import { SegmentationFallback } from '../segmentation-fallback.js';

const PERFORMANCE_INTERVALS = {
    quality: 33,
    balanced: 66,
    battery: 120,
};

const PERFORMANCE_SCALES = {
    quality: 1,
    balanced: 0.75,
    battery: 0.5,
};

const VALID_PERFORMANCE_MODES = Object.keys(PERFORMANCE_INTERVALS);
const MIN_MASK_DIMENSION = 64;

/**
 * 2D canvas fallback with manual four-point anchors and segmentation-based occlusion.
 */
export class CanvasFallbackEngine {
    constructor(container, data, statusCallback = () => {}) {
        this.container = container;
        this.data = data;
        this.onStatus = statusCallback;
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.wallpaperImage = null;
        this.corners = [];
        this.isDragging = false;
        this.draggedCornerIndex = -1;
        this.segmentation = null;
        this.segmentationMask = document.createElement('canvas');
        this.segmentationCtx = this.segmentationMask.getContext('2d');
        this.wallpaperBuffer = document.createElement('canvas');
        this.wallpaperBufferCtx = this.wallpaperBuffer.getContext('2d');
        this.active = true;
        this.performanceMode = this.sanitisePerformanceMode(data.performance_mode);
        this.segmentationInterval = PERFORMANCE_INTERVALS[this.performanceMode];
        this.segmentationScale = PERFORMANCE_SCALES[this.performanceMode];
        this.lastSegmentationRun = 0;
        this.lastMaskFrame = null;
        this.isEstimatingMask = false;
        this.init();
    }

    sanitisePerformanceMode(mode) {
        const value = typeof mode === 'string' ? mode.toLowerCase() : '';
        if (VALID_PERFORMANCE_MODES.includes(value)) {
            return value;
        }
        return 'balanced';
    }

    init() {
        this.container.innerHTML = '';

        this.video = document.createElement('video');
        this.video.setAttribute('autoplay', '');
        this.video.setAttribute('playsinline', '');
        this.video.style.position = 'absolute';
        this.video.style.top = '0';
        this.video.style.left = '0';
        this.video.style.width = '100%';
        this.video.style.height = '100%';
        this.video.style.objectFit = 'cover';
        this.container.appendChild(this.video);

        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.wallpaperImage = new Image();
        this.wallpaperImage.crossOrigin = 'anonymous';
        this.wallpaperImage.onload = () => {
            this.startCamera();
        };
        this.wallpaperImage.onerror = () => {
            this.container.innerHTML = `<p class="arwp-error">${this.data.i18n.image_load_error}</p>`;
        };
        this.wallpaperImage.src = this.data.image_url;

        this.setupUI();
        this.setupListeners();
        this.onStatus({ id: 'engine', label: this.data.i18n.status_canvas, state: 'neutral' });
    }

    async startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
            this.video.srcObject = stream;
            this.video.onloadedmetadata = () => {
                this.video.play();
                this.resizeCanvas();
                this.resetCorners();
                this.initSegmentation();
                this.animate();
            };
        } catch (error) {
            this.container.innerHTML = `<p class="arwp-error">${this.data.i18n.camera_error}</p>`;
            console.error('AR Wallpaper Preview: camera error', error);
            this.active = false;
        }
    }

    async initSegmentation() {
        if (this.data.occlusion_mode === 'off') {
            return;
        }
        this.segmentation = new SegmentationFallback({
            mode: this.data.occlusion_mode,
            dilation: 6,
            performanceMode: this.performanceMode,
            moduleConfig: this.data.mediapipe,
        });
        try {
            await this.segmentation.load();
            this.onStatus({ id: 'occlusion', label: this.data.i18n.status_canvas_occlusion || this.data.i18n.status_segmentation, state: 'success' });
        } catch (error) {
            console.warn('AR Wallpaper Preview: segmentation model failed to load', error);
            this.onStatus({ id: 'occlusion', label: this.data.i18n.status_segmentation_fail, state: 'warning' });
            this.segmentation = null;
        }
    }

    setupUI() {
        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.textContent = this.data.i18n.canvas_guidance;
        }

        const controls = document.getElementById('arwp-ui-controls');
        if (!controls) {
            return;
        }

        const performanceLabel = this.data.i18n.performance_label || 'Mask performance';
        const performanceOptions = [
            { value: 'quality', label: this.data.i18n.performance_quality || 'Quality' },
            { value: 'balanced', label: this.data.i18n.performance_balanced || 'Balanced' },
            { value: 'battery', label: this.data.i18n.performance_battery || 'Battery Saver' },
        ];

        controls.innerHTML = `
            <div class="arwp-control-group">
                <button type="button" data-action="fit-width">${this.data.i18n.fit_width}</button>
                <button type="button" data-action="fit-height">${this.data.i18n.fit_height}</button>
                <button type="button" data-action="reset">${this.data.i18n.reset}</button>
                <button type="button" data-action="snapshot">${this.data.i18n.snapshot}</button>
            </div>
            <div class="arwp-control-group arwp-performance-group">
                <label>
                    <span>${performanceLabel}</span>
                    <select data-action="performance-mode">
                        ${performanceOptions
                            .map((option) => `<option value="${option.value}">${option.label}</option>`)
                            .join('')}
                    </select>
                </label>
            </div>
        `;

        const performanceSelect = controls.querySelector('select[data-action="performance-mode"]');
        if (performanceSelect) {
            performanceSelect.value = this.performanceMode;
        }

        controls.addEventListener('click', (event) => {
            const action = event.target.getAttribute('data-action');
            if (!action) {
                return;
            }

            if (action === 'reset') {
                this.resetCorners();
            } else if (action === 'fit-width') {
                this.fitWidth();
            } else if (action === 'fit-height') {
                this.fitHeight();
            } else if (action === 'snapshot') {
                this.exportSnapshot();
            }
        });

        controls.addEventListener('change', (event) => {
            const action = event.target.getAttribute('data-action');
            if (action === 'performance-mode') {
                this.updatePerformanceMode(event.target.value);
            }
        });
    }

    setupListeners() {
        window.addEventListener('resize', this.resizeCanvas.bind(this));
        this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
        this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
        this.canvas.addEventListener('pointercancel', this.onPointerUp.bind(this));
    }

    resizeCanvas() {
        const { clientWidth, clientHeight } = this.container;
        this.canvas.width = clientWidth;
        this.canvas.height = clientHeight;
        this.wallpaperBuffer.width = clientWidth;
        this.wallpaperBuffer.height = clientHeight;
        if (!this.corners.length) {
            this.resetCorners();
        }
    }

    resetCorners() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const wallRatio = this.data.width_cm / this.data.height_cm;
        const canvasRatio = w / h;

        let width = w * 0.68;
        let height = width / wallRatio;
        if (height > h * 0.75) {
            height = h * 0.75;
            width = height * wallRatio;
        }

        const offsetX = (w - width) / 2;
        const offsetY = (h - height) / 2;

        this.corners = [
            offsetX, offsetY,
            offsetX + width, offsetY,
            offsetX + width, offsetY + height,
            offsetX, offsetY + height,
        ];
    }

    fitWidth() {
        const w = this.canvas.width * 0.9;
        const wallRatio = this.data.width_cm / this.data.height_cm;
        const h = w / wallRatio;
        const offsetX = (this.canvas.width - w) / 2;
        const offsetY = (this.canvas.height - h) / 2;
        this.corners = [
            offsetX, offsetY,
            offsetX + w, offsetY,
            offsetX + w, offsetY + h,
            offsetX, offsetY + h,
        ];
    }

    fitHeight() {
        const h = this.canvas.height * 0.9;
        const wallRatio = this.data.width_cm / this.data.height_cm;
        const w = h * wallRatio;
        const offsetX = (this.canvas.width - w) / 2;
        const offsetY = (this.canvas.height - h) / 2;
        this.corners = [
            offsetX, offsetY,
            offsetX + w, offsetY,
            offsetX + w, offsetY + h,
            offsetX, offsetY + h,
        ];
    }

    onPointerDown(event) {
        event.preventDefault();
        const { x, y } = this.pointerToCanvas(event);
        const index = this.hitTestCorner(x, y);
        if (index !== -1) {
            this.isDragging = true;
            this.draggedCornerIndex = index;
        }
    }

    onPointerMove(event) {
        if (!this.isDragging) {
            return;
        }
        event.preventDefault();
        const { x, y } = this.pointerToCanvas(event);
        this.corners[this.draggedCornerIndex] = x;
        this.corners[this.draggedCornerIndex + 1] = y;
    }

    onPointerUp() {
        this.isDragging = false;
        this.draggedCornerIndex = -1;
    }

    pointerToCanvas(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
        };
    }

    hitTestCorner(x, y) {
        const cornerSize = 24;
        for (let i = 0; i < this.corners.length; i += 2) {
            const cx = this.corners[i];
            const cy = this.corners[i + 1];
            if (Math.abs(x - cx) <= cornerSize && Math.abs(y - cy) <= cornerSize) {
                return i;
            }
        }
        return -1;
    }

    async animate() {
        if (!this.active) {
            return;
        }
        await this.drawFrame();
        requestAnimationFrame(() => this.animate());
    }

    async drawFrame() {
        if (this.video.readyState < this.video.HAVE_CURRENT_DATA) {
            return;
        }

        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.drawImage(this.video, 0, 0, width, height);

        this.prepareWallpaperBuffer(width, height);

        let maskFrame = null;
        if (this.segmentation) {
            maskFrame = await this.getSegmentationMask(width, height);
        }

        if (maskFrame) {
            this.applyMaskToVideo(maskFrame, width, height);
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'destination-over';
            this.ctx.drawImage(this.wallpaperBuffer, 0, 0, width, height);
            this.ctx.restore();
        } else {
            this.ctx.save();
            this.ctx.drawImage(this.wallpaperBuffer, 0, 0, width, height);
            this.ctx.restore();
        }

        this.drawCornerHandles();
    }

    prepareWallpaperBuffer(width, height) {
        if (this.wallpaperBuffer.width !== width || this.wallpaperBuffer.height !== height) {
            this.wallpaperBuffer.width = width;
            this.wallpaperBuffer.height = height;
        } else {
            this.wallpaperBufferCtx.clearRect(0, 0, width, height);
        }
        this.drawWallpaper(this.wallpaperBufferCtx);
    }

    async getSegmentationMask(width, height) {
        if (this.isEstimatingMask) {
            return this.lastMaskFrame;
        }
        const now = performance.now();
        if (now - this.lastSegmentationRun < this.segmentationInterval) {
            return this.lastMaskFrame;
        }

        this.lastSegmentationRun = now;
        this.isEstimatingMask = true;

        const scaledWidth = Math.max(MIN_MASK_DIMENSION, Math.round(width * this.segmentationScale));
        const scaledHeight = Math.max(MIN_MASK_DIMENSION, Math.round(height * this.segmentationScale));

        try {
            const mask = await this.segmentation.estimate(
                this.video,
                scaledWidth,
                scaledHeight,
                this.segmentationMask,
                this.segmentationCtx,
            );
            if (mask) {
                this.lastMaskFrame = { canvas: mask, width: scaledWidth, height: scaledHeight };
            }
        } catch (error) {
            console.warn('AR Wallpaper Preview: segmentation estimate failed', error);
        } finally {
            this.isEstimatingMask = false;
        }

        return this.lastMaskFrame;
    }

    applyMaskToVideo(maskFrame, width, height) {
        if (!maskFrame || !maskFrame.canvas || this.corners.length < 8) {
            return;
        }
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(this.corners[0], this.corners[1]);
        for (let i = 2; i < this.corners.length; i += 2) {
            this.ctx.lineTo(this.corners[i], this.corners[i + 1]);
        }
        this.ctx.closePath();
        this.ctx.clip();
        this.ctx.globalCompositeOperation = 'destination-in';
        this.ctx.drawImage(maskFrame.canvas, 0, 0, width, height);
        this.ctx.restore();
    }

    updatePerformanceMode(mode) {
        const resolved = this.sanitisePerformanceMode(mode);
        if (resolved === this.performanceMode) {
            return;
        }
        this.performanceMode = resolved;
        this.data.performance_mode = resolved;
        this.segmentationInterval = PERFORMANCE_INTERVALS[this.performanceMode];
        this.segmentationScale = PERFORMANCE_SCALES[this.performanceMode];
        this.lastSegmentationRun = 0;
        this.lastMaskFrame = null;
        const controls = document.getElementById('arwp-ui-controls');
        const select = controls ? controls.querySelector('select[data-action="performance-mode"]') : null;
        if (select) {
            select.value = this.performanceMode;
        }
    }

    drawWallpaper(targetCtx = this.ctx) {
        if (!this.corners.length) {
            return;
        }

        const [x0, y0, x1, y1, , , x3, y3] = this.corners;
        const sX0 = 0;
        const sY0 = 0;
        const sX1 = this.wallpaperImage.width;
        const sY1 = 0;
        const sX2 = 0;
        const sY2 = this.wallpaperImage.height;

        const dX0 = x0;
        const dY0 = y0;
        const dX1 = x1;
        const dY1 = y1;
        const dX2 = x3;
        const dY2 = y3;

        const denom = (sX1 - sX0) * (sY2 - sY0) - (sY1 - sY0) * (sX2 - sX0);
        if (denom === 0) {
            return;
        }

        const m11 = ((dX1 - dX0) * (sY2 - sY0) - (dX2 - dX0) * (sY1 - sY0)) / denom;
        const m12 = ((dX2 - dX0) * (sX1 - sX0) - (dX1 - dX0) * (sX2 - sX0)) / denom;
        const m21 = ((dY1 - dY0) * (sY2 - sY0) - (dY2 - dY0) * (sY1 - sY0)) / denom;
        const m22 = ((dY2 - dY0) * (sX1 - sX0) - (dY1 - dY0) * (sX2 - sX0)) / denom;

        const ctx = targetCtx;

        ctx.save();
        ctx.transform(m11, m21, m12, m22, dX0, dY0);

        const tileX = this.data.tiling ? Math.max(1, this.data.repeat_x) : 1;
        const tileY = this.data.tiling ? Math.max(1, this.data.repeat_y) : 1;

        const tileWidth = this.wallpaperImage.width / tileX;
        const tileHeight = this.wallpaperImage.height / tileY;

        ctx.globalAlpha = Math.min(Math.max(this.data.brightness, 0.1), 1.25);

        for (let x = 0; x < tileX; x++) {
            for (let y = 0; y < tileY; y++) {
                ctx.drawImage(
                    this.wallpaperImage,
                    0,
                    0,
                    this.wallpaperImage.width,
                    this.wallpaperImage.height,
                    x * tileWidth,
                    y * tileHeight,
                    tileWidth,
                    tileHeight,
                );
            }
        }

        ctx.restore();
    }

    drawCornerHandles() {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(this.corners[0], this.corners[1]);
        this.ctx.lineTo(this.corners[2], this.corners[3]);
        this.ctx.lineTo(this.corners[4], this.corners[5]);
        this.ctx.lineTo(this.corners[6], this.corners[7]);
        this.ctx.closePath();
        this.ctx.stroke();

        this.ctx.fillStyle = '#1d4ed8';
        for (let i = 0; i < this.corners.length; i += 2) {
            const x = this.corners[i];
            const y = this.corners[i + 1];
            this.ctx.beginPath();
            this.ctx.arc(x, y, 10, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.restore();
    }

    exportSnapshot() {
        const link = document.createElement('a');
        link.download = 'ar-wallpaper-snapshot.png';
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
}

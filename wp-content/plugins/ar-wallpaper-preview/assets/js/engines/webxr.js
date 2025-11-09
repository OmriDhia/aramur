import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { ARButton } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/webxr/ARButton.js';
import { createWallpaperMaterial } from '../shaders/wallpaper-depth-material.js';
import { PoseSmoother } from '../pose-smoothing.js';
import { DepthOcclusionManager } from '../depth-occlusion.js';
import { SegmentationFallback } from '../segmentation-fallback.js';

/**

 * WebXR engine with automatic wall fitting, depth occlusion and segmentation fallback.

 */
export class WebXREngine {
    constructor(container, data, statusCallback = () => {}) {
        this.container = container;
        this.data = data;

        this.onStatus = statusCallback;


        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.reticle = null;
        this.wallpaperMesh = null;
        this.hitTestSource = null;
        this.viewerSpace = null;

        this.localSpace = null;
        this.controller = null;
        this.isConfirmed = false;
        this.smoother = new PoseSmoother(0.12);
        this.depthManager = null;
        this.segmentation = null;
        this.segmentationVideo = null;
        this.segmentationCanvas = document.createElement('canvas');
        this.segmentationCtx = this.segmentationCanvas.getContext('2d');
        this.segmentationTexture = new THREE.CanvasTexture(this.segmentationCanvas);
        this.segmentationTexture.minFilter = THREE.LinearFilter;
        this.segmentationTexture.magFilter = THREE.LinearFilter;
        this.segmentationTexture.needsUpdate = true;
        this.lastSegmentationTime = 0;
        this.planeBasis = null;
        this.planeSamples = [];
        this.wallStats = { width: null, height: null };
        this.currentScale = 1;
        this.guidance = document.getElementById('arwp-guidance');
        this.controlsRoot = document.getElementById('arwp-ui-controls');
        this.autoWallFit = data.auto_wall_fit !== false;
        this.lastHitMatrix = null;
        this.performanceMode = data.performance_mode || 'balanced';
        this.segmentationInterval = this.performanceMode === 'battery' ? 50 : (this.performanceMode === 'quality' ? 16 : 33);


        this.init();
    }

    async init() {

        if (!navigator.xr) {
            this.showError(this.data.i18n.unsupported_device);

            return;
        }

        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!supported) {

            this.showError(this.data.i18n.unsupported_device);

            return;
        }

        this.setupScene();
        this.setupRenderer();
        this.setupARButton();
        this.setupUI();
        this.animate();

        this.onStatus({ id: 'engine', label: this.data.i18n.status_webxr_ready, state: 'success' });
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);


        const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        this.scene.add(ambient);
        const dir = new THREE.DirectionalLight(0xffffff, 0.5);
        dir.position.set(0.3, 1, 0.2);
        this.scene.add(dir);

        const geometry = new THREE.RingGeometry(0.12, 0.16, 32);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.reticle = new THREE.Mesh(geometry, material);
        this.reticle.matrixAutoUpdate = false;
        this.reticle.matrix.identity();
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        this.wallpaperMesh = this.createWallpaperMesh();
        this.wallpaperMesh.visible = false;
        this.scene.add(this.wallpaperMesh);
    }

    createWallpaperMesh() {
        const geometry = new THREE.PlaneGeometry(this.wallpaperWidthMeters, this.wallpaperHeightMeters, 1, 1);
        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load(this.data.image_url, (tex) => {
            if (this.data.tiling) {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(this.data.repeat_x, this.data.repeat_y);
            }
            if (tex.image && (tex.image.width > this.data.max_texture_resolution || tex.image.height > this.data.max_texture_resolution)) {
                console.warn('Wallpaper texture exceeds configured max resolution.');
            }
        });

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            roughness: 0.82,
            metalness: 0,
            transparent: true,
            alphaMap: this.depthTexture,
            alphaTest: 0.45,
        });

        return new THREE.Mesh(geometry, material);
    }

    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.outputEncoding = THREE.sRGBEncoding;

        this.container.appendChild(this.renderer.domElement);
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    setupARButton() {

        const button = ARButton.createButton(this.renderer, {
            requiredFeatures: ['hit-test', 'dom-overlay'],
            optionalFeatures: ['plane-detection', 'anchors', 'mesh-detection', 'light-estimation', 'depth-sensing'],
            domOverlay: { root: this.container },
        });
        button.textContent = this.data.i18n.place;

        button.id = 'arwp-ar-button';
        button.textContent = this.data.i18n.place;
        this.container.appendChild(button);

        this.renderer.xr.addEventListener('sessionstart', this.onSessionStart.bind(this));
        this.renderer.xr.addEventListener('sessionend', this.onSessionEnd.bind(this));
    }

    setupUI() {
        if (!this.controlsRoot) {
            return;
        }
        this.controlsRoot.innerHTML = `
            <div class="arwp-control-group">
                <button type="button" data-action="confirm">${this.data.i18n.confirm}</button>
                <button type="button" data-action="fit-width">${this.data.i18n.fit_width}</button>
                <button type="button" data-action="fit-height">${this.data.i18n.fit_height}</button>
                <button type="button" data-action="center">${this.data.i18n.center}</button>
                <button type="button" data-action="scale-up">${this.data.i18n.scale_up}</button>
                <button type="button" data-action="scale-down">${this.data.i18n.scale_down}</button>
                <button type="button" data-action="rotate-left">${this.data.i18n.rotate_left}</button>
                <button type="button" data-action="rotate-right">${this.data.i18n.rotate_right}</button>
                <button type="button" data-action="reset">${this.data.i18n.reset}</button>
                <button type="button" data-action="snapshot">${this.data.i18n.snapshot}</button>
            </div>
        `;
        this.controlsRoot.addEventListener('click', (event) => {
            const action = event.target.getAttribute('data-action');
            if (!action) {
                return;
            }
            switch (action) {
                case 'confirm':
                    this.confirmPlacement();
                    break;
                case 'fit-width':
                    this.fitWidth();
                    break;
                case 'fit-height':
                    this.fitHeight();
                    break;
                case 'center':
                    this.centerOnPlane();
                    break;
                case 'scale-up':
                    this.adjustScale(0.05);
                    break;
                case 'scale-down':
                    this.adjustScale(-0.05);
                    break;
                case 'rotate-left':
                    this.wallpaperMesh.rotateY(THREE.MathUtils.degToRad(-2));
                    break;
                case 'rotate-right':
                    this.wallpaperMesh.rotateY(THREE.MathUtils.degToRad(2));
                    break;
                case 'reset':
                    this.resetPlacement();
                    break;
                case 'snapshot':
                    this.captureSnapshot();
                    break;
            }
        });

        window.addEventListener('keydown', (event) => {
            if (!this.wallpaperMesh.visible) {
                return;
            }
            const step = 0.02;
            switch (event.key) {
                case 'ArrowUp':
                    this.wallpaperMesh.position.addScaledVector(this.planeBasis?.up || new THREE.Vector3(0, 1, 0), step);
                    break;
                case 'ArrowDown':
                    this.wallpaperMesh.position.addScaledVector(this.planeBasis?.up || new THREE.Vector3(0, 1, 0), -step);
                    break;
                case 'ArrowLeft':
                    this.wallpaperMesh.position.addScaledVector(this.planeBasis?.right || new THREE.Vector3(1, 0, 0), -step);
                    break;
                case 'ArrowRight':
                    this.wallpaperMesh.position.addScaledVector(this.planeBasis?.right || new THREE.Vector3(1, 0, 0), step);
                    break;
            }
        });
    }

    createWallpaperMesh() {
        const width = (this.data.width_cm || 300) * 0.01;
        const height = (this.data.height_cm || 250) * 0.01;
        const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
        const loader = new THREE.TextureLoader();
        const texture = loader.load(this.data.image_url);
        texture.encoding = THREE.sRGBEncoding;
        if (this.data.tiling) {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(this.data.repeat_x || 1, this.data.repeat_y || 1);
        }

        const material = createWallpaperMaterial(texture);
        material.uniforms.uBrightness.value = this.data.brightness || 1;
        material.uniforms.uAlpha.value = 0.35;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        return mesh;
    }

    onWindowResize() {

        if (!this.renderer) {

            return;
        }
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.wallpaperMesh?.material) {
            this.wallpaperMesh.material.uniforms.uResolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height);
        }
    }

    async onSessionStart(event) {
        const session = event.target.getSession();

        this.depthManager = new DepthOcclusionManager(this.renderer, this.onStatus, this.data.i18n || {});
        await this.depthManager.configure(session);

        this.viewerSpace = await session.requestReferenceSpace('viewer');
        this.localSpace = await session.requestReferenceSpace('local-floor').catch(() => session.requestReferenceSpace('local'));

        this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });

        this.controller = this.renderer.xr.getController(0);
        this.controller.addEventListener('select', () => this.confirmPlacement());
        this.scene.add(this.controller);

        if (this.data.occlusion_mode !== 'off') {
            await this.initSegmentationFallback();
        }

        if (session.requestLightProbe) {
            try {
                this.lightProbe = await session.requestLightProbe();
                this.onStatus({ id: 'lighting', label: this.data.i18n.status_light_estimation, state: 'success' });
            } catch (error) {
                console.warn('AR Wallpaper Preview: light probe unavailable', error);
            }
        }

        if (this.guidance) {
            this.guidance.textContent = this.data.i18n.guidance_overlay;
        }

        this.onStatus({ id: 'plane', label: this.data.i18n.status_searching, state: 'pending' });
        this.wallpaperMesh.material.uniforms.uResolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height);

    }

    onSessionEnd() {
        if (this.hitTestSource) {
            this.hitTestSource.cancel();
            this.hitTestSource = null;
        }

        if (this.segmentationVideo?.srcObject) {
            const tracks = this.segmentationVideo.srcObject.getTracks();
            tracks.forEach((track) => track.stop());
        }
        this.segmentationVideo = null;
        this.segmentation = null;
        this.wallpaperMesh.visible = false;
        this.reticle.visible = false;
        this.isConfirmed = false;
        this.smoother.reset();
        this.planeBasis = null;
        this.planeSamples = [];
        if (this.guidance) {
            this.guidance.textContent = this.data.i18n.guidance_overlay;
        }
        this.onStatus({ id: 'plane', label: this.data.i18n.status_searching, state: 'neutral' });
    }

    async initSegmentationFallback() {
        this.segmentation = new SegmentationFallback({
            mode: this.data.occlusion_mode,
            dilation: 4,
            performanceMode: this.data.performance_mode,
            moduleConfig: this.data.mediapipe,
        });
        try {
            await this.segmentation.load();
            this.onStatus({ id: 'occlusion', label: this.data.i18n.status_segmentation, state: 'warning' });
        } catch (error) {
            console.warn('AR Wallpaper Preview: segmentation fallback failed', error);
            this.segmentation = null;
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            return;
        }
        this.segmentationVideo = document.createElement('video');
        this.segmentationVideo.setAttribute('playsinline', '');
        this.segmentationVideo.muted = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
            this.segmentationVideo.srcObject = stream;
            await this.segmentationVideo.play();
        } catch (error) {
            console.warn('AR Wallpaper Preview: unable to start segmentation video', error);
        }
    }

    animate() {
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    render(timestamp, frame) {
        const session = this.renderer.xr.getSession();
        if (!frame || !session) {
            this.renderer.render(this.scene, this.camera);
            return;
        }

        const referenceSpace = this.localSpace || this.renderer.xr.getReferenceSpace();

        if (this.hitTestSource && !this.isConfirmed) {
            this.handleHitTest(frame, referenceSpace);
        }

        this.updateDepth(frame, referenceSpace);
        this.updateSegmentation(timestamp);
        this.updateLightEstimation(frame);

        this.renderer.render(this.scene, this.camera);
    }

    handleHitTest(frame, referenceSpace) {
        const results = frame.getHitTestResults(this.hitTestSource);
        if (!results.length) {
            this.reticle.visible = false;
            return;
        }

        const hit = results[0];
        const pose = hit.getPose(referenceSpace);
        if (!pose) {
            return;
        }

        const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const position = new THREE.Vector3().setFromMatrixPosition(matrix);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

        const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
        const verticalThreshold = 0.4;
        if (Math.abs(normal.y) > verticalThreshold) {
            return;
        }

        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize();
        const up = new THREE.Vector3().crossVectors(normal, right).normalize();
        this.planeBasis = { normal, right, up, origin: position.clone() };
        this.lastHitMatrix = matrix.clone();

        this.reticle.matrix.fromArray(pose.transform.matrix);
        this.reticle.visible = true;

        if (!this.autoWallFit && !this.wallpaperMesh.visible) {
            this.onStatus({ id: 'plane', label: this.data.i18n.status_wall_detected, state: 'success' });
            return;
        }

        const smoothed = this.smoother.smooth(position, quaternion);
        this.wallpaperMesh.position.copy(smoothed.position);
        this.wallpaperMesh.quaternion.copy(this.alignToGravity(smoothed.quaternion));
        this.wallpaperMesh.visible = true;
        this.wallpaperMesh.material.uniforms.uAlpha.value = this.isConfirmed ? 1 : 0.55;
        this.reticle.visible = !this.isConfirmed;

        this.collectPlaneSample(position);
        this.onStatus({ id: 'plane', label: this.data.i18n.status_wall_detected, state: 'success' });
    }

    alignToGravity(quaternion) {
        const up = new THREE.Vector3(0, 1, 0);
        const currentUp = up.clone().applyQuaternion(quaternion);
        currentUp.normalize();
        const correction = new THREE.Quaternion().setFromUnitVectors(currentUp, up);
        return quaternion.clone().multiply(correction);
    }

    collectPlaneSample(point) {
        if (!this.planeBasis) {
            return;
        }
        const relative = point.clone().sub(this.planeBasis.origin);
        const x = relative.dot(this.planeBasis.right);
        const y = relative.dot(this.planeBasis.up);
        this.planeSamples.push({ x, y });
        if (this.planeSamples.length > 120) {
            this.planeSamples.shift();
        }
        const xs = this.planeSamples.map((sample) => sample.x);
        const ys = this.planeSamples.map((sample) => sample.y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        if (width > 0.1) {
            this.wallStats.width = width;
        }
        if (height > 0.1) {
            this.wallStats.height = height;
        }
    }

    confirmPlacement() {
        if (!this.wallpaperMesh.visible && this.lastHitMatrix) {
            const position = new THREE.Vector3().setFromMatrixPosition(this.lastHitMatrix);
            const quaternion = new THREE.Quaternion().setFromRotationMatrix(this.lastHitMatrix);
            this.wallpaperMesh.position.copy(position);
            this.wallpaperMesh.quaternion.copy(this.alignToGravity(quaternion));
            this.wallpaperMesh.visible = true;
            this.collectPlaneSample(position.clone());
        }
        if (!this.wallpaperMesh.visible) {
            return;
        }
        this.isConfirmed = true;
        this.wallpaperMesh.material.uniforms.uAlpha.value = 1;
        this.reticle.visible = false;
        if (this.guidance) {
            this.guidance.textContent = this.data.i18n.guidance_confirmed;
        }
    }

    resetPlacement() {
        this.isConfirmed = false;
        this.smoother.reset();
        this.planeSamples = [];
        this.wallStats = { width: null, height: null };
        this.wallpaperMesh.material.uniforms.uAlpha.value = 0.35;
    }

    adjustScale(delta) {
        this.currentScale = Math.max(0.25, this.currentScale + delta);
        this.wallpaperMesh.scale.setScalar(this.currentScale);
    }

    fitWidth() {
        if (!this.wallStats.width) {

            return;
        }
        const target = this.wallStats.width;
        const nativeWidth = (this.data.width_cm || 300) * 0.01;
        this.currentScale = target / nativeWidth;
        this.wallpaperMesh.scale.setScalar(this.currentScale);
    }


    fitHeight() {
        if (!this.wallStats.height) {
            return;
        }
        const target = this.wallStats.height;
        const nativeHeight = (this.data.height_cm || 250) * 0.01;
        this.currentScale = target / nativeHeight;
        this.wallpaperMesh.scale.setScalar(this.currentScale);
    }

    centerOnPlane() {
        if (!this.planeBasis || !this.wallStats.width || !this.wallStats.height) {
            return;
        }
        this.wallpaperMesh.position.copy(this.planeBasis.origin.clone());
    }

    async captureSnapshot() {
        const canvas = this.renderer.domElement;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
            return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'ar-wallpaper.png';
        anchor.click();
        URL.revokeObjectURL(url);
    }

    updateDepth(frame, referenceSpace) {
        if (!this.depthManager) {
            return;
        }
        const depth = this.depthManager.update(frame, referenceSpace);
        if (!depth) {
            return;
        }
        this.wallpaperMesh.material.uniforms.uDepthTexture.value = depth.texture;
        this.wallpaperMesh.material.uniforms.uDepthEnabled.value = 1;
        this.wallpaperMesh.material.uniforms.uResolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height);
        this.wallpaperMesh.material.uniforms.uDepthScale.value = depth.meterScale;
        this.onStatus({ id: 'occlusion', label: this.data.i18n.status_depth, state: 'success' });
    }

    async updateSegmentation(timestamp) {
        if (!this.segmentation || !this.segmentationVideo) {
            return;
        }
        if (timestamp - this.lastSegmentationTime < this.segmentationInterval) {
            return;
        }
        this.lastSegmentationTime = timestamp;
        const width = this.renderer.domElement.width;
        const height = this.renderer.domElement.height;
        const mask = await this.segmentation.estimate(
            this.segmentationVideo,
            width,
            height,
            this.segmentationCanvas,
            this.segmentationCtx,
        );
        if (mask) {
            this.segmentationTexture.image = mask;
            this.segmentationTexture.needsUpdate = true;
            this.wallpaperMesh.material.uniforms.uSegmentationTexture.value = this.segmentationTexture;
            this.wallpaperMesh.material.uniforms.uSegmentationEnabled.value = this.wallpaperMesh.material.uniforms.uDepthEnabled.value ? 0 : 1;
        }
    }

    updateLightEstimation(frame) {
        if (!this.lightProbe) {
            return;
        }
        const estimate = frame.getLightEstimate?.(this.lightProbe);
        if (!estimate) {
            return;

        }
        const intensity = estimate?.primaryLightIntensity;
        if (intensity) {
            const avg = (intensity.x + intensity.y + intensity.z) / 3;
            const brightness = THREE.MathUtils.clamp(avg / 1000, 0.6, 1.4);
            this.wallpaperMesh.material.uniforms.uBrightness.value = brightness;
        }
    }

    showError(message) {
        if (this.guidance) {
            this.guidance.textContent = message;
            this.guidance.style.color = 'red';
        }
        this.onStatus({ id: 'engine', label: message, state: 'error' });
    }

    animate() {
        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
    }

    showStatus(message) {
        const guidance = document.getElementById('arwp-guidance');
        if (!guidance) {
            return;
        }

        guidance.textContent = message || '';
        guidance.style.display = message ? 'block' : 'none';
    }
}

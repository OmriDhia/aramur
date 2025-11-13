import { ObjectDetectHelper } from './object-detect.js';
import { configureVisionSources, loadVisionFileset, loadVisionModule } from './vision-loader.js';

const DEFAULT_SEGMENTATION_MODELS = [
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.task',
];

// Add a multi-class general segmenter model (if available) as a recommended option
const MULTI_CLASS_SEGMENTER = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/general_segmenter/float16/1/general_segmenter.task';

/**
 * Segmentation fallback used when depth occlusion is not available.
 */
export class SegmentationFallback {
    constructor({ mode = 'segmentation', dilation = 4, feather = 3, smoothing = 0.6, performanceMode = 'balanced', moduleConfig = {} } = {}) {
        this.mode = mode;
        this.dilation = dilation;
        this.feather = feather;
        this.smoothing = Math.max(0, Math.min(1, smoothing));
        this.performanceMode = performanceMode;
        this.segmenter = null;
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.objectHelper = null;
        this._tmpCanvas = document.createElement('canvas');
        this._tmpCtx = this._tmpCanvas.getContext('2d');
        this._prevMask = null; // ImageData of previous mask alpha channel for temporal smoothing
        const globalConfig = typeof window !== 'undefined' && window.arwpData ? window.arwpData.mediapipe : null;
        this.moduleConfig = moduleConfig && Object.keys(moduleConfig).length ? moduleConfig : (globalConfig || {});
        this.modelUrls = Array.isArray(this.moduleConfig?.segmenterModels) && this.moduleConfig.segmenterModels.length
            ? this.moduleConfig.segmenterModels
            : (this.moduleConfig?.preferMultiClass ? [MULTI_CLASS_SEGMENTER, ...DEFAULT_SEGMENTATION_MODELS] : DEFAULT_SEGMENTATION_MODELS);
        configureVisionSources(this.moduleConfig);

        // Default set of foreground labels we want to keep in front of wallpaper
        this.foregroundLabels = new Set([
            'person', 'chair', 'sofa', 'couch', 'dining table', 'diningtable', 'table', 'potted plant', 'pottedplant', 'plant', 'tv', 'television', 'bed'
        ]);
    }

    async load() {
        const vision = await loadVisionFileset();
        const { ImageSegmenter } = await loadVisionModule();
        this.segmenter = await this.createSegmenter(ImageSegmenter, vision);
        if (this.mode === 'objects') {
            this.objectHelper = new ObjectDetectHelper({ moduleConfig: this.moduleConfig });
            await this.objectHelper.load();
        } else {
            // Even when using segmentation-only mode, we still keep an object detector helper to supplement (optional)
            this.objectHelper = new ObjectDetectHelper({ moduleConfig: this.moduleConfig });
            await this.objectHelper.load();
        }
    }

    async createSegmenter(ImageSegmenter, vision) {
        let lastError = null;
        for (const url of this.modelUrls) {
            if (!url) {
                continue;
            }
            try {
                // eslint-disable-next-line no-await-in-loop
                return await ImageSegmenter.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: url,
                    },
                    outputCategoryMask: true,
                    runningMode: 'VIDEO',
                });
            } catch (error) {
                console.warn('AR Wallpaper Preview: failed to load segmentation model', url, error);
                lastError = error;
            }
        }
        throw lastError || new Error('Unable to load segmentation model');
    }

    /**
     * Main estimate method — produces a mask canvas where alpha=255 for foreground objects we want
     */
    async estimate(video, width, height, targetCanvas, targetCtx) {
        if (!this.segmenter) {
            return null;
        }

        if (targetCanvas.width !== width || targetCanvas.height !== height) {
            targetCanvas.width = width;
            targetCanvas.height = height;
        }

        const segmentation = await this.segmenter.segmentForVideo(video, performance.now());
        const mask = segmentation?.categoryMask;
        if (!mask) {
            return null;
        }

        // the categoryMask may provide integer class indices per-pixel (in a Float32Array)
        const floatData = mask.getAsFloat32Array();
        const pixels = floatData.length;
        const imageData = targetCtx.createImageData(width, height);

        // Build label map when available (some models return segmentation.categories describing labels)
        const categoriesMeta = segmentation?.categories || null; // may be an array of {index, categoryName}
        const labelForIndex = (idx) => {
            if (!categoriesMeta || !categoriesMeta.length) return String(idx);
            const meta = categoriesMeta[idx];
            if (!meta) return String(idx);
            // try several common property names
            return (meta.categoryName || meta.displayName || meta.label || meta.name || String(idx)).toLowerCase();
        };

        // If model is selfie-segmenter the mask values are likely 0..1 probabilities for foreground; if categoriesMeta is present then values are indices
        const hasCategoryIndices = Array.isArray(categoriesMeta) && categoriesMeta.length > 0;

        for (let i = 0; i < pixels; i++) {
            let alpha = 0;
            if (hasCategoryIndices) {
                const clsIdx = Math.round(floatData[i]);
                const label = labelForIndex(clsIdx);
                if (this.foregroundLabels.has(label)) {
                    alpha = 255;
                }
            } else {
                // fallback: treat value as person probability
                const prob = floatData[i];
                alpha = prob > 0.5 ? 255 : 0;
            }

            imageData.data[i * 4] = 0;
            imageData.data[i * 4 + 1] = 0;
            imageData.data[i * 4 + 2] = 0;
            imageData.data[i * 4 + 3] = alpha;
        }

        // Supplement with object detections to catch things segmentation missed.
        if (this.objectHelper) {
            const detections = await this.objectHelper.detect(video);
            detections.forEach((detection) => {
                // detection may contain categories array or label field — try to get a string label
                const detLabel = (detection?.categories?.[0]?.categoryName || detection?.categories?.[0]?.label || detection?.label || '') .toLowerCase();
                // if this detection is one of the foreground classes, fill its bounding box
                if (this.foregroundLabels.has(detLabel) || detLabel.includes('chair') || detLabel.includes('sofa') || detLabel.includes('table') || detLabel.includes('bed')) {
                    const { originX, originY, width: boxWidth, height: boxHeight } = detection.boundingBox;
                    const x0 = Math.max(0, Math.floor((originX - 0.05) * width));
                    const y0 = Math.max(0, Math.floor((originY - 0.05) * height));
                    const x1 = Math.min(width, Math.ceil((originX + boxWidth + 0.05) * width));
                    const y1 = Math.min(height, Math.ceil((originY + boxHeight + 0.05) * height));
                    for (let y = y0; y < y1; y++) {
                        for (let x = x0; x < x1; x++) {
                            imageData.data[y * width * 4 + x * 4 + 3] = 255;
                        }
                    }
                }
            });
        }

        // Apply a dilation to close small holes and then a feather blur for smooth edges
        if (this.dilation > 0) {
            this.dilate(imageData, width, height, this.dilation);
        }

        // Temporal smoothing: blend current mask alpha with previous frame's alpha to reduce flicker
        if (this.smoothing > 0) {
            const total = width * height;
            if (!this._prevMask || this._prevMask.width !== width || this._prevMask.height !== height) {
                this._prevMask = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
            } else {
                const prev = this._prevMask.data;
                const curr = imageData.data;
                const s = this.smoothing;
                for (let i = 0; i < total; i++) {
                    const idx = i * 4 + 3;
                    const prevA = prev[idx];
                    const currA = curr[idx];
                    const blended = Math.round(prevA * s + currA * (1 - s));
                    curr[idx] = blended;
                    prev[idx] = blended; // update prev for next frame
                }
            }
        }

        // Put initial binary (or temporally-smoothed) mask to canvas
        targetCtx.putImageData(imageData, 0, 0);

        if (this.feather > 0) {
            this.applyFeather(targetCanvas, targetCtx, width, height, this.feather);
        }

        return targetCanvas;
    }

    applyFeather(targetCanvas, targetCtx, width, height, feather) {
        // reuse temp canvas
        this._tmpCanvas.width = width;
        this._tmpCanvas.height = height;
        const tctx = this._tmpCtx;
        // draw current mask into temp canvas and blur it via canvas filter
        tctx.clearRect(0, 0, width, height);
        tctx.filter = `blur(${feather}px)`;
        tctx.drawImage(targetCanvas, 0, 0, width, height);
        tctx.filter = 'none';

        // read blurred alpha and write it back to target canvas as alpha channel
        const blurred = tctx.getImageData(0, 0, width, height);
        const original = targetCtx.getImageData(0, 0, width, height);

        const total = width * height;
        for (let i = 0; i < total; i++) {
            const alpha = blurred.data[i * 4 + 3];
            // copy blurred alpha into original image data alpha channel
            original.data[i * 4 + 3] = alpha;
        }

        targetCtx.putImageData(original, 0, 0);
    }

    dilate(imageData, width, height, radius) {
        const source = new Uint8ClampedArray(imageData.data);
        const dest = imageData.data;
        const rowLength = width * 4;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let maxAlpha = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= height) continue;
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        const offset = ny * rowLength + nx * 4 + 3;
                        maxAlpha = Math.max(maxAlpha, source[offset]);
                        if (maxAlpha === 255) break;
                    }
                    if (maxAlpha === 255) break;
                }
                dest[y * rowLength + x * 4 + 3] = maxAlpha;
            }
        }
    }
}

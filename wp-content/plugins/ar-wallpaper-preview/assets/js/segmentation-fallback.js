import { ObjectDetectHelper } from './object-detect.js';
import { configureVisionSources, loadVisionFileset, loadVisionModule } from './vision-loader.js';

const DEFAULT_SEGMENTATION_MODELS = [
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.task',
];

/**
 * Segmentation fallback used when depth occlusion is not available.
 */
export class SegmentationFallback {
    constructor({ mode = 'segmentation', dilation = 4, performanceMode = 'balanced', moduleConfig = {} } = {}) {
        this.mode = mode;
        this.dilation = dilation;
        this.performanceMode = performanceMode;
        this.segmenter = null;
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.objectHelper = null;
        const globalConfig = typeof window !== 'undefined' && window.arwpData ? window.arwpData.mediapipe : null;
        this.moduleConfig = moduleConfig && Object.keys(moduleConfig).length ? moduleConfig : (globalConfig || {});
        this.modelUrls = Array.isArray(this.moduleConfig?.segmenterModels) && this.moduleConfig.segmenterModels.length
            ? this.moduleConfig.segmenterModels
            : DEFAULT_SEGMENTATION_MODELS;
        configureVisionSources(this.moduleConfig);
    }

    async load() {
        const vision = await loadVisionFileset();
        const { ImageSegmenter } = await loadVisionModule();
        this.segmenter = await this.createSegmenter(ImageSegmenter, vision);
        if (this.mode === 'objects') {
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

        const floatData = mask.getAsFloat32Array();
        const pixels = floatData.length;
        const imageData = targetCtx.createImageData(width, height);
        const alphaThreshold = this.mode === 'objects' ? 0.6 : 0.5;
        for (let i = 0; i < pixels; i++) {
            const a = floatData[i] > alphaThreshold ? 255 : 0;
            imageData.data[i * 4] = 0;
            imageData.data[i * 4 + 1] = 0;
            imageData.data[i * 4 + 2] = 0;
            imageData.data[i * 4 + 3] = a;
        }

        if (this.objectHelper) {
            const detections = await this.objectHelper.detect(video);
            detections.forEach((detection) => {
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
            });
        }

        if (this.dilation > 0) {
            this.dilate(imageData, width, height, this.dilation);
        }

        targetCtx.putImageData(imageData, 0, 0);
        return targetCanvas;
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

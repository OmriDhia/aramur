import { ObjectDetectHelper } from './object-detect.js';

const SEGMENTATION_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float32/latest/selfie_segmenter.tflite';
const VISION_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';

let visionFilesetPromise = null;

async function loadVisionFileset() {
    if (!visionFilesetPromise) {
        visionFilesetPromise = import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3').then(({ FilesetResolver }) =>
            FilesetResolver.forVisionTasks(VISION_WASM_ROOT)
        );
    }
    return visionFilesetPromise;
}

/**
 * Segmentation fallback used when depth occlusion is not available.
 */
export class SegmentationFallback {
    constructor({ mode = 'segmentation', dilation = 4, performanceMode = 'balanced' } = {}) {
        this.mode = mode;
        this.dilation = dilation;
        this.performanceMode = performanceMode;
        this.segmenter = null;
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.objectHelper = null;
    }

    async load() {
        const vision = await loadVisionFileset();
        const { ImageSegmenter } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3');
        this.segmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: SEGMENTATION_MODEL_URL,
            },
            outputCategoryMask: true,
            runningMode: 'VIDEO',
        });
        if (this.mode === 'objects') {
            this.objectHelper = new ObjectDetectHelper();
            await this.objectHelper.load();
        }
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

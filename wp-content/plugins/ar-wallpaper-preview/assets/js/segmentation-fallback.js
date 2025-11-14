import { ObjectDetectHelper } from './object-detect.js';
import { configureVisionSources, loadVisionFileset, loadVisionModule } from './vision-loader.js';

const GENERAL_SEGMENTER_MODEL =
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/general_segmenter/float16/1/general_segmenter.task';
const SELFIE_SEGMENTER_MODEL =
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.task';

const DEFAULT_SEGMENTATION_MODELS = [GENERAL_SEGMENTER_MODEL, SELFIE_SEGMENTER_MODEL];

const DEFAULT_FOREGROUND_LABELS = [
    'person',
    'people',
    'human',
    'chair',
    'armchair',
    'stool',
    'sofa',
    'couch',
    'loveseat',
    'bench',
    'recliner',
    'bed',
    'bunk bed',
    'nightstand',
    'crib',
    'table',
    'dining table',
    'coffee table',
    'desk',
    'counter',
    'island',
    'tv',
    'television',
    'monitor',
    'screen',
    'computer',
    'laptop',
    'plant',
    'potted plant',
    'pottedplant',
    'flower',
    'tree',
    'wardrobe',
    'dresser',
    'cabinet',
    'shelf',
    'bookcase',
];

const DEFAULT_PARTIAL_MATCHES = ['chair', 'sofa', 'couch', 'table', 'desk', 'plant', 'tv', 'monitor', 'screen', 'bed'];

const DEFAULT_BOX_EXPANSION = 0.08;

function normaliseLabel(label) {
    return (label || '').toLowerCase().trim();
}

function uniqueArray(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function derivePartialMatches(labels) {
    const partials = new Set(DEFAULT_PARTIAL_MATCHES);
    labels.forEach((label) => {
        const norm = normaliseLabel(label);
        if (!norm) {
            return;
        }
        norm
            .split(/[\s/,-]+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 2)
            .forEach((token) => partials.add(token));
    });
    return Array.from(partials);
}

/**
 * Segmentation fallback used when depth occlusion is not available.
 */
export class SegmentationFallback {
    constructor({
        mode = 'segmentation',
        dilation = 4,
        feather = 3,
        smoothing = 0.6,
        performanceMode = 'balanced',
        moduleConfig = {},
    } = {}) {
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
        this.moduleConfig = moduleConfig && Object.keys(moduleConfig).length ? moduleConfig : globalConfig || {};

        const configuredModels = Array.isArray(this.moduleConfig?.segmenterModels)
            ? this.moduleConfig.segmenterModels.filter(Boolean)
            : null;
        this.modelUrls = configuredModels && configuredModels.length ? configuredModels : DEFAULT_SEGMENTATION_MODELS;
        configureVisionSources(this.moduleConfig);

        const maskOptions = this.resolveMaskOptions();
        this.dilation = maskOptions.dilation ?? this.dilation;
        this.feather = maskOptions.feather ?? this.feather;
        this.smoothing = maskOptions.smoothing ?? this.smoothing;
        this.personThreshold = typeof maskOptions.personThreshold === 'number' ? maskOptions.personThreshold : 0.5;
        this.boxExpansion = typeof maskOptions.boxExpansion === 'number' ? maskOptions.boxExpansion : DEFAULT_BOX_EXPANSION;

        // Default set of foreground labels we want to keep in front of wallpaper, with configuration hooks.
        const resolvedLabels = this.resolveForegroundLabels(maskOptions);
        this.foregroundLabels = new Set(resolvedLabels.map(normaliseLabel));
        this.partialLabelMatches = derivePartialMatches(resolvedLabels);
    }

    resolveMaskOptions() {
        const candidates = [
            this.moduleConfig?.mask,
            this.moduleConfig?.maskOptions,
            this.moduleConfig?.segmentationMask,
            this.moduleConfig?.segmentation,
        ];
        for (const candidate of candidates) {
            if (candidate && typeof candidate === 'object') {
                return candidate;
            }
        }
        return {};
    }

    resolveForegroundLabels(maskOptions) {
        const globalForeground =
            (typeof window !== 'undefined' && window.arwpData && window.arwpData.segmentation?.foregroundLabels) ||
            (typeof window !== 'undefined' && window.arwpData && window.arwpData.foregroundLabels);
        const candidateLists = [
            maskOptions?.foregroundLabels,
            this.moduleConfig?.foregroundLabels,
            this.moduleConfig?.segmentation?.foregroundLabels,
            this.moduleConfig?.segmentationMask?.foregroundLabels,
            globalForeground,
        ];

        let base = null;
        for (const list of candidateLists) {
            if (Array.isArray(list) && list.length) {
                base = list;
                break;
            }
        }

        if (!base) {
            base = DEFAULT_FOREGROUND_LABELS;
        }

        const additional = [];
        const additionalCandidates = [
            maskOptions?.additionalForegroundLabels,
            this.moduleConfig?.additionalForegroundLabels,
            this.moduleConfig?.segmentation?.additionalForegroundLabels,
        ];
        additionalCandidates.forEach((candidate) => {
            if (Array.isArray(candidate) && candidate.length) {
                additional.push(...candidate);
            }
        });

        return uniqueArray([...base, ...additional]);
    }

    async load() {
        const vision = await loadVisionFileset();
        const { ImageSegmenter } = await loadVisionModule();
        this.segmenter = await this.createSegmenter(ImageSegmenter, vision);

        // Even when relying primarily on segmentation we keep an object detector handy to fill gaps.
        this.objectHelper = new ObjectDetectHelper({ moduleConfig: this.moduleConfig, classes: this.getDetectorAllowlist() });
        try {
            await this.objectHelper.load();
        } catch (error) {
            console.warn('AR Wallpaper Preview: object detector unavailable, relying on tf.js fallback when possible', error);
        }
    }

    getDetectorAllowlist() {
        const base = new Set([
            'person',
            'people',
            'chair',
            'couch',
            'sofa',
            'dining table',
            'table',
            'desk',
            'coffee table',
            'potted plant',
            'plant',
            'tv',
            'television',
            'monitor',
            'screen',
            'bed',
            'bench',
            'nightstand',
            'dresser',
            'wardrobe',
            'cabinet',
            'shelf',
            'bookcase',
            'stool',
            'sofa chair',
        ]);
        this.foregroundLabels.forEach((label) => base.add(label));
        this.partialLabelMatches.forEach((token) => base.add(token));
        return Array.from(base);
    }

    isForegroundLabel(label) {
        const normalized = normaliseLabel(label);
        if (!normalized) {
            return false;
        }
        if (this.foregroundLabels.has(normalized)) {
            return true;
        }
        return this.partialLabelMatches.some((token) => normalized.includes(token));
    }

    mergeDetections(imageData, detections, width, height) {
        const data = imageData.data;
        detections.forEach((detection) => {
            if (!detection) {
                return;
            }
            const label =
                detection.label ||
                detection.categoryName ||
                detection.class ||
                detection?.categories?.[0]?.categoryName ||
                detection?.categories?.[0]?.displayName ||
                detection?.categories?.[0]?.label ||
                detection?.categories?.[0]?.name ||
                '';
            if (!this.isForegroundLabel(label)) {
                return;
            }

            const normalizedBox = this.normaliseDetectionBox(detection, width, height);
            if (!normalizedBox) {
                return;
            }
            const bounds = this.expandNormalizedBox(
                normalizedBox,
                width,
                height,
                typeof detection.boxExpansion === 'number' ? detection.boxExpansion : this.boxExpansion,
            );
            if (!bounds) {
                return;
            }

            const { x0, y0, x1, y1 } = bounds;
            for (let y = y0; y < y1; y++) {
                let offset = y * width * 4 + x0 * 4 + 3;
                for (let x = x0; x < x1; x++, offset += 4) {
                    data[offset] = 255;
                }
            }
        });
    }

    normaliseDetectionBox(detection, width, height) {
        const bbox = detection?.bbox || detection?.boundingBox;
        if (!bbox) {
            return null;
        }

        if (bbox.normalized === false) {
            const x = bbox.x ?? bbox.originX ?? bbox.xMin ?? 0;
            const y = bbox.y ?? bbox.originY ?? bbox.yMin ?? 0;
            const boxWidth = bbox.width ?? (bbox.xMax != null ? bbox.xMax - (bbox.x ?? bbox.originX ?? bbox.xMin ?? 0) : 0);
            const boxHeight = bbox.height ?? (bbox.yMax != null ? bbox.yMax - (bbox.y ?? bbox.originY ?? bbox.yMin ?? 0) : 0);
            if (!boxWidth || !boxHeight) {
                return null;
            }
            return {
                x: x / width,
                y: y / height,
                width: boxWidth / width,
                height: boxHeight / height,
            };
        }

        let x = bbox.x ?? bbox.originX ?? bbox.xMin ?? 0;
        let y = bbox.y ?? bbox.originY ?? bbox.yMin ?? 0;
        let boxWidth = bbox.width;
        let boxHeight = bbox.height;

        if (boxWidth == null && bbox.xMax != null) {
            boxWidth = bbox.xMax - x;
        }
        if (boxHeight == null && bbox.yMax != null) {
            boxHeight = bbox.yMax - y;
        }
        if (boxWidth == null || boxHeight == null) {
            return null;
        }

        const values = [x, y, boxWidth, boxHeight].map((value) => (Number.isFinite(value) ? value : 0));
        const maxValue = Math.max(...values.map((value) => Math.abs(value)));
        if (bbox.normalized === true || maxValue <= 2) {
            return { x, y, width: boxWidth, height: boxHeight };
        }

        return {
            x: x / width,
            y: y / height,
            width: boxWidth / width,
            height: boxHeight / height,
        };
    }

    expandNormalizedBox(box, width, height, expansion = this.boxExpansion) {
        if (!box) {
            return null;
        }
        const baseX = box.x * width;
        const baseY = box.y * height;
        const baseW = box.width * width;
        const baseH = box.height * height;
        if (baseW <= 1 || baseH <= 1) {
            return null;
        }
        const padX = Math.max(2, baseW * expansion);
        const padY = Math.max(2, baseH * expansion);
        const x0 = Math.max(0, Math.floor(baseX - padX));
        const y0 = Math.max(0, Math.floor(baseY - padY));
        const x1 = Math.min(width, Math.ceil(baseX + baseW + padX));
        const y1 = Math.min(height, Math.ceil(baseY + baseH + padY));
        if (x1 <= x0 || y1 <= y0) {
            return null;
        }
        return { x0, y0, x1, y1 };
    }

    applyTemporalSmoothing(imageData, width, height) {
        const total = width * height;
        if (!this._prevMask || this._prevMask.width !== width || this._prevMask.height !== height) {
            this._prevMask = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
            return imageData;
        }

        const prev = this._prevMask.data;
        const curr = imageData.data;
        const s = this.smoothing;
        for (let i = 0; i < total; i++) {
            const idx = i * 4 + 3;
            const prevA = prev[idx];
            const currA = curr[idx];
            const blended = Math.round(prevA * s + currA * (1 - s));
            curr[idx] = blended;
            prev[idx] = blended;
        }
        return imageData;
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

        const maskWidth = mask.width || width;
        const maskHeight = mask.height || height;
        const floatData = mask.getAsFloat32Array();
        const totalPixels = floatData.length;

        const categoriesMeta = Array.isArray(segmentation?.categories) ? segmentation.categories : null;
        const labelForIndex = (idx) => {
            if (!categoriesMeta || !categoriesMeta.length) {
                return String(idx);
            }
            const meta = categoriesMeta[idx];
            if (!meta) {
                return String(idx);
            }
            return normaliseLabel(meta.categoryName || meta.displayName || meta.label || meta.name || idx);
        };

        const hasCategoryIndices = Boolean(categoriesMeta && categoriesMeta.length);
        const baseMask = new ImageData(maskWidth, maskHeight);
        for (let i = 0; i < totalPixels; i++) {
            let alpha = 0;
            if (hasCategoryIndices) {
                const clsIdx = Math.round(floatData[i]);
                const label = labelForIndex(clsIdx);
                if (this.isForegroundLabel(label)) {
                    alpha = 255;
                }
            } else {
                const prob = floatData[i];
                alpha = prob >= this.personThreshold ? 255 : 0;
            }
            const offset = i * 4;
            baseMask.data[offset] = 0;
            baseMask.data[offset + 1] = 0;
            baseMask.data[offset + 2] = 0;
            baseMask.data[offset + 3] = alpha;
        }

        // Scale mask to target resolution if necessary.
        this._tmpCanvas.width = maskWidth;
        this._tmpCanvas.height = maskHeight;
        this._tmpCtx.putImageData(baseMask, 0, 0);
        targetCtx.clearRect(0, 0, width, height);
        targetCtx.drawImage(this._tmpCanvas, 0, 0, width, height);

        const imageData = targetCtx.getImageData(0, 0, width, height);

        if (this.objectHelper) {
            try {
                const detections = await this.objectHelper.detect(video);
                if (Array.isArray(detections) && detections.length) {
                    this.mergeDetections(imageData, detections, width, height);
                }
            } catch (error) {
                console.warn('AR Wallpaper Preview: object detection failed', error);
            }
        }

        if (this.dilation > 0) {
            this.dilate(imageData, width, height, this.dilation);
        }

        if (this.smoothing > 0) {
            this.applyTemporalSmoothing(imageData, width, height);
        } else {
            this._prevMask = null;
        }

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

import { configureVisionSources, loadVisionFileset, loadVisionModule } from './vision-loader.js';

const DEFAULT_OBJECT_MODELS = [
    'https://storage.googleapis.com/mediapipe-models/object_detector/lite-model/float16/1/lite-model.task',
];

const DEFAULT_DETECTOR_CLASSES = [
    'person',
    'people',
    'chair',
    'couch',
    'sofa',
    'dining table',
    'table',
    'coffee table',
    'desk',
    'bench',
    'stool',
    'bed',
    'nightstand',
    'dresser',
    'wardrobe',
    'cabinet',
    'potted plant',
    'plant',
    'flower',
    'tv',
    'television',
    'monitor',
    'screen',
    'laptop',
    'computer',
    'bookcase',
    'shelf',
];

const TFJS_CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.12.0/dist/tf.min.js';
const COCO_SSD_CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js';

let tfjsLoadPromise = null;
let cocoSsdLoadPromise = null;

async function loadScriptOnce(url) {
    if (!url) {
        return;
    }
    if (document.querySelector(`script[src="${url}"]`)) {
        return;
    }
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = (error) => reject(error);
        document.head.appendChild(script);
    });
}

/**
 * Lightweight helper to detect people and furniture close to the wall.
 */
export class ObjectDetectHelper {
    constructor({
        // Expanded list of COCO / common labels to help detect furniture and large foreground objects
        classes = DEFAULT_DETECTOR_CLASSES,
        scoreThreshold = 0.35,
        moduleConfig = {},
    } = {}) {
        this.classes = Array.isArray(classes) && classes.length ? classes : DEFAULT_DETECTOR_CLASSES;
        this.scoreThreshold = scoreThreshold;
        this.detector = null;
        this.tfDetector = null;
        this.tfDetectorPromise = null;
        this.usingTfjs = false;
        this.classSet = new Set(this.classes.map((value) => (value || '').toLowerCase()));
        const globalConfig = typeof window !== 'undefined' && window.arwpData ? window.arwpData.mediapipe : null;
        this.moduleConfig = moduleConfig && Object.keys(moduleConfig).length ? moduleConfig : (globalConfig || {});
        this.modelUrls = Array.isArray(this.moduleConfig?.objectDetectorModels) && this.moduleConfig.objectDetectorModels.length
            ? this.moduleConfig.objectDetectorModels
            : DEFAULT_OBJECT_MODELS;
        configureVisionSources(this.moduleConfig);
    }

    async load() {
        try {
            const vision = await loadVisionFileset();
            const { ObjectDetector } = await loadVisionModule();
            this.detector = await this.createDetector(ObjectDetector, vision);
            this.usingTfjs = false;
        } catch (error) {
            console.warn('AR Wallpaper Preview: Mediapipe object detector unavailable, using tf.js fallback', error);
            this.detector = null;
            this.usingTfjs = true;
            await this.ensureTfjsDetector();
        }
    }

    async createDetector(ObjectDetector, vision) {
        let lastError = null;
        for (const url of this.modelUrls) {
            if (!url) {
                continue;
            }
            try {
                // eslint-disable-next-line no-await-in-loop
                return await ObjectDetector.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: url,
                    },
                    runningMode: 'VIDEO',
                    scoreThreshold: this.scoreThreshold,
                    categoryAllowlist: this.classes,
                });
            } catch (error) {
                console.warn('AR Wallpaper Preview: failed to load object detector model', url, error);
                lastError = error;
            }
        }
        throw lastError || new Error('Unable to load object detector model');
    }

    matchesAllowlist(label) {
        const normalized = (label || '').toLowerCase();
        if (!normalized) {
            return false;
        }
        if (this.classSet.has(normalized)) {
            return true;
        }
        for (const allow of this.classSet) {
            if (allow && normalized.includes(allow)) {
                return true;
            }
        }
        return false;
    }

    async ensureTfjsDetector() {
        if (this.tfDetector) {
            return this.tfDetector;
        }
        if (!this.tfDetectorPromise) {
            this.tfDetectorPromise = (async () => {
                try {
                    if (!window.tf) {
                        tfjsLoadPromise = tfjsLoadPromise || loadScriptOnce(TFJS_CDN);
                        await tfjsLoadPromise;
                    }
                    if (!window.tf) {
                        throw new Error('TensorFlow.js failed to load');
                    }
                    if (!window.cocoSsd) {
                        cocoSsdLoadPromise = cocoSsdLoadPromise || loadScriptOnce(COCO_SSD_CDN);
                        await cocoSsdLoadPromise;
                    }
                    if (!window.cocoSsd || typeof window.cocoSsd.load !== 'function') {
                        throw new Error('COCO-SSD module not available on window');
                    }
                    const model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
                    this.tfDetector = model;
                    return model;
                } catch (error) {
                    console.warn('AR Wallpaper Preview: failed to initialise tf.js detector', error);
                    throw error;
                } finally {
                    if (!this.tfDetector) {
                        this.tfDetectorPromise = null;
                    }
                }
            })();
        }
        return this.tfDetectorPromise;
    }

    formatMediapipeDetection(detection) {
        if (!detection) {
            return null;
        }
        const primaryCategory = detection?.categories?.[0] || {};
        const label = (primaryCategory.categoryName || primaryCategory.displayName || primaryCategory.label || detection.label || '').toLowerCase();
        const score = primaryCategory.score ?? detection.score ?? 0;
        if (!this.matchesAllowlist(label) || score < this.scoreThreshold) {
            return null;
        }
        const bbox = detection.boundingBox || {};
        let width = bbox.width;
        let height = bbox.height;
        if (width == null && bbox.xMax != null) {
            width = bbox.xMax - (bbox.originX ?? bbox.x ?? 0);
        }
        if (height == null && bbox.yMax != null) {
            height = bbox.yMax - (bbox.originY ?? bbox.y ?? 0);
        }
        if (width == null || height == null) {
            return null;
        }
        return {
            label,
            score,
            bbox: {
                x: bbox.originX ?? bbox.x ?? bbox.xMin ?? 0,
                y: bbox.originY ?? bbox.y ?? bbox.yMin ?? 0,
                width,
                height,
                normalized: true,
            },
            raw: detection,
        };
    }

    formatTfjsPrediction(prediction, video) {
        if (!prediction || !video?.videoWidth || !video?.videoHeight) {
            return null;
        }
        const label = (prediction.class || prediction.label || '').toLowerCase();
        const score = prediction.score ?? 0;
        if (!this.matchesAllowlist(label) || score < this.scoreThreshold) {
            return null;
        }
        const [x = 0, y = 0, w = 0, h = 0] = prediction.bbox || [];
        const width = video.videoWidth || video.width || 1;
        const height = video.videoHeight || video.height || 1;
        if (!width || !height) {
            return null;
        }
        return {
            label,
            score,
            bbox: {
                x: x / width,
                y: y / height,
                width: w / width,
                height: h / height,
                normalized: true,
            },
            raw: prediction,
        };
    }

    async detect(video) {
        if (!video) {
            return [];
        }
        if (this.detector) {
            const detections = this.detector.detectForVideo(video, performance.now());
            const items = detections?.detections || [];
            return items.map((detection) => this.formatMediapipeDetection(detection)).filter(Boolean);
        }
        if (this.usingTfjs) {
            try {
                const model = await this.ensureTfjsDetector();
                if (!model) {
                    return [];
                }
                const predictions = await model.detect(video, undefined, this.scoreThreshold);
                return predictions.map((prediction) => this.formatTfjsPrediction(prediction, video)).filter(Boolean);
            } catch (error) {
                console.warn('AR Wallpaper Preview: tf.js detection failed', error);
                return [];
            }
        }
        return [];
    }
}

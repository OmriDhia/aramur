import { configureVisionSources, loadVisionFileset, loadVisionModule } from './vision-loader.js';

const DEFAULT_OBJECT_MODELS = [
    'https://storage.googleapis.com/mediapipe-models/object_detector/lite-model/float16/1/lite-model.task',
];

/**
 * Lightweight helper to detect people and furniture close to the wall.
 */
export class ObjectDetectHelper {
    constructor({
        classes = ['person', 'chair', 'couch', 'dining table', 'potted plant', 'tv'],
        scoreThreshold = 0.4,
        moduleConfig = {},
    } = {}) {
        this.classes = classes;
        this.scoreThreshold = scoreThreshold;
        this.detector = null;
        const globalConfig = typeof window !== 'undefined' && window.arwpData ? window.arwpData.mediapipe : null;
        this.moduleConfig = moduleConfig && Object.keys(moduleConfig).length ? moduleConfig : (globalConfig || {});
        this.modelUrls = Array.isArray(this.moduleConfig?.objectDetectorModels) && this.moduleConfig.objectDetectorModels.length
            ? this.moduleConfig.objectDetectorModels
            : DEFAULT_OBJECT_MODELS;
        configureVisionSources(this.moduleConfig);
    }

    async load() {
        const vision = await loadVisionFileset();
        const { ObjectDetector } = await loadVisionModule();
        this.detector = await this.createDetector(ObjectDetector, vision);
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

    async detect(video) {
        if (!this.detector) {
            return [];
        }
        const detections = this.detector.detectForVideo(video, performance.now());
        return detections?.detections || [];
    }
}

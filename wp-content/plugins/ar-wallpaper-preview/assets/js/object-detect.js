const OBJECT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/lite-model/float16/latest/lite-model.tflite';
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
 * Lightweight helper to detect people and furniture close to the wall.
 */
export class ObjectDetectHelper {
    constructor({ classes = ['person', 'chair', 'couch', 'dining table', 'potted plant', 'tv'], scoreThreshold = 0.4 } = {}) {
        this.classes = classes;
        this.scoreThreshold = scoreThreshold;
        this.detector = null;
    }

    async load() {
        const vision = await loadVisionFileset();
        const { ObjectDetector } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3');
        this.detector = await ObjectDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: OBJECT_MODEL_URL,
            },
            runningMode: 'VIDEO',
            scoreThreshold: this.scoreThreshold,
            categoryAllowlist: this.classes,
        });
    }

    async detect(video) {
        if (!this.detector) {
            return [];
        }
        const detections = this.detector.detectForVideo(video, performance.now());
        return detections?.detections || [];
    }
}

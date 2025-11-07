import { WebXREngine } from './engines/webxr.js';
import { ARJSEngine } from './engines/arjs.js';
import { CanvasFallbackEngine } from './engines/canvas-fallback.js';

/**
 * Main entry point for the AR Wallpaper Preview plugin.
 * Handles feature detection and selects the appropriate AR engine.
 */
class AREntry {
    constructor() {
        this.data = window.arwpData;
        this.container = document.getElementById('arwp-container');
        this.engine = null;

        if (!this.container || !this.data) {
            console.error('AR Wallpaper Preview: Container or data not found.');
            return;
        }

        this.startAR();
    }

    async startAR() {
        const priority = this.data.engine_priority;
        const userOverride = this.data.user_engine_override;

        // Check for user override
        if (userOverride !== 'auto' && this.isEngineAvailable(userOverride)) {
            this.loadEngine(userOverride);
            return;
        }

        // Iterate through priority list
        for (const engineName of priority) {
            if (this.isEngineAvailable(engineName)) {
                this.loadEngine(engineName);
                return;
            }
        }

        // Fallback if no engine is available (should not happen if canvas_fallback is in the list)
        this.showError(this.data.i18n.unsupported_device);
    }

    isEngineAvailable(engineName) {
        switch (engineName) {
            case 'webxr':
                // Check for WebXR support and 'immersive-ar' session support
                return navigator.xr && navigator.xr.isSessionSupported('immersive-ar');
            case 'arjs':
                // Check for basic camera access as a proxy for AR.js feasibility
                return navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
            case 'canvas_fallback':
                // Canvas fallback is always available if the browser supports canvas and getUserMedia
                return !!document.createElement('canvas').getContext('2d') && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
            default:
                return false;
        }
    }

    loadEngine(engineName) {
        console.log(`AR Wallpaper Preview: Loading engine: ${engineName}`);
        this.container.classList.add(`arwp-engine-${engineName}`);

        switch (engineName) {
            case 'webxr':
                this.engine = new WebXREngine(this.container, this.data);
                break;
            case 'arjs':
                this.engine = new ARJSEngine(this.container, this.data);
                break;
            case 'canvas_fallback':
                this.engine = new CanvasFallbackEngine(this.container, this.data);
                break;
            default:
                this.showError(`Unknown AR engine: ${engineName}`);
        }
    }

    showError(message) {
        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.textContent = message;
            guidance.style.color = 'red';
        }
    }
}

// Wait for the DOM to be ready and the localized script data to be available
document.addEventListener('DOMContentLoaded', () => {
    if (window.arwpData) {
        new AREntry();
    }
});

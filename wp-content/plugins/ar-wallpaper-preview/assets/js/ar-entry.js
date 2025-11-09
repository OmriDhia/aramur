import { WebXREngine } from './engines/webxr.js';
import { CanvasFallbackEngine } from './engines/canvas-fallback.js';

/**
 * Main entry point for the Smart AR Wallpaper feature.
 * Selects the best engine at runtime and surfaces status updates in the UI.
 */
class AREntry {
    constructor() {
        this.data = window.arwpData;
        this.container = document.getElementById('arwp-container');
        this.statusTray = document.getElementById('arwp-status-tray');
        this.engine = null;

        if (!this.container || !this.data) {
            console.error('AR Wallpaper Preview: Container or data not found.');
            return;
        }

        this.status = new Map();
        this.renderStatus({ id: 'engine', label: this.data.i18n.status_initialising });
        this.startAR();
    }

    async startAR() {
        const priority = this.data.engine_priority;
        const userOverride = this.data.user_engine_override;

        if (userOverride !== 'auto' && await this.isEngineAvailable(userOverride)) {
            this.loadEngine(userOverride);
            return;
        }

        for (const engineName of priority) {
            if (await this.isEngineAvailable(engineName)) {
                this.loadEngine(engineName);
                return;
            }
        }

        this.showError(this.data.i18n.unsupported_device);
        this.renderStatus({ id: 'engine', label: this.data.i18n.status_unsupported, state: 'error' });
    }

    async isEngineAvailable(engineName) {
        switch (engineName) {
            case 'webxr':
                if (!navigator.xr || !navigator.xr.isSessionSupported) {
                    return false;
                }
                try {
                    return await navigator.xr.isSessionSupported('immersive-ar');
                } catch (error) {
                    console.warn('AR Wallpaper Preview: WebXR availability check failed', error);
                    return false;
                }
            case 'canvas_fallback':
                return !!document.createElement('canvas').getContext('2d') && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
            default:
                return false;
        }
    }

    loadEngine(engineName) {
        console.log(`AR Wallpaper Preview: Loading engine: ${engineName}`);
        this.container.classList.add(`arwp-engine-${engineName}`);

        const statusHandler = this.handleStatus.bind(this);

        switch (engineName) {
            case 'webxr':
                this.engine = new WebXREngine(this.container, this.data, statusHandler);
                break;
            case 'canvas_fallback':
                this.engine = new CanvasFallbackEngine(this.container, this.data, statusHandler);
                break;
            default:
                this.showError(`Unknown AR engine: ${engineName}`);
        }
    }

    handleStatus(event) {
        if (!event || !event.id) {
            return;
        }
        this.renderStatus(event);
    }

    renderStatus({ id, label, state = 'neutral' }) {
        if (!this.statusTray) {
            return;
        }

        if (!this.status.has(id)) {
            const badge = document.createElement('span');
            badge.className = 'arwp-status-badge';
            badge.dataset.state = state;
            badge.textContent = label;
            badge.dataset.id = id;
            this.statusTray.appendChild(badge);
            this.status.set(id, badge);
            return;
        }

        const badge = this.status.get(id);
        badge.dataset.state = state;
        badge.textContent = label;
    }

    showError(message) {
        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.textContent = message;
            guidance.style.color = 'red';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.arwpData) {
        new AREntry();
    }
});

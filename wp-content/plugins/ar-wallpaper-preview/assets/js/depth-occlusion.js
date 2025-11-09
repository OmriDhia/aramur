import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/**
 * Handles WebXR depth sensing and exposes a Three.js texture for shaders.
 */
export class DepthOcclusionManager {
    constructor(renderer, statusCallback = () => {}, strings = {}) {
        this.renderer = renderer;
        this.onStatus = statusCallback;
        this.depthTexture = null;
        this.supported = false;
        this.strings = strings;
    }

    async configure(session) {
        if (!session || !session.updateRenderState) {
            return false;
        }
        try {
            await session.updateRenderState({
                depthSensingState: {
                    enabled: true,
                    usagePreference: ['cpu-optimized', 'gpu-optimized'],
                    dataFormatPreference: ['luminance-alpha', 'float32'],
                },
            });
            this.supported = true;
            const label = this.strings.status_depth || 'Depth sensing';
            this.onStatus({ id: 'occlusion', label, state: 'pending' });
            return true;
        } catch (error) {
            console.warn('AR Wallpaper Preview: depth configuration failed', error);
            this.supported = false;
            return false;
        }
    }

    update(frame, referenceSpace) {
        if (!this.supported) {
            return null;
        }
        const pose = frame.getViewerPose(referenceSpace);
        if (!pose) {
            return null;
        }

        const depthData = frame.getDepthInformation(pose.views[0]);
        if (!depthData || !depthData.data) {
            return null;
        }

        const { width, height, data } = depthData;
        const buffer = data instanceof Uint8Array ? data : new Uint8Array(data.buffer);
        if (!this.depthTexture || this.depthTexture.image.width !== width || this.depthTexture.image.height !== height) {
            this.depthTexture = new THREE.DataTexture(new Uint8Array(buffer), width, height, THREE.LuminanceAlphaFormat);
            this.depthTexture.needsUpdate = true;
        } else {
            this.depthTexture.image.data.set(buffer);
            this.depthTexture.needsUpdate = true;
        }

        return {
            texture: this.depthTexture,
            width,
            height,
            raw: depthData,
            meterScale: 0.001,
        };
    }
}

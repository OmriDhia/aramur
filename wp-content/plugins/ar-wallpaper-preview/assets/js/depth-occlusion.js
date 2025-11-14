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
        this.isFloatFormat = false;
        this.strings = strings;
        this._floatBuffer = null;
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
            const fallbackLabel = this.strings.status_depth_unavailable || this.strings.status_segmentation || 'Using segmentation';
            this.onStatus({ id: 'occlusion', label: fallbackLabel, state: 'warning' });
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
        if (!depthData) {
            return null;
        }

        const { width, height, data } = depthData;

        let textureNeedsRebuild = !this.depthTexture
            || this.depthTexture.image.width !== width
            || this.depthTexture.image.height !== height;

        let textureData = null;
        let textureFormat = THREE.LuminanceAlphaFormat;
        let textureType = THREE.UnsignedByteType;

        if (data instanceof Float32Array) {
            textureData = data;
            textureFormat = THREE.RedFormat;
            textureType = THREE.FloatType;
            this.isFloatFormat = true;
        } else if (data instanceof Uint8Array) {
            textureData = data;
            this.isFloatFormat = false;
        } else if (data instanceof Uint16Array) {
            textureData = new Uint8Array(data.buffer);
            this.isFloatFormat = false;
        } else if (data && data.buffer) {
            textureData = new Uint8Array(data.buffer);
            this.isFloatFormat = false;
        } else if (typeof depthData.getDepthInMeters === 'function') {
            const size = width * height;
            if (!this._floatBuffer || this._floatBuffer.length !== size) {
                this._floatBuffer = new Float32Array(size);
            }
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const idx = y * width + x;
                    this._floatBuffer[idx] = depthData.getDepthInMeters(x, y) || 0;
                }
            }
            textureData = this._floatBuffer;
            textureFormat = THREE.RedFormat;
            textureType = THREE.FloatType;
            this.isFloatFormat = true;
        } else {
            return null;
        }

        if (this.depthTexture && (this.depthTexture.format !== textureFormat || this.depthTexture.type !== textureType)) {
            textureNeedsRebuild = true;
        }

        if (textureNeedsRebuild) {
            if (this.depthTexture) {
                this.depthTexture.dispose();
            }
            this.depthTexture = new THREE.DataTexture(textureData, width, height, textureFormat, textureType);
            this.depthTexture.minFilter = THREE.NearestFilter;
            this.depthTexture.magFilter = THREE.NearestFilter;
            this.depthTexture.generateMipmaps = false;
            this.depthTexture.flipY = false;
            if (textureFormat === THREE.RedFormat && textureType === THREE.FloatType) {
                this.depthTexture.internalFormat = 'R32F';
            }
        } else if (textureData && this.depthTexture.image?.data?.set) {
            this.depthTexture.image.data.set(textureData);
        }

        this.depthTexture.needsUpdate = true;

        const meterScale = typeof depthData.rawValueToMeters === 'number'
            ? depthData.rawValueToMeters
            : (this.isFloatFormat ? 1.0 : 0.001);

        return {
            texture: this.depthTexture,
            width,
            height,
            raw: depthData,
            meterScale,
            isFloat: this.isFloatFormat,
        };
    }
}

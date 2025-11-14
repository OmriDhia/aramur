import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export function createWallpaperMaterial(texture) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: texture },
            uDepthTexture: { value: null },
            uSegmentationTexture: { value: null },
            uDepthEnabled: { value: 0 },
            uSegmentationEnabled: { value: 0 },
            uDepthScale: { value: 0.001 },
            uDepthIsFloat: { value: 0 },
            uResolution: { value: new THREE.Vector2(1, 1) },
            uDepthResolution: { value: new THREE.Vector2(1, 1) },
            uCameraNear: { value: 0.01 },
            uCameraFar: { value: 20.0 },
            uBrightness: { value: 1.0 },
            uAlpha: { value: 1.0 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D uMap;
            uniform sampler2D uDepthTexture;
            uniform sampler2D uSegmentationTexture;
            uniform int uDepthEnabled;
            uniform int uSegmentationEnabled;
            uniform int uDepthIsFloat;
            uniform vec2 uResolution;
            uniform vec2 uDepthResolution;
            uniform float uDepthScale;
            uniform float uCameraNear;
            uniform float uCameraFar;
            uniform float uBrightness;
            uniform float uAlpha;

            float linearizeDepth(float depth) {
                float z = depth * 2.0 - 1.0;
                return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
            }

            void main() {
                vec4 base = texture2D(uMap, vUv);
                if (base.a < 0.01) discard;
                base.rgb *= uBrightness;
                base.a *= uAlpha;

                vec2 screenUv = gl_FragCoord.xy / uResolution;
                vec2 depthUv = screenUv;
                if (uDepthResolution.x > 0.0 && uDepthResolution.y > 0.0) {
                    depthUv = vec2(gl_FragCoord.x / uDepthResolution.x, gl_FragCoord.y / uDepthResolution.y);
                }

                if (uSegmentationEnabled == 1) {
                    float mask = texture2D(uSegmentationTexture, screenUv).a;
                    if (mask > 0.45) {
                        discard;
                    }
                }

                if (uDepthEnabled == 1) {
                    float realDepth;
                    if (uDepthIsFloat == 1) {
                        realDepth = texture2D(uDepthTexture, depthUv).r * uDepthScale;
                    } else {
                        vec2 depthSample = texture2D(uDepthTexture, depthUv).ra;
                        float low = depthSample.x * 255.0;
                        float high = depthSample.y * 255.0;
                        float depthMm = low + high * 256.0;
                        realDepth = depthMm * uDepthScale;
                    }
                    float virtualDepth = linearizeDepth(gl_FragCoord.z);
                    if (realDepth > 0.0 && realDepth < virtualDepth) {
                        discard;
                    }
                }

                gl_FragColor = base;
            }
        `,
    });
}

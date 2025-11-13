import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// GLSL chunks embedded as JS strings for Three.js ShaderMaterial
export const WallpaperOcclusionShader = {
    uniforms: {
        // Provided by the app:
        uMap: { value: null },            // wallpaper texture
        uOpacity: { value: 1.0 },

        // Depth provided by DepthOcclusionManager.update():
        uDepthTexture: { value: null },
        uDepthWidth: { value: 0 },
        uDepthHeight: { value: 0 },
        uDepthSize: { value: new THREE.Vector2(0,0) },
        uRawValueToMeters: { value: 1.0 },
        uDepthIsFloat: { value: 0 },
        uDepthScale: { value: 0.001 },
        uDepthBias: { value: 0.03 },       // meters - bias to avoid z-fighting
        uDepthSmooth: { value: 0.04 },     // meters - smoothing region for soft edges
        uNormDepthBufferFromNormView: { value: new THREE.Matrix4() },

        // Segmentation fallback
        uSegmentationTexture: { value: null },

        // Camera/projection matrices auto-set by three.js but provide placeholders
        projectionMatrix: { value: new THREE.Matrix4() },
        viewMatrix: { value: new THREE.Matrix4() },

        // Flags
        uUseDepth: { value: 0 },          // 1 if we have depth
        uUseSegmentation: { value: 0 },

        // Resolution for depth/segmentation sampling (screen)
        uScreenResolution: { value: new THREE.Vector2(1, 1) },

        // Misc
        uBrightness: { value: 1.0 },
        uAlpha: { value: 1.0 },
    },

    vertexShader: `
    varying vec2 vUv;
    varying vec4 vViewPosition; // position in view space

    void main() {
      vUv = uv;
      // Compute view-space position of this vertex
      vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = viewPos;
      gl_Position = projectionMatrix * viewPos;
    }
  `,

    fragmentShader: `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec4 vViewPosition;

    uniform sampler2D uMap;
    uniform float uOpacity;

    uniform sampler2D uDepthTexture;
    uniform float uRawValueToMeters;
    uniform int uDepthIsFloat;
    uniform float uDepthScale;
    uniform float uDepthBias;
    uniform float uDepthSmooth;
    uniform mat4 uNormDepthBufferFromNormView;
    uniform int uUseDepth;

    uniform sampler2D uSegmentationTexture;
    uniform int uUseSegmentation;

    // screen resolution for mapping gl_FragCoord -> 0..1 texture coords
    uniform vec2 uScreenResolution;
    uniform float uBrightness;
    uniform float uAlpha;

    // Convert view-space Z (negative going forward) to positive meters
    float viewZToMeters(float viewZ) {
      return -viewZ; // Three.js view space has -Z forward
    }

    // Sample real-world depth at the current fragment
    float sampleRealWorldDepth(vec4 viewPos) {
      // Convert view-space position to Normalized View (nv = position / w)
      vec4 nv = vec4((viewPos.xyz / viewPos.w), 1.0);
      vec4 depthUv4 = uNormDepthBufferFromNormView * nv;
      vec2 depthUv = depthUv4.xy / depthUv4.w;

      if (depthUv.x < 0.0 || depthUv.x > 1.0 || depthUv.y < 0.0 || depthUv.y > 1.0) {
        return 1e6; // outside -> treat as far
      }

      float meters = 1e6;
      if (uDepthIsFloat == 1) {
        float raw = texture2D(uDepthTexture, depthUv).r;
        meters = raw * uDepthScale;
      } else {
        vec2 depthSample = texture2D(uDepthTexture, depthUv).ra;
        float high = depthSample.x * 255.0;
        float low = depthSample.y * 255.0;
        float depthMm = high + low * 256.0;
        meters = depthMm * uDepthScale;
      }
      return meters;
    }

    void main() {
      vec4 texel = texture2D(uMap, vUv);
      if (texel.a < 0.01) discard;
      texel.rgb *= uBrightness;
      texel.a *= uAlpha * uOpacity;

      // Sample screen-space coords for depth/seg
      vec2 screenUv = gl_FragCoord.xy / uScreenResolution;

      // Segmentation fallback (people mask) - mask value 1 means foreground => cut hole
      if (uUseSegmentation == 1) {
        float mask = texture2D(uSegmentationTexture, screenUv).a;
        if (mask > 0.45) discard;
      }

      if (uUseDepth == 1) {
        // Sample real-world depth at this fragment using the depth->view mapping
        float realDepthMeters = 1e6;
        // If we have a valid norm matrix (non-identity), use it to map view->depth UV
        bool hasNorm = true;
        // crude check: test first column of matrix
        mat4 mtest = uNormDepthBufferFromNormView;
        if (mtest[0][0] == 0.0 && mtest[1][1] == 0.0 && mtest[2][2] == 0.0 && mtest[3][3] == 0.0) {
          hasNorm = false;
        }
        if (hasNorm) {
          realDepthMeters = sampleRealWorldDepth(vViewPosition);
        } else {
          // Fallback: map screen UV directly into depth texture space assuming similar alignment
          vec2 fallbackUv = gl_FragCoord.xy / uScreenResolution; // 0..1
          // if depth texture has different size, this still maps approximately
          if (uDepthSize.x > 0.0 && uDepthSize.y > 0.0) {
            // attempt to compensate for differing resolutions
            fallbackUv = vec2(gl_FragCoord.x * (uDepthSize.x / uScreenResolution.x) / uDepthSize.x, gl_FragCoord.y * (uDepthSize.y / uScreenResolution.y) / uDepthSize.y);
          }
          if (uDepthIsFloat == 1) {
            float raw = texture2D(uDepthTexture, fallbackUv).r;
            realDepthMeters = raw * uDepthScale;
          } else {
            vec2 depthSample = texture2D(uDepthTexture, fallbackUv).ra;
            float high = depthSample.x * 255.0;
            float low = depthSample.y * 255.0;
            float depthMm = high + low * 256.0;
            realDepthMeters = depthMm * uDepthScale;
          }
        }
         float fragDepthMeters  = viewZToMeters(vViewPosition.z);

         // Compute difference: positive when fragment is farther than real scene (i.e., real object is closer)
         if (realDepthMeters > 0.0 && isfinite(realDepthMeters)) {
           float diff = fragDepthMeters - realDepthMeters;
           // diff > 0 means wallpaper fragment is behind real object
           if (diff > uDepthBias + uDepthSmooth) {
             // fully occluded
             discard;
           } else if (diff > uDepthBias) {
             // soft blend region: reduce alpha proportionally
             float t = (diff - uDepthBias) / uDepthSmooth; // 0..1
             float occlusion = smoothstep(0.0, 1.0, t);
             texel.a *= (1.0 - occlusion);
             if (texel.a < 0.01) discard;
           } else if (diff > 0.0) {
             // within bias, treat as occluded to avoid z-fighting
             discard;
           }
         }
       }

      gl_FragColor = vec4(texel.rgb, texel.a);
    }
  `,
};

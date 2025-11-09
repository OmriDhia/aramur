import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { ARButton } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/webxr/ARButton.js';

/**
 * Advanced WebXR engine that performs wall detection, occlusion masking, and
 * lighting adaptation for a wallpaper preview.
 */
export class WebXREngine {
    constructor(container, data) {
        this.container = container;
        this.data = data;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.reticle = null;
        this.wallpaperMesh = null;
        this.hitTestSource = null;
        this.viewerSpace = null;
        this.referenceSpace = null;
        this.controller = null;
        this.lightProbe = null;

        this.detectedWall = null;
        this.detectedWallPose = null;
        this.detectedWallMatrix = null;
        this.planes = new Map();

        this.wallpaperWidthMeters = Math.max(0.1, this.data.width_cm * 0.01);
        this.wallpaperHeightMeters = Math.max(0.1, this.data.height_cm * 0.01);

        this.isPlaced = false;
        this.targetPosition = new THREE.Vector3();
        this.targetQuaternion = new THREE.Quaternion();
        this.smoothedPosition = new THREE.Vector3();
        this.smoothedQuaternion = new THREE.Quaternion();
        this.positionLerp = 0.2;
        this.rotationSlerp = 0.25;

        this.depthCanvas = document.createElement('canvas');
        this.depthCtx = this.depthCanvas.getContext('2d');
        this.depthTexture = new THREE.CanvasTexture(this.depthCanvas);
        this.depthSupported = false;
        this.depthCanvas.width = 1;
        this.depthCanvas.height = 1;
        this.depthCtx.fillStyle = '#ffffff';
        this.depthCtx.fillRect(0, 0, 1, 1);
        this.depthTexture.needsUpdate = true;

        this.init();
    }

    async init() {
        if (!navigator.xr || !navigator.xr.isSessionSupported) {
            this.showStatus(this.data.i18n.unsupported_device);
            return;
        }

        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!supported) {
            this.showStatus(this.data.i18n.unsupported_device);
            return;
        }

        this.setupScene();
        this.setupRenderer();
        this.setupARButton();
        this.setupListeners();
        this.animate();
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

        const ambient = new THREE.HemisphereLight(0xffffff, 0x222244, 0.6);
        const directional = new THREE.DirectionalLight(0xffffff, 0.5);
        directional.position.set(0.5, 1.2, 0.5);
        this.scene.add(ambient);
        this.scene.add(directional);

        const reticleGeometry = new THREE.RingGeometry(0.12, 0.18, 32);
        const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffc3 });
        this.reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
        this.reticle.rotation.x = -Math.PI / 2;
        this.reticle.matrixAutoUpdate = false;
        this.reticle.matrix.identity();
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        this.wallpaperMesh = this.createWallpaperMesh();
        this.wallpaperMesh.visible = false;
        this.scene.add(this.wallpaperMesh);
    }

    createWallpaperMesh() {
        const geometry = new THREE.PlaneGeometry(this.wallpaperWidthMeters, this.wallpaperHeightMeters, 1, 1);
        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load(this.data.image_url, (tex) => {
            if (this.data.tiling) {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(this.data.repeat_x, this.data.repeat_y);
            }
            if (tex.image && (tex.image.width > this.data.max_texture_resolution || tex.image.height > this.data.max_texture_resolution)) {
                console.warn('Wallpaper texture exceeds configured max resolution.');
            }
        });

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            roughness: 0.82,
            metalness: 0,
            transparent: true,
            alphaMap: this.depthTexture,
            alphaTest: 0.45,
        });

        return new THREE.Mesh(geometry, material);
    }

    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.container.appendChild(this.renderer.domElement);
    }

    setupARButton() {
        const sessionInit = {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['plane-detection', 'dom-overlay', 'light-estimation', 'depth-sensing'],
            domOverlay: { root: this.container },
            depthSensing: {
                usagePreference: ['gpu-optimized', 'cpu-optimized'],
                dataFormatPreference: ['luminance-alpha', 'float32'],
            },
        };

        const button = ARButton.createButton(this.renderer, sessionInit);
        button.id = 'arwp-ar-button';
        button.textContent = this.data.i18n.place;
        this.container.appendChild(button);
    }

    setupListeners() {
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.xr.addEventListener('sessionstart', this.onSessionStart.bind(this));
        this.renderer.xr.addEventListener('sessionend', this.onSessionEnd.bind(this));
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) {
            return;
        }
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    async onSessionStart(event) {
        const session = event.target.getSession();

        this.viewerSpace = await session.requestReferenceSpace('viewer');
        this.referenceSpace = await session.requestReferenceSpace('local');
        this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });

        if (session.requestLightProbe) {
            try {
                this.lightProbe = await session.requestLightProbe();
            } catch (error) {
                console.warn('Light probe not available', error);
            }
        }

        this.controller = this.renderer.xr.getController(0);
        this.controller.addEventListener('select', () => this.onSelect());
        this.scene.add(this.controller);

        this.showStatus(this.data.i18n.guidance_overlay);
    }

    onSessionEnd() {
        if (this.hitTestSource) {
            this.hitTestSource.cancel();
            this.hitTestSource = null;
        }

        this.isPlaced = false;
        this.wallpaperMesh.visible = false;
        this.reticle.visible = false;
        this.detectedWall = null;
        this.detectedWallPose = null;
        this.showStatus(this.data.i18n.guidance_overlay);
    }

    onSelect() {
        if (!this.reticle.visible) {
            return;
        }

        const matrix = new THREE.Matrix4();
        matrix.copy(this.reticle.matrix);
        this.targetPosition.setFromMatrixPosition(matrix);
        this.targetQuaternion.setFromRotationMatrix(matrix);
        this.smoothedPosition.copy(this.targetPosition);
        this.smoothedQuaternion.copy(this.targetQuaternion);

        this.wallpaperMesh.position.copy(this.targetPosition);
        this.wallpaperMesh.quaternion.copy(this.targetQuaternion);
        this.wallpaperMesh.visible = true;
        this.isPlaced = true;
        this.reticle.visible = false;
        this.showStatus('');

        this.fitWallpaperToWall();
    }

    fitWallpaperToWall() {
        if (!this.detectedWall || !this.detectedWall.polygon || !this.detectedWallMatrix) {
            return;
        }

        const polygon = Array.from(this.detectedWall.polygon);
        if (polygon.length < 3) {
            return;
        }

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < polygon.length; i += 3) {
            const x = polygon[i];
            const y = polygon[i + 1];
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }

        const planeWidth = Math.max(0.1, maxX - minX);
        const planeHeight = Math.max(0.1, maxY - minY);
        const scaleX = planeWidth / this.wallpaperWidthMeters;
        const scaleY = planeHeight / this.wallpaperHeightMeters;
        const targetScale = Math.min(scaleX, scaleY) * 0.95;

        this.wallpaperMesh.scale.set(targetScale, targetScale, 1);
    }

    detectWalls(frame, referenceSpace) {
        const worldInfo = frame.worldInformation;
        if (!worldInfo || !worldInfo.detectedPlanes) {
            return;
        }

        for (const plane of worldInfo.detectedPlanes) {
            const pose = frame.getPose(plane.planeSpace, referenceSpace);
            if (!pose) {
                continue;
            }

            if (!this.isVerticalPlane(pose)) {
                continue;
            }

            this.detectedWall = plane;
            this.detectedWallPose = pose;
            this.detectedWallMatrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
            break;
        }
    }

    isVerticalPlane(pose) {
        if (!pose || !pose.transform) {
            return false;
        }

        const { orientation } = pose.transform;
        const quaternion = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
        const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
        return Math.abs(normal.y) < 0.35; // walls have near-zero Y component
    }

    updateReticleFromPose(pose) {
        if (!pose) {
            this.reticle.visible = false;
            return;
        }

        const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const rotationMatrix = new THREE.Matrix4().extractRotation(matrix);
        const normal = new THREE.Vector3(0, 0, -1).applyMatrix4(rotationMatrix).normalize();
        if (Math.abs(normal.y) > 0.5) {
            // likely horizontal surface, ignore
            return;
        }

        this.reticle.matrix.copy(matrix);
        this.detectedWallMatrix = matrix.clone();
        this.reticle.visible = true;

        if (!this.isPlaced) {
            this.targetPosition.setFromMatrixPosition(matrix);
            this.targetQuaternion.setFromRotationMatrix(matrix);
        }
    }

    updateLighting(frame) {
        if (!this.lightProbe || !frame.getLightEstimate) {
            return;
        }

        try {
            const estimate = frame.getLightEstimate(this.lightProbe);
            if (!estimate) {
                return;
            }

            const intensity = estimate.primaryLightIntensity || [1, 1, 1];
            const average = (intensity[0] + intensity[1] + intensity[2]) / 3;
            this.wallpaperMesh.material.color.setScalar(average);
            this.wallpaperMesh.material.needsUpdate = true;
        } catch (error) {
            console.warn('Unable to apply light estimate', error);
        }
    }

    updateDepthOcclusion(frame, referenceSpace) {
        if (!frame.getViewerPose || !frame.getDepthInformation) {
            return;
        }

        const viewerPose = frame.getViewerPose(referenceSpace);
        if (!viewerPose) {
            return;
        }

        try {
            for (const view of viewerPose.views) {
                const depthInfo = frame.getDepthInformation(view);
                if (!depthInfo) {
                    continue;
                }

                this.depthSupported = true;

                const width = depthInfo.width;
                const height = depthInfo.height;
                if (!width || !height) {
                    continue;
                }

                this.depthCanvas.width = width;
                this.depthCanvas.height = height;
                const imageData = this.depthCtx.createImageData(width, height);

                const wallpaperPosition = new THREE.Vector3();
                this.wallpaperMesh.getWorldPosition(wallpaperPosition);
                const cameraPosition = new THREE.Vector3();
                this.camera.getWorldPosition(cameraPosition);
                const wallpaperDistance = cameraPosition.distanceTo(wallpaperPosition);

                const tolerance = 0.1;
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const depth = depthInfo.getDepthInMeters(x, y);
                        const idx = (y * width + x) * 4;
                        if (!depth || depth < wallpaperDistance - tolerance) {
                            imageData.data[idx] = 0;
                            imageData.data[idx + 1] = 0;
                            imageData.data[idx + 2] = 0;
                            imageData.data[idx + 3] = 255;
                        } else {
                            imageData.data[idx] = 255;
                            imageData.data[idx + 1] = 255;
                            imageData.data[idx + 2] = 255;
                            imageData.data[idx + 3] = 0;
                        }
                    }
                }

                this.depthCtx.putImageData(imageData, 0, 0);
                this.depthTexture.needsUpdate = true;
                break;
            }
        } catch (error) {
            console.warn('Depth occlusion update failed', error);
        }
    }

    render(time, frame) {
        if (frame) {
            const referenceSpace = this.referenceSpace || this.renderer.xr.getReferenceSpace();

            if (this.hitTestSource) {
                const hits = frame.getHitTestResults(this.hitTestSource);
                if (hits.length > 0) {
                    const pose = hits[0].getPose(referenceSpace);
                    if (pose && this.isVerticalPlane(pose)) {
                        this.updateReticleFromPose(pose);
                    }
                }
            }

            this.detectWalls(frame, referenceSpace);
            if (this.detectedWallMatrix && !this.isPlaced) {
                this.updateReticleFromPose({ transform: { matrix: this.detectedWallMatrix.toArray() } });
            }

            if (this.isPlaced) {
                this.smoothedPosition.lerp(this.targetPosition, this.positionLerp);
                this.smoothedQuaternion.slerp(this.targetQuaternion, this.rotationSlerp);
                this.wallpaperMesh.position.copy(this.smoothedPosition);
                this.wallpaperMesh.quaternion.copy(this.smoothedQuaternion);
            }

            this.updateLighting(frame);
            this.updateDepthOcclusion(frame, referenceSpace);

            if (this.isPlaced && this.detectedWallMatrix) {
                this.targetPosition.setFromMatrixPosition(this.detectedWallMatrix);
                this.targetQuaternion.setFromRotationMatrix(this.detectedWallMatrix);
                this.fitWallpaperToWall();
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    animate() {
        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
    }

    showStatus(message) {
        const guidance = document.getElementById('arwp-guidance');
        if (!guidance) {
            return;
        }

        guidance.textContent = message || '';
        guidance.style.display = message ? 'block' : 'none';
    }
}

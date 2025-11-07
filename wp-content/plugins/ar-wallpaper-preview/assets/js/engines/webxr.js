import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { ARButton } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/webxr/ARButton.js';

/**
 * WebXR Engine for AR Wallpaper Preview.
 * Uses Three.js and the WebXR Device API for plane detection and hit-testing.
 */
export class WebXREngine {
    constructor(container, data) {
        this.container = container;
        this.data = data;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.wallpaperMesh = null;
        this.hitTestSource = null;
        this.reticle = null;
        this.controller = null;
        this.isPlaced = false;
        this.init();
    }

    async init() {
        if (!navigator.xr) {
            this.container.innerHTML = "WebXR not supported on this device/browser.";
            return;
        }

        const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!isSupported) {
            this.container.innerHTML = "Immersive AR session not supported.";
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

        // Camera is managed by the WebXR session
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

        // Lighting
        this.scene.add(new THREE.HemisphereLight(0x808080, 0x606060, 1));
        const light = new THREE.DirectionalLight(0xffffff, 0.5);
        light.position.set(0.5, 1, 0.25);
        this.scene.add(light);

        // Reticle (for hit-testing visualization)
        const geometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.reticle = new THREE.Mesh(geometry, material);
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        // Placeholder for the wallpaper mesh
        this.wallpaperMesh = this.createWallpaperMesh();
        this.wallpaperMesh.visible = false;
        this.scene.add(this.wallpaperMesh);
    }

    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.container.appendChild(this.renderer.domElement);
    }

    setupARButton() {
        const button = ARButton.createButton(this.renderer, { requiredFeatures: ['hit-test', 'dom-overlay'], optionalFeatures: ['plane-detection'] });
        button.textContent = this.data.i18n.place;
        button.id = 'arwp-ar-button';
        this.container.appendChild(button);
    }

    setupListeners() {
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.xr.addEventListener('sessionstart', this.onSessionStart.bind(this));
        this.renderer.xr.addEventListener('sessionend', this.onSessionEnd.bind(this));
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onSessionStart(event) {
        const session = event.target.getSession();
        session.requestReferenceSpace('viewer').then((referenceSpace) => {
            this.viewerSpace = referenceSpace;
            session.requestHitTestSource({ space: this.viewerSpace }).then((hitTestSource) => {
                this.hitTestSource = hitTestSource;
            });
        });

        this.controller = this.renderer.xr.getController(0);
        this.controller.addEventListener('select', this.onSelect.bind(this));
        this.scene.add(this.controller);

        // Show guidance
        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.textContent = this.data.i18n.guidance_overlay;
            guidance.style.display = 'block';
        }
    }

    onSessionEnd() {
        if (this.hitTestSource) {
            this.hitTestSource.cancel();
            this.hitTestSource = null;
        }
        this.isPlaced = false;
        this.wallpaperMesh.visible = false;
        this.reticle.visible = false;

        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.textContent = this.data.i18n.unsupported_device; // Reset to a generic message
            guidance.style.display = 'block';
        }
    }

    onSelect() {
        if (this.reticle.visible && !this.isPlaced) {
            this.placeWallpaper();
        }
    }

    placeWallpaper() {
        if (!this.reticle.visible) return;

        // Place the wallpaper mesh at the reticle's position and orientation
        this.wallpaperMesh.position.setFromMatrixPosition(this.reticle.matrix);
        this.wallpaperMesh.quaternion.setFromRotationMatrix(this.reticle.matrix);

        // Rotate to be upright on the wall (assuming hit-test gives a horizontal plane by default, but we want a wall)
        // For simplicity, we assume the hit-test is on a floor/horizontal surface, and we rotate the wallpaper to be vertical.
        // A proper implementation would use the plane-detection feature to get the wall's normal.
        // For now, we rotate it 90 degrees around the X axis to stand up.
        this.wallpaperMesh.rotateX(-Math.PI / 2);

        this.wallpaperMesh.visible = true;
        this.reticle.visible = false;
        this.isPlaced = true;

        // Hide guidance
        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.style.display = 'none';
        }

        // TODO: Implement UI controls for Move, Rotate, Scale, Tile, Light
        // This is a placeholder for the complex UI/UX part.
        const uiControls = document.getElementById('arwp-ui-controls');
        if (uiControls) {
            uiControls.innerHTML = `
                <button>${this.data.i18n.move}</button>
                <button>${this.data.i18n.rotate}</button>
                <button>${this.data.i18n.scale}</button>
                <button>${this.data.i18n.tile}</button>
                <button>${this.data.i18n.light}</button>
                <button>${this.data.i18n.reset}</button>
                <button>${this.data.i18n.snapshot}</button>
            `;
        }
    }

    createWallpaperMesh() {
        // Convert cm to meters (1cm = 0.01m)
        const width = this.data.width_cm * 0.01;
        const height = this.data.height_cm * 0.01;

        const geometry = new THREE.PlaneGeometry(width, height);

        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load(this.data.image_url, (tex) => {
            // Adjust texture properties for tiling
            if (this.data.tiling) {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(this.data.repeat_x, this.data.repeat_y);
            }
            // Simple check for max resolution (actual resizing would require canvas/image processing)
            if (tex.image.width > this.data.max_texture_resolution || tex.image.height > this.data.max_texture_resolution) {
                console.warn(`Texture resolution (${tex.image.width}x${tex.image.height}) exceeds max limit (${this.data.max_texture_resolution}). Performance may be affected.`);
            }
        });

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            color: new THREE.Color(this.data.brightness, this.data.brightness, this.data.brightness), // Adjust brightness
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "WallpaperMesh";
        return mesh;
    }

    animate() {
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    render(timestamp, frame) {
        if (frame) {
            const referenceSpace = this.renderer.xr.getReferenceSpace();
            const session = this.renderer.xr.getSession();

            if (this.hitTestSource && !this.isPlaced) {
                const hitTestResults = frame.getHitTestResults(this.hitTestSource);

                if (hitTestResults.length) {
                    const hit = hitTestResults[0];
                    this.reticle.visible = true;
                    this.reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
                } else {
                    this.reticle.visible = false;
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
}

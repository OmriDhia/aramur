/**
 * AR.js Engine for AR Wallpaper Preview.
 * Uses AR.js for marker-based or markerless (location-based) AR as a fallback.
 * Note: AR.js is typically used with A-Frame, but we will use a more direct approach
 * with a-frame-ar.js for simplicity and to keep the file size down.
 */
export class ARJSEngine {
    constructor(container, data) {
        this.container = container;
        this.data = data;
        this.sceneEl = null;
        this.init();
    }

    init() {
        // Dynamically load A-Frame and AR.js
        this.loadScript('https://aframe.io/releases/1.5.0/aframe.min.js', () => {
            this.loadScript('https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar.js', () => {
                this.setupScene();
            });
        });
    }

    loadScript(url, callback) {
        const script = document.createElement('script');
        script.src = url;
        script.onload = callback;
        document.head.appendChild(script);
    }

    setupScene() {
        // 1. Create A-Frame scene
        this.sceneEl = document.createElement('a-scene');
        this.sceneEl.setAttribute('embedded', '');
        this.sceneEl.setAttribute('arjs', 'sourceType: webcam; detectionMode: mono; maxDetectionRate: 30; canvasWidth: 1280; canvasHeight: 960;');
        this.sceneEl.style.position = 'absolute';
        this.sceneEl.style.top = '0';
        this.sceneEl.style.left = '0';
        this.sceneEl.style.width = '100%';
        this.sceneEl.style.height = '100%';

        // 2. Add camera
        const cameraEl = document.createElement('a-camera');
        cameraEl.setAttribute('gps-camera', 'minDistance: 1;');
        cameraEl.setAttribute('look-controls', 'enabled: false');
        this.sceneEl.appendChild(cameraEl);

        // 3. Add AR source (marker or markerless)
        if (this.data.marker_url) {
            // Marker-based AR
            const markerEl = document.createElement('a-marker');
            // AR.js marker pattern files are usually .patt, but we'll assume the user provides a URL to a custom marker image
            // and use the 'custom' type, which is more complex. For simplicity in this demo, we'll use a predefined Hiro marker
            // or assume the user has converted their image to a pattern file and provided the URL.
            // Since we don't have the pattern file, we'll use the simplest marker-based approach for a demo.
            // A proper implementation would require the user to upload a .patt file.
            // For now, we'll use a simple pattern marker.
            markerEl.setAttribute('type', 'pattern');
            markerEl.setAttribute('url', this.data.marker_url); // Assuming this is a .patt file
            this.sceneEl.appendChild(markerEl);
            this.addWallpaperEntity(markerEl);
        } else {
            // Markerless (Location-based) AR - a simpler fallback for wall placement
            // This is a significant simplification, as true markerless AR for wall placement is complex.
            // We'll use a simple entity that can be positioned by the user.
            this.addWallpaperEntity(this.sceneEl);
        }

        this.container.appendChild(this.sceneEl);

        // Hide guidance
        const guidance = document.getElementById('arwp-guidance');
        if (guidance) {
            guidance.style.display = 'none';
        }

        // TODO: Implement UI controls for Move, Rotate, Scale, Tile, Light
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

    addWallpaperEntity(parentEl) {
        // Convert cm to meters (1cm = 0.01m)
        const width = this.data.width_cm * 0.01;
        const height = this.data.height_cm * 0.01;

        const wallpaperEl = document.createElement('a-plane');
        wallpaperEl.setAttribute('width', width);
        wallpaperEl.setAttribute('height', height);
        wallpaperEl.setAttribute('rotation', '-90 0 0'); // Rotate to be vertical (for wall)
        wallpaperEl.setAttribute('position', `0 ${height / 2} 0`); // Position it on the ground plane

        // Texture properties
        let repeat = '';
        if (this.data.tiling) {
            repeat = `${this.data.repeat_x} ${this.data.repeat_y}`;
        }

        // Brightness is hard to control directly in A-Frame material, but we can use a color filter or a simple color attribute
        const brightnessColor = new THREE.Color(this.data.brightness, this.data.brightness, this.data.brightness).getHexString();

        wallpaperEl.setAttribute('material', `
            src: url(${this.data.image_url});
            repeat: ${repeat};
            side: double;
            color: #${brightnessColor};
        `);

        // Add a-frame-extras components for interaction (requires a separate script load)
        // For simplicity, we skip complex interaction components and rely on the AR.js base.
        // A full implementation would include a-frame-extras for drag/rotate/scale.

        parentEl.appendChild(wallpaperEl);
    }
}

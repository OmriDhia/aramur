var ARWP_Entry = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // ar-wallpaper-preview/assets/js/engines/webxr.js
  var THREE2 = __toESM(__require("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"));
  var import_ARButton = __require("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/webxr/ARButton.js");
  var WebXREngine = class {
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
      const isSupported = await navigator.xr.isSessionSupported("immersive-ar");
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
      this.scene = new THREE2.Scene();
      this.camera = new THREE2.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
      this.scene.add(new THREE2.HemisphereLight(8421504, 6316128, 1));
      const light = new THREE2.DirectionalLight(16777215, 0.5);
      light.position.set(0.5, 1, 0.25);
      this.scene.add(light);
      const geometry = new THREE2.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
      const material = new THREE2.MeshBasicMaterial({ color: 16777215 });
      this.reticle = new THREE2.Mesh(geometry, material);
      this.reticle.matrixAutoUpdate = false;
      this.reticle.visible = false;
      this.scene.add(this.reticle);
      this.wallpaperMesh = this.createWallpaperMesh();
      this.wallpaperMesh.visible = false;
      this.scene.add(this.wallpaperMesh);
    }
    setupRenderer() {
      this.renderer = new THREE2.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.xr.enabled = true;
      this.container.appendChild(this.renderer.domElement);
    }
    setupARButton() {
      const button = import_ARButton.ARButton.createButton(this.renderer, { requiredFeatures: ["hit-test", "dom-overlay"], optionalFeatures: ["plane-detection"] });
      button.textContent = this.data.i18n.place;
      button.id = "arwp-ar-button";
      this.container.appendChild(button);
    }
    setupListeners() {
      window.addEventListener("resize", this.onWindowResize.bind(this));
      this.renderer.xr.addEventListener("sessionstart", this.onSessionStart.bind(this));
      this.renderer.xr.addEventListener("sessionend", this.onSessionEnd.bind(this));
    }
    onWindowResize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    onSessionStart(event) {
      const session = event.target.getSession();
      session.requestReferenceSpace("viewer").then((referenceSpace) => {
        this.viewerSpace = referenceSpace;
        session.requestHitTestSource({ space: this.viewerSpace }).then((hitTestSource) => {
          this.hitTestSource = hitTestSource;
        });
      });
      this.controller = this.renderer.xr.getController(0);
      this.controller.addEventListener("select", this.onSelect.bind(this));
      this.scene.add(this.controller);
      const guidance = document.getElementById("arwp-guidance");
      if (guidance) {
        guidance.textContent = this.data.i18n.guidance_overlay;
        guidance.style.display = "block";
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
      const guidance = document.getElementById("arwp-guidance");
      if (guidance) {
        guidance.textContent = this.data.i18n.unsupported_device;
        guidance.style.display = "block";
      }
    }
    onSelect() {
      if (this.reticle.visible && !this.isPlaced) {
        this.placeWallpaper();
      }
    }
    placeWallpaper() {
      if (!this.reticle.visible) return;
      this.wallpaperMesh.position.setFromMatrixPosition(this.reticle.matrix);
      this.wallpaperMesh.quaternion.setFromRotationMatrix(this.reticle.matrix);
      this.wallpaperMesh.rotateX(-Math.PI / 2);
      this.wallpaperMesh.visible = true;
      this.reticle.visible = false;
      this.isPlaced = true;
      const guidance = document.getElementById("arwp-guidance");
      if (guidance) {
        guidance.style.display = "none";
      }
      const uiControls = document.getElementById("arwp-ui-controls");
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
      const width = this.data.width_cm * 0.01;
      const height = this.data.height_cm * 0.01;
      const geometry = new THREE2.PlaneGeometry(width, height);
      const textureLoader = new THREE2.TextureLoader();
      const texture = textureLoader.load(this.data.image_url, (tex) => {
        if (this.data.tiling) {
          tex.wrapS = THREE2.RepeatWrapping;
          tex.wrapT = THREE2.RepeatWrapping;
          tex.repeat.set(this.data.repeat_x, this.data.repeat_y);
        }
        if (tex.image.width > this.data.max_texture_resolution || tex.image.height > this.data.max_texture_resolution) {
          console.warn(`Texture resolution (${tex.image.width}x${tex.image.height}) exceeds max limit (${this.data.max_texture_resolution}). Performance may be affected.`);
        }
      });
      const material = new THREE2.MeshStandardMaterial({
        map: texture,
        side: THREE2.DoubleSide,
        color: new THREE2.Color(this.data.brightness, this.data.brightness, this.data.brightness)
        // Adjust brightness
      });
      const mesh = new THREE2.Mesh(geometry, material);
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
  };

  // ar-wallpaper-preview/assets/js/engines/arjs.js
  var ARJSEngine = class {
    constructor(container, data) {
      this.container = container;
      this.data = data;
      this.sceneEl = null;
      this.init();
    }
    init() {
      this.loadScript("https://aframe.io/releases/1.5.0/aframe.min.js", () => {
        this.loadScript("https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar.js", () => {
          this.setupScene();
        });
      });
    }
    loadScript(url, callback) {
      const script = document.createElement("script");
      script.src = url;
      script.onload = callback;
      document.head.appendChild(script);
    }
    setupScene() {
      this.sceneEl = document.createElement("a-scene");
      this.sceneEl.setAttribute("embedded", "");
      this.sceneEl.setAttribute("arjs", "sourceType: webcam; detectionMode: mono; maxDetectionRate: 30; canvasWidth: 1280; canvasHeight: 960;");
      this.sceneEl.style.position = "absolute";
      this.sceneEl.style.top = "0";
      this.sceneEl.style.left = "0";
      this.sceneEl.style.width = "100%";
      this.sceneEl.style.height = "100%";
      const cameraEl = document.createElement("a-camera");
      cameraEl.setAttribute("gps-camera", "minDistance: 1;");
      cameraEl.setAttribute("look-controls", "enabled: false");
      this.sceneEl.appendChild(cameraEl);
      if (this.data.marker_url) {
        const markerEl = document.createElement("a-marker");
        markerEl.setAttribute("type", "pattern");
        markerEl.setAttribute("url", this.data.marker_url);
        this.sceneEl.appendChild(markerEl);
        this.addWallpaperEntity(markerEl);
      } else {
        this.addWallpaperEntity(this.sceneEl);
      }
      this.container.appendChild(this.sceneEl);
      const guidance = document.getElementById("arwp-guidance");
      if (guidance) {
        guidance.style.display = "none";
      }
      const uiControls = document.getElementById("arwp-ui-controls");
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
      const width = this.data.width_cm * 0.01;
      const height = this.data.height_cm * 0.01;
      const wallpaperEl = document.createElement("a-plane");
      wallpaperEl.setAttribute("width", width);
      wallpaperEl.setAttribute("height", height);
      wallpaperEl.setAttribute("rotation", "-90 0 0");
      wallpaperEl.setAttribute("position", `0 ${height / 2} 0`);
      let repeat = "";
      if (this.data.tiling) {
        repeat = `${this.data.repeat_x} ${this.data.repeat_y}`;
      }
      const brightnessColor = new THREE.Color(this.data.brightness, this.data.brightness, this.data.brightness).getHexString();
      wallpaperEl.setAttribute("material", `
            src: url(${this.data.image_url});
            repeat: ${repeat};
            side: double;
            color: #${brightnessColor};
        `);
      parentEl.appendChild(wallpaperEl);
    }
  };

  // ar-wallpaper-preview/assets/js/engines/canvas-fallback.js
  var CanvasFallbackEngine = class {
    constructor(container, data) {
      this.container = container;
      this.data = data;
      this.video = null;
      this.canvas = null;
      this.ctx = null;
      this.wallpaperImage = null;
      this.corners = [];
      this.isDragging = false;
      this.draggedCornerIndex = -1;
      this.init();
    }
    init() {
      this.container.innerHTML = "";
      this.video = document.createElement("video");
      this.video.setAttribute("autoplay", "");
      this.video.setAttribute("playsinline", "");
      this.video.style.position = "absolute";
      this.video.style.top = "0";
      this.video.style.left = "0";
      this.video.style.width = "100%";
      this.video.style.height = "100%";
      this.video.style.objectFit = "cover";
      this.container.appendChild(this.video);
      this.canvas = document.createElement("canvas");
      this.canvas.style.position = "absolute";
      this.canvas.style.top = "0";
      this.canvas.style.left = "0";
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.wallpaperImage = new Image();
      this.wallpaperImage.crossOrigin = "anonymous";
      this.wallpaperImage.onload = () => {
        this.startCamera();
      };
      this.wallpaperImage.onerror = () => {
        this.container.innerHTML = `<p style="color:red;">Error loading wallpaper image: ${this.data.image_url}</p>`;
      };
      this.wallpaperImage.src = this.data.image_url;
      this.setupUI();
      this.setupListeners();
    }
    setupUI() {
      const guidance = document.getElementById("arwp-guidance");
      if (guidance) {
        guidance.style.display = "none";
      }
      const uiControls = document.getElementById("arwp-ui-controls");
      if (uiControls) {
        uiControls.innerHTML = `
                <button id="arwp-reset-corners">${this.data.i18n.reset}</button>
                <button>${this.data.i18n.light}</button>
                <button>${this.data.i18n.tile}</button>
                <button>${this.data.i18n.snapshot}</button>
            `;
        document.getElementById("arwp-reset-corners").addEventListener("click", () => this.resetCorners());
      }
    }
    startCamera() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((stream) => {
          this.video.srcObject = stream;
          this.video.onloadedmetadata = () => {
            this.video.play();
            this.resizeCanvas();
            this.resetCorners();
            this.animate();
          };
        }).catch((err) => {
          this.container.innerHTML = `<p style="color:red;">Camera access denied or failed: ${err.message}</p>`;
        });
      } else {
        this.container.innerHTML = `<p style="color:red;">Camera not supported on this browser.</p>`;
      }
    }
    resizeCanvas() {
      this.canvas.width = this.container.clientWidth;
      this.canvas.height = this.container.clientHeight;
    }
    resetCorners() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      this.corners = [
        w * 0.2,
        h * 0.2,
        // Top-Left
        w * 0.8,
        h * 0.1,
        // Top-Right
        w * 0.9,
        h * 0.8,
        // Bottom-Right
        w * 0.1,
        h * 0.9
        // Bottom-Left
      ];
    }
    setupListeners() {
      window.addEventListener("resize", this.resizeCanvas.bind(this));
      this.canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
      this.canvas.addEventListener("mousemove", this.onMouseMove.bind(this));
      this.canvas.addEventListener("mouseup", this.onMouseUp.bind(this));
      this.canvas.addEventListener("touchstart", this.onTouchStart.bind(this));
      this.canvas.addEventListener("touchmove", this.onTouchMove.bind(this));
      this.canvas.addEventListener("touchend", this.onTouchEnd.bind(this));
    }
    getMousePos(evt) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
      };
    }
    getTouchPos(evt) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: evt.touches[0].clientX - rect.left,
        y: evt.touches[0].clientY - rect.top
      };
    }
    onMouseDown(evt) {
      const pos = this.getMousePos(evt);
      this.checkDragStart(pos.x, pos.y);
    }
    onMouseMove(evt) {
      if (this.isDragging) {
        const pos = this.getMousePos(evt);
        this.updateCorner(pos.x, pos.y);
      }
    }
    onMouseUp() {
      this.isDragging = false;
      this.draggedCornerIndex = -1;
    }
    onTouchStart(evt) {
      if (evt.touches.length === 1) {
        const pos = this.getTouchPos(evt);
        this.checkDragStart(pos.x, pos.y);
      }
    }
    onTouchMove(evt) {
      if (this.isDragging && evt.touches.length === 1) {
        const pos = this.getTouchPos(evt);
        this.updateCorner(pos.x, pos.y);
        evt.preventDefault();
      }
    }
    onTouchEnd() {
      this.isDragging = false;
      this.draggedCornerIndex = -1;
    }
    checkDragStart(x, y) {
      const cornerSize = 20;
      for (let i = 0; i < this.corners.length; i += 2) {
        const cx = this.corners[i];
        const cy = this.corners[i + 1];
        if (Math.abs(x - cx) < cornerSize && Math.abs(y - cy) < cornerSize) {
          this.isDragging = true;
          this.draggedCornerIndex = i;
          return;
        }
      }
    }
    updateCorner(x, y) {
      if (this.draggedCornerIndex !== -1) {
        this.corners[this.draggedCornerIndex] = x;
        this.corners[this.draggedCornerIndex + 1] = y;
      }
    }
    animate() {
      requestAnimationFrame(this.animate.bind(this));
      this.draw();
    }
    draw() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.video.readyState === this.video.HAVE_ENOUGH_DATA && this.wallpaperImage.complete) {
        this.drawTransformedImage();
        this.drawCorners();
      }
    }
    drawCorners() {
      this.ctx.strokeStyle = "red";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(this.corners[0], this.corners[1]);
      this.ctx.lineTo(this.corners[2], this.corners[3]);
      this.ctx.lineTo(this.corners[4], this.corners[5]);
      this.ctx.lineTo(this.corners[6], this.corners[7]);
      this.ctx.closePath();
      this.ctx.stroke();
      const cornerSize = 8;
      this.ctx.fillStyle = "white";
      this.ctx.strokeStyle = "red";
      this.ctx.lineWidth = 2;
      for (let i = 0; i < this.corners.length; i += 2) {
        this.ctx.beginPath();
        this.ctx.arc(this.corners[i], this.corners[i + 1], cornerSize, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.stroke();
      }
    }
    drawTransformedImage() {
      const s = [0, 0, this.wallpaperImage.width, 0, this.wallpaperImage.width, this.wallpaperImage.height, 0, this.wallpaperImage.height];
      const d = this.corners;
      this.ctx.save();
      const s0 = 0, s1 = 0;
      const s2 = this.wallpaperImage.width, s3 = 0;
      const s4 = 0, s5 = this.wallpaperImage.height;
      const d0 = d[0], d1 = d[1];
      const d2 = d[2], d3 = d[3];
      const d4 = d[6], d5 = d[7];
      const dx1 = s2 - s0;
      const dy1 = s3 - s1;
      const dx2 = s4 - s0;
      const dy2 = s5 - s1;
      const a = d2 - d0;
      const b = d3 - d1;
      const c = d4 - d0;
      const f = d5 - d1;
      const det = dx1 * dy2 - dy1 * dx2;
      const invDet = 1 / det;
      const m11 = (a * dy2 - c * dy1) * invDet;
      const m12 = (c * dx1 - a * dx2) * invDet;
      const m21 = (b * dy2 - f * dy1) * invDet;
      const m22 = (f * dx1 - b * dx2) * invDet;
      this.ctx.transform(m11, m21, m12, m22, d0, d1);
      this.ctx.globalAlpha = this.data.brightness;
      const tileX = this.data.tiling ? this.data.repeat_x : 1;
      const tileY = this.data.tiling ? this.data.repeat_y : 1;
      const tileW = this.wallpaperImage.width / tileX;
      const tileH = this.wallpaperImage.height / tileY;
      for (let x = 0; x < tileX; x++) {
        for (let y = 0; y < tileY; y++) {
          this.ctx.drawImage(
            this.wallpaperImage,
            0,
            0,
            this.wallpaperImage.width,
            this.wallpaperImage.height,
            x * tileW,
            y * tileH,
            tileW,
            tileH
          );
        }
      }
      this.ctx.restore();
    }
  };

  // ar-wallpaper-preview/assets/js/ar-entry.js
  var AREntry = class {
    constructor() {
      this.data = window.arwpData;
      this.container = document.getElementById("arwp-container");
      this.engine = null;
      if (!this.container || !this.data) {
        console.error("AR Wallpaper Preview: Container or data not found.");
        return;
      }
      this.startAR();
    }
    async startAR() {
      const priority = this.data.engine_priority;
      const userOverride = this.data.user_engine_override;
      if (userOverride !== "auto" && this.isEngineAvailable(userOverride)) {
        this.loadEngine(userOverride);
        return;
      }
      for (const engineName of priority) {
        if (this.isEngineAvailable(engineName)) {
          this.loadEngine(engineName);
          return;
        }
      }
      this.showError(this.data.i18n.unsupported_device);
    }
    isEngineAvailable(engineName) {
      switch (engineName) {
        case "webxr":
          return navigator.xr && navigator.xr.isSessionSupported("immersive-ar");
        case "arjs":
          return navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
        case "canvas_fallback":
          return !!document.createElement("canvas").getContext("2d") && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
        default:
          return false;
      }
    }
    loadEngine(engineName) {
      console.log(`AR Wallpaper Preview: Loading engine: ${engineName}`);
      this.container.classList.add(`arwp-engine-${engineName}`);
      switch (engineName) {
        case "webxr":
          this.engine = new WebXREngine(this.container, this.data);
          break;
        case "arjs":
          this.engine = new ARJSEngine(this.container, this.data);
          break;
        case "canvas_fallback":
          this.engine = new CanvasFallbackEngine(this.container, this.data);
          break;
        default:
          this.showError(`Unknown AR engine: ${engineName}`);
      }
    }
    showError(message) {
      const guidance = document.getElementById("arwp-guidance");
      if (guidance) {
        guidance.textContent = message;
        guidance.style.color = "red";
      }
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (window.arwpData) {
      new AREntry();
    }
  });
})();

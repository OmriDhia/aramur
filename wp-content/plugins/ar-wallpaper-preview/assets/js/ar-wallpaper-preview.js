class ARWallpaperPreview {
    constructor() {
        this.modal = document.getElementById('ar-wallpaper-modal');
        if (!this.modal) {
            return;
        }

        this.triggerSelector = '.ar-wallpaper-preview__btn';
        this.video = this.modal.querySelector('.ar-wallpaper-modal__video');
        this.canvas = this.modal.querySelector('.ar-wallpaper-modal__canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.wallpaper = this.modal.querySelector('.ar-wallpaper-modal__wallpaper');
        this.videoContainer = this.modal.querySelector('.ar-wallpaper-modal__video-container');
        this.subtitle = this.modal.querySelector('.ar-wallpaper-modal__subtitle');
        this.permissionMessage = this.modal.querySelector('.ar-wallpaper-modal__permission-message');
        this.scaleControl = this.modal.querySelector('.ar-wallpaper-modal__scale');
        this.rotationControl = this.modal.querySelector('.ar-wallpaper-modal__rotation');
        this.scaleLabel = this.modal.querySelector('.ar-wallpaper-modal__label--scale');
        this.rotationLabel = this.modal.querySelector('.ar-wallpaper-modal__label--rotation');
        this.snapshotButton = this.modal.querySelector('.ar-wallpaper-modal__snapshot');
        this.snapshotLink = this.modal.querySelector('.ar-wallpaper-modal__snapshot-link');
        this.webxrControl = this.modal.querySelector('.ar-wallpaper-modal__control--webxr');
        this.webxrButton = this.modal.querySelector('.ar-wallpaper-modal__webxr-button');
        this.webxrContainer = this.modal.querySelector('.ar-wallpaper-modal__webxr-container');
        this.webxrMessage = this.modal.querySelector('.ar-wallpaper-modal__webxr-message');

        this.stream = null;
        this.imageUrl = '';
        this.image = null;
        this.isDragging = false;
        this.dragPointerId = null;
        this.offset = { x: 0, y: 0 };
        this.scale = (window.arWallpaperPreview && arWallpaperPreview.settings.defaultScale) || 1;
        this.rotation = (window.arWallpaperPreview && arWallpaperPreview.settings.defaultRotation) || 0;
        this.videoAspect = 1;
        this.webxrSupported = false;
        this.webxrSession = null;
        this.webxrRenderer = null;
        this.webxrScene = null;
        this.webxrCamera = null;
        this.webxrWallpaperMesh = null;
        this.webxrReticle = null;
        this.webxrHitTestSource = null;
        this.webxrHitTestRequested = false;
        this.webxrLocalSpace = null;
        this.webxrViewerSpace = null;
        this.cameraPermissionStatus = null;
        this.cameraPermissionHandler = null;
        this.activeMessageKey = '';

        this.configureVideoElement();
        this.bindEvents();
        this.prepareText();
        this.observeButtons();
    }

    getString(key, fallback = '') {
        const defaults = {
            webxrTitle: 'WebXR Preview',
            webxrNotSupported: 'Your device does not support WebXR. Showing fallback preview.',
            secureContext: 'AR preview requires a secure (HTTPS) connection. Reload the page over HTTPS to enable camera and WebXR features.',
            cameraDenied: 'Camera access was denied. Unable to show live preview.',
            cameraPermission: 'Please allow camera access to enable the live preview.',
            cameraBlocked: 'Camera access is blocked. Update your browser permissions to use the live preview.',
            cameraUnavailable: 'No compatible camera was found. Showing static preview.',
            fallbackPreview: 'Live camera preview is unavailable. Showing static background instead.',
        };

        const defaultValue = Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : fallback;

        if (!window.arWallpaperPreview || !arWallpaperPreview.strings) {
            return defaultValue;
        }

        return arWallpaperPreview.strings[key] || defaultValue;
    }

    prepareText() {
        if (!window.arWallpaperPreview) {
            return;
        }

        const { strings } = arWallpaperPreview;
        if (this.subtitle) {
            this.subtitle.textContent = strings.instructions;
        }

        if (this.scaleLabel) {
            this.scaleLabel.textContent = strings.scaleLabel;
        }

        if (this.rotationLabel) {
            this.rotationLabel.textContent = strings.rotationLabel;
        }

        if (this.snapshotButton) {
            this.snapshotButton.textContent = strings.takeSnapshot;
        }

        if (this.webxrButton) {
            this.webxrButton.textContent = strings.startWebXR;
        }
    }

    bindEvents() {
        this.modal.addEventListener('click', (event) => {
            const action = event.target.getAttribute('data-action');
            if (action === 'close') {
                event.preventDefault();
                this.close();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });

        if (this.scaleControl) {
            this.scaleControl.addEventListener('input', () => {
                this.scale = parseFloat(this.scaleControl.value);
                this.updateWallpaperTransform();
                this.updateWebXRScale();
            });
        }

        if (this.rotationControl) {
            this.rotationControl.addEventListener('input', () => {
                this.rotation = parseFloat(this.rotationControl.value);
                this.updateWallpaperTransform();
                this.updateWebXRRotation();
            });
        }

        if (this.snapshotButton) {
            this.snapshotButton.addEventListener('click', () => this.captureSnapshot());
        }

        if (this.webxrButton) {
            this.webxrButton.addEventListener('click', () => this.launchWebXR());
        }

        if (this.wallpaper) {
            this.wallpaper.addEventListener('pointerdown', (event) => this.startDrag(event));
        }

        if (this.videoContainer) {
            this.videoContainer.addEventListener('pointermove', (event) => this.onDrag(event));
            this.videoContainer.addEventListener('pointerup', (event) => this.endDrag(event));
            this.videoContainer.addEventListener('pointercancel', (event) => this.endDrag(event));
            this.videoContainer.addEventListener('pointerleave', (event) => this.endDrag(event));
        }
    }

    observeButtons() {
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest(this.triggerSelector);
            if (!trigger) {
                return;
            }

            event.preventDefault();
            const url = trigger.getAttribute('data-wallpaper-url');
            if (url) {
                this.open(url);
            }
        });
    }

    configureVideoElement() {
        if (!this.video) {
            return;
        }

        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('muted', '');
        this.video.setAttribute('autoplay', '');
        this.video.playsInline = true;
        this.video.muted = true;
        this.video.autoplay = true;
    }

    isOpen() {
        return this.modal.classList.contains('is-visible');
    }

    open(imageUrl) {
        if (!imageUrl) {
            return Promise.resolve();
        }

        this.imageUrl = imageUrl;
        this.scale = (window.arWallpaperPreview && arWallpaperPreview.settings.defaultScale) || 1;
        this.rotation = (window.arWallpaperPreview && arWallpaperPreview.settings.defaultRotation) || 0;
        this.offset = { x: 0, y: 0 };

        this.modal.classList.add('is-visible');
        this.modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('ar-wallpaper-modal-open');

        if (this.scaleControl) {
            this.scaleControl.value = this.scale;
        }

        if (this.rotationControl) {
            this.rotationControl.value = this.rotation;
        }

        return this.loadWallpaperImage(imageUrl)
            .then(() => {
                this.applyWallpaperBackground();
                this.updateWallpaperTransform();
                return this.checkWebXRSupport();
            })
            .then((webxrStatus) => {
                this.webxrSupported = webxrStatus.supported;
                this.toggleWebXRControls(this.webxrSupported);

                if (this.webxrSupported) {
                    this.showMessage(this.getString('webxrTitle'), true, 'webxr-ready');
                } else if (webxrStatus.message) {
                    this.showMessage(webxrStatus.message, true, 'webxr-status');
                } else {
                    this.showMessage(this.getString('webxrNotSupported'), false, 'webxr-unsupported');
                }


                return this.startFallbackCamera();
            })
            .catch((error) => {
                console.error('Failed to open preview', error);
                return this.useStaticFallback(this.getString('fallbackPreview'));
            });
    }

    loadWallpaperImage(url) {
        if (!url) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load wallpaper image'));
            img.src = url;
        })
            .then((img) => {
                this.image = img;
            })
            .catch((error) => {
                console.error('Unable to load wallpaper image', error);
                this.image = null;
            });
    }

    applyWallpaperBackground() {
        if (!this.wallpaper || !this.imageUrl) {
            return;
        }

        this.wallpaper.style.backgroundImage = `url('${this.imageUrl}')`;
        this.wallpaper.style.opacity = (window.arWallpaperPreview && arWallpaperPreview.settings.overlayOpacity) || 0.92;
        this.wallpaper.classList.add('is-visible');
    }

    updateWallpaperTransform() {
        if (!this.wallpaper) {
            return;
        }

        const transform = `translate(-50%, -50%) translate(${this.offset.x}px, ${this.offset.y}px) rotate(${this.rotation}deg) scale(${this.scale})`;
        this.wallpaper.style.transform = transform;
    }

    startDrag(event) {
        if (this.isDragging) {
            return;
        }

        this.isDragging = true;
        this.dragPointerId = event.pointerId;
        this.startOffset = { ...this.offset };
        this.startPosition = { x: event.clientX, y: event.clientY };
        this.wallpaper.setPointerCapture(event.pointerId);
        this.wallpaper.classList.add('is-dragging');
        event.preventDefault();
    }

    onDrag(event) {
        if (!this.isDragging || event.pointerId !== this.dragPointerId) {
            return;
        }

        const deltaX = event.clientX - this.startPosition.x;
        const deltaY = event.clientY - this.startPosition.y;
        this.offset = {
            x: this.startOffset.x + deltaX,
            y: this.startOffset.y + deltaY,
        };
        this.updateWallpaperTransform();
    }

    endDrag(event) {
        if (!this.isDragging || event.pointerId !== this.dragPointerId) {
            return;
        }

        this.isDragging = false;
        this.wallpaper.releasePointerCapture(event.pointerId);
        this.wallpaper.classList.remove('is-dragging');
    }

    startFallbackCamera() {
        if (!this.video || this.stream) {
            return Promise.resolve();
        }

        this.showPermission(false);

        if (this.videoContainer) {
            this.videoContainer.classList.remove('ar-wallpaper-modal__video-container--static');
        }

        if (this.activeMessageKey === 'fallback') {
            this.hideMessage();
        }

        if (!window.isSecureContext) {

            return this.useStaticFallback(this.getString('secureContext'));
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return this.useStaticFallback(this.getString('fallbackPreview'));
        }

        const context = {
            permissionState: 'unknown',
            hasShownPermissionMessage: false,
        };

        const handlePermissionChange = (target) => {
            if (!target) {
                return;
            }

            if (target.state === 'granted') {
                this.showPermission(false);
                if (!this.stream) {
                    this.startFallbackCamera();
                }
            } else if (target.state === 'denied') {
                this.useStaticFallback(this.getString('cameraBlocked'));
            }
        };

        const permissionPromise = (navigator.permissions && navigator.permissions.query)
            ? navigator.permissions.query({ name: 'camera' })
                .then((status) => {
                    this.cameraPermissionStatus = status;
                    context.permissionState = status.state;

                    if (!this.cameraPermissionHandler) {
                        this.cameraPermissionHandler = (event) => {
                            const target = event && event.target ? event.target : this.cameraPermissionStatus || status;
                            handlePermissionChange(target);
                        };
                    }

                    if (typeof status.removeEventListener === 'function') {
                        status.removeEventListener('change', this.cameraPermissionHandler);
                    }

                    if (typeof status.addEventListener === 'function') {
                        status.addEventListener('change', this.cameraPermissionHandler);
                    } else if ('onchange' in status && typeof status.onchange !== 'function') {
                        status.onchange = this.cameraPermissionHandler;
                    }

                    if (status.state === 'denied') {
                        context.hasShownPermissionMessage = true;
                        return Promise.reject(new Error('camera-denied'));
                    }

                    if (status.state === 'granted') {
                        this.showPermission(false);
                        context.hasShownPermissionMessage = true;
                    }

                    if (status.state === 'prompt') {
                        this.showPermission(true, this.getString('cameraPermission'));
                        context.hasShownPermissionMessage = true;
                    }

                    return status;
                })
                .catch((error) => {
                    if (error && error.message === 'camera-denied') {
                        throw error;
                    }
                    context.permissionState = 'prompt';
                    return null;
                })
            : Promise.resolve(null);

        const attemptStream = () => {
            const constraintAttempts = [
                { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
                { video: { facingMode: 'environment' }, audio: false },
                { video: { facingMode: { ideal: 'user' } }, audio: false },
                { video: true, audio: false },
            ];

            let attemptIndex = 0;
            let lastError = null;

            const tryNext = () => {
                if (attemptIndex >= constraintAttempts.length) {
                    return Promise.reject(lastError || new Error('camera-unavailable'));
                }

                const constraints = constraintAttempts[attemptIndex];
                attemptIndex += 1;

                return navigator.mediaDevices.getUserMedia(constraints)
                    .then((stream) => {
                        this.stream = stream;
                        return stream;
                    })
                    .catch((error) => {
                        lastError = error;
                        return tryNext();
                    });
            };

            return tryNext();
        };

        return permissionPromise
            .then(() => {
                if (!context.hasShownPermissionMessage && context.permissionState !== 'granted') {
                    this.showPermission(true, this.getString('cameraPermission'));
                    context.hasShownPermissionMessage = true;
                }

                return attemptStream();
            })
            .then(() => {
                this.video.srcObject = this.stream;

                const playPromise = this.video.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {});
                }

                this.clearUnsupportedWebXRMessage();
                if (this.activeMessageKey !== 'webxr-ready') {
                    this.showMessage(this.getString('livePreviewReady'), false, 'live-preview');
                }
                this.showPermission(false);
                if (this.videoContainer) {
                    this.videoContainer.classList.remove('ar-wallpaper-modal__video-container--static');
                }

                this.video.addEventListener('loadedmetadata', () => {
                    if (!this.canvas) {
                        return;
                    }
                    this.canvas.width = this.video.videoWidth;
                    this.canvas.height = this.video.videoHeight;
                    this.videoAspect = this.video.videoWidth / Math.max(this.video.videoHeight, 1);
                }, { once: true });

                return null;
            })
            .catch((error) => {
                if (error && error.message === 'camera-denied') {
                    return this.useStaticFallback(this.getString('cameraBlocked'));
                }

                const lastError = error && error.name ? error : null;
                const fallbackMessage = lastError && (lastError.name === 'NotAllowedError' || lastError.name === 'SecurityError')
                    ? 'cameraBlocked'
                    : lastError && (lastError.name === 'NotFoundError' || lastError.name === 'OverconstrainedError')
                        ? 'cameraUnavailable'
                        : 'fallbackPreview';

                console.error('Unable to access camera', error);
                return this.useStaticFallback(this.getString(fallbackMessage));
            });
    }

    clearUnsupportedWebXRMessage() {
        if (!this.activeMessageKey) {
            return;
        }

        const unsupportedKeys = ['webxr-unsupported', 'webxr-status'];
        if (unsupportedKeys.includes(this.activeMessageKey)) {
            this.hideMessage();

        }

        if (!hasShownPermissionMessage && permissionState !== 'granted') {
            this.showPermission(true, this.getString('cameraPermission'));
            hasShownPermissionMessage = true;
        }

        const constraintAttempts = [
            { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
            { video: { facingMode: 'environment' }, audio: false },
            { video: { facingMode: { ideal: 'user' } }, audio: false },
            { video: true, audio: false },
        ];

        let lastError = null;

        for (const constraints of constraintAttempts) {
            try {
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
                break;
            } catch (error) {
                lastError = error;
            }

        }

        if (!this.stream) {
            console.error('Unable to access camera', lastError);
            if (lastError && (lastError.name === 'NotAllowedError' || lastError.name === 'SecurityError')) {
                await this.useStaticFallback(this.getString('cameraBlocked'));
            } else if (lastError && (lastError.name === 'NotFoundError' || lastError.name === 'OverconstrainedError')) {
                await this.useStaticFallback(this.getString('cameraUnavailable'));
            } else {
                await this.useStaticFallback(this.getString('fallbackPreview'));
            }
            return;
        }

        this.video.srcObject = this.stream;

        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }

        this.clearUnsupportedWebXRMessage();
        if (this.activeMessageKey !== 'webxr-ready') {
            this.showMessage(this.getString('livePreviewReady'), false, 'live-preview');
        }
        this.showPermission(false);
        if (this.videoContainer) {
            this.videoContainer.classList.remove('ar-wallpaper-modal__video-container--static');
        }

        this.video.addEventListener('loadedmetadata', () => {
            if (!this.canvas) {
                return;
            }
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.videoAspect = this.video.videoWidth / Math.max(this.video.videoHeight, 1);
        }, { once: true });
    }

    clearUnsupportedWebXRMessage() {
        if (!this.activeMessageKey) {
            return;
        }

        const unsupportedKeys = ['webxr-unsupported', 'webxr-status'];
        if (unsupportedKeys.includes(this.activeMessageKey)) {
            this.hideMessage();

        }

        if (!this.stream) {
            console.error('Unable to access camera', lastError);
            if (lastError && (lastError.name === 'NotAllowedError' || lastError.name === 'SecurityError')) {
                await this.useStaticFallback(this.getString('cameraBlocked'));
            } else if (lastError && (lastError.name === 'NotFoundError' || lastError.name === 'OverconstrainedError')) {
                await this.useStaticFallback(this.getString('cameraUnavailable'));
            } else {
                await this.useStaticFallback(this.getString('fallbackPreview'));
            }
            return;
        }

        this.video.srcObject = this.stream;

        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }

        this.showPermission(false);
        if (this.videoContainer) {
            this.videoContainer.classList.remove('ar-wallpaper-modal__video-container--static');
        }

        this.video.addEventListener('loadedmetadata', () => {
            if (!this.canvas) {
                return;
            }
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.videoAspect = this.video.videoWidth / Math.max(this.video.videoHeight, 1);
        }, { once: true });
    }

    showPermission(state, message = '') {
        if (!this.permissionMessage) {
            return;
        }

        if (state) {
            this.permissionMessage.hidden = false;
            this.permissionMessage.textContent = message;
        } else {
            this.permissionMessage.hidden = true;
            this.permissionMessage.textContent = '';
        }
    }

    toggleWebXRControls(show) {
        if (!this.webxrControl) {
            return;
        }

        this.webxrControl.hidden = !show;
    }

    useStaticFallback(message = '') {
        return this.stopFallbackCamera().then(() => {
            if (this.videoContainer) {
                this.videoContainer.classList.add('ar-wallpaper-modal__video-container--static');
            }

            if (message) {
                this.showMessage(message, true, 'fallback');
            }

            this.showPermission(false);
        });

    }

    showMessage(message, sticky = false, key = '') {
        if (!this.webxrMessage) {
            return;
        }

        this.webxrMessage.textContent = message;
        this.webxrMessage.classList.add('is-visible');
        this.activeMessageKey = key;

        if (!sticky) {
            window.clearTimeout(this.messageTimer);
            this.messageTimer = window.setTimeout(() => {
                this.webxrMessage.classList.remove('is-visible');
                this.activeMessageKey = '';
            }, 3200);
        }
    }

    hideMessage() {
        if (this.webxrMessage) {
            this.webxrMessage.classList.remove('is-visible');
        }
        this.activeMessageKey = '';
    }


    checkWebXRSupport() {
        if (!window.isSecureContext) {
            return Promise.resolve({
                supported: false,
                message: this.getString('secureContext'),
            });
        }

        if (!navigator.xr || !navigator.xr.isSessionSupported) {
            return Promise.resolve({
                supported: false,
                message: this.getString('webxrNotSupported'),
            });

        }

        return Promise.resolve(navigator.xr.isSessionSupported('immersive-ar'))
            .then((supported) => ({
                supported,
                message: supported ? '' : this.getString('webxrNotSupported'),
            }))
            .catch(() => ({
                supported: false,
                message: this.getString('webxrNotSupported'),
            }));
    }

    launchWebXR() {
        if (!this.webxrSupported || this.webxrSession) {
            return Promise.resolve();
        }

        this.showMessage(arWallpaperPreview.strings.loadingWebXR, true, 'webxr-loading');

        const setupWebXR = (THREE) => {
            const { Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Scene, PerspectiveCamera, WebGLRenderer, TextureLoader, DoubleSide, AmbientLight, HemisphereLight } = THREE;

            this.webxrRenderer = new WebGLRenderer({ antialias: true, alpha: true });
            this.webxrRenderer.setPixelRatio(window.devicePixelRatio);
            this.webxrRenderer.setSize(window.innerWidth, window.innerHeight);
            this.webxrRenderer.xr.enabled = true;
            this.webxrRenderer.domElement.style.width = '100%';
            this.webxrRenderer.domElement.style.height = '100%';
            this.webxrContainer.innerHTML = '';
            this.webxrContainer.appendChild(this.webxrRenderer.domElement);
            this.webxrContainer.hidden = false;

            this.webxrScene = new Scene();
            this.webxrCamera = new PerspectiveCamera();

            const ambient = new AmbientLight(0xffffff, 0.8);
            const hemi = new HemisphereLight(0xffffff, 0xbbbbff, 0.4);
            this.webxrScene.add(ambient);
            this.webxrScene.add(hemi);

            this.webxrReticle = new Mesh(
                new RingGeometry(0.12, 0.15, 32).rotateX(-Math.PI / 2),
                new MeshBasicMaterial({ color: 0x38bdf8 })
            );
            this.webxrReticle.matrixAutoUpdate = false;
            this.webxrReticle.visible = false;
            this.webxrScene.add(this.webxrReticle);

            const textureLoader = new TextureLoader();
            textureLoader.crossOrigin = 'anonymous';

            return new Promise((resolve, reject) => {
                textureLoader.load(this.imageUrl, resolve, undefined, reject);
            }).then((texture) => {
                const aspect = this.image && this.image.naturalHeight ? this.image.naturalWidth / this.image.naturalHeight : 1.5;
                const baseHeight = 2.2;
                const baseWidth = baseHeight * aspect;
                const geometry = new PlaneGeometry(baseWidth, baseHeight);
                const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true });
                this.webxrWallpaperMesh = new Mesh(geometry, material);
                this.webxrWallpaperMesh.visible = false;
                this.webxrScene.add(this.webxrWallpaperMesh);
                this.updateWebXRScale();
                this.updateWebXRRotation();

                const sessionInit = {
                    requiredFeatures: ['hit-test'],
                    optionalFeatures: ['dom-overlay'],
                    domOverlay: { root: this.modal },
                };

                return Promise.resolve(navigator.xr.requestSession('immersive-ar', sessionInit))
                    .then((session) => {
                        this.webxrSession = session;
                        this.webxrRenderer.xr.setReferenceSpaceType('local');
                        return Promise.resolve(this.webxrRenderer.xr.setSession(session));
                    })
                    .then(() => {
                        this.webxrSession.addEventListener('end', () => this.cleanupWebXR(true));

                        const controller = this.webxrRenderer.xr.getController(0);
                        controller.addEventListener('select', () => {
                            if (this.webxrReticle.visible) {
                                this.webxrWallpaperMesh.visible = true;
                                this.webxrWallpaperMesh.position.setFromMatrixPosition(this.webxrReticle.matrix);
                                this.webxrWallpaperMesh.quaternion.setFromRotationMatrix(this.webxrReticle.matrix);
                                const uniformScale = this.scale;
                                this.webxrWallpaperMesh.scale.set(uniformScale, uniformScale, uniformScale);
                                this.updateWebXRRotation();
                            }
                        });
                        this.webxrScene.add(controller);

                        this.webxrHitTestSource = null;
                        this.webxrHitTestRequested = false;
                        this.webxrLocalSpace = null;
                        this.webxrViewerSpace = null;

                        const onXRFrame = (time, frame) => {
                            const session = frame.session;

                            if (!this.webxrHitTestRequested) {
                                this.webxrHitTestRequested = true;
                                session.requestReferenceSpace('viewer').then((viewerSpace) => {
                                    this.webxrViewerSpace = viewerSpace;
                                    session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                                        this.webxrHitTestSource = source;
                                    }).catch(() => {
                                        this.webxrHitTestRequested = false;
                                    });
                                }).catch(() => {
                                    this.webxrHitTestRequested = false;
                                });

                                session.requestReferenceSpace('local').then((refSpace) => {
                                    this.webxrLocalSpace = refSpace;
                                }).catch(() => {
                                    this.webxrLocalSpace = null;
                                });
                            }

                            const referenceSpace = this.webxrLocalSpace || this.webxrRenderer.xr.getReferenceSpace();

                            if (this.webxrHitTestSource && referenceSpace) {
                                const results = frame.getHitTestResults(this.webxrHitTestSource);
                                if (results.length > 0) {
                                    const hit = results[0];
                                    const pose = hit.getPose(referenceSpace);
                                    this.webxrReticle.visible = true;
                                    this.webxrReticle.matrix.fromArray(pose.transform.matrix);
                                } else {
                                    this.webxrReticle.visible = false;
                                }
                            }

                            this.webxrRenderer.render(this.webxrScene, this.webxrCamera);
                        };

                        this.webxrRenderer.setAnimationLoop(onXRFrame);
                        this.hideMessage();
                    });
            });
        };


        return this.stopFallbackCamera()
            .then(() => Promise.resolve(import('https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js')))
            .then((THREE) => setupWebXR(THREE))
            .catch((error) => {
                console.error('WebXR launch failed', error);
                this.showMessage(arWallpaperPreview.strings.webxrFailed, true, 'webxr-error');
                this.cleanupWebXR();
                return this.startFallbackCamera();
            });

    }

    updateWebXRScale() {
        if (!this.webxrWallpaperMesh) {
            return;
        }

        const uniformScale = this.scale;
        this.webxrWallpaperMesh.scale.set(uniformScale, uniformScale, uniformScale);
    }

    updateWebXRRotation() {
        if (!this.webxrWallpaperMesh) {
            return;
        }

        this.webxrWallpaperMesh.rotation.z = (this.rotation * Math.PI) / 180;
    }


    stopFallbackCamera() {

        if (this.video) {
            this.video.pause();
            this.video.srcObject = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
        }

        this.stream = null;

        return Promise.resolve();
    }

    close() {
        this.modal.classList.remove('is-visible');
        this.modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ar-wallpaper-modal-open');
        this.hideMessage();
        return this.stopFallbackCamera()
            .then(() => this.endWebXRSession())
            .then(() => {
                this.resetSnapshotLink();
                this.isDragging = false;
                this.dragPointerId = null;
                if (this.wallpaper) {
                    this.wallpaper.classList.remove('is-dragging');
                }
            });
    }

    endWebXRSession() {
        if (!this.webxrSession) {
            this.cleanupWebXR();
            return Promise.resolve();
        }

        const session = this.webxrSession;
        return Promise.resolve()
            .then(() => session.end())
            .catch(() => {})
            .then(() => {
                this.cleanupWebXR();
            });
    }

    cleanupWebXR(restartFallback = false) {
        if (this.webxrRenderer) {
            this.webxrRenderer.setAnimationLoop(null);
            this.webxrRenderer.dispose();
        }

        if (this.webxrContainer) {
            this.webxrContainer.hidden = true;
            this.webxrContainer.innerHTML = '';
        }

        if (this.webxrHitTestSource) {
            try {
                this.webxrHitTestSource.cancel();
            } catch (error) {
                // ignore
            }
        }

        this.webxrSession = null;
        this.webxrRenderer = null;
        this.webxrScene = null;
        this.webxrCamera = null;
        this.webxrWallpaperMesh = null;
        this.webxrReticle = null;
        this.webxrHitTestSource = null;
        this.webxrHitTestRequested = false;
        this.webxrLocalSpace = null;
        this.webxrViewerSpace = null;
        const shouldRestart = this.isOpen() && (restartFallback || !this.stream);

        if (shouldRestart) {
            this.startFallbackCamera();
        }
    }

    resetSnapshotLink() {
        if (this.snapshotLink) {
            this.snapshotLink.hidden = true;
            this.snapshotLink.textContent = '';
            this.snapshotLink.removeAttribute('href');
        }
    }

    captureSnapshot() {
        if (!this.canvas || !this.ctx) {
            return Promise.resolve();
        }

        if (!this.image) {
            return Promise.resolve();
        }

        const width = this.video && this.video.videoWidth ? this.video.videoWidth : this.canvas.width;
        const height = this.video && this.video.videoHeight ? this.video.videoHeight : this.canvas.height;

        if (!width || !height) {
            return Promise.resolve();
        }

        this.canvas.width = width;
        this.canvas.height = height;

        this.ctx.save();
        this.ctx.clearRect(0, 0, width, height);

        if (this.stream && this.video) {
            this.ctx.drawImage(this.video, 0, 0, width, height);
        } else {
            const gradient = this.ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#0f172a');
            gradient.addColorStop(1, '#1e293b');
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, width, height);
        }

        const aspect = this.image.naturalWidth / Math.max(this.image.naturalHeight, 1);
        const baseWidth = width * 0.65;
        const wallpaperWidth = baseWidth * this.scale;
        const wallpaperHeight = wallpaperWidth / aspect;

        const offsetX = this.offset.x * (width / this.videoContainer.clientWidth);
        const offsetY = this.offset.y * (height / this.videoContainer.clientHeight);

        this.ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
        this.ctx.rotate((this.rotation * Math.PI) / 180);
        this.ctx.drawImage(this.image, -wallpaperWidth / 2, -wallpaperHeight / 2, wallpaperWidth, wallpaperHeight);
        this.ctx.restore();

        const data = this.canvas.toDataURL('image/png');
        if (this.snapshotLink) {
            this.snapshotLink.href = data;
            this.snapshotLink.hidden = false;
            this.snapshotLink.textContent = arWallpaperPreview.strings.snapshotReady;
            this.snapshotLink.click();
        }

        return Promise.resolve();
    }
}

if (document.readyState !== 'loading') {
    new ARWallpaperPreview();
} else {
    document.addEventListener('DOMContentLoaded', () => new ARWallpaperPreview());
}

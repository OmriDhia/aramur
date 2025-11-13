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
        this.fitButton = this.modal.querySelector('.ar-wallpaper-modal__fit-to-wall');
        this.resetButton = this.modal.querySelector('.ar-wallpaper-modal__reset');
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
        this.defaultScale = (window.arWallpaperPreview && arWallpaperPreview.settings.defaultScale) || 1;
        this.defaultRotation = (window.arWallpaperPreview && arWallpaperPreview.settings.defaultRotation) || 0;
        this.scale = this.defaultScale;
        this.rotation = this.defaultRotation;
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
        this.latestDetections = [];
        this.detectionModel = null;
        this.detectionModelPromise = null;
        this.detectionTimer = null;
        this.detectionActive = false;
        this.analysisCanvas = document.createElement('canvas');
        this.analysisCtx = this.analysisCanvas.getContext('2d');
        this.maskDataUrl = '';
        this.prevBackgroundSize = '';
        this.compositeActive = false;
        this.compositeHandle = null;

        // debug overlay (visible if URL contains ?ar_debug=1)
        this.debugMode = window.location.search && window.location.search.indexOf('ar_debug=1') !== -1;
        if (this.debugMode && this.videoContainer) {
            // style the analysis canvas so it overlays the video for debugging
            this.analysisCanvas.style.position = 'absolute';
            this.analysisCanvas.style.inset = '0';
            this.analysisCanvas.style.width = '100%';
            this.analysisCanvas.style.height = '100%';
            this.analysisCanvas.style.pointerEvents = 'none';
            this.analysisCanvas.style.opacity = '0.65';
            this.analysisCanvas.style.zIndex = '4';
            this.videoContainer.appendChild(this.analysisCanvas);
        }

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

        if (this.fitButton) {
            this.fitButton.textContent = strings.fitToWall;
        }

        if (this.resetButton) {
            this.resetButton.textContent = strings.resetPlacement;
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

        if (this.fitButton) {
            this.fitButton.addEventListener('click', () => this.fitWallpaperToWall());
        }

        if (this.resetButton) {
            this.resetButton.addEventListener('click', () => this.resetPlacement(true));
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
        this.scale = this.defaultScale;
        this.rotation = this.defaultRotation;
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
                this.resetMask();
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

        const transform = `translate(0%, 0%) translate(${this.offset.x}px, ${this.offset.y}px) rotate(${this.rotation}deg) scale(${this.scale})`;
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
                    this.startObjectDetection();
                    // start compositing preview onto the overlay canvas so occlusion is pixel-accurate
                    this.startCompositeLoop();
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
        this.stopObjectDetection();
        this.stopCompositeLoop();

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
                this.resetMask();
                this.resetSnapshotLink();
                this.isDragging = false;
                this.dragPointerId = null;
                if (this.wallpaper) {
                    this.wallpaper.classList.remove('is-dragging');
                }
                this.resetPlacement(false);
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

    resetPlacement(showMessage = false) {
        this.scale = this.defaultScale;
        this.rotation = this.defaultRotation;
        this.offset = { x: 0, y: 0 };

        if (this.scaleControl) {
            this.scaleControl.value = this.scale;
        }

        if (this.rotationControl) {
            this.rotationControl.value = this.rotation;
        }

        this.updateWallpaperTransform();
        this.resetMask();

        if (showMessage) {
            this.showMessage(this.getString('resettingPlacement'), false, 'reset');
        }
    }

    // Composite loop: draw video then wallpaper to the overlay canvas, then clear occluder rects to let video/foreground show in front
    startCompositeLoop() {
        if (!this.canvas || !this.ctx || this.compositeActive) {
            return;
        }

        // save current display/z-index values so we can restore them later
        try {
            this._prevWallpaperDisplay = this.wallpaper ? this.wallpaper.style.display : '';
            this._prevCanvasZ = this.canvas ? this.canvas.style.zIndex : '';
        } catch (e) {
            this._prevWallpaperDisplay = '';
            this._prevCanvasZ = '';
        }

        // hide the DOM wallpaper element while the composite canvas is shown
        if (this.wallpaper) {
            this.wallpaper.style.display = 'none';
            this.wallpaper.style.pointerEvents = 'none';
        }

        // bring the canvas to the front so the composite rendering is visible above video
        if (this.canvas) {
            this.canvas.style.zIndex = '2';
        }

        this.compositeActive = true;

        const loop = () => {
            if (!this.compositeActive) {
                return;
            }

            try {
                const width = this.canvas.width = this.video && this.video.videoWidth ? this.video.videoWidth : this.videoContainer.clientWidth || 640;
                const height = this.canvas.height = this.video && this.video.videoHeight ? this.video.videoHeight : this.videoContainer.clientHeight || 480;

                // draw camera frame as background
                if (this.stream && this.video) {
                    this.ctx.clearRect(0, 0, width, height);
                    this.ctx.drawImage(this.video, 0, 0, width, height);
                } else {
                    // static fallback background
                    this.ctx.fillStyle = '#0f172a';
                    this.ctx.fillRect(0, 0, width, height);
                }

                // draw wallpaper image using same transform logic as snapshot
                if (this.image) {
                    const aspect = this.image.naturalWidth / Math.max(this.image.naturalHeight, 1);
                    const baseWidth = width * 0.65;
                    const wallpaperWidth = baseWidth * this.scale;
                    const wallpaperHeight = wallpaperWidth / aspect;

                    const offsetX = this.offset.x * (width / (this.videoContainer.clientWidth || width));
                    const offsetY = this.offset.y * (height / (this.videoContainer.clientHeight || height));

                    this.ctx.save();
                    this.ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
                    this.ctx.rotate((this.rotation * Math.PI) / 180);
                    this.ctx.drawImage(this.image, -wallpaperWidth / 2, -wallpaperHeight / 2, wallpaperWidth, wallpaperHeight);
                    this.ctx.restore();

                    // apply occluder clear rects so detected objects appear in front
                    if (Array.isArray(this.latestDetections) && this.latestDetections.length) {
                        const scaleX = width / (this.videoContainer.clientWidth || width);
                        const scaleY = height / (this.videoContainer.clientHeight || height);
                        const expand = Math.max(2, Math.round(Math.min(width, height) * 0.01));

                        this.latestDetections.forEach((box) => {
                            const x = Math.max(0, Math.round(box.x * scaleX) - expand);
                            const y = Math.max(0, Math.round(box.y * scaleY) - expand);
                            const w = Math.min(width - x, Math.round(box.width * scaleX) + expand * 2);
                            const h = Math.min(height - y, Math.round(box.height * scaleY) + expand * 2);
                            // clear the wallpaper pixels in the occluder rect so the underlying camera image shows
                            this.ctx.clearRect(x, y, w, h);
                        });
                    }
                }
            } catch (err) {
                console.error('AR Wallpaper Preview: composite loop error', err);
            }

            this.compositeHandle = window.requestAnimationFrame(loop);
        };

        this.compositeHandle = window.requestAnimationFrame(loop);
    }

    stopCompositeLoop() {
        if (!this.compositeActive) {
            return;
        }
        this.compositeActive = false;
        if (this.compositeHandle) {
            window.cancelAnimationFrame(this.compositeHandle);
            this.compositeHandle = null;
        }

        // restore wallpaper element and canvas z-index
        try {
            if (this.wallpaper) {
                this.wallpaper.style.display = this._prevWallpaperDisplay || '';
                this.wallpaper.style.pointerEvents = '';
            }
            if (this.canvas) {
                this.canvas.style.zIndex = this._prevCanvasZ || '';
            }
        } catch (e) {
            // ignore
        }
    }

    resetMask() {
        if (!this.wallpaper) {
            return;
        }

        this.wallpaper.style.removeProperty('mask-image');
        this.wallpaper.style.removeProperty('-webkit-mask-image');
        this.wallpaper.style.removeProperty('--ar-wallpaper-mask');
        // restore previous background-size if we changed it
        if (this.prevBackgroundSize) {
            try {
                this.wallpaper.style.backgroundSize = this.prevBackgroundSize;
            } catch (e) {
                // ignore
            }
            this.prevBackgroundSize = '';
        }
        this.maskDataUrl = '';
        this.latestDetections = [];
    }

    fitWallpaperToWall(auto = false) {
        if (!this.videoContainer) {
            return;
        }

        const occluders = this.latestDetections || [];
        const containerWidth = this.videoContainer.clientWidth || 1;
        const containerHeight = this.videoContainer.clientHeight || 1;

        let totalOccluderWidth = 0;
        let occluderBottom = 0;
        let occluderCenter = 0;

        occluders.forEach((box) => {
            totalOccluderWidth += box.width;
            occluderBottom = Math.max(occluderBottom, box.y + box.height);
            occluderCenter += box.x + box.width / 2;
        });

        const occluderCount = occluders.length || 1;
        const averageCenter = occluderCenter / occluderCount;
        const occluderWidth = totalOccluderWidth / occluderCount;
        const baseWidth = containerWidth * 0.65;
        const safeWidth = Math.max(containerWidth - (occluderWidth || 0), containerWidth * 0.55);
        const targetScale = Math.min(3, Math.max(0.55, safeWidth / Math.max(baseWidth, 1)));

        const verticalSpace = containerHeight - occluderBottom;
        const targetOffsetY = (verticalSpace > containerHeight * 0.2)
            ? -((containerHeight / 2) - (verticalSpace / 2)) * 0.5
            : -containerHeight * 0.1;

        const centerBias = averageCenter ? (averageCenter - containerWidth / 2) : 0;
        const targetOffsetX = -centerBias * 0.35;

        this.scale = targetScale;
        this.offset = {
            x: targetOffsetX,
            y: targetOffsetY,
        };

        if (this.scaleControl) {
            this.scaleControl.value = this.scale;
        }

        this.updateWallpaperTransform();

        if (!auto) {
            this.showMessage(this.getString('fittingWall'), false, 'fit');
        }
    }

    ensureDetectionModel() {
        if (this.detectionModel) {
            return Promise.resolve(this.detectionModel);
        }

        if (this.detectionModelPromise) {
            return this.detectionModelPromise;
        }

        console.debug('AR Wallpaper Preview: ensureDetectionModel() - starting model load');

        const loadScript = (src) => new Promise((resolve, reject) => {
            if ((src.includes('tf.min.js') && window.tf) || (src.includes('coco-ssd') && window.cocoSsd)) {
                console.debug('AR Wallpaper Preview: script already present', src);
                resolve();
                return;
            }

            const existing = Array.from(document.querySelectorAll('script')).find((script) => script.src === src);
            if (existing) {
                if (existing.dataset.loaded === 'true' || existing.readyState === 'complete') {
                    resolve();
                } else {
                    existing.addEventListener('load', () => resolve());
                    existing.addEventListener('error', (event) => reject(event.error || new Error('Script load failed')));
                }
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.defer = true;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                console.debug('AR Wallpaper Preview: script loaded', src);
                resolve();
            });
            script.addEventListener('error', (event) => {
                console.error('AR Wallpaper Preview: script load error', src, event && event.error ? event.error : event);
                reject(event.error || new Error(`Failed to load script: ${src}`));
            });
            document.head.appendChild(script);
        });

        this.detectionModelPromise = loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.16.0/dist/tf.min.js')
            .then(() => loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js'))
            .then(() => {
                if (!window.cocoSsd || !window.cocoSsd.load) {
                    throw new Error('coco-ssd loader not available');
                }
                console.debug('AR Wallpaper Preview: loading coco-ssd model');
                return window.cocoSsd.load();
            })
            .then((model) => {
                console.debug('AR Wallpaper Preview: coco-ssd model loaded');
                this.detectionModel = model;
                return model;
            })
            .catch((error) => {
                console.warn('Object detection model failed to load', error);
                this.detectionModelPromise = null;
                return null;
            });

        return this.detectionModelPromise;
    }

    startObjectDetection() {
        if (this.detectionActive || !this.video) {
            return;
        }

        this.detectionActive = true;
        this.showMessage(this.getString('occlusionCalibrating'), false, 'occlusion');
        console.debug('AR Wallpaper Preview: starting object detection');
        this.runDetectionLoop();
    }

    stopObjectDetection() {
        this.detectionActive = false;
        if (this.detectionTimer) {
            window.clearTimeout(this.detectionTimer);
            this.detectionTimer = null;
        }
        if (this.activeMessageKey === 'occlusion') {
            this.hideMessage();
        }
        console.debug('AR Wallpaper Preview: stopped object detection');
    }

    runDetectionLoop() {
        if (!this.detectionActive) {
            return;
        }

        if (!this.video || this.video.readyState < 2) {
            this.detectionTimer = window.setTimeout(() => this.runDetectionLoop(), 800);
            return;
        }

        console.debug('AR Wallpaper Preview: running detection iteration');

        this.ensureDetectionModel()
            .then((model) => {
                if (!model || !this.detectionActive) {
                    console.debug('AR Wallpaper Preview: detection model not available or detection stopped');
                    return null;
                }

                return model.detect(this.video).then((predictions) => {
                    console.debug('AR Wallpaper Preview: detection predictions', predictions && predictions.length ? predictions.length : 0);
                    if (!Array.isArray(predictions)) {
                        return;
                    }

                    this.latestDetections = this.normalizeDetections(predictions);
                    console.debug('AR Wallpaper Preview: normalized detections', this.latestDetections);
                    this.applyOcclusionMask();
                    if (this.activeMessageKey === 'occlusion') {
                        this.hideMessage();
                    }
                    if (!this.latestDetections.length) {
                        this.resetMask();
                    } else {
                        this.fitWallpaperToWall(true);
                    }
                }).catch((err) => {
                    console.error('AR Wallpaper Preview: detection model failed during detect()', err);
                });
            })
            .finally(() => {
                if (this.detectionActive) {
                    this.detectionTimer = window.setTimeout(() => this.runDetectionLoop(), 1000);
                }
            });
    }

    normalizeDetections(predictions) {
        if (!this.videoContainer) {
            return [];
        }

        // broaden occluder labels and relax detection threshold slightly
        const occlusionLabels = ['person', 'chair', 'sofa', 'bed', 'tv', 'dining table', 'potted plant', 'cat', 'dog', 'couch'];
        const containerWidth = this.videoContainer.clientWidth || 1;
        const containerHeight = this.videoContainer.clientHeight || 1;
        const videoWidth = this.video && this.video.videoWidth ? this.video.videoWidth : containerWidth;
        const videoHeight = this.video && this.video.videoHeight ? this.video.videoHeight : containerHeight;
        const scaleX = containerWidth / Math.max(videoWidth, 1);
        const scaleY = containerHeight / Math.max(videoHeight, 1);

        // lower score threshold to 0.35 to catch more occluders in challenging lighting/angles
        const SCORE_THRESHOLD = 0.35;

        return predictions
            .filter((prediction) => occlusionLabels.includes(prediction.class) && prediction.score >= SCORE_THRESHOLD)
            .map((prediction) => {
                const [x, y, width, height] = prediction.bbox;
                return {
                    x: x * scaleX,
                    y: y * scaleY,
                    width: width * scaleX,
                    height: height * scaleY,
                };
            });
    }

    applyOcclusionMask() {
        if (!this.wallpaper || !this.analysisCtx || !this.latestDetections.length) {
            console.debug('AR Wallpaper Preview: applyOcclusionMask skipped (no wallpaper, analysis context, or detections)', { wallpaper: !!this.wallpaper, analysisCtx: !!this.analysisCtx, detections: this.latestDetections.length });
            return;
        }

        const videoWidth = this.video && this.video.videoWidth ? this.video.videoWidth : this.videoContainer.clientWidth || 640;
        const videoHeight = this.video && this.video.videoHeight ? this.video.videoHeight : this.videoContainer.clientHeight || 480;

        if (!videoWidth || !videoHeight) {
            console.debug('AR Wallpaper Preview: applyOcclusionMask aborted due to invalid video dimensions', { videoWidth, videoHeight });
            return;
        }

        this.analysisCanvas.width = videoWidth;
        this.analysisCanvas.height = videoHeight;

        const ctx = this.analysisCtx;
        // Fill the mask fully opaque initially (opaque areas will show the wallpaper)
        ctx.clearRect(0, 0, videoWidth, videoHeight);
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.fillRect(0, 0, videoWidth, videoHeight);

        // We'll make occluder bounding boxes transparent so the underlying video/foreground shows in front
        const scaleX = videoWidth / (this.videoContainer.clientWidth || videoWidth);
        const scaleY = videoHeight / (this.videoContainer.clientHeight || videoHeight);

        // Small expansion to avoid hairline gaps around detected boxes
        const expand = Math.max(2, Math.round(Math.min(videoWidth, videoHeight) * 0.01));

        console.debug('AR Wallpaper Preview: applyOcclusionMask drawing boxes', { videoWidth, videoHeight, scaleX, scaleY, expand, detections: this.latestDetections });

        this.latestDetections.forEach((box) => {
            const x = Math.max(0, Math.round(box.x * scaleX) - expand);
            const y = Math.max(0, Math.round(box.y * scaleY) - expand);
            const w = Math.min(videoWidth - x, Math.round(box.width * scaleX) + expand * 2);
            const h = Math.min(videoHeight - y, Math.round(box.height * scaleY) + expand * 2);
            // clearRect makes those pixels fully transparent in the PNG mask
            ctx.clearRect(x, y, w, h);

            // draw debug rectangle outline in red when debug mode is enabled
            if (this.debugMode) {
                ctx.save();
                ctx.strokeStyle = 'rgba(255,0,0,0.9)';
                ctx.lineWidth = Math.max(2, Math.round(Math.min(videoWidth, videoHeight) * 0.01));
                ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
                ctx.restore();
            }
        });

        const dataUrl = this.analysisCanvas.toDataURL('image/png');

        console.debug('AR Wallpaper Preview: generated mask dataUrl length', dataUrl ? dataUrl.length : 0, 'detections', this.latestDetections.length);

        if (dataUrl !== this.maskDataUrl) {
            // explicitly set mask CSS properties to ensure consistent behavior across browsers
            try {
                this.wallpaper.style.setProperty('--ar-wallpaper-mask', `url(${dataUrl})`);
                this.wallpaper.style.maskImage = `url(${dataUrl})`;
                this.wallpaper.style.webkitMaskImage = `url(${dataUrl})`;
                this.wallpaper.style.maskRepeat = 'no-repeat';
                this.wallpaper.style.webkitMaskRepeat = 'no-repeat';
                this.wallpaper.style.maskSize = '100% 100%';
                this.wallpaper.style.webkitMaskSize = '100% 100%';
                this.wallpaper.style.maskPosition = 'center';
                this.wallpaper.style.webkitMaskPosition = 'center';
                // Ensure wallpaper sits above video so mask can reveal video beneath
                this.wallpaper.style.zIndex = '1';
                // if background-size isn't already cover, store and set to cover for correct alignment
                try {
                    const currentSize = window.getComputedStyle(this.wallpaper).backgroundSize || '';
                    if (!this.prevBackgroundSize) {
                        this.prevBackgroundSize = currentSize;
                    }
                    this.wallpaper.style.backgroundSize = 'cover';
                } catch (e) {
                    // ignore
                }
                this.maskDataUrl = dataUrl;
                console.debug('AR Wallpaper Preview: applied mask to wallpaper element');
            } catch (err) {
                console.error('AR Wallpaper Preview: failed to apply mask styles', err);
            }
        }
    }
}

if (document.readyState !== 'loading') {
    new ARWallpaperPreview();
} else {
    document.addEventListener('DOMContentLoaded', () => new ARWallpaperPreview());
}

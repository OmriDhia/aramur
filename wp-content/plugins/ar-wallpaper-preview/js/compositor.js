/* eslint-disable no-unused-vars, no-undef */
// compositor.js (ES module)
// Main orchestrator: camera -> segmentation/depth -> composite wallpaper behind foreground objects

const DEFAULTS = {
  feather: 3,
  quality: 'medium',
  occlusion: true,
  targetFPS: 30,
};

function makeCanvas(w,h){ const c=document.createElement('canvas'); c.width=w;c.height=h; return c; }

async function setupVideo(video){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera not available');
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  await video.play();
  return video;
}

function copySize(src, ...cans){
  cans.forEach(c=>{ if (c.width !== src.videoWidth || c.height !== src.videoHeight){ c.width = src.videoWidth; c.height = src.videoHeight; } });
}

function drawWallpaperToCanvas(img, canvas){
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0,0,cw,ch);
  if (!img) return;
  const iw = img.naturalWidth || img.videoWidth || img.width;
  const ih = img.naturalHeight || img.videoHeight || img.height;
  // cover mode: scale to cover canvas
  const scale = Math.max(cw/iw, ch/ih);
  const sw = iw * scale, sh = ih * scale;
  const sx = (cw - sw)/2, sy = (ch - sh)/2;
  ctx.drawImage(img, sx, sy, sw, sh);
}

// Draw wallpaper image directly into a 2D context (scaled to cover)
function drawWallpaperToCtx(img, ctx, w, h){
  ctx.clearRect(0,0,w,h);
  if (!img) return false;
  const iw = img.naturalWidth || img.videoWidth || img.width || 1;
  const ih = img.naturalHeight || img.videoHeight || img.height || 1;
  const scale = Math.max(w/iw, h/ih);
  const sw = iw * scale, sh = ih * scale;
  const sx = (w - sw)/2, sy = (h - sh)/2;
  try{ ctx.drawImage(img, sx, sy, sw, sh); }catch(e){ return false; }
  return true;
}

async function createImageElement(src){
  if (!src) return null;
  const img = new Image(); img.crossOrigin = 'anonymous';
  return new Promise((resolve,reject)=>{ img.onload = ()=>resolve(img); img.onerror = async (e)=>{
    console.warn('ARWP: direct image load failed, attempting fetch blob fallback for', src, e);
    const modes = [ {mode:'cors'}, {}, {mode:'no-cors'} ];
    let lastErr = null;
    for (let m=0;m<modes.length;m++){
      try{
        const opts = modes[m];
        const resp = await fetch(src, opts);
        // Accept if response is ok or opaque (no-cors)
        if (!resp) { lastErr = new Error('no response'); continue; }
        if (!resp.ok && resp.type !== 'opaque') {
          lastErr = new Error('bad response: ' + resp.status + ' type=' + resp.type);
          console.warn('ARWP: fetch returned bad response', resp.status, resp.type);
          continue;
        }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const img2 = new Image();
        img2.onload = ()=>{ URL.revokeObjectURL(blobUrl); resolve(img2); };
        img2.onerror = (ee)=>{ URL.revokeObjectURL(blobUrl); throw ee; };
        img2.src = blobUrl;
        return; // success
      }catch(fetchErr){
        lastErr = fetchErr;
        console.warn('ARWP: fetch attempt failed for mode', modes[m], fetchErr);
        // continue to next mode
      }
    }
    console.warn('ARWP: all fetch fallbacks failed for', src, lastErr);
    reject(e);
  }; img.src = src; });
}

// Per-root instance setup, but start only when start() is called
export default async function setupInstance(root){
   const video = root.querySelector('.arwp-video');
   const wallpaperCanvas = root.querySelector('.arwp-wallpaper-canvas');
   const maskCanvas = root.querySelector('.arwp-mask-canvas');
   const outputCanvas = root.querySelector('.arwp-output-canvas');

   // controls
   const occlusionToggle = root.querySelector('.arwp-toggle-occlusion');
   const featherInput = root.querySelector('.arwp-feather');
   const qualitySelect = root.querySelector('.arwp-quality');
   const loadingEl = root.querySelector('.arwp-loading');

   // create auxiliary canvases
  const videoCanvas = makeCanvas(2,2);
  const fgCanvas = makeCanvas(2,2);
  // segmentation provider will be lazily initialized on start()
  let segProvider = null;
  const pendingSegOptions = { quality: DEFAULTS.quality, feather: DEFAULTS.feather, detectionInterval: 400, softFillRadius: DEFAULTS.feather * 6 };
  let lastMaskImageData = null;

   // Diagnostic UI (status + debug toggle)
   let diagRoot = null;
   let diagInterval = null;
   function createDiagUI(){
     if (diagRoot) return;
     diagRoot = document.createElement('div'); diagRoot.className = 'arwp-diag';
     diagRoot.innerHTML = '<button class="arwp-diag-toggle">Seg Debug</button><div class="arwp-diag-status">Provider: -</div>';
     // place in root (top-left)
     root.appendChild(diagRoot);
     const toggle = diagRoot.querySelector('.arwp-diag-toggle');
     const status = diagRoot.querySelector('.arwp-diag-status');
     toggle.addEventListener('click', async ()=>{
       const isOn = toggle.classList.toggle('on');
       const debugVal = !!isOn;
       toggle.textContent = debugVal ? 'Seg Debug (ON)' : 'Seg Debug';
       // set provider debug if provider supports setOptions
       try{
         if (segProvider && segProvider.setOptions){ segProvider.setOptions({ debug: debugVal }); }
       }catch(e){ console.warn('ARWP: diag toggle setOptions failed', e); }
     });

     // updater
     diagInterval = setInterval(()=>{
       try{
         let s = { provider: 'none' };
         if (segProvider && typeof segProvider.getStatus === 'function'){
           s = segProvider.getStatus();
         } else if (window.ARWP_Segmentation){
           // if segProvider not yet init, we can still query module-level info via getStatus if exported differently
         }
         status.textContent = `Provider: ${s.provider || '-'} | model:${s.modelLoaded? 'yes':'no'} | bodypix:${s.bodypix? 'yes':'no'} | debug:${s.debug}`;
       }catch(e){ /* ignore */ }
     }, 500);
   }

   function destroyDiagUI(){ if (diagInterval) { clearInterval(diagInterval); diagInterval = null; } if (diagRoot && diagRoot.parentElement) diagRoot.parentElement.removeChild(diagRoot); diagRoot = null; }

   // load wallpaper image from data-bg attr
   const bgUrl = root.dataset.bg || '';
   let wallpaperImg = null;
   if (bgUrl) {
     try{ wallpaperImg = await createImageElement(bgUrl); }catch(e){ console.warn('Failed to load wallpaper image', e); }
   }

   // wallpaper placement state
   let wallpaperPlaced = false;
   // target transform (in camera space units): { yaw (rad), distance (m), widthM (m) }
   let targetTransform = { yaw: 0, distance: 2.0, widthM: 2.4 };
   let smoothTransform = Object.assign({}, targetTransform);
   const transformSmoothFactor = 0.1; // 0..1, lower=more smoothing

   // helper to lerp transforms
   function lerpTransform(src, dst, t){ return { yaw: src.yaw + (dst.yaw - src.yaw) * t, distance: src.distance + (dst.distance - src.distance) * t, widthM: src.widthM + (dst.widthM - src.widthM) * t }; }

   // helper: try to start an immersive-ar session safely (returns session or null)
   async function tryStartImmersiveAR(){
     if (!('xr' in navigator)){
       console.warn('ARWP: navigator.xr not available');
       return null;
     }
     if (!window.isSecureContext){
       console.warn('ARWP: WebXR requires a secure context (HTTPS or localhost)');
       return null;
     }
     let supported;
     try{
       supported = await navigator.xr.isSessionSupported('immersive-ar');
     }catch(err){ console.warn('ARWP: isSessionSupported check failed', err); supported = false; }
     if (!supported){
       console.warn('ARWP: immersive-ar not supported on this device/browser');
       return null;
     }

     const sessionInit = {
       // prefer hit-test etc as optional to reduce chance of rejection
       optionalFeatures: ['hit-test','dom-overlay','local-floor','depth-sensing'],
       domOverlay: { root: document.body },
       depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha'] }
     };

     try {
       return await navigator.xr.requestSession('immersive-ar', sessionInit);
     } catch (err) {
       console.warn('ARWP: requestSession failed', err);
       return null;
     }

   }

   // Fit to Wall / Reset controls
   const fitBtn = root.querySelector('.arwp-fit-wall');
   const resetBtn = root.querySelector('.arwp-reset');
   if (fitBtn) fitBtn.addEventListener('click', async function(){
     // Try WebXR hit-test to get a world hit; if unavailable, fallback to center placement
     try{
       const session = await tryStartImmersiveAR();
       if (!session){
         console.log('ARWP: WebXR not available or session denied; using center fallback');
         // Show a friendly UI message so the user understands why hit-test didn't run
         try{
           if (loadingEl){
             loadingEl.textContent = 'WebXR not available or permission denied — using center placement. For AR hit-testing open this page in a supported mobile browser.';
             loadingEl.style.display = 'block';
             setTimeout(()=>{ try{ loadingEl.style.display = 'none'; }catch(e){} }, 5000);
           }
         }catch(e){}
         wallpaperPlaced = true; targetTransform = { yaw: 0, distance: 2.0, widthM: 2.4 };
         return;
       }

       // We have a session; try to get a single hit result within a short timeout
       let viewerRef = null;
       try{ viewerRef = await session.requestReferenceSpace('viewer'); }catch(e){ try{ viewerRef = await session.requestReferenceSpace('local'); }catch(e){ viewerRef = null; } }
       let hitSource = null;
       try{ if (viewerRef && session.requestHitTestSource) hitSource = await session.requestHitTestSource({ space: viewerRef }); }catch(e){ console.warn('ARWP: requestHitTestSource failed', e); }

       let got = false;
       const framePromise = new Promise((resolve) => {
         const onFrame = (time, xrFrame) => {
           try{
             if (hitSource){
               const hits = xrFrame.getHitTestResults(hitSource);
               if (hits && hits.length){
                 const hit = hits[0];
                 let p = null;
                 try{ p = hit.getPose(session.referenceSpace || xrFrame.session.referenceSpace); }catch(e){}
                 if (!p){ try{ p = hit.getPose(viewerRef); }catch(e){} }
                 if (p && p.transform){
                   const q = p.transform.orientation;
                   const ys = 2*(q.w*q.y + q.x*q.z);
                   const yc = 1 - 2*(q.y*q.y + q.z*q.z);
                   const yaw = Math.atan2(ys, yc);
                   const pos = p.transform.position;
                   const distance = Math.sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z) || 2.0;
                   targetTransform = { yaw: yaw, distance: distance, widthM: 2.4 };
                   wallpaperPlaced = true; got = true; resolve(true);
                   return;
                 }
               }
             }
           }catch(err){ /* ignore per-frame errors */ }
           if (!got && session) session.requestAnimationFrame(onFrame);
         };
         session.requestAnimationFrame(onFrame);
       });

       // wait up to 3s for a hit
       const ok = await Promise.race([framePromise, new Promise(r => setTimeout(() => r(false), 3000))]);
      try{ await session.end(); }catch(e){}
      if (!ok){ console.warn('ARWP: hit-test timed out or failed; falling back to center placement'); wallpaperPlaced = true; targetTransform = { yaw: 0, distance: 2.0, widthM: 2.4 }; }
    }catch(e){ console.warn('ARWP: Fit-to-wall failed', e); wallpaperPlaced = true; targetTransform = { yaw: 0, distance: 2.0, widthM: 2.4 }; }
  });

   // Reset button: restore default transform
   if (resetBtn) resetBtn.addEventListener('click', async function(){
     wallpaperPlaced = false;
     targetTransform = { yaw: 0, distance: 2.0, widthM: 2.4 };
   });

   // initial setup
   copySize(video, wallpaperCanvas, maskCanvas, outputCanvas, videoCanvas, fgCanvas);
   drawWallpaperToCanvas(wallpaperImg, wallpaperCanvas);

   // segmentor = await initSegmentation({ workerPath: 'bodypix_worker.js', modelPath: 'model.json', maxWidth: 640, maxHeight: 480 });
   // segmentor.setOptions({ flipHorizontal: true });
   // const seg = await segmentor.segment(video);
   // console.log('segmentation result', seg);

   // start video capture (await and show friendly error on failure)
   try {
     await setupVideo(video);
     // priming draw
     copySize(video, wallpaperCanvas, maskCanvas, outputCanvas, videoCanvas, fgCanvas);
     drawWallpaperToCanvas(wallpaperImg, wallpaperCanvas);
     // If debugging is enabled via localized data, show the raw video element to help troubleshooting
     try{
       if (window.ARWP_Data && window.ARWP_Data.debug){ try{ video.style.display = 'block'; }catch(e){} }
       else {
         // Keep video visually hidden but not 'display:none' to avoid some browsers blocking autoplay on hidden elements.
         try{
           video.style.display = 'block';
           video.style.position = 'absolute';
           video.style.left = '-9999px';
           video.style.width = '1px';
           video.style.height = '1px';
           video.style.opacity = '0';
         }catch(e){}
       }
     }catch(e){}
     if (loadingEl) { try { loadingEl.style.display = 'none'; } catch(e){} }
   } catch (err) {
     console.warn('ARWP: camera start failed', err);
     if (loadingEl) {
      try {
        let msg = 'Camera start failed: ' + (err && err.name ? err.name + ' - ' : '') + (err && err.message ? err.message : String(err));
        if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function'){
          try{
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices.filter(d => d.kind === 'videoinput');
            msg += ' | cameras detected: ' + cams.length;
            if (cams.length > 0) msg += ' (' + cams.map(d => d.label || 'unnamed').slice(0,3).join(', ') + (cams.length>3? ',...':'') + ')';
          }catch(ed){ console.warn('ARWP: enumerateDevices failed', ed); }
        }
        loadingEl.textContent = msg;
      } catch(e){}
     }
   }

   // per-instance update loop
   let lastFrameTime = performance.now();
   async function instanceUpdate(){
     const now = performance.now();
     const dt = (now - lastFrameTime) / 1000;
     lastFrameTime = now;

    // Ensure all working canvases match the video dimensions for this frame
    copySize(video, wallpaperCanvas, maskCanvas, outputCanvas, videoCanvas, fgCanvas);

    // Request/update segmentation mask
    let maskImageData = null;
    if (segProvider && typeof segProvider.getMask === 'function'){
      try{
        maskImageData = await segProvider.getMask(video, videoCanvas.width, videoCanvas.height);
      }catch(e){ console.warn('ARWP: segProvider.getMask failed', e); }
    }
    if (!maskImageData && lastMaskImageData){
      maskImageData = lastMaskImageData;
    }

    // smooth transform towards target
    smoothTransform = lerpTransform(smoothTransform, targetTransform, transformSmoothFactor);

    // draw the latest camera frame into an off-screen canvas so we can apply the mask via compositing
    {
      const ctx = videoCanvas.getContext('2d');
      ctx.clearRect(0,0,videoCanvas.width,videoCanvas.height);
      ctx.save();
      ctx.translate(videoCanvas.width/2, videoCanvas.height/2);
      ctx.rotate(-smoothTransform.yaw);
      ctx.translate(-videoCanvas.width/2, -videoCanvas.height/2);
      ctx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
      ctx.restore();
    }

    // redraw wallpaper to match the video canvas
    drawWallpaperToCanvas(wallpaperImg, wallpaperCanvas);

    // update mask canvas and punch out foreground objects from the wallpaper layer
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.clearRect(0,0,maskCanvas.width, maskCanvas.height);
    if (maskImageData){
      if (maskCanvas.width !== maskImageData.width || maskCanvas.height !== maskImageData.height){
        maskCanvas.width = maskImageData.width;
        maskCanvas.height = maskImageData.height;
      }
      maskCtx.putImageData(maskImageData, 0, 0);
      lastMaskImageData = maskImageData;
      const wallCtx = wallpaperCanvas.getContext('2d');
      wallCtx.save();
      wallCtx.globalCompositeOperation = 'destination-out';
      wallCtx.drawImage(maskCanvas, 0, 0, wallpaperCanvas.width, wallpaperCanvas.height);
      wallCtx.restore();
    }

    // Composite final output: start with the live video, then overlay the masked wallpaper
    try{
      const outCtx = outputCanvas.getContext('2d');
      outCtx.clearRect(0,0,outputCanvas.width, outputCanvas.height);
      outCtx.drawImage(videoCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      if (wallpaperImg){
        outCtx.drawImage(wallpaperCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      }
    }catch(e){ console.warn('ARWP: output composite failed', e); }

     // request next frame
     if (video.readyState >= 2) {
       // only request if video is actually playing
       if (!video.paused && !video.ended) {
         // if playback is too slow, skip frames to catch up (target ~30fps)
         const targetFrameTime = 1000 / DEFAULTS.targetFPS;
         const skipFrames = Math.floor(dt / (targetFrameTime * 0.9));
         for (let i=0; i<skipFrames; i++) video.pause();
         video.play();
       }
     }
   }

   // main instance loop
   async function instanceLoop(){
     // per-instance update loop
     while (video.readyState < 2) await new Promise(r=>setTimeout(r, 100));
     lastFrameTime = performance.now();
     try{ await instanceUpdate(); }catch(e){ console.warn('ARWP: instanceUpdate failed', e); }
     const loop = async ()=>{
       try{ await instanceUpdate(); }catch(e){ console.warn('ARWP: instanceUpdate failed', e); }
       requestAnimationFrame(loop);
     };
     requestAnimationFrame(loop);
   }

  // Wait for the video to report non-zero dimensions (first frame) before starting the loop.
  async function waitForVideoFrame(timeoutMs = 3000){
    if (video.videoWidth > 0 && video.videoHeight > 0) return true;
    return new Promise((resolve)=>{
      const start = performance.now();
      function check(){
        if (video.videoWidth > 0 && video.videoHeight > 0) return resolve(true);
        if (performance.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 50);
      }
      // also listen for playing event as a fallback
      function onPlaying(){ if (video.videoWidth > 0 && video.videoHeight > 0) resolve(true); }
      try{ video.addEventListener('playing', onPlaying, { once: true }); }catch(e){}
      check();
    });
  }

  (async ()=>{
    const got = await waitForVideoFrame(3000);
    if (!got) console.warn('ARWP: video did not report dimensions within timeout; output may be delayed.');
    instanceLoop();
  })();

   // lazy load segmentation provider
   import('./segmentation.js').then(async mod=>{
     // find a suitable provider (priority order)
     const providers = [ mod.BodyPixSegmentation, mod.MediaPipeSegmentation ];
     for (let i=0;i<providers.length;i++){
       const SegClass = providers[i];
       if (SegClass && typeof SegClass.detect === 'function'){
         segProvider = new SegClass();
         console.log('ARWP: using segmentation provider', SegClass.name);
         // apply any pending options
         try{
           if (segProvider.setOptions) segProvider.setOptions(pendingSegOptions);
         }catch(e){ console.warn('ARWP: setOptions failed for pending options', e); }
         // ready to go
         break;
       }
     }
   });

   // cleanup on dispose
   return ()=>{
    destroyDiagUI();
    if (segProvider && typeof segProvider.dispose === 'function') try{ segProvider.dispose(); }catch(e){ console.warn('ARWP: dispose failed', e); }
    if (video) { video.srcObject = null; video.pause(); }
    lastMaskImageData = null;
    [ wallpaperCanvas, maskCanvas, outputCanvas, videoCanvas, fgCanvas ].forEach(c=>{ try{ c.width = 2; c.height = 2; }catch(e){} });
  };
}

// Also expose on window for dev tools and to satisfy static analysis that the default export is used
if (typeof window !== 'undefined') {
  try { window.ARWP_compositor_setupInstance = setupInstance; } catch (e) { /* ignore non-browser env */ }
}

// Provide a simple global API expected by auto-inject: ARWP.startRoot(root) and ARWP.stopRoot(root)
if (typeof window !== 'undefined') {
  window.ARWP = window.ARWP || {};
  (function(api){
    api._rootDisposers = api._rootDisposers || new WeakMap();
    api.startRoot = function(root){
      if (!root) return null;
      // avoid double-start
      if (api._rootDisposers.has(root)) return null;
      (async function(){
        try{
          const disposer = await setupInstance(root);
          if (typeof disposer === 'function') api._rootDisposers.set(root, disposer);
        }catch(err){ console.warn('ARWP: startRoot failed', err); }
      })();
      return null;
    };
    api.stopRoot = function(root){
      try{
        const d = api._rootDisposers.get(root);
        if (typeof d === 'function'){
          try{ d(); }catch(e){ console.warn('ARWP: disposer failed', e); }
          api._rootDisposers.delete(root);
        }
      }catch(e){ /* ignore */ }
    };
  })(window.ARWP);
}

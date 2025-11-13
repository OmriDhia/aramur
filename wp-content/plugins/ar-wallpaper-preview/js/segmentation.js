// filepath: c:\laragon\www\Auramur\wp-content\plugins\ar-wallpaper-preview\js\segmentation.js
// Enhanced segmentation with MediaPipe try-first and TFJS DeepLab lazy-fallback.
// Produces a soft-filled blurred mask (boxes -> blurred paint) for foreground classes and supports throttling + debug overlay.

(function(){
  const DEFAULTS = {
    quality: 'medium',
    feather: 3,
    smoothFactor: 0.6,
    detectionInterval: 400, // ms between heavy segmentation runs
    softFillRadius: 24,     // px blur when painting boxes
    foregroundClasses: ['person','chair','sofa','diningtable','potted plant','tv','dog','cat','bench','table','couch','bed'],
    debug: false
  };

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      if (document.querySelector(`script[src=\"${src}\"]`)) return resolve();
      const s = document.createElement('script'); s.src = src; s.onload = () => resolve(); s.onerror = (e)=>reject(e); document.head.appendChild(s);
    });
  }
  function makeCanvas(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

  // PASCAL VOC labels used by DeepLab (0..20)
  const PASCAL_LABELS = [
    'background','aeroplane','bicycle','bird','boat','bottle','bus','car','cat','chair','cow','diningtable','dog','horse','motorbike','person','potted plant','sheep','sofa','train','tv'
  ];

  const FOREGROUND_SET = (arr)=>{ const s=new Set(); arr.forEach(x=>s.add((x||'').toLowerCase())); return s; };

  window.ARWP_Segmentation = (function(){
    let opts = {};
    let model = null; // deeplab model instance
    let deeplabLib = null;
    let tf = null;
    let useMediaPipe = false;
    let mpSegmenter = null;
    let lastRun = 0;
    let prevMaskImageData = null; // Uint8ClampedArray of previous alpha values for smoothing
    let lastMaskCanvas = null; // cached canvas of last mask
    let disposed = false;

    // provider info
    let providerName = 'none';
    let lastError = null;

    // BodyPix fallback provider (if Deeplab not available)
    let bodypixProvider = null;

    // debug overlay
    let debugOn = false;
    let debugRoot = null;
    let debugCanvas = null; let debugCtx = null;

    function createDebugUI(){
      if (debugRoot) return;
      debugRoot = document.createElement('div');
      debugRoot.style.position='fixed'; debugRoot.style.right='8px'; debugRoot.style.top='8px'; debugRoot.style.zIndex=99999; debugRoot.style.fontFamily='sans-serif';
      debugRoot.style.background='rgba(0,0,0,0.5)'; debugRoot.style.color='white'; debugRoot.style.padding='6px'; debugRoot.style.borderRadius='6px';
      const btn = document.createElement('button'); btn.textContent = 'Seg Debug'; btn.style.cursor='pointer'; btn.style.marginRight='6px';
      btn.addEventListener('click', ()=>{ debugOn = !debugOn; btn.style.background = debugOn ? '#0b7' : ''; if (!debugOn) hideDebugCanvas(); else showDebugCanvas(); });
      debugRoot.appendChild(btn);
      const info = document.createElement('span'); info.textContent = 'Show segmentation diagnostics'; info.style.fontSize = '12px'; debugRoot.appendChild(info);
      document.body.appendChild(debugRoot);
    }
    function showDebugCanvas(){ if (!debugCanvas){ debugCanvas = makeCanvas(320,240); debugCanvas.style.position='fixed'; debugCanvas.style.left='8px'; debugCanvas.style.top='64px'; debugCanvas.style.zIndex=99998; debugCanvas.style.border='2px solid rgba(255,255,255,0.35)'; debugCanvas.style.background='black'; debugCanvas.style.opacity='0.95'; debugCanvas.style.pointerEvents='none'; debugCtx = debugCanvas.getContext('2d'); document.body.appendChild(debugCanvas); } debugCanvas.style.display='block'; }
    function hideDebugCanvas(){ if (debugCanvas) debugCanvas.style.display='none'; }

    async function tryMediaPipe(){
      try{
        // Detect MediaPipe tasks API ImageSegmenter (best-effort). Not all builds exist on every platform.
        const mp = window.tasks && window.tasks.vision ? window.tasks.vision : (window.tasks ? window.tasks : null);
        if (mp && typeof mp.ImageSegmenter === 'function'){
          try{
            // Try to initialize a default segmenter; this is defensive - some builds require model config.
            mpSegmenter = new mp.ImageSegmenter();
            useMediaPipe = true;
            providerName = 'mediapipe';
            console.log('[ARWP] MediaPipe ImageSegmenter available and instantiated');
            return true;
          }catch(e){
            console.warn('[ARWP] MediaPipe ImageSegmenter instantiation failed', e);
            lastError = e;
            mpSegmenter = null; useMediaPipe = false; providerName = 'none'; return false;
          }
        }
      }catch(e){ console.warn('[ARWP] MediaPipe detection error', e); lastError = e; }
      return false;
    }

    async function loadDeepLabLazy(){
      if (model || deeplabLib) return true;
      try{
        if (!window.tf){
          await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.20.0/dist/tf.min.js');
        }
        tf = window.tf;
      }catch(e){ console.warn('[ARWP] failed to load tfjs', e); lastError = e; }

      const version = '0.2.2';
      // candidate CDN locations in order of preference. Some CDNs don't host an ESM file at the expected path, so try several.
      const candidates = [
        // try skypack ESM which serves an ESM-compatible bundle
        `https://cdn.skypack.dev/@tensorflow-models/deeplab@${version}`,
        // try jsDelivr UMD/min distributable
        `https://cdn.jsdelivr.net/npm/@tensorflow-models/deeplab@${version}/dist/deeplab.min.js`,
        // try unpkg UMD/min distributable
        `https://unpkg.com/@tensorflow-models/deeplab@${version}/dist/deeplab.min.js`,
      ];

      let lastErr = null;
      for (const url of candidates){
        try{
          console.log('[ARWP] attempting to load DeepLab from', url);
          // If the URL looks like a skypack ESM entry, try dynamic import
          if (url.indexOf('skypack.dev') !== -1){
            try{
              const mod = await import(url);
              deeplabLib = mod && (mod.default || mod);
              if (deeplabLib && typeof deeplabLib.load === 'function'){
                console.log('[ARWP] DeepLab loaded via skypack ESM');
                break;
              } else {
                console.warn('[ARWP] skypack import did not expose deeplab.load');
              }
            }catch(e){ lastErr = e; console.warn('[ARWP] skypack import failed', e); }
            continue;
          }

          // Otherwise, load the UMD/min script which should expose window.deeplab
          try{
            await loadScript(url);
            if (window.deeplab && typeof window.deeplab.load === 'function'){
              deeplabLib = window.deeplab;
              console.log('[ARWP] DeepLab loaded via UMD script at', url);
              break;
            } else {
              lastErr = new Error('deeplab not exposed on window after loading ' + url);
              console.warn('[ARWP] script loaded but deeplab not found on window for', url);
            }
          }catch(errScript){ lastErr = errScript; console.warn('[ARWP] failed to load script', url, errScript); }
        }catch(e){ lastErr = e; console.warn('[ARWP] unexpected error while trying candidate', url, e); }
      }

      if (!deeplabLib){
        console.warn('[ARWP] deeplab not available from CDN candidates; last error:', lastErr || lastError);
        // Try BodyPix + COCO-SSD fallback
        try{
          console.log('[ARWP] Attempting BodyPix + COCO-SSD fallback');
          // ensure tf is present
          if (!window.tf){
            await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.20.0/dist/tf.min.js');
          }
          // load BodyPix and COCO-SSD
          await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js');
          await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js');
          const modelBP = await window.bodyPix.load({ architecture: 'MobileNetV1', outputStride: 16, multiplier: 0.75 });
          const modelCOCO = await window.cocoSsd.load();
          // create provider
          bodypixProvider = makeBodyPixProvider(modelBP, modelCOCO);
          providerName = 'bodypix';
          console.log('[ARWP] BodyPix+COCO-SSD fallback ready');
          return true;
        }catch(bpErr){
          console.warn('[ARWP] BodyPix fallback failed', bpErr);
          lastError = bpErr;
          bodypixProvider = null;
          providerName = 'unavailable';
          return false;
        }
      }

      if (deeplabLib && typeof deeplabLib.load === 'function'){
        try{
          model = await deeplabLib.load({ base: 'pascal' });
          providerName = 'deeplab';
          console.log('[ARWP] DeepLab model loaded');
          return true;
        }catch(e){ console.warn('[ARWP] deeplab.load() failed', e); lastError = e; model = null; }
      }
      return false;
    }

    // BodyPix provider factory (creates compatible getMask signature)
    function makeBodyPixProvider(modelBP, modelCOCO){
      let prevMaskData = null;
      return {
        async getMask(video, w, h){
          const scale = opts.quality === 'high' ? 1 : (opts.quality === 'low' ? 0.5 : 0.75);
          const sw = Math.max(1, Math.floor(w * scale));
          const sh = Math.max(1, Math.floor(h * scale));
          const temp = makeCanvas(sw, sh); const tctx = temp.getContext('2d'); tctx.drawImage(video,0,0,sw,sh);

          // person segmentation
          const segmentation = await modelBP.segmentPerson(temp, { internalResolution: 'medium', segmentationThreshold: 0.5 });
          const img = tctx.createImageData(sw, sh);
          for (let i=0;i<segmentation.data.length;i++){ const v = segmentation.data[i] ? 255 : 0; const idx=i*4; img.data[idx]=255; img.data[idx+1]=255; img.data[idx+2]=255; img.data[idx+3]=v; }
          const small = makeCanvas(sw, sh); small.getContext('2d').putImageData(img,0,0);

          const maskCanvas = makeCanvas(w,h); const mctx = maskCanvas.getContext('2d'); mctx.imageSmoothingEnabled = true; mctx.drawImage(small,0,0,w,h);

          // run object detection to mark furniture boxes
          try{
            const detections = await modelCOCO.detect(temp);
            mctx.globalCompositeOperation = 'source-over'; mctx.fillStyle='white';
            detections.forEach(det=>{ const c = det.class; if (['chair','couch','sofa','dining table','table','potted plant','bench','bed'].includes(c)){
              const [x,y,bw,bh] = det.bbox; const sx = x*(w/sw); const sy = y*(h/sh); const sbw = bw*(w/sw); const sbh = bh*(h/sh); const padX=Math.max(4,sbw*0.05); const padY=Math.max(4,sbh*0.05); mctx.fillRect(sx-padX, sy-padY, sbw+padX*2, sbh+padY*2);
            }});
          }catch(e){ console.warn('[ARWP] COCO detection error in fallback', e); }

          // temporal smoothing
          const currData = mctx.getImageData(0,0,w,h);
          if (!prevMaskData) prevMaskData = new Uint8ClampedArray(currData.data);
          const alpha = opts.smoothFactor || 0.6;
          for (let i=0;i<currData.data.length;i+=4){ const currA=currData.data[i+3]; const prevA=prevMaskData[i+3]||0; const sm=Math.round(prevA*alpha + currA*(1-alpha)); currData.data[i]=currData.data[i+1]=currData.data[i+2]=255; currData.data[i+3]=sm; prevMaskData[i+3]=sm; }

          const featherPx = Math.min(12, Math.max(0, opts.feather || 3));
          const outCanvas = makeCanvas(w,h); const outCtx = outCanvas.getContext('2d'); if (featherPx>0) outCtx.filter=`blur(${featherPx}px)`; outCtx.putImageData(currData,0,0);
          return outCtx.getImageData(0,0,w,h);
        },
        dispose(){ modelBP=null; modelCOCO=null; prevMaskData=null; }
      };
    }

    function setOptions(o){ opts = Object.assign({}, opts, o || {}); if (opts.debug) { createDebugUI(); } }

    // compute bounding boxes for foreground labels from segmentationMap (Uint8Array length sw*sh)
    function computeBoxesFromSegMap(segMap, sw, sh, foregroundSet){
      const boxes = [];
      const visited = new Uint8Array(segMap.length);
      // Use sw/sh directly to avoid redundant local aliases
      for (let y=0;y<sh;y++){
        for (let x=0;x<sw;x++){
          const i = y*sw + x;
          if (visited[i]) continue;
          const label = segMap[i];
          // map label id to textual label if possible (DeepLab) or treat non-zero as foreground
          let isFg = false;
          if (Array.isArray(PASCAL_LABELS) && label >=0 && label < PASCAL_LABELS.length){
            isFg = foregroundSet.has(PASCAL_LABELS[label].toLowerCase());
          } else {
            isFg = label !== 0;
          }
          if (!isFg){ visited[i]=1; continue; }
          // BFS flood to get bbox for this connected component
          let minX=x, maxX=x, minY=y, maxY=y;
          const stack=[i]; visited[i]=1;
          while(stack.length){
            const idx = stack.pop();
            const yy = Math.floor(idx/sw), xx = idx % sw;
            minX = Math.min(minX, xx); maxX = Math.max(maxX, xx);
            minY = Math.min(minY, yy); maxY = Math.max(maxY, yy);
            // neighbors
            const nb = [idx-1, idx+1, idx-sw, idx+sw];
            for (const n of nb){ if (n<0||n>=segMap.length) continue; if (visited[n]) continue; const lbl = segMap[n]; let nIsFg = (lbl>=0 && lbl<PASCAL_LABELS.length) ? foregroundSet.has(PASCAL_LABELS[lbl].toLowerCase()) : (lbl !== 0); if (nIsFg){ visited[n]=1; stack.push(n);} else { visited[n]=1; } }
          }
          boxes.push({ x:minX, y:minY, w: maxX-minX+1, h: maxY-minY+1 });
        }
      }
      return boxes;
    }

    // paint blurred boxes onto a mask canvas (size w x h). boxes are in target pixels
    function softFillMask(maskCanvas, boxes, blurPx){
      const w = maskCanvas.width, h = maskCanvas.height;
      const temp = makeCanvas(w,h); const tctx = temp.getContext('2d');
      tctx.clearRect(0,0,w,h); tctx.fillStyle='white';
      for (const b of boxes){ tctx.fillRect(b.x, b.y, b.w, b.h); }
      const out = maskCanvas.getContext('2d'); out.clearRect(0,0,w,h);
      if (blurPx>0) out.filter = `blur(${blurPx}px)`;
      out.drawImage(temp,0,0);
      out.filter = 'none';
    }

    // Temporal smoothing: blend previous alpha with current mask alpha
    function temporalSmooth(maskCanvas, smoothFactor){
      const w = maskCanvas.width, h = maskCanvas.height; const ctx = maskCanvas.getContext('2d'); const id = ctx.getImageData(0,0,w,h);
      if (!prevMaskImageData || prevMaskImageData.length !== id.data.length){ prevMaskImageData = new Uint8ClampedArray(id.data); return id; }
      const alpha = Math.max(0, Math.min(1, smoothFactor || 0.6));
      for (let i=0;i<id.data.length;i+=4){ const currA = id.data[i+3]; const prevA = prevMaskImageData[i+3]||0; const blended = Math.round(prevA*alpha + currA*(1-alpha)); id.data[i]=255; id.data[i+1]=255; id.data[i+2]=255; id.data[i+3]=blended; prevMaskImageData[i+3]=blended; }
      ctx.putImageData(id,0,0);
      return id;
    }

    // Public API: init -> returns object with getMask(video,w,h)
    async function init(options){
      opts = Object.assign({}, DEFAULTS, options || {});
      if (opts.debug) createDebugUI();

      // Attempt MediaPipe first (non-blocking): if available we will use it. Otherwise we'll lazily load DeepLab when needed.
      try{
        const mpOk = await tryMediaPipe();
        if (!mpOk){
          console.log('[ARWP] MediaPipe not available, will lazily load DeepLab on first segmentation call');
        }
      }catch(e){ console.warn('[ARWP] MediaPipe try failed', e); lastError = e; }

      return { getMask, setOptions, dispose, getStatus };
    }

    // Expose a small status object for diagnostics
    function getStatus(){
      return {
        provider: providerName,
        modelLoaded: !!model,
        deeplabLib: !!deeplabLib,
        bodypix: !!bodypixProvider,
        debug: !!opts.debug,
        lastError: lastError ? String(lastError) : null
      };
    }

    async function getMask(video, w, h){
      if (disposed) return null;
      const now = performance.now();
      if (now - lastRun < (opts.detectionInterval||400)){
        // return last cached mask if available
        if (lastMaskCanvas) return lastMaskCanvas.getContext('2d').getImageData(0,0,lastMaskCanvas.width,lastMaskCanvas.height);
        return null;
      }
      lastRun = now;

      // ensure sizes
      const scale = opts.quality === 'high' ? 1 : (opts.quality === 'low' ? 0.5 : 0.75);
      const sw = Math.max(1, Math.floor(w * scale));
      const sh = Math.max(1, Math.floor(h * scale));

      // draw current frame to temp canvas for model input
      const input = makeCanvas(sw, sh); const ictx = input.getContext('2d'); ictx.drawImage(video,0,0,sw,sh);

      // attempt MediaPipe segmentation if available
      if (useMediaPipe && mpSegmenter){
        try{
          // defensive: different MP builds expose different APIs
          let result;
           if (typeof mpSegmenter.segment === 'function'){
             result = await mpSegmenter.segment(input);
           } else if (typeof mpSegmenter.segmentForVideo === 'function'){
             result = await mpSegmenter.segmentForVideo(video, /* timestamp */ performance.now());
           } else {
             console.warn('[ARWP] MediaPipe segment API not available on this build; falling back');
             // mark MediaPipe as unusable so we attempt DeepLab/fallbacks
             useMediaPipe = false;
             mpSegmenter = null;
             result = null;
           }
          // result might contain categoryMask or a segmentationMap; try to extract a map
          if (result && result.categoryMask){
            // draw mask to small canvas and compute boxes by thresholding alpha
            const cat = result.categoryMask; const catCanvas = makeCanvas(cat.width||sw, cat.height||sh); const cctx = catCanvas.getContext('2d'); cctx.drawImage(cat,0,0);
            const id = cctx.getImageData(0,0,catCanvas.width,catCanvas.height).data;
            // create binary map
            const segMap = new Uint8Array(catCanvas.width*catCanvas.height);
            for (let i=0;i<segMap.length;i++){ segMap[i] = id[i*4+3] > 0 ? 1 : 0; }
            // compute boxes in small scale then scale to target
            const boxesSmall = [];
            // naive bbox compute: find extents of non-zero pixels
            let minX=catCanvas.width, minY=catCanvas.height, maxX=0, maxY=0, found=false;
            for (let y=0;y<catCanvas.height;y++){
              for (let x=0;x<catCanvas.width;x++){
                const p = y*catCanvas.width + x; if (segMap[p]){ found=true; minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); }
              }
            }
            if (found) boxesSmall.push({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1});
            const boxes = boxesSmall.map(b=>({ x: Math.floor(b.x*(w/catCanvas.width)), y: Math.floor(b.y*(h/catCanvas.height)), w: Math.ceil(b.w*(w/catCanvas.width)), h: Math.ceil(b.h*(h/catCanvas.height)) }));
            // prepare mask canvas
            const maskCanvas = makeCanvas(w,h);
            softFillMask(maskCanvas, boxes, opts.softFillRadius || opts.feather || 12);
            temporalSmooth(maskCanvas, opts.smoothFactor || 0.6);
            lastMaskCanvas = maskCanvas;
            if (opts.debug) renderDebugOverlay(video, boxes, maskCanvas);
            return maskCanvas.getContext('2d').getImageData(0,0,w,h);
          }
        }catch(e){ console.warn('[ARWP] MediaPipe segmentation runtime failed, falling back to DeepLab', e); useMediaPipe=false; mpSegmenter=null; }
      }

      // Ensure DeepLab model loaded
      if (!model){
        const ok = await loadDeepLabLazy();
        if (!ok){ console.warn('[ARWP] No segmentation model available'); return null; }
      }

      // Run DeepLab segmentation
      try{
        // If we have a BodyPix fallback provider, use it instead of DeepLab
        if (!model && bodypixProvider){
          try{
            const imgData = await bodypixProvider.getMask(video, w, h);
            // convert ImageData to maskCanvas for consistency
            const maskCanvas = makeCanvas(w,h); const mctx = maskCanvas.getContext('2d'); mctx.putImageData(imgData,0,0);
            lastMaskCanvas = maskCanvas;
            if (opts.debug) renderDebugOverlay(video, [], maskCanvas);
            return imgData;
          }catch(e){ console.warn('[ARWP] BodyPix provider error', e); }
        }
        const segResult = await model.segment(input);
        // segResult.segmentationMap is Uint8Array length sw*sh
        const segMap = segResult.segmentationMap;
        // compute boxes on small size then scale
        const fgSet = FOREGROUND_SET(opts.foregroundClasses || DEFAULTS.foregroundClasses);
        const boxesSmall = computeBoxesFromSegMap(segMap, sw, sh, fgSet);
        const boxes = boxesSmall.map(b=>({ x: Math.floor(b.x*(w/sw)), y: Math.floor(b.y*(h/sh)), w: Math.ceil(b.w*(w/sw)), h: Math.ceil(b.h*(h/sh)) }));

        const maskCanvas = makeCanvas(w,h);
        softFillMask(maskCanvas, boxes, opts.softFillRadius || opts.feather || 12);
        temporalSmooth(maskCanvas, opts.smoothFactor || 0.6);
        lastMaskCanvas = maskCanvas;
        if (opts.debug) renderDebugOverlay(video, boxes, maskCanvas, segResult.legend);
        return maskCanvas.getContext('2d').getImageData(0,0,w,h);
      }catch(e){ console.warn('[ARWP] DeepLab segmentation error', e); return null; }
    }

    function renderDebugOverlay(video, boxes, maskCanvas, legend){
      try{
        if (!opts.debug) return;
        if (!debugCanvas) showDebugCanvas();
        const vw = debugCanvas.width, vh = debugCanvas.height; debugCtx.clearRect(0,0,vw,vh);
        // draw video frame small
        debugCtx.globalAlpha=0.6; debugCtx.drawImage(video,0,0,vw,vh); debugCtx.globalAlpha=1;
        // draw boxes
        debugCtx.strokeStyle='lime'; debugCtx.lineWidth=2; debugCtx.font='12px sans-serif'; debugCtx.fillStyle='lime';
        boxes.forEach((b,i)=>{ const bx = Math.floor(b.x * (vw/maskCanvas.width)); const by = Math.floor(b.y * (vh/maskCanvas.height)); const bw = Math.ceil(b.w * (vw/maskCanvas.width)); const bh = Math.ceil(b.h * (vh/maskCanvas.height)); debugCtx.strokeRect(bx,by,bw,bh); debugCtx.fillText((legend && legend[b.label])?legend[b.label]:`Box ${i+1}`, bx+4, by+12); });
        // draw mask preview
        debugCtx.drawImage(maskCanvas, vw-160, 8, 150, 112);
      }catch(e){ console.warn('[ARWP] debug render error', e); }
    }

    function dispose(){ disposed = true; model = null; deeplabLib = null; tf = null; mpSegmenter = null; prevMaskImageData = null; lastMaskCanvas = null; if (debugCanvas && debugCanvas.parentElement) debugCanvas.parentElement.removeChild(debugCanvas); if (debugRoot && debugRoot.parentElement) debugRoot.parentElement.removeChild(debugRoot); }

    return { init, setOptions, dispose };
  })();
})();

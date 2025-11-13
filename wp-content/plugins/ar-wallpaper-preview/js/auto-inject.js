(function(){
  // Auto-inject the "Preview in My Room" button when not present.
  // ARWP_Data is localized by PHP and contains: { isProduct: boolean, bgUrl: string }
  function createButton(bgUrl){
    var wrapper = document.createElement('div');
    wrapper.className = 'arwp-product-preview';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arwp-open-btn button';
    btn.textContent = 'Preview in My Room';
    if (bgUrl) btn.setAttribute('data-bg', bgUrl);
    // if localized ARWP_Data contains a compositor script url, add it as a default attr
    try{ if (!btn.getAttribute('data-compositor-script') && window.ARWP_Data && window.ARWP_Data.compositorScript){ btn.setAttribute('data-compositor-script', window.ARWP_Data.compositorScript); } }catch(e){}
    wrapper.appendChild(btn);
    return wrapper;
  }

  function attachToButton(btn){
    if (!btn || btn._arwp_attached) return;
    btn._arwp_attached = true;
    btn.addEventListener('click', function(){
      var bg = btn.getAttribute('data-bg') || (window.ARWP_Data && ARWP_Data.bgUrl) || '';
      var scriptUrl = btn.getAttribute('data-compositor-script') || null;
      openModalWithRoot(bg, scriptUrl);
    });
  }

  // Delegated click handler as a fallback for dynamically added elements or missed attachment
  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('.arwp-open-btn') : null;
    if (!el) return;
    // Avoid double-handling if attachToButton already wired click
    if (el._arwp_attached) return;
    try{ var bg = el.getAttribute('data-bg') || (window.ARWP_Data && ARWP_Data.bgUrl) || ''; var scriptUrl = el.getAttribute('data-compositor-script') || (window.ARWP_Data && ARWP_Data.compositorScript) || null; openModalWithRoot(bg, scriptUrl); }catch(err){ console.error('ARWP delegated click error', err); }
  }, true);

  function waitForStartRoot(timeoutMs){
    return new Promise(function(resolve){
      var start = Date.now();
      function check(){
        if (window.ARWP && typeof window.ARWP.startRoot === 'function') return resolve(window.ARWP.startRoot);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(check, 100);
      }
      check();
    });
  }

  function openModalWithRoot(bgUrl, compositorScript){
    // create overlay
    var overlay = document.createElement('div'); overlay.className = 'arwp-modal-overlay';
    var content = document.createElement('div'); content.className = 'arwp-modal-content';

    // close button
    var closeBtn = document.createElement('button'); closeBtn.className = 'arwp-modal-close'; closeBtn.type = 'button'; closeBtn.innerText = '×';
    closeBtn.setAttribute('aria-label','Close preview');
    content.appendChild(closeBtn);

    // create root markup (full screen)
    var root = document.createElement('div'); root.className = 'arwp-root';
    root.setAttribute('data-bg', bgUrl || '');
    root.style.width = '100%'; root.style.height = '100%';

    // inner markup: canvases and controls (kept minimal)
    root.innerHTML = '\n      <div class="arwp-canvas-wrap">\n        <canvas class="arwp-gl-canvas" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:8"></canvas>\n        <canvas class="arwp-wallpaper-canvas" style="display:none"></canvas>\n        <canvas class="arwp-mask-canvas" style="display:none"></canvas>\n        <canvas class="arwp-output-canvas"></canvas>\n      </div>\n      <video class="arwp-video" autoplay playsinline muted></video>\n      <div class="arwp-controls">\n        <button type="button" class="arwp-fit-wall button">Fit to Wall</button>\n        <button type="button" class="arwp-reset button">Reset</button>\n        <label style="margin-left:8px"><input type="checkbox" class="arwp-toggle-occlusion" checked> Occlusion</label>\n        <label style="margin-left:6px">Feather <input type="range" class="arwp-feather" min="0" max="8" value="3"></label>\n        <label style="margin-left:6px">Quality <select class="arwp-quality"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label>\n      </div>\n      <div class="arwp-loading">Initializing AR Wallpaper Preview…</div>\n    ';

    content.appendChild(root);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    // prevent background scroll
    document.body.classList.add('arwp-modal-open');

    // close handler
    function close(){
      try{ window.ARWP && ARWP.stopRoot && ARWP.stopRoot(root); }catch(e){}
      try{ document.body.removeChild(overlay); }catch(e){}
      document.body.classList.remove('arwp-modal-open');
      document.removeEventListener('keydown', onKey);
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
    function onKey(e){ if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    // Start AR compositor for this root with polling to ensure module is loaded
    (async function(){
      // First, quickly check if ARWP.startRoot is already available
      var starter = await waitForStartRoot(1500);
      if (starter){
        try{ starter(root); return; }catch(e){ console.error('ARWP startRoot error', e); }
      }
      // If not present and we have a compositorScript URL, try loading it as a module dynamically
      if (compositorScript){
        try{
          await new Promise(function(resolve, reject){
            var s = document.createElement('script'); s.type = 'module'; s.src = compositorScript; s.async = true;
            s.onload = function(){ resolve(); };
            s.onerror = function(){ reject(new Error('Failed to load compositor module: ' + compositorScript)); };
            document.head.appendChild(s);
          });
          // wait a bit for the module to initialize
          starter = await waitForStartRoot(3000);
          if (starter){ try{ starter(root); return; }catch(e){ console.error('ARWP startRoot after dynamic load failed', e); } }
        }catch(err){ console.error('ARWP dynamic module load failed', err); }
      }
      console.warn('ARWP compositor not available - timed out');
      var ld = overlay.querySelector('.arwp-loading'); if (ld) ld.textContent = 'ARWP script not available';
    })();
  }

  function tryInsertButton(){
    try{
      if (typeof ARWP_Data === 'undefined') ARWP_Data = { bgUrl: '' };
      if (document.querySelector('.arwp-open-btn')) return true; // already present

      var selectors = ['.summary', '.product .summary', '.woocommerce-product-gallery', '.single-product .product', '.entry-summary', '#primary', '.product_meta'];
      for (var i=0;i<selectors.length;i++){
        var el = document.querySelector(selectors[i]);
        if (el){
          let btn = createButton(ARWP_Data.bgUrl || '');
          el.appendChild(btn);
          attachToButton(btn.querySelector('.arwp-open-btn'));
          return true;
        }
      }
      // fallback: after product title
      var title = document.querySelector('.product_title') || document.querySelector('h1.product_title');
      if (title && title.parentNode){
        let btn = createButton(ARWP_Data.bgUrl || '');
        title.parentNode.insertBefore(btn, title.nextSibling);
        attachToButton(btn.querySelector('.arwp-open-btn'));
        return true;
      }
      return false;
    }catch(e){ console.error('ARWP autoinsert error', e); return false; }
  }

  function attachExistingButtons(){
    var btns = document.querySelectorAll('.arwp-open-btn');
    btns.forEach(function(b){ attachToButton(b); });
  }

  // MutationObserver to attach handlers to buttons added dynamically
  function observe(){
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function(muts){
      muts.forEach(function(m){
        m.addedNodes && m.addedNodes.forEach(function(n){
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('.arwp-open-btn')) attachToButton(n);
          var found = n.querySelector && n.querySelector('.arwp-open-btn'); if (found) attachToButton(found);
        });
      });
    });
    obs.observe(document.body, { childList:true, subtree:true });
    setTimeout(function(){ try{ obs.disconnect(); }catch(e){} }, 120000);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tryInsertButton(); attachExistingButtons(); observe(); });
  } else {
    tryInsertButton(); attachExistingButtons(); observe();
  }
})();

/* DevFit safe PWA updater.
 * Checks for new releases on open/foreground, but never reloads a client while
 * they are entering a workout, meal or progress record. A waiting update is
 * activated only after the user taps the small "Update ready" banner.
 */
(function(){
  if(!('serviceWorker' in navigator)) return;

  var waitingWorker=null;
  var userRequested=false;
  var refreshing=false;

  function banner(){
    var b=document.getElementById('pwa-update-bar');
    if(b) return b;
    b=document.createElement('button');
    b.id='pwa-update-bar';
    b.type='button';
    b.textContent='Update ready — tap to restart';
    b.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147482000;background:#2f9e57;color:#fff;border:0;border-radius:24px;padding:10px 16px;font:700 12px DM Sans,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer;display:none';
    (document.body||document.documentElement).appendChild(b);
    return b;
  }

  function offerUpdate(sw){
    if(!sw||!navigator.serviceWorker.controller) return;
    waitingWorker=sw;
    var b=banner();
    b.textContent='Update ready — tap to restart';
    b.style.display='block';
    b.classList.add('show');
    b.onclick=applyUpdate;
  }

  function applyUpdate(){
    if(!waitingWorker) return;
    userRequested=true;
    var b=banner();
    b.textContent='Updating DevFit…';
    b.style.pointerEvents='none';
    waitingWorker.postMessage({type:'SKIP_WAITING'});
  }

  window.DevFitApplyUpdate=applyUpdate;
  window.pwaApplyUpdate=applyUpdate; // compatibility with the existing home banner
  window.DevFitShowUpdate=function(reg){ if(reg&&reg.waiting) offerUpdate(reg.waiting); };

  navigator.serviceWorker.addEventListener('controllerchange',function(){
    // An older worker may activate itself, but this page is never force-reloaded.
    // Only a deliberate banner tap authorizes the restart.
    if(!userRequested||refreshing) return;
    refreshing=true;
    window.location.reload();
  });

  function init(){
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      reg.update().catch(function(){});
      if(reg.waiting) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound',function(){
        var sw=reg.installing;
        if(!sw) return;
        sw.addEventListener('statechange',function(){
          if(sw.state==='installed') offerUpdate(sw);
        });
      });
      document.addEventListener('visibilitychange',function(){
        if(!document.hidden) reg.update().catch(function(){});
      });
    }).catch(function(){});
  }

  if(document.readyState==='loading') window.addEventListener('load',init);
  else init();
})();

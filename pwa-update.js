/* DevFit auto-updater — runs on every page, no UI dependencies.
 * Guarantees an installed PWA never stays stuck on an old version:
 *  - re-checks sw.js on every open + when brought to the foreground
 *  - activates a NEWLY installed update (updatefound → skipWaiting)
 *  - ALSO activates an update that was ALREADY waiting when the page opened
 *    (installed while the app was closed) — the case that used to leave the
 *    app stale until a manual reload
 *  - reloads once when the new worker takes control, so fresh JS/CSS load
 */
(function(){
  if(!('serviceWorker' in navigator)) return;

  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if(refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Only tell a worker to skip waiting when there's already an active controller
  // — i.e. this is an UPDATE, not the very first install (first install should
  // not trigger a reload loop).
  function applyUpdate(sw){
    if(sw && navigator.serviceWorker.controller) sw.postMessage({ type: 'SKIP_WAITING' });
  }

  function init(){
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      reg.update();

      // An update finished installing while the app was closed and is parked in
      // "waiting" — activate it now instead of waiting for all tabs to close.
      if(reg.waiting) applyUpdate(reg.waiting);

      // A new update is downloading now — activate the moment it's installed.
      reg.addEventListener('updatefound', function(){
        var sw = reg.installing;
        if(!sw) return;
        sw.addEventListener('statechange', function(){
          if(sw.state === 'installed') applyUpdate(sw);
        });
      });

      // Re-check every time the app comes to the foreground.
      document.addEventListener('visibilitychange', function(){
        if(!document.hidden) reg.update();
      });
    }).catch(function(){});
  }

  if(document.readyState === 'loading'){
    window.addEventListener('load', init);
  } else {
    init();
  }
})();

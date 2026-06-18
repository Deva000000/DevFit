/* DevFit shared theme controller.
   Early-apply is done by a tiny inline <head> script on each page (no FOUC);
   this file exposes the API used by the Settings toggle and keeps tabs in sync. */
(function(){
  var KEY = 'devfit_theme';
  function get(){
    try{ return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; }
    catch(e){ return 'dark'; }
  }
  function apply(theme){
    if(theme === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
    // Keep the browser UI (status bar / address bar) in step
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', theme === 'light' ? '#f7f4f0' : '#cc0000');
  }
  function set(theme){
    theme = (theme === 'light') ? 'light' : 'dark';
    try{ localStorage.setItem(KEY, theme); }catch(e){}
    apply(theme);
    document.dispatchEvent(new CustomEvent('devfit:themechange',{detail:{theme:theme}}));
  }
  function toggle(){ set(get() === 'light' ? 'dark' : 'light'); }

  // Apply on load (covers pages that forgot the inline snippet)
  apply(get());
  // Cross-tab sync
  window.addEventListener('storage', function(e){ if(e.key === KEY) apply(get()); });

  window.DevFitTheme = { get:get, set:set, toggle:toggle, apply:apply };

  // ---------- iOS-style page-exit fade on in-app navigation ----------
  (function(){
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var APP_PAGES = /(^|\/)(index|nutrition|workouts|settings|login|pricing)\.html(\?|#|$)/i;
    document.addEventListener('click', function(e){
      if(e.defaultPrevented || e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if(!a) return;
      var href = a.getAttribute('href');
      if(!href || a.target==='_blank' || href[0]==='#' || /^(mailto:|tel:|https?:|wa\.me)/i.test(href)) return;
      if(!APP_PAGES.test(href)) return;            // only fade between our own pages
      if(a.classList.contains('active')) return;   // already here
      e.preventDefault();
      document.documentElement.classList.add('df-leaving');
      setTimeout(function(){ window.location.href = href; }, 150);
    }, true);
    // If restored from bfcache (back/forward), clear the leaving state
    window.addEventListener('pageshow', function(){ document.documentElement.classList.remove('df-leaving'); });
  })();
})();

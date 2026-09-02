/* DevFit — resilient jsPDF dependency loader.
   PDF export is a paid core feature, so it must not depend on one CDN being
   reachable on every phone. Try two pinned, integrity-checked copies and let
   export buttons wait for the result instead of failing during page startup. */
(function (global) {
  'use strict';

  var INTEGRITY = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
  var URLS = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ];
  var inFlight = null;

  function constructor() {
    return global.jspdf && global.jspdf.jsPDF || null;
  }

  function setState(value) {
    try { document.documentElement.setAttribute('data-devfit-pdf', value); } catch (_) {}
  }

  function loadScript(url) {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      var settled = false;
      var timer = setTimeout(function () { finish(false); }, 6000);

      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (!ok) { try { script.remove(); } catch (_) {} }
        resolve(Boolean(ok && constructor()));
      }

      script.src = url;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.integrity = INTEGRITY;
      script.referrerPolicy = 'no-referrer';
      script.onload = function () { finish(Boolean(constructor())); };
      script.onerror = function () { finish(false); };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function load() {
    if (constructor()) { setState('ready'); return Promise.resolve(true); }
    if (inFlight) return inFlight;
    setState('loading');
    inFlight = (async function () {
      for (var i = 0; i < URLS.length; i++) {
        if (await loadScript(URLS[i])) { setState('ready'); return true; }
      }
      setState('failed');
      return false;
    })().finally(function () { inFlight = null; });
    return inFlight;
  }

  global.DevFitPDF = {
    load: load,
    get: async function () { return await load() ? constructor() : null; }
  };

  // Start early; an export tap can await the same promise on a slow connection.
  load();
})(window);

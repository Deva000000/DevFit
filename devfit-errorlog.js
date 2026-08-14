/* DevFit — client error reporter.
 * Catches uncaught errors + unhandled promise rejections and posts a compact
 * report to /api/log so production failures are visible (the app has many
 * try/catch blocks that would otherwise swallow them silently).
 *
 * Safe by design: never throws, never blocks the page, caps how much it sends
 * (dedupes identical errors, hard limit per page load) so a crash loop can't
 * spam the network. Load this FIRST on every page so it's armed before app code
 * runs. Uses fetch keepalive so a report still flushes during navigation/unload.
 */
(function () {
  var sent = 0, MAX = 8, seen = Object.create(null);

  function post(payload) {
    try {
      if (sent >= MAX) return;
      var key = (payload.message || '') + '|' + (payload.src || '') + '|' + (payload.line || '');
      if (seen[key]) return;
      seen[key] = 1; sent++;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/log', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body, keepalive: true
        }).catch(function () {});
      }
    } catch (e) { /* logging must never break the app */ }
  }

  function ctx() {
    return {
      page: (location && location.pathname) || '',
      ua: (navigator && navigator.userAgent || '').slice(0, 200)
    };
  }

  window.DevFitErrors = {
    report: function (type, message, extra) {
      var c = ctx(), x = extra || {};
      post({
        type: String(type || 'error').slice(0, 20),
        message: String(message || 'Unknown error').slice(0, 500),
        stack: String(x.stack || '').slice(0, 1500),
        src: String(x.src || '').slice(0, 200),
        page: c.page, ua: c.ua
      });
    }
  };

  window.addEventListener('error', function (e) {
    if (!e || !e.message) return; // ignore bare resource-load errors
    var c = ctx();
    post({
      type: 'error',
      message: String(e.message || '').slice(0, 500),
      src: String(e.filename || '').slice(0, 200),
      line: e.lineno || 0,
      stack: String((e.error && e.error.stack) || '').slice(0, 1500),
      page: c.page, ua: c.ua
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var c = ctx();
    post({
      type: 'promise',
      message: String((r && r.message) || r || 'unhandledrejection').slice(0, 500),
      stack: String((r && r.stack) || '').slice(0, 1500),
      page: c.page, ua: c.ua
    });
  });
})();

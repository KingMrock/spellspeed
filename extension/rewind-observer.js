/* DBETTER, GPL-3.0-only. MAIN world, document_start: response observation only. */
(() => {
  'use strict';
  if (!/^\/replay(?:\.php)?\/?$/.test(location.pathname) || window.DBETTERReplayCapture) return;
  let pending = null, receiver = null;
  const deliver = text => {
    if (receiver) { try { receiver(text); } catch {} }
    else pending = text;
  };
  window.DBETTERReplayCapture = Object.freeze({subscribe(fn) {
    receiver = fn;
    if (pending !== null) { const text = pending; pending = null; deliver(text); }
  }});
  const open = XMLHttpRequest.prototype.open;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (...args) {
    // Only identify the endpoint. Never inspect send(), headers, or the token.
    let replay = false;
    try { const url = new URL(args[1], location.href); replay = url.origin === location.origin && url.pathname === '/view-replay'; } catch {}
    if (!requests.has(this)) {
      this.addEventListener('load', () => {
        if (!requests.get(this)) return;
        try { if (!this.responseType || this.responseType === 'text') deliver(this.responseText); } catch {}
      });
    }
    requests.set(this, replay);
    return Reflect.apply(open, this, args);
  };
})();

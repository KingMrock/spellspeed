/* DBETTER, GPL-3.0-only. Touch controls for phones and tablets.
 * DuelingBook and DBETTER are driven by mouse events. A finger is translated
 * into the same events a mouse would produce, so every existing feature (drag
 * and drop, card menus, hover previews, double-click actions) works unchanged:
 *   tap = hover + click, double tap = double-click, hold = right-click,
 *   drag = mouse drag. Inside scrolling lists a quick swipe scrolls instead;
 *   hold briefly before moving to drag a card out of one.
 * Form fields and jQuery UI widgets (which DuelingBook's touch-punch already
 * drives) are left to the browser.
 */
(() => {
  'use strict';
  if (window.__dbetterTouch) return;
  window.__dbetterTouch = true;
  const rules = window.DBLiteRules;
  let config = rules.settings(JSON.parse(document.currentScript?.dataset.settings || '{}'));
  const tapSlop = 10, holdDelay = 500, dragHold = 150, doubleDelay = 320, doubleSlop = 28;
  const nativeSelector = 'input,textarea,select,option,label,[contenteditable="true"],iframe,.ui-draggable,.ui-sortable,.ui-slider,.ui-resizable-handle,.ui-selectable,.dbetter-touch-native,.dbetter-tour,#dblite-timeline';
  // Phones get the fitted viewport and full-screen button. DuelingBook itself sets
  // window.mobile from the user agent; a coarse primary pointer covers tablets.
  const phone = () => window.mobile === true || !!window.matchMedia?.('(pointer: coarse)').matches;
  let session = null, hovered = null, lastTap = null, guardUntil = 0;

  const at = (x, y, fallback) => document.elementFromPoint?.(x, y) || fallback;
  const touchOf = (list, id) => [...(list || [])].find(t => t.identifier === id);
  function mouse(type, target, x, y, extra = {}) {
    if (!target?.dispatchEvent) return true;
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 0, detail: 1, ...extra });
    // Lets a handler choose a touch-friendly variant, such as the summon position wheel.
    event.dbetterTouch = true;
    return target.dispatchEvent(event);
  }
  // Duel cards and piles: a double tap opens DBETTER's action menu or pile viewer, as a
  // right-click would. When DBETTER has nothing to show (selecting targets, the
  // opponent's cards, observers) it stays an ordinary double-click.
  const menuTarget = node => node?.closest?.('#duel .card,.dblite-fan-card,#deck_hidden,#extra_hidden,#grave_hidden,#banished_hidden');
  // Small buttons (user, 2026-10-28): on a phone DuelingBook's buttons are 2 to 4 mm tall. A tap that lands on
  // nothing that reacts (the page beside a button) goes to the nearest button within SNAP px (about 3 mm here).
  // During a duel only DBETTER's own Solo, timeline and corner buttons are candidates: a stray tap near a phase,
  // life points or OK / Thinking must never become a game action.
  const SNAP = 16;
  const clickable = 'button,a[href],input[type=submit],input[type=button],[role="button"],.card_menu_btn,.dblite-card-ref';
  const duelSafe = '.dblite-solo-session button,.dblite-solo-same-native,#dblite-timeline button,.dbetter-touch-bar button,.dblite-chat-wheel-button,.dblite-find-card';
  const handles = node => { const events = window.jQuery?._data?.(node, 'events'); return !!(node.onclick || events && (events.click || events.mousedown || events.mouseup)); };
  function reacts(node) {
    for (let n = node; n && n !== document.body && n !== document.documentElement; n = n.parentElement)
      if (n.matches?.(clickable) || handles(n) || menuTarget(n)) return true;
    return false;
  }
  function snapTap(target, x, y) {
    if (!target || reacts(target) || target.closest?.('.dblite-fan,#view,.dblite-menu,.dblite-panel')) return null;
    const duel = /^duel/.test(window.currentLabel || '') && document.getElementById('duel')?.offsetParent;
    let best = null, distance = SNAP;
    for (const node of document.querySelectorAll(duel ? duelSafe : clickable)) {
      if (node.disabled) continue;
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const dx = Math.max(box.left - x, 0, x - box.right), dy = Math.max(box.top - y, 0, y - box.bottom), d = Math.hypot(dx, dy);
      if (d >= distance) continue;
      // The nearest point of the button, kept 2 px inside it, must show that button (not something over it).
      const px = Math.min(box.right - 2, Math.max(box.left + 2, x)), py = Math.min(box.bottom - 2, Math.max(box.top + 2, y));
      const top = document.elementFromPoint(px, py);
      if (top !== node && !node.contains(top) && !(top && window.jQuery?.(node).data?.('proxy')?.[0] === top)) continue;
      best = { node, x: px, y: py }; distance = d;
    }
    return best;
  }
  function rightClick(target, x, y) {
    mouse('mousedown', target, x, y, { button: 2, buttons: 2 });
    mouse('mouseup', target, x, y, { button: 2 });
    return !mouse('contextmenu', target, x, y, { button: 2 });
  }
  const chain = node => { const out = []; for (let n = node; n?.nodeType === 1; n = n.parentNode) out.push(n); return out; };
  // Move the virtual pointer onto target, with the over/out/enter/leave order of a real mouse.
  function hover(target, x, y, buttons = 0) {
    const extra = { buttons, detail: 0 };
    const old = hovered?.isConnected ? hovered : null;
    if (target !== old) {
      const before = chain(old), after = chain(target);
      if (old) {
        mouse('mouseout', old, x, y, { ...extra, relatedTarget: target });
        for (const node of before) if (!after.includes(node)) node.dispatchEvent(new MouseEvent('mouseleave', { clientX: x, clientY: y, view: window, relatedTarget: target, ...extra }));
      }
      if (target) {
        mouse('mouseover', target, x, y, { ...extra, relatedTarget: old });
        for (const node of after.reverse()) if (!before.includes(node)) node.dispatchEvent(new MouseEvent('mouseenter', { clientX: x, clientY: y, view: window, relatedTarget: old, ...extra }));
      }
      hovered = target;
    }
    mouse('mousemove', target, x, y, extra);
  }
  function scroller(node) {
    for (let n = node; n?.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const style = getComputedStyle(n);
      if ((/auto|scroll/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 1) ||
          (/auto|scroll/.test(style.overflowX) && n.scrollWidth > n.clientWidth + 1)) return n;
    }
    return null;
  }
  function canPan(node, dx, dy) {
    return Math.abs(dy) >= Math.abs(dx) ? node.scrollHeight > node.clientHeight + 1 : node.scrollWidth > node.clientWidth + 1;
  }

  function start(event) {
    if (!config.touchControls) return;
    if (event.touches.length > 1 || session) { cancel(); return; }
    const t = event.changedTouches[0];
    // The browser's own events focus fields and drive widgets, so they must not be swallowed.
    if (!t || event.target.closest?.(nativeSelector)) { guardUntil = 0; return; }
    event.preventDefault();
    // A prevented touch never moves focus. Leave a text field the way a click elsewhere would,
    // which also closes the on-screen keyboard.
    const active = document.activeElement;
    if (active?.matches?.('input,textarea,[contenteditable="true"]') && !active.contains(event.target)) active.blur();
    session = { id: t.identifier, x: t.clientX, y: t.clientY, time: Date.now(), target: event.target, mode: 'pending', scroller: scroller(event.target) };
    session.timer = setTimeout(hold, holdDelay);
    guardUntil = Infinity;
  }
  const signalButton = node => node?.closest?.('#good_btn,#think_btn');
  function signalHold(kind) { document.dispatchEvent(new CustomEvent('dbetter-signal', { detail: { kind, long: true } })); }
  function hold() {
    const s = session;
    if (!s || s.mode !== 'pending') return;
    s.mode = 'done';
    const signal = signalButton(s.target);
    if (signal) { signalHold(signal.id === 'good_btn' ? 'ok' : 'think'); navigator.vibrate?.(12); return; }
    hover(s.target, s.x, s.y);
    rightClick(s.target, s.x, s.y);
    navigator.vibrate?.(12);
  }
  function move(event) {
    const s = session, t = s && touchOf(event.changedTouches, s.id);
    if (!t) return;
    event.preventDefault();
    const x = t.clientX, y = t.clientY;
    if (s.mode === 'pending') {
      if (Math.hypot(x - s.x, y - s.y) < tapSlop) return;
      clearTimeout(s.timer);
      const dx = x - s.x, dy = y - s.y, card = s.target.closest?.('.dblite-fan-card');
      // A card in the Fan/Grid viewer: a sideways move drags it at once; only a mostly
      // vertical move scrolls the viewer. Elsewhere a quick move scrolls, a held one drags.
      const wantsPan = card ? Math.abs(dy) > Math.abs(dx) * 1.4 : Date.now() - s.time < dragHold;
      if (s.scroller && wantsPan && canPan(s.scroller, dx, dy)) {
        Object.assign(s, { mode: 'pan', lastX: s.x, lastY: s.y, viewer: card?.closest('.dblite-fan') || null });
      } else startDrag(s);
    }
    if (s.mode === 'pan') {
      // Scrolling a card out past the viewer's edge picks the card up instead.
      const box = s.viewer?.getBoundingClientRect();
      if (box && (x < box.left || x > box.right || y < box.top || y > box.bottom)) { startDrag(s); mouse('mousemove', at(x, y, s.target), x, y, { buttons: 1 }); return; }
      s.scroller.scrollLeft -= x - s.lastX; s.scroller.scrollTop -= y - s.lastY;
      s.lastX = x; s.lastY = y;
    } else if (s.mode === 'drag') mouse('mousemove', at(x, y, s.target), x, y, { buttons: 1 });
  }
  // While dragging only moves are sent: hover (over/out) events made DuelingBook preview every card
  // under the finger and blank the preview over the Deck (seen as flashes).
  function startDrag(s) {
    s.mode = 'drag';
    mouse('mousedown', s.target, s.x, s.y, { buttons: 1 });
  }
  function end(event) {
    const s = session, t = s && touchOf(event.changedTouches, s.id);
    if (!t) return;
    event.preventDefault();
    clearTimeout(s.timer); session = null;
    // Swallow the browser's own compatibility mouse events for this touch.
    guardUntil = Date.now() + 600;
    const x = t.clientX, y = t.clientY;
    if (s.mode === 'drag') {
      // No mousemove first: a buttonless move ends a DBETTER drag before the drop.
      const target = at(x, y, s.target);
      mouse('mouseup', target, x, y);
      if (target === s.target) mouse('click', target, x, y);
      lastTap = null;
      return;
    }
    if (s.mode !== 'pending') return;
    const snapped = snapTap(s.target, s.x, s.y);
    if (snapped) Object.assign(s, { target: snapped.node, x: snapped.x, y: snapped.y });
    const double = lastTap && s.time - lastTap.time < doubleDelay && Math.hypot(s.x - lastTap.x, s.y - lastTap.y) < doubleSlop;
    // A double tap on a duel card or pile opens its action menu or viewer (the first tap
    // has already clicked and previewed it). Without a DBETTER menu it stays a double-click.
    const viewerOpen = document.querySelector('.dblite-fan,.dblite-classic-switch');
    if (double && viewerOpen && !s.target.closest?.('.dblite-fan,.dblite-classic-switch,#view,.dblite-menu,.dblite-panel,.dblite-view-settings,.dbetter-touch-bar,.dblite-ring')) {
      lastTap = null; hover(s.target, s.x, s.y);
      if (rightClick(s.target, s.x, s.y)) return;
    }
    if (double && config.touchTapMenu && menuTarget(s.target)) {
      hover(s.target, s.x, s.y);
      lastTap = null;
      if (rightClick(s.target, s.x, s.y)) return;
    }
    const detail = double ? 2 : 1;
    hover(s.target, s.x, s.y);
    mouse('mousedown', s.target, s.x, s.y, { buttons: 1, detail });
    mouse('mouseup', s.target, s.x, s.y, { detail });
    mouse('click', s.target, s.x, s.y, { detail });
    if (double) mouse('dblclick', s.target, s.x, s.y, { detail });
    lastTap = double ? null : { time: s.time, x: s.x, y: s.y };
  }
  // A second finger, an interrupted touch or a disabled setting abandons the gesture.
  function cancel() {
    const s = session;
    session = null;
    if (!s) return;
    clearTimeout(s.timer);
    guardUntil = Date.now() + 600;
    // A buttonless move is how a drag learns the button was released elsewhere.
    if (s.mode === 'drag') mouse('mousemove', hovered || s.target, s.x, s.y, { detail: 0 });
  }
  const options = { capture: true, passive: false };
  window.addEventListener('touchstart', start, options);
  window.addEventListener('touchmove', move, options);
  window.addEventListener('touchend', end, options);
  window.addEventListener('touchcancel', cancel, options);
  for (const type of ['mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'click', 'dblclick', 'contextmenu']) {
    window.addEventListener(type, event => {
      if (!event.isTrusted || Date.now() >= guardUntil) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
  }
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });

  // Phone screen: fit the page to the device width so the adaptive layout scales the
  // 1024x640 stage to the screen. DuelingBook's mobile mode asks for height=640 instead.
  const fitted = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
  let viewportMeta = null, nativeViewport = null, bar = null, notice = null;
  function fitViewport(active) {
    const meta = document.querySelector('meta[name="viewport"]');
    if (active) {
      if (meta && meta.content === fitted) return;
      if (!meta || meta !== viewportMeta) nativeViewport = meta ? meta.content : null;
      viewportMeta = meta || Object.assign(document.createElement('meta'), { name: 'viewport' });
      if (!viewportMeta.isConnected) (document.head || document.documentElement).append(viewportMeta);
      viewportMeta.content = fitted;
    } else if (viewportMeta) {
      if (nativeViewport === null) viewportMeta.remove(); else viewportMeta.content = nativeViewport;
      viewportMeta = null; nativeViewport = null;
    }
  }
  const fullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFullscreen() {
    if (fullscreen()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
    const root = document.documentElement, request = root.requestFullscreen || root.webkitRequestFullscreen;
    Promise.resolve(request?.call(root, { navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  function button(text, label, action = toggleFullscreen) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'dbetter-touch-native'; node.textContent = text; node.setAttribute('aria-label', label);
    node.addEventListener('click', action);
    return node;
  }
  // DBETTER's floating Find card button is sized for a mouse; on a phone it covers the
  // watchers box. The corner bar, outside the board, carries a small one instead.
  const duelFind = () => document.querySelector('.dblite-duel-tools .dblite-find-card');
  const duelChat = () => document.querySelector('.dblite-chat-row .dblite-chat-wheel-button');
  let fullscreenButton = null, findButton = null, chatButton = null, okButton = null, thinkButton = null, signalRow = null, toolRow = null;
  // Big OK / Thinking buttons: a tap sends OK / Thinking, a hold sends Keep going / Big think.
  function signalCorner(text, label, kind) {
    const node = button(text, label, () => {});
    node.classList.add('dbetter-signal-corner'); node.dataset.kind = kind;
    let timer = null, held = false;
    const clear = () => { clearTimeout(timer); timer = null; node.classList.toggle('dbetter-holding', false); };
    node.addEventListener('pointerdown', () => { held = false; clear(); node.classList.toggle('dbetter-holding', true); timer = setTimeout(() => { held = true; clear(); signalHold(kind); navigator.vibrate?.(12); }, holdDelay); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, clear);
    node.addEventListener('click', event => { event.preventDefault(); if (held) { held = false; return; } document.dispatchEvent(new CustomEvent('dbetter-signal', { detail: { kind, long: false } })); });
    node.addEventListener('contextmenu', event => event.preventDefault());
    return node;
  }
  const shown = node => { const native = document.getElementById(node.dataset.kind === 'ok' ? 'good_btn' : 'think_btn'); return !!native && native.getClientRects().length > 0 && getComputedStyle(native).visibility !== 'hidden'; };
  const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
  function phoneUi(active) {
    const portrait = innerHeight > innerWidth;
    if (active && !bar) {
      bar = document.createElement('div'); bar.className = 'dbetter-touch-bar';
      fullscreenButton = button('⛶', 'Full screen');
      findButton = button('⌕', 'Find a card', () => duelFind()?.click());
      chatButton = button('💬', 'Quick chat', () => duelChat()?.click()); chatButton.classList.add('dbetter-chat-corner');
      thinkButton = signalCorner('🤔', 'Thinking (hold: big think)', 'think'); okButton = signalCorner('👍', 'OK (hold: keep going)', 'ok');
      // OK / Thinking / chat: a column on the right, under the player profiles (phone duels).
      signalRow = document.createElement('div'); signalRow.className = 'dbetter-touch-bar dbetter-signal-bar'; signalRow.append(thinkButton, okButton, chatButton);
      toolRow = document.createElement('div'); toolRow.className = 'dbetter-touch-row'; toolRow.append(fullscreenButton, findButton);
      bar.append(toolRow); document.body?.append(bar, signalRow);
    }
    // DuelingBook's #draw_btn reads "View Replay" in Solo and finished duels (and "Offer Draw" in a duel).
    // On a phone the replay is not worth the space; Offer Draw stays.
    const draw = document.getElementById('draw_btn');
    draw?.classList.toggle('dbetter-phone-hidden', !!active && draw.value === 'View Replay');
    if (bar) {
      // Written only on change (this runs twice a second).
      setHidden(fullscreenButton, fullscreen()); setHidden(findButton, !duelFind());
      setHidden(chatButton, true); // Quick chat lives beside the chat input on touch too.
      setHidden(okButton, !shown(okButton)); setHidden(thinkButton, !shown(thinkButton));
      setHidden(signalRow, !active || portrait || okButton.hidden && thinkButton.hidden && chatButton.hidden);
      // Under your profile, in the column right of the action histories.
      const profile = document.getElementById('avatar1'), box = profile?.getClientRects().length ? profile.getBoundingClientRect() : null;
      if (box && !signalRow.hidden) {
        const left = Math.round(Math.min(box.left, innerWidth - 58)) + 'px', top = Math.round(box.bottom + 10) + 'px', width = Math.round(Math.max(box.width, 52)) + 'px';
        if (signalRow.style.left !== left) signalRow.style.left = left;
        if (signalRow.style.top !== top) signalRow.style.top = top;
        if (signalRow.style.width !== width) signalRow.style.width = width;
      }
      setHidden(bar, !active || portrait || [fullscreenButton, findButton].every(node => node.hidden) && !bar.querySelector('.dbetter-app-settings'));
    }
    if (active && portrait && !notice?.dismissed) {
      if (!notice) {
        notice = document.createElement('div'); notice.className = 'dbetter-rotate'; notice.setAttribute('role', 'status');
        const text = document.createElement('span'); text.textContent = 'Turn your phone sideways: the duel board is landscape.';
        const close = document.createElement('button'); close.type = 'button'; close.className = 'dbetter-touch-native'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss');
        close.addEventListener('click', () => { notice.dismissed = true; notice.hidden = true; });
        notice.append(text, button('Full screen', 'Full screen, landscape'), close);
        document.body?.append(notice);
      }
      notice.hidden = false;
    } else if (notice) notice.hidden = true;
  }
  const style = document.createElement('style');
  style.textContent = `
    html.dbetter-touch,html.dbetter-touch body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
    html.dbetter-touch :is(input,textarea,[contenteditable="true"]){-webkit-user-select:text;user-select:text;touch-action:manipulation}
    /* DuelingBook's two green-line planes: 3072 x 1920 images under a 7.1x perspective transform. Redrawing them
       took the phone's frame time, and cards showed black for a frame or two (user, 2026-10-29). On the phone,
       hiding them took black flashes in a replay at 1x from 11 to 3 per 14 s; they only showed at the screen's edges. */
    html.dbetter-touch :is(#greenlines1,#greenlines2){display:none!important}
    .dbetter-touch-bar{position:fixed;left:max(6px,env(safe-area-inset-left));bottom:max(6px,env(safe-area-inset-bottom));z-index:2147483640;display:flex;flex-direction:row;align-items:flex-end;gap:8px}
    .dbetter-touch-row{display:flex;gap:8px}
    .dbetter-touch-bar button{width:42px;height:42px;padding:0;border:1px solid #73998d;border-radius:10px;background:#1d352ecc;color:#ecfaf4;font:21px/40px system-ui,sans-serif}
    html.dblite-in-constructor .dbetter-touch-bar:not(.dbetter-signal-bar){top:max(6px,env(safe-area-inset-top));bottom:auto}
    html.dblite-in-constructor .dbetter-touch-bar:not(.dbetter-signal-bar) button{width:34px;height:34px;font-size:18px;line-height:32px}
    /* In the deck constructor the board starts after the camera cut-out's margin: the corner bar sits in that margin,
       not over the card preview (Android app, 2026-10-28). */
    html.dblite-in-constructor.dbetter-cutout-left .dbetter-touch-bar:not(.dbetter-signal-bar){left:max(2px,calc(env(safe-area-inset-left) - 44px))}
    html.dblite-in-constructor.dbetter-cutout-right .dbetter-touch-bar:not(.dbetter-signal-bar){left:auto;right:max(2px,calc(env(safe-area-inset-right) - 44px))}
    .dbetter-touch-bar.dbetter-signal-bar{left:auto;bottom:auto;flex-direction:column;align-items:center;gap:10px}
    .dbetter-signal-bar button{width:52px;height:52px;border-radius:14px;font-size:26px;line-height:50px}
    .dbetter-touch-bar .dbetter-signal-corner{background:#21402fe6}
    .dbetter-touch-bar .dbetter-signal-corner.dbetter-holding{background:#3d7058;border-color:#c4f4dc;transition:background .5s}
    html.dbetter-phone #duel :is(#good_btn,#think_btn){clip-path:inset(50%)!important}
    html.dbetter-phone .dblite-view-modes button[aria-pressed="false"]{display:none}
    html.dbetter-phone .dblite-view-modes button[aria-pressed="true"]::after{content:" ▸";opacity:.7}
    html.dbetter-phone .dblite-fan-header{flex-wrap:nowrap;width:max-content;max-width:none;gap:calc(4px / var(--dblite-fan-scale,1));padding:calc(3px / var(--dblite-fan-scale,1)) calc(6px / var(--dblite-fan-scale,1));margin-bottom:calc(4px / var(--dblite-fan-scale,1));border-radius:calc(9px / var(--dblite-fan-scale,1))}
    html.dbetter-phone .dblite-fan-header :is(button,input){min-width:calc(30px / var(--dblite-fan-scale,1));height:calc(28px / var(--dblite-fan-scale,1));min-height:0;padding:0 calc(7px / var(--dblite-fan-scale,1));font-size:calc(13px / var(--dblite-fan-scale,1));line-height:1;border-radius:calc(7px / var(--dblite-fan-scale,1))}
    html.dbetter-phone .dblite-fan-header input{flex:none;width:calc(64px / var(--dblite-fan-scale,1))}
    html.dbetter-phone .dblite-fan-header>strong{display:none}
    html.dbetter-phone .dblite-search-result{font-size:11px;padding:4px}html.dbetter-phone .dblite-search-result:has(.dblite-search-art){grid-template-columns:28px 1fr}html.dbetter-phone .dblite-search-art{width:28px;height:28px}
    html.dbetter-phone .dblite-fan-header :is(strong,.dblite-count){font-size:calc(12px / var(--dblite-fan-scale,1))}
    html.dbetter-phone .dblite-fan-header .dblite-move,html.dbetter-phone .dblite-fan footer{display:none!important}
    .dbetter-rotate{position:fixed;left:8px;right:8px;top:8px;z-index:2147483641;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #73998d;border-radius:10px;background:#1d352ef2;color:#ecfaf4;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 4px 18px #0007}
    .dbetter-rotate span{flex:1}
    .dbetter-rotate button{min-height:36px;padding:0 12px;border:1px solid #96d8bb;border-radius:8px;background:#29483d;color:inherit;font:inherit}
    .dbetter-rotate button[aria-label="Dismiss"]{min-width:36px;padding:0;font-size:20px}
    .dbetter-touch-bar [hidden],[hidden].dbetter-touch-bar,[hidden].dbetter-rotate{display:none!important}
    html.dbetter-phone body>.dblite-duel-tools,html.dbetter-phone #dblite-replay,.dbetter-phone-hidden{display:none!important}
    html.dbetter-phone #deck_constructor .dblite-builder-pager>button{width:44px;height:30px;padding:0;font-size:26px;line-height:26px;border-radius:6px}
    html.dbetter-phone #deck_constructor .dblite-builder-pager{height:32px;font-size:12px}
    html.dbetter-phone #deck_constructor .dblite-builder-pager>label{width:78px}
    html.dbetter-phone #deck_constructor .dblite-builder-search{padding:8px;font-size:12px;line-height:1.35}
    html.dbetter-phone #deck_constructor .dblite-builder-search h2{font-size:15px;line-height:20px}
    html.dbetter-phone #deck_constructor .dblite-builder-heading{height:26px;gap:6px}
    html.dbetter-phone #deck_constructor .dblite-builder-heading>label{width:96px}
    html.dbetter-phone #deck_constructor .dblite-builder-search :is(input:not([type=checkbox]),select,button,summary){font-size:12.5px!important;min-height:24px;border-radius:5px}
    html.dbetter-phone #deck_constructor .dblite-builder-search :is(.dblite-builder-heading,.dblite-builder-pager) :is(select,option,button){font-size:11.5px!important;height:24px;min-height:24px}
    html.dbetter-phone #deck_constructor .dblite-search-text{grid-template-columns:minmax(0,1fr) 84px;gap:6px}
    html.dbetter-phone #deck_constructor .dblite-builder-search input[type=checkbox]{width:15px;height:15px;min-height:15px}
    html.dbetter-phone #deck_constructor :is(.dblite-builder-fields,.dblite-builder-search .dblite-lab){height:190px;padding-right:4px}
    html.dbetter-phone #deck_constructor .dblite-builder-fields{padding-bottom:12px;-webkit-mask-image:linear-gradient(#000 calc(100% - 16px),#0000);mask-image:linear-gradient(#000 calc(100% - 16px),#0000)}
    html.dbetter-phone #deck_constructor .dblite-builder-search .dblite-filter-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}
    html.dbetter-phone #deck_constructor .dblite-builder-search .dblite-options{gap:4px 8px;max-height:160px}
    html.dbetter-phone #deck_constructor .dblite-builder-actions{gap:8px}
    html.dbetter-phone #deck_constructor .dblite-builder-actions>button{flex:1;min-height:28px}
    html.dbetter-phone #deck_constructor .dblite-deck-control{font-size:15px!important;line-height:calc(var(--dblite-control-height,18px) - 2px)!important}
    html.dbetter-phone #deck_constructor .combobox.dblite-deck-control>span{line-height:calc(var(--dblite-control-height,18px) - 2px)!important}
    html.dbetter-phone #deck_constructor .dblite-solo-launch{height:34px}
    html.dbetter-phone #deck_constructor .dblite-solo-launch button{height:34px;font-size:15px;line-height:32px}
    html.dbetter-phone #deck_constructor .dblite-solo-launch>button:first-child{width:auto;flex:1}
    html.dbetter-phone #deck_constructor .dblite-solo-launch .dblite-solo-gear{width:40px}
    html.dbetter-phone #deck_constructor .dblite-solo-launch .dblite-solo-gear{font-size:18px}
    html.dbetter-phone #deck_constructor .dblite-solo-launch .dblite-overview-button{display:none}`;
  (document.head || document.documentElement).append(style);

  // Which side has the camera cut-out's margin, if either is wide enough for the corner bar (landscape).
  let insetProbe = null;
  function markCutout() {
    if (!document.body) return;
    if (!insetProbe) { insetProbe = document.createElement('div'); insetProbe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:0 env(safe-area-inset-right) 0 env(safe-area-inset-left)'; }
    if (!insetProbe.isConnected) document.body.append(insetProbe);
    const css = getComputedStyle(insetProbe), left = parseFloat(css.paddingLeft) || 0, right = parseFloat(css.paddingRight) || 0;
    const html = document.documentElement, wantLeft = left >= 40, wantRight = !wantLeft && right >= 40;
    if (html.classList.contains('dbetter-cutout-left') !== wantLeft) html.classList.toggle('dbetter-cutout-left', wantLeft);
    if (html.classList.contains('dbetter-cutout-right') !== wantRight) html.classList.toggle('dbetter-cutout-right', wantRight);
  }
  function apply() {
    const touch = config.touchControls, phoneFit = touch && config.touchLayout && phone();
    document.documentElement.classList.toggle('dbetter-touch', touch && phone());
    document.documentElement.classList.toggle('dbetter-phone', phoneFit);
    if (!touch) cancel();
    fitViewport(phoneFit);
    phoneUi(phoneFit); markCutout();
  }
  // DuelingBook rewrites its viewport tag while starting up in mobile mode.
  const viewportObserver = new MutationObserver(() => { if (!window.DBETTERRebuilding && window.document && config.touchControls && config.touchLayout && phone()) fitViewport(true); });
  viewportObserver.observe(document.head || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
  window.addEventListener('dbetter-rebuild-begin', () => viewportObserver.disconnect());
  window.addEventListener('dbetter-rebuild-end', () => { viewportObserver.observe(document.head || document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['content']}); apply(); });
  setInterval(() => { if (!window.DBETTERRebuilding && (bar || document.querySelector('.dbetter-phone-hidden'))) phoneUi(config.touchControls && config.touchLayout && phone()); }, 500);
  window.addEventListener('resize', () => { phoneUi(config.touchControls && config.touchLayout && phone()); markCutout(); });
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, () => phoneUi(config.touchControls && config.touchLayout && phone()));
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_SETTINGS') return;
    config = rules.settings(event.data.settings || {});
    apply();
  });
  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true });
  window.DBETTERTouch = { active: () => !!session, phone };
})();

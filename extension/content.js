/* DBETTER, GPL-3.0-only. See NOTICE.txt for Overflow references.
 * Site adapters checked against DuelingBook's public client v932, 2026-10-14.
 */
(() => {
  'use strict';
  if (window.__duelingBookLite) return;
  window.__duelingBookLite = true;
  const rules = window.DBLiteRules;
  let config = rules.settings(JSON.parse(document.currentScript?.dataset.settings || '{}'));
  // Replaces the user's Auto-Focus Blocker userscript: DuelingBook's own focus()
  // calls on text boxes are ignored so shortcut keys keep reaching the page, while
  // DBETTER's calls (scripts served from this extension's origin) still focus.
  const extensionOrigin = new URL(document.currentScript?.src || location.href).origin;
  for (const proto of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype]) {
    const original = proto.focus;
    if (original.dbliteFocusBlock) continue;
    const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
      // Only the direct caller counts: DBETTER often invokes native code that then focuses chat.
      if (config.blockAutoFocus && extensionOrigin !== location.origin && !((new Error().stack || '').split('\n')[2] || '').includes(extensionOrigin + '/')) return;
      // An older blocker userscript may have replaced the input method; use the element method.
      return HTMLElement.prototype.focus.apply(this, args);
    };
    wrapped.dbliteFocusBlock = true; wrapped.dbliteOriginal = original; proto.focus = wrapped;
  }
  const sounds = window.DBLiteSounds?.create(() => ({ ...config, sounds: config.sounds && config.refinedSounds }));
  let speedOwner = null, oldSpeed = null, speedApplied = false;
  const motionSpeed = 1.6, motionHooks = new Map();
  let summonContext = null;
  const moveSummonEffects = new Set();
  let chanceView = null;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const smoothEase = progress => (1 - Math.cos(Math.PI * progress)) / 2;
  const stillEase = progress => progress < 1 ? 0 : 1;
  let gesture = null, pendingAttach = null, attachTimer = null, suppressClickUntil = 0;
  let cardLink = null, previewHook = null, animationStyle = null, statusTimer;
  const wrappers = new Map();
  let workbench = null, duelTools = null, lagMonitor = null;
  let dragEffect = null;
  let hoveredNode = null, raisedHand = null;
  const handCards = new Set(), heldKeys = new Map();
  const holdDelay = 550;
  const $ = (...args) => window.jQuery(...args);
  const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const same = (a, b) => !!a && !!b && a[0] === b[0];
  const includes = (arr, card) => Array.isArray(arr) && arr.some(item => same(item, card));
  const directPiles = { main_arr: 'Deck', grave_arr: 'Graveyard', banished_arr: 'Banished', extra_arr: 'Extra Deck' };
  const hoverPiles = [
    ['deck_hidden', 'main_arr', 'Deck'], ['extra_hidden', 'extra_arr', 'Extra Deck'],
    ['grave_hidden', 'grave_arr', 'Graveyard'], ['banished_hidden', 'banished_arr', 'Banished']
  ];
  const pileCards = new Map();
  let hoveredPile = null;
  let rpsAttempt = null;
  let rpsReceiptHook = null, introSkipped = false;
  const startupHooks = new Map(), failedImages = new WeakMap();
  let volumeControl, volumeSlider, volumeDragging = false, volumePosted = -Infinity;
  // CSS pixels already account for browser zoom. Keep the native stage and
  // contentScale in agreement; all docking coordinates remain stage-local.
  const { layoutPlan, clampFloating } = rules;
  let layoutFrame = null, clampFrame = null, layoutStyle, layoutSignature = '', layoutWasActive = false;
  const clampedStyles = new Map();
  const layoutHooks = new Map();
  function scheduleLayout() {
    if (window.DBETTERRebuilding) return;
    if (layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = null; if (window.document) adaptiveLayout(true); });
  }
  function adaptiveLayout(force = false) {
    if (window.DBETTERRebuilding) return;
    for (const name of ['resizeE', 'mainResizeE', 'resizeComponents', 'requestResize', 'goto']) {
      const original = window[name];
      if (typeof original !== 'function' || rules.hasHook(original, layoutHooks.get(name))) continue;
      const hook = function (...args) { if (window.DBETTERRebuilding) return original.apply(this, args); const result = original.apply(this, args); scheduleLayout(); return result; };
      rules.markHook(hook, original); layoutHooks.set(name, hook); window[name] = hook;
    }
    const stage = document.getElementById('content');
    if (!config.adaptiveLayout || !stage) {
      if (layoutStyle) layoutStyle.textContent = '';
      for (const [node, styles] of clampedStyles) if (node.isConnected) Object.assign(node.style, styles);
      clampedStyles.clear();
      document.documentElement.classList.toggle('dblite-adaptive', false);
      window.DBLiteLayout = null;
      if (layoutWasActive) { layoutWasActive = false; layoutSignature = ''; window.resizeE?.(); }
      return;
    }
    const duel = /^duel/.test(window.currentLabel || ''), signature = [innerWidth, innerHeight, window.currentLabel, config.adaptiveDock, config.adaptiveConstructor, config.hideZoomNotice, config.boardSize, window.zooming, document.documentElement.classList.contains('dbetter-phone')].join(':');
    if (!force && signature === layoutSignature) return;
    layoutSignature = signature; layoutWasActive = true;
    // Phones: keep the stage clear of rounded screen corners and camera cut-outs.
    const inset = phoneInset();
    const plan = layoutPlan(innerWidth - inset.left - inset.right, innerHeight - inset.top - inset.bottom, config.adaptiveDock, duel, config.boardSize), { scale, band, wide } = plan;
    const x = plan.x + inset.left, y = plan.y + inset.top;
    if (band) { band.left += inset.left; band.top += inset.top; }
    // The wider constructor search extends right of the stage by about x; centre both.
    // On a phone the stage moves to the left edge and the search takes all the spare width.
    const wideSearch = config.adaptiveConstructor && window.currentLabel === 'deck_constructor';
    const phoneSearch = wideSearch && document.documentElement.classList.contains('dbetter-phone');
    // Phone duels: the player profiles at the right of the board get a smaller column (about 55 %),
    // and the board moves right by the space saved, leaving a wider left margin for the corner
    // buttons and Find a card.
    const phoneDuel = duel && document.documentElement.classList.contains('dbetter-phone');
    const stageX = wideSearch ? (phoneSearch ? inset.left : x / 2) : phoneDuel ? Math.max(x, innerWidth - inset.right - (1024 + PHONE_PROFILE_SPARE) * scale) : x;
    window.contentScale = scale; window.marginLeft = stageX; window.marginTop = y;
    window.DBLiteLayout = { ...plan, constructorWidth: config.adaptiveConstructor ? 216 + Math.max(0, (innerWidth - inset.left - inset.right - 1024 * scale) / ((phoneSearch ? 1 : 2) * scale)) - (phoneSearch ? 8 : 0) : 216, x, y };
    if (!layoutStyle) { layoutStyle = document.createElement('style'); document.head.append(layoutStyle); }
    let css = `html.dblite-adaptive,html.dblite-adaptive body{overflow:hidden!important}html.dblite-adaptive #content{position:absolute!important;overflow:visible!important;margin:0!important;transform-origin:0 0!important;left:${window.zooming ? stageX / scale : stageX}px!important;top:${window.zooming ? y / scale : y}px!important;transform:${window.zooming ? 'none' : `scale(${scale})`}!important;zoom:${window.zooming ? scale : 1}!important;transition:none!important}`;
    if (config.hideZoomNotice) css += '.notification:has(.zoom){display:none!important}';
    // DuelingBook's dimming backdrop (#dark) is 10240 x 6400 stage px. At phone pixel densities that
    // one layer outgrew the GPU tile memory of Android WebView, which then dropped parts of the
    // screen for a frame (dark flashes). The stage is fitted, so the window is all it has to cover.
    if (!window.zooming) css += `html.dblite-adaptive #content>#dark{left:${-stageX / scale - 4}px!important;top:${-y / scale - 4}px!important;width:${innerWidth / scale + 8}px!important;height:${innerHeight / scale + 8}px!important}`;
    if (config.adaptiveConstructor && window.currentLabel === 'deck_constructor') css += `html.dblite-adaptive #deck_constructor>.cards{overflow:visible!important}html.dblite-adaptive #deck_constructor .dblite-builder-search{width:${window.DBLiteLayout.constructorWidth + 5}px!important}`;
    if (band) {
      css += 'html.dblite-adaptive #duel,html.dblite-adaptive #duel>.preview{overflow:visible!important}';
      // Native nodes keep their parents, event handlers and proxy inputs.
      const bx = (band.left - x) / scale, by = (band.top - y) / scale, bw = band.width / scale, bh = band.height / scale;
      const box = (selector, l, t, w, h) => `html.dblite-adaptive #duel ${selector}{left:${l}px!important;top:${t}px!important;width:${w}px!important;max-width:${w}px!important;height:${h}px!important;max-height:${h}px!important;translate:none!important;box-sizing:border-box!important}`;
      const col = wide ? bw : bw / 3, chatX = wide ? bx : bx + col * 2, chatY = wide ? by + bh * .57 : by;
      const chatH = wide ? bh * .43 : bh;
      css += box('>.cout_txt', chatX, chatY, col - 6, Math.max(30, chatH - 30));
      css += box(':is(.cin_txt,.cin_txt+.textinput)', chatX, chatY + chatH - 26, col - 6, 22);
      css += box('.dblite-action-history[data-player="2"]', wide ? bx + bw * .48 : bx + col, by, wide ? bw * .52 : col - 6, (wide ? bh * .56 : bh) / 2 - 3);
      css += box('.dblite-action-history[data-player="1"]', wide ? bx + bw * .48 : bx + col, by + (wide ? bh * .56 : bh) / 2, wide ? bw * .52 : col - 6, (wide ? bh * .56 : bh) / 2 - 3);
      const previewWidth = wide ? bw * .46 : col - 6, previewHeight = wide ? bh * .31 : bh * .65;
      const previewScale = Math.min(previewWidth / 813, previewHeight / 1185);
      css += `html.dblite-adaptive #duel #preview{left:${bx}px!important;top:${by}px!important;width:813px!important;height:1185px!important;transform:scale(${previewScale})!important;transform-origin:top left!important}`;
      css += `html.dblite-adaptive #chats>#duel_log{left:${chatX}px!important;top:${chatY}px!important;width:${col - 6}px!important;height:${chatH}px!important;max-width:${col - 6}px!important;max-height:${chatH}px!important}`;
      css += box('#preview_txt', bx, by + (wide ? bh * .32 : bh * .67), wide ? bw * .46 : col - 6, wide ? bh * .23 : bh * .32);
    }
    layoutStyle.textContent = css;
    requestAnimationFrame(volumeUI);
    document.documentElement.classList.toggle('dblite-adaptive', true);
    if (scrollX || scrollY) scrollTo(0, 0);
    window.DBETTERConstructor?.resize?.();
    duelTools?.placeChat();
    clampControls();
  }
  let safeProbe = null;
  const PHONE_PROFILE_SPARE = 96; // stage px kept right of the board for the phone profile column (about 52 CSS px)
  function phoneInset() {
    if (!document.documentElement.classList.contains('dbetter-phone')) return { left: 0, right: 0, top: 0, bottom: 0 };
    if (!safeProbe) {
      safeProbe = document.createElement('div');
      safeProbe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    }
    if (!safeProbe.isConnected) document.body.append(safeProbe);
    const style = getComputedStyle(safeProbe), px = value => parseFloat(value) || 0, app = document.documentElement.classList.contains('dbetter-app');
    return { left: Math.max(app ? 6 : 18, px(style.paddingLeft)), right: Math.max(app ? 6 : 18, px(style.paddingRight)),
      // The bottom strip is Android's swipe-up (home / leave full screen) gesture zone: a drag
      // that starts on a hand card there could leave full screen instead.
      top: Math.max(app ? 2 : 8, px(style.paddingTop)), bottom: Math.max(app ? 4 : 28, px(style.paddingBottom)) };
  }
  function clampControls() {
    if (window.DBETTERRebuilding) return;
    if (!config.adaptiveLayout || !window.document) return;
    // Read all bounds before writing. Fixed overlays live outside #content.
    const nodes = [...document.querySelectorAll('#dblite-vfx-volume,#dblite-replay-rate,.dblite-fan,.dblite-menu,.dblite-panel,.dblite-view-settings,.dblite-card-search,.dblite-solo-settings,.dblite-deck-wheel')].filter(node => visible(node) && !node.closest('#content'));
    const bounds = nodes.map(node => ({ node, rect: clampFloating(node.getBoundingClientRect()) }));
    for (const [node] of clampedStyles) if (!node.isConnected) clampedStyles.delete(node);
    for (const { node, rect } of bounds) {
      if (!clampedStyles.has(node)) clampedStyles.set(node, Object.fromEntries(['left','top','right','bottom','maxWidth','maxHeight','overflow','transform'].map(key => [key, node.style[key]])));
      if (node.classList.contains('dblite-batch-panel')) node.style.transform = 'none';
      Object.assign(node.style, { left: rect.left + 'px', top: rect.top + 'px', right: 'auto', bottom: 'auto', maxWidth: node.classList.contains('dblite-fan') ? node.style.maxWidth : innerWidth - 16 + 'px', maxHeight: node.classList.contains('dblite-fan') ? node.style.maxHeight : innerHeight - 16 + 'px', overflow: node.classList.contains('dblite-fan') ? node.style.overflow : 'auto' });
    }
  }
  function scheduleClamp() {
    if (window.DBETTERRebuilding) return;
    if (clampFrame !== null || !window.document) return;
    clampFrame = requestAnimationFrame(() => { clampFrame = null; clampControls(); });
  }
  window.addEventListener('resize', scheduleLayout);
  // overflow:hidden still allows focus and resize to scroll the page; the
  // fitted stage must stay at the window origin.
  // Without the adaptive layout too: DuelingBook's consent script sets `overflow: unset !important` on <html>,
  // and its scenery layers are over 10,000 px wide, so focusing a field slid the deck constructor off the
  // left edge (user's window, 2026-10-28). The body hides overflow: a sideways scroll is never the player's.
  window.addEventListener('scroll', () => {
    if (config.adaptiveLayout && document.documentElement.classList.contains('dblite-adaptive') && (scrollX || scrollY)) scrollTo(0, 0);
    else if (scrollX && document.body && getComputedStyle(document.body).overflowX === 'hidden') scrollTo(0, scrollY);
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleLayout);
  const floatingObserver = new MutationObserver(records => { if (window.document && config.adaptiveLayout && records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches('[class*="dblite-"],[id^="dblite-"]') || n.querySelector('[class*="dblite-"],[id^="dblite-"]'))))) scheduleClamp(); });
  floatingObserver.observe(document.body, { childList: true, subtree: true });
  function scoutSpacing() {
    const scout = document.querySelector('replay-scout'), root = scout?.shadowRoot;
    if (!root || !visible(scout)) return;
    // Also support older Scout builds and vertically centered duel boards.
    const rect = scout.getBoundingClientRect(), sound = volumeControl && visible(volumeControl) ? volumeControl.getBoundingClientRect() : null;
    const reserve = Math.max(60, sound && rect.right > sound.left && rect.left < sound.right ? innerHeight - sound.top + 8 : 0);
    if (!root.querySelector('#dblite-scout-spacing')) {
      const style = document.createElement('style'); style.id = 'dblite-scout-spacing';
      style.textContent = '.panel{max-height:calc(100dvh - var(--dblite-scout-reserve,60px) - 8px)!important}'; root.append(style);
    }
    const clearance = Math.round(reserve * 100) / 100 + 'px';
    if (scout.style.getPropertyValue('--dblite-scout-reserve') !== clearance) scout.style.setProperty('--dblite-scout-reserve', clearance);
    const previous = Number(scout.style.getPropertyValue('--dblite-scout-lift')) || 0;
    const gap = innerHeight - rect.bottom - previous;
    const lift = String(Math.round(Math.max(0, reserve - gap) * 100) / 100);
    if (lift !== scout.style.getPropertyValue('--dblite-scout-lift')) scout.style.setProperty('--dblite-scout-lift', lift);
  }
  function volumeUI() {
    const mute = document.getElementById('mute_btn');
    if (!config.sounds || !config.volumeControl || !visible(mute)) { if (volumeControl) volumeControl.hidden = true; return; }
    if (!volumeControl) {
      volumeControl = document.createElement('label'); volumeControl.id = 'dblite-vfx-volume'; volumeControl.textContent = 'VFX';
      volumeSlider = document.createElement('input'); volumeSlider.type = 'range'; volumeSlider.min = '0'; volumeSlider.max = '100'; volumeSlider.step = '1';
      volumeSlider.setAttribute('aria-label', 'VFX volume'); volumeControl.append(volumeSlider); document.body.append(volumeControl);
      const postVolume = () => { volumePosted = Date.now(); window.postMessage({ type: 'DBLITE_VOLUME', volume: config.vfxVolume }, location.origin); };
      volumeSlider.addEventListener('pointerdown', () => { volumeDragging = true; });
      volumeSlider.addEventListener('change', () => { config.vfxVolume = Number(volumeSlider.value); postVolume(); volumeDragging = false; });
      volumeSlider.addEventListener('pointercancel', () => { volumeDragging = false; });
      document.addEventListener('pointerup', () => { volumeDragging = false; });
      window.addEventListener('blur', () => { volumeDragging = false; });
      volumeSlider.addEventListener('input', () => {
        config.vfxVolume = Number(volumeSlider.value); volumeSlider.title = 'VFX volume: ' + config.vfxVolume + '%';
        if (Date.now() - volumePosted >= 250) postVolume();
      });
    }
    const rect = mute.getBoundingClientRect(); volumeControl.hidden = false;
    if (!volumeDragging) volumeSlider.value = String(config.vfxVolume); volumeSlider.title = 'VFX volume: ' + config.vfxVolume + '%';
    let left = Math.max(8, Math.min(innerWidth - 132, rect.right + 8)), top = Math.max(8, Math.min(innerHeight - 32, rect.top + rect.height / 2 - 12));
    // Clamping at the window edge can push the slider over the hand; go above the mute button then.
    const overlaps = node => { const r = node.getBoundingClientRect(); return r.width && left < r.right && left + 124 > r.left && top < r.bottom && top + 24 > r.top; };
    if ([...document.querySelectorAll('#duel .card.dblite-hand-card')].some(overlaps)) { left = Math.max(8, Math.min(innerWidth - 132, rect.right - 124)); top = Math.max(8, rect.top - 30); }
    Object.assign(volumeControl.style, { left: left + 'px', top: top + 'px' });
  }
  function skipSiteIntro() {
    if (!config.skipIntro || introSkipped || typeof window.skipIntro !== 'function' ||
        !visible(document.getElementById('skip_intro_btn'))) return;
    introSkipped = true; window.skipIntro();
  }
  // Already logged in (user, 2026-10-28): after a network change, a reload or a closed app, DuelingBook's duel server
  // keeps the old connection until it times out (a minute or more) and refuses a new one: "Already logged into duel
  // server elsewhere!". DBETTER presses DUEL again every 10 seconds, for up to two minutes, which is what the player
  // would do by hand. "Close it and connect" ends the old connection at once, the way DuelingBook's own reconnect
  // reaches it: a Reconnect with the login the page already holds (as DuelingBook's client sends after a dropped
  // connection), then a clean close, then DUEL. It also ends a session that is really open elsewhere (another
  // device), so it is the player's choice, never automatic. Stop ends it all.
  const LOGIN_MESSAGE = 'Already logged into duel server elsewhere!', LOGIN_EVERY = 10000, LOGIN_ATTEMPTS = 12;
  let loginHook = null, loginRetry = null;
  function hookLoginError() {
    const original = window.errorE;
    if (typeof original !== 'function' || rules.hasHook(original, loginHook)) return;
    loginHook = function (message, ...rest) {
      if (window.DBETTERRebuilding || message !== LOGIN_MESSAGE || !config.retryLogin || typeof window.performStart !== 'function') {
        stopLoginRetry(); return original.call(this, message, ...rest);
      }
      loginRetry ||= { attempt: 0, timer: null, panel: null, state: 'waiting' };
      if (loginRetry.attempt >= LOGIN_ATTEMPTS) {
        stopLoginRetry();
        return original.call(this, `${message} If DuelingBook is open on another device or tab, close it there, then press DUEL.`, ...rest);
      }
      loginRetry.attempt++; loginRetry.state = 'waiting'; loginRetry.at = Date.now() + LOGIN_EVERY;
      clearTimeout(loginRetry.timer); loginRetry.timer = setTimeout(retryLogin, LOGIN_EVERY);
      showLoginRetry();
    };
    rules.markHook(loginHook, original); window.errorE = loginHook;
  }
  function retryLogin() {
    if (!loginRetry) return;
    clearTimeout(loginRetry.timer); loginRetry.timer = null;
    // The player went somewhere else meanwhile (logged out, opened a replay) or turned the retry off: leave it.
    if (!config.retryLogin || window.currentLabel !== 'front_page' || typeof window.performStart !== 'function') { stopLoginRetry(); return; }
    loginRetry.state = 'connecting'; showLoginRetry();
    try { window.performStart({ currentTarget: null }); } catch (error) { console.warn('Spellspeed login retry:', error); stopLoginRetry(); }
  }
  // DuelingBook's own globals: the duel server and the login it holds for its own reconnect (DuelingBook's reconnectE
  // only resumes a connection this page already had, so it cannot end the old one from the front page). Read only when
  // Close it and connect is pressed, kept in this call, sent only to DuelingBook's duel server (wss:// on
  // duelingbook.com); never stored or logged. Any other HOSTNAME: nothing is sent, the normal retry runs.
  const duelLogin = () => {
    try {
      const host = typeof HOSTNAME === 'string' && rules.duelServer(HOSTNAME);
      return host && typeof username === 'string' && typeof password === 'string' && username && password ? { host, username, password } : null;
    } catch { return null; }
  };
  function closeOldConnection() {
    const login = duelLogin(), job = loginRetry;
    if (!job || job.state === 'closing') return;
    if (!login || typeof WebSocket !== 'function') { retryLogin(); return; }
    clearTimeout(job.timer); job.timer = null; job.state = 'closing'; showLoginRetry();
    let socket, done = false, guard;
    const finish = () => {
      if (done) return; done = true; clearTimeout(guard); job.cancel = null;
      try { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(1000); } catch {}
      // The server has let go of the old connection: connect as usual.
      if (loginRetry === job) setTimeout(retryLogin, 500);
    };
    // Stop while the socket is still opening closes it before anything is sent (release review, 2026-10-29: the
    // Reconnect still went out and could end the session on the player's other device).
    job.cancel = finish;
    guard = setTimeout(finish, 8000);
    try { socket = new WebSocket(login.host); } catch { finish(); return; }
    socket.onopen = () => { if (loginRetry === job && !done) socket.send(JSON.stringify({ action: 'Reconnect', username: login.username, password: login.password })); else finish(); };
    socket.onmessage = event => { let data; try { data = JSON.parse(event.data); } catch { return; } if (data?.action) finish(); };
    socket.onerror = socket.onclose = finish;
  }
  function stopLoginRetry() {
    if (!loginRetry) return;
    const job = loginRetry; loginRetry = null;
    clearTimeout(job.timer); job.panel?.remove(); job.cancel?.();
  }
  function showLoginRetry() {
    let panel = loginRetry.panel;
    if (!panel) {
      panel = loginRetry.panel = document.createElement('section'); panel.className = 'dblite-login-retry'; panel.setAttribute('role', 'status');
      const title = document.createElement('strong'); title.textContent = 'Your last connection is still open';
      const text = document.createElement('p');
      const button = (text, action, cls = '') => { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.className = cls; node.addEventListener('click', action); return node; };
      const close = button('Close it and connect', closeOldConnection, 'dblite-login-close'), stop = button('Stop', stopLoginRetry);
      const row = document.createElement('div'); row.append(close, stop);
      panel.append(title, text, row); document.body.append(panel);
    }
    const seconds = Math.max(0, Math.ceil((loginRetry.at - Date.now()) / 1000)), state = loginRetry.state;
    panel.querySelector('p').textContent = state === 'closing' ? 'Closing the old connection…' : state === 'connecting' ? 'Connecting…' :
      `DuelingBook's duel server still holds your previous connection (it lets go a minute or so after a network change, a reload or a closed app). Close it now, or wait: trying again in ${seconds} s (attempt ${loginRetry.attempt} of ${LOGIN_ATTEMPTS}). Closing it also disconnects DuelingBook if it is really open on another device.`;
    panel.querySelector('.dblite-login-close').disabled = state === 'closing';
  }
  // Connected (or gone elsewhere): the retry is over.
  function watchLoginRetry() {
    if (!loginRetry) return;
    // Retry turned off in the settings during the countdown, unless the player already pressed Close it and connect.
    if (!config.retryLogin && loginRetry.state !== 'closing') { stopLoginRetry(); return; }
    if (!['front_page', 'connecting'].includes(window.currentLabel)) { stopLoginRetry(); return; }
    if (loginRetry.timer) showLoginRetry();
  }
  // DuelingBook's dead ends ask for a page refresh and offer no button (user, 2026-10-29: "Timed out due to inactivity"
  // left the Android app stuck; a browser has F5, the app has nothing). Reconnect reloads the page and presses DUEL
  // once the front page shows the account again; kicked or rejected only reload.
  const DEAD_ENDS = { timed_out: 'Timed out due to inactivity', lost_conn2: 'Lost connection', closed: 'The server has closed',
    rejected: 'Rejected by the server', kicked: 'Kicked from the server' };
  const RECONNECT_KEY = 'dbetter-reconnect', RECONNECT_FOR = 60000;
  let deadEnd = null;
  function watchDeadEnd() {
    const label = window.currentLabel, reason = Object.hasOwn(DEAD_ENDS, label) ? DEAD_ENDS[label] : null;
    if (!reason) { deadEnd?.remove(); deadEnd = null; resumeReconnect(); return; }
    if (deadEnd?.isConnected && deadEnd.dataset.label === label) return;
    deadEnd?.remove();
    const again = !['kicked', 'rejected'].includes(label);
    deadEnd = document.createElement('section'); deadEnd.className = 'dblite-login-retry dblite-dead-end'; deadEnd.dataset.label = label; deadEnd.setAttribute('role', 'alert');
    const title = document.createElement('strong'); title.textContent = reason;
    const text = document.createElement('p'); text.textContent = again ? 'Reconnect reloads the page and connects again.' : 'Reload goes back to the front page.';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'dblite-login-close'; button.textContent = again ? 'Reconnect' : 'Reload';
    button.addEventListener('click', () => { if (again) try { sessionStorage.setItem(RECONNECT_KEY, String(Date.now())); } catch {} location.reload(); });
    const row = document.createElement('div'); row.append(button);
    deadEnd.append(title, text, row); document.body.append(deadEnd);
  }
  // After Reconnect's reload: DUEL once the front page shows the signed-in account, within a minute.
  function resumeReconnect() {
    let at = 0; try { at = Number(sessionStorage.getItem(RECONNECT_KEY)) || 0; } catch {}
    if (!at) return;
    const clear = () => { try { sessionStorage.removeItem(RECONNECT_KEY); } catch {} };
    if (Date.now() - at > RECONNECT_FOR) { clear(); return; }
    const account = document.querySelector('#logged_in .username_txt');
    if (window.currentLabel !== 'front_page' || typeof window.performStart !== 'function' || !visible(account) || !account.textContent.trim()) return;
    clear();
    try { window.performStart({ currentTarget: null }); } catch (error) { console.warn('Spellspeed reconnect:', error); }
  }
  // DuelingBook keeps a card's hover menu open in its own pile viewer ("Viewing Deck"): its menuOutE and menuRollOutE
  // return early for cards in #view (user, 2026-10-29: the menu stayed over the cards after the pointer left). It closes
  // once the pointer is more than MENU_SLACK px outside both the card and the menu, so the way into the menu stays open.
  // Live, the cards sit in the scroll pane's .os_viewport inside .content (2026-10-29: a parent check never matched).
  const MENU_SLACK = 6;
  document.addEventListener('mousemove', event => {
    const card = window.menu_card?.[0], menu = window.menu?.[0];
    if (!card || !menu?.isConnected || !document.querySelector('#view > .content')?.contains(card) || typeof window.removeCardMenu !== 'function') return;
    const near = node => { const r = node.getBoundingClientRect(); return event.clientX >= r.left - MENU_SLACK && event.clientX <= r.right + MENU_SLACK && event.clientY >= r.top - MENU_SLACK && event.clientY <= r.bottom + MENU_SLACK; };
    // The card's face (.content) is drawn offset from the .card box itself (live, 2026-11-04: box 804–920 × 287–455,
    // face 746–862 × 203–371), so the left and top of the face closed the menu just after it opened.
    if (near(card) || [...card.querySelectorAll(':scope > .content')].some(near) || near(menu)) return;
    try { window.removeCardMenu('spellspeed-viewer-leave'); } catch (error) { console.warn('Spellspeed viewer menu:', error); }
  }, { capture: true, passive: true });
  // Restacks without re-inserting (spectating on a phone, 2026-10-28: closing a pile viewer flashed every card).
  // Closing a viewer runs DuelingBook's exitViewing, whose shiftDecks re-appends every Deck, Extra Deck, GY and
  // banished card of both players to the field, in order, even when nothing moved: about 120 cards re-inserted at
  // once. During a restack the appends to each container are collected, and only the cards not already in the place
  // DuelingBook asks for are moved (the cards coming back from the viewer, say); the final order is DuelingBook's.
  let restacking = false;
  function hookRestack() {
    if (!window.jQuery) return;
    for (const name of ['shiftDecks', 'shiftDeck', 'shiftExtra', 'shiftGrave', 'shiftBanished']) {
      const original = window[name];
      if (typeof original !== 'function' || original.dbliteRestack) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding || restacking) return original.apply(this, args);
        return restack(() => original.apply(this, args));
      };
      rules.markHook(wrapped, original); wrapped.dbliteRestack = true; window[name] = wrapped;
    }
  }
  function restack(run) {
    const $ = window.jQuery, append = $.fn.append, moves = new Map();
    restacking = true;
    $.fn.append = function (...args) {
      const parent = this.length === 1 ? this[0] : null, item = args.length === 1 ? args[0] : null;
      const nodes = item?.jquery ? item.toArray() : item?.nodeType === 1 ? [item] : null;
      if (!parent || !nodes?.length || nodes.some(node => node?.nodeType !== 1)) return append.apply(this, args);
      if (!moves.has(parent)) moves.set(parent, []);
      const list = moves.get(parent);
      for (const node of nodes) { const at = list.indexOf(node); if (at >= 0) list.splice(at, 1); list.push(node); }
      return this;
    };
    try { return run(); }
    finally {
      $.fn.append = append; restacking = false;
      for (const [parent, list] of moves) {
        // DuelingBook's order: the other children as they are, then the appended ones in sequence.
        const listed = new Set(list), desired = [...[...parent.children].filter(node => !listed.has(node)), ...list];
        // Fewest moves: the longest run of children already in DuelingBook's relative order stays; the rest move.
        const rank = new Map(desired.map((node, i) => [node, i])), current = [...parent.children].filter(node => rank.has(node)).map(node => rank.get(node));
        const tails = [], back = new Array(current.length), ends = [];
        current.forEach((value, i) => {
          let lo = 0, hi = tails.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (current[tails[mid]] < value) lo = mid + 1; else hi = mid; }
          back[i] = lo ? tails[lo - 1] : -1; tails[lo] = i;
        });
        for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = back[i]) ends.push(current[i]);
        const stay = new Set(ends.map(i => desired[i]));
        for (let i = desired.length - 1; i >= 0; i--) if (!stay.has(desired[i])) parent.insertBefore(desired[i], desired[i + 1] || null);
      }
    }
  }
  function retryImage(img) {
    if (!(img instanceof HTMLImageElement) || !img.isConnected || !img.src) return;
    let url; try { url = new URL(img.src, location.href); } catch { return; }
    if (url.protocol !== 'https:' || !['www.duelingbook.com','duelingbook.com','images.duelingbook.com','static.duelingbook.com'].includes(url.hostname) || !/\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname)) return;
    const source = img.src, key = new URL(url); key.searchParams.delete('dbetter_retry');
    let state = failedImages.get(img);
    if (!state || state.key !== key.href) { state = { key: key.href, attempts: 0, pending: false }; failedImages.set(img, state); }
    if (state.pending || state.attempts >= 3) return;
    state.pending = true; const attempt = ++state.attempts;
    setTimeout(() => {
      if (!img.isConnected || img.src !== source || img.naturalWidth > 0) { state.pending = false; return; }
      // Never assign an untested URL to the displayed artwork. Failed detached
      // requests consume the same three-attempt budget without blanking it.
      const candidate = new Image(); let finished = false;
      const finish = ok => {
        if (finished) return; finished = true; clearTimeout(timeout);
        candidate.onload = candidate.onerror = null; state.pending = false;
        if (!img.isConnected || img.src !== source || failedImages.get(img) !== state) return;
        if (ok) img.src = candidate.src;
        else retryImage(img);
      };
      const timeout = setTimeout(() => finish(false), 5000);
      candidate.onload = () => rules.imageReady(candidate).then(finish);
      candidate.onerror = () => finish(false);
      url.searchParams.set('dbetter_retry', String(attempt)); candidate.src = url.href;
    }, 700 * 2 ** (attempt - 1));
  }
  document.addEventListener('error', e => retryImage(e.target), true);
  // An extension can arrive after native image errors. Revisit existing failed
  // artwork too; per-element/source budgets prevent retry loops.
  function recoverImages() {
    for (const img of document.querySelectorAll('#duel img,#rps_start img,#tp_start img')) if (img.complete && img.naturalWidth === 0) retryImage(img);
  }
  function replayNextGame() {
    const duel = document.getElementById('duel');
    let button = document.getElementById('dblite-next-game');
    if (!window.replay || !duel || !visible(duel)) { if (button) button.hidden = true; return; }
    if (!button) {
      button = document.createElement('button'); button.id = 'dblite-next-game'; button.type = 'button'; button.textContent = 'Next game →';
      // With Spellspeed's replay timeline on, the timeline moves there (rewind-ui.js, nextGame).
      button.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); if (!button.disabled && !window.DBETTERRewind?.nextGame?.()) window.nextGameE?.(); replayNextGame(); });
    }
    const parent = document.getElementById('avatar1')?.parentElement || document.getElementById('content') || duel;
    if (button.parentElement !== parent) parent.append(button);
    const chat = duel.querySelector('.cout_txt'), board = document.getElementById('content') || parent;
    if (chat && visible(chat)) {
      const box = chat.getBoundingClientRect(), root = board.getBoundingClientRect(), scale = root.width / 1024 || 1;
      Object.assign(button.style, { top: ((box.bottom - root.top) / scale + 3) + 'px', width: (box.width / scale) + 'px' });
    }
    button.hidden = false;
    button.disabled = typeof window.nextGameE !== 'function' || !(window.replay_arr || []).some(e => ['Siding', 'Begin next duel', 'Back to RPS'].includes(e.play));
  }
  function startupRecovery() {
    volumeUI();
    replayNextGame();
    for (const name of ['pickFirstResponse', 'duelStart', 'simultaneousDraw']) {
      const original = window[name]; if (typeof original !== 'function' || rules.hasHook(original, startupHooks.get(name))) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        const engine = window.TweenMax, methods = [], context = { duel: window.duelId, player: window.player1, other: window.player2 };
        if (!engine || window.replay || window.resetting) return original.apply(this, args);
        for (const method of ['to', 'fromTo']) {
          const before = engine[method]; if (typeof before !== 'function') continue;
          const hook = function (...params) {
            const at = method === 'fromTo' ? 3 : 2;
            if (name === 'simultaneousDraw') { params[1] = Math.min(Number(params[1]) || .18, .18); return before.apply(this, params); }
            const vars = params[at];
            if (typeof vars?.onComplete !== 'function') return before.apply(this, params);
            const complete = vars.onComplete; let settled = false, handle, tween;
            const valid = () => window.duelId === context.duel && window.player1 === context.player && window.player2 === context.other &&
              window.duel_active && !window.resetting && (name === 'pickFirstResponse' ? /^tp_start/.test(window.currentLabel || '') : /^duel_start/.test(window.currentLabel || ''));
            const once = function (...values) { if (settled) return; settled = true; clearTimeout(handle); if (valid()) return complete.apply(this, values); };
            params[at] = { ...vars, onComplete: once }; tween = before.apply(this, params);
            // Recover only an interrupted opening transition, never replay or
            // card draws. The saved native callback owns the initial draw queue.
            const check = () => {
              if (settled || !valid()) return;
              if (document.hidden || window.paused || tween?.isActive?.()) { handle = setTimeout(check, 1000); return; }
              if (name === 'duelStart' && ((context.player?.hand_arr?.length || 0) + (context.other?.hand_arr?.length || 0) > 0 || window.actionsQueue?.length)) return;
              once.apply(vars.onCompleteScope || vars.callbackScope || tween, vars.onCompleteParams || []);
            };
            if (!settled) handle = setTimeout(check, Math.max(600, (Number(params[1]) + (Number(vars.delay) || 0)) * 1000 + 250));
            return tween;
          };
          methods.push({ method, before, hook }); engine[method] = hook;
        }
        try { return original.apply(this, args); }
        finally { for (const { method, before, hook } of methods) if (engine[method] === hook) engine[method] = before; }
      };
      rules.markHook(wrapped, original); startupHooks.set(name, wrapped); window[name] = wrapped;
    }
    const original = window.determineWinner;
    if (typeof original === 'function' && !rules.hasHook(original, rpsReceiptHook)) {
      rpsReceiptHook = function (data, ...args) {
        // A whole tie animation may complete between polling ticks. Arm the
        // next round on the receipt itself; native controls still gate sending.
        rpsAttempt = null;
        return original.call(this, data, ...args);
      };
      rules.markHook(rpsReceiptHook, original); window.determineWinner = rpsReceiptHook;
    }
  }
  const roomLabelSizes = new WeakMap();
  const roomLabelContents = new WeakMap();
  let roomObserved = null, roomFrame = null;
  const dirtyRoomRows = new Set();
  const collectRoomChanges = records => {
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const row = node?.closest(".duelbutton"); if (row) dirtyRoomRows.add(row);
      for (const added of record.addedNodes) if (added.nodeType === 1) { if (added.matches(".duelbutton")) dirtyRoomRows.add(added); for (const row of added.querySelectorAll(".duelbutton")) dirtyRoomRows.add(row); }
    }
    if (!window.document || !roomObserved?.isConnected || !dirtyRoomRows.size || roomFrame !== null) return;
    roomFrame = requestAnimationFrame(() => {
      roomFrame = null;
      if (!window.document || !roomObserved?.isConnected) return;
      roomObserver.disconnect();
      const rows = [...dirtyRoomRows].filter(row => row.isConnected);
      roomPresentation(rows); fitRoomLabels(rows.flatMap(row => [...row.querySelectorAll(".username_txt,.title_txt,.title2_txt")])); dirtyRoomRows.clear();
      roomObserver.observe(roomObserved, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
    });
  };
  const roomObserver = new MutationObserver(collectRoomChanges);

  const roomRows = new Map();
  function layoutRoomRows() {
    const room = document.getElementById('duel_room');
    if (room !== roomObserved) { roomObserver.disconnect(); roomObserved = room; if (room) { for (const row of room.querySelectorAll('.duelbutton')) dirtyRoomRows.add(row); roomObserver.observe(room, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] }); } }
    collectRoomChanges(roomObserver.takeRecords());
    if (!window.jQuery) return;
    for (const row of dirtyRoomRows) if (row.isConnected) roomRows.set(row, '');
    dirtyRoomRows.clear();
    const changed = [];
    // Row data can hold jQuery elements (e.g. format); they are not part of the row's identity and cannot be serialized.
    const plain = (key, value) => value && typeof value === 'object' && (value.jquery || value.nodeType) ? undefined : value;
    const stamp = row => JSON.stringify([config.nightMode, $(row).data(), window.friends_arr, window.following_arr, row.innerHTML, row.className], plain);
    for (const [row, previous] of roomRows) {
      if (!row.isConnected) { roomRows.delete(row); continue; }
      if (stamp(row) !== previous) changed.push(row);
    }
    if (changed.length) {
      roomObserver.disconnect(); roomPresentation(changed);
      fitRoomLabels(changed.flatMap(row => [...row.querySelectorAll('.username_txt,.title_txt,.title2_txt')]));
      for (const row of changed) roomRows.set(row, stamp(row));
      if (room) roomObserver.observe(room, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
  }

  function roomPresentation(rows = document.querySelectorAll("#duel_room .duelbutton")) {
    if (!window.jQuery) return;
    for (const row of rows) {
      if (!roomRows.has(row)) roomRows.set(row, '');
      // Keep the native controls and handlers; only group their layout.
      const data = $(row).data();
      const format = data.format_str || (typeof data.format === 'string' && data.format) || row.closest('.format')?.id || '';
      const note = row.querySelector('.note_txt');
      // WatchButton uses the native note field for these formats' Rated label.
      const ratedNote = row.classList.contains('watchbutton') && ['yr', 'gr', 'er', 'sr'].includes(format) && note?.textContent.trim() === '(Rated)';
      let metadata = row.querySelector('.dblite-room-meta');
      if (config.nightMode) {
        if (!metadata) {
          metadata = document.createElement('div'); metadata.className = 'dblite-room-meta';
          row.append(metadata);
        }
        for (const node of row.querySelectorAll(':scope > .tcg_title,:scope > .ocg_title,:scope > .key,:scope > .game_type,:scope > .tag_duel,:scope > .classic,:scope > .expert,:scope > .tag_team,:scope > .partner,:scope > .watching')) metadata.append(node);
        if (ratedNote && note.parentElement !== metadata) metadata.append(note);
        else if (!ratedNote && note?.parentElement === metadata) row.append(note);
      } else if (metadata) { row.append(...metadata.childNodes); metadata.remove(); }
      let heading = row.querySelector('.dblite-room-heading');
      const username = row.querySelector('.username_txt'), rating = row.querySelector('.rating_txt');
      if (config.nightMode && username && rating) {
        if (!heading) {
          heading = document.createElement('div'); heading.className = 'dblite-room-heading';
          row.insertBefore(heading, username);
        }
        if (username.parentElement !== heading) heading.append(username);
        if (rating.parentElement !== heading) heading.append(rating);
      } else if (heading) { heading.replaceWith(...heading.childNodes); }
      row.classList.toggle('dblite-room-tag', !!row.querySelector('.title2_txt'));
      row.classList.toggle('dblite-room-rated', format === 'ar');
      row.classList.toggle('dblite-room-hide-match', ['ar', 'yr', 'yu'].includes(format) && /^Match\b/i.test(row.querySelector('.game_type')?.textContent.trim() || ''));
      row.classList.toggle('dblite-room-no-meta', config.nightMode && !!metadata && ![...metadata.children].some(node => getComputedStyle(node).display !== 'none'));
      const names = [...new Set(['username', 'username1', 'username2', 'username3', 'username4'].map(key => data[key])
        .filter(value => typeof value === 'string' && value))].sort((a, b) => b.length - a.length);
      const relation = name => window.friends_arr?.includes(name) ? 'friend' : window.following_arr?.includes(name) ? 'following' : '';
      const relationships = names.map(name => [name, relation(name)]);
      for (const label of row.querySelectorAll('.username_txt,.title_txt,.title2_txt')) {
        const text = label.textContent, key = JSON.stringify([text, relationships]);
        if (roomLabelContents.get(label) === key && label.querySelector('.dblite-room-name')) continue;
        if (!names.length) continue;
        const parts = document.createDocumentFragment();
        // Match only the displayed text. Never restore a name censored by DB.
        let offset = 0;
        while (offset < text.length) {
          const user = names.find(name => text.startsWith(name, offset) && (offset === 0 || /[|&]\s$/.test(text.slice(0, offset))));
          const rating = !user && text.slice(offset).match(/^\(\d+\/\d+\)/)?.[0];
          const separator = !user && !rating && /^ [|&] /.test(text.slice(offset)) ? text.slice(offset, offset + 3) : '';
          const value = user || rating || separator;
          if (!value) { parts.append(document.createTextNode(text[offset++])); continue; }
          const span = document.createElement('span'); span.textContent = value;
          span.className = user ? 'dblite-room-name' : rating ? 'dblite-room-rating' : 'dblite-room-versus';
          if (user && relation(user)) { span.classList.add(`dblite-room-${relation(user)}`); span.title = relation(user) === 'friend' ? 'Friend' : 'Following'; }
          parts.append(span); offset += value.length;
        }
        let player = null;
        for (const part of [...parts.childNodes]) {
          if (part.classList?.contains('dblite-room-name')) {
            player = document.createElement('span'); player.className = 'dblite-room-player';
            parts.insertBefore(player, part); player.append(part);
          } else if (part.classList?.contains('dblite-room-versus')) player = null;
          else if (player) player.append(part);
        }
        label.replaceChildren(parts); roomLabelContents.set(label, key); roomLabelSizes.delete(label);
      }
    }
  }

  function fitRoomLabels(labels = document.querySelectorAll("#duel_room .duelbutton :is(.username_txt,.title_txt,.title2_txt)")) {
    if (!config.nightMode) return;
    for (const label of labels) {
      if (!label.clientWidth || !label.clientHeight) continue;
      const key = `${label.textContent}:${label.clientWidth}:${label.clientHeight}`;
      if (roomLabelSizes.get(label) === key) continue;
      const baseSize = label.closest('.watchbutton') ? (label.closest('.dblite-room-tag') ? 10.5 : 15) : 16;
      for (const player of label.querySelectorAll('.dblite-room-player')) {
        let size = baseSize; const name = player.querySelector('.dblite-room-name');
        player.style.fontSize = `${size}px`;
        while (size > 9 && name.scrollWidth > name.clientWidth + 1) {
          size -= .5; player.style.fontSize = `${size}px`;
        }
      }
      roomLabelSizes.set(label, key);
    }
  }

  let profileOrigin = null;
  function profileReturn() {
    const profile = document.getElementById('profile_viewer');
    let button = profile?.querySelector('.dblite-return-game');
    if (!profileOrigin) { button?.remove(); return; }
    if (!profile || button) return;
    button = document.createElement('button'); button.type = 'button'; button.className = 'dblite-return-game';
    button.textContent = '← Back to game';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (!profileOrigin || window.duelist || window.unsavedChanges || conflict()) return;
      if (typeof window.watchDuelE !== 'function') return;
      // Rejoin the original game through DB's normal watch/password route.
      window.watchDuelE.call($(document.createElement('div')).data(profileOrigin)[0]);
      if (window.duel_active) { profileOrigin = null; profileReturn(); }
    });
    profile.append(button);
  }
  const profilePictures = new WeakMap();
  function profileTabReady() {
    return !window.replay && !(window.duel_active && window.duelist) && !window.unsavedChanges && !conflict() &&
      !!window.username && window.websocket?.readyState === 1 && typeof window.loadProfile === 'function' && typeof window.leaveDuelRoom === 'function';
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'DBLITE_PROFILE_COMMAND') {
      const ready = profileTabReady(); let opened = false;
      if (ready && data.command === 'DBETTER_PROFILE_OPEN' && data.expires >= Date.now() && typeof data.username === 'string' && data.username.trim() && data.username.length <= 120 && !/[\x00-\x1f]/.test(data.username)) {
        window.leaveDuelRoom(); window.loadProfile(data.username); opened = true;
      }
      window.postMessage({ type: 'DBLITE_PROFILE_REPLY', id: data.id, ready, opened }, location.origin);
    }
    if (data?.type === 'DBLITE_PROFILE_RESULT' && !data.opened) {
      document.querySelector('.dblite-profile-feedback')?.remove();
      const feedback = document.createElement('div'); feedback.className = 'dblite-profile-feedback'; feedback.setAttribute('role', 'status');
      feedback.textContent = data.error || 'No available DuelingBook tab could open this profile.'; document.body.append(feedback);
      setTimeout(() => feedback.remove(), 10000);
    }
  });
  // Touch screens (Android app, 2026-10-28): the avatars are small on a phone and have no hover, so a tap on one
  // opens Profile and Chat at full size beside it; they press the avatar's own buttons.
  let avatarPanel = null;
  function closeAvatarMenu() { avatarPanel?.remove(); avatarPanel = null; }
  function avatarMenu(avatar) {
    closeAvatarMenu();
    const panel = avatarPanel = document.createElement('div'); panel.className = 'dblite-avatar-menu'; panel.setAttribute('role', 'menu');
    for (const [selector, label] of [['.dblite-profile-button', 'Profile ↗'], ['.dblite-chat-button', 'Chat']]) {
      const source = avatar.querySelector(selector); if (!source) continue;
      const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.textContent = label; item.title = source.title;
      item.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); closeAvatarMenu(); source.click(); });
      panel.append(item);
    }
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) panel.addEventListener(type, event => event.stopPropagation());
    document.body.append(panel);
    const r = avatar.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
    panel.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left - w - 8 < 8 ? r.right + 8 : r.left - w - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2)) + 'px';
  }
  document.addEventListener('mousedown', event => { if (avatarPanel && !avatarPanel.contains(event.target) && !event.target.closest?.('.duel_avatar')) closeAvatarMenu(); }, true);
  function profilePicture(avatar, enabled) {
    const picture = avatar.querySelector(':scope > .image'); if (!picture) return;
    // Touch: anywhere on the avatar, DuelingBook's rating and name overlays included, opens the menu.
    if (!avatar.dbliteAvatarMenu) {
      avatar.dbliteAvatarMenu = true;
      avatar.addEventListener('click', event => {
        if (!document.documentElement.classList.contains('dbetter-touch') || event.target.closest('.dblite-profile-button,.dblite-chat-button')) return;
        if (!avatar.querySelector('.dblite-chat-button,.dblite-profile-button')) return;
        event.preventDefault(); event.stopImmediatePropagation(); avatarMenu(avatar);
      }, true);
    }
    if (!profilePictures.has(picture)) {
      profilePictures.set(picture, Object.fromEntries(['role', 'tabindex', 'title'].map(key => [key, picture.getAttribute(key)])));
      for (const type of ['click', 'keydown', 'mousedown', 'mouseup', 'dblclick']) picture.addEventListener(type, event => {
        if (!picture.classList.contains('dblite-profile-picture')) return;
        if (type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (type !== 'click' && type !== 'keydown') return;
        if (document.documentElement.classList.contains('dbetter-touch') && avatar.querySelector('.dblite-chat-button')) avatarMenu(avatar);
        else avatar.querySelector('.dblite-profile-button')?.click();
      }, true);
    }
    picture.classList.toggle('dblite-profile-picture', enabled);
    if (enabled) { picture.setAttribute('role', 'button'); picture.tabIndex = 0; picture.title = avatar.querySelector('.dblite-profile-button')?.title || 'View player profile'; }
    else for (const [key, value] of Object.entries(profilePictures.get(picture))) { if (value === null) picture.removeAttribute(key); else picture.setAttribute(key, value); }
  }
  function spectatorProfiles() {
    if (profileOrigin) {
      const onProfile = /^profile_viewer2?$/.test(window.currentLabel || '');
      const name = document.getElementById('profile_username_txt')?.value.trim() || document.querySelector('#profile_viewer .username_txt')?.textContent.trim();
      // loadProfile is asynchronous; keep the origin while its native dimmer is up.
      const loading = profileOrigin.pending && visible(document.getElementById('dim'));
      if (onProfile) profileOrigin.pending = false;
      if (window.duel_active || (!loading && window.currentLabel && !onProfile) || (onProfile && name && name !== profileOrigin.username)) profileOrigin = null;
    }
    profileReturn();
    // Watching a match, between its games too (siding, choosing who goes first): user, 2026-10-28.
    const watching = (window.duel_active || /^(?:siding|tp_start|rps_start|duel_start)/.test(window.currentLabel || '')) && !window.duelist && !window.unsavedChanges && !conflict();
    const enabled = watching && (window.replay || (typeof window.loadProfile === 'function' && typeof window.leaveDuelRoom === 'function'));
    for (const avatar of document.querySelectorAll('#duel .duel_avatar')) {
      let button = avatar.querySelector('.dblite-profile-button');
      const displayed = [...(avatar.querySelector('.username_txt')?.childNodes || [])]
        .find(node => node.nodeType === 3)?.textContent.trim();
      const candidates = [window.player1, window.player2, window.player3, window.player4];
      const exact = candidates.find(player => player?.username === displayed)?.username;
      const censored = [...new Set(candidates.filter(player => displayed && player?.username &&
        window.censor?.(player.username) === displayed).map(player => player.username))];
      const username = exact || (censored.length === 1 ? censored[0] : null);
      let chat = avatar.querySelector('.dblite-chat-button');
      if (!watching || !username || username === window.username || typeof window.openPrivateE !== 'function') chat?.remove();
      else {
        if (!chat) {
          chat = document.createElement('button'); chat.type = 'button'; chat.className = 'dblite-chat-button'; chat.textContent = 'Chat';
          for (const type of ['mousedown', 'mouseup', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'keypress']) chat.addEventListener(type, event => event.stopPropagation());
          chat.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            const before = chat.dataset.username, duel = chat.dataset.duel;
            spectatorProfiles();
            if (!chat.isConnected || chat.dataset.username !== before || chat.dataset.duel !== duel) return;
            window.openPrivateE(before);
          });
          avatar.append(chat);
        }
        chat.dataset.username = username; chat.dataset.duel = String(window.duelId);
        chat.title = `Chat with ${displayed}`; chat.setAttribute('aria-label', chat.title);
      }
      if (!enabled || !username) { button?.remove(); profilePicture(avatar, false); continue; }
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'dblite-profile-button';
        button.textContent = 'Profile ↗';
        for (const type of ['mousedown', 'mouseup', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'keypress']) button.addEventListener(type, event => event.stopPropagation());
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          const before = button.dataset.username;
          spectatorProfiles();
          if (!button.isConnected || button.dataset.username !== before) return;
          if (window.replay) {
            window.postMessage({ type: 'DBLITE_PROFILE_REQUEST', username: before }, location.origin);
            return;
          }
          const id = window.duelId;
          const source = [...document.querySelectorAll('#duel_room .watchbutton')].find(row => $(row).data('id') === id);
          profileOrigin = id ? { id, password: !!(source && $(source).data('password')), watching: true, username: before, pending: true } : null;
          // The same route as DB's native user menu, including spectator exit.
          window.leaveDuelRoom(); window.loadProfile(before); profileReturn();
          document.getElementById('online_users')?.style.setProperty('display', 'none');
        });
        avatar.append(button);
      }
      button.dataset.username = username; button.title = `View ${displayed}'s profile`;
      button.setAttribute('aria-label', `View ${displayed}'s profile`);
      profilePicture(avatar, true);
    }
  }

  function autoRps() {
    if (window.DBETTERRebuilding) return;
    if (!config.autoRps || !window.jQuery || window.currentLabel !== 'rps_start' || !window.duelist ||
        window.replay || window.solo || window.paused || document.hidden || conflict() ||
        !window.duelId || window.Player1?.() !== window.player1 || window.player1?.username !== window.username) {
      rpsAttempt = null; return;
    }
    // A tie resets pickedRPS, then re-enables the same three controls. Seeing
    // the native acknowledgement arms the next round without duplicate sends.
    if (window.pickedRPS || window.rpsWinner) { rpsAttempt = null; return; }
    const choices = [window.rock1, window.paper1, window.scissors1];
    if (typeof window.chooseRPS !== 'function' || typeof window.TweenMax?.isTweening !== 'function' ||
        !choices.every(card => card?.[0]?.isConnected && card.hasClass('rps_card') && visible(card[0]) &&
          getComputedStyle(card.find('.content:first')[0] || card[0]).pointerEvents !== 'none' &&
          window.jQuery._data?.(card[0], 'events')?.click?.some(event => event.handler === window.chooseRPS))) return;
    if ([...choices, ...(window.topChoices || [])].some(card => window.TweenMax.isTweening(card))) return;
    if (rpsAttempt?.duel === window.duelId && rpsAttempt.nodes.every((node, i) => node === choices[i][0])) return;
    const index = Math.floor(Math.random() * 3);
    rpsAttempt = { duel: window.duelId, nodes: choices.map(card => card[0]) };
    // Use exactly the site's normal choice handler: it disables all controls,
    // sets pickedRPS and sends one ordinary RPS choice. Never choose turn order.
    try { window.chooseRPS.call(choices[index][0], window.jQuery.Event('click')); }
    catch (error) { console.warn('Spellspeed random RPS:', error); }
  }

  function announce(message) {
    let node = document.getElementById('dblite-status');
    if (!node) {
      node = document.createElement('div'); node.id = 'dblite-status';
      node.setAttribute('role', 'status'); document.body.appendChild(node);
    }
    node.textContent = message; node.hidden = false;
    clearTimeout(statusTimer); statusTimer = setTimeout(() => { node.hidden = true; }, 3500);
  }

  function conflict() { return typeof window.DBO_chooseZone === 'function'; }
  function effectAllowsDrag() {
    const queue = window.actionsQueue;
    return dragEffect && dragEffect.duelId === window.duelId && dragEffect.player === window.player1 &&
      dragEffect.queue === queue && queue.length === 1 && queue[0] === dragEffect.action && window.stopQueue;
  }
  const queueBusy = () => !!(window.stopQueue || window.actionsQueue?.length);
  function canPlay(allowEffect = false, duringAnimation = false) {
    if (!window.jQuery || !window.duel_active || !window.duelist || window.replay ||
        window.automatic || window.tag_duel || window.paused || conflict()) return false;
    if (!Array.isArray(window.player1?.all_cards_arr)) return false;
    if (queueBusy() && !duringAnimation && !(allowEffect && effectAllowsDrag())) return false;
    return visible(document.getElementById('cig1_txt')) &&
      !['overlay', 'dim', 'confirm', 'confirm2', 'input', 'combo'].some(id => visible(document.getElementById(id)));
  }
  const canDrag = () => canPlay(true);
  // A card can be picked up and dragged while DuelingBook still plays the last animations (user, 2026-10-29: on PC
  // the next move is planned during the animation); the move itself waits for the queue (dropWhenIdle).
  const canGrab = () => canPlay(true, true);
  // Drops made during an animation run once DuelingBook's queue is idle, in order, each re-checked by executeDrop
  // (same card, same zone state). After one runs, the next waits until its animation has started and finished, so it
  // never acts on the board as it was before. Escape cancels; a move still waiting after DEFER_MS is dropped.
  const DEFER_MS = 8000, DEFER_MAX = 3, ECHO_MS = 1500;
  let deferred = [], deferTimer = 0, deferWait = null;
  function dropWhenIdle(g, run) {
    if (!deferred.length && !deferWait && canDrag()) { run(); return; }
    if (deferred.length >= DEFER_MAX) { announce('Moves already waiting for the animation. Esc cancels them.'); return; }
    deferred.push({ run, duelId: g.duelId, at: Date.now() });
    announce(deferred.length > 1 ? `${deferred.length} moves wait for the animation · Esc cancels.` : 'Placed when the animation ends · Esc cancels.');
    if (!deferTimer) deferTimer = setInterval(flushDeferred, 40);
  }
  function cancelDeferred(message) {
    const had = deferred.length; deferred = []; deferWait = null; clearInterval(deferTimer); deferTimer = 0;
    if (had && message) announce(message);
  }
  function flushDeferred() {
    const now = Date.now();
    if (deferred.some(item => item.duelId !== window.duelId || now - item.at > DEFER_MS)) { cancelDeferred('The waiting move was cancelled: the duel moved on.'); return; }
    if (!deferred.length) { cancelDeferred(); return; }
    // The last queued move's own animation: wait until it has started and ended (or never started within ECHO_MS).
    if (deferWait) {
      if (queueBusy()) deferWait.seen = true;
      if (deferWait.seen ? queueBusy() : now - deferWait.at < ECHO_MS) return;
      deferWait = null;
    }
    if (!canDrag() || pendingSelection() || pendingAttach) return;
    const next = deferred.shift();
    try { next.run(); } catch (error) { announce('Move unavailable. Use the card menu.'); console.warn('Spellspeed:', error); }
    if (deferred.length) deferWait = { at: Date.now(), seen: false };
    else { clearInterval(deferTimer); deferTimer = 0; }
  }
  function canDraw(card = window.player1?.main_arr?.[0]) {
    return canPlay() && !document.hidden && !pendingSelection() && !pendingAttach && !workbench?.busy() &&
      !/Picking|Choosing|shuffle/i.test(window.viewing || '') && typeof window.drawCardE === 'function' &&
      !!card && same(window.player1.main_arr[0], card) && card.data('controller') === window.player1 &&
      card.data('owner') === window.player1 && !card.data('fake_card');
  }
  function drawOne(card) {
    if (!canDraw(card)) return;
    window.drawCardE();
  }

  function declarationChatCall(original, receiver, args, accepts = () => true) {
    const addLine = window.addLine;
    if (typeof addLine !== 'function') return original.apply(receiver, args);
    // Tag native system output, retaining the DOM, logs and commands. Ordinary
    // player messages never pass through this declaration-only scope.
    const scopedLine = function (...lineArgs) {
      if (!accepts(lineArgs[0])) return addLine.apply(this, lineArgs);
      const chat = document.querySelector('#duel .cout_txt');
      // DB's scrollpane adapter may append inside an OverlayScrollbars viewport.
      const before = new Set(chat?.querySelectorAll('span,br'));
      const returned = addLine.apply(this, lineArgs);
      for (const child of chat?.querySelectorAll('span,br') || []) if (!before.has(child)) child.classList.toggle('dblite-declaration-chat', true);
      return returned;
    };
    window.addLine = scopedLine;
    try { return original.apply(receiver, args); }
    finally { if (window.addLine === scopedLine) window.addLine = addLine; }
  }
  function trackDragEffects() {
    if (conflict()) { dragEffect = null; return; }
    // These native responses only show an effect (and may temporarily reorder
    // a pile). Leave their callbacks and queue untouched: the next server
    // response must still run after native cleanup. Only dragging gets this
    // exception, and only while no later response is waiting to change state.
    for (const name of ['declare', 'applyEffect', 'targetCardResponse', 'attack', 'attackDirectly', 'endAction', 'duelResponse2']) {
      const original = window[name];
      if (typeof original !== 'function' || rules.hasHook(original, wrappers.get(name))) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) {
          if (name === 'endAction') workbench?.flushHistory();
          const declaration = name === 'declare' ? workbench?.prepareDeclare(args[1]) : null;
          if (declaration) workbench.declareReceived(declaration);
          const result = original.apply(this, args);
          if (name === 'targetCardResponse') workbench?.targetReceived(args[1]);
          return result;
        }
        if (name === 'duelResponse2') {
          const data = args[1];
          // Some received declarations also include a separate system line.
          return data?.play === 'Declare' && data.line && workbench?.prepareDeclare(data) ?
            declarationChatCall(original, this, args, line => line === data.line) : original.apply(this, args);
        }
        clearPileHover();
        dragEffect = null;
        if (name === 'endAction') { workbench?.flushHistory(); return original.apply(this, args); }
        const queue = window.actionsQueue, action = queue?.[0];
        const effect = window.stopQueue && typeof action === 'function' ?
          { queue, action, duelId: window.duelId, player: window.player1 } : null;
        const declaration = name === 'declare' ? workbench?.prepareDeclare(args[1]) : null;
        const factory = window.createSVGAnimation;
        let scopedFactory;
        if (declaration && typeof factory === 'function') {
          // Scope the replacement to this Declare's spark. Its native play()
          // marks the reveal moment; do not advance or replace any callbacks.
          scopedFactory = function (...clipArgs) {
            const clip = factory.apply(this, clipArgs);
            if (clipArgs[0] === window.spark && typeof clip?.play === 'function') {
              // SVGAnim renders into s.node; mc is only an inner timeline
              // group. Hiding mc alone leaves other spark artwork visible.
              const sparkNodes = () => [clip.s?.node, document.getElementById(clip.mc?.id)].filter(node => node?.classList);
              const hideSpark = hide => sparkNodes().forEach(node => node.classList.toggle('dblite-native-declare', hide));
              hideSpark(config.animations && config.declareGlow);
              const play = clip.play; let received = false;
              clip.play = function (...playArgs) {
                hideSpark(config.animations && config.declareGlow);
                const result = play.apply(this, playArgs);
                if (!received) {
                  received = true;
                  workbench.declareReceived(declaration);
                }
                return result;
              };
            }
            return clip;
          };
          window.createSVGAnimation = scopedFactory;
        }
        let result;
        try { result = declaration ? declarationChatCall(original, this, args) : original.apply(this, args); }
        finally {
          if (scopedFactory && window.createSVGAnimation === scopedFactory) window.createSVGAnimation = factory;
        }
        if (name === 'targetCardResponse') workbench?.targetReceived(args[1]);
        if (effect && window.actionsQueue === queue && queue[0] === action && window.stopQueue &&
            effect.duelId === window.duelId && effect.player === window.player1) dragEffect = effect;
        return result;
      };
      rules.markHook(wrapped, original); wrappers.set(name, wrapped); window[name] = wrapped;
    }
  }
  function pendingSelection() {
    return window.attacking_card || window.overlaying_card ||
      [...document.querySelectorAll('#select_zones > div')].some(visible);
  }
  function ownCard(node) {
    const proxy = workbench?.cardFor(node);
    if (proxy) return proxy;
    const cardNode = node.closest?.('.card');
    if (!cardNode) return null;
    const id = $(cardNode).data('id');
    const p = window.player1;
    const candidates = [...(p?.all_cards_arr || [])];
    for (const host of [p?.m1, p?.m2, p?.m3, p?.m4, p?.m5, window.linkLeft, window.linkRight]) {
      if (host?.data('controller') === p) candidates.push(...(host.data('xyz_arr') || []));
    }
    return candidates.find(card => card.data('id') === id && same(card, $(cardNode))) || null;
  }
  function cardInfo(card) {
    const front = card.data('cardfront');
    const p = window.player1;
    const field = Array.from({ length: 5 }, (_, i) => [p[`m${i + 1}`], p[`s${i + 1}`]]).flat();
    field.push(p.fieldSpell, p.pendulumLeft, p.pendulumRight, window.linkLeft, window.linkRight);
    return {
      onField: field.some(item => same(item, card)),
      inMonsterZone: [...Array.from({ length: 5 }, (_, i) => p[`m${i + 1}`]), window.linkLeft, window.linkRight].some(item => same(item, card)),
      link: front?.data('monster_color') === 'Link',
      trap: front?.data('card_type') === 'Trap',
      fieldSpell: front?.data('type') === 'Field',
      extra: includes(p.extra_arr, card),
      hand: includes(p.hand_arr, card),
      viewedExtra: includes(p.extra_arr, card) && window.viewing === 'Extra Deck',
      faceUpExtraPendulum: includes(p.extra_arr, card) && faceUpPendulum(card),
      viewedDeck: includes(p.main_arr, card) && window.viewing === 'Deck',
      monster: front?.data('card_type') === 'Monster',
      pendulum: !!front?.data('pendulum'),
      name: front?.data('name') || 'Card'
    };
  }

  function faceUpPendulum(card) {
    const front = card?.data('cardfront');
    return card?.data('face_down') === false && front?.data('card_type') === 'Monster' && !!front.data('pendulum');
  }
  function dragSource(card) {
    if (!same(ownCard(card[0]), card) || card.data('controller') !== window.player1 ||
        card.data('fake_card')) return null;
    if (card.hasClass('xyzmaterial')) {
      const host = materialHost(card);
      return host && ((!window.viewing && card[0].closest('#field')) ||
        (window.viewing === 'Xyz Materials' && same(window.viewing_card_with_materials, host) && card[0].closest('#view'))) ? 'material' : null;
    }
    if (window.viewing && !['Deck', 'Extra Deck', 'Graveyard', 'Banished'].includes(window.viewing)) return null;
    const p = window.player1;
    for (const [key, viewer] of [['main_arr', 'Deck'], ['extra_arr', 'Extra Deck']]) {
      if (includes(p[key], card)) return window.viewing === viewer ||
        (key === 'main_arr' && same(p.main_arr[0], card) && canDraw(card)) ||
        (key === 'extra_arr' && same(p.extra_arr[0], card) && faceUpPendulum(card)) ? key : null;
    }
    if (cardInfo(card).onField) return 'field';
    return ['hand_arr', 'grave_arr', 'banished_arr'].find(key => includes(p[key], card)) || null;
  }
  function dragSourceUnchanged(g) {
    if (g.source === 'material') return dragSource(g.card) === 'material' && g.card.data('id') === g.cardId &&
      same(materialHost(g.card), g.host) && g.host?.data('id') === g.hostId && window.viewing === g.materialView;
    return dragSource(g.card) === g.source && (!g.pile ||
      (window.viewing !== directPiles[g.pile] && same(window.player1[g.pile]?.[0], g.card) && g.card.data('id') === g.cardId));
  }
  function materialHost(card) {
    const p = window.player1;
    return [p?.m1, p?.m2, p?.m3, p?.m4, p?.m5, window.linkLeft, window.linkRight].find(host =>
      host?.data('controller') === p && !host.data('fake_card') && includes(host.data('xyz_arr'), card)) || null;
  }

  // Menu access is broader than dragging: native macros can open picking
  // viewers, and materials, Skill Cards and visible opponent cards have actions.
  function menuCard(node) {
    const own = ownCard(node); if (own) return own;
    const cardNode = node.closest?.('.card'); if (!cardNode) return null;
    for (const p of [window.player1, window.player2]) {
      const cards = [...(p?.all_cards_arr || []), p?.skillCard];
      for (const host of p?.all_cards_arr || []) cards.push(...(host.data('xyz_arr') || []));
      const card = cards.find(card => card?.[0] === cardNode);
      if (card) return card;
    }
    return null;
  }
  function menuSource(card) {
    if (!card?.[0]?.closest || typeof card.data !== 'function' || !same(menuCard(card[0]), card) || card.data('fake_card')) return null;
    for (const [index, p] of [window.player1, window.player2].entries()) {
      if (!p) continue;
      for (const key of ['main_arr', 'extra_arr', 'grave_arr', 'banished_arr', 'hand_arr']) {
        if (includes(p[key], card)) return `${index}:${key}`;
      }
      for (const key of ['m1', 'm2', 'm3', 'm4', 'm5', 's1', 's2', 's3', 's4', 's5', 'fieldSpell', 'pendulumLeft', 'pendulumRight', 'skillCard']) {
        if (same(p[key], card)) return `${index}:${key}`;
      }
      for (const host of p.all_cards_arr || []) {
        if (includes(host.data('xyz_arr'), card)) return `${index}:material:${host.data('id')}`;
      }
    }
    for (const key of ['linkLeft', 'linkRight']) if (same(window[key], card)) return key;
    return null;
  }
  function replaceHoverMenu(card) {
    return config.contextMenu && !!workbench && window.duel_active && window.duelist &&
      !window.automatic && !window.tag_duel && !window.replay && !conflict() &&
      visible(document.getElementById('cig1_txt')) && !!menuSource(card);
  }
  // DBETTER scales and moves a resized Classic list (#view) with CSS; DuelingBook positions its card
  // menu from the unscaled list, so map the menu through the same scale and offset.
  function alignViewerMenu() {
    const view = document.getElementById('view'), menu = window.menu?.[0];
    if (!menu?.isConnected || !view?.classList.contains('dblite-classic-sized') || window.menu_card?.[0]?.parentElement?.closest('#view') !== view) { if (menu) menu.style.scale = ''; return; }
    const scale = parseFloat(view.style.getPropertyValue('--dblite-view-scale')) || 1;
    const dx = parseFloat(view.style.getPropertyValue('--dblite-view-x')) || 0, dy = parseFloat(view.style.getPropertyValue('--dblite-view-y')) || 0;
    const viewLeft = parseFloat(getComputedStyle(view).left) || 0, viewTop = parseFloat(getComputedStyle(view).top) || 0;
    const left = parseFloat(menu.style.left) || 0, top = parseFloat(menu.style.top) || 0;
    menu.style.left = `${viewLeft + dx + (left - viewLeft) * scale}px`; menu.style.top = `${viewTop + dy + (top - viewTop) * scale}px`;
    menu.style.transformOrigin = 'top left'; menu.style.scale = String(scale);
  }
  // DuelingBook's hover menu (user, 2026-11-04, Classic look): it slides in over 0.18 s, and a long menu without room above
  // its card is squeezed vertically (face-up Pendulum monsters in the Extra Deck viewer: 10 entries in 60 px). With
  // animations off it appears at once; a squeezed menu keeps its full size, above the card when the window has room,
  // otherwise just below it.
  function fitMenu() {
    const menu = window.menu?.[0], card = window.menu_card?.[0], tween = window.TweenMax;
    if (!menu?.isConnected || !card || !tween) return;
    const content = menu.querySelector('#card_menu_content');
    // Finished, not killed: the slide is a lazily rendered "from" tween that would otherwise put the content back down.
    if (!config.animations && content) for (const slide of tween.getTweensOf(content)) slide.progress(1);
    // DuelingBook squeezes with a 2D matrix(a, b, c, d, e, f); d is the vertical scale.
    const squeeze = Number(getComputedStyle(menu).transform?.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[3]);
    if (!(squeeze < 0.99)) return;
    tween.set(menu, { scaleY: 1 });
    const face = card.querySelector(':scope > .content') || card, c = face.getBoundingClientRect(), m = menu.getBoundingClientRect();
    const unit = menu.offsetHeight ? m.height / menu.offsetHeight : 1, gap = 2;
    let top = c.top - m.height;
    if (top < gap) top = c.bottom + m.height <= innerHeight - gap ? c.bottom : Math.max(gap, innerHeight - gap - m.height);
    menu.style.top = `${(parseFloat(menu.style.top) || 0) + (top - m.top) / unit}px`;
  }
  function cardMenus() {
    const original = window.showMenu;
    if (typeof original === 'function' && !rules.hasHook(original, wrappers.get('showMenu'))) {
      // Hook the renderer, not mouseover: existing cards already hold a reference
      // to cardMenuE, and their separate hover preview must keep working.
      const wrapped = function (card, ...args) {
        if (window.DBETTERRebuilding) return original.call(this, card, ...args);
        if (replaceHoverMenu(card)) { window.menu_reason = 'Use the right-click card menu'; return; }
        const result = original.call(this, card, ...args);
        // DuelingBook lifts a hand card itself when its menu opens; a second lift covers the bottom entries.
        if (window.menu_card) { if (same(window.menu_card, $(raisedHand))) lowerHand(); document.documentElement.classList.toggle('dblite-native-menu-open', true); }
        alignViewerMenu(); fitMenu();
        return result;
      };
      rules.markHook(wrapped, original); wrappers.set('showMenu', wrapped); window.showMenu = wrapped;
    }
    const remove = window.removeCardMenu;
    if (typeof remove === 'function' && !rules.hasHook(remove, wrappers.get('removeCardMenu'))) {
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return remove.apply(this, args); try { return remove.apply(this, args); } finally { if (!window.menu_card) document.documentElement.classList.toggle('dblite-native-menu-open', false); } };
      rules.markHook(wrapped, remove); wrappers.set('removeCardMenu', wrapped); window.removeCardMenu = wrapped;
    }
    if (!window.menu_card) document.documentElement.classList.toggle('dblite-native-menu-open', false);
    if (window.menu_card && replaceHoverMenu(window.menu_card)) window.removeCardMenu?.('DBETTER right-click actions');
  }
  // Collect every native entry, including card-specific labels and command IDs.
  // Temporary capture bypasses only rendering and is restored even on failure.
  function menuEntries(card) {
    if (typeof window.cardMenuE !== 'function' || typeof window.showMenu !== 'function') return [];
    const original = window.showMenu, previousCard = window.menu_card;
    const previousReason = window.menu_reason;
    let choices = [];
    window.showMenu = (target, entries) => {
      if (same(target, card) && Array.isArray(entries)) choices = entries
        .filter(entry => entry && typeof entry.data === 'string')
        .map(entry => ({ data: entry.data, label: typeof entry.label === 'string' ? entry.label : '' }));
    };
    window.menu_card = null;
    try { window.cardMenuE.call(card.find('.content:first')[0]); }
    finally { window.showMenu = original; window.menu_card = previousCard; window.menu_reason = previousReason; }
    return choices;
  }
  function allowedActions(card) {
    // Native menus reject every closed Extra Deck card. For its visible top
    // Pendulum only, collect the ordinary Extra Deck actions synchronously.
    // No viewer is opened, no card moves, and native state is always restored.
    const previousViewing = window.viewing;
    const closedPendulum = !previousViewing && same(window.player1?.extra_arr?.[0], card) && faceUpPendulum(card);
    try {
      if (closedPendulum) window.viewing = 'Extra Deck';
      return menuEntries(card).map(entry => entry.data);
    } finally { if (closedPendulum) window.viewing = previousViewing; }
  }

  function typingAt(node) {
    return node?.isContentEditable || node?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.dblite-action-history,.dblite-card-search,.dblite-deck-wheel,.dblite-tools,replay-scout');
  }
  function shortcutReady() {
    return config.shortcuts && !document.hidden && canPlay() && !pendingSelection() &&
      !gesture && !pendingAttach && !workbench?.busy() && !typingAt(document.activeElement) &&
      !document.querySelector('.dblite-panel,.dblite-view-settings,.dblite-opponent-choice') &&
      !/Picking|Choosing|shuffle/i.test(window.viewing || '');
  }
  function shortcutButton(key) {
    const node = document.getElementById(key === config.keys.ok ? 'good_btn' : 'think_btn');
    return visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' &&
      getComputedStyle(node).pointerEvents !== 'none' ? node : null;
  }
  function signal(key, long) {
    const node = shortcutButton(key);
    if (!node) return;
    if (key === config.keys.ok) {
      if (long) {
        // The native mouse hold sends this command, but also installs a global
        // mouseup handler. Keep keyboard hold ownership local to DBETTER instead.
        if (window.player1.still_good || parseFloat(getComputedStyle(node).opacity) < .5 || typeof window.Send !== 'function') return;
        $(node).data('holding', true).css('opacity', .4);
        window.Send({ action: 'Duel', play: 'Good', long: true });
      } else if (typeof window.allGoodE === 'function') {
        $(node).data('holding', false);
        window.allGoodE({ button: 0 });
      }
    } else if (long) {
      window.Send?.({ action: 'Duel', play: 'Duel message', message: 'big think' });
    } else window.thinkingE?.();
  }
  // OK / Thinking from the phone corner buttons or a held native button (touch.js): tap or hold.
  document.addEventListener('dbetter-signal', event => {
    const kind = event.detail?.kind, key = kind === 'ok' ? config.keys.ok : kind === 'think' ? config.keys.think : null;
    if (!key || !canPlay() || !shortcutButton(key)) return;
    signal(key, !!event.detail.long);
  });
  function targetHovered() {
    if (!hoveredNode?.isConnected || !visible(hoveredNode)) return;
    const card = menuCard(hoveredNode);
    if (!card || !menuSource(card) || card.data('fake_card') || card.hasClass('xyzmaterial')) return;
    if (window.TweenMax?.isTweening?.(card)) return;
    if (allowedActions(card).includes('Target')) window.cardMenuClicked?.(card, 'Target');
    // Opponent field/hand cards use the native click target handler instead of
    // the owned-card menu. It retains DB's target class and viewer restrictions.
    else if (card.hasClass('target') && typeof window.targetCard === 'function') window.targetCard.call(card[0]);
  }
  function cancelShortcuts() {
    for (const press of heldKeys.values()) clearTimeout(press.timer);
    heldKeys.clear();
  }
  function declareHovered() {
    if (!hoveredNode?.isConnected || !visible(hoveredNode)) return;
    const card = menuCard(hoveredNode);
    if (!card || card.data('controller') !== window.player1 || !menuSource(card) ||
        card.data('fake_card') || card.hasClass('xyzmaterial') || window.TweenMax?.isTweening?.(card)) return;
    if (allowedActions(card).includes('Declare')) window.cardMenuClicked?.(card, 'Declare');
  }
  // Zone keys over one of your cards send it there with the native menu action;
  // otherwise they keep opening the pile.
  const zoneSendActions = { grave: ['To GY'], banished: ['Banish'], deck: ['To T Deck'], extra: ['To ED', 'To Extra Deck', 'To ED FU'], hand: ['To hand'] };
  function sendHovered(zone) {
    if (!config.zoneKeysSend || !hoveredNode?.isConnected || !visible(hoveredNode)) return false;
    const card = menuCard(hoveredNode);
    if (!card || card.data('controller') !== window.player1 || !menuSource(card) ||
        card.data('fake_card') || card.hasClass('xyzmaterial') || window.TweenMax?.isTweening?.(card)) return false;
    // Pendulum Monsters go to the Extra Deck face-up (from the Deck viewer too).
    const pendulum = !!card.data('cardfront')?.data('pendulum'), candidates = zone === 'extra' && pendulum ? ['To ED FU', 'To ED'] : zoneSendActions[zone];
    // DuelingBook's Deck menu omits it, but the server accepts To ED FU for a Pendulum in your Deck.
    const allowed = [...allowedActions(card), ...(zone === 'extra' && pendulum && includes(window.player1.main_arr, card) ? ['To ED FU'] : [])];
    const action = candidates?.find(name => allowed.includes(name));
    if (!action) return false;
    window.cardMenuClicked?.(card, action); return true;
  }
  function shortcutContext(press) {
    return shortcutReady() && press.duelId === window.duelId && press.player === window.player1;
  }
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing) { cancelShortcuts(); return; }
    const action = Object.keys(config.keys).find(action => config.keys[action] === key);
    const enabled = ['ok', 'think'].includes(action) ? config.signalKeys : ['declare', 'target'].includes(action) ? config.cardKeys : action === 'wheel' ? config.drag : ['extra', 'deck', 'grave', 'banished', 'hand'].includes(action) && config.zoneKeys;
    if (!enabled || event.defaultPrevented ||
        event.composedPath().some(typingAt) || !shortcutReady()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat || heldKeys.has(key)) return;
    const press = { duelId: window.duelId, player: window.player1, long: false };
    heldKeys.set(key, press);
    if (key === config.keys.ok || key === config.keys.think) {
      press.timer = setTimeout(() => {
        if (heldKeys.get(key) !== press) return;
        press.long = true;
        if (shortcutContext(press)) signal(key, true);
      }, holdDelay);
    } else if (key === config.keys.target) targetHovered();
    else if (key === config.keys.declare) declareHovered();
    else if (action === 'wheel') toggleWheel();
    else if (!sendHovered(action) && action !== 'hand') workbench?.togglePile(({ extra: 'Extra Deck', deck: 'Deck', grave: 'Graveyard', banished: 'Banished' })[action]);
  }, true);
  document.addEventListener('keyup', event => {
    // Match keyup by letter even if Shift was pressed during a hold.
    const key = event.key.toLowerCase(), press = heldKeys.get(key);
    if (!press) return;
    clearTimeout(press.timer); heldKeys.delete(key);
    if (event.composedPath().some(typingAt)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing &&
        (key === config.keys.ok || key === config.keys.think) && !press.long && shortcutContext(press)) signal(key, false);
  }, true);
  document.addEventListener('focusin', event => { if (event.composedPath().some(typingAt)) cancelShortcuts(); }, true);

  const fieldHoverCards = new Set();
  function syncFieldHover() {
    const current = new Set();
    if ((config.animations && config.cardMotion) && window.duel_active && !document.hidden && !conflict() && !gesture && !window.stopQueue && !window.actionsQueue?.length && !pendingSelection()) {
      for (const p of [window.player1, window.player2]) if (p) {
        for (const key of ['m1','m2','m3','m4','m5','s1','s2','s3','s4','s5','fieldSpell']) {
          const card=p[key], node=card?.[0];
          if (node?.isConnected && !card.data('fake_card') && !card.hasClass('xyzmaterial') && node.closest('#field,#duel_content .cards') && !node.closest('#view')) current.add(node);
        }
      }
      for (const card of [window.linkLeft,window.linkRight]) if (card?.[0]?.isConnected && !card.data('fake_card')) current.add(card[0]);
    }
    for (const node of fieldHoverCards) if (!current.has(node)) node.classList.toggle('dblite-field-card', false);
    fieldHoverCards.clear();for (const node of current) {node.classList.toggle('dblite-field-card', true);fieldHoverCards.add(node);}
  }
  document.addEventListener('mouseover', syncFieldHover, true);
  function lowerHand() {
    raisedHand?.classList.toggle('dblite-hand-raised', false); raisedHand = null;
  }
  function syncHandHover() {
    const cards = config.handHover && window.duel_active && window.duelist && !window.replay && !conflict() ?
      (window.player1?.hand_arr || []).filter(card => card[0]?.isConnected && card.data('controller') === window.player1 &&
        !card.data('fake_card') && !card.hasClass('xyzmaterial') && card[0].closest('#field,#duel_content .cards') && !card[0].closest('#view')).map(card => card[0]) : [];
    const current = new Set(cards);
    for (const node of handCards) if (!current.has(node)) { node.classList.toggle('dblite-hand-card', false); node.classList.toggle('dblite-hand-raised', false); handCards.delete(node); }
    for (const node of cards) if (!handCards.has(node)) { node.classList.toggle('dblite-hand-card', true); handCards.add(node); }
    if (raisedHand && (!current.has(raisedHand) || !canDrag() || gesture || pendingSelection() || workbench?.busy())) lowerHand();
  }
  document.addEventListener('mouseover', event => {
    const node = event.target.closest?.('.dblite-fan-card,.card');
    if (node === hoveredNode) return;
    hoveredNode = node; lowerHand(); syncHandHover();
    // With Right-click actions off, DuelingBook's hover menu lifts the card itself.
    if (config.contextMenu && handCards.has(node) && canDrag() && !gesture && !pendingSelection() && !workbench?.busy()) {
      raisedHand = node; node.classList.toggle('dblite-hand-raised', true);
    }
  }, true);
  document.addEventListener('mouseout', event => {
    if (hoveredNode && !hoveredNode.contains(event.relatedTarget)) { hoveredNode = null; lowerHand(); }
  }, true);
  document.addEventListener('mousedown', () => { cancelShortcuts(); lowerHand(); clearPileHover(); }, true);
  window.addEventListener('blur', () => { cancelShortcuts(); hoveredNode = null; lowerHand(); clearPileHover(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelShortcuts(); hoveredNode = null; lowerHand(); clearPileHover(); } });

  function clearPileHover() {
    for (const node of pileCards.keys()) { node.classList.toggle('dblite-pile-card', false); node.classList.toggle('dblite-pile-raised', false); }
    pileCards.clear(); hoveredPile = null;
  }
  function pileAt(node) {
    if (!node?.closest || !window.jQuery) return null;
    const hitbox = node.closest('#deck_hidden,#extra_hidden,#grave_hidden,#banished_hidden');
    if (hitbox) return hoverPiles.find(([id]) => id === hitbox.id)?.[1] || null;
    if (!node.closest('#field,#duel_content .cards') || node.closest('#view,.dblite-fan')) return null;
    const card = ownCard(node);
    return card ? hoverPiles.find(([, key]) => includes(window.player1?.[key], card))?.[1] || null : null;
  }
  function syncPileHover() {
    if (!config.pileHover || !canPlay() || document.hidden || gesture || pendingSelection() || workbench?.busy() ||
        (window.viewing && !hoverPiles.some(([, , zone]) => zone === window.viewing))) { clearPileHover(); return; }
    const current = new Map();
    for (const [, key, zone] of hoverPiles) {
      const card = window.player1[key]?.[0], node = card?.[0];
      if (window.viewing !== zone && node?.isConnected && node.closest('#field,#duel_content .cards') && !node.closest('#view') &&
          visible(node) && card.data('controller') === window.player1 && !card.data('fake_card') && !card.hasClass('xyzmaterial')) current.set(node, key);
    }
    for (const node of pileCards.keys()) if (!current.has(node)) { node.classList.toggle('dblite-pile-card', false); node.classList.toggle('dblite-pile-raised', false); }
    pileCards.clear();
    for (const [node, key] of current) {
      pileCards.set(node, key); node.classList.toggle('dblite-pile-card', true);
      node.classList.toggle('dblite-pile-raised', key === hoveredPile);
    }
  }
  document.addEventListener('mouseover', event => { hoveredPile = pileAt(event.target); syncPileHover(); }, true);
  document.addEventListener('mouseout', event => { hoveredPile = pileAt(event.relatedTarget); syncPileHover(); }, true);
  window.addEventListener('resize', clearPileHover);

  // Measurements are reused until something that can move the box changes. Briefly showing a
  // hidden box forces a full board layout; done every tick, it made Android WebView drop
  // layers for a frame (parts of the screen flashing dark).
  const measured = new WeakMap();
  function measure(node) {
    if (!node) return null;
    const key = [node.getAttribute('style'), node.className, window.contentScale, window.marginLeft, window.marginTop, window.zooming, innerWidth, innerHeight, scrollX, scrollY, window.currentLabel].join('|');
    const cached = measured.get(node);
    if (cached?.key === key) return cached.rect;
    let rect;
    if (getComputedStyle(node).display !== 'none') rect = node.getBoundingClientRect();
    else {
      const old = node.getAttribute('style');
      // Native selection boxes are normally display:none; measure in their actual
      // scaled board layout without showing or activating them.
      node.style.setProperty('display', 'block', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
      rect = node.getBoundingClientRect();
      if (old === null) node.removeAttribute('style'); else node.setAttribute('style', old);
    }
    rect = rect.width > 0 && rect.height > 0 ? rect : null;
    // An empty box (board not laid out yet) is measured again next time.
    if (rect) measured.set(node, { key, rect });
    return rect;
  }
  function dropRect(node, kind) {
    if (!node) return null;
    // The Field Spell's native selector can inherit the 93px square width.
    // Its card position also changes between Link, classic and smaller fields.
    // Measure the portrait slot around the same anchor used by native placement.
    const p = window.player1, field = document.getElementById('field');
    if (kind === 'field' && field && Number.isFinite(p.fieldSpellX) && Number.isFinite(p.fieldSpellY)) {
      const slot = document.createElement('div'); slot.className = 'dblite-zone-probe';
      slot.style.cssText = `position:absolute;left:${p.fieldSpellX - 31.5}px;top:${p.fieldSpellY - 45}px;width:63px;height:90px;pointer-events:none;visibility:hidden`;
      field.append(slot); const rect = slot.getBoundingClientRect(); slot.remove();
      if (rect.width > 0 && rect.height > 0) return rect;
    }
    const rect = measure(node); if (!rect) return null;
    const selector = /_select2?$/.test(node.id);
    if (selector && kind !== 'field') {
      const hiddenId = node.id.endsWith('_select2') ? node.id.replace(/^m(\d)_select2$/, 'opp_m$1_hidden') : node.id.replace('_select', '_hidden');
      const outline = measure(document.getElementById(hiddenId));
      if (outline) return outline;
    }
    const css = getComputedStyle(node), nativeWidth = parseFloat(css.width), nativeHeight = parseFloat(css.height);
    const sx = rect.width / nativeWidth, sy = rect.height / nativeHeight;
    if (!(sx > 0 && sy > 0 && Number.isFinite(sx) && Number.isFinite(sy))) return rect;
    let x = 0, y = 0, width = nativeWidth, height = nativeHeight;
    if (kind === 'field') { x = .5; y = 1.5; width = 63; height = 90; }
    else if (selector && nativeWidth === 93 && nativeHeight === 93) { x = y = 1.5; width = height = 90; }
    // The Main Deck's click area includes the stack overhang. Its drop outline
    // should match the 63x90 portrait footprint used by the other piles.
    else if (kind === 'deck' && nativeWidth === 75.5 && nativeHeight === 97.5) { width = 63; height = 90; }
    const left = rect.left + x * sx, top = rect.top + y * sy;
    return { left, top, width: width * sx, height: height * sy, right: left + width * sx, bottom: top + height * sy };
  }
  function targets(card) {
    const p = window.player1, result = [], info = cardInfo(card);
    const count = window.duel_links || window.speed || window.rush ? 3 : 5;
    function add(id, kind, occupant, zone = false) {
      const node = document.getElementById(id), rect = dropRect(node, kind);
      const front = occupant?.data?.('cardfront');
      const overlayEligible = kind === 'monster' && !!occupant && !same(occupant, card) &&
        occupant.data?.('controller') === p && !occupant.data('face_down') &&
        !occupant.data('fake_card') && !!front && front.data('monster_color') !== 'Token';
      if (rect) result.push({ node, rect, kind, occupant, occupied: !!occupant, zone,
        overlayEligible, xyz: front?.data('monster_color') === 'Xyz' });
    }
    for (let i = 1; i <= count; i++) {
      add(`m${i}_select`, 'monster', p[`m${i}`], true);
      add(`s${i}_select`, 'spell', p[`s${i}`], true);
    }
    if (window.links && !window.rush) {
      if (info.extra || info.onField || window.linkLeft) add('link_left_select', 'monster', window.linkLeft, true);
      if (info.extra || info.onField || window.linkRight) add('link_right_select', 'monster', window.linkRight, true);
    }
    add('field_spell1_select', 'field', p.fieldSpell, true);
    for (const [id, kind] of [['grave_hidden', 'grave'], ['banished_hidden', 'banished'],
      ['deck_hidden', 'deck'], ['extra_hidden', 'extra']]) add(id, kind, false);
    // Transform board-local hand coordinates to viewport coordinates using the
    // site's own parent container. Works for an empty hand as well as full hands.
    const field = document.getElementById('field');
    if (field && Number.isFinite(p.handY)) {
      const marker = document.createElement('div');
      marker.style.cssText = `position:absolute;left:280px;top:${p.handY - 45}px;width:470px;height:90px;pointer-events:none;visibility:hidden`;
      field.appendChild(marker);
      const rect = marker.getBoundingClientRect(); marker.remove();
      if (rect.width) {
        // The hand's board coordinates already include DB's window scaling.
        // Extend below it into the unused viewport, keeping side/chat areas out.
        const padding = rect.width / 470 * 80;
        const left = Math.max(8, rect.left - padding), right = Math.min(innerWidth - 8, rect.right + padding);
        const top = Math.max(0, rect.top - padding / 8), bottom = Math.max(rect.bottom, innerHeight - 8);
        result.push({ kind: 'hand', rect: { left, right, top, bottom, width: right - left, height: bottom - top }, occupied: false, zone: false });
      }
    }
    const opponent = window.player2;
    if (field && opponent && Number.isFinite(opponent.handY)) {
      const marker = document.createElement('div');
      marker.style.cssText = `position:absolute;left:280px;top:${opponent.handY - 45}px;width:470px;height:90px;pointer-events:none;visibility:hidden`;
      field.appendChild(marker);
      const rect = marker.getBoundingClientRect(); marker.remove();
      if (rect.width) result.push({ kind: 'opponentHand', rect, occupied: false, zone: false });
    }
    if (opponent) {
      for (let i = 1; i <= count; i++) add(`m${i}_select2`, 'opponentZone', opponent[`m${i}`], true);
      for (let i = 1; i <= count; i++) if (opponent[`m${i}`]) add(`opp_m${i}_hidden`, 'opponentMonster', opponent[`m${i}`]);
      for (const [id, occupant] of [['link_left_select', window.linkLeft], ['link_right_select', window.linkRight]]) {
        if (window.links && occupant?.data('controller') === opponent) add(id, 'opponentMonster', occupant);
      }
    }
    return result;
  }
  function actionFor(g, target, shift, ctrl, alt) {
    shift = shift && config.dragDefense; alt = alt && config.dragSet;
    if (target.kind === 'opponentHand' && !(cardInfo(g.card).hand ? config.dragReveal : config.dragAttack) ||
        target.kind === 'opponentMonster' && !config.dragAttack) return null;
    if (g.source === 'material') {
      const action = ({ grave: 'Detach', banished: 'Banish' })[target.kind];
      return action && g.actions.includes(action) ? action : null;
    }
    if (g.source === 'hand_arr' && target.kind === 'hand' && duelTools?.canOrder()) return 'Reorder hand';
    if (g.pile === 'main_arr') return target.kind === 'hand' && g.actions.includes('Draw card') ? 'Draw card' : null;
    const action = rules.dropAction(cardInfo(g.card), target, shift, g.actions, config.normalSummon && ctrl, alt);
    // Banish returns a card to its owner. Do not strand a borrowed card in the
    // opponent's pile, or improvise a move that the native menu doesn't offer.
    if (action === 'Attach' && needsBanish(g.source) &&
        (!g.actions.includes('Banish') || g.card.data('owner') !== window.player1)) return null;
    return action;
  }
  function needsBanish(source) { return ['field', 'hand_arr', 'main_arr'].includes(source); }
  function drawTargets(g, shift, ctrl, alt) {
    g.shift = !!shift; g.ctrl = !!ctrl; g.alt = !!alt;
    for (const target of g.targets) {
      // A zone with no plain-drop move (no Attack position, say) still takes the card when the wheel offers more than one.
      const choices = summonChoices(g, target, { shift, ctrl, alt }), action = actionFor(g, target, shift, ctrl, alt) || (choices.length > 1 ? choices[0][0] : null);
      target.marker.hidden = !action;
      target.marker.textContent = ({ 'Set ST': 'Set face-down', 'To ST': 'Place face-up',
        'Activate ST': 'Activate', 'To ED FU': 'Extra Deck face-up', 'Set monster': 'Set face-down',
        'To T Deck': 'Top of Deck', 'To B Deck': 'Bottom of Deck', 'Draw card': 'Draw 1',
        'Detach': 'Detach to GY', 'Reveal': 'Reveal to opponent', 'Attack': 'Declare attack', 'Attack directly': 'Direct attack' })[action] || action || '';
      if (action && target.kind === 'opponentZone') target.marker.textContent = /^SS /.test(action) ? `Opponent’s field${action === 'SS DEF' ? ' · DEF' : ''}` : 'Change control';
      if (action === 'Attach' && needsBanish(g.source)) target.marker.textContent = 'Attach via banish';
      if (action && choices.length > 1) target.marker.textContent = ['spell', 'field'].includes(target.kind) ? 'Place…' : 'Summon…';
      target.marker.dataset.label = target.marker.textContent;
      const label = document.createElement('span'); label.className = 'dblite-drop-label'; label.textContent = target.marker.textContent;
      target.marker.replaceChildren(label);
    }
  }
  // User, 2026-10-29: the position wheel suits laid-back mouse play; off, a drop plays at once and Shift, Ctrl and Alt
  // choose (keyboard play). A button beside Find a card and a key (W) switch between the two, saved like the settings.
  let wheelNote = null;
  function toggleWheel() {
    const on = !config.dropWheel;
    config = { ...config, dropWheel: on };
    window.postMessage({ type: 'DBLITE_QUICK', dropWheel: on }, location.origin);
    wheelNote?.remove();
    const note = wheelNote = document.createElement('div'); note.className = 'dblite-quick-note'; note.setAttribute('role', 'status');
    note.textContent = on ? 'Position wheel on: a drop on an empty zone asks how to play the card' : 'Position wheel off: drops play at once (Shift, Ctrl, Alt choose)';
    document.body.append(note); setTimeout(() => { if (wheelNote === note) { note.remove(); wheelNote = null; } }, 1800);
  }
  // Touch has no Shift / Ctrl / Alt, so a drop on an empty monster zone asks for the position.
  // The position wheel's choices for a drop on an empty zone: always for touch (no Shift / Ctrl / Alt), and with a
  // mouse when the Position wheel setting is on and no modifier key (keys: the drop's) picks the move directly.
  function summonChoices(g, target, keys) {
    if (target.occupied || !(g.touch || config.dropWheel && !keys?.shift && !keys?.ctrl && !keys?.alt)) return [];
    const info = cardInfo(g.card), offered = ([action]) => g.actions.includes(action);
    if (info.onField) return [];
    if (['monster', 'opponentZone'].includes(target.kind)) {
      if (target.kind === 'opponentZone' && !info.monster) return [];
      // Clockwise from the top (user, 2026-10-28): Special Summons up and down, Normal Summon right, Set left.
      return [['SS ATK', 'SS Attack'], ['Normal Summon', 'Normal'], ['SS DEF', 'SS Defense'], ['Set monster', 'Set']].filter(([action]) =>
        offered([action]) && !(action === 'SS DEF' && info.link) && (info.hand && target.kind === 'monster' || !['Normal Summon', 'Set monster'].includes(action)));
    }
    // Spells and Traps: activate, Set or place face-up (a Pendulum monster from the Extra Deck only goes face-up).
    if (target.kind === 'spell' && !((info.viewedExtra || info.faceUpExtraPendulum) && info.monster))
      return (info.trap ? [['Set ST', 'Set'], ['Activate ST', 'Activate'], ['To ST', 'Face-up']] : [['Activate ST', 'Activate'], ['Set ST', 'Set'], ['To ST', 'Face-up']]).filter(offered);
    if (target.kind === 'field' && info.fieldSpell) return [['Activate Field Spell', 'Activate'], ['Set Field Spell', 'Set']].filter(offered);
    return [];
  }
  // A ring of joined segments around a centre ×, like the Deck actions wheel. Used for the
  // summon position (touch drops) and the quick chat. items: [{ label, sub, title, run }].
  const SVG = 'http://www.w3.org/2000/svg';
  function ringWheel({ className, label, items, x, y, outer = 98, inner = 36, onClose }) {
    const node = document.createElement('div'); node.className = 'dblite-ring ' + (className || '');
    node.setAttribute('role', 'menu'); node.setAttribute('aria-label', label);
    const size = outer * 2 + 8, c = size / 2;
    const left = Math.max(8, Math.min(innerWidth - size - 8, x - c)), top = Math.max(8, Math.min(innerHeight - size - 8, y - c));
    Object.assign(node.style, { left: left + 'px', top: top + 'px', width: size + 'px', height: size + 'px' });
    const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('width', size); svg.setAttribute('height', size);
    const n = items.length, gap = n > 1 ? 1.6 : 0, point = (r, a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
    // The first segment is centred at the top, the others follow clockwise: two choices sit above and below.
    const first = -Math.PI / 2 - Math.PI / n;
    items.forEach((item, i) => {
      const a0 = first + i * 2 * Math.PI / n + (n > 1 ? gap / outer : 0), a1 = first + (i + 1) * 2 * Math.PI / n - (n > 1 ? gap / outer : 0);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = point(outer, a0), [x1, y1] = point(outer, a1), [x2, y2] = point(inner, a1), [x3, y3] = point(inner, a0);
      const g = document.createElementNS(SVG, 'g'); g.setAttribute('class', 'dblite-ring-item'); g.setAttribute('role', 'menuitem');
      g.setAttribute('tabindex', '0'); g.setAttribute('aria-label', item.title || item.label);
      if (item.action) g.dataset.action = item.action;
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', n === 1
        ? `M ${c - outer} ${c} A ${outer} ${outer} 0 1 1 ${c + outer} ${c} A ${outer} ${outer} 0 1 1 ${c - outer} ${c} M ${c - inner} ${c} A ${inner} ${inner} 0 1 0 ${c + inner} ${c} A ${inner} ${inner} 0 1 0 ${c - inner} ${c} Z`
        : `M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`);
      path.setAttribute('fill-rule', 'evenodd');
      const mid = (a0 + a1) / 2, [tx, ty] = point((outer + inner) / 2, n === 1 ? -Math.PI / 2 : mid);
      const text = document.createElementNS(SVG, 'text'); text.setAttribute('x', tx); text.setAttribute('y', ty);
      const lines = [item.label, item.sub].filter(Boolean);
      lines.forEach((line, k) => {
        const span = document.createElementNS(SVG, 'tspan'); span.setAttribute('x', tx);
        span.setAttribute('dy', k ? '1.15em' : `${-(lines.length - 1) * .55 + .35}em`); if (k) span.setAttribute('class', 'dblite-ring-sub');
        span.textContent = line.length > 14 ? line.slice(0, 13) + '…' : line; text.append(span);
      });
      // A tooltip only where the label had to be shortened (it would repeat the text otherwise).
      if (lines.some(line => line.length > 14)) { const title = document.createElementNS(SVG, 'title'); title.textContent = item.title || item.label; g.append(title); }
      g.append(path, text);
      const choose = event => { event.preventDefault(); event.stopPropagation(); close(); item.run(); };
      g.addEventListener('click', choose);
      g.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') choose(event); });
      svg.append(g);
    });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'dblite-ring-close'; cancel.textContent = '×';
    cancel.setAttribute('aria-label', 'Close ' + label);
    Object.assign(cancel.style, { left: c - inner + 6 + 'px', top: c - inner + 6 + 'px', width: (inner - 6) * 2 + 'px', height: (inner - 6) * 2 + 'px' });
    cancel.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); close(); });
    let closed = false;
    function close() { if (closed) return; closed = true; node.remove(); onClose?.(); }
    node.append(svg, cancel); document.body.append(node);
    node.querySelector('.dblite-ring-item')?.focus?.({ preventScroll: true });
    return { node, close };
  }
  let positionWheel = null;
  function closePositionWheel() { positionWheel?.close(); positionWheel = null; }
  function openPositionWheel(g, target, choices, pointerX) {
    closePositionWheel();
    const r = target.rect;
    // The card viewer steps aside while the position is chosen (it covers the field).
    document.documentElement.classList.toggle('dblite-wheel-open', true);
    const wheel = ringWheel({ className: 'dblite-position-wheel', label: ['spell', 'field'].includes(target.kind) ? 'How to place it' : 'Summon position', x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2,
      outer: choices.length > 2 ? 92 : 78, inner: 30,
      onClose: () => { document.documentElement.classList.toggle('dblite-wheel-open', false); if (positionWheel?.close === wheel.close) positionWheel = null; },
      items: choices.map(([action, label]) => ({ label, action, title: label, run: () => {
        // A card taken from a viewer: the viewer closes once the summon is sent.
        const fromViewer = !!g.focusTarget?.closest?.('.dblite-fan,#view');
        try { dropWhenIdle(g, () => { executeDrop(g, target, false, false, false, pointerX, action); if (fromViewer) setTimeout(() => workbench?.closeViewer?.(), 0); }); }
        catch (error) { announce('Move unavailable. Use the card menu.'); console.warn('Spellspeed:', error); }
      } })) });
    positionWheel = { ...wheel, duelId: g.duelId };
  }
  document.addEventListener('mousedown', event => { if (positionWheel && !event.target.closest?.('.dblite-position-wheel')) closePositionWheel(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && positionWheel) { event.preventDefault(); event.stopImmediatePropagation(); closePositionWheel(); } }, true);
  window.addEventListener('blur', closePositionWheel);
  function beginDrag(g, event) {
    if (!canGrab() || !dragSourceUnchanged(g) || pendingSelection()) return false;
    g.actions = g.pile === 'main_arr' ? (canDraw(g.card) ? ['Draw card'] : []) : allowedActions(g.card);
    if (!g.actions.length && !(g.source === 'hand_arr' && duelTools?.canOrder())) return false;
    g.targets = targets(g.card);
    g.layer = document.createElement('div'); g.layer.id = 'dblite-drag-layer';
    for (const target of g.targets) {
      const marker = document.createElement('div'); marker.className = 'dblite-drop';
      marker.dataset.zone = target.node?.id || target.kind;
      const r = target.rect;
      marker.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      target.marker = marker; g.layer.appendChild(marker);
    }
    g.ghost = document.createElement('div'); g.ghost.className = 'dblite-ghost';
    const concealed = g.pile === 'main_arr' || (g.source === 'banished_arr' && g.card.data('face_down'));
    const pic = !concealed && rules.pageImage(g.card.find('.cardfront .pic').first().attr('src'));
    if (pic) { const image = document.createElement('img'); image.src = pic; g.ghost.appendChild(image); }
    const label = document.createElement('span'); label.textContent = g.pile === 'main_arr' ? 'Top of Deck' : concealed ? 'Face-down banished card' : cardInfo(g.card).name;
    g.ghost.appendChild(label); g.layer.appendChild(g.ghost); document.body.appendChild(g.layer);
    window.removeCardMenu?.('DBETTER drag');
    document.documentElement.classList.toggle('dblite-dragging', true);
    g.active = true;
    workbench?.dragging(true);
    drawTargets(g, event.shiftKey, event.ctrlKey, event.altKey);
    return true;
  }
  // Click-and-drop waits out the double-click time before it picks the card up (or until the
  // pointer leaves the card): the viewer stays clickable, so a double-click still declares.
  const CLICK_DROP_DELAY = 500;
  let clickDropTimer = 0;
  const pointerOf = event => ({ clientX: event.clientX, clientY: event.clientY, shiftKey: !!event.shiftKey, ctrlKey: !!event.ctrlKey, altKey: !!event.altKey });
  function startClickDrop(g, event) {
    // detail 2: the second click of a double-click.
    if (!config.clickDrop || g.touch || event.detail > 1 || !g.focusTarget?.closest?.('.dblite-fan-card,#view') || Math.hypot(event.clientX - g.x, event.clientY - g.y) >= 8) return false;
    g.armed = true; g.pointer = pointerOf(event);
    clearTimeout(clickDropTimer);
    clickDropTimer = setTimeout(() => { if (gesture === g && g.armed && !pickUp(g, g.pointer)) cleanDrag(); }, CLICK_DROP_DELAY);
    return true;
  }
  function pickUp(g, event) {
    g.armed = false; clearTimeout(clickDropTimer);
    if (gesture !== g || !canGrab() || window.duelId !== g.duelId) return false;
    try { if (!beginDrag(g, event)) return false; } catch (error) { console.warn('Spellspeed click and drop:', error); return false; }
    g.sticky = true; g.stickyAt = Date.now();
    g.ghost.style.transform = `translate3d(${event.clientX + 18}px,${event.clientY + 18}px,0)`;
    announce('Click a zone to place the card · Esc or right-click cancels.');
    return true;
  }
  function cleanDrag() {
    clearTimeout(clickDropTimer);
    if (gesture?.active) {
      suppressClickUntil = Date.now() + 350;
      // A key pressed during a mouse drag can activate :focus-visible on the
      // originating fan tile. Release that pointer-owned focus with the drag.
      if (gesture.focusTarget?.contains(document.activeElement)) document.activeElement.blur?.();
    }
    gesture?.layer?.remove();
    gesture = null; document.documentElement.classList.toggle('dblite-dragging', false);
    workbench?.dragging(false);
  }
  function targetAt(g, event) {
    return g.targets.find(target => {
      const r = target.rect;
      if (target.kind === 'hand' && event.target?.closest?.('input,textarea,select,button,[contenteditable="true"],.chat,#chats,.dblite-panel,.dblite-view-settings,.dblite-card-search')) return false;
      return event.clientX >= r.left && event.clientX <= r.right &&
        event.clientY >= r.top && event.clientY <= r.bottom && (actionFor(g, target, event.shiftKey, event.ctrlKey, event.altKey) ||
        summonChoices(g, target, { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey }).length > 1);
    });
  }
  function overlayOnto(card, host, action) {
    const previousCard = window.overlaying_card, previousPlay = window.olPlay;
    window.player1.temp_arr = [];
    window.overlaying_card = card; window.olPlay = action;
    // The native menu would ask for a target. The drop already selected one.
    try { window.overlayCard(host); }
    finally { window.overlaying_card = previousCard; window.olPlay = previousPlay; }
  }
  function clearAttach() {
    pendingAttach = null;
    clearInterval(attachTimer); attachTimer = null;
  }
  function cancelAttach() {
    if (!pendingAttach) return;
    const banished = includes(pendingAttach.player.banished_arr, pendingAttach.card);
    clearAttach();
    announce(banished ? 'Attachment cancelled; the card remains banished.' :
      'Attachment cancelled. The banish already requested may still complete.');
  }
  function advanceAttach() {
    const job = pendingAttach;
    if (!job) { clearAttach(); return; }
    try {
      if (!config.drag || !window.duel_active || !window.duelist || window.replay ||
          window.automatic || window.tag_duel || window.paused || conflict() || document.hidden ||
          window.duelId !== job.duelId || window.player1 !== job.player ||
          Date.now() >= job.deadline || pendingSelection() ||
          !same(ownCard(job.card[0]), job.card) || job.card.data('id') !== job.cardId ||
          job.card.data('controller') !== job.player || job.card.data('owner') !== job.player ||
          job.card.data('fake_card') || job.card.hasClass('xyzmaterial')) {
        cancelAttach(); return;
      }
      const occupant = job.player[job.targetNode.id.replace('_select', '')] || (job.targetNode.id === 'link_left_select' ? window.linkLeft : window.linkRight);
      const front = occupant?.data('cardfront');
      const target = job.targetNode.isConnected && { occupant, xyz: front?.data('monster_color') === 'Xyz', overlayEligible: !!occupant && occupant.data('controller') === job.player && !occupant.data('face_down') && !occupant.data('fake_card') && !!front && front.data('monster_color') !== 'Token' };
      if (!target?.overlayEligible || !target.xyz || !same(target.occupant, job.host) ||
          job.host.data('id') !== job.hostId) { cancelAttach(); return; }
      const source = dragSource(job.card);
      if (source !== 'banished_arr') {
        if (source !== job.source) cancelAttach();
        return; // Still awaiting the server's Banish response; never send early.
      }
      if (job.card.data('face_down')) { cancelAttach(); return; }
      // The native Banish handler updates the pile before its animation ends.
      // Wait for its action queue to finish as well, instead of using a delay.
      if (!canPlay()) return;
      if (!allowedActions(job.card).includes('Attach') || typeof window.overlayCard !== 'function') {
        cancelAttach(); return;
      }
      clearAttach(); // Clear before dispatch: exactly one Attach, with no retries.
      overlayOnto(job.card, job.host, 'Attach');
      announce('Attach requested.');
    } catch (error) {
      clearAttach(); announce('Attachment stopped. Check the card’s current zone.');
      console.warn('Spellspeed attach:', error);
    }
  }
  function banishThenAttach(g, target) {
    if (typeof window.cardMenuClicked !== 'function') return;
    pendingAttach = { card: g.card, cardId: g.card.data('id'), source: g.source,
      host: target.occupant, hostId: target.occupant.data('id'), targetNode: target.node,
      duelId: g.duelId, player: window.player1, deadline: Date.now() + 10000 };
    announce('Banishing, then attaching… Escape cancels.');
    try {
      window.cardMenuClicked(g.card, 'Banish');
      if (pendingAttach) attachTimer = setInterval(advanceAttach, 50);
    } catch (error) { cancelAttach(); throw error; }
  }
  function executeDrop(g, target, shift, ctrl, alt, pointerX, chosen = null) {
    if (pendingAttach || !canDrag() || window.duelId !== g.duelId || pendingSelection() ||
        !dragSourceUnchanged(g)) return;
    const fresh = targets(g.card).find(item => item.kind === target.kind && item.node === target.node);
    if (!fresh) return;
    // Do not turn a summon into an overlay (or vice versa), or change the
    // intended host, if another action changed this zone during the gesture.
    if (fresh.occupied !== target.occupied ||
        (target.occupied && !same(fresh.occupant, target.occupant))) {
      announce('That destination changed. Drag the card again.'); return;
    }
    g.actions = g.pile === 'main_arr' ? (canDraw(g.card) ? ['Draw card'] : []) : allowedActions(g.card);
    if (!g.actions.length && !(g.source === 'hand_arr' && fresh.kind === 'hand' && duelTools?.canOrder())) { announce('That card is no longer available.'); return; }
    const action = chosen ? (summonChoices(g, fresh).some(([name]) => name === chosen) ? chosen : null) : actionFor(g, fresh, shift, ctrl, alt);
    if (!action) { announce('That destination is no longer available.'); return; }
    if (action === 'Reorder hand') {
      duelTools.reorder(g, pointerX);
    } else if (action === 'Draw card') {
      drawOne(g.card);
    } else if (fresh.kind === 'opponentMonster') {
      if (typeof window.attackCard !== 'function' || fresh.occupant?.data('controller') !== window.player2) return;
      const previous = window.attacking_card;
      try { window.attacking_card = g.card; window.attackCard(fresh.occupant); }
      finally { window.attacking_card = previous; }
    } else if (fresh.occupied && fresh.overlayEligible) {
      if (typeof window.overlayCard !== 'function') return;
      if (action === 'Attach' && needsBanish(g.source)) banishThenAttach(g, fresh);
      else overlayOnto(g.card, fresh.occupant, action);
    } else if (fresh.kind === 'opponentZone' && /^SS /.test(action)) {
      summonToOpponent(g, fresh, action);
    } else if (fresh.zone && action !== 'Activate Field Spell' && action !== 'Set Field Spell') {
      if (typeof window.chooseZone !== 'function') return;
      window.player1.temp_arr = [];
      window.summoning_card = g.card; window.summoning_play = action;
      window.chooseZone.call(fresh.node);
    } else if (typeof window.cardMenuClicked === 'function') {
      window.cardMenuClicked(g.card, action);
    }
  }

  // A monster that is not on the field reaches an opponent's zone in two native steps: Special
  // Summon to a free zone of yours, then Move (DuelingBook's change of control) once it is there
  // and the action queue is idle. The Move is given up after 8 seconds or if the zone fills.
  let pendingControl = null, controlTimer = 0;
  function summonToOpponent(g, target, action) {
    const p = window.player1, count = window.duel_links || window.speed || window.rush ? 3 : 5;
    const free = [...Array.from({ length: count }, (_, i) => [`m${i + 1}_select`, () => p[`m${i + 1}`]]),
      ...(window.links && !window.rush ? [['link_left_select', () => window.linkLeft], ['link_right_select', () => window.linkRight]] : [])]
      .find(([id, occupant]) => !occupant() && document.getElementById(id));
    if (!free || typeof window.chooseZone !== 'function') { announce('No free zone of yours to summon through.'); return; }
    window.player1.temp_arr = [];
    window.summoning_card = g.card; window.summoning_play = action;
    window.chooseZone.call(document.getElementById(free[0]));
    pendingControl = { card: g.card, name: cardInfo(g.card).name, occupant: free[1], zone: target.node, duelId: window.duelId, until: Date.now() + 8000 };
    announce('Summoning to your field, then moving it to your opponent’s.');
    clearTimeout(controlTimer); controlTimer = setTimeout(settleControl, 150);
  }
  function settleControl() {
    clearTimeout(controlTimer);
    const job = pendingControl; if (!job) return;
    if (Date.now() > job.until || window.duelId !== job.duelId) { pendingControl = null; announce('The card stayed on your field. Use Move to give it to your opponent.'); return; }
    const card = job.occupant();
    const ready = card && card.data('controller') === window.player1 && (same(card, job.card) || cardInfo(card).name === job.name) &&
      canPlay() && !pendingSelection() && typeof window.chooseZone === 'function';
    if (!ready) { controlTimer = setTimeout(settleControl, 150); return; }
    pendingControl = null;
    const index = job.zone?.id?.match(/^m(\d)_select2$/)?.[1];
    if (!index || window.player2?.[`m${index}`]) { announce('That opponent zone was taken. Use Move on the card.'); return; }
    let actions = [];
    try { actions = allowedActions(card); } catch (error) { console.warn('Spellspeed:', error); }
    if (!actions.includes('Move')) { announce('Move is not available for that card. Use its menu.'); return; }
    window.player1.temp_arr = [];
    window.summoning_card = card; window.summoning_play = 'Move';
    window.chooseZone.call(job.zone);
  }

  // Token drags use only empty main monster zones and the native summon command.
  let tokenGesture = null;
  function tokenReady() {
    return config.drag && canDrag() && !pendingSelection() && !workbench?.busy() && !window.awaiting_token &&
      typeof window.Card === 'function' && typeof window.chooseZone === 'function';
  }
  function tokenTargets() {
    const out = [];
    for (let i = 1; i <= (window.speed || window.rush ? 3 : 5); i++) {
      const node = document.getElementById('m' + i + '_select');
      if (window.player1?.['m' + i] || !node) continue;
      const rect = dropRect(node, 'monster'); if (rect) out.push({node, rect});
    }
    return out;
  }
  function cancelToken() {
    if (tokenGesture?.active) suppressClickUntil = Date.now() + 350;
    tokenGesture?.layer?.remove(); tokenGesture = null;
    document.documentElement.classList.toggle('dblite-dragging', false);
  }
  document.addEventListener('mousedown', event => {
    const button = event.target.closest?.('#duel .token_btn');
    if (!button || event.button !== 0 || !tokenReady() || !visible(button)) return;
    // Native tokenDownE opens its picker after a long press. A drag must not
    // start that timer (nor leave its body mouseup cleanup pending).
    event.preventDefault(); event.stopImmediatePropagation();
    tokenGesture = { x: event.clientX, y: event.clientY, player: window.player1, duel: window.duelId, active: false };
  }, true);
  // Cancel only the browser menu. Capture also covers panels whose own handlers
  // stop bubbling; native and DBETTER right-click actions still receive the event.
  document.addEventListener('contextmenu', event => {
    // Synthetic touch dispatch cannot open a browser menu. Its cancellation is
    // reserved for action handlers so the touch adapter can detect a handled tap.
    if (event.dbetterTouch) return;
    const target = event.target;
    if (!visible(document.getElementById('duel')) ||
        target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.chat,#chats,#duel_log,#watch_chat,#watchers,#online_users,.cout_txt,.cin_txt')) return;
    if (target.closest?.('#duel,#field,#duel_content,#view,.dblite-fan,.dblite-menu,.dblite-panel,.dblite-tools,.dblite-duel-tools,.dblite-view-settings,.dblite-card-search,.dblite-deck-wheel,.dblite-action-history')) event.preventDefault();
  }, true);
  // A right-click on anything but a card or a pile closes DuelingBook's own viewer, like its red × and Escape
  // (user, 2026-11-04). Picking and choosing viewers stay open.
  document.addEventListener('contextmenu', event => {
    if (event.dbetterTouch || event.button !== 2 || gesture || !window.duel_active || !window.viewing || /Picking|Choosing|shuffle/i.test(window.viewing) ||
        !visible(document.getElementById('view')) || !visible(document.querySelector('#view .exit_btn')) || typeof window.exitViewing !== 'function') return;
    if (event.target.closest?.('.card,#card_menu,.dblite-menu,.dblite-fan,.dblite-panel,#deck_hidden,#extra_hidden,#grave_hidden,#banished_hidden,input,textarea,select,.chat,#chats,#duel_log')) return;
    event.preventDefault(); window.exitViewing(event);
  });
  document.addEventListener('contextmenu', event => {
    const button = event.target.closest?.('#duel .token_btn');
    if (!button || !canPlay() || !visible(button)) return;
    event.preventDefault(); event.stopImmediatePropagation(); cancelToken(); window.showTokens?.();
  }, true);
  document.addEventListener('dblclick', event => {
    if (!config.drag || !event.target.closest?.('#duel .token_btn')) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  document.addEventListener('mousemove', event => {
    const g = tokenGesture; if (!g) return;
    if (!(event.buttons & 1) || !tokenReady() || g.player !== window.player1 || g.duel !== window.duelId) { cancelToken(); return; }
    if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 8) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!g.active) { g.active = true; g.layer = document.createElement('div'); g.layer.className = 'dblite-token-drag'; document.body.append(g.layer); document.documentElement.classList.toggle('dblite-dragging', true); }
    g.layer.replaceChildren(); g.target = null;
    for (const target of tokenTargets()) {
      const r = target.rect, selected = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      const marker = document.createElement('div'); marker.className = 'dblite-drop' + (selected ? ' dblite-selected' : ''); marker.textContent = 'Summon token'; marker.dataset.label = 'Summon token';
      const label = document.createElement('span'); label.className = 'dblite-drop-label'; label.textContent = marker.textContent; marker.replaceChildren(label);
      Object.assign(marker.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); g.layer.append(marker);
      if (selected) g.target = target.node;
    }
  }, true);
  window.addEventListener('mouseup', event => {
    const g = tokenGesture; if (!g || event.button !== 0) return;
    cancelToken(); if (!g.active) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = tokenTargets().find(t => t.node === g.target && event.clientX >= t.rect.left && event.clientX <= t.rect.right && event.clientY >= t.rect.top && event.clientY <= t.rect.bottom);
    if (!target || !tokenReady() || g.player !== window.player1 || g.duel !== window.duelId) return;
    const previous = { card: window.summoning_card, play: window.summoning_play, temp: g.player.temp_arr };
    try { window.summoning_card = new window.Card(); window.summoning_play = 'Summon token'; g.player.temp_arr = []; window.awaiting_token = true; window.chooseZone.call(target.node); }
    catch (error) { window.awaiting_token = false; announce('Token summon unavailable. Use the token button.'); }
    finally { window.summoning_card = previous.card; window.summoning_play = previous.play; g.player.temp_arr = previous.temp; }
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && tokenGesture) { event.preventDefault(); event.stopImmediatePropagation(); cancelToken(); } }, true);
  window.addEventListener('blur', cancelToken);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelToken(); });

  // Click-and-drop: a click (no movement) on a card in the Fan/Grid or Classic viewer picks it
  // up with the same drop targets as a drag; the next click on a zone drops it there. A click
  // elsewhere, a right-click or Escape puts it back. A second click on the card before it is
  // picked up is a double-click (declare). While a card is picked up the fan is click-through,
  // so a late second click on the card lands on the board: it is recognised by position.
  const pointIn = (node, event) => { const r = node?.getBoundingClientRect?.(); return !!r?.width && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom; };
  const onCard = (g, event) => g.focusTarget?.contains(event.target) || pointIn(g.focusTarget, event);
  document.addEventListener('mousedown', event => {
    const g = gesture;
    if (g?.armed) {
      if (event.button === 0 && onCard(g, event)) { clearTimeout(clickDropTimer); gesture = null; return; } // the native double-click follows
      if (event.button !== 0 || !pickUp(g, event)) { cleanDrag(); return; }
    }
    if (!g?.sticky) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.button === 0 && Date.now() - g.stickyAt < 300 && onCard(g, event)) {
      cleanDrag(); suppressClickUntil = Date.now() + 450;
      runDoubleClick(g.card, event); return;
    }
    let target = null;
    try { target = event.button === 0 && canGrab() && window.duelId === g.duelId && targetAt(g, event); } catch (error) { console.warn('Spellspeed drop target:', error); }
    cleanDrag();
    if (!target) return;
    const choices = summonChoices(g, target, { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey });
    if (choices.length > 1) { openPositionWheel(g, target, choices, event.clientX); return; }
    const keys = [event.shiftKey, event.ctrlKey, event.altKey, event.clientX];
    try { dropWhenIdle(g, () => executeDrop(g, target, ...keys)); }
    catch (error) { announce('Move unavailable. Use the card menu.'); console.warn('Spellspeed:', error); }
  }, true);
  document.addEventListener('contextmenu', event => { if (gesture?.sticky) { event.preventDefault(); event.stopImmediatePropagation(); cleanDrag(); } }, true);
  document.addEventListener('mousedown', event => {
    if (workbench?.busy()) return;
    if (pendingAttach) { cancelAttach(); return; }
    if (!config.drag || event.button !== 0 || !canGrab() || pendingSelection() ||
        event.target.closest('input,textarea,button,select,a,.card_menu_btn')) return;
    // Native pile hitboxes can sit above the card artwork. Resolve only the
    // current top card, without opening or rearranging the native viewer.
    const hitbox = event.target.closest('#deck_hidden,#grave_hidden,#banished_hidden,#extra_hidden');
    const pileKey = ({ deck_hidden: 'main_arr', grave_hidden: 'grave_arr', banished_hidden: 'banished_arr', extra_hidden: 'extra_arr' })[hitbox?.id];
    if (pileKey && window.viewing === directPiles[pileKey]) return;
    const card = pileKey ? window.player1[pileKey]?.[0] : ownCard(event.target);
    if (!card) return;
    const source = dragSource(card);
    if (!source) return;
    const pile = directPiles[source] && window.viewing !== directPiles[source] && !event.target.closest('#view,.dblite-fan') ? source : null;
    const candidate = { card, source, pile, cardId: card.data('id'), x: event.clientX, y: event.clientY, duelId: window.duelId, active: false, touch: !!event.dbetterTouch,
      focusTarget: event.target.closest('.dblite-fan-card') || card[0],
      hand: source === 'hand_arr' ? window.player1.hand_arr.map(card => ({ node: card[0], id: card.data('id') })) : null };
    if (source === 'material') { candidate.host = materialHost(card); candidate.hostId = candidate.host?.data('id'); candidate.materialView = window.viewing; }
    if (dragSourceUnchanged(candidate)) gesture = candidate;
  }, true);
  document.addEventListener('mousemove', event => {
    if (!gesture) return;
    const g = gesture;
    if (g.armed) {
      // Still over the card, it may become a double-click; leaving it picks the card up now.
      g.pointer = pointerOf(event);
      if (onCard(g, event)) return;
      if (!pickUp(g, event)) { cleanDrag(); return; }
    }
    if (!(event.buttons & 1) && !g.sticky || !config.drag || !canGrab() || window.duelId !== g.duelId) { cleanDrag(); return; }
    if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 8) return;
    try {
      if (!g.active && !beginDrag(g, event)) { cleanDrag(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      // Per move only the ghost and the highlighted zone change (phones, 2026-10-28: rebuilding every zone's label and
      // rewriting every zone's class on each move made dragging janky). Labels follow Shift / Ctrl / Alt.
      if (g.shift !== !!event.shiftKey || g.ctrl !== !!event.ctrlKey || g.alt !== !!event.altKey) drawTargets(g, event.shiftKey, event.ctrlKey, event.altKey);
      // Follow the pointer directly on the compositor; never ease the cursor.
      g.ghost.style.transform = `translate3d(${event.clientX + 18}px,${event.clientY + 18}px,0)`;
      const selected = targetAt(g, event);
      if (selected !== g.selected) { g.selected?.marker.classList.toggle('dblite-selected', false); selected?.marker.classList.toggle('dblite-selected', true); g.selected = selected; }
      duelTools?.markInsertion(g, event.clientX, selected);
    } catch (error) { cleanDrag(); console.warn('Spellspeed drag:', error); }
  }, true);
  window.addEventListener('mouseup', event => {
    if (!gesture || event.button !== 0) return;
    const g = gesture;
    let target;
    try { target = g.active && targetAt(g, event); }
    catch (error) { console.warn('Spellspeed drop target:', error); }
    finally { if (g.active || !startClickDrop(g, event)) cleanDrag(); }
    if (!g.active || g.sticky) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target) {
      const choices = summonChoices(g, target, { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey });
      if (choices.length > 1) { openPositionWheel(g, target, choices, event.clientX); return; }
      const keys = [event.shiftKey, event.ctrlKey, event.altKey, event.clientX];
      try { dropWhenIdle(g, () => executeDrop(g, target, ...keys)); }
      catch (error) { announce('Move unavailable. Use the card menu.'); console.warn('Spellspeed:', error); }
    }
  }, true);
  for (const type of ['click', 'dblclick']) document.addEventListener(type, event => {
    if (Date.now() < suppressClickUntil && !event.target.closest?.('.dblite-position-wheel')) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  }, true);
  document.addEventListener('dragstart', event => { if (gesture) event.preventDefault(); }, true);
  document.addEventListener('keydown', event => {
    if (event.target.closest?.('.dblite-card-search')) return;
    if (workbench?.allowsChat(event.target)) return;
    if (event.composedPath().some(node => node.localName === 'replay-scout')) return;
    if (event.key === 'Escape' && pendingAttach) {
      event.preventDefault(); event.stopImmediatePropagation(); cancelAttach(); return;
    }
    if (event.key === 'Escape' && deferred.length && !gesture?.active) {
      event.preventDefault(); event.stopImmediatePropagation(); cancelDeferred('Waiting moves cancelled.'); return;
    }
    if (event.key === 'Escape' && (gesture?.active || gesture?.armed)) {
      event.preventDefault(); event.stopImmediatePropagation(); cleanDrag(); return;
    }
    if (gesture?.active) {
      // Keep native keyboard shortcuts and fan keyboard focus from starting a
      // second action while the pointer owns this card. Modifiers still work.
      if (['Shift', 'Control', 'Alt'].includes(event.key)) drawTargets(gesture, event.shiftKey, event.ctrlKey, event.altKey);
      if (!event.metaKey && !event.ctrlKey) event.preventDefault();
      event.stopImmediatePropagation(); return;
    }
    if (event.key === 'Escape' && workbench?.escape(event.composedPath().some(typingAt))) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (event.key === 'Escape' && !event.repeat && !event.composedPath().some(typingAt) && window.duel_active && window.viewing &&
        !/Picking|Choosing|shuffle/i.test(window.viewing) &&
        visible(document.getElementById('view')) &&
        visible(document.querySelector('#view .exit_btn')) && typeof window.exitViewing === 'function') {
      event.preventDefault(); event.stopImmediatePropagation(); cleanDrag();
      window.exitViewing(event); return;
    }
  }, true);
  document.addEventListener('keyup', event => {
    if (!gesture?.active) return;
    if (['Shift', 'Control', 'Alt'].includes(event.key)) drawTargets(gesture, event.shiftKey, event.ctrlKey, event.altKey);
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointercancel', cleanDrag, true);
  window.addEventListener('blur', () => { cleanDrag(); cancelAttach(); });
  window.addEventListener('resize', cleanDrag);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cleanDrag(); cancelAttach(); } });

  document.addEventListener('dblclick', event => {
    if (workbench?.busy()) return;
    if (pendingAttach || (!config.doubleClick && !config.declare) || !canPlay() || pendingSelection() ||
        Date.now() < suppressClickUntil || gesture?.active ||
        event.target.closest?.('input,textarea,button,select,a,.card_menu_btn') ||
        typeof window.cardMenuClicked !== 'function') return;
    const pile = event.target.closest?.('#deck_hidden,#extra_hidden,#grave_hidden,#banished_hidden');
    let zone = ({ deck_hidden: 'Deck', extra_hidden: 'Extra Deck', grave_hidden: 'Graveyard', banished_hidden: 'Banished' })[pile?.id];
    // A pile's real top card can receive the click instead of its hitbox.
    if (!zone && window.viewing && !event.target.closest?.('#view,.dblite-fan')) {
      const card = ownCard(event.target);
      if (card?.[0]?.closest('#field')) zone = Object.entries({ Deck: 'main_arr', 'Extra Deck': 'extra_arr', Graveyard: 'grave_arr', Banished: 'banished_arr' })
        .find(([label, key]) => label !== window.viewing && includes(window.player1?.[key], card))?.[0];
    }
    if (zone) {
      if (!config.doubleClick || !config.doubleClickPiles || !workbench?.openPile(zone)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    runDoubleClick(ownCard(event.target), event);
  }, true);
  // Double-click on one of your cards: flip / activate a Set card, or Declare (hand, field, GY,
  // banished, a face-up Pendulum in the Extra Deck). Handled events are consumed.
  function runDoubleClick(card, event) {
    const p = window.player1;
    if (workbench?.busy() || pendingAttach || (!config.doubleClick && !config.declare) || !canPlay() || pendingSelection() ||
        typeof window.cardMenuClicked !== 'function') return;
    if (!card || card.data('controller') !== p || card.data('fake_card') || card.hasClass('xyzmaterial')) return;
    const front = card.data('cardfront');
    const faceUpPendulumExtra = includes(p.extra_arr, card) && !card.data('face_down') &&
      front?.data('card_type') === 'Monster' && !!front.data('pendulum');
    if (!(faceUpPendulumExtra || cardInfo(card).onField ||
        [p.hand_arr, p.grave_arr, p.banished_arr].some(arr => includes(arr, card)))) return;
    try {
      const actions = allowedActions(card);
      const setOnField = cardInfo(card).onField && card.data('face_down');
      const action = setOnField ? (config.doubleClick && config.doubleClickSet && ['Flip', 'Activate ST', 'Activate Field Spell'].find(a => actions.includes(a))) :
        (config.declare && actions.includes('Declare') && 'Declare');
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      window.cardMenuClicked(card, action, event);
    } catch (error) { announce('Action unavailable. Use the card menu.'); console.warn('Spellspeed:', error); }
  }

  function nativeMotionEnabled() {
    return (config.animations && config.cardMotion) && window.duel_active && !window.resetting && !conflict();
  }
  function clearChance() {
    if (!chanceView) return;
    chanceView.observer.disconnect();
    chanceView.native.classList.toggle('dblite-chance-native', false);
    chanceView.node.remove(); chanceView = null;
  }
  function positionChance() {
    if (!chanceView) return;
    const board = document.getElementById('content') || document.getElementById('duel');
    const rect = board?.getBoundingClientRect();
    if (!rect?.width) return;
    Object.assign(chanceView.node.style, { left: `${rect.left + rect.width / 2}px`,
      top: `${rect.top + rect.height * .48}px`,
      transform: `translate(-50%,-50%) scale(${Math.min(1.2, Math.max(.7, rect.width / 1024))})` });
  }
  function showChance(kind, player, result, native) {
    clearChance();
    const node = document.createElement('div'); node.className = `dblite-chance dblite-chance-${kind}`;
    node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
    const stage = document.createElement('div'); stage.className = 'dblite-chance-stage'; stage.setAttribute('aria-hidden', 'true');
    const pose = document.createElement('div'); pose.className = 'dblite-chance-pose'; stage.append(pose);
    const object = document.createElement('div'); object.className = 'dblite-chance-object'; pose.append(object);
    if (kind === 'die') {
      const rotations = [[0,0],[0,-90],[-90,0],[90,0],[0,90],[0,180]];
      object.style.setProperty('--rx', rotations[result-1][0]+'deg'); object.style.setProperty('--ry', rotations[result-1][1]+'deg');
      const pips = [[4],[0,8],[0,4,8],[0,2,6,8],[0,2,4,6,8],[0,2,3,5,6,8]];
      for (let face=1; face<=6; face++) {
        const side = document.createElement('div'); side.className = 'dblite-die-face'; side.dataset.face = face;
        for (let i=0;i<9;i++) { const pip=document.createElement('i'); if (!pips[face-1].includes(i)) pip.style.visibility='hidden'; side.append(pip); }
        object.append(side);
      }
    } else {
      object.style.setProperty('--ry', result==='tails'?'180deg':'0deg');
      for (const [side,letter] of [['heads','H'],['tails','T']]) {
        const face=document.createElement('div'); face.className='dblite-coin-face '+side; face.textContent=letter; object.append(face);
      }
      for (let z=-2;z<=2;z++) {
        const edge=document.createElement('div'); edge.className='dblite-coin-edge'; edge.style.transform=`translateZ(${z}px)`; object.append(edge);
      }
    }
    const caption=document.createElement('div'); caption.className='dblite-chance-caption';
    const actor=document.createElement('span'); actor.textContent=player?.username || 'Player';
    const value=document.createElement('strong'); value.textContent=kind==='die'?`Rolled ${result}`:result==='heads'?'Heads':'Tails';
    caption.append(actor,value);node.append(stage,caption);document.body.append(node);
    const observer=new MutationObserver(() => { if (chanceView?.node===node && (!native.isConnected || native.style.display==='none')) clearChance(); });
    chanceView={node,native,observer,duelId:window.duelId};
    native.classList.toggle('dblite-chance-native', true);observer.observe(native,{attributes:true,attributeFilter:['style']});positionChance();
  }
  function chanceEffects() {
    const enabled=(config.animations && config.cardMotion) && window.duel_active && !window.resetting && !window.paused && !conflict();
    if (chanceView && (!enabled || document.hidden || chanceView.duelId!==window.duelId || !visible(chanceView.native.parentElement) || chanceView.native.style.display==='none')) clearChance();
    for (const [name,kind] of [['dieRoll','die'],['coinFlip','coin']]) {
      const original=window[name];
      if (typeof original!=='function' || rules.hasHook(original, wrappers.get(name))) continue;
      const wrapped=function(player,data,...rest) {
        // A rewind applies plays at once: an overlay made then would be on the change tape and removed outside it.
        if (window.DBETTERRebuilding) return original.call(this,player,data,...rest);
        const result=data?.result, native=document.getElementById(kind);
        const valid=kind==='die'?Number.isInteger(Number(result)) && Number(result)>=1 && Number(result)<=6:['heads','tails'].includes(result);
        const active=(config.animations && config.cardMotion) && window.duel_active && !window.resetting && !window.paused && !document.hidden && !conflict() && native && valid;
        const returned=original.call(this,player,data,...rest);
        // Native timers/tweens still log the server result and complete its queue.
        if (active && native.style.display!=='none') showChance(kind,player,kind==='die'?Number(result):result,native);
        return returned;
      };
      rules.markHook(wrapped, original); wrappers.set(name,wrapped);window[name]=wrapped;
    }
  }
  for (const eventName of ['mousedown', 'click', 'dblclick']) document.addEventListener(eventName, event => {
    const button = event.target.closest?.('#die_btn,#coin_btn'); if (!button) return;
    const native = document.getElementById(button.id === 'die_btn' ? 'die' : 'coin');
    if (native && visible(native) && native.style.display !== 'none') { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('resize',positionChance);
  window.addEventListener('scroll',positionChance,true);
  function motionTargets(target) {
    let nodes;
    try {
      nodes = typeof target === 'string' ? [...document.querySelectorAll(target)] :
        target?.nodeType === 1 ? [target] : Array.from(target || []);
    } catch { return false; }
    return nodes.length > 0 && nodes.every(node => node?.nodeType === 1 &&
      node.closest('#duel,#field,#duel_content') && !node.closest('.dblite-fan,.dblite-menu,.dblite-panel'));
  }
  function motionVars(target, duration, vars) {
    // Only adjust visible interpolation. Preserve per-tween timing, delays,
    // callbacks, queue ownership, repeat cycles and non-DOM counters. The
    // shared GSAP clock below accelerates related native tweens together.
    if (!nativeMotionEnabled() || !(duration > .04) || !vars || typeof vars !== 'object' ||
        vars.repeat || vars.yoyo || vars.bezier || vars.onUpdate || !motionTargets(target)) return vars;
    const values = vars.css || vars;
    if (typeof values !== 'object') return vars;
    const spatial = ['left','top','x','y','scale','scaleX','scaleY','rotation','rotationX','rotationY'].some(key => key in values);
    const fade = ['opacity','alpha','autoAlpha'].some(key => key in values);
    if (!spatial && !fade) return vars;
    const nodes = typeof target === 'string' ? document.querySelectorAll(target) : target?.nodeType === 1 ? [target] : target;
    const node = nodes?.length === 1 ? nodes[0] : null;
    if (node && ['ss_glow', 'ss_spiral'].includes(node.id)) {
      // These two native layers are decorative. Keep their queue/reset
      // callbacks and timing, but replace the sixfold spinning burst with
      // two gentle rings. The summoned card's movement is unchanged.
      const effect = { ...values };
      if ('scale' in effect && effect.scale > 1) effect.scale = node.id === 'ss_glow' ? 2.3 : 2.75;
      if ('rotation' in effect) effect.rotation = 0;
      return { ...vars, ...(vars.css ? { css: effect } : effect), ease: spatial ? progress => 1 - Math.pow(1 - progress, 3) : smoothEase };
    }
    // Endpoint-only interpolation removes travel for reduced-motion users
    // without completing callbacks early or revealing future game state.
    return { ...vars, ease: reducedMotion?.matches && spatial ? stillEase : smoothEase };
  }
  function restoreMotionSpeed() {
    if (speedApplied && speedOwner.globalTimeScale() === motionSpeed) speedOwner.globalTimeScale(oldSpeed);
    speedApplied = false; speedOwner = null;
  }
  function summonColors(card) {
    const palette = rules.cardPalette(card.data('cardfront'), !!card.data('face_down'));
    for (const node of document.querySelectorAll('#ss_glow,#ss_spiral')) {
      node.style.setProperty('--dblite-summon-color', palette.primary);
      node.style.setProperty('--dblite-summon-secondary', palette.secondary);
    }
  }
  function moveSummonContext(p, data) {
    if (!/^(?:M-?[1-5]|(?:Left|Right) (?:EMZ|Extra Monster Zone))$/.test(data?.zone || '')) return null;
    const card = [p, ...(window.solo ? [p?.opponent] : [])].flatMap(actor => [1, 2, 3, 4, 5].map(i => actor?.['s' + i]))
      .find(card => card?.data('id') === data.id);
    return card ? { type: 'move', card, cardId: data.id, duel: window.duelId, player: window.player1 } : null;
  }
  function validMoveSummon(effect) {
    const card = effect.card;
    return nativeMotionEnabled() && !reducedMotion?.matches && effect.duel === window.duelId && effect.player === window.player1 &&
      card?.[0]?.isConnected && card.data('id') === effect.cardId &&
      [window.player1, window.player2].flatMap(p => [1, 2, 3, 4, 5].map(i => p?.['m' + i]))
        .concat(window.linkLeft, window.linkRight).some(host => same(host, card));
  }
  function clearMoveSummons() {
    for (const effect of moveSummonEffects) if (!validMoveSummon(effect) || Date.now() >= effect.until) {
      effect.node.remove(); moveSummonEffects.delete(effect);
    }
  }
  function playMoveSummon(effect) {
    if (!validMoveSummon(effect)) return;
    for (const old of moveSummonEffects) if (same(old.card, effect.card)) { old.node.remove(); moveSummonEffects.delete(old); }
    const field = document.getElementById('field'); if (!field) return;
    const node = document.createElement('div'), card = effect.card;
    node.className = 'dblite-move-summon'; node.setAttribute('aria-hidden', 'true');
    const palette = rules.cardPalette(card.data('cardfront'), !!card.data('face_down'));
    node.style.setProperty('--dblite-summon-color', palette.primary); node.style.setProperty('--dblite-summon-secondary', palette.secondary);
    Object.assign(node.style, { left: card.css('left'), top: card.css('top'), zIndex: String(Math.max(0, (parseInt(card.css('z-index'), 10) || 1) - 1)) });
    node.append(document.createElement('i'), document.createElement('i')); field.append(node);
    const active = { ...effect, node, until: Date.now() + 950 }; moveSummonEffects.add(active);
    const finish = () => { node.remove(); moveSummonEffects.delete(active); };
    node.lastElementChild.addEventListener('animationend', finish, { once: true }); setTimeout(finish, 1000);
  }
  function animations() {
    window.DBETTERConstructor?.tick();
    const tween = window.TweenMax;
    const active = nativeMotionEnabled();
    document.documentElement.classList.toggle('dblite-smooth-motion', (config.animations && config.cardMotion) && !conflict());
    document.documentElement.classList.toggle('dblite-declare-off', !config.animations || !config.declareGlow || conflict());
    document.documentElement.classList.toggle('dblite-motion-off', !(config.animations && config.cardMotion) || conflict());
    document.documentElement.classList.toggle('dblite-summon-motion', active);
    document.documentElement.classList.toggle('dblite-hide-spiral', config.hideSummonSpiral);
    clearMoveSummons();
    for (const name of ['specialSummon', 'summonToken', 'move']) {
      const summon = window[name];
      if (!active || typeof summon !== 'function' || rules.hasHook(summon, wrappers.get(name))) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return summon.apply(this, args);
        const previous = summonContext;
        summonContext = nativeMotionEnabled() ? (name === 'move' ? moveSummonContext(...args) : { type: name }) : null;
        try { return summon.apply(this, args); } finally { summonContext = previous; }
      };
      wrapped.dbliteHistoryHook = summon.dbliteHistoryHook;
      rules.markHook(wrapped, summon); wrappers.set(name, wrapped); window[name] = wrapped;
    }
    const accelerate = active && !window.replay && !/^(rps|tp)_/.test(window.currentLabel || '') && Number(window.turnCount ?? 1) > 0;
    if (speedApplied && (!accelerate || speedOwner !== tween)) restoreMotionSpeed();
    if (tween && typeof tween.globalTimeScale === 'function') {
      if (accelerate && !speedApplied) {
        oldSpeed = tween.globalTimeScale(); speedOwner = tween;
        tween.globalTimeScale(motionSpeed); speedApplied = true;
      }
    }
    for (const [method, hook] of motionHooks) {
      if (!active || hook.owner !== tween) {
        if (hook.owner[method] === hook.wrapped) hook.owner[method] = hook.original;
        motionHooks.delete(method);
      }
    }
    if (active && tween) for (const method of ['to', 'from', 'fromTo']) {
      const original = tween[method];
      if (typeof original !== 'function' || rules.hasHook(original, motionHooks.get(method)?.wrapped)) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        const index = method === 'fromTo' ? 3 : 2;
        args[index] = motionVars(args[0], args[1], args[index]);
        const vars = args[index], card = args[0];
        // Apply this card's palette on arrival, alongside the native effect.
        // Keep the native reveal, callback receiver and queue timing intact.
        if (summonContext?.type === 'summonToken' && !summonContext.bound && method === 'to' && card?.hasClass?.('card') && vars?.scale === .1485 && 'left' in vars && 'top' in vars) {
          // newDuelCard first scales a recycled card with its previous front.
          // The placement tween follows Token initialization.
          summonContext.bound = true; summonColors(card);
        } else if (summonContext && !summonContext.bound && method === 'to' && card?.hasClass?.('card') &&
            typeof vars?.onComplete === 'function' && vars.scale === .1485 && 'left' in vars && 'top' in vars) {
          const context = summonContext;
          summonContext.bound = true;
          const complete = vars.onComplete;
          args[index] = { ...vars, onComplete: function (...params) {
            if (context.type === 'move') playMoveSummon(context);
            else if (nativeMotionEnabled()) summonColors(card);
            return complete.apply(this, params);
          } };
        }
        return original.apply(this, args);
      };
      rules.markHook(wrapped, original); motionHooks.set(method, { owner: tween, original, wrapped }); tween[method] = wrapped;
    }
    if (!animationStyle) {
      animationStyle = document.createElement('style'); document.head.appendChild(animationStyle);
    }
    const animationCss = active ? '#select_zones.glowing>div{animation:none!important}' : '';
    if (animationStyle.textContent !== animationCss) animationStyle.textContent = animationCss;
    for (const name of ['startChooseMonsterZones', 'startChooseMonsterZones2', 'startChooseSpellZones',
      'startChooseSTZones', 'startChooseExtraZones', 'startChooseFieldSpellZones']) {
      const original = window[name];
      if (typeof original !== 'function' || rules.hasHook(original, wrappers.get(name)) || conflict()) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        const result = original.apply(this, args);
        if (nativeMotionEnabled()) for (const node of document.querySelectorAll('#select_zones > div')) {
          if (visible(node)) {
            const clip = window[node.id]; if (typeof clip?.stop === 'function') clip.stop();
          }
        }
        return result;
      };
      rules.markHook(wrapped, original); wrappers.set(name, wrapped); window[name] = wrapped;
    }
  }
  reducedMotion?.addEventListener?.('change', () => tick());
  window.addEventListener('pagehide', restoreMotionSpeed);

  function spectatorCounters() {
    if (!window.duel_active || window.duelist || window.replay || window.solo || window.unknown_totals ||
        !visible(document.getElementById('duel')) || !visible(document.getElementById('field_content'))) return;
    // Solo mode hides the upper labels. Joining an ongoing duel bypasses the
    // turn-order screen that normally shows them again. Keep native text and
    // positioning; only restore known pile totals during live spectating.
    const players = [typeof window.Player1 === 'function' ? window.Player1() : window.player1,
      typeof window.Player2 === 'function' ? window.Player2() : window.player2];
    const goat = ['gr', 'gu'].includes(window.duelFormat) ||
      (typeof window.isGoat === 'function' && window.isGoat());
    players.forEach((player, index) => {
      for (const [prefix, key] of [['cid', 'main_arr'], ['cie', 'extra_arr']]) {
        if (!Array.isArray(player?.[key]) || (prefix === 'cie' && goat)) continue;
        const node = document.getElementById(`${prefix}${index + 1}_txt`);
        if (node && /^\d+$/.test(node.textContent.trim()) && getComputedStyle(node).display === 'none') $(node).show();
      }
    });
  }

  function updateCardLink() {
    const preview = window.preview, node = preview?.[0];
    const name = preview?.data?.('name');
    const url = name !== 'preview' && !preview?.data?.('custom') ? rules.cardUrl(name) : null;
    if (!url || !window.duel_active || !visible(document.getElementById('duel')) || !visible(node)) {
      if (cardLink) { cardLink.hidden = true; cardLink.removeAttribute('href'); }
      return;
    }
    if (!cardLink) {
      cardLink = document.createElement('a'); cardLink.id = 'dblite-card-link';
      cardLink.textContent = 'YGOR ↗'; cardLink.target = '_blank'; cardLink.rel = 'noopener noreferrer';
      cardLink.addEventListener('click', event => { updateCardLink(); if (cardLink.hidden) event.preventDefault(); event.stopPropagation(); });
    }
    // Stay inside DB's transformed preview, below native chat/log windows.
    if (cardLink.parentNode !== node) node.appendChild(cardLink);
    cardLink.href = url; cardLink.title = `Look up ${name} on YGOResources`;
    cardLink.setAttribute('aria-label', cardLink.title);
    const rect = node.getBoundingClientRect();
    // Cancel preview/board scaling so the link retains its readable screen size.
    const scaleX = rect.width / node.offsetWidth || 1, scaleY = rect.height / node.offsetHeight || 1;
    const inverseX = Number.isFinite(scaleX) && scaleX > 0 ? 1 / scaleX : 1;
    const inverseY = Number.isFinite(scaleY) && scaleY > 0 ? 1 / scaleY : 1;
    cardLink.style.left = `${4 * inverseX}px`;
    cardLink.style.bottom = `${4 * inverseY}px`;
    cardLink.style.transform = `scale(${inverseX}, ${inverseY})`;
    cardLink.hidden = false;
  }
  let previewSource = null, redirectedScroll = null;
  function stopDescriptionScroll() {
    if (redirectedScroll?.viewport.isConnected) {
      const viewport = redirectedScroll.viewport;
      viewport.scrollTo?.({ top: viewport.scrollTop, behavior: 'instant' });
    }
    redirectedScroll = null;
  }
  // Gate writes on these image instances only. Native copyCard/jQuery keep their
  // nodes and handlers, while both .src and .attr('src', ...) stage offscreen.
  const previewImageStates = new WeakMap(), previewReplacements = new WeakMap();
  let previewObserved = null, previewImages = [];
  function protectPreviewImage(img) {
    if (previewImageStates.has(img)) return;
    const state = { wanted: img.getAttribute('src'), generation: 0 };
    previewImageStates.set(img, state);
    const set = img.setAttribute, descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const stage = value => {
      value = String(value);
      if (state.wanted === value) return;
      state.wanted = value; const generation = ++state.generation;
      previewReplacements.delete(img);
      if (value === img.getAttribute('src')) return;
      const safe = rules.pageImage(value); if (!safe) return;
      const candidate = new Image(); candidate.src = safe;
      rules.imageReady(candidate).then(ok => {
        if (generation !== state.generation) return;
        if (!ok) { state.wanted = img.getAttribute('src'); return; }
        if (!previewObserved?.contains(img)) return;
        set.call(img, 'src', value);
      });
    };
    img.setAttribute = function (name, value) { if (String(name).toLowerCase() === 'src') stage(value); else set.call(this, name, value); };
    Object.defineProperty(img, 'src', { configurable: true, get() { return descriptor.get.call(this); }, set: stage });
  }
  function reconcilePreviewImages() {
    if (!window.document || !previewObserved?.isConnected) return;
    const current = [...previewObserved.querySelectorAll('img')];
    current.forEach((img, index) => {
      const old = previewImages[index];
      if (old && old !== img && !old.isConnected) {
        // A native replacement also keeps the actual old image, not a fresh clone.
        img.replaceWith(old); previewReplacements.set(old, img);
        rules.imageReady(img).then(ok => {
          if (!ok || !previewObserved?.contains(old) || previewReplacements.get(old) !== img) return;
          old.replaceWith(img); protectPreviewImage(img);
          previewImages = [...previewObserved.querySelectorAll('img')];
        });
      } else protectPreviewImage(img);
    });
    previewImages = [...previewObserved.querySelectorAll('img')];
  }
  const artworkPreviewObserver = new MutationObserver(reconcilePreviewImages);
  function cardPreview() {
    const node = document.getElementById('preview');
    if (node !== previewObserved) {
      artworkPreviewObserver.disconnect(); previewObserved = node; previewImages = [];
      if (node) artworkPreviewObserver.observe(node, { subtree: true, childList: true });
    }
    reconcilePreviewImages();
    const original = window.previewFront;
    if (typeof original === 'function' && !rules.hasHook(original, previewHook)) {
      previewHook = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        if (previewSource !== args[0]?.[0]) stopDescriptionScroll();
        reconcilePreviewImages();
        const result = original.apply(this, args);
        reconcilePreviewImages();
        previewSource = args[0]?.[0] || null; updateCardLink(); return result;
      };
      rules.markHook(previewHook, original); window.previewFront = previewHook;
    }
    updateCardLink();
  }
  // Lift cards only while their native movement tween is active.
  const travelHooks = new Map(), travelling = new Map();
  function travelCards(target, depth = 0) {
    if (depth > 3) return [];
    if (typeof target === 'string') { try { return travelCards(document.querySelectorAll(target), depth + 1); } catch { return []; } }
    if (target?.nodeType === 1) return target.matches('.card') && target.closest('#duel') && !target.closest('.dblite-fan') ? [target] : [];
    return target && typeof target.length === 'number' ? [...new Set(Array.from(target).flatMap(n => travelCards(n, depth + 1)))] : [];
  }
  function fieldLayers() {
    const field = document.getElementById('field'), stats = document.getElementById('field_stats');
    if (!field || !stats || field.closest('#duel') !== stats.closest('#duel')) return;
    // Stats belong above stationary field cards. Only travelling cards rise
    // above that layer; putting stats inside field also preserves Safari's context.
    if (stats.parentElement !== field) field.append(stats);
    const engine = window.TweenMax;
    for (const [node, tokens] of travelling) {
      const live = engine?.getTweensOf?.(node);
      for (const token of tokens) if (!node.isConnected || token.engine !== engine || live && token.tween && !live.includes(token.tween)) tokens.delete(token);
      if (!tokens.size) { node.classList.toggle('dblite-card-travelling', false); travelling.delete(node); }
    }
    if (!engine) return;
    for (const method of ['to','from','fromTo']) {
      const original = engine[method];
      if (typeof original !== 'function' || rules.hasHook(original, travelHooks.get(method)?.wrapped)) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        const index = method === 'fromTo' ? 3 : 2, vars = args[index], values = vars?.css || vars;
        const cards = args[1] > 0 && values && ['left','top','x','y'].some(k => k in values) ? travelCards(args[0]) : [];
        if (!cards.length) return original.apply(this, args);
        const token = { engine, tween: null };
        const clear = () => cards.forEach(node => { const tokens = travelling.get(node); tokens?.delete(token); if (!tokens?.size) { travelling.delete(node); node.classList.toggle('dblite-card-travelling', false); } });
        args[index] = { ...vars, onStart: function (...params) {
          for (const node of cards) { if (!travelling.has(node)) travelling.set(node, new Set()); travelling.get(node).add(token); node.classList.toggle('dblite-card-travelling', true); }
          return vars.onStart?.apply(this, params);
        }, onComplete: function (...params) { clear(); return vars.onComplete?.apply(this, params); } };
        try { token.tween = original.apply(this, args); return token.tween; } catch (error) { clear(); throw error; }
      };
      rules.markHook(wrapped, original); travelHooks.set(method, { engine, wrapped }); engine[method] = wrapped;
    }
  }
  let replayRate = 1, replayRateControl, replayClock, replayClockBefore, replayClockApplied, replayStepClock;
  try { replayRate = [1,2,4,8,16].includes(Number(localStorage.getItem('dbetter-replay-rate'))) ? Number(localStorage.getItem('dbetter-replay-rate')) : 1; } catch {}
  // Replay effects have several independent clocks. Keep timer ownership through
  // callbacks rather than accelerating unrelated UI, network or GSAP ticker timers.
  const replayTimers = new Map(), replayObjects = new Map(), replayHooks = new Map();
  const replayTimeout = window.setTimeout.bind(window), replayClear = window.clearTimeout.bind(window);
  let replayEffectDepth = 0, replayStepTimer = false, replayAppliedRate = 1;
  const replayFactor = () => config.replay && config.replaySpeed && window.replay && window.fast_forwarding && !window.paused && window.replay_arr?.length ? replayRate : 1;
  function replayEffect(callback, receiver, args) {
    if (window.DBETTERRebuilding) return callback.apply(receiver, args);
    replayEffectDepth++;
    try { return callback.apply(receiver, args); } finally { replayEffectDepth--; }
  }
  function scheduleReplayTimer(record) {
    record.at = performance.now(); record.rate = replayFactor();
    record.handle = replayTimeout(() => {
      if (!replayTimers.has(record.id)) return;
      if (!record.interval) { replayTimers.delete(record.id); replayClear(record.id); }
      else record.remaining = record.delay;
      record.executing = true;
      try { replayEffect(record.callback, window, record.args); }
      finally { record.executing = false; if (record.interval && replayTimers.has(record.id)) scheduleReplayTimer(record); }
    }, record.remaining / record.rate);
  }
  for (const name of ['setTimeout', 'setInterval']) {
    const original = window[name];
    window[name] = function (callback, delay, ...args) {
      if (!window.replay || !replayEffectDepth || replayStepTimer || typeof callback !== 'function') return original.call(window, callback, delay, ...args);
      const record = { callback, args, delay: Math.max(0, Number(delay) || 0), interval: name === 'setInterval' };
      record.remaining = record.delay;
      // Reserve a browser handle until completion so it cannot be reused by
      // another timer; preserve clearInterval(timeout) and clearTimeout(interval).
      record.id = replayTimeout(() => {}, 2147483647);
      replayTimers.set(record.id, record); scheduleReplayTimer(record); return record.id;
    };
  }
  for (const name of ['clearTimeout', 'clearInterval']) {
    const original = window[name];
    window[name] = function (id) {
      const record = replayTimers.get(id);
      if (record) { replayClear(record.handle); replayTimers.delete(id); }
      return original.call(window, id);
    };
  }
  function replayObject(object, property, rate = replayFactor()) {
    if (!object || !Number.isFinite(object[property])) return;
    let entry = replayObjects.get(object);
    if (!entry && rate === 1) return;
    if (!entry) { entry = { property, before: object[property], applied: object[property] }; replayObjects.set(object, entry); }
    // Respect changes made by another owner.
    if (object[property] !== entry.applied) entry.before = object[property];
    entry.applied = entry.before * rate;
    try { object[property] = entry.applied; } catch { replayObjects.delete(object); }
    if (rate === 1) replayObjects.delete(object);
  }
  function replayVisuals() {
    if (!window.replay) return;
    for (const animation of document.getAnimations?.() || []) {
      const target = animation.effect?.target, node = target?.element || target;
      if (node?.closest?.('#duel,#field,#duel_content,#view,.dblite-fan,.dblite-declare-glow')) replayObject(animation, 'playbackRate');
    }
  }
  for (const type of ['animationstart', 'transitionrun']) document.addEventListener(type, replayVisuals, true);
  // Web Animations (including workbench tile travel) can start between ticks.
  if (typeof Element.prototype.animate === 'function') {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.closest('#duel,#field,#duel_content,#view,.dblite-fan,.dblite-declare-glow')) replayObject(animation, 'playbackRate');
      return animation;
    };
  }
  function replayTimingHooks() {
    if (!window.replay) return;
    for (const name of ['performNextAction', 'duelResponse', 'duelResponse2', 'pickFirstResponse', 'duelStart',
      'simultaneousDraw', 'declare', 'targetCardResponse', 'shuffleDeck', 'shuffleHand2', 'updateLifePoints', 'dieRoll', 'coinFlip', 'playSound',
      'fastE', 'pauseE', 'pauseReplayE', 'playE', 'playReplayE', 'nextE', 'exitReplay', 'exitReplayE', 'duelOver']) {
      const original = window[name];
      if (typeof original !== 'function' || rules.hasHook(original, replayHooks.get(name))) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        try { return window.replay ? replayEffect(original, this, args) : original.apply(this, args); }
        finally {
          replaySpeed();

        }
      };
      rules.markHook(wrapped, original); replayHooks.set(name, wrapped); window[name] = wrapped;
    }
    // GSAP globalTimeScale drives both seconds and useFrames roots, including
    // TweenLite, TimelineMax and delayedCall. Wrap callbacks only: never divide
    // their durations as well (which would apply the selected rate twice).
    for (const engine of new Set([window.TweenMax, window.TweenLite, window.TimelineMax?.prototype, window.TimelineLite?.prototype])) {
      if (!engine) continue;
      for (const method of ['to', 'from', 'fromTo', 'set', 'delayedCall', 'call']) {
        const original = engine[method], key = original?.dbliteReplayTiming;
        if (typeof original !== 'function' || key || rules.hasHook(original, 'dbliteReplayTiming')) continue;
        const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
          if (window.replay) {
            if (method === 'delayedCall' || method === 'call') {
              const index = method === 'call' ? 0 : 1, callback = args[index];
              if (typeof callback === 'function') args[index] = function (...values) { return replayEffect(callback, this, values); };
            } else {
              const index = method === 'fromTo' ? 3 : method === 'set' ? 1 : 2, vars = args[index];
              if (vars && typeof vars === 'object') {
                args[index] = { ...vars };
                for (const key of ['onStart', 'onUpdate', 'onComplete', 'onRepeat', 'onReverseComplete']) if (typeof vars[key] === 'function')
                  args[index][key] = function (...values) { return replayEffect(vars[key], this, values); };
              }
            }
          }
          // GSAP's fallback ticker is a scheduler, not an effect delay. In
          // particular, speeding it would accelerate useFrames twice.
          const depth = replayEffectDepth; replayEffectDepth = 0;
          try { return original.apply(this, args); } finally { replayEffectDepth = depth; }
        };
        wrapped.dbliteReplayTiming = true; rules.markHook(wrapped, original); engine[method] = wrapped;
      }
    }
    const jq = window.jQuery;
    if (jq?.speed && !rules.hasHook(jq.speed, 'dbliteReplayTiming')) {
      const original = jq.speed;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        const options = original.apply(this, args);
        if (window.replay && replayEffectDepth) {
          options.dbliteReplayRate = replayFactor();
          options.duration /= options.dbliteReplayRate;
          const complete = options.complete;
          if (complete) options.complete = function (...values) { return replayEffect(complete, this, values); };
        }
        return options;
      };
      wrapped.dbliteReplayTiming = true; rules.markHook(wrapped, original); jq.speed = wrapped;
    }
  }
  function replayJquery() {
    // jQuery exposes in-flight animation clocks here; retain elapsed progress
    // when switching speed, including stopping/pausing fast-forward.
    for (const timer of window.jQuery?.timers || []) {
      if (!timer.elem?.closest?.('#duel,#field,#duel_content') || !timer.anim) continue;
      const anim = timer.anim, prior = anim.dbliteReplayRate || anim.opts?.dbliteReplayRate || 1, rate = replayFactor();
      if (prior !== rate) {
        const now = Date.now(), elapsed = now - anim.startTime;
        anim.startTime = now - elapsed * prior / rate; anim.duration *= prior / rate; anim.dbliteReplayRate = rate;
      }
    }
  }
  function replaySpeed() {
    if (window.DBETTERRebuilding) return;
    const rate = replayFactor();
    if (rate !== replayAppliedRate) {
      for (const record of replayTimers.values()) {
        if (record.executing) continue;
        record.remaining = Math.max(0, record.remaining - (performance.now() - record.at) * record.rate);
        replayClear(record.handle); scheduleReplayTimer(record);
      }
      for (const [object, entry] of replayObjects) replayObject(object, entry.property, rate);
      replayAppliedRate = rate;
    }
    replayVisuals(); replayJquery();
    for (const audio of window.audio_arr || []) {
      const src = audio.src || audio.getAttribute?.('src') || '';
      if (/(?:sfx-[\w-]+\.wav|(?:^|\/)sounds\/(?!intro|music)[\w-]+\.mp3)/i.test(src) && (!audio.paused || replayObjects.has(audio))) replayObject(audio, 'playbackRate');
    }
    const engine = window.TweenMax || window.TweenLite, running = config.replay && config.replaySpeed && window.replay && window.fast_forwarding && !window.paused && window.replay_arr?.length && replayRate > 1;
    if (replayClock && (!running || replayClock !== engine)) {
      if (replayClock.globalTimeScale() === replayClockApplied) replayClock.globalTimeScale(replayClockBefore);
      replayClock = null;
    }
    if (running && typeof engine?.globalTimeScale === 'function') {
      if (!replayClock) { replayClock = engine; replayClockBefore = engine.globalTimeScale(); }
      replayClockApplied = replayClockBefore * replayRate; engine.globalTimeScale(replayClockApplied);
    }
    const nativeTimer = window.timer;
    if (replayStepClock && (!running || replayStepClock.timer !== nativeTimer)) {
      if (replayStepClock.timer.millis === replayStepClock.applied) replayStepClock.timer.millis = 150;
      replayStepClock = null;
    }
    if (window.replay && nativeTimer && typeof nativeTimer.callback === 'function' && !rules.hasHook(nativeTimer.callback, 'dbliteReplayRate')) {
      const callback = nativeTimer.callback;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return callback.apply(this, args);
        replaySpeed();
        try { return window.replay ? replayEffect(callback, this, args) : callback.apply(this, args); }
        finally { replaySpeed(); }
      };
      wrapped.dbliteReplayRate = true; rules.markHook(wrapped, callback); nativeTimer.callback = wrapped;
    }
    if (window.replay && nativeTimer && typeof nativeTimer.start === 'function' && !rules.hasHook(nativeTimer.start, 'dbliteReplayRate')) {
      const original = nativeTimer.start;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding) return original.apply(this, args);
        if (replayFactor() > 1) {
          this.millis = Math.max(10, 150 / replayRate);
          replayStepClock = { timer: this, applied: this.millis };
        }
        replaySpeed();
        const before = replayStepTimer; replayStepTimer = true;
        try { return original.apply(this, args); } finally { replayStepTimer = before; }
      };
      wrapped.dbliteReplayRate = true; rules.markHook(wrapped, original); nativeTimer.start = wrapped;
    }
    const fast = document.getElementById('fast_btn');
    if (!config.replay || !config.replaySpeed || !window.replay || !fast) { if (replayRateControl) replayRateControl.hidden = true; return; }
    if (!replayRateControl) {
      replayRateControl = document.createElement('label'); replayRateControl.id = 'dblite-replay-rate';
      replayRateControl.append(document.createTextNode('Fast forward '));
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Fast-forward speed');
      for (const n of [1,2,4,8,16]) { const option = document.createElement('option'); option.value = n; option.textContent = n === 1 ? 'Native' : `${n}× faster`; select.append(option); }
      select.value = String(replayRate);
      select.addEventListener('change', () => {
        replayRate = Number(select.value); try { localStorage.setItem('dbetter-replay-rate', String(replayRate)); } catch {}
        // Changing the preference must preserve native playback state.
        if (window.replay && window.fast_forwarding && !window.paused && window.replay_arr?.length && window.timer) {
          window.timer.millis = Math.max(10, 150 / replayRate); window.timer.start?.();
        }
        replaySpeed();
      });
      for (const type of ['keydown','keyup','mousedown','click']) select.addEventListener(type, e => e.stopPropagation());
      replayRateControl.append(select); document.body.append(replayRateControl);
    }
    replayRateControl.hidden = !visible(fast.closest('#duel') || fast);
  }
  document.addEventListener('click', event => { if (event.target.closest?.('#play_btn,#pause_btn,#pause_replay_btn,#fast_btn,#next_btn')) queueMicrotask(replaySpeed); }, true);
  function hasOwnWheelBehavior(target) {
    if (target.closest?.('input,textarea,select,[contenteditable="true"],[role="slider"],.chat,#chats,#duel_log,#watch_chat,#watchers,#online_users,.dblite-action-history,.dblite-menu,.dblite-view-settings,.dblite-panel,.dblite-builder-search,#card_menu,#combo')) return true;
    for (let node = target; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const css = getComputedStyle(node);
      if ((/(auto|scroll|overlay)/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 1) ||
          (/(auto|scroll|overlay)/.test(css.overflowX) && node.scrollWidth > node.clientWidth + 1)) return true;
    }
    return false;
  }
  // Keep the description's native wheel behavior. Elsewhere, smoothly scroll
  // that same viewport, unless the pointer is over another scrolling surface.
  document.addEventListener('wheel', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) || conflict() || gesture?.active || document.hidden) return;
    const preview = window.preview?.[0] || document.getElementById('preview');
    const text = document.getElementById('preview_txt');
    const screen = preview?.closest('#duel,#deck_constructor');
    if (!visible(preview) || !visible(text) || !visible(screen)) return;
    if (text.contains(event.target) || hasOwnWheelBehavior(event.target)) { stopDescriptionScroll(); return; }
    if (['dim','overlay','confirm','confirm2','input'].some(id => visible(document.getElementById(id)))) return;
    const viewport = [...text.querySelectorAll('[data-overlayscrollbars-viewport],.os-viewport,.os_viewport'), text]
      .find(node => node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1);
    if (!viewport) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    const previous = redirectedScroll;
    const accumulating = previous?.viewport === viewport && Date.now() - previous.time < 700 && Math.sign(delta) === previous.direction;
    const top = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, (accumulating ? previous.top : viewport.scrollTop) + delta));
    const smooth = (config.animations && config.cardMotion) && !reducedMotion?.matches && typeof viewport.scrollTo === 'function';
    redirectedScroll = smooth ? { viewport, top, direction: Math.sign(delta), time: Date.now() } : null;
    if (smooth) viewport.scrollTo({ top, behavior: 'smooth' });
    else if (viewport.scrollTo) viewport.scrollTo({ top, behavior: 'instant' });
    else viewport.scrollTop = top;
    event.preventDefault(); event.stopPropagation();
  }, { capture: true, passive: false });
  document.addEventListener('scrollend', event => {
    if (event.target === redirectedScroll?.viewport && Math.abs(event.target.scrollTop - redirectedScroll.top) < 1) redirectedScroll = null;
  }, true);
  document.addEventListener('pointerdown', stopDescriptionScroll, true);
  window.addEventListener('blur', stopDescriptionScroll);

  // DB fits card names while constructing a front, sometimes before it has
  // measurable dimensions or its font has loaded. Refit the complete title
  // when visible, using the same horizontal compression as native setText.
  const cardNameFits = new WeakMap();
  let cardNameFrame = null;
  const observedNames = new Set();
  const nameResize = window.ResizeObserver ? new ResizeObserver(entries => { for (const entry of entries) dirtyNames.add(entry.target); queueCardNames(); }) : null;
  const dirtyNames = new Set();
  function fitCardNames(names = document.querySelectorAll(".cardfront .name_txt,.cardfront .name2_txt")) {
    for (const name of names) {
      if (!observedNames.has(name)) { observedNames.add(name); nameResize?.observe(name); }
      if (!name.textContent || !name.clientWidth || !visible(name)) continue;
      name.style.whiteSpace = 'nowrap';
      const width = name.clientWidth, fullWidth = name.scrollWidth;
      if (!fullWidth) continue;
      const key = `${name.textContent}:${width}:${fullWidth}:${name.style.transform}`;
      if (cardNameFits.get(name) === key) continue;
      const transform = `scaleX(${Math.min(1, width / fullWidth)})`;
      if (name.style.transform !== transform) name.style.transform = transform;
      name.style.transformOrigin = 'top left';
      cardNameFits.set(name, `${name.textContent}:${width}:${fullWidth}:${name.style.transform}`);
    }
  }
  const queueCardNames = () => {
    if (cardNameFrame !== null || !window.document) return;
    cardNameFrame = requestAnimationFrame(() => { cardNameFrame = null; if (window.document) { fitCardNames([...dirtyNames]); dirtyNames.clear(); } });
  };
  const collectCardNames = records => {
    for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1) {
      for (const name of [node, ...node.querySelectorAll('.name_txt,.name2_txt')]) if (!name.isConnected && observedNames.has(name)) { nameResize?.unobserve(name); observedNames.delete(name); }
    }
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const name = node?.closest('.cardfront .name_txt,.cardfront .name2_txt'); if (name) dirtyNames.add(name);
      for (const added of record.addedNodes) if (added.nodeType === 1) {
        if (added.matches('.cardfront .name_txt,.cardfront .name2_txt')) dirtyNames.add(added);
        for (const name of added.querySelectorAll('.cardfront .name_txt,.cardfront .name2_txt')) dirtyNames.add(name);
      }
    }
    if (dirtyNames.size) queueCardNames();
  };
  const cardNameObserver = new MutationObserver(collectCardNames);
  cardNameObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  document.fonts?.addEventListener('loadingdone', () => fitCardNames());
  document.fonts?.ready.then(() => { if (window.document) fitCardNames(); });

  // Native select focus can scroll a transformed, overflow-hidden board.
  // Restore only its fixed containers, never the deck/search scroll panes.
  let banlistScroll = null;
  const isBanlist = target => target?.id === 'banlists' && target.closest('#deck_constructor');
  const restoreBanlistScroll = () => {
    if (!banlistScroll || !visible(document.getElementById('deck_constructor'))) return;
    for (const { node, x, y } of banlistScroll) if (node.isConnected) { node.scrollLeft = x; node.scrollTop = y; }
  };
  const captureBanlistScroll = event => {
    if (!isBanlist(event.target)) return;
    if (event.type !== 'focusin' || !banlistScroll) {
      const fixedPage = ['hidden', 'clip'].includes(getComputedStyle(document.body).overflowY);
      banlistScroll = [...new Set([document.scrollingElement, document.body,
        ...['content', 'frames', 'deck_constructor'].map(id => document.getElementById(id))])]
        .filter(Boolean).map(node => ({ node, x: fixedPage ? 0 : node.scrollLeft, y: fixedPage ? 0 : node.scrollTop }));
    }
    // Focus before the native mousedown default so opening the select cannot
    // scroll the transformed board to reveal its untransformed coordinates.
    if (event.type === 'pointerdown') event.target.focus({ preventScroll: true });
    restoreBanlistScroll(); queueMicrotask(restoreBanlistScroll); requestAnimationFrame(restoreBanlistScroll);
  };
  document.addEventListener('pointerdown', captureBanlistScroll, true);
  document.addEventListener('focusin', captureBanlistScroll, true);
  document.addEventListener('keydown', event => { if (isBanlist(event.target)) captureBanlistScroll(event); }, true);
  document.addEventListener('scroll', event => {
    if (isBanlist(document.activeElement) && banlistScroll?.some(item => item.node === event.target || event.target === document)) restoreBanlistScroll();
  }, true);
  document.addEventListener('change', captureBanlistScroll, true);
  let cardLinkFrame = null;
  window.addEventListener('resize', () => {
    if (cardLinkFrame !== null) return;
    cardLinkFrame = requestAnimationFrame(() => { cardLinkFrame = null; if (window.document) updateCardLink(); });
  });
  // Card preview: quoted names (archetypes, named cards) and the card name open Find a card.
  const quoted = /["“]([^"“”\n]*)["”]/g;
  // Stat phrases ("monster with 300 ATK/200 DEF", "with 2000 or more ATK", "Level 4 or lower")
  // become links too; clicking searches by those stats instead of a name.
  const statPhrase = /\bwith (\d+|\?) ATK\s*(?:\/|and|&)\s*(\d+|\?) DEF\b|\bwith (\d+) or (more|less|higher|lower) (ATK|DEF)\b|\bwith (\d+|\?) (ATK|DEF)\b|\bLevel (\d+) or (lower|higher|less|more)\b|\bLevel (\d+)(?= (?:(?:[A-Z][A-Za-z/-]*|or|and|and\/or)[ ,]+)*(?:monsters?|Tuners?)\b)|\bLevel (\d+(?:,\s*(?:(?:or|and)\s+)?\d+){2,}|\d+(?: or \d+){2,})\b/g;
  const frameWords = ['Normal', 'Effect', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum'];
  // "1 LIGHT Cyberse monster with 2300 ATK" / "Level 4 or lower WIND Winged Beast monster": Attribute and Type.
  const attributeWords = ['LIGHT', 'DARK', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
  let monsterTypeSet = null;
  function monsterTypes() {
    if (monsterTypeSet?.size) return monsterTypeSet;
    monsterTypeSet = new Set((Array.isArray(window.Cards) ? window.Cards : []).filter(card => card?.card_type === 'Monster' && card.type && card.type !== 'Proxy').map(card => card.type));
    return monsterTypeSet;
  }
  function traitsOf(words) {
    const traits = {}, list = words.trim().split(/\s+/).filter(Boolean);
    if (attributeWords.includes(list[0])) traits.attribute = list.shift();
    const type = list.join(' ');
    if (type && monsterTypes().has(type)) traits.type = type; else if (type) return traits.attribute && list.length === 0 ? traits : {};
    return traits;
  }
  const traitsBefore = /((?:\b(?:LIGHT|DARK|EARTH|WATER|FIRE|WIND|DIVINE)\s+)?(?:\b[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)?\s+)?)monsters?\s+$/;
  const traitsAfter = /^\s+((?:(?:LIGHT|DARK|EARTH|WATER|FIRE|WIND|DIVINE)\s+)?(?:[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)?\s+)?)monsters?\b/;
  function matchTraits(words) {
    // "Winged Beast" or a single word; drop leading words that are not part of the Type ("Reveal 1 ...").
    const list = words.trim().split(/\s+/).filter(Boolean);
    for (let start = 0; start < list.length; start++) {
      const traits = traitsOf(list.slice(start).join(' '));
      if (traits.type || traits.attribute) return traits;
    }
    return {};
  }
  function statsOf(match) {
    const exact = value => value === '?' ? ['?', '?'] : [value, value], bound = (value, word) => /more|higher/.test(word) ? [value, ''] : ['', value];
    if (match[1]) return { atk: exact(match[1]), def: exact(match[2]) };
    if (match[3]) return { [match[5].toLowerCase()]: bound(match[3], match[4]) };
    if (match[6]) return { [match[7].toLowerCase()]: exact(match[6]) };
    if (match[8]) return { level: bound(match[8], match[9]) };
    if (match[11]) { const values = match[11].match(/\d+/g); return { level: [String(Math.min(...values)), String(Math.max(...values))] }; }
    return { level: exact(match[10]) };
  }
  function linkStats(text) {
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement.closest('.dblite-card-ref') && (statPhrase.lastIndex = 0, statPhrase.test(node.data))) nodes.push(node);
    for (const node of nodes) {
      statPhrase.lastIndex = 0; const fragment = document.createDocumentFragment(); let last = 0, match;
      while ((match = statPhrase.exec(node.data))) {
        fragment.append(node.data.slice(last, match.index));
        const ref = document.createElement('span'); ref.className = 'dblite-card-ref dblite-stat-ref'; ref.textContent = match[0];
        const stats = statsOf(match), around = match[0].startsWith('with') ? node.data.slice(0, match.index).match(traitsBefore) : node.data.slice(match.index + match[0].length).match(traitsAfter);
        if (around?.[1]) Object.assign(stats, matchTraits(around[1]));
        ref.dataset.stats = JSON.stringify(stats); ref.title = `Find ${[stats.attribute, stats.type].filter(Boolean).join(' ')} monsters ${match[0]}`.replace(/\s+/g, ' ');
        // "Level 8 or lower Fusion Monster": keep the frame with the Level range.
        const frame = node.data.slice(match.index + match[0].length).match(/^\s+(Normal|Effect|Ritual|Fusion|Synchro|Xyz|Link|Pendulum)\b/i)?.[1];
        if (frame) ref.dataset.frame = frameWords.find(word => word.toLowerCase() === frame.toLowerCase());
        fragment.append(ref); last = match.index + match[0].length;
      }
      fragment.append(node.data.slice(last)); node.replaceWith(fragment);
    }
    statPhrase.lastIndex = 0;
    // 'Level 7 or higher "Artmage" monster' is one search: merge the stat and the name link.
    for (const ref of text.querySelectorAll('.dblite-stat-ref')) {
      const gap = ref.nextSibling, name = gap?.nextSibling, tail = name?.nextSibling;
      if (gap?.nodeType !== 3 || !/^\s*"$/.test(gap.data) || !name?.classList?.contains('dblite-card-ref') || name.dataset.stats || tail?.nodeType !== 3 || !tail.data.startsWith('"')) continue;
      ref.dataset.name = name.textContent;
      ref.textContent = `${ref.textContent}${gap.data}${name.textContent}"`;
      ref.title = `Find ${ref.textContent}`;
      gap.remove(); name.remove(); tail.data = tail.data.slice(1);
    }
    // Descriptions without a stat or quoted name are searches too: "1 DARK Dragon monster".
    const words = [...monsterTypes(), ...attributeWords, ...frameWords, 'Tuner', 'Flip', 'Gemini', 'Spirit', 'Toon', 'Union', 'Quick-Play', 'Continuous', 'Equip', 'Field', 'Counter'];
    const word = '(?:non-)?(?:' + words.sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?:-Type)?';
    const description = new RegExp('\\b(?:monsters? \\((?:Fusion|Synchro|Xyz|Pendulum)(?:/(?:Fusion|Synchro|Xyz|Pendulum))+\\)(?= |$)|(?:odd(?: and \\d+ even)?|even) Pendulum Scale)(?=\\W|$)|\\b(?:Level/Rank/Link \\d+ |Rank \\d+(?: or (?:lower|higher|less|more))? |Link(?:-| Rating (?:of )?)\\d+ |' + word + '(?:[ ,]+(?:(?:or|and|and/or) )?' + word + ')* )(?:monsters?|Monsters?|Tuners?|Spells?|Traps?|Spell/Traps?)\\b|\\b(?:with (?:an? )?(?:ATK|DEF) of \\d+(?: points)?(?: or (?:less|lower|more|higher))?|(?:with|has|have) \\d+(?: or (?:less|lower|more|higher))? (?:ATK|DEF)|(?:non-)?Tuners?|monsters? whose ATK (?:equals?|is equal to) (?:its|their) (?:own )?DEF|whose (?:original )?Type is ' + word + '(?:,? (?:or |and )?' + word + ')*)\\b', 'g');
    const rest = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), plain = [];
    for (let node = rest.nextNode(); node; node = rest.nextNode()) if (!node.parentElement.closest('.dblite-card-ref') && (description.lastIndex = 0, description.test(node.data))) plain.push(node);
    const original = text.textContent, positions = new WeakMap(), allText = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let position = 0;
    for (let node = allText.nextNode(); node; node = allText.nextNode()) { positions.set(node, position); position += node.data.length; }
    for (const node of plain) {
      description.lastIndex = 0; const fragment = document.createDocumentFragment(); let last = 0, match;
      while ((match = description.exec(node.data))) {
        const before = original.slice(0, positions.get(node) + match.index);
        if ((before.match(/["“”]/g) || []).length % 2 || /"[^"\n]*Tokens?"\s*\([^)]*$/i.test(before) || /\bas (?:an? )?(?:face-up )?$/i.test(before)) continue;
        fragment.append(node.data.slice(last, match.index));
        const ref = document.createElement('span'); ref.className = 'dblite-card-ref dblite-stat-ref'; ref.textContent = match[0];
        ref.dataset.stats = '{}'; ref.title = `Find ${match[0]}`; fragment.append(ref); last = match.index + match[0].length;
      }
      fragment.append(node.data.slice(last)); node.replaceWith(fragment);
    }
  }
  function linkPreviewText() {
    const text = document.getElementById('preview_txt');
    if (!text || !config.previewLinks) return;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement.closest('.dblite-card-ref') && (quoted.lastIndex = 0, quoted.test(node.data))) nodes.push(node);
    for (const node of nodes) {
      quoted.lastIndex = 0; const fragment = document.createDocumentFragment(); let last = 0, match;
      const catalog = previewCatalog(), raw = node.data.replace(/[“”]/g, '"'), nested = [];
      const current = catalog.names.get(previewNameKey(document.querySelector('#preview .name_txt')?.textContent));
      for (const name of raw.includes('""') ? catalog.nested : catalog.nestedMiddle) for (let at = raw.indexOf('"' + name + '"'); at >= 0; at = raw.indexOf('"' + name + '"', at + name.length + 2)) { const match = [raw.slice(at, at + name.length + 2), name]; match.index = at; nested.push(match); }
      const matches = [...nested, ...[...node.data.matchAll(quoted)].filter(match => !nested.some(other => match.index < other.index + other[0].length && match.index + match[0].length > other.index))].sort((a, b) => a.index - b.index);
      for (const match of matches) {
        // Quoted effect sentences and generated Tokens are not catalog names.
        if (!match[1] || match[1].length > 80 || match[1] !== match[1].trim() || /\bTokens?$/i.test(match[1])) continue;
        const catalog = previewCatalog(), key = previewNameKey(match[1]);
        if (current?.card_type === 'Monster' && current.monster_color === 'Normal' && node.data === current.effect && !catalog.names.has(key)) continue;
        if ((match[1].length === 1 || /^\d+$/.test(match[1])) && !catalog.names.has(key)) continue;
        if (!catalog.quoted.has(key)) catalog.quoted.set(key, catalog.keys.some(name => name.includes(key) || /s$/.test(key) && name.includes(key.slice(0, -1)) || /es$/.test(key) && name.includes(key.slice(0, -2))));
        if (!catalog.quoted.get(key)) continue;
        fragment.append(node.data.slice(last, match.index + 1));
        const ref = document.createElement('span'); ref.className = 'dblite-card-ref'; ref.textContent = match[1]; ref.title = `Find cards named “${match[1]}”`;
        fragment.append(ref); last = match.index + match[0].length - 1;
      }
      fragment.append(node.data.slice(last)); node.replaceWith(fragment);
    }
    quoted.lastIndex = 0;
    linkStats(text);
    previewFooter(text);
  }
  // Wraps each snippet of the card text in <mark>, across the text's links (one text node at a time). Quotes and case are ignored.
  function markDescribed(text, snippets) {
    const nodes = [], walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let all = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('.dblite-preview-more, mark.dblite-describe-mark')) continue;
      nodes.push({ node, start: all.length }); all += node.data;
    }
    const plain = value => value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase(), haystack = plain(all), ranges = [];
    for (const snippet of snippets) {
      const at = haystack.indexOf(plain(snippet).trim());
      if (at >= 0) ranges.push([at, at + snippet.trim().length]);
    }
    for (const { node, start } of nodes.reverse()) {
      for (const [from, to] of ranges.filter(([from, to]) => from < start + node.data.length && to > start).sort((a, b) => b[0] - a[0])) {
        const a = Math.max(0, from - start), b = Math.min(node.data.length, to - start), piece = node.splitText(a);
        piece.splitText(b - a);
        const mark = document.createElement('mark'); mark.className = 'dblite-describe-mark'; piece.replaceWith(mark); mark.append(piece);
      }
    }
    // A long text: the first highlight comes into view at the top of the text box.
    // DuelingBook's text box scrolls in OverlayScrollbars' viewport.
    const first = text.querySelector('mark.dblite-describe-mark'), box = first?.closest('.os_viewport') || text;
    if (first && box.scrollHeight > box.clientHeight) box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top - 4;
  }
  // The first opaque background colour from node up to the box (included); '' leaves the CSS one.
  function boxColour(node, box) {
    for (let current = node; current; current = current.parentElement) {
      const colour = getComputedStyle(current).backgroundColor;
      if (colour && !/^(transparent|rgba\(.*,\s*0\))$/.test(colour)) return colour;
      if (current === box) break;
    }
    return '';
  }
  // The footer keeps the colour it got when it was made: after switching the look (Night to Classic), or when it was made
  // during the box's background transition, it stayed a grey bar on the white Classic box (user, 2026-11-07). Each tick
  // puts the box's current colour back (written only on change).
  function footerColours() {
    for (const more of document.querySelectorAll('#preview_txt .dblite-preview-more')) {
      const colour = boxColour(more.parentElement, more.closest('#preview_txt'));
      if (more.style.backgroundColor !== colour) more.style.backgroundColor = colour;
    }
  }
  // Under the card text: the card's archetype(s), and in the deck constructor a reverse search
  // for the cards that add or Summon it. DuelingBook replaces the text with each preview.
  function previewFooter(text) {
    text.querySelectorAll('.dblite-preview-more').forEach(node => node.remove());
    hideCardPeek();
    const api = window.DBETTERConstructor, name = document.querySelector('#preview .name_txt')?.textContent.trim();
    const card = api?.catalogCard?.(window.preview?.data?.('id'), name);
    if (!card) return;
    const archetypes = api.archetypesOf?.(card) || [], constructor = window.currentLabel === 'deck_constructor';
    if (!archetypes.length && !constructor) return;
    const more = document.createElement('span'), line = () => more.appendChild(document.createElement('span'));
    more.className = 'dblite-preview-more';
    // A Describe search result: why it matched, and the clauses that did, highlighted in the card text.
    const why = constructor && api.describeWhy?.(card);
    if (why?.length) {
      markDescribed(text, why.flatMap(hit => hit.text.split(' … ')).filter(Boolean));
      const row = line(); row.className = 'dblite-describe-why'; row.append(`🔎 ${why.map(hit => hit.label).join(' · ')}`);
    }
    let breakdown = null;
    if (archetypes.length) {
      const row = line(); row.append(archetypes.length > 1 ? 'Archetypes: ' : 'Archetype: ');
      archetypes.forEach((archetype, i) => {
        if (i) row.append(' · ');
        const ref = document.createElement('span'); ref.className = 'dblite-card-ref dblite-archetype-ref';
        ref.dataset.archetype = archetype; ref.textContent = archetype; ref.title = `Find “${archetype}” cards`; row.append(ref);
        if (constructor) {
          const support = document.createElement('span'); support.className = 'dblite-card-ref dblite-support-ref'; support.dataset.support = archetype;
          support.textContent = 'support'; support.title = `Cards outside “${archetype}” that can search or summon many of its monsters`; row.append(' (', support, ')');
        }
      });
    }
    if (constructor) {
      const row = line(); row.append('⤺ ');
      [['access', 'Access', 'Cards that take it out of its Deck: add it to the hand, Special Summon, Set or send it to the GY. For Fusion, Synchro, Xyz and Link Monsters (from the Extra Deck): Set, send to the GY or banish. ⚙ in the search panel changes this'],
        ['synergy', 'Synergy', 'Access, plus cards that add, summon, Set or send it from anywhere (GY, hand, banished…), cards that name it or its archetype, and the cards it names or fetches'],
        ['starters', 'Starters', 'Starters: cards that, alone in your opening hand, get it on their own (listed first) or search or summon one of its own searchers, which then gets it. Each step counts what Access counts (⚙ in the search panel)'],
        ['ideas', 'Ideas', 'Ideas: every card that gets it alone or through one of its searchers, also when it needs more than that one card (a cost, a condition, a trigger), with what each needs. The Starters come first. Each step counts what Access counts (⚙ in the search panel)']].filter(([mode]) => mode !== 'synergy' || api.synergyEnabled).forEach(([mode, label, title], i) => {
        if (i) row.append(' · ');
        const ref = document.createElement('span'); ref.className = 'dblite-card-ref dblite-fetch-ref'; ref.dataset.fetch = String(card.id); ref.dataset.mode = mode;
        ref.textContent = label; ref.title = title; row.append(ref);
      });
      // A Summon Lab result: the breakdown of its materials above the footer, and in the footer a pointer to
      // it (with Any slots) or, as before, what a "These + others" recipe still needs.
      let detail = null;
      try { detail = api.summonLabEnabled && api.labDetail?.(card); } catch (error) { console.warn('Spellspeed Lab:', error); }
      if (detail) {
        breakdown = labBreakdown(card, detail);
        const slots = detail.slots.filter(slot => slot.ways.length);
        if (slots.length) {
          const ways = slots.reduce((sum, slot) => sum + slot.ways.length, 0), complete = slots.reduce((sum, slot) => sum + slot.ways.filter(way => way.complete).length, 0);
          const row = line(); row.append(`🌀 Lab: ${ways} way${ways > 1 ? 's' : ''} to fill ${slots.length > 1 ? 'your Any slots' : slots[0].name}${detail.exact ? '' : `, ${complete} complete`} · `);
          const show = document.createElement('span'); show.className = 'dblite-card-ref dblite-lab-show'; show.textContent = 'details'; show.title = 'Show the materials this result takes';
          row.append(show);
        }
      }
      const needs = (!detail || !detail.slots.length) && api.summonLabEnabled && api.labNeeds?.(card);
      if (needs) {
        const row = line(); row.append(`🌀 Needs: ${needs.text}`);
        if (needs.request) { const find = document.createElement('span'); find.className = 'dblite-card-ref dblite-need-ref'; find.dataset.need = String(card.id); find.textContent = 'find'; find.title = 'Search for cards that fill it'; row.append(' · ', find); }
      }
      // A two-step Starters result: the searcher it reaches first, and how: it gets it, Summons it from the Extra
      // Deck, destroys it in the Deck, or makes it with itself and/or the monster it brings out (an Xyz, Synchro or
      // Link Summon); the step may destroy itself. Card names work like cards: hover for the picture, click or tap
      // to open it in the overview.
      const step = api.starterStep?.(card), how = api.starterHow?.(card);
      // What the starter or its step does to the card ("sends the card to the GY"); "gets the card" when it is not known.
      const does = action => ({ add: 'adds the card to your hand', summon: 'Special Summons the card', set: 'Sets or places the card', send: 'sends the card to the GY', banish: 'banishes the card' })[action] || 'gets the card';
      const cardRef = shown => { const ref = document.createElement('span'); ref.className = 'dblite-card-ref dblite-step-ref'; ref.dataset.card = String(shown.id); ref.textContent = shown.name; ref.title = `Show “${shown.name}”`; return ref; };
      if (step && how?.move === 'material') {
        const summon = `${how.kind[0].toUpperCase()}${how.kind.slice(1)} Summons`, ref = cardRef(step);
        if (!how.with) line().append(`⤺ Step: ${summon} “`, ref, '” with it, which gets the card');
        else line().append(`⤺ Step: ${summon} “`, ref, `” with ${how.alone ? '' : 'it and '}“`, cardRef(how.with), '”, which gets the card');
      } else if (how?.idea) {
        // An Ideas line (user, 2026-10-30): what it would do, and what it needs that one card in the opening hand does not give.
        const needs = [how.idea.starter && `it needs: ${how.idea.starter}`, how.idea.step && `the step needs: ${how.idea.step}`].filter(Boolean);
        const note = needs.length ? needs.join('; ') : how.idea.generic ? 'the step finds any card of that kind' : 'its timing or limits do not fit a one-card line';
        const tail = `${how.chance ? `, by chance: ${how.chance}` : ''} — ${note}`;
        if (step) line().append(`⤺ Idea: ${how.move === 'destroy' ? 'destroys' : 'gets'} “`, cardRef(step), `”, which ${does(how.action)}${tail}`);
        else line().append(`⤺ Idea: ${does(how.action)}${tail}`);
      } else if (how?.move === 'direct') {
        // A one-card starter gets the card with its own effect (user, 2026-10-30).
        line().append(`⤺ On its own: ${does(how.action)}${how.chance ? `, by chance: ${how.chance}` : ''}`);
      } else if (step) {
        const [verb, after] = { summon: ['Summons', ' from the Extra Deck'], destroy: ['destroys', ''] }[how?.move] || ['gets', ''];
        // A line by chance says what has to go your way (user, 2026-10-30).
        line().append(`⤺ Step: ${verb} “`, cardRef(step), `”${after}, which ${how?.self ? 'destroys itself and ' : ''}${does(how?.action)}${how?.chance ? `, by chance: ${how.chance}` : ''}`);
      }
    }
    const spans = text.querySelectorAll(':scope > span, .os-viewport > span, .os_viewport > span, .os-content > span, [data-overlayscrollbars-viewport] > span');
    if (spans.length) spans[spans.length - 1].after(more); else text.append(more);
    // The sticky footer covers the text scrolled under it, so it needs the box's own colour. The CSS `inherit` only
    // reaches the scroll viewport, which is transparent in the Classic look (user, 2026-11-04: scrolling up Artmage
    // Power Patron's text, the archetype lines sat over the effect text).
    more.style.backgroundColor = boxColour(more.parentElement, text);
    // The breakdown scrolls with the card text; the footer stays at the bottom of the box.
    if (breakdown) more.before(breakdown);
  }
  // A card named in the overview (a Starters step), seen without leaving the overview (user, 2026-10-30): with
  // a mouse, a small panel beside the name while hovered, with its artwork, name, kind and text (DuelingBook
  // has no picture of a whole card). Touch has no hover; a tap opens the card in the overview.
  let cardPeek = null;
  const hideCardPeek = () => cardPeek?.remove();
  // The same panel for a card name quoted in the card text (user, 2026-11-06), in duels, Solo and the deck constructor:
  // only a name that is exactly one card's ("Toon World", not the archetype "Toon"). The click is unchanged.
  const peekCard = ref => ref.dataset.card ? window.DBETTERConstructor?.catalogCard?.(ref.dataset.card)
    : config.namePeek && !ref.dataset.stats && !ref.dataset.archetype && previewCatalog().names.get(previewNameKey(ref.textContent)) || null;
  function showCardPeek(ref) {
    const card = peekCard(ref);
    if (!card) return;
    cardPeek ||= Object.assign(document.createElement('div'), { className: 'dblite-card-peek' });
    const art = Object.assign(document.createElement('img'), { alt: '', src: (window.CARD_IMAGES_START || 'https://images.duelingbook.com/low-res/') + encodeURIComponent(card.id) + '.jpg' });
    const name = document.createElement('strong'), kind = document.createElement('small'), text = document.createElement('p');
    const color = String(card.monster_color || ''), link = color.includes('Link');
    name.textContent = card.name;
    kind.textContent = card.card_type === 'Monster'
      ? [color, card.attribute, card.type, card.level !== '' && card.level != null ? `${link ? 'Link' : color.includes('Xyz') ? 'Rank' : 'Level'} ${card.level}` : '', `${card.atk ?? '?'}/${link ? '-' : card.def ?? '?'}`].filter(Boolean).join(' · ')
      : `${card.type || ''} ${card.card_type}`.trim();
    text.textContent = [card.pendulum_effect, card.effect].filter(Boolean).join('\n\n');
    cardPeek.replaceChildren(art, name, kind, text);
    document.body.append(cardPeek);
    const box = ref.getBoundingClientRect(), width = cardPeek.offsetWidth, height = cardPeek.offsetHeight;
    cardPeek.style.left = Math.max(8, Math.min(box.right + 12, innerWidth - width - 8)) + 'px';
    cardPeek.style.top = Math.max(8, Math.min(box.top - height / 2, innerHeight - height - 8)) + 'px';
  }
  document.addEventListener('pointerover', event => {
    const ref = event.pointerType === 'mouse' && event.target.closest?.('#preview_txt .dblite-step-ref, #preview_txt .dblite-card-ref');
    if (ref) showCardPeek(ref);
  }, true);
  document.addEventListener('pointerout', event => { if (event.target.closest?.('.dblite-step-ref, #preview_txt .dblite-card-ref')) hideCardPeek(); }, true);
  // Summon Lab breakdown (user, 2026-10-30): each chosen card and the part of the recipe it fills, then for
  // each Any slot the ways real cards fill it, with up to 3 of them, a search for all, and what remains.
  const labExpanded = new Set();
  function labBreakdown(card, detail) {
    const block = document.createElement('span'), row = () => block.appendChild(document.createElement('span'));
    block.className = 'dblite-preview-more dblite-preview-lab';
    const ref = (text, title, data) => {
      const node = document.createElement('span'); node.className = 'dblite-card-ref'; node.textContent = text; node.title = title;
      Object.assign(node.dataset, data); return node;
    };
    row().append('🌀 Summon Lab');
    // A second procedure printed on the card (not its material line); its conditions are not checked.
    if (detail.procedure) row().append(`By its own procedure: ${detail.procedure}`);
    for (const material of detail.materials) if (!material.generic) row().append(`${material.name} → ${material.role || 'material'}${material.scale ? ` · ${material.scale}` : ''}`);
    detail.slots.forEach((slot, s) => {
      const head = row(); head.className = 'dblite-lab-slot-head';
      head.append(slot.ways.length ? `${slot.name} can be:` : `${slot.name}: no card fits with the others`);
      const key = `${card.id}:${s}`, shown = labExpanded.has(key) ? slot.ways.length : 4;
      slot.ways.forEach((way, w) => {
        const line = row(); line.className = 'dblite-lab-way'; line.hidden = w >= shown; line.dataset.labSlot = key;
        line.append(`• ${way.role}${way.scale ? ` · ${way.scale}` : ''}: ${way.count} card${way.count > 1 ? 's' : ''} (`);
        way.names.slice(0, 3).forEach((name, i) => { if (i) line.append(', '); line.append(ref(name, `Find “${name}”`, {})); });
        if (way.count > 3) line.append('…');
        line.append(' · ', ref('find', `Search for the cards that fill ${slot.name} this way`, { labWay: `${s}:${w}`, labPart: 'fit', labCard: String(card.id) }), ') → ');
        if (way.complete) line.append('complete');
        else {
          line.append(`+ ${way.needs.text}`);
          if (way.needs.request) line.append(' · ', ref('find', 'Search for cards that fill it', { labWay: `${s}:${w}`, labPart: 'need', labCard: String(card.id) }));
        }
      });
      if (slot.ways.length > shown) {
        const toggle = row(); toggle.className = 'dblite-lab-way';
        const node = ref(`+ ${slot.ways.length - shown} more way${slot.ways.length - shown > 1 ? 's' : ''}`, 'Show every way', { labMore: key });
        toggle.append(node);
      }
      if (slot.partial) row().append('(stopped at the time limit: some cards were not tried)');
    });
    return block;
  }
  // Smart links: '"X" monster/Spell/Trap' limits the card type; '... mentions "X"' searches descriptions.
  const kindPhrase = '(?:[a-z-]+\\s+)?(?:monster|spell\\/trap|spell|trap|card)s?';
  const mentionsBefore = new RegExp(`(${kindPhrase}(?:\\s+(?:or|and)\\s+${kindPhrase})?)\\s+that\\s+mentions?\\s*"?$`);
  const namedAfter = new RegExp(`^\\s*(${kindPhrase}(?:\\s+or\\s+${kindPhrase})?)\\b`);
  let previewNames = null;
  const previewNameKey = name => String(name).normalize('NFKC').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
  function previewCatalog() {
    const cards = window.Cards || [];
    if (previewNames?.cards !== cards || previewNames.size !== cards.length) {
      const names = new Map();
      for (const card of cards) if (card?.name && !card.rush && !names.has(previewNameKey(card.name))) names.set(previewNameKey(card.name), card);
      const aliases = window.DBETTERConstructor?.aliases;
      const nested = [...names.values()].map(card => card.name).filter(name => name.includes('"')).sort((a, b) => b.length - a.length);
      previewNames = { cards, size: cards.length, names, nested, nestedMiddle: nested.filter(name => !name.startsWith('"') && !name.endsWith('"')), keys: [...names.keys(), ...(aliases ? cards.filter(card => card?.name && !card.rush).flatMap(card => aliases(card).map(previewNameKey)) : [])], quoted: new Map() };
    }
    return previewNames;
  }
  function previewQuery(ref) {
    const text = ref.textContent.trim();
    // The history names the card whose overview link started a search.
    const origin = document.querySelector('#preview .name_txt')?.textContent.trim() || '';
    if (ref.dataset.fetch) return { fetch: ref.dataset.fetch, mode: ref.dataset.mode || 'access', origin };
    if (ref.dataset.support) return { support: ref.dataset.support, origin };
    if (ref.dataset.need) return { need: ref.dataset.need, origin };
    if (ref.dataset.labWay) return { labWay: ref.dataset.labWay, labPart: ref.dataset.labPart, labCard: ref.dataset.labCard, origin };
    if (ref.dataset.archetype) return { text: ref.dataset.archetype, field: 'name', cardTypes: [], frames: [], stProperties: [], origin };
    // Every condition of the phrase around the link, read like the reverse search (constructor.js):
    // "Level 5 or higher monster (LIGHT or DARK, Pyro or Aqua)", 'non-Warrior "Vanquish Soul" monster'.
    const around = previewTextAround(ref);
    let read = null;
    try { read = around && window.DBETTERConstructor?.phraseRequest?.(around.text, around.offset); } catch (error) { console.warn('Spellspeed link:', error); }
    if (read && (read.text || ref.dataset.stats || read.phrase?.excluded?.length)) {
      // A quoted card name the sentence reads as another kind of card ('Ritual Summon this card with "Light and
      // Darkness Ritual"' reads as a Ritual Monster; it is a Spell): search for that card itself.
      const catalog = previewCatalog(), key = previewNameKey(text);
      const exact = !ref.dataset.stats && (catalog.names.get(key) || /s$/.test(key) && catalog.names.get(key.slice(0, -1)) || /es$/.test(key) && catalog.names.get(key.slice(0, -2)));
      let fits = true;
      try { fits = !exact || !read.phrase || !!window.DBETTERConstructor?.fitsPhrase?.(exact, read.phrase); } catch { fits = true; }
      if (exact && !fits && read.field !== 'effect' && !read.phrase?.excluded?.length) return { text: exact.name, field: 'name', cardTypes: [], frames: [], stProperties: [], origin };
      return { ...read, origin };
    }
    if (ref.dataset.stats) {
      try { return { text: ref.dataset.name || '', stats: JSON.parse(ref.dataset.stats), label: text, cardTypes: ['Monster'], frames: ref.dataset.frame ? [ref.dataset.frame] : [], stProperties: [], origin }; }
      catch { return { text }; }
    }
    const after = (ref.nextSibling?.textContent || '').slice(1, 50).toLowerCase(), before = (ref.previousSibling?.textContent || '').slice(-70).toLowerCase();
    // 'Quick-Play Spell or Trap that mentions "X"' (before) or '"X" Spell/Trap' (after the name).
    const mentions = before.match(mentionsBefore), named = !mentions && after.match(namedAfter);
    const phrase = (mentions || named || [])[1] || '';
    return { text, field: mentions || /mentions?\s*"?$/.test(before) ? 'effect' : 'name', ...cardKinds(phrase.replace(/\bcards?\b/g, '').trim() ? phrase : ''), origin };
  }
  // The card text as one string (the overview's own lines, not DBETTER's footer) and where ref starts in it.
  function previewTextAround(ref) {
    const root = document.getElementById('preview_txt');
    if (!root) return null;
    let text = '', offset = -1;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.dblite-preview-more')) continue;
      if (offset < 0 && ref.contains(node)) offset = text.length;
      text += node.data;
    }
    return offset < 0 ? null : { text, offset };
  }
  // 'quick-play spell or trap' -> card types Spell+Trap, Spell limited to Quick-Play, Traps unrestricted.
  function cardKinds(phrase) {
    const properties = { Spell: ['Normal', 'Continuous', 'Equip', 'Quick-Play', 'Field', 'Ritual'], Trap: ['Normal', 'Continuous', 'Counter'] };
    const cardTypes = new Set(), frames = new Set(), limited = { Spell: new Set(), Trap: new Set() }, open = new Set();
    let anyMonster = false, framedMonster = true;
    for (const part of phrase.split(/\s+(?:or|and)\s+/)) {
      const match = part.match(/^(?:([a-z-]+)\s+)?(monster|spell\/trap|spell|trap|card)s?$/);
      if (!match) continue;
      const word = (match[1] || '').replace(/(^|-)([a-z])/g, (m, dash, c) => dash + c.toUpperCase());
      const types = match[2] === 'monster' ? ['Monster'] : match[2] === 'spell/trap' ? ['Spell', 'Trap'] : match[2] === 'spell' ? ['Spell'] : match[2] === 'trap' ? ['Trap'] : [];
      for (const type of types) {
        cardTypes.add(type);
        if (type === 'Monster') { anyMonster = true; if (frameWords.includes(word)) frames.add(word); else framedMonster = false; }
        else if (properties[type].includes(word)) limited[type].add(word); else open.add(type);
      }
    }
    const stProperties = [];
    if (limited.Spell.size || limited.Trap.size) for (const type of ['Spell', 'Trap']) if (cardTypes.has(type))
      for (const property of open.has(type) ? properties[type] : limited[type]) stProperties.push(`${type}:${property}`);
    return { cardTypes: [...cardTypes], frames: anyMonster && framedMonster ? [...frames] : [], stProperties };
  }
  document.addEventListener('click', event => {
    if (!config.previewLinks) return;
    const ref = event.target.closest?.('#preview_txt .dblite-card-ref');
    if (!ref) return;
    // A card named in the overview opens there.
    if (ref.dataset.card) {
      event.preventDefault(); event.stopPropagation(); hideCardPeek();
      const card = window.DBETTERConstructor?.catalogCard?.(ref.dataset.card);
      if (card && typeof window.previewFront === 'function' && window.jQuery) window.previewFront(window.jQuery('<div>').data({ ...card, effect: card.effect || '', pendulum_effect: card.pendulum_effect || '' }));
      return;
    }
    // Summon Lab breakdown: unfold a slot's other ways, or bring the breakdown into view from the footer.
    if (ref.dataset.labMore || ref.classList.contains('dblite-lab-show')) {
      event.preventDefault(); event.stopPropagation();
      const block = document.querySelector('#preview_txt .dblite-preview-lab');
      if (ref.dataset.labMore) {
        labExpanded.add(ref.dataset.labMore);
        block?.querySelectorAll('.dblite-lab-way[hidden]').forEach(node => { if (node.dataset.labSlot === ref.dataset.labMore) node.hidden = false; });
        ref.parentElement.remove();
      } else {
        // Scroll the text box only (scrollIntoView would also scroll DuelingBook's page).
        for (let box = block?.parentElement; box; box = box.parentElement) {
          if (box.scrollHeight <= box.clientHeight + 1 || !/auto|scroll/.test(getComputedStyle(box).overflowY)) continue;
          box.scrollTop += block.getBoundingClientRect().top - box.getBoundingClientRect().top;
          break;
        }
      }
      return;
    }
    const request = previewQuery(ref);
    const api = window.DBETTERConstructor, constructor = window.currentLabel === 'deck_constructor';
    const handled = request.support ? constructor && api?.searchSupport?.(request.support) : request.need ? constructor && api?.searchNeed?.(request.need)
      : request.labWay ? constructor && api?.searchLabWay?.(request.labCard, ...request.labWay.split(':').map(Number), request.labPart)
      : request.fetch ? constructor && api?.searchFetchers?.(request.fetch, request.origin, request.mode) : constructor ? api?.searchFor?.(request) : duelTools?.findText(request);
    if (!handled) return;
    event.preventDefault(); event.stopPropagation();
  }, true);
  const previewObserver = new MutationObserver(() => { previewObserver.disconnect(); try { linkPreviewText(); } finally { observePreview(); } });
  function observePreview() {
    // The card name itself stays plain text, so it can be selected and copied.
    const text = document.getElementById('preview_txt');
    if (text) previewObserver.observe(text, { childList: true, subtree: true, characterData: true });
  }
  observePreview();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_SETTINGS') return;
    const draggedVolume = config.vfxVolume;
    config = rules.settings(event.data.settings || {});
    if (volumeDragging) config.vfxVolume = draggedVolume;
    presentationSafety = 0; scheduleLayout();
    cancelShortcuts();
    if (!config.drag) cleanDrag();
    tick();
  });
  function createDuelTools() {
    let controls, sortButton, searchButton, wheelButton, chatButton, search, input, results, count, typing;
    let searchField = 'name', searchType = 'all', searchStats = null, searchStatsLabel = '', searchPhrase = null;
    let owner, duelId, order = [], identities = new Map(), catalog, catalogSize = -1, searchMode, searchPool, searchPoolSize = -1;
    const nativeHooks = new Map(), typists = new Map();
    const inDuel = () => !!window.player1 && visible(document.getElementById('duel')) &&
      /^duel_start/.test(window.currentLabel || '') && !window.resetting && !conflict();
    const personalHand = () => inDuel() && window.duelist && window.duel_active && !window.replay && !window.tag_duel && !window.automatic;
    const resetOrder = () => { order = []; identities.clear(); };
    const canOrder = () => personalHand() && canPlay() && !document.hidden && !pendingSelection() &&
      !pendingAttach && !workbench?.busy() && !window.viewing && typeof window.organizeHand === 'function' &&
      window.player1.hand_arr?.length > 1 && window.player1.hand_arr.every(card =>
        card.data('controller') === window.player1 && card.data('owner') === window.player1 &&
        card.data('cardfront')?.data('initialized') !== false && !!card.data('cardfront')?.data('name'));
    function reconcile(p) {
      if (owner !== p || duelId !== window.duelId || !personalHand()) { resetOrder(); owner = p; duelId = window.duelId; }
      const hand = p?.hand_arr || [];
      // Native shuffles may reuse DOM nodes with new IDs. Never carry an old
      // visual identity through that reassignment, or reorder DB's real array.
      if (hand.some(card => identities.has(card[0]) && identities.get(card[0]) !== card.data('id'))) resetOrder();
      if (order.length) {
        order = order.filter(card => includes(hand, card));
        for (const card of hand) if (!includes(order, card)) order.push(card);
        identities = new Map(hand.map(card => [card[0], card.data('id')]));
      }
      return order.length ? order : hand;
    }
    function arrange(cards) {
      order = cards.slice(); owner = window.player1; duelId = window.duelId;
      identities = new Map(order.map(card => [card[0], card.data('id')]));
      window.removeCardMenu?.('DBETTER hand order');
      window.organizeHand(owner, true, !(config.animations && config.cardMotion) || !!reducedMotion?.matches);
    }
    function handSort(a, b) {
      const left = a.data('cardfront')?.data() || {}, right = b.data('cardfront')?.data() || {};
      const type = data => ({ Monster: 0, Spell: 1, Trap: 2, Skill: 3 })[data.card_type] ?? 4;
      const level = data => {
        if (data.card_type !== 'Monster') return 0;
        if (data.monster_color === 'Link' && /^[01]{8}$/.test(data.arrows || '') && data.arrows.includes('1')) return [...data.arrows].filter(bit => bit === '1').length;
        return data.level !== '' && data.level != null && Number.isFinite(Number(data.level)) ? Number(data.level) : Number.MAX_SAFE_INTEGER;
      };
      return type(left) - type(right) || level(left) - level(right) || String(left.name || '').localeCompare(String(right.name || ''), 'en', { sensitivity: 'base', numeric: true });
    }
    function hookHand() {
      for (const name of ['organizeHand', 'shuffleHand2']) {
        const original = window[name];
        if (typeof original !== 'function' || rules.hasHook(original, nativeHooks.get(name))) continue;
        const wrapped = function (p, ...args) {
          if (window.DBETTERRebuilding) return original.call(this, p, ...args);
          if (p !== window.player1) return original.call(this, p, ...args);
          if (name === 'shuffleHand2') { resetOrder(); return original.call(this, p, ...args); }
          const canonical = p.hand_arr, displayed = reconcile(p);
          if (!order.length || !personalHand()) return original.call(this, p, ...args);
          // v932 organizeHand synchronously schedules left-position tweens and
          // DOM stacking only. Restore the canonical array before any callback,
          // server response, ID update or subsequent native operation can run.
          p.hand_arr = displayed;
          try { return original.call(this, p, ...args); }
          finally { p.hand_arr = canonical; }
        };
        rules.markHook(wrapped, original); nativeHooks.set(name, wrapped); window[name] = wrapped;
      }
    }
    function insertion(card, x) {
      const remaining = reconcile(window.player1).filter(item => !same(item, card));
      const centers = remaining.map(item => {
        const rect = (item.find('.content')[0] || item[0]).getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
      const next = centers.findIndex(center => x < center), index = next < 0 ? remaining.length : next;
      const line = index === 0 ? centers[0] - 32 : index === centers.length ? centers.at(-1) + 32 : (centers[index - 1] + centers[index]) / 2;
      return { remaining, index, line };
    }
    function reorder(g, x) {
      if (!canOrder() || !Number.isFinite(x)) return;
      const hand = window.player1.hand_arr;
      if (!g.hand || g.hand.length !== hand.length || g.hand.some((entry, i) => entry.node !== hand[i][0] || entry.id !== hand[i].data('id'))) {
        announce('Your hand changed. Drag the card again.'); return;
      }
      const { remaining, index } = insertion(g.card, x); remaining.splice(index, 0, g.card); arrange(remaining);
    }
    function markInsertion(g, x, target) {
      g.insertion?.remove(); g.insertion = null;
      if (g.source !== 'hand_arr' || target?.kind !== 'hand' || !canOrder()) return;
      const marker = document.createElement('div'); marker.className = 'dblite-hand-insert';
      const { line } = insertion(g.card, x);
      marker.style.cssText = `left:${line}px;top:${target.rect.top + 8}px;height:${Math.min(110, target.rect.height - 16)}px`;
      g.layer.append(marker); g.insertion = marker;
    }
    function makeButton(text, action) {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.onclick = action; return node;
    }
    function closeSearch(focus = false) {
      search?.remove(); search = null; input = null; catalog = null; catalogSize = -1;
      searchMode = undefined; searchPool = null; searchPoolSize = -1;
      searchButton?.setAttribute('aria-expanded', 'false');
      if (focus && searchButton?.isConnected) searchButton.focus({ preventScroll: true });
    }
    // Find a card can be resized from its corner; the chosen size is kept for later duels.
    let searchSize = null;
    try { const saved = JSON.parse(localStorage.getItem('dblite-find-size-2')); if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) searchSize = saved; } catch { /* Default size. */ }
    const searchResize = window.ResizeObserver ? new ResizeObserver(() => {
      if (!search || positioningSearch) return;
      const rect = search.getBoundingClientRect();
      // Only a size the user dragged to is saved, not the one positionSearch just applied.
      if (Math.abs(rect.width - placedSize.width) < 1 && Math.abs(rect.height - placedSize.height) < 1) return;
      searchSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
      try { localStorage.setItem('dblite-find-size-2', JSON.stringify(searchSize)); } catch { /* Keep for this page. */ }
    }) : null;
    let positioningSearch = false, placedSize = { width: 0, height: 0 };
    // A slim, tall column directly above the Find card button (bottom-left), clear of the card
    // preview when the window has a margin beside the board. Width and height can be dragged.
    function positionSearch() {
      if (!search) return;
      positioningSearch = true;
      // Phones show the small corner ⌕ instead of the Find card button: sit above whichever is visible.
      const anchor = [searchButton, document.querySelector('.dbetter-touch-bar [aria-label="Find a card"]')].find(node => node?.isConnected && node.getBoundingClientRect().width);
      const button = anchor?.getBoundingClientRect(), stage = document.getElementById('content')?.getBoundingClientRect();
      // In the phone corner row (which can also hold the app's ⚙), line up with the row's left edge.
      const row = anchor?.closest?.('.dbetter-touch-bar')?.getBoundingClientRect();
      const left = Math.max(10, row?.width ? row.left : button?.width ? button.left : 10), bottom = button?.height ? button.top - 8 : innerHeight - 12;
      const margin = stage ? stage.left - left - 8 : 0;
      // Phones: stay in the margin left of the board (never over the card preview) when it is 120 px or wider.
      const phoneWidth = row?.width && margin >= 100 ? margin : null;
      const width = Math.min(phoneWidth ?? searchSize?.width ?? Math.min(250, Math.max(170, margin)), innerWidth - left - 10);
      const height = Math.max(160, Math.min(searchSize?.height ?? Math.round(innerHeight * .62), bottom - 10));
      search.style.width = width + 'px'; search.style.height = height + 'px'; placedSize = { width, height };
      search.style.left = left + 'px'; search.style.top = Math.max(10, bottom - height) + 'px';
      search.style.maxHeight = Math.max(200, bottom - 10) + 'px';
      requestAnimationFrame(() => { positioningSearch = false; });
      if (searchResize && !search.dbliteObserved) { searchResize.observe(search); search.dbliteObserved = true; }
    }
    function showCard(data) {
      if (!inDuel() || typeof window.previewFront !== 'function') return;
      // previewFront/copyCard only read .data(). A detached data snapshot gives
      // the native overview its full card artwork without creating a duel card.
      const front = $('<div>').data({ ...data, effect: data.effect || '', pendulum_effect: data.pendulum_effect || '' });
      window.previewFront(front);
    }
    function cardSearchMode() {
      const format = window.duelFormat;
      if (window.rush || ['ru', 'rr'].includes(format)) return 'rush';
      if (window.speed || ['su', 'sr'].includes(format)) return 'speed';
      if (['gu', 'gr'].includes(format)) return 'goat';
      if (['yu', 'yr'].includes(format)) return 'genesys';
      return format === 'cu' ? 'custom' : 'standard';
    }
    const cardSearchPool = mode => mode === 'speed' ? window.SpeedCards : mode === 'goat' ? window.GoatCards : null;
    function findCards() {
      if (!search) return;
      catalog = window.Cards; catalogSize = catalog?.length || 0;
      searchMode = cardSearchMode(); searchPool = cardSearchPool(searchMode); searchPoolSize = searchPool?.length || 0;
      results.replaceChildren();
      const query = input.value.trim().toLocaleLowerCase();
      if (!catalogSize) { count.textContent = 'Waiting for the card catalog…'; return; }
      if (['speed', 'goat'].includes(searchMode) && !searchPoolSize) { count.textContent = 'Waiting for this format’s card list…'; return; }
      if (!query && !searchStats && !searchPhrase) { count.textContent = `Search ${searchField === 'name' ? 'card names' : 'card descriptions'}. Hover or select a result.`; return; }
      const pool = searchPool ? new Set(searchPool.map(String)) : null, unique = new Map(), names = window.DBETTERConstructor?.names;
      for (const card of catalog) {
        if (!card || card.hidden || typeof card.name !== 'string' || !card.name.trim()) continue;
        if (searchMode !== 'custom') {
          if (card.custom || !!Number(card.rush || 0) !== (searchMode === 'rush')) continue;
          if (card.card_type === 'Skill' && searchMode !== 'speed') continue;
          if (pool && !pool.has(String(card.id))) continue;
          if (searchMode === 'genesys' && (card.monster_color === 'Link' || Number(card.pendulum))) continue;
        }
        if (searchType !== 'all' && !(searchType === 'Spell/Trap' ? ['Spell', 'Trap'].includes(card.card_type) : card.card_type === searchType)) continue;
        if (searchStats && !statsMatch(card, searchStats)) continue;
        if (searchPhrase && !window.DBETTERConstructor?.fitsPhrase?.(card, searchPhrase)) continue;
        const key = card.name.trim().toLocaleLowerCase();
        // A name search also matches the names a card is always treated as (Theorealized Medius for "Power Patron"), like the deck constructor.
        const fields = searchField === 'name' ? [card.name, ...(names?.(card) || [])] : [card.effect, card.pendulum_effect];
        if (query && !fields.some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(query))) continue;
        // Alternate artworks share a name. Keep one matching public printing,
        // chosen by ID so catalog ordering never changes the overview artwork.
        if (!unique.has(key) || Number(card.id) < Number(unique.get(key).id)) unique.set(key, card);
      }
      const matches = [...unique.values()];
      matches.sort((a, b) => Number(b.name.toLocaleLowerCase().startsWith(query)) - Number(a.name.toLocaleLowerCase().startsWith(query)) || a.name.localeCompare(b.name));
      if (searchStats || searchPhrase) count.textContent = `${searchStatsLabel} · `; else count.textContent = '';
      count.textContent += matches.length > 50 ? `${matches.length} cards · first 50 shown; refine your search` : `${matches.length} card${matches.length === 1 ? '' : 's'}`;
      for (const data of matches.slice(0, 50)) {
        const row = makeButton(data.name, () => showCard(data)); row.className = 'dblite-search-result';
        row.addEventListener('mouseenter', () => showCard(data)); row.addEventListener('focus', () => showCard(data));
        const type = document.createElement('small'); type.textContent = [data.monster_color, data.card_type].filter(Boolean).join(' · ');
        row.append(type);
        // A small artwork beside the name (placed first by CSS), so the right card is easy to pick without hovering.
        if (data.id && !data.custom) {
          const art = document.createElement('img'); art.className = 'dblite-search-art'; art.alt = ''; art.loading = 'lazy';
          art.src = (window.CARD_IMAGES_START || 'https://images.duelingbook.com/low-res/') + encodeURIComponent(data.id) + '.jpg';
          row.append(art);
        }
        results.append(row);
      }
    }
    // On touch screens focusing the field opens the on-screen keyboard over the results;
    // the field is focused only when tapped.
    const typeFocus = () => { if (!document.documentElement.classList.contains('dbetter-touch')) input.focus(); };
    // Quick chat: the deck's own messages (set in the deck constructor) come first, then the
    // general presets from DBETTER's settings; at most 8 in the wheel.
    function deckChatName() { return workbench?.deckName?.() || window.default_deck || ''; }
    function chatMessages() {
      let deck = [];
      try { deck = JSON.parse(localStorage.getItem('dbetter-deck-chat') || '{}')?.[deckChatName()] || []; } catch { /* No deck messages. */ }
      return rules.chatList([...rules.chatList(deck, []), ...(config.chatPresets || [])], []).slice(0, 8);
    }
    let chatWheel = null;
    function openChatWheel() {
      if (chatWheel) { chatWheel.close(); return; }
      if (!config.chatWheel || !inDuel() || !window.duelist || window.replay || chatButton?.hidden || typeof window.Send !== 'function') return;
      const messages = chatMessages(); if (!messages.length) return;
      const anchor = chatButton;
      const r = anchor?.getBoundingClientRect() || { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2 };
      // Above the chat row, with the wheel's edge aligned to its button.
      chatWheel = ringWheel({ className: 'dblite-chat-wheel', label: 'Quick chat', x: r.right - 108, y: r.top - 112, outer: 104, inner: 34,
        onClose: () => { chatWheel = null; },
        items: messages.map(message => ({ label: message, title: 'Send “' + message + '”', run: () => {
          if (inDuel() && window.duelist && typeof window.Send === 'function') window.Send({ action: 'Duel', play: 'Duel message', message, html: 0 });
        } })) });
    }
    document.addEventListener('mousedown', event => { if (chatWheel && !event.target.closest?.('.dblite-chat-wheel,.dblite-chat-wheel-button,.dbetter-chat-corner')) chatWheel.close(); }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && chatWheel) { event.preventDefault(); event.stopImmediatePropagation(); chatWheel.close(); } }, true);
    let chatRow, chatPlacement, chatMeasured = '';
    const chatStyle = document.createElement('style');
    document.head.append(chatStyle);
    function placeChat() {
      if (!chatButton?.isConnected && !controls?.isConnected) return;
      const field = document.querySelector('#duel .cin_txt');
      const off = !config.chatWheel || !window.duelist || !!window.replay || !inDuel() || !field || !visible(field);
      // Written only on change (Android app, 2026-10-28): re-appending the button and rewriting its attributes on every
      // tick restyled the page each time, seen as flashing cards in replays.
      if (chatButton.hidden !== off) chatButton.hidden = off;
      if (!field) { const duel = document.getElementById('duel'); if (duel && chatButton.parentElement !== duel) duel.append(chatButton); if (chatStyle.textContent) chatStyle.textContent = ''; chatWheel?.close(); return; }
      if (field.parentElement !== chatRow) {
        chatRow?.replaceWith(...[...chatRow.children].filter(n => n !== chatButton));
        chatRow = document.createElement('div'); chatRow.className = 'dblite-chat-row';
        const proxy = field.nextElementSibling?.matches('.textinput') ? field.nextElementSibling : null;
        field.before(chatRow); chatRow.append(field); if (proxy) chatRow.append(proxy);
        chatRow.append(chatButton);
      }
      if (chatButton.parentElement !== chatRow) chatRow.append(chatButton);
      if (off) { if (chatStyle.textContent) chatStyle.textContent = ''; chatWheel?.close(); chatMeasured = ''; return; }
      const proxy = field.nextElementSibling?.matches('.textinput') ? field.nextElementSibling : null;
      // Measure again only when the field moved or the window changed: switching our stylesheet off and on to
      // measure restyles the whole page twice.
      // Positions only: our reservation changes the field's width, not where it is.
      const parent0 = chatRow.parentElement, at = (proxy && visible(proxy) ? proxy : field).getBoundingClientRect(), box = parent0?.getBoundingClientRect();
      const key = [innerWidth, innerHeight, at.left, at.top, at.height, box?.left, box?.top, box?.width, box?.height, getComputedStyle(field).position, parent0 && getComputedStyle(parent0).transform].join('|');
      if (key === chatMeasured && chatStyle.textContent) return;
      chatMeasured = key;
      // Measure the native slot without our width reservation. Native proxies and
      // adaptive fixed coordinates retain their selectors and event handlers.
      chatStyle.disabled = true;
      const anchor = proxy && visible(proxy) ? proxy : field;
      const r = anchor.getBoundingClientRect(), parent = chatRow.parentElement;
      const p = parent.getBoundingClientRect(), sx = parent.offsetWidth ? p.width / parent.offsetWidth || 1 : 1, sy = parent.offsetHeight ? p.height / parent.offsetHeight || 1 : 1;
      const fixed = getComputedStyle(anchor).position === 'fixed' && getComputedStyle(parent).transform === 'none';
      const x = fixed ? r.left : (r.left - p.left) / sx, y = fixed ? r.top : (r.top - p.top) / sy;
      const width = r.width / (fixed ? 1 : sx), height = r.height / (fixed ? 1 : sy), reserve = Math.min(32, width / 3);
      const css = `#duel .dblite-chat-row>:is(.cin_txt,.textinput){box-sizing:border-box!important;width:${Math.max(1, width - reserve)}px!important}#duel .dblite-chat-row>.dblite-chat-wheel-button{position:${fixed ? 'fixed' : 'absolute'}!important;left:${x + width - reserve + 2}px!important;top:${y}px!important;width:${reserve - 2}px!important;height:${height}px!important}`;
      chatStyle.disabled = false;
      if (chatStyle.textContent !== css) chatStyle.textContent = css;
      const placement = [r.left, r.top, r.width, r.height].join(',');
      if (chatPlacement && chatPlacement !== placement) chatWheel?.close();
      chatPlacement = placement;
    }
    function openSearch() {
      if (search) { closeSearch(true); return; }
      if (!inDuel()) return;
      search = document.createElement('section'); search.className = 'dblite-card-search'; search.id = 'dblite-card-search';
      search.setAttribute('aria-label', 'Find a card');
      // Compact controls: the search field and close button share one row, the filters another.
      const heading = document.createElement('header');
      const close = makeButton('×', () => closeSearch(true)); close.setAttribute('aria-label', 'Close card search');
      input = document.createElement('input'); input.type = 'search'; input.autocomplete = 'off';
      heading.append(input, close);
      const fields = document.createElement('div'); fields.className = 'dblite-search-fields'; fields.setAttribute('role', 'group'); fields.setAttribute('aria-label', 'Search field');
      const syncField = () => {
        for (const button of fields.children) button.setAttribute('aria-pressed', String(button.dataset.field === searchField));
        input.placeholder = searchField === 'name' ? 'Card name…' : 'Card description…';
        input.setAttribute('aria-label', searchField === 'name' ? 'Search card name' : 'Search card description');
      };
      for (const [field, label] of [['name', 'Name'], ['description', 'Text']]) {
        const button = makeButton(label, () => { searchField = field; syncField(); findCards(); typeFocus(); });
        button.dataset.field = field; fields.append(button);
      }
      syncField();
      count = document.createElement('p'); count.className = 'dblite-search-count'; count.setAttribute('role', 'status');
      results = document.createElement('div'); results.className = 'dblite-search-results'; results.setAttribute('aria-label', 'Matching cards');
      input.addEventListener('input', () => { searchStats = searchPhrase = null; findCards(); });
      // Small card type filter: All / Monster / Spell / Trap.
      const types = document.createElement('div'); types.className = 'dblite-search-fields dblite-search-types'; types.setAttribute('role', 'group'); types.setAttribute('aria-label', 'Card type');
      for (const [type, label] of [['all', 'All'], ['Monster', 'Mon'], ['Spell', 'Spell'], ['Trap', 'Trap']]) {
        const button = makeButton(label, () => { searchType = type; for (const other of types.children) other.setAttribute('aria-pressed', String(other.dataset.type === searchType)); findCards(); typeFocus(); });
        button.dataset.type = type; button.setAttribute('aria-pressed', String(type === searchType)); types.append(button);
      }
      const filters = document.createElement('div'); filters.className = 'dblite-search-filters'; filters.append(fields, types);
      search.append(heading, filters, count, results);
      for (const type of ['mousedown', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'contextmenu']) search.addEventListener(type, event => {
        event.stopPropagation();
        if (type === 'keydown' && event.key === 'Escape') { event.preventDefault(); closeSearch(true); }
        else if (type === 'keydown' && event.target === input && ['ArrowDown', 'Enter'].includes(event.key)) { event.preventDefault(); results.querySelector('button')?.focus(); }
      });
      document.body.append(search); searchButton.setAttribute('aria-expanded', 'true'); findCards(); positionSearch(); typeFocus();
    }
    function received(data, p) {
      if (!inDuel() || !p) return;
      if (data?.play === 'Typing') typists.set(p, { seen: false, duel: window.duelId });
      else if (data?.play === 'Duel message') typists.delete(p);
    }
    // Find card and the position wheel switch (2026-11-07): left 12, bottom 72 was laid out on a 2560×1440 screen; at 1920×1080
    // full screen DuelingBook's stage leaves a 96 px margin and the row covered its friends icon and chat bubbles. The spot now
    // comes from the free space: that row while it clears DuelingBook's corner controls, else a column left of them (under the
    // Watchers box), else that column with icons only, else a row under the stage. Touch screens keep their layout (touch.js).
    // Replays add Hide Hands / Show Hand / Show Both and the like button under Watchers (user, 2026-11-09: at 1920×1080
    // full screen the 0.9.1 spot covered them, and the Record video panel, which follows Find card, went to the top right).
    const REPLAY_CONTROLS = '#duel>.radiobutton,#show_lbl,#show1_lbl,#show2_lbl,#duel>.like_btn';
    const TOOL_OBSTACLES = '#online_btn,#chat_btn,#private_btn,#watchers,#watch_chat,' + REPLAY_CONTROLS;
    let toolsAt = '';
    function toolsSpot() {
      const pad = 6, gap = 5, h = 32, n = wheelButton.hidden ? 1 : 2;
      const boxes = [...document.querySelectorAll(TOOL_OBSTACLES)].filter(visible).map(node => node.getBoundingClientRect()).filter(r => r.width && r.height);
      if (!boxes.length) return null;
      const free = (left, top, width, height) => left >= 0 && top >= 0 && left + width <= innerWidth && top + height <= innerHeight &&
        !boxes.some(r => left < r.right + pad && left + width > r.left - pad && top < r.bottom + pad && top + height > r.top - pad);
      if (free(12, innerHeight - 72 - h, n > 1 ? 132 + gap + 72 : 132, h)) return null;
      // The column stays left of DuelingBook's corner icons and of the replay controls.
      const icons = [...document.querySelectorAll('#online_btn,#chat_btn,#private_btn,' + REPLAY_CONTROLS)].filter(visible).map(node => node.getBoundingClientRect().left).filter(x => x > 0);
      const room = Math.floor((icons.length ? Math.min(...icons) : innerWidth) - pad - 4), height = n * h + (n - 1) * gap;
      const width = room >= 96 ? Math.min(132, room) : room >= h ? h : 0;
      if (width) {
        // The 0.9.1 bottom line first, then just under each obstacle, lowest first.
        const tops = [innerHeight - 72 - height, ...boxes.map(r => Math.ceil(r.bottom + pad)).sort((a, b) => b - a)];
        const top = tops.find(y => free(4, y, width, height));
        if (top !== undefined) return { mode: width === h ? 'icons' : 'column', left: 4, top, width };
      }
      const stage = document.getElementById('content')?.getBoundingClientRect();
      if (stage && free(12, Math.ceil(stage.bottom + 2), n > 1 ? 132 + gap + 72 : 132, h)) return { mode: 'row', left: 12, top: Math.ceil(stage.bottom + 2) };
      return null;
    }
    function placeTools() {
      if (!controls?.isConnected) return;
      const spot = document.documentElement.classList.contains('dbetter-touch') ? null : toolsSpot();
      const key = spot ? `${spot.mode}|${spot.left}|${spot.top}|${spot.width || ''}` : '';
      if (key === toolsAt) return; // Written only on change.
      toolsAt = key;
      controls.classList.toggle('dblite-tools-column', !!spot && spot.mode !== 'row');
      controls.classList.toggle('dblite-tools-icons', spot?.mode === 'icons');
      Object.assign(controls.style, spot ? { left: `${spot.left}px`, top: `${spot.top}px`, bottom: 'auto', width: spot.width ? `${spot.width}px` : '' } : { left: '', top: '', bottom: '', width: '' });
    }
    function update() {
      if (!window.jQuery) return;
      hookHand();
      const active = inDuel();
      if (!active) {
        controls?.remove(); controls = null; sortButton?.remove(); chatButton?.remove(); chatStyle.textContent = ''; chatWheel?.close(); typing?.remove(); typing = null; closeSearch(); typists.clear(); resetOrder();
        document.getElementById('duel')?.classList.toggle('dblite-local-tools', false); return;
      }
      if (owner !== window.player1 || duelId !== window.duelId) { closeSearch(); typists.clear(); }
      reconcile(window.player1);
      // The compact duel layout regroups OK, Thinking, Shuffle, Show hand and auto draw; off (Classic look) they stay where DuelingBook puts them.
      const duel = document.getElementById('duel'); duel.classList.toggle('dblite-local-tools', config.duelLayout !== false);
      if (!controls?.isConnected) {
        controls = document.createElement('div'); controls.className = 'dblite-duel-tools';
        sortButton = makeButton('Sort hand', () => {
          if (!canOrder()) return;
          arrange(reconcile(window.player1).slice().sort(handSort));
        });
        sortButton.title = 'Sort by card type, then Level/Rank/Link rating, then name (local only)'; sortButton.className = 'dblite-sort-hand';
        sortButton.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="3" width="18" height="25" rx="2" fill="var(--dbt-panel)" stroke="var(--dbt-line)"/><rect x="6" y="5" width="18" height="25" rx="2" fill="var(--dbt-panel-2)" stroke="var(--dbt-text)"/><path d="M9 13h8m-8 5h6m-6 5h4M27 7v18m-3-3 3 3 3-3" fill="none" stroke="var(--dbt-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        searchButton = makeButton('⌕ Find card', openSearch); searchButton.className = 'dblite-find-card'; searchButton.dataset.icon = '⌕';
        wheelButton = makeButton('', toggleWheel); wheelButton.className = 'dblite-position-wheel-toggle';
        chatButton =makeButton('💬', openChatWheel); chatButton.className = 'dblite-chat-wheel-button';
        chatButton.title = 'Quick chat: gg, glhf and your deck\'s own messages'; chatButton.setAttribute('aria-label', 'Quick chat');
        searchButton.setAttribute('aria-expanded', 'false'); searchButton.setAttribute('aria-controls', 'dblite-card-search');
        const parent = document.getElementById('avatar1')?.parentElement || document.getElementById('duel_content')?.parentElement || duel;
        controls.append(searchButton, wheelButton); document.body.append(controls); parent.append(sortButton);
        typing = document.createElement('div'); typing.className = 'dblite-chat-typing'; typing.setAttribute('role', 'status'); parent.append(typing);
      }
      if (sortButton.hidden !== !personalHand()) sortButton.hidden = !personalHand();
      if (sortButton.disabled !== !canOrder()) sortButton.disabled = !canOrder();
      placeChat();
      // Written only on change: per-tick rewrites restyled the page (phones).
      if (sortButton.getAttribute('aria-label') !== 'Sort hand by type and level') sortButton.setAttribute('aria-label', 'Sort hand by type and level');
      if (searchButton.getAttribute('aria-label') !== 'Find a card') searchButton.setAttribute('aria-label', 'Find a card');
      const wheelOn = !!config.dropWheel, wheelText = wheelOn ? '◎ Wheel' : '⌨ Direct';
      if (wheelButton.textContent !== wheelText) {
        wheelButton.textContent = wheelText; wheelButton.dataset.icon = wheelText[0]; wheelButton.setAttribute('aria-pressed', String(wheelOn));
        wheelButton.setAttribute('aria-label', `Position wheel ${wheelOn ? 'on' : 'off'}`);
        wheelButton.title = `${wheelOn ? 'Position wheel on: a drop on an empty zone asks how to play the card.' : 'Position wheel off: a drop plays at once; Shift, Ctrl and Alt choose.'} Click or press ${rules.keyLabel(config.keys.wheel)} to switch.`;
      }
      // Only in your own games (Solo or a duel you play); not while watching or in a replay (user, 2026-10-29).
      const noWheel = !config.drag || !window.duelist || !!window.replay;
      if (wheelButton.hidden !== noWheel) wheelButton.hidden = noWheel;
      placeTools();
      const names = [];
      for (const [p, state] of typists) {
        if (state.duel !== window.duelId || ![window.player1, window.player2].includes(p) || !window.duel_active) { typists.delete(p); continue; }
        const bubbles = p.bubbles?.[0], shown = visible(bubbles) && getComputedStyle(bubbles).display !== 'none';
        if (shown) state.seen = true;
        else if (state.seen) { typists.delete(p); continue; }
        if (shown && (!window.duelist || p !== window.player1)) names.push(p.username || 'Opponent');
      }
      const label = names.length ? `••• ${names.join(' & ')} ${names.length === 1 ? 'is' : 'are'} typing…` : '';
      const quiet = !label || !visible(duel.querySelector('.cout_txt')); if (typing.hidden !== quiet) typing.hidden = quiet;
      if (typing.textContent !== label) { typing.textContent = label; typing.title = label; }
      if (search) {
        const mode = cardSearchMode(), pool = cardSearchPool(mode);
        if (catalog !== window.Cards || catalogSize !== (window.Cards?.length || 0) || searchMode !== mode || searchPool !== pool || searchPoolSize !== (pool?.length || 0)) findCards();
        positionSearch();
      }
    }
    window.addEventListener('resize', positionSearch); window.addEventListener('resize', () => placeTools());
    // Opens Find a card on a name search, e.g. from a quoted name in the card preview.
    // Stats are compared as numbers; '?' only matches '?' (stored as -1 or '?').
    function statsMatch(card, stats) {
      if (card.card_type !== 'Monster') return false;
      for (const [key, bounds] of Object.entries(stats)) {
        if (key === 'type' || key === 'attribute') { if (card[key] !== bounds) return false; continue; }
        const [low, high] = bounds;
        if (key === 'def' && card.monster_color === 'Link') return false;
        const raw = card[key], unknown = raw === '?' || Number(raw) < 0;
        if (low === '?') { if (!unknown) return false; continue; }
        const value = Number(raw); if (unknown || !Number.isFinite(value)) return false;
        if (low !== '' && value < Number(low) || high !== '' && value > Number(high)) return false;
      }
      return true;
    }
    function findText(request) {
      const { text = '', field = 'name', cardTypes = [], stats = null, label = '', phrase = null } = typeof request === 'string' ? { text: request } : request || {};
      const kinds = new Set(cardTypes), cardType = kinds.size === 1 ? [...kinds][0] : kinds.size === 2 && kinds.has('Spell') && kinds.has('Trap') ? 'Spell/Trap' : null;
      if (!inDuel() || !text && !stats && !phrase) return false;
      if (!search) openSearch();
      if (!search) return false;
      searchField = field === 'effect' ? 'description' : 'name'; searchType = cardType || 'all'; input.value = text;
      searchPhrase = phrase; searchStats = phrase ? null : stats; searchStatsLabel = stats || phrase ? label : '';
      for (const button of search.querySelectorAll('.dblite-search-fields button')) button.setAttribute('aria-pressed', String(button.dataset.field === searchField));
      for (const button of search.querySelectorAll('.dblite-search-types button')) button.setAttribute('aria-pressed', String(button.dataset.type === searchType));
      findCards(); return true;
    }
    return { update, placeChat, canOrder, reorder, markInsertion, received, findText, chatMessages };
  }

  function createLagMonitor() {
    let context, socket, wrappedSend, heartbeat = null, slowUntil = 0, responseTime = 0, lastTick = Date.now(), notice;
    const pending = [];
    // Track gameplay requests only. Native cleanup can shuffle automatically;
    // views, prompts, chat and those shuffles are not unconfirmed user actions.
    const plays = new Set(['Draw card', 'SS ATK', 'SS DEF', 'Normal Summon', 'Set monster', 'Flip Summon',
      'To GY', 'To hand', 'To hand 2', 'To T Deck', 'To B Deck', 'To ED', 'To ED FU', 'Banish', 'Banish FD',
      'Move', 'To ST', 'Activate ST', 'Set ST', 'To ATK', 'To DEF', 'Flip', 'Turn face-down',
      'Summon token', 'Remove Token', 'Detach', 'Target card', 'Declare',
      'Die', 'Coin', 'Life points', 'Start turn', 'End turn', 'Enter DP', 'Enter SP', 'Enter M1', 'Enter BP', 'Enter M2', 'Enter EP']);
    const receiptPlay = play => {
      const name = String(play || '').toLowerCase();
      if (name.startsWith('banish')) return /\bfd\b/.test(name) ? 'banish fd' : 'banish';
      if (name === 'to grave from hand') return 'to gy';
      if (name === 'activate spell from hand') return 'activate st';
      return name.replace(/ from .+$/, '').replace(/ 2\b/, '');
    };
    const active = () => !!window.duel_active && !window.replay && !window.resetting && !document.hidden &&
      !conflict() && visible(document.getElementById('duel'));
    function clear() { pending.length = 0; heartbeat = null; slowUntil = 0; responseTime = 0; if (notice) notice.hidden = true; }
    function sync() {
      const next = active() ? window.websocket : null;
      if (socket !== next || context?.duel !== window.duelId || context?.player !== window.player1 || !active()) {
        socket?.removeEventListener?.('message', received); socket?.removeEventListener?.('close', update);
        clear(); socket = next; context = { duel: window.duelId, player: window.player1 };
        socket?.addEventListener?.('message', received); socket?.addEventListener?.('close', update);
      }
      return active();
    }
    function received(event) {
      if (!sync() || event.currentTarget !== socket) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      const now = Date.now();
      if (data?.action === 'Heartbeat' && heartbeat !== null) {
        responseTime = Math.max(0, now - heartbeat); heartbeat = null;
        slowUntil = responseTime >= 2500 ? now + 15000 : 0;
      }
      // DB treats any server frame as a heartbeat acknowledgement. A healthy
      // heartbeat or an explicit error also settles stale action samples:
      // native receipt names/IDs can differ from the submitted command.
      if (data?.action !== 'Heartbeat') heartbeat = null;
      if (['Heartbeat', 'Error'].includes(data?.action)) pending.length = 0;
      if (data?.action === 'Duel' && typeof data.play === 'string') {
        const index = pending.findIndex(item => item.username === data.username && receiptPlay(item.play) === receiptPlay(data.play) &&
          (item.card == null || item.card === data.id));
        if (index >= 0) {
          if (now - pending[index].time < 1500) slowUntil = 0;
          pending.splice(0, index + 1);
        }
      }
      update();
    }
    function update() {
      const now = Date.now();
      // Suspended tabs/system sleep cannot provide a useful latency sample.
      if (now - lastTick > 15000 || now < lastTick) clear();
      lastTick = now;
      if (!sync()) return;
      const original = window.Send;
      if (typeof original === 'function' && !rules.hasHook(original, wrappedSend)) {
        wrappedSend = function (message, ...rest) {
          let item, pulse = false;
          if (sync() && socket?.readyState === 1 && typeof socket.addEventListener === 'function') {
            if (message?.action === 'Heartbeat') { if (heartbeat === null) { heartbeat = Date.now(); pulse = true; } }
            else {
              const play = message?.action === 'Declare' ? 'Declare' : message?.action === 'Duel' ? message.play : null;
              if (window.duelist && plays.has(play)) {
                item = { play, card: message.card ?? message.id, username: window.player1?.username, time: Date.now() };
                pending.push(item); if (pending.length > 32) pending.shift();
              }
            }
          }
          try { return original.call(this, message, ...rest); }
          catch (error) { const index = pending.indexOf(item); if (index >= 0) pending.splice(index, 1); if (pulse) heartbeat = null; throw error; }
        };
        rules.markHook(wrappedSend, original); window.Send = wrappedSend;
      }
      while (pending.length && now - pending[0].time > 60000) pending.shift();
      let title = '', detail = '';
      if (socket && [2, 3].includes(socket.readyState)) { title = 'Connection interrupted'; detail = 'Waiting for DuelingBook to reconnect.'; }
      else if (pending.length && now - pending[0].time >= 5000) {
        title = 'Possible lag'; detail = `Action awaiting confirmation · ${Math.floor((now - pending[0].time) / 1000)}s`;
      } else if (heartbeat !== null && now - heartbeat >= 4000) {
        title = 'Possible lag'; detail = `Waiting for DuelingBook · ${Math.floor((now - heartbeat) / 1000)}s`;
      } else if (slowUntil > now) { title = 'Slow connection'; detail = `Last response took ${(responseTime / 1000).toFixed(1)}s.`; }
      if (!title) { if (notice) notice.hidden = true; return; }
      if (!notice) {
        notice = document.createElement('aside'); notice.id = 'dblite-lag-warning';
        const heading = document.createElement('strong'); heading.setAttribute('role', 'status');
        notice.append(heading, document.createElement('span')); document.body.append(notice);
      }
      if (notice.firstElementChild.textContent !== title) notice.firstElementChild.textContent = title;
      if (notice.lastElementChild.textContent !== detail) notice.lastElementChild.textContent = detail;
      notice.hidden = false;
    }
    document.addEventListener('visibilitychange', () => { clear(); lastTick = Date.now(); update(); });
    return { update };
  }

  let presentationSafety = 0, profileState = "";
  let profileCensor, profileChat, profileLoader, profileLeave;
  let profilesDirty = true;
  const profileObserver = new MutationObserver(records => { if (records.some(record => (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest(".duel_avatar"))) profilesDirty = true; });
  profileObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  function tick() {
    if (window.DBETTERRebuilding) return;
    const safety = Date.now() - presentationSafety >= 5000 || !presentationSafety;
    if (safety) presentationSafety = Date.now();
    adaptiveLayout();
    fieldLayers(); replaySpeed(); footerColours();
    scoutSpacing();
    skipSiteIntro(); hookLoginError(); watchLoginRetry(); watchDeadEnd(); hookRestack();
    sounds?.update();
    document.documentElement.dataset.dbetterTheme = config.theme;
    document.documentElement.classList.toggle('dbetter-night', config.theme !== 'classic');
    document.documentElement.classList.toggle('dbetter-dark-boxes', config.darkTextBoxes);
    document.documentElement.classList.toggle('dblite-hide-declaration-chat', config.hideDeclarationChat && !conflict());
    document.documentElement.classList.toggle('dblite-hide-screenshot', config.hideScreenshotButton);
    layoutRoomRows();
    collectCardNames(cardNameObserver.takeRecords());
    fitCardNames(dirtyNames);
    dirtyNames.clear();
    for (const name of observedNames) if (!name.isConnected) { nameResize?.unobserve(name); observedNames.delete(name); }
    fitCardNames(observedNames);
    if (profileObserver.takeRecords().some(record => (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest(".duel_avatar"))) profilesDirty = true;
    if (safety) { roomObserver.disconnect(); roomPresentation(); fitRoomLabels(); roomObserved = null; layoutRoomRows(); fitCardNames(); profilesDirty = true; }
    if (!window.jQuery) return;
    startupRecovery(); recoverImages();
    lagMonitor?.update();
    autoRps();
    trackDragEffects(); animations(); replayTimingHooks(); chanceEffects(); cardPreview(); spectatorCounters();
    const nextProfiles = [window.duel_active, window.duelist, window.replay, window.unsavedChanges, window.currentLabel, window.username, ...[window.player1,window.player2,window.player3,window.player4].map(p => p?.username)].join('|');
    if (profileCensor !== window.censor || profileChat !== window.openPrivateE || profileLoader !== window.loadProfile || profileLeave !== window.leaveDuelRoom) profilesDirty = true;
    profileCensor = window.censor; profileChat = window.openPrivateE; profileLoader = window.loadProfile; profileLeave = window.leaveDuelRoom;
    if (profilesDirty || nextProfiles !== profileState || profileOrigin) { spectatorProfiles(); profilesDirty = false; profileState = nextProfiles; }
    cardMenus(); syncHandHover(); syncPileHover(); syncFieldHover();
    if ([...heldKeys.values()].some(press => !shortcutContext(press))) cancelShortcuts();
    workbench?.update();
    if (gesture && (!canGrab() || window.duelId !== gesture.duelId)) cleanDrag();
    if (positionWheel && (!canGrab() || window.duelId !== positionWheel.duelId)) closePositionWheel();
  }
  const style = document.createElement('style');
  style.textContent = `
    .dblite-card-ref{color:var(--dbt-text);text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer}.dblite-card-ref:hover{color:var(--dbt-text);text-decoration-style:solid}#preview_txt .dblite-card-ref{display:inline}.dblite-card-peek{position:fixed;z-index:2147483000;box-sizing:border-box;width:300px;max-height:360px;overflow:hidden;padding:8px 10px;border:1px solid var(--dbt-line,#8a9c9f);border-radius:8px;background:var(--dbt-panel,#1e1e24);color:var(--dbt-text,#eee);box-shadow:0 6px 24px rgba(0,0,0,.55);pointer-events:none;font:13px/1.35 Arial,sans-serif}.dblite-card-peek img{float:left;width:72px;height:72px;margin:0 8px 4px 0;border-radius:4px;object-fit:cover}.dblite-card-peek strong{display:block;font-size:14px}.dblite-card-peek small{display:block;opacity:.75;margin:2px 0 4px}.dblite-card-peek p{clear:both;margin:4px 0 0;white-space:pre-wrap}
    /* Archetype, Access and Starters stay at the bottom of the text box however long the card text (user, 2026-10-28:
       Access seemed missing on a phone, scrolled below the box). The box's own background keeps the text under it hidden. */
    #preview_txt .dblite-preview-more{display:block!important;position:sticky!important;bottom:-5px;z-index:1;background:inherit;margin-top:.6em;padding-top:.35em;padding-bottom:5px;border-top:1px solid color-mix(in srgb,var(--dbt-accent) 35%,transparent);white-space:normal;font-style:normal}#preview_txt .dblite-preview-more>span{display:block}
    /* The Summon Lab breakdown of a result scrolls with the card text, above the footer. */
    #preview_txt .dblite-preview-lab{position:static!important;z-index:auto}#preview_txt .dblite-preview-lab>span[hidden]{display:none}#preview_txt .dblite-preview-lab>.dblite-lab-way{padding-left:.8em}#preview_txt .dblite-preview-lab>.dblite-lab-slot-head{margin-top:.25em}
    #preview_txt>span,#preview_txt .os-viewport>span,#preview_txt .os_viewport>span,#preview_txt .os-content>span{display:block!important;width:100%;box-sizing:border-box;white-space:pre-wrap;float:none!important}
    #field_stats{pointer-events:none;z-index:1!important}#duel.dblite-opening #field_stats{visibility:hidden!important}
    :is(#field,#duel_content) .card.dblite-card-travelling{z-index:2!important}
    #dblite-replay-rate{position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;gap:8px;align-items:center;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:8px;padding:7px 10px;color:var(--dbt-text);font:12px system-ui}
    #dblite-replay-rate select{background:var(--dbt-input);color:var(--dbt-text);border:1px solid var(--dbt-line);border-radius:5px;padding:4px;font:inherit}#dblite-replay-rate[hidden]{display:none}
    #duel #dblite-next-game{position:absolute;left:843px;top:407px;width:calc(var(--dblite-history-width,181px) - 9px);height:17px;padding:0 4px;box-sizing:border-box;border:1px solid var(--dbt-line);border-radius:4px;background:var(--dbt-panel);color:var(--dbt-text);font:600 9px/15px 'Segoe UI',sans-serif;cursor:pointer}
    #duel #dblite-next-game:disabled{opacity:.4;cursor:default}#duel #dblite-next-game[hidden]{display:none!important}
    #duel:has(#dblite-next-game:not([hidden])) #next_game_btn,#duel:has(#dblite-next-game:not([hidden])) #next_game_btn+.button{display:none!important}
    #duel.dblite-opening .lifepoints{visibility:hidden!important}
    #duel.dblite-phase-chat .phase{pointer-events:auto!important}
    #duel.dblite-local-tools :is(#think_btn,#good_btn){top:588px!important;width:28px!important;height:28px!important;box-sizing:border-box;border:1px solid;border-radius:5px;cursor:pointer;box-shadow:0 2px 4px #0004}
    #duel.dblite-local-tools #think_btn{left:769px!important;background:#655326;border-color:#c9aa53}
    #duel.dblite-local-tools #good_btn{left:803px!important;background:#294f38;border-color:#77b68a}
    #duel.dblite-local-tools :is(#think_btn,#good_btn) img{position:absolute;left:3px!important;top:3px!important;width:20px!important;height:20px!important;object-fit:contain}
    #duel.dblite-local-tools #think_btn:hover{background:#7e6933;filter:brightness(1.1)}
    #duel.dblite-local-tools #good_btn:hover{background:#346749;filter:brightness(1.1)}
    #duel.dblite-local-tools #auto_draw_cb{left:934px!important;top:624px!important}
    #duel.dblite-local-tools #auto_draw_cb + .checkbox{left:936px!important;top:626px!important}
    #duel.dblite-local-tools #auto_draw_lbl{left:952px!important;top:627px!important;width:44px!important;white-space:nowrap!important;font:9px/12px 'Segoe UI',sans-serif!important;transform:none!important}
    #duel.dblite-local-tools :is(#shuffle_btn,#show_hand_btn){top:612px!important;scale:.8;transform-origin:top left}
    #duel.dblite-local-tools #shuffle_btn{left:874px!important}
    #duel.dblite-local-tools #show_hand_btn{left:905px!important}
    #duel .dblite-sort-hand{position:absolute;left:843px;top:612px;width:30px;height:30px;padding:0;background:none;border:0;border-radius:3px;scale:.8;transform-origin:top left;cursor:pointer}
    #duel .dblite-sort-hand svg{position:static;width:30px;height:30px;display:block}
    #duel .dblite-sort-hand:hover{background:var(--dbt-panel-2);filter:drop-shadow(0 0 3px var(--dbt-accent))}
    #duel .dblite-sort-hand:focus-visible{outline:2px solid var(--dbt-accent)}
    #duel .dblite-sort-hand:disabled{opacity:.4;cursor:default}
    #duel .dblite-sort-hand[hidden]{display:none!important}
    #duel.dblite-history-layout.dblite-duel-layout .lifepoints{left:var(--dblite-lp-left,var(--dblite-turn-left))!important;width:116px!important;scale:var(--dblite-lp-scale,.62);transform-origin:top left}
    #duel.dblite-history-layout.dblite-duel-layout .lifepoints .life_bar{transform:scaleX(.695);transform-origin:left center;left:3px!important;top:3px!important;height:24px!important;overflow:hidden}
    #duel.dblite-history-layout.dblite-duel-layout .lifepoints .life_border{width:111px!important;box-sizing:border-box;height:30px!important}
    #duel.dblite-history-layout.dblite-duel-layout .lifepoints .life_txt{left:3px!important;top:0!important;width:108px!important;text-align:center!important;font-size:26px;line-height:30px}
    #duel.dblite-history-layout.dblite-layout-links .lifepoints .life_txt{font-size:28px}
    #duel.dblite-history-layout.dblite-duel-layout #lifepoints2{top:275px!important}
    #duel.dblite-history-layout.dblite-duel-layout #lifepoints1{top:326px!important}
    body>.dblite-duel-tools{position:fixed;left:12px;bottom:72px;width:auto;height:32px;display:flex;gap:5px;pointer-events:auto;z-index:1000}.dblite-duel-tools .dblite-find-card{width:132px;flex:0 0 132px}.dblite-duel-tools .dblite-chat-wheel-button{flex:0 0 auto}
    .dblite-duel-tools button{position:static;flex:1;min-width:0;white-space:nowrap;padding:5px 8px;border:1px solid var(--dbt-line);border-radius:5px;background:var(--dbt-panel-2);color:var(--dbt-text);font:600 12px/18px 'Segoe UI',sans-serif;cursor:pointer}
    .dblite-duel-tools button:disabled{opacity:.4;cursor:default}
    .dblite-duel-tools button[hidden],.dblite-chat-typing[hidden]{display:none!important}
    .dblite-duel-tools .dblite-position-wheel-toggle{flex:0 0 auto}.dblite-duel-tools .dblite-position-wheel-toggle[aria-pressed="true"]{border-color:var(--dbt-accent)}
    html.dbetter-touch .dblite-duel-tools .dblite-position-wheel-toggle{display:none}
    body>.dblite-duel-tools.dblite-tools-column{flex-direction:column;height:auto}.dblite-duel-tools.dblite-tools-column button{flex:0 0 32px;width:auto;height:32px;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis}
    .dblite-duel-tools.dblite-tools-icons button{padding:0;font-size:0}.dblite-duel-tools.dblite-tools-icons button::before{content:attr(data-icon);font-size:16px;line-height:30px}
    .dblite-quick-note{position:fixed;left:12px;bottom:110px;z-index:2147483000;max-width:min(420px,calc(100vw - 24px));padding:7px 11px;border:1px solid var(--dbt-line);border-radius:8px;background:var(--dbt-panel);color:var(--dbt-text);font:600 12px/1.35 'Segoe UI',sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.4);pointer-events:none}
    replay-scout{translate:0 calc(-1px * var(--dblite-scout-lift,0))}
    #duel .dblite-chat-typing{position:absolute;left:845px;top:394px;width:calc(var(--dblite-history-width,181px) - 4px);height:11px;font:600 8.5px/11px 'Segoe UI',sans-serif;color:var(--dbt-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
    .dbetter-night #duel .dblite-chat-typing{color:var(--dbt-text)}
    .dblite-card-search{position:fixed;z-index:2147483002;display:flex;flex-direction:column;gap:6px;height:330px;resize:both;overflow:hidden;min-width:100px;min-height:200px;padding:8px;box-sizing:border-box;border:1px solid var(--dbt-line);border-radius:10px;background:var(--dbt-panel);color:var(--dbt-text);font:13px/1.4 'Segoe UI',sans-serif;box-shadow:0 12px 38px #0007}
    .dblite-card-search *{position:static;box-sizing:border-box}
    .dblite-card-search header{display:flex;align-items:center;gap:4px;flex-shrink:0;padding:0;margin:0}
    .dblite-card-search header button{flex:0 0 auto;padding:0 4px;font-size:18px;line-height:1;color:inherit;background:transparent;border:0;cursor:pointer}
    .dblite-search-filters{display:flex;flex-wrap:wrap;gap:4px;flex-shrink:0}
    .dblite-search-fields{display:flex;flex:1 1 auto;gap:2px;flex-shrink:0;padding:2px;border-radius:5px;background:var(--dbt-input)}
    .dblite-search-fields button{flex:1;padding:2px 3px;border:0;border-radius:3px;color:var(--dbt-text);background:transparent;font:600 10px 'Segoe UI',sans-serif;cursor:pointer}
    .dblite-search-fields button[aria-pressed="true"]{background:var(--dbt-input);color:var(--dbt-text)}
    .dblite-search-fields button:focus-visible{outline:2px solid var(--dbt-accent)}
    .dblite-card-search input{flex:1 1 auto;min-width:0;width:100%;padding:5px 7px;border:1px solid var(--dbt-line);border-radius:5px;background:var(--dbt-input);color:var(--dbt-text);font:inherit}
    .dblite-card-search .dblite-search-count{margin:0;color:var(--dbt-muted);font-size:10px;line-height:1.2;flex-shrink:0}
    .dblite-search-results{overflow:auto;min-height:0;overscroll-behavior:contain}
    .dblite-search-result{display:block;width:100%;padding:5px 6px;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--dbt-line);color:inherit;font:600 12px/1.4 'Segoe UI',sans-serif;cursor:pointer}
    .dblite-search-result:has(.dblite-search-art){display:grid;grid-template-columns:34px 1fr;column-gap:8px;align-items:center}.dblite-search-art{order:-1;grid-row:span 2;width:34px;height:34px;border-radius:4px;object-fit:cover;background:var(--dbt-panel)}
    .dblite-search-result small{display:block;font-weight:400;font-size:10px;color:var(--dbt-muted)}
    .dblite-search-result:hover,.dblite-search-result:focus-visible{background:var(--dbt-panel-2);outline:1px solid var(--dbt-accent);outline-offset:-1px}
    .dblite-hand-insert{position:absolute;width:3px;border-radius:3px;background:var(--dbt-accent);box-shadow:0 0 6px var(--dbt-accent);pointer-events:none}
    .dblite-chance-native{visibility:hidden!important}
    .dblite-hide-declaration-chat #duel .cout_txt .dblite-declaration-chat{display:none!important}
    .dblite-hide-screenshot #screenshot_btn{display:none!important}
    .dblite-chance{position:fixed;z-index:2147483001;width:160px;pointer-events:none;color:var(--dbt-text);font:13px/1.4 system-ui,sans-serif;text-align:center}
    .dblite-chance *{box-sizing:border-box;pointer-events:none}
    .dblite-chance-stage{position:relative!important;height:116px;perspective:550px;display:grid;place-items:center}
    .dblite-chance-stage:before{content:'';position:absolute;width:80px;height:18px;bottom:5px;left:40px;border-radius:50%;background:radial-gradient(ellipse,#0005,transparent 70%)}
    .dblite-chance-pose{position:relative!important;transform-style:preserve-3d}
    .dblite-chance-die .dblite-chance-pose{transform:rotateX(-20deg) rotateY(-28deg)}
    .dblite-chance-coin .dblite-chance-pose{transform:rotateX(12deg) rotateZ(-8deg)}
    /* Opacity/filter on the rotating object flatten its faces in Chromium. */
    .dblite-chance-object{position:relative!important;width:64px;height:64px;transform-style:preserve-3d}
    .dblite-chance-die .dblite-chance-object{transform:rotateX(var(--rx)) rotateY(var(--ry));animation:dblite-die-tumble 1.12s cubic-bezier(.2,.65,.25,1) both}
    .dblite-die-face{position:absolute!important;inset:0;display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:10px;border:1px solid #c2cfc5;border-radius:5px;background:linear-gradient(135deg,#fffff5,#d8e3da);backface-visibility:hidden;box-shadow:inset 0 0 0 2px #ffffff66}
    .dblite-die-face i{position:static!important;width:10px;height:10px;border-radius:50%;background:#233e36;box-shadow:inset 0 2px 2px #0009,0 1px #fff9}
    .dblite-die-face[data-face="1"]{transform:translateZ(32px)}.dblite-die-face[data-face="2"]{transform:rotateY(90deg) translateZ(32px)}.dblite-die-face[data-face="3"]{transform:rotateX(90deg) translateZ(32px)}.dblite-die-face[data-face="4"]{transform:rotateX(-90deg) translateZ(32px)}.dblite-die-face[data-face="5"]{transform:rotateY(-90deg) translateZ(32px)}.dblite-die-face[data-face="6"]{transform:rotateY(180deg) translateZ(32px)}
    .dblite-chance-coin .dblite-chance-object{width:70px;height:70px;transform:rotateY(var(--ry));animation:dblite-coin-toss 1.25s ease-out both}
    .dblite-coin-face{position:absolute!important;inset:0;display:grid;place-items:center;border-radius:50%;border:3px solid #c49b50;background:radial-gradient(circle at 30% 25%,#fff1b4,#dbb66b 60%,#ab7f38);color:#745019;font:700 30px Georgia,serif;text-shadow:0 1px #fff6d4;box-shadow:inset 0 0 0 3px #ffe8a3,inset 0 0 0 5px #b98f43;backface-visibility:hidden}
    .dblite-coin-face.heads{transform:translateZ(3px)}
    .dblite-coin-face.tails{transform:rotateY(180deg) translateZ(3px);background:radial-gradient(circle at 30% 25%,#f4edcd,#cebb83 60%,#988049)}
    .dblite-coin-edge{position:absolute!important;inset:1px;border-radius:50%;background:#ad813e;border:1px dashed #e3bd72}
    .dblite-chance-caption{position:relative!important;padding:7px 14px;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:10px;animation:dblite-chance-result .18s .86s both}
    .dblite-chance-caption span,.dblite-chance-caption strong{position:static!important;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dblite-chance-caption span{font-size:11px;color:var(--dbt-muted)}.dblite-chance-caption strong{font-size:17px;letter-spacing:.02em}
    @keyframes dblite-die-tumble{0%{transform:translate(-85px,-60px) rotateX(calc(var(--rx) + 620deg)) rotateY(calc(var(--ry) + 450deg)) rotateZ(-70deg)}45%{transform:translate(12px,-25px) rotateX(calc(var(--rx) + 210deg)) rotateY(calc(var(--ry) + 170deg)) rotateZ(30deg)}76%{transform:translate(-3px,4px) rotateX(calc(var(--rx) + 20deg)) rotateY(calc(var(--ry) + 15deg))}90%{transform:translate(1px,-3px) rotateX(var(--rx)) rotateY(var(--ry))}100%{transform:translate(0,0) rotateX(var(--rx)) rotateY(var(--ry))}}
    @keyframes dblite-coin-toss{0%{transform:translateY(55px) rotateY(calc(var(--ry) - 1260deg)) rotateZ(-20deg)}38%{transform:translateY(-45px) rotateY(calc(var(--ry) - 720deg)) rotateZ(10deg)}69%{transform:translateY(4px) rotateY(var(--ry)) rotateZ(-8deg)}80%{transform:translateY(-8px) rotateY(var(--ry)) rotateZ(5deg)}89%{transform:translateY(1px) rotateY(var(--ry)) rotateZ(-2deg)}100%{transform:translateY(0) rotateY(var(--ry))}}
    @keyframes dblite-chance-result{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}
    @media(prefers-reduced-motion:reduce){.dblite-chance .dblite-chance-object,.dblite-chance-caption{animation:none!important}}
    /* Native Special Summon layers already sit behind the field cards. */
    #profile_viewer .dblite-return-game{position:absolute;left:210px;top:606px;z-index:10;width:150px;height:30px;border:1px solid var(--dbt-line);border-radius:5px;background:var(--dbt-panel);color:var(--dbt-text);font:600 14px/24px 'Segoe UI',Arial,sans-serif;cursor:pointer}
    .dblite-profile-picture{cursor:pointer}.dblite-profile-picture:focus-visible{outline:2px solid var(--dbt-accent);outline-offset:2px}
    .dblite-profile-feedback{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:500px;padding:12px 18px;background:var(--dbt-panel);color:var(--dbt-text);border:1px solid var(--dbt-line);border-radius:6px;z-index:999999;font:14px/1.5 system-ui}
    #duel .duel_avatar :is(.dblite-profile-button,.dblite-chat-button){position:absolute;left:auto;right:8px;bottom:auto;top:8px;z-index:4;width:68px;height:25px;padding:3px 6px;border:1px solid var(--dbt-line);border-radius:5px;background:var(--dbt-panel-2);color:var(--dbt-text);font:600 11px/17px 'Segoe UI',Arial,sans-serif;cursor:pointer;opacity:0;pointer-events:none}
    #duel .duel_avatar .dblite-chat-button{right:81px;width:54px}
    #duel .duel_avatar:hover :is(.dblite-profile-button,.dblite-chat-button),#duel .duel_avatar:focus-within :is(.dblite-profile-button,.dblite-chat-button){opacity:1;pointer-events:auto}
    #duel :is(.dblite-profile-button,.dblite-chat-button):focus-visible{outline:2px solid var(--dbt-accent);outline-offset:2px;opacity:1;pointer-events:auto}
    /* Touch screens: a tap on the avatar opens these at full size (avatarMenu); the miniature ones stay hidden. */
    html.dbetter-touch #duel .duel_avatar :is(.dblite-profile-button,.dblite-chat-button){display:none}
    .dblite-avatar-menu{position:fixed;z-index:2147483600;display:flex;flex-direction:column;gap:8px;padding:8px;border:1px solid var(--dbt-line);border-radius:10px;background:var(--dbt-panel);box-shadow:0 8px 28px #000a}
    .dblite-avatar-menu button{min-width:120px;min-height:40px;padding:0 14px;border:1px solid var(--dbt-line);border-radius:8px;background:var(--dbt-input);color:var(--dbt-text);font:600 15px system-ui,sans-serif;cursor:pointer}
    html.dblite-hide-spiral :is(#ss_glow,#ss_spiral)>img{visibility:hidden!important}
    .dblite-summon-motion :is(#ss_glow,#ss_spiral){pointer-events:none}
    .dblite-summon-motion :is(#ss_glow,#ss_spiral)>img{visibility:hidden}
    .dblite-summon-motion :is(#ss_glow,#ss_spiral)::before{content:"";position:absolute;inset:0;box-sizing:border-box;padding:2px;border-radius:50%;background:linear-gradient(to bottom,var(--dblite-summon-color,#b0f2dc) 40%,var(--dblite-summon-secondary,#b0f2dc) 60%);mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude}
    .dblite-summon-motion :is(#ss_glow,#ss_spiral){filter:drop-shadow(0 -2px 3px var(--dblite-summon-color,#b0f2dc)) drop-shadow(0 2px 3px var(--dblite-summon-secondary,#b0f2dc))}
    .dblite-summon-motion #ss_spiral::before{inset:5px;padding:1px;opacity:.8}
    #field .dblite-move-summon{position:absolute;width:0;height:0;pointer-events:none}
    #field .dblite-move-summon i{position:absolute;left:-46px;top:-29px;width:92px;height:58px;box-sizing:border-box;padding:2px;border-radius:50%;background:linear-gradient(var(--dblite-summon-color) 40%,var(--dblite-summon-secondary) 60%);mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;filter:drop-shadow(0 0 4px var(--dblite-summon-color));animation:dblite-move-summon .8s cubic-bezier(.2,.7,.3,1) both;pointer-events:none}
    #field .dblite-move-summon i+i{padding:1px;animation-delay:.08s}
    @keyframes dblite-move-summon{0%{transform:scale(.25);opacity:0}20%{opacity:.95}100%{transform:scale(1.25);opacity:0}}
    @media(prefers-reduced-motion:reduce){.dblite-move-summon{display:none!important}}
    @media(prefers-reduced-motion:reduce){.dblite-summon-motion :is(#ss_glow,#ss_spiral){visibility:hidden!important}}
    /* Keep the native checkbox clickable without covering cards with its label. */
    #choose_zones{width:24px!important}
    #choose_zones .background{pointer-events:none}
    #choose_zones_lbl{opacity:0;pointer-events:none}
    #choose_zones_cb:is(:hover,:focus-visible)~#choose_zones_lbl{opacity:1}
    #choose_zones:has(#choose_zones_cb:is(:hover,:focus-visible)) .background{width:110px!important}
    :is(#field,#duel_content) .card.dblite-hand-card{translate:0 0;transition:translate var(--dblite-motion-fast,140ms) cubic-bezier(.22,.61,.36,1)}
    :is(#field,#duel_content) .card.dblite-hand-raised{translate:0 -8px;z-index:1000!important}
    /* Native hand cards live in #duel_content .cards, beside #field. Their
       content is centered with translate(-50%,-50%), so extend that hit area. */
    :is(#field,#duel_content) .card.dblite-hand-raised>.content::after{content:"";position:absolute;left:0;top:100%;width:100%;height:55px;pointer-events:auto}
    @media(prefers-reduced-motion:reduce){:is(#field,#duel_content) .card.dblite-hand-card{translate:none!important;transition:none}}
    :is(#field,#duel_content) .card.dblite-pile-card{translate:0 0;transition:translate var(--dblite-motion-fast,140ms) cubic-bezier(.22,.61,.36,1)}
    :is(#field,#duel_content) .card.dblite-pile-raised{translate:0 -5px;filter:brightness(1.05) drop-shadow(0 5px 7px #0006)}
    @media(prefers-reduced-motion:reduce){:is(#field,#duel_content) .card.dblite-pile-card{translate:none!important;transition:none}}
    #dblite-card-link{position:absolute;z-index:1;transform-origin:bottom left;white-space:nowrap;background:var(--dbt-panel);color:var(--dbt-text);border:1px solid var(--dbt-line);border-radius:3px;padding:0 4px;font:600 9px/1.5 system-ui;text-decoration:none;opacity:.85}#dblite-card-link:hover{opacity:1}
    #dblite-card-link[hidden]{display:none!important}#dblite-card-link:hover{background:var(--dbt-panel-2)}#dblite-card-link:focus-visible{outline:2px solid white}
    #dblite-replay,#dblite-status{position:fixed;z-index:2147483646;right:16px;bottom:16px;padding:10px 16px;border:1px solid var(--dbt-line);border-radius:8px;background:var(--dbt-panel);color:var(--dbt-text);font:14px/1.4 system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 18px #0005}
    #dblite-status{bottom:66px;max-width:320px;pointer-events:none}
    .dblite-login-retry{position:fixed;z-index:2147483646;left:50%;top:24px;translate:-50% 0;width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:14px 16px;border:1px solid var(--dbt-line);border-radius:10px;background:var(--dbt-panel);color:var(--dbt-text);font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px #0007}
    .dblite-login-retry strong{display:block;font-size:15px;margin-bottom:4px}.dblite-login-retry p{margin:0 0 10px;color:var(--dbt-muted)}
    .dblite-login-retry div{display:flex;gap:8px}.dblite-login-retry .dblite-login-close{flex:2;background:var(--dbt-accent);color:var(--dbt-on-accent);border-color:var(--dbt-accent);font-weight:600}.dblite-login-retry button:disabled{opacity:.5;cursor:wait}.dblite-login-retry button{flex:1;min-height:36px;border:1px solid var(--dbt-line);border-radius:6px;background:var(--dbt-input);color:var(--dbt-text);font:inherit;cursor:pointer}
    #dblite-lag-warning{position:fixed;z-index:2147483646;top:16px;right:16px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:10px 14px;border:1px solid var(--dbt-line);border-left:4px solid var(--dbt-line);border-radius:9px;background:var(--dbt-panel);color:var(--dbt-text);box-shadow:0 5px 20px #0005;font:12px/1.4 'Segoe UI',sans-serif;pointer-events:none}
    #dblite-lag-warning[hidden]{display:none!important}
    #dblite-lag-warning :is(strong,span){position:static;display:block}#dblite-lag-warning strong{font-size:13px}#dblite-lag-warning span{margin-top:2px;color:var(--dbt-text)}
    #dblite-replay[hidden],#dblite-status[hidden],.dblite-drop[hidden]{display:none!important}
    #dblite-replay:hover{background:var(--dbt-panel-2)}#dblite-replay:focus-visible{outline:3px solid white}
    #dblite-vfx-volume{position:fixed;display:flex;align-items:center;gap:6px;width:124px;height:24px;z-index:1000;color:var(--dbt-text);font:600 10px/16px 'Segoe UI',sans-serif}
    #dblite-vfx-volume input{position:static;width:92px;min-width:0;margin:0;accent-color:var(--dbt-accent);cursor:pointer}
    #dblite-vfx-volume[hidden]{display:none!important}
    :is(#field,#duel_content) .card.dblite-field-card{transition:translate 120ms ease-out}
    html:not(.dblite-dragging) :is(#field,#duel_content) .card.dblite-field-card:hover{translate:0 -2px}
    @media(prefers-reduced-motion:reduce){:is(#field,#duel_content) .card.dblite-field-card{transition:none;translate:none!important}}
    #dblite-drag-layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none}
    .dblite-ring{position:fixed;z-index:2147483646;color:var(--dbt-text);filter:drop-shadow(0 8px 16px #0009);animation:dblite-ring-in 120ms ease-out}
    .dblite-ring svg{display:block;overflow:visible}.dblite-ring *{box-sizing:border-box}
    .dblite-ring-item{cursor:pointer;outline:none}.dblite-ring-item path{fill:var(--dbt-panel);stroke:var(--dbt-accent);stroke-width:1}
    .dblite-ring-item:hover path,.dblite-ring-item:focus-visible path{fill:var(--dbt-panel-2);stroke:var(--dbt-accent)}.dblite-ring-item:active path{fill:var(--dbt-input)}
    .dblite-ring-item text{fill:var(--dbt-text);font:600 14px 'Segoe UI',system-ui,sans-serif;text-anchor:middle;pointer-events:none}.dblite-ring-item .dblite-ring-sub{font-size:10px;font-weight:400;fill:var(--dbt-text)}
    .dblite-ring-close{position:absolute;padding:0;border:1px solid var(--dbt-line);border-radius:50%;background:var(--dbt-panel);color:var(--dbt-text);font:22px/1 system-ui;cursor:pointer}
    @keyframes dblite-ring-in{from{opacity:0;scale:.85}to{opacity:1;scale:1}}
    html.dblite-wheel-open :is(.dblite-fan,.dblite-classic-switch,#view){opacity:0!important;pointer-events:none!important}
    .dblite-token-drag{position:fixed;inset:0;z-index:2147483646;pointer-events:none}
    .dblite-drop{position:absolute;box-sizing:border-box;border:2px solid var(--dbt-line);background:var(--dbt-panel);color:var(--dbt-text);font:bold 11px/1.2 system-ui;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:5px;text-shadow:0 1px 3px #000;transition:background-color var(--dblite-motion-fast,140ms) ease-out,border-color var(--dblite-motion-fast,140ms) ease-out}
    .dblite-selected{background:var(--dbt-input);border-color:var(--dbt-line);box-shadow:inset 0 0 0 1px var(--dbt-line)}
    .dblite-ghost{position:absolute;left:0;top:0;will-change:transform;max-width:130px;background:var(--dbt-panel);color:var(--dbt-text);border:1px solid var(--dbt-line);border-radius:6px;padding:5px;font:12px/1.3 system-ui;box-shadow:0 8px 25px #0007}
    .dblite-ghost img{width:65px;display:block;margin-bottom:4px}.dblite-ghost span{display:block}
    .dblite-dragging,.dblite-dragging *{user-select:none!important;cursor:grabbing!important}
  `;
  document.head.appendChild(style);
  duelTools = createDuelTools();
  lagMonitor = createLagMonitor();
  workbench = window.DBLiteWorkbench?.create({ config: () => config, canPlay, pendingSelection, allowedActions, menuEntries, menuCard, menuSource, duelTools,
    ownCard, cardInfo, dragSource, same, includes, visible, measure, announce, clearPileHover, canDraw, drawOne,
    occupied: () => !!pendingAttach || !!gesture?.active,
    suppressClicks: () => { suppressClickUntil = Date.now() + 350; } });
  window.addEventListener('dbetter-rebuild-begin', () => {
    for (const observer of [floatingObserver, roomObserver, cardNameObserver, previewObserver, artworkPreviewObserver, profileObserver]) observer.disconnect();
    nameResize?.disconnect();
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame); layoutFrame = null;
    if (clampFrame !== null) cancelAnimationFrame(clampFrame); clampFrame = null;
    clearChance();
  });
  window.addEventListener('dbetter-rebuild-end', event => {
    floatingObserver.observe(document.body, {childList:true,subtree:true});
    cardNameObserver.observe(document.body, {subtree:true,childList:true,characterData:true});
    profileObserver.observe(document.body, {subtree:true,childList:true,characterData:true});
    roomObserved = null; previewObserved = null;
    observePreview();
    observedNames.clear(); dirtyNames.clear();
    // A fresh load of the duel redoes the whole layout; recording past the furthest play only refreshes.
    if (event.detail?.mode !== 'record') { profilesDirty = true; layoutSignature = ''; }
    tick();
  });
  // Moves along the rewind tape run no DuelingBook code: refresh once things settle, not on every step.
  let tapeTimer = 0;
  window.addEventListener('dbetter-tape', () => { clearTimeout(tapeTimer); tapeTimer = setTimeout(tick, 150); });
  tick(); setInterval(tick, 1000);
  setInterval(autoRps, 250);
})();

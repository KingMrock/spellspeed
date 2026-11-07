/* DBETTER, GPL-3.0-only. Original fan UI inspired by Fuwalab's simulator.
 * No Fuwalab code or assets are included. Native DB owns all duel state.
 */
(() => {
  'use strict';
  window.DBLiteWorkbench = { create };
  function create(api) {
    const rules = window.DBLiteRules;
    const $ = (...args) => window.jQuery(...args);
    const zones = { Deck: 'main_arr', 'Extra Deck': 'extra_arr', Graveyard: 'grave_arr', Banished: 'banished_arr' };
    let fan, fanKey = '', fanZone = '', query = '', viewMode = 'fan', classicSwitch, menu, panel, toolbar;
    let deckWheel, wheelToggle;
    let sortedFan = false, sortCaptured = false;
    const histories = new Map();
    const pendingHistory = new Set();
    // Action history as a tape: entries made while the rewind core runs DuelingBook's engine are stamped with
    // their play number, so any position shows exactly the entries up to it. DuelingBook clearing the history
    // (a new game) is stored as a marker.
    const historyTape = [];
    // Entries historyTape[renderedStart, renderedEnd) are on screen. Moving forward appends the new ones only.
    let renderedStart = -1, renderedEnd = 0;
    const playNumber = () => (window.previous_plays || []).length;
    let renderingRebuildHistory = false;
    const replayHandEntries = new Set();
    let replayHandMode;
    const profileNodes = new Set();
    const signalSources = new Set(), signalStates = new Map(), signalReceipts = new WeakMap();
    let signalRevision = 0;
    let turnSnapshot = null;
    const turnHooks = new Map();
    function displayedTurn() {
      const native = Math.max(0, Number(window.turnCount) || 0);
      if (!turnSnapshot || turnSnapshot.duel !== window.duelId || turnSnapshot.player !== player()) return native;
      return Math.max(0, turnSnapshot.turn + native - turnSnapshot.native);
    }
    function hookTurns() {
      for (const name of ['watchDuelResponse', 'initDuel', 'duelStart', 'beginNextDuel', 'resetGame']) {
        const original = window[name];
        if (typeof original !== 'function' || rules.hasHook(original, turnHooks.get(name))) continue;
        const wrapped = function (data, ...rest) {
          if (['duelStart', 'beginNextDuel', 'resetGame'].includes(name)) { turnSnapshot = null; if (window.DBETTERRebuilding) historyTape.push({ pos: playNumber(), clear: true }); else clearHistories(); }
          const result = original.call(this, data, ...rest);
          if (['watchDuelResponse', 'initDuel'].includes(name)) {
            // DB adds a presentation-only turn on watch/rejoin. Preserve its
            // internal state while showing the server's actual turn number.
            const received = Number(data?.turnCount);
            turnSnapshot = { duel: window.duelId, player: player(), native: Number(window.turnCount) || 0,
              turn: Number.isFinite(received) && received > 0 ? received : Math.max(1, (Number(window.turnCount) || 1) - (name === 'watchDuelResponse' ? 1 : 0)) };
          }
          return result;
        };
        rules.markHook(wrapped, original); turnHooks.set(name, wrapped); window[name] = wrapped;
      }
    }
    function fieldPlaying() {
      return window.duel_active && !window.resetting && !/^(rps|tp)_|sid/i.test(window.currentLabel || '') &&
        (!window.currentLabel || Number(window.turnCount) > 0) &&
        !['siding','siding1','siding2'].some(id => api.visible(document.getElementById(id)));
    }
    function fieldMessage(p, kind, text, revision = ++signalRevision, details = {}) {
      if (!p) return;
      const state = signalState(p);
      if (revision < state.messageRevision) return;
      state.messageRevision = revision; state.message = { kind, text, at: window.DBETTERRebuilding ? -Infinity : Date.now(),
        turnColor: actorColor(window.turn_player?.username ? window.turn_player : p), ...details };
    }
    let historyContext = null, historyDepth = 0, profileVersus = null;
    try { const saved = sessionStorage.getItem('dblite-card-view'); if (['fan', 'grid', 'classic'].includes(saved)) viewMode = saved; } catch { /* Storage may be unavailable. */ }
    let sequence = null, wizard = null, dragging = false, fanContext = null;
    let opponentRequest = null, peerContext = null;
    const peerSeen = new Set();
    // Viewer positions, one per zone (user, 2026-10-29: the Deck, Extra Deck, GY and banished viewers each keep their own
    // place, across reloads). Without one, the viewer centres on the field, clear of the card overview.
    let savedPositions = {}, moving = null, peeking = false, spaceCaptured = false;
    const positionZone = () => (fanPassDescriptor || viewZone())?.zone || '';
    const zonePosition = () => savedPositions[positionZone()] || null;
    const defaultAppearance = { size: 100, transparency: 92, windowOpacity: 68, showHints: true, sortLayout: 'adaptive', perRow: 0, maxRows: 0 };
    // Viewer size chosen by dragging its right edge, bottom edge or corner (unscaled px); null = automatic.
    let viewDims = null;
    try { const saved = JSON.parse(localStorage.getItem('dblite-view-dimensions')); if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) viewDims = saved; } catch { /* Automatic size. */ }
    const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
    let appearance = { ...defaultAppearance }, settingsPanel, settingsAnchor;
    try {
      const saved = JSON.parse(localStorage.getItem('dblite-view-settings'));
      appearance = { size: bounded(saved?.size, 40, 150, 100), transparency: bounded(saved?.transparency, 0, 98, 92),
        windowOpacity: bounded(saved?.windowOpacity, 0, 100, 68),
        showHints: typeof saved?.showHints === 'boolean' ? saved.showHints : true,
        sortLayout: ['adaptive', 'continuous', 'stacked'].includes(saved?.sortLayout) ? saved.sortLayout : 'adaptive',
        // Most cards in one Fan/Grid row; 0 = automatic (fit the width).
        perRow: saved?.perRow === 0 ? 0 : bounded(saved?.perRow, 4, 25, 0),
        // Most rows in a Fan (3 to 5); 0 = automatic. It wins over Cards per row: rows take more cards, overlapping more.
        maxRows: saved?.maxRows === 0 ? 0 : bounded(saved?.maxRows, 3, 5, 0) };
    } catch { /* Keep defaults if stored preferences are unavailable. */ }
    const zoneSort = {};
    try {
      const saved = JSON.parse(localStorage.getItem('dblite-zone-sort'));
      for (const zone of Object.keys(zones)) if (saved?.[zone]) zoneSort[zone] = {
        sorted: saved[zone].sorted === true,
        layout: ['adaptive', 'continuous', 'stacked'].includes(saved[zone].layout) ? saved[zone].layout : appearance.sortLayout
      };
    } catch { /* Sorting preferences can still be used in memory. */ }
    const sortPreference = () => zoneSort[(fanPassDescriptor || viewZone())?.zone];
    const sortLayout = () => sortPreference()?.layout || appearance.sortLayout;
    function saveSort(change) {
      const zone = (fanPassDescriptor || viewZone())?.zone;
      if (!Object.hasOwn(zones, zone)) return;
      zoneSort[zone] = { sorted: sortPreference()?.sorted || false, layout: sortLayout(), ...change };
      try { localStorage.setItem('dblite-zone-sort', JSON.stringify(zoneSort)); } catch { /* Keep the in-memory choice. */ }
    }
    try {
      const saved = JSON.parse(localStorage.getItem('dblite-view-positions'));
      for (const [zone, point] of Object.entries(saved && typeof saved === 'object' ? saved : {}))
        if (Object.hasOwn(zones, zone) && Number.isFinite(point?.left) && Number.isFinite(point?.top)) savedPositions[zone] = { left: point.left, top: point.top };
      // The single position of earlier versions often sat over the card overview: the field-centred default replaces it.
      localStorage.removeItem('dblite-view-position');
    } catch { /* Keep automatic placement when storage is unavailable or invalid. */ }
    let observedView = null;
    let watchedView = null, watchedDisplay = '';
    const targets = new Map();
    const viewObserver = new MutationObserver(records => {
      if (!watchedView?.isConnected) return;
      const display = watchedView?.style.display;
      const changed = display !== watchedDisplay || records.some(record => record.type === 'childList');
      watchedDisplay = display;
      // Native show()/append() calls can come from existing event handlers or
      // delayed server responses. Mutation delivery runs before the next paint.
      if (changed) { fanProbe = ""; refreshFan(); }
    });
    let fanPassDescriptor = null, fanConcealment = null, fanProbe = "", fanSafety = 0, fanDockStamp = "";
    const dirtyFaces = new Set();
    const faceObserver = new MutationObserver(records => {
      for (const record of records) {
        const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const card = node?.closest('.card');
        if (card) dirtyFaces.add(card);
      }
    });
    const proxies = new WeakMap(), hooks = new Map(), receipts = new Map();
    const tileMotions = new Map();
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motionEnabled = () => !window.DBETTERRebuilding && (api.config().animations && api.config().cardMotion) && !motionQuery?.matches && !document.hidden && typeof window.DBO_chooseZone !== 'function';
    function animateTile(tile, frames, delay = 0) {
      tileMotions.get(tile)?.cancel();
      if (!motionEnabled() || !tile.animate) return;
      const animation = tile.animate(frames, { duration: 180, delay, fill: 'backwards', easing: 'cubic-bezier(.22,.61,.36,1)' });
      tileMotions.set(tile, animation);
      const clear = () => { if (tileMotions.get(tile) === animation) tileMotions.delete(tile); };
      animation.onfinish = clear; animation.oncancel = clear;
    }
    function clearTileMotions() {
      for (const [tile, animation] of tileMotions) if (!tile.isConnected || !motionEnabled()) {
        animation.cancel(); tileMotions.delete(tile);
      }
    }
    motionQuery?.addEventListener?.('change', clearTileMotions);
    const nativeView = () => document.getElementById('view');
    const name = card => api.cardInfo(card).name;
    const cardType = card => card.data('cardfront')?.data('card_type');
    const id = card => card.data('id');
    const player = () => window.player1;
    const nativeReady = () => api.canPlay() && !api.pendingSelection() && !api.occupied();
    const context = () => ({ player: player(), duel: window.duelId });
    function contextValid(ctx) {
      return !!ctx && ctx.player === player() && ctx.duel === window.duelId && window.duel_active && window.duelist &&
        !window.replay && !window.automatic && !window.tag_duel && !window.paused && !document.hidden &&
        typeof window.DBO_chooseZone !== 'function' && api.visible(document.getElementById('cig1_txt'));
    }
    const observing = () => !window.duelist || !!window.replay;
    const viewContext = () => ({ ...context(), opponent: window.player2, observing: observing() });
    function viewerValid(ctx, allowFinished = false) {
      // Spectators can keep browsing the final board. Actions and transient
      // duel effects still require an active duel through the default path.
      return !!ctx?.player && ctx.player === player() && ctx.duel === window.duelId &&
        (ctx.opponent === undefined || ctx.opponent === window.player2) &&
        (ctx.observing === undefined || ctx.observing === observing()) &&
        (window.duel_active || (allowFinished && observing())) && !window.resetting && !document.hidden && typeof window.DBO_chooseZone !== 'function' &&
        (observing() ? api.visible(document.getElementById('duel')) : contextValid(ctx));
    }
    // Only mirror a list that DB has already opened. Never request a hidden
    // pile or populate the fan from cards absent from the native viewer.
    function viewZone(title = window.viewing) {
      const first = window.Player1?.() || player();
      let owner = player(), zone = title, cards;
      if (title === 'Xyz Materials') return { zone: title, cards: window.viewing_card_with_materials?.data('xyz_arr') || [] };
      if (title === "Host's Public Extra Deck") { owner = first; zone = 'Extra Deck'; }
      else if (/^Opponent's /.test(title)) {
        zone = title.slice(11); owner = ['Graveyard', 'Banished'].includes(zone) ? player()?.opponent || window.player2 : first?.opponent || window.player2;
        if (zone === 'Extra Deck (partial)') { cards = window.random_arr || []; zone = 'Extra Deck'; }
        else if (zone === 'Public Extra Deck') zone = 'Extra Deck';
        else if (/^Deck \((?:partial|Top [135] Cards)\)$/.test(zone)) zone = 'Deck';
      } else if (title === 'Deck (Top Card)') { owner = first; zone = 'Deck'; }
      else if (['Deck', 'Extra Deck'].includes(title)) owner = first;
      const key = zones[zone] || (zone === 'Hand' && title === "Opponent's Hand" ? 'hand_arr' : null);
      return key ? { owner, zone, key, cards: cards || owner?.[key] || [], publicExtra: title.includes('Public Extra') } : null;
    }
    function ownDeckPreview(card, descriptor = fanPassDescriptor || viewZone()) {
      // The native viewer has already admitted this card. Its opening rotation
      // is cosmetic; don't clone the back while it turns toward the front.
      return ['Deck', 'Extra Deck'].includes(window.viewing) && !observing() && descriptor?.owner === player() &&
        card.data('cardfront')?.data('initialized') !== false && !!card.data('cardfront')?.data('name');
    }
    function concealed(card, descriptor = fanPassDescriptor || viewZone()) {
      if (fanConcealment?.has(card)) return fanConcealment.get(card);
      const front = card.data('cardfront'), node = card[0].querySelector('.cardfront');
      return front?.data('initialized') === false ||
        (descriptor?.zone === 'Banished' && card.data('face_down')) ||
        (descriptor?.publicExtra && (card.data('face_down') || !front?.data('pendulum'))) ||
        !!(!ownDeckPreview(card, descriptor) && node && (getComputedStyle(node).display === 'none' || node.hidden));
    }
    const displayName = card => concealed(card) ? ((fanPassDescriptor || viewZone())?.zone === 'Banished' ? 'Face-down banished card' : 'Face-down card') : name(card);
    function owned(card) {
      return !!card && api.same(api.ownCard(card[0]), card) && card.data('controller') === player() &&
        card.data('owner') === player() && !card.data('fake_card') && !card.hasClass('xyzmaterial');
    }
    function element(tag, cls, text) {
      const node = document.createElement(tag); if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text; return node;
    }
    function button(label, action, cls = '') {
      const node = element('button', cls, label); node.type = 'button'; node.onclick = action; return node;
    }
    function isolate(node) {
      for (const type of ['mousedown', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'contextmenu']) {
        node.addEventListener(type, event => event.stopPropagation());
      }
      return node;
    }
    function closeMenu() { menu?.remove(); menu = null; }
    function closePanel() { panel?.remove(); panel = null; }
    function setPeek(active) {
      peeking = active;
      fan?.classList.toggle('dblite-view-peek', active);
      classicSwitch?.classList.toggle('dblite-view-peek', active);
      nativeView()?.classList.toggle('dblite-view-peek', active && !!classicSwitch);
      settingsPanel?.querySelector('.dblite-peek-preview')?.setAttribute('aria-pressed', String(active));
    }
    // Touch screens have no Space key: this button turns see-through on, and the next
    // touch or click anywhere turns it off again (the see-through viewer ignores input).
    const eyeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    function peekButton() {
      const node = button('', () => {
        closeMenu(); finishMoving(false); setPeek(true);
        const end = event => {
          if (!peeking) return;
          event.preventDefault(); event.stopImmediatePropagation(); setPeek(false);
          for (const type of ['touchstart', 'mousedown']) window.removeEventListener(type, end, true);
        };
        // After this click's own events, so the tap that started it does not end it.
        setTimeout(() => { for (const type of ['touchstart', 'mousedown']) window.addEventListener(type, end, { capture: true, passive: false }); }, 0);
      }, 'dblite-peek-toggle');
      node.innerHTML = eyeIcon; node.setAttribute('aria-label', 'See through the viewer'); node.title = 'See through (tap anywhere to come back)';
      return node;
    }
    function closeSettings(focus = false) {
      if (!settingsPanel) return;
      settingsPanel.remove(); settingsPanel = null; setPeek(false);
      settingsAnchor?.setAttribute('aria-expanded', 'false');
      if (focus && settingsAnchor?.isConnected) settingsAnchor.focus({ preventScroll: true });
      settingsAnchor = null;
    }
    function positionSettings() {
      if (!settingsPanel) return;
      const rect = settingsPanel.getBoundingClientRect(), anchor = settingsAnchor.getBoundingClientRect();
      settingsPanel.style.left = `${Math.max(8, Math.min(anchor.right - rect.width, innerWidth - rect.width - 8))}px`;
      settingsPanel.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, innerHeight - rect.height - 8))}px`;
    }
    function saveAppearance() {
      try { localStorage.setItem('dblite-view-settings', JSON.stringify(appearance)); } catch { /* Retain changes for this page. */ }
    }
    function updateHelperText() {
      const helper = fan?.querySelector('footer');
      if (!helper) return;
      helper.hidden = !appearance.showHints;
      positionFan(moving?.position || zonePosition());
    }
    function updateAppearance(save = false, relayout = true) {
      appearanceStyle.textContent = `.dblite-fan{--dblite-window-opacity:${appearance.windowOpacity / 100}}.dblite-view-peek{opacity:${(100 - appearance.transparency) / 100}!important}`;
      if (save) saveAppearance();
      if (!relayout) return;
      updateHelperText();
      fanKey = ''; refreshFan();
    }
    function settingsButton() {
      const toggle = button('⚙', () => {
        if (settingsPanel) { closeSettings(true); return; }
        closeMenu(); finishMoving(false); setPeek(false); settingsAnchor = toggle;
        toggle.setAttribute('aria-expanded', 'true');
        settingsPanel = isolate(element('section', 'dblite-view-settings'));
        settingsPanel.setAttribute('role', 'dialog'); settingsPanel.setAttribute('aria-label', 'Viewer settings');
        const header = element('header');
        const close = button('×', () => closeSettings(true)); close.setAttribute('aria-label', 'Close viewer settings');
        header.append(element('strong', '', 'Viewer settings'), close); settingsPanel.append(header);
        const inputs = [];
        for (const [key, label, min, max, step] of [['size', 'View size', 40, 150, 5], ['windowOpacity', 'Window opacity', 0, 100, 1], ['transparency', `${rules.keyLabel(api.config().keys.peek)} transparency`, 0, 98, 1]]) {
          const row = element('label'), caption = element('span', 'dblite-setting-caption', label), output = element('output', '', `${appearance[key]}%`);
          const input = element('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step;
          input.value = appearance[key]; input.setAttribute('aria-label', label); input.setAttribute('aria-valuetext', `${appearance[key]}%`);
          input.oninput = () => {
            appearance[key] = bounded(input.valueAsNumber, min, max, defaultAppearance[key]);
            output.textContent = `${appearance[key]}%`; input.setAttribute('aria-valuetext', output.textContent); updateAppearance(true, key === 'size');
          };
          caption.append(output); row.append(caption, input); settingsPanel.append(row); inputs.push({ key, input, output });
        }
        const layoutRow = element('label'), layoutSelect = element('select');
        layoutRow.append(element('span', 'dblite-setting-caption', 'Sorted rows'));
        layoutSelect.setAttribute('aria-label', 'Sorted rows');
        for (const [value, label] of [['adaptive', 'Adaptive'], ['continuous', 'Continuous'], ['stacked', 'Stacked']]) {
          const option = element('option', '', label); option.value = value; layoutSelect.append(option);
        }
        layoutSelect.value = sortLayout();
        layoutSelect.onchange = () => { saveSort({ layout: layoutSelect.value }); updateAppearance(); positionSettings(); };
        layoutRow.append(layoutSelect); settingsPanel.append(layoutRow);
        const perRowRow = element('label'), perRowSelect = element('select');
        perRowRow.append(element('span', 'dblite-setting-caption', 'Cards per row'));
        perRowSelect.setAttribute('aria-label', 'Cards per row');
        for (const value of [0, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25]) {
          const option = element('option', '', value ? `At most ${value}` : 'Automatic'); option.value = String(value); perRowSelect.append(option);
        }
        perRowSelect.value = String(appearance.perRow);
        perRowSelect.onchange = () => { appearance.perRow = Number(perRowSelect.value); updateAppearance(true); positionSettings(); };
        perRowRow.append(perRowSelect); settingsPanel.append(perRowRow);
        const maxRowsRow = element('label'), maxRowsSelect = element('select');
        maxRowsRow.append(element('span', 'dblite-setting-caption', 'Max rows'));
        maxRowsSelect.setAttribute('aria-label', 'Max rows');
        for (const value of [0, 3, 4, 5]) { const option = element('option', '', value ? `At most ${value}` : 'Automatic'); option.value = String(value); maxRowsSelect.append(option); }
        maxRowsSelect.value = String(appearance.maxRows);
        maxRowsSelect.onchange = () => { appearance.maxRows = Number(maxRowsSelect.value); updateAppearance(true); positionSettings(); };
        maxRowsRow.title = 'Fan view: at most this many rows; more cards share a row, overlapping more.';
        maxRowsRow.append(maxRowsSelect); settingsPanel.append(maxRowsRow);
        settingsPanel.append(element('p', 'dblite-layout-help', 'Saved for this zone. Adaptive pairs categories of fewer than five cards, with a gap. Continuous fills each row. Stacked keeps large categories in their own rows. Small Extra Deck categories can share a row in either layout, aiming for three rows; face-up Pendulums stay last. Rows never overlap.'));
        const helperRow = element('label', 'dblite-helper-setting'), helperToggle = element('input');
        helperToggle.type = 'checkbox'; helperToggle.checked = appearance.showHints;
        helperToggle.onchange = () => {
          appearance.showHints = helperToggle.checked; saveAppearance(); updateHelperText(); positionSettings();
        };
        helperRow.append(helperToggle, element('span', '', 'Show helper text')); settingsPanel.append(helperRow);
        settingsPanel.append(element('p', '', `Window opacity controls the background behind your cards. ${DBLiteRules.keyLabel(api.config().keys.peek)} hides that background and fades the cards by the selected transparency. Saved for all zones.`));
        const actions = element('div', 'dblite-setting-actions');
        const preview = button(`Preview ${DBLiteRules.keyLabel(api.config().keys.peek)}`, () => setPeek(!peeking), 'dblite-peek-preview'); preview.setAttribute('aria-pressed', 'false');
        actions.append(preview, button('Reset', () => {
          appearance = { ...defaultAppearance };
          saveSort({ layout: defaultAppearance.sortLayout }); layoutSelect.value = sortLayout();
          helperToggle.checked = appearance.showHints;
          for (const { key, input, output } of inputs) { input.value = appearance[key]; output.textContent = `${appearance[key]}%`; input.setAttribute('aria-valuetext', output.textContent); }
          updateAppearance(true);
        }));
        settingsPanel.append(actions); document.body.append(settingsPanel); positionSettings(); inputs[0].input.focus();
      }, 'dblite-settings-toggle');
      toggle.title = 'Viewer settings'; toggle.setAttribute('aria-label', 'Viewer settings');
      toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-haspopup', 'dialog'); return toggle;
    }
    function sizeClassicView(view) {
      view.classList.toggle('dblite-classic-sized', appearance.size !== 100);
      view.style.setProperty('--dblite-view-scale', '1');
      view.style.setProperty('--dblite-view-x', '0px'); view.style.setProperty('--dblite-view-y', '0px');
      if (appearance.size === 100) return;
      const rect = view.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const scale = Math.min(appearance.size / 100, Math.max(1, innerWidth - 32) / rect.width, Math.max(1, innerHeight - 32) / rect.height);
      const left = Math.max(16, Math.min(rect.left, innerWidth - rect.width * scale - 16));
      const top = Math.max(16, Math.min(rect.top, innerHeight - rect.height * scale - 16));
      // Translate in the native board's coordinates; the board itself may be scaled.
      view.style.setProperty('--dblite-view-x', `${(left - rect.left) / (rect.width / (view.offsetWidth || rect.width))}px`);
      view.style.setProperty('--dblite-view-y', `${(top - rect.top) / (rect.height / (view.offsetHeight || rect.height))}px`);
      view.style.setProperty('--dblite-view-scale', String(scale));
    }
    function fanResizeHandle(edge) {
      const handle = element('div', 'dblite-fan-resize'); handle.dataset.edge = edge;
      handle.title = 'Drag to resize the viewer · double-click to restore the automatic size';
      let drag = null, frame = 0;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !fan) return;
        event.preventDefault(); event.stopPropagation();
        const scale = appearance.size / 100, rect = fan.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, width: rect.width / scale, height: rect.height / scale, scale, id: event.pointerId };
        try { handle.setPointerCapture(event.pointerId); } catch { /* Mouse capture is optional. */ }
      });
      handle.addEventListener('pointermove', event => {
        if (!drag) return;
        viewDims = {
          width: Math.round(edge === 's' ? drag.width : Math.max(300, drag.width + (event.clientX - drag.x) / drag.scale)),
          height: Math.round(edge === 'e' ? drag.height : Math.max(180, drag.height + (event.clientY - drag.y) / drag.scale)) };
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; fanKey = ''; refreshFan(); });
      });
      const finish = () => {
        if (!drag) return; drag = null;
        try { localStorage.setItem('dblite-view-dimensions', JSON.stringify(viewDims)); } catch { /* Keep for this page. */ }
      };
      handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
      handle.addEventListener('dblclick', event => {
        event.preventDefault(); event.stopPropagation(); viewDims = null;
        try { localStorage.removeItem('dblite-view-dimensions'); } catch { /* Nothing saved. */ }
        fanKey = ''; refreshFan();
      });
      for (const type of ['mousedown', 'click', 'contextmenu']) handle.addEventListener(type, event => event.stopPropagation());
      return handle;
    }
    function positionFan(point = zonePosition()) {
      if (!fan) return;
      const band = api.config().adaptiveLayout && api.config().adaptiveDock && window.DBLiteLayout?.band;
      const scale = appearance.size / 100;
      if (!point && band) { fan.style.maxWidth = band.width / scale + 'px'; fan.style.maxHeight = band.height / scale + 'px'; point = { left: band.left, top: band.top }; }
      else { fan.style.maxWidth = (innerWidth - 32) / scale + 'px'; fan.style.maxHeight = (innerHeight - 32) / scale + 'px'; }
      // Phones: between the card overview and the OK / Thinking column, so neither is covered.
      // A position saved by moving the viewer is ignored on phones, where the move handle is hidden.
      const phoneArea = !moving && !band && document.documentElement.classList.contains('dbetter-phone') ? phoneViewerArea() : null;
      if (phoneArea) fan.style.maxWidth = (phoneArea.right - phoneArea.left) / scale + 'px';
      const rect = fan.getBoundingClientRect();
      // Staying in the window comes first: a viewer wider than the space beside the overview is centred as before.
      const area = !point && !phoneArea && !band ? fieldViewerArea() : null, fieldArea = area && rect.width <= area.right - area.left ? area : null;
      const left = phoneArea ? Math.max(phoneArea.left, Math.min(phoneArea.left + (phoneArea.right - phoneArea.left - rect.width) / 2, phoneArea.right - rect.width)) :
        fieldArea ? Math.max(fieldArea.left, Math.min(fieldArea.centerX - rect.width / 2, fieldArea.right - rect.width)) :
        Math.max(16, Math.min(point?.left ?? (innerWidth - rect.width) / 2, innerWidth - rect.width - 16));
      const top = Math.max(phoneArea ? 6 : 16, Math.min(phoneArea ? (innerHeight - rect.height) / 2 : point?.top ?? (fieldArea ? fieldArea.centerY - rect.height / 2 : (innerHeight - rect.height) / 2), innerHeight - rect.height - (phoneArea ? 6 : 16)));
      fan.style.left = `${left}px`; fan.style.top = `${top}px`;
      return { left, top };
    }
    // Desktop default: centred on the field, right of the card overview (never over it).
    function fieldViewerArea() {
      const box = node => node?.getClientRects().length ? node.getBoundingClientRect() : null;
      const field = box(document.getElementById('field')), preview = box(document.getElementById('preview'));
      if (!field?.width) return null;
      const left = Math.max(16, preview?.width ? preview.right + 8 : 16), right = innerWidth - 16;
      return right - left > 200 ? { left, right, centerX: (field.left + field.right) / 2, centerY: (field.top + field.bottom) / 2 } : null;
    }
    function phoneViewerArea() {
      const box = node => node?.getClientRects().length ? node.getBoundingClientRect() : null;
      const preview = box(document.getElementById('preview')), column = box(document.querySelector('.dbetter-signal-bar:not([hidden])'));
      // The overview's place is kept even while it is empty (it appears with the first tapped card).
      const stage = box(document.getElementById('content')), scale = Number(window.contentScale) || 1;
      const left = Math.max(preview ? preview.right + 6 : 8, stage ? stage.left + 206 * scale : 8), right = column ? column.left - 6 : innerWidth - 8;
      return right - left > 200 ? { left, right } : null;
    }
    function rememberPosition(point) {
      const zone = positionZone();
      if (!Object.hasOwn(zones, zone)) return;
      if (point) savedPositions[zone] = { left: point.left, top: point.top }; else delete savedPositions[zone];
      try { localStorage.setItem('dblite-view-positions', JSON.stringify(savedPositions)); } catch { /* Keep the position for this page when storage is unavailable. */ }
    }
    function finishMoving(save) {
      if (!moving) return;
      if (save && moving.changed) rememberPosition(positionFan(moving.position));
      else positionFan(moving.start);
      moving = null; fan?.classList.toggle('dblite-view-moving', false);
    }
    function centerFan() { finishMoving(false); rememberPosition(null); positionFan(); }
    function moveHandle() {
      const handle = button('⠿', () => {}, 'dblite-move');
      handle.setAttribute('aria-label', 'Move card viewer');
      handle.title = 'Drag to move · Arrow keys to move · Double-click or Home to center';
      handle.ondblclick = centerFan;
      handle.addEventListener('keydown', event => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!directions[event.key] && event.key !== 'Home') return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Home') { centerFan(); return; }
        const rect = fan.getBoundingClientRect(), step = event.shiftKey ? 40 : 10, [x, y] = directions[event.key];
        rememberPosition(positionFan({ left: rect.left + x * step, top: rect.top + y * step }));
      });
      return handle;
    }
    function hideFan() {
      finishMoving(false); closeSettings(); setPeek(false);
      faceObserver.disconnect(); observedView = null; dirtyFaces.clear();
      fan?.remove(); fan = null; fanKey = ''; fanZone = ''; sortedFan = false;
      clearTileMotions();
      classicSwitch?.remove(); classicSwitch = null;
      { const view = nativeView(); view?.classList.toggle('dblite-native-view', false); view?.classList.toggle('dblite-classic-sized', false); }
      for (const key of ['--dblite-view-scale', '--dblite-view-x', '--dblite-view-y']) nativeView()?.style.removeProperty(key);
      fanContext = null;
    }
    // DuelingBook asks for a zone (or attack target) on the field, which the viewer covers:
    // hide it while the choice is open, then close it once the choice is made.
    let zonePickViewer = false;
    function viewerDuringZonePick() {
      const picking = !!(fan || classicSwitch || window.viewing && zones[window.viewing]) && api.pendingSelection() && !sequence && !wizard && !soloPractice && !panel;
      document.documentElement.classList.toggle('dblite-zone-pick', picking);
      if (picking) { zonePickViewer = true; closeMenu(); return; }
      if (!zonePickViewer) return;
      zonePickViewer = false;
      if (viewZone() && nativeReady() && !sequence && !wizard) closeViewer();
    }
    function closeViewer() {
      targets.clear();
      hideFan(); if (viewZone() && typeof window.exitViewing === 'function') window.exitViewing();
    }
    function openPile(zone) {
      if (!nativeReady() || sequence || wizard) return;
      if (window.viewing === zone) return;
      if (window.viewing) { if (!zones[window.viewing]) return; closeViewer(); }
      const pile = player()?.[zones[zone]];
      if (!pile?.length) { api.announce(`${zone} is empty.`); return; }
      if (zone === 'Deck' || zone === 'Extra Deck') window.cardMenuClicked?.(pile[0], zone === 'Deck' ? 'View deck' : 'View ED');
      else if (zone === 'Graveyard') window.viewGY?.();
      else window.viewBanished?.();
      refreshFan();
    }
    function canResolveFifty(card) {
      return (api.config().quickActions && api.config().cardMacros) && owned(card) && name(card) === 'Fifty Fifty?' && cardType(card) === 'Spell' &&
        !card.data('face_down') && (api.cardInfo(card).onField || api.includes(player().grave_arr, card));
    }
    function canResolveVidolium(card) {
      return (api.config().quickActions && api.config().cardMacros) && owned(card) && name(card) === 'Vidolium the Unstable Power Patron of Unity' &&
        cardType(card) === 'Monster' && !card.data('face_down') && api.cardInfo(card).inMonsterZone;
    }
    function cardMenuEntries(card) {
      const entries = api.menuEntries(card);
      if (canResolveFifty(card)) entries.push({ data: 'dblite:fifty-fifty', label: 'Resolve effect · Spellspeed', run: () => startFifty(card) });
      if (canResolveVidolium(card)) entries.push({ data: 'dblite:vidolium', label: 'Banish your GY face-down · Spellspeed', run: () => batchDialog('vidolium', card) });
      const position = ['To ATK', 'To DEF', 'Flip', 'Flip Summon', 'Set monster', 'Set ST', 'Set Field Spell', 'Activate ST', 'Activate Field Spell'];
      return entries.map(entry => ({ ...entry,
        position: api.cardInfo(card).onField && position.includes(entry.data),
        effect: entry.data.startsWith('dblite:') || /\b(effect|event)\b|^Resolve /i.test(entry.data) ||
          /^Resolve Effect$|^(Banish|Mill|Draw|Reveal) \d+\b/i.test(entry.label || '') || /^(Banish|Mill) (\d+|random|top)\b/.test(entry.data)
      })).sort((a, b) => (a.position ? 0 : a.effect ? 1 : 2) - (b.position ? 0 : b.effect ? 1 : 2));
    }
    // With Right-click actions off, Fan and Grid cards open the same action list on hover,
    // like DuelingBook's own hover menu on the board.
    let hoverMenuTimer = null, hoveredTile = null, menuHovered = false;
    function hoverMenuOpen() { return !!menu?.classList.contains('dblite-hover-menu'); }
    function scheduleHoverClose() {
      clearTimeout(hoverMenuTimer);
      hoverMenuTimer = setTimeout(() => { if (hoverMenuOpen() && !menuHovered && hoveredTile !== menu.dbliteAnchor) closeMenu(); }, 220);
    }
    function hoverCardMenu(tile, card) {
      clearTimeout(hoverMenuTimer);
      if (api.config().contextMenu || dragging || peeking || observing() || concealed(card) && !api.menuSource(card)) return;
      hoverMenuTimer = setTimeout(() => {
        if (!tile.isConnected || hoveredTile !== tile || dragging || menu && !hoverMenuOpen()) return;
        if (hoverMenuOpen() && menu.dbliteAnchor === tile) return;
        const r = tile.getBoundingClientRect(); openCardMenu(card, r.right - 8, r.top + 6, tile);
      }, 140);
    }
    // DuelingBook rebuilds the card overview on every previewCard call, which blanks its artwork
    // for a frame even for the card already shown. A tap is a hover plus a click: preview once.
    let previewed = null;
    function previewOnce(card) {
      const shown = window.preview?.data?.('id'), front = card.data('cardfront')?.data?.('id');
      if (previewed?.card === card && previewed.id === shown && shown === front && front != null) return;
      window.previewCard?.(card);
      previewed = { card, id: window.preview?.data?.('id') };
    }
    function openCardMenu(card, x, y, hoverAnchor = null) {
      if (!nativeReady() || sequence || wizard || !api.menuSource(card)) return;
      const entries = cardMenuEntries(card); if (!entries.length) return;
      // Declare is the most frequent action; it always leads the list.
      entries.sort((a, b) => (b.data === 'Declare') - (a.data === 'Declare'));
      closeMenu(); window.removeCardMenu?.('DBETTER context menu');
      const ctx = context(), source = api.menuSource(card), viewer = window.viewing, cardId = id(card),
        controller = card.data('controller'), owner = card.data('owner');
      menu = isolate(element('div', 'dblite-menu')); menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `${name(card)} actions`);
      menu.append(element('strong', '', name(card)));
      const labels = { 'SS ATK': 'Special Summon · ATK', 'SS DEF': 'Special Summon · DEF', 'Set monster': 'Set monster face-down',
        'Set ST': 'Set face-down', 'To GY': 'Send to Graveyard', 'Banish FD': 'Banish face-down', 'To T Deck': 'Top of Deck',
        'To B Deck': 'Bottom of Deck', 'To ST': 'Place in Spell/Trap Zone', 'To ED FU': 'Extra Deck face-up' };
      for (const entry of entries) {
        const action = entry.data;
        const positionLabels = { 'To ATK': 'Switch to ATK', 'To DEF': 'Switch to DEF', 'Flip': 'Flip face-up · keep DEF',
          'Set monster': 'Set face-down · DEF', 'Set ST': 'Set face-down', 'Set Field Spell': 'Set face-down',
          'Activate ST': 'Activate face-up', 'Activate Field Spell': 'Activate face-up' };
        const item = button((entry.position && positionLabels[action]) || entry.label || labels[action] || action, event => {
          closeMenu();
          if (contextValid(ctx) && nativeReady() && api.menuSource(card) === source && window.viewing === viewer &&
              id(card) === cardId && card.data('controller') === controller && card.data('owner') === owner &&
              cardMenuEntries(card).some(fresh => fresh.data === action && fresh.label === entry.label)) {
            if (entry.run) entry.run(); else window.cardMenuClicked?.(card, action, event);
          } else api.announce('That action changed. Open the card menu again.');
        }); item.setAttribute('role', 'menuitem'); item.dataset.action = action;
        item.classList.toggle('dblite-position-action', entry.position);
        item.classList.toggle('dblite-card-effect', entry.effect);
        menu.append(item);
      }
      if (hoverAnchor) {
        menu.classList.toggle('dblite-hover-menu', true); menu.dbliteAnchor = hoverAnchor;
        menuHovered = false;
        menu.addEventListener('mouseleave', () => { menuHovered = false; scheduleHoverClose(); }); menu.addEventListener('mouseenter', () => { menuHovered = true; clearTimeout(hoverMenuTimer); });
      }
      document.body.append(menu);
      const rect = menu.getBoundingClientRect();
      // A hover menu that does not fit right of the card opens on its left instead.
      const left = hoverAnchor && x + rect.width > innerWidth - 8 ? hoverAnchor.getBoundingClientRect().left - rect.width + 8 : x;
      menu.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
      // Hover menus never take the keyboard: shortcut keys keep working while pointing at cards.
      if (!hoverAnchor) menu.querySelector('button')?.focus({ preventScroll: true });
    }
    function copyFace(card, face) {
      const root = card[0];
      // Compare before cloning. Ignore only native root movement and DBETTER's
      // transient declaration effects; descendant front/back styles still count.
      const stamp = node => {
        if (node.nodeType !== 1) return node.textContent;
        if (node.classList.contains('dblite-declare-glow')) return '';
        const attrs = [...node.attributes].filter(a => !['id', 'style', 'class'].includes(a.name)).map(a => [a.name,a.value]);
        const classes = [...node.classList].filter(c => c !== 'dblite-declaring').sort();
        const styles = Array.from(node.style).filter(p => !(node === root && ['left','top','transform','z-index','opacity'].includes(p)) && !(node === root.querySelector(':scope > .content') && p === 'transform')).map(p => [p,node.style.getPropertyValue(p),node.style.getPropertyPriority(p)]);
        return [node.tagName, attrs, classes, styles, [...node.childNodes].map(stamp)];
      };
      const key = JSON.stringify([stamp(root), ownDeckPreview(card), concealed(card), observing(), (fanPassDescriptor || viewZone())?.owner === player()]);
      rules.replaceArtwork(face, () => {
      // Preserve the native front/back visibility and composed artwork. Only
      // the copy's positioning is normalized; live cards keep their transforms.
      const clone = card[0].cloneNode(true); clone.removeAttribute('id');
      clone.querySelectorAll('.dblite-declare-glow').forEach(node => node.remove());
      clone.querySelectorAll('.dblite-declaring').forEach(node => node.classList.toggle('dblite-declaring', false));
      const content = clone.querySelector(':scope > .content');
      if (content) content.style.transform = 'none';
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      clone.querySelectorAll('img').forEach(node => { node.loading = 'eager'; });
      if (ownDeckPreview(card)) {
        clone.classList.toggle('face_down', false);
        const front = clone.querySelector('.cardfront'), back = clone.querySelector('.cardback');
        if (front) { front.hidden = false; front.style.display = 'block'; front.style.visibility = 'visible'; }
        if (back) back.style.display = 'none';
      }
      if (concealed(card) && (observing() || (fanPassDescriptor || viewZone())?.owner !== player())) {
        clone.querySelector('.cardfront')?.remove();
        const back = clone.querySelector('.cardback'); if (back) back.style.display = 'block';
      }
      clone.setAttribute('aria-hidden', 'true');
      // Native movement changes the live root's positioning, not its visible face.
      for (const prop of ['left', 'top', 'transform', 'z-index', 'opacity']) clone.style.removeProperty(prop);
      return clone;
      }, key);
    }
    function refreshFaces() {
      for (const tile of fan.querySelectorAll('.dblite-fan-card')) {
        const card = proxies.get(tile);
        if (dirtyFaces.has(card[0])) copyFace(card, tile.querySelector('.dblite-fan-face'));
      }
      dirtyFaces.clear();
    }
    function refreshTargets() {
      if (window.DBETTERRebuilding) return;
      for (const [cardId, effect] of targets) {
        if (Date.now() >= effect.until || !viewerValid(effect) || effect.zone !== window.viewing ||
            !api.includes(viewZone()?.cards, effect.card)) targets.delete(cardId);
      }
      for (const tile of fan?.querySelectorAll('.dblite-fan-card') || []) {
        const effect = targets.get(id(proxies.get(tile)));
        let ring = tile.querySelector('.dblite-target-ring');
        tile.classList.toggle('dblite-targeted', !!effect);
        if (!effect) { ring?.remove(); continue; }
        if (!ring || ring.dataset.received !== String(effect.received)) {
          ring?.remove(); ring = element('span', 'dblite-target-ring');
          ring.dataset.received = String(effect.received);
          ring.setAttribute('role', 'img'); ring.setAttribute('aria-label', 'Targeted card');
          ring.style.setProperty('--dblite-target-color', effect.color);
          ring.append(element('span', 'dblite-target-label', 'Targeted')); tile.append(ring);
        }
      }
    }
    let targetReceipt = 0;
    function targetLocation(card) {
      for (const p of [player(), window.player2]) {
        if (!p) continue;
        for (const [zone, key] of Object.entries({ ...zones, Hand: 'hand_arr' })) {
          if (api.includes(p[key], card)) return { player: p, zone, key };
        }
        for (const [zone, keys] of [
          ['Monster Zone', ['m1', 'm2', 'm3', 'm4', 'm5']],
          ['S/T zone', ['s1', 's2', 's3', 's4', 's5']],
          ['Field Zone', ['fieldSpell']], ['Pendulum Zone', ['pendulumLeft', 'pendulumRight']], ['Skill Zone', ['skillCard']]
        ]) {
          const slot = keys.find(key => api.same(p[key], card));
          if (slot) return { player: p, zone, slot };
        }
        if ((p.all_cards_arr || []).some(host => api.includes(host.data('xyz_arr'), card))) return { player: p, zone: 'Xyz Materials' };
      }
      if ([window.linkLeft, window.linkRight].some(host => api.same(host, card))) return { player: card.data('controller'), zone: 'Extra Monster Zone' };
      return null;
    }
    function replayHandVisible(p) {
      return !!window.replay && (Number(window.show_cards) === 2 || (Number(window.show_cards) === 1 && p === player()));
    }
    function targetName(card, location) {
      const local = !observing() && location.player === player(), front = card.data('cardfront');
      const shownHand = location.key === 'hand_arr' && replayHandVisible(location.player);
      // A previously revealed front can remain cached after returning to a
      // hidden location. Never turn that cached identity into a notification.
      const hiddenPile = !local && !shownHand && (['main_arr', 'hand_arr'].includes(location.key) ||
        (location.key === 'extra_arr' && (!front?.data('pendulum') || card.data('face_down'))));
      if (hiddenPile) return 'a card';
      if (card.data('face_down') && !shownHand && !(local && ['main_arr', 'extra_arr', 'hand_arr'].includes(location.key))) return 'a face-down card';
      return front?.data('initialized') !== false && front?.data('name') || 'a card';
    }
    function historyMatches(ctx) {
      return !!ctx && ctx.player === player() && ctx.opponent === window.player2 && ctx.duel === window.duelId &&
        ctx.observing === observing() && !window.resetting;
    }
    function historyAccepts(ctx) {
      // Recording received actions must continue in a background tab. Input
      // permissions and animation visibility are separate from this log.
      return historyMatches(ctx) && (window.duel_active || renderingRebuildHistory) && !window.tag_duel &&
        typeof window.DBO_chooseZone !== 'function' && (window.DBETTERRebuilding || api.visible(document.getElementById('duel')));
    }
    function clearHistories() {
      for (const { node, avatar, fieldStatus } of histories.values()) {
        fieldStatus.remove(); node.remove(); avatar?.classList.toggle('dblite-history-profile', false);
        avatar?.style.removeProperty('--dblite-profile-shift'); avatar?.style.removeProperty('--dblite-profile-scale');
      }
      histories.clear(); pendingHistory.clear(); replayHandEntries.clear(); renderedStart = -1; renderedEnd = 0; replayHandMode = undefined; signalStates.clear(); historyContext = null;
      restoreProfiles();
    }
    function restoreProfiles() {
      for (const node of signalSources) node.classList.toggle('dblite-history-signal-source', false);
      signalSources.clear();
      for (const { fieldStatus } of histories.values()) fieldStatus.hidden = true;
      for (const node of document.querySelectorAll('.dblite-viewing-source')) node.classList.toggle('dblite-viewing-source', false);
      profileVersus?.remove(); profileVersus = null;
      const duel = document.getElementById('duel');
      duel?.classList.toggle('dblite-history-layout', false);
      for (const key of ['history-width', 'profile-left', 'profile-width', 'profile-bottom', 'life-scale']) duel?.style.removeProperty('--dblite-' + key);
      for (const node of profileNodes) {
        node.classList.toggle('dblite-history-profile', false);
        for (const key of ['shift', 'scale', 'y']) node.style.removeProperty('--dblite-profile-' + key);
      }
      profileNodes.clear();
    }
    function signalState(p) {
      if (!signalStates.has(p)) signalStates.set(p, { revision: ++signalRevision, suppressed: false });
      return signalStates.get(p);
    }
    // Off (Classic look): no histories, moved profiles or field messages, even for a frame.
    const historiesOff = () => api.config().actionHistory === false;
    function refreshSignals() {
      if (window.DBETTERRebuilding || historiesOff()) return;
      const active = new Set();
      for (const [p, history] of histories) {
        const { signal, signalIcon, signalText, fieldSignal, fieldSignalIcon, fieldSignalText, node, avatar } = history;
        const presentations = [[signal, signalIcon, signalText], [fieldSignal, fieldSignalIcon, fieldSignalText]];
        // The final state is collected first and written once, only where it differs: rewriting
        // unchanged attributes on every update restyled the page each frame, and Android WebView
        // then dropped parts of the screen for a frame (dark flashes).
        const shown = new Set([fieldSignal]), kinds = new Map([[fieldSignal, 'idle']]), opacities = new Map([[fieldSignal, '1']]), icons = new Map([[fieldSignalIcon, true]]);
        try {
        const thinking = p.thinking?.[0] || avatar?.querySelector('.think');
        const good = p.all_good?.[0] || avatar?.querySelector('.all_good');
        const state = signalState(p);
        // Okay/Thinking follow the native fade exactly, just like Actions.
        // Only declarations and targets remain as persistent field messages.
        const message = ['thinking', 'okay'].includes(state.message?.kind) ? null : state.message;
        const freshMessage = history.messageEffectRevision !== state.messageRevision;
        const animateMessage = message && ['declared', 'targeted'].includes(message.kind) &&
          (api.config().animations && api.config().declareGlow) && fieldPlaying() && Date.now() - message.at < 1200;
        if (freshMessage || !animateMessage) { history.fieldEffect?.remove(); history.fieldEffect = null; }
        if (freshMessage && animateMessage) {
          const effect = element('i', 'dblite-field-action-glow'); effect.setAttribute('aria-hidden', 'true');
          effect.style.setProperty('--dblite-action-color', message.turnColor);
          fieldSignal.append(effect); history.fieldEffect = effect;
        }
        history.messageEffectRevision = state.messageRevision;
        if (message) {
          kinds.set(fieldSignal, message.kind);
          const textKey = message.kind + '\n' + message.text;
          if (history.messageTextKey !== textKey) {
            history.messageTextKey = textKey;
            if (message.zone) {
              const name = element('span', 'dblite-field-card-name', (message.kind === 'declared' ? 'Declared' : 'Targeted') + ' · ' + message.cardName);
              const zone = element('span', 'dblite-field-zone');
              zone.append(element('span', 'dblite-field-separator', ' · '), document.createTextNode(message.zone));
              fieldSignalText.replaceChildren(name, zone);
            } else fieldSignalText.textContent = message.text;
          }
          if (fieldSignal.title !== message.text) fieldSignal.title = message.text;
          const source = message.kind === 'thinking' ? thinking : message.kind === 'okay' ? good : null;
          const icon = source?.matches('img') ? source : source?.querySelector('img');
          const src = rules.pageImage(icon?.getAttribute('data-src') || icon?.getAttribute('src'));
          icons.set(fieldSignalIcon, !src);
          if (src && fieldSignalIcon.getAttribute('src') !== src) fieldSignalIcon.setAttribute('src', src);
          const width = fieldSignalText.clientWidth, css = getComputedStyle(fieldSignal);
          const height = fieldSignal.clientHeight - parseFloat(css.paddingTop || 0) - parseFloat(css.paddingBottom || 0);
          const fitKey = textKey + '\n' + width + ':' + height;
          const fits = () => fieldSignalText.scrollHeight <= height && fieldSignalText.scrollWidth <= width;
          if (width > 0 && height > 0 && (history.messageFitKey !== fitKey || !fits())) {
            history.messageFitKey = fitKey;
            // Fit rendered lines, including the smaller zone, rather than
            // estimating from character count (wide names wrap differently).
            fieldSignalText.style.fontSize = '9px';
            if (!fits()) {
              let low = .25, high = 9;
              fieldSignalText.style.fontSize = low + 'px';
              for (let step = 0; step < 9; step++) {
                const size = (low + high) / 2;
                fieldSignalText.style.fontSize = size + 'px';
                if (fits()) low = size; else high = size;
              }
              // Round down, never up into the next wrapped line. There is no
              // 5px floor that can leave long names clipped in a narrow box.
              fieldSignalText.style.fontSize = (Math.floor(low * 100) / 100) + 'px';
            }
          }
        } else {
          history.messageTextKey = history.messageFitKey = null;
          if (fieldSignal.title) fieldSignal.title = '';
          if (fieldSignalText.textContent !== '—') fieldSignalText.textContent = '—';
          if (fieldSignalText.style.fontSize) fieldSignalText.style.removeProperty('font-size');
        }
        if (node.hidden || !api.visible(node) || !historyMatches(historyContext)) continue;
        for (const source of [thinking, good].filter(Boolean)) {
          active.add(source); source.classList.toggle('dblite-history-signal-source', true);
        }
        if (signalState(p).suppressed) continue;
        // Native nodes retain their timing and visibility tests; both copies
        // follow the same source and clear on the next received player action.
        const source = [thinking, good].find(source => source?.isConnected && source.getClientRects().length &&
          getComputedStyle(source).display !== 'none' && Number(getComputedStyle(source).opacity || 1) > .01);
        if (!source) continue;
        const label = source === thinking ? 'Thinking…' : p.still_good ? 'Keep going' : 'OK';
        const kind = source === thinking ? 'thinking' : 'okay', aria = (p.username || 'Player') + ': ' + label;
        const opacity = getComputedStyle(source).opacity || '1';
        const nativeImage = source.matches('img') ? source : source.querySelector('img');
        const src = rules.pageImage(nativeImage?.getAttribute('data-src') || nativeImage?.getAttribute('src'));
        for (const [signal, icon, text] of presentations) {
          if (signal === fieldSignal && message) continue;
          if (text.textContent !== label) text.textContent = label;
          kinds.set(signal, kind);
          if (signal.getAttribute('aria-label') !== aria) signal.setAttribute('aria-label', aria);
          opacities.set(signal, opacity);
          icons.set(icon, !src);
          if (src && icon.getAttribute('src') !== src) icon.setAttribute('src', src);
          shown.add(signal);
        }
        } finally {
          for (const node of [signal, fieldSignal]) { const hide = !shown.has(node); if (node.hidden !== hide) node.hidden = hide; }
          for (const [node, kind] of kinds) if (node.dataset.kind !== kind) node.dataset.kind = kind;
          for (const [node, opacity] of opacities) if (node.style.opacity !== opacity) node.style.opacity = opacity;
          for (const [node, hide] of icons) if (node.hidden !== hide) node.hidden = hide;
        }
      }
      for (const node of signalSources) if (!active.has(node)) node.classList.toggle('dblite-history-signal-source', false);
      signalSources.clear(); for (const node of active) signalSources.add(node);
    }
    function refreshViewing(history, p, index) {
      const { fieldStatus, eye, eyeOpp, eyeZone } = history;
      fieldStatus.hidden = !fieldPlaying();
      const source = document.querySelector('#status' + index + ' .status_txt');
      const status = source?.textContent?.trim() || '';
      const viewing = status.startsWith('Viewing ') ? status.slice(8) : '';
      const zone = /Extra Deck/i.test(viewing) ? 'ED' : /Deck/i.test(viewing) ? 'Deck' :
        /Graveyard/i.test(viewing) ? 'GY' : /Banished/i.test(viewing) ? 'Ban' :
        /Xyz Materials/i.test(viewing) ? 'Mat' : /Hand/i.test(viewing) ? 'Hand' : '';
      const lit = !!zone && !fieldStatus.hidden, opponent = lit && /Opponent/i.test(viewing);
      source?.classList.toggle('dblite-viewing-source', lit);
      eye.classList.toggle('is-viewing', lit);
      if (eyeOpp.hidden !== !opponent) eyeOpp.hidden = !opponent;
      if (eyeZone.textContent !== (lit ? zone : '')) eyeZone.textContent = lit ? zone : '';
      const label = (p.username || 'Player') + (lit ? ': viewing ' + viewing : ': not viewing a zone');
      if (eye.getAttribute('aria-label') !== label) { eye.setAttribute('aria-label', label); eye.title = label; }
    }
    const passiveSignalPlays = new Set(['Thinking', 'Good', 'Stop good', 'Typing', 'Countdown', 'Message',
      'Duel message', 'Edit duel message', 'Watcher message', 'Add watcher', 'Remove watcher',
      'Rejoin duel', 'Initialize cards', 'Preview Skillback', 'Frozen', 'Beginner']);
    function hookSignals() {
      for (const name of ['duelResponse', 'thinking', 'allGood']) {
        const original = window[name];
        if (typeof original !== 'function' || rules.hasHook(original, "dbliteSignalHook")) continue;
        const wrapped = function (...args) {
          const data = name === 'duelResponse' ? args[0] : args[1];
          const p = name === 'duelResponse' ? [player(), window.player2].find(p => p?.username === data?.username) : args[0];
          const valid = p && [player(), window.player2].includes(p) && historyAccepts(viewContext());
          let receipt;
          if (name === 'duelResponse' && valid && typeof data?.play === 'string') {
            const state = signalState(p);
            if (['Thinking', 'Good'].includes(data.play)) {
              receipt = { revision: ++signalRevision, ...viewContext() };
              state.revision = receipt.revision; signalReceipts.set(data, receipt);
              fieldMessage(p, data.play === 'Thinking' ? 'thinking' : 'okay', data.play === 'Thinking' ? 'Thinking…' : 'OK', receipt.revision);
            } else if (!passiveSignalPlays.has(data.play)) {
              state.revision = ++signalRevision; signalReceipts.set(data, { revision: state.revision, ...viewContext() });
              // A long OK (Keep going) lasts until DuelingBook's Stop good; other actions keep it visible.
              if (!p.still_good) state.suppressed = true; refreshSignals();
            }
          }
          const result = original.apply(this, args);
          if (name === 'duelResponse') api.duelTools?.received(data, p);
          if (name !== 'duelResponse' && valid) {
            receipt = data && signalReceipts.get(data);
            // A queued old signal must not reappear after a more recent action.
            if (!receipt || (historyMatches(receipt) && signalState(p).revision === receipt.revision)) {
              signalState(p).suppressed = false;
              fieldMessage(p, name === 'thinking' ? 'thinking' : 'okay', name === 'thinking' ? 'Thinking…' : p.still_good ? 'Keep going' : 'OK', receipt?.revision);
            }
          }
          refreshSignals(); return result;
        };
        rules.markHook(wrapped, original); wrapped.dbliteSignalHook = true;
        wrapped.dbliteSoundHook = original.dbliteSoundHook;
        window[name] = wrapped;
      }
    }
    function refreshNotices() {
      if (window.DBETTERRebuilding) return;
      document.documentElement.classList.toggle('dblite-profile-layout', !window.tag_duel && typeof window.DBO_chooseZone !== 'function' && api.config().actionHistory !== false);
      if (historyContext && !historyMatches(historyContext)) clearHistories();
      const duel = document.getElementById('duel');
      // Off (Classic look): DuelingBook's profiles stay where the histories would be.
      if (api.config().actionHistory === false || !player() || window.resetting || !api.visible(duel) || typeof window.DBO_chooseZone === 'function' || window.tag_duel) {
        for (const { node, avatar } of histories.values()) { node.hidden = true; avatar?.classList.toggle('dblite-history-profile', false); }
        restoreProfiles();
        refreshDuelLayout(); return;
      }
      if (!historyContext && window.duel_active) historyContext = viewContext();
      if (historyContext) for (const p of [player(), window.player2]) if (p) ensureHistory(p);
      positionNotices();
    }
    function ensureHistory(p) {
      if (histories.has(p)) return histories.get(p);
      if (!historyContext) historyContext = viewContext();
      const index = p === player() ? 1 : 2;
      const node = isolate(element('section', 'dblite-target-notices dblite-action-history'));
      if (renderingRebuildHistory) node.hidden = true;
      node.dataset.player = String(index);
      node.style.setProperty('--dblite-target-color', actorColor({ username: p.username }));
      node.setAttribute('aria-label', (p.username || 'Player ' + index) + ' action history');
      const heading = element('header', 'dblite-history-heading', 'Actions');
      const signal = element('span', 'dblite-history-signal'); signal.hidden = true;
      signal.setAttribute('role', 'status');
      const signalIcon = element('img'), signalText = element('span'); signalIcon.alt = ''; signalIcon.hidden = true;
      signal.append(signalIcon, signalText);
      const caption = element('span', 'dblite-history-caption', 'Actions'); heading.replaceChildren(caption, signal);
      const list = element('div', 'dblite-history-list'); list.tabIndex = 0;
      list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite'); list.setAttribute('aria-relevant', 'additions');
      list.setAttribute('aria-label', (p.username || 'Player ' + index) + ' recent actions');
      const latest = button('Latest ↓', () => { list.scrollTop = list.scrollHeight; latest.hidden = true; }, 'dblite-history-latest');
      latest.hidden = true;
      list.addEventListener('scroll', () => { if (list.scrollHeight - list.clientHeight - list.scrollTop < 12) latest.hidden = true; });
      node.append(heading, list, latest);
      const parent = document.getElementById('duel'); parent?.append(node);
      const fieldStatus = element('div', 'dblite-field-status'); fieldStatus.dataset.player = String(index);
      fieldStatus.style.setProperty('--dblite-target-color', actorColor({ username: p.username }));
      const fieldSignal = element('span', 'dblite-history-signal dblite-field-signal'); fieldSignal.hidden = true; fieldSignal.setAttribute('aria-hidden', 'true');
      const fieldSignalIcon = element('img'), fieldSignalText = element('span'); fieldSignalIcon.alt = ''; fieldSignalIcon.hidden = true;
      fieldSignal.append(fieldSignalIcon, fieldSignalText);
      const eye = element('span', 'dblite-viewing-eye'); eye.setAttribute('role', 'img');
      eye.innerHTML = '<svg viewBox="0 0 40 30" aria-hidden="true"><path d="M3 12 Q20 -1 37 12 Q20 25 3 12Z M3 12 0 6 M37 12 40 6 M21 21 17 29 M10 20 Q7 28 3 25"/><circle cx="20" cy="12" r="6"/><circle class="pupil" cx="20" cy="12" r="2"/></svg>';
      const eyeOpp = element('span', 'dblite-eye-opp', 'OPP'), eyeZone = element('span', 'dblite-eye-zone'); eyeOpp.hidden = true;
      eye.append(eyeOpp, eyeZone); fieldStatus.append(fieldSignal, eye); parent?.append(fieldStatus);
      const history = { node, list, latest, signal, signalIcon, signalText, fieldStatus, fieldSignal, fieldSignalIcon, fieldSignalText, eye, eyeOpp, eyeZone, avatar: document.getElementById('avatar' + index) };
      histories.set(p, history); return history;
    }
    function positionNotices() {
      refreshDuelLayout();
      if (historiesOff()) return;
      const duel = document.getElementById('duel');
      if (!historyMatches(historyContext) || !api.visible(duel) || typeof window.DBO_chooseZone === 'function' || window.tag_duel) return;
      const board = document.getElementById('content') || duel, rect = board.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scale = rect.width / 1024 || 1, viewport = document.documentElement.clientWidth || innerWidth;
      let spare = Math.max(0, (viewport - rect.right - 16) / scale);
      // Reserve native floating chats in the margin. Both players use the same
      // width, keeping their profiles and history boxes aligned vertically.
      for (const blocker of document.querySelectorAll('#chats>.chat,#watchers,#duel_log,#watch_chat')) {
        if (!api.visible(blocker)) continue;
        const box = blocker.getBoundingClientRect();
        if (box.right > rect.right && box.left < rect.right + 200 * scale && box.bottom > rect.top && box.top < rect.bottom) {
          spare = Math.min(spare, Math.max(0, (box.left - rect.right - 12) / scale));
        }
      }
      const profileScale = Math.max(.45, Math.min(1, (spare - 12) / 181));
      const width = Math.min(181, Math.max(92, 181 + spare - 12 - 181 * profileScale));
      // At narrow widths the center profiles share the native sidebar space.
      // Keep its chat and input within the same column as the histories.
      duel.classList.toggle('dblite-history-layout', true); duel.style.setProperty('--dblite-history-width', width + 'px');
      duel.style.setProperty('--dblite-profile-left', (843 + width + 12) + 'px');
      duel.style.setProperty('--dblite-profile-width', (181 * profileScale) + 'px');
      duel.style.setProperty('--dblite-profile-bottom', (334 + 154 * profileScale) + 'px');
      duel.style.setProperty('--dblite-life-scale', String(Math.min(.72, (181 * profileScale - 4) / 155)));
      // The native board spans 640px. Keep both profiles equally close to its
      // center, with a 28px gap for VS, at every responsive profile scale.
      // Phones: both profiles sit at the top of their column, leaving the space below them for the
      // big OK / Thinking / chat buttons. Elsewhere they are centred on the board.
      const halfGap = 14, middle = document.documentElement.classList.contains('dbetter-phone') ? 6 + halfGap + 154 * profileScale : 320;
      for (const [p, history] of histories) {
        const { node } = history, index = p === player() ? 1 : 2;
        const label = (p.username || 'Player ' + index);
        // Written only on change: per-update rewrites restyled the page every frame (WebView flashes).
        if (node.getAttribute('aria-label') !== label + ' action history') node.setAttribute('aria-label', label + ' action history');
        if (history.list.getAttribute('aria-label') !== label + ' recent actions') history.list.setAttribute('aria-label', label + ' recent actions');
        const targetColor = index === 1 ? 'var(--dbt-you)' : 'var(--dbt-opponent)';
        if (node.style.getPropertyValue('--dblite-target-color') !== targetColor) node.style.setProperty('--dblite-target-color', targetColor);
        const avatar = document.getElementById('avatar' + index);
        if (history.avatar !== avatar) { history.avatar?.classList.toggle('dblite-history-profile', false); history.avatar = avatar; }
        const parent = avatar?.parentElement || duel;
        if (node.parentElement !== parent) parent.append(node);
        const field = document.getElementById('field');
        const fieldParent = field?.parentElement || document.getElementById('lifepoints' + index)?.parentElement || parent;
        // Paint the center status before the native card layer, including moving cards.
        if (field && (history.fieldStatus.parentElement !== fieldParent || !(history.fieldStatus.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING))) fieldParent.insertBefore(history.fieldStatus, field);
        else if (history.fieldStatus.parentElement !== fieldParent) fieldParent.append(history.fieldStatus);
        node.hidden = false;
        const nativeTop = index === 1 ? 451 : 35;
        const profileTop = index === 1 ? middle + halfGap : middle - halfGap - 154 * profileScale;
        // Keep native avatars and their event handlers in place. Individual
        // transforms don't overwrite DB's GSAP transforms or profile contents.
        for (const profile of [avatar, ...['status', 'gone', 'countdown', 'done_siding'].map(id => document.getElementById(id + index))].filter(Boolean)) {
          const css = getComputedStyle(profile);
          const dx = profile === avatar ? 0 : (parseFloat(css.left) || 843) - 843;
          const dy = profile === avatar ? 0 : (parseFloat(css.top) || 0) - nativeTop;
          profileNodes.add(profile);
          profile.style.setProperty('--dblite-profile-shift', (width + 12 + dx * (profileScale - 1)) + 'px');
          profile.style.setProperty('--dblite-profile-y', (profileTop - nativeTop + dy * (profileScale - 1)) + 'px');
          profile.style.setProperty('--dblite-profile-scale', String(profileScale));
          profile.classList.toggle('dblite-history-profile', true);
        }
        Object.assign(node.style, { left: '843px', top: index === 1 ? '431px' : '35px', width: width + 'px', height: '174px' });
      }
      const first = document.getElementById('avatar1'), second = document.getElementById('avatar2');
      if (first && second) {
        if (!profileVersus) { profileVersus = element('div', 'dblite-profile-versus', 'VS'); profileVersus.setAttribute('aria-hidden', 'true'); }
        if (profileVersus.parentElement !== first.parentElement) first.parentElement.append(profileVersus);
        // Only one VS: a replay on the phone showed a second, stale copy over an avatar (2026-10-29).
        for (const copy of document.querySelectorAll('.dblite-profile-versus')) if (copy !== profileVersus) copy.remove();
        Object.assign(profileVersus.style, { left: (843 + width + 12) + 'px', top: (middle - halfGap) + 'px', width: (181 * profileScale) + 'px', height: (halfGap * 2) + 'px' });
      } else { profileVersus?.remove(); profileVersus = null; }
      for (const [p, history] of histories) refreshViewing(history, p, p === player() ? 1 : 2);
      if (fieldPlaying() && displayedTurn() > 0) for (const history of histories.values()) ensureTurnGroup(history, displayedTurn());
      refreshSignals();
    }
    function ensureTurnGroup(history, turn, turnPlayer = window.turn_player?.username) {
      if (history.turnGroup?.dataset.turn === String(turn)) return history.turnGroup;
      const {list, latest} = history, follow = list.scrollHeight - list.clientHeight - list.scrollTop < 12;
      const group = element('section', 'dblite-history-turn'); group.dataset.turn = String(turn);
      group.append(element('div', 'dblite-turn-divider', 'T' + turn + ' · ' + (turnPlayer || 'Turn')));
      list.append(group); history.turnGroup = group;
      if (follow) { if (!renderingRebuildHistory) list.scrollTop = list.scrollHeight; } else latest.hidden = false;
      return group;
    }
    function historyFront(card, cardName) {
      const front = card?.data('cardfront');
      if (!cardName || ['a card', 'a face-down card'].includes(cardName) || !front ||
          front.data('initialized') === false || front.data('name') !== cardName) return null;
      // Store only the identity already displayed in this entry. Never retain
      // a live card: shuffles may reuse its ID/front for a different identity.
      const data = Object.fromEntries(Object.entries(front.data()).filter(([, value]) =>
        value == null || ['string', 'number', 'boolean'].includes(typeof value)));
      data.effect = typeof data.effect === 'string' ? data.effect : '';
      return data;
    }
    function historyNameElement(cardName, front, node, ctx) {
      const name = element(front ? 'button' : 'strong', 'dblite-target-name', cardName);
      if (front) {
        name.type = 'button'; name.setAttribute('aria-label', 'Preview ' + cardName);
        const preview = () => {
          if (name.isConnected && historyMatches(ctx) && api.visible(node) && api.visible(document.getElementById('duel')) &&
              !window.tag_duel && typeof window.DBO_chooseZone !== 'function' && typeof window.previewFront === 'function') {
            window.previewFront($('<div>').data({ ...front }));
          }
        };
        name.addEventListener('mouseenter', preview); name.addEventListener('focus', preview);
      }
      name.title = cardName; return name;
    }
    function refreshReplayHands() {
      const mode = window.replay ? Number(window.show_cards) : -1;
      if (mode === replayHandMode) return;
      replayHandMode = mode;
      for (const entry of replayHandEntries) {
        if (!entry.node.isConnected || !historyMatches(entry.ctx)) { replayHandEntries.delete(entry); continue; }
        const front = replayHandVisible(entry.player) ? entry.front : null;
        const name = front?.name || 'a card';
        entry.node.querySelector('.dblite-target-name')?.replaceWith(historyNameElement(name, front, entry.node, entry.ctx));
        entry.node.title = [entry.verb, name, entry.zone].filter(Boolean).join(' · ');
      }
    }
    for (const type of ['click', 'change']) document.addEventListener(type, () => {
      if (window.replay) queueMicrotask(refreshReplayHands);
    }, true);
    function appendHistory(data, verb, cardName, zone, color, card, options = {}) {
      const actor = [player(), window.player2].find(p => p && p.username === data?.username);
      if (!actor || !historyAccepts(viewContext())) return;
      if (window.DBETTERRebuilding) {
        historyTape.push({ pos: playNumber(), args: [data, verb, cardName, zone, color, null, { ...options,
          front: Object.hasOwn(options, 'front') ? options.front : historyFront(card, cardName), turn: Math.max(1, displayedTurn()), turnPlayer: window.turn_player?.username }] });
        return;
      }
      if (!renderingRebuildHistory) refreshNotices();
      if (historiesOff()) return;
      const history = ensureHistory(actor), { list, latest } = history;
      const turn = options.turn ?? Math.max(1, displayedTurn());
      const follow = renderingRebuildHistory || list.scrollHeight - list.clientHeight - list.scrollTop < 12;
      const node = element('div', 'dblite-target-notice');
      const ctx = viewContext(), front = Object.hasOwn(options, 'front') ? options.front : historyFront(card, cardName);
      node.style.setProperty('--dblite-target-color', color || actorColor(data));
      if (verb === 'Declared') node.classList.toggle('dblite-declare-notice', true);
      node.title = [verb, cardName, zone].filter(Boolean).join(' · ');
      const heading = element('div', 'dblite-action-heading'), details = element('div', 'dblite-action-details');
      heading.append(element('span', 'dblite-action-verb', verb));
      if (cardName) {
        heading.append(historyNameElement(cardName, front, node, ctx));
      }
      if (zone) details.append(element('span', 'dblite-target-zone', zone));
      const date = new Date(Date.now());
      const time = element('time', 'dblite-action-time', [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'));
      time.dateTime = date.toISOString(); time.title = date.toLocaleString();
      details.append(time); node.append(heading, details);
      ensureTurnGroup(history, turn, options.turnPlayer).append(node);
      if (options.replayHand) replayHandEntries.add({ node, ctx, verb, zone, ...options.replayHand });
      if (follow) { if (!renderingRebuildHistory) list.scrollTop = list.scrollHeight; }
      else latest.hidden = false;
      if (!renderingRebuildHistory) positionNotices();
    }
    function subtractGap(gaps, start, end) {
      return gaps.flatMap(([low, high]) => end <= low || start >= high ? [[low, high]] :
        [[low, Math.min(high, start)], [Math.max(low, end), high]].filter(([a, b]) => b > a));
    }
    function refreshDuelLayout() {
      const duel = document.getElementById('duel');
      if (!duel) return;
      // Off (Classic look): DuelingBook's own phases, Turn button, life point controls and die / coin / token / counter buttons.
      duel.classList.toggle('dblite-duel-layout', api.config().duelLayout !== false && (!!window.duel_active || (!!player() && /^duel_start/.test(window.currentLabel || '') && api.visible(duel))));
      duel.classList.toggle('dblite-layout-links', !!window.links && !window.speed && !window.rush);
      duel.classList.toggle('dblite-layout-observer', observing());
      duel.classList.toggle('dblite-phase-chat', phaseChatReady());
      duel.classList.toggle('dblite-opening', /^(rps|tp)_/.test(window.currentLabel || ''));
    }
    function phaseChatReady() {
      return !!window.duelist && !window.replay && !!window.duel_active &&
        /^duel_start/.test(window.currentLabel || '') && !window.resetting &&
        typeof window.Send === 'function' && !!window.turn_player?.username &&
        /^(DP|SP|M1|BP|M2|EP)$/.test(window.currentPhase || '');
    }
    function eventCard(data) {
      const cards = [player(), window.player2].flatMap(p => (p?.all_cards_arr || []).flatMap(card => [card, ...(card.data('xyz_arr') || [])]));
      return cards.find(card => id(card) === data?.id && !card.data('fake_card'));
    }
    function actorColor(data) {
      return data?.username === (window.Player1?.() || player())?.username ? 'var(--dbt-you)' :
        data?.username === (window.Player2?.() || window.player2)?.username ? 'var(--dbt-opponent)' : 'var(--dbt-accent)';
    }
    function showNotice(data, color, verb = 'targeted', snapshot) {
      if (!historyAccepts(snapshot || viewContext()) || data?.id == null || typeof data.username !== 'string') return;
      const card = snapshot?.card || eventCard(data), location = snapshot?.location || (card && targetLocation(card));
      if (!card || !location) return;
      // Declare explicitly reveals the received identity. Target never uses a
      // cached front in a hidden pile as evidence of a reveal.
      const revealed = verb === 'declared' && (data.card?.name || data.name);
      const cardName = typeof revealed === 'string' && revealed ? revealed : targetName(card, location);
      appendHistory(data, verb === 'declared' ? 'Declared' : 'Targeted', cardName, location.zone, color, card);
      fieldMessage([player(), window.player2].find(p => p?.username === data.username), verb,
        (verb === 'declared' ? 'Declared' : 'Targeted') + ' · ' + cardName + ' · ' + location.zone, signalReceipts.get(data)?.revision, {cardName, zone:location.zone});
      refreshSignals();
    }
    function targetReceived(data) {
      const color = actorColor(data);
      showNotice(data, color);
      if (window.DBETTERRebuilding) return;
      const target = eventCard(data), anchor = target && declareAnchor(target);
      if (anchor && historyAccepts(viewContext())) {
        anchor.querySelector('.dblite-card-target')?.remove();
        const icon = element('span', 'dblite-card-target'); icon.setAttribute('aria-label', 'Targeted card'); icon.setAttribute('role', 'img');
        icon.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true" fill="none"><circle cx="32" cy="32" r="20"/><path d="M32 3v18 M32 43v18 M3 32h18 M43 32h18"/></svg>';
        icon.style.setProperty('--dblite-target-color', color); anchor.append(icon);
        setTimeout(() => icon.remove(), 1600);
      }
      if (!fan || !viewerValid(fanContext)) return;
      const card = viewZone()?.cards.find(card => id(card) === data?.id);
      if (!card) return;
      targets.set(id(card), { ...viewContext(), card, zone: window.viewing, color, until: Date.now() + 1200, received: ++targetReceipt });
      refreshTargets();
    }
    const declarations = [];
    let declarationBanner = null;
    function prepareDeclare(data) {
      const card = eventCard(data), location = card && targetLocation(card);
      if (!card || !location || !historyAccepts(viewContext())) return null;
      return { ...viewContext(), card, location, viewing: window.viewing || '', data, queue: window.actionsQueue, action: window.actionsQueue?.[0] };
    }
    function declareAnchor(card) {
      const tile = [...(fan?.querySelectorAll('.dblite-fan-card') || [])].find(tile => api.same(proxies.get(tile), card));
      // DB positions a card by its center: its .content is translated -50%.
      // Attaching to that layer also follows defense rotation and board zoom.
      const node = tile || card[0]?.querySelector(':scope > .content');
      return node?.isConnected && api.visible(node) ? node : null;
    }
    function removeDeclaration(index) {
      const effect = declarations.splice(index, 1)[0];
      effect.node.parentElement?.classList.toggle('dblite-declaring', false); effect.node.remove();
    }
    function refreshDeclarations() {
      if (window.DBETTERRebuilding) return;
      if (declarationBanner && (!historyAccepts(declarationBanner.context) || Date.now() >= declarationBanner.until)) {
        declarationBanner.node.remove(); declarationBanner = null;
      }
      for (let i = declarations.length - 1; i >= 0; i--) {
        const effect = declarations[i], anchor = declareAnchor(effect.card);
        const location = targetLocation(effect.card);
        const sameZone = location && ['player', 'zone', 'key', 'slot'].every(key => location[key] === effect.location[key]);
        if (!viewerValid(effect) || !(api.config().animations && api.config().declareGlow) || Date.now() >= effect.until || !anchor ||
            !sameZone || effect.viewing !== (window.viewing || '')) {
          removeDeclaration(i); continue;
        }
        if (effect.node.parentElement !== anchor) {
          effect.node.parentElement?.classList.toggle('dblite-declaring', false); anchor.append(effect.node);
        }
        anchor.classList.toggle('dblite-declaring', true);
        const tile = anchor.classList.contains('dblite-fan-card');
        const face = tile ? anchor.querySelector('.dblite-fan-face') : anchor;
        const width = tile ? 100 : parseFloat(getComputedStyle(anchor).width) || 400;
        const height = tile ? 145 : parseFloat(getComputedStyle(anchor).height) || 580;
        const rect = face.getBoundingClientRect();
        const scale = Math.max(.05, Math.max(rect.width, rect.height) / Math.max(width, height));
        Object.assign(effect.node.style, { width: tile ? '100px' : '100%', height: tile ? '145px' : '100%' });
        effect.node.style.setProperty('--dblite-declare-stroke', `${2.5 / scale}px`);
        effect.node.style.setProperty('--dblite-declare-radius', `${4 / scale}px`);
        effect.node.style.setProperty('--dblite-declare-blur', `${13 / scale}px`);
        effect.node.style.setProperty('--dblite-declare-px', `${1 / scale}px`);
      }
    }
    function declareReceived(snapshot) {
      if (!snapshot || !historyAccepts(snapshot) || eventCard(snapshot.data) !== snapshot.card ||
          (snapshot.action && (window.actionsQueue !== snapshot.queue || window.actionsQueue?.[0] !== snapshot.action))) return false;
      showNotice(snapshot.data, actorColor(snapshot.data), 'declared', snapshot);
      if (window.DBETTERRebuilding) return true;
      if (!(api.config().animations && api.config().declareGlow) || !viewerValid(snapshot)) return false;
      if (!declareAnchor(snapshot.card)) return true;
      // This outline is separate from the live card and from GSAP. Native
      // reveal, pile restoration, audio and endAction callbacks remain intact.
      for (let i = declarations.length - 1; i >= 0; i--) if (api.same(declarations[i].card, snapshot.card)) removeDeclaration(i);
      const node = element('div', 'dblite-declare-glow'); node.setAttribute('aria-hidden', 'true');
      const palette = window.DBLiteRules.cardPalette(snapshot.card.data('cardfront'));
      node.style.setProperty('--dblite-declare-color', palette.primary);
      node.style.setProperty('--dblite-declare-secondary', palette.secondary);
      node.classList.toggle('dblite-pendulum-glow', palette.primary !== palette.secondary);
      // A short perimeter burst follows the card's own rotation and scale.
      // Screen-sized sparks stay small in both the native field and card fan.
      const sparks = [[8,0,-12,-18],[35,0,-4,-22],[68,0,6,-19],[95,0,15,-16],
        [100,30,21,-7],[100,72,18,9],[92,100,12,18],[64,100,3,22],
        [30,100,-6,18],[4,100,-15,15],[0,67,-20,5],[0,25,-18,-9]];
      sparks.forEach(([x,y,dx,dy],i) => {
        const spark = element('i', 'dblite-declare-spark');
        spark.style.cssText = `left:${x}%;top:${y}%;--spark-x:calc(${dx} * var(--dblite-declare-px));--spark-y:calc(${dy} * var(--dblite-declare-px));animation-delay:${i % 3 * 70}ms`;
        if (y > 50) spark.style.background = 'var(--dblite-declare-secondary)';
        node.append(spark);
      });
      declarations.push({ ...snapshot, node, until: Date.now() + 1900 });
      while (declarations.length > 4) removeDeclaration(0);
      refreshDeclarations(); return true;
    }
    function sortAvailable() {
      // Fan and Grid views both sort (user, 2026-10-29: Grid could not be sorted).
      return fan && ['fan', 'grid'].includes(viewMode) && Object.hasOwn(zones, (fanPassDescriptor || viewZone())?.zone) &&
        window.viewing === fanZone && viewerValid(fanContext, true) && nativeView() && getComputedStyle(nativeView()).display !== 'none' &&
        !dragging && (observing() || (!api.occupied() && !api.pendingSelection())) && !sequence && !wizard && !panel && !settingsPanel && !moving;
    }
    function toggleSort() {
      if (!sortAvailable()) return;
      closeMenu(); setPeek(false); sortedFan = !sortedFan; saveSort({ sorted: sortedFan }); fanKey = ''; refreshFan();
    }
    function cardGroup(card) {
      if ((fanPassDescriptor || viewZone())?.zone === 'Banished' && card.data('face_down')) return 'Face-down cards';
      if (concealed(card)) return 'Hidden cards';
      if ((fanPassDescriptor || viewZone())?.zone !== 'Extra Deck') return ({ Monster: 'Monsters', Spell: 'Spells', Trap: 'Traps' })[cardType(card)] || 'Other';
      const front = card.data('cardfront'), color = front?.data('monster_color');
      if (cardType(card) === 'Monster' && front?.data('pendulum') && !card.data('face_down')) return 'Pendulum';
      if (cardType(card) === 'Monster' && ['Fusion', 'Synchro', 'Xyz', 'Link'].includes(color)) return color;
      return 'Other';
    }
    function publicPileSort() { return ['Graveyard', 'Banished'].includes((fanPassDescriptor || viewZone())?.zone); }
    function sortMonsterType(card) {
      if (!publicPileSort() || concealed(card) || cardType(card) !== 'Monster') return 0;
      const order = ['Normal', 'Effect', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Link', 'Token'];
      const index = order.indexOf(card.data('cardfront')?.data('monster_color'));
      return index < 0 ? order.length : index;
    }
    function sortLevel(card) {
      const front = card.data('cardfront');
      if (concealed(card) || cardType(card) !== 'Monster') return 0;
      if (front?.data('monster_color') === 'Link') {
        // DB stores Link rating as the number of enabled arrow bits, not level.
        const arrows = front.data('arrows');
        if (typeof arrows === 'string' && /^[01]{8}$/.test(arrows) && arrows.includes('1')) return [...arrows].filter(bit => bit === '1').length;
        const fallback = Number(front.data('level'));
        return Number.isFinite(fallback) && fallback > 0 ? fallback : Number.MAX_SAFE_INTEGER;
      }
      const value = front?.data('level'), level = Number(value);
      return value !== undefined && value !== null && value !== '' && Number.isFinite(level) && level >= 0 ? level : Number.MAX_SAFE_INTEGER;
    }
    function cardGroups(cards) {
      if (!sortedFan) return [{ label: '', cards }];
      const order = (fanPassDescriptor || viewZone())?.zone === 'Extra Deck' ? ['Fusion', 'Synchro', 'Xyz', 'Link', 'Other', 'Hidden cards', 'Pendulum'] : ['Monsters', 'Spells', 'Traps', 'Other', 'Hidden cards', 'Face-down cards'];
      // Sort fresh display arrays only. Native pile order and native card nodes
      // stay intact, and tiles keep their mapping to the original card object.
      return order.map(label => ({ label, cards: cards.filter(card => cardGroup(card) === label)
        .sort((a, b) => sortMonsterType(a) - sortMonsterType(b) || sortLevel(a) - sortLevel(b) || displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base', numeric: true })) }))
        .filter(group => group.cards.length);
    }
    function sortedRows(cards, capacity) {
      const groups = cardGroups(cards), bands = [];
      const extraDeck = (fanPassDescriptor || viewZone())?.zone === 'Extra Deck';
      const fits = batch => {
        const boundaries = batch.reduce((n, card, i) => n + (i > 0 && cardGroup(card) !== cardGroup(batch[i - 1]) ? 1 : 0), 0);
        return batch.length <= capacity && 100 + (batch.length - 1) * 36 + boundaries * 88 <= parseFloat(fan.style.width) - 76;
      };
      const sections = (fanPassDescriptor || viewZone())?.zone === 'Banished' ?
        [groups.filter(group => group.label !== 'Face-down cards'), groups.filter(group => group.label === 'Face-down cards')] :
        (fanPassDescriptor || viewZone())?.zone === 'Extra Deck' ? [groups.filter(group => group.label !== 'Pendulum'), groups.filter(group => group.label === 'Pendulum')] : [groups];
      for (const section of sections.filter(groups => groups.length)) {
        const sectionBands = [];
        if (sortLayout() === 'continuous') sectionBands.push(section.flatMap(group => group.cards));
        else for (const group of section) {
          // Extra Deck types may reorder: pair small groups even when another
          // type sits between them. Pendulums remain in their own last section.
          const partner = extraDeck && group.cards.length < 5 ? sectionBands.find(band => band.length < 5 && fits([...band, ...group.cards])) :
            sortLayout() === 'adaptive' && sectionBands.at(-1)?.length < 5 && group.cards.length < 5 && fits([...sectionBands.at(-1), ...group.cards]) ? sectionBands.at(-1) : null;
          if (partner) partner.push(...group.cards);
          else sectionBands.push([...group.cards]);
        }
        bands.push(...sectionBands);
      }
      const rows = bands.flatMap(band => {
        const count = Math.ceil(band.length / capacity), size = Math.floor(band.length / count), extra = band.length % count;
        return Array.from({ length: count }, (_, i) => {
          const start = i * size + Math.min(i, extra);
          return band.slice(start, start + size + (i < extra ? 1 : 0));
        });
      });
      if (extraDeck && sortLayout() !== 'continuous') {
        while (rows.length > 3) {
          let best = null;
          for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
            const pendulum = [...rows[i], ...rows[j]].some(card => cardGroup(card) === 'Pendulum');
            // A Pendulum row may only join the row before it, so Pendulums remain last.
            if ([...rows[i], ...rows[j]].some(card => cardGroup(card) === 'Hidden cards') || pendulum && !(j === rows.length - 1 && i === j - 1)) continue;
            const merged = [...rows[i], ...rows[j]];
            if (fits(merged) && (!best || merged.length < best.cards.length)) best = { i, j, cards: merged };
          }
          if (!best) break;
          rows[best.i] = best.cards; rows.splice(best.j, 1);
        }
      }
      return rows;
    }
    function renderFanCards(cards) {
      const area = fan.querySelector('.dblite-fan-cards');
      const focused = area.contains(document.activeElement) ? document.activeElement : null;
      const scrollTop = area.scrollTop;
      const previous = new Map([...area.querySelectorAll('.dblite-fan-card')].map(tile =>
        [proxies.get(tile), { tile, rect: tile.getBoundingClientRect() }]));
      // Sample the current visual position before cancelling an interrupted
      // layout animation; new measurements must use the resting layout.
      for (const { tile } of previous.values()) { tileMotions.get(tile)?.cancel(); tileMotions.delete(tile); }
      area.replaceChildren();
      const grid = viewMode === 'grid';
      area.classList.toggle('dblite-grid', grid);
      area.classList.toggle('dblite-sorted', sortedFan && !grid); area.classList.toggle('dblite-grid-sorted', sortedFan && grid);
      area.dataset.zone = (fanPassDescriptor || viewZone())?.zone || '';
      const sortButton = fan.querySelector('.dblite-sort');
      if (sortButton) { sortButton.hidden = !['fan', 'grid'].includes(viewMode); sortButton.setAttribute('aria-pressed', String(sortedFan)); const keyHint = document.documentElement.classList.contains('dbetter-phone') ? '' : ` (${rules.keyLabel(api.config().keys.sort)})`; const sortLabel = (sortedFan ? 'Sorted' : 'Sort') + keyHint; if (sortButton.textContent !== sortLabel) sortButton.textContent = sortLabel; }
      const filtered = cards.filter(card => displayName(card).toLowerCase().includes(query.toLowerCase()));
      fan.querySelector('.dblite-count').textContent = `${filtered.length} / ${cards.length}`;
      const scale = appearance.size / 100;
      fan.style.transform = `scale(${scale})`; fan.style.setProperty('--dblite-fan-scale', String(scale)); fan.style.maxHeight = `${Math.max(1, innerHeight - 32) / scale}px`;
      const band = api.config().adaptiveLayout && api.config().adaptiveDock && !zonePosition() && !moving?.position && window.DBLiteLayout?.band;
      // A landscape phone is wide and short: lay a fan out in at most three rows.
      const phoneRows = !grid && !sortedFan && document.documentElement.classList.contains('dbetter-phone');
      const maxWidth = phoneRows ? Math.max(1, band?.width || innerWidth - 32) / scale : Math.min(760, Math.max(1, band?.width || innerWidth - 32) / scale);
      const rowCap = appearance.perRow || Infinity;
      const fanLimit = Math.min(rowCap, phoneRows ? Math.max(15, Math.ceil(filtered.length / 3)) : appearance.perRow || 15);
      const capacity = grid ? Math.max(1, Math.min(rowCap, Math.floor((maxWidth - 46) / 110))) : Math.max(1, Math.min(fanLimit, Math.floor((maxWidth - 160) / 52) + 1));
      const columns = Math.min(Math.max(1, filtered.length), capacity);
      const available = Math.max(1, innerWidth - 32) / scale;
      const width = viewDims ? Math.min(available, Math.max(300, viewDims.width)) : sortedFan && !grid ? maxWidth : Math.min(maxWidth, Math.max(560, grid ? columns * 110 + 46 : (Math.min(columns, phoneRows ? Math.ceil(filtered.length / 3) : columns) - 1) * 52 + 160));
      fan.style.width = `${width}px`;
      fan.classList.toggle('dblite-fan-sized', !!viewDims);
      if (viewDims) fan.style.height = `${Math.min(Math.max(1, innerHeight - 32) / scale, Math.max(180, viewDims.height))}px`; else fan.style.removeProperty('height');
      if (!filtered.length) { area.append(element('p', 'dblite-empty', 'No matching cards')); positionFan(); return; }
      const perRow = grid ? Math.max(1, Math.min(rowCap, Math.floor((width - 46) / 110))) : Math.max(1, Math.min(sortedFan ? Math.min(rowCap, 18) : fanLimit, Math.floor((width - 160) / (sortedFan ? 36 : 52)) + 1));
      // Sorted Grid: the same groups and order as the sorted Fan, each group starting a row.
      let rows = sortedFan && grid ? cardGroups(filtered).flatMap(group => Array.from({ length: Math.ceil(group.cards.length / perRow) }, (_, i) => group.cards.slice(i * perRow, (i + 1) * perRow))) :
        sortedFan ? sortedRows(filtered, perRow) : Array.from({ length: Math.ceil(filtered.length / perRow) }, (_, i) => filtered.slice(i * perRow, (i + 1) * perRow));
      // Max rows (⚙, Fan view only): fewer, fuller rows. Sorted rows first take more cards each, then the two
      // neighbouring rows with the fewest cards join.
      const maxRows = !grid && appearance.maxRows;
      if (maxRows && rows.length > maxRows) {
        if (sortedFan) {
          for (let cap = perRow + 1; rows.length > maxRows && cap <= filtered.length; cap++) rows = sortedRows(filtered, cap);
          while (rows.length > maxRows) {
            let best = 0;
            for (let i = 1; i < rows.length - 1; i++) if (rows[i].length + rows[i + 1].length < rows[best].length + rows[best + 1].length) best = i;
            rows.splice(best, 2, [...rows[best], ...rows[best + 1]]);
          }
        } else {
          const size = Math.ceil(filtered.length / maxRows);
          rows = Array.from({ length: Math.ceil(filtered.length / size) }, (_, i) => filtered.slice(i * size, (i + 1) * size));
        }
      }
      area.dataset.layout = sortedFan ? sortLayout() : '';
      for (const [rowIndex, batch] of rows.entries()) {
          const row = element('div', 'dblite-fan-row');
          if (sortedFan && grid && rowIndex > 0 && cardGroup(batch[0]) !== cardGroup(rows[rowIndex - 1][0])) row.classList.add('dblite-group-start');
          row.style.setProperty('--columns', batch.length);
          row.style.setProperty('--row-index', rowIndex);
          const boundaries = sortedFan && !grid && sortLayout() !== 'continuous' ? batch.reduce((total, card, i) => total + (i > 0 && cardGroup(card) !== cardGroup(batch[i - 1]) ? 1 : 0), 0) : 0;
          if (sortedFan && !grid) row.style.setProperty('--card-step', `${Math.min(68, Math.max(maxRows ? 12 : 36, (width - 176 - boundaries * 124) / Math.max(1, batch.length - 1 - boundaries)))}px`);
          // A row fuller than the width allows (Max rows): the cards overlap more.
          else if (!grid && batch.length > 1 && (width - 160) / (batch.length - 1) < 52) row.style.setProperty('--fan-step', `${Math.max(10, (width - 160) / (batch.length - 1))}px`);
          batch.forEach((card, index) => {
            const down = concealed(card);
            const old = previous.get(card)?.tile;
            const reuse = !!old;
            const tile = reuse ? old : element('div', 'dblite-fan-card'); proxies.set(tile, card);
            tile.dataset.faceDown = String(!!down);
            tile.classList.toggle('dblite-category-start', !!boundaries && index > 0 && cardGroup(card) !== cardGroup(batch[index - 1]));
            if (sortedFan) tile.dataset.group = cardGroup(card); else delete tile.dataset.group;
            tile.tabIndex = 0; tile.setAttribute('role', 'button');
            tile.setAttribute('aria-label', displayName(card));
            tile.title = displayName(card);
            const t = batch.length === 1 ? 0 : (index / (batch.length - 1) - 0.5) * 2;
            tile.style.setProperty('--angle', `${grid ? 0 : t * (sortedFan ? 5 : 7)}deg`);
            tile.style.setProperty('--arc', `${grid ? 0 : t * t * (sortedFan ? 9 : 13)}px`);
            tile.style.setProperty('--index', index);
            const face = tile.querySelector('.dblite-fan-face') || element('div', 'dblite-fan-face');
            copyFace(card, face); tile.append(face);
            const label = tile.querySelector('.dblite-fan-name') || element('span', 'dblite-fan-name');
            label.textContent = down ? 'Face-down' : name(card); tile.append(label);
            if (!reuse) {
              tile.addEventListener('mouseenter', () => { if (!dragging && !concealed(card)) previewOnce(card); hoveredTile = tile; hoverCardMenu(tile, card); });
              tile.addEventListener('mouseleave', () => { if (hoveredTile === tile) hoveredTile = null; if (hoverMenuOpen()) scheduleHoverClose(); else clearTimeout(hoverMenuTimer); });
              tile.addEventListener('click', () => { if (!dragging && !concealed(card)) previewOnce(card); });
              tile.addEventListener('keydown', event => {
              if (event.key === 'Enter') { event.preventDefault(); const r = tile.getBoundingClientRect(); openCardMenu(card, r.right, r.top); }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault(); const tiles = [...area.querySelectorAll('.dblite-fan-card')], n = tiles.indexOf(tile);
                tiles[(n + (event.key === 'ArrowRight' ? 1 : -1) + tiles.length) % tiles.length].focus();
              }
              });
            }
            row.append(tile);
          }); area.append(row);
      }
      dirtyFaces.clear();
      area.scrollTop = scrollTop;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
      positionFan(moving?.position || zonePosition());
      // Reuse survivors when cards leave/search changes, then animate layout
      // deltas. They must not replay a whole fan entrance on every update.
      const tiles = [...area.querySelectorAll('.dblite-fan-card')];
      const rects = tiles.map(tile => tile.getBoundingClientRect());
      clearTileMotions();
      tiles.forEach((tile, index) => {
        const old = previous.get(proxies.get(tile));
        if (dragging || moving || peeking || sortedFan) return;
        if (old?.tile === tile) {
          const dx = (old.rect.left - rects[index].left) / scale;
          const dy = (old.rect.top - rects[index].top) / scale;
          if (Math.abs(dx) + Math.abs(dy) > 1) animateTile(tile, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }]);
        } else animateTile(tile, [{ translate: '0px 8px' }, { translate: '0px 0px' }], Math.min(index * 8, 48));
      });
      refreshTargets();
    }
    function modeButtons() {
      const group = element('div', 'dblite-view-modes');
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Card view mode');
      for (const mode of ['fan', 'grid', 'classic']) {
        const item = button(mode[0].toUpperCase() + mode.slice(1), () => {
          // Phones show only the current mode; tapping it moves to the next one.
          const phone = document.documentElement.classList.contains('dbetter-phone');
          if (viewMode === mode && !phone) return;
          viewMode = viewMode === mode ? ['fan', 'grid', 'classic'][(['fan', 'grid', 'classic'].indexOf(mode) + 1) % 3] : mode;
          try { sessionStorage.setItem('dblite-card-view', viewMode); } catch { /* Keep the in-memory choice. */ }
          closeMenu(); hideFan(); refreshFan();
        });
        item.setAttribute('aria-pressed', String(viewMode === mode));
        if (mode === 'classic') item.title = 'Use DuelingBook’s original card list';
        group.append(item);
      }
      return group;
    }
    function wantsFan(zone = window.viewing) {
      return api.config().fan && viewMode !== 'classic' && !wizard && !!(fanPassDescriptor || viewZone(zone)) && viewerValid(viewContext(), true);
    }
    function hookPileMoveOrigins() {
      for (const [fn, zone, position, offset] of [
        ['removeFromDeck', 'Deck', 'deck', 'm'], ['removeTopCardFromDeck', 'Deck', 'deck', 'm'],
        ['removeFromExtra', 'Extra Deck', 'extra', 'e'], ['removeFromGY', 'Graveyard', 'grave', 'g'],
        ['removeFromBanished', 'Banished', 'banished', 'b']
      ]) {
        const original = window[fn];
        if (typeof original !== 'function' || rules.hasHook(original, hooks.get(fn))) continue;
        const wrapped = function (p, data, ...rest) {
          if (window.DBETTERRebuilding) return original.call(this, p, data, ...rest);
          api.clearPileHover();
          let origin, card;
          if (p === player() && window.viewing === zone && wantsFan(zone)) {
            const pile = p[zones[zone]] || [];
            const index = fn === 'removeTopCardFromDeck' ? 0 : pile.findIndex(item => id(item) === data?.id);
            card = pile[index];
            if (card && nativeView()?.querySelector(':scope > .content')?.contains(card[0]) &&
                Number.isFinite(p[`${position}X`]) && Number.isFinite(p[`${position}Y`])) {
              const depth = pile.length - 1 - index;
              const step = axis => Number.isFinite(p[`${offset}${axis}`]) ? p[`${offset}${axis}`] : 0;
              const down = zone === 'Deck' ? !card.data('face_up') && !p.deck_face_up : zone !== 'Graveyard' && card.data('face_down');
              origin = { left: p[`${position}X`] + depth * step('X'),
                top: p[`${position}Y`] + (zone === 'Banished' ? 0 : depth * step('Y')),
                scale: 0.1485, rotation: p.rot || 0, rotationY: (down ? 180 : 0) + (window.ABOUT_ZERO || 0.0001), alpha: 1 };
            }
          }
          const result = original.call(this, p, data, ...rest);
          // The native remover has detached the card and refreshed the list.
          // Reset only the departing card before its caller starts the move
          // tween. Waiting for this response also leaves cancelled drops alone.
          if (origin && api.same(result, card) && typeof window.TweenMax?.set === 'function') window.TweenMax.set(result, origin);
          return result;
        };
        rules.markHook(wrapped, original); hooks.set(fn, wrapped); window[fn] = wrapped;
      }
    }
    function hookViewLifecycle() {
      const view = nativeView();
      if (view !== watchedView) {
        viewObserver.disconnect(); watchedView = view; watchedDisplay = view?.style.display;
        if (view) viewObserver.observe(view, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
      }
      for (const name of ['viewingE', 'viewCards']) {
        const original = window[name];
        if (typeof original !== 'function' || rules.hasHook(original, hooks.get(name))) continue;
        const wrapped = function (...args) {
          if (window.DBETTERRebuilding) return original.apply(this, args);
          api.clearPileHover();
          const zone = name === 'viewingE' ? args[0] : window.viewing;
          nativeView()?.classList.toggle('dblite-native-view', wantsFan(zone));
          try { return original.apply(this, args); }
          finally { refreshFan(); }
        };
        rules.markHook(wrapped, original); hooks.set(name, wrapped); window[name] = wrapped;
      }
    }
    function refreshFan() {
      if (window.DBETTERRebuilding) return;
      // Solo dealing views the Deck only because the server requires it; never draw the fan then.
      if (document.documentElement.classList.contains('dblite-solo-dealing')) { if (fan || classicSwitch) hideFan(); return; }
      const band = window.DBLiteLayout?.band;
      const dockStamp = [api.config().adaptiveLayout, api.config().adaptiveDock, band?.left, band?.top, band?.width, band?.height].join(':');
      if (dockStamp !== fanDockStamp) { fanDockStamp = dockStamp; fanKey = ''; }
      const descriptor = viewZone(), view = nativeView();
      const cards = descriptor?.cards || [];
      const probe = [window.viewing, view?.style.display, view?.className, window.duelId, window.duel_active, window.duelist, window.replay, window.paused, window.resetting, document.hidden, typeof window.DBO_chooseZone, viewerValid(viewContext(), true), nativeReady(), !!sequence, !!panel, !!dragging, !!moving, innerWidth, innerHeight, appearance.size, window.player1?.username, api.config().fan, viewMode, sortedFan, query, !!wizard,
        ...cards.map(card => { const front = card.data('cardfront'); return [id(card), card.data('face_down'), card.data('fake_card'), card[0].isConnected, front?.data('initialized'), front?.data('name'), front?.data('card_type'), front?.data('monster_color'), front?.data('level'), front?.data('arrows'), front?.data('pendulum')].join(':'); })].join('|');
      if (fanKey && probe === fanProbe && !dirtyFaces.size && fanContext?.player === player() && fanContext?.opponent === window.player2 && Date.now() - fanSafety < 5000) return;
      fanProbe = probe; fanSafety = Date.now();
      fanPassDescriptor = descriptor; fanConcealment = new Map();
      // Batch concealment/style reads before creating or moving any fan tiles.
      for (const card of cards) fanConcealment.set(card, concealed(card, descriptor));
      try { refreshFanNow(); } finally { fanPassDescriptor = null; fanConcealment = null; }
    }
    function refreshFanNow() {
      const view = nativeView(), zone = window.viewing;
      view?.classList.toggle('dblite-native-view', wantsFan(zone));
      view?.classList.toggle('dblite-macro-view', !!wizard);
      if (wizard || (fanContext && !viewerValid(fanContext, true))) { targets.clear(); hideFan(); return; }
      const descriptor = fanPassDescriptor || viewZone(zone);
      const enabled = api.config().fan && descriptor && viewerValid(viewContext(), true) && view && getComputedStyle(view).display !== 'none';
      if (!enabled) { targets.clear(); if (fan || classicSwitch) hideFan(); return; }
      const pile = descriptor.cards;
      if (Array.isArray(pile) && !pile.length) {
        // Check duel state, not filtered/rendered cards. Native effects can
        // temporarily remove the last card, so wait for their queue to settle.
        if (zones[zone] && nativeReady() && !sequence && !panel && !dragging && !moving) { closeMenu(); closeViewer(); }
        else if (observing() && fan) hideFan();
        return;
      }
      if (viewMode === 'classic') {
        if (fan) hideFan();
        if (!classicSwitch) {
          classicSwitch = isolate(element('nav', 'dblite-classic-switch'));
          classicSwitch.setAttribute('aria-label', 'Card list display');
          classicSwitch.append(modeButtons(), peekButton(), settingsButton()); document.body.append(classicSwitch); fanContext = viewContext();
        }
        sizeClassicView(view);
        const rect = view.getBoundingClientRect(), switchRect = classicSwitch.getBoundingClientRect();
        classicSwitch.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - switchRect.width - 8))}px`;
        classicSwitch.style.top = `${rect.top >= switchRect.height + 8 ? rect.top - switchRect.height - 6 : Math.max(8, Math.min(rect.bottom + 6, innerHeight - switchRect.height - 8))}px`;
        return;
      }
      // DuelingBook redirects scrollpane.append(card) into an OverlayScrollbars
      // viewport. Its real cards are descendants, not necessarily direct children.
      const cards = [...view.querySelectorAll(':scope > .content .card')].map(node => pile.find(card => card[0] === node))
        .filter(card => card && !card.data('fake_card'));
      if (!cards.length) { if (fan) hideFan(); view.classList.toggle('dblite-native-view', wantsFan(zone)); return; }
      if (fanZone !== zone) { hideFan(); query = ''; sortedFan = ['fan', 'grid'].includes(viewMode) && !!sortPreference()?.sorted; }
      const key = `${zone}:${sortedFan}:${cards.map(card => `${id(card)}:${displayName(card)}:${concealed(card)}:${!!card.data('face_down')}:${card[0].className}:${sortedFan ? `${cardGroup(card)}:${sortMonsterType(card)}:${sortLevel(card)}` : ''}`).join('|')}`;
      if (fan && fanKey === key) { refreshFaces(); return; }
      fanZone = zone; fanKey = key;
      if (!fan) {
        fan = element('section', 'dblite-fan'); fan.setAttribute('aria-label', `${zone} card fan`);
        for (const edge of ['e', 's', 'se']) fan.append(fanResizeHandle(edge));
        fan.classList.toggle('dblite-observer', observing());
        for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) fan.addEventListener(type, event => {
          if (observing() && event.target.closest?.('.dblite-fan-card')) {
            event.stopPropagation(); if (type === 'contextmenu') event.preventDefault();
          }
        });
        fanContext = viewContext();
        const header = isolate(element('header', 'dblite-fan-header'));
        header.append(moveHandle(), element('strong', '', zone), element('span', 'dblite-count'));
        const search = element('input'); search.type = 'search'; search.placeholder = 'Find a card…'; search.setAttribute('aria-label', `Search ${zone}`);
        search.value = query; search.oninput = () => { query = search.value; fanKey = ''; refreshFan(); };
        header.append(search, modeButtons());
        if (Object.hasOwn(zones, descriptor.zone)) {
          const sort = button(`Sort (${rules.keyLabel(api.config().keys.sort)})`, toggleSort, 'dblite-sort'); sort.setAttribute('aria-pressed', 'false');
          sort.title = `Group by card type, then level/rank/Link rating and name. Press ${rules.keyLabel(api.config().keys.sort)} to toggle.`; header.append(sort);
        }
        header.append(peekButton(), settingsButton(), button('×', closeViewer, 'dblite-close'));
        header.lastChild.setAttribute('aria-label', 'Close card fan');
        fan.append(header, element('div', 'dblite-fan-cards'), element('footer', '', `${observing() ? 'Read-only · ' : ''}${Object.hasOwn(zones, descriptor.zone) ? `${rules.keyLabel(api.config().keys.sort)}: sort Fan rows · ` : ''}${DBLiteRules.keyLabel(api.config().keys.peek)}: see through · Drag header: move · Right-click outside cards: close`));
        fan.querySelector('footer').hidden = !appearance.showHints;
        document.body.append(fan);
      }
      if (observedView !== view) {
        faceObserver.disconnect(); observedView = view;
        faceObserver.observe(view.querySelector(':scope > .content'), {
          subtree: true, childList: true, characterData: true, attributes: true,
          attributeFilter: ['style', 'class', 'src', 'srcset', 'hidden']
        });
      }
      view.classList.toggle('dblite-native-view', true); renderFanCards(cards);
    }
    function dialog(title, help) {
      closeSettings(); closePanel(); closeMenu(); panel = isolate(element('section', 'dblite-panel'));
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title);
      const header = element('header'); header.append(element('strong', '', title), button('×', cancelAll, 'dblite-close'));
      header.lastChild.setAttribute('aria-label', 'Close action');
      panel.append(header, element('p', 'dblite-help', help)); document.body.append(panel); return panel;
    }
    function cancelSummon() {
      if (wizard?.stage === 'summon' && api.same(window.summoning_card, wizard.result)) {
        window.hideSelectZones?.(); window.summoning_card = null; window.summoning_play = '';
      }
    }
    function cancelAll() {
      const changed = sequence?.sent || wizard?.changed;
      soloPractice = null;
      cancelFiftyPrompt();
      cancelSummon();
      sequence = null; wizard = null; nativeView()?.classList.toggle('dblite-macro-view', false); closePanel(); closeMenu();
      if (changed) api.announce('Stopped. Sent actions may still finish; completed moves are kept.');
    }
    function stop(message) { soloPractice = null; cancelFiftyPrompt(); cancelSummon(); sequence = null; wizard = null; nativeView()?.classList.toggle('dblite-macro-view', false); closePanel(); api.announce(message); }
    const historyActions = {
      specialSummon: 'SS', summonToken: 'SS', olSummon: 'Xyz Summoned', normalSummon: 'NS', flipSummon: 'Flip Summoned',
      move: 'Moved', toGY: 'Sent to GY', mill: 'Milled', banish: 'Banished', toHand: 'Added to hand', toDeck: 'Returned to Deck', toED: 'Returned to Extra Deck',
      drawCard: 'Drew 1 card',
      setMonster: 'Set a monster', setST: 'Set a Spell/Trap', activateST: 'Activated', toST: 'Moved',
      activateFieldSpell: 'Activated Field Spell', setFieldSpell: 'Set Field Spell',
      toATK: 'Changed to Attack', toDEF: 'Changed to Defense', flip: 'Flipped', turnFaceDown: 'Turned face-down',
      changeControl: 'Changed control', overlay: 'Overlaid', attach: 'Attached material', attachTopCardFromDeck2: 'Attached material', detach: 'Detached material'
    };
    function prepareHistory(fn, p, data) {
      if (!historyActions[fn] || !historyAccepts(viewContext()) || !data || data.username !== p?.username) return null;
      const cardId = fn === 'attach' || fn === 'overlay' ? data.start_id : fn === 'attachTopCardFromDeck2' ? data.end_id : data.id;
      const card = eventCard({ id: cardId }) || (['drawCard', 'mill'].includes(fn) ? p.main_arr?.[0] : null);
      const source = card && targetLocation(card);
      // Public provenance is captured before the native handler hides/moves it.
      // Own hands and decks are private too; cached identities are not evidence.
      const publicSource = source && (source.key === 'grave_arr' || (!card.data('face_down') &&
        !['main_arr', 'hand_arr'].includes(source.key) && (source.key !== 'extra_arr' || card.data('cardfront')?.data('pendulum'))));
      const publicName = publicSource ? card.data('cardfront')?.data('name') : null;
      return { ...viewContext(), card, source, publicFront: publicName ? historyFront(card, publicName) : null, data, fn };
    }
    function receivedHistory(snapshot) {
      if (!snapshot || !historyAccepts(snapshot)) { pendingHistory.delete(snapshot); return; }
      const { fn, data, source } = snapshot, card = snapshot.card || eventCard(data);
      const destination = card && targetLocation(card);
      if (!card) return;
      // Reveal-and-move handlers temporarily detach the card from every zone.
      // Record after native placement, before endAction advances the queue.
      if (!destination) { pendingHistory.add(snapshot); return; }
      pendingHistory.delete(snapshot);
      // Decide visibility at the destination after the native receipt updates
      // it. Drawing/setting/returning a cached opponent card must not reveal it.
      const publicReturn = fn === 'toHand' && source?.key === 'grave_arr' && snapshot.publicFront;
      const banishedFD = fn === 'banish' && !!card.data('face_down');
      const publicFront = (publicReturn || banishedFD) && snapshot.publicFront;
      const cardName = banishedFD ? publicFront?.name || 'a card' : publicReturn ? publicFront.name : targetName(card, destination);
      const options = banishedFD || publicReturn ? { front: publicFront || null } : {};
      if (window.replay && destination.key === 'hand_arr' && ['toHand', 'drawCard'].includes(fn) && !publicReturn) {
        options.replayHand = { player: destination.player, front: historyFront(card, card.data('cardfront')?.data('name')) };
      }
      const describe = location => location.zone + (/^[ms][1-5]$/.test(location.slot) ? ' · ' + location.slot.toUpperCase() : '');
      const route = source && describe(source) !== describe(destination) ? describe(source) + ' → ' + describe(destination) : describe(destination);
      appendHistory(data, banishedFD ? 'Banished FD' : historyActions[fn], cardName, route, undefined, card, options);
    }
    function flushHistory() {
      for (const snapshot of pendingHistory) receivedHistory(snapshot);
    }
    function hookReceipts() {
      hookTurns();
      hookSignals();
      hookPeerChat();
      // Shuffle receipts still confirm native macro steps, without adding noise
      // to the visible action history.
      for (const fn of ['reveal', 'shuffleDeck', 'resetGame', 'beginNextDuel', ...Object.keys(historyActions)]) {
        const original = window[fn]; if (typeof original !== 'function' || rules.hasHook(original, hooks.get(fn)) || rules.hasHook(original, "dbliteHistoryHook")) continue;
        const wrapped = function (p, data, ...rest) {
          if (['resetGame', 'beginNextDuel'].includes(fn)) clearHistories();
          const snapshot = historyDepth ? null : prepareHistory(fn, p, data);
          let result;
          historyDepth++;
          try { result = original.call(this, p, data, ...rest); }
          finally { historyDepth--; }
          if (p === player() && ['reveal', 'shuffleDeck', 'resetGame'].includes(fn)) {
            const key = fn === 'reveal' ? `reveal:${data?.id}` : fn; receipts.set(key, (receipts.get(key) || 0) + 1);
          }
          receivedHistory(snapshot);
          return result;
        };
        wrapped.dbliteHistoryHook = true;
        rules.markHook(wrapped, original); hooks.set(fn, wrapped); window[fn] = wrapped;
      }
    }
    function runSteps(steps, complete, validate = () => true, requiresQuickActions = 'cardMacros') {
      if (sequence || !nativeReady()) return false;
      hookReceipts();
      sequence = { ...context(), steps, index: 0, waiting: false, sent: 0, complete, validate, requiresQuickActions };
      advance(); return true;
    }
    function advance() {
      const job = sequence; if (!job) return;
      try {
        if (job.requiresQuickActions && !(api.config().quickActions && api.config()[job.requiresQuickActions]) || !contextValid(job) || api.pendingSelection() || api.occupied()) {
          stop('Action stopped because the duel state changed. Completed moves are kept.'); return;
        }
        const step = job.steps[job.index];
        if (job.waiting) {
          if (Date.now() >= job.deadline) { stop('No confirmation from DuelingBook. Stopped without retrying; check the duel log.'); return; }
          if (!step.done() || !api.canPlay()) return;
          job.index++; job.waiting = false;
          if (job.index === job.steps.length) { sequence = null; job.complete(); return; }
        }
        if (!nativeReady()) return;
        const next = job.steps[job.index];
        if (!job.validate(job.index) || !next.valid()) { stop('Cards or actions changed. Stopped; completed moves are kept.'); return; }
        job.waiting = true; job.deadline = Date.now() + 15000; job.sent++;
        if (wizard) wizard.changed = true;
        next.send();
        if (panel) { let status = panel.querySelector('.dblite-progress'); if (!status) { status = element('p', 'dblite-progress'); status.setAttribute('role', 'status'); panel.append(status); } status.textContent = `Waiting for DuelingBook · ${job.index + 1} / ${job.steps.length}`; }
      } catch (error) { console.warn('Spellspeed action:', error); stop('Action stopped. Check the duel log before continuing.'); }
    }
    function moveStep(card, source, action, destination, faceDown = false, requireMenu = true) {
      const cardId = id(card);
      return {
        valid: () => owned(card) && id(card) === cardId && api.includes(player()[source], card) &&
          (!requireMenu || api.allowedActions(card).includes(action)),
        send: () => window.cardMenuClicked(card, action),
        done: () => owned(card) && id(card) === cardId && !api.includes(player()[source], card) &&
          (destination === 'field' ? api.cardInfo(card).inMonsterZone : api.includes(player()[destination], card)) &&
          (destination !== 'banished_arr' || !!card.data('face_down') === faceDown)
      };
    }
    function commandStep(message, cards, source, destination) {
      let before = null;
      return {
        valid: () => cards.every(card => owned(card) && api.includes(player()[source], card)),
        send: () => { before = { source: player()[source].length, destination: player()[destination].length }; window.Send({ action: 'Duel', play: 'Duel message', message }); },
        done: () => !!before && player()[source].length <= before.source - cards.length && player()[destination].length >= before.destination + cards.length
      };
    }
    function receiptStep(card, action, receiptKey, source) {
      let before;
      const cardId = id(card);
      return {
        valid: () => owned(card) && id(card) === cardId && api.includes(player()[source], card) &&
          typeof window[receiptKey.startsWith('reveal:') ? 'reveal' : 'shuffleDeck'] === 'function',
        send: () => { before = receipts.get(receiptKey) || 0; window.cardMenuClicked(card, action); },
        done: () => (receipts.get(receiptKey) || 0) > before && (receiptKey === 'shuffleDeck' || api.includes(player()[source], card))
      };
    }
    let soloPractice, soloSession, soloSessionControls, nativeSameHand;
    const soloSessionValid = () => soloSession && soloSession.player === player() && soloSession.duel === window.duelId && window.solo && window.duelist && !window.replay && !window.automatic && !window.tag_duel;
    function startSoloPractice(plan, reset = false) {
      // Accept an in-flight plan from the previous constructor script too.
      const settings = plan.settings || { handCount: 5, stackCount: plan.ids?.length ? 1 : 0, ordered: !!plan.ids?.length };
      soloPractice = { ...plan, ids: [...(plan.ids || [])], settings: { ...settings }, ...context(), stage: reset ? 'reset' : 'starting', deadline: Date.now() + 180000 };
    }
    function finishSoloPractice() {
      const { handCount, stackCount } = soloPractice.settings, stack = soloPractice.stack || [];
      soloPractice = null; closePanel();
      readSoloOpening(stack);
      api.announce(`Solo ready: ${handCount} cards in hand · ${stackCount} stacked on top.`);
    }
    // Same starting hand (user, 2026-10-28): when a Solo hand was not chosen in the constructor, ↺ beside Reset
    // deck resets the deck and deals this game's opening hand again (and the same cards stacked on top, if any);
    // later draws are not kept. The opening is read once per deal: when DBETTER's setup finishes, or when
    // DuelingBook's own deal (the duel's start, its Reset Deck) is complete and every card is still in the hand
    // or the Deck.
    let soloOpening = null;
    const dealKey = () => `${window.duelId}:${receipts.get('resetGame') || 0}`;
    const printedId = card => Number(card?.data('cardfront')?.data('id'));
    function readSoloOpening(stack = []) {
      const p = player(), hand = p?.hand_arr || [];
      if (!hand.length || hand.some(card => !owned(card) || card.data('cardfront')?.data('initialized') === false || !printedId(card)) || stack.some(card => !printedId(card))) return false;
      soloOpening = { key: dealKey(), player: p, duel: window.duelId, hand: hand.map(printedId), stack: stack.map(printedId) };
      return true;
    }
    function watchSoloOpening() {
      if (soloPractice || !window.solo || !window.duelist || window.replay || window.tag_duel || soloOpening?.key === dealKey() || !nativeReady()) return;
      const p = player();
      if (!p || p.hand_arr.length < Math.min(5, p.main_arr.length + p.hand_arr.length)) return;
      if (p.all_cards_arr.every(c => api.includes(p.hand_arr, c) || api.includes(p.main_arr, c) || api.includes(p.extra_arr, c))) readSoloOpening();
    }
    // A hand chosen in the constructor is dealt again by Reset deck already.
    const sameHandOffered = () => !!soloOpening && soloOpening.player === player() && soloOpening.duel === window.duelId && window.solo && window.duelist && !window.replay &&
      !(soloSession?.ids?.length && soloSession.settings?.ordered);
    function resetSameHand() {
      if (!sameHandOffered() || !nativeReady() || soloPractice || sequence || wizard || window.resetting) return;
      const { hand, stack } = soloOpening;
      closeViewer();
      startSoloPractice({ ...(soloSessionValid() ? soloSession : {}), ids: [...hand, ...stack], settings: { handCount: hand.length, stackCount: stack.length, ordered: true }, sameHand: true }, true);
    }
    function updateSoloControls() {
      const duel = document.getElementById('duel');
      // A Solo without DBETTER's controls (started elsewhere, or after a reload): ↺ beside DuelingBook's Reset Deck.
      const native = !soloSessionValid() && duel && sameHandOffered() && api.visible(document.getElementById('reset_btn'));
      if (native && !nativeSameHand) {
        nativeSameHand = isolate(button('↺', resetSameHand, 'dblite-solo-same dblite-solo-same-native'));
        nativeSameHand.title = 'Reset the deck with this game’s starting hand'; nativeSameHand.setAttribute('aria-label', nativeSameHand.title);
      }
      if (native) {
        if (nativeSameHand.parentElement !== duel) duel.append(nativeSameHand);
        const disabled = !nativeReady() || !!soloPractice || !!sequence || !!wizard || !!window.resetting;
        if (nativeSameHand.disabled !== disabled) nativeSameHand.disabled = disabled;
      } else { nativeSameHand?.remove(); nativeSameHand = null; }
      duel?.classList.toggle('dblite-same-hand-native', !!native);
      if (!soloSessionValid()) {
        soloSession = null; soloSessionControls?.remove(); soloSessionControls = null; duel?.classList.toggle('dblite-constructor-solo', false); return;
      }
      if (!soloSessionControls && duel) {
        soloSessionControls = isolate(element('div', 'dblite-solo-session'));
        soloSessionControls.setAttribute('aria-label', 'Constructor Solo controls');
        const reset = button('Reset deck', () => {
          if (!soloSessionValid() || !nativeReady() || soloPractice || sequence || wizard || window.resetting) return;
          closeViewer(); startSoloPractice(soloSession, true);
        }); reset.title = 'Reset the deck and regenerate this Solo session’s hand and top-deck stack';
        const same = button('↺', resetSameHand, 'dblite-solo-same');
        same.title = 'Reset the deck with this game’s starting hand'; same.setAttribute('aria-label', same.title);
        const resetRow = element('div', 'dblite-solo-reset-row'); resetRow.append(reset, same);
        const back = button('Back to deck', () => {
          if (!soloSessionValid()) return;
          const plan = soloSession; cancelAll(); closeViewer();
          try { if (!window.DBETTERConstructor?.returnToDeck(plan)) api.announce('The constructor deck is unavailable. Use Quit to leave Solo.'); }
          catch (error) { console.warn('Spellspeed return to deck:', error); api.announce('Could not reopen the constructor. Use Quit to leave Solo.'); }
          updateSoloControls();
        }, 'dblite-solo-back'); back.title = `Return to ${soloSession.deckName || 'the deck constructor'}`;
        soloSessionControls.append(resetRow, back); duel.append(soloSessionControls);
      }
      duel?.classList.toggle('dblite-constructor-solo', true);
      if (soloSessionControls) {
        const disabled = !nativeReady() || !!soloPractice || !!sequence || !!wizard || !!window.resetting;
        for (const node of soloSessionControls.querySelectorAll('.dblite-solo-reset-row button')) if (node.disabled !== disabled) node.disabled = disabled;
        const same = soloSessionControls.querySelector('.dblite-solo-same'), offered = sameHandOffered();
        if (same.hidden === offered) same.hidden = !offered;
      }
    }
    function practiceDrawStep() {
      let card;
      return {
        valid: () => owned(player().main_arr[0]) && typeof window.drawCardE === 'function',
        send: () => { card = player().main_arr[0]; window.drawCardE(); },
        done: () => owned(card) && !api.includes(player().main_arr, card) && api.includes(player().hand_arr, card)
      };
    }
    function practiceMoveStep(card, source, action, destination) {
      const originalId = id(card), printedId = card.data('cardfront')?.data('id');
      // Native hand shuffles renumber the same card objects, including earlier
      // cards in the hand. Follow that identity chain, never a printed-name match.
      const sameCard = () => owned(card) && card.data('cardfront')?.data('id') === printedId &&
        (id(card) === originalId || card.data('prev_ids')?.includes(originalId));
      return {
        valid: () => sameCard() && api.includes(player()[source], card) && api.allowedActions(card).includes(action),
        send: () => window.cardMenuClicked(card, action),
        done: () => sameCard() && !api.includes(player()[source], card) && api.includes(player()[destination], card)
      };
    }
    function hookPracticeHandPosition() {
      const original = window.determineHandPosition;
      if (typeof original !== 'function' || rules.hasHook(original, hooks.get('determineHandPosition'))) return;
      const wrapped = function (p, ...rest) {
        if (window.DBETTERRebuilding) return original.call(this, p, ...rest);
        const result = original.call(this, p, ...rest);
        // Native reveal-to-hand asks for index -1 before adding the first card.
        if (soloPractice && window.solo && p === player() && p.hand_arr.length === 0 &&
            !Number.isFinite(window.handDestination) && Number.isFinite(p.hand_position_arr?.[0])) {
          window.handDestination = p.hand_position_arr[0];
        }
        return result;
      };
      rules.markHook(wrapped, original); hooks.set('determineHandPosition', wrapped); window.determineHandPosition = wrapped;
    }
    // Solo setup is bookkeeping, not play: run native card animations at 4x
    // while it lasts and restore the exact previous GSAP time scale after.
    let soloClock = null;
    function soloSetupClock(active) {
      const engine = window.TweenMax || window.TweenLite;
      if (typeof engine?.globalTimeScale !== 'function') return;
      if (active) {
        // Another owner (native speed, replay rate) may set a new base; keep 4x on top of it.
        const current = engine.globalTimeScale();
        if (!soloClock || soloClock.engine !== engine) soloClock = { engine, before: current, applied: null };
        else if (current !== soloClock.applied) soloClock.before = current;
        if (current !== soloClock.applied) { soloClock.applied = soloClock.before * 4; engine.globalTimeScale(soloClock.applied); }
      } else if (soloClock) { if (soloClock.engine.globalTimeScale() === soloClock.applied) soloClock.engine.globalTimeScale(soloClock.before); soloClock = null; }
    }
    function updateSoloPractice() {
      if (!soloPractice && nativeReady()) {
        const plan = window.DBETTERConstructor?.takePractice();
        if (plan) { soloSession = { ...plan, ...context() }; startSoloPractice(plan); }
      }
      watchSoloOpening(); updateSoloControls();
      // The server only deals from a viewed Deck; keep that view off screen.
      document.documentElement.classList.toggle('dblite-solo-dealing', !!soloPractice && (['view', 'select', 'dealing'].includes(soloPractice.stage) || window.viewing === 'Deck'));
      soloSetupClock(!!soloPractice);
      const job = soloPractice; if (!job) return;
      hookPracticeHandPosition();
      if (!contextValid(job) || !window.solo || Date.now() > job.deadline) { stop('Solo setup stopped. Check the current hand before continuing.'); return; }
      if (sequence || !nativeReady() || window.resetting) return;
      const p = player(), settings = job.settings;
      if (job.stage === 'starting') {
        if (p.hand_arr.length < Math.min(5, job.mainSize || p.main_arr.length + p.hand_arr.length)) return;
        if (!settings.ordered && settings.handCount === 5 && settings.stackCount === 0) { finishSoloPractice(); return; }
        job.stage = 'return';
      }
      if (job.stage === 'reset') {
        if (p.all_cards_arr.every(c => api.includes(p.main_arr,c) || api.includes(p.extra_arr,c))) { job.stage = 'return'; }
        else {
          if (typeof window.resetDeckE !== 'function') { stop('Native deck reset is unavailable.'); return; }
          job.resetReceipt = receipts.get('resetGame') || 0; job.stage = 'resetting';
          dialog('Reset Solo deck', 'Waiting for DuelingBook to return and shuffle the cards.');
          try { window.resetDeckE(); } catch (error) { console.warn('Spellspeed Solo reset:', error); stop('Solo reset stopped. Check the current deck before trying again.'); }
          return;
        }
      }
      if (job.stage === 'resetting') {
        // Solo's reset response also queues a fresh five-card hand. nativeReady
        // above waits for that queue; the return stage replaces the automatic
        // hand with this session's configured hand and top-deck stack.
        if ((receipts.get('resetGame') || 0) <= job.resetReceipt) return;
        // No chosen cards and the default hand: keep the random five DuelingBook just dealt.
        if (!job.ids.length && !settings.ordered && settings.stackCount === 0 && settings.handCount === 5) { finishSoloPractice(); return; }
        job.stage = 'return';
      }
      if (job.stage === 'return') {
        if (!p.hand_arr.length) { job.stage = 'shuffle-start'; return; }
        const original = [...p.hand_arr]; job.stage = 'returning';
        dialog('Solo starting hand', 'Returning the random starting hand, then shuffling. Escape stops setup.');
        runSteps(original.map(card=>practiceMoveStep(card,'hand_arr','To T Deck','main_arr')),()=>{ job.stage='shuffle-start'; },()=>window.solo,false);
      } else if (job.stage === 'shuffle-start' || job.stage === 'shuffle-final') {
        const final = job.stage === 'shuffle-final', next = () => { job.stage = final ? settings.ordered ? 'top' : 'draw' : job.ids.length ? 'view' : 'draw'; };
        if (!p.main_arr.length) { next(); return; }
        job.stage = 'shuffling';
        runSteps([receiptStep(p.main_arr[0],'Shuffle deck','shuffleDeck','main_arr')],next,()=>window.solo,false);
      } else if (job.stage === 'draw') {
        if (!settings.handCount) { job.stage = 'top'; return; }
        job.stage = 'drawing';
        dialog('Solo starting hand', `Drawing ${settings.handCount} random cards. Escape stops setup.`);
        runSteps(Array.from({ length: settings.handCount }, practiceDrawStep), () => { job.stage = 'top'; }, () => window.solo, false);
      } else if (job.stage === 'top') {
        const stack = job.stack || [];
        if (!stack.length) { finishSoloPractice(); return; }
        job.stage = 'placing';
        runSteps([...stack].reverse().map(card => practiceMoveStep(card,'hand_arr','To T Deck','main_arr')), finishSoloPractice,()=>window.solo,false);
      } else if (job.stage === 'view') {
        document.documentElement.classList.toggle('dblite-solo-dealing', true); hideFan();
        closePanel(); openPile('Deck'); job.stage='select';
      } else if (job.stage === 'select') {
        if (window.viewing!=='Deck' || !p.main_arr.every(c=>c.data('cardfront')?.data('initialized'))) return;
        const available=[...p.main_arr],chosen=[];
        for(const printedId of job.ids){const index=available.findIndex(c=>Number(c.data('cardfront').data('id'))===printedId);if(index<0){const same=job.sameHand;soloPractice=null;closeViewer();stop(same?'The Deck no longer holds this game’s starting hand. Setup stopped.':'The Solo deck does not match the constructor’s selected cards. Setup stopped.');return;}chosen.push(available.splice(index,1)[0]);}
        const steps=chosen.map(c=>practiceMoveStep(c,'main_arr','To hand','hand_arr'));
        job.stack=chosen.slice(settings.ordered ? settings.handCount : 0);
        job.stage='dealing';
        dialog('Solo starting hand',`Preparing ${settings.handCount} cards in hand and ${settings.stackCount} on top. Escape stops setup.`);
        runSteps(steps,()=>{
          closeViewer();
          // Wait for closing animations/receipts before starting another action.
          // Place the configured stack after the viewer's shuffle and final shuffle.
          job.stage='shuffle-final';
        },()=>window.solo,false);
      }
    }
    function batchDialog(kind, sourceCard) {
      if (!nativeReady() || sequence || wizard || !api.config().quickActions || !api.config()[kind === 'vidolium' ? 'cardMacros' : 'quickButtons']) return;
      const grave = kind === 'vidolium', source = grave ? 'grave_arr' : 'main_arr';
      const sourceId = sourceCard && id(sourceCard), sourceValid = () => !grave || (sourceCard && id(sourceCard) === sourceId && canResolveVidolium(sourceCard));
      if (!sourceValid()) return;
      const title = ({ mill: 'Mill top X', banish: 'Banish top X', banishFD: 'Banish top X face-down', vidolium: 'Vidolium · banish entire GY face-down' })[kind];
      const ctx = context(), pile = [...(player()[source] || [])];
      if (!pile.length) { api.announce(grave ? 'Your Graveyard is empty.' : 'Your Deck is empty.'); return; }
      const root = dialog(title, grave ? `${pile.length} cards in your GY. Banish your cards face-down for Vidolium’s effect. Your opponent handles their own GY.` : `${pile.length} cards in your Deck. How many cards?`);
      root.classList.toggle('dblite-batch-panel', true); root.dataset.quickSetting = grave ? 'cardMacros' : 'quickButtons';
      const input = element('input'); input.type = 'number'; input.min = '1'; input.max = String(pile.length); input.step = '1'; input.value = grave ? String(pile.length) : '1'; input.setAttribute('aria-label', 'Number of cards');
      const presets = [];
      const syncAmount = () => presets.forEach(preset => preset.setAttribute('aria-pressed', String(Number(input.value) === Number(preset.dataset.amount))));
      const setAmount = value => { input.value = String(Math.max(1, Math.min(pile.length, value))); syncAmount(); };
      if (!grave) {
        input.className = 'dblite-amount'; root.append(input);
        const choices = element('div', 'dblite-amount-presets'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'Quick amounts');
        for (const amount of [1, 3, 5, 6, 10]) {
          const preset = button(String(amount), () => setAmount(amount)); preset.dataset.amount = String(amount);
          preset.disabled = amount > pile.length; presets.push(preset); choices.append(preset);
        }
        input.addEventListener('input', syncAmount); syncAmount();
        root.append(choices, element('p', 'dblite-amount-hint', 'Scroll to adjust · Right-click to confirm'));
      }
      const error = element('p', 'dblite-error'); error.setAttribute('role', 'alert'); root.append(error);
      const submit = button(grave ? `Banish ${pile.length} face-down` : 'Apply', () => {
        if (panel !== root || !root.isConnected || sequence || wizard) return;
        const n = Number(input.value);
        if (!Number.isInteger(n) || n < 1 || n > pile.length) { error.textContent = `Enter a whole number from 1 to ${pile.length}.`; return; }
        if (!contextValid(ctx) || !nativeReady() || !sourceValid() || player()[source].length !== pile.length || pile.some((card, i) => !api.same(player()[source][i], card))) {
          error.textContent = 'The cards changed. Close and reopen this action.'; return;
        }
        if (window.viewing && !zones[window.viewing]) { error.textContent = 'Close the current native viewer, then Apply again.'; return; }
        closeViewer();
        const action = kind === 'mill' ? 'Mill' : kind === 'banish' ? 'Banish' : 'Banish FD';
        // Mill and top-card banishment are native pile-menu commands. Never
        // open a hidden Deck to learn the card identities for a batch.
        // Top-of-Deck batches use DuelingBook's own duel commands (/mill N, /banish N,
        // /banishfd N): one server action instead of N animated menu round trips.
        const command = !grave && typeof window.Send === 'function' && ({ mill: 'mill', banish: 'banish', banishFD: 'banishfd' })[kind];
        // The server ignores these commands above 10 cards, so larger batches are sent in chunks of 10.
        const chunks = []; for (let start = 0; start < n; start += 10) chunks.push(pile.slice(start, Math.min(n, start + 10)));
        const steps = command ? chunks.map(cards => commandStep(`/${command} ${cards.length}`, cards, source, kind === 'mill' ? 'grave_arr' : 'banished_arr')) :
          pile.slice(0, n).map(card => moveStep(card, source, action, kind === 'mill' ? 'grave_arr' : 'banished_arr', action === 'Banish FD', grave));
        root.replaceChildren(element('strong', '', title), element('p', 'dblite-help', 'One card at a time. Escape stops the remaining actions.'), button('Stop', cancelAll));
        runSteps(steps, () => { closePanel(); api.announce(`${n} card${n === 1 ? '' : 's'} moved.`); }, index => {
          const remaining = pile.slice(command ? index * 10 : index), live = player()[source]; // command steps move up to 10 cards
          return sourceValid() && live.length === remaining.length && remaining.every((card, i) => api.same(live[i], card));
        }, grave ? 'cardMacros' : 'quickButtons');
      }, 'dblite-primary');
      root.append(submit, button('Cancel', cancelAll, 'dblite-cancel')); input.onkeydown = event => { if (event.key === 'Enter') submit.click(); };
      if (!grave) {
        root.addEventListener('wheel', event => {
          if (!root.contains(input) || !event.deltaY || event.ctrlKey || event.metaKey || event.altKey) return;
          event.preventDefault(); event.stopPropagation();
          const current = Number.isInteger(input.valueAsNumber) ? input.valueAsNumber : 1;
          setAmount(current + (event.deltaY < 0 ? 1 : -1));
        }, { passive: false });
        root.addEventListener('contextmenu', event => {
          if (event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
          event.preventDefault(); event.stopPropagation();
          if (!root.contains(input) || event.target.closest?.('.dblite-close,.dblite-cancel')) return;
          submit.click();
        });
      }
      (grave ? submit : input).focus(); input.select?.();
    }

    // Both DBETTER clients use ordinary authenticated duel chat as their transport.
    // A reply can advance only the current resolution and the expected step.
    const peerPattern = /^\[DBLite FF (\d+) ([a-f0-9]{16}) (\d+) (pick|branch|reply-pick-[ABC]|reply-branch-[12]|close-pick|close-branch|cancel)\] (.+)$/;
    const opponentName = () => player()?.opponent?.username || window.player2?.username;
    function peerValid(ctx) {
      return !!ctx && ctx.player === player() && ctx.duel === window.duelId && window.duel_active && window.duelist &&
        !window.replay && !window.automatic && !window.tag_duel && !window.solo && typeof window.DBO_chooseZone !== 'function';
    }
    function sendPeer(token, kind, text) {
      if (!peerValid(context()) || typeof window.Send !== 'function') return false;
      try { window.Send({ action: 'Duel', play: 'Duel message', message: `[DBLite FF ${window.duelId} ${token} ${Math.floor(Date.now() / 1000)} ${kind}] ${text}`, html: 0 }); return true; }
      catch (error) { console.warn('Spellspeed opponent question:', error); return false; }
    }
    function closeOpponentRequest() { opponentRequest?.root?.remove(); opponentRequest = null; }
    function cancelFiftyPrompt() {
      if (wizard?.prompt && peerValid(wizard)) sendPeer(wizard.token, 'cancel', 'Fifty Fifty?: Resolution stopped.');
      if (wizard) wizard.prompt = null;
    }
    function finishFiftyPrompt(stage, text = 'Fifty Fifty?: Choice recorded.') {
      if (wizard?.prompt && !wizard.prompt.choice) sendPeer(wizard.token, `close-${stage}`, text);
      if (wizard) wizard.prompt = null;
    }
    function receivePeer(data, parsed) {
      if (!(api.config().quickActions && api.config().cardMacros) || !peerValid(context()) || data.html || data.username !== opponentName()) return;
      if (!peerContext || !peerValid(peerContext)) { closeOpponentRequest(); peerSeen.clear(); peerContext = context(); }
      const [, duel, token, issued, kind] = parsed, key = `${token}:${kind}`, age = Date.now() - Number(issued) * 1000;
      if (Number(duel) !== Number(window.duelId) || age < -30000 || age >= 120000) return;
      if (peerSeen.has(key)) return;
      peerSeen.add(key); if (peerSeen.size > 128) peerSeen.delete(peerSeen.values().next().value);
      if (kind === 'cancel' || kind.startsWith('close-')) {
        if (opponentRequest?.token === token && (kind === 'cancel' || kind === `close-${opponentRequest.stage}`)) closeOpponentRequest();
        return;
      }
      if (kind === 'pick' || kind === 'branch') {
        if (opponentRequest || peerSeen.has(`${token}:cancel`) || peerSeen.has(`${token}:close-${kind}`)) return;
        opponentRequest = { ...context(), token, stage: kind, opponent: data.username, deadline: Math.min(Date.now(), Number(issued) * 1000) + 120000, root: null };
        return;
      }
      const prompt = wizard?.prompt;
      if (!wizard || !prompt || !wizardValid() || wizard.token !== token || prompt.opponent !== data.username ||
          Date.now() >= prompt.deadline || wizard.stage !== prompt.stage || prompt.choice) return;
      const prefix = `reply-${prompt.stage}-`;
      if (kind.startsWith(prefix)) prompt.choice = kind.slice(prefix.length);
    }
    function hookPeerChat() {
      const original = window.duelChatPrint;
      if (typeof original !== 'function' || rules.hasHook(original, hooks.get('duelChatPrint'))) return;
      const wrapped = function (data, ...rest) {
        const snapshot = { username: data?.username, message: data?.message, html: data?.html };
        const parsed = typeof snapshot.message === 'string' && snapshot.message.match(peerPattern);
        // Keep ordinary chat behavior and show readable text in DBETTER. Parse a
        // snapshot because native printing can escape text or censor usernames.
        const known = parsed && !snapshot.html && [player()?.username, opponentName()].includes(snapshot.username);
        const result = original.call(this, known ? { ...data, message: parsed[5] } : data, ...rest);
        if (parsed) receivePeer(snapshot, parsed);
        return result;
      };
      rules.markHook(wrapped, original); hooks.set('duelChatPrint', wrapped); window.duelChatPrint = wrapped;
    }
    function updateOpponentRequest() {
      const request = opponentRequest; if (!request) return;
      if (!(api.config().quickActions && api.config().cardMacros) || !peerValid(request) || request.opponent !== opponentName() || Date.now() >= request.deadline) { closeOpponentRequest(); return; }
      const ready = contextValid(request) && nativeReady() && !sequence && !wizard && !panel;
      if (request.root) { request.root.hidden = !ready; return; }
      if (!ready) return;
      const root = request.root = isolate(element('section', 'dblite-panel dblite-opponent-choice'));
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Fifty Fifty? · your choice');
      root.append(element('strong', '', 'Fifty Fifty? · your choice'));
      root.append(element('p', 'dblite-help', request.stage === 'pick' ? 'Your opponent revealed three cards. Choose A, B or C at random; their identities are hidden behind these labels.' : 'Choose which effect your opponent must apply.'));
      const choices = request.stage === 'pick' ? [['A', 'A'], ['B', 'B'], ['C', 'C']] :
        [['1', 'Picked card · add or Special Summon a monster; banish a Trap'], ['2', 'Other card · add a monster; banish a Trap']];
      const error = element('p', 'dblite-error'); error.setAttribute('role', 'alert');
      for (const [value, label] of choices) root.append(button(label, () => {
        if (opponentRequest !== request || !(api.config().quickActions && api.config().cardMacros) || !contextValid(request) || !peerValid(request) || !nativeReady() || sequence || wizard || panel || request.opponent !== opponentName() || Date.now() >= request.deadline) return;
        const text = request.stage === 'pick' ? `Fifty Fifty?: I choose ${value}.` : `Fifty Fifty?: I choose effect ${value}.`;
        if (sendPeer(request.token, `reply-${request.stage}-${value}`, text)) closeOpponentRequest();
        else error.textContent = 'Reply could not be sent. Try again or tell your opponent in chat.';
      }, 'dblite-primary'));
      root.append(error, button('Dismiss', closeOpponentRequest)); document.body.append(root);
    }
    function startFifty(sourceCard) {
      if (!nativeReady() || sequence || wizard || !canResolveFifty(sourceCard)) return;
      const root = dialog('Fifty Fifty?', 'Choose 1 monster and 2 Traps from your Deck. Your opponent needs Spellspeed with Game actions and Card macros enabled to receive clickable choices. Questions and replies also appear in duel chat.');
      root.dataset.quickSetting = 'cardMacros';
      if (window.viewing !== 'Deck') {
        root.append(button('Open Deck to choose cards', () => { closePanel(); openPile('Deck'); startFifty(sourceCard); }, 'dblite-primary'));
        return;
      }
      const cards = [...player().main_arr];
      if (!cards.every(card => card.data('cardfront')?.data('name'))) { root.append(element('p', '', 'Wait for the Deck viewer to finish loading, then reopen this action.')); return; }
      const choices = [];
      for (const type of ['Monster', 'Trap', 'Trap']) {
        const label = element('label', '', choices.length === 0 ? 'Monster' : `Trap ${choices.length}`), select = element('select');
        select.setAttribute('aria-label', label.textContent);
        select.append(new Option('Choose a card…', ''));
        cards.forEach((card, i) => { if (cardType(card) === type) select.append(new Option(`${name(card)} · copy ${i + 1}`, String(i))); });
        label.append(select); root.append(label); choices.push(select);
      }
      const ctx = context(), error = element('p', 'dblite-error'); error.setAttribute('role', 'alert'); root.append(error);
      root.append(button('Reveal selected cards', () => {
        const selected = choices.map(select => select.value === '' ? null : cards[Number(select.value)]);
        if (selected.some(card => !card) || new Set(selected).size !== 3) { error.textContent = 'Choose one monster and two different Trap copies.'; return; }
        if (!contextValid(ctx) || !nativeReady() || !canResolveFifty(sourceCard) || window.viewing !== 'Deck' || selected.some(card => !owned(card) || !api.includes(player().main_arr, card))) { error.textContent = 'The cards changed. Reopen the action.'; return; }
        const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
        wizard = { ...ctx, cards: selected, changed: false, stage: 'reveal', token: [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') };
        hideFan(); nativeView()?.classList.toggle('dblite-macro-view', true);
        dialog('Fifty Fifty? · reveal', 'Revealing the three selected cards through DuelingBook. Escape stops.');
        runSteps(selected.map(card => receiptStep(card, 'Reveal', `reveal:${id(card)}`, 'main_arr')), chooseRandomCard);
      }, 'dblite-primary'));
    }
    function wizardValid() {
      if (!wizard || !contextValid(wizard) || !(api.config().quickActions && api.config().cardMacros) || !wizard.cards.every(card => owned(card))) return false;
      if (['branch', 'resultReveal', 'result', 'summon', 'finish'].includes(wizard.stage) &&
          (!api.includes(player().banished_arr, wizard.banished) || wizard.banished.data('face_down'))) return false;
      if (['pick', 'trap'].includes(wizard.stage) && !wizard.cards.every(card => api.includes(player().main_arr, card))) return false;
      if (['branch', 'result'].includes(wizard.stage) && ![wizard.picked, wizard.remaining].every(card => api.includes(player().main_arr, card))) return false;
      return true;
    }
    function askFiftyOpponent(stage, message) {
      if (!wizardValid() || !nativeReady() || window.solo || !opponentName()) return false;
      wizard.prompt = { stage, opponent: opponentName(), deadline: Date.now() + 120000, choice: null };
      const sent = sendPeer(wizard.token, stage, message);
      if (!sent) wizard.prompt = null;
      return sent;
    }
    function manualFiftyChoices(root, asked) {
      const details = element('details', 'dblite-manual-choice'); details.open = !asked;
      details.append(element('summary', '', 'Record a reply manually'));
      details.append(element('p', 'dblite-help', 'If the opponent cannot use the popup, agree their choice in chat and record it here.'));
      root.append(details); return details;
    }
    function acceptFiftyPick(value) {
      if (!wizardValid() || !nativeReady() || wizard.stage !== 'pick' || !['A', 'B', 'C'].includes(value)) return;
      finishFiftyPrompt('pick');
      wizard.picked = wizard.order[['A', 'B', 'C'].indexOf(value)]; wizard.stage = 'trap'; chooseTrap();
    }
    function chooseRandomCard() {
      if (!wizardValid()) { cancelAll(); return; }
      // Fisher–Yates with rejection sampling, not a local coin flip replacing
      // the opponent's choice. The three labels do not expose card identities.
      const shuffled = [...wizard.cards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const range = i + 1, limit = Math.floor(0x100000000 / range) * range, value = new Uint32Array(1);
        do { crypto.getRandomValues(value); } while (value[0] >= limit);
        const j = value[0] % range; [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      wizard.stage = 'pick';
      wizard.order = shuffled;
      const asked = askFiftyOpponent('pick', 'Fifty Fifty?: Please choose A, B or C at random in the Spellspeed popup, or reply in chat. The labels hide the three revealed cards.');
      const root = dialog('Fifty Fifty? · opponent’s random pick', asked ? 'Waiting for your opponent to choose A, B or C in Spellspeed. Their reply advances this step automatically.' : 'Ask your opponent to choose A, B or C at random, then record their choice.');
      const choices = manualFiftyChoices(root, asked);
      for (const label of ['A', 'B', 'C']) choices.append(button(`Opponent picked ${label}`, () => acceptFiftyPick(label), 'dblite-primary'));
    }
    function chooseTrap() {
      const root = dialog('Fifty Fifty? · banish a Trap', 'These are the two unpicked cards. Choose a Trap to banish face-up.');
      for (const card of wizard.cards.filter(card => card !== wizard.picked)) {
        const row = element('div', 'dblite-choice'); row.append(element('span', '', name(card)));
        if (cardType(card) === 'Trap') row.append(button('Banish this Trap', () => {
          if (!wizardValid() || !nativeReady() || sequence) return;
          wizard.banished = card;
          wizard.remaining = wizard.cards.find(item => item !== card && item !== wizard.picked);
          wizard.stage = 'banish';
          dialog('Fifty Fifty? · banishing Trap', 'Waiting for the banishment to finish.');
          runSteps([moveStep(card, 'main_arr', 'Banish', 'banished_arr', false, false)], chooseBranch);
        })); root.append(row);
      }
    }
    function chooseBranch() {
      if (!wizardValid()) { cancelAll(); return; }
      wizard.stage = 'branch';
      const asked = askFiftyOpponent('branch', 'Fifty Fifty?: Choose 1) Reveal your picked card: add or Special Summon a monster; banish a Trap. Or 2) Reveal the other remaining card: add a monster; banish a Trap. Choose in Spellspeed or reply 1/2 in chat.');
      const root = dialog('Fifty Fifty? · opponent’s effect choice', asked ? 'Waiting for your opponent to choose an effect in Spellspeed. Their reply advances this step automatically.' : 'Ask the opponent which effect to apply, then record their decision.');
      manualFiftyChoices(root, asked).append(button('Opponent chose the picked card', () => revealResult('picked'), 'dblite-primary'),
        button('Opponent chose the remaining card', () => revealResult('remaining')));
    }
    function revealResult(branch) {
      if (!wizardValid() || !nativeReady() || sequence || wizard.stage !== 'branch') return;
      finishFiftyPrompt('branch');
      const card = wizard[branch]; wizard.branch = branch; wizard.result = card; wizard.stage = 'resultReveal';
      dialog('Fifty Fifty? · reveal result', 'Revealing the card chosen by the effect.');
      runSteps([receiptStep(card, 'Reveal', `reveal:${id(card)}`, 'main_arr')], () => {
        wizard.stage = 'result';
        const root = dialog('Fifty Fifty? · apply result', name(card));
        if (cardType(card) === 'Trap') root.append(button('Banish, then shuffle the rest', () => finishFifty('Banish'), 'dblite-primary'));
        else {
          root.append(button('Add to hand, then shuffle', () => finishFifty('To hand'), 'dblite-primary'));
          if (branch === 'picked') {
            root.append(button('Special Summon in ATK', () => finishFifty('SS ATK')), button('Special Summon in DEF', () => finishFifty('SS DEF')));
          }
        }
      });
    }
    function finishFifty(action) {
      if (!wizardValid() || !nativeReady() || sequence) return;
      const card = wizard.result, rest = wizard.cards.find(item => item !== wizard.banished && item !== card);
      if (!api.includes(player().main_arr, rest)) { stop('A selected card moved. Finish the resolution manually.'); return; }
      if (action.startsWith('SS')) {
        // Open the native zone selector as a deliberate user step. The sequence
        // resumes only once that specific card is actually on the field.
        if (!api.allowedActions(card).includes(action)) { api.announce('That summon is unavailable. Use Add to hand or finish manually.'); return; }
        wizard.stage = 'summon'; wizard.summonDeadline = Date.now() + 60000;
        dialog('Fifty Fifty? · summon', 'Choose a monster zone on the board. The remaining card is shuffled back after the summon finishes.').style.pointerEvents = 'none';
        window.cardMenuClicked(card, action); return;
      }
      wizard.stage = 'finish';
      closeViewer();
      dialog('Fifty Fifty? · finishing', 'Moving the result and shuffling the remaining Deck.');
      runSteps([moveStep(card, 'main_arr', action, action === 'Banish' ? 'banished_arr' : 'hand_arr', false, false),
        receiptStep(rest, 'Shuffle deck', 'shuffleDeck', 'main_arr')], finishWizard);
    }
    function finishWizard() { wizard = null; closeViewer(); nativeView()?.classList.toggle('dblite-macro-view', false); closePanel(); api.announce('Fifty Fifty? resolution complete.'); }
    function updateWizard() {
      if (!wizard) return;
      if (!wizardValid()) { cancelAll(); return; }
      if (wizard.prompt) {
        if (wizard.prompt.opponent !== opponentName()) { stop('The opponent changed. Finish the resolution manually.'); return; }
        if (Date.now() >= wizard.prompt.deadline) {
          finishFiftyPrompt(wizard.prompt.stage, 'Fifty Fifty?: Question expired; confirm this choice in chat.');
          const help = panel?.querySelector('.dblite-help'); if (help) help.textContent = 'No Spellspeed reply received. Ask your opponent in chat and record their choice manually, or cancel.';
          const fallback = panel?.querySelector('details'); if (fallback) fallback.open = true;
        } else if (wizard.prompt.choice && nativeReady()) {
          const { stage, choice } = wizard.prompt;
          if (stage === 'pick') acceptFiftyPick(choice);
          else if (stage === 'branch') revealResult(choice === '1' ? 'picked' : 'remaining');
        }
      }
      if (wizard?.stage === 'summon') {
        if (Date.now() >= wizard.summonDeadline) { stop('Summon not confirmed. Finish Fifty Fifty? manually and shuffle the Deck.'); return; }
        if (api.cardInfo(wizard.result).inMonsterZone && nativeReady()) {
          const rest = wizard.cards.find(card => card !== wizard.banished && card !== wizard.result);
          wizard.stage = 'finish'; closeViewer(); dialog('Fifty Fifty? · shuffle', 'Shuffling the remaining card into the Deck.');
          runSteps([receiptStep(rest, 'Shuffle deck', 'shuffleDeck', 'main_arr')], finishWizard);
        }
      }
    }
    function shuffleCard() {
      const card = player()?.main_arr?.[0];
      return api.config().quickActions && api.config().quickButtons && nativeReady() && !document.hidden && !sequence && !wizard &&
        !window.viewing && card && owned(card) &&
        !card.data('fake_card') && typeof window.cardMenuClicked === 'function' ? card : null;
    }
    function shuffleOne() {
      const card = shuffleCard();
      // Shuffle belongs to showDeckMenu, not the individual card menu (which
      // deliberately rejects cards in a closed Deck). Use its native dispatch.
      if (card) window.cardMenuClicked(card, 'Shuffle deck');
    }
    function closeWheel(focus = false) {
      if (deckWheel) deckWheel.hidden = true;
      wheelToggle?.setAttribute('aria-expanded', 'false');
      if (focus && wheelToggle?.isConnected && !toolbar.hidden) wheelToggle.focus({ preventScroll: true });
    }
    function positionWheel() {
      if (!deckWheel || deckWheel.hidden) return;
      const anchor = wheelToggle.getBoundingClientRect();
      const left = Math.max(8, Math.min(innerWidth - 196, anchor.left + anchor.width / 2 - 94));
      const top = Math.max(8, Math.min(innerHeight - 196, anchor.top - 196));
      deckWheel.style.left = left + 'px'; deckWheel.style.top = top + 'px';
    }
    function updateToolbar() {
      const show = api.config().quickActions && api.config().quickButtons && contextValid(context());
      if (!show) { if (toolbar) toolbar.hidden = true; closeWheel(); return; }
      const deck = api.measure(document.getElementById('deck_hidden')), grave = api.measure(document.getElementById('grave_hidden'));
      if (!deck || !grave || deck.top <= grave.bottom) { if (toolbar) toolbar.hidden = true; closeWheel(); return; }
      if (!toolbar) {
        toolbar = isolate(element('nav', 'dblite-tools')); toolbar.setAttribute('aria-label', 'Deck actions');
        deckWheel = isolate(element('div', 'dblite-deck-wheel')); deckWheel.id = 'dblite-deck-wheel'; deckWheel.hidden = true;
        deckWheel.setAttribute('role', 'group'); deckWheel.setAttribute('aria-label', 'More Deck actions');
        const items = element('div', 'dblite-tools-items');
        for (const [label, kind, title] of [['Mill X', 'mill', 'Send the top X cards of your Deck to the GY'], ['Banish X', 'banish', 'Banish the top X cards of your Deck'], ['Banish X FD', 'banishFD', 'Banish X face-down']]) {
          const action = button(label, () => { closeWheel(); batchDialog(kind); }); action.title = title; action.setAttribute('aria-label', title); items.append(action);
        }
        const shuffle = button('Shuffle', () => { closeWheel(); shuffleOne(); }, 'dblite-shuffle');
        shuffle.title = 'Shuffle your Deck'; shuffle.setAttribute('aria-label', 'Shuffle your Deck'); items.append(shuffle);
        const draw = button('Draw', () => { closeWheel(); if (nativeReady() && !sequence && !wizard) api.drawOne(); }, 'dblite-draw');
        draw.title = 'Draw the top card of your Deck'; draw.setAttribute('aria-label', 'Draw 1 card');
        wheelToggle = button('', () => {
          if (!nativeReady() || sequence || wizard || toolbar.hidden) return;
          if (!deckWheel.hidden) { closeWheel(); return; }
          deckWheel.hidden = false; wheelToggle.setAttribute('aria-expanded', 'true'); positionWheel();
        }, 'dblite-wheel-toggle');
        wheelToggle.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v20M6 16h20"/></svg>';
        wheelToggle.setAttribute('aria-label', 'More Deck actions'); wheelToggle.setAttribute('aria-expanded', 'false'); wheelToggle.setAttribute('aria-controls', deckWheel.id); wheelToggle.title = 'Mill, banish or shuffle';
        for (const action of items.children) {
          const [verb, ...amount] = action.textContent.split(' ');
          action.replaceChildren(element('span', '', verb));
          if (amount.length) action.append(element('span', '', ` ${amount.join(' ')}`));
        }
        const close = button('×', () => closeWheel(true), 'dblite-wheel-close'); close.setAttribute('aria-label', 'Close Deck actions');
        deckWheel.append(items, close); toolbar.append(wheelToggle, draw); document.body.append(toolbar, deckWheel);
      }
      toolbar.hidden = false;
      // Native pile hitboxes already include the board's scale and offsets.
      const scale = Math.min(deck.width / 75.5, (deck.top - grave.bottom) / 72);
      const center = deck.left + deck.width / 2 - 16 * scale, top = (grave.bottom + deck.top) / 2;
      const viewport = document.documentElement.clientWidth || innerWidth;
      // Reserve the neighbouring zone's full defense-position footprint even
      // when empty. Cards travelling between piles and transient hover menus
      // must never move or hide this dock. Busy controls remain visible/disabled.
      let gaps = [[Math.max(8, deck.left - 14.5 * scale), Math.min(viewport - 8, deck.right + 12 * scale)]];
      for (const node of document.querySelectorAll('#duel .duel_avatar,.dblite-action-history,#duel .cout_txt,#duel .cin_txt,#duel #view,#chats>.chat,.dblite-fan,.dblite-panel')) {
        if (!api.visible(node)) continue;
        const measured = node.getBoundingClientRect(), padding = 5 * scale;
        const box = measured;
        if (box.bottom > top - 30 * scale - padding && box.top < top + 30 * scale + padding) {
          gaps = subtractGap(gaps, box.left - padding, box.right + padding);
        }
      }
      const gap = gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
      const width = gap && Math.min(102 * scale, gap[1] - gap[0]);
      if (!width || width < 78 * scale || scale < .1) { toolbar.hidden = true; closeWheel(); return; }
      toolbar.style.width = '102px';
      toolbar.style.left = `${Math.max(gap[0] + width / 2, Math.min(center, gap[1] - width / 2))}px`;
      toolbar.style.top = `${top}px`;
      toolbar.style.transform = `translate(-50%, -50%) scale(${width / 102})`;
      const blocked = !nativeReady() || !!sequence || !!wizard;
      if (blocked) closeWheel();
      [...toolbar.querySelectorAll('button'), ...deckWheel.querySelectorAll('.dblite-tools-items button')].forEach(node => {
        const disabled = blocked || (node.classList.contains('dblite-draw') && !api.canDraw()) ||
          (node.classList.contains('dblite-shuffle') && !shuffleCard());
        if (node.disabled !== disabled) node.disabled = disabled;
      });
      positionWheel();
    }
    let settingsStamp = '';
    function update() {
      if (window.DBETTERRebuilding) return;
      const preferences = JSON.stringify(api.config().keys);
      if (preferences !== settingsStamp) { settingsStamp = preferences; hideFan(); closeSettings(); }
      if (!api.config().shortcuts || !api.config().peekKey) setPeek(false);
      api.duelTools?.update();
      clearTileMotions();
      hookViewLifecycle(); hookPileMoveOrigins(); hookReceipts(); refreshFan(); refreshTargets(); refreshNotices(); refreshReplayHands(); flushHistory(); refreshDeclarations(); updateToolbar(); updateWizard(); updateOpponentRequest();
      if (sequence) advance();
      updateSoloPractice();
      if (((!api.config().quickActions || !api.config()[sequence?.requiresQuickActions || (wizard ? 'cardMacros' : panel?.dataset.quickSetting || 'quickButtons')]) && sequence?.requiresQuickActions !== false && !soloPractice || !contextValid(context())) && (sequence || wizard || panel)) cancelAll();
      if (menu && (!nativeReady() || !api.config().contextMenu && !hoverMenuOpen() || api.config().contextMenu && hoverMenuOpen())) closeMenu();
      viewerDuringZonePick();
    }
    document.addEventListener('contextmenu', event => {
      // The duel log and the action history sit beside the viewer (in replays it covers the board): there, a
      // right-click closes an open viewer like any other space away from its cards, and otherwise keeps theirs.
      if (event.target.closest?.('#duel_log,.dblite-action-history') && !event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]') &&
          (fan || classicSwitch) && viewerValid(fanContext, true) && viewZone() && !sequence && !wizard && !panel && !dragging && !api.pendingSelection() && !api.occupied()) {
        event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); closeViewer(); return;
      }
      if (event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.chat,#chats,#duel_log,#watch_chat,#watchers,#online_users,.cout_txt,.cin_txt')) return;
      const phase = event.target.closest?.('#duel .phase');
      if (phase && phaseChatReady() && api.visible(phase)) {
        const name = ({dp:'Draw Phase',sp:'Standby Phase',m1:'Main Phase 1',bp:'Battle Phase',m2:'Main Phase 2',ep:'End Phase'})[phase.id];
        if (name) {
          event.preventDefault(); event.stopImmediatePropagation();
          const own = window.turn_player.username === window.username;
          const message = !own ? 'in ' + name : window.currentPhase === phase.id.toUpperCase() ? 'End of ' + name : name + ' ?';
          window.Send({action:'Duel',play:'Duel message',message,html:0}); return;
        }
      }
      if (event.target.closest?.('.dblite-deck-wheel')) { event.preventDefault(); return; }
      if (event.target.closest?.('.dblite-card-search')) return;
      if (event.target.closest?.('.dblite-action-history')) return;
      if (event.target.closest?.('.dblite-view-settings')) { event.preventDefault(); return; }
      // Menus, panels and the controls inside the viewer header keep the viewer;
      // the header/switch background still closes it like any space away from cards.
      if (event.target.closest?.('.dblite-menu,.dblite-panel,.dblite-tools') ||
          event.target.closest?.('.dblite-fan-header,.dblite-classic-switch') && event.target.closest?.('input,button,select,textarea,label,[role="button"]')) { event.preventDefault(); return; }
      const viewerOpen = (fan || classicSwitch) && viewerValid(fanContext, true) && viewZone();
      if (viewerOpen && !sequence && !wizard && !panel && !dragging && !api.pendingSelection() && !api.occupied() &&
          !event.target.closest?.('.card,.dblite-fan-card')) {
        event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); closeViewer(); return;
      }
      if (event.target.closest?.('.dblite-fan-header,.dblite-classic-switch')) { event.preventDefault(); return; }
      if (!api.config().contextMenu || !nativeReady() || sequence || wizard) return;
      const pile = event.target.closest?.('#deck_hidden,#extra_hidden,#grave_hidden,#banished_hidden');
      if (pile) {
        event.preventDefault(); event.stopImmediatePropagation();
        openPile(({ deck_hidden: 'Deck', extra_hidden: 'Extra Deck', grave_hidden: 'Graveyard', banished_hidden: 'Banished' })[pile.id]); return;
      }
      const card = api.menuCard(event.target);
      if (!card || !api.menuSource(card)) return;
      event.preventDefault(); event.stopImmediatePropagation(); openCardMenu(card, event.clientX, event.clientY);
    }, true);
    // Native handlers can remain bound from the previous turn. Enable phase hit
    // testing for chat, while retaining the native restriction on left clicks.
    document.addEventListener('click', event => {
      if (event.target.closest?.('#duel .phase') && phaseChatReady() && (window.automatic || window.turn_player.username !== window.username)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    const wizardChat = target => !!wizard && !!target.closest?.('#duel .cin_txt,#chats');
    document.addEventListener('mousedown', event => {
      if (!event.target.closest?.('.dblite-deck-wheel,.dblite-wheel-toggle')) closeWheel();
      if (!event.target.closest?.('.dblite-view-settings,.dblite-settings-toggle')) closeSettings();
      if (!event.target.closest?.('.dblite-menu')) closeMenu();
      // Prevent another local game command from racing a multi-step action.
      if ((sequence || wizard || soloPractice) && !wizardChat(event.target) && !event.target.closest?.('.dblite-panel,.dblite-solo-session') && wizard?.stage !== 'summon') {
        event.preventDefault(); event.stopImmediatePropagation();
        return;
      }
      if (event.button === 0 && fan && !dragging && !peeking && event.target.closest?.('.dblite-fan-header') &&
          !event.target.closest('input,textarea,select,a,button:not(.dblite-move)')) {
        event.preventDefault(); event.stopImmediatePropagation(); closeMenu();
        const rect = fan.getBoundingClientRect(), start = { left: rect.left, top: rect.top };
        moving = { x: event.clientX, y: event.clientY, start, position: start, changed: false };
        fan.classList.toggle('dblite-view-moving', true);
        fan.querySelector('.dblite-move').focus({ preventScroll: true });
      }
    }, true);
    document.addEventListener('mousemove', event => {
      if (!moving || !fan) return;
      if (!(event.buttons & 1)) { finishMoving(true); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      const dx = event.clientX - moving.x, dy = event.clientY - moving.y;
      if (!moving.changed && Math.hypot(dx, dy) < 3) return;
      moving.changed = true;
      moving.position = positionFan({ left: moving.start.left + dx, top: moving.start.top + dy });
    }, true);
    document.addEventListener('mouseup', event => {
      if (event.button !== 0 || !moving) return;
      event.preventDefault(); event.stopImmediatePropagation(); finishMoving(true);
    }, true);
    document.addEventListener('click', event => {
      if ((sequence || wizard || soloPractice) && !wizardChat(event.target) && !event.target.closest?.('.dblite-panel,.dblite-solo-session') && wizard?.stage !== 'summon') {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.target.closest?.('.dblite-action-history,.dblite-card-search,.dblite-deck-wheel')) return;
      if (api.config().shortcuts && api.config().sortKey && event.key.toLowerCase() === api.config().keys.sort && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
          !event.isComposing && !event.defaultPrevented && sortAvailable() &&
          !event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]') &&
          !event.composedPath().some(node => node.localName === 'replay-scout')) {
        event.preventDefault(); event.stopImmediatePropagation(); sortCaptured = true;
        if (!event.repeat) toggleSort();
        return;
      }
      if (api.config().shortcuts && api.config().peekKey && event.key.toLowerCase() === api.config().keys.peek && !event.ctrlKey && !event.altKey && !event.metaKey &&
          (fan || classicSwitch) && viewerValid(fanContext, true) && viewZone() && !sequence && !wizard && !panel &&
          !event.isComposing && !event.target.closest?.('.dblite-view-settings,.dblite-settings-toggle,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]') &&
          !event.composedPath().some(node => node.localName === 'replay-scout')) {
        event.preventDefault(); event.stopImmediatePropagation(); spaceCaptured = true;
        if (!event.repeat) { finishMoving(true); closeMenu(); setPeek(!peeking); }
        return;
      }
      if (event.key !== 'Escape' && (sequence || wizard || soloPractice) && !wizardChat(event.target) && !event.target.closest?.('.dblite-panel,.dblite-solo-session')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('keyup', event => {
      if (event.key.toLowerCase() === api.config().keys.sort && sortCaptured) {
        event.preventDefault(); event.stopImmediatePropagation(); sortCaptured = false; return;
      }
      if (event.key.toLowerCase() === api.config().keys.peek && spaceCaptured) {
        event.preventDefault(); event.stopImmediatePropagation(); spaceCaptured = false;
      }
    }, true);
    window.addEventListener('blur', () => { closeWheel(); finishMoving(false); closeSettings(); setPeek(false); spaceCaptured = false; sortCaptured = false; closeMenu(); if (!wizard && (sequence || soloPractice)) cancelAll(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { finishMoving(false); closeSettings(); setPeek(false); spaceCaptured = false; sortCaptured = false; if (sequence || wizard || soloPractice) cancelAll(); }
    });
    let resizeFrame = null;
    window.addEventListener('resize', () => {
      // Bounds and native coordinate controls must be valid during resize handlers.
      finishMoving(false); fanKey = ''; closeMenu(); refreshFan(); positionSettings(); updateToolbar(); positionNotices();
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null; if (!window.document) return;
        finishMoving(false); fanKey = ''; closeMenu(); refreshFan(); positionSettings(); updateToolbar(); positionNotices();
      });
    });
    window.addEventListener('scroll', () => { updateToolbar(); positionNotices(); }, true);
    window.addEventListener('dbetter-rebuild-begin', event => {
      viewObserver.disconnect(); faceObserver.disconnect(); watchedView = null; observedView = null;
      // Recording past the furthest play continues the duel, as normal playback does: keep everything.
      if (event.detail?.mode === 'record') return;
      historyTape.length = 0;
      clearHistories(); turnSnapshot = null; hideFan(); closeMenu(); closePanel();
      targets.clear(); while (declarations.length) removeDeclaration(declarations.length - 1);
      declarationBanner?.node.remove(); declarationBanner = null;
      clearTileMotions();
    });
    function renderHistoryTape() {
      const pos = playNumber();
      let start = 0, end = 0;
      for (; end < historyTape.length && historyTape[end].pos <= pos; end++) if (historyTape[end].clear) start = end + 1;
      if (start === renderedStart && end === renderedEnd) return;
      const append = start === renderedStart && end > renderedEnd;
      if (!append) clearHistories();
      renderingRebuildHistory = true;
      try { for (let i = append ? renderedEnd : start; i < end; i++) if (!historyTape[i].clear) appendHistory(...historyTape[i].args); }
      finally { renderingRebuildHistory = false; }
      renderedStart = start; renderedEnd = end;
      update();
      for (const {list} of histories.values()) list.scrollTop = list.scrollHeight;
    }
    window.addEventListener('dbetter-rebuild-end', () => {
      viewObserver.takeRecords(); faceObserver.takeRecords(); dirtyFaces.clear(); fanProbe = ''; fanKey = '';
      renderHistoryTape();
    });
    // Moves along the tape: rendered once per frame however fast the user steps or scrubs.
    let tapeFrame = 0;
    window.addEventListener('dbetter-tape', () => {
      if (tapeFrame) return;
      tapeFrame = requestAnimationFrame(() => { tapeFrame = 0; fanProbe = ''; fanKey = ''; renderHistoryTape(); });
    });
    setInterval(update, 150);
    const style = element('style'); style.textContent = css; document.head.append(style);
    const appearanceStyle = element('style'); document.head.append(appearanceStyle); updateAppearance();
    return { update, targetReceived, prepareDeclare, declareReceived, flushHistory, cardFor: node => { const tile = node.closest?.('.dblite-fan-card'); return tile && proxies.get(tile); },
      openPile: zone => {
        if (!zones[zone] || !nativeReady() || sequence || wizard || panel || moving || settingsPanel || opponentRequest ||
            (window.viewing && !zones[window.viewing])) return false;
        closeMenu(); openPile(zone); return true;
      },
      togglePile: zone => {
        if (!zones[zone] || !nativeReady() || sequence || wizard || panel || moving || settingsPanel || opponentRequest) return;
        closeMenu();
        if (window.viewing === zone) closeViewer(); else openPile(zone);
      },
      busy: () => !!sequence || !!wizard || !!panel || !!moving || !!soloPractice,
      allowsChat: wizardChat,
      // Deck of the current Solo session started from the constructor (other duels use the default deck).
      deckName: () => soloSessionValid() ? soloSession.deckName || null : null,
      closeViewer: () => { if (viewZone() && nativeReady() && !sequence && !wizard) closeViewer(); },
      dragging: active => { dragging = active; fan?.classList.toggle('dblite-fan-dragging', active); if (active) closeMenu(); },
      escape: (typing = false) => { if (deckWheel && !deckWheel.hidden) { closeWheel(true); return true; } if (settingsPanel) { closeSettings(true); return true; } if (moving) { finishMoving(false); return true; } if (sequence || wizard || panel || soloPractice) { cancelAll(); return true; } if (opponentRequest) { closeOpponentRequest(); return true; } if (menu) { closeMenu(); return true; } if (fan && !typing) { closeViewer(); return true; } return false; }
    };
  }
  const css = `
    html.dblite-solo-dealing :is(#view,.dblite-fan,.dblite-classic-switch){visibility:hidden!important;pointer-events:none!important}
    :root{--dblite-motion-fast:140ms;--dblite-motion-card:180ms;--dblite-motion-ease:cubic-bezier(.22,.61,.36,1)}
    .dblite-motion-off{--dblite-motion-fast:0ms;--dblite-motion-card:0ms}
    .dblite-smooth-motion :is(.dblite-menu,.dblite-panel,.dblite-view-settings,.dblite-fan-header,.dblite-classic-switch,#dblite-status){animation:dblite-surface-in var(--dblite-motion-fast) var(--dblite-motion-ease)}
    @keyframes dblite-surface-in{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
    .dblite-native-view,.dblite-macro-view{visibility:hidden!important;pointer-events:none!important}
    .dblite-fan,.dblite-menu,.dblite-panel,.dblite-tools,.dblite-classic-switch{box-sizing:border-box;color:var(--dbt-text);font:13px/1.4 system-ui,sans-serif;color-scheme:inherit}
    .dblite-fan *,.dblite-menu *,.dblite-panel *,.dblite-tools *{box-sizing:border-box}
    .dblite-fan button,.dblite-menu button,.dblite-panel button,.dblite-tools button{font:inherit;cursor:pointer;color:inherit;border:1px solid var(--dbt-line);border-radius:8px;background:var(--dbt-panel-2);padding:7px 11px;transition:transform 100ms ease-out,opacity 100ms ease-out}
    .dblite-fan button:hover,.dblite-menu button:hover,.dblite-panel button:hover,.dblite-tools button:hover{background:var(--dbt-panel-2);border-color:var(--dbt-line)}
    .dblite-fan :focus-visible,.dblite-menu :focus-visible,.dblite-panel :focus-visible,.dblite-tools :focus-visible{outline:2px solid var(--dbt-accent);outline-offset:3px}
    .dblite-view-modes{display:flex;gap:3px}.dblite-view-modes button{font:inherit;cursor:pointer;color:var(--dbt-text);border:1px solid var(--dbt-line);border-radius:7px;background:var(--dbt-panel-2);padding:7px 9px}.dblite-view-modes button:hover{background:var(--dbt-panel-2)}.dblite-view-modes button[aria-pressed="true"]{background:var(--dbt-panel-2);color:var(--dbt-text);border-color:var(--dbt-line)}.dblite-view-modes :focus-visible{outline:2px solid var(--dbt-accent);outline-offset:3px}
    .dblite-classic-switch{position:fixed;z-index:2147483001;display:flex;align-items:center;gap:6px;padding:5px;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:10px;box-shadow:0 5px 16px #0005}
    .dblite-classic-sized{scale:var(--dblite-view-scale);translate:var(--dblite-view-x) var(--dblite-view-y);transform-origin:top left!important}
    .dblite-settings-toggle{font:16px/1 system-ui!important;cursor:pointer;color:var(--dbt-text);border:1px solid var(--dbt-line);border-radius:8px;background:var(--dbt-panel);padding:7px 9px!important}
    .dblite-view-settings{position:fixed;z-index:2147483646;width:300px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box;color:var(--dbt-text);color-scheme:inherit;font:13px/1.4 system-ui;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:12px;padding:16px;box-shadow:0 12px 40px #0009}
    .dblite-view-settings header,.dblite-setting-caption,.dblite-setting-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .dblite-view-settings button{font:inherit;cursor:pointer;color:inherit;border:1px solid var(--dbt-line);border-radius:7px;background:var(--dbt-panel-2);padding:6px 10px}.dblite-view-settings button:hover{background:var(--dbt-panel-2)}.dblite-view-settings button[aria-pressed="true"]{background:var(--dbt-panel-2);color:var(--dbt-text)}
    .dblite-view-settings label{display:block;margin-top:18px}.dblite-view-settings output{color:var(--dbt-text);font-variant-numeric:tabular-nums}.dblite-view-settings input[type="range"]{display:block;box-sizing:border-box;width:100%;margin:12px 0 0;accent-color:var(--dbt-accent);cursor:pointer}.dblite-view-settings p{color:var(--dbt-text);font-size:12px;margin:16px 0}.dblite-view-settings :focus-visible,.dblite-settings-toggle:focus-visible{outline:2px solid var(--dbt-accent);outline-offset:3px}
    .dblite-view-settings .dblite-helper-setting{display:flex;align-items:center;gap:9px;cursor:pointer}.dblite-helper-setting input[type="checkbox"]{width:16px;height:16px;margin:0;accent-color:var(--dbt-accent);cursor:pointer}
    .dblite-fan input,.dblite-panel input,.dblite-panel select{font:inherit;min-width:0;border:1px solid var(--dbt-line);border-radius:7px;background:var(--dbt-input);color:var(--dbt-text);padding:8px}
    .dblite-fan{position:fixed;z-index:2147483001;display:flex;flex-direction:column;max-height:calc(100vh - 32px);width:min(760px,calc(100vw - 32px));transform-origin:top left;pointer-events:none;border:1px solid var(--dbt-line);border-radius:16px;background:color-mix(in srgb,var(--dbt-panel) calc(var(--dblite-window-opacity,.68) * 100%),transparent);box-shadow:0 14px 35px #0006;filter:drop-shadow(0 15px 28px #0009);transition:opacity var(--dblite-motion-fast) ease-out}
    .dblite-fan.dblite-view-peek{background:transparent;border-color:transparent;box-shadow:none}
    .dblite-fan-header{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;margin:0 auto 14px;padding:9px 12px;width:fit-content;max-width:100%;flex-shrink:0;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:12px;pointer-events:auto;box-shadow:0 5px 16px #0005;cursor:grab;user-select:none}
    .dblite-fan .dblite-move{cursor:grab;padding:5px 7px;font-size:18px;line-height:1}.dblite-view-moving,.dblite-view-moving .dblite-fan-header,.dblite-view-moving .dblite-move{cursor:grabbing}
    .dblite-fan-header strong{white-space:nowrap}.dblite-count{font-size:11px;color:var(--dbt-muted);white-space:nowrap}.dblite-fan-header input{width:190px;flex:1 1 0;min-width:90px;max-width:190px}
    .dblite-fan-resize{position:absolute;z-index:4;pointer-events:auto;touch-action:none}
    html.dblite-native-menu-open :is(.dblite-classic-switch,.dblite-tools,.dblite-deck-wheel){opacity:0!important;pointer-events:none!important}
    html.dblite-zone-pick :is(.dblite-fan,.dblite-classic-switch,#view){opacity:0!important;pointer-events:none!important}
    .dblite-fan-resize[data-edge=e]{top:18px;bottom:18px;right:0;width:6px;cursor:ew-resize}
    .dblite-fan-resize[data-edge=s]{left:18px;right:18px;bottom:0;height:6px;cursor:ns-resize}
    .dblite-fan-resize[data-edge=se]{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 55%,var(--dbt-panel) 56%,var(--dbt-panel) 64%,transparent 65%,transparent 75%,var(--dbt-panel) 76%,var(--dbt-panel) 84%,transparent 85%);border-bottom-right-radius:14px}
    .dblite-fan.dblite-fan-sized .dblite-fan-cards{max-height:none;flex:1 1 auto}
    .dblite-fan-cards{min-height:0;max-height:55vh;overflow-y:auto;overflow-x:hidden;padding:22px 18px 30px;pointer-events:auto;scrollbar-width:thin;scrollbar-color:var(--dbt-line) var(--dbt-line)}
    .dblite-fan-row{display:flex;justify-content:center;align-items:flex-start;padding:4px 10px 0;position:relative;height:194px;min-height:194px;box-sizing:border-box}
    .dblite-sorted{max-height:none;padding-top:18px;padding-bottom:16px}
    .dblite-grid-sorted .dblite-fan-row.dblite-group-start{margin-top:8px;padding-top:8px;border-top:1px solid var(--dbt-line)}
    .dblite-sorted .dblite-fan-row{padding-top:0;z-index:var(--row-index)}
    .dblite-sorted .dblite-fan-row{height:178px;min-height:178px}
    .dblite-sorted .dblite-category-start{margin-left:calc(124px - var(--card-step))}
    .dblite-sorted .dblite-fan-row:has(.dblite-fan-card:hover),.dblite-sorted .dblite-fan-row:focus-within{z-index:101}
    .dblite-sorted .dblite-fan-row:has(.dblite-targeted,.dblite-declaring){z-index:102}
    .dblite-fan-card.dblite-declaring{z-index:103}
    .dblite-sorted .dblite-fan-card{margin-right:calc(var(--card-step) - 100px);transition:none}
    .dblite-fan-row[style*="--fan-step"]>.dblite-fan-card{margin-right:calc(var(--fan-step) - 100px)}
    .dblite-sorted .dblite-fan-card:last-child{margin-right:0}
    .dblite-view-settings select{display:block;width:100%;margin-top:8px;padding:7px 9px;border:1px solid var(--dbt-line);border-radius:7px;background:var(--dbt-input);color:var(--dbt-text);font:inherit}
    .dblite-view-settings .dblite-layout-help{margin:8px 0 0}
    .dblite-fan .dblite-sort[aria-pressed="true"]{background:var(--dbt-accent);color:var(--dbt-on-accent);border-color:var(--dbt-accent)}.dblite-fan .dblite-sort[hidden]{display:none}
    .dblite-fan-card{position:relative;flex:0 1 100px;min-width:0;width:100px;margin-right:-48px;transform:translateY(var(--arc)) rotate(var(--angle));transform-origin:50% 100%;z-index:var(--index);cursor:grab;outline-offset:5px;transition:transform 100ms ease-out,opacity 100ms ease-out}
    .dblite-observer .dblite-fan-card{cursor:default}
    .dblite-fan-card:last-child{margin-right:0}.dblite-fan-card:hover,.dblite-fan-card:focus-visible{z-index:99!important;transform:translateY(-12px) rotate(0) scale(1.06);filter:drop-shadow(0 6px 10px #0008)}
    .dblite-fan-card.dblite-targeted{z-index:100!important}
    .dblite-target-ring{position:absolute;left:-5px;top:-5px;width:112px;height:157px;box-sizing:border-box;border:3px solid var(--dblite-target-color);border-radius:9px;box-shadow:0 0 0 2px var(--dbt-line),0 0 14px var(--dblite-target-color);pointer-events:none;animation:dblite-target-pulse .6s ease-in-out 2}
    .dblite-target-label{position:absolute;left:50%;top:-24px;transform:translateX(-50%);padding:3px 7px;border-radius:5px;background:var(--dbt-panel);color:var(--dblite-target-color);font:bold 11px/1.2 system-ui;white-space:nowrap}
    @keyframes dblite-target-pulse{0%,100%{opacity:1}50%{opacity:.7}}
    .dblite-fan-face{width:100px;height:145px;position:relative;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:5px;overflow:hidden;pointer-events:none}
    .dblite-fan-face:empty{visibility:hidden}
    .dblite-fan-face>.card{display:block!important;position:absolute!important;width:400px!important;height:580px!important;left:0!important;top:0!important;transform:scale(.25)!important;transform-origin:top left!important;opacity:1!important;visibility:visible!important;pointer-events:none!important}
    /* Native absolute positioning is scoped to #content. The fan lives on the
       body, so give only its cloned card layers that same layout context. */
    .dblite-fan-face>.card :is(div,span,img,input,select,textarea,svg){position:absolute;box-sizing:content-box}
    .dblite-fan-face>.card>.content{left:0!important;top:0!important;width:400px!important;height:580px!important;transform:none!important;transform-origin:top left!important}
    .dblite-fan-face>.card>.content>.white{display:none!important}
    .dblite-fan-face>.card.face_down .cardfront{clip-path:polygon(0% 100%,0% 0%,100% 0%,100% 0%);display:block!important}
    .dblite-fan-face *{pointer-events:none!important}.dblite-fan-name{display:none;position:absolute;left:0;right:0;top:148px;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:5px;padding:4px;font-size:10px;text-align:center;max-height:32px;overflow:hidden;pointer-events:none}
    .dblite-fan-card:hover .dblite-fan-name,.dblite-fan-card:focus-visible .dblite-fan-name{display:block}
    .dblite-grid .dblite-fan-row{gap:10px;padding-bottom:16px;min-height:178px}.dblite-grid .dblite-fan-card{flex:0 0 100px;margin:0}.dblite-grid .dblite-fan-name{display:block}
    .dblite-fan footer{margin:0 auto;width:fit-content;flex-shrink:0;border-radius:8px;background:var(--dbt-panel);padding:6px 12px;font-size:11px;color:var(--dbt-text);text-align:center}
    .dblite-fan footer[hidden]{display:none!important}
    .dblite-peek-toggle{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px}.dblite-peek-toggle svg{width:18px;height:18px}
    .dblite-view-peek{opacity:.08!important;pointer-events:none!important;filter:none!important}.dblite-view-peek *{pointer-events:none!important}
        /* Touch screens: the viewer covers most of a phone, so it gets out of the way entirely while a card is dragged out. */
    html.dbetter-touch .dblite-fan-dragging{opacity:0}
    .dblite-fan-dragging{opacity:.18;pointer-events:none!important}.dblite-fan-dragging *{pointer-events:none!important}
    .dblite-empty{padding:24px;text-align:center;background:var(--dbt-panel);border-radius:10px}
    .dblite-menu{position:fixed;z-index:2147483645;width:238px;max-height:75vh;overflow:auto;background:var(--dbt-panel);border:1px solid var(--dbt-line);box-shadow:0 12px 40px #0009;border-radius:12px;padding:8px}
    .dblite-menu strong{display:block;padding:7px 8px 12px;font-size:12px}.dblite-menu button{display:block;width:100%;text-align:left;border-color:transparent;background:transparent;margin:1px 0;padding:6px 9px}
    .dblite-menu button.dblite-position-action{background:var(--dbt-panel-2);color:var(--dbt-text);border-color:var(--dbt-line);font-weight:600}
    .dblite-menu button.dblite-card-effect{background:var(--dbt-panel-2);color:var(--dbt-text);border-left:3px solid var(--dbt-line)}
    .dblite-menu button.dblite-position-action:hover,.dblite-menu button.dblite-position-action:focus-visible{background:var(--dbt-panel-2);border-color:var(--dbt-line)}
    .dblite-menu button.dblite-card-effect:hover,.dblite-menu button.dblite-card-effect:focus-visible{background:var(--dbt-panel-2);border-color:var(--dbt-line)}
    .dblite-tools{position:fixed;z-index:2147483000;width:102px;height:60px;display:flex;align-items:center;gap:8px;transform-origin:center}
    .dblite-tools *{position:static}
    .dblite-tools[hidden],.dblite-deck-wheel[hidden]{display:none!important}
    .dblite-tools .dblite-draw{display:flex;align-items:center;justify-content:center;flex:0 0 60px;width:60px;height:60px;padding:0;border-radius:10px;font-size:16px;line-height:20px;background:var(--dbt-panel);color:var(--dbt-text);border-color:var(--dbt-line);font-weight:700;box-shadow:0 3px 9px #0004}
    .dblite-tools .dblite-draw:hover{background:var(--dbt-panel-2);border-color:var(--dbt-line)}
    .dblite-tools button:disabled,.dblite-deck-wheel button:disabled{opacity:.45;cursor:default}
    .dblite-tools .dblite-wheel-toggle{flex:0 0 34px;width:34px;height:34px;padding:5px;border-radius:50%;background:var(--dbt-panel);box-shadow:0 2px 7px #0005}
    .dblite-wheel-toggle svg{display:block;width:22px;height:22px;fill:none;stroke:var(--dbt-accent);stroke-width:2;stroke-linecap:round}
    .dblite-wheel-toggle[aria-expanded="true"]{outline:2px solid var(--dbt-accent);outline-offset:2px}
    .dblite-deck-wheel{position:fixed;z-index:2147483003;width:188px;height:188px;box-sizing:border-box;color:var(--dbt-text);color-scheme:inherit;font:13px/1.3 system-ui,sans-serif;filter:drop-shadow(0 8px 16px #0007);animation:dblite-wheel-in var(--dblite-motion-fast,140ms) ease-out}
    .dblite-deck-wheel *{box-sizing:border-box;position:static}
    .dblite-tools-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
    .dblite-tools-items button{display:flex;flex-direction:column;align-items:center;justify-content:center;width:92px;height:92px;padding:0 6px;border:1px solid var(--dbt-line);background:var(--dbt-panel-2);color:inherit;font:600 12px/17px system-ui,sans-serif;cursor:pointer}
    .dblite-tools-items button:nth-child(1){border-radius:92px 8px 12px 8px;padding:14px 0 0 12px}.dblite-tools-items button:nth-child(2){border-radius:8px 92px 8px 12px;padding:14px 12px 0 0}.dblite-tools-items button:nth-child(3){border-radius:8px 12px 8px 92px;padding:0 0 14px 12px}.dblite-tools-items button:nth-child(4){border-radius:12px 8px 92px 8px;padding:0 12px 14px 0}
    .dblite-deck-wheel .dblite-wheel-close{position:absolute;left:76px;top:76px;width:36px;height:36px;padding:0;border:1px solid var(--dbt-line);border-radius:50%;background:var(--dbt-panel);color:var(--dbt-text);font:22px/34px system-ui;cursor:pointer}
    .dblite-deck-wheel button:hover{background:var(--dbt-panel-2);border-color:var(--dbt-line)}
    .dblite-deck-wheel button:focus-visible{outline:2px solid var(--dbt-accent);outline-offset:-4px}
    @keyframes dblite-wheel-in{from{opacity:0;scale:.85}to{opacity:1;scale:1}}
    @media(prefers-reduced-motion:reduce){.dblite-deck-wheel{animation:none}}
    /* Three native control groups occupy the gaps between the card zones.
       Keep native display, click handlers and pointer-event eligibility. */
    #duel.dblite-duel-layout{--dblite-phase-left:344px;--dblite-phase-right:390px;--dblite-notice-left:574px;--dblite-notice-width:126px;--dblite-turn-left:344px;--dblite-lp-left:622px;--dblite-lp-scale:.48}
    #duel.dblite-layout-links{--dblite-phase-left:282px;--dblite-phase-right:328px;--dblite-notice-left:662px;--dblite-notice-width:100px;--dblite-turn-left:282px;--dblite-lp-left:710px;--dblite-lp-scale:.42}
    #duel.dblite-layout-observer{--dblite-phase-left:477px;--dblite-phase-right:522px;--dblite-notice-left:344px;--dblite-notice-width:125px;--dblite-turn-left:477px}
    #duel.dblite-layout-links.dblite-layout-observer{--dblite-notice-left:282px;--dblite-notice-width:92px}
    #duel.dblite-duel-layout .phase{width:42px!important;height:20px!important;scale:1;transform-origin:50% 50%!important;border-radius:5px;background:var(--dbt-panel);box-shadow:inset 0 0 0 1px var(--dbt-line)}
    #duel.dblite-duel-layout :is(#dp,#m1,#m2){left:var(--dblite-phase-left)!important}
    #duel.dblite-duel-layout :is(#sp,#bp,#ep){left:var(--dblite-phase-right)!important}
    #duel.dblite-duel-layout :is(#dp,#sp){top:248px!important}
    #duel.dblite-duel-layout :is(#m1,#bp){top:272px!important}
    #duel.dblite-duel-layout :is(#m2,#ep){top:296px!important}
    #duel.dblite-duel-layout .phase .background{display:none}
    #duel.dblite-duel-layout .phase .phase_inner{inset:1px;width:auto;height:auto;border-radius:4px;pointer-events:none}
    #duel.dblite-duel-layout .phase .phase_inner.red{background:var(--dbt-panel)}
    #duel.dblite-duel-layout .phase .phase_inner.blue{background:var(--dbt-panel)}
    #duel.dblite-duel-layout .phase.active{box-shadow:0 0 0 2px var(--dbt-line),0 0 10px var(--dbt-line)}
    #duel.dblite-duel-layout .phase.active .phase_inner.red{background:var(--dbt-panel)}
    #duel.dblite-duel-layout .phase.active .phase_inner.blue{background:var(--dbt-panel)}
    #duel.dblite-duel-layout .phase span{left:0;top:0;width:100%;height:20px;padding:0;color:var(--dbt-text);font:600 11px/20px 'Segoe UI',Arial,sans-serif;pointer-events:none;text-shadow:none}
    #duel.dblite-duel-layout .phase.active .phase_txt{color:var(--dbt-text);font-weight:800;text-decoration:underline;text-underline-offset:3px}
    #duel.dblite-duel-layout .phase:hover{outline:1px solid var(--dbt-accent);outline-offset:1px}
    #duel.dblite-duel-layout :is(#die_btn,#coin_btn,.token_btn,#counter_btn){width:34px!important;height:27px!important;border-radius:5px;background:var(--dbt-panel);box-shadow:inset 0 0 0 1px var(--dbt-line)}
    #duel.dblite-duel-layout :is(#die_btn,.token_btn){left:480px!important}
    #duel.dblite-duel-layout :is(#coin_btn,#counter_btn){left:526px!important}
    #duel.dblite-duel-layout :is(#die_btn,#coin_btn){top:248px!important}
    #duel.dblite-duel-layout :is(.token_btn,#counter_btn){top:278px!important}
    #duel.dblite-duel-layout :is(#die_btn,#coin_btn,.token_btn)>img{left:6px;top:3px;width:22px;height:21px;object-fit:contain}
    #duel.dblite-duel-layout #counter_btn>.content{left:4px;top:2px;width:26px;height:23px;transform:none}
    #duel.dblite-duel-layout #counter_btn img{left:0;top:0;width:26px;height:23px}
    #duel.dblite-duel-layout #lp_txt{left:477px!important;top:316px!important;font:600 11px/16px Arial,sans-serif!important}
    #duel.dblite-duel-layout :is(#life_txt,#life_txt+.textinput){left:497px!important;top:313px!important;width:39px!important;height:21px!important;box-sizing:border-box;font-size:12px}
    #duel.dblite-duel-layout :is(#plus_btn,#minus_btn){left:541px!important;top:313px!important;width:21px!important;height:21px!important;transform:none!important}
    #duel.dblite-duel-layout #minus_bg{left:538px!important;top:310px!important;width:27px;height:27px}
    #duel.dblite-duel-layout :is(#turn,#start_turn,#end_turn){left:var(--dblite-turn-left)!important;top:322px!important;width:88px;height:16px;border-radius:5px;background:var(--dbt-panel);box-shadow:inset 0 0 0 1px var(--dbt-line)}
    #duel.dblite-duel-layout :is(#turn,#start_turn,#end_turn)>div{left:1px;top:1px;width:86px;height:14px;border-radius:4px}
    #duel.dblite-duel-layout :is(#turn,#start_turn,#end_turn) :is(.background,.white_glow){display:none!important}
    #duel.dblite-duel-layout :is(#turn,#start_turn,#end_turn)>span{left:0;top:0;width:100%;height:16px;font:600 9px/16px 'Segoe UI',Arial,sans-serif;pointer-events:none;text-shadow:0 1px 2px #0008}
    .dblite-action-history{position:absolute;z-index:3;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border:1px solid color-mix(in srgb,var(--dblite-target-color) 54%,var(--dbt-line));border-top:3px solid var(--dblite-target-color);border-radius:9px;background:var(--dbt-panel);color:var(--dbt-text);font:12px/1.35 'Segoe UI',Arial,sans-serif;pointer-events:auto;text-align:left;box-shadow:0 3px 12px #0002}
    .dblite-action-history[hidden],.dblite-history-latest[hidden]{display:none!important}
    .dblite-action-history *{box-sizing:border-box;position:static!important;white-space:normal}
    .dblite-history-heading{display:flex;align-items:center;justify-content:space-between;gap:5px;flex:0 0 23px;padding:2px 7px;color:var(--dblite-target-color);font-size:9px;line-height:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid var(--dbt-line)}
    .dblite-action-history[data-player="2"] .dblite-history-heading{order:2;border-bottom:0;border-top:1px solid var(--dbt-line)}
    .dblite-history-signal{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;width:100%;font:600 11px/17px 'Segoe UI',Arial,sans-serif;text-transform:none;letter-spacing:0;color:var(--dbt-text);pointer-events:none}
    .dblite-history-signal[data-kind="okay"]{color:var(--dbt-text)}
    .dblite-history-signal img{flex:0 0 18px;width:18px!important;height:17px!important;object-fit:contain}
    .dblite-history-signal>span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dblite-history-signal[hidden],.dblite-history-signal img[hidden],.dblite-history-heading:has(.dblite-history-signal:not([hidden])) .dblite-history-caption{display:none!important}
    #duel .dblite-history-signal-source,#duel .dblite-history-signal-source *{visibility:hidden!important;pointer-events:none!important}
    .dblite-history-list{flex:1;min-height:0;width:100%;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dblite-target-color) transparent;outline-offset:-2px}
    .dblite-history-list:focus-visible{outline:1px solid var(--dblite-target-color)}
    .dblite-target-notice{display:block;padding:2px 6px;border-bottom:1px solid var(--dbt-line)}
    .dblite-action-heading,.dblite-action-details{display:flex;align-items:baseline;gap:4px;min-width:0}
    .dblite-action-heading{height:13px;line-height:13px}.dblite-action-details{height:10px;line-height:10px}
    .dblite-action-history :is(.dblite-action-verb,.dblite-target-name,.dblite-target-zone){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dblite-action-verb{flex:0 1 auto;max-width:58%;color:var(--dblite-target-color);font-size:9px;font-weight:600}
    .dblite-action-history .dblite-target-name{display:block;flex:1;border:0;border-radius:2px;background:none;padding:0;margin:0;font:600 10px/13px 'Segoe UI',Arial,sans-serif;color:var(--dbt-text);text-align:left;box-shadow:none;text-shadow:none}
    .dblite-action-history button.dblite-target-name{cursor:help}
    .dblite-action-history button.dblite-target-name:is(:hover,:focus-visible){color:var(--dbt-text);text-decoration:underline;text-decoration-color:var(--dblite-target-color);text-underline-offset:2px}
    .dblite-action-history button.dblite-target-name:focus-visible{outline:1px solid var(--dblite-target-color);outline-offset:-1px}
    .dblite-target-zone{flex:1;font-size:6.5px;color:var(--dbt-muted)}
    .dblite-action-history .dblite-action-time{flex:0 0 auto;margin-left:auto;color:var(--dbt-muted);font-size:8px;line-height:10px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .dblite-history-latest{flex:0 0 auto;width:100%;border:0;border-top:1px solid var(--dbt-line);border-radius:0;padding:2px;background:var(--dbt-panel);color:var(--dblite-target-color);font:600 9px 'Segoe UI',Arial,sans-serif;cursor:pointer}
    #duel .dblite-history-profile{translate:var(--dblite-profile-shift) var(--dblite-profile-y,0px);scale:var(--dblite-profile-scale);transform-origin:top left!important}
    #duel.dblite-history-layout>.cout_txt{top:212px!important;height:181px!important;max-width:calc(var(--dblite-history-width) - 9px)!important;font-size:11px;line-height:1.15}
    #duel.dblite-history-layout :is(.cin_txt,.cin_txt+.textinput){top:406px!important;max-width:calc(var(--dblite-history-width) - 20px)!important;box-sizing:border-box}
    #duel.dblite-history-layout .refresh_btn{top:214px!important;left:calc(843px + var(--dblite-history-width) - 16px)!important}
    #duel.dblite-history-layout .html_cb{top:408px!important;left:calc(843px + var(--dblite-history-width) - 21px)!important}
    #duel .dblite-field-status{position:absolute;left:574px;top:248px;width:126px;height:40px;pointer-events:none;z-index:auto}
    #duel.dblite-layout-links .dblite-field-status{left:662px;width:100px}
    #duel .dblite-field-status[data-player="1"]{top:297px}
    #duel .dblite-field-status[hidden]{display:none!important}
    #duel .dblite-field-signal{position:relative;font-size:9px;line-height:10px;height:25px;gap:3px;padding:2px;border:1px solid color-mix(in srgb,var(--dblite-target-color) 40%,transparent);border-radius:4px;background:var(--dbt-panel);box-sizing:border-box}
    #duel .dblite-field-signal>*{position:static}
    #duel .dblite-field-signal>span{flex:1;white-space:normal;overflow-wrap:anywhere;max-height:19px;overflow:hidden;line-height:1.1;text-align:center}
    #duel .dblite-field-signal>span>.dblite-field-card-name,#duel .dblite-field-signal>span>.dblite-field-zone{position:static;display:block;white-space:normal;overflow-wrap:anywhere}
    #duel .dblite-field-signal>span>.dblite-field-zone{font-size:.65em;line-height:1.05;color:var(--dbt-muted)}
    #duel .dblite-field-signal .dblite-field-separator{display:none}
    #duel .dblite-field-signal[data-kind="declared"]{color:var(--dbt-text);font-size:8px;line-height:9px;border-color:var(--dblite-target-color)}
    #duel .dblite-field-signal[data-kind="idle"]{color:var(--dbt-text)}
    #duel .dblite-field-signal>.dblite-field-action-glow{position:absolute;inset:-1px;display:block;box-sizing:border-box;pointer-events:none;border:1px solid var(--dblite-action-color);border-radius:inherit;box-shadow:0 0 8px color-mix(in srgb,var(--dblite-action-color) 60%,transparent),inset 0 0 5px color-mix(in srgb,var(--dblite-action-color) 20%,transparent);animation:dblite-field-action-glow 1.2s ease-out both}
    #duel .dblite-field-action-glow::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(110deg,transparent 25%,color-mix(in srgb,var(--dblite-action-color) 28%,transparent) 49%,transparent 73%);background-size:300% 100%;animation:dblite-field-action-sweep .8s ease-out both}
    @keyframes dblite-field-action-glow{0%{opacity:0}15%,45%{opacity:1}100%{opacity:0}}
    @keyframes dblite-field-action-sweep{0%{background-position:130% 0;opacity:0}20%{opacity:1}100%{background-position:-30% 0;opacity:0}}
    @media(prefers-reduced-motion:reduce){#duel .dblite-field-signal>.dblite-field-action-glow{display:none}}
    .dblite-action-history .dblite-turn-divider{position:sticky!important;top:0;z-index:1;background:var(--dbt-panel);color:var(--dbt-text);border-top:2px solid var(--dblite-target-color);border-bottom:1px solid var(--dbt-line);padding:3px 5px;font:700 9px/12px 'Segoe UI',sans-serif}
    .dblite-history-turn{display:block}

    #duel .dblite-field-signal img{width:16px!important;height:16px!important;flex-basis:16px}
    #duel .dblite-viewing-eye{position:absolute;left:0;top:26px;width:46px;height:13px;box-sizing:border-box;display:flex;align-items:center;gap:2px;padding:0 2px;border:1px solid color-mix(in srgb,var(--dblite-target-color) 35%,transparent);border-radius:4px;background:var(--dbt-panel);color:var(--dblite-target-color);opacity:.35;pointer-events:auto}
    #duel .dblite-viewing-eye svg{position:static;flex:0 0 13px;width:13px;height:11px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    #duel .dblite-viewing-eye .pupil{fill:currentColor;stroke:none}
    #duel .dblite-viewing-eye.is-viewing{opacity:1;filter:drop-shadow(0 0 3px color-mix(in srgb,var(--dblite-target-color) 55%,transparent))}
    #duel .dblite-viewing-eye span{position:static;width:auto;white-space:nowrap;font:700 6px/10px 'Segoe UI',sans-serif}
    #duel .dblite-viewing-eye .dblite-eye-opp{top:-1px}
    #duel .dblite-viewing-eye .dblite-eye-zone{bottom:0}
    #duel .dblite-viewing-eye span:empty,#duel .dblite-viewing-eye [hidden]{display:none!important}
    #duel .dblite-viewing-source{visibility:hidden!important}
    .dblite-card-target{position:absolute;left:50%;top:50%;translate:-50% -50%;z-index:2147483645;display:block;width:35%;aspect-ratio:1;background:transparent;border:0;color:var(--dblite-target-color);pointer-events:none;filter:drop-shadow(0 1px 1px #000) drop-shadow(0 0 1px #fff9)}
    .dblite-card-target>svg{position:static;display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round}
    .dblite-profile-versus{position:absolute;z-index:3;display:flex;align-items:center;justify-content:center;gap:7px;pointer-events:none;color:var(--dbt-text);font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:.12em;text-shadow:0 1px 3px #0008}
    .dblite-profile-versus::before,.dblite-profile-versus::after{content:'';width:16px;height:1px;background:var(--dbt-panel)}
    #duel .dblite-declare-banner{position:absolute;left:265px;top:32px;width:310px;z-index:100001;pointer-events:none;padding:10px 15px;border:2px solid var(--declare-actor);border-radius:9px;background:var(--dbt-panel);color:var(--dbt-text);box-shadow:0 0 24px color-mix(in srgb,var(--declare-actor) 45%,transparent);text-align:center;animation:dblite-declare-banner .22s ease-out both}
    #duel .dblite-declare-banner>*{position:static;display:block}#duel .dblite-declare-banner small{font:800 11px/16px 'Segoe UI',sans-serif;color:var(--declare-actor);letter-spacing:.1em}#duel .dblite-declare-banner strong{font:700 17px/22px 'Segoe UI',sans-serif}
    @keyframes dblite-declare-banner{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
    @media(prefers-reduced-motion:reduce){#duel .dblite-declare-banner{animation:none}}
    .dblite-native-declare,.dblite-native-declare *{visibility:hidden!important}
    .dblite-declare-glow{position:absolute;left:0;top:0;z-index:2147483646;pointer-events:none;box-sizing:border-box;border:var(--dblite-declare-stroke,3px) solid var(--dblite-declare-color);border-radius:var(--dblite-declare-radius,4px);box-shadow:0 0 var(--dblite-declare-blur,16px) color-mix(in srgb,var(--dblite-declare-color) 75%,transparent),inset 0 0 var(--dblite-declare-blur,16px) color-mix(in srgb,var(--dblite-declare-color) 25%,transparent);animation:dblite-declare-in 1.9s cubic-bezier(.22,.61,.36,1) both}
    .dblite-declare-glow::before{content:"";position:absolute;inset:0;border:var(--dblite-declare-stroke,3px) solid var(--dblite-declare-color);border-radius:inherit;pointer-events:none;animation:dblite-declare-ring .9s ease-out both}
    .dblite-pendulum-glow,.dblite-pendulum-glow::before{border-image:linear-gradient(to bottom,var(--dblite-declare-color) 40%,var(--dblite-declare-secondary) 60%) 1}
    .dblite-declare-glow::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(110deg,transparent 35%,#ffffff55 48%,#ffffff88 50%,transparent 63%);background-size:250% 100%;animation:dblite-declare-sheen .85s ease-out both}
    .dblite-declare-spark{position:absolute;width:calc(2 * var(--dblite-declare-px,1px));height:calc(2 * var(--dblite-declare-px,1px));border-radius:50%;background:var(--dblite-declare-color);box-shadow:0 0 calc(5 * var(--dblite-declare-px,1px)) var(--dblite-declare-color);pointer-events:none;animation:dblite-declare-spark .95s ease-out both}
    @keyframes dblite-declare-spark{0%{opacity:0;translate:-50% -50%;scale:.4}18%{opacity:1;scale:1}75%{opacity:.65}100%{opacity:0;translate:calc(-50% + var(--spark-x)) calc(-50% + var(--spark-y));scale:.2}}
    @keyframes dblite-declare-in{0%{opacity:0}10%,72%{opacity:1}100%{opacity:0}}
    @keyframes dblite-declare-ring{0%{opacity:.75;scale:1}100%{opacity:0;scale:1.08}}
    @keyframes dblite-declare-sheen{0%{opacity:0;background-position:160% 0}15%{opacity:.8}85%{opacity:.6}100%{opacity:0;background-position:-60% 0}}
    @keyframes dblite-notice-in{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
    @keyframes dblite-notice-out{from{opacity:1}to{opacity:0}}
    #duel.dblite-constructor-solo :is(#reset_btn,#reset_btn+.button.proxy){display:none!important}
    #duel .dblite-solo-session{position:absolute;left:105px;top:565px;width:98px;display:flex;flex-direction:column;gap:3px;z-index:2}
    #duel .dblite-solo-session button{position:static;width:98px;height:22px;box-sizing:border-box;padding:0;border:1px solid var(--dbt-line);border-radius:4px;background:var(--dbt-panel-2);color:var(--dbt-text);font:11px system-ui;cursor:pointer}
    #duel .dblite-solo-session button:disabled{opacity:.45;cursor:wait}
    /* DuelingBook positions every div in #duel absolutely: the row stays in the column's flow. */
    #duel .dblite-solo-session .dblite-solo-reset-row{position:static!important;display:flex;gap:3px;width:98px;height:22px}
    #duel .dblite-solo-session .dblite-solo-reset-row button{flex:1;width:auto;min-width:0}
    #duel .dblite-solo-session .dblite-solo-reset-row .dblite-solo-same{flex:0 0 24px;font-size:14px;line-height:20px}
    #duel .dblite-solo-session [hidden]{display:none}
    #duel.dblite-same-hand-native #reset_btn{width:71px!important}
    #duel.dblite-same-hand-native #reset_btn+.button.proxy{width:69px!important;overflow:hidden;white-space:nowrap}
    #duel .dblite-solo-same-native{position:absolute;left:179px;top:565px;width:24px;height:22px;box-sizing:border-box;padding:0;border:1px solid var(--dbt-line);border-radius:4px;background:var(--dbt-panel-2);color:var(--dbt-text);font:14px/20px system-ui;cursor:pointer;z-index:2}
    #duel .dblite-solo-same-native:disabled{opacity:.45;cursor:wait}
    .dblite-panel{color:var(--dbt-text);position:fixed;z-index:2147483644;right:20px;top:24px;width:min(420px,calc(100vw - 40px));max-height:calc(100vh - 48px);overflow:auto;background:var(--dbt-panel);border:1px solid var(--dbt-line);border-radius:14px;padding:20px;box-shadow:0 20px 80px #000a}
    .dblite-panel.dblite-batch-panel{left:50%;top:50%;right:auto;transform:translate(-50%,-50%);width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 32px)}
    .dblite-batch-panel .dblite-amount{width:100%;font-size:26px;text-align:center;padding:9px}.dblite-amount-presets{display:flex;gap:6px;margin:10px 0}.dblite-amount-presets button{flex:1;margin:0;padding:7px 5px}.dblite-amount-presets button[aria-pressed="true"]{background:var(--dbt-accent);color:var(--dbt-on-accent);border-color:var(--dbt-accent)}.dblite-amount-hint{font-size:12px;color:var(--dbt-muted);margin:10px 0}
    .dblite-panel header{display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:17px}.dblite-panel .dblite-close{padding:2px 8px}.dblite-help{color:var(--dbt-muted);font-size:13px;margin:14px 0 18px}.dblite-panel button{margin:4px 5px 4px 0}.dblite-panel .dblite-primary{background:var(--dbt-accent);color:var(--dbt-on-accent);border-color:var(--dbt-accent);font-weight:650}.dblite-panel label{display:block;margin:10px 0}.dblite-panel select{display:block;width:100%;margin-top:5px}.dblite-error{color:var(--dbt-text);font-size:12px}.dblite-progress{font-size:12px;color:var(--dbt-text)}.dblite-choice{border-top:1px solid var(--dbt-line);padding:12px 0}.dblite-choice span{display:block}.dblite-tools button:disabled,.dblite-panel button:disabled{opacity:.45;cursor:default}
    .dblite-opponent-choice>strong{font-size:17px}.dblite-opponent-choice[hidden]{display:none!important}.dblite-opponent-choice>.dblite-primary{min-width:54px;white-space:normal;text-align:left}.dblite-manual-choice{border-top:1px solid var(--dbt-line);padding-top:12px}.dblite-manual-choice summary{cursor:pointer;color:var(--dbt-text)}.dblite-manual-choice .dblite-help{font-size:12px}
    .dblite-motion-off :is(.dblite-target-ring,.dblite-target-notice){animation:none}
    .dblite-declare-off .dblite-declare-glow{display:none}
    @media(prefers-reduced-motion:reduce){
      .dblite-declare-glow{animation:none;scale:1;box-shadow:none}
      .dblite-declare-glow::before,.dblite-declare-glow::after,.dblite-declare-spark{display:none}
      :root{--dblite-motion-fast:0ms;--dblite-motion-card:0ms}
      .dblite-smooth-motion :is(.dblite-menu,.dblite-panel,.dblite-view-settings,.dblite-fan-header,.dblite-classic-switch,#dblite-status),.dblite-target-ring,.dblite-target-notice{animation:none}
      .dblite-fan-card:hover,.dblite-fan-card:focus-visible{transform:translateY(var(--arc)) rotate(var(--angle))}
    }
    @media(max-width:620px){.dblite-fan-header{gap:5px;padding:7px;flex-wrap:wrap;justify-content:center}.dblite-fan-header input{width:105px}.dblite-fan footer{font-size:10px}.dblite-panel{right:12px;width:calc(100vw - 24px)}}
  `;
})();

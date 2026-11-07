/* DBETTER, GPL-3.0-only. See NOTICE.txt. */
(function (root) {
  'use strict';
  const defaults = Object.freeze({ animations: true, sounds: true, replay: true, drag: true, doubleClick: true, declare: true, normalSummon: true, fan: true, contextMenu: true, quickActions: true, shortcuts: true, handHover: true, pileHover: true, autoRps: true, skipIntro: true, hideDeclarationChat: true, dragDefense: true, dragSet: true, dropWheel: true, dragReveal: true, dragAttack: true, doubleClickPiles: true, doubleClickSet: true, signalKeys: true, zoneKeys: true, cardKeys: true, sortKey: true, peekKey: true, quickButtons: true, cardMacros: true, cardMotion: true, declareGlow: true, replaySpeed: true, replayRewind: true, replayVideo: true, refinedSounds: true, volumeControl: true, adaptiveLayout: true, adaptiveDock: false, adaptiveConstructor: true, hideZoomNotice: true, hideScreenshotButton: true, hideSummonSpiral: true, blockAutoFocus: true, zoneKeysSend: true, previewLinks: true, clickDrop: true, chatWheel: true, touchControls: true, touchLayout: true, touchTapMenu: true, actionHistory: true, duelLayout: true, darkTextBoxes: true, retryLogin: true });
  // Quick chat wheel: up to 8 short messages (each deck can add its own in the constructor).
  const defaultChat = Object.freeze(['gg', 'glhf', 'mc', 'ty', 'gl', 'np', 'wait', 'ok']);
  function chatList(value, fallback = defaultChat) {
    if (!Array.isArray(value)) return [...fallback];
    return [...new Set(value.filter(text => typeof text === 'string').map(text => text.replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);
  }
  const defaultKeys = Object.freeze({ ok: 'a', think: 'z', extra: 'e', deck: 'd', grave: 'c', banished: 'r', hand: 'h', declare: 'q', target: 't', sort: 's', peek: ' ', wheel: 'w' });
  // Keys added after people saved their own: a key someone already uses for another action is not taken from them.
  const newKeys = Object.freeze({ wheel: ['w', 'x', 'v', 'g', 'u', 'y', 'n', 'm'] });
  // 0.6.5 changed the defaults (Q declare, D Deck, T target, R banished, H hand). A saved set that is
  // still exactly the old defaults was never customised, so it follows the new defaults.
  const legacyKeys = { ok: 'a', think: 'z', extra: 'e', deck: 'f', grave: 'c', banished: 'b', declare: 'd', target: 'r', sort: 's', peek: ' ' };
  // One printable character or a named navigation/function key; no chords,
  // control characters, reserved activation keys or modifier/lock keys.
  function validKey(key) {
    if (typeof key !== 'string') return false;
    return key === ' ' || /^[^\p{C}\p{Z}]$/u.test(key.toLowerCase()) ||
      /^(?:arrow(?:up|down|left|right)|home|end|page(?:up|down)|insert|delete|backspace|f(?:[1-9]|1[0-9]|2[0-4]))$/i.test(key);
  }
  function settings(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    if (value.keys && !value.keys.hand && Object.entries(legacyKeys).every(([action, key]) => String(value.keys[action] ?? '').toLowerCase() === key)) value = { ...value, keys: undefined };
    const keys = Object.fromEntries(Object.entries(defaultKeys).map(([action, fallback]) =>
      [action, validKey(value.keys?.[action]) ? value.keys[action].toLowerCase() : fallback]));
    for (const [action, choices] of Object.entries(newKeys)) if (!validKey(value.keys?.[action])) {
      const taken = Object.entries(keys).filter(([other]) => other !== action).map(([, key]) => key);
      keys[action] = choices.find(key => !taken.includes(key)) || keys[action];
    }
    // Restore every member of a collision. Repeat because restoring a default
    // may collide with another remapping. This converges to unique defaults.
    for (;;) {
      const conflicts = Object.keys(keys).filter(action => Object.values(keys).filter(key => key === keys[action]).length > 1);
      if (!conflicts.length) break;
      conflicts.forEach(action => { keys[action] = defaultKeys[action]; });
    }
    return { ...Object.fromEntries(Object.keys(defaults).map(key => [key,
      typeof value[key] === 'boolean' ? value[key] : defaults[key]])), keys,
      theme: Object.hasOwn(value, 'theme') ? (['night', 'classic', 'abyss', 'ember'].includes(value.theme) ? value.theme : 'night') : value.nightMode === false ? 'classic' : 'night',
      // Compatibility for internal native-page layout branches and older settings senders.
      nightMode: Object.hasOwn(value, 'theme') ? value.theme !== 'classic' : value.nightMode !== false,
      vfxVolume: Number.isFinite(value.vfxVolume) ? Math.max(0, Math.min(100, Math.round(value.vfxVolume))) : 100,
      boardSize: Number.isFinite(value.boardSize) ? Math.max(60, Math.min(100, Math.round(value.boardSize))) : 100,
      chatPresets: chatList(value.chatPresets),
      look: value.look === 'classic' ? 'classic' : 'dbetter', lookSaved: savedLook(value.lookSaved),
      tourSeen: Array.isArray(value.tourSeen) ? tourIds.filter(id => value.tourSeen.includes(id)) : [], tourOff: value.tourOff === true };
  }
  // A page's DBLITE_QUICK message: the switches a duel offers outside the settings (user, 2026-10-29: the position
  // wheel on and off, for laid-back mouse play or keyboard play). Only known settings, as booleans; null when nothing changes.
  const quickKeys = Object.freeze(['dropWheel']);
  function quickPatch(current, message) {
    const config = settings(current), patch = {};
    for (const key of quickKeys) if (typeof message?.[key] === 'boolean' && message[key] !== config[key]) patch[key] = message[key];
    return Object.keys(patch).length ? patch : null;
  }
  // Onboarding (tour.js): the welcome card, then one tip per part. Seen tips and Skip are saved in the settings.
  const tourIds = Object.freeze(['welcome', 'duel', 'viewer', 'replay', 'constructor']);
  // The settings patch for a page's DBLITE_TOUR message: only known tips, Skip and a look. null when nothing changes.
  function tourPatch(current, message) {
    const config = settings(current), patch = {};
    if (tourIds.includes(message?.seen) && !config.tourSeen.includes(message.seen)) patch.tourSeen = tourIds.filter(id => id === message.seen || config.tourSeen.includes(id));
    if (message?.off === true && !config.tourOff) patch.tourOff = true;
    if (['dbetter', 'classic'].includes(message?.look)) Object.assign(patch, lookPatch(current, message.look));
    return Object.keys(patch).length ? patch : null;
  }
  // Classic look (user, 2026-10-28): DuelingBook's own look and layout, keeping DBETTER's quality-of-life features
  // (drag and drop, Find a card, quick chat, shortcuts, the replay timeline, the constructor extras). Choosing it
  // sets these settings and keeps their previous values; the DBETTER look puts those back.
  // The adaptive layout stays: it fits the board to the window and gives the constructor's search the spare width,
  // so the deck keeps its full size (user, 2026-10-28).
  // Dark text boxes are turned off too (user, 2026-11-04: Classic should look like DuelingBook with the extras
  // optional; the dark card text, chat and log boxes stood out). They stay a setting of their own.
  const classicLook = Object.freeze({ theme: 'classic', darkTextBoxes: false, fan: false, animations: false, handHover: false, pileHover: false,
    contextMenu: false, hideSummonSpiral: false, hideScreenshotButton: false, hideDeclarationChat: false, actionHistory: false, quickButtons: false,
    duelLayout: false });
  function savedLook(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.fromEntries(Object.keys(classicLook).filter(key => key === 'theme' ? ['night', 'classic', 'abyss', 'ember'].includes(value.theme) : typeof value[key] === 'boolean').map(key => [key, value[key]]));
  }
  // The settings patch that switches to a look: {} when it is already the current one.
  function lookPatch(current, look) {
    const config = settings(current);
    if (!['dbetter', 'classic'].includes(look) || look === config.look) return {};
    if (look === 'classic') return { ...classicLook, look, lookSaved: Object.fromEntries(Object.keys(classicLook).map(key => [key, config[key]])) };
    const saved = config.lookSaved || {};
    return { ...Object.fromEntries(Object.keys(classicLook).map(key => [key, Object.hasOwn(saved, key) ? saved[key] : key === 'theme' ? 'night' : defaults[key]])), look, lookSaved: null };
  }
  const keyLabel = key => key === ' ' ? 'Space' : key.toUpperCase();
  function replayUrl(id) {
    return /^[1-9]\d*$/.test(String(id)) ? `https://www.duelingbook.com/replay?id=${id}` : null;
  }
  function cardUrl(name) {
    return typeof name === 'string' && name.trim() ?
      `https://db.ygoresources.com/search#quick:${encodeURIComponent(name.trim())}` : null;
  }
  // Cooperative wrappers expose their predecessor. Inspect the whole chain:
  // checking only its outer function makes polling extensions wrap one another
  // forever, eventually exhausting the stack and blocking live duel packets.
  const originalKeys = ['dbliteOriginal', 'dbxSpectatorHistoryOriginal', 'dbxDeckHistoryOriginal', 'dbxDeckFoldersOriginal', 'dbxEnhancerOriginal'];
  function hasHook(fn, expected) {
    if (!expected) return false;
    const pending = [fn], seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (typeof current !== 'function' || seen.has(current)) continue;
      if (typeof expected === 'function' ? current === expected : current[expected]) return true;
      seen.add(current);
      for (const key of originalKeys) if (typeof current[key] === 'function') pending.push(current[key]);
    }
    return false;
  }
  function markHook(wrapped, original) {
    Object.defineProperty(wrapped, 'dbliteOriginal', { value: original });
    // Preserve other extensions' documented chain links so their own hook
    // maintenance can also find its existing wrapper through ours.
    for (const key of originalKeys.slice(1)) if (typeof original[key] === 'function')
      Object.defineProperty(wrapped, key, { value: original });
    return wrapped;
  }
  // Use native menu actions plus the requested direct placement/attachment
  // shortcuts. Source/viewer/host checks run again before native dispatch.
  function dropAction(card, target, shift, actions, ctrl = false, alt = false) {
    const has = name => actions.includes(name);
    const first = (...names) => names.find(has) || null;
    // Native Move opens the opponent monster selectors too (including solo).
    // Current menus no longer offer a separate Change control entry. A monster that is not on
    // the field yet is Special Summoned to a zone of yours first, then moved (content.js).
    if (target.kind === 'opponentZone') {
      if (target.occupied) return null;
      if (card.onField) return first('Move', 'Change control');
      return card.monster ? first(shift && !card.link ? 'SS DEF' : 'SS ATK') : null;
    }
    if (target.kind === 'opponentHand') return card.hand ? first('Reveal') : card.inMonsterZone ? first('Attack directly') : null;
    if (target.kind === 'opponentMonster') return card.inMonsterZone ? first('Attack') : null;
    if (target.occupied) {
      if (target.kind !== 'monster' || !target.overlayEligible) return null;
      if (card.extra) return first(shift && !card.link ? 'OL DEF' : 'OL ATK');
      if (card.onField) return shift ? (target.xyz ? 'Attach' : null) : first('Overlay');
      if (target.xyz && (card.hand || card.viewedDeck)) return 'Attach';
      return target.xyz ? first('Attach') : null;
    }
    switch (target.kind) {
      case 'monster':
        if (card.onField) return first('Move');
        if (alt && card.hand && card.monster) return first('Set monster');
        if (ctrl && card.hand && card.monster) return first('Normal Summon');
        return first(shift && !card.link ? 'SS DEF' : 'SS ATK');
      case 'spell':
        if (card.onField) return first('Move');
        if ((card.viewedExtra || card.faceUpExtraPendulum) && card.monster) return 'To ST';
        if (card.trap) return shift ? first('To ST') : first('Set ST', 'To ST');
        return shift ? first('Set ST', 'To ST') : first('Activate ST', 'To ST', 'Set ST');
      case 'field':
        if (!card.fieldSpell) return null;
        return card.onField ? first('Move') : first(shift ? 'Set Field Spell' : 'Activate Field Spell');
      case 'grave': return first('Remove Token', 'Detach', 'To GY');
      case 'banished': return first('Remove Token', shift ? 'Banish FD' : 'Banish');
      // Native "allowToBottom" hides a menu option; a card that can return to
      // the top can also use the bottom shortcut without changing that setting.
      case 'deck': return shift ? (has('To B Deck') || has('To T Deck') ? 'To B Deck' : null) : first('To T Deck');
      case 'extra':
        if (card.viewedDeck && card.monster && card.pendulum) return 'To ED FU';
        return first('To ED', 'To ED FU');
      case 'hand': return first('To hand');
      default: return null;
    }
  }
  function cardPalette(front, concealed = false) {
    if (concealed) return { primary: '#a7b4b1', secondary: '#a7b4b1' };
    const type = front?.data('card_type');
    const primary = type === 'Spell' ? '#38b69a' : type === 'Trap' ? '#cb70aa' :
      ({ Normal: '#d7bd73', Effect: '#d99559', Ritual: '#6b9ddd', Fusion: '#a87ad6',
        Synchro: '#e5e9e7', Xyz: '#596575', Link: '#438bd5', Token: '#a7b4b1' })[front?.data('monster_color')] || '#d99559';
    return { primary, secondary: type === 'Monster' && front?.data('pendulum') ? '#38b69a' : primary };
  }
  function layoutPlan(width, height, dock = true, duel = true, size = 100) {
    const wide = width / height >= 1.65;
    const reserve = dock && duel ? (wide ? Math.min(440, Math.max(220, width * .21)) : Math.min(300, Math.max(140, height * .27))) : 0;
    const availableWidth = width - (wide ? reserve : 0), availableHeight = height - (!wide ? reserve : 0);
    // Board size shrinks the fitted stage; the freed space stays evenly around it.
    const scale = Math.min(availableWidth / 1024, availableHeight / 640) * Math.max(.6, Math.min(1, size / 100));
    const x = (availableWidth - 1024 * scale) / 2, y = (availableHeight - 640 * scale) / 2;
    const band = !reserve ? null : wide ? { left: availableWidth + 8, top: 8, width: reserve - 16, height: height - 16 } : { left: 8, top: availableHeight + 8, width: width - 16, height: reserve - 16 };
    return { scale, x, y, wide, band };
  }
  function clampFloating(rect, width = innerWidth, height = innerHeight) {
    const w = Math.min(rect.width, width - 16), h = Math.min(rect.height, height - 16);
    return { left: Math.max(8, Math.min(rect.left, width - w - 8)), top: Math.max(8, Math.min(rect.top, height - h - 8)), width: w, height: h };
  }
  // A timeout is a loaded-image fallback, never permission to expose a broken face.
  // Network destinations (2026-10-29, for players to verify Spellspeed only talks to DuelingBook): a host that is
  // duelingbook.com or one of its subdomains.
  const duelingBookHost = host => host === 'duelingbook.com' || String(host).endsWith('.duelingbook.com');
  // An image address copied from DuelingBook's page, as given, or null: https on DuelingBook, data:/blob:, or relative
  // to the page.
  function pageImage(value, base = globalThis.location?.href || 'https://www.duelingbook.com/') {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (/^(?:data:image\/|blob:)/i.test(value.trim())) return value.trim();
    try { const url = new URL(value, base); return url.protocol === 'https:' && duelingBookHost(url.hostname) ? value.trim() : null; } catch { return null; }
  }
  // DuelingBook's duel server from its HOSTNAME global, or null: only wss:// on DuelingBook (wss://duel.duelingbook.com:8443/).
  function duelServer(value) {
    try { const url = new URL(value); return url.protocol === 'wss:' && duelingBookHost(url.hostname) ? url.href : null; } catch { return null; }
  }
  function imageReady(img, timeout = 4000) {
    return new Promise(resolve => {
      let settled = false, timer;
      const finish = ok => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        img.removeEventListener?.('load', loaded); img.removeEventListener?.('error', failed);
        resolve(ok);
      };
      const failed = () => finish(false);
      const loaded = () => {
        if (typeof img.decode === 'function') {
          try { Promise.resolve(img.decode()).then(() => finish(true), () => finish(img.complete && img.naturalWidth > 0)); }
          catch { finish(img.complete && img.naturalWidth > 0); }
        } else finish(img.complete && img.naturalWidth > 0);
      };
      img.addEventListener?.('load', loaded); img.addEventListener?.('error', failed);
      timer = setTimeout(() => finish(img.complete && img.naturalWidth > 0), timeout);
      if (typeof img.decode === 'function' || img.complete) loaded();
    });
  }
  const artworkStates = new WeakMap();
  function replaceArtwork(face, clone, key) {
    let state = artworkStates.get(face);
    if (!state) { state = {}; artworkStates.set(face, state); }
    state.wanted = key;
    if (state.shown === key || state.pending === key) return;
    if (typeof clone === 'function') clone = clone();
    const images = [...clone.querySelectorAll('img[src]')];
    if (clone.matches('img[src]')) images.unshift(clone);
    const commit = () => { if (state.wanted === key) { face.replaceChildren(clone); state.shown = key; } };
    if (!images.length) { commit(); return; }
    state.pending = key;
    Promise.all(images.map(img => imageReady(img))).then(ready => {
      if (state.pending === key) state.pending = null;
      // An empty face never waits on artwork that failed: a broken image beats an invisible card.
      if (ready.every(Boolean) || !face.firstChild) commit();
    });
  }
  root.DBLiteRules = { imageReady, replaceArtwork, defaultChat, chatList, layoutPlan, clampFloating, defaults, defaultKeys, validKey, keyLabel, settings, classicLook, lookPatch, tourIds, tourPatch, quickPatch, pageImage, duelServer, replayUrl, cardUrl, cardPalette, dropAction, hasHook, markHook };
})(globalThis);

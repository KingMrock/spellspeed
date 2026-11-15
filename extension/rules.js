/* DBETTER, GPL-3.0-only. See NOTICE.txt. */
(function (root) {
  'use strict';
  const defaults = Object.freeze({ animations: true, sounds: true, replay: true, drag: true, doubleClick: true, declare: true, normalSummon: true, fan: true, contextMenu: true, quickActions: true, shortcuts: true, handHover: true, pileHover: true, autoRps: true, skipIntro: true, hideDeclarationChat: true, dragDefense: true, dragSet: true, dropWheel: true, dragReveal: true, dragAttack: true, doubleClickPiles: true, doubleClickSet: true, signalKeys: true, zoneKeys: true, cardKeys: true, sortKey: true, peekKey: true, quickButtons: true, cardMacros: true, cardMotion: true, declareGlow: true, replaySpeed: true, replayRewind: true, replayVideo: true, refinedSounds: true, mellowSounds: false, volumeControl: true, adaptiveLayout: true, adaptiveDock: false, adaptiveConstructor: true, hideZoomNotice: true, hideScreenshotButton: true, hideSummonSpiral: true, blockAutoFocus: true, zoneKeysSend: true, previewLinks: true, namePeek: true, keepHandRevealed: true, clickDrop: true, chatWheel: true, touchControls: true, touchLayout: true, touchTapMenu: true, actionHistory: true, duelLayout: true, darkTextBoxes: true, retryLogin: true, guideButton: true });
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
      tourSeen: Array.isArray(value.tourSeen) ? tourIds.filter(id => value.tourSeen.includes(id)) : [], tourOff: value.tourOff === true,
      guideDone: Array.isArray(value.guideDone) ? guideIds.filter(id => value.guideDone.includes(id)) : [] };
  }
  // A page's DBLITE_QUICK message: the switches a duel offers outside the settings (user, 2026-10-29: the position
  // wheel on and off, for laid-back mouse play or keyboard play). Only known settings, as booleans; null when nothing changes.
  // Also one moved key, from the DBuddy hotkey clash note's one-click fix (user, 2026-11-12): a known action and a valid
  // key that no other action uses.
  const quickKeys = Object.freeze(['dropWheel']);
  function quickPatch(current, message) {
    const config = settings(current), patch = {};
    for (const key of quickKeys) if (typeof message?.[key] === 'boolean' && message[key] !== config[key]) patch[key] = message[key];
    const move = message?.key;
    if (move && typeof move === 'object' && Object.hasOwn(defaultKeys, move.action) && validKey(move.value)) {
      const value = move.value.toLowerCase();
      if (config.keys[move.action] !== value && !Object.entries(config.keys).some(([action, key]) => action !== move.action && key === value))
        patch.keys = { ...config.keys, [move.action]: value };
    }
    return Object.keys(patch).length ? patch : null;
  }
  // Onboarding (tour.js): the welcome card, then one tip per part. Seen tips and Skip are saved in the settings.
  // 'guide': the invitation to the deck builder guide was answered (first-launch card, welcome page or the toast).
  const tourIds = Object.freeze(['welcome', 'duel', 'viewer', 'replay', 'constructor', 'guide']);
  // Deck builder guide (guide.js; user, 2026-11-14, design B): a checklist of the deck builder's tools in five groups.
  // An item is done the first time the player uses the tool; `guideDone` keeps those ids in this order.
  const guideGroups = Object.freeze([['find', 'Find cards'], ['read', 'Read a card'], ['extra', 'Extra Deck'], ['test', 'Test the deck'], ['match', 'Matches']]);
  const guideItems = Object.freeze([
    ['search', 'find', 'Search for cards'], ['describe', 'find', 'Describe a card in your own words'], ['recent', 'find', 'Go back to a recent search'],
    ['links', 'read', 'Follow a link in card text'], ['access', 'read', 'Access: what gets a card out of the Deck'],
    ['starters', 'read', 'Starters: what reaches it from your hand'], ['ideas', 'read', 'Ideas: every one- or two-card line'],
    ['lab', 'extra', 'Summon Lab'], ['labMain', 'extra', 'Summon Lab from your Main Deck'],
    ['odds', 'test', 'Opening odds'], ['lines', 'test', 'Combo lines in Solo'],
    ['siding', 'match', 'Siding patterns'], ['sidePlan', 'match', 'Side plans between games'], ['history', 'match', 'Deck history'], ['chat', 'match', 'Quick chat for this deck']
  ].map(([id, group, title]) => Object.freeze({ id, group, title })));
  const guideIds = Object.freeze(guideItems.map(item => item.id));
  // YouTube links (user, 2026-11-14): filled in once the release video and the shorts are public. Empty: no video
  // button or clip link is shown anywhere.
  const guideVideos = Object.freeze({ tour: '', items: Object.freeze({}) });
  // The settings patch for a page's DBLITE_TOUR message: only known tips, Skip, a look and guide items used. null when nothing changes.
  function tourPatch(current, message) {
    const config = settings(current), patch = {};
    if (tourIds.includes(message?.seen) && !config.tourSeen.includes(message.seen)) patch.tourSeen = tourIds.filter(id => id === message.seen || config.tourSeen.includes(id));
    if (guideIds.includes(message?.done) && !config.guideDone.includes(message.done)) patch.guideDone = guideIds.filter(id => id === message.done || config.guideDone.includes(id));
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
  const originalKeys = ['dbliteOriginal', '__dbteOriginal', 'dbxSpectatorHistoryOriginal', 'dbxDeckHistoryOriginal', 'dbxDeckFoldersOriginal', 'dbxEnhancerOriginal'];
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
    if (hasHook(original, '__dbteWrapped')) Object.defineProperty(wrapped, '__dbteWrapped', { value: true });
    return wrapped;
  }
  // Use native menu actions plus the requested direct placement/attachment
  // shortcuts. Source/viewer/host checks run again before native dispatch.
  // Attach is in DuelingBook's own menu only while its player controls an Xyz Monster
  // (hasXyzMonster), and only for Graveyard and banished cards. Other cards are banished
  // first (content.js), so another Xyz Monster than the dropped card must be there.
  function canAttach(card, target, actions) {
    if (!target.anyXyz) return false;
    if (card.onField || card.hand || card.viewedDeck || card.extra) return true;
    return actions.includes('Attach');
  }
  // The wheel on an Xyz Monster: Attach (under it, as material) or Overlay (on top of it).
  // [action, label, sub]; empty when there is only one way, unless every way is asked for (all).
  function hostChoices(card, target, actions, all = false) {
    if (target.kind !== 'monster' || !target.occupied || !target.overlayEligible || !target.xyz) return [];
    const has = name => actions.includes(name), list = [];
    if (canAttach(card, target, actions)) list.push(['Attach', 'Attach', 'as material']);
    if (card.extra) {
      if (has('OL ATK')) list.push(['OL ATK', 'Overlay', 'on top']);
      if (has('OL DEF') && !card.link) list.push(['OL DEF', 'Overlay', 'on top · DEF']);
    } else if (card.onField && has('Overlay')) list.push(['Overlay', 'Overlay', 'on top']);
    return all || list.length > 1 ? list : [];
  }
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
      // DuelingBook's two plays onto a monster (user, 2026-11-13): Attach puts the dropped card
      // under the target as material; Overlay (a field card) or OL ATK / OL DEF (an Xyz Monster
      // from the Extra Deck) puts it on top, the target going under it.
      const attach = canAttach(card, target, actions) ? 'Attach' : null;
      const over = card.extra ? first(shift && !card.link ? 'OL DEF' : 'OL ATK') : card.onField ? first('Overlay') : null;
      if (!target.xyz) return card.extra || card.onField && card.xyz ? over || attach : attach;
      if (card.onField && shift) return attach;
      return over || attach;
    }
    switch (target.kind) {
      case 'monster':
        if (card.onField) return first('Move');
        if (alt && card.hand && card.monster) return first('Set monster');
        if (ctrl && card.hand && card.monster) return first('Normal Summon');
        return first(shift && !card.link ? 'SS DEF' : 'SS ATK');
      case 'spell':
        if (card.onField) return first('Move');
        // A monster from the viewed Deck or face-up banished too (user, 2026-11-14: Bingo Machine, Go!!! shows
        // revealed monsters there). Measured in a real duel: the Hand, GY and Deck menus offer To S/T for monsters,
        // the Extra Deck and banished menus do not, yet DuelingBook's server takes the play from both.
        if ((card.viewedExtra || card.faceUpExtraPendulum || card.viewedDeck || card.faceUpBanished) && card.monster) return 'To ST';
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
  // Anchoring Spellspeed's boxes to DuelingBook's (2026-11-11): a node's box in `parent`'s own pixels, read through the
  // offset chain. Those are the stage's unscaled pixels, so screen size, zoom and the adaptive scale drop out, and the
  // theme's padding is included. Null when the node is hidden or not laid out under `parent`: callers keep their
  // stylesheet spot then.
  function offsetBox(node, parent) {
    if (!node || !parent || !(node.offsetWidth > 0) || !(node.offsetHeight > 0)) return null;
    let left = 0, top = 0, at = node;
    for (let depth = 0; at && at !== parent && depth < 12; depth++) { left += at.offsetLeft || 0; top += at.offsetTop || 0; at = at.offsetParent; }
    return at === parent ? { left, top, width: node.offsetWidth, height: node.offsetHeight } : null;
  }
  // True when a visible node among `nodes` (laid out under `parent`) overlaps `box`.
  function boxBlocked(box, nodes, parent, skip) {
    for (const node of nodes) {
      if (node === skip) continue;
      const b = offsetBox(node, parent);
      if (b && b.left < box.left + box.width && b.left + b.width > box.left && b.top < box.top + box.height && b.top + b.height > box.top) return true;
    }
    return false;
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
  // DBuddy, another DuelingBook extension (docs/dbuddy-compat.md). Shared in MAIN and isolated worlds: its markers
  // (#dbte-root, its theme and rarity styles) and the tools it announced (data-dblite-dbuddy, kept by bootstrap.js).
  // Cached; an observer of <head>, <body> and that attribute refreshes it. No polling.
  let dbuddyState = null;
  const dbuddyListeners = new Set();
  function dbuddy() {
    if (dbuddyState) return dbuddyState;
    const doc = root.document, html = doc?.documentElement;
    const tools = new Set((html?.dataset.dbliteDbuddy || '').split(' ').filter(name => name && name !== 'on'));
    const state = { present: !!(root.__dbteBridge || doc?.getElementById('dbte-root') || html?.dataset.dbliteDbuddy),
      theme: !!doc?.getElementById('dbte-theme-vars'), foils: !!doc?.getElementById('dbte-rarity'), tools,
      // DBuddy's card hotkeys press items of DuelingBook's own hover menu, and its extra card actions add items to it.
      cardMenus: tools.has('cardHotkeys') || tools.has('extraActions'),
      silentPileView: tools.has('silentPileView'), replayTools: tools.has('replayTools'), sounds: tools.has('siteSounds') };
    html?.classList.toggle('dblite-dbuddy', state.present);
    html?.classList.toggle('dblite-dbuddy-theme', state.theme);
    return (dbuddyState = state);
  }
  // A DBuddy pile-wheel action in progress (marked by bootstrap.js until DBuddy's bridge answers; 1.5 s at most).
  function dbuddyPileAction() {
    const at = Number(root.document?.documentElement?.dataset.dbliteDbuddyPile);
    return at > 0 && Date.now() - at < 1500;
  }
  function onDbuddy(listener) { dbuddyListeners.add(listener); return () => dbuddyListeners.delete(listener); }
  function dbuddyChanged() {
    const before = dbuddyState; dbuddyState = null; const after = dbuddy();
    if (!before || ['present', 'theme', 'foils', 'cardMenus', 'silentPileView', 'replayTools'].some(key => before[key] !== after[key]))
      dbuddyListeners.forEach(listener => { try { listener(after); } catch (error) { console.error(error); } });
  }
  // Spellspeed's input handlers skip what another extension (DBuddy) already handled: an event already prevented when
  // it first reached Spellspeed, or one in DBuddy's own panel. A cancel by an earlier Spellspeed handler does not
  // count: the first document-capture listener (this one, injected before every other Spellspeed script) notes the
  // state on arrival. DBuddy's own key, pointer and middle-click handlers listen on window capture, so they come first.
  const preventedOnArrival = new WeakMap();
  if (typeof root.document?.addEventListener === 'function' && !root.document.dbliteArrival) {
    root.document.dbliteArrival = true;
    for (const type of ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'pointerdown', 'pointerup', 'pointermove', 'mousemove', 'mouseover', 'mouseout', 'wheel', 'touchstart'])
      root.document.addEventListener(type, event => preventedOnArrival.set(event, event.defaultPrevented), { capture: true, passive: true });
  }
  function skipInput(event) {
    const prevented = preventedOnArrival.has(event) ? preventedOnArrival.get(event) : event.defaultPrevented;
    return prevented || (event.composedPath?.() || [event.target]).some(node => node?.id === 'dbte-root');
  }
  // DBuddy's own layers (every class dbte-…) go; native elements it marked (e.g. .name_txt with dbte-rarity-plain-name)
  // stay, without its classes.
  function cleanFanClone(clone) {
    for (const face of [clone, ...clone.querySelectorAll('.cardfront_content,.dbte-rarity,[data-dbte-rarity]')]) {
      face.classList.remove('dbte-rarity'); face.removeAttribute('data-dbte-rarity');
      for (const layer of [...face.children]) {
        const classes = [...layer.classList], own = classes.filter(name => name.startsWith('dbte-rarity'));
        if (layer.localName === 'canvas' || own.length && own.length === classes.length) layer.remove();
        else if (own.length) layer.classList.remove(...own);
      }
    }
    clone.querySelectorAll('canvas').forEach(node => node.remove());
    return clone;
  }
  if (root.document?.documentElement && root.MutationObserver) {
    dbuddy();
    // DBuddy puts its styles in <head> and #dbte-root in <body>: their direct children are enough.
    const observer = new root.MutationObserver(dbuddyChanged), doc = root.document;
    const watch = () => {
      observer.observe(doc.documentElement, { childList: true, attributes: true, attributeFilter: ['data-dblite-dbuddy'] });
      if (doc.head) observer.observe(doc.head, { childList: true });
      if (doc.body) observer.observe(doc.body, { childList: true });
    };
    watch();
    if (!doc.body) doc.addEventListener('DOMContentLoaded', () => { watch(); dbuddyChanged(); }, { once: true });
  }
  root.DBLiteRules = { dbuddy, dbuddyPileAction, onDbuddy, skipInput, cleanFanClone, imageReady, replaceArtwork, defaultChat, chatList, layoutPlan, clampFloating, offsetBox, boxBlocked, defaults, defaultKeys, validKey, keyLabel, settings, classicLook, lookPatch, tourIds, tourPatch, guideGroups, guideItems, guideIds, guideVideos, quickPatch, pageImage, duelServer, replayUrl, cardUrl, cardPalette, dropAction, hostChoices, hasHook, markHook };
})(globalThis);

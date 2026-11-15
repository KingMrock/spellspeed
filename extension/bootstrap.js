/* DBETTER, GPL-3.0-only. Runs before DuelingBook can paint a duel. */
(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  // Spellspeed's replay timeline is on (Replay enhancements and Replay rewind, both on by default); see the replay guard below.
  let ownReplay = true;
  const theme = settings => {
    ownReplay = settings?.replay !== false && settings?.replayRewind !== false;
    const name = Object.hasOwn(settings || {}, 'theme')
      ? (['night', 'classic', 'abyss', 'ember'].includes(settings.theme) ? settings.theme : 'night')
      : settings?.nightMode === false ? 'classic' : 'night';
    document.documentElement.dataset.dbetterTheme = name;
    document.documentElement.classList.toggle('dbetter-night', name !== 'classic');
    document.documentElement.classList.toggle('dbetter-dark-boxes', settings?.darkTextBoxes !== false);
    // Classic keeps DuelingBook's profiles in place: never hide them while DBETTER loads.
    document.documentElement.classList.toggle('dblite-profile-layout', settings?.actionHistory !== false);
    document.documentElement.removeAttribute('data-dbetter-theme-pending');
  };
  // Keep the first paint behind the storage read so Classic never flashes Night.
  if (api?.storage?.local) {
    document.documentElement.setAttribute('data-dbetter-theme-pending', '');
    // Never keep the page hidden on a slow or stuck storage read.
    setTimeout(() => document.documentElement.removeAttribute('data-dbetter-theme-pending'), 400);
    let changed = false;
    api.storage.onChanged?.addListener((changes, area) => { if (area === 'local' && changes.settings) changed = true; });
    api.storage.local.get('settings').then(saved => { if (!changed) theme(saved.settings); }).catch(() => { if (!changed) theme({}); });
  } else theme({});
  api?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.settings) theme(changes.settings.newValue);
  });
  document.documentElement.classList.add('dblite-profile-layout', 'dblite-constructor-layout');
  // DBuddy (another DuelingBook extension) tells its page bridge which of its tools are on with window messages
  // ({source:'dbte-ext', type, value}). Spellspeed only listens, from document_start so none is missed, and keeps the
  // tools that decide who owns an input in data-dblite-dbuddy, read by every Spellspeed script (rules.dbuddy()).
  const dbuddyTools = new Set();
  const dbuddyOn = { cardHotkeys: v => v === true, extraActions: v => Array.isArray(v) && v.length > 0, pileWheel: v => v === true,
    silentPileView: v => v === true, replayTools: v => v === true, deckTools: v => !!v && typeof v === 'object', rpsAuto: v => !!v,
    siteVolume: v => typeof v === 'number' && v !== 1, setTimeScale: v => typeof v === 'number' && v !== 1,
    // DBuddy 2.2.3+ sound packs: the map lists only the sounds it replaces, mutes or brings from the user; empty = DuelingBook's own.
    siteSounds: v => !!v && typeof v === 'object' && Object.keys(v).length > 0 };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'dbte-ext' || !Object.hasOwn(dbuddyOn, data.type)) return;
    if (dbuddyOn[data.type](data.value)) dbuddyTools.add(data.type); else dbuddyTools.delete(data.type);
    document.documentElement.dataset.dbliteDbuddy = [...dbuddyTools].sort().join(' ') || 'on';
  });
  // Replays (user, 2026-11-12): Spellspeed's timeline runs them, even with DBuddy's Replay tools on. Once started, DBuddy's
  // replay module edits the replay on its own (every 150 ms it drops DuelingBook's duplicated play and saves checkpoints;
  // docs/dbuddy-compat.md), so hiding its buttons is not enough. On replay pages, while Spellspeed's timeline is on, its
  // start message and its replay commands are held back before DBuddy's bridge sees them (a capture listener runs before
  // the bridge's), and html[data-dblite-dbuddy-replay-held] lets rewind-ui.js say so. DBuddy's own setting is never
  // changed; with Spellspeed's timeline off, DBuddy's replay tools work as usual.
  const replayPage = /^\/replay(?:\.php)?\/?$/.test(location.pathname);
  addEventListener('message', event => {
    const data = event.data;
    if (!replayPage || !ownReplay || event.source !== window || data?.source !== 'dbte-ext') return;
    if (!(data.type === 'replayTools' && data.value === true) && data.type !== 'replayCmd') return;
    document.documentElement.dataset.dbliteDbuddyReplayHeld = '';
    event.stopImmediatePropagation();
  }, true);
  // DBuddy's pile wheel opens the Deck and Extra Deck through DuelingBook's own pile menu (its bridge calls showDeckMenu,
  // then clicks "View deck"). Mark the request until the bridge answers, so Spellspeed lets that one native menu show
  // (content.js cardMenus). This listener runs before DBuddy's bridge, which is injected later.
  addEventListener('message', event => {
    const data = event.data, html = document.documentElement;
    if (event.source !== window) return;
    if (data?.source === 'dbte-ext' && data.type === 'pileAction') html.dataset.dbliteDbuddyPile = String(Date.now());
    else if (data?.source === 'dbte-bridge' && data.type === 'cardResult' && data.payload?.kind === 'pileAction') delete html.dataset.dbliteDbuddyPile;
  });
})();

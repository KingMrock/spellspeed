/* DBETTER, GPL-3.0-only. Runs before DuelingBook can paint a duel. */
(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const theme = settings => {
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
    siteVolume: v => typeof v === 'number' && v !== 1, setTimeScale: v => typeof v === 'number' && v !== 1 };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'dbte-ext' || !Object.hasOwn(dbuddyOn, data.type)) return;
    if (dbuddyOn[data.type](data.value)) dbuddyTools.add(data.type); else dbuddyTools.delete(data.type);
    document.documentElement.dataset.dbliteDbuddy = [...dbuddyTools].sort().join(' ') || 'on';
  });
})();

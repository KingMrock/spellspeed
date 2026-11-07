/* DBETTER, GPL-3.0-only. */
(() => {
  'use strict';
  const api = globalThis.browser || chrome;
  const profileRequests = new Map();
  api.runtime?.onMessage?.addListener((message, sender, respond) => {
    if (!['DBETTER_PROFILE_PROBE', 'DBETTER_PROFILE_OPEN'].includes(message?.type)) return;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { profileRequests.delete(id); respond({ ready: false, opened: false }); }, 1500);
    profileRequests.set(id, result => { clearTimeout(timer); respond(result); });
    window.postMessage({ ...message, type: 'DBLITE_PROFILE_COMMAND', command: message.type, id }, location.origin);
    return true;
  });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'DBLITE_PROFILE_REPLY') { const reply = profileRequests.get(data.id); profileRequests.delete(data.id); reply?.({ ready: data.ready === true, opened: data.opened === true }); }
    if (data?.type === 'DBLITE_PROFILE_REQUEST' && typeof data.username === 'string' && data.username.length <= 120) {
      api.runtime.sendMessage({ type: 'DBETTER_PROFILE_REQUEST', username: data.username }).then(result => {
        window.postMessage({ type: 'DBLITE_PROFILE_RESULT', ...result }, location.origin);
      }, () => window.postMessage({ type: 'DBLITE_PROFILE_RESULT', opened: false, error: 'Reload Spellspeed and your DuelingBook tabs to enable profile links.' }, location.origin));
    }
  });
  // Covers live duels as well as replays, including an updated older loader.
  document.documentElement.classList.add('dblite-profile-layout', 'dblite-constructor-layout');
  function inject(file, config, attempt = 0) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = api.runtime.getURL(file);
      if (config) script.dataset.settings = JSON.stringify(config);
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); if (attempt < 2) setTimeout(() => inject(file, config, attempt + 1).then(resolve, reject), 500 * 2 ** attempt); else reject(new Error(`Could not load ${file}`)); };
      (document.head || document.documentElement).appendChild(script);
    });
  }
  async function start() {
    const saved = await api.storage.local.get('settings');
    let currentSettings = saved.settings || {};
    const theme = settings => {
      const name = Object.hasOwn(settings || {}, 'theme')
        ? (['night', 'classic', 'abyss', 'ember'].includes(settings.theme) ? settings.theme : 'night')
        : settings?.nightMode === false ? 'classic' : 'night';
      document.documentElement.dataset.dbetterTheme = name;
      document.documentElement.classList.toggle('dbetter-night', name !== 'classic');
      document.documentElement.classList.toggle('dbetter-dark-boxes', settings?.darkTextBoxes !== false);
    // Classic keeps DuelingBook's profiles in place: never hide them while DBETTER loads.
    document.documentElement.classList.toggle('dblite-profile-layout', settings?.actionHistory !== false);
    };
    theme(currentSettings);
    // Changes a page asks for are merged into the settings as stored now, one at a time (release review, 2026-10-29:
    // writing this tab's cached copy could undo a change just made in another tab, or another tab's seen tip).
    let writes = Promise.resolve();
    const update = compute => {
      writes = writes.then(async () => {
        const latest = (await api.storage.local.get('settings')).settings || {};
        const patch = compute(latest);
        if (!patch) return;
        currentSettings = { ...latest, ...patch };
        await api.storage.local.set({ settings: currentSettings });
      }).catch(() => {});
    };
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_VOLUME') return;
      const volume = event.data.volume;
      if (!Number.isInteger(volume) || volume < 0 || volume > 100) return;
      update(() => ({ vfxVolume: volume }));
    });
    // Switches a duel offers outside the settings, such as the position wheel (validated by DBLiteRules.quickPatch).
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_QUICK') return;
      const data = event.data;
      update(latest => globalThis.DBLiteRules?.quickPatch(latest, data));
    });
    // Onboarding: seen tips, Skip and the look chosen on the welcome card (validated by DBLiteRules.tourPatch).
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_TOUR') return;
      const data = event.data;
      update(latest => globalThis.DBLiteRules?.tourPatch(latest, data));
    });
    // Theme all routes, including static pages without the duel client, and
    // update it independently of whether page-script injection succeeds.
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        currentSettings = changes.settings.newValue || {};
        theme(currentSettings);
        window.postMessage({ type: 'DBLITE_SETTINGS', settings: currentSettings }, location.origin);
      }
    });
    await inject('rules.js');
    await inject('workbench.js');
    await inject('constructor.js');
    await inject('sounds.js');
    await inject('content.js', currentSettings);
    if (/^\/replay(?:\.php)?\/?$/.test(location.pathname)) {
      await inject('rewind.js');
      await inject('rewind-ui.js', currentSettings);
    }
    // Touch controls are an add-on layer: a failure must not undo the loaded features.
    await inject('touch.js', currentSettings).catch(error => console.warn('Spellspeed:', error.message));
    await inject('recorder.js', currentSettings).catch(error => console.warn('Spellspeed:', error.message));
    await inject('tour.js', currentSettings).catch(error => console.warn('Spellspeed:', error.message));
    window.postMessage({ type: 'DBLITE_SETTINGS', settings: currentSettings }, location.origin);
  }
  start().catch(error => {
    document.documentElement.classList.remove('dblite-profile-layout', 'dblite-constructor-layout');
    console.warn('Spellspeed:', error.message);
  });
})();

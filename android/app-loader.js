/* DBETTER for Android, GPL-3.0-only. Does what the extension's bootstrap.js, loader.js and
 * night.css content script do, with the app's settings bridge (window.DBETTERApp) in place of
 * chrome.storage. Injected by MainActivity when a page starts (styles) and when it has loaded
 * (scripts); it runs once per page. */
(() => {
  'use strict';
  const base = 'https://appassets.androidplatform.net/dbetter/';
  const bridge = window.DBETTERApp;
  const read = () => { try { return JSON.parse(bridge?.getSettings() || '{}') || {}; } catch { return {}; } };
  // As the extension's bootstrap.js: the theme by name, dark text boxes, and native avatars kept in place when
  // the action histories are off (Classic).
  const theme = settings => {
    const html = document.documentElement; if (!html) return;
    const name = Object.hasOwn(settings || {}, 'theme')
      ? (['night', 'classic', 'abyss', 'ember'].includes(settings.theme) ? settings.theme : 'night')
      : settings?.nightMode === false ? 'classic' : 'night';
    html.dataset.dbetterTheme = name;
    html.classList.toggle('dbetter-night', name !== 'classic');
    html.classList.toggle('dbetter-dark-boxes', settings?.darkTextBoxes !== false);
    html.classList.toggle('dblite-profile-layout', settings?.actionHistory !== false);
  };
  function styles() {
    const head = document.head || document.documentElement;
    if (!head || document.getElementById('dbetter-app-night')) return !!head;
    document.documentElement.classList.add('dblite-constructor-layout', 'dbetter-app');
    theme(read());
    const link = document.createElement('link'); link.id = 'dbetter-app-night'; link.rel = 'stylesheet'; link.href = base + 'night.css'; head.append(link);
    // The app is always full screen and landscape: DBETTER's browser prompts for both are not needed.
    const style = document.createElement('style'); style.id = 'dbetter-app-style';
    style.textContent = 'html.dbetter-app .dbetter-touch-bar [aria-label="Full screen"],html.dbetter-app .dbetter-rotate{display:none!important}' +
      'html.dbetter-app .dbetter-touch-bar .dbetter-app-settings{font-size:17px}' +
      'html.dbetter-app .dbetter-app-home{position:fixed;left:max(6px,env(safe-area-inset-left));top:max(6px,env(safe-area-inset-top));z-index:2147483640;width:42px;height:42px;padding:0;border:1px solid #73998d;border-radius:10px;background:#1d352ecc;color:#ecfaf4;font:23px/40px system-ui,sans-serif}' +
      'html.dbetter-app.dblite-in-constructor .dbetter-app-home{left:calc(max(6px,env(safe-area-inset-left)) + 42px);width:34px;height:34px;font-size:20px;line-height:32px}' +
      'html.dbetter-app.dblite-in-constructor.dbetter-cutout-left .dbetter-app-home{left:calc(max(2px,calc(env(safe-area-inset-left) - 44px)) + 42px)}' +
      'html.dbetter-app.dblite-in-constructor.dbetter-cutout-right .dbetter-app-home{left:auto;right:calc(max(2px,calc(env(safe-area-inset-right) - 44px)) + 42px)}' +
      // Ads are not loaded in the app (MainActivity); their empty slots must not cover the board either.
      'html.dbetter-app :is([id^="ezoic-pub-ad-placeholder"],.ezoic-ad,.ezoic-adpicker-ad,.ezads-sticky-intradiv,[id^="ezmob"],ins.adsbygoogle,[id^="google_ads_iframe"],[id^="div-gpt-ad"],#ez-video-wrap,.ez-video-wrap){display:none!important}';
    head.append(style);
    return true;
  }
  function inject(file, config, attempt = 0) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = base + file;
      if (config) script.dataset.settings = JSON.stringify(config);
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); if (attempt < 2) setTimeout(() => inject(file, config, attempt + 1).then(resolve, reject), 500 * 2 ** attempt); else reject(new Error(`Could not load ${file}`)); };
      (document.head || document.documentElement).appendChild(script);
    });
  }
  // DBETTER's settings button joins the phone corner buttons (Find a card ⌕).
  function settingsButton() {
    const bar = document.querySelector('.dbetter-touch-bar');
    if (!bar || bar.querySelector('.dbetter-app-settings')) return;
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'dbetter-touch-native dbetter-app-settings'; button.textContent = '⚙'; button.setAttribute('aria-label', 'Spellspeed settings');
    button.addEventListener('click', () => bridge?.openSettings());
    bar.prepend(button);
  }
  // Replays and decks open from links in place of the main page, in the app's single window (user, 2026-10-29: no way
  // back to play): ⌂ leads back from any page but the main one, except during a duel you play (a Solo from a deck page).
  // Top left, where replays leave room (a third corner button would cover DuelingBook's Show Hand switches); beside ⚙
  // where the corner buttons sit at the top (deck pages).
  function homeButton() {
    if (location.pathname === '/' || !document.body) return;
    let home = document.querySelector('.dbetter-app-home');
    if (!home) {
      home = document.createElement('button'); home.type = 'button';
      home.className = 'dbetter-touch-native dbetter-app-home'; home.textContent = '⌂'; home.setAttribute('aria-label', 'Back to the main page');
      home.addEventListener('click', () => location.assign(location.origin + '/'));
      document.body.append(home);
    }
    home.hidden = !!(window.duel_active && window.duelist && !window.replay);
  }
  const replayPage = () => /^\/replay(?:\.php)?\/?$/.test(location.pathname);
  async function start() {
    let current = read();
    window.__dbetterApp = {
      settings(next) { current = next || {}; theme(current); window.postMessage({ type: 'DBLITE_SETTINGS', settings: current }, location.origin); }
    };
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.type === 'DBLITE_VOLUME' && Number.isInteger(data.volume) && data.volume >= 0 && data.volume <= 100) {
        current = { ...read(), vfxVolume: data.volume }; bridge?.setSettings(JSON.stringify(current));
      }
      // Onboarding: seen tips, Skip and the look chosen on the welcome card. The page hears the result like any settings change.
      if (data?.type === 'DBLITE_TOUR') {
        const patch = window.DBLiteRules?.tourPatch(read(), data);
        if (patch) { const next = { ...read(), ...patch }; bridge?.setSettings(JSON.stringify(next)); window.__dbetterApp.settings(next); }
      }
      // Switches a duel offers outside the settings, such as the position wheel.
      if (data?.type === 'DBLITE_QUICK') {
        const patch = window.DBLiteRules?.quickPatch(read(), data);
        if (patch) { const next = { ...read(), ...patch }; bridge?.setSettings(JSON.stringify(next)); window.__dbetterApp.settings(next); }
      }
      // Profile links open the profile in this window; there are no other tabs to route to.
      if (data?.type === 'DBLITE_PROFILE_REQUEST') window.postMessage({ type: 'DBLITE_PROFILE_RESULT', opened: false, error: 'Leave the replay (⌂), then open the profile from the main menu.' }, location.origin);
    });
    await inject('rules.js');
    await inject('workbench.js');
    await inject('constructor.js');
    await inject('sounds.js');
    await inject('content.js', current);
    // Replays: the timeline (rewind-observer.js, which captures the replay, runs with this loader as the page starts).
    if (replayPage()) {
      await inject('rewind.js');
      await inject('rewind-ui.js', current);
    }
    await inject('touch.js', current).catch(error => console.warn('Spellspeed:', error.message));
    await inject('tour.js', current).catch(error => console.warn('Spellspeed:', error.message));
    window.postMessage({ type: 'DBLITE_SETTINGS', settings: current }, location.origin);
    const corners = () => { settingsButton(); homeButton(); };
    new MutationObserver(corners).observe(document.body, { childList: true });
    corners();
  }
  window.__dbetterAppStart = stage => {
    if (!styles()) return;
    if (stage !== 'ready' || window.__dbetterAppStarted) return;
    window.__dbetterAppStarted = true;
    start().catch(error => console.warn('Spellspeed:', error.message));
  };
})();

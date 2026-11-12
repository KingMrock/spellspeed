/* Spellspeed, GPL-3.0-only. See NOTICE.txt.
 * Welcome page (user, 2026-11-12): opens in its own tab when Spellspeed is installed (background.js). It lists the main
 * features, all on to start: the duel features one by one with an icon, the deck builder and the replay features as one
 * recommended switch each. Then the look and how card actions open, then DuelingBook. Everything saves at once, like the
 * settings popup, and open DuelingBook tabs follow. */
(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const rules = globalThis.DBLiteRules;
  // Line icons (24 × 24, stroked in the text colour). Drawn here, so the page needs no image files.
  const icons = Object.freeze({
    duel: 'M14.5 14.5 4 4V3h1l10.5 10.5M9.5 14.5 20 4V3h-1L8.5 13.5M6 16l2 2M18 16l-2 2M4.5 19.5l2.5-2.5M19.5 19.5 17 17',
    drag: 'M4 5h9v13H4zM15.5 11.5h5M18 9l2.5 2.5L18 14',
    wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 3v6M12 15v6M3 12h6M15 12h6',
    fan: 'M9.5 4h5v14h-5zM9.5 6.5 5 8.2l3.8 11.2.7-.3M14.5 6.5l4.5 1.7-3.8 11.2-.7-.3',
    keys: 'M3 7h18v10H3zM6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7 14h10',
    chat: 'M4 5h16v10H9.5L5 19v-4H4z',
    history: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7.5V12l3 2',
    motion: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
    sound: 'M4 9h4l5-4v14l-5-4H4zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10',
    deck: 'M8.5 3H19v15H8.5zM5 6.5V21h10.5',
    pointer: 'M5 3l12.5 7.5-5.2 1.3 3.2 6.2-2.4 1.2-3.2-6.2L6 17z',
    replay: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM10 8.5v7l6-3.5z'
  });
  // The features shown: each switch sets `keys` together and is on when all of them are; `parent` greys it out while
  // that setting is off. Everything else stays in the settings popup.
  const groups = Object.freeze([
    { id: 'duel', label: 'In duels', icon: 'duel', features: [
      { id: 'drag', keys: ['drag'], icon: 'drag', label: 'Drag and drop', text: 'Drag a card onto a zone to play it.' },
      { id: 'dropWheel', keys: ['dropWheel'], icon: 'wheel', parent: 'drag', label: 'Position wheel', text: 'Choose attack, defense or set as you drop.' },
      { id: 'fan', keys: ['fan'], icon: 'fan', label: 'Card fans', text: 'Your piles open as a fan or a grid.' },
      { id: 'shortcuts', keys: ['shortcuts'], icon: 'keys', label: 'Shortcut keys', text: 'Keys for common actions.' },
      { id: 'chatWheel', keys: ['chatWheel'], icon: 'chat', label: 'Quick chat', text: 'gg, glhf and your own lines in two clicks.' },
      { id: 'actionHistory', keys: ['actionHistory'], icon: 'history', label: 'Action history', text: 'Recent plays beside each player.' },
      { id: 'animations', keys: ['animations'], icon: 'motion', label: 'Animations', text: 'Smoother card moves and effects.' },
      { id: 'sounds', keys: ['sounds'], icon: 'sound', label: 'Sounds', text: 'Card sounds with their own volume.' }
    ] },
    { id: 'deck', label: 'Deck builder', icon: 'deck', features: [
      { id: 'deck', keys: ['adaptiveConstructor', 'previewLinks', 'namePeek'], icon: 'deck', recommended: true, label: 'Better deck builder',
        text: 'A wider search, card text you can follow, and what gets each card out of the Deck.' }
    ] },
    { id: 'replay', label: 'Replays', icon: 'replay', features: [
      { id: 'replays', keys: ['replay', 'replayRewind', 'replaySpeed', 'replayVideo'], icon: 'replay', recommended: true, label: 'Replay enhancements',
        text: 'A timeline to any play, up to 16× speed, and saving as a video.' }
    ] }
  ]);
  // The page's own state, kept beside the settings: whether Open DuelingBook was used.
  const normal = value => ({ done: value?.done === true });
  // What's new, newest first: the entry for this version (or the latest before it) is shown.
  const news = Object.freeze([
    ['0.9.3', ['Works alongside DBuddy: with both installed, Spellspeed follows DBuddy\'s theme and keeps its foils.',
      'Describe understands more: whose card, targeting, Tributes and costs ("pops your own card, non target").',
      'Summon Lab: a clear Back to search button, and Esc closes it.',
      'Fixes: right-click in the deck builder search always moves the card, the "is typing" line no longer covers the chat, and pile counts stay off your hand.']],
    ['0.9.2', ['Opening odds: how often this deck opens with a starter, beside Solo in the deck builder.',
      'Siding patterns: the cards you side in and out for each matchup, with a PDF to print.',
      'Replays load ahead in the background, so the timeline jumps to a play faster.']]
  ]);
  globalThis.SpellspeedWelcome = { icons, groups, normal, news };
  const $ = id => document.getElementById(id);
  if (!api?.storage || !rules || !$('features')) return;

  let config = rules.settings({}), state = normal({}), ready = false, queue = Promise.resolve();
  const status = text => { $('status').textContent = text; };
  // Serialized like the popup's saves, so quick clicks keep each other's changes and those of other open panels.
  // Any choice here also counts as the welcome: DuelingBook's own welcome card is then not shown.
  function commit(make) {
    queue = queue.then(async () => {
      const stored = await api.storage.local.get(['settings', 'welcome']);
      const current = stored.settings || {}, result = make(current, normal(stored.welcome));
      const patch = { ...result.patch }, seen = rules.settings({ ...current, ...patch }).tourSeen;
      if (!seen.includes('welcome')) patch.tourSeen = rules.tourIds.filter(id => id === 'welcome' || seen.includes(id));
      const settings = rules.settings({ ...current, ...patch });
      await api.storage.local.set({ settings, welcome: result.state });
      config = settings; state = result.state; render();
      status('Saved. Open DuelingBook tabs use it at once.');
    }).catch(() => status('Could not save. Reload this page and try again.'));
    return queue;
  }
  const keep = patch => (current, saved) => ({ patch, state: saved });
  const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  function icon(name) {
    const SVG = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(SVG, 'svg'), path = document.createElementNS(SVG, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
    path.setAttribute('d', icons[name]); svg.append(path);
    return svg;
  }
  function choice(id, label, detail, swatch) {
    const node = element('button', 'choice'); node.type = 'button'; node.id = id; node.setAttribute('role', 'radio'); node.disabled = true;
    if (swatch) { const sample = element('span', 'theme-swatch'); sample.dataset.dbetterTheme = swatch; sample.setAttribute('aria-hidden', 'true'); node.append(sample); }
    node.append(element('strong', '', label), element('span', '', detail));
    return node;
  }

  const rows = [], pair = element('div', 'pair'), menuButtons = new Map();
  for (const group of groups) {
    const many = group.features.length > 1, block = element('section', 'group'); block.dataset.group = group.id;
    const title = element('h3'); title.append(icon(group.icon), document.createTextNode(group.label)); block.append(title);
    const list = element('div', many ? 'feature-grid' : 'feature-list');
    for (const feature of group.features) {
      const row = element('label', 'feature'); row.htmlFor = 'feature-' + feature.id;
      const words = element('span', 'words'), name = element('strong', '', feature.label);
      if (feature.recommended) name.append(element('em', 'tag', 'Recommended'));
      words.append(name, element('small', '', feature.text));
      const input = element('input'); input.type = 'checkbox'; input.id = 'feature-' + feature.id; input.dataset.settings = feature.keys.join(' '); input.disabled = true;
      input.addEventListener('change', () => commit(keep(Object.fromEntries(feature.keys.map(key => [key, input.checked])))));
      row.append(icon(feature.icon), words, input); list.append(row); rows.push({ feature, input, row });
    }
    // How card actions open (playtest F2: players did not know DuelingBook's hover menu was off, nor where to bring it
    // back): the same setting as the toolbar panel's Right-click actions, a pick between the two, saying which is on.
    if (group.id === 'duel') {
      const row = element('div', 'feature menu-pick'), words = element('span', 'words'), pick = element('span', 'segmented');
      words.append(element('strong', '', 'Card actions'), element('small', '', '')); words.lastChild.id = 'menu-detail';
      pick.setAttribute('role', 'radiogroup'); pick.setAttribute('aria-label', 'Card actions');
      for (const [value, label] of [[true, 'Right-click'], [false, 'Hover']]) {
        const node = element('button', '', label); node.type = 'button'; node.id = value ? 'menu-right' : 'menu-hover'; node.setAttribute('role', 'radio'); node.disabled = true;
        node.addEventListener('click', () => commit(keep({ contextMenu: value }))); pick.append(node); menuButtons.set(value, node);
      }
      row.append(icon('pointer'), words, pick); list.append(row);
    }
    block.append(list);
    // The deck builder and replays sit side by side under the duel features.
    if (many) $('features').append(block); else pair.append(block);
  }
  $('features').append(pair);

  const lookButtons = new Map(), themeButtons = new Map();
  for (const [look, label, detail, swatch] of [['dbetter', 'Spellspeed', 'Dark themes and a layout that fits the window.', 'night'],
    ['classic', 'Classic DuelingBook', 'DuelingBook’s own look and hover menu, with Spellspeed’s tools.', 'classic']]) {
    const node = choice(look === 'classic' ? 'look-classic' : 'look-spellspeed', label, detail, swatch);
    node.addEventListener('click', () => commit((current, saved) => ({ patch: rules.lookPatch(current, look), state: saved }))); $('looks').append(node); lookButtons.set(look, node);
  }
  $('themes').append(element('span', 'label', 'Theme'));
  for (const name of ['night', 'abyss', 'ember']) {
    const node = element('button', 'theme'); node.type = 'button'; node.dataset.theme = name; node.disabled = true;
    const sample = element('span', 'theme-swatch'); sample.dataset.dbetterTheme = name; sample.setAttribute('aria-hidden', 'true');
    node.append(sample, document.createTextNode(name[0].toUpperCase() + name.slice(1)));
    node.addEventListener('click', () => commit(keep({ theme: name }))); $('themes').append(node); themeButtons.set(name, node);
  }
  $('open').addEventListener('click', event => {
    // Saved before leaving, so the first DuelingBook page already has the choices.
    event.preventDefault();
    const href = $('open').href;
    commit((current, saved) => ({ patch: {}, state: { ...saved, done: true } })).then(() => { location.href = href; });
  });

  function render() {
    document.documentElement.dataset.dbetterTheme = config.theme;
    for (const { feature, input, row } of rows) {
      const off = !!feature.parent && !config[feature.parent];
      // Shown off while its parent is off, since it does nothing then; its own setting is kept.
      input.checked = !off && feature.keys.every(key => config[key]); input.disabled = !ready || off;
      row.classList.toggle('disabled', off);
    }
    for (const [look, node] of lookButtons) { node.setAttribute('aria-checked', String(config.look === look)); node.disabled = !ready; }
    // The Spellspeed sample shows the theme picked below it.
    if (config.look !== 'classic') lookButtons.get('dbetter').querySelector('.theme-swatch').dataset.dbetterTheme = config.theme;
    $('themes').hidden = config.look === 'classic';
    for (const [name, node] of themeButtons) { node.setAttribute('aria-pressed', String(config.theme === name)); node.disabled = !ready; }
    for (const [value, node] of menuButtons) { node.setAttribute('aria-checked', String(config.contextMenu === value)); node.disabled = !ready; }
    $('menu-detail').textContent = (config.contextMenu ? 'Spellspeed’s right-click menu is on: right-click a card for its actions.'
      : 'DuelingBook’s hover menu is on: hover a card for its actions.') + ' You can switch later in the toolbar panel (Right-click actions).';
    $('tips-note').textContent = config.tourOff ? 'Tips are turned off. Show tips again is in the settings.'
      : 'A short tip shows the first time you reach a duel, a replay or the deck builder.';
  }

  let version = '';
  try { const manifest = api.runtime.getManifest(); version = manifest.version; } catch {}
  const entry = news.find(([number]) => !version || number.localeCompare(version, undefined, { numeric: true }) <= 0) || news[0];
  $('news-version').textContent = entry[0];
  for (const item of entry[1]) $('news').append(element('li', '', item));

  (async () => {
    try {
      const stored = await api.storage.local.get(['settings', 'welcome']);
      config = rules.settings(stored.settings); state = normal(stored.welcome); ready = true; render();
      status('Changes save as you go.');
      if (location.hash === '#new') $('new').scrollIntoView?.();
      api.storage.onChanged?.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.settings) config = rules.settings(changes.settings.newValue);
        if (changes.welcome) state = normal(changes.welcome.newValue);
        if (changes.settings || changes.welcome) render();
      });
    } catch { status('Could not load the settings. Reload this page.'); }
  })();
})();

/* DBETTER, GPL-3.0-only. Shared popup and options controller. */
(async () => {
  'use strict';
  const api = globalThis.browser || chrome, full = document.body.classList.contains('options');
  const $ = id => document.getElementById(id);
  const groups = [
    ['Drag & drop', [
      ['drag', 'Drag and drop', 'Move cards using native duel actions.'],
      ['dragDefense', 'Shift modifiers', 'Defense, set Spell/Trap, bottom of Deck and face-down banishment.', 'drag'],
      ['dragSet', 'Alt to Set', 'Set a monster from hand.', 'drag'],
      ['dragReveal', 'Reveal to opponent', 'Drag a hand card onto the opponent hand.', 'drag'],
      ['dragAttack', 'Attack opponent targets', 'Drag a monster onto an opponent monster or hand.', 'drag'],
      ['normalSummon', 'Ctrl-drag to Normal Summon', 'From hand to an empty monster zone.', 'drag'],
      ['dropWheel', 'Position wheel', 'A drop on an empty zone asks how to play the card: SS Attack (up), SS Defense (down), Normal Summon (right) or Set (left); Activate, Set or face-up for Spells and Traps. Shift, Ctrl and Alt still choose directly. In a duel, ◎ Wheel / ⌨ Direct beside Find card (or W) switches it.', 'drag'],
      ['clickDrop', 'Click, then click a zone', 'In the Fan, Grid or Classic viewer, click a card, then click where it goes. The card is picked up when the pointer leaves it (or after half a second), so a double-click still declares. Esc or right-click cancels.', 'drag'],
      ['doubleClick', 'Double-click actions', 'Pile viewing and flipping set cards.'],
      ['doubleClickPiles', 'Double-click piles', 'Open Deck, Extra, GY, banished and material viewers.', 'doubleClick'],
      ['doubleClickSet', 'Double-click set cards', 'Flip set field cards face-up.', 'doubleClick']
    ]],
    ['Keyboard & card actions', [
      ['shortcuts', 'Keyboard shortcuts', 'Remap each action below in All settings.'],
      ['signalKeys', 'Signal keys', 'OK / hold keep going; thinking / hold big think.', 'shortcuts'],
      ['zoneKeys', 'Zone keys', 'Open Extra Deck, Deck, GY and banished.', 'shortcuts'],
      ['zoneKeysSend', 'Zone keys send hovered card', 'Over one of your cards, the zone keys send it to GY, banished, top of Deck, Extra Deck or hand.', 'shortcuts'],
      ['cardKeys', 'Card keys', 'Declare or target the hovered card.', 'shortcuts'],
      ['sortKey', 'Sort key', 'Toggle sorting in the pile viewer.', 'shortcuts'],
      ['peekKey', 'See-through key', 'Toggle viewer background and card transparency.', 'shortcuts'],
      ['blockAutoFocus', 'Block DuelingBook auto-focus', 'Stop the site moving your cursor into chat and search boxes, so shortcut keys keep working. Replaces the Auto-Focus Blocker userscript.'],
      ['declare', 'Double-click to declare', 'Hand, field, GY, banished and face-up Extra Deck Pendulums.'],
      ['previewLinks', 'Clickable names in card preview', 'Click a quoted name, archetype or stat in the card text to list related cards in Find a card. Links read the whole phrase (Level, Attributes, Types, “non-” exclusions). Under the text: the card’s archetype and, in the deck constructor, Access and Starters.'],
      ['chatWheel', 'Quick chat wheel', 'A 💬 Chat button in duels opens a wheel of short messages (gg, glhf…): your deck’s own messages from the deck constructor first, then the messages below.'],
      ['contextMenu', 'Right-click actions', 'On: right-click a card for its actions. Off: DuelingBook’s hover menu (also in Fan and Grid views).'],
      ['quickActions', 'Game actions & macros', 'Native game buttons and guided card macros.'],
      ['quickButtons', 'Draw / Deck buttons', 'Draw, shuffle, mill and banish from the Deck.', 'quickActions'],
      ['cardMacros', 'Card macros', 'Vidolium and Fifty Fifty? on eligible cards.', 'quickActions']
    ]],
    ['Layout', [
      ['adaptiveLayout', 'Adaptive layout', 'Fit the stage to the current window.'],
      ['adaptiveDock', 'Dock chat and panels', 'Use the side or bottom band.', 'adaptiveLayout'],
      ['adaptiveConstructor', 'Wider constructor grid', 'Use spare width for Auto search columns.', 'adaptiveLayout'],
      ['hideZoomNotice', 'Hide zoom notice', 'Hide only the native zoom warning; browser zoom is unchanged.', 'adaptiveLayout']
    ]],
    ['Touch & phone', [
      ['touchControls', 'Touch controls', 'Tap to click, double-tap for the action menu, hold for the right-click menu, drag cards with a finger; dropping on an empty monster zone asks for the position. Swipe lists to scroll; hold briefly, then drag, to pull a card out of one.'],
      ['touchTapMenu', 'Double-tap opens actions', 'Double-tap a card for its action menu (Declare first), or a pile to view it. A single tap previews and clicks. During target selection, and when there is no Spellspeed menu, a double tap is a normal double-click.', 'touchControls'],
      ['touchLayout', 'Fit phone screen', 'On phones, size the page to the screen so the board fills it, and show a full-screen button.', 'touchControls']
    ]],
    ['Visuals', [
      ['theme', 'Theme', 'Night, Classic, Abyss or Ember.'],
      ['animations', 'Smooth animations', 'Movement and declaration effects.'],
      ['cardMotion', 'Card motion', 'Gentle movement and smooth scrolling.', 'animations'],
      ['declareGlow', 'Declare glow', 'Type-colored glow with a brief light sweep.', 'animations'],
      ['fan', 'Animated card fans', 'Fan and Grid pile viewers with per-zone preferences.'],
      ['handHover', 'Hand hover lift', 'Raise your hand cards under the pointer.'],
      ['pileHover', 'Pile hover lift', 'Raise non-empty Deck, Extra Deck, GY and banished piles.'],
      ['darkTextBoxes', 'Dark text boxes', 'Card text, chat, the duel log and text fields on a dark background, whatever the theme. The Night, Abyss and Ember themes are dark already; this matters most for Classic.'],
      ['duelLayout', 'Compact duel layout', 'Phase buttons in a grid, a compact Turn button and life point controls, and Spellspeed’s die, coin, token and counter buttons. Off: DuelingBook’s own.'],
      ['actionHistory', 'Action histories', 'Each player’s recent actions in a panel by their avatar. Off: DuelingBook’s own profiles.'],
      ['hideDeclarationChat', 'Hide declarations in duel chat', 'Keep declarations in player action histories.'],
      ['hideScreenshotButton', 'Hide screenshot button', 'Remove the camera icon from duel and menu screens.'],
      ['hideSummonSpiral', 'Hide native summon spiral', 'Never show DuelingBook’s spinning Special Summon spiral; Smooth animations show soft rings instead.']
    ]],
    ['Sounds', [
      ['sounds', 'Sound enhancements', 'Uses DuelingBook’s mute control.'],
      ['refinedSounds', 'Refined sound effects', 'Card riffles and restrained chimes; thinking from either player.', 'sounds'],
      ['volumeControl', 'Show VFX volume control', 'Show the volume slider beside the native mute control.', 'sounds']
    ]],
    ['Replay & startup', [
      ['replayRewind', 'Replay rewind', 'Back one visible play (←), or go to the start of the turn (Shift+←). Pauses playback. Unavailable while recording or when Enhancer replay controls are present.', 'replay'],
      ['replay', 'Replay enhancements', 'Fast-forward controls and replay videos.'],
      ['replaySpeed', 'Replay speed control', 'Native, 2×, 4×, 8× or 16× fast-forward.', 'replay'],
      ['replayVideo', 'Replay to video', 'A ⏺ Record video button on replays plays them fast-forwarded (2× by default) and downloads a small video file when they end, about 10 MB a minute. Your browser asks which tab to share. A finished Solo duel links to its replay for this.', 'replay'],
      ['skipIntro', 'Skip site intro', 'Go directly to the front page.'],
      ['autoRps', 'Random RPS', 'Automatically choose Rock, Paper or Scissors, including ties.'],
      ['retryLogin', 'Retry when “already logged in”', 'After a network change or a reload, DuelingBook’s duel server keeps your old connection for up to a minute. Press DUEL again every 5 seconds instead of showing the error.']
    ]]
  ];
  const actions = {ok: 'OK / keep going', think: 'Thinking / big think', extra: 'Extra Deck (open / send)', deck: 'Deck (open / send)', grave: 'GY (open / send)', banished: 'Banished (open / send)', hand: 'Hand (hovered card)', declare: 'Declare hovered card', target: 'Target hovered card', sort: 'Sort pile', peek: 'See through', wheel: 'Position wheel on / off'};
  const rows = [], keyButtons = new Map();
  // Top of the panel: how card actions open (the choice with the most friction), then the
  // features people switch most often. Both mirror the same settings as the full list below.
  const quickToggles = [['drag', 'Drag & drop', '⇄'], ['shortcuts', 'Shortcut keys', '⌨'], ['fan', 'Card fans', '🂠'],
    ['animations', 'Animations', '✦'], ['sounds', 'Sounds', '♪']];
  const modeButtons = new Map(), quickButtons = new Map(), themeButtons = new Map(), lookButtons = new Map();
  const normalizedTheme = value => DBLiteRules.settings(value).theme;
  const themes = ['night', 'classic', 'abyss', 'ember'];
  {
    // The look: DBETTER's, or DuelingBook's own with DBETTER's quality-of-life features (Classic).
    const lookTitle = document.createElement('p'); lookTitle.className = 'quick-title'; lookTitle.textContent = 'Look';
    const looks = document.createElement('div'); looks.className = 'menu-mode look-mode'; looks.setAttribute('role', 'radiogroup'); looks.setAttribute('aria-label', 'Look');
    for (const [value, label, detail, theme] of [['dbetter', 'Spellspeed', 'Themes, card fans, animations, action histories and a layout that fits the window.', 'night'],
      ['classic', 'Classic DuelingBook', 'DuelingBook’s own look and layout, still with drag and drop, shortcuts, quick chat, the replay timeline and the constructor extras.', 'classic']]) {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'mode-option'; option.id = 'look-' + value;
      option.setAttribute('role', 'radio'); option.disabled = true;
      const swatch = document.createElement('span'); swatch.className = 'theme-swatch'; swatch.dataset.dbetterTheme = theme; swatch.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.textContent = label; const small = document.createElement('small'); small.textContent = detail; text.append(small);
      option.append(swatch, text); option.addEventListener('click', () => save(DBLiteRules.lookPatch(config, value))); looks.append(option); lookButtons.set(value, option);
    }
    const chooser = document.createElement('div'); chooser.className = 'menu-mode'; chooser.setAttribute('role', 'radiogroup'); chooser.setAttribute('aria-label', 'Card actions');
    const title = document.createElement('p'); title.className = 'quick-title'; title.textContent = 'Card actions';
    for (const [value, label, detail] of [[true, 'Right-click menu', 'Right-click a card for its actions. Hovering only previews it.'],
      [false, 'Hover menu', 'DuelingBook’s own menu appears when you hover a card, also in Fan and Grid views.']]) {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'mode-option'; option.id = value ? 'menu-mode-right' : 'menu-mode-hover';
      option.setAttribute('role', 'radio'); option.disabled = true;
      const picture = document.createElement('span'); picture.className = `mode-picture ${value ? 'mode-right' : 'mode-hover'}`; picture.setAttribute('aria-hidden', 'true');
      picture.append(document.createElement('i'), document.createElement('b'));
      const text = document.createElement('span'); text.textContent = label; const small = document.createElement('small'); small.textContent = detail; text.append(small);
      option.append(picture, text); option.addEventListener('click', () => save({contextMenu: value})); chooser.append(option); modeButtons.set(value, option);
    }
    const essentials = document.createElement('div'); essentials.className = 'essentials';
    for (const [id, label, icon] of quickToggles) {
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'essential'; tile.disabled = true; tile.dataset.setting = id;
      const glyph = document.createElement('span'); glyph.className = 'glyph'; glyph.textContent = icon; glyph.setAttribute('aria-hidden', 'true');
      tile.append(glyph, document.createTextNode(label)); tile.addEventListener('click', () => save({[id]: !config[id]}));
      essentials.append(tile); quickButtons.set(id, tile);
    }
    const essentialsTitle = document.createElement('p'); essentialsTitle.className = 'quick-title'; essentialsTitle.textContent = 'Essentials';
    const themeTitle = document.createElement('p'); themeTitle.className = 'quick-title'; themeTitle.textContent = 'Theme';
    const picker = document.createElement('div'); picker.className = 'theme-picker'; picker.setAttribute('role', 'group'); picker.setAttribute('aria-label', 'Theme');
    for (const name of themes) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'theme-choice'; button.dataset.theme = name; button.disabled = true;
      const swatch = document.createElement('span'); swatch.className = 'theme-swatch'; swatch.setAttribute('aria-hidden', 'true');
      // Local preview tokens leave the surrounding button text in the active theme.
      swatch.dataset.dbetterTheme = name;
      button.append(swatch, document.createTextNode(name[0].toUpperCase() + name.slice(1)));
      button.addEventListener('click', () => save({theme: name})); picker.append(button); themeButtons.set(name, button);
    }
    // Onboarding: the welcome card and the first-visit tips (tour.js) come back on the open DuelingBook tabs.
    const tour = document.createElement('div'); tour.className = 'tour-row';
    const tourButton = document.createElement('button'); tourButton.type = 'button'; tourButton.id = 'tour-reset'; tourButton.disabled = true; tourButton.textContent = 'Show tips again';
    // The Android app (DBETTERApp, from its settings shim) never shows the welcome card: phones get the Spellspeed look.
    const tourNote = document.createElement('small'); tourNote.textContent = window.DBETTERApp ? 'A short tip the first time you reach each part.' : 'The welcome card and a short tip the first time you reach each part.';
    tourButton.addEventListener('click', () => save({ tourSeen: [], tourOff: false }));
    tour.append(tourButton, tourNote);
    $('quick').append(lookTitle, looks, tour, title, chooser, essentialsTitle, essentials, themeTitle, picker);
    try { { const manifest = api.runtime.getManifest(); $('version').textContent = 'v' + (manifest.version_name || manifest.version); } } catch {}
  }
  let config, capturing, queue = Promise.resolve(), ready = false;
  const error = message => { $('error').textContent = message; };
  for (const [title, entries] of groups) {
    const group = document.createElement('details'); group.className = 'settings-category'; group.open = full;
    const summary = document.createElement('summary'); summary.append(Object.assign(document.createElement('span'), {className: 'category-name', textContent: title}), document.createElement('small'));
    // One switch turns a whole category on or off (every listed setting, including sub-options).
    const all = document.createElement('input'); all.type = 'checkbox'; all.className = 'group-toggle'; all.disabled = true;
    all.setAttribute('aria-label', `All ${title} settings`); all.title = `Turn every ${title} setting on or off`;
    all.addEventListener('click', event => event.stopPropagation());
    all.addEventListener('change', () => save(Object.fromEntries(entries.filter(([id]) => id !== 'theme').map(([id]) => [id, all.checked]))));
    summary.insertBefore(all, summary.querySelector('small')); group.append(summary); group.dbliteEntries = entries.filter(([id]) => id !== 'theme').map(([id]) => id);
    for (const [id, label, description, parent] of entries) {
      // The popup lists main switches only, plus the sub-options that change how a plain drop behaves.
      if (!full && parent && !['normalSummon', 'dropWheel'].includes(id)) continue;
      const row = document.createElement('label'); row.className = parent ? 'setting sub-setting' : 'setting'; row.htmlFor = id;
      const text = document.createElement('span'); text.textContent = label;
      const detail = document.createElement('small'); detail.textContent = description; text.append(detail);
      const input = document.createElement(id === 'theme' ? 'select' : 'input'); input.id = id; input.disabled = true;
      if (id === 'theme') for (const name of themes) input.append(Object.assign(document.createElement('option'), {value: name, textContent: name[0].toUpperCase() + name.slice(1)}));
      else input.type = 'checkbox';
      row.append(text, input); group.append(row); rows.push({id, row, input, parent, search: `${title} ${label} ${description}`.toLowerCase()});
      input.addEventListener('change', () => save({[id]: id === 'theme' ? input.value : input.checked}));
    }
    $('categories').append(group);
  }
  // Quick chat messages (full settings page): eight short fields, saved as they change.
  const chatInputs = [];
  if (full && $('chat-settings')) {
    for (let i = 0; i < 8; i++) {
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 40; input.disabled = true;
      input.setAttribute('aria-label', `Quick chat message ${i + 1}`); input.placeholder = `Message ${i + 1}`;
      input.addEventListener('change', () => save({ chatPresets: chatInputs.map(node => node.value) }));
      chatInputs.push(input); $('chat-messages').append(input);
    }
    $('chat-reset').addEventListener('click', () => save({ chatPresets: [...DBLiteRules.defaultChat] }));
  }
  function render() {
    document.documentElement.dataset.dbetterTheme = config.theme;
    for (const [name, button] of themeButtons) { button.setAttribute('aria-pressed', String(config.theme === name)); button.disabled = !ready; }
    chatInputs.forEach((input, i) => { if (document.activeElement !== input) input.value = config.chatPresets[i] || ''; input.disabled = !ready; });
    for (const [value, option] of lookButtons) { option.setAttribute('aria-checked', String(config.look === value)); option.disabled = !ready; }
    $('tour-reset').disabled = !ready;
    for (const [value, option] of modeButtons) { option.setAttribute('aria-checked', String(config.contextMenu === value)); option.disabled = !ready; }
    for (const [id, tile] of quickButtons) { tile.setAttribute('aria-pressed', String(!!config[id])); tile.disabled = !ready; }
    for (const {id, row, input, parent} of rows) {
      if (id === 'theme') input.value = config.theme; else input.checked = config[id]; input.disabled = !ready || !!parent && !config[parent];
      row.classList.toggle('disabled', !!parent && !config[parent]);
    }
    for (const [action, button] of keyButtons) {
      button.textContent = action === capturing ? 'Press a key…' : DBLiteRules.keyLabel(config.keys[action]);
      const sub = ['ok','think'].includes(action) ? 'signalKeys' : ['declare','target'].includes(action) ? 'cardKeys' : action === 'sort' ? 'sortKey' : action === 'peek' ? 'peekKey' : action === 'wheel' ? 'drag' : 'zoneKeys';
      button.disabled = !ready || !config.shortcuts || !config[sub];
    }
    $('vfxVolume').value = config.vfxVolume; $('volume-value').textContent = `${config.vfxVolume}%`;
    $('boardSize').value = config.boardSize; $('board-value').textContent = `${config.boardSize}%`; $('boardSize').disabled = !config.adaptiveLayout;
    for (const group of document.querySelectorAll('.settings-category')) {
      const inputs = [...group.querySelectorAll('.setting input')]; group.querySelector('summary small').textContent = `${inputs.filter(input => input.checked).length} of ${inputs.length} on`;
      const all = group.querySelector('.group-toggle'), on = group.dbliteEntries.filter(id => config[id]).length;
      all.checked = on === group.dbliteEntries.length; all.indeterminate = on > 0 && on < group.dbliteEntries.length; all.disabled = !ready;
    }
    const hints = Object.entries(actions).map(([action, label]) => `${DBLiteRules.keyLabel(config.keys[action])}: ${label}`).join(' · ');
    $('shortcuts').closest('label').querySelector('small').textContent = hints;
  }
  // Serialize read/merge/write patches so rapid edits preserve other controls,
  // remappings and changes made by the page's volume slider or another panel.
  function save(patch, replace = false) {
    const operation = async () => {
      try {
        const current = await api.storage.local.get('settings');
        const merged = replace ? patch : {...current.settings, ...patch, keys: {...current.settings?.keys, ...patch.keys}};
        const settings = DBLiteRules.settings(merged);
        if (patch.keys && Object.entries(patch.keys).some(([action, key]) => settings.keys[action] !== key.toLowerCase())) { error('Shortcut conflicts with a current key. Choose another key.'); return false; }
        await api.storage.local.set({settings}); config = settings; render();
        $('status').textContent = 'Saved · changes apply to open DuelingBook tabs';
        return true;
      } catch { $('status').textContent = 'Could not save settings. Please reopen this panel.'; return false; }
    };
    queue = queue.then(operation); return queue;
  }
  $('search').addEventListener('input', () => {
    const query = $('search').value.trim().toLowerCase(); let any = false;
    for (const item of rows) { item.row.hidden = !item.search.includes(query); if (!item.row.hidden) any = true; }
    for (const group of document.querySelectorAll('.settings-category')) {
      group.hidden = ![...group.querySelectorAll('.setting')].some(row => !row.hidden);
      if (query && !group.hidden) group.open = true;
    }
    for (const button of keyButtons.values()) { const row = button.closest('.key-row'); row.hidden = !row.textContent.toLowerCase().includes(query) && !'keyboard shortcuts remap'.includes(query); if (!row.hidden) any = true; }
    if (full) {
      const matchesVolume = 'vfx volume sound loudness 0-100'.includes(query);
      $('volume-setting').hidden = !matchesVolume; any ||= matchesVolume;
      const matchesBoard = 'board size scale smaller larger layout'.includes(query);
      $('board-setting').hidden = !matchesBoard; any ||= matchesBoard;
      $('key-settings').hidden = ![...keyButtons.values()].some(button => !button.closest('.key-row').hidden);
    }
    $('empty').hidden = any;
  });
  $('all-settings')?.addEventListener('click', () => api.runtime.openOptionsPage());
  if (full) {
    $('key-settings').hidden = $('transfer').hidden = false;
    if ($('chat-settings')) $('chat-settings').hidden = false;
    // Touch screens (the Android app, tablets): no keyboard section, larger controls.
    if (window.matchMedia?.('(pointer: coarse)').matches) { document.body.classList.add('touch'); $('key-settings').hidden = true; }
    for (const [action, label] of Object.entries(actions)) {
      const row = document.createElement('div'); row.className = 'key-row';
      const text = document.createElement('span'); text.textContent = label;
      const button = document.createElement('button'); button.type = 'button'; button.disabled = true; button.dataset.action = action; button.setAttribute('aria-label', `Remap ${label}`);
      button.addEventListener('click', () => { capturing = action; error(''); render(); });
      row.append(text, button); $('key-bindings').append(row); keyButtons.set(action, button);
    }
    document.addEventListener('keydown', event => {
      if (!capturing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { capturing = null; error(''); render(); return; }
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (!DBLiteRules.validKey(event.key) || event.ctrlKey || event.altKey || event.metaKey) { error('Choose a character, navigation or function key without modifiers.'); return; }
      const conflict = Object.keys(config.keys).find(action => action !== capturing && config.keys[action] === key);
      if (conflict) { error(`${DBLiteRules.keyLabel(key)} is already used by ${actions[conflict]}.`); return; }
      const action = capturing; capturing = null; error(''); save({keys: {[action]: key}});
    }, true);
    $('vfxVolume').addEventListener('input', () => save({vfxVolume: Number($('vfxVolume').value)}));
    $('boardSize').addEventListener('input', () => { $('board-value').textContent = `${$('boardSize').value}%`; });
    $('boardSize').addEventListener('change', () => save({boardSize: Number($('boardSize').value)}));
    $('reset').addEventListener('click', () => { $('reset-confirm').hidden = false; $('reset-yes').focus(); });
    $('reset-no').addEventListener('click', () => { $('reset-confirm').hidden = true; $('reset').focus(); });
    $('reset-yes').addEventListener('click', async () => { if (await save({}, true)) { $('reset-confirm').hidden = true; error(''); $('reset').focus(); } });
    $('export').addEventListener('click', async () => {
      await queue;
      try {
        const saved = await api.storage.local.get('settings');
        const blob = new Blob([JSON.stringify(DBLiteRules.settings(saved.settings), null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'dbetter-settings.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        $('status').textContent = 'Exported settings';
      } catch { error('Could not export settings.'); }
    });
    $('import').addEventListener('change', async () => {
      const file = $('import').files[0]; if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw Error('Choose a settings JSON file under 1 MB.');
        const raw = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(file); });
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).some(key => Object.hasOwn(DBLiteRules.defaults, key) || ['keys','vfxVolume','boardSize','theme','nightMode'].includes(key))) throw Error('Expected a Spellspeed settings object.');
        if (Object.entries(value).some(([key, val]) => Object.hasOwn(DBLiteRules.defaults, key) && typeof val !== 'boolean') || value.vfxVolume !== undefined && (!Number.isFinite(value.vfxVolume) || value.vfxVolume < 0 || value.vfxVolume > 100)) throw Error('Invalid setting value.');
        if (Object.hasOwn(value, 'nightMode') && typeof value.nightMode !== 'boolean') throw Error('Invalid legacy theme.');
        if (value.theme !== undefined && !themes.includes(value.theme)) throw Error('Invalid theme.');
        if (!Object.hasOwn(value, 'theme') && Object.hasOwn(value, 'nightMode')) value.theme = normalizedTheme(value);
        if (value.keys !== undefined && (!value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys))) throw Error('Invalid shortcuts object.');
        const normalized = DBLiteRules.settings(value);
        if (value.keys && Object.entries(value.keys).some(([action, key]) => !Object.hasOwn(DBLiteRules.defaultKeys, action) || !DBLiteRules.validKey(key) || normalized.keys[action] !== key.toLowerCase())) throw Error('Invalid or conflicting shortcut keys.');
        // Import is a patch: omitted settings keep their current stored values.
        const patch = Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(normalized, key)));
        const current = await api.storage.local.get('settings');
        const candidate = DBLiteRules.settings({...current.settings, ...patch, keys: {...current.settings?.keys, ...patch.keys}});
        if (patch.keys && Object.entries(patch.keys).some(([action, key]) => candidate.keys[action] !== key.toLowerCase())) throw Error('Imported shortcut conflicts with a current key.');
        if (await save(patch)) { error(''); $('status').textContent = 'Imported settings · changes apply to open tabs'; }
      } catch (cause) { error(cause instanceof SyntaxError ? 'Invalid JSON file.' : cause.message || 'Could not read settings file.'); }
      $('import').value = '';
    });
  }
  try {
    const saved = await api.storage.local.get('settings'); config = DBLiteRules.settings(saved.settings); ready = true; render();
    $('status').textContent = 'Settings apply automatically';
    api.storage.onChanged?.addListener((changes, area) => { if (area === 'local' && changes.settings) { config = DBLiteRules.settings(changes.settings.newValue); capturing = null; render(); } });
  } catch { $('status').textContent = 'Could not load settings. Please reopen this panel.'; }
})();

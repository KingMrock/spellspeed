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
      ['namePeek', 'Hover a named card to see it', 'Point at a card name quoted in the card text (in duels, Solo and the deck constructor) to see that card in a small panel, without clicking. Archetype names that fit several cards have none.', 'previewLinks'],
      ['chatWheel', 'Quick chat wheel', 'A 💬 Chat button in duels opens a wheel of short messages (gg, glhf…): your deck’s own messages from the deck constructor first, then the messages below.'],
      ['contextMenu', 'Right-click actions', 'On: right-click a card for its actions. Off: DuelingBook’s hover menu (also in Fan and Grid views).'],
      ['keepHandRevealed', 'Keep hand revealed', 'DuelingBook’s Show hand button asks: Show once (its own) or Keep revealed; Keep hand revealed is also in the right-click menu of your hand cards. Your whole hand stays revealed to your opponent (Mind Scan and the like), new cards too, with DuelingBook’s own Stay Revealed, until you choose Stop.'],
      ['quickActions', 'Game actions & macros', 'Native game buttons and guided card macros.'],
      ['quickButtons', 'Draw / Deck buttons', 'Draw, shuffle, mill and banish from the Deck.', 'quickActions'],
      ['cardMacros', 'Card macros', 'Vidolium and Fifty Fifty? on eligible cards.', 'quickActions']
    ]],
    ['Layout', [
      ['adaptiveLayout', 'Adaptive layout', 'Fit the stage to the current window.'],
      ['adaptiveDock', 'Dock chat and panels', 'Use the side or bottom band.', 'adaptiveLayout'],
      ['adaptiveConstructor', 'Wider search', 'Use spare width for the search results.'],
      ['guideButton', 'Guide button', 'The 🧭 Guide button above Solo in the deck builder. It hides itself once you have tried every tool; Open the guide in the toolbar menu still opens the checklist.'],
      ['hideZoomNotice', 'Hide zoom notice', 'Hide only the native zoom warning; browser zoom is unchanged.', 'adaptiveLayout']
    ]],
    ['Touch & phone', [
      ['touchControls', 'Touch controls', 'Tap to click, double-tap for the action menu, hold for the right-click menu, drag cards with a finger; dropping on an empty monster zone asks for the position. Swipe lists to scroll; hold briefly, then drag, to pull a card out of one.'],
      ['touchTapMenu', 'Double-tap opens actions', 'Double-tap a card for its action menu (Declare first), or a pile to view it. A single tap previews and clicks. During target selection, and when there is no Spellspeed menu, a double tap is a normal double-click.', 'touchControls'],
      ['touchLayout', 'Fit phone screen', 'On phones, size the page to the screen so the board fills it, and show a full-screen button.', 'touchControls']
    ]],
    ['Visuals', [
      ['animations', 'Smooth animations', 'Movement and declaration effects.'],
      ['cardMotion', 'Card motion', 'Gentle movement and smooth scrolling.', 'animations'],
      ['declareGlow', 'Declare glow', 'Type-colored glow with a brief light sweep.', 'animations'],
      ['fan', 'Animated card fans', 'Fan and Grid pile viewers with per-zone preferences.'],
      ['handHover', 'Hand hover lift', 'Raise your hand cards under the pointer.'],
      ['pileHover', 'Pile hover lift', 'Raise non-empty Deck, Extra Deck, GY and banished piles.'],
      ['darkTextBoxes', 'Dark text boxes', 'Card text, chat, the duel log and text fields on a dark background, whatever the theme. The Night, Abyss and Ember themes are dark already; this matters most for Light.'],
      ['duelLayout', 'Compact duel layout', 'Phase buttons in a grid, a compact Turn button and life point controls, and Spellspeed’s die, coin, token and counter buttons. Off: DuelingBook’s own.'],
      ['actionHistory', 'Action histories', 'Each player’s recent actions in a panel by their avatar. Off: DuelingBook’s own profiles.'],
      ['hideDeclarationChat', 'Hide declarations in duel chat', 'Keep declarations in player action histories.'],
      ['hideScreenshotButton', 'Hide screenshot button', 'Remove the camera icon from duel and menu screens.'],
      ['hideSummonSpiral', 'Hide native summon spiral', 'Never show DuelingBook’s spinning Special Summon spiral; Smooth animations show soft rings instead.']
    ]],
    ['Sounds', [
      ['sounds', 'Sound enhancements', 'Uses DuelingBook’s mute control. Steps aside while DBuddy’s sound pack is on.'],
      ['refinedSounds', 'Refined sound effects', 'Card riffles and restrained chimes; thinking from either player.', 'sounds'],
      ['mellowSounds', 'Mellow sound effects', 'DuelingBook’s own sounds, softer: fewer sharp highs and gentler attacks, at the same loudness. Used instead of Refined sound effects while on.', 'sounds'],
      ['volumeControl', 'Show VFX volume control', 'Show the volume slider beside the native mute control.', 'sounds']
    ]],
    ['Replay & startup', [
      ['replayRewind', 'Replay rewind', 'Back one visible play (←), or go to the start of the turn (Shift+←). Pauses playback. Unavailable while recording or when Enhancer replay controls are present.', 'replay'],
      ['replay', 'Replay enhancements', 'Fast-forward controls and replay videos.'],
      ['replaySpeed', 'Replay speed control', 'Native, 2×, 4×, 8× or 16× fast-forward.', 'replay'],
      ['replayVideo', 'Replay to video', 'A ⏺ Record video button on replays plays them fast-forwarded (2× by default) and downloads a video file when they end: Low, Medium or High quality, about 6, 8 or 24 MB a minute. Your browser asks which tab to share. A finished Solo duel links to its replay for this.', 'replay'],
      ['skipIntro', 'Skip site intro', 'Go directly to the front page.'],
      ['autoRps', 'Random RPS', 'Automatically choose Rock, Paper or Scissors, including ties.'],
      ['retryLogin', 'Retry when “already logged in”', 'After a network change or a reload, DuelingBook’s duel server keeps your old connection for up to a minute. Press DUEL again every 5 seconds instead of showing the error.']
    ]]
  ];
  const actions = {ok: 'OK / keep going', think: 'Thinking / big think', extra: 'Extra Deck (open / send)', deck: 'Deck (open / send)', grave: 'GY (open / send)', banished: 'Banished (open / send)', hand: 'Hand (hovered card)', declare: 'Declare hovered card', target: 'Target hovered card', sort: 'Sort pile', peek: 'See through', wheel: 'Position wheel on / off'};
  const rows = [], keyButtons = new Map(), modeButtons = new Map(), quickButtons = new Map(), lookButtons = new Map(), soundButtons = new Map();
  const normalizedTheme = value => DBLiteRules.settings(value).theme;
  const themes = ['night', 'classic', 'abyss', 'ember'];
  const catalogue = new Map(groups.flatMap(([, entries]) => entries).map(entry => [entry[0], entry]));
  const sections = [
    ['duels', 'Duels', ['drag', 'dragDefense', 'dragSet', 'dragReveal', 'dragAttack', 'normalSummon', 'dropWheel', 'clickDrop', 'doubleClick', 'doubleClickPiles', 'doubleClickSet', 'contextMenu', 'declare', 'keepHandRevealed', 'quickActions', 'quickButtons', 'cardMacros']],
    ['keys', 'Keys', ['shortcuts', 'signalKeys', 'zoneKeys', 'zoneKeysSend', 'cardKeys', 'sortKey', 'peekKey', 'blockAutoFocus']],
    ['deck-builder', 'Deck builder', ['adaptiveConstructor', 'previewLinks', 'namePeek', 'guideButton']],
    ['replays', 'Replays', ['replay', 'replaySpeed', 'replayRewind', 'replayVideo']],
    ['look', 'Look', ['animations', 'cardMotion', 'declareGlow', 'fan', 'handHover', 'pileHover', 'darkTextBoxes', 'duelLayout', 'actionHistory', 'hideScreenshotButton', 'hideSummonSpiral', 'adaptiveLayout', 'adaptiveDock', 'hideZoomNotice']],
    ['sound', 'Sound', ['sounds', 'refinedSounds', 'mellowSounds', 'volumeControl']],
    ['chat', 'Chat', ['chatWheel', 'hideDeclarationChat']],
    ['phone-touch', 'Phone & touch', ['touchControls', 'touchTapMenu', 'touchLayout']],
    ['startup', 'Start-up', ['skipIntro', 'autoRps', 'retryLogin']],
    ['help', 'Help & backup', []]
  ];
  const el = (tag, className, text) => Object.assign(document.createElement(tag), {className: className || '', ...(text === undefined ? {} : {textContent: text})});
  const button = (text, id, handler) => {
    const node = el('button', '', text); node.type = 'button'; if (id) node.id = id;
    node.addEventListener('click', handler); return node;
  };
  const openGuide = item => {
    Promise.resolve(api.runtime.sendMessage({type: 'DBETTER_GUIDE_OPEN', ...(item ? {item} : {})})).catch(() => {});
    if (!full) window.close();
  };
  const openWelcome = hash => {
    Promise.resolve(api.tabs.create({url: api.runtime.getURL('welcome.html') + hash})).catch(() => {});
    if (!full) window.close();
  };
  function lookChooser() {
    const row = el('div', 'setting look-setting'), title = el('p', 'quick-title', 'Look and theme');
    const choices = el('div', 'look-mode'); choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', 'Look and theme');
    for (const [value, label, theme] of [['night', 'Night', 'night'], ['abyss', 'Abyss', 'abyss'], ['ember', 'Ember', 'ember'], ['light', 'Light', 'classic'], ['classic', 'Classic DuelingBook', 'classic']]) {
      const option = button(label, value === 'night' ? 'look-dbetter' : 'look-' + value, () => save(value === 'classic' ? DBLiteRules.lookPatch(config, 'classic') : {...DBLiteRules.lookPatch(config, 'dbetter'), theme}));
      option.className = 'theme-choice'; option.dataset.theme = theme; option.setAttribute('role', 'radio'); option.disabled = true;
      const swatch = el('span', 'theme-swatch'); swatch.dataset.dbetterTheme = theme; swatch.setAttribute('aria-hidden', 'true'); option.prepend(swatch);
      choices.append(option); lookButtons.set(value, option);
    }
    row.append(title, choices);
    if (!window.DBETTERApp && String(api.runtime?.getURL?.('') || '').startsWith('chrome-extension:')) {
      const more = el('p', 'theme-more'), link = el('a', '', 'Check out DBuddy');
      link.href = 'https://chromewebstore.google.com/detail/fpehmkbiafgdeaheeehcbpgahmlkolac'; link.target = '_blank'; link.rel = 'noopener';
      more.append('Want more themes? ', link); row.append(more);
    }
    return row;
  }
  function cardActions(pictures) {
    const chooser = el('div', pictures ? 'menu-mode' : 'segmented'); chooser.setAttribute('role', 'radiogroup'); chooser.setAttribute('aria-label', 'Card actions');
    for (const [value, label, detail] of [[true, pictures ? 'Right-click menu' : 'Right-click', 'Right-click a card for its actions. Hovering only previews it.'], [false, pictures ? 'Hover menu' : 'Hover', 'DuelingBook’s own menu appears when you hover a card, also in Fan and Grid views.']]) {
      const option = button('', value ? 'menu-mode-right' : 'menu-mode-hover', () => save({contextMenu: value}));
      option.className = pictures ? 'mode-option' : ''; option.setAttribute('role', 'radio'); option.disabled = true;
      if (pictures) {
        const picture = el('span', `mode-picture ${value ? 'mode-right' : 'mode-hover'}`); picture.setAttribute('aria-hidden', 'true'); picture.append(el('i'), el('b')); option.append(picture);
      }
      const text = el('span', '', label); if (pictures) text.append(el('small', '', detail)); option.append(text);
      chooser.append(option); modeButtons.set(value, option);
    }
    return chooser;
  }
  if (!full) {
    if (!window.DBETTERApp) {
      const guide = el('section', 'guide-block'); guide.id = 'guide-block';
      const count = el('p', '', '🧭 Guide'); count.id = 'guide-count';
      const progress = el('progress'); progress.id = 'guide-progress'; progress.max = DBLiteRules.guideIds.length; progress.value = 0; progress.setAttribute('aria-label', 'Features tried');
      const controls = el('div', 'actions'); controls.append(button('Open the guide', 'guide-open', () => openGuide()));
      // Hide or bring back the 🧭 Guide button above Solo (user, 2026-11-15: players can take the space back).
      controls.append(button('Hide the button', 'guide-button-toggle', () => save({guideButton: !config.guideButton})));
      if (DBLiteRules.guideVideos.tour) controls.append(button('▶ Video', 'guide-video', () => { Promise.resolve(api.tabs.create({url: DBLiteRules.guideVideos.tour})).catch(() => {}); }));
      const news = button("What's new", 'whats-new', () => { Promise.resolve(api.storage.local.remove?.('whatsNew')).catch(() => {}); openWelcome('#new'); });
      news.hidden = true; controls.append(news);
      Promise.resolve(api.storage.local.get('whatsNew')).then(saved => { news.hidden = !saved?.whatsNew; }).catch(() => {});
      guide.append(count, progress, controls); $('quick').append(guide);
    }
    $('quick').append(lookChooser(), el('p', 'quick-title', 'Card actions'), cardActions(true), el('p', 'quick-title', 'Quick switches'));
    const essentials = el('div', 'essentials');
    for (const [id, label, glyph, keys = [id]] of [['drag', 'Drag', '⇄'], ['shortcuts', 'Keys', '⌨'], ['fan', 'Fans', '🂠'], ['animations', 'Animations', '✦'], ['sounds', 'Sounds', '♪'], ['deck-builder', 'Deck builder', '🃏', ['adaptiveConstructor', 'previewLinks', 'namePeek']]]) {
      const tile = button('', '', () => { const on = keys.every(key => config[key]); save(Object.fromEntries(keys.map(key => [key, !on]))); });
      tile.className = 'essential'; tile.dataset.setting = id; tile.disabled = true; tile.append(el('span', 'glyph', glyph), document.createTextNode(label)); essentials.append(tile); quickButtons.set(keys, tile);
    }
    $('quick').append(essentials);
  }
  try { const manifest = api.runtime.getManifest(); $('version').textContent = 'v' + (manifest.version_name || manifest.version); } catch {}
  let config, capturing, queue = Promise.resolve(), ready = false;
  const error = message => { $('error').textContent = message; };
  const sectionNodes = new Map(), searchExtras = [];
  const searchable = (row, search) => { searchExtras.push({row, search: search.toLowerCase()}); return row; };
  function settingRow(id, title, group) {
    const [, label, description, parent] = catalogue.get(id);
    const row = el('label', parent ? 'setting sub-setting' : 'setting'); row.htmlFor = id;
    const text = el('span', '', label); text.append(el('small', '', description));
    const input = el('input'); input.id = id; input.type = 'checkbox'; input.disabled = true;
    row.append(text, input); group.append(row); rows.push({id, row, input, parent, search: `${title} ${label} ${description}`.toLowerCase()});
    input.addEventListener('change', () => save({[id]: input.checked})); return row;
  }
  for (const [slug, title, ids] of sections) {
    const group = el('section', full ? 'settings-category' : 'search-results'); group.id = 'section-' + slug; sectionNodes.set(slug, group);
    if (full) {
      const heading = el('div', 'section-heading'); heading.append(el('h2', '', title));
      if (ids.length) {
        const all = el('input', 'group-toggle'); all.type = 'checkbox'; all.disabled = true; all.setAttribute('aria-label', `All ${title} settings`); all.title = `Turn every ${title} setting on or off`;
        all.addEventListener('change', () => save(Object.fromEntries(ids.map(id => [id, all.checked])))); heading.append(el('small'), all);
      }
      group.append(heading); group.settingIds = ids;
      const link = el('a', '', title); link.href = '#' + group.id; link.addEventListener('click', () => setCurrent(group)); $('section-menu').append(link);
      if (slug === 'look') group.append(searchable(lookChooser(), 'look theme night abyss ember light classic duelingbook'));
    }
    for (const id of ids) {
      if (full && id === 'mellowSounds') continue;
      if (full && (id === 'contextMenu' || id === 'refinedSounds')) {
        const sound = id === 'refinedSounds', row = el('div', sound ? 'setting sub-setting sound-setting' : 'setting');
        row.append(el('p', '', sound ? 'Sound effects' : 'Card actions'));
        const controls = sound ? el('div', 'segmented') : cardActions(false);
        if (sound) {
          controls.setAttribute('role', 'radiogroup'); controls.setAttribute('aria-label', 'Sound effects');
          for (const [value, label, patch] of [['native', 'DuelingBook', {refinedSounds: false, mellowSounds: false}], ['refined', 'Refined', {refinedSounds: true, mellowSounds: false}], ['mellow', 'Mellow', {mellowSounds: true}]]) {
            const option = button(label, 'sound-' + value, () => save(patch)); option.setAttribute('role', 'radio'); controls.append(option); soundButtons.set(value, option);
          }
        }
        for (const key of sound ? ['refinedSounds', 'mellowSounds'] : ['contextMenu']) {
          const input = el('input'); input.type = 'checkbox'; input.id = key; input.hidden = true; row.append(input);
          rows.push({id: key, row, input, parent: sound ? 'sounds' : undefined, search: `${title} ${row.textContent} ${catalogue.get(key)[1]} ${catalogue.get(key)[2]}`.toLowerCase()});
        }
        row.append(controls); group.append(row);
      } else settingRow(id, title, group);
      if (full && id === 'chatWheel') { group.append(searchable($('chat-settings'), 'chat quick messages presets wheel')); }
    }
    $('categories').append(group);
  }
  function setCurrent(section) {
    for (const link of $('section-menu').querySelectorAll('a')) {
      const current = link.hash === '#' + section.id; link.classList.toggle('current', current);
      if (current) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  }
  if (full) {
    const move = (id, slug, search) => sectionNodes.get(slug).append(searchable($(id), search));
    move('key-settings', 'keys', 'keyboard shortcuts remap'); move('board-setting', 'look', 'board size scale smaller larger layout'); move('volume-setting', 'sound', 'vfx volume sound loudness 0-100');
    const help = sectionNodes.get('help'), helpActions = el('div', 'actions tour-row');
    if (!window.DBETTERApp) helpActions.append(button('Open the guide', 'guide-open', () => openGuide()));
    const reset = button('Show tips again', 'tour-reset', () => save({tourSeen: [], tourOff: false})); reset.disabled = true; helpActions.append(reset);
    const note = el('small', '', window.DBETTERApp ? 'A short tip the first time you reach each part.' : 'The welcome card and a short tip the first time you reach each part.');
    if (!window.DBETTERApp) helpActions.append(button('Setup page', 'welcome-open', () => openWelcome('')));
    note.className = 'help-note'; helpActions.append(note);
    help.append(searchable(helpActions, 'help guide show tips again setup page'), searchable($('transfer'), 'help backup reset defaults export import json preferences'));
    for (const note of [...document.querySelectorAll('main > p.note')]) help.append(searchable(note, note.textContent));
    if (!window.DBETTERApp) {
      const tools = el('div', 'deck-tools'); tools.append(el('p', 'note', 'Most deck-builder tools have no switch. Show me opens DuelingBook and points at the tool.'));
      const grid = el('div', 'tool-grid');
      for (const [item, name] of [['access', 'Access · Starters · Ideas'], ['lab', 'Summon Lab'], ['describe', 'Describe'], ['odds', 'Opening odds 🎲'], ['siding', 'Siding patterns ⇄'], ['history', 'Deck history 🕘']]) {
        const tile = el('div', 'tool-tile'); const show = button('Show me', '', () => openGuide(item)); show.dataset.guideItem = item; show.setAttribute('aria-label', 'Show me ' + name);
        tile.append(el('span', '', name), show); grid.append(tile);
      }
      tools.append(grid); sectionNodes.get('deck-builder').append(searchable(tools, tools.textContent));
    }
    setCurrent(sectionNodes.get('duels'));
    const trackSection = () => {
      const visible = [...sectionNodes.values()].filter(section => !section.hidden);
      const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const current = atEnd ? visible.at(-1) : visible.filter(section => section.getBoundingClientRect().top <= 110).pop() || visible[0]; if (current) setCurrent(current);
    };
    window.addEventListener('scroll', trackSection, {passive: true});
    window.addEventListener('resize', trackSection);
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
    chatInputs.forEach((input, i) => { if (document.activeElement !== input) input.value = config.chatPresets[i] || ''; input.disabled = !ready; });
    const selectedLook = config.look === 'classic' ? 'classic' : config.theme === 'classic' ? 'light' : config.theme;
    for (const [value, option] of lookButtons) { option.setAttribute('aria-checked', String(selectedLook === value)); option.disabled = !ready; }
    if ($('tour-reset')) $('tour-reset').disabled = !ready;
    if ($('guide-count')) { $('guide-count').textContent = `🧭 Guide · ${config.guideDone.length} of ${DBLiteRules.guideIds.length} features tried`; $('guide-progress').value = config.guideDone.length; }
    if ($('guide-button-toggle')) {
      const allTried = config.guideDone.length >= DBLiteRules.guideIds.length, toggle = $('guide-button-toggle');
      toggle.hidden = allTried; toggle.disabled = !ready; toggle.textContent = config.guideButton ? 'Hide the button' : 'Show the button';
      toggle.title = 'The 🧭 Guide button above Solo in the deck builder';
    }
    const sound = config.mellowSounds ? 'mellow' : config.refinedSounds ? 'refined' : 'native';
    for (const [value, option] of soundButtons) { option.setAttribute('aria-checked', String(sound === value)); option.disabled = !ready || !config.sounds; }
    for (const [value, option] of modeButtons) { option.setAttribute('aria-checked', String(config.contextMenu === value)); option.disabled = !ready; }
    for (const [keys, tile] of quickButtons) { tile.setAttribute('aria-pressed', String(keys.every(id => config[id]))); tile.disabled = !ready; }
    for (const {id, row, input, parent} of rows) {
      input.checked = config[id]; input.disabled = !ready || !!parent && !config[parent];
      row.classList.toggle('disabled', !!parent && !config[parent]);
    }
    for (const [action, button] of keyButtons) {
      button.textContent = action === capturing ? 'Press a key…' : DBLiteRules.keyLabel(config.keys[action]);
      const sub = ['ok','think'].includes(action) ? 'signalKeys' : ['declare','target'].includes(action) ? 'cardKeys' : action === 'sort' ? 'sortKey' : action === 'peek' ? 'peekKey' : action === 'wheel' ? 'drag' : 'zoneKeys';
      button.disabled = !ready || !config.shortcuts || !config[sub];
    }
    if (full) {
      $('vfxVolume').value = config.vfxVolume; $('volume-value').textContent = `${config.vfxVolume}%`;
      $('boardSize').value = config.boardSize; $('board-value').textContent = `${config.boardSize}%`; $('boardSize').disabled = !config.adaptiveLayout;
      for (const group of document.querySelectorAll('.settings-category')) {
        const ids = group.settingIds, all = group.querySelector('.group-toggle'); if (!all) continue;
        const on = ids.filter(id => config[id]).length; group.querySelector('.section-heading small').textContent = `${on} of ${ids.length} on`;
        all.checked = on === ids.length; all.indeterminate = on > 0 && on < ids.length; all.disabled = !ready;
      }
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
  function filterSettings() {
    const query = $('search').value.trim().toLowerCase(); let any = false;
    const uniqueRows = new Set(rows.map(item => item.row));
    for (const row of uniqueRows) { row.hidden = !full && !query || !rows.some(item => item.row === row && item.search.includes(query)); if (!row.hidden) any = true; }
    for (const {row, search} of searchExtras) { row.hidden = !search.includes(query); }
    for (const button of keyButtons.values()) {
      const row = button.closest('.key-row'); row.hidden = !row.textContent.toLowerCase().includes(query) && !'keyboard shortcuts remap'.includes(query);
    }
    if (full) {
      $('key-settings').hidden = document.body.classList.contains('touch') || ![...keyButtons.values()].some(button => !button.closest('.key-row').hidden);
      for (const section of sectionNodes.values()) {
        section.hidden = ![...section.children].some(child => !child.classList.contains('section-heading') && !child.hidden);
        const link = $('section-menu').querySelector(`[href="#${section.id}"]`); link.hidden = section.hidden;
        if (!section.hidden) any = true;
      }
      const first = [...sectionNodes.values()].find(section => !section.hidden); if (first) setCurrent(first);
    } else $('categories').hidden = !query;
    $('empty').hidden = !query || any;
  }
  $('search').addEventListener('input', filterSettings);
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
  filterSettings();
  try {
    const saved = await api.storage.local.get('settings'); config = DBLiteRules.settings(saved.settings); ready = true; render();
    $('status').textContent = 'Settings apply automatically';
    api.storage.onChanged?.addListener((changes, area) => { if (area === 'local' && changes.settings) { config = DBLiteRules.settings(changes.settings.newValue); capturing = null; render(); } });
  } catch { $('status').textContent = 'Could not load settings. Please reopen this panel.'; }
})();

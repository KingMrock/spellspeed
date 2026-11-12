/* DBETTER, GPL-3.0-only. Onboarding (user, 2026-10-28): a welcome card that asks for the DBETTER or the Classic
 * DuelingBook look, then a short tip the first time each part is reached (a duel, a card fan, the replay timeline,
 * the deck constructor). Every tip can be skipped; "Show tips again" in the settings brings them back.
 * Seen tips, Skip and the look are saved by the loader (DBLITE_TOUR); this page only asks. */
(() => {
  'use strict';
  if (window.DBETTERTour) return;
  const rules = window.DBLiteRules;
  if (!rules?.settings) return;
  const script = document.currentScript;
  let config = rules.settings((() => { try { return JSON.parse(script?.dataset.settings || '{}'); } catch { return {}; } })());
  // Shown and saved locally at once, so a tip never comes back while the save is on its way.
  const seen = new Set(config.tourSeen);
  let off = config.tourOff, open = null, timer = null, waiting = null;
  const started = performance.now();

  const html = document.documentElement;
  const phone = () => html.classList.contains('dbetter-phone');
  const app = () => html.classList.contains('dbetter-app');
  const key = action => rules.keyLabel(config.keys[action]);
  const visible = node => {
    if (!node?.isConnected) return false;
    const box = node.getBoundingClientRect(), css = getComputedStyle(node);
    return box.width > 4 && box.height > 4 && css.visibility !== 'hidden' && css.display !== 'none' &&
      box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  };
  const first = (...selectors) => selectors.map(selector => document.querySelector(selector)).find(visible) || null;
  const settingsWhere = () => app() ? 'the ⚙ button in the corner' : 'the Spellspeed icon in the browser toolbar';
  const playing = () => !!window.duel_active && !!window.duelist && !window.replay && /^duel_start/.test(window.currentLabel || '') &&
    visible(document.getElementById('duel'));
  // Phones and the app (user, 2026-10-29): fingers tap, double-tap and hold; nothing is pointed at or clicked.
  const tap = () => phone() || app();
  const builderSearch = () => first('#deck_constructor .dblite-builder-search');
  const handCard = () => {
    const card = window.player1?.hand_arr?.find?.(card => visible(card?.[0]))?.[0];
    return card || first('#duel #field');
  };
  // Where the hand cards are. The duel tip waits until this stays the same (user, 2026-11-09: in Solo the Drag and
  // drop tip appeared during the deal and jumped from card to card as they were dealt).
  const handPlace = () => (window.player1?.hand_arr || []).map(card => card?.[0]).filter(visible)
    .map(node => { const box = node.getBoundingClientRect(); return Math.round(box.left) + ',' + Math.round(box.top); }).join(' ');

  // Each tip: when it applies, then its steps. A step without a target is centred on the page.
  const tips = [
    { id: 'duel', when: playing, settle: handPlace, steps: () => [
      config.drag && { target: handCard, title: 'Drag and drop', text: config.dropWheel
        ? 'Drag a card onto a zone to play it. On an empty zone a wheel asks how: SS Attack up, SS Defense down, Normal on the right, Set on the left.'
        : tap() ? 'Drag a card onto a zone to play it.' : 'Drag a card onto a zone to play it. Shift plays it in Defense or face-down, Ctrl Normal Summons, Alt Sets.' },
      { target: handCard, title: 'Card actions', text: tap()
        // touch.js: a hold is a right-click; a double tap opens the same menu (touchTapMenu) or is a double-click.
        ? (config.touchTapMenu && config.contextMenu ? 'Double-tap or hold a card for its actions.' : config.contextMenu ? 'Hold a card for its actions.' : 'Tap a card for DuelingBook’s action menu.') +
          (config.declare && !config.touchTapMenu ? ' Double-tap a card to declare it.' : '')
        : (config.contextMenu ? 'Right-click a card for its actions.' : 'Hover a card for DuelingBook’s action menu.') +
          (config.declare ? ' Double-click a card to declare it.' : '') },
      { target: () => first('.dbetter-touch-bar [aria-label="Find a card"]', '.dblite-find-card'), title: 'Find a card',
        text: 'Look up any card by name or by its text, and read it in the card preview: handy for your opponent’s cards.' },
      config.chatWheel && { target: () => first('.dblite-chat-row .dblite-chat-wheel-button', '.dbetter-chat-corner', '.dblite-chat-wheel-button'), title: 'Quick chat',
        text: `Short messages (gg, glhf, ty…) in two ${tap() ? 'taps' : 'clicks'}. Each deck can have its own in the deck constructor.` },
      config.shortcuts && !tap() && { title: 'Shortcut keys', text: `${key('ok')} OK, ${key('think')} Thinking. ${key('deck')}, ${key('extra')}, ${key('grave')} and ${key('banished')} open your Deck, Extra Deck, GY and banished cards; over one of your cards they send it there. ${key('declare')} declares and ${key('target')} targets the card under the pointer. Every key can be changed in the settings: ${settingsWhere()}.` }
    ].filter(Boolean) },
    { id: 'viewer', when: () => config.fan && !!first('.dblite-fan'), steps: () => [
      { target: () => first('.dblite-fan'), title: 'Card fans', text: `Piles open as a fan. Drag a card out of it to play it, or type to search the pile.${config.shortcuts && !tap() ? ` ${key('sort')} sorts, ${key('peek')} shows the board through it.` : ''} Fan, Grid and Classic switch the view for each zone; ⚙ sets its size and transparency.` }
    ] },
    { id: 'replay', when: () => !!first('#dblite-timeline'), steps: () => [
      { target: () => first('#dblite-timeline'), title: 'Replay timeline', text: `${tap() ? 'Tap' : 'Click'} or drag the bar to go to any play. ▶ plays at 1×, 2× or 4× with the duel’s sounds; « and » skip fast and silently; ‹ and › go one play.${tap() ? '' : ' Space plays and pauses.'} Going back is instant once a play has been seen.` }
    ] },
    // Only in the constructor itself: a read-only deck page (deck?id=…) shows #deck_constructor without the card
    // search, and its tips showed untargeted and counted as seen (pre-launch pass, 2026-10-29). The card text is not
    // required: on phones it shows only once a card is tapped.
    { id: 'constructor', when: () => visible(document.getElementById('deck_constructor')) && !!builderSearch(),
      still: () => visible(document.getElementById('deck_constructor')), steps: () => [
      { target: builderSearch, title: 'Card search', text: 'Search by name, text and filters. The results use the space beside your deck.' },
      config.previewLinks && { target: () => first('#preview_txt'), title: 'Card text links', text: `${tap() ? 'Tap' : 'Point at'} a card to read it in the card preview. In its text, names, Types, Levels and other phrases are links: ${tap() ? 'tap' : 'click'} one to list the matching cards. Under the text, Access lists the cards that can get this one out of the Deck.` }
    ].filter(Boolean) }
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(label, action, className = '') {
    const node = element('button', 'dbetter-tour-button ' + className, label); node.type = 'button';
    // The board's own handlers (drag, clicks through to cards) never see the tour's clicks.
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) node.addEventListener(type, event => event.stopPropagation());
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
    return node;
  }
  function tell(message) { window.postMessage({ type: 'DBLITE_TOUR', ...message }, location.origin); }
  function markSeen(id) { if (seen.has(id)) return; seen.add(id); tell({ seen: id }); }
  function skipAll() { off = true; tell({ off: true }); close(); }

  function close() {
    if (!open) return;
    open.root.remove(); open.ring?.remove(); open.cleanup?.();
    open = null;
  }

  function welcome() {
    const root = element('div', 'dbetter-tour dbetter-tour-welcome');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'dbetter-tour-title');
    const card = element('div', 'dbetter-tour-card');
    const title = element('h2', '', 'Welcome to Spellspeed'); title.id = 'dbetter-tour-title';
    const intro = element('p', '', 'Choose a look. You can change it at any time in the settings: ' + settingsWhere() + '.');
    const choices = element('div', 'dbetter-tour-looks');
    const choose = look => { tell({ look, seen: 'welcome' }); seen.add('welcome'); close(); };
    for (const [look, label, detail] of [
      ['dbetter', 'Spellspeed', 'Themes, card fans, animations, action histories by the avatars and right-click card actions.'],
      ['classic', 'Classic DuelingBook', 'DuelingBook’s own look, layout and menus, with drag and drop, shortcut keys, quick chat, the replay timeline and the deck constructor extras.']]) {
      const option = button('', () => choose(look), 'dbetter-tour-look');
      option.dataset.look = look; option.setAttribute('aria-pressed', String(config.look === look));
      option.append(element('strong', '', label), element('span', '', detail));
      choices.append(option);
    }
    const foot = element('div', 'dbetter-tour-foot');
    foot.append(element('span', '', 'Short tips follow the first time you reach a duel, a replay or the deck constructor.'), button('Skip tips', () => { markSeen('welcome'); skipAll(); }, 'dbetter-tour-skip'));
    card.append(title, intro, choices, foot); root.append(card);
    const keys = event => { if (event.key === 'Escape') { event.stopPropagation(); markSeen('welcome'); close(); } };
    document.addEventListener('keydown', keys, true);
    document.body.append(root);
    open = { id: 'welcome', root, cleanup: () => document.removeEventListener('keydown', keys, true) };
    choices.querySelector(`[data-look="${config.look}"]`)?.focus({ preventScroll: true });
  }

  function show(tip) {
    const steps = tip.steps();
    if (!steps.length) { markSeen(tip.id); return; }
    let index = 0;
    const root = element('div', 'dbetter-tour dbetter-tour-tip'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-live', 'polite');
    const ring = element('div', 'dbetter-tour-ring'); ring.setAttribute('aria-hidden', 'true');
    const title = element('strong', 'dbetter-tour-title'), text = element('p', 'dbetter-tour-text');
    const count = element('span', 'dbetter-tour-count');
    const next = button('', () => { if (++index >= steps.length) { markSeen(tip.id); close(); } else render(); }, 'dbetter-tour-next');
    const skip = button('Skip tips', () => { markSeen(tip.id); skipAll(); }, 'dbetter-tour-skip');
    const arrow = element('i', 'dbetter-tour-arrow');
    const row = element('div', 'dbetter-tour-row'); row.append(count, skip, next);
    root.append(arrow, title, text, row);
    root.addEventListener('mousedown', event => event.stopPropagation());
    // Escape also reaches the page, so the same key closes the tip and, say, the card fan under it.
    const keys = event => { if (event.key === 'Escape' && open?.root === root) { markSeen(tip.id); close(); } };
    document.addEventListener('keydown', keys, true);
    document.body.append(ring, root);
    const place = () => {
      // Nothing of the tour changes while a replay play is recorded: the rewind tape watches the whole page.
      if (window.DBETTERRebuilding) return;
      const step = steps[index], target = step.target?.();
      const margin = 8, gap = 12, width = root.offsetWidth, height = root.offsetHeight;
      if (!target) {
        ring.hidden = true; arrow.hidden = true;
        root.style.left = Math.max(margin, (innerWidth - width) / 2) + 'px'; root.style.top = Math.max(margin, (innerHeight - height) / 2) + 'px';
        return;
      }
      const box = target.getBoundingClientRect();
      ring.hidden = false;
      Object.assign(ring.style, { left: box.left - 4 + 'px', top: box.top - 4 + 'px', width: box.width + 8 + 'px', height: box.height + 8 + 'px' });
      // Above the target when it fits, else below, else beside it; always inside the window.
      let side = box.top - gap - height >= margin ? 'above' : box.bottom + gap + height <= innerHeight - margin ? 'below'
        : box.right + gap + width <= innerWidth - margin ? 'right' : 'left';
      let left, top;
      if (side === 'above' || side === 'below') {
        left = Math.min(innerWidth - margin - width, Math.max(margin, box.left + box.width / 2 - width / 2));
        top = side === 'above' ? box.top - gap - height : box.bottom + gap;
      } else {
        top = Math.min(innerHeight - margin - height, Math.max(margin, box.top + box.height / 2 - height / 2));
        left = side === 'right' ? box.right + gap : Math.max(margin, box.left - gap - width);
      }
      root.style.left = left + 'px'; root.style.top = top + 'px'; root.dataset.side = side;
      arrow.hidden = false;
      if (side === 'above' || side === 'below') { arrow.style.left = Math.min(width - 18, Math.max(10, box.left + box.width / 2 - left - 6)) + 'px'; arrow.style.top = ''; }
      else { arrow.style.top = Math.min(height - 18, Math.max(10, box.top + box.height / 2 - top - 6)) + 'px'; arrow.style.left = ''; }
    };
    const render = () => {
      const step = steps[index];
      title.textContent = step.title; text.textContent = step.text;
      count.textContent = steps.length > 1 ? `${index + 1} / ${steps.length}` : '';
      next.textContent = index + 1 < steps.length ? 'Next' : 'Got it';
      place();
    };
    addEventListener('resize', place); addEventListener('scroll', place, true);
    open = { id: tip.id, root, ring, place, still: tip.still || tip.when, cleanup: () => { removeEventListener('resize', place); removeEventListener('scroll', place, true); document.removeEventListener('keydown', keys, true); } };
    render();
  }

  function check() {
    if (off || document.hidden || window.DBETTERRebuilding || !document.body) return;
    if (open) {
      // A tip whose part was closed (the fan, the constructor, the duel) counts as seen.
      if (open.still && !open.still()) { markSeen(open.id); close(); } else open.place?.();
      return;
    }
    if (!seen.has('welcome')) {
      // Phones and the Android app (user, 2026-10-28): no choice, the DBETTER look; Classic is not made for a phone.
      // The phone class is set by touch.js after the page fits: wait a moment before deciding.
      if (performance.now() - started < 1500) return;
      if (phone() || app()) { markSeen('welcome'); return; }
      // Never over a duel in progress: the welcome waits for the next page outside one.
      if (!playing()) welcome();
      return;
    }
    const tip = tips.find(tip => !seen.has(tip.id) && tip.when());
    if (!tip) { waiting = null; return; }
    // A tip with `settle` shows once its target has kept still for three checks in a row (about 1.4 s).
    if (tip.settle) {
      const place = tip.settle();
      if (waiting?.id !== tip.id || waiting.place !== place) { waiting = { id: tip.id, place, still: 0 }; return; }
      if (++waiting.still < 2) return;
    }
    waiting = null; show(tip);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_SETTINGS') return;
    const next = rules.settings(event.data.settings);
    // "Show tips again" in the settings clears the list and Skip.
    if (!next.tourSeen.length && !next.tourOff) { seen.clear(); close(); }
    for (const id of next.tourSeen) seen.add(id);
    off = next.tourOff; config = next;
    if (off) close();
    else if (open?.id === 'welcome') open.root.querySelectorAll('[data-look]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.look === config.look)));
  });

  const style = element('style'); style.id = 'dbetter-tour-style';
  style.textContent = `
    .dbetter-tour{position:fixed;z-index:2147483643;box-sizing:border-box;font:13px/1.4 'Segoe UI',Arial,sans-serif;color:var(--ssp-text,#e6eeea);text-align:left}
    .dbetter-tour *{box-sizing:border-box}
    .dbetter-tour-welcome{inset:0;display:grid;place-items:center;background:#0009;padding:16px}
    .dbetter-tour-card{width:min(520px,100%);max-height:100%;overflow:auto;padding:20px;border-radius:12px;background:var(--ssp-panel,#242c2e);border:1px solid var(--ssp-line,#3a4548);box-shadow:0 12px 40px #000a}
    .dbetter-tour-card h2{margin:0 0 6px;font-size:20px;color:inherit}
    .dbetter-tour-card p{margin:0 0 14px;color:var(--ssp-muted,#a3b2b8)}
    .dbetter-tour .dbetter-tour-looks{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .dbetter-tour .dbetter-tour-look{display:flex;flex-direction:column;gap:4px;padding:12px;text-align:left;border-radius:9px;cursor:pointer;color:inherit;background:var(--ssp-input,#1b2224);border:1px solid var(--ssp-line,#3a4548);font:inherit}
    .dbetter-tour .dbetter-tour-look strong{font-size:15px}
    .dbetter-tour .dbetter-tour-look span{font-size:12px;color:var(--ssp-muted,#a3b2b8)}
    .dbetter-tour .dbetter-tour-look:hover,.dbetter-tour .dbetter-tour-look:focus-visible{border-color:var(--ssp-accent,#4fc3b5);outline:none}
    .dbetter-tour .dbetter-tour-look[aria-pressed="true"]{border-color:var(--ssp-accent,#4fc3b5);box-shadow:inset 0 0 0 1px var(--ssp-accent,#4fc3b5)}
    .dbetter-tour-foot{display:flex;align-items:center;gap:10px;margin-top:14px;font-size:12px;color:var(--ssp-muted,#a3b2b8)}
    .dbetter-tour-foot>span{flex:1}
    .dbetter-tour-button{font:inherit;cursor:pointer;color:inherit;background:none;border:0;padding:4px 8px;border-radius:6px}
    .dbetter-tour-skip{color:var(--ssp-muted,#a3b2b8);text-decoration:underline;text-underline-offset:2px;font-size:12px}
    .dbetter-tour-next{background:var(--ssp-accent,#4fc3b5);color:var(--ssp-on-accent,#071512);font-weight:700;padding:5px 14px}
    .dbetter-tour-tip{width:min(300px,calc(100vw - 16px));padding:12px 14px 10px;border-radius:10px;background:var(--ssp-panel,#242c2e);border:1px solid var(--ssp-accent,#4fc3b5);box-shadow:0 8px 28px #000b;pointer-events:auto}
    .dbetter-tour-title{display:block;font-size:14px;margin-bottom:4px}
    .dbetter-tour-text{margin:0 0 8px}
    .dbetter-tour-row{display:flex;align-items:center;gap:6px}
    .dbetter-tour-count{flex:1;font-size:11px;color:var(--ssp-muted,#a3b2b8)}
    .dbetter-tour-arrow{position:absolute;width:12px;height:12px;background:inherit;border:inherit;border-width:0 1px 1px 0;transform:rotate(45deg)}
    .dbetter-tour-tip[data-side="above"] .dbetter-tour-arrow{bottom:-7px}
    .dbetter-tour-tip[data-side="below"] .dbetter-tour-arrow{top:-7px;transform:rotate(225deg)}
    .dbetter-tour-tip[data-side="right"] .dbetter-tour-arrow{left:-7px;transform:rotate(135deg)}
    .dbetter-tour-tip[data-side="left"] .dbetter-tour-arrow{right:-7px;transform:rotate(-45deg)}
    .dbetter-tour-ring{position:fixed;z-index:2147483642;border-radius:8px;box-shadow:0 0 0 2px var(--ssp-accent,#4fc3b5),0 0 0 6px #4fc3b533;pointer-events:none}
    html.dbetter-phone .dbetter-tour{font-size:12px}
    html.dbetter-phone .dbetter-tour-looks{grid-template-columns:1fr}
  `;
  (document.head || html).append(style);

  window.DBETTERTour = { check, close, tips: () => tips.map(tip => tip.id), get open() { return open?.id || null; } };
  timer = setInterval(check, 700);
  check();
})();

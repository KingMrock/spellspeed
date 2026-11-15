/* Spellspeed, GPL-3.0-only. See NOTICE.txt.
 * A deck-builder checklist and coaches that follow the controls on the page. */
(() => {
  'use strict';
  if (window.DBETTERGuide) return;
  const rules = window.DBLiteRules;
  if (!rules?.guideItems) return;
  let config = rules.settings((() => { try { return JSON.parse(document.currentScript?.dataset.settings || '{}'); } catch { return {}; } })());
  const items = rules.guideItems, ids = rules.guideIds, done = new Set(config.guideDone), uses = new Map(), saving = new Set();
  let dock = null, expanded = null, coach = null, whole = null, pending = null, launch = null;
  const copy = {
    search: 'Type a name or words from the card text, or use the filters, then Search. Results use the space beside your deck.',
    describe: 'Under More options, describe cards in plain words, like “spellcaster that searches”. Each part becomes a chip you can remove.',
    recent: '↶ goes back to your previous search. Recent lists your last ten.',
    links: 'Names, Types and Levels in the card text are links: click one to list the matching cards. Point at a quoted name to see that card.',
    access: 'Point at a card, then click Access under its text: every card that can get it out of the Deck. ⚙ sets what counts.',
    starters: 'Starters lists the cards that reach this one from your opening hand, alone or in two steps. Sure lines come first.',
    ideas: 'Ideas lists every line of one or two cards that gets this card, with what each line needs.',
    lab: 'Pick materials, or Any monster of a kind, and Find lists every Fusion, Synchro, Xyz and Link Monster they can make.',
    labMain: 'In Summon Lab, choose From my Main Deck, then Find: the Extra Deck monsters your Main Deck can make.',
    odds: '🎲 shows how often this deck opens with a starter. Mark the starters (S) and the rest, or let Suggest roles do it.',
    lines: 'In Solo, the Line view in the Actions panel goes back to any step, plays the line again, saves it for this deck and shares it as a code.',
    siding: '⇄ keeps your siding plan for each matchup, going first and second, with a PDF to print. It needs a Side Deck.',
    sidePlan: "Between games of a match, ⇄ Side plan on DuelingBook's siding screen plays a saved siding pattern for you. Done Siding stays yours.",
    history: '🕘 keeps every saved version of this deck, shows what changed, and loads an older one.',
    chat: "💬 sets this deck's own quick chat lines. They come first in the 💬 Chat wheel in duels."
  };
  const query = selector => document.querySelector(selector);
  const visible = node => {
    if (!node?.isConnected) return false;
    for (let current = node; current; current = current.parentElement) {
      const css = getComputedStyle(current);
      if (current.hidden || css.display === 'none' || css.visibility === 'hidden') return false;
    }
    const box = node.getBoundingClientRect();
    return box.width > 4 && box.height > 4 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  };
  const first = selector => [...document.querySelectorAll(selector)].find(visible) || null;
  const ready = () => visible(query('#deck_constructor')) && !!query('#deck_constructor .dblite-builder-search');
  const buttonWanted = () => config.guideButton !== false && done.size < ids.length;
  const playing = () => !!window.duel_active && !!window.duelist && !window.replay && /^duel_start/.test(window.currentLabel || '') && visible(query('#duel'));
  const chips = () => !!query('.dblite-describe-chips')?.children.length;
  const labelShows = id => [...document.querySelectorAll('.dblite-fetch-label')].some(node => new RegExp('^⤺\\s*' + ({ access: 'Access to', starters: 'Starters for', ideas: 'Ideas for' }[id])).test(node.textContent.trim()));
  const hasDeck = () => !!window.deck_filled_arr?.length;
  const link = () => first('#preview_txt .dblite-card-ref:not(.dblite-fetch-ref)');
  const panel = id => first('section.dblite-' + ({ chat: 'deck-chat' }[id] || id));
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, act, className = '') {
    const node = element('button', className, text); node.type = 'button';
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) node.addEventListener(type, event => event.stopPropagation());
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!window.DBETTERRebuilding) act(); });
    return node;
  }
  function video(text, href) {
    const node = element('a', '', text); node.href = href; node.target = '_blank'; node.rel = 'noopener'; return node;
  }
  function tick(id, used = false) {
    if (window.DBETTERRebuilding) return;
    if (used) uses.set(id, (uses.get(id) || 0) + 1);
    if (done.has(id)) return;
    done.add(id); saving.add(id); window.postMessage({ type: 'DBLITE_TOUR', done: id }, location.origin); progress();
  }
  function progress() {
    if (launch) launch.textContent = done.size === ids.length ? '🧭 Guide ✓' : `🧭 Guide · ${done.size} of ${ids.length}`;
    if (!dock) return;
    dock.querySelector('progress').value = done.size;
    dock.querySelector('.dbetter-guide-progress').textContent = done.size === ids.length
      ? `All ${ids.length} tried · the Guide button now hides itself; open the Guide from the Spellspeed menu`
      : `${done.size} of ${ids.length} tried · each one ticks itself when you use it`;
    dock.querySelectorAll('[data-item]').forEach(row => {
      const used = done.has(row.dataset.item); row.classList.toggle('is-done', used);
      // The check is drawn in CSS (bold, theme text-on-accent), like DuelingBook's checked boxes in night.css.
      row.querySelector('.dbetter-guide-tick').textContent = '';
      row.querySelector('.dbetter-guide-tick').setAttribute('aria-label', used ? 'Tried' : 'Not tried');
    });
  }
  function close() { if (window.DBETTERRebuilding) return; dock?.remove(); dock = null; }
  function open() {
    if (window.DBETTERRebuilding || !document.body || dock) return;
    dock = element('aside', 'dbetter-guide'); dock.setAttribute('role', 'dialog'); dock.setAttribute('aria-label', 'Spellspeed guide');
    const head = element('header'); head.append(element('strong', '', '🧭 Spellspeed guide'), button('×', close, 'dbetter-guide-close'));
    head.lastChild.setAttribute('aria-label', 'Close guide');
    const bar = element('progress'); bar.max = ids.length; bar.setAttribute('aria-label', 'Tools tried');
    dock.append(head, button('Take the whole tour', startTour, 'dbetter-guide-tour'), bar, element('p', 'dbetter-guide-progress'));
    const list = element('div', 'dbetter-guide-list');
    for (const [group, title] of rules.guideGroups) {
      list.append(element('h4', '', title));
      for (const item of items.filter(item => item.group === group)) {
        const row = element('div', 'dbetter-guide-item'); row.dataset.item = item.id;
        const toggle = button('', () => {
          expanded = expanded === item.id ? null : item.id;
          dock.querySelectorAll('[data-item]').forEach(node => {
            const active = node.dataset.item === expanded; node.querySelector('.dbetter-guide-detail').hidden = !active;
            node.querySelector('button').setAttribute('aria-expanded', String(active));
          });
        }, 'dbetter-guide-toggle');
        toggle.setAttribute('aria-expanded', String(expanded === item.id));
        toggle.append(element('span', 'dbetter-guide-tick'), element('span', 'dbetter-guide-item-title', item.title));
        const detail = element('div', 'dbetter-guide-detail'); detail.hidden = expanded !== item.id;
        detail.append(element('p', '', copy[item.id]), button('Show me', () => showItem(item.id), 'dbetter-guide-primary'));
        if (rules.guideVideos.items[item.id]) detail.append(video('▶ Clip', rules.guideVideos.items[item.id]));
        row.append(toggle, detail); list.append(row);
      }
    }
    dock.append(list);
    if (rules.guideVideos.tour) dock.append(video('▶ Watch the video (90 s)', rules.guideVideos.tour));
    document.body.append(dock); progress();
  }
  const menuLabels = { odds: 'Opening odds', siding: 'Siding patterns', history: 'Deck history', chat: 'Quick chat' };
  const control = id => first('.dblite-' + ({ chat: 'deck-chat' }[id] || id) + '-button') ||
    [...document.querySelectorAll('section.dblite-deck-menu button')].find(node => visible(node) && node.textContent.includes(menuLabels[id])) || null;
  function stepsFor(id) {
    const title = items.find(item => item.id === id).title;
    const wasDone = done.has(id), previous = uses.get(id) || 0;
    const tried = () => (uses.get(id) || 0) > previous || !wasDone && done.has(id);
    const step = (target, text, act, done) => ({ target, title, text, act, done });
    // DuelingBook fills the deck a moment after the constructor shows (seen live): wait for it rather than give up.
    const needDeck = ['labMain', 'odds', 'siding', 'history'].includes(id) && !hasDeck();
    const clickControl = (id, text) => step(() => control(id), text, () => control(id)?.click(), () => !!panel(id));
    const moreOptions = () => step(() => first('details.dblite-builder-more summary'), 'Open More options.', () => { const node = query('details.dblite-builder-more'); if (node) node.open = true; }, () => !!query('details.dblite-builder-more')?.open);
    const openLab = () => step(() => first('button.dblite-lab-open'), 'Open the Summon Lab.', () => first('button.dblite-lab-open')?.click(), () => !!panel('lab'));
    const labSteps = () => panel('lab') ? [] : [...(query('details.dblite-builder-more') && !query('details.dblite-builder-more').open ? [moreOptions()] : []), openLab()];
    const preview = () => step(() => first('#deck_constructor .deck_cards'), 'Point at any card in your deck to read it.', null, () => !!first('#preview_txt .dblite-card-ref'));
    if (['links', 'access', 'starters', 'ideas'].includes(id) && !config.previewLinks) return [step(null, 'Card text links are off. Turn on Clickable names in card preview in the settings (Deck builder), then try again.')];
    let steps;
    switch (id) {
      case 'search': steps = [step(() => first('.dblite-search-text input, .dblite-builder-search input[type="search"]'), 'Type part of a card name, then press Enter or Search.', null, tried)]; break;
      case 'describe': steps = [
        moreOptions(),
        step(() => first('.dblite-describe input'), 'Describe cards in plain words, then press Enter.', () => {
          const input = query('.dblite-describe input'); if (!input) return;
          input.value = 'spellcaster that searches'; input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }, chips)]; break;
      case 'recent': steps = query('.dblite-history-back')?.disabled !== false
        ? [step(null, 'Run a search first, then come back here.')]
        : [step(() => first('.dblite-history-back'), copy.recent, () => first('.dblite-history-back')?.click(), tried)]; break;
      case 'links': steps = [...(!link() ? [preview()] : []), step(link, 'Click a highlighted name, Type or Level.', () => link()?.click(), tried)]; break;
      case 'access': case 'starters': case 'ideas': {
        const target = () => first(`#preview_txt .dblite-fetch-ref[data-mode="${id}"]`);
        steps = [...(!target() ? [preview()] : []), step(target, `Click ${id[0].toUpperCase() + id.slice(1)} under the card text.`, () => target()?.click(), () => labelShows(id))];
        if (id === 'access') steps.push(step(() => first('button.dblite-access-gear'), '⚙ sets what counts: add, Summon, Set, send, banish.'));
        break;
      }
      case 'lab': steps = [...labSteps(), step(() => first('.dblite-lab-slots'), 'Drag cards into the slots, or use ＋ Material to choose Any. Then Find.')]; break;
      case 'labMain': steps = [...labSteps(),
        step(() => first('.dblite-lab-mode'), 'Choose From my Main Deck.', () => { const select = query('.dblite-lab-mode'); if (select) { select.value = 'deck'; select.dispatchEvent(new Event('change', { bubbles: true })); } }, () => query('.dblite-lab-mode')?.value === 'deck'),
        step(() => first('.dblite-lab-find'), 'Find.', () => first('.dblite-lab-find')?.click(), tried)]; break;
      case 'odds': steps = [clickControl(id, 'Open Opening odds.'), step(() => [...document.querySelectorAll('section.dblite-odds .dblite-odds-tabs button')].find(node => visible(node) && node.textContent.trim() === 'Cards and roles') || first('.dblite-odds-tabs'), 'In Cards and roles, mark the starters (S) and the rest, or press Suggest roles.')]; break;
      case 'siding': steps = [clickControl(id, 'Open Siding patterns.'), step(() => first('.dblite-siding-list'), 'Add a matchup, choose what goes in and out for game 2 and 3, then Export PDF.')]; break;
      case 'history': steps = [clickControl(id, 'Open Deck history.'), step(() => panel(id), 'Each save adds a version. Compare two versions, or load an older one.')]; break;
      case 'chat': steps = [clickControl(id, 'Open quick chat for this deck.'), step(() => panel(id), 'Up to eight lines for this deck, shown first in the duel’s 💬 Chat wheel.')]; break;
      case 'lines': steps = [step(() => first('div.dblite-solo-launch > button'), 'Start Solo with this deck. After your first play, press Line in the Actions panel.')]; break;
      case 'sidePlan': steps = [step(() => control('siding'), 'In a best-of-3 match, DuelingBook’s siding screen gets ⇄ Side plan above Swap Cards. Save your patterns here with ⇄ first.')]; break;
    }
    const menuId = id === 'sidePlan' ? 'siding' : id;
    if (menuLabels[menuId] && !control(menuId) && first('.dblite-deck-more') && !panel(menuId)) steps.unshift(step(() => first('.dblite-deck-more'), 'Open ⋯ Deck.', () => first('.dblite-deck-more')?.click(), () => !!first('section.dblite-deck-menu')));
    if (needDeck) steps.unshift({ ...step(null, 'Pick or import a deck first: the deck list under the buttons, or Import Deck.', null, hasDeck), wait: 'Waiting for a deck…' });
    return steps;
  }
  function removeCoach() { coach?.root.remove(); coach?.ring.remove(); coach = null; }
  function end() { if (window.DBETTERRebuilding) return; pending = null; removeCoach(); whole?.strip.remove(); whole = null; open(); }
  function place() {
    if (window.DBETTERRebuilding || !coach) return;
    const { root, ring, arrow, step } = coach, target = step.target?.();
    const margin = 8, gap = 12, width = root.offsetWidth, height = root.offsetHeight;
    if (!visible(target)) {
      ring.hidden = true; arrow.hidden = true;
      root.style.left = Math.max(margin, (innerWidth - width) / 2) + 'px'; root.style.top = Math.max(margin, (innerHeight - height) / 2) + 'px'; return;
    }
    const box = target.getBoundingClientRect(); ring.hidden = false;
    Object.assign(ring.style, { left: box.left - 4 + 'px', top: box.top - 4 + 'px', width: box.width + 8 + 'px', height: box.height + 8 + 'px' });
    const side = box.top - gap - height >= margin ? 'above' : box.bottom + gap + height <= innerHeight - margin ? 'below' : box.right + gap + width <= innerWidth - margin ? 'right' : 'left';
    let left, top;
    if (side === 'above' || side === 'below') {
      left = Math.min(innerWidth - margin - width, Math.max(margin, box.left + box.width / 2 - width / 2)); top = side === 'above' ? box.top - gap - height : box.bottom + gap;
    } else {
      top = Math.min(innerHeight - margin - height, Math.max(margin, box.top + box.height / 2 - height / 2)); left = side === 'right' ? box.right + gap : Math.max(margin, box.left - gap - width);
    }
    root.style.left = left + 'px'; root.style.top = top + 'px'; root.dataset.side = side; arrow.hidden = false;
    if (side === 'above' || side === 'below') { arrow.style.left = Math.min(width - 18, Math.max(10, box.left + box.width / 2 - left - 6)) + 'px'; arrow.style.top = ''; }
    else { arrow.style.top = Math.min(height - 18, Math.max(10, box.top + box.height / 2 - top - 6)) + 'px'; arrow.style.left = ''; }
  }
  function runSteps(steps, finish, index = 0) {
    removeCoach();
    if (index >= steps.length) { finish(); return; }
    const step = steps[index], root = element('div', 'dbetter-guide-coach'), ring = element('div', 'dbetter-guide-ring'), arrow = element('i', 'dbetter-guide-arrow');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', step.title); ring.setAttribute('aria-hidden', 'true');
    const next = () => { if (!window.DBETTERRebuilding) runSteps(steps, finish, index + 1); };
    const row = element('div', 'dbetter-guide-actions');
    if (step.done) {
      root.append(element('p', 'dbetter-guide-wait', step.wait || 'Waiting for your click…'));
      if (step.act) row.append(button('Do it for me', step.act, 'dbetter-guide-primary'));
      row.append(button('Skip', next));
    } else row.append(button(step.nextLabel || (index + 1 < steps.length ? 'Next' : 'Got it'), next, 'dbetter-guide-primary'));
    row.append(button(whole ? 'End tour' : 'End', end));
    root.prepend(arrow, element('strong', 'dbetter-guide-title', step.title), element('p', '', step.text)); root.append(row);
    document.body.append(ring, root); coach = { root, ring, arrow, step, next }; place();
  }
  function finishItem() {
    if (!whole) { removeCoach(); open(); return; }
    const item = whole.queue[whole.index];
    runSteps([{ title: item.title, text: 'Ready for the next feature?', nextLabel: 'Next feature ›' }], () => {
      if (++whole.index >= whole.queue.length) { end(); return; } runItem(whole.queue[whole.index].id);
    });
  }
  function runItem(id) {
    if (whole) {
      const item = items.find(item => item.id === id), group = rules.guideGroups.find(([group]) => group === item.group)[1];
      whole.label.textContent = `🧭 Tour · ${group} · ${whole.index + 1} of ${whole.queue.length}`;
    }
    if (!ready()) {
      runSteps([{ title: 'Deck Constructor', text: 'Open the Deck Constructor first.', target: () => first('#deck_btn'), done: ready }], () => runItem(id)); return;
    }
    if (['search', 'describe', 'recent'].includes(id) && panel('lab')) query('.dblite-lab-back')?.click();
    if (['search', 'describe'].includes(id)) document.querySelectorAll('.dblite-builder-search .dblite-fetch-clear').forEach(node => { if (visible(node)) node.click(); });
    runSteps(stepsFor(id), finishItem);
  }
  function request(tour, id) {
    if (window.DBETTERRebuilding) return;
    removeCoach(); whole?.strip.remove(); whole = null; pending = null;
    if (!ready()) {
      open(); pending = { tour, id, until: Date.now() + 600000 };
      runSteps([{ title: 'Deck Constructor', text: 'Open the Deck Constructor first.', target: () => first('#deck_btn'), done: ready }], () => check()); return;
    }
    close();
    if (tour) {
      const undone = items.filter(item => !done.has(item.id)), queue = undone.length ? undone : [...items];
      const strip = element('div', 'dbetter-guide-strip'), label = element('span'); strip.append(label, button('End tour', end)); document.body.append(strip);
      whole = { strip, label, queue, index: 0 }; runItem(queue[0].id);
    } else runItem(id);
  }
  function showItem(id) { if (ids.includes(id)) request(false, id); }
  function startTour() { request(true); }
  function detect(event) {
    if (window.DBETTERRebuilding) return;
    const target = event.target;
    if (event.type === 'click') {
      const search = target.closest?.('.dblite-builder-search button');
      if (search?.textContent.trim() === 'Search') tick('search', true);
      if (target.closest?.('.dblite-history-back')) tick('recent', true);
      if (target.closest?.('#preview_txt .dblite-card-ref:not(.dblite-fetch-ref)')) tick('links', true);
      if (target.closest?.('.dblite-lab-find') && panel('lab') && query('.dblite-lab-mode')?.value === 'deck') tick('labMain', true);
    }
    if (event.type === 'keydown' && event.key === 'Enter' && target.matches?.('input,select,textarea') && target.closest('.dblite-builder-search')) tick('search', true);
    if (event.type === 'change' && target.matches?.('.dblite-history-recent')) tick('recent', true);
  }
  function check() {
    if (window.DBETTERRebuilding || !document.body) return;
    if (chips()) tick('describe');
    for (const id of ['access', 'starters', 'ideas']) if (labelShows(id)) tick(id);
    for (const id of ['lab', 'odds', 'siding', 'history', 'chat']) if (panel(id)) tick(id);
    if (first('.dblite-duel-side')) tick('sidePlan');
    if (query('.dblite-line-toggle[aria-pressed="true"]')) tick('lines');
    // The button above Solo: off in the settings (Guide button), or gone once every tool was tried (user, 2026-11-15);
    // the Spellspeed menu's Open the guide still opens the checklist.
    if (ready() && buttonWanted()) {
      const solo = query('#deck_constructor div.dblite-solo-launch');
      if (solo && (!launch?.isConnected || launch.nextElementSibling !== solo)) {
        launch?.remove(); launch = button('', () => dock ? close() : open(), 'dbetter-guide-button'); solo.before(launch); progress();
      }
      if (solo && launch) {
        const css = getComputedStyle(solo), top = (parseFloat(css.top) || solo.offsetTop) - 27;
        const placement = { top: top + 'px', left: css.left || '3px', width: css.width || '200px' };
        for (const [key, value] of Object.entries(placement)) if (launch.style[key] !== value) launch.style[key] = value;
        const preview = query('#deck_constructor #preview_txt');
        if (preview) {
          const height = Math.max(40, top - (parseFloat(getComputedStyle(preview).top) || 300) - 7) + 'px', root = query('#deck_constructor');
          if (root.style.getPropertyValue('--ssp-guide-text-height') !== height) root.style.setProperty('--ssp-guide-text-height', height);
        }
      }
    } else if (launch?.isConnected) { launch.remove(); launch = null; }
    if (playing()) { close(); removeCoach(); if (whole) { whole.strip.remove(); whole.paused = true; } return; }
    if (whole?.paused && ready()) { whole.paused = false; document.body.append(whole.strip); finishItem(); return; }
    if (pending) {
      if (Date.now() > pending.until) { pending = null; removeCoach(); return; }
      if (ready()) { const next = pending; pending = null; request(next.tour, next.id); return; }
    }
    if (coach?.step.done?.()) coach.next(); else place();
  }
  for (const type of ['click', 'keydown', 'change']) document.addEventListener(type, detect, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !coach) close(); }, true);
  addEventListener('resize', place); addEventListener('scroll', place, true);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || window.DBETTERRebuilding) return;
    if (event.data?.type === 'DBLITE_SETTINGS') {
      config = rules.settings(event.data.settings);
      for (const id of config.guideDone) saving.delete(id);
      done.clear(); for (const id of [...config.guideDone, ...saving]) done.add(id); progress();
    }
    if (event.data?.type === 'DBLITE_GUIDE_OPEN') {
      if (event.data.tour === true) startTour(); else if (ids.includes(event.data.item)) showItem(event.data.item); else open();
    }
  });
  const style = element('style'); style.id = 'dbetter-guide-style';
  style.textContent = `
    .dbetter-guide,.dbetter-guide-coach,.dbetter-guide-strip{position:fixed;box-sizing:border-box;z-index:2147483643;font:13px/1.4 'Segoe UI',Arial,sans-serif;text-align:left;color:var(--ssp-text,#e6eeea);background:var(--ssp-panel,#242c2e);border:1px solid var(--ssp-accent,#4fc3b5);box-shadow:0 8px 28px #000b}
    .dbetter-guide *,.dbetter-guide-coach *{box-sizing:border-box}
    .dbetter-guide{right:12px;top:64px;width:min(300px,calc(100vw - 16px));max-height:calc(100vh - 80px);display:flex;flex-direction:column;border-radius:10px;padding:12px;gap:8px}
    .dbetter-guide header{display:flex;align-items:center;justify-content:space-between;gap:6px}
    .dbetter-guide button,.dbetter-guide-coach button,.dbetter-guide-strip button{font:inherit;cursor:pointer;border:0;border-radius:6px;background:none;color:inherit;padding:4px 8px}
    .dbetter-guide a,.dbetter-guide .dbetter-guide-tour{color:var(--ssp-accent,#4fc3b5);text-decoration:underline;text-align:left}
    .dbetter-guide progress{width:100%;height:6px;flex-shrink:0;accent-color:var(--ssp-accent,#4fc3b5)}
    .dbetter-guide-progress{font-size:11px;color:var(--ssp-muted,#a3b2b8);margin:0}
    .dbetter-guide-list{min-height:0;overflow-y:auto}
    .dbetter-guide h4{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--ssp-accent,#4fc3b5);margin:14px 0 6px}
    .dbetter-guide-toggle{display:flex;align-items:center;gap:8px;width:100%;text-align:left}
    .dbetter-guide-tick{position:relative;display:inline-block;flex:0 0 18px;height:18px;border:1.5px solid var(--ssp-muted,#a3b2b8);border-radius:4px}
    .dbetter-guide .is-done .dbetter-guide-tick{background:var(--ssp-accent,#4fc3b5);border-color:var(--ssp-accent,#4fc3b5)}
    .dbetter-guide .is-done .dbetter-guide-tick::after{content:'';position:absolute;left:5px;top:1px;width:5px;height:10px;border:solid var(--ssp-on-accent,#071512);border-width:0 3px 3px 0;transform:rotate(45deg)}
    .dbetter-guide .is-done .dbetter-guide-item-title{color:var(--ssp-muted,#a3b2b8)}
    .dbetter-guide-detail{padding:0 8px 10px 32px;font-size:12px}.dbetter-guide-detail p{margin:6px 0 10px}.dbetter-guide-detail a{margin-left:10px}
    .dbetter-guide [hidden],.dbetter-guide-ring[hidden],.dbetter-guide-arrow[hidden]{display:none!important}
    .dbetter-guide-button{box-sizing:border-box;display:block;width:200px;max-width:100%;height:24px;position:absolute;left:3px;cursor:pointer;border:1px solid var(--ssp-line,#3a4548);border-radius:4px;background:var(--ssp-input,#1b2224);color:var(--ssp-accent,#4fc3b5);font:12px/20px 'Segoe UI',Arial,sans-serif;padding:0 6px;z-index:2}
    html #deck_constructor.dblite-overview-sized:has(.dbetter-guide-button) #preview_txt,#deck_constructor:has(.dbetter-guide-button) #preview_txt{max-height:var(--ssp-guide-text-height,125px)!important}
    .dbetter-guide-coach{z-index:2147483645;width:min(300px,calc(100vw - 16px));padding:12px 14px 10px;border-radius:10px}
    .dbetter-guide-title{display:block;font-size:14px}.dbetter-guide-coach p{margin:6px 0 8px}.dbetter-guide-wait{font-size:11px;color:var(--ssp-muted,#a3b2b8)}
    .dbetter-guide-actions{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap}
    .dbetter-guide .dbetter-guide-primary,.dbetter-guide-coach .dbetter-guide-primary{background:var(--ssp-accent,#4fc3b5);color:var(--ssp-on-accent,#071512);font-weight:700}
    .dbetter-guide-ring{position:fixed;z-index:2147483644;border-radius:8px;box-shadow:0 0 0 2px var(--ssp-accent,#4fc3b5),0 0 0 6px #4fc3b533;pointer-events:none}
    .dbetter-guide-arrow{position:absolute;width:12px;height:12px;background:inherit;border:inherit;border-width:0 1px 1px 0;transform:rotate(45deg)}
    .dbetter-guide-coach[data-side="above"] .dbetter-guide-arrow{bottom:-7px}.dbetter-guide-coach[data-side="below"] .dbetter-guide-arrow{top:-7px;transform:rotate(225deg)}
    .dbetter-guide-coach[data-side="right"] .dbetter-guide-arrow{left:-7px;transform:rotate(135deg)}.dbetter-guide-coach[data-side="left"] .dbetter-guide-arrow{right:-7px;transform:rotate(-45deg)}
    .dbetter-guide-strip{inset:0 0 auto;height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;z-index:2147483645;font-size:12px}
  `;
  (document.head || document.documentElement).append(style);
  window.DBETTERGuide = { open, openDock: open, close, startTour, showItem, get done() { return ids.filter(id => done.has(id)); }, items };
  setInterval(check, 700); check();
})();

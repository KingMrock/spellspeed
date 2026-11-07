/* DBETTER, GPL-3.0-only. Replay timeline: play, step, jump, scan and scrub through a replay in both
   directions. Positions come from the rewind core's change tape; integration stays separate from the core. */
(() => {
  'use strict';
  if (!/^\/replay(?:\.php)?\/?$/.test(location.pathname) || window.DBETTERRewind) return;
  const rules = window.DBLiteRules, core = window.DBRewind;
  if (!rules || !core || !window.DBETTERReplayCapture) return;
  let config = rules.settings(JSON.parse(document.currentScript?.dataset.settings || '{}'));
  let captured = false, taken = false;
  // A video recording steps the timeline aside (DuelingBook's own playback), unless the recording plays through the
  // timeline (user, 2026-10-29: the video played DuelingBook's old way, not at the timeline's speed).
  let recordingHere = false;
  const recording = () => !recordingHere && (document.documentElement.classList.contains('dblite-recording') || !!window.DBETTERRecorder?.recording());
  const enhancer = () => !!window.DBXPreviousState || !!document.querySelector('#prev_btn,#previous_btn,#dbx-prev-btn,#dbx-previous-state') ||
    [...document.querySelectorAll('#duel button,#duel input[type="button"],#duel input[type="submit"]')].some(n => /^(?:Prev|Previous)(?: Play| State)?$/i.test(n.value || n.textContent.trim()));
  // Replays of Solo duels too (user, 2026-10-28): DuelingBook flags them solo; a live Solo duel is never a replay.
  const enabled = () => config.replay && config.replayRewind && captured && window.replay && !enhancer() && !!window.player1?.all_cards_arr;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const PHASES = { DP: 'Draw Phase', SP: 'Standby Phase', M1: 'Main Phase 1', BP: 'Battle Phase', M2: 'Main Phase 2', EP: 'End Phase' };
  // Playback follows the replay's pace at 1-4x, with its sounds; fast forward/backward (scanning) is the quick,
  // silent way through (user, 2026-10-28: 8x was too close to it).
  const SPEEDS = [1, 2, 4];
  const SCAN_MS = 50;
  // Touch on the track: a finger that lifts within this many pixels of where it landed tapped.
  const TAP_SLOP = 8;

  // Turns, phases and games of the loaded replay. Up to the furthest recorded play these are what DuelingBook
  // actually played; beyond it, the entries still ahead, less those it is known to drop unplayed.
  let marks = null, marksKey = '';
  function analyse() {
    const ignored = window.IGNORED_PLAYS || [], h = core.history?.();
    const done = h?.played.length ? h.played : window.previous_plays || [];
    const rest = (h?.played.length ? h.ahead : window.replay_arr || []).filter(p => !ignored.includes(p?.play));
    const key = `${done.length}:${rest.length}:${h?.ended}:${done[0]?.seconds ?? rest[0]?.seconds}`;
    if (marks && key === marksKey) return marks;
    const all = done.concat(rest), turns = [], phases = [], games = [{ pos: 0, game: 1 }];
    let turn = 0;
    all.forEach((p, i) => {
      const name = p?.play || '';
      if (name === 'Begin next duel' || name === 'Back to RPS') { games.push({ pos: i, game: games.length + 1 }); turn = 0; }
      else if (name === 'Pick first' || name === 'Start turn') {
        const who = p.username || (Array.isArray(p.log) ? p.log[0]?.username : p.log?.username) || '';
        turns.push({ pos: i + 1, turn: ++turn, who, game: games.length });
      } else if (/^Enter (DP|SP|M1|BP|M2|EP)$/.test(name)) phases.push({ pos: i + 1, phase: name.slice(6) });
    });
    marksKey = key;
    return marks = { all, total: all.length, turns, phases, games };
  }
  const position = () => (window.previous_plays || []).length;
  const lastAt = (list, pos) => { let found = null; for (const item of list) { if (item.pos > pos) break; found = item; } return found; };
  function describe(pos) {
    const m = analyse(), turn = lastAt(m.turns, pos), game = lastAt(m.games, pos);
    const phase = turn ? lastAt(m.phases.filter(p => p.pos >= turn.pos), pos) : null;
    return { turn, game, phase: phase ? PHASES[phase.phase] : turn ? 'Draw Phase' : '', play: pos > 0 ? m.all[pos - 1]?.play : 'Start', multi: m.games.length > 1 };
  }
  function label(pos) {
    const d = describe(pos);
    const where = d.turn ? `T${d.turn.turn}${d.phase ? ' · ' + d.phase : ''}${d.turn.who ? ' · ' + d.turn.who : ''}` : 'Before the duel';
    return (d.multi && d.game ? `G${d.game.game} · ` : '') + where;
  }

  // Plays that change nothing on screen are skipped by the step buttons, as by DuelingBook's own rewind lists.
  const invisible = p => (window.FAST_PLAYS || []).concat(window.PLAYS_TO_SPEED_UP_WHEN_REWINDING || []).includes(p?.play) || !!p?.play?.startsWith('View');
  function stepFrom(pos, n) {
    const all = analyse().all;
    if (n < 0) {
      for (let k = 0; k < -n && pos > 0; k++) {
        while (pos > 0 && invisible(all[pos - 1])) pos--;
        if (pos > 0) pos--;
        while (pos > 0 && invisible(all[pos - 1])) pos--;
      }
    } else for (let k = 0; k < n && pos < all.length; k++) {
      pos++;
      while (pos < all.length && invisible(all[pos - 1])) pos++;
    }
    return pos;
  }
  function turnFrom(pos, direction) {
    const turns = analyse().turns;
    if (direction < 0) { const prev = turns.filter(t => t.pos < pos).pop(); return prev ? prev.pos : 0; }
    const next = turns.find(t => t.pos > pos); return next ? next.pos : analyse().total;
  }

  // Transitions: cards glide from where they were to where the new position put them, in both directions, and a card
  // that turned over turns while it travels. Positions are measured on screen: a move can take a card to another
  // container (from the field into the hand), whose coordinates differ. CSS translate/rotate/scale on the real cards
  // and an additive transform on their centred layer: no copies, and no style writes for the change tape to see.
  const cards = () => [window.player1, window.player2, window.player3, window.player4].flatMap(p => p?.all_cards_arr || []).map(c => c?.[0]).filter(el => el?.isConnected);
  const faceShown = el => el.querySelector(':scope > .content > .cardfront')?.style.display === 'block';
  // The centre of the card on screen, its centred layer and that layer's screen box; null while it isn't drawn.
  function onScreen(el) {
    const layer = el.querySelector(':scope > .content'), r = (layer || el).getBoundingClientRect();
    return r.width || r.height ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, layer, r } : null;
  }
  // Whose hand the card is in (1 to 4), or 0.
  const handOf = el => [window.player1, window.player2, window.player3, window.player4].findIndex(p => p?.hand_arr?.some?.(c => c?.[0] === el)) + 1;
  function placement() {
    const map = new Map();
    for (const el of cards()) { const t = el._gsTransform, at = onScreen(el); map.set(el, [at?.x, at?.y, t?.rotation || 0, t?.scaleX || 1, faceShown(el), handOf(el)]); }
    return map;
  }
  function glide(before, ms) {
    if (!before || !ms || reduceMotion.matches) return;
    // Standard ease-in-out: a front-loaded curve made cards dart, since a move's first frame can come late.
    const easing = 'cubic-bezier(.4,0,.2,1)';
    for (const el of cards()) {
      const b = before.get(el), t = el._gsTransform, at = onScreen(el);
      if (!at) continue;
      if (!b || b[0] == null) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing }); continue; }
      // The order inside a hand doesn't matter (user, 2026-10-28): a shuffled or reordered hand takes its new places
      // at once instead of every card crossing the others.
      if (b[5] && b[5] === handOf(el)) continue;
      // Screen pixels per pixel of the card's container, from the card's own size on screen.
      const own = Math.abs(t?.scaleX || 1), size = Math.max(at.layer?.offsetWidth || 0, at.layer?.offsetHeight || 0);
      const k = size && own ? Math.max(at.r.width, at.r.height) / (size * own) || 1 : 1;
      const dx = (b[0] - at.x) / k, dy = (b[1] - at.y) / k;
      const dr = b[2] - (t?.rotation || 0), ds = (t?.scaleX || 1) ? b[3] / (t?.scaleX || 1) : 1;
      const turned = b[4] !== faceShown(el) && at.layer && config.animations !== false;
      if (turned) at.layer.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: Math.max(140, ms * .9), easing, composite: 'add' });
      if (Math.abs(dx) + Math.abs(dy) < 0.5 && Math.abs(dr) < 0.5 && Math.abs(ds - 1) < 0.01) continue;
      el.animate([{ translate: `${dx}px ${dy}px`, rotate: `${dr}deg`, scale: `${ds}`, zIndex: 9000 }, { translate: '0px 0px', rotate: '0deg', scale: '1', zIndex: 9000 }], { duration: ms, easing });
    }
  }

  // Cues: the tape applies a play's result at once, so moving forward through a play also replays a light version
  // of what normal playback shows, scaled to the playback speed: the sounds DuelingBook played (recorded with the
  // tape), DBETTER's declaration glow on declared and activated cards, a ring on targeted cards, the attacker's
  // lunge and a landing pulse on summoned cards (cards that turn over do it in the glide).
  const GLOWS = ['Declare', 'Activate ST', 'Activate Field Spell', 'Activate Pendulum Left', 'Activate Pendulum Right', 'Activate skill'];
  const SUMMONS = ['Normal Summon', 'SS ATK', 'SS DEF', 'Flip Summon', 'Summon Token', 'Set monster', 'Overlay', 'OL ATK', 'OL DEF'];
  const SPARKS = [[8,0,-12,-18],[35,0,-4,-22],[68,0,6,-19],[95,0,15,-16],[100,30,21,-7],[100,72,18,9],[92,100,12,18],[64,100,3,22],[30,100,-6,18],[4,100,-15,15],[0,67,-20,5],[0,25,-18,-9]];
  const cueTimers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { cueTimers.delete(id); fn(); }, ms); cueTimers.add(id); };
  // A new move drops what the previous one had not started yet.
  const cancelCues = () => { for (const id of cueTimers) clearTimeout(id); cueTimers.clear(); };
  const motion = () => config.animations !== false && !reduceMotion.matches;
  function cardById(id) {
    if (id == null) return null;
    const all = [window.player1, window.player2, window.player3, window.player4].flatMap(p => p?.all_cards_arr || []);
    return all.find(c => c?.data?.('id') == id) || all.find(c => c?.data?.('prev_ids')?.includes?.(id)) || null;
  }
  function content(card) { const node = card?.[0]?.querySelector(':scope > .content'); return node?.isConnected && node.getClientRects().length ? node : null; }
  // DBETTER's declaration glow (workbench's look), on the card's centred layer so it follows the card.
  function glow(card, primary, secondary, rate, sparks) {
    const anchor = content(card);
    if (!anchor || config.animations === false || config.declareGlow === false) return;
    const node = element('div', 'dblite-declare-glow'); node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('--dblite-declare-color', primary); node.style.setProperty('--dblite-declare-secondary', secondary);
    node.classList.toggle('dblite-pendulum-glow', primary !== secondary);
    const style = getComputedStyle(anchor), rect = anchor.getBoundingClientRect();
    const scale = Math.max(.05, Math.max(rect.width, rect.height) / Math.max(parseFloat(style.width) || 400, parseFloat(style.height) || 580));
    Object.assign(node.style, { width: '100%', height: '100%' });
    node.style.setProperty('--dblite-declare-stroke', `${2.5 / scale}px`); node.style.setProperty('--dblite-declare-radius', `${4 / scale}px`);
    node.style.setProperty('--dblite-declare-blur', `${13 / scale}px`); node.style.setProperty('--dblite-declare-px', `${1 / scale}px`);
    if (sparks) SPARKS.forEach(([x, y, dx, dy], i) => {
      const spark = element('i', 'dblite-declare-spark');
      spark.style.cssText = `left:${x}%;top:${y}%;--spark-x:calc(${dx} * var(--dblite-declare-px));--spark-y:calc(${dy} * var(--dblite-declare-px));animation-delay:${i % 3 * 70}ms`;
      if (y > 50) spark.style.background = 'var(--dblite-declare-secondary)';
      node.append(spark);
    });
    anchor.append(node); anchor.classList.add('dblite-declaring');
    for (const animation of node.getAnimations({ subtree: true })) animation.playbackRate = rate;
    setTimeout(() => { node.remove(); if (!anchor.querySelector('.dblite-declare-glow')) anchor.classList.remove('dblite-declaring'); }, 1900 / rate + 50);
  }
  // Additive transforms on the centred layer scale and turn the card about its own centre, on top of GSAP's.
  function pulse(card, keyframes, ms, delay = 0) {
    const anchor = content(card);
    if (anchor && motion()) anchor.animate(keyframes, { duration: ms, delay, easing: 'cubic-bezier(.2,.8,.3,1)', composite: 'add' });
  }
  function lunge(attacker, defender, rate) {
    const el = attacker?.[0], toward = defender?.[0] || attacker?.data?.('controller')?.opponent?.main_arr?.[0]?.[0];
    if (!el?.isConnected || !toward || !motion()) return;
    const dx = defender ? (parseFloat(toward.style.left) || 0) - (parseFloat(el.style.left) || 0) : 0;
    const dy = (parseFloat(toward.style.top) || 0) - (parseFloat(el.style.top) || 0);
    el.animate([{ translate: '0px 0px' }, { translate: `${dx * .3}px ${dy * .3}px`, offset: .45 }, { translate: '0px 0px' }],
      { duration: 480 / rate, easing: 'cubic-bezier(.3,.7,.4,1)', composite: 'add' });
  }
  function cues(from, to, budget, glideMs) {
    // Playback runs its cues at the playback speed; a step the viewer takes runs them in full.
    const m = analyse(), rate = budget === Infinity ? 1 : speed, plays = [];
    for (let pos = from + 1; pos <= to; pos++) if (!invisible(m.all[pos - 1])) plays.push(pos);
    // A coalesced move (key repeat, clicks): the last two visible plays only.
    for (const pos of plays.slice(-2)) {
      const play = m.all[pos - 1], name = play?.play;
      const side = play?.username === window.player1?.username ? 'var(--dbt-you,#c8424a)' : 'var(--dbt-opponent,#3c9bb5)';
      // Every sound of the play: they make a replay easier to follow. One that would come after the next move (which
      // cancels what has not started) is brought forward to just before it. Scanning runs no cues.
      const sounds = core.effects?.(pos)?.sounds || [];
      for (const { at, args } of sounds) later(() => { try { window.playSound?.(...args); } catch {} }, Math.min(at / rate, Math.max(0, budget - 40)));
      if (GLOWS.includes(name)) {
        const card = cardById(play.id), palette = rules.cardPalette?.(card?.data?.('cardfront')) || { primary: side, secondary: side };
        if (card) glow(card, palette.primary, palette.secondary, rate, true);
      } else if (name === 'Target card') {
        const card = cardById(play.id); if (card) glow(card, side, side, rate, false);
      } else if (name === 'Attack' || name === 'Attack directly') {
        const attacker = cardById(name === 'Attack' ? play.attacking_id : play.id), defender = name === 'Attack' ? cardById(play.attacked_id) : null;
        lunge(attacker, defender, rate);
        if (defender) later(() => glow(defender, side, side, rate, false), 200 / rate);
      } else if (SUMMONS.includes(name)) {
        pulse(cardById(play.id ?? play.end_id), [{ transform: 'scale(1.16)' }, { transform: 'scale(1)' }], 320 / rate, glideMs);
      }
    }
  }

  // Seeks are coalesced: clicks, key repeats and scanning ticks that arrive before the change is applied make one
  // move. Playback and scanning advance from the target, so a slow first visit never piles up.
  // resume: playing before a fast scan began; turning the scan off (or reaching the start) goes back to it.
  let target = null, scheduled = false, dragging = false, playing = false, scan = 0, speed = 1, playTimer = 0, resume = false;
  // scrub: a finger on the track ({ id, x, pct, pos, playing, scan }); the bar shows the finger's place, not the board's.
  let scrub = null;
  // cue: forward moves made by playing or stepping replay the cues of their plays, within this many milliseconds.
  function request(pos, ms, fromPlayer = false, cue = 0) {
    if (!enabled() || recording()) return;
    if (!fromPlayer) { scan = 0; clearTimeout(playTimer); }
    const total = analyse().total;
    target = { pos: Math.max(0, Math.min(total, pos)), ms: target ? Math.max(target.ms, ms) : ms, cue: target ? Math.max(target.cue, cue) : cue };
    if (scheduled) return;
    scheduled = true; ui.root?.classList.add('dblite-tl-busy'); render();
    // Let the pressed state paint first: a first visit to a stretch of the replay records it, which takes time.
    requestAnimationFrame(() => setTimeout(run, 0));
  }
  function run() {
    scheduled = false;
    const { pos, ms, cue } = target; target = null;
    // Recording a video or turning the timeline off since the request: the move no longer applies.
    if (!enabled() || recording()) { ui.root?.classList.remove('dblite-tl-busy'); render(); return; }
    const consistent = core.status().tape?.consistent;
    if (pos !== position() || !consistent) {
      const from = position(), before = ms ? placement() : null;
      cancelCues();
      try { window.pauseE?.(); core.seek(pos); }
      catch (error) { console.warn('Spellspeed rewind:', error); playing = false; scan = 0; }
      glide(before, ms);
      if (cue && position() > from) cues(from, position(), cue, ms);
    }
    ui.root?.classList.remove('dblite-tl-busy'); render(); schedule();
  }
  const step = n => request(stepFrom(target ? target.pos : position(), n), 340, false, n > 0 ? Infinity : 0);
  const jumpTurn = direction => request(turnFrom(target ? target.pos : position(), direction), 480);
  function schedule() {
    clearTimeout(playTimer);
    if (!enabled() || recording() || (!playing && !scan)) return;
    const pos = position(), m = analyse();
    if (scan) {
      const next = stepFrom(pos, scan);
      if (next === pos) { playing = scan < 0 && resume; scan = 0; render(); schedule(); return; }
      playTimer = setTimeout(() => request(next, 40, true), SCAN_MS);
      return;
    }
    if (pos >= m.total) { playing = false; render(); return; }
    // The recorded pace, with long pauses shortened, divided by the chosen speed.
    const next = stepFrom(pos, 1), now = m.all[pos - 1]?.seconds, then = m.all[next - 1]?.seconds;
    const gap = Math.max(350, Math.min(1500, Number.isFinite(then - now) ? (then - now) * 1000 : 600)) / speed;
    playTimer = setTimeout(() => request(next, Math.min(380, gap * 0.8), true, gap), gap);
  }
  // User, 2026-10-28: one rule for the icons. ⏸ whenever the replay moves (playing or scanning), and it always pauses;
  // ▶ only when paused. « and » start a scan, and pressed again go back to how it was (playing or paused).
  function togglePlay() { const moving = playing || !!scan; scan = 0; playing = !moving; render(); schedule(); }
  function toggleScan(direction) {
    if (scan === direction) { scan = 0; playing = resume; }
    else { if (!scan) resume = playing; playing = false; scan = direction; }
    render(); schedule();
  }
  function cycleSpeed() { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; render(); schedule(); }
  // For recorder.js: play the replay through the timeline at 1, 2 or 4 times, from the start when at the end.
  const recordPlayback = Object.freeze({
    available: () => enabled(),
    start(rate) {
      if (!enabled()) return false;
      // A finger on the track lets go: lifting it must not seek during the recording.
      ui.stopDrag?.();
      recordingHere = true; speed = SPEEDS.includes(rate) ? rate : 1; scan = 0; playing = true;
      if (position() >= analyse().total) request(0, 0, true); else { render(); schedule(); }
      return true;
    },
    stop() { if (!recordingHere) return; recordingHere = false; playing = false; scan = 0; clearTimeout(playTimer); render(); },
    finished: () => recordingHere && !playing && !scheduled && position() >= analyse().total
  });

  // UI
  const ui = {};
  // A touch that began on the resting bar only brings it back: no button under the finger reacts to its click (keys,
  // whose clicks have no detail, still do).
  let revealTap = -Infinity;
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
  function button(className, text, title, action) {
    const node = element('button', className, text); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!event.detail || event.timeStamp - revealTap > 1000) action(); });
    return node;
  }
  function build() {
    const root = ui.root = element('div'); root.id = 'dblite-timeline'; root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Replay timeline');
    const controls = element('div', 'dblite-tl-controls');
    ui.prevTurn = button('dblite-tl-turn', '⏮', 'Start of turn; previous turn when already there (Shift+←)', () => jumpTurn(-1));
    ui.scanBack = button('', '«', 'Fast backward (J): quick and silent', () => toggleScan(-1));
    ui.back = button('', '◀', 'Back one play (←)', () => step(-1));
    ui.play = button('dblite-tl-play', '▶', 'Play / pause (Space or K): the replay’s pace, with sounds', () => { togglePlay(); if (touch()) ui.wake?.(); });
    ui.next = button('', '▶|', 'Next play (→)', () => step(1));
    ui.scanFwd = button('', '»', 'Fast forward (L): quick and silent', () => toggleScan(1));
    ui.nextTurn = button('dblite-tl-turn', '⏭', 'Next turn (Shift+→)', () => jumpTurn(1));
    ui.speed = button('dblite-tl-speed', '1×', 'Playback speed: 1×, 2× or 4×', cycleSpeed);
    controls.append(ui.prevTurn, ui.scanBack, ui.back, ui.play, ui.next, ui.scanFwd, ui.nextTurn, ui.speed);
    const track = ui.track = element('div', 'dblite-tl-track'); track.setAttribute('role', 'slider'); track.tabIndex = 0;
    track.setAttribute('aria-label', 'Replay position');
    ui.rail = element('div', 'dblite-tl-rail'); ui.fill = element('div', 'dblite-tl-fill'); ui.marks = element('div', 'dblite-tl-marks');
    ui.thumb = element('div', 'dblite-tl-thumb'); ui.ghost = element('div', 'dblite-tl-thumb dblite-tl-preview'); ui.tip = element('div', 'dblite-tl-tip');
    ui.ghost.hidden = ui.tip.hidden = true;
    track.append(ui.rail, ui.fill, ui.marks, ui.ghost, ui.thumb, ui.tip);
    const info = element('div', 'dblite-tl-info');
    ui.label = element('span', 'dblite-tl-label'); ui.count = element('span', 'dblite-tl-count');
    info.append(ui.label, ui.count);
    // Collapsed, only this progress line shows; moving to the bottom of the stage opens the bar.
    ui.mini = element('div', 'dblite-tl-mini'); ui.miniFill = element('div', 'dblite-tl-mini-fill'); ui.mini.append(ui.miniFill);
    root.append(controls, track, info, ui.mini);
    for (const type of ['mousedown', 'click', 'dblclick', 'contextmenu', 'keydown']) root.addEventListener(type, event => event.stopPropagation());
    const fraction = event => { const r = ui.rail.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) : 0; };
    const at = event => Math.round(fraction(event) * analyse().total);
    const snap = (pos, within = 6) => { const m = analyse(), r = ui.rail.getBoundingClientRect(), px = m.total ? r.width / m.total : 0; const t = m.turns.find(t => Math.abs(t.pos - pos) * px <= within); return t ? t.pos : pos; };
    const preview = (pos, ghost = true, pct = analyse().total ? pos / analyse().total * 100 : 0) => {
      ui.ghost.hidden = !ghost; ui.tip.hidden = false; ui.ghost.style.left = ui.tip.style.left = pct + '%';
      ui.tip.textContent = `${label(pos)} — ${describe(pos).play || ''}`;
    };
    const stopDrag = ui.stopDrag = () => { dragging = false; scrub = null; root.classList.remove('dblite-tl-dragging'); ui.ghost.hidden = ui.tip.hidden = true; };
    track.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') preview(snap(at(event))); });
    track.addEventListener('pointerleave', () => { if (!dragging) ui.ghost.hidden = ui.tip.hidden = true; });
    // Mouse: dragging moves the board along with the thumb; tape steps are cheap enough to follow the pointer.
    // Touch (user, 2026-10-29: sliding "was kind of moving slowly"; it should scrub like YouTube): the thumb, the
    // count and the preview label stay under the finger, and the board follows as fast as seeks land (coalesced, so
    // it never queues behind the finger). Lifting settles on the finger's play; a tap jumps there, or to a turn mark
    // within 12 px. Only the first finger counts, and touching pauses playing or scanning until the finger lifts.
    const scrubTo = event => {
      scrub.pct = fraction(event) * 100; scrub.pos = at(event);
      ui.thumb.style.left = ui.fill.style.width = ui.miniFill.style.width = scrub.pct + '%';
      ui.count.textContent = `${scrub.pos} / ${analyse().total}`; preview(scrub.pos, false, scrub.pct);
      request(scrub.pos, 0);
    };
    const endScrub = (event, cancelled) => {
      if (!scrub || event.pointerId !== scrub.id) return;
      const tap = !cancelled && Math.abs(event.clientX - scrub.x) < TAP_SLOP, { playing: wasPlaying, scan: wasScanning } = scrub;
      if (!cancelled) scrubTo(event);
      stopDrag();
      if (!cancelled) request(tap ? snap(at(event), 12) : at(event), 0);
      // Playing or scanning goes on from there: when the pending move lands (run → schedule), or now.
      playing = wasPlaying; scan = wasScanning;
      if (wasPlaying || wasScanning) { render(); if (!scheduled) schedule(); }
      else if (cancelled) render();
    };
    track.addEventListener('pointerdown', event => {
      if (scrub || dragging) return;
      track.setPointerCapture?.(event.pointerId);
      dragging = true; root.classList.add('dblite-tl-dragging');
      if (event.pointerType !== 'touch') { request(snap(at(event)), 0); return; }
      scrub = { id: event.pointerId, x: event.clientX, playing, scan };
      playing = false; scan = 0; clearTimeout(playTimer); render(); scrubTo(event);
    });
    track.addEventListener('pointermove', event => {
      if (scrub) { if (event.pointerId === scrub.id) scrubTo(event); }
      else if (dragging) request(snap(at(event)), 0);
    });
    track.addEventListener('pointerup', event => {
      if (scrub) { endScrub(event, false); return; }
      if (!dragging) return; stopDrag(); request(snap(at(event)), 0);
    });
    for (const type of ['pointercancel', 'lostpointercapture']) track.addEventListener(type, event => { if (scrub) endScrub(event, true); else if (type === 'pointercancel') stopDrag(); });
    track.addEventListener('keydown', event => {
      const keys = { ArrowLeft: () => step(-1), ArrowRight: () => step(1), Home: () => request(0, 0), End: () => request(analyse().total, 0), PageUp: () => jumpTurn(-1), PageDown: () => jumpTurn(1) };
      if (keys[event.key]) { event.preventDefault(); keys[event.key](); }
    });
    // Outside DuelingBook's stage, which scales #content and positions every div in it absolutely.
    document.body.append(root);
    let idleTimer = 0;
    // Touch screens have no hover (Android app, 2026-10-28): the controls stay longer, and a tap on the thin progress
    // line brings them back without reaching the cards under it.
    const wake = () => { root.classList.remove('dblite-tl-idle'); clearTimeout(idleTimer); idleTimer = setTimeout(idle, touch() ? 6000 : 2200); };
    // A tapped control keeps :hover and focus on a touch screen, so there only touching the bar keeps it awake.
    const idle = () => { if (!dragging && !scheduled && (touch() || !root.matches(':hover,:focus-within'))) root.classList.add('dblite-tl-idle'); else idleTimer = setTimeout(idle, 1200); };
    // User, 2026-11-01: the tap that brought the resting bar back also pressed a button. A tap sends mouse events too
    // (the browser's, or touch.js's for DuelingBook); waking the bar on their mousemove put a button under the click.
    document.addEventListener('mousemove', event => {
      if (touch() || event.dbetterTouch || event.sourceCapabilities?.firesTouchEvents) return;
      const r = stage().getBoundingClientRect(); if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.bottom - 70) wake(); }, { passive: true });
    root.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') { revealTap = -Infinity; return; }
      const resting = root.classList.contains('dblite-tl-idle');
      revealTap = resting && !event.target.closest('.dblite-tl-play') ? event.timeStamp : -Infinity;
      if (!resting) wake();
    }, true);
    ui.mini.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); wake(); });
    ui.wake = wake; wake();
    addEventListener('resize', place);
  }
  const stage = () => document.getElementById('content') || document.body;
  const touch = () => document.documentElement.classList.contains('dbetter-touch');
  // Over the bottom of the stage, from the right of the hand options (Hide Hands, Show Hand, Show Both) to the
  // stage's right edge: the timeline takes the place of DuelingBook's replay buttons, which stood beside them.
  // Without those options, from the right of the card preview column.
  function place() {
    if (!ui.root) return;
    const r = stage().getBoundingClientRect(), preview = document.getElementById('preview')?.getBoundingClientRect();
    const options = ['show_lbl', 'show1_lbl', 'show2_lbl'].map(id => document.getElementById(id)?.getBoundingClientRect()).filter(b => b?.width);
    const after = options.length ? Math.max(...options.map(b => b.right)) + 16 : preview?.width && preview.right < r.left + r.width / 2 ? preview.right + 10 : 0;
    const left = Math.max(r.left + 14, after), right = r.right - 14;
    // Touch screens (Android app, 2026-10-28): at the very bottom of the screen, to cover less of the hand.
    const bottom = document.documentElement.classList.contains('dbetter-touch') ? 2 : Math.round(Math.max(0, innerHeight - r.bottom) + 10);
    Object.assign(ui.root.style, { left: `${Math.round(left)}px`, width: `${Math.round(right - left)}px`, bottom: `${bottom}px` });
  }
  function renderMarks() {
    const m = analyse();
    if (ui.marksKey === marksKey) return;
    ui.marksKey = marksKey; ui.marks.replaceChildren();
    if (!m.total) return;
    const width = ui.rail.getBoundingClientRect().width || 1000, everyN = Math.max(1, Math.ceil(26 / Math.max(1, width / Math.max(1, m.turns.length))));
    m.turns.forEach((t, i) => {
      const tick = element('div', 'dblite-tl-tick'); tick.style.left = t.pos / m.total * 100 + '%';
      // The turn player's side: bottom (player 1) or top.
      tick.classList.add(t.who && t.who !== window.player1?.username ? 'dblite-tl-top' : 'dblite-tl-bottom');
      if (i % everyN === 0) tick.append(element('span', '', String(t.turn)));
      ui.marks.append(tick);
    });
    for (const g of m.games.slice(1)) { const sep = element('div', 'dblite-tl-game'); sep.style.left = g.pos / m.total * 100 + '%'; sep.append(element('span', '', 'G' + g.game)); ui.marks.append(sep); }
  }
  // DuelingBook shows its replay buttons through proxy copies (watchComponent) of hidden inputs; the proxies are
  // what has to go while the timeline is on.
  function markNativeButtons() {
    for (const id of ['play_btn', 'pause_replay_btn', 'next_btn', 'fast_btn']) window.jQuery?.('#' + id).data('proxy')?.[0]?.classList.add('dblite-native-replay-btn');
  }
  function render() {
    const on = enabled() && !recording();
    document.documentElement.classList.toggle('dblite-timeline-on', on);
    if (!on) { if (ui.root) ui.root.hidden = true; if (playing || scan) { playing = false; scan = 0; clearTimeout(playTimer); } return; }
    markNativeButtons();
    if (!ui.root) build();
    ui.root.hidden = false; place();
    const m = analyse(), pos = scrub ? scrub.pos : target ? target.pos : position(), pct = scrub ? scrub.pct : m.total ? pos / m.total * 100 : 0;
    renderMarks();
    ui.fill.style.width = ui.miniFill.style.width = pct + '%'; ui.thumb.style.left = pct + '%';
    ui.track.setAttribute('aria-valuemin', '0'); ui.track.setAttribute('aria-valuemax', String(m.total)); ui.track.setAttribute('aria-valuenow', String(pos));
    const text = label(pos); ui.track.setAttribute('aria-valuetext', text); ui.label.textContent = text; ui.count.textContent = `${pos} / ${m.total}`;
    ui.root.style.setProperty('--dblite-tl-digits', String(String(m.total).length));
    const moving = playing || !!scan;
    ui.play.textContent = moving ? '⏸' : '▶'; ui.play.setAttribute('aria-pressed', String(moving)); ui.play.setAttribute('aria-label', moving ? 'Pause' : 'Play');
    ui.scanBack.setAttribute('aria-pressed', String(scan < 0)); ui.scanFwd.setAttribute('aria-pressed', String(scan > 0));
    ui.speed.textContent = speed + '×';
    ui.prevTurn.disabled = ui.back.disabled = ui.scanBack.disabled = pos === 0;
    ui.next.disabled = ui.nextTurn.disabled = ui.scanFwd.disabled = pos >= m.total;
  }

  // Keys outside text fields: ←/→ step, Shift+←/→ turn, Space or K play/pause, J/L fast backward/forward. Keys the
  // user mapped to DBETTER shortcuts keep their shortcut; Space is DBETTER's peek key only while a card viewer is open.
  document.addEventListener('keydown', event => {
    const target = event.target, key = event.key.toLowerCase();
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || !enabled() || recording() ||
        target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.chat,#chats,#watch_chat') ||
        document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
    const actions = { arrowleft: () => event.shiftKey ? jumpTurn(-1) : step(-1), arrowright: () => event.shiftKey ? jumpTurn(1) : step(1), k: togglePlay, ' ': togglePlay, j: () => toggleScan(-1), l: () => toggleScan(1) };
    const peek = key === ' ' && config.keys?.peek === ' ' && document.querySelector('.dblite-fan,.dblite-classic-switch');
    if (!actions[key] || peek || (config.shortcuts && Object.entries(config.keys || {}).some(([action, mapped]) => mapped === key && !(key === ' ' && action === 'peek')))) return;
    if (key === ' ' && event.repeat) { event.preventDefault(); return; }
    event.preventDefault(); event.stopImmediatePropagation(); actions[key](); ui.wake?.();
    spacePlayed = key === ' ';
  }, true);
  // A focused button would also take the Space that played or paused, on its keyup.
  let spacePlayed = false;
  document.addEventListener('keyup', event => { if (event.key === ' ' && spacePlayed) { spacePlayed = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  // A new hand setting (Hide Hands, Show Hand, Show Both) makes the tape stale: the duel is recorded again at the
  // current position right away, so the next move stays quick.
  document.addEventListener('change', event => { if (event.target?.name === 'show' && enabled() && !recording()) request(position(), 0); });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_SETTINGS') return;
    config = rules.settings(event.data.settings || {}); render();
  });

  const style = document.createElement('style'); style.id = 'dblite-timeline-style';
  style.textContent = `
    html.dblite-timeline-on :is(#play_btn,#pause_replay_btn,#next_btn,#fast_btn,.dblite-native-replay-btn,#dblite-replay-rate){display:none!important}
    html.dblite-recording #dblite-timeline{visibility:hidden!important}
    #dblite-timeline{position:fixed;left:14px;bottom:10px;z-index:2147482000;box-sizing:border-box;display:flex;align-items:center;gap:12px;height:42px;padding:0 12px;
      border-radius:12px;background:color-mix(in srgb,var(--dbt-panel,#242c2e) 92%,transparent);border:1px solid var(--dbt-line,#3a4548);
      box-shadow:0 10px 28px rgba(0,0,0,.45);backdrop-filter:blur(6px);color:var(--dbt-text,#e6eeea);font:12px/1.3 system-ui,'Segoe UI',sans-serif;
      transition:background-color .2s,border-color .2s,box-shadow .2s;user-select:none}
    #dblite-timeline[hidden]{display:none}
    #dblite-timeline>*{transition:opacity .2s}
    #dblite-timeline.dblite-tl-idle{background:transparent;border-color:transparent;box-shadow:none;backdrop-filter:none;pointer-events:none}
    #dblite-timeline.dblite-tl-idle>:not(.dblite-tl-mini){opacity:0;visibility:hidden}
    #dblite-timeline:not(.dblite-tl-idle)>.dblite-tl-mini{opacity:0;pointer-events:none}
    #dblite-timeline.dblite-tl-busy{cursor:progress}
    #dblite-timeline .dblite-tl-mini{position:absolute;left:4px;right:4px;bottom:-6px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--dbt-panel-2,#2b3234) 80%,transparent)}
    html.dbetter-touch #dblite-timeline.dblite-tl-idle>.dblite-tl-mini{pointer-events:auto}
    html.dbetter-touch #dblite-timeline{height:38px;padding:0 6px;gap:6px;touch-action:manipulation}
    html.dbetter-touch #dblite-timeline .dblite-tl-controls{gap:3px}
    html.dbetter-touch #dblite-timeline .dblite-tl-controls button{height:32px;min-width:38px;padding:0 5px;font-size:17px;touch-action:manipulation}
    /* User, 2026-10-29: on a phone, play by play matters more than whole turns, which the turn marks on the track reach. */
    html.dbetter-touch #dblite-timeline .dblite-tl-controls .dblite-tl-turn{display:none}
    html.dbetter-touch #dblite-timeline .dblite-tl-controls .dblite-tl-speed{font-size:14px}
    /* User, 2026-11-01: pausing a playing replay needed the bar first. On touch screens ▶/⏸ comes first and stays while
       the bar rests, at its left end (beside the hand, not over it); tapping it also brings the bar back. */
    html.dbetter-touch #dblite-timeline .dblite-tl-controls .dblite-tl-play{order:-1}
    html.dbetter-touch #dblite-timeline.dblite-tl-idle>.dblite-tl-controls{opacity:1}
    html.dbetter-touch #dblite-timeline.dblite-tl-idle .dblite-tl-controls>:not(.dblite-tl-play){opacity:0}
    html.dbetter-touch #dblite-timeline.dblite-tl-idle .dblite-tl-controls>.dblite-tl-play{visibility:visible;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.5)}
    html.dbetter-touch #dblite-timeline .dblite-tl-track{flex:1 1 auto;height:38px;min-width:120px}
    html.dbetter-touch #dblite-timeline .dblite-tl-info{flex:none}
    /* Room for the longest count, so the track keeps its width under a scrubbing finger as the count gains digits. */
    html.dbetter-touch #dblite-timeline .dblite-tl-count{min-width:calc(var(--dblite-tl-digits,3) * 2ch + 2ch);text-align:right}
    html.dbetter-touch #dblite-timeline .dblite-tl-label{display:none}
    html.dbetter-touch #dblite-timeline .dblite-tl-thumb{top:9px;width:20px;height:20px;margin-left:-10px}
    html.dbetter-touch #dblite-timeline .dblite-tl-tip{bottom:42px}
    html.dbetter-touch #dblite-timeline .dblite-tl-mini{bottom:2px;left:50px}
    html.dbetter-touch #dblite-timeline .dblite-tl-mini::before{content:'';position:absolute;left:0;right:0;top:-16px;bottom:-6px}
    #dblite-timeline .dblite-tl-mini-fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--dbt-accent,#3c9bb5)}
    #dblite-timeline .dblite-tl-controls{position:relative;display:flex;gap:4px;flex:none}
    #dblite-timeline .dblite-tl-info{position:relative;display:flex;align-items:baseline;gap:10px;flex:0 1 330px;min-width:0}
    #dblite-timeline .dblite-tl-track{position:relative;flex:1 1 auto;min-width:200px;height:30px;cursor:pointer;touch-action:none;outline:none}
    .dblite-tl-track:focus-visible .dblite-tl-thumb{box-shadow:0 0 0 3px var(--dbt-text,#e6eeea)}
    .dblite-tl-rail,.dblite-tl-fill{position:absolute;left:0;top:17px;height:4px;border-radius:2px}
    .dblite-tl-rail{right:0;background:var(--dbt-panel-2,#2b3234);box-shadow:inset 0 0 0 1px var(--dbt-line,#3a4548)}
    .dblite-tl-fill{background:var(--dbt-accent,#3c9bb5)}
    .dblite-tl-marks{position:absolute;inset:0;pointer-events:none}
    .dblite-tl-tick{position:absolute;top:13px;width:2px;height:12px;margin-left:-1px;border-radius:1px;background:var(--dbt-you,#c8424a)}
    .dblite-tl-tick.dblite-tl-top{background:var(--dbt-opponent,#3c9bb5)}
    .dblite-tl-tick span{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:10px;line-height:1;color:var(--dbt-muted,#a3b2b8)}
    .dblite-tl-game{position:absolute;top:3px;width:2px;height:26px;margin-left:-1px;background:var(--dbt-text,#e6eeea)}
    .dblite-tl-game span{position:absolute;top:0;left:5px;font:700 10px/1 system-ui;color:var(--dbt-text,#e6eeea)}
    .dblite-tl-thumb{position:absolute;top:12px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--dbt-accent,#3c9bb5);
      border:2px solid var(--dbt-panel,#242c2e);box-sizing:border-box;pointer-events:none;transition:left .12s}
    .dblite-tl-dragging .dblite-tl-thumb{transition:none}
    .dblite-tl-preview{background:var(--dbt-text,#e6eeea);opacity:.55;transition:none}
    .dblite-tl-tip{position:absolute;bottom:34px;transform:translateX(-50%);white-space:nowrap;padding:4px 8px;border-radius:6px;pointer-events:none;
      background:var(--dbt-panel-2,#2b3234);border:1px solid var(--dbt-line,#3a4548);color:var(--dbt-text,#e6eeea);box-shadow:0 4px 12px rgba(0,0,0,.35)}
    .dblite-tl-controls button{min-width:32px;height:28px;padding:0 7px;border-radius:7px;border:1px solid var(--dbt-line,#3a4548);background:var(--dbt-panel-2,#2b3234);
      color:var(--dbt-text,#e6eeea);font:600 13px/1 system-ui,sans-serif;cursor:pointer}
    .dblite-tl-controls button:hover:not(:disabled),.dblite-tl-controls button[aria-pressed="true"]{border-color:var(--dbt-accent,#3c9bb5)}
    .dblite-tl-controls button[aria-pressed="true"]:not(.dblite-tl-play){color:var(--dbt-on-accent,#071512);background:var(--dbt-accent,#3c9bb5)}
    .dblite-tl-controls button:focus-visible{outline:2px solid var(--dbt-accent,#3c9bb5);outline-offset:2px}
    .dblite-tl-controls button:disabled{opacity:.45;cursor:default}
    .dblite-tl-controls .dblite-tl-play{min-width:38px;background:var(--dbt-accent,#3c9bb5);border-color:var(--dbt-accent,#3c9bb5);color:var(--dbt-on-accent,#071315)}
    .dblite-tl-controls .dblite-tl-speed{min-width:38px;font-variant-numeric:tabular-nums}
    .dblite-tl-label{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .dblite-tl-count{margin-left:auto;flex:none;color:var(--dbt-muted,#a3b2b8);font-variant-numeric:tabular-nums}
  `;
  (document.head || document.documentElement).append(style);
  // Activation sparks are SVG movies on their own timer: none should stay on the board after a jump.
  window.addEventListener('dbetter-rebuild-end', () => {
    document.querySelectorAll('#spark > svg').forEach(node => node.remove());
    try { window.spark?.stop?.(); } catch {}
  });
  window.DBETTERRewind = Object.freeze({ render, request, label, recordPlayback, motion: Object.freeze({ placement, glide }) });
  window.DBETTERReplayCapture.subscribe(text => {
    try { core.capture(text); captured = true; } catch { captured = false; }
    render();
  });
  // On load DuelingBook plays the replay itself. Once its duel exists, the tape takes over from that position.
  setInterval(() => {
    // Turned off and on again: take over again, so DuelingBook's own playback does not run behind hidden controls
    // (release review, 2026-10-29).
    if (taken && !enabled()) taken = false;
    if (!taken && enabled() && !recording() && !window.DBETTERRebuilding) {
      taken = true; playing = !window.paused; window.pauseE?.(); request(position(), 0);
    }
    if (!dragging && !scheduled) render();
  }, 250);
  render();
})();

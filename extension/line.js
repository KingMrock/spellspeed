/* Spellspeed, GPL-3.0-only. Combo lines for Solo (user, 2026-11-12): the plays of a Solo game are kept as a line, so
 * the player can go back to any step (same opening hand, the plays sent again) and replay a saved line step by step.
 * DuelingBook has no undo: a Solo duel lives on its server, and its only way back is Reset game (measured
 * 2026-11-12). This file holds the parts without the page: turning a sent play into a step, finding the cards for
 * a step again after a reset, the share code and the labels. workbench.js records and replays. */
(root => {
  'use strict';
  const VERSION = 1, PREFIX = 'SPELLSPEED-LINE-1:', MAX_STEPS = 400, MAX_CODE = 200000;
  // Fields of a play that hold a card of the duel (DuelingBook v934 client: duel.js and main.js Send calls).
  const CARD_FIELDS = ['card', 'start_card', 'end_card', 'attacking_card', 'attacked_card'];
  // Plays sent again as they were. Anything else (chat, viewing, shuffles, coins and dice, match and account plays,
  // random effect events) is never sent by a line; a shared line is checked against this list too.
  const REPLAY = new Set([
    'Normal Summon', 'Set monster', 'SS ATK', 'SS DEF', 'Flip Summon', 'Flip', 'To ATK', 'To DEF', 'Move',
    'Activate ST', 'Set ST', 'To ST', 'Activate Field Spell', 'Activate Field Spell 2', 'Set Field Spell', 'Set Field Spell 2',
    'Activate Pendulum Left', 'Activate Pendulum Right', 'To GY', 'To hand', 'To hand 2', 'Banish', 'Banish FD', 'Banish B',
    'To T Deck', 'To T Deck 2', 'To T Deck FU', 'To T Deck 2 FU', 'To B Deck', 'To B Deck 2', 'To ED', 'To ED FU',
    'Overlay', 'OL ATK', 'OL DEF', 'Attach', 'Detach', 'Remove Token', 'Target', 'Declare', 'Reveal',
    'Attack', 'Attack directly', 'Add counter', 'Remove counter', 'Edit stats', 'Life points',
    'Enter DP', 'Enter SP', 'Enter M1', 'Enter BP', 'Enter M2', 'Enter EP', 'End turn'
  ]);
  // Plays whose result depends on the Deck's order: after a reset the Deck is shuffled differently, so the line keeps
  // which cards they moved and sends those moves instead.
  const TOP = new Set(['Draw card', 'Mill', 'Mill 3 cards', 'Banish top 3 cards', 'Banish top 8 cards FD', 'Banish top 10 cards FD']);
  const COMMAND = /^\/(mill|banish|banishfd|banish_fd) ?\d{1,2}$/i;
  // Plays a line never keeps: they change nothing on the board (or nothing a line can repeat).
  const QUIET = new Set(['Thinking', 'Typing', 'Good', 'Stop good', 'View deck', 'View ED', 'View GY', 'View GY 2', 'View ED 2',
    'View Banished', 'View Banished 2', 'View materials', 'Stop viewing', 'Stop viewing 2', 'Show hand', 'Show deck', 'Show ED',
    'Shuffle deck', 'Shuffle hand', 'Auto shuffle', 'Pause game', 'Ready', 'Pick first', 'RPS', 'Reset game', 'Reset deck',
    'Quit duel', 'Admit defeat', 'Start siding', 'Done siding', 'Call admin', 'Cancel call', 'Permission denied', 'Change Token',
    'Offer draw', 'Accept draw', 'Revoke draw', 'Offer rematch', 'Accept rematch', 'Revoke rematch', 'Edit duel message', 'Start turn',
    // Spellspeed's Keep hand revealed sends these by itself for each card that reaches the hand.
    'Stay revealed', 'Stop revealing']);
  // The other fields a step may send again, each with its shape. Anything else makes a step one that is never sent.
  const DATA = { zone: v => typeof v === 'string' && /^[A-Za-z0-9 _-]{1,16}$/.test(v), amount: v => Number.isFinite(v) || (typeof v === 'string' && /^-?\d{1,6}$/.test(v)),
    atk: v => Number.isFinite(v) || (typeof v === 'string' && /^[0-9?-]{0,6}$/.test(v)), def: v => Number.isFinite(v) || (typeof v === 'string' && /^[0-9?-]{0,6}$/.test(v)),
    message: v => typeof v === 'string' && COMMAND.test(v) };
  // Where an outcome card went, and the play that puts a Deck card there.
  const OUTCOME_PLAY = { hand: 'To hand', gy: 'To GY', banished: 'Banish', banishedFD: 'Banish FD' };
  const PLACES = /^(hand|deck|extra|gy|banished|materials|field:[A-Za-z0-9]{1,16})$/;
  const VERBS = {
    'Normal Summon': 'Normal Summon', 'Set monster': 'Set', 'SS ATK': 'Special Summon', 'SS DEF': 'Special Summon (DEF)',
    'Flip Summon': 'Flip Summon', 'Flip': 'Flip', 'To ATK': 'To ATK', 'To DEF': 'To DEF', 'Move': 'Move',
    'Activate ST': 'Activate', 'Set ST': 'Set', 'To ST': 'Place in S/T', 'Activate Field Spell': 'Activate', 'Activate Field Spell 2': 'Activate',
    'Set Field Spell': 'Set', 'Set Field Spell 2': 'Set', 'Activate Pendulum Left': 'Pendulum Scale', 'Activate Pendulum Right': 'Pendulum Scale',
    'To GY': 'Send to GY', 'Banish': 'Banish', 'Banish FD': 'Banish face-down', 'Banish B': 'Banish',
    'To T Deck': 'Top of Deck', 'To T Deck 2': 'Top of Deck', 'To T Deck FU': 'Top of Deck', 'To T Deck 2 FU': 'Top of Deck',
    'To B Deck': 'Bottom of Deck', 'To B Deck 2': 'Bottom of Deck', 'To ED': 'To Extra Deck', 'To ED FU': 'To Extra Deck face-up',
    'Overlay': 'Overlay', 'OL ATK': 'Xyz Summon', 'OL DEF': 'Xyz Summon (DEF)', 'Attach': 'Attach', 'Detach': 'Detach',
    'Remove Token': 'Remove token', 'Target': 'Target', 'Declare': 'Declare', 'Reveal': 'Reveal', 'Stay revealed': 'Keep revealed',
    'Stop revealing': 'Stop revealing', 'Attack': 'Attack', 'Attack directly': 'Direct attack', 'Add counter': 'Add counter',
    'Remove counter': 'Remove counter', 'Edit stats': 'Edit ATK/DEF', 'Life points': 'Life points', 'End turn': 'End turn',
    'Draw card': 'Draw', 'Mill': 'Mill', 'Mill 3 cards': 'Mill 3', 'Banish top 3 cards': 'Banish top 3',
    'Banish top 8 cards FD': 'Banish top 8', 'Banish top 10 cards FD': 'Banish top 10'
  };
  const PLACE_NAMES = { hand: 'hand', deck: 'Deck', extra: 'Extra Deck', gy: 'GY', banished: 'banished', materials: 'materials' };

  const recordable = data => !!data && data.action === 'Duel' && typeof data.play === 'string' && !QUIET.has(data.play) &&
    (data.play !== 'Duel message' || COMMAND.test(String(data.message || '')));
  const topDeck = data => TOP.has(data.play) || data.play === 'Duel message';
  const cleanRef = ref => ref && Number.isInteger(ref.i) && ref.i > 0 ? { i: ref.i, n: String(ref.n || '').slice(0, 120), f: typeof ref.f === 'string' && PLACES.test(ref.f) ? ref.f : '' } : null;
  const outcomeTo = to => typeof to === 'string' && Object.prototype.hasOwnProperty.call(OUTCOME_PLAY, to);

  // A play as the page sent it -> a step. describe(id) gives { i: printed card id, n: name, f: place } for an own card.
  function step(data, describe) {
    const s = { p: data.play }, c = {}, d = {};
    let replay = REPLAY.has(data.play) || (data.play === 'Duel message' && COMMAND.test(String(data.message || '')));
    for (const [key, value] of Object.entries(data)) {
      if (key === 'action' || key === 'play' || key === 'token') continue;
      if (CARD_FIELDS.includes(key)) {
        const ref = value == null ? null : cleanRef(describe(value));
        if (ref) c[key] = ref; else replay = false;
      } else if (key === 'cards' && Array.isArray(value)) {
        const refs = value.map(id => cleanRef(describe(id)));
        if (refs.every(Boolean)) s.cs = refs; else replay = false;
      } else if (Object.prototype.hasOwnProperty.call(DATA, key) && DATA[key](value)) d[key] = value;
      else replay = false;
    }
    if (Object.keys(c).length) s.c = c;
    if (Object.keys(d).length) s.d = d;
    // A Deck-order play is repeated from the cards it moved (filled once they are known, setOutcome), whatever the
    // page knew of the top card when it was sent.
    if (topDeck(data)) { s.top = true; s.o = null; }
    else if (!replay) s.x = true; // Kept in the list, never sent again.
    return s;
  }
  // The cards a Deck-order play moved: [{ r: ref, to: 'hand' | 'gy' | 'banished' | 'banishedFD' }].
  function setOutcome(s, moved) {
    s.o = moved.filter(m => cleanRef(m.r) && outcomeTo(m.to)).map(m => ({ r: cleanRef(m.r), to: m.to }));
    if (!s.o.length) s.x = true;
    return s;
  }
  const replayable = s => !!s && !s.x && (!s.top || Array.isArray(s.o) && s.o.length > 0);
  // The printed cards a line needs at once at most, by printed id (the opening hand and every card it names).
  function needs(line) {
    const most = new Map(), names = new Map();
    const count = refs => { const here = new Map(); for (const r of refs) { here.set(r.i, (here.get(r.i) || 0) + 1); names.set(r.i, r.n); } for (const [i, n] of here) most.set(i, Math.max(most.get(i) || 0, n)); };
    count([...line.hand, ...(line.stack || [])].map(i => ({ i, n: '' })));
    for (const s of line.steps) count([...Object.values(s.c || {}), ...(s.cs || []), ...(s.o || []).map(o => o.r)]);
    return { most, names };
  }

  // The plays that repeat a step now. candidates: [{ id, i: printed id, f: place }] of the player's own cards.
  // Each ref takes a card with the same printed id in the same place (a field card: the same zone first, then any zone).
  function plan(s, candidates) {
    if (!replayable(s)) return { error: 'skip' };
    const used = new Set();
    const pick = ref => {
      const free = candidates.filter(c => c.i === ref.i && !used.has(c.id));
      const found = free.find(c => c.f === ref.f) || (ref.f.startsWith('field:') ? free.find(c => c.f.startsWith('field:')) : null);
      if (found) used.add(found.id);
      return found || null;
    };
    if (s.top) {
      const plays = [];
      for (const { r, to } of s.o) {
        const card = pick({ ...r, f: 'deck' });
        if (!card) return { error: 'missing', ref: { ...r, f: 'deck' } };
        plays.push({ action: 'Duel', play: OUTCOME_PLAY[to], card: card.id });
      }
      return { plays };
    }
    // Checked fields only, then the play and the cards found now: nothing a step carries can stand in for them.
    const message = {};
    for (const [key, value] of Object.entries(s.d || {})) if (Object.prototype.hasOwnProperty.call(DATA, key) && DATA[key](value)) message[key] = value;
    Object.assign(message, { action: 'Duel', play: s.p });
    for (const [key, ref] of Object.entries(s.c || {})) {
      const card = pick(ref); if (!card) return { error: 'missing', ref };
      message[key] = card.id;
    }
    if (s.cs) {
      const ids = [];
      for (const ref of s.cs) { const card = pick(ref); if (!card) return { error: 'missing', ref }; ids.push(card.id); }
      message.cards = ids;
    }
    return { plays: [message] };
  }
  // Does repeating this step read the Deck (so its cards must be known: DuelingBook's Deck view)?
  const needsDeck = s => !!s.top || [...Object.values(s.c || {}), ...(s.cs || [])].some(ref => ref.f === 'deck');

  function placeName(f) {
    if (!f) return '';
    if (f.startsWith('field:')) { const slot = f.slice(6); const m = /^([ms])([1-5])$/.exec(slot); return m ? (m[1] === 'm' ? 'M' : 'S') + m[2] : 'field'; }
    return PLACE_NAMES[f] || f;
  }
  // { verb, name, detail } for the list.
  function label(s) {
    const main = s.c?.card || s.c?.start_card || s.c?.attacking_card || s.cs?.[0] || (s.top && s.o?.[0]?.r) || null;
    let verb = VERBS[s.p] || s.p;
    if (s.p === 'Duel message') verb = String(s.d?.message || '').replace(/^\//, '');
    if (['To hand', 'To hand 2'].includes(s.p)) verb = main?.f === 'deck' ? 'Add from Deck' : main?.f === 'gy' ? 'Add from GY' : main?.f === 'banished' ? 'Add from banished' : 'To hand';
    if (s.p === 'SS ATK' || s.p === 'SS DEF') { if (main?.f === 'extra') verb = 'Summon from Extra Deck'; else if (main?.f === 'deck') verb = 'Special Summon from Deck'; }
    if (s.p === 'Life points') return { verb: 'Life points', name: String(s.d?.amount ?? ''), detail: '' };
    if (/^Enter |^End turn$/.test(s.p)) return { verb: s.p === 'End turn' ? 'End turn' : 'Phase', name: s.p.replace('Enter ', ''), detail: '' };
    let name = main?.n || '';
    if (s.top && s.o?.length > 1) name = s.o.map(o => o.r.n).join(', ');
    if (s.cs?.length > 1) name = s.cs.map(r => r.n).join(', ');
    const zone = typeof s.d?.zone === 'string' ? s.d.zone : '';
    const from = main ? placeName(main.f) : '';
    const detail = s.p === 'Attach' && s.c?.end_card ? 'to ' + s.c.end_card.n : zone ? (from && from !== 'hand' ? from + ' → ' : '') + zone : from;
    return { verb, name, detail };
  }

  // Share code: the line as text a friend can paste in Spellspeed's Solo. Cards by printed id (with names for display).
  function encode(line) {
    const body = { v: VERSION, name: String(line.name || '').slice(0, 80), deck: String(line.deck || '').slice(0, 80),
      hand: line.hand, stack: line.stack || [], steps: line.steps };
    const json = JSON.stringify(body);
    // UTF-8 bytes as a binary string for btoa (card names have curly quotes and accents).
    const binary = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Untrusted text in, a checked line out (or an Error with a message for the player).
  function decode(text) {
    const code = String(text || '').trim();
    if (!code.startsWith(PREFIX)) throw new Error('This is not a Spellspeed line code.');
    if (code.length > MAX_CODE) throw new Error('This line code is too long.');
    let body;
    try {
      const binary = atob(code.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
      body = JSON.parse(decodeURIComponent(Array.from(binary, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
    } catch { throw new Error('This line code is damaged. Copy it again.'); }
    return check(body);
  }
  const ids = list => Array.isArray(list) && list.length <= 60 && list.every(i => Number.isInteger(i) && i > 0);
  // Also used for lines read back from storage.
  function check(body) {
    if (!body || body.v !== VERSION) throw new Error('This line code comes from another Spellspeed version.');
    if (!ids(body.hand) || !ids(body.stack || [])) throw new Error('This line code has no valid opening hand.');
    if (!Array.isArray(body.steps) || body.steps.length > MAX_STEPS) throw new Error('This line code has no valid steps.');
    const steps = body.steps.map(raw => {
      if (!raw || typeof raw.p !== 'string' || raw.p.length > 40) throw new Error('This line code has a damaged step.');
      const s = { p: raw.p };
      if (raw.c) {
        s.c = {};
        for (const [key, ref] of Object.entries(raw.c)) { const clean = CARD_FIELDS.includes(key) && cleanRef(ref); if (!clean) throw new Error('This line code has a damaged card.'); s.c[key] = clean; }
      }
      if (raw.cs) { if (!Array.isArray(raw.cs) || raw.cs.length > 60) throw new Error('This line code has a damaged card.'); s.cs = raw.cs.map(ref => { const clean = cleanRef(ref); if (!clean) throw new Error('This line code has a damaged card.'); return clean; }); }
      let fields = true;
      if (raw.d) {
        if (typeof raw.d !== 'object' || Array.isArray(raw.d)) throw new Error('This line code has a damaged step.');
        s.d = {};
        // Only the known fields, each in its shape (DATA); a step with any other field is kept but never sent.
        for (const [key, value] of Object.entries(raw.d)) {
          if (Object.prototype.hasOwnProperty.call(DATA, key) && DATA[key](value)) s.d[key] = value; else fields = false;
        }
      }
      if (raw.top) { s.top = true; s.o = Array.isArray(raw.o) ? raw.o.map(m => ({ r: cleanRef(m?.r), to: m?.to })).filter(m => m.r && outcomeTo(m.to)) : []; }
      // Only plays Spellspeed itself would send again stay sendable.
      // A command (/mill …) is only ever repeated from the cards it moved, never sent as it was.
      const allowed = s.top ? s.o.length > 0 : REPLAY.has(s.p);
      if (raw.x || !allowed || !fields) s.x = true;
      return s;
    });
    return { name: String(body.name || '').slice(0, 80), deck: String(body.deck || '').slice(0, 80), hand: body.hand, stack: body.stack || [], steps };
  }
  // Two openings hold the same cards (in any order).
  const sameCards = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

  const api = { VERSION, PREFIX, recordable, step, setOutcome, replayable, plan, needsDeck, needs, label, placeName, encode, decode, check, sameCards };
  root.DBLiteLine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);

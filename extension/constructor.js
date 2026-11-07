/* DBETTER, GPL-3.0-only. Deck search uses the native catalog and draggable cards. */
(() => {
  'use strict';
  // Internal release gates; these are deliberately not user settings.
  const SUMMON_LAB_ENABLED = true;
  const SYNERGY_ENABLED = false;
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
  const searchText = new WeakMap();
  // Called millions of times by a reverse search: the fields are compared one by one, without a new array each call.
  function indexedText(card) {
    let entry = searchText.get(card);
    const s = entry?.signature;
    if (!s || s[0] !== card.name || s[1] !== card.effect || s[2] !== card.pendulum_effect || s[3] !== card.card_type || s[4] !== card.type || s[5] !== card.monster_color) {
      const signature = [card.name, card.effect, card.pendulum_effect, card.card_type, card.type, card.monster_color];
      entry = { signature, name: [card.name, ...aliases(card)].map(normalize), effect: [card.effect, card.pendulum_effect].map(normalize) };
      searchText.set(card, entry);
    }
    return entry;
  }
  // A name used only on the field or in the GY is not that card's name in the Deck.
  function namesAt(card, place) {
    const entry = indexedText(card), cache = entry.places ||= {};
    if (cache[place]) return cache[place];
    if (!entry.identity) {
      const names = [], text = maskQuotes(quoteText(card.effect + '\n' + card.pendulum_effect), names), base = [normalize(card.name)];
      const quoted = clause => [...clause.matchAll(/"§(\d+)§"/g)].map(match => normalize(names[match[1]]));
      for (const match of text.matchAll(/this card(?:'s name)? is (?:also )?(?:always )?treated as ([^.:;\n]+)/gi)) if (!/\b(?:while|if|when|unless|as long as)\b/i.test(match[1])) base.push(...quoted(match[1]));
      // "This card's name is treated as "Elemental HERO Bubbleman" while it is face-up on the field" (Neo Bubbleman): a name there, like "becomes".
      const changes = [...text.matchAll(/this card's name (?:becomes|is (?:also )?treated as) ([^.\n]+?) while ([^.\n]+)/gi)].filter(match => !/\b(?:not|except|unless)\b/i.test(match[2])).map(match => ({ names: quoted(match[1]), scope: match[2] }));
      entry.identity = { base, changes };
    }
    const pattern = { deck: /\bin (?:your |the )?(?:Main )?Deck\b/i, extra: /\bin (?:your |the )?Extra Deck\b/i, hand: /\bin (?:your |the )?hand\b/i,
      gy: /\bin (?:your |the )?(?:GY|Graveyard)\b/i, field: /\bon the field\b/i, banished: /\bbanished\b|\bbanishment\b/i }[place];
    return cache[place] = [...new Set([...entry.identity.base, ...entry.identity.changes.filter(change => pattern?.test(change.scope)).flatMap(change => change.names)])];
  }
  function categoriesOf(card) { const entry = indexedText(card); return entry.categories ||= effectCategories(card); }
  // Effect categories for the "Effect" filter. Each test reads the normalized card text
  // one sentence fragment at a time ([^.;:] keeps a match inside one clause), so a cost in
  // one clause and an effect in another do not combine. Heuristic, not rules-complete.
  const effectCategoryLabels = [['search', 'Searcher'], ['handtrap', 'Hand trap'], ['negate', 'Negation'], ['negate-activation', 'Negate activation'],
    ['destroy', 'Removal: destroy'], ['banish', 'Removal: banish'], ['bounce', 'Removal: bounce'], ['summon-deck', 'Summon from Deck'],
    ['revive', 'Summon from GY'], ['draw', 'Draw'], ['mill', 'Mill'], ['floodgate', 'Floodgate / lock'], ['recycle', 'Recycle'],
    ['burn', 'Burn'], ['gain', 'LP gain'], ['token', 'Tokens'], ['equip', 'Equip']];
  function effectCategories(card) {
    // Normal Monster text is flavor text; only its Pendulum Effect is an effect.
    const flavor = card.card_type === 'Monster' && String(card.monster_color) === 'Normal';
    const text = normalize((flavor ? '' : card.effect) + '\n' + card.pendulum_effect).replace(/graveyard/g, 'gy');
    const found = new Set(), when = (key, test) => { if (test) found.add(key); };
    const otherThanSelf = '(?!this card\\b)';
    // Searcher: "add ... from your Deck ... to your hand" (Main Deck only, not Extra Deck).
    when('search', /\badd\b[^.;:]*?\bfrom (?:your |the )?(?:main )?deck\b[^.;:]*?\bto (?:your|the|their) hand/.test(text));
    // Hand trap: a monster discarded/banished/revealed/sent from the hand at the opponent's
    // timing (Quick Effect, either player's / opponent's turn, "when your opponent ..."),
    // or a Trap that may be activated from the hand.
    const handUse = /\b(?:discard|reveal) this card\b|\b(?:send|banish) this card(?: and [^.;:]*?)? from (?:your|the) hand\b|special summon this card \(?from your hand/;
    const fromHand = handUse.test(text);
    const opponentTimingRe = /quick effect|either player's turn|(?:during )?your opponent's (?:turn|main phase|battle phase|standby phase|end phase|draw phase)|\bwhen (?:your opponent|a card or effect is activated|an? (?:monster|spell|trap|card)\b[^.;:]*?activat)|\bif your opponent (?:special summons|activates|adds|draws)/, opponentTiming = opponentTimingRe.test(text);
    // Battle tricks (Kuriboh-style damage-step discards) are not hand traps: drop cards whose
    // every hand-activation sentence is about attacks or damage calculation.
    const handSentences = text.split(/[.\n]/).filter(part => handUse.test(part));
    const battleOnly = handSentences.length > 0 && handSentences.every(part => /damage calculation|damage step|battle damage|\battacks?\b|attack declaration|battle phase/.test(part));
    // The hand activation and the opponent/quick timing must be in the same effect (one sentence),
    // so cards that merely discard or reveal themselves for their own-turn effects do not count.
    const handTiming = handSentences.some(part => opponentTimingRe.test(part)) && !battleOnly;
    when('handtrap', card.card_type === 'Monster' && fromHand && handTiming || card.card_type === 'Trap' && /activate this card from your hand/.test(text));
    // Negation: negate an activation, effect or Summon (attack negation is a battle trick).
    when('negate', /\bnegate\b(?! (?:an |the |that |its |this )?attacks?\b)/.test(text));
    // Counter-Trap style: "negate the activation" (any card), plus every Counter Trap.
    when('negate-activation', /\bnegate (?:the |that |its |their )?activations?\b/.test(text) || card.card_type === 'Trap' && card.type === 'Counter');
    // Removal: "destroy <something other than this card>"; "destroyed" is a condition, not removal.
    when('destroy', new RegExp('\\bdestroy ' + otherThanSelf).test(text));
    // Removal: banish cards on the field / of the opponent, or a target ("banish it").
    when('banish', /\bbanish (?!this card\b)(?:it\b|them\b|that (?:card|monster|target)|those (?:cards|monsters|targets)|[^.;:]*?(?:on the field|your opponent controls|your opponent's|from their (?:hand|field|gy)|face-down))/.test(text));
    // Removal: return cards (not this card) to the hand.
    when('bounce', /\breturn (?!this card\b)[^.;:]*?\bto (?:the |its |their )?(?:owner's |owners' )?hands?\b/.test(text));
    // Special Summon from the Main Deck (also "from your hand or Deck"), not from the Extra Deck.
    when('summon-deck', /special summon\b[^.;:]*?\bfrom (?:your |the )?(?:(?:hand|gy)(?:,| or| and) )*(?:or )?deck\b/.test(text));
    // Revival: Special Summon from the GY, or target a monster in a GY then Special Summon it.
    when('revive', /special summon\b[^.;:]*?\b(?:from|in) (?:your |either player's |either |your opponent's |the |their )?(?:(?:hand|deck)(?:,| or| and) )*(?:or )?gys?\b/.test(text) ||
      /\btarget\b[^.;]*?\bin (?:your|either|either player's|your opponent's) gys?\b[^.]*?;[^.]*?special summon (?:it|that (?:target|monster)|them)\b/.test(text));
    // Draw: "draw 1 card", "draw 2 cards", "draws 1 card".
    when('draw', /\bdraws? (?:up to )?(?:\d+|a|one|two|three|four|five|six|cards?)\b/.test(text));
    // Mill: send from the Deck (or its top cards) to the GY.
    when('mill', /\bsend\b[^.;:]*?\bfrom (?:your |the |their |either player's |your opponent's )?(?:main )?deck to the gy/.test(text) ||
      /\bsend the top\b[^.;:]*?\bdeck to the gy/.test(text));
    // Floodgate / lock: restrictions on the opponent or both players, or replacement of the GY.
    when('floodgate', !!describeFloodgate(text));
    // Recycle: add from the GY / banishment to the hand, or shuffle/return them into the Deck.
    when('recycle', /\badd\b[^.;:]*?(?:\bfrom (?:your |the |either )?(?:deck or )?(?:gy|banishment)|\bbanished\b)[^.;:]*?\bto (?:your|the|their) hand/.test(text) ||
      /\b(?:shuffle|return)\b[^.;:]*?(?:\bin (?:your|the|their|either) gy|\bfrom (?:your |the |their )?gy|\bbanished\b)[^.;:]*?\binto (?:the|your|their) (?:main )?deck/.test(text));
    // Burn: inflict a fixed amount or "damage equal to" (not battle damage).
    when('burn', /\binflicts? (?:\d+ damage|damage (?:to (?:your opponent|each player|both players) )?equal to)|\byour opponent (?:takes|loses) \d+ (?:damage|lp|life points)/.test(text));
    // Life Point gain.
    when('gain', /\bgains? (?:\d+ )?(?:lp|life points)\b/.test(text));
    // Tokens: Special Summon a Token.
    when('token', /special summon\b[^.;:]*?\btokens?\b/.test(text));
    // Equip: Equip Spells and effects that equip a card.
    when('equip', card.card_type === 'Spell' && card.type === 'Equip' || /\bequip (?:this card|it|that|those|them|\d+|up to|one|a|an)\b/.test(text));
    return found;
  }
  // ATK/DEF relations for Monsters. '?' / negative / missing stats never match; Links have no DEF.
  function statValue(raw) { if (raw == null || String(raw).trim() === '' || raw === '?' || !Number.isFinite(Number(raw)) || Number(raw) < 0) return null; return Number(raw); }
  const statExpressions = { sum: (a, d) => a + d, diff: (a, d) => a - d, rdiff: (a, d) => d - a };
  function statMatch(card, q) {
    const relation = q.statRelation || '', expression = statExpressions[q.statExpr] && String(q.statValue ?? '').trim() !== '' && Number.isFinite(Number(q.statValue)) ? q.statExpr : '';
    if (!relation && !expression) return true;
    if (card.card_type !== 'Monster' || String(card.monster_color).includes('Link')) return false;
    const atk = statValue(card.atk), def = statValue(card.def);
    if (atk === null || def === null) return false;
    if (relation === 'eq' && atk !== def || relation === 'gt' && atk <= def || relation === 'lt' && atk >= def) return false;
    if (!expression) return true;
    const value = statExpressions[expression](atk, def), target = Number(q.statValue);
    return q.statCompare === 'ge' ? value >= target : q.statCompare === 'le' ? value <= target : value === target;
  }
  function terms(query, mode) { const text = normalize(query).trim(); return mode === 'all' ? text.split('*').map(s => s.trim()).filter(Boolean) : [text]; }
  function indexedMatch(texts, terms, mode) { return terms.every(term => mode === 'all' && term.startsWith('-') && term.length > 1 ? !texts.some(s => s.includes(term.slice(1))) : texts.some(s => s.includes(term))); }
  function aliases(card) {
    const text = normalize(card.effect) + '\n' + normalize(card.pendulum_effect), result = [];
    const quoted = clause => { for (const name of clause.matchAll(/"([^"]+)"/g)) if (!result.includes(name[1])) result.push(name[1]); };
    // Printed identity clauses about this card only: "this card('s name) is (also) (always)
    // treated as "A" (and "B")". Quoted names may contain periods; other effect text is ignored, and so is a
    // name in a condition ("treated as a Toon monster while "Toon World" is on the field", "treated as a Continuous
    // Trap: you can Tribute 1 "HERO" monster"); "while face-up on the field" only says where the name holds.
    for (const clause of text.matchAll(/this card(?:'s name)? is (?:also )?(?:always )?treated as ((?:[^".):;\n]|"[^"\n]*")+)/g)) {
      const rest = clause[1].replace(/\s*while (?:it is |this card is )?(?:face-up )?(?:on the field|in the (?:gy|graveyard))\s*$/, '');
      if (!/\b(?:while|if|when|unless|during|as long as)\b/.test(rest.replace(/"[^"\n]*"/g, ' '))) quoted(rest);
    }
    // "This card's name becomes "X" while on the field or in the GY" is a location-wide rename;
    // conditional renames such as "While face-up, this card's name becomes ..." stay excluded.
    for (const clause of text.matchAll(/this card's name becomes ("[^"\n]+"(?:(?:,| and| or|, and|, or) "[^"\n]+")*) while (?:it is |this card is )?(?:face-up )?(?:on the field|in the (?:gy|graveyard))/g)) quoted(clause[1]);
    return result;
  }
  function textMatch(texts, query, mode) {
    const haystacks = texts.map(normalize), value = normalize(query).trim();
    const terms = mode === 'all' ? value.split('*').map(s => s.trim()).filter(Boolean) : [value];
    return terms.every(term => mode === 'all' && term.startsWith('-') && term.length > 1
      ? !haystacks.some(s => s.includes(term.slice(1))) : haystacks.some(s => s.includes(term)));
  }
  const quoteText = value => String(value ?? '').normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let nestedNames = null;
  function quoteMatches(text) {
    if (!text.includes('"')) return [];
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (nestedNames?.cards !== cards || nestedNames.size !== cards.length) {
      const names = [...new Set(cards.filter(card => card?.name?.includes('"') && !card.rush).map(card => card.name))].sort((a, b) => b.length - a.length);
      nestedNames = { cards, size: cards.length, names, middle: names.filter(name => !name.startsWith('"') && !name.endsWith('"')) };
    }
    const nested = [];
    for (const name of text.includes('""') ? nestedNames.names : nestedNames.middle) for (let at = text.indexOf('"' + name + '"'); at >= 0; at = text.indexOf('"' + name + '"', at + name.length + 2)) {
      const match = ['"' + name + '"', name]; match.index = at; nested.push(match);
    }
    return [...nested, ...[...text.matchAll(/"([^"\n]{1,80})"/g)].filter(match => !nested.some(other => match.index < other.index + other[0].length && match.index + match[0].length > other.index))].sort((a, b) => a.index - b.index);
  }
  function maskQuotes(text, names) {
    let masked = '', cursor = 0;
    for (const match of quoteMatches(text)) { masked += text.slice(cursor, match.index) + `"§${names.push(match[1]) - 1}§"`; cursor = match.index + match[0].length; }
    return masked + text.slice(cursor);
  }
  const wordy = /[\p{L}\p{N}]/u;
  // These English archetypes also occur inside a word (Epurrely, Daigusto, Saqlifice).
  // Other words still need a boundary: "Rose" must not include "Primrose".
  const EMBEDDED_ARCHETYPES = new Set(['roid', 'lswarm', 'tellarknight', 'purrely', 'rokket', 'qli', 'gusto', 'invoked', 'mathmech', 'lightsworn', 'number c', 'magnet warrior', 'noble knight', 'noble arms', 'ritual beast', 'ritual beast tamer']);
  // "hero" is in "elemental hero neos" and "gem-" in "gem-knight pearl", but "rose" is not in "primrose". A plural
  // counts: "sacred beast" is in "calamity of the sacred beasts - hamon", "hero" in "heroes".
  function namePart(name, part) {
    for (let i = name.indexOf(part); i >= 0; i = name.indexOf(part, i + 1)) {
      let end = i + part.length;
      if (wordy.test(part.at(-1))) {
        if (name.startsWith('es', end) && !wordy.test(name[end + 2] || '')) end += 2;
        else if (name[end] === 's' && !wordy.test(name[end + 1] || '')) end += 1;
      }
      const before = name[i - 1], after = name[end];
      if ((!before || !wordy.test(before) || !wordy.test(part[0])) && (!after || !wordy.test(after) || !wordy.test(part.at(-1)))) return true;
    }
    return false;
  }
  let catalogIds = null;
  function catalogCard(id, name) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (catalogIds?.cards !== cards || catalogIds.size !== cards.length) catalogIds = { cards, size: cards.length, map: new Map(cards.map(c => [String(c.id), c])) };
    const byId = catalogIds.map.get(String(id));
    return byId && (!name || byId.name === name) ? byId : name ? cards.find(c => c.name === name) || null : null;
  }
  // Archetypes. DuelingBook's catalog has no archetype field, so they are inferred: a quoted name that
  // card texts use as one ('"Artmage" monster', '"Mitsurugi" Ritual Spell', '"HERO" cards') and that
  // at least two card names (or "treated as" names) contain.
  const kindModifiers = '(?:(?:normal|effect|ritual|fusion|synchro|xyz|link|pendulum|tuner|flip|gemini|spirit|toon|union|quick-play|continuous|field|equip|counter)\\s+)*';
  // Monster abilities besides Tuner: "Level 5 or higher Flip monster", "1 Gemini monster".
  const ABILITIES = ['Flip', 'Gemini', 'Spirit', 'Toon', 'Union'];
  // '"Scrap" Tuner' is a "Scrap" Tuner monster.
  const kindWords = '(?:cards?|monsters?|spells?\\/traps?|spells?|traps?|tuners?)';
  const archetypeUse = new RegExp(`"([^"\\n]{2,40})"\\s+${kindModifiers}${kindWords}\\b`, 'gi');
  let archetypeIndex = null;
  // The catalog's indexes are built on first use, or ahead in a search's slices (fetchRanksTask).
  function* archetypeIndexTask(cards) {
    if (archetypeIndex?.cards === cards && archetypeIndex.size === cards.length) return;
    const used = new Map();
    for (const other of cards) {
      yield* fetchCheckpoint();
      for (const match of quoteText(other.effect + '\n' + other.pendulum_effect).matchAll(archetypeUse)) {
        const key = normalize(match[1]); if (!used.has(key)) used.set(key, match[1]);
      }
    }
    archetypeIndex = { cards, size: cards.length, used, members: new Map() };
  }
  function archetypesOf(card) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (!card?.name || !cards.length) return [];
    if (archetypeIndex?.cards !== cards || archetypeIndex.size !== cards.length) labDrain(archetypeIndexTask(cards));
    const own = indexedText(card).name, found = [];
    for (const [key, label] of archetypeIndex.used) {
      if (!own.some(name => namePart(name, key))) continue;
      if (!archetypeIndex.members.has(key)) {
        let count = 0;
        for (const other of cards) if (!other.rush && indexedText(other).name.some(name => namePart(name, key)) && ++count >= 2) break;
        archetypeIndex.members.set(key, count);
      }
      if (archetypeIndex.members.get(key) >= 2) found.push(label);
    }
    return found.sort((a, b) => b.length - a.length).slice(0, 4);
  }
  // Reverse search: the clauses of a card's text that add a card to the hand, Summon it, Set or place
  // it, or send it from the Deck or Extra Deck to the GY, and what that card has to be. Heuristic,
  // like the Effect categories: one clause at a time, read from the verb on. A card kind is enough
  // for a Deck action (Foolish Burial sends any monster); an unqualified "add 1 card" lists nothing.
  const fetchVerb = /\b(?:banish(?:es)?\s+(?:up to\s+)?(?:\d+|a|an|one|two|three)\b(?=[^]*?\bfrom (?:your|the|their) (?:main |extra )?deck\b)|adds?\b(?=[^]*?\bto (?:your|the|their|its owner's) hand)|(?:special|ritual|fusion|synchro|xyz|link|normal|tribute) summons?\b|(?:sets?|places?)\s+(?:up to\s+)?(?:\d+|a|an|one|two|three)\b(?=[^]*?\bfrom\b)|destroy\s+(?:up to\s+)?(?:\d+|a|an|one|two|three)\b(?=(?:(?!\b(?:take|add|send|summon|set|banish)\b)[^.;])*?\b(?:in|from) your (?:(?:hand|field|face-up field)\s*,?\s*(?:or |and |and\/or )?)*Deck\b)|sends?\s+to (?:the )?(?:gy|graveyard)(?=[^]*?\bfrom (?:your|the|their) (?:main |extra )?deck\b)|sends?\s+(?:up to\s+)?(?:\d+|a|an|one|two|three)\b(?=[^]*?\bfrom (?:your|the|their) (?:main |extra )?deck\b[^]*?\b(?:gy|graveyard)\b))/i;
  // Where a fetched card comes from: "from your hand or Deck" and "the top 3 cards of your Deck" are the
  // Main Deck; "from your Extra Deck" (and every Fusion, Synchro, Xyz and Link Summon) the Extra Deck.
  const mainDeckSource = /\bfrom (?:your |the |their |either player's )?(?:(?:hand|gy|graveyard|field|banishment|extra deck)\s*,?\s*(?:or |and |and\/or )?)*(?:main )?(?<!extra )deck\b|\b(?:top|bottom)\s+(?:\w+\s+)?cards?\s+of\s+(?:your|the|their)\s+deck\b|\bexcavate\b/i;
  const destroyDeckSource = /\b(?:in|from) your (?:(?:hand|field|face-up field)\s*,?\s*(?:or |and |and\/or )?)*Deck\b/i;
  const extraDeckSource = /\bfrom (?:your |the |their )?(?:(?:hand|gy|graveyard|field|banishment|main deck|deck)\s*,?\s*(?:or |and |and\/or )?)*(?:face-up )?extra deck\b/i;
  const ATTRIBUTES = ['LIGHT', 'DARK', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
  const fetchVerbs = new RegExp(fetchVerb.source, 'gi');
  const FRAMES = ['Normal', 'Effect', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum'];
  // An Effect Monster: DuelingBook's Effect frame, or its effect flag on a Ritual, Fusion, Synchro, Xyz or Link Monster.
  // The flag alone is not enough: DuelingBook sets it on some Normal Monsters (97 in catalog 787, Blue-Eyes White Dragon
  // and Dark Magician among them), which listed Normal Monsters for "2 Effect Monsters" (user, 2026-10-29).
  const effectMonster = card => card.card_type === 'Monster' && String(card.monster_color) !== 'Normal' &&
    (String(card.monster_color).includes('Effect') || Number(card.is_effect) === 1);
  const PROPERTIES = { Spell: ['Normal', 'Continuous', 'Equip', 'Quick-Play', 'Field', 'Ritual'], Trap: ['Normal', 'Continuous', 'Counter'] };
  let typePattern = null;
  function monsterTypes() {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (typePattern?.cards !== cards || typePattern.size !== cards.length) {
      const types = [...new Set(cards.filter(c => c.card_type === 'Monster' && c.type && c.type !== 'Proxy').map(c => c.type))].sort((a, b) => b.length - a.length);
      const escaped = types.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      // Capitalised Type words anywhere in the phrase: "Dragon monster", "Pyro or Aqua", "Warrior-Type". Names are quoted, so masked.
      // Words that narrow one noun, joined by "or": '"Toon" Field or Continuous Spell', '"X" Warrior or Spellcaster monster'.
      const narrow = `(?:${[...new Set([...PROPERTIES.Spell, 'Counter', ...FRAMES, ...ABILITIES, 'FLIP', ...ATTRIBUTES])].join('|')}${escaped ? '|' + escaped : ''})(?:-Type)?`;
      typePattern = { cards, size: cards.length, names: types, regex: escaped ? new RegExp(`\\b(${escaped})(?:-Type)?\\b`, 'g') : null,
        non: new RegExp(`\\bnon-(${escaped ? escaped + '|' : ''}[A-Za-z][\\w-]*)`, 'g'),
        narrowedName: new RegExp(`"§\\d+§"(?:,?\\s+${narrow})+,?$`),
        narrowedNoun: new RegExp(`^${narrow}(?:(?:,\\s*(?:and\\/or\\s+|or\\s+|and\\s+)?|\\s+(?:and\\/or|or|and)\\s+|\\s+)${narrow})*\\s+(?:monsters?|Monsters?|Tuners?|Spell\\/Traps?|Spells?|Traps?|cards?)\\b`) };
    }
    return typePattern;
  }
  function kindsOf(word, modifiers = '') {
    const kind = word.toLowerCase().replace(/s(?=\/|$)/g, ''), mods = modifiers.trim().split(/[\s,]+/).filter(word => word && !/^(?:or|and|and\/or)$/i.test(word)).map(m => m.replace(/(^|-)([a-z])/g, (x, dash, c) => dash + c.toUpperCase()));
    const kinds = kind === 'monster' || kind === 'tuner' ? ['Monster'] : kind === 'spell' ? ['Spell'] : kind === 'trap' ? ['Trap'] : kind === 'spell/trap' ? ['Spell', 'Trap'] : null;
    const result = { kinds, frames: [], properties: [], tuner: mods.includes('Tuner') || kind === 'tuner', abilities: [] };
    for (const mod of mods) {
      if (kinds?.includes('Monster') && ABILITIES.includes(mod)) result.abilities.push(mod);
      else if (kinds?.includes('Monster') && FRAMES.includes(mod)) result.frames.push(mod);
      else if (kinds) for (const type of kinds) if (PROPERTIES[type]?.includes(mod)) result.properties.push(`${type}:${mod}`);
    }
    return result;
  }
  // A Fusion, Synchro, Xyz, Link or Ritual Summon brings out only a monster of that frame:
  // "Fusion Summon 1 Dragon or Spellcaster monster" is a Fusion Monster.
  const summonFrame = verb => ({ fusion: 'Fusion', synchro: 'Synchro', xyz: 'Xyz', link: 'Link', ritual: 'Ritual' })[String(verb).toLowerCase().split(/\s+/)[0]] || '';
  // Different descriptions joined by "or" are alternatives, not an intersection:
  // '"Gravekeeper's" or EARTH Fairy monster', 'Dinosaur Tuner or Dinosaur Normal Monster'.
  function splitDescriptions(text) {
    if (!/\s(?:or|and\/or)\s/i.test(text)) return [{ start: 0, end: text.length, text }];
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++; else if (text[i] === ')') depth--;
      if (depth || text[i] !== ' ') continue;
      const join = text.slice(i).match(/^ (?:or|and\/or) /i);
      if (!join) continue;
      const before = text.slice(0, i), after = text.slice(i + join[0].length), noun = after.match(/\b(monsters?|Monsters?|Tuners?|Spells?|Traps?|cards?)\b/);
      if (!objectNoun.test(before) || !noun) continue;
      // Alternatives of a source, number, or comparison still describe the same card.
      if (/^(?:(?:your |the )?(?:hand|Deck|GY|Graveyard|banishment|Extra Deck)\b|face-up Extra Deck\b|(?:less|lower|more|higher|equal|ATK|DEF)\b)/i.test(after) || /\b(?:less|greater|lower|higher) than\s*$/i.test(before)) continue;
      if (/"§\d+§",?\s*$/.test(before) && /^"§\d+§"/.test(after)) continue;
      // Spell / Trap alternatives already share their properties and "mentions" clause.
      if (/\b(?:Spell|Trap)s?\s*$/i.test(before) && /^\s*(?:Spell|Trap)s?\b/i.test(after)) continue;
      // '"Toon" Field or Continuous Spell' is a "Toon" Field Spell or a "Toon" Continuous Spell, not any Continuous Spell.
      if (monsterTypes().narrowedName.test(before) && monsterTypes().narrowedNoun.test(after)) continue;
      const shared = /\b(?:monsters?|tuners?|spells?|traps?|cards?)\b/i.test(before) ? '' : ' ' + noun[0];
      const scale = before.match(/\b(?:Level|Rank|Link Rating) \d+(?: or (?:lower|higher|less|more))?\b/)?.[0];
      return [{ start: 0, end: i, text: before + shared }, ...splitDescriptions(after).map(part => ({ ...part, text: scale && /monster|tuner/i.test(noun[0]) && !/\b(?:Level|Rank|Link Rating)\b/.test(part.text) ? scale + ' ' + part.text : part.text, start: part.start + i + join[0].length, end: part.end + i + join[0].length }))];
    }
    return [{ start: 0, end: text.length, text }];
  }
  const refKind = new RegExp(`^\\s+(${kindModifiers})(${kindWords})\\b`, 'i'), sharedKind = new RegExp(`^(?:(?:\\s*,\\s*(?:(?:and\\/or|or|and)\\s+)?|\\s+(?:and\\/or|or|and)\\s+)"§\\d+§")+\\s+(${kindModifiers})(${kindWords})\\b`, 'i');
  const frameWord = '(?:Normal|Effect|Ritual|Fusion|Synchro|Xyz|Link|Pendulum)';
  const framePattern = new RegExp(`\\b(${frameWord}(?:(?:,\\s*(?:and\\/or\\s+|or\\s+|and\\s+)?|\\s+(?:and\\/or|or|and)\\s+)${frameWord})*)\\s+(?:Tuner\\s+)?Monsters?\\b`, 'g');
  const propertyWord = '(?:Quick-Play|Continuous|Equip|Field|Ritual|Normal|Counter)';
  const propertyPattern = new RegExp(`\\b(${propertyWord}(?:(?:,\\s*(?:and\\/or\\s+|or\\s+|and\\s+)?|\\s+(?:and\\/or|or|and)\\s+)${propertyWord})*)\\s+(Spell\\/Traps?|Spells?|Traps?)\\b`, 'g');
  const bracketFrames = new RegExp(`\\bmonsters? \\((${frameWord}(?:/${frameWord})+)\\)`, 'g');
  const quotedKind = new RegExp(`"§\\d+§"(?:\\s+${kindModifiers}${kindWords}\\b)?`, 'gi');
  const scalePatterns = [['level', 'Levels?'], ['rank', 'Ranks?'], ['link', 'Link(?:-| Rating (?:of )?)']].map(([key, word]) => ({
    key, bound: new RegExp(`\\b${word} ?(\\d+) or (lower|higher|less|more)\\b`, 'i'),
    list: new RegExp(`\\b${word} (\\d+(?:,\\s*(?:(?:or|and)\\s+)?\\d+){2,}|\\d+(?: or \\d+){2,})\\b`, 'i'),
    choices: new RegExp(`\\b${word} (?:from )?(\\d+) (or|and|to) (\\d+)\\b`, 'i'), exact: new RegExp(`\\b${word} ?(\\d+)\\b`, 'i')
  }));
  let referenceWords = null;
  function knownArchetype(name) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (referenceWords?.cards !== cards || referenceWords.size !== cards.length) {
      const names = new Map(cards.filter(card => card?.name && !card.rush).map(card => [normalize(card.name), card.name])), exact = new Set(names.keys()), used = new Set();
      for (const card of cards) if (!card.rush) for (const match of quoteText(card.effect + '\n' + card.pendulum_effect).matchAll(archetypeUse)) used.add(normalize(match[1]));
      referenceWords = { cards, size: cards.length, exact, used, names };
    }
    return !referenceWords.exact.has(name) && referenceWords.used.has(name);
  }
  function fetchPhrase(text, names, frame = '', allowGeneric = false, descriptions = true) {
    const phrase = { refs: [], kinds: null, frames: [], properties: [], tuner: false, abilities: [], attributes: [], types: [], stats: {}, not: [] };
    text = text.replace(bracketFrames, (match, frames) => frames.replace(/\//g, ' or ') + ' Monsters');
    const choices = descriptions ? splitDescriptions(text) : [{ text }];
    if (choices.length > 1) {
      phrase.alternatives = choices.map(part => fetchPhrase(part.text, names, frame, allowGeneric)).filter(Boolean);
      return phrase.alternatives.length ? phrase : null;
    }
    // How the card is placed or treated is not what it is: "as a face-up Continuous Spell", "as an Effect Monster".
    text = text.replace(/\b(?:(?:is |be )?treated )?as (?:(?:a|an)\s+|face-up\s+|face-down\s+)[^,;]*/gi, ' ');
    text = text.replace(/\(1 Tuner and 1 non-Tuner(?: monster)?\)/gi, ' ');
    text = text.replace(/\b(?:has|have) (?=\d+ (?:ATK|DEF)\b)/gi, 'with ');
    // "that specifically lists the card "Dark Magician" in its text" mentions it, like "that mentions "Dark Magician"".
    text = text.replace(/\b(mentions?|lists?) the card (?="§\d+§")/gi, '$1 ');
    text = text.replace(/\bwith (\d+|\?) ATK (?:and|&) DEF\b/gi, 'with $1 ATK and $1 DEF');
    text = text.replace(/\bnon-"§(\d+)§"/gi, (m, n) => { (phrase.excluded ||= []).push({ name: normalize(names[n]), label: names[n], mode: 'archetype' }); return ' '; });
    // A card mentioned as the reference for a name is not another fetched card, but a condition: "1 Ritual Monster whose
    // name is mentioned on that Ritual Spell" (Pre-Preparation of Rites) is one that a Ritual Spell quotes. "that card"
    // is read from the clause before (readClause).
    text = text.replace(/\bwhose name is (?:specifically )?(?:mentioned|listed) on (?:that|the) (Ritual (?:Spell|Monster)|card)\b/gi, (m, on) => {
      if (/^card$/i.test(on)) phrase.mentionedOn = 'card'; else phrase.mentionedOn = fetchPhrase(on, names) || undefined;
      return ' ';
    });
    // "a Spell/Trap that mentions an "Elemental HERO" monster's card name": it quotes the name of a monster of that archetype.
    text = text.replace(/\bmentions? (?:an? )?"§(\d+)§" (monster|card|Spell|Trap)'s (?:card )?names?\b/gi, (m, n, noun) => {
      phrase.refs.push({ name: normalize(names[n]), mode: 'member', ...kindsOf(noun), label: names[n], index: Number(n) });
      return ' ';
    });
    text = text.replace(/\bnumber between "§(\d+)§" and "§(\d+)§" in (?:its|their|the) names?\b/gi, (m, a, b) => {
      if (!/^\d+$/.test(names[a]) || !/^\d+$/.test(names[b])) return m;
      phrase.numberRange = { low: Number(names[a]), high: Number(names[b]), prefix: '' }; return ' ';
    });
    text = text.replace(/\bwith (\d+|\?) ATK\s*(?:&|and|\/)\s*(\d+|\?) DEF,? or (\d+|\?) ATK\s*(?:&|and|\/)\s*(\d+|\?) DEF\b/gi, (m, a, d, b, e) => {
      phrase.statAlternatives = [{ atk: [a, a], def: [d, d] }, { atk: [b, b], def: [e, e] }]; return ' ';
    });
    const namedRange = text.match(/"§(\d+)§" (?:through|to) "§(\d+)§" in (?:its|their|the) names?\b/i);
    const first = namedRange && names[namedRange[1]]?.match(/^(.*?)(\d+)$/), last = namedRange && names[namedRange[2]]?.match(/^(.*?)(\d+)$/);
    if (first && last && first[1] === last[1]) phrase.numberRange = { low: Number(first[2]), high: Number(last[2]), prefix: first[1].trim() };
    for (const match of text.matchAll(/"§(\d+)§"/g)) {
      const name = normalize(names[Number(match[1])]), before = text.slice(0, match.index), after = text.slice(match.index + match[0].length);
      // '"X" monster' is an archetype, 'that mentions "X"' a mention, a bare "X" that card; '"A" or "B" monster' share the kind.
      const kind = after.match(refKind) || after.match(sharedKind) || after.match(/^\s+((?:(?:[A-Z][\w-]*|or|and|and\/or)[ ,]+)+)(monsters?|Spells?|Traps?)\b/);
      const preceding = before.match(/\b(monsters?|cards?|spells?|traps?)(?:\(s\))?\s*$/i) || before.match(/\b(monsters?)\b[^.;]*\(\s*(?:"§\d+§"\s*,\s*)*$/i);
      const mentioned = /\b(?:mentions?|lists?)\s+(?:an?\s+)?$|\bmentions?\s*$/i.test(before) || phrase.refs.at(-1)?.mode === 'mention' && /\b(?:mentions?|lists?)\s+"§\d+§",?\s+(?:or|and|and\/or)\s+$/i.test(before);
      const ref = mentioned ? { name, mode: 'mention' } : kind ? { name, mode: 'archetype', ...kindsOf(kind[2], kind[1]) } : preceding ? { name, mode: 'archetype', ...kindsOf(preceding[1]) } : /^\s+(?:in (?:its|their|the) (?:original )?names?|names?|Tributes?)\b/i.test(after) ? { name, mode: 'archetype', ...kindsOf('monster') } : knownArchetype(name) ? { name, mode: 'archetype', ...kindsOf('card') } : { name, mode: 'exact' };
      if (/\bin (?:its|their|the) (?:original )?names?\b/i.test(text) && /\b(?:has|have|with)\b/i.test(before)) Object.assign(ref, { mode: 'archetype', nameMatch: 'includes' });
      if (phrase.numberRange?.prefix && [namedRange[1], namedRange[2]].includes(match[1])) Object.assign(ref, { name: normalize(phrase.numberRange.prefix), mode: 'archetype', ...kindsOf('monster') });
      phrase.refs.push(Object.assign(ref, { label: names[Number(match[1])], index: Number(match[1]) }));
      if (ref.mode === 'exact' && /s$/.test(name) && !referenceWords?.exact.has(name)) {
        const singular = [name.replace(/s$/, ''), name.replace(/es$/, '')].find(word => referenceWords?.exact.has(word));
        if (singular) Object.assign(ref, { name: singular, label: referenceWords.names.get(singular) });
      }
      if (phrase.numberRange?.prefix && [namedRange[1], namedRange[2]].includes(match[1])) ref.label = phrase.numberRange.prefix;
    }
    // Conditions outside the quoted names; zone names are not card kinds.
    // "non-Effect", "non-Tuner", "non-DARK": what the card must not be.
    const nonWord = monsterTypes().non;
    phrase.not = [...text.matchAll(nonWord)].map(m => m[1].toLowerCase().replace(/^(tuner|token)s$/, '$1'));
    const plain = text.replace(quotedKind, ' ').replace(nonWord, ' ')
      .replace(/\bLevel\/Rank\/Link (\d+)\b/gi, 'Level $1 or Rank $1 or Link Rating $1')
      .replace(/\b(?:with|has|have) (?:an? )?(ATK|DEF) of (\d+)(?: points)?(?: or (less|lower|more|higher))?\b/gi, (m, stat, n, bound) => `with ${n}${bound ? ' or ' + bound : ''} ${stat}`)
      .replace(/\b(?:main |extra )?monster zones?\b|\bspell (?:&|and) trap zones?\b|\bfield zone\b|\bpendulum zones?\b|\b(?:spell|trap) counters?\b/gi, ' ')
      .replace(/\b(?:that|which) (?:cannot|can) be (?:Normal|Special) Summoned(?:\/Set)?\b/gi, ' ');
    // "a monster that cannot be Normal Summoned/Set" (and "that can be ..."): a summoning condition of the card.
    phrase.normal = /\bthat cannot be Normal Summoned\b/i.test(text) ? 'no' : /\bthat can be Normal Summoned\b/i.test(text) ? 'yes' : '';
    // "1 Level 7 or lower monster that has a coin tossing effect": what the card's own text does.
    const counter = text.match(/\bthat (?:you )?can (?:place|have) (?:an? )?([A-Za-z-]+) Counters? on\b/i);
    // "whose ATK equals its own DEF", "with the same ATK and DEF": a relation between the card's own stats.
    phrase.relation = /\bATK (?:equals?|is equal to|is the same as) (?:its|their) (?:own )?DEF\b|\b(?:with|has|have) (?:the same|equal) ATK and DEF\b|\bwhose ATK and DEF are (?:the same|equal)\b/i.test(text) ? 'eq'
      : /\bATK (?:does not|doesn't) equal (?:its|their) (?:own )?DEF\b/i.test(text) ? 'ne' : '';
    phrase.textHas = [/\bcoin[- ]toss(?:ing)? effect/i.test(text) && 'coin', /\b(?:dice|die)[- ]roll(?:ing)? effect/i.test(text) && 'die', counter && 'counter:' + counter[1].toLowerCase()].filter(Boolean);
    const kinds = new Set();
    for (const match of plain.matchAll(/\b(monster|spell\/trap|spell|trap)s?\b/gi)) for (const kind of kindsOf(match[1]).kinds) kinds.add(kind);
    if (kinds.size && !/\bcards?\b/i.test(plain.replace(/\b(?:this|that|these|those) cards?\b/gi, ' '))) phrase.kinds = [...kinds];
    // "Fusion Monster", and lists: "Fusion or Synchro Monster", "Fusion, Synchro, or Xyz Monster".
    for (const match of plain.matchAll(framePattern))
      phrase.frames.push(...match[1].split(/,\s*(?:and\/or\s+|or\s+|and\s+)?|\s+(?:and\/or|or|and)\s+/));
    // "Continuous Spell", and lists: "Field or Continuous Spell", "Normal, Quick-Play, or Ritual Spell".
    for (const match of plain.matchAll(propertyPattern)) for (const type of kindsOf(match[2]).kinds) for (const word of match[1].split(/,\s*(?:and\/or\s+|or\s+|and\s+)?|\s+(?:and\/or|or|and)\s+/)) if (PROPERTIES[type].includes(word)) phrase.properties.push(`${type}:${word}`);
    phrase.tuner = /\bTuners?\b/.test(plain);
    phrase.abilities = [...new Set([...plain.matchAll(/\b(FLIP|Flip|Gemini|Spirit|Toon|Union)\s+(?:(?:Effect|Normal|Tuner|Pendulum)\s+)?[Mm]onsters?\b/g)].map(match => match[1] === 'FLIP' ? 'Flip' : match[1]))];
    phrase.attributes = [...new Set(plain.match(/\b(?:LIGHT|DARK|EARTH|WATER|FIRE|WIND|DIVINE)\b/g) || [])];
    const types = monsterTypes().regex;
    if (types) phrase.types = [...new Set([...plain.matchAll(types)].map(match => match[1]))];
    const bound = (value, word) => /more|higher/i.test(word) ? [value, ''] : ['', value];
    let match;
    if ((match = plain.match(/\bwith (\d+|\?) ATK\s*(?:\/|and|&)\s*(\d+|\?) DEF\b/i))) Object.assign(phrase.stats, { atk: [match[1], match[1]], def: [match[2], match[2]] });
    for (const stat of plain.matchAll(/\b(?:with )?(\d+) or (more|less|higher|lower) (ATK|DEF)\b/gi)) phrase.stats[stat[3].toLowerCase()] = bound(stat[1], stat[2]);
    for (const stat of plain.matchAll(/\bwith (\d+|\?) (ATK|DEF)\b(?!\s*(?:\/|and|&)\s*(?:\d+|\?) DEF)/gi)) phrase.stats[stat[2].toLowerCase()] ||= [stat[1], stat[1]];
    // "with 2400 or more ATK and 1000 DEF": the second stat of a pair.
    for (const stat of plain.matchAll(/\b(?:ATK|DEF)\s*(?:\/|and|&)\s*(\d+|\?) (ATK|DEF)\b/gi)) phrase.stats[stat[2].toLowerCase()] ||= [stat[1], stat[1]];
    // Level, Rank and Link Rating are kept apart: DuelingBook stores all three in "level", but a Level
    // belongs to neither Xyz nor Link Monsters. A bare "Level" ("the same original Type and Level")
    // still needs a monster that has one.
    for (const { key, bound: rangePattern, list: listPattern, choices: choicesPattern, exact: exactPattern } of scalePatterns) {
      if ((match = plain.match(listPattern))) { const values = match[1].match(/\d+/g); phrase.stats[key] = [String(Math.min(...values)), String(Math.max(...values))]; (phrase.values ||= {})[key] = values; }
      else if ((match = plain.match(rangePattern))) phrase.stats[key] = bound(match[1], match[2]);
      else if ((match = plain.match(choicesPattern))) {
        phrase.stats[key] = [String(Math.min(match[1], match[3])), String(Math.max(match[1], match[3]))];
        if (match[2].toLowerCase() !== 'to' && Math.abs(Number(match[1]) - Number(match[3])) > 1) (phrase.values ||= {})[key] = [match[1], match[3]];
      }
      else if ((match = plain.match(exactPattern))) phrase.stats[key] = [match[1], match[1]];
    }
    const level = /\bLevels?\b/i.test(plain), rank = /\bRanks?\b/i.test(plain), link = /\bLink(?:-\d| Ratings?\b)/i.test(plain);
    phrase.needs = level && !rank && !link ? 'level' : rank && !level ? 'rank' : link && !level ? 'link' : '';
    const scales = Object.keys(phrase.stats).filter(key => ['level', 'rank', 'link'].includes(key));
    if (scales.length > 1 && /\bor\b/i.test(plain)) {
      phrase.scaleAlternatives = Object.fromEntries(scales.map(key => [key, phrase.stats[key]]));
      for (const key of scales) delete phrase.stats[key];
      phrase.needs = '';
    }
    if (frame && !phrase.refs.some(ref => ref.kinds?.length && !ref.kinds.includes('Monster'))) { phrase.frames = [frame]; phrase.kinds = ['Monster']; }
    if (/\b(?:odd|even) Pendulum Scale\b/i.test(text)) {
      const odd = /\bodd\b/i.test(text), even = /\beven\b/i.test(text);
      phrase.scaleParity = odd && even ? 'any' : odd ? 'odd' : 'even';
      phrase.frames = ['Pendulum']; phrase.kinds = ['Monster'];
    }
    // In "Machine 'roid' or 'Elemental HERO' monster", Machine belongs to the first name.
    const firstName = text.match(/"§\d+§"/);
    if (phrase.refs.length > 1 && firstName && /"§\d+§"\s+or\s+"§\d+§"/.test(text) && monsterTypes().names.some(type => text.slice(0, firstName.index).endsWith(type + ' '))) {
      phrase.refs[0].types = phrase.types; phrase.types = [];
    }
    const conditions = phrase.refs.length + (phrase.excluded?.length || 0) + phrase.frames.length + phrase.properties.length + phrase.attributes.length + phrase.types.length + Object.keys(phrase.stats).length + phrase.tuner + phrase.abilities.length + !!phrase.normal + !!phrase.relation + !!phrase.numberRange + !!phrase.statAlternatives + phrase.textHas.length + phrase.not.length + !!phrase.mentionedOn;
    const generic = allowGeneric && phrase.kinds?.length && !/\b(?:with|whose|that|same|different|following|these|those|such|one of|any of|listed|mentioned|based on)\b/i.test(text);
    return conditions || generic ? phrase : null;
  }
  // "add 1 "Dark Magician", or 1 non-Ritual Monster that mentions it": "it" is the last name quoted before.
  function resolveMentions(text, before = '') {
    return text.replace(/\bmentions? (?:it|them|that card|that monster)(?:'s name)?\b/gi, (match, index) => {
      const last = [...(before + text.slice(0, index)).matchAll(/"§(\d+)§"/g)].pop();
      return last ? `mentions "§${last[1]}§"` : match;
    });
  }
  // One phrase per object ("1 "X" monster and 1 "Y" Spell"), as { text, start, end } (offsets in object).
  // These stay one phrase: "Level 7 or 8", brackets ("(1 Normal Monster and 1 Effect Monster)"), and a stat
  // after "and" ("with 1200 ATK and 1000 or less DEF"). An object without its own noun shares the next
  // one's: "1 Level 4 or lower and 1 Level 5 or higher EARTH Machine monsters" is two EARTH Machines.
  const objectNoun = /"§\d+§"|\b(?:monsters?|cards?|spells?|traps?|spell\/traps?|tuners?)\b/i;
  function splitObjects(object) {
    const parts = [];
    let from = 0;
    for (const match of object.matchAll(/(?<!\b(?:levels?|ranks?) \d+),?\s+(?:and|or|and\/or)\s+(?=(?:up to\s+)?(?:\d+|a|an|one|two)\s)/gi)) {
      const before = object.slice(0, match.index);
      if (/\b(?:Levels?|Ranks?) \d+(?:(?:,\s*(?:(?:or|and)\s+)?| or )\d+)*,?$/.test(before) && (/\bor\b/i.test(match[0]) || /,/.test(before))) continue;
      parts.push({ start: from, end: match.index }); from = match.index + match[0].length;
    }
    parts.push({ start: from, end: object.length });
    const merged = [];
    for (const part of parts) {
      const previous = merged.at(-1), before = previous ? object.slice(previous.start, previous.end) : '';
      const open = (before.match(/\(/g) || []).length - (before.match(/\)/g) || []).length;
      if (previous && (open > 0 || /^\s*\d+\s+(?:or (?:more|less|higher|lower)\s+)?(?:ATK|DEF)\b/i.test(object.slice(part.start, part.end)))) previous.end = part.end;
      else merged.push({ ...part });
    }
    return merged.map((part, i) => {
      let text = object.slice(part.start, part.end);
      const next = merged[i + 1];
      if (next && !objectNoun.test(text)) text += ' ' + object.slice(next.start, next.end).replace(/^\s*(?:up to\s+)?(?:\d+|a|an|one|two)\s+/i, '')
        .replace(/\b(?:Level|Rank)s? \d+(?: (?:or|and|to) (?:\d+|lower|higher|less|more))?\b|\b(?:with )?\d+ or (?:more|less|higher|lower) (?:ATK|DEF)\b|\bwith \d+ (?:ATK|DEF)\b/gi, ' ');
      return { ...part, text };
    });
  }
  // How a card can be Summoned, from its own text: "Cannot be Special Summoned.", "Must be Special Summoned
  // with "X"", "... with the effect of a "X" card", "by its own effect", "Must be Fusion Summoned",
  // "Cannot be Special Summoned from the Deck", "Must first be Special Summoned ...", "Cannot be Normal Summoned".
  function summonRule(card) {
    const entry = indexedText(card);
    if (entry.rule) return entry.rule;
    const text = quoteText(card.effect), rule = { never: false, only: '', byName: [], byArchetype: [], notFrom: [], first: false,
      noNormal: card.card_type === 'Monster' && /Ritual|Fusion|Synchro|Xyz|Link/.test(String(card.monster_color)) };
    for (const rawSentence of text.split(/(?<=\.)\s+|\n/)) {
      const sentence = rawSentence.replace(/\bcan only be Special Summoned (?=(?:by|with|from|\())/i, 'Must be Special Summoned ');
      if (/\bcannot be Normal Summoned\b(?![^.]*\b(?:unless|except|if)\b)/i.test(sentence) || /\bMust (?:first )?be (?:Special|Ritual|Fusion|Synchro|Xyz|Link) Summoned\b/i.test(sentence)) rule.noNormal = true;
      if (/^\s*(?:(?:This card|This monster) )?cannot be Special Summoned\s*\.?\s*$/i.test(sentence) || /\b(?:Must be Special Summoned|cannot be Special Summoned except) by its own effect\b/i.test(sentence)) rule.never = true;
      const from = sentence.match(/\bcannot be Special Summoned from (?:the |your )?(Deck|GY|Graveyard|Extra Deck)\b/i);
      if (from) rule.notFrom.push(/^gy|grave/i.test(from[1]) ? 'gy' : from[1].toLowerCase());
      const archetype = sentence.match(/\b(?:Must be Special Summoned (?:with|by) the effect of|cannot be Special Summoned except (?:with|by) the effect of) (?:a|an) "([^"]+)"/i);
      const named = !archetype && sentence.match(/\b(?:Must be Special Summoned (?:only )?(?:with|by)|cannot be Special Summoned except (?:with|by)) "([^"]+)"/i);
      if (archetype) rule.byArchetype.push(normalize(archetype[1])); else if (named) rule.byName.push(normalize(named[1]));
      const procedure = sentence.match(/\bMust (?:first )?be (Ritual|Fusion|Synchro|Xyz|Link) Summoned\b/i);
      if (procedure) rule.only = procedure[1].toLowerCase();
      // "Must be either Fusion Summoned, or Special Summoned (from your Extra Deck) by banishing ...": no other effect
      // Special Summons it (its other procedure is not an effect).
      const either = sentence.match(/\bMust be either (Ritual|Fusion|Synchro|Xyz|Link) Summoned\b/i);
      if (either) rule.only ||= either[1].toLowerCase();
      if (!/\bby (?:a )?card effects?\b/i.test(sentence) && (/\bMust first be Special Summoned\b|\bMust be Special Summoned \(from your hand\)/i.test(sentence) ||
          !archetype && !named && /\b(?:Must be Special Summoned|cannot be Special Summoned except)\b/i.test(sentence))) rule.first = true;
    }
    // A Ritual Monster comes out of the Deck or hand only by a Ritual Summon (it can be revived afterwards).
    if (!rule.only && !rule.never && String(card.monster_color).includes('Ritual')) rule.ritual = true;
    return entry.rule = rule;
  }
  // Can fetcher's phrase bring this card out under its Summoning conditions? Access is from the Deck, where
  // a card that must first be Summoned by its own procedure cannot come out by another effect.
  function summonAllowed(card, phrase, fetcher, mode) {
    const rule = summonRule(card);
    if (mode !== 'synergy' && extraDeckMonster(card) && phrase.extraFaceUp && !card.pendulum) return false;
    if (phrase.normal === 'no' && !rule.noNormal || phrase.normal === 'yes' && (rule.noNormal || extraDeckMonster(card))) return false;
    if (phrase.action !== 'summon') return true;
    if (['normal', 'tribute'].includes(phrase.summon)) return mode === 'synergy' && !rule.noNormal;
    if (phrase.ignores) return true;
    if (rule.never) return false;
    if (rule.only) return phrase.summon === rule.only;
    if (rule.ritual && mode !== 'synergy' && phrase.summon !== 'ritual') return false;
    const names = fetcher ? indexedText(fetcher).name : [];
    if (rule.byName.length && !rule.byName.some(name => names.includes(name))) return false;
    if (rule.byArchetype.length && !rule.byArchetype.some(part => names.some(name => namePart(name, part)))) return false;
    if (rule.notFrom.includes('deck') && phrase.fromMain && mode !== 'synergy') return false;
    if (rule.notFrom.includes('extra deck') && phrase.fromExtra && mode !== 'synergy') return false;
    return !(rule.first && mode !== 'synergy');
  }
  // A card's text as clauses, with quoted names masked (§n§). Normal Monster text is flavor text; only its Pendulum
  // Effect is an effect. Restrictions ("..., but you cannot ...") are clauses of their own. Each clause keeps its
  // effect: the sentence, with the condition before its colon, joined to the header of a bullet list or to the
  // sentence an "If you do" sentence continues.
  function cardClauses(card) {
    const entry = indexedText(card);
    if (entry.clauses) return entry.clauses;
    const flavor = card.card_type === 'Monster' && String(card.monster_color) === 'Normal', names = [];
    const own = maskQuotes(quoteText(flavor ? '' : card.effect), names), pendulum = maskQuotes(quoteText(card.pendulum_effect), names);
    const clauses = [], effects = [];
    for (const [part, isPendulum] of [[own, false], [pendulum, true]]) {
      let header = null, previous = null;
      for (const raw of part.split(/[.\n]+/)) {
        // Older texts have no colon: "When this card is destroyed by battle and sent to the Graveyard, you can ...".
        const line = raw.trim(), bullet = line.startsWith('●'), body = line.replace(/^●\s*/, ''), condition = body.match(/^([^;]*?):/)?.[1] || body.match(/^((?:When|If|During|Once per turn, during)\b[^,;:]*?),\s*(?:you can|you may)\b/i)?.[1] || '';
        if (!line) continue;
        // A FLIP effect goes on until the next effect (Morphing Jar #2: three sentences).
        const continued = !bullet && previous && (/^(?:if you do|then|also|after that|otherwise|in addition)\b/i.test(body) || /^\s*FLIP\b/i.test(previous.condition) && !condition && !/^(?:you can|if|when|once|during|while)\b/i.test(body));
        // "(This is treated as a Fusion Summon.)" belongs to the sentence before (Instant Fusion).
        const treated = !bullet && previous && /^\(?\s*this is treated as an? \w+ Summon\b/i.test(body);
        if (treated) previous.text += ` ${body}`;
        const effect = treated ? previous : bullet && header ? { condition: `${header.condition} ${condition}`, text: `${header.text} ${body}`, own: body, pendulum: isPendulum }
          : continued ? { condition: previous.condition, text: `${previous.text} ${body}`, pendulum: isPendulum } : { condition, text: body, pendulum: isPendulum };
        if (!bullet && !continued) header = /\b(?:of )?(?:these|the following) effects?\b|\bgains? this effect\b/i.test(body) ? effect : null;
        previous = effect;
        for (const clause of line.split(/[;:●]+|,\s*(?:and\s+)?(?:if you do|then)\b|\bthen\b|,\s*but\b|,\s*also\b|,\s*(?:and\s+)?(?=(?:(?:you|your opponent) can )?(?:add|Special Summon|Set|send|banish)\b)|,\s*(?=(?:you|your opponent|neither player) (?:can only|cannot|can't)\b)|\s+or,\s+(?=if\b)/i).map(s => s.trim()).filter(Boolean)) {
          clauses.push(clause); effects.push(effect);
        }
      }
    }
    return entry.clauses = { names, clauses, effects };
  }
  function fetchClauses(card) {
    const { names, clauses, effects } = cardClauses(card), phrases = [];
    clauses.forEach((clause, i) => {
      const start = phrases.length;
      readClause(clause, i);
      // "if you activated this effect while this card was revealed": the clause needs another of the card's effects first.
      const dependent = /\bif you activated this effect while\b|\bwhile this card (?:is|was) revealed\b/i.test(clause);
      // "..., or if you control a "Regenesis" monster, you can add ...": an alternative with a condition of its own, in the
      // clause before. Starters check it (effectUse). Not "then if ..." (Awakening of Veidos: its own placing may meet it).
      const own = i > 0 && effects[i - 1] === effects[i] && !effects[i].condition.includes(clauses[i - 1].trim()) && clauses[i - 1].match(effects[i].text.includes(`or, ${clauses[i - 1].trim()}`) ? /^\s*if\b([^;:]*)$/i : /\bor,?\s+if\b([^;:]*)$/i);
      for (const phrase of phrases.slice(start)) if (own) phrase.when = own[1].trim();
      for (const phrase of phrases.slice(start)) Object.assign(phrase, { effect: effects[i], dependent });
    });
    return phrases;
    function readClause(clause, i) {
      if (/\bcannot\b|\bcan't\b|\bcan only\b|\bneither player can\b|\bnegate\b/i.test(clause.replace(/\b(?:that|which) (?:cannot|can) be (?:Normal|Special) Summoned\b/gi, ' '))) return;
      // Copying a Ritual Spell's activation can fetch from the Deck only when that Spell does.
      if (/\b(?:apply that card's activation effect that|this effect becomes that card's effect that) Ritual Summons?\b/i.test(clause)) {
        const by = fetchPhrase(clauses[i - 1] || '', names);
        if (by && (by.properties.includes('Spell:Ritual') || by.refs.some(ref => ref.properties?.includes('Spell:Ritual')))) phrases.push({
          ...fetchPhrase('Ritual Monster', names), action: 'summon', summon: 'ritual', fromMain: true, fromExtra: false, copiedRitual: by,
        });
        return;
      }
      // The first verb that is an action, not a noun ("this card's Xyz Summon", "the Link Summon of").
      let verb = null;
      for (const match of clause.matchAll(fetchVerbs)) if (!/(?:'s|\b(?:a|an|the|its|their|for|of))\s+$/i.test(clause.slice(0, match.index))) { verb = match; break; }
      if (!verb) return;
      // A trigger condition is not an effect: "If your opponent Special Summons a monster ...", "If you Link
      // Summon ...". "When this card is Normal Summoned, add 1 ..." keeps its effect after the comma.
      if (/\b(?:if|when|while|whenever|each time|any time|every time|unless)\b[^,]*$/i.test(clause.slice(0, verb.index))) return;
      // "Special Summon this card", "add this card to your hand": the card fetches itself.
      if (/^\s*this card\b/i.test(clause.slice(verb.index + verb[0].length))) return;
      // "place 1 "Volcanic" monster from your Deck on top of your Deck" (Soul Servant, Infernity Pawn): it stays in the Deck.
      if (/^place/i.test(verb[0]) && /\bon (?:the )?(?:top|bottom) of (?:the |your |their |its owner's )?(?:Main )?Deck\b/i.test(clause.slice(verb.index))) return;
      const tail = clause.slice(verb.index);
      if (/^\s*(?:a maximum of|only|no more than)\b/i.test(tail.slice(verb[0].length))) return;
      const opponent = /\byour opponent\s+(?:can |may )?$/i.test(clause.slice(0, verb.index)) && /\bfrom (?:their|your opponent's)\b/i.test(tail);
      let object = tail;
      // "Special Summon it": what "it" is comes earlier, in the same clause ("reveal 1 "X" ..., and add it")
      // or in the previous one ("Target 1 ... in your GY; Special Summon it").
      if (/^\s*(?:it|them|that (?:target|card|monster)s?|those (?:targets|cards|monsters))\b/i.test(object.replace(/^\S+(?:\s+summons?)?/i, ''))) {
        const head = clause.slice(0, verb.index);
        if (/"§\d+§"|\bmonsters?\b|\bspells?\b|\btraps?\b/i.test(head)) object = head;
        else if (/\b(?:target(?:ing|s)?|reveal|select|choose)\s+(?:up to\s+)?(?:\d+|a|an|one|two|three)\b/i.test(clauses[i - 1] || '')) object = clauses[i - 1];
        else return; // "this card", as in "you can Normal Summon it to have it be treated as an Effect Monster"
      }
      object = resolveMentions(object, clause.slice(0, verb.index));
      // 'except "Y"' and 'non-"Z"' exclude those cards; names of cards on the field are conditions, not targets.
      const excluded = [], ref = /"§(\d+)§"/g;
      object = object.replace(/\b(?:except(?: for)?|other than)\s+(?:"§\d+§"(?:\s*,?\s*(?:or|and)?\s*)?)+/gi, part => { for (const m of part.matchAll(ref)) excluded.push({ name: normalize(names[m[1]]), mode: 'exact' }); return ' '; })
        .replace(/\bnon-"§(\d+)§"/gi, (part, n) => { excluded.push({ name: normalize(names[n]), label: names[n], mode: 'archetype' }); return ' '; })
        .replace(/\bexcept\b[^]*$/i, ' ') // "Special Summon monsters, except FIRE monsters": a restriction
        // A condition after the card is not the card: "Set 1 Normal Spell/Trap from your Deck, or if your opponent controls a monster, ...".
        .replace(/,?\s+(?:or\s+|and\s+)?(?:if|when|while|unless)\b[^]*$/i, ' ')
        // Materials and costs are not the fetched card: ", by banishing Fusion Materials ... that are all Link Monsters", "using ...".
        .replace(/,?\s+(?:by (?:banishing|sending|tributing|shuffling|detaching|returning|using|revealing|placing|destroying)|using|as (?:fusion |synchro |xyz |link )?materials?)\b[^]*$/i, ' ')
        .replace(/\b(?:the same|a (?:higher|lower|different))\s+(?:original\s+)?(?:level|rank|type|attribute|name|atk|def)s?\s+(?:as|than)\b[^,;]*/gi, ' ')
        .replace(/(?:\b(?:a|an|\d+)\s+)?(?:face-up\s+)?"§\d+§"\s+(?:[\w-]+\s+){0,2}?(?:cards?|monsters?)\s+(?:you control|your opponent controls|on the field)\b/gi, ' ');
      // Destroying a card in the Deck sends it to the GY ("Destroy 1 "DoomZ" card in your hand, Deck, or face-up field").
      const destroy = /^destroy/i.test(verb[0]), deckSource = text => destroy ? destroyDeckSource.test(text) : mainDeckSource.test(text);
      const action = /^add/i.test(verb[0]) ? 'add' : /^(?:set|place)/i.test(verb[0]) ? 'set' : /^(?:send|destroy)/i.test(verb[0]) ? 'send' : /^banish/i.test(verb[0]) ? 'banish' : 'summon';
      const summon = action === 'summon' ? verb[0].toLowerCase().split(/\s+/)[0] : '';
      // A later action has its own source. Normal and Tribute Summons always use the hand.
      const selected = /\b(?:excavated|selected|revealed|chosen)\b/i.test(object) && /\b(?:excavate|select|reveal|choose)\b/i.test(clauses[i - 1] || '') && mainDeckSource.test(clauses[i - 1]) ||
        /\bamong (?:them|those cards)\b/i.test(object) && /\bexcavate\b/i.test(clauses[i - 2] || '') && mainDeckSource.test(clauses[i - 2]);
      const fromMain = !opponent && !['normal', 'tribute'].includes(summon) && (deckSource(tail) || deckSource(object) || selected);
      const fromExtra = !opponent && (/^(?:fusion|synchro|xyz|link) summon/i.test(verb[0]) || extraDeckSource.test(tail) || extraDeckSource.test(object));
      // "Reveal 1 Fusion Monster in your Extra Deck and Special Summon, from your hand or Deck, 1 of the Fusion Materials
      // whose name is mentioned on that monster": any monster an Extra Deck monster names as material. The revealed
      // monster may be narrowed ('reveal 1 "HERO" Fusion Monster'); "Synchro Materials" are named by Synchro Monsters.
      // Synchro Overtake names it before the verb: "choose 1 of the Synchro Materials mentioned on it, and add to your hand ... that monster".
      const listedPattern = /\b(?:(Fusion|Synchro|Xyz|Link) )?materials?\b(?:\s+[\w,]+){0,6}?\s+(?:specifically )?(?:listed|mentioned) on (?:it|that (?:card|monster|revealed monster)|the (?:card|monster) you revealed)\b/i;
      const listed = !summonFrame(summon) && (object.match(listedPattern) || /\b(?:that monster|it|them)\b/i.test(tail) &&
        (clause.slice(0, verb.index).match(listedPattern) || /\b(?:choose|reveal)\b/i.test(clauses[i - 1] || '') && clauses[i - 1].match(listedPattern)));
      if (listed) {
        const reveal = `${clauses[i - 1] || ''} ${clause}`.match(/\b(?:reveal|show)\s+((?:1|a|an)\s+.*?\b(?:Fusion|Synchro|Xyz|Link) Monster)\b/i), by = reveal ? fetchPhrase(reveal[1], names) : null;
        const word = listed[1] || by?.frames[0] || 'Fusion', frame = word[0].toUpperCase() + word.slice(1).toLowerCase();
        const base = { refs: [], kinds: ['Monster'], frames: [], properties: [], tuner: false, abilities: [], attributes: [], types: [], stats: {}, not: [], textHas: [], excluded, action, summon, fromMain, fromExtra, listed: { frame, by } };
        phrases.push(base);
        // Synchro Overtake: "add to your hand or Special Summon that monster".
        if (action === 'add' && /\bSpecial Summon\b/i.test(tail)) phrases.push({ ...base, action: 'summon', summon: 'special' });
        return;
      }
      // One phrase per object ("1 "X" monster and 1 "Y" Spell"), but "Level 7 or 8" stays together.
      const parts = splitObjects(object), sharedMain = fromMain, sharedExtra = fromExtra;
      for (const part of parts) {
        const phrase = fetchPhrase(part.text, names, summonFrame(summon), action !== 'set' || /^set/i.test(verb[0]));
        if (phrase && action === 'summon' && !phrase.kinds && !phrase.refs.some(ref => ref.kinds?.some(kind => kind !== 'Monster')) && !/\bas (?:an? )?(?:Normal|Effect) Monsters?\b/i.test(part.text)) phrase.kinds = ['Monster'];
        // Objects with their own source do not borrow another object's Deck.
        const ownSource = /\bfrom\b|\bin (?:your |the |either |your opponent's )?(?:GY|Graveyard|hand|banishment|(?:Main |Extra )?Monster Zone)\b|\byou control\b/i.test(part.text);
        const fromMain = !opponent && !['normal', 'tribute'].includes(summon) && (ownSource ? deckSource(part.text) : sharedMain);
        const fromExtra = !opponent && (/^(?:fusion|synchro|xyz|link)$/.test(summon) || (ownSource ? extraDeckSource.test(part.text) : sharedExtra));
        // Two monsters with positive Levels totaling N must each be below N.
        const total = object.match(/\b(?:total|combined) Levels (?:exactly )?equal (\d+)\b/i);
        if (phrase && total && parts.length === 2) phrase.stats.level = ['1', String(Number(total[1]) - 1)];
        if (phrase && /\bface-up Extra Deck\b/i.test(part.text)) phrase.extraFaceUp = true;
        if (phrase && /\bignoring (?:its|their|the) Summoning conditions\b/i.test(tail)) phrase.ignores = true;
        // "whose name is mentioned on that card": the card revealed or sent before ("reveal 1 Ritual Spell in your hand, add
        // 1 Ritual Monster ...": Transonic Bird; "send 1 Ritual Spell ... to the GY; add ...": Skull Archfiend of Chaos).
        if (phrase?.mentionedOn === 'card') {
          const that = `${clauses[i - 1] || ''} ${clause.slice(0, verb.index)}`.match(/\b(?:reveal|send|banish|discard|target|choose|select|Tribute)\w*\s+(?:1|a|an|one)\s+(.+?)\s+(?:in|from|on|to|you control)\b(?![^]*\b(?:reveal|send|banish|discard|target|choose|select|Tribute)\w*\s+(?:1|a|an|one)\s)/i);
          phrase.mentionedOn = that && fetchPhrase(that[1], names) || undefined;
        }
        // describeWhere: the object and the rest of the clause, for its source (Describe search: "from your GY"); clause: the masked clause.
        if (phrase) phrases.push(Object.assign(phrase, { excluded, action, summon, fromMain, fromExtra, describeWhere: `${part.text} ${tail}`, clause }, destroy && { destroy }));
        // "take 1 Equip Spell from your Deck and either add it to your hand or send it to the GY": both.
        if (phrase && action === 'add' && /\badd (?:it|them) to your hand or send (?:it|them) to the (?:GY|Graveyard)\b/i.test(clause)) phrases.push({ ...phrase, action: 'send' });
        // "add to your hand, or Special Summon, 1 "Power Patron" monster from your Deck" (Medius the Pure) and "add 1 ... to
        // your hand or Special Summon it": both, so Access and Starters set to Special Summon only still list it (user, 2026-11-04).
        if (phrase && action === 'add' && /\badd to your hand,? or Special Summon\b|\bto your hand,? or Special Summon (?:it|them)\b/i.test(clause)) phrases.push({ ...phrase, action: 'summon', summon: 'special', kinds: phrase.kinds || ['Monster'] });
      }
    }
  }
  // Frames only limit monsters, and a Spell/Trap property only its own card type ("Quick-Play Spell or Trap").
  function fitsKind(card, { kinds = null, frames = [], properties = [], tuner = false, abilities = [], types = [] }) {
    if (kinds && !kinds.includes(card.card_type)) return false;
    if (types.length && (card.card_type !== 'Monster' || !types.includes(card.type))) return false;
    const monster = card.card_type === 'Monster';
    if (frames.length && (monster ? !frames.some(frame => frame === 'Pendulum' ? !!card.pendulum : frame === 'Effect' ? effectMonster(card) : frame === 'Normal' ? String(card.monster_color) === 'Normal' : String(card.monster_color).includes(frame)) : !kinds?.some(kind => kind !== 'Monster'))) return false;
    const own = properties.filter(property => property.startsWith(card.card_type + ':'));
    if (own.length ? !own.includes(`${card.card_type}:${card.type}`) : properties.length && !kinds?.includes(card.card_type)) return false;
    if (abilities.length && !(monster && abilities.every(ability => ability === 'Flip' ? !!Number(card.flip) || String(card.ability).includes('Flip') : String(card.ability).includes(ability)))) return false;
    return !tuner || monster && String(card.ability).includes('Tuner');
  }
  // How directly a phrase fetches the card: 0 names it, 1 by its archetype, 2 as a card that mentions a
  // name, 3 by Type, Attribute, frame or stats only; Infinity when it does not fit.
  let ritualDeckIndex = null;
  function* ritualDeckTask(cards) {
    if (ritualDeckIndex?.cards === cards && ritualDeckIndex.size === cards.length) return;
    const list = [];
    for (const card of cards) {
      yield* fetchCheckpoint();
      if (!card.rush && card.card_type === 'Spell' && card.type === 'Ritual')
        for (const phrase of fetchClauses(card)) if (phrase.action === 'summon' && phrase.summon === 'ritual' && phrase.fromMain && !phrase.copiedRitual) list.push({ card, phrase });
    }
    ritualDeckIndex = { cards, size: cards.length, list };
  }
  function ritualDeckEffects() {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (ritualDeckIndex?.cards !== cards || ritualDeckIndex.size !== cards.length) labDrain(ritualDeckTask(cards));
    return ritualDeckIndex.list;
  }
  function fetchRank(card, phrase, anySource = false) {
    // Printed case distinguishes embedded archetypes: "roid" / "LV", but "HERO" is not "Heroic".
    const text = indexedText(card), named = ref => {
      const identities = anySource ? text.name : phrase.fromMain ? namesAt(card, 'deck') : phrase.fromExtra ? namesAt(card, 'extra') : phrase.places?.length ? [...new Set(phrase.places.flatMap(place => namesAt(card, place)))] : text.name;
      if (ref.mode === 'exact') return identities.includes(ref.name);
      if (ref.nameMatch === 'includes' || EMBEDDED_ARCHETYPES.has(ref.name)) return identities.some(name => name.includes(ref.name));
      const printed = !!ref.label && String(card.name).includes(ref.label);
      if (ref.label && /[A-Z]/.test(ref.label) && !/[a-z]/.test(ref.label)) return printed || identities.slice(1).some(name => namePart(name, ref.name));
      return printed || identities.some(name => namePart(name, ref.name));
    };
    if (phrase.excluded?.some(named)) return Infinity;
    if (phrase.copiedRitual) return ritualDeckEffects().some(entry => fetchRank(entry.card, phrase.copiedRitual) < Infinity && summonAllowed(card, entry.phrase, entry.card, 'access') && fetchRank(card, entry.phrase) < Infinity) ? 2 : Infinity;
    if (phrase.alternatives) return Math.min(Infinity, ...phrase.alternatives.map(part => fetchRank(card, part, anySource)));
    if (phrase.listed) return listedBy(card).some(other => String(other.monster_color).includes(phrase.listed.frame) && (!phrase.listed.by || fetchRank(other, phrase.listed.by) < Infinity)) ? 2 : Infinity;
    let rank = 3;
    if (phrase.refs.length) {
      rank = Math.min(...phrase.refs.map(ref => ref.mode === 'exact' ? (named(ref) ? 0 : Infinity) :
        ref.mode === 'mention' ? (text.effect.some(s => s.includes(`"${ref.name}"`)) ? 2 : Infinity) : ref.mode === 'member' ? (quotesMember(card, ref) ? 2 : Infinity) : named(ref) && fitsKind(card, ref) ? 1 : Infinity));
      if (rank === Infinity) return Infinity;
    }
    if (!fitsKind(card, phrase)) return Infinity;
    if (phrase.mentionedOn?.refs) {
      if (!quotedBy(card, phrase.fromMain ? namesAt(card, 'deck') : text.name).some(other => fetchRank(other, phrase.mentionedOn, true) < Infinity)) return Infinity;
      rank = Math.min(rank, 2);
    }
    if (phrase.scaleParity && phrase.scaleParity !== 'any' && Number(card.scale) % 2 !== (phrase.scaleParity === 'odd' ? 1 : 0)) return Infinity;
    if (phrase.deck === 'main' && extraDeckMonster(card) || phrase.deck === 'extra' && !extraDeckMonster(card) && !card.pendulum || phrase.deck === 'face-up extra' && !card.pendulum) return Infinity;
    if (phrase.normal && (phrase.normal === 'no') !== summonRule(card).noNormal) return Infinity;
    const monster = card.card_type === 'Monster';
    if (phrase.attributes.length && !(monster && phrase.attributes.includes(card.attribute))) return Infinity;
    if (phrase.types.length && !(monster && phrase.types.includes(card.type))) return Infinity;
    const color = String(card.monster_color), xyz = monster && color.includes('Xyz'), link = monster && color.includes('Link');
    if (phrase.needs === 'level' && (!monster || xyz || link) || phrase.needs === 'rank' && !xyz || phrase.needs === 'link' && !link) return Infinity;
    if (phrase.scaleAlternatives) {
      const bounds = phrase.scaleAlternatives[link ? 'link' : xyz ? 'rank' : 'level'];
      if (!monster || !bounds || !inRange(card.level, ...bounds)) return Infinity;
    }
    if (phrase.numberRange) {
      const { low, high, prefix } = phrase.numberRange, own = normalize(card.name), at = prefix ? own.indexOf(normalize(prefix)) : 0;
      const number = at < 0 ? null : own.slice(at + prefix.length).match(/\d+/);
      if (!number || Number(number[0]) < low || Number(number[0]) > high) return Infinity;
    }
    if (phrase.statAlternatives && (!monster || link || !phrase.statAlternatives.some(stats => Object.entries(stats).every(([key, bounds]) => inRange(card[key], ...bounds))))) return Infinity;
    for (const [key, [low, high]] of Object.entries(phrase.stats)) {
      if (!monster || key === 'level' && (xyz || link) || key === 'rank' && !xyz || key === 'link' && !link || key === 'def' && link) return Infinity;
      if (!inRange(card[key === 'rank' || key === 'link' ? 'level' : key], low, high)) return Infinity;
    }
    for (const [key, values] of Object.entries(phrase.values || {})) if (!values.includes(String(card[key === 'rank' || key === 'link' ? 'level' : key]))) return Infinity;
    if (phrase.relation) {
      const atk = statValue(card.atk), def = statValue(card.def);
      if (!monster || link || atk === null || def === null || (phrase.relation === 'eq') !== (atk === def)) return Infinity;
    }
    if (phrase.textHas?.includes('coin') && !text.effect.some(s => /\btoss(?:es)? a coin|\bcoin toss/.test(s))) return Infinity;
    if (phrase.textHas?.includes('die') && !text.effect.some(s => /\broll(?:s)? a (?:six-sided )?die|\bdie roll|\bdice\b/.test(s))) return Infinity;
    for (const need of phrase.textHas || []) if (need.startsWith('counter:') && !text.effect.some(s => s.includes(need.slice(8) + ' counter'))) return Infinity;
    if (phrase.not?.length) {
      const kinds = phrase.kinds || phrase.refs.flatMap(ref => ref.kinds || []);
      if (!monster && !kinds.some(kind => kind !== 'Monster')) return Infinity;
      const own = [card.attribute, card.type, card.monster_color, ...FRAMES.filter(frame => fitsKind(card, { kinds: null, frames: [frame], properties: [], tuner: false })), ...['Tuner', ...ABILITIES].filter(ability => String(card.ability).includes(ability) || ability === 'Flip' && Number(card.flip))];
      if (own.some(word => word && (phrase.not.includes(String(word).toLowerCase()) || phrase.not.includes(String(word).toLowerCase() + 's')))) return Infinity;
    }
    return rank;
  }
  // Reverse search. "access": cards that add it from its Deck to the hand, or Special Summon or Set it
  // from there: the Extra Deck for Fusion, Synchro, Xyz and Link Monsters (Pendulum ones too), the Main
  // Deck for every other card, Normal and Effect Pendulums included. "synergy": the access cards, every
  // add, Summon, Set or send from anywhere, the cards that name it or its archetype, and the cards it
  // names or fetches itself. Same ranks; the card's own copies are left out of the extra synergy parts.
  const extraDeckMonster = card => card.card_type === 'Monster' && /Fusion|Synchro|Xyz|Link/.test(String(card.monster_color));
  // What Access counts (⚙ in the search panel, remembered in this browser): from the card's Deck, adding it
  // to the hand, Special Summoning it, Setting it, sending it to the GY and, if chosen, banishing it.
  // Within a tier, searches and summons come before sends to the GY, and those before banishes.
  // Extra Deck monsters have their own choice: they cannot be searched, and Special Summoning one from the
  // Extra Deck depends on the game, so by default their Access is Setting / placing, sending and banishing.
  const ACCESS_ACTIONS = [['add', 'Search'], ['summon', 'Special Summon'], ['set', 'Set / place'], ['send', 'Send to GY'], ['banish', 'Banish']];
  const ACCESS_DEFAULT = { main: ['add', 'summon', 'set', 'send'], extra: ['set', 'send', 'banish'] };
  const ACCESS_KEY = { main: 'dbetter-access-actions', extra: 'dbetter-access-actions-extra' }, ACTION_WEIGHT = { send: 0.2, banish: 0.4 };
  const accessAction = action => ACCESS_ACTIONS.some(([key]) => key === action);
  const accessActions = {};
  for (const deck of ['main', 'extra']) {
    accessActions[deck] = new Set(ACCESS_DEFAULT[deck]);
    try { const saved = JSON.parse(localStorage.getItem(ACCESS_KEY[deck]) || 'null'); if (Array.isArray(saved)) accessActions[deck] = new Set(saved.filter(accessAction)); } catch {}
  }
  function setAccessActions(list, deck = 'main') {
    accessActions[deck] = new Set(list.filter(accessAction));
    try { localStorage.setItem(ACCESS_KEY[deck], JSON.stringify([...accessActions[deck]])); } catch {}
  }
  const actionRank = (rank, phrase) => rank + (ACTION_WEIGHT[phrase.action] || 0);
  function relatedRank(card, target, mode = 'access', actions = null) {
    if (!target) return Infinity;
    const synergy = mode === 'synergy', extra = extraDeckMonster(target);
    actions ||= accessActions[extra ? 'extra' : 'main'];
    const phrases = (indexedText(card).fetch ||= fetchClauses(card)).filter(phrase => synergy || actions.has(phrase.action) && (extra ? phrase.fromExtra : phrase.fromMain));
    let rank = Math.min(Infinity, ...phrases.filter(phrase => summonAllowed(target, phrase, card, mode)).map(phrase => actionRank(fetchRank(target, phrase, synergy), phrase)));
    if (synergy && rank > 0 && card.name !== target.name)
      rank = Math.min(rank, referenceRank(card, target), ...(indexedText(target).fetch ||= fetchClauses(target)).filter(phrase => summonAllowed(card, phrase, target, mode)).map(phrase => actionRank(fetchRank(card, phrase, true), phrase)));
    return rank;
  }
  // Names quoted in a card's text, without its own name and "treated as" names.
  const quotedNames = card => { const own = indexedText(card).name; return [...quoteText(card.effect + '\n' + card.pendulum_effect).matchAll(/"([^"\n]{2,80})"/g)].map(m => normalize(m[1])).filter(name => !own.includes(name)); };
  // 0: the card names it, or it names the card; 1: the card names its archetype or a name it is treated as.
  function referenceRank(card, target) {
    const own = indexedText(card), other = indexedText(target);
    const quoted = own.quoted ||= quotedNames(card), named = other.quoted ||= quotedNames(target);
    if (quoted.includes(other.name[0]) || named.includes(own.name[0])) return 0;
    const archetypes = other.archetypes ||= [...archetypesOf(target).map(normalize), ...other.name.slice(1)];
    return quoted.some(name => archetypes.includes(name)) ? 1 : Infinity;
  }
  const fetches = (card, target, mode = 'access') => relatedRank(card, target, mode) < Infinity;
  const fitsPhrase = (card, phrase) => fetchRank(card, phrase) < Infinity;
  // Describe search (user, 2026-10-31): a search in plain words, read into what the card is and what its effects do:
  // "revive fire monster", "level 4 tuner", "spellcasters that can search", "hand traps", "negate spell", "-fire".
  // Words after an effect verb say what the effect acts on ("revive fire monster": it revives a FIRE monster); the
  // other words say what the card is ("fire monster that revives"). Each part read is a chip; each result keeps the
  // clause that matched, for the card overview. An effect whose object is not narrowed ("Special Summon 1 monster from
  // your GY") fits too, after the ones that name it. Read from the card texts, like Access; not rules-complete.
  // action: an add / Special Summon / Set that Access's reader takes (fetchClauses); verb: read here (describeActions);
  // category: an Effect filter category; test: a pattern on the card text. intransitive: the words after it are the card.
  const DESCRIBE_CONCEPTS = [
    { key: 'search', label: 'Searches', words: ['search', 'searcher', 'tutor', 'add from deck'], action: 'add', from: 'deck' },
    { key: 'recycle', label: 'Adds back', words: ['recycle', 'recursion', 'salvage', 'add from gy'], action: 'add', from: 'gy' },
    { key: 'add', label: 'Adds to the hand', words: ['add', 'add to hand'], action: 'add' },
    { key: 'revive', label: 'Revives', words: ['revive', 'reborn', 'reanimate', 'resurrect', 'revival', 'reanimation', 'summon from gy', 'special summon from gy'], action: 'summon', from: 'gy' },
    { key: 'summon', label: 'Special Summons', words: ['special summon', 'summon', 'ss'], action: 'summon' },
    { key: 'set', label: 'Sets', words: ['set'], action: 'set' },
    { key: 'mill', label: 'Mills', words: ['mill', 'dump', 'foolish'], verb: 'send', from: 'deck' },
    { key: 'send', label: 'Sends to the GY', words: ['send', 'send to gy', 'send to graveyard'], verb: 'send' },
    { key: 'banish', label: 'Banishes', words: ['banish', 'remove', 'exile'], verb: 'banish' },
    { key: 'destroy', label: 'Destroys', words: ['destroy', 'pop', 'destruction', 'removal'], verb: 'destroy' },
    { key: 'omni', label: 'Negates any card or effect', words: ['omni negate', 'omninegate', 'omni negation', 'omni', 'omni negater'], verb: 'negate', any: true, intransitive: true },
    { key: 'negate', label: 'Negates', words: ['negate', 'negation', 'negater', 'negator'], verb: 'negate' },
    { key: 'bounce', label: 'Returns to the hand', words: ['bounce', 'return to hand'], verb: 'return', to: 'hand' },
    { key: 'spin', label: 'Shuffles into the Deck', words: ['spin', 'shuffle', 'return to deck', 'shuffle into deck'], verb: 'return', to: 'deck' },
    { key: 'discard', label: 'Discards', words: ['discard', 'hand destruction'], verb: 'discard' },
    { key: 'control', label: 'Takes control', words: ['steal', 'take control', 'control change', 'change control', 'gain control'], verb: 'control' },
    { key: 'draw', label: 'Draws', words: ['draw', 'draw power'], verb: 'draw', intransitive: true },
    { key: 'handtrap', label: 'Hand trap', words: ['hand trap', 'handtrap'], category: 'handtrap', mark: /\b(?:discard|reveal|banish|send) this card\b|\bspecial summon this card \(?from your hand|\bactivate this card from your hand/, intransitive: true },
    { key: 'floodgate', label: 'Floodgate', words: ['floodgate', 'lock', 'stun'], category: 'floodgate', mark: /\bcannot\b|\bcan't\b|\bcan only\b|\bmust (?:first )?set\b|\bneither player can\b|\bnegat|\bbanished instead\b/, intransitive: true },
    { key: 'burn', label: 'Burn', words: ['burn', 'burn damage', 'inflict damage', 'effect damage'], category: 'burn', mark: /\binflicts?\b|\b(?:takes|loses) \d+/, intransitive: true },
    { key: 'gain', label: 'Gains LP', words: ['lp gain', 'gain lp', 'heal', 'life gain', 'lifegain', 'gain life points', 'recover lp'], category: 'gain', mark: /\bgains?\b/, intransitive: true },
    { key: 'token', label: 'Makes Tokens', words: ['token', 'token maker'], category: 'token', mark: /\btokens?\b/, intransitive: true },
    { key: 'equip', label: 'Equips', words: ['equip', 'equips'], category: 'equip', mark: /\bequip/, intransitive: true },
    { key: 'quick', label: 'Quick Effect', words: ['quick effect', 'quick'], test: /\bquick effect\b/, intransitive: true },
    { key: 'protect', label: 'Protection', words: ['protection', 'protect', 'indestructible', 'unaffected', 'untargetable', 'cannot be destroyed', 'cannot be targeted', 'immune'], test: /\bcannot be (?:destroyed|targeted)\b|\bunaffected by\b|\bcannot target (?:this card|it)\b/, intransitive: true },
    { key: 'extender', label: 'Special Summons itself', words: ['extender', 'summons itself', 'self summon', 'special summons itself', 'summon itself'], test: /\bspecial summon this card\b(?:[^.;:]*?\bfrom (?:your |the )?hand\b| \(from your hand\))|\bspecial summon this card\b[^.;:]*?\bin (?:your )?hand\b/, intransitive: true },
    { key: 'selfrevive', label: 'Revives itself', words: ['revives itself', 'self revive', 'self revival', 'revive itself', 'comes back', 'recursive'], test: /\bspecial summon this card\b[^.;:]*?\bfrom (?:your |the )?(?:hand or )?gy\b|\bthis card is in (?:your |the )?gy\b[^.]*?\bspecial summon this card\b/, intransitive: true },
    { key: 'piercing', label: 'Piercing damage', words: ['piercing', 'pierce', 'piercing damage'], test: /\bpiercing (?:battle )?damage\b/, intransitive: true },
    { key: 'direct', label: 'Attacks directly', words: ['direct attack', 'attack directly', 'direct attacker', 'attacks directly'], test: /\bcan attack (?:your opponent )?directly\b/, intransitive: true },
  ];
  // Ongoing locks, not protection or a response window (Anti-Spell Fragrance, Skill Drain).
  function describeFloodgate(text) {
    return text.split(/[.\n]+/).find((line, i, lines) => {
      if (/(?:cannot|neither player can) activate[^.;]*when[^.;]*summon/.test(line) || /^\s*these effects last until the end of the damage step/.test(lines[i + 1] || '')) return false;
      if (/in response|damage step|damage calculation|during that battle phase|neither player can activate (?:its|their) (?:pendulum )?effects|those summoned monsters|cannot activate[^.;]*when[^.;]*summon|when [^:;]*(?:is (?:ritual|fusion|pendulum) summoned|declare[^:;]*attacks?)|that summoned monster|special summon\b[^.;]*(?:effects are negated|have their effects negated)|effects of[^.;]*destroyed by|you (?:currently )?control[^.;]*(?:unaffected|cannot be destroyed)[^.;]*effects are negated|unaffected[^.;]*their effects are negated/.test(line)) return false;
      return /\b(?:neither player can|(?:your opponent|each player|players|both players) cannot|monsters (?:your opponent controls|on the field) cannot) (?:special summon|normal summon|summon|activate|add|set|declare|conduct|attack|draw|tribute|be used)\b|\b(?:each player|neither player|your opponent|players) can only (?:control|activate|summon|special summon|attack)\b|\b(?:players|each player|both players|your opponent) must (?:first )?set\b|\b(?:(?:any|all|each) (?:cards?|monsters?)|(?:spells? and traps?|cards?|monsters?) sent)[^.;]*\b(?:is|are) banished instead\b|\bnegate (?:the )?effects of all\b|\b(?:effects of (?:all |face-up )?[^.;:]*|(?:all |face-up )?(?:monsters|spells|traps)[^.;:]*) (?:are|have their effects) negated\b/.test(line);
    }) || '';
  }
  // Where this action's object comes from; top-of-Deck wording belongs only to Describe (Card Trooper).
  const DESCRIBE_SOURCES = {
    deck: text => mainDeckSource.test(text) || /\bin (?:your|the|their) (?:main )?deck\b|\bfrom (?:the )?top of (?:your|the|their|your opponent's) deck\b/i.test(text),
    extra: text => extraDeckSource.test(text),
    gy: text => /\b(?:from|in) (?:your |the |their |either player's |either |your opponent's |its owner's )?(?:(?:hand|deck|field|banishment|main deck)\s*,?\s*(?:or |and |and\/or )?)*(?:gy|graveyard)s?\b/i.test(text),
    hand: text => /\bfrom (?:your |the |their |either player's |your opponent's )?(?:(?:deck|gy|graveyard|field)\s*,?\s*(?:or |and |and\/or )?)*hand\b|\bin (?:your|their|the|your opponent's) hand\b/i.test(text),
    banished: text => /\bbanished\b|\bbanishment\b/i.test(text),
    field: text => /\bon (?:the|your|their) field\b|\byou control\b|\byour opponent controls\b|\bface-up\b|\bset (?:spell|trap|card)|\b(?:spell [&/] trap|monster|pendulum) zone/i.test(text),
  };
  const DESCRIBE_SOURCE_LABELS = { deck: 'from the Deck', extra: 'from the Extra Deck', gy: 'from the GY', hand: 'from the hand', banished: 'banished', field: 'on the field' };
  const DESCRIBE_VERBS = /\b(special summon|ritual summon|fusion summon|synchro summon|xyz summon|link summon|send|banish|destroy|negate|return|shuffle|place|discard|take control|gain control|switch(?:es)? control|draw|add|set)(?:s|es)?\b/gi;
  // Keep known objects; an unresolved "it" or an unknown qualified object is not "any card".
  function describeObject(text, names) {
    const excluded = [];
    text = text.replace(/\b(?:except(?: for)?|other than)\s+(?:"§\d+§"(?:\s*,?\s*(?:or|and)?\s*)?)+/gi, part => { for (const m of part.matchAll(/"§(\d+)§"/g)) excluded.push({ name: normalize(names[m[1]]), mode: 'exact' }); return ' '; });
    text = text.replace(/^(\s*(?:target )?)(?:the same number of|that many|any number of|the top \d+|top \d+)\s+/i, '$1');
    const except = text.match(/\bexcept (?:an? )?((?:Continuous|Field|Ritual|Normal|Quick-Play|Equip|Counter) (?:Spell|Trap))/i);
    if (except) text = text.slice(0, except.index);
    const phrase = fetchPhrase(resolveMentions(text), names, '', true);
    if (phrase) { if (except) phrase.except = fetchPhrase(except[1], names, '', true); for (const ref of phrase.refs) { if (ref.index != null && new RegExp('\"?' + ref.index + '?\"\\s+Pendulum', 'i').test(text)) ref.frames = ['Pendulum']; } phrase.excluded = [...(phrase.excluded || []), ...excluded]; return phrase; }
    if (/^\s*(?:(?:target|choose|select|up to|all|other|face-up|face-down|the|a|an|one|two|three|\d+)\s+)*(?:cards?|monsters?|spell\/traps?|spells?|traps?)\b/i.test(text) && !/\b(?:with|whose|that|same|different|following|listed|mentioned)\b/i.test(text))
      return { refs: [], kinds: /\bmonsters?\b/i.test(text) ? ['Monster'] : /\bspell\/trap\b/i.test(text) ? ['Spell', 'Trap'] : /\bspells?\b/i.test(text) ? ['Spell'] : /\btraps?\b/i.test(text) ? ['Trap'] : null, frames: [], properties: [], tuner: false, abilities: [], attributes: [], types: [], stats: {}, not: [], excluded };
    return null;
  }
  function describeActions(card) {
    const entry = indexedText(card);
    if (entry.actions) return entry.actions;
    const { names, clauses, effects } = cardClauses(card), list = [];
    clauses.forEach((clause, i) => {
      const matches = [...clause.matchAll(DESCRIBE_VERBS)], effect = effects[i];
      const previous = i > 0 && effects[i - 1] === effect ? clauses[i - 1] : '';
      for (let j = 0; j < matches.length; j++) {
        const match = matches[j], before = clause.slice(0, match.index), word = match[1].toLowerCase();
        const verb = /control/.test(word) ? 'control' : /summon/.test(word) ? 'summon' : /^(?:shuffle|place)$/.test(word) ? 'return' : word;
        if (/\b(?:if|when|while|whenever|each time|unless|after|once|before)\b[^,;:]*$/i.test(before) || /\b(?:cannot|can't|can only|do not|does not|neither player can|would)\s+(?:\w+\s+)?$/i.test(before) || /(?:'s|\b(?:a|an|the|its|their|for|of|be|is|are|was|were|by))\s+$/i.test(before) || /\b(?:effect that|effects that)\s*$/i.test(before)) continue;
        let tail = clause.slice(match.index + match[0].length, matches[j + 1]?.index).replace(/,?\s+(?:by (?:banishing|sending|tributing|shuffling|detaching|returning|using|revealing|placing|destroying)|using|as (?:fusion |synchro |xyz |link )?materials?)\b[^]*$/i, '').replace(/,?\s+(?:and |or )?(?:if|when|while|unless)\b[^]*$/i, '').replace(/,?\s*\b(?:and|or|also|to)\s*$/i, '').replace(/\b(?:the same|a (?:higher|lower|different))\s+(?:original\s+)?(?:level|rank|type|attribute|name|atk|def)s?\s+(?:as|than)\b[^]*$/i, '');
        if (verb === 'add' && /^\s*to your hand\s*$/i.test(tail) && /^set$/i.test(matches[j + 1]?.[1] || '')) tail = clause.slice(matches[j + 1].index + matches[j + 1][0].length) + ' to your hand';
        if (verb === 'control') tail = tail.replace(/^\s*of\s+/i, ' ').replace(/\s+with each other\s*$/i, '');
        const self = /^\s*(?:this card|itself)\b/i.test(tail), pronoun = /^\s*(?:it|them|that (?:target|card|monster)s?|those (?:targets|cards|monsters))\b/i.test(tail);
        let antecedent = '';
        if (pronoun || verb === 'negate' || verb === 'control') {
          const heads = [before, previous];
          antecedent = heads.map(head => head.match(/\b(?:target(?:ing)?|chooses?|select|reveal|destroy|banish|send|shuffle|return)\s+(.+)/i)?.[1] || '').find(Boolean) || '';
        }
        if (verb === 'control') { tail = tail.replace(/^\s*of\s+/i, ' '); antecedent ||= previous.match(/\btarget\s+(.+)/i)?.[1] || ''; }
        let object = (pronoun || verb === 'control' && /^\s*(?:that|those)/i.test(tail)) ? antecedent ? `${antecedent} ${tail.replace(/^\s*(?:it|them|that (?:target|card|monster)s?|those (?:targets|cards|monsters))\b/i, '')}` : '' : tail;
        if (verb === 'send' && !/\bto (?:the |their |its owner's |your )?(?:gy|graveyard)\b/i.test(tail)) continue;
        if (verb === 'draw' && (!/^\s*(?:up to )?(?:\d+|a card|one|two|three|four|five|six|cards?\b|that many|the same number|a number)/i.test(tail) || /\b(?:your opponent|they|he\/she|the turn player)\s+(?:can |may |must |each )?$/i.test(before))) continue;
        // Santa Claws' "Summoned this way" draw belongs to the opponent who received it.
        if (verb === 'draw' && /\bif summoned this way\b/i.test(effect.condition) && /special summon this card[^.]*to your opponent's field/i.test(card.effect)) continue;
        const to = verb === 'return' ? /\bto (?:the |its |their |your )?(?:owner's |owners' )?hands?\b/i.test(tail) ? 'hand' : /\b(?:into|to|on) (?:the |its |their |your )?(?:(?:top|bottom) of (?:the |your |their )?)?(?:owner's |owners' )?(?:main |extra )?deck\b/i.test(tail) ? 'deck' : '' : '';
        let phrase = null, any = false;
        if (verb === 'negate') {
          if (/^\s*(?:(?:the|that|an?|this|its)\s+)?attacks?\b/i.test(tail)) continue;
          // The activation event precedes costs; Spell Card or effect stays typed (Herald of Green Light).
          const event = [...effect.text.slice(0, effect.text.indexOf(clause) + match.index).matchAll(/\b(?:when|if)\s+([^:;]*?\bactivat(?:e[sd]?|ion)\b[^:;]*)/gi)].at(-1)?.[1] || '';
          if (!/\b(?:activation|effects?)\b/i.test(tail)) continue;
          const reactive = /\b(?:activation|effect)\b/i.test(tail) && !/\beffects? of (?:all|\d+|an?|the face-up|that monster)/i.test(tail) && !!event;
          let what = reactive ? event.replace(/\b(?:that|which|while|and you|if you)\b[^]*$/i, '').replace(/\b(?:is|was) activated\b[^]*$/i, 'is activated').replace(/\beffects? to [^]*$/i, '').replace(/^.*?\bOR\s+/,'') : /\b(?:monsters?|spells?|traps?|cards?)\b/i.test(tail) ? tail : antecedent;
          what = what.replace(/,?\s+(?:up to|equal to)\b[^]*$/i, '').replace(/\b(?:that|which)\s+(?:activates?|is|are|targets?|destroys?|has|have)\b[^]*$/i, '').replace(/\b(?:spell (?:&|and) trap|monster) zones?\b/gi, '').replace(/\b(?:that|which)\s+(?:has|have|destroys?|targets?)\b[^]*$/i, '');
          // A just-Summoned friendly body with negated effects is a drawback (Junk Synchron).
          if (!reactive && /\b(?:special|ritual) summon\b/i.test(previous + ' ' + before) && /^\s*(?:its|their|that monster's|the summoned monster's) effects?/i.test(tail)) continue;
          const kinds = [];
          if (/\bspells?\b/i.test(what)) kinds.push('Spell');
          if (/\btraps?\b/i.test(what)) kinds.push('Trap');
          if (/\bmonsters?\b/i.test(what)) kinds.push('Monster');
          any = reactive && (kinds.length === 3 || !kinds.length && /\bcards?\s*,?\s*(?:or|\/)\s*(?:the )?effects?\b/i.test(what));
          if (!kinds.length && !any && !/\b(?:(?:all|each|every|(?:up to )?\d+) (?:face-up )?|face-up )cards?\b/i.test(what)) continue;
          phrase = { refs: [], kinds: any || !kinds.length ? null : kinds, frames: [], properties: [], tuner: false, abilities: [], attributes: [], types: [], stats: {}, not: [] };
        } else if (verb !== 'draw') phrase = self ? { ...describeObject('monster', names), refs: [{ mode: 'exact', name: normalize(card.name), label: card.name }] } : describeObject(object, names);
        const returnSource = object.replace(/\b(?:equal to|up to|so the number|for each)\b[^]*$/i, '');
        if (verb === 'return' && (!to || self || !object || /\b(?:fusion materials?|excavat|remaining|rest of|end phase|end of (?:this|the) turn)\b/i.test(object + ' ' + effect.condition) || !((DESCRIBE_SOURCES.field(returnSource) || !/(?:gy|graveyard|banishw*|hand|deck)/i.test(returnSource) && /(?:monsters?|cards?|spells?|traps?|targets?)/i.test(returnSource)) && (!DESCRIBE_SOURCES.gy(returnSource) || /controls (?:and|or)[^]*\b(?:in|from) (?:their|your|the) (?:gy|graveyard)/i.test(returnSource)) && !DESCRIBE_SOURCES.banished(returnSource) && (!DESCRIBE_SOURCES.extra(returnSource) || /pendulum zone|you control|your field/i.test(returnSource)) || to === 'deck' && /\b(?:your opponent's|their) hand\b/i.test(object)))) continue;
        if (verb === 'summon' && !/^special|^ritual/.test(word)) continue;
        // A self-revival takes its source from its own condition (Zephyros), not a later material cost.
        const sourceObject = object.replace(/\bwith (?:a different|the same) name\b[^]*$/i, '');
        // A source of its own wins: Deep-Eyes White Dragon's "Special Summon this card from your hand" after a GY trigger.
        const where = self && verb === 'summon' && !/\b(?:from|in) (?:your|the|their) (?:hand|gy|graveyard|deck|banish)/i.test(sourceObject) ? `${sourceObject} ${effect.condition}` : sourceObject;
        if (phrase) Object.assign(phrase, { fromMain: DESCRIBE_SOURCES.deck(where), fromExtra: DESCRIBE_SOURCES.extra(where), deck: DESCRIBE_SOURCES.deck(where) ? 'main' : undefined });
        list.push({ verb, self, phrase, any, to, where, clause, index: i, effect, object });
      }
      // Passive activation negation (Light and Darkness Dragon) reads the same event as the active wording.
      if (/\b(?:activation|effects?) (?:is|are) negated\b/i.test(clause)) {
        const passive = clause.match(/\b(?:that|the|its) activation is negated\b/i);
        const event = effect.text.match(/\bwhen ([^:;]*?activat[^:;]*)/i)?.[1];
        const kinds = event && ['Spell', 'Trap', 'Monster'].filter(kind => new RegExp('\\b' + kind + 's?\\b', 'i').test(event));
        if (passive && kinds?.length) list.push({ verb: 'negate', phrase: { ...describeObject('monster', names), kinds }, any: kinds.length === 3, where: '', clause, effect, index: i });
        else if (/\b(?:effects of|trap cards?[^.]*effects|effects of[^.]*trap cards?)\b/i.test(clause) && !/\bsummon/i.test(clause)) {
          const phrase = describeObject(clause, names); if (phrase) list.push({ verb: 'negate', phrase, any: false, where: clause, clause, effect, index: i });
        }
      }
    });
    return entry.actions = list;
  }
  const describeKey = text => normalize(text).replace(/[-/]/g, ' ').replace(/[^\p{L}\p{N}§'+ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  let describeVocab = null;
  // The words a description understands: the concepts, card kinds, Attributes, Types, frames, Spell/Trap properties,
  // sources, and the catalog's archetypes and card names.
  // Built once per catalog; ahead in a description's slices (describeTask), else in one go.
  const describeWords = () => labDrain(describeWordsTask());
  function* describeWordsTask() {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (describeVocab?.cards === cards && describeVocab.size === cards.length) return describeVocab;
    yield* archetypeIndexTask(cards);
    const map = new Map(), add = (words, entry) => { for (const word of [].concat(words)) { const key = describeKey(word); if (key && !map.has(key)) map.set(key, entry); } };
    for (const concept of DESCRIBE_CONCEPTS) add(concept.words, { kind: 'concept', concept, label: concept.label });
    add(['monster', 'mon', 'mons'], { kind: 'kind', value: ['Monster'], label: 'Monster' });
    add(['spell', 'spell card', 'magic'], { kind: 'kind', value: ['Spell'], label: 'Spell' });
    add(['trap', 'trap card'], { kind: 'kind', value: ['Trap'], label: 'Trap' });
    add(['spell/trap', 'spell trap', 'spells traps', 'spell or trap', 's/t', 'backrow'], { kind: 'kind', value: ['Spell', 'Trap'], label: 'Spell/Trap' });
    for (const attribute of ATTRIBUTES) add(attribute, { kind: 'attributes', value: attribute, label: attribute });
    for (const type of monsterTypes().names) add(type, { kind: 'types', value: type, label: type });
    add(['beast warrior', 'beastwarrior'], { kind: 'types', value: 'Beast-Warrior', label: 'Beast-Warrior' });
    for (const frame of ['Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum']) add(frame, { kind: 'frames', value: frame, label: frame });
    // A bare "effect" is a word of the query ("negate monster effect"), not the Effect frame.
    add(['effect monster', 'effect monsters'], { kind: 'frames', value: 'Effect', label: 'Effect Monster' });
    add(['tuner'], { kind: 'tuner', label: 'Tuner' });
    for (const ability of ABILITIES) add(ability, { kind: 'abilities', value: ability, label: ability });
    // Ritual and Normal are frames or Spell/Trap properties; the kind beside them decides (describeSpec).
    add('ritual', { kind: 'either', value: 'Ritual', label: 'Ritual' }); add('normal', { kind: 'either', value: 'Normal', label: 'Normal' });
    add(['quick play', 'quickplay', 'quick play spell', 'qp'], { kind: 'properties', value: ['Spell:Quick-Play'], label: 'Quick-Play Spell' });
    add(['field', 'field spell'], { kind: 'properties', value: ['Spell:Field'], label: 'Field Spell' });
    add(['equip spell', 'equip card'], { kind: 'properties', value: ['Spell:Equip'], label: 'Equip Spell' });
    add(['continuous'], { kind: 'properties', value: ['Spell:Continuous', 'Trap:Continuous'], label: 'Continuous' });
    add(['continuous spell'], { kind: 'properties', value: ['Spell:Continuous'], label: 'Continuous Spell' });
    add(['continuous trap'], { kind: 'properties', value: ['Trap:Continuous'], label: 'Continuous Trap' });
    add(['counter trap', 'counter'], { kind: 'properties', value: ['Trap:Counter'], label: 'Counter Trap' });
    const source = (place, words) => add(words, { kind: 'source', value: place, label: DESCRIBE_SOURCE_LABELS[place] });
    source('deck', ['from deck', 'from main deck', 'from the deck', 'from your deck', 'in deck']);
    source('extra', ['from extra deck', 'from extra', 'from the extra deck', 'from ed']);
    source('gy', ['from gy', 'from graveyard', 'from grave', 'from the gy', 'from your gy', 'in gy', 'in graveyard', 'in the gy', 'from the graveyard']);
    source('hand', ['from hand', 'from the hand', 'from your hand', 'in hand']);
    source('banished', ['from banished', 'from banishment', 'banished', 'from the banishment']);
    source('field', ['from field', 'on field', 'on the field', 'from the field', 'opponent s', "opponent's", 'opponents']);
    add(['not', 'non', 'no', 'without', 'except', 'but not'], { kind: 'not' });
    add(['that', 'which', 'who', 'whose', 'with an effect that', 'can', 'able to'], { kind: 'that' });
    add(['a', 'an', 'the', 'card', 'cards', 'your', 'my', 'their', 'with', 'to', 'of', 'its', 'it', 'is', 'are', 'be', 'i', 'me', 'find', 'show', 'want', 'need', 'all',
      'any', 'some', 'and', 'or', 'also', 'effect', 'effects', 'by', 'for', 'on', 'in', 'from', 'opponent', 'turn', 'one', 'what', 'does', 'do', 'them', 'they', 'thing', 'things',
      'synergy', 'support', 'type', 'attribute', 'archetype', 'deck', 'during', 'their turn', 'opponents turn', 'opponent turn', 'either', 'player', 'up', 'up to', 'could', 'like'], { kind: 'filler' });
    // Archetypes: the quoted names card texts use as one ('"Branded" Spell'), last: a word above means what it says there.
    for (const [key, label] of archetypeIndex.used) add(key, { kind: 'archetype', value: key, label: `“${label}”` });
    const names = new Map();
    for (const card of cards) { if (card?.name && !card.rush) { const key = describeKey(card.name); if (!names.has(key)) names.set(key, card); } yield* fetchCheckpoint(); }
    const singles = [...map].filter(([key, entry]) => !key.includes(' ') && key.length >= 4 && !['filler', 'archetype', 'that'].includes(entry.kind)).map(([key]) => key);
    return describeVocab = { cards, size: cards.length, map, names, singles };
  }
  // One typo (a letter added, missing, changed or two swapped) in a word of 5 letters or more.
  function oneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1 || a === b) return false;
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  function describeLookup(vocab, key) {
    const exact = vocab.map.get(key);
    if (exact) return { entry: exact, exact: true };
    // Plurals and verb forms: "searches", "hand traps", "fairies", "negating", "revived", "negaters".
    const words = key.split(' '), last = words.pop();
    for (const stem of [last.replace(/ies$/, 'y'), last.replace(/es$/, ''), last.replace(/s$/, ''), last.replace(/ing$/, ''), last.replace(/ing$/, 'e'), last.replace(/ed$/, ''), last.replace(/d$/, ''), last.replace(/ers?$/, ''), last.replace(/ers?$/, 'e'), last.replace(/rs?$/, '')]) {
      if (stem === last || stem.length < 2) continue;
      const entry = vocab.map.get([...words, stem].join(' '));
      if (entry) return { entry, exact: true };
    }
    return null;
  }
  // The card a few words name: its whole name, else the shortest name with a word starting with them ("phara").
  function describeCard(vocab, words) {
    const key = words.join(' ');
    if (key.length < 3) return null;
    if (vocab.names.has(key)) return vocab.names.get(key);
    // Whole words first ("phara": Phara the Primordial Goddess, not Pharaonic Advent), then the shortest name.
    let best = null;
    for (const [name, card] of vocab.names) {
      if (!(' ' + name).includes(' ' + key)) continue;
      const score = ((' ' + name + ' ').includes(' ' + key + ' ') ? 0 : 2000) + (name.startsWith(key) ? 0 : 1000) + name.length;
      if (!best || score < best.score) best = { score, card };
    }
    return best?.card || null;
  }
  const STAT_KEYS = { level: 'level', lvl: 'level', lv: 'level', star: 'level', stars: 'level', rank: 'rank', link: 'link', atk: 'atk', attack: 'atk', def: 'def', defense: 'def', defence: 'def', scale: 'scale' };
  const STAT_LABELS = { level: 'Level', rank: 'Rank', link: 'Link', atk: 'ATK', def: 'DEF', scale: 'Scale' };
  function statBound(value, how) {
    const n = Number(value);
    if (!how) return [String(n), String(n)];
    if (/^(?:>=|=>|\+|or (?:more|higher|above|greater)|and (?:up|above|higher|more)|at least|min(?:imum)?)$/.test(how)) return [String(n), ''];
    if (/^(?:>|over|above|more than|greater than|higher than)$/.test(how)) return [String(n + 1), ''];
    if (/^(?:<=|=<|or (?:less|lower|below|fewer|under)|and (?:below|under|lower|less)|at most|max(?:imum)?)$/.test(how)) return ['', String(n)];
    if (/^(?:<|under|below|less than|lower than)$/.test(how)) return ['', String(n - 1)];
    return [String(n), String(n)];
  }
  // "level 4", "lv4", "level 4 or lower", "atk >= 2500", "atk 3000 or more", "3000+ atk", "at least 2000 def", "4 stars", "link 2".
  const describeStatPatterns = (() => {
    const stat = '(level|lvl|lv|rank|link|atk|attack|def|defense|defence|scale)', after = '(\\+|or (?:more|higher|above|greater|less|lower|below|fewer|under)|and (?:up|above|higher|more|below|under|lower|less))';
    const before = '(>=|=>|<=|=<|>|<|=|at least|at most|over|under|above|below|more than|less than|greater than|higher than|lower than|min|max)';
    return [
      new RegExp(`\\b${stat}\\s*(?:${before}\\s*)?(\\d+)\\s*${after}?(?=\\s|$)`, 'g'),
      new RegExp(`(?:\\b${before}\\s*)?\\b(\\d+)\\s*(\\+)?\\s*-?\\s*(stars?|atk|attack|def|defense|defence)\\b(?:\\s*${after})?`, 'g'),
    ];
  })();
  function describeStats(text) {
    const found = [];
    for (const match of text.matchAll(describeStatPatterns[0])) found.push({ start: match.index, end: match.index + match[0].length, key: STAT_KEYS[match[1]], bound: statBound(match[3], match[2] || match[4]) });
    for (const match of text.matchAll(describeStatPatterns[1])) {
      if (found.some(f => match.index < f.end && match.index + match[0].length > f.start)) continue;
      found.push({ start: match.index, end: match.index + match[0].length, key: STAT_KEYS[match[4]], bound: statBound(match[2], match[1] || match[3] || match[5]) });
    }
    for (const f of found) {
      const [low, high] = f.bound;
      f.label = `${STAT_LABELS[f.key]} ${low === high ? low : low === '' ? '≤ ' + high : '≥ ' + low}`;
    }
    return found.sort((a, b) => a.start - b.start);
  }
  const describeGroup = () => ({ kinds: new Set(), attributes: new Set(), types: new Set(), frames: new Set(), abilities: new Set(), properties: new Set(), either: new Set(), tuner: false,
    stats: {}, archetypes: [], words: [], wordRanges: [], labels: [], not: { kinds: new Set(), attributes: new Set(), types: new Set(), frames: new Set(), abilities: new Set(), properties: new Set(), either: new Set(), archetypes: [], tuner: false, concepts: [] } });
  // The query read: { self, parts, chips, pending }. self: what the card is; parts: one per effect concept, with what it acts on
  // (group, or target: a card named) and where from (sources). Chips carry the ranges of the words they read, for ×.
  function readDescribe(raw) {
    const vocab = describeWords(), text = normalize(raw).replace(/[“”]/g, '"'), self = describeGroup(), parts = [], chips = [];
    const stats = describeStats(text), tokens = [];
    for (const match of text.matchAll(/[^\s,;.!?()"]+/g)) {
      const inStat = stats.find(s => match.index >= s.start && match.index < s.end);
      if (inStat) { if (!tokens.includes(inStat)) tokens.push(inStat); continue; }
      let word = match[0], start = match.index, not = false;
      if (/^-\S/.test(word)) { not = true; word = word.slice(1); start++; } else if (/^non-\S/.test(word)) { not = true; word = word.slice(4); start += 4; }
      tokens.push({ word, start, end: match.index + match[0].length, not });
    }
    const entries = [];
    let pending = '';
    for (let i = 0; i < tokens.length;) {
      const token = tokens[i];
      if (token.key) { entries.push({ kind: 'stat', key: token.key, bound: token.bound, label: token.label, start: token.start, end: token.end }); i++; continue; }
      let hit = null, n = 0;
      for (n = Math.min(5, tokens.length - i); n >= 1 && !hit; n--) {
        const run = tokens.slice(i, i + n);
        if (run.some(t => t.key) || run.slice(1).some(t => t.not)) continue;
        hit = describeLookup(vocab, describeKey(run.map(t => t.word).join(' ')));
        if (hit) hit.n = n;
      }
      n = hit?.n || 1;
      const end = tokens[i + n - 1].end, last = i + n === tokens.length && !/\s$/.test(raw);
      if (!hit && token.word.length >= 5 && !/\d/.test(token.word)) {
        const key = describeKey(token.word), near = vocab.singles.find(word => oneEdit(key, word));
        if (near) hit = { entry: vocab.map.get(near), typo: `${token.word} → ${near}` };
      }
      // A word still being typed counts once it is complete or means one thing only ("han" → "hand").
      if (last && (!hit || hit.typo) && [...vocab.map.keys()].some(key => key.startsWith(describeKey(token.word)) && key !== describeKey(token.word))) { pending = token.word; i += n; continue; }
      entries.push(hit ? { ...hit.entry, typo: hit.typo, not: token.not, start: token.start, end } : { kind: 'word', word: describeKey(token.word), not: token.not, start: token.start, end });
      i += n;
    }
    let group = self, part = null, notNext = false;
    for (const entry of entries) {
      if (entry.kind === 'filler') continue;
      if (entry.kind === 'that') { group = self; continue; }
      if (entry.kind === 'not') { notNext = true; continue; }
      const not = entry.not || notNext; notNext = false;
      if (entry.kind === 'concept') {
        if (not) { self.not.concepts.push(entry.concept); chips.push({ label: `not ${entry.concept.label}`, ranges: [[entry.start, entry.end]], title: entry.typo }); continue; }
        part = { concept: entry.concept, group: describeGroup(), sources: [], ranges: [[entry.start, entry.end]], typo: entry.typo };
        parts.push(part); group = entry.concept.intransitive ? self : part.group; continue;
      }
      if (entry.kind === 'source') { if (part) { part.sources.push(entry.value); part.ranges.push([entry.start, entry.end]); } continue; }
      const into = not ? group.not : group, label = (not ? 'not ' : '') + (entry.label || entry.word);
      if (entry.kind === 'kind') entry.value.forEach(v => into.kinds.add(v));
      else if (['attributes', 'types', 'frames', 'abilities', 'either'].includes(entry.kind)) into[entry.kind].add(entry.value);
      else if (entry.kind === 'properties') entry.value.forEach(v => into.properties.add(v));
      else if (entry.kind === 'tuner') into.tuner = true;
      else if (entry.kind === 'stat' && !not) group.stats[entry.key] = entry.bound;
      else if (entry.kind === 'archetype') into.archetypes.push({ name: entry.value, label: entry.label });
      else if (entry.kind === 'word') { if (not) group.not.archetypes.push({ word: entry.word, label: entry.word }); else { group.words.push(entry.word); group.wordRanges.push([entry.start, entry.end]); continue; } }
      group.labels.push({ label, ranges: [[entry.start, entry.end]], title: entry.typo });
    }
    // Words no list knows: after a verb, a card's name ("search phara"); for the card itself, a name, else words of its text.
    for (const p of parts) if (p.group.words.length) {
      const card = describeCard(vocab, p.group.words);
      if (card) { p.target = card; p.group.labels.push({ label: `“${card.name}”`, ranges: p.group.wordRanges }); }
      else p.group.labels.push({ label: `text “${p.group.words.join(' ')}”`, ranges: p.group.wordRanges, plain: true });
    }
    if (self.words.length) {
      const key = self.words.join(' '), card = vocab.names.get(key);
      if (card) self.card = card;
      self.labels.push({ label: card ? `“${card.name}”` : `text “${key}”`, ranges: self.wordRanges, plain: !card });
    }
    for (const p of parts) {
      for (const label of p.group.labels) p.ranges.push(...label.ranges);
      const object = p.group.labels.map(l => l.label).join(' '), sources = p.sources.map(s => DESCRIBE_SOURCE_LABELS[s]).join(', ');
      chips.push({ label: [p.concept.label, object, sources].filter(Boolean).join(' · '), ranges: p.ranges, title: [p.typo, ...p.group.labels.map(l => l.title)].filter(Boolean).join('; ') || '', concept: true });
      p.spec = describeSpec(p.group); p.not = describeExclusions(p.group);
    }
    for (const label of self.labels) chips.push({ ...label, title: label.title || '' });
    self.spec = describeSpec(self); self.exclude = describeExclusions(self);
    const active = parts.length > 0 || !!self.spec || !!self.exclude || self.words.length > 0 || self.not.concepts.length > 0;
    return { raw, self, parts, chips, pending, active };
  }
  // A group as a card-text phrase (fetchPhrase's shape), for fetchRank and objectRank; null when it says nothing.
  function describeSpec(g) {
    const monsterWords = g.attributes.size || g.types.size || g.frames.size || g.abilities.size || g.tuner || Object.keys(g.stats).some(key => key !== 'scale') || g.stats.scale;
    const kinds = new Set(g.kinds), properties = new Set(g.properties), frames = new Set(g.frames);
    for (const property of properties) kinds.add(property.split(':')[0]);
    const base = { refs: g.archetypes.map(a => ({ name: a.name, mode: 'archetype', label: a.label.replace(/[“”]/g, ''), kinds: null, frames: [], properties: [], tuner: false, abilities: [] })),
      frames: [], properties: [], tuner: g.tuner, abilities: [...g.abilities], attributes: [...g.attributes], types: [...g.types], stats: { ...g.stats }, not: [] };
    if (g.card) base.refs.push({ name: normalize(g.card.name), mode: 'exact', label: g.card.name });
    const make = (k, f, p) => ({ ...base, kinds: k.size ? [...k] : null, frames: [...f], properties: [...p] });
    // "Ritual" / "Normal": a frame beside "monster" or a Monster word, a property beside "Spell"/"Trap", else either.
    if (g.either.size) {
      const asFrame = kinds.has('Monster') || monsterWords, asProperty = [...kinds].some(kind => kind !== 'Monster');
      const frameSpec = () => make(new Set(['Monster']), new Set([...frames, ...g.either]), properties);
      const propertySpec = kinds2 => make(kinds2, frames, new Set([...properties, ...[...g.either].flatMap(word => [...kinds2].filter(kind => PROPERTIES[kind]?.includes(word)).map(kind => `${kind}:${word}`))]));
      if (asFrame && !asProperty) return frameSpec();
      if (asProperty && !asFrame) return propertySpec(kinds);
      return { ...make(kinds, frames, properties), alternatives: [frameSpec(), propertySpec(new Set(g.either.has('Ritual') && !g.either.has('Normal') ? ['Spell'] : ['Spell', 'Trap']))] };
    }
    if (monsterWords && !kinds.size) kinds.add('Monster');
    if (!kinds.size && !base.refs.length && !frames.size && !Object.keys(base.stats).length) return null;
    return make(kinds, frames, properties);
  }
  function describeExclusions(g) {
    const n = g.not;
    return n.kinds.size || n.attributes.size || n.types.size || n.frames.size || n.abilities.size || n.properties.size || n.either.size || n.tuner || n.archetypes.length ? n : null;
  }
  function describeExcluded(card, n) {
    if (!n) return false;
    const monster = card.card_type === 'Monster', text = indexedText(card);
    if (n.kinds.has(card.card_type) || monster && (n.attributes.has(card.attribute) || n.types.has(card.type))) return true;
    if (monster && [...n.frames, ...n.either].some(frame => fitsKind(card, { kinds: null, frames: [frame], properties: [], tuner: false }))) return true;
    if (monster && [...n.abilities].some(ability => fitsKind(card, { kinds: null, frames: [], properties: [], tuner: false, abilities: [ability] }))) return true;
    if (n.tuner && monster && String(card.ability).includes('Tuner')) return true;
    if (!monster && ([...n.properties].includes(`${card.card_type}:${card.type}`) || n.either.has(card.type))) return true;
    return n.archetypes.some(a => a.name ? text.name.some(name => namePart(name, a.name)) : text.name.some(name => describeKey(name).includes(a.word)) || text.effect.some(s => describeKey(s).includes(a.word)));
  }
  const rangesOverlap = ([lowA, highA], [lowB, highB]) => {
    if ([lowA, highA, lowB, highB].includes('?')) return lowA === '?' && lowB === '?';
    const lo = v => v === '' ? -Infinity : Number(v), hi = v => v === '' ? Infinity : Number(v);
    return lo(lowA) <= hi(highB) && lo(lowB) <= hi(highA);
  };
  const DESCRIBE_LISTS = ['attributes', 'types', 'frames', 'abilities', 'properties'];
  // How an effect's object P fits the object asked for, Q: 0 it names what Q asks (its Attribute, Type, kind…), 1 it is
  // not narrowed that way (any monster), Infinity it asks for something else.
  function objectRank(P, Q) {
    // Nothing asked about the object ("steal"): any action counts, read or not (Locomotion R-Genex). Asked: it must be read.
    if (!Q) return 0;
    if (!P) return Infinity;
    if (Q.alternatives) return Math.min(...Q.alternatives.map(q => objectRank(P, q)));
    if (P.alternatives) return Math.min(Infinity, ...P.alternatives.map(p => objectRank({ ...p, fromMain: P.fromMain, fromExtra: P.fromExtra, deck: P.deck }, Q)));
    let rank = 0;
    const monsterOnly = p => p.attributes?.length || p.types?.length || p.frames?.length || p.abilities?.length || p.tuner || ['level', 'rank', 'link', 'atk', 'def'].some(key => p.stats?.[key]);
    const kindsIn = p => p.kinds?.length ? p.kinds : [...new Set((p.refs || []).flatMap(ref => ref.kinds || []))].length ? [...new Set(p.refs.flatMap(ref => ref.kinds || []))] : monsterOnly(p) ? ['Monster'] : null;
    const pk = kindsIn(P), qk = kindsIn(Q);
    if (qk) { if (!pk) rank = 1; else if (!pk.some(kind => qk.includes(kind))) return Infinity; }
    for (const key of DESCRIBE_LISTS) if (Q[key]?.length) { const own = P[key] || []; if (!own.length) rank = 1; else if (!own.some(value => Q[key].includes(value))) return Infinity; }
    if (Q.tuner && !P.tuner) { if (P.not?.includes('tuner')) return Infinity; rank = 1; }
    for (const [key, bound] of Object.entries(Q.stats || {})) { const own = P.stats?.[key]; if (!own) rank = 1; else if (!rangesOverlap(own, bound)) return Infinity; else if (bound[0] !== '' && (own[0] === '' || +own[0] < +bound[0]) || bound[1] !== '' && (own[1] === '' || +own[1] > +bound[1])) rank = 1; }
    if (Q.refs?.length) {
      if (!P.refs?.length) rank = 1;
      else if (!P.refs.some(ref => Q.refs.some(q => ref.name === q.name || ref.mode === 'exact' && namePart(ref.name, q.name)))) return Infinity;
    }
    // The whole object and source must intersect Q (Gold Gadget cannot fetch a FIRE Level 4 Gadget).
    if (P.refs?.length) { const fit = Math.min(...P.refs.map(ref => describeRefFit(ref, Q, P))); return fit < Infinity && rank === 0 && Q.refs?.length ? 0 : fit; }
    // Narrowed another way ("1 Fairy monster" for FIRE): not what was asked. Exclusions and text conditions: the cards they
    // leave must meet Q (a catalog pass per object, so only for these few).
    if (rank !== 0 && (DESCRIBE_LISTS.some(key => P[key]?.length && !Q[key]?.length) || P.tuner && !Q.tuner)) return Infinity;
    if ((P.except || P.excluded?.length || P.not?.length || P.textHas?.length) && !describeIntersects(Q, P)) return Infinity;
    if (rank === 0) return 0;
    return 1;
  }
  // "searcher -fire": an effect whose object is only what is excluded (1 FIRE monster, "Dark Magician" for -dark).
  function objectExcluded(P, n) {
    if (!P) return false;
    if (P.alternatives) return P.alternatives.every(p => objectExcluded(p, n));
    const all = (list, set) => list?.length && list.every(value => set.has(value));
    if (all(P.kinds, n.kinds) || all(P.attributes, n.attributes) || all(P.types, n.types) || all(P.frames, n.frames) || all(P.abilities, n.abilities) || all(P.properties, n.properties) || n.tuner && P.tuner) return true;
    const exact = P.refs?.filter(ref => ref.mode === 'exact').map(ref => describeWords().names.get(describeKey(ref.label || ref.name))).filter(Boolean);
    return !!exact?.length && exact.length === P.refs.length && exact.every(card => describeExcluded(card, n));
  }
  let describeFits = null;
  const describeIndex = () => labDrain(describeIndexTask());
  function* describeIndexTask() {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (describeFits?.cards !== cards || describeFits.size !== cards.length) {
      // The cards by each word of their names: a name part starts at a word of the name (namePart).
      const words = new Map();
      for (const card of cards) {
        if (card.name && !card.rush && !card.custom && card.hidden != 1 && card.card_type !== 'Skill') for (const name of indexedText(card).name) for (const word of new Set(name.split(/[^\p{L}\p{N}]+/u))) if (word) (words.get(word) || words.set(word, []).get(word)).push(card);
        yield* fetchCheckpoint();
      }
      describeFits = { cards, size: cards.length, words, members: new Map(), fits: new Map(), asked: new Map() };
    }
    return describeFits;
  }
  // Is there a card that fits both the object (with its exclusions: "1 non-Tuner monster", 'except "X"') and Q? Read over the
  // cards that fit Q, kept per Q, up to the first one: over the whole catalog per object, single cards took up to 285 ms (Node).
  function describeIntersects(Q, P) {
    const index = describeIndex(), qKey = JSON.stringify(Q), key = `${qKey}:${JSON.stringify({ ...P, describeWhere: undefined, clause: undefined })}`;
    if (index.fits.has(key)) return index.fits.get(key);
    let asked = index.asked.get(qKey);
    if (!asked) index.asked.set(qKey, asked = index.cards.filter(card => card.name && !card.rush && !card.custom && card.hidden != 1 && card.card_type !== 'Skill' && fetchRank(card, Q) < Infinity));
    const fit = asked.some(card => !(P.fromMain && extraDeckMonster(card)) && (!P.except || fetchRank(card, P.except) === Infinity) && fetchRank(card, { ...P, refs: [] }) < Infinity);
    index.fits.set(key, fit);
    return fit;
  }
  function describeRefFit(ref, Q, P = {}) {
    const cards = describeIndex().cards;
    // The members depend on the whole ref (its kinds, frames …), the fit on Q too (audit, 2026-10-31: keyed by name only, one
    // query changed the next one's results).
    // Without its label and index (where the name sits in that card's text), so every card naming it shares the entry.
    const refKey = ref ? JSON.stringify([ref.mode, ref.name, ref.nameMatch, ref.kinds, ref.frames, ref.properties, ref.tuner, ref.abilities, ref.types]) : 'null';
    const key = `${refKey}:${JSON.stringify({ ...P, refs: undefined, describeWhere: undefined, clause: undefined })}:${JSON.stringify(Q)}`;
    if (describeFits.fits.has(key)) return describeFits.fits.get(key);
    // The ref's cards once (its name in theirs: a few dozen), then per object the ones its other conditions leave. Read per
    // object over the name index, a first "revive fire monster" took 4–10 s (Node, catalog 787).
    let named = describeFits.members.get(refKey);
    if (!named) {
      // Candidates by the rarest word of the name (each word is a word of the card's name; the last may take an s or es):
      // by the first word, "The Phantom Knights" read every card with "the" (1 s live on DuelingBook, 2026-10-31).
      const seen = new Set(), words = ref ? ref.name.split(/[^\p{L}\p{N}]+/u).filter(Boolean) : [], index = describeFits.words;
      const lists = words.map((word, i) => i < words.length - 1 ? index.get(word) || [] : [...new Set([word, word + 's', word + 'es'].flatMap(w => index.get(w) || []))]);
      const candidates = !ref || !['exact', 'archetype'].includes(ref.mode) || !lists.length ? cards : lists.reduce((a, b) => b.length < a.length ? b : a);
      const bare = { refs: ref ? [ref] : [], kinds: null, frames: [], properties: [], tuner: false, abilities: [], attributes: [], types: [], stats: {}, not: [] };
      // A mention is read straight from the texts: fetchRank over the whole catalog took about a second live.
      const fits = ref?.mode === 'mention' ? card => indexedText(card).effect.some(s => s.includes(`"${ref.name}"`)) : card => !ref || fetchRank(card, bare) < Infinity;
      named = candidates.filter(card => card.name && !card.rush && !card.custom && card.hidden != 1 && card.card_type !== 'Skill' && fits(card) && !seen.has(card.name) && seen.add(card.name));
      describeFits.members.set(refKey, named);
    }
    const members = named.filter(card => !(P.fromMain && extraDeckMonster(card)) && (!P.except || fetchRank(card, P.except) === Infinity) && fetchRank(card, { ...P, refs: ref ? [ref] : [] }) < Infinity);
    const fit = members.filter(card => fetchRank(card, Q) < Infinity).length, rank = !fit ? Infinity : fit === members.length ? 0 : 1;
    describeFits.fits.set(key, rank);
    return rank;
  }
  // The card's text, sentence by sentence, for a concept read from the whole text (category / test).
  function describeSentence(card, pattern) {
    const flavor = card.card_type === 'Monster' && String(card.monster_color) === 'Normal';
    for (const sentence of quoteText((flavor ? '' : card.effect) + '\n' + card.pendulum_effect).split(/(?<=[.])\s+|\n+/)) if (pattern.test(normalize(sentence).replace(/graveyard/g, 'gy'))) return sentence.trim();
    return '';
  }
  // The clause to show, with the clause before when it says what "it" is ("Target 1 monster in your GY … Special Summon it").
  const unmaskClause = (card, clause) => {
    const { names, clauses } = cardClauses(card), at = clauses.indexOf(clause), unmask = text => text.replace(/"§(\d+)§"/g, (m, n) => `"${names[n]}"`);
    const referred = at > 0 && /^\s*(?:(?:you can|and|then)\s+)?\w+(?:\s+summon)?\s+(?:it|them|that|those)\b/i.test(clause);
    return referred ? `${unmask(clauses[at - 1])} … ${unmask(clause)}` : unmask(clause);
  };
  // Resolved benefits, in their own sentence (Solemn Wishes gains LP; Aromage Jasmine reacts to it).
  function describeBenefit(card, key) {
    const text = normalize((card.card_type === 'Monster' && String(card.monster_color) === 'Normal' ? '' : card.effect) + '\n' + (card.pendulum_effect || '')).replace(/graveyard/g, 'gy');
    if (key === 'floodgate') return describeFloodgate(text);
    if (key === 'extender') {
      if (card.card_type !== 'Monster') return '';
      const action = describeActions(card).find(a => a.verb === 'summon' && a.self && /\b(?:hand|gy|banish)/i.test(a.where) && !/damage step|damage calculation|battle damage|declares (?:an?|a direct) attack|attack declaration|an attack is declared|during your end phase|when you take[^.;]*opponent|destroyed[^.;]*opponent|opponent's (?:turn|battle phase)|your opponent (?:activates|destroys)|destroyed by (?:battle|an opponent)|to your opponent's (?:field|side)/i.test(a.effect.text));
      return action ? unmaskClause(card, action.clause) : '';
    }
    return text.split(/[.\n]+/).find((line, i, lines) => {
      if (key === 'gain') return [...line.matchAll(/\bgains?\s+(?:(?:\d+|that much|that many|that amount of|the same (?:amount|number) of|an? (?:amount|number) of)\s+)?(?:lp|life points)\b/g)].some(m => !/\b(?:if|when|whenever|each time)\b[^,;:]*$|\b(?:your opponent|they|he\/she)\s+(?:(?:can |will |would )?(?:choose to )?)$/i.test(line.slice(0, m.index)));
      if (key === 'protect') {
        if (/^\s*this effect cannot be negated/.test(line) && /cannot (?:special |normal |pendulum )?summon|you can only special summon/.test(lines[i - 1] || '')) return false;
        line = line.replace(/\([^)]*(?:even if|unaffected)[^)]*\)/g, '');
        if (/cannot (?:special |normal |pendulum )?summon/.test(line)) line = line.replace(/\(this effect cannot be negated\)/g, '');
        if (/unaffected by ["“]?necrovalley|your opponent's[^;:]* (?:cannot be|is unaffected)|that (?:monster|target) cannot be destroyed.*battle.*and.*(?:damage|atk)/.test(line)) return false;
        return /\bcannot be (?:destroyed|targeted|negated)\b|\bunaffected by\b|\bcannot target (?:this card|it|[^.;:]*you control)\b|\bwould be destroyed[^.]*instead\b/.test(line) && !/\b(?:opponent controls|opponent's monster)[^.;]*\b(?:cannot be destroyed|unaffected)\b/.test(line);
      }
      if (key === 'quick') return card.card_type === 'Monster' && /\bquick effect\b|\bduring either player's turn\b|\bthis effect can be activated during either player's turn\b/.test(line);
      if (key === 'token') return /\bspecial summon(?:s|ing)?\b[^.;:]*\btokens?\b/.test(line) && !/^(?:if|when|you cannot|neither player can)\b[^:;]*special summon(?:s|ing)?\b/.test(line);
      if (key === 'burn') return /\binflicts? (?:\d+ (?:points of )?damage|damage (?:to (?:your opponent|each player|both players) )?equal to)|\byour opponent (?:takes|loses) \d+ (?:damage|lp|life points)/.test(line);
      return false;
    }) || '';
  }
  // How a card does one concept of the query: { rank, text } (the clause, to show), or null.
  function conceptHit(card, part, query = '') {
    const { concept } = part, sources = part.sources.length ? part.sources : concept.from ? [concept.from] : [];
    const from = where => sources.every(place => DESCRIBE_SOURCES[place](where));
    // A card named: how the effect names it (fetchRank: 0 by name … 3 by Type or stats). Else the object asked, without what is excluded.
    const objectOf = phrase => !phrase ? (part.target || part.spec ? Infinity : 0) : part.target ? (() => { if (sources.includes('deck') && extraDeckMonster(part.target)) return Infinity; const r = fetchRank(part.target, phrase); return r === Infinity ? Infinity : r <= 1 ? 0 : r === 2 ? 0.5 : 1; })()
      : part.not && objectExcluded(phrase, part.not) ? Infinity : objectRank(phrase, part.spec);
    let best = null;
    const keep = (rank, text, self = false) => { if (rank < Infinity && (!best || rank < best.rank)) best = { rank, text, self }; };
    if (['floodgate', 'gain', 'protect', 'extender', 'quick', 'token', 'burn'].includes(concept.key)) { const text = describeBenefit(card, concept.key); if (text) keep(0, text); }
    else if (concept.category) { if (categoriesOf(card).has(concept.category)) keep(0, describeSentence(card, concept.mark)); }
    else if (concept.test) { const text = normalize((card.card_type === 'Monster' && String(card.monster_color) === 'Normal' ? '' : card.effect) + '\n' + card.pendulum_effect).replace(/graveyard/g, 'gy'); if (concept.test.test(text)) keep(0, describeSentence(card, concept.test)); }
    else if (concept.action) {
      for (const action of describeActions(card)) {
        if (action.verb !== concept.action || !action.phrase || !from(action.where.replace(concept.action === 'add' ? /\bto (?:your|the|their|its owner's) hand\b/gi : /^$/, ' '))) continue;
        if (concept.action === 'summon' && sources.includes('gy') && action.phrase.fromExtra) continue;
        if (concept.action === 'add' && /\byour opponent\s+(?:can |may )?adds?\b/i.test(action.clause)) continue;
        if (concept.action === 'add' && !/\bto (?:your|the|their|its owner's) hand\b/i.test(action.where)) continue;
        // A card that revives (searches …) itself comes after the ones that do it for other cards (Nine-Tailed Fox for "revive fire monster").
        keep(objectOf(action.phrase) + (action.self ? 1 : 0), unmaskClause(card, action.clause), action.self);
      }
    } else {
      for (const action of describeActions(card)) {
        if (action.verb !== concept.verb || action.self && concept.verb !== 'banish' || concept.to && action.to !== concept.to || !from(action.where)) continue;
        // "pop backrow" must be able to remove opposing backrow (Harpie Conductor only destroys yours).
        if (concept.key === 'destroy' && /\bbackrow\b/i.test(query) && /\byou control\b|\bin your (?:spell [&/] trap|pendulum) zone/i.test(action.object) && !/\b(?:your opponent controls|on the field)\b/i.test(action.object)) continue;
        if (concept.key === 'destroy' && /\bbackrow\b/i.test(query) && /\bdestroy (?:that|the) card you control\b/i.test(action.clause)) continue;
        // A negation of any card or effect fits "negate spell" as well, after the ones that name Spells.
        if (concept.verb === 'negate') { if (concept.any && !action.any) continue; keep(concept.any ? 0 : action.any ? (part.spec ? 1 : 0) : objectRank(action.phrase, part.spec), unmaskClause(card, action.clause)); }
        else keep(concept.verb === 'draw' ? 0 : objectOf(action.phrase), unmaskClause(card, action.clause));
      }
    }
    if (best && part.group.words.length && !part.target && !part.group.words.every(word => describeKey(best.text).includes(word))) best = null;
    return best;
  }
  // A card against a read query: { rank: the sum of its parts' ranks (Infinity: no match), why: [{ label, text }] }.
  function describeRank(card, read) {
    const why = [], { self } = read;
    let total = 0;
    if (self.spec && fetchRank(card, self.spec) === Infinity) {
      // An archetype also finds the cards that name it ("Branded" support), after its members.
      const rest = { ...self.spec, refs: [] }, plain = !rest.kinds && !rest.frames.length && !rest.attributes.length && !rest.types.length && !Object.keys(rest.stats).length;
      const quoted = self.spec.refs.length && !self.card && indexedText(card).effect.some(s => self.spec.refs.some(ref => s.includes(`"${ref.name}"`)));
      if (!quoted || !plain && fetchRank(card, rest) === Infinity) return { rank: Infinity, why };
      why.push({ label: `Mentions ${self.spec.refs.map(ref => `“${ref.label}”`).join(' or ')}`, text: '' });
      total = 1;
    }
    if (describeExcluded(card, self.exclude)) return { rank: Infinity, why };
    if (!self.card && self.words.length) {
      const text = indexedText(card), hit = self.words.every(word => text.name.some(name => describeKey(name).includes(word)) || text.effect.some(s => describeKey(s).includes(word)));
      if (!hit) return { rank: Infinity, why };
    }
    for (const concept of self.not.concepts) if (conceptHit(card, { concept, sources: [], group: describeGroup(), spec: null })) return { rank: Infinity, why };
    for (const part of read.parts) {
      const hit = conceptHit(card, part, read.raw);
      if (!hit) return { rank: Infinity, why };
      total += hit.rank;
      why.push({ label: part.concept.label + (hit.self ? ' (itself)' : hit.rank >= 1 ? ' (also other cards)' : ''), text: hit.text });
    }
    return { rank: total, why };
  }
  let describeCache = null;
  const describeRead = raw => describeCache?.raw === raw && describeCache.cards === window.Cards && describeCache.size === window.Cards?.length ? describeCache.read : (describeCache = { raw, cards: window.Cards, size: window.Cards?.length, read: readDescribe(raw) }).read;
  // A description's matches, in a search's slices (startFetchJob): reading the card texts the first time, and objects checked
  // against the catalog (describeRefFit) took 1–4 s a query in Node, catalog 787. found: card → describeRank.
  const describeTask = raw => function* (progress) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [], found = new Map();
    progress.total = cards.length;
    // The catalog's indexes, as Access builds them (fetchRanksTask): built on first use, one took about a second live.
    yield* labPrepareReferences(cards); yield* archetypeIndexTask(cards); yield* quoteIndexTask(cards); yield* listedIndexTask(cards); yield* ritualDeckTask(cards);
    yield* describeWordsTask(); const index = yield* describeIndexTask(), read = describeRead(raw);
    // The cards that fit each object asked (describeIntersects), ahead in slices too.
    for (const part of read.parts) {
      const qKey = part.spec && JSON.stringify(part.spec);
      if (!qKey || index.asked.has(qKey)) continue;
      const asked = [];
      for (const card of index.cards) { if (card.name && !card.rush && !card.custom && card.hidden != 1 && card.card_type !== 'Skill' && fetchRank(card, part.spec) < Infinity) asked.push(card); yield* fetchCheckpoint(); }
      index.asked.set(qKey, asked);
    }
    if (read.active) for (const card of cards) {
      if (card.name && !card.rush) found.set(card, describeRank(card, read));
      progress.done++; yield* fetchCheckpoint();
    }
    return { cards, size: cards.length, found };
  };
  // Summon Lab: which Fusion, Synchro, Xyz and Link Monsters chosen monsters can make, read from each
  // Extra Deck monster's material line. The line is parts joined by "+" ("1 Tuner + 1+ non-Tuner monsters");
  // a part may offer alternatives (""Red-Eyes Black Dragon" or 1 Dragon Effect Monster", "2+ Tuners or 1
  // Tuner Synchro Monster"). Each alternative has a count, a card-text phrase, checks on where the material
  // is ("in the hand": a Main Deck monster; "Special Summoned from the Extra Deck": an Extra Deck monster or
  // a Pendulum), rules over the materials it gets ("with the same Attribute but different Types") and, for
  // "Exactly these", what it must include ("2+ monsters, including a Link Monster"). Brackets share the
  // outer phrase: "2 monsters (Synchro and/or Xyz)", "4 Dragon monsters (1 Fusion, 1 Synchro, 1 Xyz, and
  // 1 Pendulum)". Heuristic, like the rest of the reading.
  // The catalog prints these as 0, but their unconditional text gives the actual Level/Rank.
  function labMaterial(card) {
    const entry = indexedText(card);
    if (entry.materialScale === undefined) entry.materialScale = Number(quoteText(card.effect).match(/This card's original (?:Level|Rank) is always treated as (\d+)/i)?.[1]) || 0;
    if (!entry.materialScale || Number(card.level) === entry.materialScale) return card;
    return entry.labMaterial ||= { ...card, level: entry.materialScale };
  }
  const labItemValue = item => item && typeof item === 'object' ? 'any=' + encodeURIComponent(JSON.stringify(item)) : String(item);
  function labGenericLabel(spec) {
    const range = (label, bounds) => !bounds ? '' : bounds[0] == null ? `${label} ${bounds[1]} or lower` : bounds[1] == null ? `${label} ${bounds[0]}+` : bounds[0] === bounds[1] ? `${label} ${bounds[0]}` : `${label} ${bounds[0]}–${bounds[1]}`;
    const words = [spec.where === 'hand' ? 'in-hand' : spec.where === 'field-down' ? 'face-down' : spec.where === 'field-up' ? 'face-up' : '',
      (spec.attributes || []).join('/'), range('Lv', spec.level), range('Link', spec.link).replace('Link ', 'Link-'),
      (spec.kinds || []).filter(kind => kind !== 'Link' || !spec.link).join('/'), (spec.types || []).join('/'), spec.archetype ? `“${spec.archetype}”` : '',
      spec.tuner === true ? 'Tuner' : spec.tuner === false ? 'non-Tuner' : '', range('ATK', spec.atk), range('DEF', spec.def)].filter(Boolean);
    return 'any ' + words.join(' ') + (words.length === 1 && spec.tuner === true ? '' : (words.length ? ' monster' : 'monster'));
  }
  function fitsGeneric(card, spec) {
    const color = String(card.monster_color), link = color.includes('Link');
    if (!fitsKind(card, { frames: spec.kinds || [] }) || typeof spec.tuner === 'boolean' && String(card.ability).includes('Tuner') !== spec.tuner) return false;
    if (spec.attributes?.length && !spec.attributes.includes(card.attribute) || spec.types?.length && !spec.types.includes(card.type)) return false;
    for (const key of ['level', 'link', 'atk', 'def']) if (spec[key]) {
      if (key === 'level' && link || key === 'link' && !link || key === 'def' && link) return false;
      const value = statValue(card[key === 'link' ? 'level' : key]), [min, max] = spec[key];
      if (value === null || min != null && value < min || max != null && value > max) return false;
    }
    if (spec.archetype && !indexedText(card).name.some(name => namePart(name, normalize(spec.archetype)))) return false;
    return !(spec.where === 'hand' && (extraDeckMonster(card) || color.includes('Token')) || spec.where === 'field-down' && (link || color.includes('Token')));
  }
  // Base equivalence classes omit identity and combat stats. Split those classes only for recipes
  // that read them. Filtering the spec happens first, so every representative is a real witness.
  let genericCatalog = null;
  // A cutoff is a third result, never an ordinary failed recipe.
  const LAB_NOT_EVALUATED = Symbol('Lab target not evaluated');
  const LAB_PAUSE = Symbol('Lab slice complete');
  let labWork = null, labSlice = null;
  // Synchronous callers drain the same iterator; Find resumes it in browser tasks.
  function labDrain(iterator) {
    let step;
    do { step = iterator.next(); } while (!step.done);
    return step.value;
  }
  function* labCheckpoint(force = false) {
    if (labSlice && (force || (++labSlice.checks & 15) === 0) && performance.now() >= labSlice.deadline) {
      yield LAB_PAUSE;
    }
  }
  function labSpend() {
    // Backtracking safety only: 262,144 steps or 500 ms of active target work.
    // Pool preparation and time spent yielding do not consume this allowance.
    if (labWork && (++labWork.steps > 262144 || (labWork.steps & 31) === 0 && performance.now() >= labWork.deadline)) throw LAB_NOT_EVALUATED;
  }
  const genericPool = item => labDrain(genericPoolTask(item));
  function* genericPoolTask(item) {
    if (item.pool) return item.pool;
    const cards = window.Cards || [];
    if (genericCatalog?.cards !== cards || genericCatalog.size !== cards.length) genericCatalog = { cards, size: cards.length, pools: new Map() };
    const specKey = JSON.stringify(item.generic);
    if (genericCatalog.pools.has(specKey)) return item.pool = genericCatalog.pools.get(specKey);
    const groups = new Map(), names = new Map();
    let scanned = 0;
    for (const raw of window.Cards || []) {
      if ((++scanned & 7) === 0) yield* labCheckpoint();
      if (raw.card_type !== 'Monster' || raw.rush || raw.custom) continue;
      const base = labMaterial(raw), card = item.generic.where ? { ...base, labWhere: item.generic.where } : base;
      if (!fitsGeneric(card, item.generic)) continue;
      const key = JSON.stringify([card.attribute, card.type, card.level, card.monster_color, card.ability, !!card.flip, !!card.pendulum, card.is_effect]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
      for (const name of indexedText(base).name) { if (!names.has(name)) names.set(name, []); names.get(name).push(card); }
    }
    item.pool = { groups: [...groups.values()], names, named: new Map(), fitting: new Map() };
    if (genericCatalog.pools.size >= 24) genericCatalog.pools.delete(genericCatalog.pools.keys().next().value);
    genericCatalog.pools.set(specKey, item.pool);
    return item.pool;
  }
  function* genericCandidates(item, recipe, option, allows, have, last, need, totalAllows) {
    if (item.generic.where && item.generic.where !== 'field-up' && recipe.kind !== 'Fusion' && recipe.kind !== 'Procedure') return;
    const pool = genericPool(item), required = need !== undefined ? need : last ? option.including.find(piece => !includedMaterials([piece], have)) : null;
    const inclusions = need !== undefined ? (need ? [need] : []) : includedMaterials(option.including, have) ? [] : option.including;
    const fitKey = JSON.stringify([recipe.kind, recipe.difference, recipe.sameLevel, option.text, last, required?.text, need !== undefined, inclusions.length]);
    const witnesses = function* (view) {
      for (let i = 0; ; i++) {
        labSpend();
        yield* labCheckpoint();
        if (i === view.groups.length) {
          if (view.done) return;
          let next = view.next.next();
          while (!next.done && next.value === LAB_PAUSE) {
            yield LAB_PAUSE;
            labSpend();
            next = view.next.next();
          }
          if (next.done) { view.done = true; return; }
          view.groups.push(next.value);
        }
        const group = view.groups[i];
        if (totalAllows && !totalAllows(group[0])) continue;
        for (const card of option.group?.different.includes('name') ? group : [group[0]]) {
          labSpend();
          yield* labCheckpoint();
          if (allows(card)) { yield card; if (last || !option.group?.different.includes('name')) break; }
        }
      }
    };
    if (pool.fitting.has(fitKey)) { yield* witnesses(pool.fitting.get(fitKey)); return; }
    const refs = option.phrase?.refs?.length ? option.phrase.refs : required?.phrase?.refs;
    let groups = pool.groups;
    if (refs?.length && refs.every(ref => ref.mode === 'exact' || ref.mode === 'archetype')) {
      const key = JSON.stringify(refs);
      if (!pool.named.has(key)) {
        const named = new Set();
        for (const ref of refs) {
          if (ref.mode === 'exact') for (const card of pool.names.get(ref.name) || []) named.add(card);
          else for (const [name, cards] of pool.names) {
            yield* labCheckpoint();
            if (name.includes(ref.name)) for (const card of cards) named.add(card);
          }
        }
        pool.named.set(key, [...named].map(card => [card]));
      }
      groups = pool.named.get(key);
    }
    const detailed = [...materialFields(recipe, [option])].some(field => LAB_DETAIL_FIELDS.includes(field));
    const sourceGroups = groups;
    // Split only the base classes actually visited. Building a complete name or
    // inclusion view for every target used to dominate first-use catalog queries.
    groups = (function* () {
      for (const group of sourceGroups) {
        yield* labCheckpoint();
        if (detailed) { for (const card of group) { yield* labCheckpoint(); yield [card]; } }
        else if (!inclusions.length) yield group;
        else {
          if (!fitsMaterial(group[0], option)) continue;
          const split = new Map();
          for (const card of group) {
            yield* labCheckpoint();
            const key = inclusions.map(piece => fitsMaterial(card, piece) ? '1' : '0').join('');
            if (!split.has(key)) split.set(key, []);
            split.get(key).push(card);
          }
          yield* split.values();
        }
      }
    })();
    const matching = function* () {
      const equivalent = new Set();
      for (const group of groups) {
        if (group === LAB_PAUSE) { yield LAB_PAUSE; continue; }
        yield* labCheckpoint();
        const card = group[0];
        if (!fitsMaterial(card, option)) continue;
        // Once the clause has been checked, its descriptive fields no longer
        // distinguish choices. Retain only totals, group rules and inclusion fits.
        const key = JSON.stringify([
          recipe.kind === 'Link' ? (String(card.monster_color).includes('Link') ? Number(card.level) || 1 : 1) :
            recipe.kind === 'Synchro' || recipe.difference || recipe.sameLevel ? (/Xyz|Link/.test(String(card.monster_color)) ? null : Number(card.level) || 0) : null,
          ...(option.group ? [...option.group.same, ...option.group.different.filter(field => field !== 'name')].map(field => groupValue(card, field)) : []),
          ...inclusions.map(piece => fitsMaterial(card, piece))
        ]);
        if (option.group?.different.includes('name')) yield group;
        else if (!equivalent.has(key)) { equivalent.add(key); yield [card]; }
      }
    };
    const view = { groups: [], next: matching(), done: false };
    pool.fitting.set(fitKey, view);
    yield* witnesses(view);
  }
  // The card fields a recipe's checks read. Pools group monsters by Attribute, Type, Level, frame and
  // abilities; a recipe that reads anything else (names, ATK/DEF, text) has to try each card.
  const LAB_DETAIL_FIELDS = ['name', 'normal', 'atk', 'def', 'scale', 'effect', 'pendulum_effect'];
  function materialFields(recipe, pieces) {
    const fields = new Set();
    if (recipe.kind === 'Synchro' || recipe.difference || recipe.sameLevel) fields.add('materialLevel');
    if (recipe.kind === 'Link') fields.add('contribution');
    const readPhrase = phrase => {
      if (!phrase) return;
      if (phrase.attributes?.length) fields.add('attribute');
      if (phrase.types?.length) fields.add('type');
      if (phrase.tuner || phrase.abilities?.length) { fields.add('ability'); fields.add('flip'); }
      if (phrase.frames?.length || phrase.refs?.some(ref => ref.frames?.length)) { fields.add('monster_color'); fields.add('pendulum'); fields.add('is_effect'); }
      for (const key of Object.keys(phrase.stats || {})) fields.add(key);
      for (const key of Object.keys(phrase.values || {})) fields.add(key);
      if (phrase.needs || phrase.scaleAlternatives || ['level', 'rank', 'link', 'def'].some(key => phrase.stats?.[key] || phrase.values?.[key])) { fields.add('level'); fields.add('monster_color'); }
      if (phrase.statAlternatives || phrase.relation) { fields.add('atk'); fields.add('def'); fields.add('monster_color'); }
      if (phrase.normal) { fields.add('normal'); fields.add('monster_color'); }
      if (phrase.deck) { fields.add('pendulum'); fields.add('monster_color'); }
      if (phrase.not?.length) for (const key of ['attribute', 'type', 'ability', 'flip', 'pendulum', 'is_effect', 'monster_color']) fields.add(key);
      if (phrase.textHas?.length || phrase.listed) { fields.add('effect'); fields.add('pendulum_effect'); fields.add('name'); }
      if (phrase.scaleParity) fields.add('scale');
      if (phrase.refs?.length || phrase.excluded?.length || phrase.numberRange) fields.add('name');
      for (const part of phrase.alternatives || []) readPhrase(part);
      for (const ref of phrase.refs || []) readPhrase(ref);
    };
    for (const piece of pieces) {
      readPhrase(piece.phrase);
      if (piece.excluded.length || piece.group?.same.includes('name')) fields.add('name');
      for (const field of [...(piece.group?.same || []), ...(piece.group?.different || [])]) if (field !== 'name') fields.add(field);
      // Field/face-up checks read only labWhere, which is fixed for the entire generic pool.
      if (piece.checks.some(check => check !== MATERIAL_PLACES[4][1] && check !== MATERIAL_PLACES[5][1])) {
        fields.add('level'); fields.add('monster_color'); fields.add('pendulum'); fields.add('normal');
      }
    }
    return fields;
  }
  const MATERIAL_PLACES = [
    [/,?\s*(?:you control,?\s*)?(?:that (?:was|were|is|are) )?Special Summoned from the Extra Deck\b|\bin (?:the|an) Extra Monster Zone\b/gi, card => card.labWhere !== 'hand' && (extraDeckMonster(card) || !!card.pendulum)],
    [/\bin (?:the|your) hand\b|,?\s*except on the field or in the GY\b/gi, card => (!card.labWhere || card.labWhere === 'hand') && !extraDeckMonster(card)],
    // "1 Normal Summoned/Set monster": one that can be Normal Summoned ("that cannot be Normal Summoned" is the phrase's).
    [/(?<!\bbe )\bNormal Summoned(?:\/Set)?\b/gi, card => !extraDeckMonster(card) && !summonRule(card).noNormal],
    [/\bface-down(?: Defense Position)?\b/gi, card => (!card.labWhere || card.labWhere === 'field-down') && !String(card.monster_color).includes('Link')],
    [/\bface-up\b/gi, card => !card.labWhere || card.labWhere === 'field-up'],
    [/\bon the field\b|\b(?:you|your opponent) controls?\b/gi, card => card.labWhere !== 'hand'],
  ];
  // Where else a material may be, and what no card text can rule out, changes nothing.
  const MATERIAL_NOISE = /\bface-up\b|\bSpecial Summoned this turn\b|\bon the field\b|\b(?:you|your opponent) controls?\b|\bin (?:your |your opponent's |the |either player's )?(?:GY|Graveyard)s?\b|\bequipped with (?:an?|\d+) [^,+]*?Cards?\b|\bthat (?:have|has) materials?\b|,?\s*except (?:a |an )?Tokens?\b/gi;
  // "with the same Type and Attribute, but different names", "with different Types and different
  // Attributes", "with the same Type or Attribute" (either one).
  const groupClause = /,?\s*\b(?:with|but)\s+(?:the same|different)\b[^,+()]*(?:,\s*but\s+(?:the same|different)\b[^,+()]*)?/gi;
  function groupRules(clause) {
    const rule = { same: [], different: [], any: false };
    let mode = '';
    for (const word of clause.toLowerCase().match(/\bsame\b|\bdifferent\b|\b(?:names?|types?|attributes?|levels?|ranks?)\b|\bor\b/g) || []) {
      if (word === 'same' || word === 'different') mode = word;
      else if (word === 'or') rule.any = mode === 'same';
      else if (mode) rule[mode].push(word.replace(/s$/, ''));
    }
    return rule.same.length || rule.different.length ? rule : null;
  }
  const groupValue = (card, field) => {
    const color = String(card.monster_color), scaleless = /Xyz|Link/.test(color);
    const value = field === 'name' ? card.name : field === 'level' ? (scaleless ? null : card.level) : field === 'rank' ? (color.includes('Xyz') ? card.level : null) : card[field];
    return value == null || value === '' ? null : String(value);
  };
  function groupFits(rule, cards) {
    if (!rule) return true;
    if (cards.some(card => [...rule.same, ...rule.different].some(field => groupValue(card, field) === null))) return false;
    const alike = field => new Set(cards.map(card => groupValue(card, field))).size <= 1;
    if (rule.same.length && !(rule.any ? rule.same.some(alike) : rule.same.every(alike))) return false;
    return rule.different.every(field => new Set(cards.map(card => groupValue(card, field))).size === cards.length);
  }
  function materialPiece(raw, names) {
    const checks = [], including = [], excluded = [];
    let group = null;
    let text = raw.replace(/\bwhose (?:original )?(Level|ATK|DEF) is\b/gi, '$1').replace(/\boriginal (?=(?:ATK|DEF|Levels?|Types?|Attributes?)\b)/gi, '')
      .replace(/\bwith (\d+|\?) ATK\s*(?:\/|&|and)\s*DEF\b/gi, 'with $1 ATK and $1 DEF')
      // "including a Ritual, Fusion, Synchro, or Xyz Monster" runs to the end or to ", except ...".
      .replace(/,?\s*including (?:at least )?(?:an? |1 |one )?(.+?)(?=,\s*(?:except|with|but)\b|$)/gi, (m, what) => {
        for (const item of what.split(/,\s*(?:and\s+)?(?=\d+\s)|\s+and\s+(?=\d+\s)/i))
          including.push(/^Tokens?$/i.test(item.trim()) ? { ...materialPiece('1 monster', names), checks: [card => String(card.monster_color).includes('Token')] } : materialPiece(/^\d+\s/.test(item.trim()) ? item.trim() : '1 ' + item, names));
        return ' ';
      })
      .replace(/,?\s*except (?:for )?(?:an? )?((?:"§\d+§"(?:\s+(?:monsters?|cards?))?(?:\s*,?\s*(?:or|and)\s*)?)+)/gi, (m, list) => {
        for (const ref of list.matchAll(/"§(\d+)§"(\s+(?:monsters?|cards?))?/gi)) excluded.push({ name: normalize(names[ref[1]]), mode: ref[2] ? 'archetype' : 'exact' });
        return ' ';
      })
      .replace(groupClause, clause => { group = groupRules(clause) || group; return ' '; });
    text = text.replace(/,?\s*except (?:a |an )?Tokens?\b/gi, () => { checks.push(card => !String(card.monster_color).includes('Token')); return ' '; });
    for (const [pattern, check] of MATERIAL_PLACES) text = text.replace(pattern, () => { if (!checks.includes(check)) checks.push(check); return ' '; });
    // "including a Level/Rank/Link 2 monster": whichever the monster has.
    text = text.replace(/\bLevel\/Rank\/Link (\d+)\b/gi, (m, n) => { checks.push(card => Number(card.level) === Number(n)); return ' '; }).replace(MATERIAL_NOISE, ' ');
    const count = text.match(/^\s*(\d+)\s*(?:x\s+)?(\+|\s+or more)?(?:\s*≤(\d+))?\s+/i);
    const min = count ? Number(count[1]) : 1, max = count?.[3] ? Number(count[3]) : count?.[2] ? Infinity : min;
    const phrase = fetchPhrase(count ? text.slice(count[0].length) : text, names);
    if (phrase?.normal === 'no') checks.push(card => extraDeckMonster(card) || summonRule(card).noNormal);
    if (phrase?.normal === 'yes') checks.push(card => !extraDeckMonster(card) && !summonRule(card).noNormal);
    // A stat can qualify a named card (Emperor Charles), or an archetype with no such card.
    if (phrase) for (const ref of phrase.refs) if (ref.mode === 'exact' && Object.keys(phrase.stats).length && !referenceWords?.exact.has(ref.name)) Object.assign(ref, { mode: 'archetype', ...kindsOf('monster') });
    const label = raw.replace(/"§(\d+)§"/g, (m, n) => `"${names[n]}"`).replace(/\s*≤(\d+)/, ' (max. $1)').replace(/^\s*\d+\s*(?:x\s+)?(?:\+|or more\b)?\s*(?:\(max\. \d+\)\s*)?/i, '').replace(/\s+/g, ' ').trim();
    return { min, max, phrase, checks, group, including, excluded, text: label,
      generic: !phrase && !checks.some(check => check !== MATERIAL_PLACES[4][1] && check !== MATERIAL_PLACES[5][1]) && !group && !excluded.length };
  }
  // Parts joined by "+" outside brackets.
  function splitMaterials(text) {
    const parts = [];
    let depth = 0, from = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++; else if (text[i] === ')') depth = Math.max(0, depth - 1);
      else if (!depth && text[i] === '+' && /\s/.test(text[i - 1] || '') && /\s/.test(text[i + 1] || '')) { parts.push(text.slice(from, i).trim()); from = i + 1; }
    }
    parts.push(text.slice(from).trim());
    return parts.filter(Boolean);
  }
  // "2 monsters (Synchro and/or Xyz)" reads as "2 Synchro or Xyz Monsters"; "2 Level 5 or higher monsters
  // (1 Fusion + 1 Synchro)" as two parts, "1 Level 5 or higher Fusion Monster" and "1 ... Synchro Monster".
  function expandBrackets(part) {
    const match = part.match(/\s*\(([^()]*)\)/);
    if (!match) return [part];
    const before = part.slice(0, match.index), after = part.slice(match.index + match[0].length), inner = match[1].trim();
    const noun = [...before.matchAll(/\b(?:monsters?|Monsters?)\b/g)].pop();
    if (!noun) return expandBrackets(before + after);
    // Frames go next to the noun ("Synchro or Xyz Monsters"), Types and Attributes after the count.
    const insert = raw => {
      const words = raw.replace(/\s+(?:monsters?|Monsters?)$/, '');
      if (FRAMES.some(frame => new RegExp(`\\b${frame}\\b`).test(words)))
        return before.slice(0, noun.index) + words + ' ' + noun[0].replace(/^m/, 'M') + before.slice(noun.index + noun[0].length) + after;
      const count = before.match(/^\s*\d+\s*(?:x\s+)?(?:\+|\s+or more)?(?:\s*≤\d+)?\s+/i)?.[0] || '';
      return count + words + ' ' + before.slice(count.length) + after;
    };
    if (!/^\d/.test(inner)) return expandBrackets(insert(inner.replace(/\s*\band\/or\b\s*/gi, ' or ')));
    return inner.split(/\s*(?:,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+\+\s+)\s*/).filter(Boolean).flatMap(item => {
      const own = item.match(/^(\d+)\s+(.*)$/);
      return own ? expandBrackets(insert(own[2]).replace(/^\s*\d+\s*(?:\+|\s+or more)?\s+/i, `${own[1]} `)) : [];
    });
  }
  // The material line: the first line, without a leading "(This card's original Level is always treated
  // as 1.)" and without a next sentence glued on ("1 Tuner + 1+ non-TunersIf this card is ...").
  function materialLine(card) {
    const lines = quoteText(card.effect).split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^\(.*\)$/.test(line));
    return (lines[0] || '').replace(/(?<=[a-z])(?:If|When|You|Once|Must|Cannot|This|During|Each|While|Gains|Your)\b[^]*$/, '').trim();
  }
  function materialParts(text, names) {
    return splitMaterials(text).flatMap(expandBrackets).map(part => ({
      options: part.split(/(?<!\b(?:Levels?|Ranks?|Link)[ -]?\d+)\s+or\s+(?=\d+\+?\s+(?!ATK|DEF))/i).map(option => materialPiece(option, names)),
    }));
  }
  // Procedures printed on the target are separate recipes. Protect quoted names before finding
  // sentences ("N.As.Ch. Knight"), and leave timing/effect conditions outside the material phrase.
  function alternativeRecipes(card) {
    if (!/\bMust be either\b|\bYou can also Xyz Summon this card by using\b/i.test(card.effect)) return [];
    const names = [], text = quoteText(card.effect).replace(/"([^"\n]{1,80})"/g, (m, name) => `"§${names.push(name) - 1}§"`), recipes = [];
    // Whole sentences, with a leading condition ("During the turn …, you can also Xyz Summon …").
    const sentences = text.match(/[^.\n]*?\b(?:Must be either \w+ Summoned, or Special Summoned|You can also Xyz Summon this card by using)\b[^.\n]*\.?/gi) || [];
    for (const sentence of sentences) {
      const xyz = /\bYou can also Xyz/i.test(sentence);
      const match = xyz ? sentence.match(/by using (.+)/i) : sentence.match(/\bby (?:Tributing|banishing|sending|shuffling|returning) (.+)/i);
      if (!match || /\bthe above (?:cards|monsters)\b/i.test(match[1])) continue;
      // "from your face-up field and/or GY": the field part stays face-up (Black-Winged Assault Dragon).
      const faceUp = /\bface-up field\b/i.test(match[1]);
      let materials = match[1].replace(/\([^()]*\)/g, ' ')
        // 'a monster you control whose original name is "X"' is that card itself, not its archetype (Shatter Stream).
        .replace(/\b(?:an?|1) monster you control whose original name is\s*("§\d+§")/gi, '1 $1 you control')
        .replace(/,?\s*\b(?:during the turn|while you have|and cannot be Special Summoned)\b[^]*$/i, '')
        .replace(/\bas (?:the )?(?:Xyz )?materials?\b/gi, '')
        .replace(/\bother than\b/gi, 'except')
        .replace(/\bthat has no materials?\b|\bwith \d+ or more materials?\b|\bwith the highest ATK\b/gi, '')
        .replace(/\bwhose original name is\s*/gi, '')
        .replace(/\bequipped with\s+"§\d+§"/gi, '')
        .replace(/\bfrom (?:the|your) hand\b/gi, 'in your hand')
        .replace(/\bfrom (?:your )?(?:face-up )?field(?: and\/or (?:GY|Graveyard))?\b/gi, '')
        .replace(/\bfrom any Monster Zones\b|\bon either field\b/gi, '')
        .replace(/\b(?:to|into) (?:the|your) (?:GY|Graveyard|Deck|Extra Deck|hand)\b/gi, '')
        .replace(/[.,\s]+$/, '').trim();
      // Materials from the GY or the Spell & Trap Zone have no place in the Lab (docs/summon-lab-design.md).
      if (!materials || !/^(?:\d+\s|an?\s|"§)/i.test(materials) || /\b(?:GY|Graveyard|Spell & Trap Zone)\b/i.test(materials)) continue;
      if (xyz) materials = materials.replace(/^an?\s+/i, '1 ');
      else materials = materials.replace(/\s+and\s+(?=\d+\s)/gi, ' + ');
      const parts = xyz ? [{ options: [materialPiece(materials, names)] }] : materialParts(materials, names);
      // Unspecified places mean the field. An explicit hand part keeps its own place check.
      for (const part of parts) for (const piece of part.options)
        if (!piece.checks.includes(MATERIAL_PLACES[1][1])) {
          if (!piece.checks.includes(MATERIAL_PLACES[5][1])) piece.checks.push(MATERIAL_PLACES[5][1]);
          if (faceUp && !piece.checks.includes(MATERIAL_PLACES[4][1])) piece.checks.push(MATERIAL_PLACES[4][1]);
        }
      // Shown in the breakdown with its conditions, which the Lab does not check (timing, other cards).
      const shown = sentence.replace(/\s*\(in which case[^()]*\)/gi, '').replace(/,?\s*and cannot be Special Summoned[^]*$/i, '')
        .replace(/"§(\d+)§"/g, (m, n) => `"${names[n]}"`).replace(/\s+/g, ' ').trim();
      const procedure = shown.length > 220 ? shown.slice(0, 219) + '…' : shown;
      recipes.push({ kind: xyz ? 'Xyz' : 'Procedure', parts, level: Number(card.level) || 0, difference: 0, sameLevel: false, procedure });
    }
    return recipes;
  }
  function materialRecipe(card) {
    const entry = indexedText(card);
    if (entry.recipe !== undefined) return entry.recipe;
    const kind = card.card_type === 'Monster' && ['Fusion', 'Synchro', 'Xyz', 'Link'].find(frame => String(card.monster_color).includes(frame));
    const alternatives = kind ? alternativeRecipes(card) : [];
    const line = kind ? materialLine(card) : '', names = [];
    let text = line.replace(/\(s\)/g, 's').replace(/"([^"\n]{1,80})"/g, (m, name) => `"§${names.push(name) - 1}§"`);
    // "Cannot be Synchro Summoned. Must be Special Summoned (from your Extra Deck) by sending 2 monsters you
    // control with a Level difference of 7 to the GY (1 Tuner and 1 non-Tuner)": materials by a difference.
    const procedure = text.match(/\bMust be Special Summoned \(from your Extra Deck\) by sending (\d+) monsters you control with a Level difference of (\d+) to the GY \(([^()]+)\)/i);
    const equalLevels = text.match(/\bMust be Special Summoned \(from your Extra Deck\) by sending (\d+) (Level \d+ or higher monsters) you control with the same Level to the (?:GY|Graveyard) \(([^()]+)\)/i);
    const fusionProcedure = text.match(/^Must be Fusion Summoned using any (\d+) (.+?), and cannot be Special Summoned/i);
    if (procedure) text = `${procedure[1]} monsters (${procedure[3]})`;
    else if (equalLevels) text = `${equalLevels[1]} ${equalLevels[2]} (${equalLevels[3]})`;
    else if (fusionProcedure) text = `${fusionProcedure[1]} ${fusionProcedure[2]}`;
    else if (!kind || !line || line.length > 240 || !/^(?:\d+\+?\s|"|\d+ or more\s)/.test(line)) {
      const first = alternatives.shift();
      return entry.recipe = first ? { ...first, alternatives } : null;
    }
    text = resolveMentions(text.replace(/\s*\(max\.?\s*(\d+)\)/gi, ' ≤$1').replace(/\s*\(or ([^()]*)\)/gi, ' or $1'));
    const parts = materialParts(text, names);
    return entry.recipe = { kind, parts, level: Number(card.level) || 0, difference: procedure ? Number(procedure[2]) : 0, sameLevel: !!equalLevels, alternatives };
  }
  // Quoted names across the catalog: which cards quote a name, and which card has it.
  let quoteIndex = null;
  function* quoteIndexTask(cards) {
    if (quoteIndex?.cards === cards && quoteIndex.size === cards.length) return;
    const by = new Map(), named = new Map();
    for (const other of cards) {
      yield* fetchCheckpoint();
      if (other.rush || !other.name) continue;
      if (!named.has(normalize(other.name))) named.set(normalize(other.name), other);
      for (const match of quoteText(other.effect + '\n' + other.pendulum_effect).matchAll(/"([^"\n]{2,80})"/g)) { const key = normalize(match[1]); if (!by.has(key)) by.set(key, new Set()); by.get(key).add(other); }
    }
    quoteIndex = { cards, size: cards.length, by, named };
  }
  function quotes() {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (quoteIndex?.cards !== cards || quoteIndex.size !== cards.length) labDrain(quoteIndexTask(cards));
    return quoteIndex;
  }
  // The other cards whose text quotes the card's name ("whose name is mentioned on that Ritual Spell").
  const quotedBy = (card, names) => [...new Set(names.flatMap(name => [...(quotes().by.get(name) || [])]))].filter(other => other.name !== card.name);
  // 'mentions an "Elemental HERO" monster's card name': the card quotes the name of a card of that archetype and kind,
  // other than its own printed name ("treated as a Toon monster while "Toon World" is on the field" still mentions it).
  const quotesMember = (card, ref) => (indexedText(card).mentioned ||= [...new Set([...quoteText(card.effect + '\n' + card.pendulum_effect).matchAll(/"([^"\n]{2,80})"/g)].map(m => normalize(m[1])))].filter(name => name !== normalize(card.name))).some(name => {
    const other = quotes().named.get(name);
    return !!other && indexedText(other).name.some(own => EMBEDDED_ARCHETYPES.has(ref.name) ? own.includes(ref.name) : namePart(own, ref.name)) && fitsKind(other, ref);
  });
  // The Extra Deck monsters whose material line names the card ('"Medius the Pure" + 1 "Artmage" monster').
  let listedIndex = null;
  function* listedIndexTask(cards) {
    if (listedIndex?.cards === cards && listedIndex.size === cards.length) return;
    const map = new Map();
    for (const other of cards) {
      yield* fetchCheckpoint();
      const recipe = !other.rush && materialRecipe(other);
      if (!recipe) continue;
      for (const piece of [recipe, ...recipe.alternatives].flatMap(recipe => recipe.parts.flatMap(part => part.options.flatMap(option => [option, ...option.including]))))
        for (const ref of piece.phrase?.refs || []) if (ref.mode === 'exact') { if (!map.has(ref.name)) map.set(ref.name, new Set()); map.get(ref.name).add(other); }
    }
    listedIndex = { cards, size: cards.length, map };
  }
  function listedBy(card) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (card.card_type !== 'Monster') return [];
    if (listedIndex?.cards !== cards || listedIndex.size !== cards.length) labDrain(listedIndexTask(cards));
    return [...new Set(indexedText(card).name.flatMap(name => [...(listedIndex.map.get(name) || [])]))];
  }
  function fitsMaterial(card, piece) {
    if (card.card_type !== 'Monster' || piece.phrase && !fitsPhrase(card, piece.phrase)) return false;
    const own = indexedText(card).name;
    if (piece.excluded.some(ref => ref.mode === 'exact' ? own.includes(ref.name) : own.some(name => namePart(name, ref.name)))) return false;
    return piece.checks.every(check => check(card));
  }
  // Exactly these materials ("exact"), or these among others ("includes"). Each material goes to one part,
  // a part uses one of its alternatives, and an alternative's rules hold over the materials it gets; with
  // "exact", every part also gets its minimum and what it must include. Returns, per part, the alternative
  // and its materials, or null.
  function includedMaterials(pieces, materials) {
    const needs = pieces.flatMap(piece => Array(piece.min).fill(piece)), used = new Set();
    const place = i => {
      labSpend();
      if (i === needs.length) return true;
      for (let k = 0; k < materials.length; k++) if (!used.has(k) && fitsMaterial(materials[k], needs[i])) {
        used.add(k); if (place(i + 1)) return true; used.delete(k);
      }
      return false;
    };
    return place(0);
  }
  const assignMaterials = (recipe, materials, exact) => labDrain(assignMaterialsTask(recipe, materials, exact));
  function* assignMaterialsTask(recipe, materials, exact) {
    const items = materials, order = materials.map((m, i) => i).sort((a, b) => !!items[a].generic - !!items[b].generic);
    materials = materials.slice();
    const parts = recipe.parts, chosen = parts.map(() => -1), groups = parts.map(() => []);
    if (exact && materials.length < parts.reduce((sum, part) => sum + Math.min(...part.options.map(option => option.min)), 0) ||
      materials.length > parts.reduce((sum, part) => sum + Math.max(...part.options.map(option => option.max)), 0)) return null;
    if (recipe.kind === 'Link' && items.length > recipe.level) return null;
    const hasGeneric = items.some(item => item.generic);
    // Numeric feasibility is independent of identity: a pool with no Link Monsters
    // cannot make Link-4 from two slots, however many differently named cards it has.
    if (hasGeneric && (recipe.kind === 'Link' || recipe.kind === 'Synchro') && !recipe.difference && !recipe.sameLevel) {
      let sums = new Set([0]);
      for (const item of items) {
        let values;
        if (item.generic) {
          const pool = genericPool(item), cache = pool.totals ||= new Map();
          if (!cache.has(recipe.kind)) {
            const set = new Set();
            for (const group of pool.groups) {
              yield* labCheckpoint();
              const m = group[0], color = String(m.monster_color);
              if (recipe.kind === 'Link') { set.add(1); if (color.includes('Link')) set.add(Number(m.level) || 1); }
              else if (!/Xyz|Link/.test(color)) set.add(Number(m.level) || 0);
            }
            cache.set(recipe.kind, [...set]);
          }
          values = cache.get(recipe.kind);
        } else values = recipe.kind === 'Link' ? [1, ...(String(item.monster_color).includes('Link') ? [Number(item.level) || 1] : [])] : /Xyz|Link/.test(String(item.monster_color)) ? [] : [Number(item.level) || 0];
        const next = new Set();
        for (const sum of sums) for (const value of values) if (sum + value <= recipe.level) next.add(sum + value);
        sums = next;
      }
      if (!sums.size || exact && !sums.has(recipe.level)) return null;
    }
    const canFit = function* (item, option, piece = null) {
      if (!item.generic) return fitsMaterial(item, option) && (!piece || fitsMaterial(item, piece));
      const pool = genericPool(item), key = JSON.stringify([recipe.kind, recipe.level, recipe.difference, recipe.sameLevel, option.text, piece?.text, piece?.checks.map(String)]);
      const cache = pool.possible ||= new Map();
      if (!cache.has(key)) {
        const candidates = genericCandidates(item, recipe, option,
          candidate => materialTotalsFit(recipe, [candidate], false) && (!piece || fitsMaterial(candidate, piece)), [], true, piece);
        let next = candidates.next();
        while (!next.done && next.value === LAB_PAUSE) { yield LAB_PAUSE; next = candidates.next(); }
        cache.set(key, !next.done);
      }
      return cache.get(key);
    };
    const fits = [];
    for (const material of materials) {
      const row = [];
      for (const part of parts) {
        const options = [];
        for (const option of part.options) options.push(yield* canFit(material, option));
        row.push(options);
      }
      fits.push(row);
    }
    if (fits.some(row => !row.some(options => options.some(Boolean)))) return null;
    if (exact) for (let k = 0; k < parts.length; k++) {
      let possible = false;
      for (let o = 0; o < parts[k].options.length; o++) {
        const option = parts[k].options[o];
        if (fits.filter(row => row[k][o]).length < option.min) continue;
        // Necessary inclusion capacity rejects absent Tokens/names/Tuners early.
        let includes = true;
        if (hasGeneric) for (const piece of option.including) {
          let count = 0;
          for (const item of items) if (yield* canFit(item, option, piece)) count++;
          if (count < piece.min) { includes = false; break; }
        }
        if (includes) { possible = true; break; }
      }
      if (!possible) return null;
    }
    const failed = new Set();
    const stateKey = i => {
      const previous = order.slice(0, i).map(j => materials[j]);
      const totals = recipe.kind === 'Link' ? previous.map(m => String(m.monster_color).includes('Link') ? Number(m.level) || 1 : 1).sort((a,b) => a-b) :
        recipe.difference || recipe.sameLevel ? previous.map(m => Number(m.level) || 0).sort((a,b) => a-b) :
        recipe.kind === 'Synchro' ? previous.reduce((sum,m) => sum + (Number(m.level) || 0), 0) : 0;
      return JSON.stringify([i, totals, groups.map((group,k) => {
        const option = parts[k].options[chosen[k]];
        return [chosen[k], group.length, option && group.map(m => [
          ...(option.group ? [...option.group.same, ...option.group.different].map(field => groupValue(m, field)) : []),
          ...option.including.map(piece => fitsMaterial(m, piece))]).map(row => JSON.stringify(row)).sort()];
      })]);
    };
    const complete = () => {
      if (!materialTotalsFit(recipe, materials, exact)) return false;
      if (!parts.every((part, k) => {
        if (!groups[k].length) return !exact;
        const option = part.options[chosen[k]];
        return exact ? groups[k].length >= option.min && includedMaterials(option.including, groups[k])
          : groups[k].length < option.max || includedMaterials(option.including, groups[k]);
      })) return false;
      if (exact) return true;
      // A partial assignment still needs room for its missing materials. Each new material has
      // at least Level 1 / Link contribution 1; a filled fixed-count part cannot take another.
      const options = parts.map((part, k) => chosen[k] < 0 ? part.options : [part.options[chosen[k]]]);
      const missing = options.reduce((sum, choices, k) => sum + Math.min(...choices.map(option => Math.max(0, option.min - groups[k].length))), 0);
      const capacity = options.reduce((sum, choices, k) => sum + Math.max(...choices.map(option => option.max - groups[k].length)), 0);
      if (recipe.kind === 'Synchro' && !recipe.difference && !recipe.sameLevel) {
        const gap = recipe.level - materials.reduce((sum, material) => sum + (Number(material.level) || 0), 0);
        if (gap < missing || gap > 0 && !capacity) return false;
      }
      if (recipe.kind === 'Link') {
        let sums = new Set([0]);
        for (const material of materials) sums = new Set([...sums].flatMap(sum => String(material.monster_color).includes('Link') ? [sum + 1, sum + (Number(material.level) || 1)] : [sum + 1]));
        if (![...sums].some(sum => sum + missing <= recipe.level && (sum === recipe.level || capacity > 0))) return false;
      }
      return true;
    };
    const place = function* (i) {
      yield* labCheckpoint();
      if (i === materials.length) return complete();
      const state = hasGeneric ? stateKey(i) : null;
      if (state !== null && failed.has(state)) return false;
      const index = order[i], item = items[index];
      for (let k = 0; k < parts.length; k++) for (let o = 0; o < parts[k].options.length; o++) {
        const option = parts[k].options[o];
        if (chosen[k] >= 0 && chosen[k] !== o || !fits[index][k][o] || groups[k].length >= option.max) continue;
        if (exact && parts.reduce((sum, part, j) => sum + Math.max(0, (j === k ? option.min : chosen[j] < 0 ? Math.min(...part.options.map(p => p.min)) : part.options[chosen[j]].min) - groups[j].length - (j === k ? 1 : 0)), 0) > items.length - i - 1) continue;
        const fresh = chosen[k] < 0;
        const previous = order.slice(0, i).map(j => materials[j]);
        const totalAllows = candidate => materialTotalsFit(recipe, [...previous, candidate], exact && i + 1 === items.length);
        const allows = candidate => groupFits(option.group, [...groups[k], candidate]);
        const candidates = function* () {
          if (!item.generic) { yield item; return; }
          const last = i + 1 === items.length;
          // Try an unmet inclusion first; still try every other witness if it
          // cannot work here (another slot may be the one that supplies it).
          const need = !last && option.including.find(piece => !includedMaterials([piece], groups[k]));
          if (need) yield* genericCandidates(item, recipe, option, candidate => allows(candidate) && fitsMaterial(candidate, need), groups[k], false, need, totalAllows);
          yield* genericCandidates(item, recipe, option, allows, groups[k], last, undefined, totalAllows);
        };
        for (const candidate of candidates()) {
          if (candidate === LAB_PAUSE) { yield LAB_PAUSE; continue; }
          materials[index] = candidate;
          chosen[k] = o; groups[k].push(candidate);
          const partial = order.slice(0, i + 1).map(j => materials[j]);
          if (groupFits(option.group, groups[k]) && materialTotalsFit(recipe, partial, false) && (yield* place(i + 1))) return true;
          groups[k].pop(); if (fresh) chosen[k] = -1;
        }
      }
      if (state !== null) failed.add(state);
      return false;
    };
    if (!(yield* place(0))) return null;
    const used = parts.map((part, k) => ({ option: part.options[Math.max(0, chosen[k])], materials: groups[k] }));
    used.witnesses = materials;
    used.recipe = recipe;
    return used;
  }
  // 0: the recipe names a chosen card, 1: its archetype, 2: other conditions, 3: any monster; Infinity: cannot.
  const pieceRank = piece => piece.generic ? 3 : piece.phrase?.refs?.some(ref => ref.mode === 'exact') ? 0 : piece.phrase?.refs?.length ? 1 : 2;
  function materialTotalsFit(recipe, materials, exact) {
    const color = m => String(m.monster_color);
    if (recipe.difference) {
      // Two monsters whose Levels differ by the given amount.
      if (materials.some(m => /Xyz|Link/.test(color(m)))) return false;
      if (materials.length === 2 && Math.abs((Number(materials[0].level) || 0) - (Number(materials[1].level) || 0)) !== recipe.difference) return false;
    } else if (recipe.sameLevel) {
      if (materials.some(m => /Xyz|Link/.test(color(m))) || new Set(materials.map(m => Number(m.level))).size > 1) return false;
    } else if (recipe.kind === 'Synchro') {
      // A Synchro's materials have Levels that add up to its Level.
      if (materials.some(m => /Xyz|Link/.test(color(m)))) return false;
      const sum = materials.reduce((total, m) => total + (Number(m.level) || 0), 0), level = recipe.level;
      if (exact ? sum !== level : sum > level) return false;
    }
    if (recipe.kind === 'Link') {
      // Each material counts 1; a Link Monster may count as its Link Rating.
      let sums = new Set([0]);
      for (const m of materials) { const next = new Set(); for (const sum of sums) { next.add(sum + 1); if (/Link/.test(color(m))) next.add(sum + (Number(m.level) || 1)); } sums = next; }
      const rating = recipe.level;
      if (exact ? !sums.has(rating) : Math.min(...sums) > rating) return false;
    }
    return true;
  }
  const labMatch = (card, lab) => labDrain(labMatchTask(card, lab));
  function* labMatchTask(card, lab) {
    if (!lab?.materials.length || !extraDeckMonster(card)) return null;
    const cache = (lab.matches ||= { exact: new Map(), includes: new Map() })[lab.mode];
    if (cache.has(card)) return cache.get(card);
    const bounded = lab.materials.some(item => item.generic);
    const skipped = () => { (lab.notEvaluated ||= new Set()).add(card); return LAB_NOT_EVALUATED; };
    let used = null;
    try {
      const recipe = materialRecipe(card);
      if (recipe) {
        const materials = lab.materials.map(item => item.generic ? item : labMaterial(item)), exact = lab.mode !== 'includes';
        // Pool construction is shared setup, not combinatorial target work.
        if (bounded) for (const item of materials) if (item.generic) yield* genericPoolTask(item);
        if (bounded) labWork = { steps: 0, deadline: performance.now() + 500 };
        let rank = Infinity;
        for (const candidate of [recipe, ...recipe.alternatives]) {
          // An alternative whose every part ranks no better cannot replace the earlier match.
          if (rank < Infinity && candidate.parts.every(part => part.options.every(option => pieceRank(option) >= rank))) continue;
          const match = bounded || materialTotalsFit(candidate, materials, exact) ? yield* assignMaterialsTask(candidate, materials, exact) : null;
          const nextRank = match ? Math.min(...match.filter(item => item.materials.length).map(item => pieceRank(item.option))) : Infinity;
          if (nextRank < rank) { used = match; rank = nextRank; }
          if (rank === 0) break; // Nothing can beat an exact named material; the first recipe wins ties.
        }
      }
    } catch (error) {
      if (error !== LAB_NOT_EVALUATED) throw error;
      used = skipped();
    } finally {
      labWork = null;
    }
    cache.set(card, used);
    return used;
  }
  function labRank(card, lab) {
    if (lab?.ranks?.has(card)) return lab.ranks.get(card);
    const used = labMatch(card, lab);
    if (used === LAB_NOT_EVALUATED) return Infinity;
    return used ? Math.min(...used.filter(item => item.materials.length).map(item => pieceRank(item.option))) : Infinity;
  }
  // What a "These + others" recipe still needs, as text and as a search for cards that fill it; the rules
  // over a part's materials narrow the search ("with the same Attribute" as the chosen one).
  function labNeeds(card, lab) {
    if (lab?.notEvaluated?.has(card)) return { notEvaluated: true, text: 'not evaluated within the search limit', request: null };
    const used = lab?.mode === 'includes' && labRank(card, lab) < Infinity ? labMatch(card, lab) : null;
    return used ? recipeNeeds(card, used) : null;
  }
  // used: an assignment of concrete materials (its witnesses) to the recipe's parts.
  function recipeNeeds(card, used) {
    const recipe = used.recipe, materials = used.witnesses;
    if (materialTotalsFit(recipe, materials, true) && assignMaterials(recipe, materials, true)) return { text: 'nothing more', request: null };
    const missing = used.map(item => ({ ...item, count: Math.max(0, item.option.min - item.materials.length) })).filter(item => item.count);
    const word = item => item.option.generic ? 'monster' : item.option.phrase?.refs?.length === 1 && item.option.phrase.refs[0].mode === 'exact' ? `“${item.option.phrase.refs[0].label}”` : 'card';
    let text = missing.map(item => `${item.count}${item.option.max > item.option.min ? ' or more' : ' ×'} ${item.option.text}`).join(' + '), level = null;
    if (recipe.kind === 'Synchro' && !recipe.difference && !recipe.sameLevel) {
      const gap = (Number(card.level) || 0) - materials.reduce((total, m) => total + (Number(m.level) || 0), 0);
      const pieces = missing.reduce((total, item) => total + item.count, 0);
      if (gap > 0 && pieces <= 1) level = String(gap);
      text = (text || 'more non-Tuner monsters') + (gap > 0 ? ` (Levels adding up to ${gap})` : '');
    }
    if (recipe.sameLevel && missing.length) {
      level = String(materials[0].level);
      text += ` (Level ${level})`;
    }
    if (recipe.kind === 'Link') {
      const rating = Number(card.level) || 0, more = Math.max(0, rating - materials.length);
      if (!missing.length && more) text = `${more} more monster${more > 1 ? 's' : ''} (or a Link Monster)`;
    }
    if (!text) return { text: 'nothing more', request: null };
    const first = missing[0], piece = first?.option, phrase = piece?.phrase;
    const request = phrase ? requestFromPhrase(phrase, phrase.refs?.length === 1 ? phrase.refs[0] : null, first.option.text) : { cardTypes: ['Monster'], not: {} };
    request.not = { attribute: [], type: [], monster_color: [], ability: [], ...request.not };
    if (level) request.stats = { ...(request.stats || {}), level: [level, level] };
    if (recipe.kind === 'Synchro' && level) request.not.monster_color = [...new Set([...request.not.monster_color, 'Xyz', 'Link'])];
    const have = first?.materials || [];
    if (piece?.group && have.length) {
      const { same, different } = piece.group, pick = field => groupValue(have[0], field);
      if (!piece.group.any && same.includes('attribute')) request.attributes = [pick('attribute')];
      if (!piece.group.any && same.includes('type')) request.types = [pick('type')];
      if (!piece.group.any && same.includes('level') && !level) request.stats = { ...(request.stats || {}), level: [pick('level'), pick('level')] };
      if (different.includes('attribute')) request.not.attribute = [...new Set([...request.not.attribute, ...have.map(m => m.attribute)])];
      if (different.includes('type')) request.not.type = [...new Set([...request.not.type, ...have.map(m => m.type)])];
    }
    if (piece?.checks.includes(MATERIAL_PLACES[1][1])) request.not.monster_color = [...new Set([...request.not.monster_color, 'Fusion', 'Synchro', 'Xyz', 'Link'])];
    if (piece?.checks.includes(MATERIAL_PLACES[0][1]) && !request.frames?.length) request.frames = ['Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum'];
    request.cardTypes = request.cardTypes?.length ? request.cardTypes : ['Monster'];
    return { text: text.replace(/\s+/g, ' ').trim(), request, word: first ? word(first) : 'monster' };
  }
  // A Lab result read back (user, 2026-10-30: "see which other materials would complete its summon"): the part
  // of the recipe each chosen card fills and, for each Any slot, the ways real cards fill it: as which part, at
  // which Level or Link Rating, and what the recipe then still needs. Worked out when the result's overview
  // opens, never during Find; each card of the slot's pool is tried in place of the Any slot.
  const LAB_DETAIL_MS = 400;
  function labDetail(card, lab) {
    if (!lab?.materials.length || lab.notEvaluated?.has(card)) return null;
    const details = lab.details ||= new Map();
    if (details.has(card)) return details.get(card);
    const used = labRank(card, lab) < Infinity ? labMatch(card, lab) : null, recipe = used?.recipe;
    if (!recipe) return null;
    const exact = lab.mode !== 'includes', materials = lab.materials.map(item => item.generic ? item : labMaterial(item));
    const levels = recipe.kind === 'Synchro' || recipe.difference || recipe.sameLevel;
    const scale = m => levels ? (/Xyz|Link/.test(String(m.monster_color)) ? '' : `Lv ${Number(m.level) || 0}`) : recipe.kind === 'Link' && String(m.monster_color).includes('Link') ? `Link-${Number(m.level) || 1}` : '';
    // Which part each material went to, by position (the same card may be chosen twice).
    const roles = run => {
      const out = [], taken = new Set();
      for (const part of run) for (const m of part.materials) {
        const i = run.witnesses.findIndex((w, j) => w === m && !taken.has(j));
        if (i >= 0) { taken.add(i); out[i] = part.option; }
      }
      return out;
    };
    const base = roles(used), generic = materials.some(item => item.generic);
    const detail = { exact, slots: [], procedure: recipe.procedure || '',
      materials: materials.map((m, i) => m.generic ? { name: m.name, generic: true } : { name: m.name, role: base[i]?.text || '', scale: scale(m) }),
      needs: exact || generic ? null : recipeNeeds(card, used) };
    const pieces = recipe.parts.flatMap(part => part.options.flatMap(option => [option, ...option.including]));
    const detailed = [...materialFields(recipe, pieces)].some(field => LAB_DETAIL_FIELDS.includes(field));
    const order = recipe.parts.flatMap(part => part.options);
    const deadline = performance.now() + LAB_DETAIL_MS;
    materials.forEach((item, s) => {
      if (!item.generic) return;
      const pool = genericPool(item), ways = new Map();
      let partial = false;
      for (const group of detailed ? pool.groups.flatMap(group => group.map(m => [m])) : pool.groups) {
        if (performance.now() > deadline) { partial = true; break; }
        const witness = group[0], trial = materials.slice();
        trial[s] = witness;
        let run = null;
        labWork = { steps: 0, deadline: performance.now() + 50 };
        try { run = assignMaterials(recipe, trial, exact); }
        catch (error) { if (error !== LAB_NOT_EVALUATED) throw error; partial = true; }
        finally { labWork = null; }
        if (!run) continue;
        const option = roles(run)[s], needs = exact ? null : recipeNeeds(card, run), complete = !needs || needs.text === 'nothing more';
        const key = JSON.stringify([order.indexOf(option), scale(witness), complete ? '' : needs.text]);
        if (!ways.has(key)) ways.set(key, { option, role: option?.text || '', scale: scale(witness), complete, needs: complete ? null : needs, names: new Set() });
        for (const m of group) ways.get(key).names.add(m.name);
      }
      const number = text => Number(String(text).replace(/\D/g, '')) || 0;
      const sorted = [...ways.values()].sort((a, b) => b.complete - a.complete || order.indexOf(a.option) - order.indexOf(b.option) || number(b.scale) - number(a.scale));
      detail.slots.push({ index: s, name: item.name, partial,
        ways: sorted.map(way => {
          const names = [...way.names].sort((a, b) => a.localeCompare(b));
          return { role: way.role, scale: way.scale, complete: way.complete, needs: way.needs, count: names.length, names, request: wayRequest(item.generic, way.option, way.scale) };
        }) });
    });
    details.set(card, detail);
    return detail;
  }
  // A search for the cards one way takes: the Any slot's description, its part's phrase and the Level (or
  // Link Rating) of the way. Name rules of the part are not filters, so it can list a few more cards.
  function wayRequest(spec, option, scale) {
    const phrase = option?.phrase;
    const base = phrase ? requestFromPhrase(phrase, phrase.refs?.length === 1 ? phrase.refs[0] : null, option.text) : { text: '', field: 'name', frames: [], attributes: [], types: [], abilities: [], stats: null, not: {} };
    const not = { attribute: [], type: [], monster_color: [], ability: [], ...base.not };
    const both = (own, wanted) => !wanted?.length ? own || [] : own?.length ? own.filter(value => wanted.includes(value)) : wanted;
    const bounds = range => [range[0] ?? '', range[1] ?? ''].map(String);
    const stats = { ...(base.stats || {}) };
    for (const key of ['level', 'atk', 'def']) if (spec[key]) stats[key] = bounds(spec[key]);
    if (spec.link) stats.level = bounds(spec.link);
    const frames = [...new Set([...(base.frames || []), ...(spec.kinds || [])])], abilities = [...(base.abilities || [])];
    const [, word, value] = String(scale).match(/^(Lv|Link-)\s*(\d+)$/) || [];
    if (value) { stats.level = [value, value]; if (word === 'Link-' && !frames.includes('Link')) frames.push('Link'); }
    if (spec.tuner === true && !abilities.includes('Tuner')) abilities.push('Tuner');
    if (spec.tuner === false && !not.ability.includes('Tuner')) not.ability.push('Tuner');
    return { ...base, text: base.text || spec.archetype || '', field: base.text ? base.field : 'name', cardTypes: ['Monster'], frames, abilities,
      attributes: both(base.attributes, spec.attributes), types: both(base.types, spec.types), stats: Object.keys(stats).length ? stats : null, not };
  }
  let labSelection = null;
  const labQueries = new Map();
  const labOf = value => {
    const text = String(value || ''), cards = window.Cards;
    // Keep a few query results, including a running job, across help/history reads.
    if (labSelection?.cards !== cards || labSelection?.size !== cards?.length) labQueries.clear();
    labSelection = { cards, size: cards?.length };
    if (labQueries.has(text)) return labQueries.get(text);
    const [mode, ids] = text.split(':'), materials = String(ids || '').split(',').filter(Boolean).map(id => {
      if (!id.startsWith('any=')) return /^\d+$/.test(id) ? catalogCard(id) : null;
      try {
        const generic = JSON.parse(decodeURIComponent(id.slice(4)));
        return generic && typeof generic === 'object' && !Array.isArray(generic) ? { generic, name: labGenericLabel(generic) } : null;
      } catch { return null; }
    });
    const lab = materials.length && materials.every(Boolean) ? { mode: mode === 'includes' ? 'includes' : 'exact', materials } : null;
    if (labQueries.size >= 4) labQueries.delete(labQueries.keys().next().value);
    labQueries.set(text, lab);
    return lab;
  };
  // Prepare the shared reference index incrementally, before a first material recipe
  // would otherwise build it synchronously. Publish only a complete index.
  function* labPrepareReferences(cards) {
    if (referenceWords?.cards === cards && referenceWords.size === cards.length) return;
    const names = new Map(), used = new Set();
    for (const card of cards) {
      yield* labCheckpoint(); yield* fetchCheckpoint();
      if (card.rush) continue;
      if (card.name) names.set(normalize(card.name), card.name);
      for (const match of quoteText(card.effect + '\n' + card.pendulum_effect).matchAll(archetypeUse)) used.add(normalize(match[1]));
    }
    referenceWords = { cards, size: cards.length, names, exact: new Set(names.keys()), used };
  }
  function evaluateLab(value, { progress = () => {}, complete = () => {}, cancelled = () => {}, valid = () => true, onSlice = () => {} } = {}) {
    const cards = window.Cards || [], size = cards.length, lab = labOf(value);
    const targets = cards.filter(c => !c.rush && !c.custom && extraDeckMonster(c));
    let stopped = false, timer = null, channel = null, work = null, paused = 0, checked = 0;
    const dispose = () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      channel?.port1.close(); channel?.port2.close();
      channel = null;
    };
    const cancel = () => { if (!stopped) { dispose(); cancelled(); } };
    const iterator = (function* () {
      yield* labPrepareReferences(cards);
      if (lab) lab.ranks ||= new Map();
      for (const card of targets) {
        yield* labCheckpoint(true);
        if (lab) {
          yield* labMatchTask(card, lab);
          lab.ranks.set(card, labRank(card, lab));
        } else materialRecipe(card);
        checked++;
      }
    })();
    const slice = () => {
      if (stopped) return;
      if (!valid() || window.Cards !== cards || cards.length !== size) { cancel(); return; }
      const start = performance.now();
      labSlice = { deadline: start + 12, checks: 0 };
      labWork = work;
      if (labWork) labWork.deadline += start - paused;
      let step;
      try { step = iterator.next(); }
      catch (error) { cancel(); throw error; }
      finally {
        work = labWork; labWork = null; labSlice = null;
        paused = performance.now();
        onSlice(paused - start);
      }
      if (stopped) return;
      if (step.done) {
        dispose();
        // A history/help read may have evicted this key while the job was running.
        labQueries.set(value, lab);
        complete(lab);
      } else {
        progress(checked, targets.length);
        if (typeof MessageChannel === 'function') {
          if (!channel) { channel = new MessageChannel(); channel.port1.onmessage = slice; }
          channel.port2.postMessage(null);
        } else timer = setTimeout(slice, 0);
      }
    };
    slice();
    return { cancel, get done() { return stopped; }, get checked() { return checked; } };
  }
  const reverseOf = value => {
    const text = String(value || ''), at = text.indexOf(':'), mode = text.slice(0, at), id = text.slice(at + 1);
    if (!SYNERGY_ENABLED && mode === 'synergy') return null;
    return at > 0 && id ? { mode: ['synergy', 'starters', 'ideas', 'support'].includes(mode) ? mode : 'access', id: mode === 'support' ? decodeURIComponent(id) : id } : null;
  };
  // Starters: cards that reach the card in two steps. They search or summon one of its named, archetype or
  // mention searchers (its Access, ranks 0-2), which then searches or summons it. Access cards that get it on their own
  // are one-card starters, listed first (directRank).
  // A generic searcher (rank 3: "1 Equip Spell") is a step only in a line that Summons it from the Extra Deck
  // or destroys it (user, 2026-10-30); those lines come after the others (GENERIC_STEP).
  const GENERIC_STEP = 3;
  // A search's slices (fetchRanksTask) resume these tasks; other callers drain them at once.
  const starterVia = target => labDrain(starterViaTask(target));
  function* starterViaTask(target) {
    if (!target) return [];
    const cards = Array.isArray(window.Cards) ? window.Cards : [], generic = new Set(), via = [];
    for (const card of cards) {
      yield* fetchCheckpoint();
      if (!card.name || card.rush || card.card_type === 'Skill' || card.name === target.name) continue;
      const rank = relatedRank(card, target, 'access');
      if (rank < 3) { via.push(card); continue; }
      if (rank === Infinity || !extraDeckMonster(card) && !accessPhrases(card, target).some(phrase => phrase.effect && (phrase.where ||= effectNeeds(card, phrase.effect)).some(need => need.startsWith('destroyed')))) continue;
      generic.add(card);
      via.push(card);
    }
    via.generic = generic;
    via.material = yield* materialLinesTask(target, via);
    return via;
  }
  // Starters through an Xyz, Synchro or Link Summon by procedure (user, 2026-10-30): all the materials of a step that
  // names the card, its archetype or a mention come from the line: the starter on the field (Normal Summoned, or
  // Summoning itself from the hand) with the monster its effect brings to the field, or one of them alone. Not
  // through a generic step: measured, those add hundreds of lines and take far too long. Worked out once per
  // search, so a starter costs one lookup: card → { rank, via, how: { move: 'material', kind, with, alone } }. Two
  // materials include one that the material line names ('2+ Effect Monsters, including a "Madolche" monster'), which
  // keeps the pairs to try few; past MATERIAL_MS the search stops and keeps what it found (lines.partial). The time
  // between a search's slices does not count.
  const MATERIAL_STEP = 3.5, MATERIAL_MS = 400;
  function* materialLinesTask(target, via) {
    const lines = new Map(), steps = [];
    let deadline = performance.now() + MATERIAL_MS;
    for (const step of via) {
      deadline += yield* fetchCheckpoint();
      // Its materials name a card or an archetype ('2 "HERO" monsters'): with "2 Effect Monsters" (Predaplant Verte
      // Anaconda) or "1 Tuner + 1+ non-Tuner monsters", nearly any two monsters make it (measured: up to 399 lines and
      // 17 s for one card).
      const kind = !via.generic?.has(step) && /"/.test(materialLine(step)) && String(step.monster_color).match(/Xyz|Synchro|Link/)?.[0].toLowerCase(), recipe = kind && materialRecipe(step);
      const nexts = recipe ? accessPhrases(step, target).filter(next => fetchRank(target, next) < Infinity) : [];
      const quoted = [...materialLine(step).matchAll(/"([^"]+)"/g)].map(match => normalize(match[1]));
      const named = card => indexedText(card).name.some(name => quoted.some(part => name === part || namePart(name, part)));
      if (nexts.length) steps.push({ step, kind, recipes: [recipe, ...(recipe.alternatives || [])], nexts, named });
    }
    if (!steps.length) return lines;
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    const fits = (recipes, materials, exact) => recipes.some(recipe => { try { return (!exact || materialTotalsFit(recipe, materials, true)) && assignMaterials(recipe, materials, exact); } catch { return false; } });
    const monsters = cards.filter(card => card.name && !card.rush && card.card_type === 'Monster' && !extraDeckMonster(card) && card.name !== target.name);
    const starters = cards.filter(card => card.name && !card.rush && card.name !== target.name && !extraDeckMonster(card) && (indexedText(card).fetch ||= fetchClauses(card)).some(phrase => phrase.fromMain && ['summon', 'add'].includes(phrase.action) && phrase.effect));
    const onField = card => normalSummonable(card) ? 'normal' : selfSummon(card).hand ? 'self' : '';
    const direct = new Map(), reaches = card => direct.get(card) ?? direct.set(card, relatedRank(card, target, 'access') < Infinity).get(card);
    const found = (card, s, other, alone) => { if (!lines.has(card)) lines.set(card, { rank: MATERIAL_STEP, via: s.step, how: { move: 'material', kind: s.kind, with: other || null, alone: !!alone } }); };
    for (const s of steps) {
      const materials = [];
      for (const card of monsters) { deadline += yield* fetchCheckpoint(); if (fits(s.recipes, [card], false)) materials.push(card); }
      const isMaterial = new Set(materials);
      const single = new Set(materials.filter(card => fits(s.recipes, [card], true))), byLevel = [new Map(), new Map()];
      for (const card of materials) for (const [i, map] of byLevel.entries()) if (!i || s.named(card)) map.set(Number(card.level), [...map.get(Number(card.level)) || [], card]);
      const namedMaterials = materials.filter(s.named);
      const works = (...used) => s.nexts.some(next => used.some(material => effectUse(s.step, next, 'summoned', s.kind, false, material)));
      // The starter alone: Normal Summoned, or Summoning itself, then the only material (a Link-1).
      for (const card of single) if (onField(card) && !reaches(card) && works(card)) found(card, s);
      for (const card of starters) {
        deadline += yield* fetchCheckpoint();
        if (performance.now() > deadline) { lines.partial = true; return lines; }
        const field = isMaterial.has(card) && onField(card);
        if (lines.has(card) || !field && !single.size || reaches(card) || !allowsSummon(card, s.step)) continue;
        for (const phrase of indexedText(card).fetch) {
          if (lines.has(card)) break;
          // "whose Level equals the number of cards banished" (Treasure Panda): which Levels is not read.
          if (!phrase.fromMain || !['summon', 'add'].includes(phrase.action) || !phrase.effect || /\b(?:Level|Rank)s? (?:equals?|is equal to) the number\b/i.test(phrase.effect.text)) continue;
          const opening = effectUse(card, phrase, 'hand', '', true);
          // Face-down, a monster is no material.
          if (!opening || phrase.action === 'summon' && /\bin face-down Defense Position\b/i.test(phrase.effect.text)) continue;
          // The starter stays on the field when it got there and its effect does not take it away.
          const stays = field && (opening.normal || field === 'self') && !/\b(?:Tribute|banish|send|discard|shuffle|return|reveal) this card\b/i.test(phrase.effect.text);
          const level = s.kind === 'xyz' ? Number(card.level) : s.kind === 'synchro' ? Number(s.step.level) - Number(card.level) : null;
          // Without the named part itself, the starter needs it in the other monster.
          const own = s.named(card) ? 0 : 1, others = stays ? level === null ? own ? namedMaterials : materials : byLevel[own].get(level) || [] : [...single];
          for (const other of others) {
            if (other.name === card.name || fetchRank(other, phrase) === Infinity || !summonAllowed(other, phrase, card, 'access')) continue;
            const out = phrase.action === 'summon' || !opening.normal && normalSummonable(other) || !!selfSummon(other).hand;
            if (!out) continue;
            if (stays && fits(s.recipes, [card, other], true) && works(card, other)) { found(card, s, other); break; }
            if (single.has(other) && works(other)) { found(card, s, other, true); break; }
          }
        }
      }
    }
    return lines;
  }
  // A starter counts only when each step really works (user, 2026-10-30): the starter's effect works from the
  // hand, and the step card's effect works where the first step puts it (added: hand; Special Summoned; Set;
  // sent: GY; banished; destroyed in the Deck: GY). Neither effect may need another effect of a card that allows
  // only 1 per turn. { rank, via: the step, how: { move: 'get' | 'summon' | 'destroy' | 'material', self: the step
  // destroys itself } }.
  function starterRank(card, target, via) {
    // An Extra Deck monster or a Skill is not in the opening hand.
    if (!target || card.name === target.name || extraDeckMonster(card) || card.card_type === 'Skill') return { rank: Infinity };
    // A card without a fetch effect starts no line but as a material (most cards: checked first, for speed).
    const material = via.material?.get(card) || { rank: Infinity };
    if (!(indexedText(card).fetch ||= fetchClauses(card)).length) return material;
    if (relatedRank(card, target, 'access') < Infinity) return directRank(card, target);
    let best = material;
    for (const step of via) {
      if (step.name === card.name) continue;
      const generic = via.generic?.has(step) ? GENERIC_STEP : 0;
      let first = relatedRank(card, step, 'access');
      for (const way of extraDeckMonster(step) ? lineSummons(card, step) : []) first = Math.min(first, way.rank);
      if (first + generic >= best.rank) continue;
      const found = chainRank(card, step, target, generic);
      if (found.rank < best.rank) best = { ...found, via: step };
    }
    return best;
  }
  // Whether a card sent to the GY (or banished) from the Deck can still do something there. Starters and Ideas need it:
  // milling a card with no effect in the GY does not get it (user, 2026-11-04: Ideas for A Rival Appears! listed
  // Tindangle cards that "get" Tindangle Trinity, whose only line mills any Spell/Trap). Access still lists every miller.
  const GY_USE = [
    // Not "as Link Material" or "by battle" (from the field only), nor "discarded" (from the hand only).
    /\b(?:if|when) this card is sent to (?:the|your) (?:GY|Graveyard)\b(?! as (?:\w+ )?Materials?\b| by battle\b)/i,
    /\b(?:if|when) this card is sent from (?:[^.;:]*?\b)?Deck\b[^.;:]*? to (?:the|your) (?:GY|Graveyard)\b/i,
    /\b(?:if|while|when) this card is in (?:your|the) (?:GY|Graveyard)\b/i,
    /\bthis card (?:from|in) (?:your|the) (?:GY|Graveyard)\b/i,
    /\bthis card in (?:your |the )?(?:hand or GY|GY or hand|hand or Graveyard|Graveyard or hand)\b/i];
  const BANISHED_USE = [/\b(?:if|when|while) this card is (?:face-up )?banished\b/i, /\bthis (?:banished card|card (?:from|in) (?:your |the )?banishment|card is in your banishment)\b/i];
  // Destroyed in the Deck (Seed Burner): also a card with an effect when it is destroyed, except by battle or on the field.
  const DESTROYED_USE = /\b(?:if|when) this card is destroyed\b(?! by battle\b)(?![^.;:]*\b(?:by battle|on the field|in the (?:Spell & Trap|Monster) Zone|you control)\b)/i;
  function usableAfter(target, phrase) {
    const action = phrase.action;
    if (action !== 'send' && action !== 'banish') return true;
    const own = indexedText(target), key = action === 'send' ? 'gyUse' : 'banishedUse', text = `${target.effect || ''}\n${target.pendulum_effect || ''}`;
    own[key] ??= (action === 'send' ? GY_USE : BANISHED_USE).some(pattern => pattern.test(text));
    if (own[key]) return true;
    return !!phrase.destroy && (own.destroyedUse ??= DESTROYED_USE.test(text));
  }
  // The phrases relatedRank ranks for Access, as Starters and Ideas use them: a send or banish counts only for a card that
  // works from there (usableAfter).
  function accessPhrases(card, target) {
    const extra = extraDeckMonster(target), actions = accessActions[extra ? 'extra' : 'main'];
    return (indexedText(card).fetch ||= fetchClauses(card)).filter(phrase => actions.has(phrase.action) && (extra ? phrase.fromExtra : phrase.fromMain) &&
      usableAfter(target, phrase) && summonAllowed(target, phrase, card, 'access'));
  }
  // A monster the starter Special Summons from the Extra Deck by its own effect, with nothing but itself as material
  // ("attach this card ... to that monster as material (this is treated as an Xyz Summon)") or with none: a move of
  // the line like the Normal Summon, counted whatever the ⚙ says. An effect that needs another monster you control
  // (Power Patron DoomZ, Rank-Up-Magic) does not count; "the same Rank as this card's Level" is checked.
  function lineSummons(card, step) {
    if (!extraDeckMonster(step) || !allowsSummon(card, step)) return [];
    const ways = [];
    for (const { phrase, material } of lineSummonPhrases(card)) {
      if (!summonAllowed(step, phrase, card, 'access') || /\bwith the same Rank as this card's (?:original )?Level\b/i.test(phrase.effect.text) && Number(step.level) !== Number(card.level)) continue;
      const rank = actionRank(fetchRank(step, phrase), phrase), treated = phrase.effect.text.match(/\btreated as an? (Fusion|Synchro|Xyz|Link) Summon\b/i);
      if (rank < Infinity) ways.push({ phrase, rank, summon: treated ? treated[1].toLowerCase() : phrase.summon, material: material ? card : null });
    }
    return ways;
  }
  // The card's Special Summons from the Extra Deck that a one-card line can use, once per card. A Fusion, Synchro, Xyz or
  // Link Summon ("Fusion Summon 1 Fusion Monster ..., using monsters from your hand or field") takes other materials. An
  // older Spell's cost is a sentence of its own ("Send 1 face-up "Neo-Spacian" monster you control to the GY. Special
  // Summon 1 Level 4 monster with the same name ..."). "While ... the Summoned monster ... its effects are negated"
  // (Instant Contact): a one-card line does not have what lifts it.
  function lineSummonPhrases(card) {
    const entry = indexedText(card);
    if (entry.lineSummons) return entry.lineSummons;
    const phrases = (entry.fetch ||= fetchClauses(card)).filter(phrase => phrase.action === 'summon' && phrase.summon === 'special' && phrase.fromExtra && phrase.effect);
    if (!phrases.length || /\bthe Summoned monster\b[^.]*\b(?:its|their) effects (?:are|is) negated\b/i.test(quoteText(card.effect))) return entry.lineSummons = [];
    const effects = [...new Set(cardClauses(card).effects)];
    return entry.lineSummons = phrases.map(phrase => {
      const at = effects.indexOf(phrase.effect), before = at > 0 && card.card_type !== 'Monster' && !/[:;]/.test(effects[at - 1].text) ? `${effects[at - 1].text} ` : '';
      return { phrase, material: ownMaterial(before + phrase.effect.text) };
    }).filter(way => way.material !== null);
  }
  // The material of an Extra Deck Summon by effect: true, the card itself ("attach this card ... to that monster as
  // material"); false, none ("Pay 1000 LP; Special Summon 1 Level 5 or lower Fusion Monster"); null when the effect
  // needs another card of yours, as material, as a cost or target ("Tribute 1 monster", "Target 2 face-up Xyz
  // Monsters", "reveal 1 ... in your hand") or to compare with ("the same Level as the Tributed monster", "that
  // mentions that card", "1 Rank higher than").
  function ownMaterial(text) {
    const own = text.replace(/\bthis (?:card|monster)(?: you control)?\b/gi, 'ITSELF').replace(/\bto (?:that|the Summoned) monster\b/gi, 'to IT');
    if (/\byou control\b|\b(?:target|Tribute|send|banish|shuffle|return|reveal|detach|discard|remove|excavate)\w*\s+(?:up to\s+)?(?:\d+|a|an|one|two|all)\b|\bITSELF and (?:up to )?(?:\d+|a|an|one|two)\b|\b(?:removed|Tributed|sent|banished|returned|targeted|destroyed|revealed|detached|discarded) (?:monsters?|cards?)\b|\bthat (?:monster|target|card)s?\b|\bthe one\b|\b(?:Rank|Level)s? (?:higher|lower) than\b|\bthe same (?:Level|Rank|Type|Attribute) as (?:the|that)\b|\bwith the same name\b|\bcombined\b|\bLink Monsters? points? to\b/i.test(own)) return null;
    if (/\battach ITSELF\b|\busing (?:only )?ITSELF as\b|\bby using ITSELF\b/i.test(own)) return true;
    return /\bmaterials?\b/i.test(own) ? null : false;
  }
  // "also you cannot Special Summon from the Extra Deck for the rest of this turn, except Psychic monsters" (Serene
  // Psychic Girl), "You cannot Special Summon from the Extra Deck, except Xyz Monsters": what the starter still lets
  // the line Summon from the Extra Deck, as phrases.
  function summonLimits(card) {
    const entry = indexedText(card);
    if (entry.summonLimits) return entry.summonLimits;
    const { names, clauses } = cardClauses(card), limits = [];
    for (const clause of clauses) {
      const match = clause.match(/\bcannot Special Summon(?: monsters)?(?: from the Extra Deck)?\b[^,]*?,?\s*except (?:for )?(.+)$/i), phrase = match && fetchPhrase(match[1], names, '', true);
      if (phrase) limits.push(phrase);
    }
    return entry.summonLimits = limits;
  }
  const allowsSummon = (card, step) => summonLimits(card).every(limit => fetchRank(step, limit, true) < Infinity);
  const PLACE = { add: 'hand', summon: 'summoned', set: 'set', send: 'gy', banish: 'banished' }, CHANCE_STEP = 4, DIRECT_STEP = -10;
  // A Normal or Quick-Play Spell, or a Normal Trap activated from the hand, is in the GY once it resolves: its GY
  // effect can follow.
  const resolvesToGY = card => (card.card_type === 'Spell' && ['Normal', 'Quick-Play'].includes(card.type) || card.card_type === 'Trap' && card.type === 'Normal' && activatable(card, 'hand')) && !onlyOneEffect(card) && activationAlone(card);
  // Its activation, the first effect that is not a note ("(This card is always treated as ...)", "You can only activate 1 ..."), works alone.
  const activationAlone = card => { const first = [...new Set(cardClauses(card).effects)].find(effect => !effect.pendulum && !/^\(|^You can only\b/i.test(effect.text)); return !first || lineAlone(card, first); };
  // An effect's own Fusion, Synchro, Xyz or Link Summon takes materials the line does not have ("Xyz Summon 1 Xyz
  // Monster, using only "Goblin" monsters you control": Goblin Biker Grand Stampede), as does a Summon that uses or
  // returns another card (Clock Lizard: "return 1 Fusion Monster from your GY to the Extra Deck, then Fusion Summon").
  const summonsAlone = (phrase, step) => phrase.action !== 'summon' || !extraDeckMonster(step) || !/\b(?:Fusion|Synchro|Xyz|Link) Summon(?! Monster)\b/i.test(phrase.effect?.text.replace(/\btreated as an? \w+ Summon\b/gi, ' ') || '') && ownMaterial(phrase.effect?.text || '') !== null;
  // One-card starters (user, 2026-10-30): an Access card whose own effect gets the card under the same rules as a
  // line's first step (from the hand, or a resolved Spell's GY effect), before every line. Not one that waits for
  // the End Phase; one that needs more (a trigger, a cost, a condition) is no starter.
  function directRank(card, target) {
    let best = { rank: Infinity };
    const resolves = resolvesToGY(card);
    for (const phrase of accessPhrases(card, target)) {
      const rank = actionRank(fetchRank(target, phrase), phrase) + DIRECT_STEP;
      if (rank >= best.rank || !summonsAlone(phrase, target) || /\bEnd Phase\b/i.test(phrase.effect?.condition || '')) continue;
      if (!(effectUse(card, phrase, 'hand', '', true) || resolves && effectUse(card, phrase, 'gy', '', true))) continue;
      const chance = chanceOf(phrase.effect), total = rank + (chance ? CHANCE_STEP : 0);
      if (total < best.rank) best = { rank: total, how: { move: 'direct', action: phrase.action, chance } };
    }
    return best;
  }
  // Ideas (user, 2026-10-30): every line of one or two cards that gets the card, also those the Starters leave out, each
  // with what it needs in the cards' own words (a condition, a cost, a trigger, a place): ideas for bridges and loops.
  // The Starters come first (their own ranks), then the Access cards that need something (IDEA_STEP), then lines through
  // one step, generic searchers included ("add 1 Normal Spell": Endymion, the Mighty Master of Magic), those that need
  // less first. A card tries its IDEA_TRIES best steps.
  const IDEA_STEP = 20, IDEA_TRIES = 6;
  const ideaVia = target => labDrain(ideaViaTask(target));
  function* ideaViaTask(target) {
    if (!target) return [];
    const cards = Array.isArray(window.Cards) ? window.Cards : [], seen = new Set(), steps = [];
    for (const card of cards) {
      yield* fetchCheckpoint();
      if (!card.name || card.rush || card.card_type === 'Skill' || card.name === target.name || seen.has(card.name)) continue;
      const rank = relatedRank(card, target, 'access');
      if (rank < Infinity) { seen.add(card.name); steps.push({ card, rank, extra: extraDeckMonster(card) }); }
    }
    return steps.sort((a, b) => a.rank - b.rank);
  }
  function ideaRank(card, target, via, steps) {
    if (!target || card.name === target.name || extraDeckMonster(card) || card.card_type === 'Skill') return { rank: Infinity };
    // Most cards take nothing out of a Deck: they reach no step, and are Starters only through a material line (for speed:
    // measured on the phone, Dark Magician took 6.7 s before this).
    const own = indexedText(card).fetch ||= fetchClauses(card), decks = { main: own.filter(phrase => accessActions.main.has(phrase.action) && phrase.fromMain),
      extra: own.filter(phrase => accessActions.extra.has(phrase.action) && phrase.fromExtra) };
    if (!decks.main.length && !decks.extra.length && !lineSummonPhrases(card).length) return via.material?.get(card) || { rank: Infinity };
    // The steps it reaches, once; a step of a kind none of its effects can fetch ("1 Spell" for a monster step) is not tried.
    // This is relatedRank(card, step) < Infinity over the phrases already sorted by Deck (most of a search's time).
    const fetchable = (step, phrases) => phrases.some(phrase => phrase.alternatives || !phrase.kinds || phrase.kinds.includes(step.card_type));
    const reaches = (step, phrases) => phrases.some(phrase => summonAllowed(step, phrase, card, 'access') && fetchRank(step, phrase) < Infinity);
    const reached = steps.filter(({ card: step, extra }) => step.name !== card.name && fetchable(step, decks[extra ? 'extra' : 'main']) && reaches(step, decks[extra ? 'extra' : 'main'])), direct = relatedRank(card, target, 'access') < Infinity;
    if (!reached.length && !direct && !lineSummonPhrases(card).length) return via.material?.get(card) || { rank: Infinity };
    const sure = starterRank(card, target, via);
    if (sure.rank < Infinity) return sure;
    const resolves = resolvesToGY(card), opening = phrase => effectUse(card, phrase, 'hand', '', true) || resolves && effectUse(card, phrase, 'gy', '', true);
    // On its own, with what it needs.
    if (direct) {
      let best = { rank: Infinity };
      for (const phrase of accessPhrases(card, target)) {
        const rank = actionRank(fetchRank(target, phrase), phrase);
        if (rank === Infinity) continue;
        const need = !opening(phrase) ? effectNeed(card, phrase, 'hand', '', true) : /\bEnd Phase\b/i.test(phrase.effect?.condition || '') ? 'the End Phase' : summonsAlone(phrase, target) ? '' : 'materials for its Summon';
        const chance = chanceOf(phrase.effect), total = IDEA_STEP + rank + (chance ? CHANCE_STEP : 0);
        if (total < best.rank) best = { rank: total, how: { move: 'direct', action: phrase.action, chance, idea: { starter: need } } };
      }
      return best;
    }
    // Through one step: the card's effect that gets the step, then the step's that gets the card.
    let best = { rank: Infinity }, tries = 0;
    for (const { card: step, rank: second } of reached) {
      for (const first of accessPhrases(card, step)) {
        const firstRank = fetchRank(step, first);
        if (firstRank === Infinity) continue;
        // A starter that works only "During the End Phase" (Watch Cat) leaves the step no Main Phase.
        const open = opening(first), starter = !open ? effectNeed(card, first, 'hand', '', true) : /\bEnd Phase\b/i.test(first.effect?.condition || '') ? 'the End Phase' : summonsAlone(first, step) ? '' : 'materials for its Summon';
        const place = first.destroy ? 'destroyed' : first.action === 'summon' && /\bin face-down Defense Position\b/i.test(first.effect?.text || '') && !/\bor face-down Defense Position\b/i.test(first.effect?.text || '') ? 'set' : PLACE[first.action];
        for (const next of accessPhrases(step, target)) {
          if (fetchRank(target, next) === Infinity) continue;
          // "Special Summon 1 Level 3 Fiend monster ..., but negate its effects" (Tour Guide From the Underworld), as in chainRank.
          const negated = place === 'summoned' && /\b(?:its|their) effects (?:are|is) negated\b|\bnegate (?:its|their) effects\b|\bwith (?:its|their) effects negated\b/i.test(first.effect?.text || '');
          const stepNeed = negated ? 'effects that its Summon does not negate' : effectUse(step, next, place, first.summon, !open?.normal) ? '' : effectNeed(step, next, place, first.summon, !open?.normal);
          const chance = chanceOf(first.effect) || chanceOf(next.effect), total = IDEA_STEP + 10 * (1 + !!starter + !!stepNeed) + actionRank(firstRank, first) + second + (chance ? CHANCE_STEP : 0);
          if (total < best.rank) best = { rank: total, via: step, how: { move: first.destroy ? 'destroy' : 'get', action: next.action, chance, idea: { starter, step: stepNeed, generic: second >= GENERIC_STEP } } };
        }
      }
      if (++tries >= IDEA_TRIES) break;
    }
    return best;
  }
  // Access, Starters and Ideas in slices (Ideas for "Infernoble Arms - Durendal" kept the user's DuelingBook tab busy
  // for 13 s, 2026-10-30): the card texts are read, then the steps and every card's rank worked out FETCH_SLICE_MS at a
  // time, with "Searching…" in the meantime; the search then reads the ranks. A search that fits in the first slice
  // ends at once, as before. The last FETCH_KEEP stay, for the target, the ⚙ choices and the catalog. A catalog of
  // fewer than FETCH_SLICED_FROM cards (DuelingBook's has 18,532) is searched at once, as before.
  const FETCH_SLICE_MS = 40, FETCH_KEEP = 4, FETCH_SLICED_FROM = 1000, FETCH_MODES = ['access', 'starters', 'ideas'], fetchRankCache = new Map();
  let fetchSlice = null;
  // A pause between slices, when the slice's time is up; returns the time paused, which a time limit inside the
  // work (MATERIAL_MS) does not count. Outside a slice it never pauses.
  function* fetchCheckpoint() {
    if (!fetchSlice || performance.now() < fetchSlice.deadline) return 0;
    const at = performance.now();
    yield;
    return performance.now() - at;
  }
  const fetchKey = (mode, target) => `${mode}:${target.id}:${[...accessActions.main]}:${[...accessActions.extra]}`;
  function cachedRanks(key) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [], entry = fetchRankCache.get(key);
    return entry?.cards === cards && entry.size === cards.length ? entry : null;
  }
  // card → what matches() would work out for it: a rank (Access) or { rank, via, how } (Starters, Ideas).
  function* fetchRanksTask(mode, target, progress) {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    progress.total = 2 * cards.length;
    // The catalog's indexes first: built in one go on first use, they took 40–340 ms each (catalog 787, Node).
    yield* labPrepareReferences(cards); yield* archetypeIndexTask(cards); yield* quoteIndexTask(cards); yield* listedIndexTask(cards); yield* ritualDeckTask(cards);
    for (const card of cards) {
      if (card.name && !card.rush) indexedText(card).fetch ||= fetchClauses(card);
      progress.done++; yield* fetchCheckpoint();
    }
    const via = mode === 'access' ? null : yield* starterViaTask(target), steps = mode === 'ideas' ? yield* ideaViaTask(target) : null, found = new Map();
    for (const card of cards) {
      if (card.name && !card.rush) found.set(card, mode === 'access' ? relatedRank(card, target, 'access') : mode === 'ideas' ? ideaRank(card, target, via, steps) : starterRank(card, target, via));
      progress.done++; yield* fetchCheckpoint();
    }
    return { cards, size: cards.length, via, steps, found };
  }
  // Runs the task in slices from now, the first one before it returns: done(job) once it ends, stopped(job) when it is
  // no longer valid (the constructor closed, the catalog changed); cancel() stops it.
  function startFetchJob(mode, target, key, { valid, progress, done, stopped: dropped, task = null }) {
    const cards = window.Cards, size = cards?.length, state = { done: 0, total: 1 }, iterator = task ? task(state) : fetchRanksTask(mode, target, state);
    let stopped = false, channel = null, timer = null;
    const job = { key, state, get stopped() { return stopped; } };
    job.cancel = () => { stopped = true; if (timer !== null) clearTimeout(timer); channel?.port1.close(); channel?.port2.close(); channel = null; };
    const slice = () => {
      if (stopped) return;
      if (!valid() || window.Cards !== cards || cards.length !== size) { job.cancel(); dropped(job); return; }
      fetchSlice = { deadline: performance.now() + FETCH_SLICE_MS };
      let step;
      try { step = iterator.next(); }
      catch (error) { job.cancel(); throw error; }
      finally { fetchSlice = null; }
      if (step.done) {
        job.cancel();
        fetchRankCache.delete(key); fetchRankCache.set(key, step.value);
        while (fetchRankCache.size > FETCH_KEEP) fetchRankCache.delete(fetchRankCache.keys().next().value);
        done(job);
        return;
      }
      progress(job);
      if (typeof MessageChannel === 'function') {
        if (!channel) { channel = new MessageChannel(); channel.port1.onmessage = slice; }
        channel.port2.postMessage(null);
      } else timer = setTimeout(slice, 0);
    };
    slice();
    return job;
  }
  // What an effect needs that a one-card line does not give, in the card's words ('' when nothing is missing).
  const PLACE_WORDS = { hand: 'to be in your hand', gy: 'to be in the GY', banished: 'to be banished', field: 'to be on the field', pendulum: 'to be in a Pendulum Zone',
    destroyed: 'to be destroyed', 'destroyed:field': 'to be destroyed on the field', 'summon:special': 'to be Special Summoned', 'summon:hand': 'to be Special Summoned from the hand',
    'summon:gy': 'to be Special Summoned from the GY', card: 'to be activated' };
  function effectNeed(card, phrase, place, summon, normal) {
    const effect = phrase.effect;
    if (!effect) return '';
    const names = cardClauses(card).names, words = text => String(text).replace(/§(\d+)§/g, (all, n) => names[n] ?? all).replace(/\s+/g, ' ').replace(/^[)\s]+/, '').trim().replace(/[:;,]$/, '');
    const clip = text => text.length > 140 ? `${text.slice(0, 139)}…` : text;
    if (phrase.dependent && onlyOneEffect(card)) return 'another of its effects first, and it allows only 1 per turn';
    const alone = aloneReason(card, effect, []);
    if (alone) {
      // A bullet's label ("●5 or more:", "●You:") reads with its header, or the sentence before that counts: "based on the
      // number of "Spellbook" Spell Cards ..." (Reaper of Prophecy, whose bullets have no "these effects" header).
      let text = words(alone);
      if (text.length < 20) {
        const list = [...new Set(cardClauses(card).effects)], before = list.slice(Math.max(0, list.indexOf(effect) - 6), list.indexOf(effect)).reverse();
        const head = effect.own !== undefined ? effect.text.slice(0, effect.text.length - effect.own.length) : (before.find(other => /\bnumber of\b/i.test(other.text)) || before[0])?.text || '';
        const count = words(head).match(/\bnumber of [^.;]*/i)?.[0];
        text = count ? `${text} (the ${count})` : head ? `${text}: ${words(head)}` : text;
      }
      return clip(text);
    }
    if (phrase.when && phrase.when.replace(LINE_CONDITION, ' ').trim()) return words(`if ${phrase.when}`);
    const needs = phrase.where ||= effectNeeds(card, effect);
    if (!needs.length || needs.includes('never')) return words(effect.condition) || 'more than the line';
    if (card.card_type === 'Trap' && needs.includes('card')) return 'to be Set a turn before';
    // A Level 5 or higher monster in the hand gets to the field by a Tribute Summon.
    if (place === 'hand' && card.card_type === 'Monster' && !normalSummonable(card) && needs.every(need => need === 'field' || need === 'summon:normal')) return summonRule(card).noNormal ? 'its Special Summon (it cannot be Normal Summoned)' : 'a Tribute Summon';
    return [...new Set(needs.map(need => need === 'summon:normal' ? (!normalSummonable(card) ? 'a Tribute Summon' : normal ? 'its Normal Summon' : 'a second Normal Summon')
      : PLACE_WORDS[need] || (need.startsWith('summon:') ? `to be ${need[7].toUpperCase()}${need.slice(8)} Summoned` : need)))].join(' or ');
  }
  function chainRank(card, step, target, generic = 0) {
    let best = { rank: Infinity };
    const resolves = resolvesToGY(card), summons = phrase => summonsAlone(phrase, step);
    const firsts = [...accessPhrases(card, step).filter(summons).map(phrase => ({ phrase, rank: actionRank(fetchRank(step, phrase), phrase), summon: phrase.summon, material: null })), ...lineSummons(card, step).map(way => ({ ...way, extra: true }))];
    for (const { phrase: first, rank: own, summon, material, extra } of firsts) {
      const rank = own + generic;
      const opening = rank < best.rank && (effectUse(card, first, 'hand', '', true) || resolves && effectUse(card, first, 'gy', '', true));
      if (!opening) continue;
      // Special Summoned face-down, a monster cannot use its effects; destroyed in the Deck, a card is in the GY.
      const place = extra ? 'summoned' : first.destroy ? 'destroyed' : first.action === 'summon' && /\bin face-down Defense Position\b/i.test(first.effect?.text || '') && !/\bor face-down Defense Position\b/i.test(first.effect?.text || '') ? 'set' : PLACE[first.action];
      // "its effects are negated" (Instant Contact while "Elemental HERO Neos" is not there): the Summoned step does nothing.
      if (place === 'summoned' && /\b(?:its|their) effects (?:are|is) negated\b|\bnegate (?:its|their) effects\b|\bwith (?:its|their) effects negated\b/i.test(first.effect?.text || '')) continue;
      // The starter Normal Summoned (or Summoned by itself) stays on the field, unless its effect takes it away: it may
      // pay the step's cost. An effect "During the End Phase" (Kuribandit, Watch Cat) leaves no Main Phase: the step can
      // then only use an effect that starts by itself (Summoned, sent, banished), a Quick Effect or a Quick-Play Spell.
      const others = card.card_type === 'Monster' && (opening.normal || (first.where || []).some(need => need === 'field' || need.startsWith('summon'))) && !/\b(?:Tribute|banish|send|discard|shuffle|return|reveal) this card\b/i.test(first.effect?.text || '') ? [card] : [];
      const late = /\bEnd Phase\b/i.test(first.effect?.condition || '');
      // "You cannot Summon other monsters the turn you activate this card" (Dark Magic Curtain) after the line Summoned.
      const summoned = { normal: !!opening.normal, special: !!extra || /\bSpecial Summon/i.test(first.effect?.text || '') || !!others.length && !opening.normal };
      const barred = indexedText(step).barred ??= (step.card_type === 'Monster' ? '' : quoteText(step.effect)).match(/\byou cannot (Normal Summon\/Set or Special Summon|Special Summon|Normal Summon|Summon)(?: other)? monsters?\b[^.]*?\bthe turn you activate this (?:card|effect)\b(?!,?\s*except)/i)?.[1] || '';
      if (/^Summon|or Special/i.test(barred) ? summoned.normal || summoned.special : /^Special/i.test(barred) ? summoned.special : /^Normal/i.test(barred) && summoned.normal) continue;
      // The step's effect that gets the card, not another of its effects.
      for (const next of accessPhrases(step, target)) {
        if (fetchRank(target, next) === Infinity) continue;
        if (late && !(/^\s*(?:If|When)\b/i.test(next.effect?.condition || '') && !/\bMain Phase\b/i.test(next.effect?.condition || '') || /\(Quick Effect\)/i.test(next.effect?.condition || '') || step.card_type === 'Spell' && step.type === 'Quick-Play' && place === 'hand')) continue;
        const use = effectUse(step, next, place, summon, !opening.normal && !late, material, others);
        // A generic step counts only through the line's Extra Deck Summon or its destruction.
        if (!use || generic && !extra && !use.destroyed) continue;
        // A line by chance comes after the sure ones, and says what has to go your way.
        const chance = chanceOf(first.effect) || chanceOf(next.effect), total = rank + (chance ? CHANCE_STEP : 0);
        if (total < best.rank) best = { rank: total, how: { move: extra ? 'summon' : first.destroy ? 'destroy' : 'get', self: use.destroyed === 'self', chance, action: next.action } };
        if (!chance) break;
      }
    }
    return best;
  }
  // Where a card must be for an effect to work, from its condition and its text: any of 'summon:normal',
  // 'summon:special', 'summon:<procedure>', 'summon:hand' / 'summon:gy' (Special Summoned from there), 'field',
  // 'hand', 'gy', 'banished', 'pendulum', 'card' (a Spell/Trap in the hand or Set), 'destroyed' (by a card effect,
  // anywhere), 'destroyed:field' (on the field) or 'never': it needs more than the step (destroyed by battle or by
  // the opponent, flipped, Tributed, sent from the field) or waits a turn.
  function effectNeeds(card, { condition, text, pendulum }) {
    if (pendulum) return ['pendulum'];
    if (/\bexcept the turn (?:this card|it) was sent to the (?:GY|Graveyard)\b|\bduring (?:the|your) next Standby Phase\b/i.test(`${condition} ${text}`)) return ['never'];
    // "If this card is destroyed by card effect", "If this card on the field is destroyed by battle or card effect",
    // "If this card is Normal or Special Summoned, or destroyed by card effect": the line may destroy it.
    const destroyed = condition.match(/\bthis (?:face-up )?card (?:((?:in|on) the (?:field|Monster Zone)|in your possession) )?(?:is |was )?(?:(?:Normal|Special|Flip|Tribute)\b[^,:]*?\bSummoned,? or )?destroyed\b([^:]*)/i);
    const destroyable = destroyed && !/\bopponent\b|\bin your possession\b/i.test(destroyed[0]) && !(/\bby battle\b/i.test(destroyed[2]) && !/\beffects?\b/i.test(destroyed[2]));
    const rest = destroyable ? condition.replace(destroyed[0], ' ') : condition;
    // "If this Fusion Summoned card is destroyed", "If this Synchro Summoned card is sent to the GY as Synchro Material",
    // "If this Set card ... has left the field", "If an Effect Monster(s) is Special Summoned to a zone(s) this card
    // points to", "When your opponent Special Summons a monster": more than the line does (unless "this card is Link
    // Summoned, or ..." gives another way: Cyberse Contract Witch).
    if (!/\bthis card is\b[^:]*?\bSummoned\b/i.test(rest) && /\b(?:a|an|another|other|1|one|your|your opponent's)\b[^:]*?\bmonsters?(?:\(s\))? (?:is|are) (?:(?:Normal|Special|Tribute|Flip|Ritual|Fusion|Synchro|Xyz|Link|Pendulum) )?Summoned\b|\b(?:you|your opponent|a player) (?:(?:Normal|Special|Tribute|Ritual|Fusion|Synchro|Xyz|Link|Pendulum) )?Summons?\b/i.test(rest)) return ['never'];
    if (/^\s*FLIP\b/i.test(condition) || destroyed && !destroyable && !/\bSummoned\b/i.test(destroyed[0]) || /\bthis (?:(?:Normal|Tribute|Special|Ritual|Fusion|Synchro|Xyz|Link|Pendulum) Summoned|Set) card\b/i.test(condition) || /\bthis card (?:is |was |has )?(?:destroyed|Tributed|flipped|detached|returned|targeted|used as|attacked|attacks|battles|leaves the field|left the field|destroys)\b|\bthis (?:face-up )?card (?:is |was )?(?:sent|banished|removed) from the (?:field|Monster Zone)\b|\bthis (?:face-up )?card (?:in|on) the (?:field|Monster Zone) (?:leaves|is destroyed)\b/i.test(rest)) return ['never'];
    const needs = new Set(), summoned = condition.match(/\bthis card (?:is|was) ((?:(?:Normal|Special|Tribute|Flip|Ritual|Fusion|Synchro|Xyz|Link|Pendulum),? (?:or |and(?:\/or)? )?)*)Summoned\b(?: from (?:your |the )?((?:hand|GY|Graveyard|Deck|Extra Deck|banishment)(?:,? (?:or |and(?:\/or)? )?(?:hand|GY|Graveyard|Deck|Extra Deck|banishment))*))?/i);
    if (summoned) {
      const kinds = summoned[1].match(/\w+/g)?.filter(word => !/^(?:or|and)$/i.test(word)).map(word => word.toLowerCase()) || ['normal', 'special'], from = String(summoned[2] || '');
      for (const kind of kinds) {
        if (kind === 'normal') needs.add('summon:normal');
        else if (kind === 'special') {
          if (!from || /deck/i.test(from)) needs.add('summon:special');
          if (/hand/i.test(from)) needs.add('summon:hand');
          if (/GY|Graveyard/i.test(from)) needs.add('summon:gy');
        }
        else if (!['tribute', 'flip'].includes(kind)) needs.add(`summon:${kind}`);
      }
    }
    if (destroyable) needs.add(destroyed[1] ? 'destroyed:field' : 'destroyed');
    const all = `${condition} ${text}`;
    for (const match of all.matchAll(/\bthis card (?:is )?(?:in|from) (?:your |the )?((?:hand|GY|Graveyard|banishment)(?:,? (?:or |and(?:\/or)? )?(?:hand|GY|Graveyard|banishment))*)/gi))
      for (const place of match[1].match(/hand|GY|Graveyard|banishment/gi)) needs.add(/^hand$/i.test(place) ? 'hand' : /^banishment$/i.test(place) ? 'banished' : 'gy');
    if (/\b(?:discard|reveal) this card\b|\bthis card is added to (?:your|the) hand\b/i.test(all)) needs.add('hand');
    const sent = condition.match(/\bthis card is (?:sent|discarded) (?:from (?:the |your )?([\w ,/]+?) )?to the (?:GY|Graveyard)\b/i);
    if (sent && (!sent[1] || /deck/i.test(sent[1]))) needs.add('gy');
    if (/\bthis card is (?:currently )?banished\b|\bthis banished card\b/i.test(condition)) needs.add('banished');
    if (!needs.size) needs.add(summoned || sent ? 'never' : card.card_type === 'Monster' ? 'field' : 'card');
    return [...needs];
  }
  // "You can only use 1 "X" effect per turn": one effect of the card in a turn.
  const onlyOneEffect = card => indexedText(card).oneEffect ??= /\bYou can only use 1 (?:"+[^"]+"+ effect|of (?:the (?:following|preceding|above)|these|this card's|its) effects(?: of "+[^"]+"+)?) per turn\b/i.test(quoteText(card.effect + ' ' + (card.pendulum_effect || '')));
  // From the hand, a monster reaches the field by its Normal Summon or by Special Summoning itself.
  // Without Tributing, or a Trap activated from the hand, when the line meets the condition before it ("If you control no
  // monsters", "If your opponent has 2 or more cards in their hand"; not "If your opponent controls a monster", nor "If
  // your LP are 1000 or less").
  const permitted = (card, words) => [...quoteText(card.effect).matchAll(new RegExp(String.raw`(?:^|[.:\n]\s*)([^.:\n]*?)\b(?:you can |can be )?${words}`, 'gi'))]
    .some(match => !match[1].replace(/\byour opponent has (?:\d+|two) or more cards in (?:their|his or her) hand\b/gi, ' ').replace(LINE_CONDITION, ' ').trim());
  const normalSummonable = card => card.card_type === 'Monster' && !extraDeckMonster(card) && !summonRule(card).noNormal && (Number(card.level) <= 4 || permitted(card, 'Normal Summon this card without Tributing'));
  // A Trap is activated from the hand only when its text says so; a Quick-Play Spell or Trap Set this turn waits; a
  // Ritual Spell needs its Ritual Monster in the hand.
  const activatable = (card, place) => card.card_type === 'Spell' && card.type === 'Ritual' ? false : card.card_type === 'Trap' ? place === 'hand' && permitted(card, '(?:activate this card from your hand|activated from your hand)')
    : !(card.card_type === 'Spell' && card.type === 'Quick-Play' && place === 'set');
  // How a monster Special Summons itself from the hand or the GY: 'procedure' (a Summoning procedure, not an
  // effect), 'effect', or ''. Its costs and conditions are not checked.
  function selfSummon(card) {
    const entry = indexedText(card);
    if (entry.selfSummon) return entry.selfSummon;
    const self = { hand: '', gy: '' };
    const set = (places, how) => { for (const place of String(places).match(/hand|GY|Graveyard/gi) || []) { const key = /hand/i.test(place) ? 'hand' : 'gy'; if (self[key] !== 'procedure') self[key] = how; } };
    // Only what a one-card line can do: not "send 1 face-up LIGHT Normal Monster you control to the Graveyard; Special
    // Summon this card from your hand or Graveyard" (Ignoble Knight of Black Laundsallyn), nor "by having exactly 5 DARK
    // monsters in your GY" (Umbramirage the Elemental Lord).
    for (const effect of new Set(cardClauses(card).effects)) {
      if (effect.pendulum || !lineAlone(card, effect)) continue;
      const text = effect.text;
      for (const match of text.matchAll(/\bSpecial Summon this card\b[^.;]*?\bfrom your ((?:hand|GY|Graveyard)(?:,? (?:or |and(?:\/or)? )?(?:hand|GY|Graveyard))*)/gi)) set(match[1], 'effect');
      for (const match of text.matchAll(/\bthis card is in your ((?:hand|GY|Graveyard)(?:,? (?:or |and(?:\/or)? )?(?:hand|GY|Graveyard))*)[^.]*?:[^.]*?\bSpecial Summon (?:it|this card)\b/gi)) set(match[1], 'effect');
      for (const match of text.matchAll(/\b(?:Must (?:first )?be Special Summoned|(?:You can )?Special Summon this card) \(from your ((?:hand|GY|Graveyard)(?:,? (?:or |and(?:\/or)? )?(?:hand|GY|Graveyard))*)\)/gi)) set(match[1], 'procedure');
    }
    return entry.selfSummon = self;
  }
  // How a card destroys itself with one of its effects: "destroy this card", or "destroy 1 <cards> you control /
  // on the field / in your hand or face-up field" that it fits itself, not "1 other ...". Each: { effect, where,
  // field, hand: where it can be when destroyed, summonsItself: "Special Summon this card ..., then destroy 1 card you control" }.
  function selfDestroys(card) {
    const entry = indexedText(card);
    if (entry.selfDestroys) return entry.selfDestroys;
    const { names, clauses, effects } = cardClauses(card), ways = [];
    const place = /(?:1|one|up to \d+|\d+) (?!other\b)(.*?)\s*(you control|on the field|in your ((?:hand|Deck|face-up field|field)(?:,? (?:or |and )?(?:hand|Deck|face-up field|field))*))\b/i.source;
    clauses.forEach((clause, i) => {
      // "Target 1 monster you control; destroy it" may target itself (Scrap Raptor).
      const match = clause.match(new RegExp(String.raw`\bdestroy (?:this card|${place})`, 'i')) ||
        /^\s*destroy (?:it|that (?:target|card|monster))\b/i.test(clause) && effects[i - 1] === effects[i] && clauses[i - 1].match(new RegExp(String.raw`\btarget ${place}`, 'i'));
      // "If the equipped monster would be destroyed ..., destroy this card instead" replaces a destruction.
      if (!match || effects[i].pendulum || /\binstead\b|\bwould be destroyed\b/i.test(effects[i].text)) return;
      const kind = String(match[1] || '').trim(), generic = /^(?:face-up )?(cards?|monsters?)$/i.exec(kind), phrase = kind && !generic && fetchPhrase(kind, names);
      if (kind && (generic ? /^monster/i.test(generic[1]) && card.card_type !== 'Monster' : !phrase || fetchRank(card, phrase, true) === Infinity)) return;
      const where = effectNeeds(card, effects[i]), zones = String(match[3] || '');
      if (where.some(need => need === 'never' || need.startsWith('destroyed'))) return;
      ways.push({ effect: effects[i], where, field: !match[3] || /field/i.test(zones), hand: /hand/i.test(zones), summonsItself: /\bSpecial Summon this card\b/i.test(effects[i].text) });
    });
    return entry.selfDestroys = ways;
  }
  // "If this card is destroyed by card effect while it has a "DoomZ" monster ... as material".
  const materialCondition = /\bwhile it has (.+?) as (?:an? )?(?:Xyz )?materials?\b/i;
  // One-card lines (user, 2026-10-30): a Starter reaches the card on its own, from a hand with only that card, the
  // Normal Summon free, an empty field and GY, and an opponent who has done nothing yet. Can this effect be used so?
  // Its condition may only say when (your turn) and where the card is (effectNeeds reads that); a condition this list
  // does not know counts as not met ("While this card is equipped", "If you control a "K9" monster", "if your
  // opponent has activated ..."). Its cost and targets (before the semicolon) may only be the card itself.
  const LINE_CONDITION = new RegExp([
    String.raw`\(Quick Effect\)`, String.raw`\bonce per (?:turn|Chain)\b`, String.raw`\bonce while this card is face-up on the field\b`,
    String.raw`\bduring (?:your|the|each|either player's) (?:Main Phase(?: 1| 2)?|turn|End Phase)\b`, String.raw`\(except during the Damage Step\)`, String.raw`\bthis turn\b`,
    // True for the starter in the hand; for the step, it assumes the starter is not a monster left on the field.
    String.raw`\byou control no (?:face-up )?(?:monsters|cards)\b`,
    String.raw`\b(?:(?:is |was )?(?:sent|discarded) (?:from (?:the |your )?(?:hand|Deck|field)(?: or (?:hand|Deck|field))? )?to (?:the |your )?(?:GY|Graveyard))\b`,
    String.raw`\bthis (?:face-up |Set )?card(?: (?:in|on|from) (?:your |the )?(?:hand|field|GY|Graveyard|Monster Zone|Pendulum Zone|Spell & Trap Zone|Deck))? (?:is |was |has been )?(?:(?:Normal|Special|Tribute|Flip|Ritual|Fusion|Synchro|Xyz|Link|Pendulum)(?:,? (?:or |and(?:\/or)? )?|\/))*(?:Summoned|sent|discarded|banished|destroyed|added|activated|revealed|Set|in your (?:hand|GY|Graveyard|Pendulum Zone)|in (?:the )?(?:GY|Graveyard))\b(?: (?:from|to|by|in|on) (?:your |the |a )?(?:hand|field|GY|Graveyard|Deck|Extra Deck|banishment|Monster Zone|card effects?|battle or card effects?|battle)| face-up)*`,
    // "If this card is Fusion Summoned or flipped face-up" (Master of Ham): where it is, which effectNeeds reads.
    String.raw`\bflipped(?: face-up)?\b`, materialCondition.source,
    // A coin or a die decides it: a line by chance (chanceOf).
    String.raw`\bthe result is (?:Heads|Tails|[^,:]*\d[^,:]*)|\byou call(?:ed)? it right\b`, String.raw`\b(?:if|when|while|you can|you may|and|or|then|also)\b`, String.raw`[,\s]+`
  ].join('|'), 'gi');
  const COST_VERB = String.raw`discard|tribute|send|banish|shuffle|return|reveal|detach|remove|target|select|destroy|excavate|equip|attach`;
  const COST_OBJECT = new RegExp(String.raw`\b(${COST_VERB})\w*\s+(?:up to\s+)?(\d+|a|an|one|two|three|all|any number of|your entire|your whole|both)\b((?:(?!\s+and\s+(?:${COST_VERB})\b)[^;])*?)(?=\s+and\s+(?:${COST_VERB})\b|,(?!\s*except\b)|;|$)`, 'gi');
  // others: the line's other monsters on the field (the Normal Summoned starter), which may pay a cost ("Tribute 1
  // Spellcaster monster": Magician's Rod → Illusion Magic) or meet "If you control a ... monster".
  function lineAlone(card, effect, others = []) {
    const entry = indexedText(card), seen = entry.alone ||= new Map();
    if (!others.length && seen.has(effect)) return seen.get(effect);
    // What works alone works with the starter too; with it, once per effect and starter.
    if (others.length) {
      if (!/\byou control no\b/i.test(effect.condition) && lineAlone(card, effect)) return true;
      const withOthers = entry.aloneWith ||= new Map(), key = others.map(other => other.id).join(','), known = withOthers.get(effect) || withOthers.set(effect, new Map()).get(effect);
      if (!known.has(key)) known.set(key, lineAloneWith(card, effect, others));
      return known.get(key);
    }
    const ok = lineAloneWith(card, effect, []);
    seen.set(effect, ok);
    return ok;
  }
  function lineAloneWith(card, effect, others) { return !aloneReason(card, effect, others); }
  // Why an effect does not work in a one-card line, as printed ('' when it works): its condition, what it counts, its cost.
  function aloneReason(card, effect, others = []) {
    const names = cardClauses(card).names, fitsKind = (other, kind) => { const generic = /^(?:face-up )?(cards?|monsters?)$/i.exec(kind); return generic ? !/^monster/i.test(generic[1]) || other.card_type === 'Monster' : (phrase => !!phrase && fetchRank(other, phrase, true) < Infinity)(fetchPhrase(kind, names)); };
    // "destroyed by the effect of a "Scrap" card" when it is one itself (Scrap Raptor destroys itself).
    const by = effect.condition.match(/\bby the effect of an? "§(\d+)§" (?:card|monster)\b/i), ownKind = by && indexedText(card).name.some(name => namePart(name, normalize(names[by[1]] || '')));
    const condition = (ownKind ? effect.condition.replace(by[0], ' ') : effect.condition).replace(/\byou control (?:a|an|1) ((?:face-up )?[^,:]*?(?:monster|card))\b/gi, (all, kind) => others.some(other => fitsKind(other, kind)) ? ' ' : all);
    // "If you control no monsters" is no longer true once the starter is on the field.
    const residue = (others.length ? condition.replace(/\byou control no (?:face-up )?(?:monsters|cards)\b/gi, ' OTHER ') : condition).replace(LINE_CONDITION, ' ').replace(/[()]/g, ' ').trim(), effects = [...new Set(cardClauses(card).effects)], next = effects[effects.indexOf(effect) + 1];
    // Not with "There must be another face-up "Madolche" monster on the field to activate and to resolve this effect"
    // (the next sentence), nor when the card is activated "only if" or "by targeting" something the line does not have,
    // nor for "up to the number of Spell Cards activated after this card's resolution" (but "the number of Rock monsters
    // you control +5"), "then discard 1 card", or a Ritual Summon (its Tributes).
    const only = card.card_type !== 'Monster' && effects.find(other => /^Activate (?:this card )?(?:only|by)\b/i.test(other.text));
    // A bullet's cost is in its own text, after the header; a bullet that "Effect Monsters you control gain" is another
    // monster's effect.
    const own = effect.own ?? effect.text, ownCondition = effect.own ? own.match(/^([^;]*?):/)?.[1] || '' : effect.condition.trim();
    const granted = effect.own !== undefined && /\bgains? this effect\b/i.test(effect.text.slice(0, effect.text.length - own.length));
    // A condition that is not met is named with what else is missing ("If you control a Dragon monster: Discard 2 cards").
    const reasons = residue ? [effect.condition] : [], also = reason => [...reasons, reason].join('; ');
    if (granted) return also('a monster that grants it this effect');
    if (/^There must be\b/i.test(next?.text || '')) return also(next.text);
    const counts = effect.text.match(/\bnumber of\b[^.;]*\b(?:activated|you control|in your (?:GY|Graveyard|hand)|on the field|your opponent)\b(?!\s*\+\s*\d)|\bnumber of [\w-]+ Counters?\b|\bthen discard (?:1|\d+) cards?\b|\bRitual Summon\b(?! this card\b)|\beffect that Ritual Summons\b/i);
    if (counts) return also(/Ritual Summon/i.test(counts[0]) ? 'monsters to Tribute for a Ritual Summon' : /^number/i.test(counts[0]) ? `the ${counts[0]}` : 'a card to discard');
    if (only && only.text.replace(/^Activate (?:this card )?(?:only|by)\b/i, ' ').replace(LINE_CONDITION, ' ').replace(/\b(?:by|during)\b/gi, ' ').trim()) return also(only.text);
    // The cost and targets: after the condition, before the semicolon; in an older text, before ", then" or "and if you
    // do" ("Shuffle 3 LIGHT monsters from your hand into the Deck, then add ..."), or what comes before the Deck's
    // card ("select 1 face-up "Scrap" monster you control, except this card, destroy it, and send 1 Tuner monster from
    // your Deck": Scrap Hunter); a procedure's whole sentence ("by having exactly 5 DARK monsters in your GY").
    const from = ownCondition ? own.indexOf(ownCondition) + ownCondition.length + 1 : 0, body = own.slice(Math.max(from, 0)), semicolon = body.indexOf(';');
    const then = body.match(/^(.*?),?\s*(?:and if you do|then)\b/i), deck = body.search(/\b(?:from|of) (?:your|the) (?:Main |Extra )?Deck\b/i);
    const before = deck > 0 ? body.slice(0, deck).match(/^(.*)(?:,\s*(?:and\s+)?|\s+and\s+)/i)?.[1] || '' : '';
    const cost = semicolon >= 0 ? body.slice(0, semicolon) : /\bSpecial Summon(?:ed)? (?:this card )?\(from your\b/i.test(body) ? body : then && (deck < 0 || then[1].length < deck) ? then[1] : before;
    // A bullet shares its header's cost ("Pay 1000 LP; activate 1 of these effects").
    const header = effect.own !== undefined ? effect.text.slice(0, effect.text.length - own.length).split(';').slice(0, -1).join(';') : '';
    if (cost || header) {
      const needs = effectNeeds(card, effect), inHand = needs.includes('hand'), onField = needs.some(need => need === 'field' || need.startsWith('summon'));
      // "pay 1000 LP", "detach 1 material from this card", "Tribute this card"; "Tribute 1 "Noble Knight" monster" that it
      // is, from where it is: not "discard 1 DARK monster" for an effect used on the field (Dark Grepher), nor "Tribute 1
      // "Magician Girl" monster, except "Lemon Magician Girl"", nor "except this card".
      let rest = `${header} ${cost}`.replace(/\bthis (?:face-up )?card(?: (?:in|from) your hand)?\b/gi, 'ITSELF').replace(/\bpay (?:\d+|half your) (?:LP|Life Points)\b/gi, ' ').replace(/\b(?:detach|remove) (?:1|\d+) (?:Xyz )?materials? from ITSELF\b/gi, ' ');
      rest = rest.replace(COST_OBJECT, (all, verb, count, object) => {
        // Cards from the Deck are there ("send any number of Equip Spells ... from your Deck to the GY": Isolde), but the
        // face-up Extra Deck is empty ("Banish 5 face-up Pendulum Monsters from your Extra Deck": Pendulum Pendant).
        if (/\b(?:from|in) your (?:Main |Extra )?Deck\b/i.test(object) && !/\bopponent\b/i.test(object)) return /\bface-up\b/i.test(object) && /\bExtra Deck\b/i.test(object) ? ' OTHER ' : ' ';
        // The line's GY and banishment are empty.
        if (/\b(?:in|from) (?:your|either) (?:GY|Graveyard)\b|\bbanish(?:ed|ment)\b/i.test(object)) return ' OTHER ';
        const hand = /^(?:discard|reveal)/i.test(verb) || /\b(?:in|from) your hand\b/i.test(object), field = !hand && (/^(?:tribute|target|select|destroy|detach)/i.test(verb) || /\byou control\b|\b(?:on|from) the field\b/i.test(object));
        const where = hand ? inHand : field ? onField : inHand || onField;
        const kind = object.replace(/,?\s*except\b.*$/i, '').replace(/\b(?:you control|on the field|in your (?:hand|GY|Graveyard)|from your (?:hand|field|GY|Graveyard))\b.*$/i, '').trim();
        const own = /\bexcept ITSELF\b/.test(object) || new RegExp(String.raw`\bexcept "§(?:${names.map((name, i) => normalize(name) === normalize(card.name) ? i : -1).filter(i => i >= 0).join('|') || 'x'})§"`).test(object);
        const single = /^(?:1|a|an|one)$/i.test(count) && !/\bother\b/i.test(object) && kind;
        // "target 1 monster you control" (Scrap Raptor): a bare kind, which the phrase reader leaves out.
        return single && (where && !own && fitsKind(card, kind) || !hand && others.some(other => fitsKind(other, kind))) ? ' ' : ' OTHER ';
      });
      // "discard this card and 1 Spell": another card with the card itself.
      if (/\bCounters?\b/i.test(`${header} ${cost}`) || /\bOTHER\b|\bITSELF and (?:up to )?(?:\d+|a|an|one|two)\b|\byou control\b|\bopponent\b|\bin your (?:hand|GY|Graveyard)\b|(?<!ITSELF )\bfrom your (?:GY|Graveyard)\b/i.test(rest)) return also(`${header} ${cost}`.replace(/\s+/g, ' ').trim());
    }
    return reasons.join('; ');
  }
  // A line that works by chance (user, 2026-10-30: shown, with when it works): '' or what has to go your way.
  function chanceOf(effect) {
    // "If the result is Heads: ..." follows its "Toss a coin." sentence.
    const result = String(effect?.condition || '').match(/\bthe result is (Heads|Tails|[^,:]*\d[^,:]*)|\byou call(?:ed)? it right\b/i);
    if (result) return /^(?:Heads|Tails)$/i.test(result[1] || '') ? `if the coin lands ${result[1]}` : result[1] ? `if the die shows ${result[1].trim()}` : 'if you call the coin toss right';
    const text = effect?.text || '', top = text.match(/\b(?:excavate|look at) the top (\d+) cards?\b/i);
    if (top) return `if it is in the top ${top[1]} card${top[1] === '1' ? '' : 's'}`;
    if (/\bexcavat/i.test(text)) return 'if it is among the excavated cards';
    const coin = text.match(/\b(?:Toss|Flip) a coin\b[^.]*?(?:\.\s*)?(?:If (?:the result is )?(Heads|Tails)|(call it right|call it))/i);
    if (coin) return coin[1] ? `if the coin lands ${coin[1]}` : 'if you call the coin toss right';
    const die = text.match(/\broll a (?:six-sided )?die\b[^.]*?(?:\.\s*)?[^.]*?\bIf (?:the result is|you roll) ([^,:;.]+)/i);
    if (die) return `if the die shows ${die[1].trim()}`;
    if (/\broll a (?:six-sided )?die\b/i.test(text)) return 'on the right die roll';
    if (/\brandom\b/i.test(text)) return 'if the random pick goes your way';
    return '';
  }
  // Can the card use this phrase's effect from that place? summon: the kind of Special Summon that put it there;
  // normal: the turn's Normal Summon is still free; material: the line's monster it has as material. Null, or
  // { normal, destroyed } when the use takes the Normal Summon or needs the card destroyed (by the starter or itself).
  function effectUse(card, phrase, place, summon, normal, material = null, others = []) {
    if (!phrase.effect) return { normal: false };
    if (phrase.dependent && onlyOneEffect(card) || !lineAlone(card, phrase.effect, others) || phrase.when && phrase.when.replace(LINE_CONDITION, ' ').trim()) return null;
    const needs = phrase.where ||= effectNeeds(card, phrase.effect), monster = card.card_type === 'Monster';
    // An Xyz Monster Special Summoned without material cannot detach any.
    if (place === 'summoned' && summon !== 'xyz' && !material && String(card.monster_color).includes('Xyz') && /\bdetach\b/i.test(phrase.effect.text)) return null;
    const has = phrase.effect.condition.match(materialCondition);
    if (has && !(material && fetchRank(material, fetchPhrase(has[1], cardClauses(card).names) || {}, true) < Infinity)) return null;
    // Destroyed in the Deck by the starter, a card is in the GY.
    if (place === 'destroyed') return needs.includes('destroyed') ? { normal: false, destroyed: 'starter' } : needs.includes('gy') ? { normal: false } : null;
    // From the hand or the GY, a monster may Special Summon itself (an effect counts against "1 effect per turn").
    const self = monster && ['hand', 'gy'].includes(place) && selfSummon(card)[place], selfOk = self === 'procedure' || self === 'effect' && !onlyOneEffect(card);
    if (needs.some(need => need === place || need === 'card' && !monster && ['hand', 'set'].includes(place) && activatable(card, place) || need === 'pendulum' && card.pendulum && ['hand', 'set'].includes(place) ||
      place === 'summoned' && ['field', 'summon:special', `summon:${summon}`].includes(need) || selfOk && ['field', 'summon:special', `summon:${place}`].includes(need))) return { normal: false };
    if (normal && place === 'hand' && normalSummonable(card) && needs.some(need => ['field', 'summon:normal'].includes(need))) return { normal: true };
    const destroyed = needs.find(need => need.startsWith('destroyed'));
    return destroyed ? destroysItself(card, phrase, destroyed, place, summon, normal) : null;
  }
  // An effect that needs the card destroyed works when another of its effects destroys it, where the card then is:
  // on the field once Summoned (or Set), else still in the hand. Not for a card that allows 1 effect per turn, nor
  // for "destroyed by card effect, except "<its own name>"".
  function destroysItself(card, phrase, need, place, summon, normal) {
    if (onlyOneEffect(card) || /\bdestroyed\b[^:]*?\bexcept "§\d+§"/i.test(phrase.effect.condition)) return null;
    for (const way of selfDestroys(card)) {
      if (way.effect === phrase.effect) continue;
      const use = effectUse(card, way, place, summon, normal);
      const field = use && (way.summonsItself || !way.where.includes(place));
      if (use && (field ? way.field : need === 'destroyed' && place === 'hand' && way.hand)) return { normal: use.normal, destroyed: 'self' };
    }
    return null;
  }
  // Archetype support: cards outside an archetype, ranked by the share of its monsters they can search or
  // summon (Access). Shown from 2 monsters and a quarter of them.
  function archetypeMembers(name) {
    const key = normalize(name), cards = Array.isArray(window.Cards) ? window.Cards : [], seen = new Set();
    return cards.filter(card => card.card_type === 'Monster' && !card.rush && !card.custom && !seen.has(card.name) && indexedText(card).name.some(n => namePart(n, key)) && seen.add(card.name));
  }
  function supportRank(card, name, members) {
    if (!members.length || indexedText(card).name.some(n => namePart(n, normalize(name)))) return Infinity;
    let reached = 0;
    for (const member of members) if (relatedRank(card, member, 'access') < Infinity) reached++;
    return reached >= 2 && reached / members.length >= 0.25 ? 1 - reached / members.length : Infinity;
  }
  // Card-text links: the phrase around a link, read like the reverse search, becomes the search. The
  // clicked name, card kind, frame, Spell/Trap property, Attributes, Types, Level, ATK/DEF and "non-"
  // exclusions all apply: "Level 5 or higher monster (LIGHT or DARK, Pyro or Aqua)", 'non-Warrior
  // "Vanquish Soul" monster'. offset: where the link starts in the text. Null when nothing is read.
  const actionWord = /\b(?:adds?|(?:special|normal|tribute|ritual|fusion|synchro|xyz|link) summons?|summons?|sets?|places?|sends?|targets?|destroys?|banish(?:es)?|returns?|reveals?|discard(?:s|ing)?|tribut(?:e|es|ing)|shuffles?|equips?|attach(?:es)?|excavates?|controls?|have|has|using|becomes?|declares?|choose|look at|activates?|takes?|treats?|makes?|apply)\b/gi;
  function phraseRequest(raw, offset) {
    const text = String(raw ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"), names = [];
    let masked = '', at = -1, cursor = 0, clicked = -1;
    for (const match of quoteMatches(text)) {
      if (at < 0 && offset < match.index) at = masked.length + offset - cursor;
      masked += text.slice(cursor, match.index);
      const index = names.push(match[1]) - 1;
      if (at < 0 && offset < match.index + match[0].length) { at = masked.length + 1; clicked = index; }
      masked += `"§${index}§"`; cursor = match.index + match[0].length;
    }
    if (at < 0) at = masked.length + offset - cursor;
    masked += text.slice(cursor);
    // The clause, then the object around the link (as in fetchClauses), read from the last verb before it.
    const around = (start, end, separator) => {
      let from = start;
      for (const match of masked.slice(start, end).matchAll(separator)) { const s0 = start + match.index; if (s0 >= at) return [from, s0]; from = s0 + match[0].length; }
      return [from, end];
    };
    let [start, end] = around(0, masked.length, /\b(?:while|if|unless)\b|[.;:\n●]+|\s+\+\s+|,\s*(?:and\s+)?(?:if you do|then)\b|\bthen\b|,\s*but\b|,\s*also\b|,\s*(?:and\s+)?(?=(?:(?:you|your opponent) can )?(?:add|Special Summon|Set|send|banish)\b)|,\s*(?=(?:you|your opponent|neither player) (?:can only|cannot|can't)\b)|\s+or,\s+(?=if\b)/gi);
    // A link inside a material bracket reads that bracket's objects separately.
    const open = masked.lastIndexOf('(', at), close = masked.indexOf(')', at);
    if (open >= start && close >= at && close < end && !masked.slice(open + 1, at).includes(')') && /\b(?:and|or)\s+\d+\s/i.test(masked.slice(open, close))) { start = open + 1; end = close; }
    // Objects also appear without counts: "a Synchro Monster and a non-Synchro monster".
    const groupStart = start;
    for (const match of masked.slice(groupStart, end).matchAll(/(?:\s+(?:and\/or|and)\s+|,\s*(?:and\/or\s+)?)(?=(?:(?:an?|no)\s+)?(?:"§\d+§"\s+)?(?:Level \d+(?: or (?:lower|higher|less|more))?\s+)?(?:non-)?(?:[A-Z][\w-]*(?:\s+[A-Z][\w-]*)?\s+)*(?:monsters?|Monsters?|Tuners?|Spells?|Traps?)\b)/g)) {
      const boundary = groupStart + match.index;
      if (/"§\d+§"[,]?\s*$/.test(masked.slice(start, boundary)) && /^\s*"§\d+§"/.test(masked.slice(boundary + match[0].length))) continue;
      if (!objectNoun.test(masked.slice(start, boundary))) continue;
      if (boundary < at) start = boundary + match[0].length; else { end = boundary; break; }
    }
    const clauseStart = start, parts = splitObjects(masked.slice(start, end));
    const part = parts.find(item => at - clauseStart >= item.start && at - clauseStart <= item.end) || parts[0];
    start = clauseStart + part.start; end = clauseStart + part.end;
    let head = start;
    for (const match of masked.slice(start, Math.max(start, at)).matchAll(actionWord)) {
      if (/^Set$/i.test(match[0]) && masked[start + match.index - 1] === '/') continue;
      // "monsters you control with 1200 ATK": control is a qualifier, not a new object.
      if (/^(?:controls?|have|has)$/i.test(match[0]) && objectNoun.test(masked.slice(start, start + match.index))) continue;
      head = start + match.index;
    }
    for (const match of masked.slice(at, end).matchAll(actionWord)) {
      if (/^Set$/i.test(match[0]) && masked[at + match.index - 1] === '/') continue;
      const before = masked.slice(at, at + match.index);
      if (/(?:[,;]\s*(?:(?:and|or)\s+)?(?:you can\s+)?|\b(?:to|and)\s+)$/i.test(before)) { end = at + match.index; break; }
    }
    const relationStart = head;
    for (const match of masked.slice(relationStart, end).matchAll(/\b(?:with|by)\s+(?=(?:non-)?(?:[A-Z][\w-]*\s+)*(?:[Mm]onster|Spell|Trap) effects\b)|\b(?:by battle with|with)\s+(?=(?:an?|all|1)\s+"§\d+§"\s+(?:Equip )?Spell)|\bby battle with\s+(?:an?\s+)?|\bto\s+(?=\d+\s+(?:(?:Rank|Level|Link)[- ]\d+ |"§\d+§"))|\bto (?:that|a|an|1)\s+(?:(?:face-up|appropriate) )?(?=(?:[A-Z][\w-]*\s+)*(?:monsters?|Monsters?))|,?\s+(?:by (?:banishing|sending|tributing|shuffling|returning|using|revealing|placing)|using)\s+|\bto (?:your |a )?zones?(?:\(s\))? (?:that )?(?:a |an )?|\b(?:number of|for each)\s+|\bwith (?:effects of|(?:non-)?[A-Z][\w-]* monster effects)\b|\bas (?=(?:Level|Rank|Link)[- ])|\b(?:listed|mentioned) on (?:that|the)\s+|\bfor the Tribute Summon of (?:an?|1)\s+|\bas well as\s+|\bup to (?:its|their)\s+|\bthe total (?:Levels?|Link Ratings?) of (?:the|your)\s+|\b(?:as|than|equals?(?: to)?) (?:1 of )?(?:the Level of )?(?:those|that|the) (?:destroyed |returned )?|,\s+(?=(?:monsters?|cards?) (?:your|you|cannot))|,\s+(?=(?:Level|Rank|Link)[ -]\d+|"§\d+§"\s+(?:monsters?|Monsters?))/g)) {
      const boundary = relationStart + match.index;
      if (boundary < at) head = boundary + match[0].length; else { end = boundary; break; }
    }
    const noun = masked.slice(at, end).match(/\b(?:monsters?|Monsters?|Tuners?|Spells?|Traps?|cards?)\b/);
    if (noun) {
      const after = at + noun.index + noun[0].length;
      const predicate = masked.slice(after, end).match(/^(?:\s+(?:you control|on the field|in (?:the |your )?(?:GY|Graveyard)|and|or))*\s+(?:is|are|becomes?|gains?|loses?|cannot(?! be Normal Summoned))\b|,\s*(?=(?:this card|it|they|that monster)\b)/i);
      if (predicate) end = after + predicate.index;
    }
    const shared = part.text.slice(part.end - part.start); // the noun borrowed from the next object, if any
    const leading = masked.slice(head).match(/^\s*(\w+) summons?\b/i);
    const direct = !/\b(?:this card|except|using|substitute|that uses)\b|,/.test(masked.slice(head, at)) && !(clicked >= 0 && /\bwith\b/.test(masked.slice(head, at)));
    const descriptions = splitDescriptions(masked.slice(head, end));
    const description = descriptions.find(part => at - head >= part.start && at - head <= part.end) || descriptions[0];
    const phrase = fetchPhrase(resolveMentions(description.text + shared, masked.slice(clauseStart, head)), names, leading && direct ? summonFrame(leading[1]) : '', false, false);
    if (!phrase) return null;
    if (leading && direct && !phrase.kinds && !phrase.refs.some(ref => ref.kinds?.some(kind => kind !== 'Monster')) && !/\bas (?:an? )?(?:Normal|Effect) Monsters?\b/i.test(description.text)) phrase.kinds = ['Monster'];
    if (leading && direct && /^(?:normal|tribute)$/i.test(leading[1])) phrase.normal = 'yes';
    // A Deck / hand description cannot include a card confined to the Extra Deck.
    const source = (description.text + shared).replace(/\bthat (?:was|were) Special Summoned[^]*/i, ''), main = mainDeckSource.test(source), extra = extraDeckSource.test(source);
    if (!/\b(?:GY|Graveyard|banished|banishment|field)\b/i.test(source)) {
      if (!extra && (main || /\bfrom (?:your|the) hand\b/i.test(source))) phrase.deck = 'main';
      else if (extra && !main) phrase.deck = /\bface-up Extra Deck\b/i.test(source) ? 'face-up extra' : 'extra';
    }
    const location = source.match(/\b(?:from|in)\s+([^.;]*?)(?=\b(?:to|with|that|whose|except|using|by)\b|$)/i)?.[1];
    if (location) {
      phrase.places = [];
      if (/\b(?<!Extra )Deck\b/i.test(location)) phrase.places.push('deck');
      if (/\bExtra Deck\b/i.test(location)) phrase.places.push('extra');
      if (/\bhand\b/i.test(location)) phrase.places.push('hand');
      if (/\b(?:GY|Graveyard)\b/i.test(location)) phrase.places.push('gy');
      if (/\bfield\b/i.test(location)) phrase.places.push('field');
      if (/\bbanish(?:ed|ment)\b/i.test(location)) phrase.places.push('banished');
    } else if (/\byou control\b|\bon the field\b/i.test(source)) phrase.places = ['field'];
    const ref = phrase.refs.find(r => r.index === clicked) || (clicked < 0 && phrase.refs.length === 1 && phrase.refs[0].mode !== 'exact' ? phrase.refs[0] : null);
    return requestFromPhrase(phrase, ref, masked.slice(head, end).replace(/"§(\d+)§"/g, (m, n) => `"${names[n]}"`).replace(/\s+/g, ' ').trim());
  }
  // A read phrase as constructor filters (and, for duels, the phrase itself): ref is the name searched.
  function requestFromPhrase(phrase, ref, label = '') {
    if (phrase.alternatives) return { text: '', field: 'name', cardTypes: [], frames: [], stProperties: [], attributes: [], types: [], abilities: [], stats: null, not: {}, phrase, label };
    const own = ref?.mode === 'member' ? null : ref, kinds = own?.kinds || phrase.kinds, frames = [...new Set([...(own?.frames || []), ...phrase.frames])];
    const properties = [...(own?.properties || []), ...phrase.properties], typeNames = monsterTypes().names;
    const not = { attribute: [], type: [], monster_color: [], ability: [], spell_trap: [] };
    for (const word of phrase.not) {
      const type = typeNames.find(name => name.toLowerCase() === word), frame = FRAMES.find(name => name.toLowerCase() === word);
      if (ATTRIBUTES.includes(word.toUpperCase())) not.attribute.push(word.toUpperCase()); else if (type) not.type.push(type);
      else {
        if (frame || word === 'token') not.monster_color.push(frame || 'Token');
        const ability = ['Tuner', ...ABILITIES].find(name => name.toLowerCase() === word);
        if (ability) not.ability.push(ability);
        for (const kind of kinds || []) for (const property of PROPERTIES[kind] || []) if (property.toLowerCase() === word) not.spell_trap.push(`${kind}:${property}`);
      }
    }
    const tuner = phrase.tuner || !!own?.tuner;
    if (phrase.needs === 'level' || phrase.stats.level) not.monster_color.push(...['Xyz', 'Link'].filter(frame => !frames.includes(frame)));
    if (phrase.stats.rank || phrase.needs === 'rank') frames.push(...(frames.includes('Xyz') ? [] : ['Xyz']));
    if (phrase.stats.link || phrase.needs === 'link') frames.push(...(frames.includes('Link') ? [] : ['Link']));
    const alternatives = Object.values(phrase.scaleAlternatives || {});
    const scale = phrase.stats.level || phrase.stats.rank || phrase.stats.link || (alternatives.length ? [
      alternatives.some(([low]) => low === '') ? '' : String(Math.min(...alternatives.map(([low]) => Number(low)))),
      alternatives.some(([, high]) => high === '') ? '' : String(Math.max(...alternatives.map(([, high]) => Number(high))))] : null), stats = { ...phrase.stats };
    delete stats.rank; delete stats.link; if (scale) stats.level = scale;
    if (phrase.statAlternatives) for (const key of ['atk', 'def']) { const values = phrase.statAlternatives.map(part => part[key][0]); if (!values.includes('?')) stats[key] = [String(Math.min(...values)), String(Math.max(...values))]; }
    const abilities = [...new Set([...(tuner ? ['Tuner'] : []), ...phrase.abilities, ...(own?.abilities || [])])];
    const monsterOnly = frames.length || abilities.length || phrase.relation || phrase.attributes.length || phrase.types.length || Object.keys(phrase.stats).length || tuner || Object.values(not).some(list => list.length);
    const cardTypes = kinds || (monsterOnly ? ['Monster'] : []);
    // A property limits only its own card type: "Quick-Play Spell or Trap" keeps every Trap.
    const stProperties = properties.length ? cardTypes.filter(type => PROPERTIES[type]).flatMap(type => {
      const own = properties.filter(property => property.startsWith(type + ':'));
      return own.length ? own : PROPERTIES[type].map(property => `${type}:${property}`);
    }) : [];
    return { text: ref?.label || '', field: ['mention', 'member'].includes(ref?.mode) ? 'effect' : 'name', cardTypes, frames, stProperties,
      attributes: phrase.attributes, types: [...new Set([...phrase.types, ...(own?.types || [])])], abilities, statRelation: phrase.relation === 'eq' ? 'eq' : '', stats: Object.keys(stats).length ? stats : null,
      not, phrase: { ...phrase, refs: ref ? [ref] : phrase.refs.filter(ref => ref.mode !== 'exact') }, label: label.length > 70 ? label.slice(0, 69) + '…' : label };
  }
  function inRange(value, low, high) {
    if (low === '' && high === '') return true;
    if (low === '?' || high === '?') return value === '?' && [low, high].every(v => v === '' || v === '?');
    if (value == null || value === '?' || !Number.isFinite(Number(value))) return false;
    return (low === '' || Number(value) >= Number(low)) && (high === '' || Number(value) <= Number(high));
  }
  const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  function compareCards(a, b, order, descending) {
    const byName = names.compare(a.name, b.name) || Number(a.id) - Number(b.id);
    if (order === 'Alpha') return descending ? -byName : byName;
    function value(card) {
      if (order === 'Date') return card.tcg_date || null;
      const key = { ATK: 'atk', DEF: 'def', LVL: 'level' }[order], raw = card[key];
      if (card.card_type !== 'Monster' || (order === 'DEF' || order === 'LVL') && card.monster_color === 'Link' ||
          raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw))) return null;
      return Number(raw);
    }
    const av = value(a), bv = value(b);
    // Unknown stats and unreleased dates stay last in either direction; zero is a real value.
    if (av === null || bv === null) return av === bv ? byName : av === null ? 1 : -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * (descending ? -1 : 1) || byName;
  }
  function matches(card, q, env) {
    const pool = Number(q.pool || 0), selected = (key, predicate) => (!q[key]?.length || q[key].some(predicate)) && !q[key + 'Not']?.some(predicate);
    if (!card.name || card.hidden == 1 && (pool !== 9 || !env.favorites.includes(card.id))) return false;
    if (pool === 0 && (card.rush || card.card_type === 'Skill' || !env.legal(card))) return false;
    if ([4, 5, 6, 9].includes(pool) && !env.pools[pool]?.includes(card.id)) return false;
    if (pool === 7 && !card.rush || pool === 8 && card.card_type !== 'Skill') return false;
    const text = indexedText(card);
    if (!indexedMatch(text.name, q.nameTerms || terms(q.name, q.nameMode), q.nameMode) ||
        !indexedMatch(text.effect, q.effectTerms || terms(q.effect, q.effectMode), q.effectMode)) return false;
    if (!selected('card_type', v => card.card_type === v) ||
        !selected('monster_color', v => v === 'Pendulum' ? card.pendulum : v === 'Effect' ? effectMonster(card) : String(card.monster_color).includes(v)) ||
        !selected('type', v => card.type === v) ||
        !selected('spell_trap', v => v === `${card.card_type}:${card.type}`) ||
        !selected('ability', v => v === 'Flip' ? !!Number(card.flip) || String(card.ability).includes('Flip') : String(card.ability).includes(v)) ||
        !selected('attribute', v => card.attribute === v)) return false;
    for (const key of ['level', 'atk', 'def', 'scale']) {
      const [low, high] = q[key] || ['', ''];
      if (low === '' && high === '') continue;
      if (card.card_type !== 'Monster' || key === 'scale' && !card.pendulum || !inRange(card[key], low, high)) return false;
    }
    if (q.pendulum && !card.pendulum || q.tcg && !card.tcg || q.ocg && !card.ocg) return false;
    if (!selected('limit', v => env.limit(card, pool, Number(v)))) return false;
    if (q.category?.length && !q.category.some(v => categoriesOf(card).has(v))) return false;
    if (!statMatch(card, q)) return false;
    if (q.phrase && !fitsPhrase(card, q.phrase)) return false;
    if (q.arrows?.some((on, i) => on && card.arrows?.[i] !== '1')) return false;
    if (q.described?.active) {
      // env.describeFound: the matches a description's slices worked out (describeTask).
      const hit = env.describeFound?.get(card) || describeRank(card, q.described);
      if (hit.rank === Infinity) return false;
      env.describeRanks?.set(card, hit.rank); env.describeWhy?.set(card, hit.why);
    }
    if (q.fetches) {
      let rank;
      // env.fetchFound: the ranks a search's slices worked out (fetchRanksTask).
      if (env.fetchMode === 'starters' || env.fetchMode === 'ideas') { const found = env.fetchFound?.get(card) || (env.fetchMode === 'ideas' ? ideaRank(card, env.fetchTarget, env.starterVia || [], env.ideaVia || []) : starterRank(card, env.fetchTarget, env.starterVia || [])); rank = found.rank; if (found.how) { env.starterSteps?.set(card, found.via || null); env.starterHow?.set(card, found.how); } }
      else if (env.fetchMode === 'support') rank = supportRank(card, env.supportName, env.supportMembers || []);
      else rank = env.fetchFound?.has(card) ? env.fetchFound.get(card) : relatedRank(card, env.fetchTarget, env.fetchMode);
      env.fetchRanks?.set(card, rank); if (rank === Infinity) return false;
    }
    if (q.lab) { const rank = labRank(card, env.lab); env.labRanks?.set(card, rank); if (rank === Infinity) return false; }
    return !q.pointsEnabled || inRange(env.points(card), ...q.points);
  }
  const element = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  let clearSearch = () => {}, syncFetch = () => {}, syncLab = () => {};
  // Search history: the last 10 distinct queries. A card-text link records the query it replaces,
  // so Back returns to it; typed searches are recorded once they settle.
  const HISTORY_SIZE = 10;
  let history = [], historyTimer, historyUI = null, restoringHistory = false;
  // The search's own fields; the Access choices (⚙) are a preference, not part of a search.
  const FIELD_NODES = 'input:not(.dblite-access-options input),select';
  function queryState() {
    const fieldsRoot = ui?.querySelector('.dblite-builder-fields');
    if (!fieldsRoot) return null;
    return [...fieldsRoot.querySelectorAll(FIELD_NODES)].map(node => node.type === 'checkbox' ? (node.dataset.exclude ? 'exclude' : node.checked) : node.value);
  }
  const blankState = state => !state || state.every((value, i) => {
    const node = [...ui.querySelector('.dblite-builder-fields').querySelectorAll(FIELD_NODES)][i];
    return value === false || value === '' || node?.tagName === 'SELECT' && value === node.options[0]?.value;
  });
  // History label: every condition of the current search, e.g. 'Name “Artmage” · Monster · Level ≥7',
  // and the card whose overview link started it ('· from Artmage Diactorus').
  function describeState(origin = '') {
    const q = read(), parts = [], label = node => node.parentElement?.textContent.trim();
    const reverse = reverseOf(q.fetches), target = reverse && reverse.mode !== 'support' && catalogCard(reverse.id);
    if (reverse?.mode === 'support') parts.push(`Support for “${reverse.id}”`);
    else if (target) parts.push(reverse.mode === 'synergy' ? `Synergy with “${target.name}”` : reverse.mode === 'starters' ? `Starters for “${target.name}”` : reverse.mode === 'ideas' ? `Ideas for “${target.name}”` : `Access to “${target.name}”`);
    const lab = labOf(q.lab);
    if (lab) parts.push(`${lab.mode === 'includes' ? 'With' : 'Made from'} ${lab.materials.map(m => `“${m.name}”`).join(' + ')}`);
    if (q.describe.trim()) parts.push(`“${q.describe.trim()}”`);
    if (q.name) parts.push(`Name “${q.name}”`);
    if (q.effect) parts.push(`Text “${q.effect}”`);
    if (q.phrase?.normal) parts.push(q.phrase.normal === 'no' ? 'Cannot be Normal Summoned/Set' : 'Can be Normal Summoned/Set');
    if (q.phrase?.textHas?.length) parts.push(...q.phrase.textHas.map(word => word.startsWith('counter:') ? word.slice(8) + ' Counter' : word === 'coin' ? 'Coin toss' : 'Die roll'));
    if (q.phrase?.relation === 'ne') parts.push('ATK ≠ DEF');
    if (q.phrase?.deck) parts.push(q.phrase.deck === 'main' ? 'Main Deck' : q.phrase.deck === 'extra' ? 'Extra Deck' : 'Face-up Extra Deck');
    if (q.phrase?.numberRange) parts.push(`${q.phrase.numberRange.prefix || 'Number'} ${q.phrase.numberRange.low}–${q.phrase.numberRange.high}`);
    for (const inputs of Object.values(multis)) {
      const on = inputs.filter(n => n.checked && !n.dataset.exclude).map(label);
      if (on.length) parts.push(on.join(' or '));
      parts.push(...inputs.filter(n => n.dataset.exclude).map(n => 'not ' + label(n)));
    }
    const rangeNames = { level: 'Level', atk: 'ATK', def: 'DEF', scale: 'Scale', points: 'Points' };
    for (const [key, inputs] of Object.entries(ranges)) {
      const [low, high] = inputs.map(n => n.value.trim());
      if (low === '' && high === '' || key === 'points' && !q.pointsEnabled) continue;
      parts.push(`${rangeNames[key] || key} ${low === high ? low : low === '' ? '≤' + high : high === '' ? '≥' + low : low + '–' + high}`);
    }
    for (const key of ['pendulum', 'tcg', 'ocg']) if (q[key]) parts.push(label(controls[key]));
    const arrows = controls.arrows.filter(n => n.checked).map(label).join('');
    if (arrows) parts.push(`Arrows ${arrows}`);
    const optionText = node => node.selectedOptions?.[0]?.textContent || node.value;
    if (q.statRelation) parts.push(optionText(controls.statRelation));
    if (q.statExpr && q.statValue) parts.push(`${optionText(controls.statExpr)} ${optionText(controls.statCompare)} ${q.statValue}`);
    if (controls.pool.selectedIndex > 0) parts.push(optionText(controls.pool));
    const words = parts.join(' · ') || 'All cards';
    return origin ? `${words} · from ${origin}` : words;
  }
  function recordQuery(now = false, origin = '') {
    clearTimeout(historyTimer);
    if (restoringHistory || !ui) return;
    const save = () => {
      const state = queryState();
      if (blankState(state) || history.some(entry => JSON.stringify(entry.state) === JSON.stringify(state))) return;
      history.push({ state, label: describeState(origin), page });
      if (history.length > HISTORY_SIZE) history.shift();
      renderHistory();
    };
    if (now) save(); else historyTimer = setTimeout(save, 1200);
  }
  function restoreQuery(entry) {
    const nodes = [...ui.querySelector('.dblite-builder-fields').querySelectorAll(FIELD_NODES)];
    restoringHistory = true;
    try {
      entry.state.forEach((value, i) => {
        const node = nodes[i]; if (!node) return;
        if (node.type === 'checkbox') { if (filterState(node) !== filterState(value)) setFilter(node, filterState(value)); }
        else node.value = value;
      });
      // A search in slices keeps the page for when it ends (fetchReady).
      run(); if (fetchJob) fetchJob.page = entry.page || 1; else { page = entry.page || 1; render(); }
    } finally { restoringHistory = false; }
    renderHistory();
  }
  // Back steps to the query recorded before the current one (history stays in time order).
  function goBack() {
    const current = JSON.stringify(queryState()), index = history.findIndex(entry => JSON.stringify(entry.state) === current);
    const entry = history[(index < 0 ? history.length : index) - 1];
    if (entry) restoreQuery(entry);
  }
  function renderHistory() {
    if (!historyUI) return;
    const { back, recent } = historyUI, current = JSON.stringify(queryState());
    back.disabled = history.findIndex(entry => JSON.stringify(entry.state) === current) === 0 || !history.some(entry => JSON.stringify(entry.state) !== current);
    recent.replaceChildren(Object.assign(element('option', `Recent (${history.length})`), { value: '' }));
    [...history].reverse().forEach((entry, i) => {
      const option = element('option', entry.label.length > 90 ? entry.label.slice(0, 89) + '…' : entry.label); option.title = entry.label;
      option.value = String(history.length - 1 - i); recent.append(option);
    });
    recent.disabled = !history.length; recent.value = '';
  }
  const filterState = node => typeof node === 'string' ? node : node === true ? 'include' : !node ? '' : node.dataset?.exclude ? 'exclude' : node.checked ? 'include' : '';
  function setFilter(input, state) {
    input.checked = !!state;
    if (state === 'exclude') input.dataset.exclude = '1'; else delete input.dataset.exclude;
    input.dispatchEvent(new Event('change'));
  }
  // Card preview links: search a name (or a description for "mentions") with every condition read from
  // the phrase around it (phraseRequest): card types, frames, Spell/Trap properties, Attributes, Types,
  // abilities, Level / ATK / DEF ranges, and exclusions (not: { type, attribute, monster_color, ability }).
  // Conditions without a matching search control travel with the query and its history.
  function linkConditions(phrase) {
    if (!phrase) return null;
    if (phrase.alternatives) return phrase;
    const stats = Object.fromEntries(Object.entries(phrase.stats || {}).filter(([, bounds]) => bounds.includes('?')));
    if (!phrase.normal && !phrase.deck && !phrase.mentionedOn?.refs && !phrase.places?.length && !phrase.scaleParity && !phrase.numberRange && !phrase.statAlternatives && !phrase.refs?.length && !phrase.excluded?.length && !phrase.textHas?.length && !phrase.values && !phrase.scaleAlternatives && phrase.relation !== 'ne' && !Object.keys(stats).length) return null;
    const refs = phrase.refs.map(ref => ref.mode === 'member' ? ref : ({ ...ref, kinds: null, frames: [], properties: [], tuner: false, abilities: [] }));
    return { refs, kinds: null, frames: [], properties: [], tuner: false, abilities: [], attributes: [], types: [], not: [], excluded: phrase.excluded,
      normal: phrase.normal, deck: phrase.deck, mentionedOn: phrase.mentionedOn?.refs ? phrase.mentionedOn : undefined, places: phrase.places, scaleParity: phrase.scaleParity, numberRange: phrase.numberRange, statAlternatives: phrase.statAlternatives, textHas: phrase.textHas || [], relation: phrase.relation === 'ne' ? 'ne' : '', stats, values: phrase.values, scaleAlternatives: phrase.scaleAlternatives };
  }
  function searchFor({ text = '', field = 'name', cardTypes = [], stats = null, frames = [], stProperties = [], attributes = [], types = [], abilities = [], not = {}, statRelation = '', phrase = null, origin = '' } = {}) {
    const conditions = !!statRelation || [cardTypes, frames, stProperties, attributes, types, abilities, ...Object.values(not || {})].some(list => list?.length);
    if (!ui || !active || window.currentLabel !== 'deck_constructor' || !text && !stats && !conditions) return false;
    recordQuery(true);
    clearSearch();
    controls.phrase.value = JSON.stringify(linkConditions(phrase));
    if (text) controls[field === 'effect' ? 'effect' : 'name'].value = text;
    // '?' stats cannot be typed into the numeric bounds; those searches only set the card type.
    for (const [key, bounds] of Object.entries(stats || {})) if (ranges[key] && Array.isArray(bounds) && !bounds.includes('?')) ranges[key].forEach((input, i) => { input.value = bounds[i] ?? ''; });
    // Older requests name one Type / Attribute next to the stats ("Cyberse monster with 2300 ATK").
    const pick = (key, include, exclude = []) => { for (const input of multis[key] || []) setFilter(input, include.includes(input.value) ? 'include' : exclude.includes(input.value) ? 'exclude' : ''); };
    pick('card_type', cardTypes); pick('monster_color', frames, not?.monster_color); pick('spell_trap', stProperties, not?.spell_trap); pick('ability', abilities, not?.ability);
    pick('attribute', [...attributes, ...(stats?.attribute ? [stats.attribute] : [])], not?.attribute);
    pick('type', [...types, ...(stats?.type ? [stats.type] : [])], not?.type);
    if (statRelation) controls.statRelation.value = statRelation;
    run(); recordQuery(true, origin); return true;
  }
  // Card overview links: Access (the cards that add or summon this card from its Deck) and Synergy (see relatedRank).
  function searchFetchers(id, name, mode = 'access') {
    if (!SYNERGY_ENABLED && mode === 'synergy') return false;
    const target = catalogCard(id, name);
    if (!ui || !active || window.currentLabel !== 'deck_constructor' || !target) return false;
    recordQuery(true);
    clearSearch();
    controls.fetches.value = `${['synergy', 'starters', 'ideas'].includes(mode) ? mode : 'access'}:${target.id}`;
    run(); recordQuery(true); return true;
  }
  // Card overview link: generic and other support for an archetype.
  function searchSupport(name) {
    if (!ui || !active || window.currentLabel !== 'deck_constructor' || !name) return false;
    recordQuery(true); clearSearch(); controls.fetches.value = `support:${encodeURIComponent(name)}`; run(); recordQuery(true); return true;
  }
  // Card overview link: cards that fill what a Summon Lab result still needs.
  function searchNeed(id) {
    if (!SUMMON_LAB_ENABLED) return false;
    const card = catalogCard(id), needs = card && labNeeds(card, labOf(controls.lab?.value));
    if (!needs?.request) return false;
    return searchFor({ ...needs.request, origin: card.name });
  }
  // Card overview links of a Lab result's breakdown: the cards one way of filling an Any slot takes ('fit'),
  // or the cards that fill what that way still needs ('need').
  function searchLabWay(id, slot, way, part = 'fit') {
    if (!SUMMON_LAB_ENABLED) return false;
    const card = catalogCard(id), found = card && labDetail(card, labOf(controls.lab?.value))?.slots[slot]?.ways[way];
    const request = part === 'need' ? found?.needs?.request : found?.request;
    return request ? searchFor({ ...request, origin: card.name }) : false;
  }
  let ui, query, results = [], page = 1, gridSize = 'm', layout = 'tall', descending = false, lastGenesys, active = false, wasConstructor = false, debounce;
  const controls = {}, multis = {}, ranges = {};
  let practicePlan = null, soloButton, soloGear, soloSettingsPanel;
  let soloSettings = { handCount: 5, stackCount: 0, ordered: false };
  try {
    const saved = JSON.parse(localStorage.getItem('dbetter-solo-settings'));
    for (const key of ['handCount', 'stackCount']) if (Number.isInteger(saved?.[key]) && saved[key] >= 0 && saved[key] <= 60) soloSettings[key] = saved[key];
    soloSettings.ordered = saved?.ordered === true;
  } catch {}
  function closeSoloSettings() { soloSettingsPanel?.remove(); soloSettingsPanel = null; soloGear?.setAttribute('aria-expanded', 'false'); }
  function showSoloSettings() {
    if (soloSettingsPanel) { closeSoloSettings(); return; }
    const panel = soloSettingsPanel = element('section', '', 'dblite-solo-settings');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Solo settings'); soloGear.setAttribute('aria-expanded', 'true');
    const header = element('header'), close = element('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close Solo settings'); close.onclick = () => { closeSoloSettings(); soloGear.focus(); };
    header.append(element('strong', 'Solo settings'), close); panel.append(header);
    const hint = element('p');
    const save = () => {
      try { localStorage.setItem('dbetter-solo-settings', JSON.stringify(soloSettings)); } catch {}
      hint.textContent = soloSettings.ordered ? 'Hand: the first cards in constructor order. Stack: the next cards, kept in that order on top.' : 'Hand: random cards. Stack: the first cards in constructor order, reserved before drawing your hand.';
      soloGear.title = `${soloSettings.handCount} in hand · ${soloSettings.ordered ? 'constructor order' : 'random'} · ${soloSettings.stackCount} on top`;
    };
    for (const [key, text] of [['handCount', 'Cards in hand'], ['stackCount', 'Cards stacked on top']]) {
      const label = element('label', text), input = element('input'); input.type = 'number'; input.min = '0'; input.max = '60'; input.step = '1'; input.value = soloSettings[key]; input.setAttribute('aria-label', text);
      input.onchange = () => { if (input.validity.valid && Number.isInteger(input.valueAsNumber)) soloSettings[key] = input.valueAsNumber; else input.value = soloSettings[key]; save(); };
      label.append(input); panel.append(label);
    }
    const label = element('label', '', 'dblite-solo-order'), ordered = element('input'); ordered.type = 'checkbox'; ordered.checked = soloSettings.ordered;
    ordered.onchange = () => { soloSettings.ordered = ordered.checked; save(); };
    label.append(ordered, document.createTextNode('Use constructor order')); panel.append(label, hint); save();
    for (const type of ['keydown','keyup','mousedown','click']) panel.addEventListener(type, e => { e.stopPropagation(); if (type === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeSoloSettings(); soloGear.focus(); } });
    document.body.append(panel);
    const r = soloGear.getBoundingClientRect(); panel.style.left = Math.max(8, Math.min(r.right, innerWidth - 288)) + 'px'; panel.style.top = Math.max(8, Math.min(r.top, innerHeight - panel.offsetHeight - 8)) + 'px';
    panel.querySelector('input').focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', e => { if (soloSettingsPanel && !soloSettingsPanel.contains(e.target) && e.target !== soloGear) closeSoloSettings(); });
  // ⤢ under the overview: the sizes of the overview, its picture and text, and of the search; the deck takes the rest.
  let overviewButton, overviewPanel;
  function closeOverviewSettings() { overviewPanel?.remove(); overviewPanel = null; overviewButton?.setAttribute('aria-expanded', 'false'); }
  function showOverviewSettings() {
    if (overviewPanel) { closeOverviewSettings(); return; }
    const panel = overviewPanel = element('section', '', 'dblite-solo-settings dblite-overview-settings');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Overview, search and deck sizes'); overviewButton.setAttribute('aria-expanded', 'true');
    const header = element('header'), close = element('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close sizes'); close.onclick = () => { closeOverviewSettings(); overviewButton.focus(); };
    header.append(element('strong', 'Sizes'), close); panel.append(header);
    const rows = [], deck = element('p'), sync = () => { for (const row of rows) row(); deck.textContent = `Deck: ${Math.round(deckScale(currentWidth()) * 100)}% of its size. It shrinks to make room for the overview and the search. Saved on this device.`; };
    const add = (label, min, max, get, set) => {
      const row = element('label', '', 'dblite-size-row'), caption = element('span', label), output = element('output'), input = element('input');
      input.type = 'range'; input.step = '5'; input.setAttribute('aria-label', label);
      rows.push(() => { input.min = String(min()); input.max = String(Math.max(min(), max())); input.value = String(get()); output.textContent = `${input.value}%`; input.setAttribute('aria-valuetext', output.textContent); });
      input.oninput = () => { set(input.valueAsNumber); sync(); };
      caption.append(' ', output); row.append(caption, input); panel.append(row);
    };
    add('Card overview width', () => 100, () => Math.floor(100 + (DECK_ROOM - searchExtra()) / 2), () => Math.round(100 + overviewExtra() / 2), value => setOverviewSize('width', (value - 100) * 2));
    add('Card picture', () => OVERVIEW_RANGE.picture[0], () => OVERVIEW_RANGE.picture[1], () => overviewSize.picture, value => setOverviewSize('picture', value));
    add('Card text', () => OVERVIEW_RANGE.text[0], () => OVERVIEW_RANGE.text[1], () => overviewSize.text, value => setOverviewSize('text', value));
    if (ui) add('Card search width', () => 100, () => Math.floor(100 * widthLimits().max / baseWidth()), () => Math.round(100 * currentWidth() / baseWidth()), value => setSearchWidth(value <= 100 ? null : baseWidth() * value / 100, true));
    const reset = element('button', 'Reset'); reset.type = 'button';
    reset.onclick = () => { for (const key of Object.keys(OVERVIEW_DEFAULT)) setOverviewSize(key, OVERVIEW_DEFAULT[key]); if (ui) setSearchWidth(null, true); sync(); };
    panel.append(deck, reset); sync();
    for (const type of ['keydown','keyup','mousedown','click']) panel.addEventListener(type, e => { e.stopPropagation(); if (type === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeOverviewSettings(); overviewButton.focus(); } });
    document.body.append(panel);
    const r = overviewButton.getBoundingClientRect(); panel.style.left = Math.max(8, Math.min(r.right + 8, innerWidth - 288)) + 'px'; panel.style.top = Math.max(8, Math.min(r.top - 120, innerHeight - panel.offsetHeight - 8)) + 'px';
    panel.querySelector('input').focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', e => { if (overviewPanel && !overviewPanel.contains(e.target) && e.target !== overviewButton) closeOverviewSettings(); });
  // Phones (user, 2026-10-28: the deck buttons were "way too small", about 2 mm tall at the phone's scale): the deck
  // list, Save and Exit get rows about twice as tall, and the rest move to a "⋯ Deck" menu of full-size buttons that
  // press DuelingBook's own ones. Solo keeps its row, taller too (touch.js).
  const DECK_MENU = [['#import_btn', 'Import Deck'], ['#export_btn', 'Export Deck'], ['#clear_btn', ''], ['.default_btn', 'Set as Default'],
    ['#new_btn', 'New Deck'], ['#rename_btn', 'Rename Deck'], ['#delete_btn', 'Delete Deck'], ['#save_as_btn', 'Save Deck As']];
  const PHONE_PLACES = { '#decklist_cb,.decklists_btn': [506, 3, 200, 30], '#save_btn': [544, 3, 76, 34], '.room_exit_btn': [544, 145, 58, 34] };
  let deckMenuButton = null, deckMenu = null;
  const phoneLayout = () => document.documentElement.classList.contains('dbetter-phone');
  // A panel opened from the menu (its own button hidden on a phone) opens beside the menu button.
  const anchorRect = button => (button?.offsetParent || !deckMenuButton?.isConnected ? button : deckMenuButton).getBoundingClientRect();
  function closeDeckMenu() { deckMenu?.remove(); deckMenu = null; deckMenuButton?.setAttribute('aria-expanded', 'false'); }
  function openDeckMenu(root) {
    if (deckMenu) { closeDeckMenu(); return; }
    deckMenu = element('section', '', 'dblite-deck-menu'); deckMenu.setAttribute('role', 'dialog'); deckMenu.setAttribute('aria-label', 'Deck');
    const head = element('header'), close = element('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.onclick = closeDeckMenu;
    head.append(element('strong', window.deck?.data || 'Deck'), close);
    const grid = element('div', '', 'dblite-deck-menu-grid');
    for (const [selector, label] of DECK_MENU) {
      const native = root.querySelector(selector);
      if (!native || getComputedStyle(native).display === 'none' && !native.classList.contains('dblite-deck-grouped')) continue;
      // Clear Deck becomes Undo after a clear: show DuelingBook's current label.
      const item = element('button', label || native.value || 'Clear Deck'); item.type = 'button'; item.disabled = !!native.disabled;
      item.onclick = () => { closeDeckMenu(); native.click(); };
      grid.append(item);
    }
    // Phones: the deck's quick chat (💬) and the opening odds (🎲) live here too.
    for (const [button, label, open] of [[deckChatButton, '💬 Quick chat', showDeckChat], [oddsButton, '🎲 Opening odds', showOdds]]) {
      if (!button?.isConnected) continue;
      const item = element('button', label); item.type = 'button'; item.onclick = () => { closeDeckMenu(); open(); };
      grid.append(item);
    }
    deckMenu.append(head, grid);
    for (const type of ['mousedown', 'pointerdown', 'click', 'keydown']) deckMenu.addEventListener(type, event => { event.stopPropagation(); if (type === 'keydown' && event.key === 'Escape') closeDeckMenu(); });
    document.body.append(deckMenu); deckMenuButton.setAttribute('aria-expanded', 'true');
  }
  document.addEventListener('pointerdown', event => { if (deckMenu && !deckMenu.contains(event.target) && event.target !== deckMenuButton) closeDeckMenu(); }, true);
  function compactControls(root) {
    if (!root) return;
    const rows = [ ['#import_btn', '#export_btn'], ['#clear_btn', '.default_btn'], ['#decklist_cb,.decklists_btn'], ['#new_btn', '#rename_btn'], ['#delete_btn', '#save_btn'], ['#save_as_btn', '.room_exit_btn'] ];
    const phone = phoneLayout();
    rows.forEach((row, i) => row.forEach((selector, j) => root.querySelectorAll(selector).forEach(input => {
      const proxy = window.jQuery(input).data('proxy');
      const place = phone ? PHONE_PLACES[selector] : null, grouped = phone && !place;
      const [top, left, width, height] = place || [487 + i * 21, j ? 105 : 3, row.length === 1 ? 200 : 98, 18];
      for (const node of [input, proxy?.[0], proxy?.data?.('proxy')?.[0]].filter(Boolean)) {
        // classList.add rewrites the class attribute even when the class is present; on Firefox for
        // Android that reopens an open <select> picker, so this per-tick pass only adds missing classes.
        if (!node.classList.contains('dblite-deck-control')) node.classList.toggle('dblite-deck-control', true);
        if (input.id === 'decklist_cb' && !node.classList.contains('dblite-deck-select')) node.classList.toggle('dblite-deck-select', true);
        if (node.classList.contains('dblite-deck-grouped') !== grouped) node.classList.toggle('dblite-deck-grouped', grouped);
        for (const [key,value] of Object.entries({ top, left, width, height })) {
          const next = value + 'px'; if (node.style.getPropertyValue('--dblite-control-' + key) !== next) node.style.setProperty('--dblite-control-' + key, next);
        }
      }
    })));
    for (const button of [deckChatButton, oddsButton]) if (button && button.hidden !== phone) button.hidden = phone;
    if (phone && !deckMenuButton?.isConnected) {
      deckMenuButton = element('button', '⋯ Deck', 'dblite-deck-more'); deckMenuButton.type = 'button';
      deckMenuButton.title = 'Import, export, clear, set as default, new, rename, delete, save as'; deckMenuButton.setAttribute('aria-haspopup', 'dialog'); deckMenuButton.setAttribute('aria-expanded', 'false');
      deckMenuButton.onclick = event => { event.stopPropagation(); openDeckMenu(root); };
      root.append(deckMenuButton);
    } else if (!phone && deckMenuButton) { deckMenuButton.remove(); deckMenuButton = null; closeDeckMenu(); }
  }
  // Quick chat messages for this deck (one per line, up to 8), shown first in the duel chat wheel.
  // Stored by deck name in this browser.
  const DECK_CHAT_KEY = 'dbetter-deck-chat';
  function deckChat() { try { return JSON.parse(localStorage.getItem(DECK_CHAT_KEY) || '{}') || {}; } catch { return {}; } }
  let deckChatPanel = null, deckChatButton = null;
  function closeDeckChat() { deckChatPanel?.remove(); deckChatPanel = null; deckChatButton?.setAttribute('aria-expanded', 'false'); }
  function showDeckChat() {
    if (deckChatPanel) { closeDeckChat(); return; }
    const name = window.deck?.data; if (!name) return;
    closeSoloSettings();
    const panel = deckChatPanel = element('section', '', 'dblite-solo-settings dblite-deck-chat');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Quick chat for this deck'); deckChatButton.setAttribute('aria-expanded', 'true');
    const header = element('header'), close = element('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close quick chat'); close.onclick = () => { closeDeckChat(); deckChatButton.focus(); };
    header.append(element('strong', 'Quick chat · ' + name), close); panel.append(header);
    const area = element('textarea'); area.rows = 8; area.maxLength = 8 * 41; area.setAttribute('aria-label', 'Messages for this deck, one per line');
    area.placeholder = 'One message per line, e.g.\nmy chain\nresponse?\ngo ahead';
    area.value = (deckChat()[name] || []).join('\n');
    Object.assign(area.style, { width: '100%', resize: 'vertical', padding: '6px', background: 'var(--dbt-input)', color: 'inherit', border: '1px solid var(--dbt-line)', borderRadius: '4px', font: '13px/1.35 system-ui' });
    const hint = element('p', 'Shown first in the 💬 chat wheel when you duel with this deck, then your general messages (Spellspeed settings). Up to 8 in all; 40 characters each.');
    const save = () => {
      const all = deckChat(), list = [...new Set(area.value.split('\n').map(text => text.replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);
      if (list.length) all[name] = list; else delete all[name];
      try { localStorage.setItem(DECK_CHAT_KEY, JSON.stringify(all)); } catch { /* Kept for this page. */ }
    };
    area.addEventListener('input', save);
    panel.append(area, hint);
    for (const type of ['keydown', 'keyup', 'mousedown', 'click']) panel.addEventListener(type, e => { e.stopPropagation(); if (type === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeDeckChat(); deckChatButton.focus(); } });
    document.body.append(panel);
    const r = anchorRect(deckChatButton); panel.style.left = Math.max(8, Math.min(r.right, innerWidth - 288)) + 'px'; panel.style.top = Math.max(8, Math.min(r.top, innerHeight - panel.offsetHeight - 8)) + 'px';
    area.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', e => { if (deckChatPanel && !deckChatPanel.contains(e.target) && e.target !== deckChatButton) closeDeckChat(); });
  // Opening odds: the chance of opening a starter (and a starter plus an extender) with the deck in the
  // constructor, from cards marked S (starter) and E (extender). Exact hypergeometric arithmetic over the
  // Main Deck; 5 cards going first, 6 going second. Marks are kept per deck in this browser.
  const ODDS_KEY = 'dbetter-deck-odds';
  let oddsPanel = null, oddsButton = null;
  function oddsMarks() { try { return JSON.parse(localStorage.getItem(ODDS_KEY) || '{}') || {}; } catch { return {}; } }
  function mainDeck() {
    const list = Array.isArray(window.deck_filled_arr) ? window.deck_filled_arr : [];
    return list.map(card => { const data = card?.data?.() || {}; return catalogCard(data.id, data.name) || (data.name ? data : null); }).filter(Boolean);
  }
  function choose(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
  // Hand of `hand` cards from `size`: starter-only a, extender-only b, both c (one card fills one role).
  function openingOdds(size, a, b, c, hand) {
    const d = size - a - b - c, total = choose(size, hand);
    let starter = 0, combo = 0;
    for (let x = 0; x <= Math.min(a, hand); x++) for (let y = 0; y <= Math.min(b, hand - x); y++) for (let z = 0; z <= Math.min(c, hand - x - y); z++) {
      const w = hand - x - y - z; if (w > d) continue;
      const ways = choose(a, x) * choose(b, y) * choose(c, z) * choose(d, w);
      if (x + z >= 1) starter += ways;
      if (x + z >= 1 && y + z >= 1 && x + y + z >= 2) combo += ways;
    }
    return total ? { starter: starter / total, combo: combo / total, brick: 1 - starter / total, expected: hand * (a + c) / size } : null;
  }
  function closeOdds() { oddsPanel?.remove(); oddsPanel = null; oddsButton?.setAttribute('aria-expanded', 'false'); }
  function showOdds() {
    if (oddsPanel) { closeOdds(); return; }
    const name = window.deck?.data || 'This deck';
    closeSoloSettings(); closeDeckChat();
    const panel = oddsPanel = element('section', '', 'dblite-solo-settings dblite-odds');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Opening odds'); oddsButton.setAttribute('aria-expanded', 'true');
    const header = element('header'), close = element('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close opening odds'); close.onclick = () => { closeOdds(); oddsButton.focus(); };
    header.append(element('strong', 'Opening odds · ' + name), close);
    const summary = element('div', '', 'dblite-odds-summary'), list = element('div', '', 'dblite-odds-list');
    const tools = element('div', '', 'dblite-odds-tools'), suggest = element('button', 'Suggest starters'), clear = element('button', 'Clear marks');
    suggest.type = clear.type = 'button';
    suggest.title = 'Mark as starters the deck cards that search or Special Summon another card of this deck from the Deck';
    tools.append(suggest, clear);
    panel.append(header, summary, tools, list);
    const deck = mainDeck(), counts = new Map();
    for (const card of deck) counts.set(card.name, { card, n: (counts.get(card.name)?.n || 0) + 1 });
    const marks = oddsMarks(), own = marks[name] ||= { starters: [], extenders: [] };
    const save = () => { const all = oddsMarks(); all[name] = own; try { localStorage.setItem(ODDS_KEY, JSON.stringify(all)); } catch {} };
    const pct = value => value == null ? '–' : (value * 100).toFixed(1).replace(/\.0$/, '') + '%';
    function update() {
    if (window.DBETTERRebuilding) return;
      const size = deck.length, isS = n => own.starters.includes(n), isE = n => own.extenders.includes(n);
      let a = 0, b = 0, c = 0;
      for (const { card, n } of counts.values()) { if (isS(card.name) && isE(card.name)) c += n; else if (isS(card.name)) a += n; else if (isE(card.name)) b += n; }
      const first = openingOdds(size, a, b, c, 5), second = openingOdds(size, a, b, c, 6);
      summary.replaceChildren();
      if (!size) { summary.textContent = 'Put cards in the Main Deck first.'; return; }
      const table = element('table'), head = element('tr');
      head.append(element('th', `${size} cards · ${a + c} starters · ${b + c} extenders`), element('th', 'First (5)'), element('th', 'Second (6)'));
      table.append(head);
      for (const [label, key] of [['At least 1 starter', 'starter'], ['Starter + extender', 'combo'], ['No starter', 'brick'], ['Starters in hand', 'expected']]) {
        const row = element('tr');
        row.append(element('td', label), element('td', key === 'expected' ? (first?.expected ?? 0).toFixed(2) : pct(first?.[key])), element('td', key === 'expected' ? (second?.expected ?? 0).toFixed(2) : pct(second?.[key])));
        table.append(row);
      }
      summary.append(table);
    }
    function row({ card, n }) {
      const line = element('div', '', 'dblite-odds-row'), label = element('span', `${n} × ${card.name}`), s = element('button', 'S'), e = element('button', 'E');
      s.type = e.type = 'button'; s.title = 'Starter: opening with it alone starts your play'; e.title = 'Extender: adds to a starter';
      const sync = () => { s.setAttribute('aria-pressed', String(own.starters.includes(card.name))); e.setAttribute('aria-pressed', String(own.extenders.includes(card.name))); };
      const toggle = (key) => { const set = new Set(own[key]); if (set.has(card.name)) set.delete(card.name); else set.add(card.name); own[key] = [...set]; save(); sync(); update(); };
      s.onclick = () => toggle('starters'); e.onclick = () => toggle('extenders');
      label.addEventListener('mouseenter', () => { if (typeof window.previewFront === 'function' && window.jQuery) window.previewFront(window.jQuery('<div>').data({ ...card, effect: card.effect || '', pendulum_effect: card.pendulum_effect || '' })); });
      line.append(s, e, label); sync(); return line;
    }
    const render = () => { list.replaceChildren(...[...counts.values()].map(row)); update(); };
    suggest.onclick = () => {
      const names = new Set(own.starters), cards = [...counts.values()].map(item => item.card);
      // Searches and summons only: sending to the GY or Setting is rarely a play on its own.
      const starting = new Set(['add', 'summon']);
      for (const card of cards) if (cards.some(other => other.name !== card.name && relatedRank(card, other, 'access', starting) < Infinity)) names.add(card.name);
      own.starters = [...names]; save(); render();
    };
    clear.onclick = () => { own.starters = []; own.extenders = []; save(); render(); };
    render();
    for (const type of ['keydown', 'keyup', 'mousedown', 'click']) panel.addEventListener(type, event => { event.stopPropagation(); if (type === 'keydown' && event.key === 'Escape') { event.preventDefault(); closeOdds(); oddsButton.focus(); } });
    document.body.append(panel);
    const r = anchorRect(oddsButton); panel.style.left = Math.max(8, Math.min(r.right, innerWidth - 328)) + 'px'; panel.style.top = Math.max(8, Math.min(r.top, innerHeight - panel.offsetHeight - 8)) + 'px';
  }
  document.addEventListener('pointerdown', e => { if (oddsPanel && !oddsPanel.contains(e.target) && e.target !== oddsButton) closeOdds(); });
  function soloControls() {
    const root = document.getElementById('deck_constructor'); if (!root || soloButton) return;
    const wrap = element('div', '', 'dblite-solo-launch'); soloButton = element('button', 'Solo'); soloButton.type = 'button';
    soloButton.title = 'Save this deck if needed and launch Solo Mode';
    soloGear = element('button', '⚙', 'dblite-solo-gear'); soloGear.type = 'button'; soloGear.setAttribute('aria-label', 'Solo settings'); soloGear.setAttribute('aria-expanded', 'false'); soloGear.onclick = showSoloSettings;
    const status = element('output'); status.setAttribute('role', 'status');
    const showStatus = text => { status.textContent = text; soloButton.title = text || 'Save this deck if needed and launch Solo Mode'; };
    soloButton.onclick = () => {
      if (practicePlan || window.currentLabel !== 'deck_constructor') return;
      const ids = (window.deck_filled_arr || []).map(c => Number(c.data('id')));
      const settings = { ...soloSettings }, needed = (settings.ordered ? settings.handCount : 0) + settings.stackCount;
      if (!ids.length || settings.handCount + settings.stackCount > ids.length || ids.slice(0,needed).some(id=>!id)) { showStatus('Hand and top-deck stack must fit in the Main Deck.'); return; }
      if (typeof window.gotoDuelRoom !== 'function' || typeof window.hostDuel !== 'function') { showStatus('Solo Mode is unavailable here.'); return; }
      closeSoloSettings();
      const plan = practicePlan = { ids: ids.slice(0,needed), settings, mainSize: ids.length, expires: Date.now() + 120000, stage: 'saving', showStatus };
      soloButton.disabled = true; showStatus(window.unsavedChanges ? 'Saving deck…' : 'Starting Solo…');
      const launch = () => {
        if (practicePlan !== plan) return;
        if (Date.now() > plan.expires || window.currentLabel !== 'deck_constructor' || !window.deck?.id) { cancelPractice('Save the deck before launching Solo.'); return; }
        const deckId = window.deck.id;
        plan.stage = 'verifying'; plan.deckId = deckId; plan.deckName = window.deck.data;
        // Native navigation selects and verifies the default deck synchronously.
        // Select this deck from the outset so an outstanding verification response
        // cannot apply the default deck's legality to the constructor deck.
        const preferred = window.default_deck;
        try { window.default_deck = window.deck.data; window.gotoDuelRoom(); }
        finally { window.default_deck = preferred; }
        advancePractice();
      };
      plan.launch = launch;
      if (window.unsavedChanges || !window.deck?.id) {
        if (typeof window.saveDeck !== 'function' || window.callbackAfterSave) { practicePlan = null; soloButton.disabled = false; showStatus('Finish the current save first.'); return; }
        window.callbackAfterSave = launch; window.saveDeck();
      } else launch();
    };
    deckChatButton = element('button', '💬', 'dblite-solo-gear dblite-deck-chat-button'); deckChatButton.type = 'button';
    deckChatButton.setAttribute('aria-label', 'Quick chat messages for this deck'); deckChatButton.title = 'Quick chat messages for this deck'; deckChatButton.setAttribute('aria-expanded', 'false'); deckChatButton.onclick = showDeckChat;
    oddsButton = element('button', '🎲', 'dblite-solo-gear dblite-odds-button'); oddsButton.type = 'button';
    oddsButton.setAttribute('aria-label', 'Opening odds for this deck'); oddsButton.title = 'Opening odds: the chance of opening a starter with this deck'; oddsButton.setAttribute('aria-expanded', 'false'); oddsButton.onclick = showOdds;
    overviewButton = element('button', '⤢', 'dblite-solo-gear dblite-overview-button'); overviewButton.type = 'button';
    overviewButton.setAttribute('aria-label', 'Sizes of the card overview, the search and the deck'); overviewButton.title = 'Sizes: a wider card overview, a smaller picture or bigger text; the deck makes room'; overviewButton.setAttribute('aria-expanded', 'false'); overviewButton.onclick = showOverviewSettings;
    // Room for the chat, odds and sizes buttons (inline, so it applies before the stylesheet reloads).
    soloButton.style.setProperty('width', '72px', 'important'); for (const button of [deckChatButton, oddsButton, overviewButton]) button.style.setProperty('font-size', '12px', 'important');
    wrap.append(soloButton, soloGear, deckChatButton, oddsButton, overviewButton, status); root.append(wrap); root.classList.toggle('dblite-solo-ready', true);
  }
  function cancelPractice(message) {
    if (window.callbackAfterSave === practicePlan?.launch) window.callbackAfterSave = null;
    practicePlan?.showStatus(message || '');
    practicePlan = null; if (soloButton) soloButton.disabled = false;
  }
  function advancePractice() {
    const plan = practicePlan; if (!plan) return;
    if (Date.now() > plan.expires) { cancelPractice('Solo launch timed out. Try again when the deck is saved.'); return; }
    // Save responses hand the launch callback to the native Message dialog.
    if (plan.stage === 'saving' && window.callbackAfterSave !== plan.launch && window.msg_callback !== plan.launch) { cancelPractice('Deck save stopped before Solo could launch. Try again.'); return; }
    if (plan.stage === 'opening' && !window.hosting && !window.duel_active) { cancelPractice('Solo hosting was cancelled.'); return; }
    if (plan.stage !== 'verifying') return;
    if (window.currentLabel !== 'duel_room' || Number(window.deck?.id) !== Number(plan.deckId)) { cancelPractice('Solo launch stopped because the selected deck changed.'); return; }
    if (!window.deck.legality) return; // Wait for the native Verify deck response.
    // Select through DuelingBook's own index method so its proxy labels show names, not codes,
    // and put the player's Format/Type back once the Solo host request has been sent.
    const $ = window.jQuery, format = $('#host .format_cb'), type = $('#host .type_cb');
    const previous = [format, type].map(select => select.prop('selectedIndex'));
    const choose = (select, value) => { const index = select.find('option').toArray().findIndex(option => option.value === value); if (index < 0) return; if (typeof select.selectedIndex === 'function') select.selectedIndex(index); else select.val(value); };
    choose(format, 'so'); choose(type, 's');
    $('#host .classic_cb,#host .tag_duel_cb').prop('checked', false);
    plan.stage = 'opening'; window.hostDuel();
    [format, type].forEach((select, i) => { if (previous[i] >= 0) { if (typeof select.selectedIndex === 'function') select.selectedIndex(previous[i]); else select.prop('selectedIndex', previous[i]); } });
    if (practicePlan === plan && !window.hosting && !window.duel_active) cancelPractice('DuelingBook could not start Solo. Check its message and try again.');
  }
  function environment() {
    const ban = window.getBanlist(window.banlists.val());
    return {
      favorites: window.favorites || [], pools: { 4: window.GoatCards, 5: window.EdisonCards, 6: window.SpeedCards, 9: window.favorites },
      fetchTarget: reverseOf(controls.fetches?.value)?.mode !== 'support' && reverseOf(controls.fetches?.value) ? catalogCard(reverseOf(controls.fetches.value).id) : null,
      ...(() => {
        const reverse = reverseOf(controls.fetches?.value), target = FETCH_MODES.includes(reverse?.mode) && catalogCard(reverse.id);
        const ranks = target && cachedRanks(fetchKey(reverse.mode, target));
        if (reverse?.mode === 'access') return { fetchFound: ranks?.found };
        if (reverse?.mode === 'starters') return { starterVia: ranks?.via || starterVia(target), fetchFound: ranks?.found, starterSteps: new Map(), starterHow: new Map() };
        if (reverse?.mode === 'ideas') return { starterVia: ranks?.via || starterVia(target), ideaVia: ranks?.steps || ideaVia(target), fetchFound: ranks?.found, starterSteps: new Map(), starterHow: new Map() };
        if (reverse?.mode === 'support') return { supportName: reverse.id, supportMembers: archetypeMembers(reverse.id) };
        return {};
      })(),
      fetchMode: reverseOf(controls.fetches?.value)?.mode, fetchRanks: new Map(), lab: labOf(controls.lab?.value), labRanks: new Map(), describeRanks: new Map(), describeWhy: new Map(),
      describeFound: controls.describe?.value.trim() ? cachedRanks('describe:' + controls.describe.value.trim())?.found : undefined,
      legal: c => ban.id === 173 || window.getLegality(c.id, c.tcg, c.ocg, c.tcg_date, c.ocg_date, c.card_type === 'Skill' || c.rush) !== 0,
      points: c => window.getPoints(c.id) ?? 0,
      limit: (c, pool, limit) => pool === 7 ? limit === 3 || (c.ocg_limit ?? 3) === limit || c.rush === 2 && limit === 1
        : window.getLimit(c.id, c.tcg_limit ?? 3) === limit || limit === 3 && pool !== 6
    };
  }
  function read() {
    const q = { pool: controls.pool.value, name: controls.name.value, effect: controls.effect.value,
      nameMode: controls.nameMode.value, effectMode: controls.effectMode.value, order: controls.order.value,
      pointsEnabled: !!window.ShowingPoints && controls.pointsEnabled.checked };
    for (const [key, inputs] of Object.entries(multis)) { q[key] = inputs.filter(n => n.checked && !n.dataset.exclude).map(n => n.value); q[key + 'Not'] = inputs.filter(n => n.dataset.exclude).map(n => n.value); }
    for (const [key, inputs] of Object.entries(ranges)) q[key] = inputs.map(n => n.value.trim());
    for (const key of ['pendulum', 'tcg', 'ocg']) q[key] = controls[key].checked;
    q.arrows = controls.arrows.map(n => n.checked);
    q.statRelation = controls.statRelation.value; q.statExpr = controls.statExpr.value;
    q.statCompare = controls.statCompare.value; q.statValue = controls.statValue.value.trim();
    q.fetches = controls.fetches.value; q.lab = controls.lab.value; q.describe = controls.describe.value;
    try { q.phrase = JSON.parse(controls.phrase.value || 'null'); } catch { q.phrase = null; }
    return q;
  }
  function search() {
    if (!active || !window.cards_fingerprint || !Array.isArray(window.Cards)) return;
    query = read();
    query.nameTerms = terms(query.name, query.nameMode); query.effectTerms = terms(query.effect, query.effectMode);
    if (query.pointsEnabled && !window.GenesysCards?.length) { controls.status.textContent = 'Points list is still loading.'; return; }
    query.described = query.describe.trim() ? describeRead(query.describe) : null;
    renderDescribe(query.described);
    results = window.Cards.filter(c => matches(c, query, environmentCache));
    // Reverse search: the cards that name it first, then its archetype, mentions, and Type / stat searchers.
    // A description: the cards whose effects name what it asks first, then those that fit any card of that kind.
    const rank = query.fetches ? environmentCache.fetchRanks : query.lab ? environmentCache.labRanks : query.described?.active ? environmentCache.describeRanks : null;
    results.sort((a, b) => (rank ? rank.get(a) - rank.get(b) : 0) || compareCards(a, b, query.order, descending));
    if (query.fetches) syncFetch(results.filter(card => rank.get(card) < ({ support: 0.5, starters: 0, ideas: IDEA_STEP }[reverseOf(query.fetches)?.mode] ?? 3)).length);
    if (query.lab) syncLab(results);
    page = 1; render();
  }
  // The description's chips; a word still being typed shows faded.
  function renderDescribe(read) {
    const box = controls.describeChips;
    if (!box) return;
    // The box lives in More options: a description brought back (Back, Recent) opens it.
    const more = box.closest('details');
    if (read && more && !more.open) more.open = true;
    const chips = read ? [...read.chips, ...(read.pending ? [{ label: `${read.pending}…`, pending: true, ranges: [] }] : [])] : [];
    box.replaceChildren(...chips.map(chip => {
      const node = element('span', '', ['dblite-describe-chip', chip.concept && 'dblite-describe-concept', chip.plain && 'dblite-describe-plain', chip.pending && 'dblite-describe-pending'].filter(Boolean).join(' '));
      node.append(chip.label);
      node.title = chip.pending ? 'Still typing: it counts once the word is complete' : chip.plain ? 'Not a known word: cards whose name or text has it' : chip.title || '';
      if (chip.ranges.length) {
        const remove = element('button', '×'); remove.type = 'button'; remove.title = 'Take these words out'; remove.setAttribute('aria-label', `Remove ${chip.label}`);
        remove.onclick = () => removeDescribed(chip.ranges); node.append(remove);
      }
      return node;
    }));
    box.hidden = !chips.length;
  }
  function removeDescribed(ranges) {
    let value = controls.describe.value;
    for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) value = value.slice(0, start) + value.slice(end);
    controls.describe.value = value.replace(/\s+/g, ' ').trim(); run();
  }
  let environmentCache, fetchJob = null;
  function run() { clearTimeout(debounce); if (!active || window.currentLabel !== 'deck_constructor') return; syncFetch(); syncLab(); if (!fetchReady()) return; environmentCache = environment(); search(); recordQuery(); renderHistory(); }
  // An Access, Starters or Ideas search runs now when its ranks are worked out, or fit in the first slice; else the
  // results are cleared, the pager says "Searching… n%", and run() comes again once the slices end (startFetchJob).
  // Another search meanwhile stops them; the same one (a filter typed) waits for them.
  function fetchReady() {
    const reverse = reverseOf(controls.fetches?.value), target = FETCH_MODES.includes(reverse?.mode) ? catalogCard(reverse.id) : null;
    // A description's matches first (describeTask), then a reverse search's ranks; each kept like Access's.
    const raw = controls.describe?.value.trim() || '', describing = !!raw && !cachedRanks('describe:' + raw);
    const key = describing ? 'describe:' + raw : target && fetchKey(reverse.mode, target);
    if (fetchJob && (fetchJob.key !== key || fetchJob.stopped)) { fetchJob.cancel(); fetchJob = null; }
    if (!key || cachedRanks(key) || window.Cards.length < FETCH_SLICED_FROM) return true;
    if (fetchJob) return false;
    let finished = false;
    const job = startFetchJob(reverse?.mode, target, key, {
      task: describing ? describeTask(raw) : null,
      valid: () => active && window.currentLabel === 'deck_constructor',
      progress: running => { if (fetchJob === running) controls.status.textContent = searchingText(); },
      done: ended => { finished = true; if (fetchJob === ended) { fetchJob = null; run(); if (ended.page > 1) { page = ended.page; render(); } } },
      // The catalog changed under it: search again.
      stopped: ended => { if (fetchJob === ended) { fetchJob = null; run(); } }
    });
    if (finished || job.stopped) return finished;
    // Meanwhile no result, and no step or need of the last search in the overview.
    fetchJob = job; results = []; environmentCache = undefined; page = 1; render();
    return false;
  }
  const searchingText = () => `Searching… ${Math.floor(100 * fetchJob.state.done / fetchJob.state.total)}%`;
  const autoColumns = width => Math.max(4, Math.floor((width + 2) / 54));
  // Result card sizes: rows that fit the result area; columns are derived from width.
  // Huge and Giant suit phones, where the scaled stage makes even Very big cards small.
  const SIZE_NAMES = [['xs', 'Very small'], ['s', 'Small'], ['m', 'Medium'], ['l', 'Big'], ['xl', 'Very big'], ['xxl', 'Huge'], ['max', 'Giant']];
  const SIZE_ROWS = { xs: 7, s: 6, m: 5, l: 4, xl: 3, xxl: 2, max: 1 };
  // Resizable search panel. The panel's right edge stays where the native/adaptive layout
  // puts it; the splitter on its left edge moves the boundary with the deck area, so the
  // panel overlaps the deck instead of moving any native constructor node.
  const WIDTH_KEY = 'dbetter-search-width', MIN_WIDTH = 216, PANEL_LEFT = 798.5, MIN_PANEL_LEFT = 400;
  let searchWidth = null, resizer;
  try { const saved = localStorage.getItem(WIDTH_KEY); if (saved !== null && Number.isFinite(Number(saved)) && saved.trim() !== '') searchWidth = Number(saved); } catch {}
  const baseWidth = () => window.DBLiteLayout?.constructorWidth || MIN_WIDTH;
  const stageScale = () => Number(window.contentScale) > 0 ? Number(window.contentScale) : 1;
  // The deck area (main, side and extra) shrinks together by one scale around the deck's top-left;
  // DuelingBook's drop tests use on-screen rectangles, so scaled drops still land correctly.
  // The card overview widens into the same room from the left (overviewExtra), and the deck moves right by as much.
  const DECK_LEFT = 206, DECK_TOP = 4, DECK_RIGHT = 794, MIN_DECK_SCALE = 0.55, DECK_ROOM = (DECK_RIGHT - DECK_LEFT) * (1 - MIN_DECK_SCALE);
  function widthLimits() {
    const base = baseWidth();
    // Narrowing the search would not give the deck more room, so the panel only widens.
    return { min: base, max: Math.floor(base + DECK_ROOM - overviewExtra()) };
  }
  function deckScale(width) { return Math.max(MIN_DECK_SCALE, 1 - (Math.max(0, width - baseWidth()) + overviewExtra()) / (DECK_RIGHT - DECK_LEFT)); }
  function applyDeckScale(width) {
    const shift = overviewExtra(), scale = searchWidth === null && !shift ? 1 : deckScale(width);
    for (const id of ['deck_bg', 'side_bg', 'extra_bg']) {
      const node = document.getElementById(id) || document.querySelector('#deck_constructor .' + id);
      if (!node) continue;
      if (scale === 1 && !shift) { node.style.removeProperty('transform'); node.style.removeProperty('transform-origin'); }
      else { node.style.setProperty('transform', `${shift ? `translate(${shift}px,0) ` : ''}scale(${scale})`, 'important'); const box = getComputedStyle(node); node.style.setProperty('transform-origin', `${DECK_LEFT - (parseFloat(box.left) || DECK_LEFT)}px ${DECK_TOP - (parseFloat(box.top) || DECK_TOP)}px`, 'important'); }
    }
  }
  // Card overview sizes (user, 2026-10-30: with the Ideas lines under it, the card text got hard to read): the
  // overview widens into the deck's room, the picture can shrink so the text box gets its height, and the text can
  // grow. Saved on this device, like the search width. DuelingBook's nodes stay where they are; a stylesheet moves
  // the text box, and the picture shrinks with the CSS scale and translate properties, which add to its own transform.
  // Nothing is measured on screen while sizing: a class change on the constructor restyles all its cards, which
  // took up to 1.4 s a step with Ideas results shown (live, 2026-10-30).
  const OVERVIEW_KEY = 'dbetter-overview-size', OVERVIEW_DEFAULT = Object.freeze({ width: 0, picture: 100, text: 100 });
  const OVERVIEW_RANGE = { picture: [40, 100], text: [80, 160] }, OVERVIEW_PICTURE = { left: 3, top: 7, width: 199, height: 291 };
  let overviewSize = { ...OVERVIEW_DEFAULT }, overviewStyle = null, overviewKey = '', overviewNative = null, overviewPending = false;
  try {
    const saved = JSON.parse(localStorage.getItem(OVERVIEW_KEY) || 'null');
    for (const key of Object.keys(OVERVIEW_DEFAULT)) if (Number.isFinite(saved?.[key])) overviewSize[key] = saved[key];
  } catch {}
  const overviewExtra = () => Math.max(0, Math.min(DECK_ROOM, overviewSize.width)), searchExtra = () => Math.max(0, currentWidth() - baseWidth());
  const overviewSized = () => Object.keys(OVERVIEW_DEFAULT).some(key => overviewSize[key] !== OVERVIEW_DEFAULT[key]);
  // The picture's box (stage px) from its own styles: DuelingBook scales an 813 x 1185 card front with an inline transform.
  function pictureBox(picture) {
    const style = picture && getComputedStyle(picture), transform = style?.transform || '';
    const [a, d] = (transform.match(/^matrix\(([^,]+),[^,]+,[^,]+,([^,]+),/) || transform.match(/^scale\(([^,)]+)(?:,([^)]+))?\)/) || []).slice(1).map((value, i, all) => Number(value ?? all[0]));
    if (!a || !d) return null;
    const [ox = 0, oy = 0] = (style.transformOrigin || '').split(' ').map(value => parseFloat(value) || 0), left = parseFloat(style.left) || 0, top = parseFloat(style.top) || 0;
    return { left: left + ox * (1 - a), top: top + oy * (1 - d), width: (parseFloat(style.width) || 813) * a, height: (parseFloat(style.height) || 1185) * d, layoutLeft: left, ox, oy, a, d };
  }
  function applyOverview(force = false) {
    // This runs on every tick: with the default sizes, or nothing changed, it reads no layout.
    const sized = overviewSized();
    if (!force && !sized && overviewKey === 'off' && overviewStyle?.isConnected) return;
    const root = document.getElementById('deck_constructor'), text = document.getElementById('preview_txt'), picture = root?.querySelector('#preview');
    // DuelingBook shows and hides the text box and the picture with inline display; only their place and size count.
    const solo = !!root?.classList.contains('dblite-solo-ready'), place = text ? ['left', 'top', 'width', 'height'].map(side => text.style[side]).join() : '';
    const key = sized ? JSON.stringify([overviewSize, solo, place, picture?.style.transform || '']) : 'off';
    // A hidden picture (no card shown yet since the page loaded) may have no computed transform: placed once it shows.
    if (!force && key === overviewKey && overviewStyle?.isConnected && !(overviewPending && picture?.getClientRects().length)) return;
    overviewKey = key;
    if (!overviewStyle) { overviewStyle = element('style'); overviewStyle.id = 'dblite-overview-size'; }
    if (!overviewStyle.isConnected) document.head.append(overviewStyle);
    if (!root || !text || !sized) { root?.classList.toggle('dblite-overview-sized', false); overviewStyle.textContent = ''; return; }
    // DuelingBook's own text box (stage px), read with the sizes off: once, and again when its place or size changes.
    if (overviewNative?.text !== text || overviewNative.solo !== solo || overviewNative.place !== place) {
      root.classList.toggle('dblite-overview-sized', false);
      const box = getComputedStyle(text);
      overviewNative = { text, solo, place, left: parseFloat(box.left) || 3, top: parseFloat(box.top) || 300, width: parseFloat(box.width) || 175, height: parseFloat(box.height) || 152, font: parseFloat(box.fontSize) || 12 };
    }
    const native = overviewNative, art = pictureBox(picture), extra = overviewExtra(), shrink = overviewSize.picture / 100;
    overviewPending = !!picture && !art;
    const freed = (art || OVERVIEW_PICTURE).height * (1 - shrink);
    let css = `html #deck_constructor.dblite-overview-sized #preview_txt{left:${native.left}px!important;top:${native.top - freed}px!important;width:${native.width + extra}px!important;max-width:none!important;height:${native.height + freed}px!important;max-height:none!important;font-size:${native.font * overviewSize.text / 100}px!important}`;
    if (art) {
      // Centred at the top of the wider column: with the scale property around the same origin, the top-left corner stays put once moved by (dx, dy).
      const left = art.left + (art.width + extra - art.width * shrink) / 2, dx = left - art.layoutLeft - art.ox * (1 - shrink * art.a), dy = art.oy * art.d * (shrink - 1);
      css += `html #deck_constructor.dblite-overview-sized #preview{scale:${shrink}!important;translate:${dx}px ${dy}px!important}`;
    }
    overviewStyle.textContent = css;
    root.classList.toggle('dblite-overview-sized', true);
  }
  function setOverviewSize(key, value) {
    if (key === 'width') value = Math.max(0, Math.min(DECK_ROOM - searchExtra(), value));
    else value = Math.max(OVERVIEW_RANGE[key][0], Math.min(OVERVIEW_RANGE[key][1], value));
    overviewSize = { ...overviewSize, [key]: Math.round(value) };
    try { if (overviewSized()) localStorage.setItem(OVERVIEW_KEY, JSON.stringify(overviewSize)); else localStorage.removeItem(OVERVIEW_KEY); } catch {}
    applyOverview(true);
    // A wider overview can narrow a widened search, whose results then lay out again.
    if (key === 'width' && active && wasConstructor) render(); else if (ui) applyWidth(); else applyDeckScale(currentWidth());
  }
  function currentWidth() {
    if (searchWidth === null) return baseWidth();
    const { min, max } = widthLimits(); return Math.min(max, Math.max(min, searchWidth));
  }
  function applyWidth() {
    if (!ui) return;
    const root = document.getElementById('deck_constructor'), width = currentWidth(), { min, max } = widthLimits();
    if (searchWidth === null) { ui.style.removeProperty('width'); ui.style.removeProperty('left'); }
    else { ui.style.setProperty('width', width + 5 + 'px', 'important'); ui.style.setProperty('left', PANEL_LEFT + baseWidth() - width + 'px', 'important'); }
    applyDeckScale(width); applyOverview();
    syncResultBackground();
    root?.classList.toggle('dblite-search-resized', searchWidth !== null);
    if (resizer) { resizer.setAttribute('aria-valuemin', String(min)); resizer.setAttribute('aria-valuemax', String(max)); resizer.setAttribute('aria-valuenow', String(Math.round(width))); }
  }
  // Grey box behind the results grid: from the panel's bottom to the stage bottom, as wide as the panel.
  // (DuelingBook's own .search_bg sits inside the hidden native search, so it cannot be used.)
  // Down to the bottom of DuelingBook's own results box (#search: top 4, height 630.5).
  const NATIVE_RESULTS_BOTTOM = 634.5;
  let resultBackground = null, gridBottom = 610;
  function syncResultBackground() {
    const root = document.getElementById('deck_constructor');
    if (!root || !ui || !active || ui.hidden) { resultBackground?.remove(); return; }
    if (!resultBackground) resultBackground = element('div', '', 'dblite-results-bg');
    const cards = root.querySelector(':scope > .cards');
    if (resultBackground.parentNode !== root || cards && resultBackground.nextSibling !== cards) root.insertBefore(resultBackground, cards || null);
    const panel = getComputedStyle(ui), top = (parseFloat(panel.top) || 4) + (parseFloat(panel.height) || 300);
    for (const [key, value] of [['position', 'absolute'], ['left', panel.left], ['width', panel.width], ['top', top - 1 + 'px'],
      ['height', Math.max(0, Math.max(gridBottom + 5, NATIVE_RESULTS_BOTTOM) - top) + 'px'], ['background', panel.backgroundColor], ['border', panel.border],
      ['border-radius', `0 0 ${panel.borderBottomRightRadius} ${panel.borderBottomLeftRadius}`], ['box-sizing', 'border-box'], ['pointer-events', 'none']])
      resultBackground.style.setProperty(key, value, 'important');
  }
  function setSearchWidth(width, persist) {
    const { min, max } = widthLimits();
    searchWidth = width === null ? null : Math.round(Math.min(max, Math.max(min, width)));
    if (persist) try { if (searchWidth === null) localStorage.removeItem(WIDTH_KEY); else localStorage.setItem(WIDTH_KEY, String(searchWidth)); } catch {}
    applyWidth(); if (active && wasConstructor) render();
  }
  function buildResizer() {
    const handle = resizer = element('div', '', 'dblite-search-resizer');
    // Right edge of the panel; inline so it works before the stylesheet updates.
    for (const [key, value] of [['position', 'absolute'], ['left', '-5px'], ['right', 'auto'], ['top', '8px'], ['bottom', '8px'], ['width', '8px'], ['cursor', 'ew-resize'], ['z-index', '10']]) handle.style.setProperty(key, value, 'important');
    handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Resize card search'); handle.title = 'Drag to resize the card search · double-click to reset';
    let drag = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag = { x: event.clientX, width: currentWidth(), id: event.pointerId };
      try { handle.setPointerCapture(event.pointerId); } catch {}
      handle.classList.toggle('dblite-resizing', true);
    });
    handle.addEventListener('pointermove', event => { if (drag) setSearchWidth(drag.width - (event.clientX - drag.x) / stageScale(), false); });
    const finish = () => { if (!drag) return; try { handle.releasePointerCapture(drag.id); } catch {} drag = null; handle.classList.toggle('dblite-resizing', false); if (searchWidth !== null) setSearchWidth(searchWidth, true); };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish); handle.addEventListener('lostpointercapture', finish);
    for (const type of ['mousedown', 'click']) handle.addEventListener(type, event => event.stopPropagation());
    handle.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); setSearchWidth(null, true); });
    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 50 : 10, { min, max } = widthLimits();
      // The handle is the panel's left edge: Left widens (and shrinks the deck), Right narrows.
      const next = { ArrowLeft: currentWidth() + step, ArrowRight: currentWidth() - step, Home: min, End: max }[event.key];
      if (next === undefined && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation();
      setSearchWidth(event.key === 'Enter' ? null : next, true);
    });
    return handle;
  }
  function render() {
    if (!active) return;
    applyWidth();
    const available = currentWidth(), shift = baseWidth() - available;
    const rows = SIZE_ROWS[gridSize] || 5;
    const rowGap = 4, fitWidth = (298 - (rows - 1) * rowGap) / rows * 813 / 1185;
    // The chosen size sets the rows; a wider search panel adds columns so the grid fills it.
    const columns = Math.max(1, Math.floor((available + 2) / (fitWidth + 2)));
    const size = columns * rows, pages = Math.ceil(results.length / size);
    page = Math.min(Math.max(page, 1), Math.max(pages, 1));
    const cards = results.slice((page - 1) * size, page * size), parent = document.querySelector('#deck_constructor > .cards');
    if (!parent) return;
    const width = Math.min((available - (columns - 1) * 2) / columns, fitWidth);
    const height = width * 1185 / 813, left = 801 + shift + (available - (columns * width + (columns - 1) * 2)) / 2;
    gridBottom = 310 + rows * height + (rows - 1) * rowGap; syncResultBackground();
    window.search_arr ||= [];
    // Original factory retains preview, drag/drop, favorites and card metadata.
    for (let i = 0; i < Math.max(window.search_arr.length, cards.length); i++) {
      const existing = window.search_arr[i];
      if (!cards[i]) { existing?.detach(); continue; }
      const card = existing || (window.search_arr[i] = new window.SearchCard(i));
      if (card[0].parentNode !== parent) parent.append(card[0]); card[0].style.display = 'block';
      const ocg = !!document.querySelector('#deck_constructor .ocg_limit_rb')?.checked;
      const renderKey = JSON.stringify([cards[i], ocg, window.banlists.val(), !!window.ShowingPoints]);
      if (card[0].dbliteSearchKey !== renderKey) {
        card.initializeAndLimit(cards[i], ocg);
        card[0].dbliteSearchKey = renderKey;
      }
      // Native CardFront uses a top-left transform origin in constructor coordinates.
      card.css({ left: left + i % columns * (width + 2), top: 310 + Math.floor(i / columns) * (height + rowGap),
        transform: `scale(${width / 813})` });
      card[0].dataset.dbliteResult = '1';
    }
    window.allCards = cards; window.totalCardsSearched = results.length; window.pageNumber = page;
    window.awaiting_cards = false; window.searching = false; window.hideDim?.();
    controls.status.textContent = fetchJob ? searchingText() : `${results.length} cards · ${pages ? page : 0} / ${pages}`;
    controls.previous.disabled = page <= 1; controls.next.disabled = page >= pages;
    document.getElementById('deck_constructor').classList.toggle('dblite-constructor-ready', true);
    // The pages around this one, so turning a page shows its art at once.
    learnImageUrl(cards[0], window.search_arr[0]);
    warmImages([page, page + 1, page - 1, page + 2].filter(n => n >= 1 && n <= pages && n !== page).flatMap(n => results.slice((n - 1) * size, n * size)));
  }
  // Card art is fetched in the background, a few images at a time; DuelingBook serves it cacheable for a
  // year, so the browser (or the Android app's image cache) keeps it. The address is learnt from a shown card.
  let imageTemplate = null, warming = 0;
  const warmed = new Set(), warmQueue = [];
  function learnImageUrl(card, shown) {
    const src = shown?.[0]?.querySelector('img.pic')?.getAttribute('src') || '', id = String(card?.id ?? '');
    if (id && src.includes(`/${id}.`)) imageTemplate = src.replace(`/${id}.`, '/{id}.');
  }
  const imageUrl = card => imageTemplate ? imageTemplate.replace('{id}', encodeURIComponent(card.id)) : `${window.CARD_IMAGES_START || 'https://images.duelingbook.com/low-res/'}${encodeURIComponent(card.id)}.jpg`;
  function warmImages(cards) {
    // The latest pages go first; stale ones beyond 200 images are dropped (and may be fetched again later).
    const fresh = [];
    for (const card of cards) { const url = card?.id != null && window.DBLiteRules?.pageImage(imageUrl(card)); if (url && !warmed.has(url)) { warmed.add(url); fresh.push(url); } }
    warmQueue.unshift(...fresh);
    for (const url of warmQueue.splice(200)) warmed.delete(url);
    while (warming < 4 && warmQueue.length) {
      const image = new Image(); warming++;
      image.onload = image.onerror = () => { warming--; warmImages([]); };
      image.decoding = 'async'; image.src = warmQueue.shift();
    }
  }
  function select(label, entries, key, parent) {
    const wrap = element('label', label), input = element('select'); input.setAttribute('aria-label', label);
    for (const [value, text] of entries) { const option = element('option', text); option.value = value; input.append(option); }
    controls[key] = input; wrap.append(input); parent.append(wrap); return input;
  }
  function multi(label, entries, key, parent) {
    const details = element('details', '', 'dblite-filter'), summary = element('summary'), options = element('div', '', 'dblite-options');
    const name = element('span', label), count = element('span', '', 'dblite-filter-count');
    count.hidden = true; summary.append(name, count);
    // The selection count doubles as a clear button for the whole category.
    count.setAttribute('role', 'button'); count.title = `Clear ${label}`; count.setAttribute('aria-label', `Clear ${label}`);
    count.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      for (const input of multis[key]) if (input.checked) { input.checked = false; delete input.dataset.exclude; input.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    summary.addEventListener('click', () => { for (const sibling of parent.querySelectorAll('details')) if (sibling !== details) sibling.open = false; });
    multis[key] = [];
    // One click includes (✓), a second excludes (✕), a third clears.
    options.title = 'Click: ✓ include · again: ✕ exclude · again: off';
    for (const [value, text] of entries.filter(([value]) => value !== '')) {
      const line = element('label'), input = element('input'); input.type = 'checkbox'; input.value = value;
      input.setAttribute('aria-label', `${label}: ${text}`); line.append(input, element('span', text)); options.append(line); multis[key].push(input);
      input.addEventListener('click', () => {
        if (!input.checked && !input.dataset.exclude) { input.checked = true; input.dataset.exclude = '1'; }
        else if (!input.checked) delete input.dataset.exclude;
      });
      input.addEventListener('change', () => {
        const on = multis[key].filter(n => n.checked), excluded = !!input.dataset.exclude;
        line.classList.toggle('dblite-excluded', excluded); input.setAttribute('aria-label', `${label}: ${excluded ? 'not ' : ''}${text}`);
        count.textContent = String(on.length); count.hidden = !on.length;
        summary.title = on.length ? on.map(n => (n.dataset.exclude ? 'not ' : '') + n.parentElement.textContent).join(', ') : label;
      });
    }
    details.append(summary, options); parent.append(details);
  }
  function range(label, key, parent) {
    const wrap = element('label', '', 'dblite-range'), inputs = []; wrap.append(element('span', label, 'dblite-range-title'));
    for (const bound of ['minimum', 'maximum']) {
      const input = element('input'); input.type = 'text'; input.inputMode = 'numeric'; input.placeholder = bound === 'minimum' ? 'Min' : 'Max';
      input.setAttribute('aria-label', `${label} ${bound}`); input.maxLength = 6; inputs.push(input); wrap.append(input);
      input.addEventListener('input', () => { input.value = input.value.replace(key === 'atk' || key === 'def' ? /[^0-9?]/g : /[^0-9]/g, ''); });
      input.addEventListener('change', () => { const other = inputs.find(n => n !== input); if (input.value !== '' && other.value === '') other.value = input.value; });
    }
    ranges[key] = inputs; parent.append(wrap);
  }
  function checkbox(label, key, parent) {
    const wrap = element('label'), input = element('input'); input.type = 'checkbox'; controls[key] = input;
    wrap.append(input, document.createTextNode(label)); parent.append(wrap); return input;
  }
  // Polymerization's artwork, from DuelingBook's own card images.
  function labIcon() {
    const icon = element('span', '', 'dblite-lab-icon'), poly = Array.isArray(window.Cards) && window.Cards.find(c => c.name === 'Polymerization' && !c.rush);
    if (poly) icon.style.backgroundImage = `url("${(window.CARD_IMAGES_START || 'https://images.duelingbook.com/low-res/') + encodeURIComponent(poly.id)}.jpg")`; else icon.textContent = '🌀';
    icon.setAttribute('aria-hidden', 'true'); return icon;
  }
  let labMonsters = null;
  function monsterNames() {
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (labMonsters?.cards !== cards || labMonsters.size !== cards.length) {
      const seen = new Map();
      for (const c of cards) if (c.card_type === 'Monster' && c.name && !c.rush && !c.custom && !seen.has(c.name)) seen.set(c.name, c);
      labMonsters = { cards, size: cards.length, list: [...seen.values()].map(c => ({ card: c, key: normalize(c.name) })) };
    }
    return labMonsters.list;
  }
  // The Summon Lab replaces the filters while open; its result is a search like the others.
  function buildLab(fields, more, fetchRow) {
    const labInput = controls.lab = element('input');
    labInput.type = 'hidden';
    if (!SUMMON_LAB_ENABLED) return;
    const labRow = element('div', '', 'dblite-lab-filter');
    const labLabel = element('span', '', 'dblite-fetch-label'), labEdit = element('button', '✎', 'dblite-lab-edit'), labClear = element('button', '×', 'dblite-fetch-clear');
    labEdit.type = labClear.type = 'button'; labEdit.title = 'Change the materials'; labEdit.setAttribute('aria-label', labEdit.title);
    labClear.title = 'Stop the Summon Lab search'; labClear.setAttribute('aria-label', labClear.title);
    labClear.onclick = () => { cancelJob(); labInput.value = ''; run(); };
    labRow.append(labInput, labLabel, labEdit, labClear); labRow.hidden = true; fields.prepend(labRow);
    const lab = element('section', '', 'dblite-lab'); lab.hidden = true; lab.setAttribute('aria-label', 'Summon Lab');
    const head = element('div', '', 'dblite-lab-head'), back = element('button', '‹ Filters', 'dblite-lab-back'); back.type = 'button';
    head.append(labIcon(), element('strong', 'Summon Lab'), element('span', 'Beta', 'dblite-lab-beta'), back);
    const help = element('p', 'Pick monsters, or describe one with Any: which Fusion, Synchro, Xyz and Link Monsters can they make?', 'dblite-lab-help');
    help.setAttribute('role', 'status');
    const defaultHelp = help.textContent;
    let job = null;
    const cancelJob = () => { if (job && !job.done) { job.cancel(); help.textContent = defaultHelp; } job = null; };
    const incompleteHelp = element('p', '', 'dblite-lab-help');
    incompleteHelp.hidden = true; incompleteHelp.setAttribute('role', 'status'); labRow.after(incompleteHelp);
    const slots = element('div', '', 'dblite-lab-slots'), add = element('button', '＋ Material', 'dblite-lab-add'), mode = element('select', '', 'dblite-lab-mode'), find = element('button', 'Find', 'dblite-lab-find');
    add.type = find.type = 'button'; mode.setAttribute('aria-label', 'Use the materials');
    for (const [value, text] of [['exact', 'Exactly these'], ['includes', 'These + others']]) { const option = element('option', text); option.value = value; mode.append(option); }
    mode.title = 'Exactly these: the monsters are all the materials. These + others: they are among the materials.';
    const actions = element('div', '', 'dblite-lab-actions'); actions.append(add, mode, find);
    lab.append(head, help, slots, actions);
    fields.after(lab);
    // Lab typing is not a search: keep it from the panel's own input / change / Enter handling.
    for (const type of ['input', 'change']) lab.addEventListener(type, event => { cancelJob(); event.stopPropagation(); });
    lab.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); find.click(); } });
    const shown = () => catalogCard(window.preview?.data?.('id'), document.querySelector('#preview .name_txt')?.textContent.trim());
    // Any monster (user, 2026-10-29; docs/summon-lab-design.md): a material described by what is known about it.
    // What is left unset can be anything; the engine reads the description (labItemValue, labGenericLabel).
    const KINDS = ['Normal', 'Effect', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum', 'Token'];
    const ATTRIBUTES = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
    const WHERE = [['', 'Anywhere'], ['hand', 'In the hand'], ['field-up', 'Field, face-up'], ['field-down', 'Field, face-down']];
    const monsterTypes = () => [...new Set((window.Cards || []).filter(c => c.card_type === 'Monster' && !c.rush && !c.custom).map(c => c.type).filter(t => t && t !== 'Proxy'))].sort();
    function anyEditor(spec, changed) {
      const editor = element('div', '', 'dblite-lab-any');
      const caption = text => element('span', text, 'dblite-lab-any-label');
      const chips = (label, values, key) => {
        const group = element('div', '', 'dblite-lab-chips'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
        group.append(caption(label));
        for (const value of values) {
          const chip = element('button', value, 'dblite-lab-chip'), on = () => (spec[key] || []).includes(value);
          chip.type = 'button'; chip.setAttribute('aria-pressed', String(on()));
          chip.onclick = () => {
            const list = new Set(spec[key] || []); if (list.has(value)) list.delete(value); else list.add(value);
            if (list.size) spec[key] = [...list]; else delete spec[key];
            chip.setAttribute('aria-pressed', String(on())); changed();
          };
          group.append(chip);
        }
        return group;
      };
      const choice = (label, options, get, set) => {
        const wrap = element('label', '', 'dblite-lab-any-field'), select = element('select');
        for (const [value, text] of options) { const option = element('option', text); option.value = value; select.append(option); }
        select.value = get(); select.onchange = () => { set(select.value); changed(); };
        wrap.append(caption(label), select); return wrap;
      };
      const range = (label, key, min, max) => {
        const wrap = element('div', '', 'dblite-lab-any-field'), low = element('input'), high = element('input');
        for (const [input, i, hint] of [[low, 0, 'from'], [high, 1, 'to']]) {
          input.type = 'number'; input.min = String(min); input.max = String(max); input.placeholder = hint; input.inputMode = 'numeric';
          input.setAttribute('aria-label', `${label} ${hint}`); input.value = spec[key]?.[i] ?? '';
          input.oninput = () => {
            const [from, to] = [low.value, high.value].map(v => v === '' || !Number.isFinite(Number(v)) ? null : Math.max(min, Math.min(max, Math.round(Number(v)))));
            if (from == null && to == null) delete spec[key]; else spec[key] = [from ?? min, to ?? max];
            changed();
          };
        }
        wrap.append(caption(label), low, element('span', '–', 'dblite-lab-any-dash'), high); return wrap;
      };
      const named = element('label', '', 'dblite-lab-any-field'), archetype = element('input');
      archetype.type = 'search'; archetype.placeholder = 'e.g. Dragonmaid'; archetype.value = spec.archetype || '';
      archetype.oninput = () => { const v = archetype.value.trim(); if (v) spec.archetype = v; else delete spec.archetype; changed(); };
      named.append(caption('Archetype'), archetype);
      editor.append(chips('Kind', KINDS, 'kinds'), chips('Attribute', ATTRIBUTES, 'attributes'),
        choice('Tuner', [['', 'Either'], ['yes', 'Tuner'], ['no', 'Not a Tuner']], () => spec.tuner == null ? '' : spec.tuner ? 'yes' : 'no', v => { if (v) spec.tuner = v === 'yes'; else delete spec.tuner; }),
        choice('Type', [['', 'Any'], ...monsterTypes().map(t => [t, t])], () => spec.types?.[0] || '', v => { if (v) spec.types = [v]; else delete spec.types; }),
        range('Level / Rank', 'level', 0, 13), range('Link Rating', 'link', 1, 6), range('ATK', 'atk', 0, 5000), range('DEF', 'def', 0, 5000),
        named, choice('Where', WHERE, () => spec.where || '', v => { if (v) spec.where = v; else delete spec.where; }));
      return editor;
    }
    function slot(card, generic) {
      const box = element('div', '', 'dblite-lab-slot'), row = element('div', '', 'dblite-lab-slot-row'), input = element('input');
      input.type = 'search'; input.placeholder = 'Monster name'; input.setAttribute('aria-label', 'Material');
      const pick = element('button', '◉', 'dblite-lab-pick'), remove = element('button', '×', 'dblite-lab-remove'), list = element('div', '', 'dblite-lab-suggest');
      pick.type = remove.type = 'button'; pick.title = 'Use the card in the card overview'; pick.setAttribute('aria-label', pick.title);
      remove.title = 'Remove this material'; remove.setAttribute('aria-label', remove.title);
      const kind = element('button', 'Card', 'dblite-lab-kind'), summary = element('button', '', 'dblite-lab-any-summary');
      kind.type = summary.type = 'button'; kind.title = 'A named card, or Any: a monster described by what you know about it'; summary.hidden = true;
      let spec = null, editor = null;
      const describe = () => { cancelJob(); box.dataset.spec = JSON.stringify(spec); summary.textContent = labGenericLabel(spec); summary.title = 'Show or hide the description'; };
      const setGeneric = (on, given) => {
        cancelJob();
        box.classList.toggle('dblite-lab-slot-any', on); kind.textContent = on ? 'Any' : 'Card'; kind.setAttribute('aria-pressed', String(on));
        kind.setAttribute('aria-label', on ? 'Any monster: switch to a named card' : 'Named card: switch to any monster');
        editor?.remove(); editor = null; list.replaceChildren();
        if (on) { spec = { ...(given || {}) }; delete box.dataset.id; editor = anyEditor(spec, describe); box.append(editor); describe(); }
        else { spec = null; delete box.dataset.spec; }
        input.hidden = pick.hidden = on; summary.hidden = !on;
      };
      kind.onclick = () => setGeneric(!spec);
      summary.onclick = () => { if (editor) editor.hidden = !editor.hidden; };
      const set = monster => { cancelJob(); input.value = monster.name; box.dataset.id = String(monster.id); list.replaceChildren(); };
      input.addEventListener('input', () => {
        delete box.dataset.id; list.replaceChildren();
        const query = normalize(input.value).trim(); if (query.length < 2) return;
        const matches = monsterNames().filter(item => item.key.includes(query)).sort((a, b) => b.key.startsWith(query) - a.key.startsWith(query) || a.key.length - b.key.length).slice(0, 6);
        for (const { card: monster } of matches) { const option = element('button', monster.name, 'dblite-lab-option'); option.type = 'button'; option.onclick = () => set(monster); list.append(option); }
      });
      pick.onclick = () => { const card = shown(); if (card?.card_type === 'Monster') set(card); else help.textContent = 'Show a monster in the card overview first (hover it).'; };
      remove.onclick = () => { cancelJob(); if (slots.children.length > 1) box.remove(); };
      row.append(kind, input, summary, pick, remove); box.append(row, list); slots.append(box);
      if (generic) setGeneric(true, generic); else if (card) set(card);
      return box;
    }
    add.onclick = () => { cancelJob(); if (slots.children.length < 6) slot().querySelector('input').focus(); };
    find.onclick = () => {
      cancelJob();
      // A typed name that is no monster stops the search with a message instead of dropping out silently (2026-10-29:
      // "Theorealized Medius" typed without a suggestion, and nothing seemed to happen).
      const named = box => box.dataset.id || monsterNames().find(item => item.key === normalize(box.querySelector('input').value).trim())?.card.id;
      const unknown = [...slots.children].filter(box => !box.dataset.spec && box.querySelector('input').value.trim() && !named(box));
      for (const box of slots.children) box.classList.toggle('dblite-lab-slot-missing', unknown.includes(box));
      if (unknown.length) { help.textContent = `No monster named “${unknown[0].querySelector('input').value.trim()}”: pick one from the suggestions, or use ◉.`; return; }
      const items = [...slots.children].map(box => box.dataset.spec ? labItemValue(JSON.parse(box.dataset.spec)) : named(box)).filter(Boolean);
      if (!items.length) { help.textContent = 'Pick at least one monster (type a name, ◉ for the card in the overview, or Any to describe one).'; return; }
      const value = `${mode.value}:${items.join(',')}`;
      job = evaluateLab(value, {
        valid: () => active && window.currentLabel === 'deck_constructor' && lab.isConnected && !lab.hidden,
        cancelled: () => { help.textContent = defaultHelp; },
        progress: (checked, total) => { help.textContent = `Checking ${checked.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}\u2026`; },
        complete: () => {
          recordQuery(true); clearSearch(); labInput.value = value; run(); recordQuery(true);
          // The existing synchronous search reads the completed query's cache.
          lab.hidden = true; fields.hidden = false;
        }
      });
    };
    const open = () => {
      cancelJob();
      fields.hidden = true; lab.hidden = false;
      // Two materials by default; the first is the card in the overview.
      if (!slots.children.length) { const card = shown(); slot(card?.card_type === 'Monster' ? card : null); slot(); }
      // Warm the recipe reader while the player chooses materials. This uses the
      // same slices and cancellation as Find, and leaves the help line unchanged.
      job = evaluateLab('', { valid: () => active && window.currentLabel === 'deck_constructor' && lab.isConnected && !lab.hidden });
      // Not on touch screens: the focus opens the keyboard over most of a phone's screen (pre-launch pass, 2026-10-29).
      if (!document.documentElement.classList.contains('dbetter-touch')) slots.querySelector('input:placeholder-shown')?.focus?.();
    };
    back.onclick = () => { cancelJob(); lab.hidden = true; fields.hidden = false; };
    labEdit.onclick = open;
    const opener = element('button', '', 'dblite-lab-open'); opener.type = 'button';
    opener.append(labIcon(), document.createTextNode(' Summon Lab'), element('span', 'Beta', 'dblite-lab-beta'));
    opener.title = 'Pick monsters and see which Fusion, Synchro, Xyz and Link Monsters they can make';
    opener.onclick = open;
    more.querySelector('summary').after(opener);
    syncLab = found => {
      const value = labOf(labInput.value);
      const unchecked = value?.notEvaluated?.size || 0;
      incompleteHelp.hidden = !unchecked;
      incompleteHelp.textContent = unchecked ? `${unchecked} monster${unchecked === 1 ? ' was' : 's were'} not evaluated within the search limit. Narrow the Any slots and try again.` : '';
      help.textContent = unchecked ? incompleteHelp.textContent : 'Pick monsters, or describe one with Any: which Fusion, Synchro, Xyz and Link Monsters can they make?';
      labRow.hidden = !value; if (!value) { labLabel.replaceChildren(); return; }
      const counts = found ? ['Fusion', 'Synchro', 'Xyz', 'Link'].map(kind => [kind, found.filter(c => String(c.monster_color).includes(kind)).length]).filter(([, n]) => n) : [];
      labLabel.replaceChildren(labIcon(), ` ${value.mode === 'includes' ? 'With' : 'From'} ${value.materials.map(m => m.name).join(' + ')}${counts.length ? ' · ' + counts.map(([kind, n]) => `${n} ${kind}`).join(' · ') : ''}`);
      labRow.title = (value.mode === 'includes' ? 'Extra Deck monsters that can use these monsters among their materials.' : 'Extra Deck monsters these monsters can make, using exactly them.') + ' Read from each material line; not rules-complete.';
    };
  }
  function build() {
    const root = document.getElementById('deck_constructor'), native = document.getElementById('search');
    if (!root || !native || typeof window.SearchCard !== 'function') return;
    const options = cls => [...native.querySelectorAll('.' + cls + ' option')].map(o => [o.value, o.textContent]);
    ui = element('section', '', 'dblite-builder-search'); ui.id = 'dblite-builder-search'; ui.setAttribute('aria-label', 'Spellspeed card search');
    const header = element('div', '', 'dblite-builder-heading'), orientation = element('button');
    orientation.type = 'button'; controls.layout = orientation;
    header.append(element('h2', 'Card search')); ui.append(header);
    const historyBack = element('button', '↶', 'dblite-history-back'); historyBack.type = 'button'; historyBack.title = 'Back to the previous search'; historyBack.setAttribute('aria-label', 'Back to the previous search');
    const recent = element('select', '', 'dblite-history-recent'); recent.setAttribute('aria-label', 'Recent searches'); recent.title = 'Recent searches (last 10)';
    historyBack.onclick = goBack;
    recent.onchange = () => { const entry = history[Number(recent.value)]; if (entry) restoreQuery(entry); };
    for (const [node, width] of [[historyBack, '22px'], [recent, '74px']]) for (const [k, v] of [['width', width], ['height', '17px'], ['min-height', '17px'], ['padding', '0 2px'], ['font-size', node === historyBack ? '12px' : '9px'], ['line-height', '15px']]) node.style.setProperty(k, v, 'important');
    header.append(historyBack, recent); historyUI = { back: historyBack, recent };
    const sizes = select('Card size', SIZE_NAMES, 'grid', header);
    header.append(orientation);
    const fields = element('div', '', 'dblite-builder-fields'); ui.append(fields);
    // Describe search: plain words, each part read shown as a chip (× takes its words out). A beta, in More options
    // beside the Summon Lab (user, 2026-11-02): it reads the card texts literally.
    const describeRow = element('div', '', 'dblite-describe'), describeLine = element('div', '', 'dblite-describe-line'), describe = controls.describe = element('input');
    describe.type = 'search'; describe.placeholder = 'Describe it: revive fire monster, level 4 tuner…'; describe.setAttribute('aria-label', 'Describe the cards (beta)');
    describe.title = 'What the card is and what it does, in plain words: "hand trap", "spellcasters that can search", "negate spell", "level 4 or lower tuner", "search Phara", "-fire". Words after an effect say what it acts on. Beta: it reads the card texts literally, so slang such as "board breaker" or "omni negate" in the meta sense is not understood.';
    describe.spellcheck = false; describe.autocomplete = 'off';
    controls.describeChips = element('div', '', 'dblite-describe-chips'); controls.describeChips.setAttribute('aria-live', 'polite');
    describeLine.append(describe, element('span', 'Beta', 'dblite-lab-beta')); describeRow.append(describeLine, controls.describeChips);
    for (const [label, key] of [['Name', 'name'], ['Description', 'effect']]) {
      const row = element('div', '', 'dblite-search-text'), input = element('input'); input.type = 'search'; input.placeholder = label; input.setAttribute('aria-label', label); controls[key] = input; row.append(input);
      const mode = select(label + ' matching', [['exact', 'Exact'], ['all', '* sep']], key + 'Mode', row);
      mode.title = 'Exact: match the complete text. * sep: separate terms with *; every term must match.';
      // Typing * means separate terms: switch to * sep.
      input.addEventListener('input', () => { if (input.value.includes('*') && mode.value !== 'all') mode.value = 'all'; });
      fields.append(row);
    }
    // Reverse search, started from the card overview: Access or Synergy for one card.
    const fetchRow = element('div', '', 'dblite-fetch-filter'), fetchInput = controls.fetches = element('input');
    fetchInput.type = 'hidden';
    const fetchLabel = element('span', '', 'dblite-fetch-label'), fetchClear = element('button', '×', 'dblite-fetch-clear');
    fetchClear.type = 'button'; fetchClear.title = 'Stop the reverse search'; fetchClear.setAttribute('aria-label', 'Stop the reverse search');
    fetchClear.onclick = () => { fetchInput.value = ''; run(); };
    const accessGear = element('button', '⚙', 'dblite-access-gear'); accessGear.type = 'button';
    accessGear.title = 'What counts as Access'; accessGear.setAttribute('aria-label', 'What counts as Access'); accessGear.setAttribute('aria-expanded', 'false');
    const accessOptions = element('div', '', 'dblite-access-options'); accessOptions.hidden = true; accessOptions.setAttribute('role', 'group'); accessOptions.setAttribute('aria-label', 'What counts as Access');
    const accessTitle = element('span', 'Access from the Deck:', 'dblite-access-title'); accessOptions.append(accessTitle);
    accessOptions.dataset.deck = 'main';
    for (const [action, label] of ACCESS_ACTIONS) {
      const line = element('label'), box = element('input'); box.type = 'checkbox'; box.value = action; box.checked = accessActions.main.has(action);
      box.addEventListener('change', event => {
        event.stopPropagation();
        setAccessActions([...accessOptions.querySelectorAll('input:checked')].map(n => n.value), accessOptions.dataset.deck); run();
      });
      line.append(box, document.createTextNode(' ' + label)); accessOptions.append(line);
    }
    accessGear.onclick = () => { accessOptions.hidden = !accessOptions.hidden; accessGear.setAttribute('aria-expanded', String(!accessOptions.hidden)); };
    fetchRow.append(fetchInput, fetchLabel, accessGear, fetchClear); fetchRow.hidden = true; fields.prepend(fetchRow); fetchRow.after(accessOptions);
    // Hovering the card's name shows it in the card overview.
    fetchLabel.addEventListener('mouseover', event => {
      const reverse = event.target.closest?.('.dblite-fetch-name') && reverseOf(fetchInput.value), target = reverse && reverse.mode !== 'support' && catalogCard(reverse.id);
      if (target && typeof window.previewFront === 'function' && window.jQuery) window.previewFront(window.jQuery('<div>').data({ ...target, effect: target.effect || '', pendulum_effect: target.pendulum_effect || '' }));
    });
    syncFetch = named => {
      const reverse = reverseOf(fetchInput.value), target = reverse && catalogCard(reverse.id), synergy = reverse?.mode === 'synergy';
      // Starters share Access's ⚙ (user, 2026-10-30): each step of a chain counts what Access counts.
      fetchRow.hidden = !reverse; accessGear.hidden = !reverse || !['access', 'starters', 'ideas'].includes(reverse.mode); if (accessGear.hidden) accessOptions.hidden = true;
      const gearTitle = ['starters', 'ideas'].includes(reverse?.mode) ? 'What counts as Access, at each step of a Starter' : 'What counts as Access';
      accessGear.title = gearTitle; accessGear.setAttribute('aria-label', gearTitle);
      // The ⚙ choices are those of the target's Deck.
      const deck = target && extraDeckMonster(target) ? 'extra' : 'main';
      if (!accessGear.hidden && accessOptions.dataset.deck !== deck) {
        accessOptions.dataset.deck = deck; accessTitle.textContent = deck === 'extra' ? 'Access from the Extra Deck:' : 'Access from the Deck:';
        for (const box of accessOptions.querySelectorAll('input')) box.checked = accessActions[deck].has(box.value);
      }
      const name = element('span', target?.name || 'unknown card', 'dblite-fetch-name');
      const what = { synergy: 'Synergy with', starters: 'Starters for', ideas: 'Ideas for', support: 'Support for', access: 'Access to' }[reverse?.mode];
      if (reverse?.mode === 'support') name.textContent = reverse.id;
      if (reverse) fetchLabel.replaceChildren(`⤺ ${what} “`, name, `”${named ? ` · ${named} ${{ support: 'reach half its monsters or more', starters: 'on their own first', ideas: named === 1 ? 'Starter first' : 'Starters first' }[reverse.mode] || 'by name first'}` : ''}`); else fetchLabel.replaceChildren();
      fetchRow.title = ({ synergy: 'Access, plus cards that add, summon, Set or send this card from anywhere, cards that name it or its archetype, and the cards it names or fetches.',
        starters: 'Starters: cards that, alone in your opening hand, get this card on their own (listed first) or search or summon one of its own searchers (named, archetype or mention), which then gets it; no other card, and nothing from your opponent. Lines by chance come after the sure ones. Hover a result to see how. Each step counts what Access counts: ⚙ changes it for both.',
        ideas: 'Ideas: every card that gets this card alone or through one of its searchers, also when it needs more than that one card: a cost, a condition, a trigger, a place. Each result says what it needs. The Starters come first, then the cards that get it but need something, then the two-step lines, searchers of any card of its kind included. Each step counts what Access counts: ⚙ changes it.',
        support: 'Cards outside the archetype that can search or summon at least a quarter of its monsters (and at least 2), most first.' }[reverse?.mode]
        || 'Cards whose text takes this card out of its Deck: the Extra Deck for Fusion, Synchro, Xyz and Link Monsters, the Main Deck for the rest. ⚙ chooses what counts (search, Special Summon, Set, send to the GY, banish), separately for Extra Deck monsters.') + ' Read from the card texts; not rules-complete.';
    };
    const filters = element('div', '', 'dblite-filter-grid'); fields.append(filters);
    for (const [label, cls, key] of [['Card', 'card_cb', 'card_type'], ['Frame', 'card2_cb', 'monster_color'], ['Ability', 'type2_cb', 'ability'], ['Attribute', 'attrib_cb', 'attribute'], ['Limit', 'limit_cb', 'limit']]) multi(label, options(cls), key, filters);
    // Skill characters, Rush-exclusive types and the editor's Proxy placeholder are not monster types.
    const types = [...new Set(window.Cards.filter(c => c.card_type === 'Monster' && !c.rush && !c.custom).map(c => c.type).filter(t => t && t !== 'Proxy'))].sort();
    multi('Type', types.map(t => [t, t]), 'type', filters);
    multi('Spell/Trap', [['Spell', ['Normal', 'Continuous', 'Equip', 'Quick-Play', 'Field', 'Ritual']],
      ['Trap', ['Normal', 'Continuous', 'Counter']]].flatMap(([kind, properties]) =>
      properties.map(property => [`${kind}:${property}`, `${kind} \u00b7 ${property}`])), 'spell_trap', filters);
    const closeFilters = () => { for (const details of filters.querySelectorAll('details')) details.open = false; };
    document.addEventListener('pointerdown', event => { if (!filters.contains(event.target)) closeFilters(); });
    filters.addEventListener('keydown', event => { if (event.key === 'Escape') { const current = event.target.closest('details'); closeFilters(); current?.querySelector('summary').focus(); event.stopPropagation(); } });
    const stats = element('div', '', 'dblite-stat-grid'); fields.append(stats);
    for (const [label, key] of [['Level / Rank', 'level'], ['ATK', 'atk'], ['DEF', 'def'], ['Scale', 'scale']]) range(label, key, stats);
    const more = element('details', '', 'dblite-builder-more'); more.append(element('summary', 'More options')); fields.append(more);
    buildLab(fields, more, fetchRow);
    (more.querySelector('.dblite-lab-open') || more.querySelector('summary')).after(describeRow);
    const checks = element('div', '', 'dblite-checks'); more.append(checks);
    for (const key of ['pendulum', 'tcg', 'ocg']) checkbox(key === 'pendulum' ? 'Pendulum' : key.toUpperCase(), key, checks);
    const arrows = element('div', '', 'dblite-checks'); arrows.setAttribute('aria-label', 'Link arrows'); more.append(arrows);
    controls.arrows = ['↖', '↑', '↗', '→', '↘', '↓', '↙', '←'].map((label, i) => checkbox(label, 'arrow' + i, arrows));
    // Effect categories (OR within the filter) and ATK/DEF relations (Monsters only).
    const moreGrid = element('div', '', 'dblite-filter-grid dblite-more-grid'); more.append(moreGrid);
    multi('Effect', effectCategoryLabels, 'category', moreGrid);
    const relation = element('div', '', 'dblite-stat-relation'); more.append(relation);
    select('ATK vs DEF', [['', 'ATK vs DEF'], ['eq', 'ATK = DEF'], ['gt', 'ATK > DEF'], ['lt', 'ATK < DEF']], 'statRelation', relation);
    select('Stat expression', [['', 'Expression'], ['sum', 'ATK + DEF'], ['diff', 'ATK − DEF'], ['rdiff', 'DEF − ATK']], 'statExpr', relation);
    select('Expression comparison', [['eq', '='], ['ge', '≥'], ['le', '≤']], 'statCompare', relation);
    const statInput = controls.statValue = element('input'); statInput.type = 'text'; statInput.inputMode = 'numeric'; statInput.placeholder = 'Value'; statInput.maxLength = 6;
    statInput.setAttribute('aria-label', 'Stat expression value'); relation.append(statInput);
    statInput.addEventListener('input', () => { statInput.value = statInput.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, ''); });
    relation.title = 'Monsters only. Unknown (?) stats never match; Link Monsters have no DEF.';
    const closeMore = () => { for (const details of moreGrid.querySelectorAll('details')) details.open = false; };
    document.addEventListener('pointerdown', event => { if (!moreGrid.contains(event.target)) closeMore(); });
    moreGrid.addEventListener('keydown', event => { if (event.key === 'Escape') { const current = event.target.closest('details'); closeMore(); current?.querySelector('summary').focus(); event.stopPropagation(); } });
    // Online custom-card search remains native; official/fixed pools use the local catalog.
    select('Pool', options('custom_cb').filter(([v]) => !['1', '2', '3'].includes(v)), 'pool', more);
    const nativeButton = element('button', 'Custom cards / native search'); nativeButton.type = 'button'; nativeButton.onclick = () => { active = false; root.classList.toggle('dblite-constructor', false); root.classList.toggle('dblite-constructor-native', true); ui.hidden = true; controls.return.hidden = false; restoreCards(); }; more.append(nativeButton);
    const points = element('div', '', 'dblite-builder-points'); controls.pointsRow = points; fields.append(points);
    checkbox('Filter Genesys points', 'pointsEnabled', points); range('Points', 'points', points);
    const pointRange = points.querySelector('.dblite-range'); pointRange.hidden = true;
    controls.pointsEnabled.addEventListener('change', () => { pointRange.hidden = !controls.pointsEnabled.checked; if (!pointRange.hidden) pointRange.scrollIntoView?.({ block: 'nearest' }); });
    fields.insertBefore(points, more);
    const actions = element('div', '', 'dblite-builder-actions'), submit = element('button', 'Search'), clear = element('button', '⌫ Clear');
    controls.phrase = element('input'); controls.phrase.type = 'hidden'; fields.append(controls.phrase);
    fields.addEventListener('input', event => { if (event.target === controls.name || event.target === controls.effect) controls.phrase.value = ''; });
    submit.type = clear.type = 'button'; clear.title = 'Clear search filters'; clear.setAttribute('aria-label', 'Clear search filters'); submit.onclick = run;
    // A link's search clears the fields, then searches once: no search of the whole catalog in between (about 50 ms).
    clearSearch = () => resetFields();
    clear.onclick = () => { resetFields(); run(); }; actions.append(submit, clear); ui.append(actions);
    const resetFields = () => { controls.phrase.value = ''; controls.nameMode.value = controls.effectMode.value = 'exact'; controls.describe.value = controls.name.value = controls.effect.value = controls.fetches.value = controls.lab.value = ''; for (const inputs of Object.values(multis)) for (const input of inputs) { input.checked = false; delete input.dataset.exclude; input.dispatchEvent(new Event('change')); } for (const inputs of Object.values(ranges)) inputs.forEach(n => n.value = ''); for (const key of ['pendulum', 'tcg', 'ocg', 'pointsEnabled']) controls[key].checked = false; pointRange.hidden = true; controls.arrows.forEach(n => n.checked = false); controls.statRelation.value = controls.statExpr.value = ''; controls.statCompare.value = 'eq'; controls.statValue.value = ''; };
    const pager = element('div', '', 'dblite-builder-pager'); controls.previous = element('button', '‹'); controls.next = element('button', '›'); controls.status = element('output', 'Search cards');
    controls.previous.setAttribute('aria-label', 'Previous results'); controls.next.setAttribute('aria-label', 'Next results');
    controls.previous.onclick = () => { page--; render(); }; controls.next.onclick = () => { page++; render(); }; pager.append(controls.previous, controls.status, controls.next); ui.append(pager);
    controls.status.title = 'Scroll down for the next page; scroll up for the previous page';
    let lastWheelAt = -Infinity, lastWheelDirection = 0;
    controls.status.addEventListener('wheel', event => {
      if (!active || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault(); event.stopPropagation();
      const direction = Math.sign(event.deltaY), now = performance.now();
      // A trackpad's inertial burst should not race through many pages.
      if (direction === lastWheelDirection && now - lastWheelAt < 160) return;
      lastWheelAt = now; lastWheelDirection = direction;
      page += direction; render();
    }, { passive: false });
    const order = select('Order', [['Alpha', 'Alpha'], ['ATK', 'ATK'], ['DEF', 'DEF'], ['LVL', 'LVL'], ['Date', 'Release']], 'order', pager);
    const direction = element('button', '', 'dblite-sort-direction'); direction.type = 'button'; pager.append(direction);
    try {
      const savedOrder = localStorage.getItem('dbetter-search-order');
      if ([...order.options].some(o => o.value === savedOrder)) order.value = savedOrder;
      descending = localStorage.getItem('dbetter-search-descending') === 'true';
    } catch {}
    function labelDirection() {
      direction.textContent = descending ? '↓' : '↑';
      direction.setAttribute('aria-label', `Sort direction: ${descending ? 'Descending' : 'Ascending'}`);
      direction.title = `${descending ? 'Descending' : 'Ascending'} — click to reverse`;
    }
    labelDirection();
    direction.onclick = () => { descending = !descending; try { localStorage.setItem('dbetter-search-descending', String(descending)); } catch {} labelDirection(); run(); };
    order.addEventListener('change', () => { try { localStorage.setItem('dbetter-search-order', order.value); } catch {} });
    // Older saves stored a row count (4-7) or 'auto'; map them to the nearest size.
    try { const saved = localStorage.getItem('dbetter-search-columns'); gridSize = SIZE_ROWS[saved] ? saved : ({ 4: 'l', 5: 'm', 6: 's', 7: 'xs' })[saved] || (document.documentElement.classList.contains('dbetter-phone') ? 'xxl' : 'm'); } catch {}
    orientation.hidden = true; // Size and panel width now decide the grid shape.
    sizes.title = 'Card size: rows follow the size, columns fill the search width';
    sizes.parentElement.style.setProperty('width', '76px', 'important'); // Fits "Very small".
    sizes.value = gridSize; sizes.onchange = () => { gridSize = sizes.value; page = 1; try { localStorage.setItem('dbetter-search-columns', gridSize); } catch {} render(); };
    ui.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !event.isComposing) { event.preventDefault(); run(); }
    });
    ui.addEventListener('input', event => { if (event.isComposing) return; clearTimeout(debounce); debounce = setTimeout(run, 150); });
    ui.addEventListener('compositionend', () => { clearTimeout(debounce); debounce = setTimeout(run, 150); });
    ui.addEventListener('change', event => { if (event.target !== controls.grid && event.target !== recent) run(); });
    ui.append(buildResizer());
    root.append(ui);
    const back = element('button', 'Spellspeed search', 'dblite-native-return'); back.type = 'button'; back.hidden = true;
    back.onclick = () => { active = true; back.hidden = true; ui.hidden = false; root.classList.toggle('dblite-constructor-native', false); root.classList.toggle('dblite-constructor', true); run(); }; root.append(back); controls.return = back;
    document.getElementById('banlists')?.addEventListener('change', () => { if (active && query) run(); });
    active = true; root.classList.toggle('dblite-constructor', true);
  }
  // Stop native document/html Tab handlers from moving focus a second time.
  window.addEventListener('keydown', event => {
    if (window.currentLabel !== 'deck_constructor' || event.key !== 'Tab' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const nativeName = document.querySelector('#search .name_txt'), nativeEffect = document.querySelector('#search .desc_txt');
    const destination = event.target === controls.name ? controls.effect : event.target === controls.effect ? controls.name :
      event.target === nativeName ? nativeEffect : event.target === nativeEffect ? nativeName : null;
    if (!destination) return;
    // Auto-focus blocker userscripts replace HTMLInputElement.prototype.focus; this is a user key press.
    event.preventDefault(); event.stopImmediatePropagation(); HTMLElement.prototype.focus.call(destination, { preventScroll: true });
    destination.setSelectionRange(destination.value.length, destination.value.length);
  }, true);
  // Left / Right arrows turn the result pages unless a text field or menu has the keyboard.
  window.addEventListener('keydown', event => {
    if (!active || !ui || ui.hidden || window.currentLabel !== 'deck_constructor' || !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
      event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    const target = event.target;
    if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="separator"], details[open]')) return;
    const button = event.key === 'ArrowLeft' ? controls.previous : controls.next;
    if (!button || button.disabled) return;
    event.preventDefault(); page += event.key === 'ArrowLeft' ? -1 : 1; render();
  });
  function restoreCards() {
    resultBackground?.remove();
    document.getElementById('deck_constructor')?.classList.toggle('dblite-constructor-ready', false);
    for (const card of window.search_arr || []) { card?.detach(); if (card?.[0]?.dataset.dbliteResult) { card[0].style.removeProperty('transform'); delete card[0].dataset.dbliteResult; } }
    // Recreate result slots with native coordinates on the next native search.
    window.search_arr = []; window.saved_search = null; window.awaiting_cards = false;
  }
  let gotoHook;
  function navigation() {
    const original = window.goto;
    if (typeof original !== 'function' || original === gotoHook || window.DBLiteRules?.hasHook(original, gotoHook)) return;
    gotoHook = function (...args) {
      if (window.DBETTERRebuilding) return original.apply(this, args);
      if (active && window.currentLabel === 'deck_constructor' && args[0] !== 'deck_constructor') {
        clearTimeout(debounce); restoreCards(); wasConstructor = false;
      }
      const result = original.apply(this, args);
      if (args[0] === 'deck_constructor') tick();
      return result;
    };
    window.DBLiteRules?.markHook(gotoHook, original); window.goto = gotoHook;
  }
  // Undo in the deck constructor (user, 2026-10-28): the last change to the deck (adding, removing, moving a card
  // between Main, Side and Extra, Clear Deck) can be undone with ↶ under the privacy button, or Ctrl+Z outside
  // text fields. DuelingBook keeps each list as card fronts (deck_filled_arr ...); a snapshot copies them before
  // the first change of a click, drag or key press, so a move (a removal and an addition) is one step. Restoring
  // takes the path of DuelingBook's own Clear Deck → Undo: clearDeck(true), then the fronts added back while
  // loading_deck is set. A change made while DuelingBook loads a deck (opening one, importing, its own Undo)
  // starts over.
  const UNDO_LIMIT = 30;
  const undo = { stack: [], gesture: 0, recorded: -1, restoring: false, deck: null, button: null };
  const deckLists = () => [['deck_filled_arr', 'addCardToMain'], ['side_filled_arr', 'addCardToSide'], ['extra_filled_arr', 'addCardToExtra']];
  const deckKey = () => String(window.deck?.id ?? window.currentDeckId ?? '');
  const deckSignature = () => deckLists().map(([list]) => (window[list] || []).map(card => card.data('id')).join(',')).join('|');
  function deckSnapshot() {
    return { deck: deckKey(), signature: deckSignature(), lists: deckLists().map(([list]) => (window[list] || []).map(card => {
      const copy = window.newCardFront(); copy.copyCard(card); return copy;
    })) };
  }
  function undoReady() {
    return window.currentLabel === 'deck_constructor' && ['newCardFront', 'clearDeck', 'addCardToMain', 'addCardToSide', 'addCardToExtra'].every(name => typeof window[name] === 'function');
  }
  function refreshUndo() {
    if (undo.deck !== deckKey()) { undo.stack.length = 0; undo.deck = deckKey(); }
    if (undo.button) { const none = !undo.stack.length; undo.button.disabled = none; undo.button.title = none ? 'Nothing to undo' : 'Undo the last change to the deck (Ctrl+Z)'; }
  }
  function undoDeck() {
    if (!undoReady()) return false;
    refreshUndo();
    // A step that changed nothing (a full deck refusing a card) is skipped.
    let snapshot = undo.stack.pop();
    while (snapshot && snapshot.signature === deckSignature()) snapshot = undo.stack.pop();
    if (!snapshot) { refreshUndo(); return false; }
    undo.restoring = true;
    try {
      window.clearDeck(true);
      window.loading_deck = true;
      deckLists().forEach(([, add], i) => { for (const card of snapshot.lists[i]) window[add](card); });
    } finally {
      window.loading_deck = false; undo.restoring = false;
    }
    window.initializeDeckCards?.(); window.countMain?.(); window.countSide?.(); window.countExtra?.(); window.countPoints?.();
    window.setUnsavedChanges?.();
    // DuelingBook's own Clear Deck → Undo must not bring back an older deck afterwards.
    window.tempMainState = []; window.tempSideState = []; window.tempExtraState = [];
    const clear = document.querySelector('#deck_constructor #clear_btn');
    if (clear) window.jQuery ? window.jQuery(clear).val('Clear Deck') : clear.value = 'Clear Deck';
    refreshUndo(); return true;
  }
  function hookDeckChanges() {
    for (const name of ['addCardToMain', 'addCardToSide', 'addCardToExtra', 'removeCardFromMain', 'removeCardFromSide', 'removeCardFromExtra', 'clearDeck']) {
      const original = window[name];
      if (typeof original !== 'function' || original.dbliteDeckUndo) continue;
      const wrapped = function (...args) {
        if (window.DBETTERRebuilding || undo.restoring) return original.apply(this, args);
        if (window.loading_deck || window.currentLabel !== 'deck_constructor') {
          // Loaded, imported or restored by DuelingBook itself: the earlier steps no longer apply.
          if (!undo.restoring && window.currentLabel === 'deck_constructor' && undo.stack.length) { undo.stack.length = 0; refreshUndo(); }
          return original.apply(this, args);
        }
        const first = undo.recorded !== undo.gesture, before = first ? deckSnapshot() : null;
        // Opening another deck: DuelingBook switches the deck, then clears it before loading_deck is set. A change to a
        // deck other than the one under the click is that load, not a step (release review, 2026-10-29: an empty deck
        // opened after a full one got the full one back with Undo).
        if (before && before.deck !== undo.gestureDeck) {
          undo.stack.length = 0; undo.deck = before.deck; refreshUndo();
          return original.apply(this, args);
        }
        const result = original.apply(this, args);
        if (before && before.signature !== deckSignature()) {
          if (before.deck !== undo.deck) undo.stack.length = 0;
          undo.stack.push(before); undo.recorded = undo.gesture; undo.deck = before.deck;
          if (undo.stack.length > UNDO_LIMIT) undo.stack.shift();
          refreshUndo();
        }
        return result;
      };
      window.DBLiteRules?.markHook(wrapped, original); wrapped.dbliteDeckUndo = true; window[name] = wrapped;
    }
  }
  // Each click, drag or key press is one step, whatever number of native changes it makes.
  for (const type of ['pointerdown', 'mousedown', 'keydown', 'dblclick', 'contextmenu', 'drop']) document.addEventListener(type, () => { undo.gesture++; undo.gestureDeck = deckKey(); }, true);
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z' || !undoReady()) return;
    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (undoDeck()) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  // ↶ under the privacy button (locked / unlocked, whichever DuelingBook shows), the same size.
  function deckUndoControls(root) {
    if (!root || !undoReady()) return;
    hookDeckChanges();
    const lock = [...root.querySelectorAll('.locked_btn,.unlocked_btn')].find(node => getComputedStyle(node).display !== 'none');
    if (!lock) { if (undo.button) undo.button.hidden = true; return; }
    if (!undo.button) {
      const button = undo.button = element('button', '↶', 'dblite-deck-undo'); button.type = 'button';
      button.setAttribute('aria-label', 'Undo the last change to the deck');
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); undoDeck(); });
    }
    const button = undo.button, css = getComputedStyle(lock);
    if (button.parentElement !== lock.parentElement) lock.parentElement.append(button);
    button.hidden = false;
    const left = css.left, top = (parseFloat(css.top) || 0) + (lock.offsetHeight || parseFloat(css.height) || 34) + 6 + 'px', size = (lock.offsetWidth || parseFloat(css.width) || 34) + 'px';
    for (const [key, value] of [['left', left], ['top', top], ['width', size], ['height', size]]) if (button.style[key] !== value) button.style[key] = value;
    refreshUndo();
  }
  function tick() {
    if (window.DBETTERRebuilding) return;
    navigation();
    advancePractice();
    document.documentElement.classList.toggle('dblite-in-constructor', window.currentLabel === 'deck_constructor');
    // Here the chat buttons' own tooltips would cover the deck controls (night.css): a title by the cursor instead.
    for (const [id, title] of [['chat_btn', 'Public Chat'], ['private_btn', 'Private Chat'], ['online_btn', 'Online Users']]) {
      const button = document.getElementById(id), want = window.currentLabel === 'deck_constructor' ? title : null;
      if (button && button.getAttribute('title') !== want) want ? button.setAttribute('title', want) : button.removeAttribute('title');
    }
    // The kept Access, Starters and Ideas ranks do not follow a card changed in place: they go with the constructor.
    if (window.currentLabel !== 'deck_constructor') { closeSoloSettings(); closeOverviewSettings(); closeDeckMenu(); if (wasConstructor && active) restoreCards(); if (wasConstructor) fetchRankCache.clear(); wasConstructor = false; return; }
    soloControls();
    applyOverview(); if (!ui && overviewExtra()) applyDeckScale(currentWidth());
    compactControls(document.getElementById('deck_constructor'));
    deckUndoControls(document.getElementById('deck_constructor'));
    if (soloButton && !practicePlan) soloButton.disabled = false;
    if (!ui && window.cards_fingerprint && window.Cards?.length && !window.awaiting_cards) build();
    if (!ui || !active) return;
    if (!wasConstructor) { wasConstructor = true; run(); }
    const genesys = !!window.ShowingPoints;
    controls.pointsRow.hidden = !genesys;
    if (lastGenesys !== undefined && lastGenesys !== genesys && query) run();
    lastGenesys = genesys;
  }
  const helperCache = {};
  window.DBETTERConstructor = Object.freeze({ tick, autoColumns, resize: () => { if (active && wasConstructor) render(); }, aliases,
    // A card's names for a name search, normalized: its own and the names it is always treated as ("Power Patron" for Theorealized Medius).
    names: card => card?.name ? indexedText(card).name : [], textMatch, inRange, matches, effectCategories: card => [...categoriesOf(card)], statMatch, searchWidth: currentWidth,
    searchFor, searchFetchers, catalogCard, archetypesOf, fetches, fetchRank: relatedRank, fetchClauses, fitsPhrase, phraseRequest, materialRecipe,
    searchSupport, searchNeed, searchLabWay, openingOdds, showOdds, undoDeck,
    // Describe search: the query read, a card's rank against it, and why a result of the current search matched ([{ label, text }]).
    describeRead: raw => describeRead(String(raw ?? '')), describeRank: (card, raw) => describeRank(card, describeRead(String(raw ?? ''))),
    describeWhy: card => query?.described?.active && card ? environmentCache?.describeWhy?.get(card) || null : null,
    summonLabEnabled: SUMMON_LAB_ENABLED, synergyEnabled: SYNERGY_ENABLED,
    labNeeds: (card, ids, mode = 'includes') => !ids && !SUMMON_LAB_ENABLED ? null : labNeeds(card, ids ? labOf(`${mode}:${ids.map(labItemValue).join(',')}`) : labOf(controls.lab?.value)),
    labDetail: (card, ids, mode = 'includes') => !ids && !SUMMON_LAB_ENABLED ? null : labDetail(card, ids ? labOf(`${mode}:${ids.map(labItemValue).join(',')}`) : labOf(controls.lab?.value)),
    starterStep: card => { const reverse = reverseOf(controls.fetches?.value); return ['starters', 'ideas'].includes(reverse?.mode) && card ? environmentCache?.starterSteps?.get(card) || null : null; },
    // How the starter reaches its step: { move: 'get' | 'summon' (from the Extra Deck) | 'destroy' (in the Deck), self: the step destroys itself },
    // action: what the step does to the card; or the card on its own: { move: 'direct', action, chance }. An Ideas line
    // adds idea: { starter, step: what each needs, generic: the step finds any card of that kind }.
    starterHow: card => { const reverse = reverseOf(controls.fetches?.value); return ['starters', 'ideas'].includes(reverse?.mode) && card ? environmentCache?.starterHow?.get(card) || null : null; },
    // For checks outside a search: the step list and the members are worked out once per card / archetype.
    starterRank: (card, target) => { if (helperCache.target !== target) helperCache.target = target, helperCache.via = starterVia(target), helperCache.steps = null; return starterRank(card, target, helperCache.via); },
    ideaRank: (card, target) => { if (helperCache.target !== target) helperCache.target = target, helperCache.via = starterVia(target), helperCache.steps = null; helperCache.steps ||= ideaVia(target); return ideaRank(card, target, helperCache.via, helperCache.steps); },
    supportRank: (card, name) => { if (helperCache.name !== name) helperCache.name = name, helperCache.members = archetypeMembers(name); return supportRank(card, name, helperCache.members); },
    labGenericLabel, labItemValue,
    evaluateLab: (ids, mode = 'exact', callbacks) => evaluateLab(`${mode}:${ids.map(labItemValue).join(',')}`, callbacks),
    labRank: (card, ids, mode = 'exact') => labRank(card, labOf(`${mode}:${ids.map(labItemValue).join(',')}`)),
    searchMaterials: (ids, mode = 'exact') => { if (!SUMMON_LAB_ENABLED || !ui || !active || window.currentLabel !== 'deck_constructor') return false; recordQuery(true); clearSearch(); controls.lab.value = `${mode}:${ids.map(labItemValue).join(',')}`; run(); recordQuery(true); return !!labOf(controls.lab.value); },
    accessActions: (deck = 'main') => [...accessActions[deck]], setAccessActions: (list, deck = 'main') => { setAccessActions(list, deck); if (active) run(); },
    returnToDeck: plan => {
      if (!window.solo || !window.duelist || window.replay || typeof window.exitDuel !== 'function' || typeof window.gotoDeckConstructor !== 'function') return false;
      const deck = window.decks?.find(d => Number(d.id) === Number(plan.deckId));
      if (!deck) return false;
      window.exitDuel(false); window.deck = deck;
      // Native options use deck labels as values; select by index like DuelingBook so its proxy shows the name.
      const index = window.decks.indexOf(deck);
      if (index >= 0 && typeof window.decklist_cb.selectedIndex === 'function') window.decklist_cb.selectedIndex(index); else window.decklist_cb.val(deck.label ?? String(deck.id));
      window.gotoDeckConstructor(true); return true;
    },
    takePractice: () => { if (!practicePlan || practicePlan.stage !== 'opening' || !window.solo || !window.duelist || window.replay || !window.duel_active) return null; const plan = practicePlan; plan.showStatus(''); practicePlan = null; return plan; }
  });
})();

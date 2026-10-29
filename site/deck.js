// Main Deck view: a deck grid of small cards and a large preview, like a deck constructor.
(() => {
  const view = document.querySelector('[data-deck]');
  if (!view) return;
  const preview = view.querySelector('.deck-preview');
  const grid = view.querySelector('.deck-grid');
  const cards = [...document.querySelectorAll('template[data-card]')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function tilt(card) {
    if (reduce) return;
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', x * 100 + '%');
      card.style.setProperty('--my', y * 100 + '%');
      card.style.setProperty('--ry', (x - .5) * 10 + 'deg');
      card.style.setProperty('--rx', (.5 - y) * 8 + 'deg');
    });
    card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  }

  function show(i) {
    preview.replaceChildren(cards[i].content.cloneNode(true));
    grid.querySelectorAll('.deck-pick').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    tilt(preview.querySelector('.ycard'));
  }

  // Each small card is the whole card, its blocks turned into spans so it can sit inside a button.
  cards.forEach((t, i) => {
    const src = t.content;
    const mini = document.createElement('span');
    mini.className = 'ycard';
    mini.setAttribute('aria-hidden', 'true');
    mini.innerHTML = src.querySelector('.ycard').innerHTML.replace(/<(\/?)(?:h3|p|div)\b/g, '<$1span');
    mini.querySelectorAll('img').forEach(img => { img.loading = 'lazy'; img.alt = ''; });
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'deck-pick';
    b.setAttribute('aria-label', t.dataset.card);
    b.append(mini);
    b.addEventListener('click', () => {
      show(i);
      if (innerWidth <= 900) preview.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    });
    grid.append(b);
  });
  show(0);
})();

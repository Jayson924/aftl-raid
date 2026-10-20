// Floating tooltip for elements inside overflow:auto/hidden scroll containers,
// where the CSS-only [data-tooltip] (::before pseudo) would be clipped.
// Opt in by adding `data-tooltip-fixed="..."` to the element.

let initialized = false;

export function initFixedTooltip() {
  if (initialized) return;
  initialized = true;

  const tip = document.createElement('div');
  tip.className = 'tooltip-fixed';
  document.body.appendChild(tip);

  const show = (el) => {
    const text = el.getAttribute('data-tooltip-fixed');
    if (!text) return;
    // Optional bold first line from data-tooltip-head.
    const head = el.getAttribute('data-tooltip-head');
    tip.textContent = '';
    // Optional rarity (simulator items) colors the head and uses the larger item style.
    const rarity = el.getAttribute('data-tooltip-rarity');
    if (rarity) tip.dataset.rarity = rarity; else delete tip.dataset.rarity;
    if (head) {
      const strong = document.createElement('strong');
      strong.className = 'tooltip-fixed-head';
      strong.textContent = head;
      tip.append(strong, '\n');
    }
    tip.append(text);
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.top - t.height - 8;
    if (top < 8) top = r.bottom + 8;
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  };
  const hide = () => { tip.style.display = 'none'; };

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-tooltip-fixed]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.('[data-tooltip-fixed]');
    if (el) hide();
  });
  window.addEventListener('scroll', hide, true);
  // A tap on a touch screen fires mouseover too; any click dismisses it.
  document.addEventListener('click', hide, true);
}

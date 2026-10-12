// Monster cards drawn like the simulator's Card tab: the card icon in its rarity frame, the name in its rarity color.
import icons from './data/sim-icons.json' with { type: 'json' };

const ICON_SPRITE = '/sim/item-icons.webp';
const ICON_PX = 44;
// Site rarities to the client's card frames (C/B/A/S/L).
const FRAME = { magic: 'card-c', rare: 'card-b', epic: 'card-a', unique: 'card-s', legend: 'card-l' };
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function cardIconHtml(name) {
  const cell = icons.items.Card?.[name];
  if (cell === undefined) return `<span class="sim-slot-empty">${esc(name)}</span>`;
  const { cols } = icons;
  return `<i class="sim-icon" style="background-image:url(${ICON_SPRITE});background-size:${cols * ICON_PX}px auto;background-position:-${(cell % cols) * ICON_PX}px -${Math.floor(cell / cols) * ICON_PX}px"></i>`;
}

// The inside of a card cell; the caller supplies the element and its data attributes.
export function cardCellInner(name, rarity) {
  return `<span class="sim-slot ${FRAME[rarity] || 'card-none'}">${cardIconHtml(name)}</span><span class="sim-card-name ${rarity || ''}">${esc(name)}</span>`;
}

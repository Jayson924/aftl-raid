// The game's monster card list, stats and totals, shared by My Characters and the Characters page.
// Card slot N on the site is the game's card N, so hand-kept slots and synced grades line up.
import cardTable from '../netlify/data/sim/cards.json' with { type: 'json' };
import { cardCellInner } from './card-cells.js';

export const GAME_CARDS = cardTable.names;
export const CARD_TIERS = [...new Set(Object.values(cardTable.levels))].sort((a, b) => a - b);
export const CARDS_PER_PAGE = 16;
export const GRADE_RARITY = { C: 'magic', B: 'rare', A: 'epic', S: 'unique', L: 'legend' };
const RARITY_GRADE = { magic: 'C', rare: 'B', epic: 'A', unique: 'S', legend: 'L' };
const RARITY_LABEL = { magic: 'Magic', rare: 'Rare', epic: 'Epic', unique: 'Unique', legend: 'Legend' };
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString('en-US') : Number(v.toFixed(2)).toLocaleString('en-US'));

const STAT_ORDER = ['PATK', 'MATK', 'STR', 'AGI', 'INT', 'VIT', 'Final damage', 'Crit damage', 'Crit', 'HP', 'MP', 'DEF', 'MDEF', 'Crit resist', 'Stun', 'Stun resist', 'Paralyze', 'Paralyze resist', 'MP regen'];
const STAT_LABEL = { PATK: 'Physical Attack', MATK: 'Magic Attack', 'Final damage': 'Final Damage', 'Crit damage': 'Crit Damage' };
const statsOf = (name) => new Set(Object.values(cardTable.lookup[name] || {}).flatMap((grade) => Object.keys(grade)));
export const CARD_STATS = [...new Set(GAME_CARDS.flatMap((name) => [...statsOf(name)]))]
  .sort((a, b) => (STAT_ORDER.indexOf(a) + 1 || 99) - (STAT_ORDER.indexOf(b) + 1 || 99));

export function cardMatches(name, tier, stat) {
  return (tier == null || cardTable.levels[name] === tier) && (!stat || statsOf(name).has(stat));
}

// Cards in game order with their slot index, limited to one level tier and one stat (null = all).
export function cardsForTier(tier, stat = null) {
  return GAME_CARDS.map((name, index) => ({ name, index })).filter(({ name }) => cardMatches(name, tier, stat));
}

// Level and stat dropdowns; the selects carry data-card-tier / data-card-stat plus the caller's attrs.
export function cardFilterHtml(tier, stat, attrs = '') {
  const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  const tiers = [['all', 'All'], ...CARD_TIERS.map((t) => [String(t), `Lv${t}`])];
  const stats = [['', 'All'], ...CARD_STATS.map((s) => [s, STAT_LABEL[s] || s])];
  const field = (label, isSet, data, list, current) => `<label class="sim-card-filter${isSet ? ' is-set' : ''}"><span>${label}</span>
    <select class="sim-card-filter-select" ${data} ${attrs}>${list.map(([v, l]) => option(v, l, current)).join('')}</select></label>`;
  return `<div class="sim-card-filters">
    ${field('Level', tier != null, 'data-card-tier', tiers, String(tier ?? 'all'))}
    ${field('Stat', !!stat, 'data-card-stat', stats, stat || '')}
  </div>`;
}

// rarity by card name: from a synced build's grades, else from hand-kept slot rows.
export function raritiesFromGrades(cardGrades) {
  return new Map((cardGrades || []).map((c) => [c?.name, GRADE_RARITY[c?.grade] || '']).filter(([, r]) => r));
}
export function raritiesFromSlots(byIndex) {
  return new Map(Object.entries(byIndex || {}).map(([i, r]) => [GAME_CARDS[Number(i)], r]).filter(([n, r]) => n && r));
}

export function cardStats(name, rarity) {
  return cardTable.lookup[name]?.[RARITY_GRADE[rarity]] || {};
}

export function cardTooltip(name, rarity) {
  const stats = Object.entries(cardStats(name, rarity)).map(([k, v]) => `${k} +${fmt(v)}`).join(' · ');
  return rarity ? `${name} · ${RARITY_LABEL[rarity]}${stats ? `\n${stats}` : ''}` : name;
}

// One cell; the caller picks the element, extra classes and data attributes.
export function cardCellHtml({ tag = 'span', name, index, rarity, className = '', attrs = '' }) {
  return `<${tag}${tag === 'button' ? ' type="button"' : ''} class="sim-card-cell ${className} ${rarity ? 'has-card' : 'no-card'}" data-card-name="${esc(name)}" data-slot-index="${index}" data-rarity="${rarity || ''}" data-tooltip-fixed="${esc(cardTooltip(name, rarity))}" ${attrs}>${cardCellInner(name, rarity)}</${tag}>`;
}

// Card stats as the simulator adds them: each stat grows 5% per mastery level (none for crit damage).
export function cardTotals(rarityByName, mastery = {}) {
  const raw = {};
  for (const [name, rarity] of rarityByName) for (const [attr, v] of Object.entries(cardStats(name, rarity))) raw[attr] = (raw[attr] || 0) + Number(v);
  const target = (attr) => attr.replace(/ (min|max)$/, '');
  return Object.entries(raw).map(([attr, v]) => {
    const level = target(attr) === 'Crit damage' ? 0 : Number(mastery?.[target(attr)] ?? mastery?.[attr]) || 0;
    // Flat stats drop their fraction after the mastery bonus, as the game and simulator do.
    const total = v * (1 + level * 0.05);
    return [attr, attr.endsWith('%') ? total : Math.trunc(total + 1e-9)];
  });
}

export function cardTotalsHtml(rarityByName, mastery) {
  const entries = cardTotals(rarityByName, mastery);
  const half = Math.max(1, Math.ceil(entries.length / 2));
  const lines = entries.map(([attr, v]) => `<div><span>${esc(attr)}</span><strong>${fmt(Math.round(v * 100) / 100)}${attr.endsWith('%') ? '%' : ''}</strong></div>`).join('');
  return `<div class="sim-board-totals"><h4>Card Stats</h4><div class="sim-totals-grid" style="grid-template-rows:repeat(${half},auto)">${lines || '<div><span>—</span></div>'}</div></div>`;
}

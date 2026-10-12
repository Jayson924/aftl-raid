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

// Cards in game order with their slot index, limited to one level tier (null = all).
export function cardsForTier(tier) {
  return GAME_CARDS.map((name, index) => ({ name, index })).filter(({ name }) => tier == null || cardTable.levels[name] === tier);
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

export function tierTabsHtml(tier, attrs = '') {
  const tabs = [['all', 'All'], ...CARD_TIERS.map((t) => [String(t), `Lv${t}`])];
  return `<div class="sim-card-tabs">${tabs.map(([v, label]) => `<button type="button" class="${String(tier ?? 'all') === v ? 'active' : ''}" data-card-tier="${v}" ${attrs}>${label}</button>`).join('')}</div>`;
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

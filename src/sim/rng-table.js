// The simulator's RNG Table section: every roll the game can give engravings, gear potentials and runes.
import rng from '../data/sim-rng.json' with { type: 'json' };
import runes from '../../netlify/data/sim/runes.json' with { type: 'json' };
import { ENGRAVING_RARITY } from './engravings.js';

export const RNG_TABS = [['engravings', 'Engravings'], ['potentials', 'Potentials'], ['runes', 'Runes']];
export const RUNE_LEVELS = ['70', '60', '50'];
export const POTENTIAL_RARITIES = ['legend', 'unique', 'epic'];

const GRADES = ['B', 'A', 'S', 'L'];
const RUNE_LINES = [['Rare', 3], ['Epic', 4], ['Unique', 5], ['Legend', 6]];
const RANK_RARITY = ['normal', 'magic', 'rare', 'epic', 'unique', 'legend'];
const ENGRAVING_STAT = { Weapon: ['PATK/MATK', ''], Armor: ['DEF/MDEF', ''], Accessory: ['HP', 'PATK/MATK'], 'Wings, tail, decal': ['Crit', 'PATK/MATK'] };

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statLabel = (attr) => String(attr).replace(/^Water\b/, 'Ice');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const rarityText = (name, text = name) => `<span class="sim-rarity-text ${name.toLowerCase()}">${esc(text)}</span>`;
const pct = (n, digits = 4) => `${Number(Number(n).toFixed(digits))}%`;
const fixed = (n) => `${Number(n).toFixed(2)}%`;
// Potential lines: attack (what most players look for), stats, HP/MP, the rest, elements, then Crit and MP regen last.
const LINE_ORDER = [/^PATK /, /^MATK /, /^(STR|AGI|INT|VIT) /, /^(HP|MP) [\d%]/, null,
  /^(Fire|Water|Ice|Light|Dark) attack/, /^(Fire|Water|Ice|Light|Dark) resist/, /^Crit [\d%]/, /^MP regen/];
export function lineRank(stat) {
  const rank = LINE_ORDER.findIndex((re) => re && re.test(stat));
  return rank < 0 ? LINE_ORDER.indexOf(null) : rank;
}
const attackFirst = lineRank;
const table = (head, rows, cls = '') => `<div class="sim-table-scroll"><table class="sim-table rng-table ${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
// Five shades from the lowest roll to the highest.
const tier = (index, count) => (count < 2 ? 'roll-only' : `roll-${Math.round((index / (count - 1)) * 4)}`);
const chip = (text, index, count, sub = '') => `<span class="rng-roll ${tier(index, count)}" data-tooltip-fixed="Roll ${index + 1} of ${count}">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;

function engravingsView() {
  const e = rng.engraving;
  const odds = GRADES.map((g) => `<tr><td>${rarityText(ENGRAVING_RARITY[g])}</td><td>${pct(e.grade_pct[g])}</td></tr>`);
  const slots = e.scrolls.map((s) => `<tr><td>${esc(s.scroll)} scroll</td><td>${s.slots.map((x) => `${esc(x.slot)} ${pct(x.pct, 2)}`).join(' · ')}</td></tr>`);

  const mainBlocks = Object.entries(e.main).map(([kind, byGrade]) => {
    const [stat, second] = ENGRAVING_STAT[kind] || [kind, ''];
    const rows = GRADES.filter((g) => byGrade[g]).map((g) => {
      const list = byGrade[g];
      const chips = list.map((v, i) => chip(fixed(v.value), i, list.length, v.secondary ? fixed(v.secondary) : '')).join('');
      return `<tr><td>${rarityText(ENGRAVING_RARITY[g])}<small>each roll ${pct(e.grade_pct[g] / list.length, 3)}</small></td><td><div class="rng-rolls">${chips}</div></td></tr>`;
    });
    return `<section><h3>${esc(kind)} <span>${esc(stat)} %${second ? `, with ${esc(second)} % under each roll` : ''}</span></h3>${table(['Rarity', 'Every roll, lowest to highest'], rows)}</section>`;
  }).join('');

  const extraRows = e.extras.map((x) => `<tr><td>${esc(statLabel(x.stat))}</td>${GRADES.map((g) =>
    `<td><div class="rng-rolls">${chip(fixed(x.values[g][0]), 0, 2)}${chip(fixed(x.values[g][1]), 1, 2)}</div></td>`).join('')}</tr>`);

  return `<div class="rng-grid rng-grid-odds">
      <section><h2>Rarity odds</h2>${table(['Rarity', 'Chance'], odds, 'sim-numbers')}</section>
      <section><h2>Which piece the scroll gives</h2>${table(['Scroll', 'Piece'], slots)}</section>
    </div>
    <h2>Main stat</h2>
    <p class="rng-note">Every roll within a rarity is equally likely. Shading runs from the lowest roll (red) to the highest (green); hover a roll for its rank.</p>
    <div class="rng-grid">${mainBlocks}</div>
    <h2>Extra stat</h2>
    <p class="rng-note">Each extra rolls low or high. With Dragon Scripture an extra is guaranteed; without it, the chance and which extra you get are decided by the server and aren't in the game files.</p>
    ${table(['Extra', ...GRADES.map((g) => rarityText(ENGRAVING_RARITY[g]))], extraRows)}`;
}

// The pools for one rarity, labelled by the items that use them.
function potentialPools(rarity) {
  return rng.potentials.filter((p) => p.rarity.includes(rarity)).map((p) => {
    const jewelry = p.items.filter((i) => ['Ring', 'Necklace', 'Earrings'].includes(i));
    let label = p.items.join(', ');
    if (p.kind === 'Weapon' && p.items.length > 10) label = `All weapons${jewelry.length ? ' and rings' : ''}`;
    else if (p.kind === 'Armor') label = `Armor${jewelry.length ? `, ${jewelry.join(', ').toLowerCase()}` : ''}`;
    return { ...p, label: p.kind === 'Weapon' && p.items.length <= 10 ? `Weapon: ${label}` : label };
  });
}

function potentialsView(rarity, poolIndex) {
  const pools = potentialPools(rarity);
  const pool = pools[poolIndex] || pools[0];
  const values = new Map();
  for (const roll of pool.rolls) {
    for (const [stat, value] of roll.lines) {
      if (!values.has(stat)) values.set(stat, new Set());
      values.get(stat).add(value);
    }
  }
  const ladder = new Map([...values].map(([stat, set]) => [stat, [...set].sort((a, b) => a - b)]));
  const line = (stat, value) => {
    const list = ladder.get(stat);
    const i = list.indexOf(value);
    return `<li class="${tier(i, list.length)}" data-tooltip-fixed="Roll ${i + 1} of ${list.length}"><span>${esc(statLabel(stat).replace(/ %$/, ''))}</span><b>${pct(value)}</b></li>`;
  };
  const cards = pool.rolls.map((r) => `<article class="rng-set"><header><strong>${pct(r.pct, 3)}</strong><span>chance</span></header><ul>${[...r.lines]
    .sort(([a], [b]) => attackFirst(a) - attackFirst(b)).map(([s, v]) => line(s, v)).join('')}</ul></article>`).join('');

  const rarityButtons = POTENTIAL_RARITIES.map((r) => `<button class="btn ${r === rarity ? 'btn-primary' : 'btn-secondary'}" data-action="rng-pot-rarity" data-value="${r}">${cap(r)}</button>`).join('');
  const poolSelect = `<select data-rng-pool aria-label="Item">${pools.map((p, i) => `<option value="${i}" ${p === pool ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`;
  return `<div class="rng-bar"><div class="sim-build-switch">${rarityButtons}</div>${poolSelect}</div>
    <p class="rng-note">A potential is one fixed set of lines, picked by its chance; lines are never rolled on their own. The same sets apply to Lv50, 60 and 70 gear.</p>
    <h2>Every set (${pool.rolls.length}), most likely first</h2>
    <div class="rng-sets">${cards}</div>`;
}

function runesView(level) {
  const ranks = [1, 2, 3, 4, 5];
  const head = ['Line', ...ranks.map((r) => `<span class="sim-rarity-text ${RANK_RARITY[r]}">Rank ${r}</span>`)];
  const rows = (type) => Object.entries(runes.normal[level]?.[type] || {}).map(([stat, values]) => {
    const have = ranks.filter((r) => values[r] !== undefined);
    return `<tr><td>${esc(statLabel(stat))}</td>${ranks.map((r) => `<td>${values[r] !== undefined ? chip(Number(values[r]).toLocaleString(), have.indexOf(r), have.length) : '—'}</td>`).join('')}</tr>`;
  });
  const lines = RUNE_LINES.map(([name, n]) => `${rarityText(name)} ${n}`).join(' · ');
  return `<div class="rng-bar">
      <div class="sim-build-switch">${RUNE_LEVELS.map((lv) => `<button class="btn ${lv === level ? 'btn-primary' : 'btn-secondary'}" data-action="rng-rune-level" data-value="${lv}">Lv${lv}</button>`).join('')}</div>
      <p class="rng-note">Lines per rune: ${lines}. A rune holds any stat on at most two lines. Rune rolls are decided by the server, so these values come from the CN tables, not the game files.</p>
    </div>
    <div class="rng-grid">
      <section><h2>Attack rune</h2>${table(head, rows('Attack'), 'sim-numbers')}</section>
      <section><h2>Defense rune</h2>${table(head, rows('Defense'), 'sim-numbers')}</section>
    </div>`;
}

export function rngTable(state) {
  const tabs = RNG_TABS.map(([key, label]) => `<button class="${key === state.tab ? 'active' : ''}" data-action="rng-tab" data-value="${key}">${label}</button>`).join('');
  const body = state.tab === 'potentials' ? potentialsView(state.potRarity, state.potPool)
    : state.tab === 'runes' ? runesView(state.runeLevel) : engravingsView();
  return `<nav class="sim-tabs rng-tabs">${tabs}</nav><div class="rng-body">${body}</div>`;
}

// The simulator's RNG Table section: every roll the game can give engravings, gear potentials and runes.
import rng from '../data/sim-rng.json' with { type: 'json' };
import runes from '../../netlify/data/sim/runes.json' with { type: 'json' };
import { ENGRAVING_RARITY } from './engravings.js';
import options from '../data/sim/options.json' with { type: 'json' };
import icons from '../data/sim-icons.json' with { type: 'json' };

export const RNG_TABS = [['engravings', 'Engravings'], ['potentials', 'Potentials'], ['fellowship', 'Fellowship Heraldry'], ['runes', 'Runes']];
export const FELLOWSHIP_LEVELS = ['70', '60'];
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
// Item icons for the pool tiles, drawn like the simulator's slots.
const ICON_SPRITE = '/sim/item-icons.webp';
const ICON_PX = 44;
function spriteIcon(cell) {
  const { cols } = icons;
  return `<i class="sim-icon" style="background-image:url(${ICON_SPRITE});background-size:${cols * ICON_PX}px auto;background-position:-${(cell % cols) * ICON_PX}px -${Math.floor(cell / cols) * ICON_PX}px"></i>`;
}
const endsWith = (name, noun) => name.toLowerCase().endsWith(` ${noun.toLowerCase()}`);
// The icon of a Lv70 item of this rarity ending in noun (Black Dragon for legend and unique).
function gearCell(rarity, noun) {
  for (const [job, items] of Object.entries(options.gear)) {
    for (const [name, entry] of Object.entries(items)) {
      if (entry.level === `Lv70 ${cap(rarity)}` && endsWith(name, noun) && icons.items[job]?.[name] !== undefined) return icons.items[job][name];
    }
  }
  return undefined;
}
function jewelCell(rarity, slot) {
  const name = Object.keys(options.accessories[slot] || {}).find((n) => options.accessories[slot][n].level === `Lv70 ${cap(rarity)}` && icons.items.Jewelry?.[n] !== undefined);
  return name ? icons.items.Jewelry[name] : undefined;
}
const JEWEL_SLOT = { Ring: 'Ring', Necklace: 'Necklace', Earrings: 'Earring' };
// One or two example icons for a pool: a gear piece and, when the pool covers jewelry, a jewel.
function poolCells(pool, rarity) {
  const jewels = pool.items.filter((i) => JEWEL_SLOT[i]);
  const gear = pool.items.filter((i) => !JEWEL_SLOT[i]);
  // A pool for every weapon shows a sword; a single weapon type shows its own.
  const preferred = pool.kind === 'Weapon' ? (gear.length > 10 ? ['Sword', ...gear] : gear) : ['Helmet', 'Headband', ...gear];
  const gearIcon = gear.length ? preferred.map((n) => gearCell(rarity, n)).find((c) => c !== undefined) : undefined;
  const jewelIcons = jewels.map((j) => jewelCell(rarity, JEWEL_SLOT[j])).filter((c) => c !== undefined);
  return [gearIcon, ...jewelIcons].filter((c) => c !== undefined).slice(0, 2);
}

function potentialPools(rarity) {
  return rng.potentials.filter((p) => p.rarity.includes(rarity)).map((p) => {
    const jewelry = p.items.filter((i) => ['Ring', 'Necklace', 'Earrings'].includes(i));
    let label = p.items.join(', ');
    if (p.kind === 'Weapon' && p.items.length > 10) label = `Weapons${jewelry.length ? ' & rings' : ''}`;
    else if (p.kind === 'Armor') label = jewelry.length ? 'Armor, necklace & earrings' : 'Armor';
    else if (jewelry.includes('Necklace')) label = 'Necklace & earrings';
    return { ...p, label };
  });
}

// Sets sorted by chance, most likely first unless the sort says otherwise.
const sortByChance = (list, order) => [...list].sort((a, b) => (order === 'asc' ? a.pct - b.pct : b.pct - a.pct));
const possibilityHead = (order) => `<div class="rng-head"><h2>Every possibility</h2><button class="btn btn-secondary rng-sort" data-action="rng-sort" data-value="${order === 'asc' ? 'desc' : 'asc'}" title="${order === 'asc' ? 'Least likely first' : 'Most likely first'}" aria-label="Sort by chance">${order === 'asc' ? '↑' : '↓'}</button></div>`;

function potentialsView(rarity, poolIndex, order) {
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
  const cards = sortByChance(pool.rolls, order).map((r) => `<article class="rng-set"><header><strong>${pct(r.pct, 3)}</strong><span>chance</span></header><ul>${[...r.lines]
    .sort(([a], [b]) => attackFirst(a) - attackFirst(b)).map(([s, v]) => line(s, v)).join('')}</ul></article>`).join('');

  const at = pools[poolIndex] ? poolIndex : 0;
  const tile = (action, value, active, cells, r, label, title = label) => `<button class="rng-pool ${active ? 'active' : ''}" data-action="${action}" data-value="${value}" title="${esc(title)}"><span class="rng-pool-icons${cells.length > 1 ? ' rng-pool-pair' : ''}">${cells
    .map((c) => `<span class="sim-slot ${r}">${spriteIcon(c)}</span>`).join('')}</span><small>${esc(label)}</small></button>`;
  // Rarity tiles show that rarity's every-weapon or sword pool; item tiles group the per-type weapon pools into one.
  const rarityTiles = POTENTIAL_RARITIES.map((r) => {
    const first = potentialPools(r).find((p) => p.kind === 'Weapon');
    return tile('rng-pot-pool', `${r}|0`, r === rarity, first ? poolCells(first, r).slice(0, 1) : [], r, cap(r));
  }).join('');
  const weaponIdx = pools.map((p, i) => (p.kind === 'Weapon' ? i : -1)).filter((i) => i >= 0);
  const others = pools.map((p, i) => [p, i]).filter(([p]) => p.kind !== 'Weapon');
  const onWeapon = pools[at].kind === 'Weapon';
  const weaponPool = pools[onWeapon ? at : weaponIdx[0]];
  const icon = (c, r) => `<span class="sim-slot ${r}">${spriteIcon(c)}</span>`;
  // With one pool per weapon type, the Weapons tile opens a menu of the types; otherwise it selects its one pool.
  const weaponTile = weaponIdx.length > 1
    ? `<div class="sim-picker rng-weapon-picker"><button class="rng-pool ${onWeapon ? 'active' : ''}" data-action="picker-toggle" aria-haspopup="listbox" title="${esc(weaponPool.items.join(', '))}"><span class="rng-pool-icons">${poolCells(weaponPool, rarity).slice(0, 1).map((c) => icon(c, rarity)).join('')}</span><small>${esc(onWeapon ? weaponPool.items.join(', ') : 'Weapons')} ▾</small></button>
      <ul class="sim-picker-list" role="listbox">${weaponIdx.map((i) => `<li><button type="button" class="${onWeapon && i === at ? 'selected' : ''}" data-action="rng-pot-pool" data-value="${rarity}|${i}" role="option">${poolCells(pools[i], rarity).slice(0, 1).map((c) => icon(c, rarity)).join('')}<span>${esc(pools[i].items.join(', '))}</span></button></li>`).join('')}</ul></div>`
    : weaponIdx.length ? tile('rng-pot-pool', `${rarity}|${weaponIdx[0]}`, onWeapon, poolCells(weaponPool, rarity).slice(0, 2), rarity, weaponPool.label, weaponPool.items.join(', ')) : '';
  const itemTiles = [weaponTile, ...others.map(([p, i]) => tile('rng-pot-pool', `${rarity}|${i}`, i === at, poolCells(p, rarity), rarity, p.label, p.items.join(', ')))].join('');
  const rows = `<div class="rng-pool-bar"><div class="rng-pools">${rarityTiles}</div><span class="rng-pool-sep"></span><div class="rng-pools">${itemTiles}</div></div>`;
  return `<div class="rng-pool-picker">${rows}</div>
    <p class="rng-note">A potential is one fixed set of lines, picked by its chance; lines are never rolled on their own. The same sets apply to Lv50, 60 and 70 gear.</p>
    ${possibilityHead(order)}
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
  return `<div class="rng-pool-bar">
      <div class="rng-level-col">${RUNE_LEVELS.map((lv) => `<button class="btn ${lv === level ? 'btn-primary' : 'btn-secondary'}" data-action="rng-rune-level" data-value="${lv}">Lv${lv}</button>`).join('')}</div>
      <span class="rng-pool-sep"></span>
      <p class="rng-note rng-bar-note">Lines per rune: ${lines}. A rune holds any stat on at most two lines. Rune rolls are decided by the server, so these values come from the CN tables, not the game files.</p>
    </div>
    <div class="rng-grid">
      <section><h2>Attack rune</h2>${table(head, rows('Attack'), 'sim-numbers')}</section>
      <section><h2>Defense rune</h2>${table(head, rows('Defense'), 'sim-numbers')}</section>
    </div>`;
}

// Fellowship plates of one level, in plate order then each plate's own stat order.
function fellowshipPlates(level) {
  const list = rng.fellowship.filter((f) => f.level === `Lv${level}`);
  const order = (f) => f.sets[0].lines.findIndex(([s]) => s === f.focus);
  return list.sort((a, b) => a.plate.localeCompare(b.plate) || order(a) - order(b));
}

function fellowshipView(level, plateIndex, order) {
  const plates = fellowshipPlates(level);
  const plate = plates[plateIndex] || plates[0];
  const values = new Map();
  for (const set of plate.sets) for (const [stat, value] of set.lines) {
    if (!values.has(stat)) values.set(stat, new Set());
    values.get(stat).add(value);
  }
  const ladder = new Map([...values].map(([stat, set]) => [stat, [...set].sort((a, b) => a - b)]));
  const line = (stat, value, bonus) => {
    const list = ladder.get(stat);
    const i = list.indexOf(value);
    return `<li class="${tier(i, list.length)}${bonus ? ' rng-bonus' : ''}" data-tooltip-fixed="Roll ${i + 1} of ${list.length}"><span>${esc(stat)}${bonus ? '<em>bonus</em>' : ''}</span><b>${Number(value).toLocaleString()}</b></li>`;
  };
  const cards = sortByChance(plate.sets, order).map((set) => `<article class="rng-set"><header><strong>${pct(set.pct, 3)}</strong><span>tier ${set.tier}</span></header><ul>${set.lines
    .map(([s, v]) => line(s, v, s === set.bonus)).join('')}</ul></article>`).join('');
  const tierPct = [1, 2, 3].map((t) => pct(plate.sets.filter((x) => x.tier === t).reduce((a, x) => a + x.pct, 0), 2));
  const levelButtons = FELLOWSHIP_LEVELS.map((lv) => `<button class="btn ${lv === level ? 'btn-primary' : 'btn-secondary'}" data-action="rng-fellow-level" data-value="${lv}">Lv${lv}</button>`).join('');
  // One tile per plate with its icon; it opens a menu of the plate's focus stats.
  const at = plates[plateIndex] ? plateIndex : 0;
  const names = [...new Set(plates.map((p) => p.plate))];
  const plateTiles = names.map((name) => {
    const options = plates.map((p, i) => [p, i]).filter(([p]) => p.plate === name);
    const current = options.find(([, i]) => i === at);
    const cell = icons.items.Heraldry?.[`${name}|Lv${level}`];
    const iconHtml = cell === undefined ? '' : `<span class="sim-slot unique">${spriteIcon(cell)}</span>`;
    const short = name.replace(' Fellowship Heraldry', '');
    return `<div class="sim-picker rng-weapon-picker"><button class="rng-pool ${current ? 'active' : ''}" data-action="picker-toggle" aria-haspopup="listbox" title="${esc(name)}"><span class="rng-pool-icons">${iconHtml}</span><small>${esc(short)}${current ? ` · ${esc(current[0].focus)}` : ''} ▾</small></button>
      <ul class="sim-picker-list" role="listbox">${options.map(([p, i]) => `<li><button type="button" class="${i === at ? 'selected' : ''}" data-action="rng-fellow-pick" data-value="${i}" role="option">${iconHtml}<span>${esc(p.focus)} focus</span></button></li>`).join('')}</ul></div>`;
  }).join('');
  return `<div class="rng-pool-bar"><div class="rng-level-col">${levelButtons}</div><span class="rng-pool-sep"></span><div class="rng-pools">${plateTiles}</div></div>
    <p class="rng-note">A plate rolls one whole set: every stat at the same tier (tier 1 ${tierPct[0]}, tier 2 ${tierPct[1]}, tier 3 ${tierPct[2]}). 15% of rolls add a bonus: an extra stat line, or a higher value on one of the plate's own stats. Which stat is the focus is your choice when crafting.</p>
    ${possibilityHead(order)}
    <div class="rng-sets">${cards}</div>`;
}

export function rngTable(state) {
  const tabs = RNG_TABS.map(([key, label]) => `<button class="${key === state.tab ? 'active' : ''}" data-action="rng-tab" data-value="${key}">${label}</button>`).join('');
  const body = state.tab === 'potentials' ? potentialsView(state.potRarity, state.potPool, state.sort)
    : state.tab === 'fellowship' ? fellowshipView(state.fellowLevel, state.fellowPlate, state.sort)
      : state.tab === 'runes' ? runesView(state.runeLevel) : engravingsView();
  return `<nav class="sim-tabs rng-tabs">${tabs}</nav><div class="rng-body">${body}</div>`;
}

// Character simulator: the meter's Build page on the site; builds A and B live in localStorage.
import options from '../data/sim/options.json' with { type: 'json' };
import { createRemoteCalculator, NONE } from '../sim/remote.js';
import { optionNumber, emptyEngravings, engravingKind, engravingMainOptions, engravingSecondaryOptions, setEngravingRank, ENGRAVING_RARITY } from '../sim/engravings.js';
import { initFixedTooltip } from '../fixed-tooltip.js';
import { rngTable, lineRank } from '../sim/rng-table.js';
import rngData from '../data/sim-rng.json' with { type: 'json' };
import { getClassSpriteStyle } from '../constants.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { dataService } from '../data.js';
import { GUILD_ONLY_TAG } from '../guild-lock.js';
import icons from '../data/sim-icons.json' with { type: 'json' };
import costumeList from '../data/sim-costumes.json' with { type: 'json' };
import { uploadHtml, setupUpload, renderGearReview } from '../sim/screenshot-import.js';

const STORAGE_KEY = 'aftl.simulator.builds';
const PARTY_KEY = 'aftl.simulator.party';
const L = options.lists;
// Answers come from the simulate function; the page re-renders when one arrives.
const calc = createRemoteCalculator({ jobMap: options.job_map, onResult: (error) => { SimulatorPage.onResult(error); openBuilder?.onResult(error); } });
// The Add/Edit Character builder while its modal is open.
let openBuilder = null;

// Tabs under the character window, for everything that is not a game window.
const TABS = [['sets', 'Gear Sets'], ['other', 'Other'], ['stats', 'Full Stats'], ['skills', 'Skills'], ['compare', 'Compare']];
// The game's character window tabs, in its order.
const VIEWS = [['general', 'General'], ['costume', 'Costume'], ['heraldry', 'Heraldry'], ['card', 'Card'], ['rune', 'Rune']];
const COSTUME_MODES = [['fashion', 'Costume'], ['engraving', 'Engraving']];
const COSTUME_COLUMN = ['Helmet', 'Upper', 'Lower', 'Gloves', 'Shoes', 'Main weapon', 'Secondary weapon'];
const COSTUME_SIDE = ['Wings', 'Tail', 'Decal'];
const COSTUME_BOTTOM = ['Necklace', 'Earring', 'Ring 1', 'Ring 2'];
const RANK_RARITY = ['normal', 'magic', 'rare', 'epic', 'unique', 'legend'];
const CARDS_PER_PAGE = 16;
// The Power of Mastery in the game's order, from the client's cardskilltable: [name, mastery key].
const MASTERY_KEYS = { 32: 'PATK', 33: 'MATK', 0: 'STR', 1: 'AGI', 2: 'INT', 3: 'VIT', 12: 'Crit', 29: 'Final damage', 8: 'DEF', 9: 'MDEF', 25: 'HP', 26: 'MP' };
const MASTERY = icons.mastery.filter(([, id]) => MASTERY_KEYS[id]).map(([name, id]) => [name, MASTERY_KEYS[id]]);
const cardFrame = (grade) => (hasValue(grade) ? `card-${String(grade).toLowerCase()}` : 'card-none');
// Card grades C/B/A/S/L are the client's card ranks 1-5; builds keep the letters.
const CARD_RARITY = { C: 'Magic', B: 'Rare', A: 'Epic', S: 'Unique', L: 'Legend' };
// Rune rarity sets its line count (Rare 3 .. Legend 6); builds without one go by their lines.
const RUNE_RARITIES = ['Rare', 'Epic', 'Unique', 'Legend'];
const runeLines = (rune) => (rune.entries || []).filter((e) => e.attr && e.attr !== 'None').length;
const runeRank = (rune) => {
  const picked = RUNE_RARITIES.indexOf(rune.rarity);
  if (picked >= 0) return picked + 2;
  const lines = runeLines(rune);
  return lines ? Math.min(5, Math.max(2, lines - 1)) : 0;
};
const runeLineCount = (rune) => (runeRank(rune) ? runeRank(rune) + 1 : 6);
// A synced rune may have a filled line past its count; never hide a line that adds stats.
const lastFilled = (entries) => entries.reduce((n, e, i) => (e.attr && e.attr !== 'None' ? i + 1 : n), 0);
const cardRarity = (grade) => ({ rarity: CARD_RARITY[grade]?.toLowerCase() || 'normal', level: 0, label: CARD_RARITY[grade] || grade });
const EQUIPMENT_SLOTS = ['Helmet', 'Upper', 'Lower', 'Gloves', 'Shoes', 'Main weapon', 'Secondary weapon'];
const JEWELRY_SLOTS = ['Necklace', 'Earring', 'Ring 1', 'Ring 2'];
const ENGRAVING_SLOTS = L.engraving.slots;
const ATTACK_ENCHANT_SLOTS = new Set(['Main weapon', 'Secondary weapon', 'Ring 1', 'Ring 2']);
const RESULT_COLUMNS = [
  ['base', 'Base'], ['equipment', 'Gear'], ['card', 'Cards'], ['glyph', 'Heraldry'],
  ['normal_rune', 'Runes'], ['core_mastery', 'Core / Mastery'], ['actual', 'Stats'], ['converted', 'Converted'],
  ['buffed', 'Buffed'],
];
const SUMMARY_METRICS = [
  ['effective_panel', 'Power level'], ['physical_average', 'Phys atk'], ['magic_average', 'Mag atk'],
  ['final_percent', 'Final dmg %'], ['crit_percent', 'Crit %'], ['crit_damage_percent', 'Crit dmg %'],
];
// Hover text for summary labels: [heading, lines].
const MP_REGEN_TIP = 'Will not match the game; part of MP recovery is not modeled yet';
// Full Stats groups, like the game window; each stat is followed by its % rows.
const STAT_GROUPS = [
  { title: 'Basic', attrs: ['HP', 'HP %', 'MP', 'MP %', 'MP regen', 'MP regen %', 'Move speed %'] },
  { title: 'Stats', attrs: ['STR', 'STR %', 'AGI', 'AGI %', 'INT', 'INT %', 'VIT', 'VIT %'] },
  { title: 'Attack', attrs: ['PATK min', 'PATK max', 'PATK %', 'PATK min %', 'PATK max %', 'MATK min', 'MATK max', 'MATK %', 'MATK min %', 'MATK max %',
    'Final damage', 'Final damage %', 'Crit', 'Crit %', 'Crit damage', 'Crit damage %', 'Paralyze', 'Paralyze %', 'Stun', 'Stun %'] },
  { title: 'Defense', attrs: ['DEF', 'DEF %', 'DEF rate %', 'MDEF', 'MDEF %', 'MDEF rate %', 'Crit resist', 'Crit resist %',
    'Paralyze resist', 'Paralyze resist %', 'Stun resist', 'Stun resist %'] },
  { title: 'Element', attrs: ['Fire attack %', 'Water attack %', 'Light attack %', 'Dark attack %', 'Fire resist %', 'Water resist %', 'Light resist %', 'Dark resist %'] },
];
// Party buffs the Skills and Compare tabs add to both builds at max level; providers from the toolbox's TEAM_JOB_BUFFS.
const PARTY_BUFFS = [
  ['Saint', ['Party buff|Common|Striking', 'Party buff|Common|Blessing of Light', 'Party buff|Common|Cure Relic']],
  ['Archer', ['Party buff|Common|Rage of the Owl']],
  ['Barbarian', ['Party buff|Common|Battle Howl']],
  ['Paladin', ['Party buff|Common|Elemental Aura', 'Party buff|Common|Conviction Aura']],
  ['Academic', ['Party buff|Common|Cocktail', 'Party buff|Common|Special Enhancement Potion']],
  ['Screamer', ['Party buff|Common|Spirit of Genie', 'Party buff|Common|Grudge Formation', 'Party buff|Common|Sadism Pleasure']],
  ['Light Fury', ['Party buff|Common|Chakra Heal', 'Party buff|Common|Blessing of Ajna']],
  ['Abyss Walker', ['Party buff|Common|Blessing of Ajna', 'Party buff|Common|Incarnation of the Dark']],
  ['Saleana', ['Party buff|Elemental Lord|Fire Shield']],
  ['Elestra', ['Party buff|Elemental Lord|Ice Shield']],
  ['Dark Avenger', ['Party buff|Common|Shadow Call']],
  ['Guild', ['Guild buff|Common|STR Boost', 'Guild buff|Common|AGI Boost', 'Guild buff|Common|INT Boost', 'Guild buff|Common|VIT Boost']],
].map(([label, keys]) => [label, keys.filter((key) => options.buffs[key])]);
const ELEMENTS_SHOWN = [['Fire', 'Fire'], ['Water', 'Ice'], ['Light', 'Light'], ['Dark', 'Dark']];
const METRIC_TIPS = {
  effective_panel: ['Site score, not in game', '(Attack + skill flat damage) × Final dmg × Crit\nAgainst the boss crit resist'],
};
const metricLabel = (key, label) => {
  const tip = METRIC_TIPS[key];
  return tip ? `<span data-tooltip-head="${esc(tip[0])}" data-tooltip-fixed="${esc(tip[1])}">${esc(label)}</span>` : `<span>${esc(label)}</span>`;
};
const PENDING_TEXT = 'Pending verification';
const PENDING_TIP = {
  runes: 'Normal rune rolls are server-side and cannot be read from the client; values are the CN table\'s.',
};
const MAX_ENCHANTS = 6;
const ICON_SPRITE = '/sim/item-icons.webp';  // built by tools/pak/build_sim_icons.py
const ICON_PX = 44;  // icon drawn inside the game's slot frame
const RARITIES = ['Magic', 'Rare', 'Epic', 'Unique', 'Legend'];

// ---- helpers --------------------------------------------------------------------------

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const clone = (value) => JSON.parse(JSON.stringify(value));

function fmt(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  const n = Number(value);
  return Number.isInteger(n) && digits === 0 ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: digits || 2 });
}

function signed(value, digits = 0) {
  const text = fmt(Math.abs(value), digits);
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function select(path, options, value, extra = '') {
  const current = value === null || value === undefined ? NONE : String(value);
  const list = options.includes(current) ? options : [current, ...options];
  return `<select data-path="${esc(path)}" ${extra}>${list.map((o) => `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(statLabel(o))}</option>`).join('')}</select>`;
}

function number(path, value, [min, max], extra = '') {
  return `<input type="number" data-path="${esc(path)}" value="${esc(value ?? 0)}" min="${min}" max="${max}" step="1" ${extra}>`;
}

function pending(kind) {
  return `<span class="sim-pending" data-tooltip-fixed="${esc(PENDING_TIP[kind])}">${PENDING_TEXT}</span>`;
}

// The game calls the water element "Ice"; data keys stay as the calculator names them.
const statLabel = (attr) => String(attr).replace(/^Water (attack|resist|resistance|effective resistance)\b/, 'Ice $1');

function statLine(stats) {
  const parts = Object.entries(stats).filter(([, v]) => v).map(([k, v]) => `${statLabel(k)} ${k.endsWith('%') ? fmt(v, 2) : fmt(v)}`);
  return parts.length ? parts.join(' · ') : '—';
}

// Stats as aligned label/value columns (editors, set panels, the Other tab).
const statGrid = (stats) => `<div class="sim-set-stats">${statPairs(stats).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${v}</strong></div>`).join('') || '<div><span>—</span></div>'}</div>`;

// Stats in the simulator's standard order (HP, MP, STR... DEF, Crit); others keep theirs after.
const STAT_ORDER = new Map(options.attribute_order.map((attr, i) => [attr, i]));
const orderOf = (key) => STAT_ORDER.get(key) ?? STAT_ORDER.get(key.replace(/ (min|max)( %)?$/, '$2')) ?? STAT_ORDER.size;

// Stats as [label, value] for display: equal min/max pairs become one line, "X %" reads "X 4%".

function statPairs(stats) {
  const out = [];
  const entries = Object.entries(stats).map((e, i) => [e, i]).sort(([[a], i], [[b], j]) => orderOf(a) - orderOf(b) || i - j).map(([e]) => e);
  for (const [key, value] of entries) {
    if (!value) continue;
    const pair = key.endsWith(' min') ? key.slice(0, -4) : key.endsWith(' max') ? key.slice(0, -4) : null;
    if (pair && stats[`${pair} min`] === stats[`${pair} max`]) {
      if (key.endsWith(' min')) out.push([statLabel(pair), fmt(value)]);
      continue;
    }
    const pct = key.match(/^(.*?) ?%$/);
    if (pct) {
      const base = pct[1].replace(/ (min|max)$/, '');
      const twin = pct[1].endsWith(' min') ? `${base} max %` : pct[1].endsWith(' max') ? `${base} min %` : null;
      if (twin && stats[twin] === value) { if (pct[1].endsWith(' min')) out.push([statLabel(base), `${fmt(value, 2)}%`]); continue; }
      out.push([statLabel(pct[1]), `${fmt(value, 2)}%`]);
      continue;
    }
    out.push([statLabel(key), fmt(value)]);
  }
  return out;
}

// Hover tooltip for a slot: name in its rarity color, then what it is and the stats it gives.
function slotTip(head, rarity, sub, stats) {
  const lines = [sub, ...statPairs(stats || {}).map(([k, v]) => `${k} ${v}`)].filter(Boolean);
  return ` data-tooltip-head="${esc(head)}" data-tooltip-rarity="${esc(rarity)}" data-tooltip-fixed="${esc(lines.join('\n'))}"`;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, key) => (o === undefined || o === null ? undefined : o[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let node = obj;
  for (const key of keys.slice(0, -1)) {
    if (node[key] === undefined || node[key] === null) node[key] = /^\d+$/.test(keys[keys.indexOf(key) + 1]) ? [] : {};
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

// ---- build shape ----------------------------------------------------------------------

// The job's buffs in a fixed order so the editor can address them by index; a build that never
// named buffs starts with the job's always-on passives at their top level, as the meter sends them.
function buffRows(build, raw) {
  const keys = L.buffs?.[build.second_job] || [];
  const given = Array.isArray(raw) ? raw : L.passives?.[build.second_job] || [];
  // A name without a key is the meter's passive; a self buff of the same name stays off (as on the server).
  const keyOf = (b) => {
    if (b?.key) return b.key;
    const named = keys.filter((k) => options.buffs?.[k]?.skill === b?.skill);
    return named.find((k) => options.buffs[k].category === 'Passive') ?? named[0];
  };
  const level = (key) => {
    const facts = options.buffs?.[key] || {};
    const hit = given.find((b) => b && keyOf(b) === key);
    return Math.max(0, Math.min(facts.max_level || 0, Number(hit?.level) || 0));
  };
  return keys.map((key) => ({ key, skill: options.buffs?.[key]?.skill || key, level: level(key) }));
}

function normalizeBuild(raw) {
  const build = clone(raw || options.defaults.build1);
  build.equipment = EQUIPMENT_SLOTS.map((slot) => ({ slot, name: NONE, suffix: NONE, enhance: 0, enchants: [], ...(build.equipment || []).find((e) => e.slot === slot) }));
  build.jewelry = JEWELRY_SLOTS.map((slot) => ({ slot, name: NONE, variant: NONE, enchants: [], ...(build.jewelry || []).find((e) => e.slot === slot) }));
  build.engravings = ENGRAVING_SLOTS.map((slot) => ({ ...emptyEngravings().find((e) => e.slot === slot), ...(build.engravings || []).find((e) => e.slot === slot) }));
  build.glyph_a = (build.glyph_a || []).slice(0, 11);
  while (build.glyph_a.length < 11) build.glyph_a.push({ level: NONE, name: NONE, extra: NONE });
  build.glyph_s = (build.glyph_s || []).slice(0, 4);
  while (build.glyph_s.length < 4) build.glyph_s.push({ level: NONE, name: NONE, base_attr1: NONE, rank1: NONE, base_attr2: NONE, rank2: NONE, base_attr3: NONE, rank3: NONE, base_attr4: NONE, rank4: NONE, extra: NONE });
  build.normal_runes = (build.normal_runes || []).slice(0, 4);
  while (build.normal_runes.length < 4) build.normal_runes.push({ type: build.normal_runes.length < 2 ? 'Attack' : 'Defense', level: NONE, entries: [] });
  for (const rune of build.normal_runes) {
    rune.entries = (rune.entries || []).slice(0, 6);
    while (rune.entries.length < 6) rune.entries.push({ attr: NONE, rank: NONE });
  }
  build.core_rune = { level: NONE, conversion: NONE, ratio_rank: NONE, coeff_rank: NONE, enhance: 0, ...(build.core_rune || {}) };
  // This client version has no talismans; keep the shape but never carry their stats.
  build.talismans = L.talismans.slots.map(({ name }) => ({ slot: name, grade: NONE, name: NONE, extra: NONE }));
  build.mastery = L.mastery.map((name) => ({ name, level: 0, ...(build.mastery || []).find((m) => m.name === name) }));
  build.fashion = Object.keys(L.fashion).map((slot) => ({ slot, name: NONE, ...(build.fashion || []).find((f) => f.slot === slot) }));
  for (const piece of build.fashion) if (!COSTUME_ITEM_SLOTS.has(piece.slot)) delete piece.item;  // tier-only slots
  const grades = new Map((build.card_grades || []).map((c) => [c.name, c.grade]));
  build.card_grades = options.cards.names.map((name) => ({ name, grade: grades.get(name) || NONE }));
  build.card_bonus_levels = build.card_bonus_levels || {};
  build.title = build.title || NONE;
  build.collection_level = build.collection_level ?? 0;
  build.crit_resist_value = build.crit_resist_value ?? 0;
  build.buffs = buffRows(build, raw?.buffs);
  return build;
}

function loadBuilds() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.A && saved?.B) {
      return {
        A: normalizeBuild(saved.A), B: normalizeBuild(saved.B),
        characterIds: saved.characterIds || { A: null, B: null },
        characterSyncs: saved.characterSyncs || { A: null, B: null },
      };
    }
  } catch (e) { /* fall through to defaults */ }
  return { A: normalizeBuild(options.defaults.build1), B: normalizeBuild(options.defaults.build1) };
}

// Fields set on the site, not sent by the game; a new sync keeps the page's values.
const SITE_SET_FIELDS = ['title', 'card_bonus_levels', 'collection_level', 'engravings', 'buffs', 'crit_resist_value'];
const sortedKeys = (_, value) => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  : value);

// The part of a build the game sends, to tell a build edited on the site from one left as synced.
function gameSentPart(build) {
  const out = normalizeBuild(build);
  for (const field of SITE_SET_FIELDS) delete out[field];
  return JSON.stringify(out, sortedKeys);
}

function siteSetPart(build) {
  const out = normalizeBuild(build);
  return JSON.stringify(Object.fromEntries(SITE_SET_FIELDS.map((field) => [field, out[field]])), sortedKeys);
}

const syncRecord = (row, build) => ({ syncedAt: row.synced_at, gear: gameSentPart(build), site: siteSetPart(build) });

// ---- option lists ---------------------------------------------------------------------

function equipmentEntry(build, name) {
  for (const job of calc.jobs(build.first_job, build.second_job)) {
    const entry = options.gear[job]?.[name];
    if (entry) return entry;
  }
  return null;
}

const equipmentOptions = (build, slot) => L.equipment[build.second_job]?.[slot] || [NONE];
const suffixOptions = (build, name) => [NONE, ...(options.suffix_sets[equipmentEntry(build, name)?.suffix] || [])];
const enchantOptions = (slot) => (ATTACK_ENCHANT_SLOTS.has(slot) ? L.enchants.attack : L.enchants.defense);
const jewelryLookupSlot = (slot) => (slot.startsWith('Ring') ? 'Ring' : slot);
const jewelryOptions = (slot) => L.jewelry[jewelryLookupSlot(slot)] || [NONE];
const jewelryEntry = (slot, name) => options.accessories[jewelryLookupSlot(slot)]?.[name];
const variantOptions = (slot, name) => [NONE, ...(jewelryEntry(slot, name)?.variants || [])];
const engravingExtraRanks = (item) => L.engraving.extra_ranks[item.extra] || [NONE];
function engravingExtraOption(item) {
  if (item.extra_tier === NONE || !item.extra_value) return NONE;
  return engravingExtraRanks(item).find((o) => o.startsWith(`${item.grade} ${item.extra_tier} `)) || NONE;
}
// The game's potential pool for an item: picked by its rarity and its noun (the last word of the name).
const JEWELRY_NOUN = { Necklace: 'Necklace', Earring: 'Earrings', 'Ring 1': 'Ring', 'Ring 2': 'Ring' };
function potentialPool(build, field, item) {
  const rarity = rarityOf(slotEntry(build, field, item));
  const noun = field === 'jewelry' ? JEWELRY_NOUN[item.slot] : String(item.name).split(' ').at(-1);
  return rngData.potentials.find((p) => p.rarity.includes(rarity) && p.items.some((i) => i.toLowerCase() === noun?.toLowerCase())) || null;
}
const potentialSetKey = (keys) => [...keys].sort().join(' + ');

// "PATK 2.88%" -> name and value cells, so the values line up in a column.
const potentialLine = (key) => {
  const at = key.lastIndexOf(' ');
  return `<span class="sim-pot-line"><span>${esc(statLabel(key.slice(0, at)))}</span><b>${esc(key.slice(at + 1))}</b></span>`;
};
const potentialLinesHtml = (keys, note) => `<span class="sim-pot-lines"><small>${esc(note)}</small>${[...keys]
  .sort((a, b) => lineRank(a) - lineRank(b)).map(potentialLine).join('')}</span>`;
// Lines that are not a whole set: how many of the item's sets contain them all.
function partialNote(lines, pool) {
  const n = pool.rolls.filter((r) => lines.every((l) => r.keys.includes(l))).length;
  return n ? `part of ${n} possible set${n === 1 ? '' : 's'}` : 'not a set this item rolls';
}
// Fellowship heraldry: the game's sets for a plate at a level, one list per focus stat (picked when crafting).
const fellowshipVariants = (item) => rngData.fellowship.filter((f) => f.level === item.level && f.plate === item.name);
const fellowSetMain = (set) => set.lines.slice(0, set.ranks.length).map(([stat]) => stat);
const fellowSetKey = (attrs, ranks, extra) => [...attrs.map((a, i) => `${a}:${ranks[i]}`), `extra:${extra}`].join('|');
const keyOfSet = (set) => fellowSetKey(fellowSetMain(set), set.ranks, set.lines[set.ranks.length]?.[0] ?? NONE);
function keyOfGlyph(item) {
  const slots = [1, 2, 3, 4].filter((n) => hasValue(item[`base_attr${n}`]) && hasValue(item[`rank${n}`]));
  return slots.length ? fellowSetKey(slots.map((n) => item[`base_attr${n}`]), slots.map((n) => String(item[`rank${n}`])), item.extra ?? NONE) : NONE;
}
function findFellowSet(key, variants) {
  for (const variant of variants) for (const set of variant.sets) if (keyOfSet(set) === key) return { variant, set };
  return null;
}
// Writes a set into the plate the way builds store it: a stat and rank per line, plus the extra.
function applyFellowSet(item, variant, set) {
  const main = fellowSetMain(set);
  for (let n = 1; n <= 4; n += 1) Object.assign(item, { [`base_attr${n}`]: main[n - 1] ?? NONE, [`rank${n}`]: set.ranks[n - 1] ?? NONE });
  item.extra = set.lines[set.ranks.length]?.[0] ?? NONE;
  item.focus = variant.focus;
}
const fellowLinesHtml = (set, note) => `<span class="sim-pot-lines"><small>${esc(note)}</small>${set.lines.map(([stat, value]) =>
  `<span class="sim-pot-line${stat === set.bonus ? ' sim-pot-bonus' : ''}"><span>${esc(stat)}</span><b>${Number(value).toLocaleString()}</b></span>`).join('')}</span>`;
function slotEntry(build, field, item) {
  if (item.name === NONE || field === 'fashion') return null;
  return field === 'jewelry' ? jewelryEntry(item.slot, item.name) : equipmentEntry(build, item.name);
}
function iconCell(build, field, name) {
  if (name === NONE) return undefined;
  if (field === 'jewelry') return icons.items.Jewelry?.[name];
  if (field === 'fashion') return icons.items.Costume?.[name];
  for (const job of calc.jobs(build.first_job, build.second_job)) if (icons.items[job]?.[name] !== undefined) return icons.items[job][name];
  return undefined;
}
// A sprite cell as an icon, or the fallback label when there is none.
function spriteIcon(cell, fallback) {
  if (cell === undefined) return `<span class="sim-slot-empty">${esc(fallback)}</span>`;
  const { cols } = icons;
  return `<i class="sim-icon" style="background-image:url(${ICON_SPRITE});background-size:${cols * ICON_PX}px auto;background-position:-${(cell % cols) * ICON_PX}px -${Math.floor(cell / cols) * ICON_PX}px"></i>`;
}
const slotIcon = (build, field, item) => spriteIcon(iconCell(build, field, field === 'fashion' ? item.item : item.name), item.slot);
// Real costume items for a slot ([name, tier, base classes, rank]); weapons only for the build's class.
function costumeItems(build, slot) {
  const base = options.job_map[build.second_job]?.base_class;
  return (costumeList[slot.startsWith('Ring') ? 'Ring' : slot] || []).filter(([, , jobs]) => !jobs || jobs.split(',').includes(base));
}
function costumeRarity(item) {
  const entry = item.item && (costumeList[item.slot.startsWith('Ring') ? 'Ring' : item.slot] || []).find(([name]) => name === item.item);
  return RANK_RARITY[entry?.[3]] || 'normal';
}
// Engraving grades B/A/S/L are Rare/Epic/Unique/Legend; builds keep the letters.
const ENGRAVING_MAIN_STAT = { 'Armor DEF/MDEF': 'DEF/MDEF', 'Weapon PATK/MATK': 'ATK', 'Accessory HP': 'HP', '3-piece Crit': 'Crit' };
function engravingRarity(grade, text = grade) {
  const name = ENGRAVING_RARITY[grade];
  return { rarity: name ? name.toLowerCase() : 'normal', level: 0, label: name ? String(text).replace(/^[BASL]\b/, name) : text };
}

// Picker row details from a gear or accessory entry ("Lv70 Legend").
const entryMeta = (entry) => ({ rarity: rarityOf(entry), level: Number(entry?.level?.match(/^Lv(\d+)/)?.[1] || 0) });
// Costume tiers carry their level in the name: "Costume Wings (Lv70)" -> "Costume Wings", 70.
function tierMeta(tier) {
  const level = String(tier).match(/\(Lv(\d+)\)/)?.[1];
  return { rarity: 'normal', level: Number(level || 0), label: String(tier).replace(/\s*\(Lv\d+\)/, '') };
}
const COSTUME_ITEM_SLOTS = new Set(['Necklace', 'Earring', 'Ring 1', 'Ring 2']);  // picked by real item
const hasValue = (value) => value !== null && value !== undefined && value !== NONE;
// The game never gives an enhancement heraldry its own stat as the extra (Magic has no MATK extra).
const glyphABlocked = (plate, extra) => (options.glyph_a_blocked?.[plate] || []).includes(extra);
const rarityOf = (entry) => RARITIES.find((r) => entry?.level?.endsWith(r))?.toLowerCase() || 'normal';
const CARD_TIERS = [...new Set(Object.values(options.cards.levels))].sort((a, b) => a - b);

// ---- page -----------------------------------------------------------------------------

const BUILD_NAMES = { A: 'Current build', B: 'New build' };
const buildName = (slot) => BUILD_NAMES[slot];
const intoBuild = (slot) => `the ${BUILD_NAMES[slot].toLowerCase()}`;

export const SimulatorPage = {
  builds: null,
  active: 'A',
  section: 'sim',
  rng: { tab: 'engravings', runeLevel: '70', potRarity: 'legend', potPool: 0, fellowLevel: '70', fellowPlate: 0, sort: 'desc' },
  tab: 'sets',
  view: 'general',
  costumeMode: 'fashion',
  statsBreakdown: false,
  compareAll: false,
  // "Change on all equipped" toggles in the heraldry and engraving editors.
  applyAll: { heraldry: false, engraving: false },
  party: null,
  partyMemo: { A: null, B: null },
  // Slot open in the editor, per window (data path of the clicked slot, or 'title').
  slots: { general: 'equipment.0', fashion: 'fashion.0', engraving: 'engravings.0', heraldry: 'glyph_a.0', rune: 'core_rune', card: 'card_grades.0' },
  cardTier: null,
  cardTab: 'cards',
  cardPage: 0,
  container: null,
  results: { A: null, B: null },
  // Guildmates: characters the meter synced and builds saved on the site.
  guild: { characters: [], saved: [], loaded: false },
  savedIds: { A: null, B: null },
  // The synced character each build slot was loaded from, for Save to character.
  characterIds: { A: null, B: null },
  // Per slot: the sync it was loaded from and its game-sent part then, to auto-load newer syncs.
  characterSyncs: { A: null, B: null },

  get build() { return this.builds[this.active]; },
  get slotKey() { return this.view === 'costume' ? this.costumeMode : this.view; },

  render(container) {
    this.container = container;
    if (!this.builds) {
      this.builds = loadBuilds();
      this.characterIds = this.builds.characterIds || { A: null, B: null };
      this.characterSyncs = this.builds.characterSyncs || { A: null, B: null };
      delete this.builds.characterIds;
      delete this.builds.characterSyncs;
    }
    if (!this.party) {
      try { this.party = new Set(JSON.parse(localStorage.getItem(PARTY_KEY) || '[]')); } catch (e) { this.party = new Set(); }
    }
    initFixedTooltip();
    container.innerHTML = `
      <div class="simulator-page" data-build="${this.active}">
        <div class="page-header">
          <div><h1>Character Simulator</h1><p class="page-subtitle">Stats from the SEA client tables. Build by hand, or compare two builds.</p></div>
          ${this.section === 'sim' ? `<div class="sim-build-switch" role="tablist">
            <button class="btn ${this.active === 'A' ? 'btn-primary' : 'btn-secondary'} sim-build-btn" data-action="switch" data-value="A" aria-pressed="${this.active === 'A'}">${buildName('A')}</button>
            <button class="btn ${this.active === 'B' ? 'btn-primary' : 'btn-secondary'} sim-build-btn" data-action="switch" data-value="B" aria-pressed="${this.active === 'B'}">${buildName('B')}</button>
          </div>` : ''}
        </div>
        <nav class="sim-page-tabs">
          <button class="${this.section === 'sim' ? 'active' : ''}" data-action="section" data-value="sim">Simulator</button>
          <button class="sim-tab-rng ${this.section === 'rng' ? 'active' : ''}" data-action="section" data-value="rng">RNG Table</button>
        </nav>
        <div class="sim-section" ${this.section === 'sim' ? '' : 'hidden'}>
          <section class="sim-summary" id="sim-summary"></section>
          <div class="gear-review" id="sim-gear-review" hidden></div>
          <section class="sim-main" id="sim-main"></section>
          <nav class="sim-tabs" id="sim-tabs"></nav>
          <section class="sim-panel" id="sim-panel"></section>
        </div>
        <div class="rng-section" id="rng-section" ${this.section === 'rng' ? '' : 'hidden'}>${rngTable(this.rng)}</div>
      </div>`;
    this.bind();
    this.recalculate();
    this.renderTabs();
    this.renderPanel();
    if (dataService.isAuthenticated() && !this.onReturn) {
      // Back from the game: pick up any sync made meanwhile.
      this.onReturn = () => { if (document.visibilityState === 'visible') void this.loadGuild(); };
      document.addEventListener('visibilitychange', this.onReturn);
      void this.loadGuild();
    }
  },

  async loadGuild() {
    const [characters, saved] = await Promise.all([dataService.isPlayer() ? dataService.getMySyncedCharacters() : [], dataService.getSavedBuilds()]);
    this.guild = { characters, saved, loaded: true };
    const updated = await this.followSyncs();
    if (!this.container) return;
    if (updated) { this.recalculate(); this.render(this.container); } else this.renderPanel();
  },

  // A slot loaded from a character takes its newer syncs; hand-set fields edited here stay and are saved
  // to the character, except those the game just sent. A slot whose gear was edited on the site is left alone.
  async followSyncs() {
    let updated = false;
    for (const slot of ['A', 'B']) {
      const row = this.guild.characters.find((c) => c.id === this.characterIds[slot]);
      if (!row) continue;
      const record = this.characterSyncs[slot];
      if (!record) { this.characterSyncs[slot] = syncRecord(row, this.builds[slot]); continue; }
      if (!row.synced_at || row.synced_at === record.syncedAt) continue;
      if (gameSentPart(this.builds[slot]) !== record.gear) {
        toast.info(`${row.name} has a new sync; Load it into ${intoBuild(slot)} to replace your gear edits`);
        record.syncedAt = row.synced_at;
        continue;
      }
      let next = normalizeBuild(row.build);
      if (record.site && siteSetPart(this.builds[slot]) !== record.site) {
        const fromGame = row.overrides?.hand_set_wins ? [] : (row.build.game_fields || []);
        const kept = Object.fromEntries(SITE_SET_FIELDS.filter((field) => !fromGame.includes(field)).map((field) => [field, this.builds[slot][field]]));
        next = normalizeBuild({ ...row.build, ...kept });
        try {
          await dataService.saveCharacterOverrides(row.id, next);
        } catch (err) {
          toast.error(err.message || 'Could not save to the character');
        }
      }
      this.builds[slot] = next;
      this.characterSyncs[slot] = syncRecord(row, next);
      updated = true;
      toast.success(`${row.name}'s new sync loaded into ${intoBuild(slot)}`);
    }
    this.save();
    return updated;
  },

  destroy() {
    this.container = null;
    if (this.onReturn) {
      document.removeEventListener('visibilitychange', this.onReturn);
      this.onReturn = null;
    }
    this.listeners?.abort();
    this.listeners = null;
  },

  // Re-renders call this again; dropping the old listeners stops one click toggling a picker twice.
  bind() {
    this.listeners?.abort();
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    const root = this.container;
    root.addEventListener('change', (e) => this.onChange(e), { signal });
    root.addEventListener('input', (e) => { if (e.target.matches('input[type="number"][data-path]')) this.onChange(e, true); }, { signal });
    root.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button || !root.contains(button)) return;
      e.preventDefault();
      this.onAction(button.dataset.action, button.dataset.value, button);
    }, { signal });
    // Item pickers close on a click elsewhere or Escape.
    const closePickers = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      const keep = e.type === 'click' ? e.target.closest?.('.sim-picker') : null;
      for (const picker of document.querySelectorAll('.sim-picker.open')) if (picker !== keep) picker.classList.remove('open');
    };
    document.addEventListener('click', closePickers, { signal });
    document.addEventListener('keydown', closePickers, { signal });
  },

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.builds, characterIds: this.characterIds, characterSyncs: this.characterSyncs })); } catch (e) { /* storage may be unavailable */ }
  },

  recalculate() {
    for (const key of ['A', 'B']) this.results[key] = calc.calculate(this.builds[key]);
    this.renderSummary();
    this.save();
  },

  // Re-render on an answer, but not over a field being typed in.
  onResult(error) {
    if (!this.container) return;
    if (error) { toast.error(error.message); return; }
    for (const key of ['A', 'B']) this.results[key] = calc.calculate(this.builds[key]);
    this.renderSummary();
    const focused = document.activeElement;
    if (!(focused?.matches?.('input[type="number"][data-path]') && this.container.contains(focused))) this.renderPanel();
  },

  // Each control carries data-path; the handler applies the meter's dependent resets, then re-renders.
  renderRng() {
    this.container.querySelector('#rng-section').innerHTML = rngTable(this.rng);
  },

  onChange(e, live = false) {
    const el = e.target;
    if (el.dataset.applyAll) { this.applyAll[el.dataset.applyAll] = el.checked; return; }
    const path = el.dataset.path;
    if (!path) return;
    const build = this.build;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') value = el.value === '' ? 0 : Number(el.value);
    if (path.endsWith('.fellow_set') || /^glyph_s\.\d+\.focus$/.test(path)) {
      const itemPath = path.slice(0, path.lastIndexOf('.'));
      const item = getPath(build, itemPath);
      const variants = fellowshipVariants(item);
      if (path.endsWith('.focus')) {
        // A different focus is a different plate; start it at its most likely set.
        const variant = variants.find((v) => v.focus === value);
        if (variant) applyFellowSet(item, variant, variant.sets[0]);
      } else if (value === NONE) {
        for (let n = 1; n <= 4; n += 1) Object.assign(item, { [`base_attr${n}`]: NONE, [`rank${n}`]: NONE });
        item.extra = NONE;
      } else {
        const found = findFellowSet(value, variants);
        if (found) applyFellowSet(item, found.variant, found.set);
      }
      this.recalculate();
      this.renderPanel();
      return;
    }
    if (path.endsWith('.potential_set')) {
      const itemPath = path.slice(0, -'.potential_set'.length);
      const item = getPath(build, itemPath);
      const field = itemPath.split('.')[0];
      const roll = value === NONE ? null : potentialPool(build, field, item)?.rolls.find((r) => potentialSetKey(r.keys) === value);
      if (value === NONE) item.enchants = [];
      else if (roll) item.enchants = [...roll.keys];
      this.recalculate();
      this.renderPanel();
      return;
    }
    if (el.dataset.enchant !== undefined) {
      const item = getPath(build, path);
      const list = new Set(item.enchants || []);
      if (el.checked) list.add(el.dataset.enchant); else list.delete(el.dataset.enchant);
      item.enchants = [...list].filter((x) => x !== NONE).slice(0, MAX_ENCHANTS);
      this.recalculate();
      if (!live) this.renderPanel();
      return;
    }
    setPath(build, path, value);
    this.afterChange(build, path, value);
    this.spreadExtra(build, path, value);
    this.recalculate();
    if (!live) this.renderPanel();
  },

  // With its toggle on, an extra stat (or engraving roll) change goes to every equipped piece of that kind that offers it.
  spreadExtra(build, path, value) {
    const [field, index, key] = path.split('.');
    const kind = { glyph_a: 'heraldry', glyph_s: 'heraldry', engravings: 'engraving' }[field];
    if (!kind || !this.applyAll[kind] || !['extra', 'extra_option'].includes(key)) return;
    const source = build[field][index];
    build[field].forEach((item, i) => {
      if (String(i) === index || !(field === 'engravings' ? hasValue(item.grade) : hasValue(item.name))) return;
      const offered = key === 'extra_option'
        ? item.extra === source.extra && (value === NONE || value.split(' ')[0] === item.grade)
        : field === 'glyph_s' ? (L.glyph_s.extra_options[item.name] || []).includes(value) : !glyphABlocked(item.name, value);
      if (!offered) return;
      const each = `${field}.${i}.${key}`;
      setPath(build, each, value);
      this.afterChange(build, each, value);
    });
  },

  applyAllToggle(kind, noun) {
    return `<label class="sim-apply-all"><input type="checkbox" data-apply-all="${kind}" ${this.applyAll[kind] ? 'checked' : ''}>Change on all equipped ${noun}</label>`;
  },

  afterChange(build, path, value) {
    const [field, index, key] = path.split('.');
    if (path === 'first_job') {
      build.second_job = L.jobs.find((j) => j.first === value)?.seconds[0] || NONE;
      this.resetClassGear(build);
      build.buffs = buffRows(build);
    } else if (path === 'second_job') {
      build.first_job = L.jobs.find((j) => j.seconds.includes(value))?.first || build.first_job;
      this.resetClassGear(build);
      build.buffs = buffRows(build);
    } else if (field === 'equipment' && key === 'name') {
      build.equipment[index].suffix = NONE;
    } else if (field === 'jewelry' && key === 'name') {
      // An accessory's stats all come from its variant, so a new pick starts on its first one.
      build.jewelry[index].variant = variantOptions(build.jewelry[index].slot, value)[1] || NONE;
    } else if (field === 'fashion' && key === 'name') {
      delete build.fashion[index].item;
    } else if (field === 'fashion' && key === 'item') {
      // A real item sets its tier, which is what the calculator and the meter read.
      const piece = build.fashion[index];
      if (value === '') delete piece.item;
      else if (value === NONE) { delete piece.item; piece.name = NONE; }
      else piece.name = costumeItems(build, piece.slot).find(([name]) => name === value)?.[1] || NONE;
    } else if (field === 'engravings') {
      const item = build.engravings[index];
      if (key === 'grade') { item.value_rank = NONE; item.main_value = 0; item.secondary_value = 0; item.extra_tier = NONE; item.extra_value = 0; }
      if (key === 'value_rank') setEngravingRank(item, value);
      if (key === 'extra') { item.extra_tier = NONE; item.extra_value = 0; }
      if (key === 'extra_option') {
        delete item.extra_option;
        const [grade, tier] = value.split(' ');
        item.extra_tier = value === NONE ? NONE : tier;
        item.extra_value = value === NONE ? 0 : optionNumber(value);
        if (value !== NONE && grade !== item.grade) item.grade = grade;
      }
    } else if (field === 'glyph_a' && key === 'name' && glyphABlocked(value, build.glyph_a[index].extra)) {
      build.glyph_a[index].extra = NONE;
    } else if (field === 'glyph_s' && key === 'name') {
      Object.assign(build.glyph_s[index], { base_attr1: NONE, rank1: NONE, base_attr2: NONE, rank2: NONE, base_attr3: NONE, rank3: NONE, base_attr4: NONE, rank4: NONE, extra: NONE, focus: NONE });
    } else if (field === 'normal_runes' && key === 'rarity') {
      // A lower rarity has fewer lines; clear the ones it no longer has.
      const rune = build.normal_runes[index];
      if (value === NONE) delete rune.rarity;
      rune.entries.forEach((entry, j) => { if (j >= runeLineCount(rune)) Object.assign(entry, { attr: NONE, rank: NONE }); });
    } else if (field === 'core_rune' && index === 'conversion') {
      build.core_rune.ratio_rank = NONE; build.core_rune.coeff_rank = NONE;
    }
  },

  // ---- screenshot import (src/sim/screenshot-import.js) drives the window through these -----

  // Gear or accessories a slot can hold for this class, with their icon cells.
  candidates(field, index) {
    const names = field === 'jewelry' ? jewelryOptions(this.build.jewelry[index].slot) : equipmentOptions(this.build, this.build.equipment[index].slot);
    return names.filter(hasValue).map((name) => ({ name, cell: iconCell(this.build, field, name) }));
  },

  jobNames: () => L.jobs.flatMap((j) => j.seconds),

  // Gear a specialization's slot can hold, to tell the class from a screenshot's icons.
  gearFor(secondJob, index) {
    const build = { first_job: L.jobs.find((j) => j.seconds.includes(secondJob))?.first, second_job: secondJob };
    return equipmentOptions(build, EQUIPMENT_SLOTS[index]).filter(hasValue).map((name) => ({ name, cell: iconCell(build, 'equipment', name) }));
  },

  // Several [path, value] edits as one change, with the window's usual dependent resets.
  apply(changes) {
    for (const [path, value] of changes) {
      setPath(this.build, path, value);
      this.afterChange(this.build, path, value);
    }
    this.recalculate();
    this.renderPanel();
  },

  openSlot(ref) {
    this.view = 'general';
    this.slots.general = ref;
    this.renderPanel();
  },

  // A specialization from outside the window (a screenshot); the class follows it.
  setJob(secondJob) {
    const second = simJobName(secondJob);
    if (!L.jobs.some((j) => j.seconds.includes(second))) return;
    this.onChange({ target: { dataset: { path: 'second_job' }, value: second, type: 'select-one' } });
  },

  resetClassGear(build) {
    for (const item of build.equipment) { item.name = NONE; item.suffix = NONE; }
  },

  onAction(action, value, button) {
    if (action !== 'picker-toggle') button.closest('.sim-more')?.classList.remove('open');
    if (action === 'switch') { this.active = value; this.render(this.container); return; }
    if (action === 'tab') { this.tab = value; this.renderTabs(); this.renderPanel(); return; }
    if (action === 'section') { this.section = value; this.render(this.container); return; }
    if (action === 'rng-fellow-pick') { this.rng.fellowPlate = Number(value); this.renderRng(); return; }
    if (action === 'rng-pot-pool') {
      const [rarity, index] = value.split('|');
      Object.assign(this.rng, { potRarity: rarity, potPool: Number(index) });
      this.renderRng();
      return;
    }
    const rngField = { 'rng-tab': 'tab', 'rng-rune-level': 'runeLevel', 'rng-fellow-level': 'fellowLevel', 'rng-sort': 'sort' }[action];
    if (rngField) {
      this.rng[rngField] = value;
      this.renderRng();
      return;
    }
    if (action === 'picker-toggle') {
      const picker = button.closest('.sim-picker');
      const open = !picker.classList.contains('open');
      for (const other of this.container.querySelectorAll('.sim-picker.open')) other.classList.remove('open');
      picker.classList.toggle('open', open);
      if (open) picker.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (action === 'picker-pick') {
      this.onChange({ target: { dataset: { path: button.dataset.pickerPath }, value, type: 'select-one' } });
      return;
    }
    if (action === 'slot') { this.slots[this.slotKey] = value; this.renderPanel(); return; }
    if (action === 'view') { this.view = value; this.renderPanel(); return; }
    if (action === 'costume-mode') { this.costumeMode = value; this.renderPanel(); return; }
    if (action === 'party') {
      if (this.party.has(value)) this.party.delete(value); else this.party.add(value);
      try { localStorage.setItem(PARTY_KEY, JSON.stringify([...this.party])); } catch (e) { /* storage may be unavailable */ }
      for (const el of this.container.querySelectorAll('.sim-party-btn')) {
        el.classList.toggle('active', this.party.has(el.dataset.value));
        el.setAttribute('aria-pressed', String(this.party.has(el.dataset.value)));
      }
      // Redraw once both buffed answers are in (onResult redraws when they arrive), so the tab never blanks.
      if (['A', 'B'].every((slot) => this.partyView(slot).result.rows.length)) this.renderPanel();
      return;
    }
    if (action === 'compare-all') { this.compareAll = !this.compareAll; this.renderPanel(); return; }
    if (action === 'stats-breakdown') { this.statsBreakdown = !this.statsBreakdown; this.renderPanel(); return; }
    if (action === 'card-tier') { this.cardTier = value === 'all' ? null : Number(value); this.cardPage = 0; this.renderPanel(); return; }
    if (action === 'card-tab') { this.cardTab = value; this.renderPanel(); return; }
    if (action === 'card-page') { this.cardPage = Number(value); this.renderPanel(); return; }
    if (action === 'cards-set') {
      const tier = this.cardTier;
      for (const card of this.build.card_grades) if (tier === null || options.cards.levels[card.name] === tier) card.grade = value;
      this.recalculate(); this.renderPanel(); return;
    }
    if (action === 'copy') {
      const [from, to] = value.split('>');
      this.builds[to] = clone(this.builds[from]);
      this.characterIds[to] = this.characterIds[from];
      this.characterSyncs[to] = this.characterSyncs[from] && { ...this.characterSyncs[from] };
      this.recalculate(); this.renderPanel();
      toast.success(`${buildName(from)} copied to ${intoBuild(to)}`); return;
    }
    if (action === 'save-character') { void this.saveCharacter(); return; }
    if (action === 'reset') {
      this.characterIds[this.active] = null;
      this.characterSyncs[this.active] = null;
      this.builds[this.active] = normalizeBuild(options.defaults.build1);
      this.recalculate(); this.render(this.container); return;
    }
    if (action === 'export') {
      navigator.clipboard?.writeText(JSON.stringify(this.build)).then(() => toast.success('Build copied to the clipboard as JSON'));
      return;
    }
    if (action === 'load-character') {
      const id = this.container.querySelector('[data-guild="character"]')?.value;
      const row = this.guild.characters.find((c) => c.id === id);
      if (!row) { toast.warning('Pick a character first'); return; }
      this.builds[this.active] = normalizeBuild(row.build);
      this.savedIds[this.active] = null;
      this.characterIds[this.active] = row.id;
      this.characterSyncs[this.active] = syncRecord(row, this.builds[this.active]);
      this.recalculate(); this.render(this.container);
      toast.success(`${row.name} loaded into ${intoBuild(this.active)}`); return;
    }
    if (action === 'load-saved') {
      const id = this.container.querySelector('[data-guild="saved"]')?.value;
      const row = this.guild.saved.find((b) => b.id === id);
      if (!row) { toast.warning('Pick a saved build first'); return; }
      this.builds[this.active] = normalizeBuild(row.build);
      this.savedIds[this.active] = row.id;
      this.characterIds[this.active] = null;
      this.characterSyncs[this.active] = null;
      this.recalculate(); this.render(this.container);
      toast.success(`${row.name} loaded into ${intoBuild(this.active)}`); return;
    }
    if (action === 'save-build') { void this.saveBuild(); return; }
    if (action === 'delete-saved') { void this.deleteSaved(); return; }
    if (action === 'import') { void this.importBuild(); return; }
    if (action === 'screenshot') { this.openScreenshot(); return; }
  },

  // Class, gear and +N from a character window screenshot into the active build; the rest of the build stays.
  openScreenshot() {
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = `
      <div class="modal-content modal-add-chooser">
        <h2>Read a screenshot</h2>
        <p class="sync-steps-lead">Paste the character sheet from the General tab in-game. Only reads equipment and enhancement levels (for now) - other tabs may be coming soon.</p>
        <p class="sync-steps-note">Afterlight members sync directly from the game via the Toolbox</p>
        ${uploadHtml('sim')}
        <div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Close</button></div>
      </div>`;
    const close = () => root.remove();
    root.addEventListener('click', (e) => { if (e.target === root || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(root);
    setupUpload(root, 'sim', {
      getTarget: () => this,
      onRead: (slots) => {
        if (!slots) return;
        // The build no longer follows the synced character it came from.
        this.characterIds[this.active] = null;
        this.characterSyncs[this.active] = null;
        this.save();
        close();
        const review = this.container?.querySelector('#sim-gear-review');
        if (review) renderGearReview(review, this, slots.filter((slot) => !slot.sure));
        this.openSlot('equipment.0');
      },
    });
  },

  async importBuild() {
    const text = await modal.prompt(`Paste a build to load into the ${buildName(this.active).toLowerCase()}.`, {
      title: 'Paste build JSON', okText: 'Load', placeholder: '{"first_job": ..., "second_job": ...}', multiline: true,
    });
    if (!text) return;
    try {
      this.builds[this.active] = normalizeBuild(JSON.parse(text));
      this.characterIds[this.active] = null;
      this.characterSyncs[this.active] = null;
      this.recalculate(); this.render(this.container);
    } catch (e) { toast.error('That is not a build JSON'); }
  },

  async saveBuild() {
    const current = this.guild.saved.find((b) => b.id === this.savedIds[this.active]);
    const name = await modal.prompt('Name this build.', { title: 'Save build', okText: 'Save', defaultValue: current?.name || `${this.build.second_job} build` });
    if (!name) return;
    try {
      const row = await dataService.saveBuild(name, this.build, current && current.name === name ? current.id : null);
      this.savedIds[this.active] = row.id;
      await this.loadGuild();
      toast.success(`Saved ${row.name}`);
    } catch (err) {
      toast.error(err.message || 'Could not save the build');
    }
  },

  // Title, card mastery, collection level, engravings and passive levels go onto the character; later syncs
  // keep them on top except where the game sent its own value and the character's hand-set toggle is off.
  async saveCharacter() {
    const id = this.characterIds[this.active];
    const row = this.guild.characters.find((c) => c.id === id);
    if (!row) { toast.warning('Load one of your synced characters first'); return; }
    try {
      await dataService.saveCharacterOverrides(row.id, this.build);
      if (this.characterSyncs[this.active]) this.characterSyncs[this.active].site = siteSetPart(this.build);
      await this.loadGuild();
      toast.success(`Saved to ${row.name}: title, card mastery, collection, engravings and passive levels`);
    } catch (err) {
      toast.error(err.message || 'Could not save to the character');
    }
  },

  async deleteSaved() {
    const id = this.container.querySelector('[data-guild="saved"]')?.value;
    const row = this.guild.saved.find((b) => b.id === id);
    if (!row) { toast.warning('Pick a saved build first'); return; }
    if (!(await modal.confirm(`Delete ${row.name}?`, { title: 'Delete build', okText: 'Delete' }))) return;
    try {
      await dataService.deleteSavedBuild(row.id);
      for (const key of ['A', 'B']) if (this.savedIds[key] === row.id) this.savedIds[key] = null;
      await this.loadGuild();
      toast.success(`Deleted ${row.name}`);
    } catch (err) {
      toast.error(err.message || 'Could not delete the build');
    }
  },

  guildRow() {
    return `<div class="sim-guild-row">${this.charactersField()}${this.savedBuildsField()}</div>`;
  },

  // Synced characters are a guild perk; everyone else sees the field dimmed, showing what a synced one of their class looks like.
  charactersField() {
    const label = 'My characters <small class="sim-label-note">synced from the game (via toolbox)</small>';
    if (!dataService.isPlayer()) {
      return `
        <label class="guild-only"><span>${label}${GUILD_ONLY_TAG}</span>
          <span class="sim-inline"><select disabled><option>Synced ${esc(this.build.second_job)}</option></select><button class="btn btn-secondary" disabled>Load</button><button class="btn btn-accent" disabled>Save to character</button></span>
        </label>`;
    }
    const { characters, loaded } = this.guild;
    const synced = (iso) => (iso ? `${shortDate(iso)}, ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '');
    const characterOptions = characters.map((c) => `<option value="${esc(c.id)}" ${c.id === this.characterIds[this.active] ? 'selected' : ''}>${esc(c.name)} · ${esc(c.role)} · ${synced(c.synced_at)}</option>`).join('');
    return `
        <label><span>${label}</span>
          <span class="sim-inline">
            <select data-guild="character" ${characters.length ? '' : 'disabled'}>${characterOptions || `<option value="">${loaded ? 'Nothing synced from the meter yet' : 'Loading'}</option>`}</select>
            <button class="btn btn-secondary" data-action="load-character" ${characters.length ? '' : 'disabled'}>Load</button>
            <button class="btn btn-accent" data-action="save-character" data-tooltip-fixed="Keeps this build's title, card mastery, collection level, engravings and passive levels on the character across syncs">Save to character</button>
          </span>
        </label>`;
  },

  // Any signed-in user can save builds; they are tied to their Discord account.
  savedBuildsField() {
    if (!dataService.isAuthenticated()) {
      return `
        <label class="guild-only"><span>Saved builds</span>
          <span class="sim-inline"><select disabled><option>Log in with Discord to save builds</option></select><button class="btn btn-secondary" disabled>Load</button><button class="btn btn-accent" disabled>Save</button></span>
        </label>`;
    }
    const { saved, loaded } = this.guild;
    const savedOptions = saved.map((b) => `<option value="${esc(b.id)}" ${b.id === this.savedIds[this.active] ? 'selected' : ''}>${esc(b.name)} · ${shortDate(b.updated_at)}</option>`).join('');
    return `
        <label><span>Saved builds</span>
          <span class="sim-inline">
            <select data-guild="saved" ${saved.length ? '' : 'disabled'}>${savedOptions || `<option value="">${loaded ? 'No saved builds' : 'Loading'}</option>`}</select>
            <button class="btn btn-secondary" data-action="load-saved" ${saved.length ? '' : 'disabled'}>Load</button>
            <button class="btn btn-accent" data-action="save-build">Save</button>
            <button class="btn btn-danger-ghost" data-action="delete-saved" ${saved.length ? '' : 'disabled'}>Delete</button>
          </span>
        </label>`;
  },

  // ---- rendering ----------------------------------------------------------------------

  renderSummary() {
    const el = this.container?.querySelector('#sim-summary');
    if (!el) return;
    const { summary, rows } = this.results[this.active];
    const row = (attr) => rows.find((r) => r.attr === attr);
    const cards = [
      ...SUMMARY_METRICS.map(([key, label]) => [metricLabel(key, label), fmt(summary[key], key.endsWith('percent') ? 1 : 0)]),
      [metricLabel('', 'HP'), fmt(row('HP')?.buffed)],
      [metricLabel('', 'DEF rate %'), fmt(row('DEF rate %')?.buffed, 1)],
    ];
    el.innerHTML = `
      <div class="sim-summary-head"><strong>${buildName(this.active)}</strong><span>${esc(this.build.second_job)} · ${esc(this.build.first_job)}</span>${rows.length ? '' : '<em class="sim-calculating">Calculating…</em>'}</div>
      <div class="sim-metrics">${cards.map(([label, value]) => `<article>${label}<strong>${value}</strong></article>`).join('')}</div>`;
    const stats = this.container.querySelector('#sim-char-stats');
    if (stats) stats.innerHTML = this.characterStats();
  },

  renderTabs() {
    const el = this.container.querySelector('#sim-tabs');
    if (!el.children.length) el.innerHTML = TABS.map(([id, label]) => `<button data-action="tab" data-value="${id}">${label}</button>`).join('');
    for (const button of el.children) button.classList.toggle('active', button.dataset.value === this.tab);
  },

  // The character window is always shown; the tab row below picks the second panel.
  renderPanel() {
    const main = this.container?.querySelector('#sim-main');
    const el = this.container?.querySelector('#sim-panel');
    if (!main || !el) return;
    main.innerHTML = this.renderCharacter();
    const render = {
      sets: () => this.renderSets(), other: () => this.renderOther(),
      stats: () => this.renderStats(), skills: () => this.renderSkills(), compare: () => this.renderCompare(),
    }[this.tab] || (() => this.renderSets());
    // A tab still calculating is short; holding its height keeps the page from scrolling up.
    const height = el.offsetHeight;
    el.innerHTML = render();
    el.style.minHeight = el.querySelector('.sim-calculating-panel') ? `${height}px` : '';
  },

  classPicker() {
    const b = this.build;
    const firsts = L.jobs.map((j) => j.first);
    const seconds = L.jobs.find((j) => j.first === b.first_job)?.seconds || [];
    return `
      <div class="sim-class-row">
        <label><span>Class</span>${select('first_job', firsts, b.first_job)}</label>
        <label><span>Specialization</span>${select('second_job', seconds, b.second_job)}</label>
        <label><span>Boss crit resist</span>${number('crit_resist_value', b.crit_resist_value, L.limits.crit_resist)}</label>
        <div class="sim-class-actions">
          <div class="btn-group">
            <button class="btn btn-secondary" data-action="copy" data-value="${this.active === 'A' ? 'A>B' : 'B>A'}">Copy to ${buildName(this.active === 'A' ? 'B' : 'A')}</button>
            <button class="btn btn-secondary" data-action="screenshot">Read screenshot</button>
          </div>
          <div class="sim-picker sim-more">
            <button type="button" class="sim-more-btn" data-action="picker-toggle" aria-haspopup="menu" aria-label="More build actions" title="More">&#8943;</button>
            <ul class="sim-picker-list" role="menu">
              <li><button type="button" role="menuitem" data-action="export">Copy build JSON</button></li>
              <li><button type="button" role="menuitem" data-action="import">Paste build JSON</button></li>
            </ul>
          </div>
          <button class="btn btn-danger-ghost" data-action="reset">Reset</button>
        </div>
      </div>
      ${this.guildRow()}`;
  },

  // One whole set from the item's pool, as the game rolls it; lines that match no set stay shown as they are.
  potentialPicker(path, item, pool) {
    const sets = new Map(pool.rolls.map((r) => [potentialSetKey(r.keys), r]));
    const current = item.enchants?.length ? potentialSetKey(item.enchants) : NONE;
    const options = [NONE, ...(current !== NONE && !sets.has(current) ? [current] : []), ...sets.keys()];
    return this.itemPicker(`${path}.potential_set`, options, current, (key) => {
      const roll = sets.get(key);
      return roll
        ? { rarity: 'normal', level: 0, html: potentialLinesHtml(roll.keys, `${roll.pct}% chance`) }
        : { rarity: 'normal', level: 0, html: potentialLinesHtml(item.enchants, partialNote(item.enchants, pool)) };
    }, { sort: false });
  },

  enchantList(path, item, slot) {
    const options = enchantOptions(slot).filter((o) => o !== NONE);
    const selected = new Set(item.enchants || []);
    return `<div class="sim-enchant-list">${options.map((o) => `<label><input type="checkbox" data-path="${esc(path)}" data-enchant="${esc(o)}" ${selected.has(o) ? 'checked' : ''}>${esc(statLabel(o))}</label>`).join('')}</div>`;
  },

  // ---- character window (laid out like the game's, tab rail on the right) ----------------

  renderCharacter() {
    const b = this.build;
    const view = this.view;
    const character = view === 'general' || view === 'costume';
    const body = {
      general: () => this.generalWindow(), costume: () => this.costumeWindow(),
      heraldry: () => this.renderHeraldry(), card: () => this.renderCards(), rune: () => this.renderRunes(),
    }[view]();
    const rail = `<nav class="sim-rail">${VIEWS.map(([id, label]) => `<button class="${id === view ? 'active' : ''}" data-action="view" data-value="${id}">${label}</button>`).join('')}</nav>`;
    const other = this.active === 'A' ? 'B' : 'A';
    const banner = `<div class="sim-editing"><span>Editing</span><strong>${buildName(this.active)}</strong><em>${esc(b.second_job)}</em>
      <button class="sim-editing-switch" data-action="switch" data-value="${other}">Switch to ${buildName(other).toLowerCase()}</button></div>`;
    return `${banner}${this.classPicker()}
      <div class="sim-equip">
        <div class="sim-window-wrap">${character ? body : `<div class="sim-window sim-window-${view}">${body}</div>`}${rail}</div>
        ${this.slotEditor()}
      </div>`;
  },

  renderSets() {
    const b = this.build;
    const sets = calc.setBonusBreakdown(b.equipment, b.jewelry, b.first_job, b.second_job);
    return `<div class="sim-sets">
        ${this.setPanels(sets.filter((s) => s.scope === 'equipment'), 'Gear set')}${this.setPanels(sets.filter((s) => s.scope === 'jewelry'), 'Accessory set')}
      </div>`;
  },

  characterWindow({ top = '', column, side = '', bottom }) {
    const title = `<button class="sim-window-btn ${this.slots[this.slotKey] === 'title' ? 'active' : ''}" data-action="slot" data-value="title">Title</button>`;
    return `
      <div class="sim-char ${side ? 'has-side' : ''}">
        <div class="sim-char-head">
          ${top ? `<div class="sim-char-top">${top}</div>` : ''}
          <div class="sim-char-name">${esc(this.build.second_job)}</div>
        </div>
        <div class="sim-char-controls">${title}</div>
        <div class="sim-char-stats" id="sim-char-stats">${this.characterStats()}</div>
        <div class="sim-char-gear">${column}</div>
        ${side ? `<div class="sim-char-side">${side}</div>` : ''}
        <div class="sim-char-jewelry">${bottom}</div>
      </div>`;
  },

  generalWindow() {
    const b = this.build;
    return this.characterWindow({
      column: b.equipment.map((_, i) => this.gearSlot('equipment', i)).join(''),
      bottom: b.jewelry.map((_, i) => this.gearSlot('jewelry', i)).join(''),
    });
  },

  // The game's costume window layout; engraving mode shows the same positions.
  costumeWindow() {
    const b = this.build;
    const engraving = this.costumeMode === 'engraving';
    const modes = COSTUME_MODES.map(([id, label]) => `<button class="sim-window-btn ${id === this.costumeMode ? 'active' : ''}" data-action="costume-mode" data-value="${id}">${label}</button>`).join('');
    const at = (slot) => {
      if (engraving) {
        const i = b.engravings.findIndex((e) => e.slot === slot);
        return i < 0 ? this.inertSlot() : this.engravingSlot(i);
      }
      const i = b.fashion.findIndex((f) => f.slot === slot);
      return i < 0 ? this.lookSlot(slot) : this.fashionSlot(i);
    };
    const row = (slots) => slots.map(at).join('');
    return this.characterWindow({
      top: modes, column: row(COSTUME_COLUMN), side: row(COSTUME_SIDE), bottom: row(COSTUME_BOTTOM),
    });
  },

  // Costume armor has no stats, so it is drawn for the layout but holds nothing.
  lookSlot(slot) {
    return `<span class="sim-slot sim-slot-inert normal" aria-label="Costume ${esc(slot)}"><span class="sim-slot-empty">${esc(slot)}</span></span>`;
  },

  slotButton(ref, { icon, rarity, badge, label, tip = '' }) {
    const selected = ref === this.slots[this.slotKey];
    return `<button class="sim-slot ${rarity} ${selected ? 'selected' : ''}" data-action="slot" data-value="${ref}" aria-label="${esc(label)}"${tip}>${icon}${badge ? `<b>${esc(badge)}</b>` : ''}</button>`;
  },

  gearSlot(field, i) {
    const b = this.build;
    const item = b[field][i];
    const entry = slotEntry(b, field, item);
    const gear = field === 'equipment';
    const extra = gear ? item.suffix : item.variant;
    const sub = [item.slot, entry?.level, gear && item.enhance ? `+${item.enhance}` : '', hasValue(extra) ? extra : ''].filter(Boolean).join(' · ');
    return this.slotButton(`${field}.${i}`, {
      icon: slotIcon(b, field, item),
      rarity: rarityOf(entry),
      tip: item.name === NONE ? '' : slotTip(item.name, rarityOf(entry), sub, gear ? calc.equipmentAttrs(item) : calc.jewelryAttrs(item)),
      badge: field === 'equipment' && item.enhance && item.name !== NONE ? `+${item.enhance}` : '',
      label: item.name === NONE ? item.slot : `${item.slot}: ${item.name}`,
    });
  },

  fashionSlot(i) {
    const b = this.build;
    const item = b.fashion[i];
    return this.slotButton(`fashion.${i}`, {
      icon: slotIcon(b, 'fashion', item), rarity: costumeRarity(item), badge: '',
      tip: item.name === NONE ? '' : slotTip(item.item || tierMeta(item.name).label, costumeRarity(item), `Costume ${item.slot}`, calc.fashionAttrs(item.name)),
      label: item.name === NONE ? item.slot : `${item.slot}: ${item.item || item.name}`,
    });
  },

  // Engravings sit on costume pieces, never on gear; costume armor has no stats to show.
  engravingHost(slot) {
    const item = this.build.fashion.find((x) => x.slot === slot);
    return item ? { field: 'fashion', item } : null;
  },

  engravingSlot(i) {
    const b = this.build;
    const item = b.engravings[i];
    const host = this.engravingHost(item.slot);
    return this.slotButton(`engravings.${i}`, {
      icon: host ? slotIcon(b, host.field, host.item) : `<span class="sim-slot-empty">${esc(item.slot)}</span>`,
      rarity: engravingRarity(item.grade).rarity,  // the frame shows the engraving's rarity
      badge: '',
      tip: ENGRAVING_RARITY[item.grade] ? slotTip(`${item.slot} engraving`, engravingRarity(item.grade).rarity, `${engravingKind(item.slot)} · ${ENGRAVING_RARITY[item.grade]}`, calc.engravingAttrs(item)) : '',
      label: `${item.slot} engraving${ENGRAVING_RARITY[item.grade] ? ` (${ENGRAVING_RARITY[item.grade]})` : ''}`,
    });
  },

  // Same labels and raw values as the game's character panel.
  characterStats() {
    const rows = this.results[this.active].rows;
    const v = (attr) => fmt(rows.find((r) => r.attr === attr)?.buffed);
    const pct = (attr) => Number(rows.find((r) => r.attr === attr)?.buffed || 0).toFixed(2);  // the game shows "6.00"
    const line = (label, value) => `<div><span>${label}</span><strong>${value}</strong></div>`;
    return `
      ${line('Class', esc(this.build.second_job))}${line('HP', v('HP'))}${line('MP', v('MP'))}${line('MP Recovery', `<span data-tooltip-fixed="${MP_REGEN_TIP}">${v('MP regen')}</span>`)}
      <h4>Special Attk. Info</h4>
      ${line('Critical', v('Crit'))}${line('Critical Damage', v('Crit damage'))}${line('Final Damage', v('Final damage'))}
      <h4>Basic Info</h4>
      ${line('Attk Power', `${v('PATK min')}-${v('PATK max')}`)}${line('Magic Attk', `${v('MATK min')}-${v('MATK max')}`)}
      ${line('Defense', v('DEF'))}${line('Magic Def', v('MDEF'))}
      <div class="sim-char-pair">
        <section><h4>Stats Info</h4>
          ${line('Strength', v('STR'))}${line('Agility', v('AGI'))}${line('Intelligence', v('INT'))}${line('Vitality', v('VIT'))}</section>
        <section><h4>Elemental Attk. Info</h4>
          ${line('Fire Attack', pct('Fire attack %'))}${line('Ice Attack', pct('Water attack %'))}
          ${line('Light Attack', pct('Light attack %'))}${line('Dark Attack', pct('Dark attack %'))}</section>
      </div>`;
  },

  // ---- slot editor --------------------------------------------------------------------

  editorShell({ icon = '', rarity = '', title, subtitle, body }) {
    return `
      <section class="sim-slot-editor">
        <header>
          ${icon ? `<span class="sim-slot ${rarity}">${icon}</span>` : ''}
          <div><strong class="${rarity}">${esc(title)}</strong><span>${esc(subtitle)}</span></div>
        </header>
        ${body}
      </section>`;
  },

  slotEditor() {
    const ref = this.slots[this.slotKey];
    if (ref === 'title') return this.titleEditor();
    if (ref === 'core_rune') return this.smeltedEditor();
    const [field, index] = ref.split('.');
    if (field === 'glyph_a' || field === 'glyph_s') return this.heraldryEditor(field, Number(index));
    if (field === 'card_grades') return this.cardEditor(Number(index));
    if (field === 'card_bonus_levels') return this.masteryEditor(ref.slice(field.length + 1));
    if (field === 'normal_runes') return this.runeEditor(Number(index));
    if (field === 'fashion') return this.fashionEditor(Number(index));
    if (field === 'engravings') return this.engravingEditor(Number(index));
    return this.gearEditor(field, Number(index));
  },

  // Styled dropdown with rarity colors and level badges; metaOf(name) gives { rarity, level, label }.
  itemPicker(path, options, value, metaOf, { sort = true } = {}) {
    const meta = (name) => (name === NONE ? { rarity: 'normal', level: 0 } : metaOf(name));
    const row = (name) => {
      const { rarity, level, label, html } = meta(name);
      return `<span class="sim-picker-name ${rarity}">${html ?? esc(label ?? name)}</span>${level ? `<span class="sim-lv">Lv${level}</span>` : ''}`;
    };
    // Highest level first, then rarity (Legend, Unique, Epic...), then name; None stays on top.
    const rankOf = (name) => RANK_RARITY.indexOf(meta(name).rarity);
    const sorted = !sort ? options : [...options].sort((a, b) => (b === NONE) - (a === NONE)
      || meta(b).level - meta(a).level || rankOf(b) - rankOf(a) || a.localeCompare(b));
    const items = sorted.map((name) => `<li><button type="button" class="${name === value ? 'selected' : ''}" data-action="picker-pick" data-value="${esc(name)}" data-picker-path="${esc(path)}" role="option" aria-selected="${name === value}">${row(name)}</button></li>`).join('');
    return `
      <div class="sim-picker">
        <button type="button" class="sim-picker-btn" data-action="picker-toggle" aria-haspopup="listbox">${row(value ?? NONE)}</button>
        <ul class="sim-picker-list" role="listbox">${items}</ul>
      </div>`;
  },

  // A rank list (1, 2, 3...) in the styled picker; each row shows what that rank gives.
  rankPicker(path, ranks, value, gives) {
    const current = hasValue(value) ? String(value) : NONE;
    return this.itemPicker(path, [NONE, ...ranks.filter((r) => r !== NONE).map(String)], current, (rank) => {
      const what = gives(rank);
      return { rarity: 'normal', level: 0, label: what ? `Rank ${rank} · ${what}` : `Rank ${rank}` };
    }, { sort: false });
  },

  gearEditor(field, index) {
    const b = this.build;
    const item = b[field][index];
    const path = `${field}.${index}`;
    const gear = field === 'equipment';
    const entry = slotEntry(b, field, item);
    const fields = gear
      ? `<div class="sim-field"><span>Gear</span>${this.itemPicker(`${path}.name`, equipmentOptions(b, item.slot), item.name, (name) => entryMeta(equipmentEntry(b, name)))}</div>
         <label><span>Suffix</span>${select(`${path}.suffix`, suffixOptions(b, item.name), item.suffix)}</label>
         <label><span>Enhance</span>${number(`${path}.enhance`, item.enhance, L.limits.enhance)}</label>`
      : `<div class="sim-field"><span>Accessory</span>${this.itemPicker(`${path}.name`, jewelryOptions(item.slot), item.name, (name) => entryMeta(jewelryEntry(item.slot, name)))}</div>
         <label><span>Variant</span>${select(`${path}.variant`, variantOptions(item.slot, item.name), item.variant)}</label>`;
    const bonus = gear ? calc.equipmentAttrs(item, b.first_job, b.second_job) : calc.jewelryAttrs(item);
    const pool = item.name === NONE ? null : potentialPool(b, field, item);
    const potentials = pool
      ? `<h4>Potential <span class="sim-h4-note">${pool.rolls.length} possible sets</span></h4><div class="sim-field sim-potential-set">${this.potentialPicker(path, item, pool)}</div>`
      : `<h4>Potentials (max ${MAX_ENCHANTS})</h4>${this.enchantList(path, item, item.slot)}`;
    return this.editorShell({
      icon: slotIcon(b, field, item), rarity: rarityOf(entry),
      title: item.name === NONE ? item.slot : item.name,
      subtitle: `${item.slot}${entry?.level ? ` · ${entry.level}` : ''}`,
      body: `
        <div class="sim-editor-fields">${fields}</div>
        ${pool
    ? `<div class="sim-gear-lower"><div>${potentials}</div><div><h4>Stats</h4>${statGrid(bonus)}</div></div>`
    : `${potentials}<h4>Stats</h4>${statGrid(bonus)}`}`,
    });
  },

  fashionEditor(index) {
    const b = this.build;
    const item = b.fashion[index];
    let picker;
    if (COSTUME_ITEM_SLOTS.has(item.slot)) {
      // Accessories by real item (rarity colored). A synced build names only the tier, which shows until an item is picked.
      const items = costumeItems(b, item.slot);
      const rank = new Map(items.map(([name, , , r]) => [name, r]));
      const value = item.item || item.name;
      const options = [NONE, ...(item.item || item.name === NONE ? [] : [item.name]), ...items.map(([name]) => name)];
      picker = this.itemPicker(`fashion.${index}.item`, options, value,
        (name) => ({ rarity: RANK_RARITY[rank.get(name)] || 'normal', level: 0 }));
    } else {
      // Weapons, wings, tail and decal: every item of a tier has the same stats, so the tier is the choice.
      picker = this.itemPicker(`fashion.${index}.name`, L.fashion[item.slot] || [NONE], item.name, tierMeta);
    }
    return this.editorShell({
      icon: slotIcon(b, 'fashion', item), rarity: costumeRarity(item),
      title: item.name === NONE ? item.slot : item.item || item.name,
      subtitle: `Costume ${item.slot}${item.name === NONE ? '' : ` · ${item.name}`}`,
      body: `
        <div class="sim-editor-fields"><div class="sim-field"><span>Costume</span>${picker}</div></div>
        <h4>Stats</h4>
        ${statGrid(calc.fashionAttrs(item.name))}`,
    });
  },

  engravingEditor(index) {
    const b = this.build;
    const item = b.engravings[index];
    const host = this.engravingHost(item.slot);
    const path = `engravings.${index}`;
    return this.editorShell({
      icon: host ? slotIcon(b, host.field, host.item) : '', rarity: engravingRarity(item.grade).rarity,
      title: `${item.slot} engraving`, subtitle: `${engravingKind(item.slot)}${ENGRAVING_RARITY[item.grade] ? ` · ${ENGRAVING_RARITY[item.grade]}` : ''}`,
      body: `
        <div class="sim-editor-fields">
          <div class="sim-field"><span>Rarity</span>${this.itemPicker(`${path}.grade`, L.engraving.grades, item.grade, (g) => engravingRarity(g), { sort: false })}</div>
          <div class="sim-field"><span>Main</span>${this.itemPicker(`${path}.value_rank`, engravingMainOptions(item), item.value_rank, (v) => {
            // Rows say what they give; the second line (ATK on accessories and wings/tail/decal) is paired by position.
            const second = engravingSecondaryOptions(item)[engravingMainOptions(item).indexOf(v) - 1];
            return { rarity: 'normal', level: 0, label: `${ENGRAVING_MAIN_STAT[engravingKind(item.slot)] || ''} +${v}${second ? ` · ATK +${second}` : ''}` };
          }, { sort: false })}</div>
          <label><span>Secondary</span><strong class="sim-field-value">${item.secondary_value ? `${fmt(item.secondary_value, 2)}%` : '—'}</strong></label>
          <label><span>Extra stat</span>${select(`${path}.extra`, L.engraving.extras, item.extra)}</label>
          <div class="sim-field"><span>Extra roll</span>${this.itemPicker(`${path}.extra_option`, engravingExtraRanks(item), engravingExtraOption(item), (o) => engravingRarity(o.split(' ')[0], o), { sort: false })}</div>
          ${this.applyAllToggle('engraving', 'engravings')}
        </div>
        <h4>Stats</h4>
        ${statGrid(calc.engravingAttrs(item))}
        ${this.engravingTotals()}`,
    });
  },

  titleEditor() {
    const b = this.build;
    return this.editorShell({
      title: b.title === NONE ? 'Title' : b.title, subtitle: 'Title',
      body: `
        <div class="sim-editor-fields"><label><span>Title</span>${select('title', L.titles, b.title)}</label></div>
        <h4>Stats</h4>
        ${statGrid(calc.titleAttrs(b.title))}`,
    });
  },

  // One panel per active set: name and pieces, then its stats in aligned columns.
  setPanels(sets, label) {
    if (!sets.length) return `<section class="sim-set-panel"><header><span>${label}</span><strong>—</strong></header></section>`;
    return sets.map((s) => `
      <section class="sim-set-panel">
        <header><span>${label}</span><strong>${esc(s.name || s.setId)}</strong><em>${s.count} ${s.count === 1 ? 'piece' : 'pieces'} · ${s.appliedTiers.length ? `bonuses at ${s.appliedTiers.join(', ')}` : `first bonus at ${Math.min(...(s.tiers?.length ? s.tiers : [2]))}`}</em></header>
        <div class="sim-set-stats">${statPairs(s.attributes).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${v}</strong></div>`).join('')}</div>
      </section>`).join('');
  },

  // ---- heraldry and rune boards (game slot positions; skill-only slots hold no stats) ------

  // Stats one column of the calculator contributes, listed like the game's "Rune Stats" box.
  boardTotals(title, column) {
    const rows = this.results[this.active].rows.filter((r) => r[column]);
    return this.totalsBox(title, rows.map((r) => [r.attr, r[column]]));
  },

  // Every engraving's stats added up; the calculator counts them with title and costumes.
  engravingTotals() {
    const sum = new Map();
    for (const item of this.build.engravings || []) {
      for (const [attr, value] of Object.entries(calc.engravingAttrs(item) || {})) sum.set(attr, (sum.get(attr) || 0) + (Number(value) || 0));
    }
    const entries = [...sum].filter(([, v]) => v).sort(([a], [b]) => orderOf(a) - orderOf(b));
    return this.totalsBox('Engraving Stats', entries);
  },

  totalsBox(title, entries) {
    const lines = entries.map(([attr, value]) => `<div><span>${esc(statLabel(attr))}</span><strong>${attr.endsWith('%') ? fmt(value, 2) : fmt(value)}</strong></div>`).join('');
    // Two columns filled top to bottom, so min/max pairs stay together.
    const half = Math.max(1, Math.ceil(entries.length / 2));
    return `<div class="sim-board-totals"><h4>${title}</h4><div class="sim-totals-grid" style="grid-template-rows:repeat(${half},auto)">${lines || '<div><span>—</span></div>'}</div></div>`;
  },

  inertSlot() {
    return '<span class="sim-slot sim-slot-inert normal" aria-hidden="true"></span>';
  },

  heraldrySlot(kind, i) {
    const item = this.build[kind][i];
    const cell = item.name === NONE ? undefined : icons.items.Heraldry?.[`${item.name}|${item.level}`];
    return this.slotButton(`${kind}.${i}`, {
      icon: spriteIcon(cell, kind === 'glyph_s' ? 'Fellowship' : 'Heraldry'),
      rarity: kind === 'glyph_s' ? 'unique' : 'orange',
      badge: '',
      tip: item.name === NONE ? '' : slotTip(item.name, kind === 'glyph_s' ? 'unique' : 'epic',
        [kind === 'glyph_s' ? 'Fellowship Heraldry' : 'Enhancement Heraldry', hasValue(item.level) ? item.level : ''].filter(Boolean).join(' · '),
        kind === 'glyph_s' ? calc.glyphSAttrs(item) : calc.glyphAAttrs(item)),
      label: item.name === NONE ? `${kind === 'glyph_s' ? 'Fellowship' : 'Enhancement'} heraldry ${i + 1}` : item.name,
    });
  },

  renderHeraldry() {
    const a = (i) => this.heraldrySlot('glyph_a', i);
    const s = (i) => this.heraldrySlot('glyph_s', i);
    const x = () => this.inertSlot();
    const gap = '<span></span>';
    const grid = [
      s(0), a(0), gap, a(1), s(1),
      a(2), x(), gap, x(), a(3),
      gap, gap, x(), gap, gap,
      a(4), x(), gap, x(), a(5),
      s(2), a(6), gap, a(7), s(3),
    ].join('');
    return `
      <div class="sim-board-title">Heraldry</div>
      <div class="sim-board sim-heraldry">${grid}</div>
      <div class="sim-board-row">${a(8)}${a(9)}${a(10)}</div>`;
  },

  // Fellowship plates the client has sets for: pick the focus, then one whole set, as the game rolls it.
  fellowshipSetEditor(item, path, cell, names, variants) {
    const current = keyOfGlyph(item);
    const match = findFellowSet(current, variants);
    const focus = (variants.find((v) => v.focus === item.focus) || match?.variant || variants[0]).focus;
    const variant = variants.find((v) => v.focus === focus);
    const sets = new Map(variant.sets.map((set) => [keyOfSet(set), set]));
    const options = [NONE, ...(current !== NONE && !sets.has(current) ? [current] : []), ...sets.keys()];
    const picker = this.itemPicker(`${path}.fellow_set`, options, current, (key) => {
      const set = sets.get(key);
      if (set) return { rarity: 'normal', level: 0, html: fellowLinesHtml(set, `${set.pct}% chance · tier ${set.tier}`) };
      const lines = [1, 2, 3, 4].filter((n) => hasValue(item[`base_attr${n}`])).map((n) => `${item[`base_attr${n}`]} rank ${item[`rank${n}`]}`);
      if (hasValue(item.extra)) lines.push(`${item.extra} extra`);
      return { rarity: 'normal', level: 0, label: `${lines.join(' · ')} (not a set the ${focus} plate rolls)` };
    }, { sort: false });
    return this.editorShell({
      icon: spriteIcon(cell, 'Fellowship'), rarity: 'unique',
      title: item.name, subtitle: `Fellowship Heraldry · ${item.level}`,
      body: `
        <div class="sim-editor-fields">
          <label><span>Level</span>${select(`${path}.level`, L.glyph_s.levels, item.level)}</label>
          <label><span>Heraldry</span>${select(`${path}.name`, names, item.name)}</label>
          <label><span>Focus</span>${select(`${path}.focus`, variants.map((v) => v.focus), focus)}</label>
        </div>
        <div class="sim-gear-lower">
          <div><h4>Set <span class="sim-h4-note">${variant.sets.length} possible sets</span></h4><div class="sim-field sim-potential-set">${picker}</div></div>
          <div><h4>Stats</h4>${statGrid(calc.glyphSAttrs(item))}</div>
        </div>
        ${this.boardTotals('Heraldry Stats', 'glyph')}`,
    });
  },

  heraldryEditor(kind, index) {
    const item = this.build[kind][index];
    const path = `${kind}.${index}`;
    const cell = item.name === NONE ? undefined : icons.items.Heraldry?.[`${item.name}|${item.level}`];
    const fellowship = kind === 'glyph_s';
    const lists = fellowship ? L.glyph_s : L.glyph_a;
    // The game allows one enhancement heraldry of each type, so plates worn in other slots are not offered.
    const worn = new Set(fellowship ? [] : this.build.glyph_a.filter((_, i) => i !== index).map((g) => g.name).filter(hasValue));
    const names = lists.names.filter((n) => !worn.has(n));
    const statRow = (n) => {
      const base = item[`base_attr${n}`];
      const gives = (rank) => {
        const stats = calc.glyphSRankAttrs(item, n, rank);
        return stats ? statLine(stats) : '';
      };
      return `<div class="sim-field sim-pair"><span>Stat ${n}</span><span class="sim-inline">${select(`${path}.base_attr${n}`, L.glyph_s.base_options[item.name] || [NONE], base)}${this.rankPicker(`${path}.rank${n}`, options.glyph_s_ranks[item.level]?.[item.name]?.[base] || L.glyph_s.ranks, item[`rank${n}`], gives)}</span></div>`;
    };
    const variants = fellowship ? fellowshipVariants(item) : [];
    if (variants.length) return this.fellowshipSetEditor(item, path, cell, names, variants);
    const fields = fellowship
      ? `${[1, 2, 3, 4].map(statRow).join('')}
         <label><span>Extra</span>${select(`${path}.extra`, L.glyph_s.extra_options[item.name] || [NONE], item.extra)}</label>
         ${this.applyAllToggle('heraldry', 'heraldry')}`
      : `<label><span>Extra</span>${select(`${path}.extra`, L.glyph_a.extras.filter((e) => !glyphABlocked(item.name, e)), item.extra)}</label>
         ${this.applyAllToggle('heraldry', 'heraldry')}`;
    return this.editorShell({
      icon: spriteIcon(cell, fellowship ? 'Fellowship' : 'Heraldry'), rarity: fellowship ? 'unique' : 'orange',
      title: item.name === NONE ? `${fellowship ? 'Fellowship' : 'Enhancement'} heraldry ${index + 1}` : item.name,
      subtitle: `${fellowship ? 'Fellowship Heraldry' : 'Enhancement Heraldry'}${!hasValue(item.level) ? '' : ` · ${item.level}`}`,
      body: `
        <div class="sim-editor-fields">
          <label><span>Level</span>${select(`${path}.level`, lists.levels, item.level)}</label>
          <label><span>Heraldry</span>${select(`${path}.name`, names, item.name)}</label>
          ${fields}
        </div>
        <h4>Stats</h4>
        ${statGrid(fellowship ? calc.glyphSAttrs(item) : calc.glyphAAttrs(item))}
        ${this.boardTotals('Heraldry Stats', 'glyph')}`,
    });
  },

  runeSlot(i) {
    const rune = this.build.normal_runes[i];
    const rank = runeRank(rune);
    return this.slotButton(`normal_runes.${i}`, {
      icon: spriteIcon(rank ? icons.items.Rune?.[`${rune.type}|${rank}`] : undefined, rune.type), rarity: RANK_RARITY[rank] || 'normal',
      badge: hasValue(rune.level) ? `Lv${rune.level}` : '',
      tip: rank ? slotTip(`${rune.type} rune`, RANK_RARITY[rank], [hasValue(rune.level) ? `Lv${rune.level}` : '', RUNE_RARITIES[rank - 2]].filter(Boolean).join(' · '),
        calc.runeAttrsForItem(rune)) : '',
      label: `${rune.type} rune ${i + 1}${rank ? ` (${RANK_RARITY[rank]})` : ''}`,
    });
  },

  smeltedSlot() {
    const core = this.build.core_rune;
    return this.slotButton('core_rune', {
      icon: spriteIcon(!hasValue(core.level) ? undefined : icons.items.Smelted?.[core.level], 'Smelted'),
      rarity: 'unique', badge: '', label: 'Smelted Rune',
    });
  },

  // Attack runes top and bottom, defense runes left and right, the Smelted Rune in the middle.
  renderRunes() {
    const r = (i) => this.runeSlot(i);
    const x = () => this.inertSlot();
    return `
      <div class="sim-board-title">Rune</div>
      <div class="sim-board sim-runes">${[x(), r(0), x(), r(2), this.smeltedSlot(), r(3), x(), r(1), x()].join('')}</div>
      ${this.boardTotals('Rune Stats', 'normal_rune')}`;
  },

  runeEditor(index) {
    const b = this.build;
    const rune = b.normal_runes[index];
    const path = `normal_runes.${index}`;
    // Only lines and ranks the tables have at this level (Crit damage is Lv70 only, Lv70 MP stops at rank 2).
    const available = options.rune_ranks[rune.level]?.[rune.type];
    const attrs = (rune.type === 'Defense' ? L.runes.defense_attrs : L.runes.attack_attrs).filter((a) => !available || a === NONE || available[a]);
    const rank = runeRank(rune);
    const rarity = RANK_RARITY[rank];
    // A rune holds any stat on at most two lines, so a stat already on two other lines isn't offered.
    const line = (entry, j) => {
      const gives = (r) => {
        const value = calc.runeRankValue(rune, j, r);
        return value ? `${entry.attr} +${fmt(value)}` : '';
      };
      return `<div class="sim-field sim-pair"><span>Line ${j + 1}</span><span class="sim-inline">${select(`${path}.entries.${j}.attr`, attrs.filter((a) => a === NONE || rune.entries.filter((e, k) => k !== j && e.attr === a).length < 2), entry.attr)}${this.rankPicker(`${path}.entries.${j}.rank`, available?.[entry.attr] || L.runes.ranks, entry.rank, gives)}</span></div>`;
    };
    return this.editorShell({
      icon: spriteIcon(rank ? icons.items.Rune?.[`${rune.type}|${rank}`] : undefined, rune.type), rarity: rarity || 'normal',
      title: `${rune.type} rune`,
      subtitle: [hasValue(rune.level) ? `Lv${rune.level}` : 'Rune', rarity ? `${rarity[0].toUpperCase()}${rarity.slice(1)}` : ''].filter(Boolean).join(' · '),
      body: `
        <div class="sim-editor-fields sim-editor-row">
          <label><span>Type</span>${select(`${path}.type`, ['Attack', 'Defense'], rune.type)}</label>
          <label><span>Level</span>${select(`${path}.level`, L.runes.levels, rune.level)}</label>
          <div class="sim-field"><span>Rarity</span>${this.itemPicker(`${path}.rarity`, [NONE, ...RUNE_RARITIES], rarity ? RUNE_RARITIES[rank - 2] : NONE,
            (r) => ({ rarity: r.toLowerCase(), level: 0 }), { sort: false })}</div>
        </div>
        <h4>Lines ${pending('runes')}</h4>
        <div class="sim-editor-fields">${rune.entries.slice(0, Math.max(runeLineCount(rune), lastFilled(rune.entries))).map(line).join('')}</div>
        <h4>Stats</h4>
        ${statGrid(calc.runeAttrsForItem(rune, b.core_rune.enhance))}`,
    });
  },

  smeltedEditor() {
    const b = this.build;
    const core = b.core_rune;
    const preview = calc.coreRunePreview(b);
    const previewText = preview.source_attr
      ? `${preview.source_attr} ${fmt(preview.source_value)} → deduct ${fmt(preview.deduct)} (cap ${fmt(preview.max_deduct)}) → ${preview.target_attr} +${fmt(preview.gain)}`
      : '—';
    // The stored "ranks" are the values themselves (13 = 13%), so the rows name them.
    const from = String(core.conversion).split(' → ')[0];
    const valuePicker = (path, options, value, label) => this.itemPicker(path, options, hasValue(value) ? String(value) : NONE,
      (v) => ({ rarity: 'normal', level: 0, label: label(v) }), { sort: false });
    return this.editorShell({
      icon: spriteIcon(!hasValue(core.level) ? undefined : icons.items.Smelted?.[core.level], 'Smelted'), rarity: 'unique',
      title: 'Smelted Rune', subtitle: !hasValue(core.level) ? 'Rune' : `Lv${core.level}`,
      body: `
        <div class="sim-editor-fields">
          <label><span>Level</span>${select('core_rune.level', [NONE, ...L.runes.core_levels], core.level)}</label>
          <label><span>Conversion</span>${select('core_rune.conversion', L.runes.conversions, core.conversion)}</label>
          <div class="sim-field"><span>Ratio</span>${valuePicker('core_rune.ratio_rank', L.runes.core_ratio_ranks[core.conversion] || [NONE], core.ratio_rank, (v) => `${v}% of ${from}`)}</div>
          <div class="sim-field"><span>Coefficient</span>${valuePicker('core_rune.coeff_rank', L.runes.core_coeff_ranks[core.conversion] || [NONE], core.coeff_rank, (v) => `×${v}`)}</div>
          <label><span>Normal rune boost %</span>${number('core_rune.enhance', core.enhance, [0, 100])}</label>
        </div>
        <h4>Conversion</h4>
        <p class="sim-line">${esc(previewText)}</p>`,
    });
  },

  // The game's card window: Monster Cards in 4x4 pages, and The Power of Mastery.
  renderCards() {
    const b = this.build;
    const tabs = [['cards', 'Monster Cards'], ['mastery', 'The Power of Mastery']]
      .map(([id, label]) => `<button class="sim-window-btn ${id === this.cardTab ? 'active' : ''}" data-action="card-tab" data-value="${id}">${label}</button>`).join('');
    const body = this.cardTab === 'mastery' ? this.masteryList() : this.cardGrid();
    return `
      <div class="sim-board-title">Card</div>
      <div class="sim-char-top">${tabs}</div>
      ${body}`;
  },

  cardGrid() {
    const b = this.build;
    const tier = this.cardTier;
    const cards = b.card_grades.map((card, index) => ({ card, index }))
      .filter(({ card }) => tier === null || options.cards.levels[card.name] === tier);
    const pages = Math.max(1, Math.ceil(cards.length / CARDS_PER_PAGE));
    const page = Math.min(this.cardPage, pages - 1);
    const shown = cards.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);
    const tiers = [['all', 'All'], ...CARD_TIERS.map((t) => [String(t), `Lv${t}`])];
    const grid = shown.map(({ card, index }) => {
      const ref = `card_grades.${index}`;
      const selected = ref === this.slots.card ? 'selected' : '';
      const { rarity, label } = cardRarity(card.grade);
      const tip = slotTip(card.name, rarity, `Monster Card · Lv${options.cards.levels[card.name]}${hasValue(card.grade) ? ` · ${label}` : ''}`,
        hasValue(card.grade) ? calc.cardAttrs(card.name, card.grade) : {});
      return `<button class="sim-card-cell ${selected}" data-action="slot" data-value="${ref}" aria-label="${esc(card.name)}"${tip}>
          <span class="sim-slot ${cardFrame(card.grade)}">${spriteIcon(icons.items.Card?.[card.name], card.name)}</span>
          <span class="sim-card-name ${cardRarity(card.grade).rarity}">${esc(card.name)}</span>
        </button>`;
    }).join('');
    const pager = Array.from({ length: pages }, (_, n) => `<button class="${n === page ? 'active' : ''}" data-action="card-page" data-value="${n}">${n + 1}</button>`).join('');
    return `
      <div class="sim-card-tabs">${tiers.map(([v, label]) => `<button class="${String(tier ?? 'all') === v ? 'active' : ''}" data-action="card-tier" data-value="${v}">${label}</button>`).join('')}</div>
      <div class="sim-card-grid">${grid}</div>
      <div class="sim-pager">${pager}</div>`;
  },

  masteryList() {
    const levels = this.build.card_bonus_levels;
    return `<div class="sim-mastery">${MASTERY.map(([name, attr]) => {
      const ref = `card_bonus_levels.${attr}`;
      const tip = slotTip(name, 'epic', `The Power of Mastery · Lv.${fmt(levels[attr] || 0)}`, calc.masteryGain(this.build, attr));
      return `<button class="sim-mastery-cell ${ref === this.slots.card ? 'selected' : ''}" data-action="slot" data-value="${esc(ref)}" aria-label="${esc(name)}"${tip}>
          <span class="sim-slot epic">${spriteIcon(icons.items.Mastery?.[name], name)}</span>
          <span><strong>${esc(name)}</strong><small>Lv.${fmt(levels[attr] || 0)}</small></span>
        </button>`;
    }).join('')}</div>`;
  },

  cardEditor(index) {
    const card = this.build.card_grades[index];
    return this.editorShell({
      icon: spriteIcon(icons.items.Card?.[card.name], card.name), rarity: cardFrame(card.grade),
      title: card.name, subtitle: `Monster Card · Lv${options.cards.levels[card.name]}`,
      body: `
        <div class="sim-editor-fields"><div class="sim-field"><span>Rarity</span>${this.itemPicker(`card_grades.${index}.grade`, L.card_grades, card.grade, cardRarity, { sort: false })}</div></div>
        <h4>Stats</h4>
        ${statGrid(calc.cardAttrs(card.name, card.grade))}
        <h4>Set all shown cards (${this.cardTier === null ? 'all tiers' : `Lv${this.cardTier}`}) to</h4>
        <div class="sim-card-bulk">${L.card_grades.map((g) => `<button class="btn btn-secondary" data-action="cards-set" data-value="${g}"><span class="sim-rarity-text ${cardRarity(g).rarity}">${esc(cardRarity(g).label)}</span></button>`).join('')}</div>
        ${this.boardTotals('Card Stats', 'card')}`,
    });
  },

  // A mastery's bonus is what it adds to the cards: the build with and without it.
  masteryEditor(attr) {
    const b = this.build;
    const name = MASTERY.find(([, a]) => a === attr)?.[0] || attr;
    const gain = calc.masteryGain(b, attr);
    return this.editorShell({
      icon: spriteIcon(icons.items.Mastery?.[name], name), rarity: 'epic',
      title: name, subtitle: 'The Power of Mastery',
      body: `
        <div class="sim-editor-fields"><label><span>Level</span>${number(`card_bonus_levels.${attr}`, b.card_bonus_levels[attr] || 0, L.limits.card_bonus_level)}</label></div>
        <h4>Stats</h4>
        ${statGrid(gain)}
        ${this.boardTotals('Card Stats', 'card')}`,
    });
  },

  renderOther() {
    const b = this.build;
    // One row per specialization: its level and what that level gives.
    // One row per buff the job can use; level 0 leaves it out. Passives (permanent) come first.
    const passive = (row) => options.buffs?.[row.key]?.category === 'Passive';
    const order = (b.buffs || []).map((row, i) => [row, i]).sort(([x], [y]) => passive(y) - passive(x));
    const buffs = order.map(([row, i]) => {
      const facts = options.buffs?.[row.key] || {};
      return `<tr${passive(row) ? ' class="sim-buff-passive"' : ''}><td>${esc(facts.category || '')}</td><td>${esc(row.skill)}</td><td>${number(`buffs.${i}.level`, row.level, [0, facts.max_level || 0])}</td></tr>`;
    }).join('');
    const mastery = b.mastery.map((m, i) => `
      <tr><td>${esc(m.name)}</td><td>${number(`mastery.${i}.level`, m.level, L.limits.mastery_level)}</td>
        <td>${esc(statPairs(calc.masteryAttrs(m.name, m.level)).map(([k, v]) => `${k} ${v}`).join(' · ') || '—')}</td></tr>`).join('');
    return `
      <div class="sim-other">
        <section class="sim-set-panel">
          <header><strong>Costume Collection</strong>
            <label class="sim-header-field"><span>Level</span>${number('collection_level', b.collection_level, L.limits.collection_level)}</label></header>
          ${statGrid(calc.collectionAttrs(b.collection_level))}
        </section>
        <section class="sim-set-panel">
          <header><strong>Specialization</strong></header>
          <table class="sim-mastery-table"><tbody>${mastery}</tbody></table>
        </section>
        <section class="sim-set-panel">
          <header><strong>Passives &amp; Buffs</strong></header>
          <table class="sim-mastery-table"><tbody>${buffs}</tbody></table>
        </section>
      </div>`;
  },

  renderStats() {
    const { rows } = this.results[this.active];
    const toggle = `<div class="sim-fs-bar"><button class="btn ${this.statsBreakdown ? 'btn-accent' : 'btn-secondary'}" data-action="stats-breakdown">${this.statsBreakdown ? 'Hide breakdown' : 'Show breakdown'}</button></div>`;
    return toggle + (this.statsBreakdown ? this.statsBreakdownTable(rows) : this.statsGroups(rows));
  },

  // Grouped like the game window: one row per stat, its % bonus or rate on the right.
  statsGroups(rows) {
    const by = new Map(rows.map((r) => [r.attr, r]));
    const value = (attr) => by.get(attr)?.buffed;
    const num = (v) => fmt(Math.round(Number(v) || 0));
    const pct = (v) => (v ? `${fmt(v, 2)}%` : '');
    const rate = (v) => (v ? `${fmt(v, 1)}%` : '');
    const bonus = (attr) => (value(`${attr} %`) ? `+${fmt(value(`${attr} %`), 2)}%` : '');
    const line = (label, shown, side = '', tip = '') => `<div class="sim-fs-row"><span>${esc(label)}</span><strong${tip ? ` data-tooltip-fixed="${esc(tip)}"` : ''}>${shown}</strong><em>${side}</em></div>`;
    const range = (attr) => `${num(value(`${attr} min`))} – ${num(value(`${attr} max`))}`;
    const used = new Set(STAT_GROUPS.flatMap((g) => g.attrs));
    const element = (kind) => ELEMENTS_SHOWN.map(([key, label]) => [label, value(`${key} ${kind} %`)]).filter(([, v]) => v);
    const cards = {
      Basic: [line('HP', num(value('HP')), bonus('HP')), line('MP', num(value('MP')), bonus('MP')),
        by.has('MP regen') ? line('MP recovery', num(value('MP regen')), '', MP_REGEN_TIP) : '', value('Move speed %') ? line('Move speed', pct(value('Move speed %'))) : ''],
      Stats: ['STR', 'AGI', 'INT', 'VIT'].map((a) => line(a, num(value(a)), bonus(a))),
      // Two inner columns each: main stats left, the rest right.
      Attack: [[line('PATK', range('PATK'), bonus('PATK')), line('MATK', range('MATK'), bonus('MATK')),
        line('Final damage', num(value('Final damage')), rate(by.get('Final damage')?.percent)),
        line('Critical', num(value('Crit')), rate(by.get('Crit')?.percent)),
        line('Crit damage', num(value('Crit damage')), by.get('Crit damage')?.percent != null ? rate(200 + by.get('Crit damage').percent) : '')],
      ['Paralyze', 'Stun'].filter((a) => value(a)).map((a) => line(a, num(value(a)), bonus(a)))],
      Defense: [[line('DEF', num(value('DEF')), rate(value('DEF rate %'))), line('MDEF', num(value('MDEF')), rate(value('MDEF rate %')))],
        ['Crit resist', 'Paralyze resist', 'Stun resist'].filter((a) => value(a)).map((a) => line(a, num(value(a)), bonus(a)))],
      Element: [element('attack').map(([l, v]) => line(`${l} attack`, pct(v))), element('resist').map(([l, v]) => line(`${l} resist`, pct(v)))],
    };
    const other = rows.filter((r) => !used.has(r.attr) && r.buffed);
    if (other.length) cards.Other = other.map((r) => line(statLabel(r.attr), r.attr.endsWith('%') ? pct(r.buffed) : num(r.buffed)));
    const card = (title) => {
      const body = cards[title] || [];
      if (!body.flat().join('')) return '';
      const split = Array.isArray(body[0]);
      const inner = split ? `<div class="sim-fs-cols">${body.map((col) => `<div>${col.join('')}</div>`).join('')}</div>` : body.join('');
      return `<section class="sim-fs-card${split ? ' wide' : ''}"><h4>${title}</h4>${inner}</section>`;
    };
    return `<div class="sim-fs-grid">${card('Basic')}${card('Stats')}${card('Attack')}${card('Defense')}${card('Element')}${card('Other')}</div>`;
  },

  // Every row by source, grouped as above; blank zeros, one Total tinted where conversion or buffs moved it.
  statsBreakdownTable(rows) {
    const by = new Map(rows.map((r) => [r.attr, r]));
    const sources = RESULT_COLUMNS.filter(([key]) => !['actual', 'converted', 'buffed'].includes(key));
    const cell = (r, key) => (r[key] ? (r.attr.endsWith('%') ? fmt(r[key], 2) : fmt(Math.round(r[key]))) : '');
    const used = new Set();
    const groupRows = [...STAT_GROUPS.map((g) => [g.title, g.attrs.filter((a) => by.has(a) && !used.has(a) && used.add(a))]),
      ['Other', rows.map((r) => r.attr).filter((a) => !used.has(a))]];
    const body = groupRows.filter(([, attrs]) => attrs.length).map(([title, attrs]) => `<tr class="sim-fs-group"><td colspan="${sources.length + 3}">${title}</td></tr>` + attrs.map((attr) => {
      const r = by.get(attr);
      const changed = Math.abs((r.buffed || 0) - (r.actual || 0)) > 1e-9;
      const tip = changed ? `Stats ${cell(r, 'actual') || 0} → Converted ${cell(r, 'converted') || 0} → Buffed ${cell(r, 'buffed') || 0}` : '';
      return `<tr><td>${esc(statLabel(attr))}</td>${sources.map(([key]) => `<td>${cell(r, key)}</td>`).join('')}<td class="sim-fs-total${changed ? ' changed' : ''}"${tip ? ` data-tooltip-fixed="${esc(tip)}"` : ''}>${cell(r, 'buffed') || 0}</td><td>${r.percent == null ? '' : `${fmt(r.percent, 2)}%`}</td></tr>`;
    }).join('')).join('');
    return `<div class="sim-table-scroll"><table class="sim-table sim-numbers sim-fs-breakdown"><thead><tr><th>Stat</th>${sources.map(([, label]) => `<th>${label}</th>`).join('')}<th>Total</th><th>Rate</th></tr></thead><tbody>${body}</tbody></table></div>`;
  },

  // A build with the chosen party buffs added; memoized so the calculator sees one stable object per content.
  partyBuild(slot) {
    const build = this.builds[slot];
    const keys = [...new Set(PARTY_BUFFS.filter(([label]) => this.party.has(label)).flatMap(([, list]) => list))];
    if (!keys.length) return build;
    const rows = keys.map((key) => ({ key, skill: options.buffs[key].skill, level: options.buffs[key].max_level }));
    const sig = JSON.stringify(build) + JSON.stringify(rows);
    if (this.partyMemo[slot]?.sig !== sig) this.partyMemo[slot] = { sig, build: { ...clone(build), buffs: [...(build.buffs || []), ...rows] } };
    return this.partyMemo[slot].build;
  },

  // What the Skills and Compare tabs read for a slot: the build itself, or its party-buffed copy.
  partyView(slot) {
    const build = this.partyBuild(slot);
    return { build, result: build === this.builds[slot] ? this.results[slot] : calc.calculate(build) };
  },

  // Class icons; hovering shows the class and each buff it adds at max level.
  partyBar() {
    const buttons = PARTY_BUFFS.filter(([, keys]) => keys.length).map(([label, keys]) => {
      const lines = keys.map((key) => {
        const b = options.buffs[key];
        return `${b.skill} Lv${b.max_level}\n   ${statPairs(b.stats || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}`;
      }).join('\n');
      const icon = getClassSpriteStyle(label)
        ? `<span class="class-sprite" style="${getClassSpriteStyle(label)}"></span>`
        : '<img src="/icons/group.svg" alt="">';
      const on = this.party.has(label);
      return `<button class="sim-party-btn ${on ? 'active' : ''}" data-action="party" data-value="${esc(label)}" aria-pressed="${on}" aria-label="${esc(label)}"
        data-tooltip-head="${esc(label)}" data-tooltip-rarity="party" data-tooltip-fixed="${esc(lines)}">${icon}</button>`;
    }).join('');
    return `<div class="sim-party-bar"><span>Party buffs</span>${buttons}</div>`;
  },

  // Damage per cast of each damage skill at its highest Lv70 level; both builds side by side when they share a class.
  renderSkills() {
    return this.partyBar() + this.skillsTable();
  },

  skillsTable() {
    const both = this.builds.A.second_job === this.builds.B.second_job;
    const own = calc.skills(this.partyView(this.active).build);
    if (!own.length) return `<p class="sim-delta-none sim-calculating-panel">${calc.pending() ? 'Calculating…' : `No skill data for ${esc(this.build.second_job)}`}</p>`;
    const other = both ? new Map(calc.skills(this.partyView(this.active === 'A' ? 'B' : 'A').build).map((sk) => [sk.id, sk])) : null;
    const [current, next] = both && this.active === 'B' ? [other, new Map(own.map((sk) => [sk.id, sk]))] : [new Map(own.map((sk) => [sk.id, sk])), other];
    const dmg = (v) => fmt(Math.round(v || 0));
    const split = (sk) => (sk ? ` data-tooltip-fixed="${esc(`Hit ${dmg(sk.hit)}
Crit ${dmg(sk.crit)}`)}"` : '');
    const row = (sk) => {
      // Hybrid skills list each part with its attack type.
      const hybrid = sk.parts.length > 1;
      const what = sk.parts.map((p) => `${fmt(p.pct)}%${p.fixed ? ` + ${fmt(p.fixed)}` : ''}${hybrid ? `<small>${p.kind === 'M' ? 'MATK' : 'PATK'}</small>` : ''}`).join('<br>')
        + (sk.element !== 'None' ? `<small>${esc(statLabel(`${sk.element} attack`).replace(' attack', ''))}</small>` : '');
      const head = `<td>${esc(sk.name)}</td><td>${sk.level}</td><td>${what}</td>`;
      if (!both) return `<tr>${head}<td>${dmg(sk.hit)}</td><td>${dmg(sk.crit)}</td><td>${dmg(sk.average)}</td></tr>`;
      const x = current.get(sk.id)?.average || 0; const y = next.get(sk.id)?.average || 0;
      const diff = y - x;
      const dir = Math.round(diff) ? (diff > 0 ? 'up' : 'down') : '';
      const change = dir ? `${signed(Math.round(diff))} <em>(${signed(x ? diff / x * 100 : 0, 1)}%)</em>` : '<span class="sim-delta-none">—</span>';
      return `<tr>${head}<td${split(current.get(sk.id))}>${dmg(x)}</td><td${split(next.get(sk.id))}>${dmg(y)}</td><td class="sim-delta ${dir}">${change}</td></tr>`;
    };
    const sorted = [...own].sort((a, b) => (current.get(b.id)?.average || 0) - (current.get(a.id)?.average || 0));
    const avgTip = ' data-tooltip-fixed="Crit-weighted, against the boss crit resist"';
    const cols = both
      ? `<th${avgTip}>${buildName('A')}</th><th${avgTip}>${buildName('B')}</th><th>Change</th>`
      : `<th>Hit</th><th>Crit</th><th${avgTip}>Average</th>`;
    return `<div class="sim-table-scroll"><table class="sim-table sim-numbers sim-skills-table">
      <thead><tr><th>Skill</th><th>Lv</th><th>Skill damage</th>${cols}</tr></thead>
      <tbody>${sorted.map(row).join('')}</tbody></table></div>`;
  },

  renderCompare() {
    const a = this.partyView('A').result; const b = this.partyView('B').result;
    const metrics = SUMMARY_METRICS.map(([key, label]) => {
      const x = Number(a.summary[key] || 0); const y = Number(b.summary[key] || 0);
      const digits = key.endsWith('percent') ? 1 : 0;
      return `<article>${metricLabel(key, label)}<strong>${fmt(x, digits)} → ${fmt(y, digits)}</strong><em class="${y - x >= 0 ? 'up' : 'down'}">${signed(y - x, digits)} · ${x ? ((y - x) / Math.abs(x) * 100).toFixed(2) : '0.00'}%</em></article>`;
    }).join('');
    return `
      <div class="sim-compare-head"><p>${buildName('A')}: ${esc(this.builds.A.second_job)} · ${buildName('B')}: ${esc(this.builds.B.second_job)}</p>
        <div class="btn-group">
          <button class="btn btn-secondary" data-action="compare-all">${this.compareAll ? 'Show changes only' : 'Show all stats'}</button>
          <button class="btn btn-secondary" data-action="copy" data-value="A>B">Copy current to new</button>
          <button class="btn btn-secondary" data-action="copy" data-value="B>A">Copy new to current</button>
        </div></div>
      ${this.partyBar()}
      <div class="sim-metrics">${metrics}</div>
      ${this.compareTable(a.rows, b.rows)}`;
  },

  // One table per Full Stats group, flowed into columns; a stat's % bonus rides on its row, unchanged rows hide unless asked for.
  compareTable(leftRows, rightRows) {
    if (!leftRows.length || !rightRows.length) return '<p class="sim-delta-none sim-calculating-panel">Calculating…</p>';
    const left = new Map(leftRows.map((r) => [r.attr, Number(r.buffed) || 0]));
    const right = new Map(rightRows.map((r) => [r.attr, Number(r.buffed) || 0]));
    const attrs = new Set([...left.keys(), ...right.keys()]);
    const isPct = (attr) => attr.endsWith('%');
    const show = (attr, v) => (isPct(attr) ? `${fmt(v, 2)}%` : fmt(Math.round(v)));
    const differs = (attr) => {
      const x = left.get(attr) || 0; const y = right.get(attr) || 0;
      return isPct(attr) ? Math.abs(y - x) >= 0.005 : Math.round(y) !== Math.round(x);
    };
    const row = (attr, bonus) => {
      const x = left.get(attr) || 0; const y = right.get(attr) || 0;
      const value = (side, v) => `${show(attr, v)}${side.get(bonus) ? `<small>+${fmt(side.get(bonus), 2)}%</small>` : ''}`;
      const diff = y - x;
      const rel = x ? diff / Math.abs(x) * 100 : (diff ? 100 : 0);
      const dir = differs(attr) ? (diff > 0 ? 'up' : 'down') : '';
      const bonusDiff = bonus && differs(bonus) ? (right.get(bonus) || 0) - (left.get(bonus) || 0) : 0;
      const change = [
        dir ? (isPct(attr) ? `${signed(diff, 2)}%` : `${signed(Math.round(diff))} <em>(${signed(rel, 1)}%)</em>`) : '',
        bonusDiff ? `<small class="${bonusDiff > 0 ? 'up' : 'down'}">bonus ${signed(bonusDiff, 2)}%</small>` : '',
      ].join('');
      // Bar length: a 25% change fills it.
      const bar = dir ? `<span class="sim-delta-bar ${dir}"><i style="width:${Math.min(100, Math.abs(rel) * 4).toFixed(1)}%"></i></span>` : '';
      return `<tr><td>${esc(statLabel(attr))}</td><td>${value(left, x)}</td><td>${value(right, y)}</td><td class="sim-delta ${dir}">${change || '<span class="sim-delta-none">—</span>'}</td><td>${bar}</td></tr>`;
    };
    const used = new Set();
    const groups = [...STAT_GROUPS.map((g) => [g.title, g.attrs.filter((a) => attrs.has(a) && !used.has(a) && used.add(a))]),
      ['Other', [...attrs].filter((a) => !used.has(a))]];
    const body = groups.map(([title, list]) => {
      const bonusOf = (attr) => (!isPct(attr) && list.includes(`${attr} %`) ? `${attr} %` : null);
      const merged = new Set(list.map(bonusOf).filter(Boolean));
      const shown = list.filter((attr) => !merged.has(attr))
        .filter((attr) => this.compareAll || differs(attr) || (bonusOf(attr) && differs(bonusOf(attr))));
      if (!shown.length) return '';
      return `<section class="sim-compare-card"><div class="sim-table-scroll"><table class="sim-table sim-numbers sim-compare-table">
        <thead><tr><th>${title}</th><th>${buildName('A')}</th><th>${buildName('B')}</th><th>Change</th><th></th></tr></thead>
        <tbody>${shown.map((attr) => row(attr, bonusOf(attr))).join('')}</tbody></table></div></section>`;
    }).join('');
    return body ? `<div class="sim-compare-grid">${body}</div>` : '<p class="sim-delta-none">Both builds have the same stats</p>';
  },
};

// ---- hand builder: the General window alone, for Add/Edit Character -------------------------

const SITE_CLASS_NAMES = { Moonlord: 'Moon Lord' };
export const siteClassName = (job) => SITE_CLASS_NAMES[job] || job;
const simJobName = (role) => Object.keys(SITE_CLASS_NAMES).find((job) => SITE_CLASS_NAMES[job] === role) || role;

// An empty build of the site class: only what the General window shows adds stats.
export function emptyBuildFor(role) {
  const second = simJobName(role);
  const job = L.jobs.find((j) => j.seconds.includes(second)) || L.jobs.find((j) => j.seconds.includes(options.defaults.build1.second_job));
  return normalizeBuild({ first_job: job.first, second_job: job.seconds.includes(second) ? second : job.seconds[0], crit_resist_value: options.defaults.build1.crit_resist_value });
}

// Mounts the window into container; onUpdate(result) runs after every change and calculator answer.
export function createCharacterBuilder(container, raw, { onUpdate } = {}) {
  const builder = Object.assign(Object.create(SimulatorPage), {
    container, builds: { A: normalizeBuild(raw) }, active: 'A', view: 'general', dirty: false,
    results: { A: { rows: [], summary: {} } }, slots: { ...SimulatorPage.slots, general: 'equipment.0' },
    applyAll: { heraldry: false, engraving: false }, listeners: null,
    get result() { return this.results.A; },
    save() {},
    recalculate() {
      this.results.A = calc.calculate(this.build);
      this.renderSummary();
    },
    onResult(error) {
      if (!this.container) return;
      if (error) { toast.error(error.message); return; }
      this.results.A = calc.calculate(this.build);
      this.renderSummary();
      const focused = document.activeElement;
      if (!(focused?.matches?.('input[type="number"][data-path]') && this.container.contains(focused))) this.renderPanel();
    },
    renderSummary() {
      const stats = this.container?.querySelector('#sim-char-stats');
      if (stats) stats.innerHTML = this.characterStats();
      onUpdate?.(this.results.A);
    },
    renderPanel() {
      const main = this.container?.querySelector('.sim-main');
      if (main) main.innerHTML = this.renderCharacter();
    },
    renderCharacter() {
      const b = this.build;
      const seconds = L.jobs.find((j) => j.first === b.first_job)?.seconds || [];
      return `
        <div class="sim-class-row">
          <label><span>Class</span>${select('first_job', L.jobs.map((j) => j.first), b.first_job)}</label>
          <label><span>Specialization</span>${select('second_job', seconds, b.second_job)}</label>
        </div>
        <div class="sim-equip"><div class="sim-window-wrap">${this.generalWindow()}</div>${this.slotEditor()}</div>`;
    },
    onChange(e, live) {
      if (e.target.dataset?.path) this.dirty = true;
      SimulatorPage.onChange.call(this, e, live);
    },
    apply(changes) {
      this.dirty = true;
      SimulatorPage.apply.call(this, changes);
    },
    destroy() {
      this.listeners?.abort();
      this.listeners = null;
      this.container = null;
      if (openBuilder === this) openBuilder = null;
    },
  });
  initFixedTooltip();
  container.innerHTML = '<div class="simulator-page sim-builder"><section class="sim-main"></section></div>';
  openBuilder = builder;
  builder.bind();
  builder.recalculate();
  builder.renderPanel();
  return builder;
}

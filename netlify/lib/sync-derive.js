// The hand-entry columns (equipment, character_stats, suffixes) derived from a synced build and panel.
import { getTables } from './sim/tables.js';

const EQUIPMENT_SLOTS = {
  'Helmet': 'helmet', 'Upper': 'top', 'Lower': 'bottom', 'Gloves': 'gloves', 'Shoes': 'boots',
  'Main weapon': 'mainWeapon', 'Secondary weapon': 'subWeapon',
};
const JEWELRY_SLOTS = {
  'Necklace': ['Necklace', 'necklace'], 'Earring': ['Earring', 'earring'],
  'Ring 1': ['Ring', 'ring1'], 'Ring 2': ['Ring', 'ring2'],
};
// Values of WEAPON_SUFFIXES in src/constants.js.
const SITE_SUFFIXES = new Set(['darkness', 'destruction', 'fire', 'harsh', 'intellect', 'ironwall', 'light', 'magic',
  'tent', 'water', 'wind', 'vigor', 'health']);

// "Lv70 Legend" -> { level: '70', rarity: 'legend' }, as the hand form stores them.
function parseLevelLabel(label) {
  const m = /^Lv(\d+)\s+(\w+)$/.exec(String(label || '').trim());
  return m ? { level: m[1], rarity: m[2].toLowerCase() } : null;
}

function findEquipment(tables, name, job) {
  const chain = tables.job_map[job];
  const jobs = chain ? [job, chain.first_job, chain.base_class] : [];
  for (const j of [...jobs, ...Object.keys(tables.equipment)]) {
    const item = tables.equipment[j]?.[name];
    if (item) return item;
  }
  return null;
}

export function deriveEquipment(build, job, tables = getTables()) {
  const equipment = {};
  for (const piece of build?.equipment || []) {
    const slot = EQUIPMENT_SLOTS[piece?.slot];
    const parsed = slot && parseLevelLabel(findEquipment(tables, piece.name, job)?.level);
    if (parsed) equipment[slot] = { ...parsed, enhancement: Number(piece.enhance) || 0 };
  }
  for (const piece of build?.jewelry || []) {
    const [tableSlot, slot] = JEWELRY_SLOTS[piece?.slot] || [];
    const parsed = slot && parseLevelLabel(tables.jewelry.items[tableSlot]?.[piece.name]?.level);
    if (parsed) equipment[slot] = { ...parsed, enhancement: 0 };
  }
  return equipment;
}

export function deriveStats(panel) {
  const summary = panel?.summary || {};
  const row = (attr) => (panel?.rows || []).find((r) => r.attr === attr)?.buffed;
  const stats = {};
  const put = (key, value, decimals = 0) => {
    const n = Number(value);
    if (value != null && Number.isFinite(n)) stats[key] = Number(n.toFixed(decimals));
  };
  put('attackPower', summary.physical_max);
  put('magicAttack', summary.magic_max);
  put('finalDamage', row('Final damage'));
  put('hp', summary.HP);
  put('defense', row('DEF'));
  put('magicDefense', row('MDEF'));
  put('criticalRate', summary.crit_percent, 2);
  // The meter gives the bonus over the base 200%; the form stores the total the game shows.
  if (summary.crit_damage_percent != null) put('criticalDamage', 200 + Number(summary.crit_damage_percent), 2);
  put('fireAttack', summary['Fire attack %'], 2);
  put('iceAttack', summary['Water attack %'], 2);
  put('lightAttack', summary['Light attack %'], 2);
  put('darkAttack', summary['Dark attack %'], 2);
  return stats;
}

// "Iron Wall II" -> 'ironwall'; null when the site has no such suffix.
export function siteSuffix(name) {
  const key = String(name || '').replace(/\s+[IVX]+$/, '').replace(/\s+/g, '').toLowerCase();
  return SITE_SUFFIXES.has(key) ? key : null;
}

// Columns to write; anything that could not be derived is left out so hand-entered values stay.
export function deriveColumns(build, panel, job, tables = getTables()) {
  const fields = {};
  const equipment = deriveEquipment(build, job, tables);
  if (Object.keys(equipment).length) fields.equipment = equipment;
  const stats = deriveStats(panel);
  if (Object.keys(stats).length) fields.character_stats = stats;
  const weapons = Object.fromEntries((build?.equipment || []).map((p) => [p?.slot, p?.suffix]));
  const suffix1 = siteSuffix(weapons['Main weapon']);
  const suffix2 = siteSuffix(weapons['Secondary weapon']);
  if (suffix1) fields.suffix1 = suffix1;
  if (suffix2) fields.suffix2 = suffix2;
  return fields;
}

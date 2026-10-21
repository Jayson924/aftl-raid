// The hand-entry columns (equipment, character_stats, suffixes) derived from a synced build and panel.
import { getTables } from './sim/tables.js';
import { deriveStats } from '../../src/sim/derive-stats.js';

export { deriveStats };

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

// The builder's card grades, lowest first, as the site's card rarities.
const CARD_RARITY = { C: 'magic', B: 'rare', A: 'epic', S: 'unique', L: 'legend' };

// player_cards rows for the admin's card slots; null when no cards arrived, so stored ones stay.
// `slots` are the slots the sync speaks for; a card synced as None empties its slot.
export function deriveCardRows(build, slotNames) {
  const grades = new Map((build?.card_grades || []).map((c) => [c?.name, c?.grade]));
  if (![...grades.values()].some((g) => CARD_RARITY[g])) return null;
  const slots = [];
  const rows = [];
  for (const [index, name] of Object.entries(slotNames || {})) {
    if (!grades.has(name)) continue;
    const slot = Number(index);
    slots.push(slot);
    const rarity = CARD_RARITY[grades.get(name)];
    if (rarity) rows.push({ slot_index: slot, rarity });
  }
  return { slots, rows };
}

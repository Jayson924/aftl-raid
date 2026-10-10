// Gear stats and a 0-100 gear score from the client item tables (see tools/pak/build_gear_tables.py).
// Covers equipment only, not set bonuses, jewels, costumes, cards, talismans or heraldry.

import tables from './data/gear-tables.js';

export const ENHANCEABLE_SLOTS = ['helmet', 'top', 'bottom', 'gloves', 'boots', 'mainWeapon', 'subWeapon'];
export const ACCESSORY_SLOTS = ['necklace', 'earring', 'ring1', 'ring2'];
export const ALL_SLOTS = [...ENHANCEABLE_SLOTS, ...ACCESSORY_SLOTS];

const ACCESSORY_KIND = { necklace: 0x2f, earring: 0x2e, ring1: 0x14, ring2: 0x14 };
const RARITY_IN_TABLE = new Set(tables.meta.ranks);
const LEVELS_IN_TABLE = tables.meta.levels.map(String);
const DEFAULT_LEVEL = String(Math.max(...tables.meta.levels));

export const MAGIC_CLASSES = new Set([
  'Saleana', 'Elestra', 'Smasher', 'Majesty',
  'Saint', 'Inquisitor',
  'Adept', 'Physician',
  'Dark Summoner', 'Soul Eater',
  'Light Fury', 'Abyss Walker',
]);

// Approximate classic values; weapon attack dominates so small errors barely matter.
const CONVERSION = {
  strToPatk: 0.5,
  agiToPatk: 0.25,
  intToMatk: 0.75,
  agiToCrit: 3.5,
};

export const PLAYER_LEVEL = 70;
export const CRIT_CAP = 0.9;

export function levelCoefficients(level = PLAYER_LEVEL) {
  return tables.coefficients[String(level)] || tables.coefficients[String(PLAYER_LEVEL)];
}

// Game FD curve: linear to 45% at 0.5625 of the level divisor, then 240/7 % per divisor.
// The divisor is 3762 at Lv60 (the old admin table) and 5540 at Lv70.
export function fdToPercent(fd, level = PLAYER_LEVEL) {
  const x = Math.max(0, Number(fd) || 0) / levelCoefficients(level).fd;
  return x <= 0.5625 ? 80 * x : 45 + (240 / 7) * (x - 0.5625);
}

export function fdForPercent(percent, level = PLAYER_LEVEL) {
  const c = levelCoefficients(level).fd;
  return percent <= 45 ? (percent / 80) * c : (0.5625 + (percent - 45) * 7 / 240) * c;
}

export function critToRate(crit, level = PLAYER_LEVEL) {
  return Math.min(CRIT_CAP, Math.max(0, crit) / levelCoefficients(level).crit);
}

export function critDamageMultiplier(critDmg, level = PLAYER_LEVEL) {
  return 2 + Math.max(0, critDmg) / levelCoefficients(level).critDmg;
}

const STAT_KEYS = ['str', 'agi', 'int', 'vit', 'patkMin', 'patkMax', 'matkMin', 'matkMax', 'crit', 'fd', 'critDmg',
  'fireAtk', 'iceAtk', 'lightAtk', 'darkAtk'];

function emptyStats() {
  const s = {};
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

function addStats(target, source, factor = 1) {
  if (!source) return target;
  for (const [k, v] of Object.entries(source)) {
    if (k in target) target[k] += v * factor;
  }
  return target;
}

export function baseJobOf(className) {
  return tables.classBaseJob[className] || null;
}

// Kind codes a class can wear in a slot; several for weapons unless the piece names one.
export function kindsForSlot(baseJob, slot, pieceKind) {
  if (ACCESSORY_KIND[slot]) return [ACCESSORY_KIND[slot]];
  const matches = [];
  for (const [code, kind] of Object.entries(tables.kinds)) {
    if (kind.slot !== slot || kind.job !== baseJob) continue;
    if (pieceKind && kind.noun.toLowerCase() !== String(pieceKind).toLowerCase() && Number(pieceKind) !== Number(code)) continue;
    matches.push(Number(code));
  }
  return matches;
}

function entryFor(level, code, rarity) {
  return tables.entries[`${level}:${code}:${rarity}`] || null;
}

// Base + enhancement + innate + average suffix, or null when the table has no row for it.
export function pieceStats(piece, baseJob, slot) {
  if (!piece || !piece.rarity || !RARITY_IN_TABLE.has(piece.rarity)) return null;
  const level = LEVELS_IN_TABLE.includes(String(piece.level)) ? String(piece.level) : DEFAULT_LEVEL;
  const codes = kindsForSlot(baseJob, slot, piece.kind);
  if (codes.length === 0) return null;

  const enhancement = Math.max(0, Math.min(tables.meta.maxEnhance, Number(piece.enhancement) || 0));
  const total = emptyStats();
  let used = 0;
  for (const code of codes) {
    const entry = entryFor(level, code, piece.rarity);
    if (!entry) continue;
    used += 1;
    addStats(total, entry.base);
    addStats(total, entry.innate);
    addStats(total, entry.suffix);
    if (enhancement > 0 && entry.curve != null) {
      const curve = tables.curves[entry.curve];
      addStats(total, curve[Math.min(enhancement, curve.length) - 1]);
    }
  }
  if (used === 0) return null;
  if (used > 1) for (const k of STAT_KEYS) total[k] /= used;
  return { ...total, level, enhancement, rarity: piece.rarity, kinds: codes.length };
}

export function computeGearStats(player) {
  const baseJob = baseJobOf(player.role);
  const equipment = player.equipment || {};
  const total = emptyStats();
  const slots = {};
  if (!baseJob) return { total, slots, baseJob: null, covered: 0 };
  let covered = 0;
  for (const slot of ALL_SLOTS) {
    const stats = pieceStats(equipment[slot], baseJob, slot);
    slots[slot] = stats;
    if (!stats) continue;
    covered += 1;
    addStats(total, stats);
  }
  return { total, slots, baseJob, covered };
}

// attack x (1 + FD%) x (1 + critRate x (critDamage - 1)), using the level's divisors.
export function computeGearPower(stats, className, opts = {}) {
  const magic = MAGIC_CLASSES.has(className);
  const level = opts.level || PLAYER_LEVEL;
  const s = { ...stats };
  if (opts.extraStats) addStats(s, opts.extraStats);

  const patk = (s.patkMin + s.patkMax) / 2 + s.str * CONVERSION.strToPatk + s.agi * CONVERSION.agiToPatk;
  const matk = (s.matkMin + s.matkMax) / 2 + s.int * CONVERSION.intToMatk;
  const attack = magic ? matk : patk;

  const critRate = critToRate(s.crit + s.agi * CONVERSION.agiToCrit, level);
  const critDamage = critDamageMultiplier(s.critDmg, level);
  const critMult = 1 + critRate * (critDamage - 1);

  const fdPercent = opts.ignoreFd ? 0 : fdToPercent(s.fd, level);
  const element = Math.max(s.fireAtk, s.iceAtk, s.lightAtk, s.darkAtk);

  const power = attack * (1 + fdPercent / 100) * critMult * (1 + element / 100);
  return { power, attack, critRate, critDamage, fdPercent, magic };
}

// Full Lv70 Legend set, +15 where enhanceable.
export function referencePlayer(className) {
  const equipment = {};
  for (const slot of ENHANCEABLE_SLOTS) equipment[slot] = { rarity: 'legend', level: DEFAULT_LEVEL, enhancement: tables.meta.maxEnhance };
  for (const slot of ACCESSORY_SLOTS) equipment[slot] = { rarity: 'legend', level: DEFAULT_LEVEL, enhancement: 0 };
  return { role: className, equipment };
}

const referenceCache = new Map();
function referencePower(className, opts) {
  const key = `${className}|${opts.level || PLAYER_LEVEL}|${opts.ignoreFd ? 'nofd' : 'fd'}`;
  if (!referenceCache.has(key)) {
    const stats = computeGearStats(referencePlayer(className)).total;
    referenceCache.set(key, computeGearPower(stats, className, opts).power);
  }
  return referenceCache.get(key);
}

// Gear power as a 0-100 share of the reference set's; null for unknown class or empty gear.
export function computeGearScore(player, opts = {}) {
  const gear = computeGearStats(player);
  if (!gear.baseJob || gear.covered === 0) return null;
  const { power, ...detail } = computeGearPower(gear.total, player.role, opts);
  const ref = referencePower(player.role, opts);
  const score = ref > 0 ? Math.round((power / ref) * 100) : null;
  return { score, power, reference: ref, ...detail, stats: gear.total, slots: gear.slots, covered: gear.covered };
}

// Each slot's share of total power, for tooltips.
export function slotContributions(player, opts = {}) {
  const gear = computeGearStats(player);
  if (!gear.baseJob) return [];
  const totalPower = computeGearPower(gear.total, player.role, opts).power || 1;
  return ALL_SLOTS.map(slot => {
    const stats = gear.slots[slot];
    if (!stats) return { slot, power: 0, share: 0, stats: null };
    const without = emptyStats();
    addStats(without, gear.total);
    addStats(without, stats, -1);
    const power = totalPower - computeGearPower(without, player.role, opts).power;
    return { slot, power, share: power / totalPower, stats };
  });
}

export { tables as gearTables };

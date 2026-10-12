// Per-character values the game never sends, kept on the player row and laid over every synced build.
import { createCalculator, NONE } from './sim/calc.js';
import { getTables } from './sim/tables.js';

// Party and self buffs are not here: the character's panel must match the game's window.
// Passive levels are, since the game never sends skill levels.
export const OVERRIDE_FIELDS = ['title', 'card_bonus_levels', 'collection_level', 'engravings', 'passives'];

// A keyed row is judged by its key: a self buff can share a passive's name.
const isPassive = (b) => {
  const rows = getTables().buffs || {};
  if (b.key) return rows[b.key]?.category === 'Passive';
  return Object.values(rows).some((r) => r.category === 'Passive' && r.skill === b.skill);
};

// The hand-set fields of a build, as the simulator saves them.
export function pickOverrides(build) {
  const out = {};
  if (!build || typeof build !== 'object') return out;
  if (typeof build.title === 'string') out.title = build.title;
  if (build.card_bonus_levels && typeof build.card_bonus_levels === 'object') out.card_bonus_levels = build.card_bonus_levels;
  if (Number.isFinite(Number(build.collection_level))) out.collection_level = Number(build.collection_level);
  if (Array.isArray(build.engravings)) out.engravings = build.engravings;
  // Level 0 is kept: it turns a passive off.
  if (Array.isArray(build.buffs)) {
    const passives = build.buffs.filter((b) => b && isPassive(b)).map((b) => ({ skill: b.skill, level: Math.max(0, Number(b.level) || 0) }));
    if (passives.length) out.passives = passives;
  }
  return out;
}

// The synced build with the stored overrides on top; the sync never sends these fields itself.
export function applyOverrides(build, overrides) {
  const out = { ...(build || {}) };
  if (!overrides || typeof overrides !== 'object') return out;
  for (const field of OVERRIDE_FIELDS) {
    if (field === 'passives' || overrides[field] === undefined || overrides[field] === null) continue;
    out[field] = overrides[field];
  }
  if (Array.isArray(overrides.passives)) {
    const levels = new Map(overrides.passives.map((p) => [p.skill, p.level]));
    const kept = (out.buffs || []).filter((b) => !levels.has(b?.skill));
    out.buffs = [...kept, ...overrides.passives.filter((p) => p.level > 0).map((p) => ({ skill: p.skill, level: p.level }))];
  }
  return out;
}

// Graded cards as "name|grade", sorted, to compare two card sets.
export function gradedCards(cards) {
  return (cards || []).filter((c) => c?.grade && c.grade !== 'None').map((c) => `${c.name}|${c.grade}`).sort();
}

let calculator = null;

// The site's own panel for a build; null when the build cannot be calculated.
export function calculatePanel(build) {
  // A build with no gear says nothing about the character; hand-entered columns then stay.
  if (!(build?.equipment || []).length && !(build?.jewelry || []).length) return null;
  try {
    calculator = calculator || createCalculator(getTables());
    const { rows, summary } = calculator.calculate(build);
    return { rows, summary };
  } catch (err) {
    console.error('panel calculation failed:', err.message);
    return null;
  }
}

export { NONE };

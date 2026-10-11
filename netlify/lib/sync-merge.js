// Per-character values the game never sends, kept on the player row and laid over every synced build.
import { createCalculator, NONE } from './sim/calc.js';
import { getTables } from './sim/tables.js';

export const OVERRIDE_FIELDS = ['title', 'card_bonus_levels', 'collection_level', 'engravings', 'buffs'];

// The hand-set fields of a build, as the simulator saves them.
export function pickOverrides(build) {
  const out = {};
  if (!build || typeof build !== 'object') return out;
  if (typeof build.title === 'string') out.title = build.title;
  if (build.card_bonus_levels && typeof build.card_bonus_levels === 'object') out.card_bonus_levels = build.card_bonus_levels;
  if (Number.isFinite(Number(build.collection_level))) out.collection_level = Number(build.collection_level);
  if (Array.isArray(build.engravings)) out.engravings = build.engravings;
  if (Array.isArray(build.buffs)) out.buffs = build.buffs.filter((b) => b && b.skill && Number(b.level) > 0).map((b) => ({ skill: b.skill, level: Number(b.level), ...(b.key ? { key: b.key } : {}) }));
  return out;
}

// The synced build with the stored overrides on top; the sync never sends these fields itself.
export function applyOverrides(build, overrides) {
  const out = { ...(build || {}) };
  if (!overrides || typeof overrides !== 'object') return out;
  for (const field of OVERRIDE_FIELDS) if (overrides[field] !== undefined && overrides[field] !== null) out[field] = overrides[field];
  return out;
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

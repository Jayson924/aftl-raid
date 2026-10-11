// Engraving slots, value lists and ranks, shared by the simulator and the edit-character modal.
import options from '../data/sim/options.json' with { type: 'json' };
import { NONE } from './remote.js';

const L = options.lists;

export const optionNumber = (text) => { const m = String(text ?? '').match(/-?\d+(?:\.\d+)?/g); return m ? Number(m.at(-1)) : 0; };

export function emptyEngravings() {
  return L.engraving.slots.map((slot) => ({
    slot, grade: NONE, value_rank: NONE, main_value: 0, secondary_value: 0, extra: NONE, extra_tier: NONE, extra_value: 0,
  }));
}

export function engravingKind(slot) {
  if (['Helmet', 'Upper', 'Lower', 'Gloves', 'Shoes'].includes(slot)) return 'Armor DEF/MDEF';
  if (['Main weapon', 'Secondary weapon'].includes(slot)) return 'Weapon PATK/MATK';
  if (['Necklace', 'Earring', 'Ring 1', 'Ring 2'].includes(slot)) return 'Accessory HP';
  return '3-piece Crit';
}
export const engravingMainOptions = (item) => [NONE, ...(L.engraving.main_values[`${engravingKind(item.slot)}|${item.grade}`] || [])];
export const engravingSecondaryOptions = (item) => L.engraving.secondary_values[`${engravingKind(item.slot)}|${item.grade}`] || [];

// Sets an engraving's main value rank and the secondary value that goes with it.
export function setEngravingRank(item, rank) {
  item.value_rank = rank;
  const at = engravingMainOptions(item).indexOf(rank);
  item.main_value = optionNumber(rank);
  item.secondary_value = optionNumber(engravingSecondaryOptions(item)[Math.max(0, at - 1)] || NONE);
}

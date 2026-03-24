/**
 * Arena Game Constants
 *
 * All combat values, ability definitions, and timer durations for the Guild Arena.
 */

// Base HP for all characters
export const BASE_HP = 120;
export const MAX_HP = 120;

// Damage values by action
export const DAMAGE = {
  ATTACK: 12,
  STRONG_ATTACK: 16,
  DEFEND_COUNTER: 8
};

// RPS outcomes: [attacker action][defender action] = { winner, damage }
// 'attacker' means the first player wins, 'defender' means second wins, 'draw' means tie
export const ACTION_OUTCOMES = {
  attack: {
    attack: { result: 'draw', damage: 0 },
    defend: { result: 'lose', damage: DAMAGE.DEFEND_COUNTER },    // Defend beats Attack
    strong_attack: { result: 'win', damage: DAMAGE.ATTACK }       // Attack beats Strong Attack
  },
  defend: {
    attack: { result: 'win', damage: DAMAGE.DEFEND_COUNTER },     // Defend beats Attack
    defend: { result: 'draw', damage: 0 },
    strong_attack: { result: 'lose', damage: DAMAGE.STRONG_ATTACK } // Strong Attack beats Defend
  },
  strong_attack: {
    attack: { result: 'lose', damage: DAMAGE.ATTACK },            // Attack beats Strong Attack
    defend: { result: 'win', damage: DAMAGE.STRONG_ATTACK },      // Strong Attack beats Defend
    strong_attack: { result: 'draw', damage: 0 }
  }
};

// Timer durations (in seconds)
export const TIMERS = {
  DRAFT_PHASE: 60,
  CHARACTER_SENDOUT: 30,
  ACTION_PICK: 20,
  SERVER_TIMEOUT: 30,  // Server auto-randoms if one committed and other hasn't after this
  TIEBREAKER_SUSPENSE: 2
};

// Class family → ability mapping
export const CLASS_ABILITIES = {
  warrior: {
    id: 'highlander',
    name: 'Highlander',
    description: 'Survive lethal damage at 1 HP once (lasts 2 turns)',
    icon: '&#9876;', // sword
    classes: ['Gladiator', 'Moon Lord', 'Barbarian', 'Destroyer']
  },
  archer: {
    id: 'critical_buff',
    name: 'Critical Buff',
    description: 'This turn\'s outgoing damage x1.5',
    icon: '&#127993;', // bow
    classes: ['Sniper', 'Artillery', 'Tempest', 'Wind Walker']
  },
  sorceress: {
    id: 'charged_missile',
    name: 'Charged Missile',
    description: 'Locked into Defend this turn, next turn damage x2',
    icon: '&#9889;', // lightning
    classes: ['Saleana', 'Elestra', 'Smasher', 'Majesty']
  },
  cleric: {
    id: 'heal',
    name: 'Heal',
    description: 'Restore 20 HP (cap 120) before damage resolution',
    icon: '&#10010;', // cross
    classes: ['Saint', 'Inquisitor', 'Guardian', 'Crusader']
  },
  academic: {
    id: 'food_dispenser',
    name: 'Food Dispenser',
    description: 'Random: +5 damage, -5 incoming, or +10 HP',
    icon: '&#9881;', // gear
    classes: ['Gear Master', 'Shooting Star', 'Adept', 'Physician']
  },
  kali: {
    id: 'ghost_guard',
    name: 'Ghost Guard',
    description: 'Opponent\'s damage halved this turn',
    icon: '&#128123;', // ghost
    classes: ['Dark Summoner', 'Soul Eater', 'Blade Dancer', 'Spirit Dancer']
  }
};

/**
 * Get the ability for a given class name
 */
export function getAbilityForClass(className) {
  for (const family of Object.values(CLASS_ABILITIES)) {
    if (family.classes.includes(className)) {
      return family;
    }
  }
  return null;
}

// Ability multipliers
export const ABILITY_EFFECTS = {
  critical_buff: { damageMultiplier: 1.5 },
  charged_missile: { forceDefend: true, nextTurnDamageMultiplier: 2 },
  heal: { hpRestore: 20 },
  ghost_guard: { incomingDamageMultiplier: 0.5 },
  highlander: { duration: 2, preventLethal: true },
  food_dispenser: {
    outcomes: [
      { type: 'damage_boost', value: 5, label: '+5 damage' },
      { type: 'damage_reduction', value: 5, label: '-5 incoming' },
      { type: 'hp_restore', value: 10, label: '+10 HP' }
    ]
  }
};

// Tournament phases
export const TOURNAMENT_PHASES = {
  SETUP: 'setup',
  GROUP_STAGE: 'group_stage',
  SEMIFINALS: 'semifinals',
  FINALS: 'finals',
  COMPLETE: 'complete'
};

// Match statuses
export const MATCH_STATUS = {
  PENDING: 'pending',
  DRAFTING: 'drafting',
  ROSTER_REVEAL: 'roster_reveal',
  IN_PROGRESS: 'in_progress',
  TIEBREAKER: 'tiebreaker',
  COMPLETE: 'complete'
};

// Draft constraints
export const DRAFT_RULES = {
  CHARACTERS_PER_DRAFT: 3,
  MAX_HIRED: 1
};

// Enhancement race (tiebreaker) rates — uses protection jelly rates
export const TIEBREAKER_RATES = {
  10: { success: 30, failDowngrade: 0 },   // +9 → +10: 30%, fail = stay
  11: { success: 25, failDowngrade: 1 },   // +10 → +11: 25%, fail = -1
  12: { success: 20, failDowngrade: 2 },   // +11 → +12: 20%, fail = -2
  13: { success: 15, failDowngrade: 2 }    // +12 → +13: 15%, fail = -2
};
export const TIEBREAKER_START_LEVEL = 9;
export const TIEBREAKER_TARGET_LEVEL = 13;

// Spectator reactions
export const REACTIONS = ['👍', '👎', '😂', '😢', '😮'];
export const REACTION_COOLDOWN_MS = 3000;

// Prize distribution (default for ~20 players)
export const DEFAULT_PRIZES = {
  '1st': 6000,
  '2nd': 3000,
  '3rd': 2000,
  '4th': 2000,
  'participation': 500
};

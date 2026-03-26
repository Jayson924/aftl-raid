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

/**
 * Calculate remaining seconds for a timer anchored to a server timestamp.
 * Returns at least 0. Callers that need a minimum of 1 should clamp themselves.
 */
export function getRemainingSeconds(serverTimestamp, durationSeconds) {
  if (!serverTimestamp) return durationSeconds;
  const elapsed = (Date.now() - new Date(serverTimestamp).getTime()) / 1000;
  return Math.max(0, Math.ceil(durationSeconds - elapsed));
}

// Class family → ability mapping
export const CLASS_ABILITIES = {
  warrior: {
    id: 'highlander',
    name: 'Highlander',
    description: 'Survive lethal damage at 1 HP once (lasts 2 turns)',
    icon: '<span class="ability-icon"><img src="/icons/warrior.png" alt=""></span>',
    classes: ['Gladiator', 'Moon Lord', 'Barbarian', 'Destroyer']
  },
  archer: {
    id: 'critical_buff',
    name: 'Critical Buff',
    description: 'This turn\'s outgoing damage x1.5',
    icon: '<span class="ability-icon"><img src="/icons/archer.png" alt=""></span>',
    classes: ['Sniper', 'Artillery', 'Tempest', 'Wind Walker']
  },
  sorceress: {
    id: 'charged_missile',
    name: 'Charged Missile',
    description: 'Locked into Defend this turn, next turn damage x2',
    icon: '<span class="ability-icon"><img src="/icons/sorceress.png" alt=""></span>',
    classes: ['Saleana', 'Elestra', 'Smasher', 'Majesty']
  },
  cleric: {
    id: 'heal',
    name: 'Heal',
    description: 'Restore 20 HP (cap 120) before damage resolution',
    icon: '<span class="ability-icon"><img src="/icons/cleric.png" alt=""></span>',
    classes: ['Saint', 'Inquisitor', 'Guardian', 'Crusader']
  },
  academic: {
    id: 'food_dispenser',
    name: 'Food Dispenser',
    description: 'Random: +5 damage, -5 incoming, or +10 HP',
    icon: '<span class="ability-icon"><img src="/icons/academic.png" alt=""></span>',
    classes: ['Gear Master', 'Shooting Star', 'Adept', 'Physician']
  },
  kali: {
    id: 'ghost_guard',
    name: 'Ghost Guard',
    description: 'Opponent\'s damage halved this turn',
    icon: '<span class="ability-icon"><img src="/icons/kali.png" alt=""></span>',
    classes: ['Dark Summoner', 'Soul Eater', 'Blade Dancer', 'Spirit Dancer']
  }
};

// Class name → base class icon file mapping
const CLASS_TO_ICON = {};
const ICON_MAP = {
  warrior: 'warrior.png',
  archer: 'archer.png',
  sorceress: 'sorceress.png',
  cleric: 'cleric.png',
  academic: 'academic.png',
  kali: 'kali.png'
};
for (const [family, data] of Object.entries(CLASS_ABILITIES)) {
  for (const cls of data.classes) {
    CLASS_TO_ICON[cls] = ICON_MAP[family];
  }
}

/**
 * Get the base class icon path for a class name
 */
export function getClassIconPath(className) {
  const file = CLASS_TO_ICON[className];
  return file ? `/icons/${file}` : null;
}

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
  REGISTRATION: 'registration',
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

// Match formats — how many characters each player drafts / rounds to win
export const MATCH_FORMATS = {
  1: { label: '1v1', charsPerDraft: 1, roundsToWin: 1, maxHired: 1 },
  2: { label: '2v2', charsPerDraft: 2, roundsToWin: 2, maxHired: 1 },
  3: { label: '3v3', charsPerDraft: 3, roundsToWin: 2, maxHired: 2 }
};
export const DEFAULT_MATCH_FORMAT = 1;

// Draft constraints (legacy convenience — use getMatchFormat() for format-aware values)
export const DRAFT_RULES = {
  CHARACTERS_PER_DRAFT: 3,
  MAX_HIRED: 2
};

/**
 * Get format config for a match format number (1, 2, or 3)
 */
export function getMatchFormat(format) {
  return MATCH_FORMATS[format] || MATCH_FORMATS[DEFAULT_MATCH_FORMAT];
}

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
export const REACTION_COOLDOWN_MS = 2000;

// Betting
export const BETTING_WINDOW_SECONDS = 60;
export const MAX_BET_PERCENTAGE = 0.5; // 50% of current gold

// Fallback increments when no pool is set
export const BET_INCREMENTS = {
  group_stage: [20, 50, 100],
  semifinals: [50, 125, 200],
  finals: [50, 125, 200]
};

/**
 * Calculate dynamic bet increments based on starting gold and participant count.
 * Group stage: min bet = startingGold / maxBettableMatches, so everyone can bet min on every match.
 * Semis/Finals: scaled up (2x, 2.5x, 4x of group min).
 */
export function getDynamicBetIncrements(startingGold, participantCount) {
  if (!startingGold || startingGold <= 0) return BET_INCREMENTS;

  // Estimate max bettable group matches: round-robin total minus your own matches
  // With B brackets of ~N/B players: total matches ≈ N*(N/B-1)/2, your matches ≈ N/B-1
  // Simplify: assume ~participantCount bettable matches as a safe estimate
  const bettableMatches = Math.max(3, participantCount - 1);
  const minBet = Math.max(5, roundToNice(startingGold / bettableMatches));

  return {
    group_stage: [minBet, minBet * 2, minBet * 4],
    semifinals: [minBet * 2, minBet * 4, minBet * 8],
    finals: [minBet * 2, minBet * 4, minBet * 8]
  };
}

function roundToNice(n) {
  if (n <= 10) return Math.max(5, Math.round(n / 5) * 5);
  if (n <= 50) return Math.round(n / 5) * 5;
  if (n <= 100) return Math.round(n / 10) * 10;
  return Math.round(n / 25) * 25;
}

// Prize distribution (default fixed amounts, used when no pool is set)
export const DEFAULT_PRIZES = {
  '1st': 6000,
  '2nd': 3000,
  '3rd': 2000,
  '4th': 2000,
  'participation': 500
};

// Prize pool distribution percentages
const PRIZE_PERCENTAGES = {
  '1st': 0.40,
  '2nd': 0.20,
  '3rd': 0.125,
  '4th': 0.125,
  'rest': 0.15   // split evenly among remaining participants
};

/**
 * Distribute a prize pool by placement.
 * Returns { '1st': N, '2nd': N, '3rd': N, '4th': N, 'participation': N }
 * All values are rounded integers (remainder goes to 1st place).
 */
export function distributePrizePool(pool, participantCount) {
  if (!pool || pool <= 0) return null;

  const prizes = {};
  const pct = PRIZE_PERCENTAGES;

  if (participantCount <= 2) {
    prizes['1st'] = Math.round(pool * 0.60);
    prizes['2nd'] = pool - prizes['1st'];
    return prizes;
  }
  if (participantCount <= 3) {
    prizes['1st'] = Math.round(pool * 0.50);
    prizes['2nd'] = Math.round(pool * 0.30);
    prizes['3rd'] = pool - prizes['1st'] - prizes['2nd'];
    return prizes;
  }
  if (participantCount <= 4) {
    prizes['1st'] = Math.round(pool * 0.40);
    prizes['2nd'] = Math.round(pool * 0.25);
    prizes['3rd'] = Math.round(pool * 0.175);
    prizes['4th'] = pool - prizes['1st'] - prizes['2nd'] - prizes['3rd'];
    return prizes;
  }

  // 5+ participants: standard distribution
  prizes['1st'] = Math.round(pool * pct['1st']);
  prizes['2nd'] = Math.round(pool * pct['2nd']);
  prizes['3rd'] = Math.round(pool * pct['3rd']);
  prizes['4th'] = Math.round(pool * pct['4th']);

  const topTotal = prizes['1st'] + prizes['2nd'] + prizes['3rd'] + prizes['4th'];
  const restPool = pool - topTotal;
  const restCount = participantCount - 4;
  prizes['participation'] = restCount > 0 ? Math.floor(restPool / restCount) : 0;

  return prizes;
}

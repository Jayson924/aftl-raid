// Weekly raid status from the game's per-stage counts (players.weekly_clears) and the site's manual marks.

// Map ids from the client's stage table; `allStages` raids are done only when every stage is cleared.
// A raid with a raidType can be marked by hand in its players `column` (a *_completed timestamp).
// A `manual` raid has no stages: the sync never completes it, the mark alone does.
// Tier 1 is the guild's endgame, tier 2 what follows it, tier 3 sits under "Other raids".
export const GAME_RAIDS = [
  { key: 'bdn-classic', tier: 1, name: 'Black Dragon Nest (Classic)', raidType: 'BDN Classic', column: 'bdn_classic_completed', stages: [{ id: 14501, limit: 10 }] },
  {
    key: 'bdn-memoria', tier: 1, name: 'Black Dragon Nest: Memoria', raidType: 'BDN Memoria', column: 'bdn_memoria_completed', allStages: true,
    stages: [{ id: 14511, name: 'I', limit: 10 }, { id: 14513, name: 'II', limit: 10 }, { id: 14514, name: 'III', limit: 10 }],
  },
  { key: 'bdn-hardcore', tier: 1, name: 'Black Dragon Nest (Hardcore)', raidType: 'BDN Hardcore', column: 'bdn_hardcore_completed', stages: [{ id: 14526, limit: 0 }] },
  { key: 'ddn-hardcore', tier: 1, name: 'Desert Dragon Nest (Hardcore)', raidType: 'DDN Hardcore', column: 'ddn_hardcore_completed', stages: [{ id: 17610, limit: 0 }] },
  // Once a week in play; the client's enter row carries no limit for it.
  { key: 'dragon-fellowship', tier: 2, name: 'Dragon Fellowship (Lv70)', raidType: 'Dragon Fellowship', column: 'dragon_fellowship_completed', stages: [{ id: 16330, limit: 1 }] },
  // No weekly limit and the game keeps counting runs, so only the manual mark decides.
  { key: 'abyssal-mire', tier: 2, name: 'Abyssal Mire', raidType: 'Abyssal Mire', column: 'abyssal_mire_completed', manual: true, stages: [] },
  { key: 'ddn-classic', tier: 3, name: 'Desert Dragon Nest (Classic)', raidType: 'DDN Classic', column: 'ddn_classic_completed', stages: [{ id: 14221, limit: 10 }] },
  {
    key: 'ddn-normal', tier: 3, name: 'Desert Dragon Nest: Memoria', raidType: 'DDN Normal', column: 'ddn_normal_completed', allStages: true,
    stages: [{ id: 14210, name: 'I', limit: 10 }, { id: 14211, name: 'II', limit: 10 }, { id: 14212, name: 'III', limit: 10 }, { id: 14213, name: 'IV', limit: 10 }],
  },
  { key: 'gdn-hardcore', tier: 3, name: 'Green Dragon Nest (Hardcore)', stages: [{ id: 17608, limit: 0 }] },
  // Solo mode counts against the party mode's entries.
  { key: 'guardian', tier: 3, name: 'Guardian Nest', sharedLimit: 10, stages: [{ id: 14300, name: 'Party' }, { id: 14320, name: 'Solo' }] },
  { key: 'anu-arendel', tier: 3, name: "Anu Arendel's Ordeal Nest", stages: [{ id: 14410, limit: 10 }] },
  { key: 'typhoon-kim', tier: 3, name: 'Typhoon Kim Nest', stages: [{ id: 14100, name: 'Normal', limit: 10 }, { id: 14101, name: 'Hell', limit: 10 }] },
  { key: 'professor-k', tier: 3, name: 'Professor K Nest', stages: [{ id: 14151, name: 'Normal', limit: 10 }, { id: 14161, name: 'Hell', limit: 10 }] },
  { key: 'dark-scorpion', tier: 3, name: 'Dark Scorpion Hunt', stages: [{ id: 17604, limit: 0 }] },
];

const LISTED_STAGES = new Set(GAME_RAIDS.flatMap((raid) => raid.stages.map((stage) => String(stage.id))));

// Stages the game reported that no raid above covers, as one-stage raids named by the game.
export function unlistedStageRaids(weeklyClears) {
  return Object.entries(weeklyClears || {})
    .filter(([id]) => !LISTED_STAGES.has(id))
    .map(([id, stage]) => ({ key: `stage-${id}`, tier: 3, name: String(stage?.name || `Stage ${id}`), stages: [{ id: Number(id), limit: Number(stage?.limit) || 0 }] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const RAID_BY_TYPE = Object.fromEntries(GAME_RAIDS.filter((r) => r.raidType).map((r) => [r.raidType, r]));

// players.bdn_classic_completed reaches the page as player.bdnClassicCompleted.
export const markField = (column) => column.replace(/_(\w)/g, (_, c) => c.toUpperCase());

const SEA_OFFSET_MS = 8 * 3600e3;
const RESET_HOUR_MS = 9 * 3600e3;

// The game's week turns at Saturday 09:00 SEA time (UTC+8), which is Saturday 01:00 UTC.
export function gameWeekStart(now = new Date()) {
  const sea = new Date(now.getTime() + SEA_OFFSET_MS - RESET_HOUR_MS);
  const daysSinceSaturday = (sea.getUTCDay() + 1) % 7;
  return new Date(Date.UTC(sea.getUTCFullYear(), sea.getUTCMonth(), sea.getUTCDate() - daysSinceSaturday) - SEA_OFFSET_MS + RESET_HOUR_MS);
}

export function isThisGameWeek(timestamp, now = new Date()) {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && time >= gameWeekStart(now).getTime();
}

// The synced counts when the game read them this week, else null (last week's counts or no sync).
export function weeklyClearsThisWeek(player, now = new Date()) {
  return player?.weeklyClears && isThisGameWeek(player.weeklyClearsAt, now) ? player.weeklyClears : null;
}

// One raid's numbers from this week's counts; a stage the game never listed reads as 0.
export function raidProgress(raid, weeklyClears) {
  const stages = raid.stages.map((stage) => {
    const counts = weeklyClears?.[stage.id] || {};
    return { ...stage, clears: Number(counts.clears) || 0, entries: Number(counts.entries) || 0 };
  });
  const clears = raid.allStages ? Math.min(...stages.map((s) => s.clears)) : stages.reduce((sum, s) => sum + s.clears, 0);
  const stagesCleared = stages.filter((s) => s.clears > 0).length;
  return {
    stages,
    clears,
    stagesCleared,
    entries: stages.reduce((sum, s) => sum + s.entries, 0),
    active: stages.some((s) => s.clears > 0 || s.entries > 0),
    done: raid.allStages ? stagesCleared === stages.length : stagesCleared > 0,
  };
}

// Done this week from the game, else from a manual mark; a game clear can't be undone by the mark.
export function raidStatus(player, raidType, now = new Date()) {
  const raid = RAID_BY_TYPE[raidType];
  if (!raid) return { done: false, source: null, synced: false };
  const weeklyClears = weeklyClearsThisWeek(player, now);
  if (weeklyClears && raidProgress(raid, weeklyClears).done) return { done: true, source: 'game', synced: true };
  const marked = isThisGameWeek(player?.[markField(raid.column)], now);
  return { done: marked, source: marked ? 'marked' : null, synced: !!weeklyClears };
}

// Before re-rendering raid cards: returns a function that puts each card's table scroll, and the page's, back where they were.
export function keepCardScroll(root, cardSelector, idKey) {
  const pageY = window.scrollY;
  const tops = new Map([...root.querySelectorAll(cardSelector)].map((card) => [card.dataset[idKey], card.querySelector('.game-raid-scroll')?.scrollTop || 0]));
  return () => {
    for (const card of root.querySelectorAll(cardSelector)) {
      const scroll = card.querySelector('.game-raid-scroll');
      if (scroll && tops.get(card.dataset[idKey])) scroll.scrollTop = tops.get(card.dataset[idKey]);
    }
    if (window.scrollY !== pageY) window.scrollTo(0, pageY);
  };
}

// Hand marks for any raid or stage, keyed by raid type (else raid key) and "<raid>#<stage>"; values are when marked.
export const raidMarkKey = (raid) => raid.raidType || raid.key;
export const stageMarkKey = (raid, stage) => `${raidMarkKey(raid)}#${stage.name}`;
// Raids done only when every stage is: their stages get a mark each.
export const isStagedRaid = (raid) => !!raid.allStages && raid.stages.length > 1;

// A player's marks in one map: raid_marks plus the *_completed column of each lineup and hand-mark raid.
export function playerRaidMarks(player) {
  const marks = { ...(player?.raidMarks || {}) };
  for (const raid of GAME_RAIDS) if (raid.column && player?.[markField(raid.column)]) marks[raid.raidType] = player[markField(raid.column)];
  return marks;
}

export function isMarked(marks, key, now = new Date()) {
  return isThisGameWeek(marks?.[key], now);
}

// A staged raid counts as marked when the whole raid or every stage is.
export function raidMarked(marks, raid, now = new Date()) {
  if (isMarked(marks, raidMarkKey(raid), now)) return true;
  return isStagedRaid(raid) && raid.stages.every((stage) => isMarked(marks, stageMarkKey(raid, stage), now));
}

const STAGE_RAID_KEY = /^stage-\d+$/;

// marks after checking or unchecking one key, or null for an unknown key; `stageRaids` also allows synced "stage-<id>" raids.
// A staged raid's own key sets or clears every stage; ticking its last stage marks the whole raid too.
export function applyRaidMark(marks, key, done, { at = new Date().toISOString(), now = new Date(), stageRaids = false } = {}) {
  const next = { ...(marks || {}) };
  const raid = GAME_RAIDS.find((r) => raidMarkKey(r) === key || (isStagedRaid(r) && r.stages.some((s) => stageMarkKey(r, s) === key)));
  if (!raid) {
    if (!stageRaids || !STAGE_RAID_KEY.test(key)) return null;
    if (done) next[key] = at;
    else delete next[key];
    return next;
  }
  const whole = raidMarkKey(raid);
  if (!isStagedRaid(raid)) {
    if (done) next[whole] = at;
    else delete next[whole];
    return next;
  }
  const stageKeys = raid.stages.map((s) => stageMarkKey(raid, s));
  // A whole-raid mark from this week stands for every stage before one of them changes.
  if (isMarked(next, whole, now)) for (const k of stageKeys) if (!isMarked(next, k, now)) next[k] = next[whole];
  for (const k of key === whole ? stageKeys : [key]) {
    if (done) next[k] = at;
    else delete next[k];
  }
  if (stageKeys.every((k) => isMarked(next, k, now))) next[whole] = at;
  else delete next[whole];
  return next;
}

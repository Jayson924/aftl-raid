// Weekly raid status from the game's per-stage counts (players.weekly_clears) and the site's manual marks.

// Map ids from the client's stage table; `allStages` raids are done only when every stage is cleared.
// A raid with a raidType can be marked by hand in its players `column` (a *_completed timestamp).
// Tier 1 is the guild's endgame, tier 2 what follows it, tier 3 sits under "Older raids".
export const GAME_RAIDS = [
  { key: 'bdn-classic', tier: 1, name: 'Black Dragon Nest (Classic)', raidType: 'BDN Classic', column: 'bdn_classic_completed', stages: [{ id: 14501, limit: 10 }] },
  {
    key: 'bdn-memoria', tier: 1, name: 'Black Dragon Nest: Memoria', raidType: 'BDN Memoria', column: 'bdn_memoria_completed', allStages: true,
    stages: [{ id: 14511, name: 'I', limit: 10 }, { id: 14513, name: 'II', limit: 10 }, { id: 14514, name: 'III', limit: 10 }],
  },
  { key: 'bdn-hardcore', tier: 1, name: 'Black Dragon Nest (Hardcore)', raidType: 'BDN Hardcore', column: 'bdn_hardcore_completed', stages: [{ id: 14526, limit: 0 }] },
  { key: 'ddn-hardcore', tier: 1, name: 'Desert Dragon Nest (Hardcore)', raidType: 'DDN Hardcore', column: 'ddn_hardcore_completed', stages: [{ id: 17610, limit: 0 }] },
  // Stage ids from the client table, unconfirmed until a synced login lists them.
  {
    key: 'abyssal-mire', tier: 2, name: 'Abyssal Mire', raidType: 'Abyssal Mire', column: 'abyssal_mire_completed',
    stages: [
      { id: 17613, name: 'Desolate Isle', limit: 0 }, { id: 17614, name: 'Abandoned Village', limit: 0 },
      { id: 17617, name: 'Pirate Ship', limit: 0 }, { id: 17620, name: 'Ghost Town', limit: 0 },
      { id: 17623, name: 'Valley', limit: 0 }, { id: 17624, name: 'Mutant Habitat', limit: 0 },
      { id: 17625, name: 'Ghost Town (second)', limit: 0 },
    ],
  },
  { key: 'dragon-fellowship', tier: 2, name: 'Dragon Fellowship (Lv70)', raidType: 'Dragon Fellowship', column: 'dragon_fellowship_completed', stages: [{ id: 16330, limit: 0 }] },
  { key: 'ddn-classic', tier: 3, name: 'Desert Dragon Nest (Classic)', raidType: 'DDN Classic', column: 'ddn_classic_completed', stages: [{ id: 14221, limit: 10 }] },
  {
    key: 'ddn-normal', tier: 3, name: 'Desert Dragon Nest (Normal)', raidType: 'DDN Normal', column: 'ddn_normal_completed', allStages: true,
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

// The game's week turns at Saturday 00:00 SEA time (UTC+8), which is Friday 16:00 UTC.
export function gameWeekStart(now = new Date()) {
  const sea = new Date(now.getTime() + SEA_OFFSET_MS);
  const daysSinceSaturday = (sea.getUTCDay() + 1) % 7;
  return new Date(Date.UTC(sea.getUTCFullYear(), sea.getUTCMonth(), sea.getUTCDate() - daysSinceSaturday) - SEA_OFFSET_MS);
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

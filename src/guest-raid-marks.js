// A guest character's week: every game raid marked by hand (stage by stage where a raid needs every stage) and their own raids with clear counters.
import { GAME_RAIDS, isThisGameWeek, raidMarkKey, stageMarkKey, isStagedRaid, isMarked, raidMarked, applyRaidMark } from './raid-clears.js';

export const MAX_CUSTOM_RAIDS = 20;
export const MAX_CUSTOM_CLEARS = 99;

// Every game raid with this week's hand marks; raids that need every stage list their stages.
export function guestRaidList(character, now = new Date()) {
  const marks = character?.marks || {};
  return GAME_RAIDS.map((raid) => ({
    key: raidMarkKey(raid),
    name: raid.name,
    tier: raid.tier,
    done: raidMarked(marks, raid, now),
    stages: isStagedRaid(raid)
      ? raid.stages.map((stage) => ({ key: stageMarkKey(raid, stage), name: stage.name, done: raidMarked(marks, raid, now) || isMarked(marks, stageMarkKey(raid, stage), now) }))
      : null,
  }));
}

// The guest's own raids; clears from before the weekly reset read as 0.
export function guestCustomRaids(character, now = new Date()) {
  return (character?.custom_raids || []).map((raid) => {
    const maxClears = Math.max(1, Number(raid.max_clears) || 1);
    const clears = isThisGameWeek(raid.clears_at, now) ? Math.min(Number(raid.clears) || 0, maxClears) : 0;
    return { id: raid.id, name: raid.name, maxClears, clears, done: clears >= maxClears };
  });
}

export function guestRaidTally(character, now = new Date()) {
  const all = [...guestRaidList(character, now), ...guestCustomRaids(character, now)];
  const done = all.filter((r) => r.done);
  return { done: done.length, total: all.length, doneNames: done.map((r) => r.name) };
}

export function applyGuestMark(character, key, done, at = new Date().toISOString()) {
  return applyRaidMark(character.marks, key, done, { at });
}

// custom_raids after one counter step, or null when the raid is missing or the step would leave 0..max.
export function stepGuestCustomRaid(character, raidId, delta, now = new Date()) {
  const current = guestCustomRaids(character, now).find((r) => r.id === raidId);
  if (!current) return null;
  const clears = current.clears + (delta > 0 ? 1 : -1);
  if (clears < 0 || clears > current.maxClears) return null;
  return character.custom_raids.map((r) => (r.id === raidId ? { ...r, clears, clears_at: now.toISOString() } : r));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_RAIDS, gameWeekStart, raidProgress, raidStatus, RAID_BY_TYPE, unlistedStageRaids, weeklyClearsThisWeek } from '../src/raid-clears.js';

test('the game week starts Saturday 09:00 SEA time, Saturday 01:00 UTC', () => {
  assert.equal(gameWeekStart(new Date('2026-10-22T03:00:00Z')).toISOString(), '2026-10-17T01:00:00.000Z');
  assert.equal(gameWeekStart(new Date('2026-10-23T16:30:00Z')).toISOString(), '2026-10-17T01:00:00.000Z');
  assert.equal(gameWeekStart(new Date('2026-10-24T00:59:00Z')).toISOString(), '2026-10-17T01:00:00.000Z');
  assert.equal(gameWeekStart(new Date('2026-10-24T01:00:00Z')).toISOString(), '2026-10-24T01:00:00.000Z');
  assert.equal(gameWeekStart(new Date('2026-10-30T23:00:00Z')).toISOString(), '2026-10-24T01:00:00.000Z');
});

test('multi-stage raids are done when every stage is cleared; alternatives when any is', () => {
  const ddn = RAID_BY_TYPE['DDN Normal'];
  const partial = raidProgress(ddn, { 14210: { clears: 1, entries: 1 }, 14211: { clears: 1, entries: 2 } });
  assert.deepEqual([partial.done, partial.clears, partial.stagesCleared, partial.entries], [false, 0, 2, 3]);
  const full = raidProgress(ddn, { 14210: { clears: 1 }, 14211: { clears: 1 }, 14212: { clears: 2 }, 14213: { clears: 1 } });
  assert.deepEqual([full.done, full.clears], [true, 1]);
  assert.equal(raidProgress(ddn, null).active, false);
});

test('a game clear beats the manual mark; a mark covers a raid the sync has no clear for', () => {
  const now = new Date('2026-10-22T03:00:00Z');
  const synced = { weeklyClears: { 14501: { clears: 1, entries: 2, limit: 10 } }, weeklyClearsAt: '2026-10-21T12:00:00Z' };
  assert.deepEqual(raidStatus(synced, 'BDN Classic', now), { done: true, source: 'game', synced: true });
  assert.deepEqual(raidStatus(synced, 'DDN Classic', now), { done: false, source: null, synced: true });
  const marked = { ...synced, ddnClassicCompleted: '2026-10-20T10:00:00Z' };
  assert.deepEqual(raidStatus(marked, 'DDN Classic', now), { done: true, source: 'marked', synced: true });
  assert.equal(raidStatus({ ddnClassicCompleted: '2026-10-16T15:00:00Z' }, 'DDN Classic', now).done, false);
  assert.equal(raidStatus(synced, 'Unspecified', now).done, false);
});

test('counts read before the game reset are last week\'s', () => {
  const player = { weeklyClears: { 14501: { clears: 1 } }, weeklyClearsAt: '2026-10-24T00:00:00Z' };
  assert.ok(weeklyClearsThisWeek(player, new Date('2026-10-24T00:30:00Z')));
  assert.equal(weeklyClearsThisWeek(player, new Date('2026-10-24T01:30:00Z')), null);
  assert.equal(raidStatus(player, 'BDN Classic', new Date('2026-10-24T01:30:00Z')).done, false);
});

test('stages outside the raid table come back as their own other raids', () => {
  const weeklyClears = { 14501: { name: 'Black Dragon Nest (Classic)', clears: 1 }, 14171: { name: 'Sea Dragon Nest (Classic Mode)', clears: 0, limit: 0 }, 14093: { name: 'Green Dragon Nest (Classic Mode)', clears: 1, limit: 10 } };
  const extra = unlistedStageRaids(weeklyClears);
  assert.deepEqual(extra.map((raid) => [raid.name, raid.tier, raid.stages[0].id, raid.stages[0].limit]), [
    ['Green Dragon Nest (Classic Mode)', 3, 14093, 10],
    ['Sea Dragon Nest (Classic Mode)', 3, 14171, 0],
  ]);
  assert.equal(raidProgress(extra[0], weeklyClears).done, true);
  assert.deepEqual(GAME_RAIDS.filter((raid) => raid.tier < 3).map((raid) => raid.key),
    ['bdn-classic', 'bdn-memoria', 'bdn-hardcore', 'ddn-hardcore', 'dragon-fellowship', 'abyssal-mire']);
});

test('the hand-marked raids follow the same precedence as the lineup ones', () => {
  const now = new Date('2026-10-22T03:00:00Z');
  const player = { abyssalMireCompleted: '2026-10-20T10:00:00Z', weeklyClears: { 14526: { clears: 1 } }, weeklyClearsAt: '2026-10-21T12:00:00Z', bdnHardcoreCompleted: '2026-10-20T10:00:00Z' };
  assert.deepEqual(raidStatus(player, 'Abyssal Mire', now), { done: true, source: 'marked', synced: true });
  // Abyssal Mire has no limit and the game keeps counting, so a synced run never marks it done.
  const ran = { weeklyClears: { 17613: { clears: 2, entries: 2 } }, weeklyClearsAt: '2026-10-21T12:00:00Z' };
  assert.deepEqual(raidStatus(ran, 'Abyssal Mire', now), { done: false, source: null, synced: true });
  assert.deepEqual(raidStatus(player, 'BDN Hardcore', now), { done: true, source: 'game', synced: true });
  assert.equal(raidStatus(player, 'Dragon Fellowship', now).done, false);
  assert.equal(raidStatus(player, 'BDN Memoria', now).done, false);
});

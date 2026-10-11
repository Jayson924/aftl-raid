import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { panelStats, syncedLabel } from '../../src/sim/panel.js';

const golden = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

test('a synced panel yields the roster numbers', () => {
  const g = golden.builds[0];
  const stats = panelStats({ rows: g.rows, summary: g.summary });
  const byLabel = Object.fromEntries(stats.map((s) => [s.label, s.value]));
  assert.equal(byLabel.ATK, '9,531');
  assert.equal(byLabel.MATK, '22,227');
  assert.equal(byLabel.FD, '2,373 (34.3%)');
  assert.equal(byLabel.Crit, '87.3%');
  assert.equal(byLabel.HP, '213,517');
  assert.ok(byLabel.Def && byLabel.MDef);
  assert.deepEqual(panelStats(null), []);
  assert.deepEqual(panelStats({ summary: {} }), []);
});

test('the synced label names the day', () => {
  assert.equal(syncedLabel(null), '');
  assert.match(syncedLabel('2026-10-11T03:00:00Z'), /^Synced from the meter on \w+ \d+$/);
  assert.equal(syncedLabel('nonsense'), 'Synced from the meter');
});

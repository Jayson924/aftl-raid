// The JS calculator against golden.json, written by the toolbox's sea/tools/dump_sim_golden.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCalculator, finalPercent, defensePercent, NONE } from '../../netlify/lib/sim/calc.js';

const dataDir = new URL('../../netlify/data/sim/', import.meta.url);
const TABLE_NAMES = ['equipment', 'jewelry', 'sets', 'potentials', 'heraldry', 'cards', 'talismans', 'runes',
  'engraving', 'costumes', 'titles', 'collection', 'mastery', 'class_base', 'job_map', 'effective_panel',
  'attribute_order', 'conversion', 'lists', 'defaults', 'buffs'];
const tables = Object.fromEntries(TABLE_NAMES.map((n) => [n, JSON.parse(fs.readFileSync(new URL(`${n}.json`, dataDir), 'utf8'))]));
const golden = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const calc = createCalculator(tables);

const COLUMNS = ['base', 'equipment', 'card', 'talisman', 'glyph', 'normal_rune', 'core_mastery', 'actual', 'converted'];
const BUFF_COLUMNS = ['buffed', 'percent'];

function close(got, want, label) {
  if (typeof want !== 'number') { assert.deepEqual(got, want, label); return; }
  assert.equal(typeof got, 'number', `${label}: got ${got}`);
  assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${label}: ${got} vs ${want}`);
}

const hasSkillBuffs = (build) => (build.buffs || []).some((b) => b && b.skill && b.skill !== NONE);

for (const g of golden.builds) {
  test(g.label, () => {
    const { rows, summary } = calc.calculate(g.build);
    const byAttr = new Map(rows.map((r) => [r.attr, r]));
    assert.deepEqual(rows.slice(0, golden.attribute_order.length).map((r) => r.attr), golden.attribute_order);
    assert.deepEqual([...byAttr.keys()].sort(), g.rows.map((r) => r.attr).sort());
    const checkBuffs = true;
    for (const want of g.rows) {
      const got = byAttr.get(want.attr);
      for (const col of COLUMNS) close(got[col], want[col], `${want.attr}.${col}`);
      if (checkBuffs) for (const col of BUFF_COLUMNS) close(got[col], want[col], `${want.attr}.${col}`);
    }
    if (checkBuffs) {
      assert.deepEqual(Object.keys(summary), Object.keys(g.summary));
      for (const [key, want] of Object.entries(g.summary)) close(summary[key], want, `summary.${key}`);
    }
    const preview = calc.coreRunePreview(g.build);
    assert.deepEqual(Object.keys(preview), Object.keys(g.core_rune_preview));
    for (const [key, want] of Object.entries(g.core_rune_preview)) close(preview[key], want, `preview.${key}`);
  });
}

test('the golden set covers builds with and without skill buffs', () => {
  assert.ok(golden.builds.filter((g) => !hasSkillBuffs(g.build)).length >= 2);
  assert.ok(golden.builds.filter((g) => hasSkillBuffs(g.build)).length >= 2);
});

test('final damage percent curve', () => {
  for (const [value, want] of golden.final_percent) close(finalPercent(value), want, `final ${value}`);
});

test('defense percent curve', () => {
  for (const [value, want] of golden.defense_percent) close(defensePercent(value), want, `defense ${value}`);
});

test('per-item helpers add up to the equipment column', () => {
  const build = golden.builds[2].build;
  const bucket = {};
  const add = (stats) => { for (const [k, v] of Object.entries(stats)) bucket[k] = (bucket[k] ?? 0) + v; };
  for (const item of build.equipment) add(calc.equipmentAttrs(item, build.first_job, build.second_job));
  for (const item of build.jewelry) add(calc.jewelryAttrs(item));
  add(calc.equipmentSetBonusAttrs(build.equipment, build.first_job, build.second_job));
  add(calc.jewelrySetBonusAttrs(build.jewelry));
  const row = golden.builds[2].rows.find((r) => r.attr === 'PATK max');
  close(bucket['PATK max'], row.equipment, 'PATK max');
  const breakdown = calc.setBonusBreakdown(build.equipment, build.jewelry, build.first_job, build.second_job);
  assert.ok(breakdown.some((s) => s.scope === 'equipment' && s.count === 7));
});

test('a buff named without a key is the passive, not a self buff of the same name', () => {
  const build = { ...tables.defaults.build1, first_job: 'Bringer', second_job: 'Abyss Walker' };
  const buffed = (buffs) => new Map(calc.calculate({ ...build, buffs }).rows.map((r) => [r.attr, r.buffed]));
  const none = buffed([]);
  const named = buffed([{ skill: 'Increased Abyss Chakra', level: 1 }]);
  assert.equal(named.get('Dark attack %'), (none.get('Dark attack %') || 0) + 10);
  assert.equal(named.get('PATK min'), none.get('PATK min'));
  const self = buffed([{ key: 'Self buff|Abyss Walker|Increased Abyss Chakra', skill: 'Increased Abyss Chakra', level: 1 }]);
  assert.ok(self.get('PATK min') > none.get('PATK min'));
});

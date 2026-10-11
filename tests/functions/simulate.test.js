// The simulate function on the golden builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handler } from '../../netlify/functions/simulate.js';

const golden = JSON.parse(fs.readFileSync(new URL('../sim/golden.json', import.meta.url), 'utf8'));
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const parse = (res) => ({ status: res.statusCode, ...JSON.parse(res.body) });
const COLUMNS = ['base', 'equipment', 'card', 'talisman', 'glyph', 'normal_rune', 'core_mastery', 'actual', 'converted'];
const close = (got, want, label) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${label}: ${got} vs ${want}`);
const hasSkillBuffs = (build) => (build.buffs || []).some((b) => b && b.skill && b.skill !== 'None');

async function answers(builds) {
  const results = {};
  for (let i = 0; i < builds.length; i += 4) {
    const chunk = Object.fromEntries(builds.slice(i, i + 4).map((build, j) => [`b${i + j}`, build]));
    const res = parse(await handler(post({ builds: chunk })));
    assert.equal(res.status, 200, res.error);
    Object.assign(results, res.results);
  }
  return builds.map((_, i) => results[`b${i}`]);
}

test('refuses anything but a POST with one to four builds', async () => {
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal(parse(await handler(post('{nope'))).status, 400);
  assert.equal(parse(await handler(post({}))).status, 400);
  assert.equal(parse(await handler(post({ builds: {} }))).status, 400);
  assert.equal(parse(await handler(post({ builds: { a: 1 } }))).status, 400);
  assert.equal(parse(await handler(post({ builds: { a: {}, b: {}, c: {}, d: {}, e: {} } }))).status, 400);
  assert.equal(parse(await handler({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(300 * 1024) })).status, 413);
});

test('rate limits one address', async () => {
  const headers = { 'x-nf-client-connection-ip': '10.0.0.9' };
  let last;
  for (let i = 0; i < 121; i += 1) last = parse(await handler(post('{nope', headers)));
  assert.equal(last.status, 429);
  assert.equal(parse(await handler(post('{nope', { 'x-nf-client-connection-ip': '10.0.0.10' }))).status, 400);
});

test('answers the golden builds with the calculator rows', async () => {
  const results = await answers(golden.builds.map((g) => g.build));
  golden.builds.forEach((g, i) => {
    const result = results[i];
    const byAttr = new Map(result.rows.map((r) => [r.attr, r]));
    assert.deepEqual([...byAttr.keys()].sort(), g.rows.map((r) => r.attr).sort());
    for (const want of g.rows) for (const col of COLUMNS) close(byAttr.get(want.attr)[col], want[col], `${g.label} ${want.attr}.${col}`);
    if (!hasSkillBuffs(g.build)) for (const [key, want] of Object.entries(g.summary)) close(result.summary[key], want, `${g.label} summary.${key}`);
    assert.deepEqual(Object.keys(result.preview), Object.keys(g.core_rune_preview));
  });
});

test('per-item answers add up to the equipment column', async () => {
  const g = golden.builds[2];
  const [result] = await answers([g.build]);
  const { items } = result;
  assert.equal(items.equipment.length, g.build.equipment.length);
  assert.equal(items.jewelry.length, g.build.jewelry.length);
  let total = 0;
  for (const attrs of [...items.equipment, ...items.jewelry]) total += attrs['PATK max'] || 0;
  for (const s of items.sets) total += s.attributes['PATK max'] || 0;
  close(total, g.rows.find((r) => r.attr === 'PATK max').equipment, 'PATK max');
  assert.ok(items.sets.some((s) => s.scope === 'equipment' && s.count === 7 && s.tiers.length));
  assert.ok(Object.keys(items.cards).length > 0);
  assert.equal(Object.keys(items.mastery).length, g.build.mastery.length);
  assert.ok(Object.keys(items.collection).length === 1);
});

test('mastery gains and rank previews come with the answer', async () => {
  const withMastery = golden.builds.find((g) => Object.values(g.build.card_bonus_levels || {}).some(Number));
  const withGlyphS = golden.builds.find((g) => (g.build.glyph_s || []).some((s) => s.name && s.name !== 'None' && s.base_attr1 && s.base_attr1 !== 'None'));
  const [m, s] = await answers([withMastery.build, withGlyphS.build]);
  const attr = Object.entries(withMastery.build.card_bonus_levels).find(([, level]) => Number(level))[0];
  assert.ok(Object.keys(m.items.mastery_gain[attr]).length > 0, `no mastery gain for ${attr}`);
  const index = withGlyphS.build.glyph_s.findIndex((g) => g.name && g.name !== 'None' && g.base_attr1 && g.base_attr1 !== 'None');
  assert.ok(Object.keys(s.items.glyph_s_ranks[index][1]).length > 0, 'no rank preview for the first fellowship stat');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculatePowerScore, powerScore, getPowerTier, POWER_REFERENCES, simJobOf, powerGaps } from '../src/constants.js';

const jobMap = JSON.parse(readFileSync(new URL('../netlify/data/sim/job_map.json', import.meta.url), 'utf8'));
const panels = JSON.parse(readFileSync(new URL('../netlify/data/sim/effective_panel.json', import.meta.url), 'utf8'));

test('every simulator class has a reference power', () => {
  for (const job of Object.keys(panels).filter((j) => jobMap[j])) {
    const ref = POWER_REFERENCES.classes[job];
    assert.ok(ref, `${job} missing`);
    assert.ok(ref.power > 50000 && ref.power < 300000, `${job} power ${ref.power}`);
    assert.equal(ref.notes.length, 0, `${job}: ${ref.notes.join('; ')}`);
  }
});

test('a synced character scores against its class reference', () => {
  const player = { role: 'Saleana', panel: { summary: { effective_panel: POWER_REFERENCES.classes.Saleana.power / 2 } } };
  assert.deepEqual(calculatePowerScore(player).source, 'power');
  assert.equal(powerScore(player), 50);
  assert.equal(getPowerTier(50).label, 'S');
});

test('site class names map to simulator jobs', () => {
  assert.equal(simJobOf({ role: 'Moon Lord' }), 'Moonlord');
  assert.equal(simJobOf({ role: 'Moon Lord', build: { second_job: 'Gladiator' } }), 'Gladiator');
  assert.ok(POWER_REFERENCES.classes[simJobOf({ role: 'Moon Lord' })]);
});

test('a character without a panel is estimated from sheet attack and FD', () => {
  const ref = POWER_REFERENCES.classes.Saint;
  const player = { role: 'Saint', characterStats: { magicAttack: ref.attack / 2, attackPower: 1000, finalDamage: 0 } };
  const { source, score } = calculatePowerScore(player);
  assert.equal(source, 'stats');
  assert.equal(score, Math.round(0.8 * 50 / (1 + ref.finalPercent / 100)));
  assert.equal(calculatePowerScore({ role: 'Saint' }).source, 'none');
});

test('the gap breakdown compares each component with the reference', () => {
  const ref = POWER_REFERENCES.classes.Saleana;
  const player = { role: 'Saleana', panel: { summary: { effective_panel: 1, physical_average: 100, magic_average: ref.attack / 2, final_percent: ref.finalPercent, crit_percent: 45, crit_damage_percent: 0 } } };
  const gaps = powerGaps(player);
  assert.deepEqual(gaps.map((g) => g.label), ['Attack', 'Final damage', 'Crit', 'Crit damage']);
  assert.equal(gaps[0].share, 0.5);
  assert.equal(gaps[1].share, 1);
  assert.equal(powerGaps({ role: 'Saleana' }).length, 0);
});

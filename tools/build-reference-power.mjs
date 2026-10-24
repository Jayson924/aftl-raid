// Per-class maxed reference builds and their power level, for the site's power score.
// Usage: node tools/build-reference-power.mjs [--verbose]   -> src/data/reference-power.json + reference-builds.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTables } from '../netlify/lib/sim/tables.js';
import { createCalculator, NONE } from '../netlify/lib/sim/calc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/reference-power.json');
const BUILDS_OUT = path.join(ROOT, 'src/data/reference-builds.json');
const VERBOSE = process.argv.includes('--verbose');

const tables = loadTables();
const calc = createCalculator(tables);
const options = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/sim/options.json'), 'utf8'));
const rng = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/sim-rng.json'), 'utf8'));
const L = options.lists;

// Choices the tables cannot settle; every synced character runs a Lv60 Smelted Rune at +10.
export const ASSUMPTIONS = {
  gear: 'Lv70 Legend, max enhancement, best suffix and potential roll',
  accessories: 'Lv70 Legend, best stat variant and potential roll',
  cards: 'every card Legend, card mastery level 25',
  mastery: 'Power of Mastery level 10, collection level 42',
  costumes: 'Lv70 costume tiers, best costume accessories, Legend engravings at the top roll',
  heraldry: '11 Lv70 enhancement plates with the best extra, 4 Lv70 fellowship plates at the best tier 3 roll',
  runes: 'two Lv70 Legend attack runes at rank 5, Lv60 Smelted Rune at the top ratio and coefficient, +10',
  buffs: 'own passives at max level; no self, party or guild buffs, as in a synced panel',
  boss: 'crit resist 19000',
};

const EQUIPMENT_SLOTS = ['Helmet', 'Upper', 'Lower', 'Gloves', 'Shoes', 'Main weapon', 'Secondary weapon'];
const JEWELRY_SLOTS = ['Necklace', 'Earring', 'Ring 1', 'Ring 2'];
const JEWELRY_NOUN = { Necklace: 'Necklace', Earring: 'Earrings', 'Ring 1': 'Ring', 'Ring 2': 'Ring' };
const RUNE_LEVEL = '70';
const CORE = { level: '60', ratio: '20', coeff: '0.5', enhance: 10 };
const CRIT_RESIST = 19000;
const MAX_POTENTIAL_LINES = 6;
const DAMAGE_RUNE_ATTRS = ['STR', 'AGI', 'INT', 'PATK', 'MATK', 'Crit', 'Final damage', 'Crit damage'];

const number = (text) => { const m = String(text ?? '').match(/-?\d+(?:\.\d+)?/g); return m ? Number(m.at(-1)) : 0; };
const last = (list) => (list && list.length ? list[list.length - 1] : NONE);

function power(build) {
  return calc.calculate(build, { summaryOnly: true }).summary.effective_panel || 0;
}

// Tries `apply(candidate)` on a copy for each candidate and keeps the best on the real build.
function pickBest(build, candidates, apply) {
  let best = null; let bestPower = -1;
  for (const candidate of candidates) {
    const trial = structuredClone(build);
    apply(trial, candidate);
    const p = power(trial);
    if (p > bestPower) { bestPower = p; best = candidate; }
  }
  if (best !== null) apply(build, best);
  return best;
}

function jobsOf(secondJob) {
  const info = tables.job_map[secondJob];
  return [secondJob, info.first_job, info.base_class];
}

function equipmentEntry(jobs, name) {
  for (const job of jobs) if (tables.equipment[job]?.[name]) return { job, entry: tables.equipment[job][name] };
  return null;
}

function legendCandidates(jobs, slot) {
  const names = new Set();
  for (const job of jobs) {
    for (const [name, meta] of Object.entries(options.gear[job] || {})) {
      if (meta.level === 'Lv70 Legend' && String(tables.equipment[job]?.[name]?.slot || '').startsWith(slot)) names.add(name);
    }
  }
  return [...names];
}

function potentialRolls(rarity, noun) {
  const pool = rng.potentials.find((p) => p.rarity.includes(rarity) && p.items.some((i) => i.toLowerCase() === noun.toLowerCase()));
  // Rolls above six lines exist but are near-impossible; the simulator caps at six too.
  return pool ? pool.rolls.filter((r) => r.keys.length <= MAX_POTENTIAL_LINES).map((r) => r.keys) : [];
}

function baseBuild(secondJob) {
  const [, firstJob] = jobsOf(secondJob);
  const buffs = [];
  for (const key of L.buffs[secondJob] || []) {
    const row = tables.buffs[key];
    if (!row || row.category !== 'Passive') continue;
    buffs.push({ key, skill: row.skill, level: row.max_level });
  }
  return {
    first_job: firstJob,
    second_job: secondJob,
    crit_resist_value: CRIT_RESIST,
    equipment: EQUIPMENT_SLOTS.map((slot) => ({ slot, name: NONE, suffix: NONE, enhance: 0, enchants: [] })),
    jewelry: JEWELRY_SLOTS.map((slot) => ({ slot, name: NONE, variant: NONE, enchants: [] })),
    engravings: [],
    glyph_a: [],
    glyph_s: [],
    normal_runes: [],
    core_rune: { level: NONE, conversion: NONE, ratio_rank: NONE, coeff_rank: NONE, enhance: 0 },
    talismans: [],
    mastery: L.mastery.map((name) => ({ name, level: L.limits.mastery_level[1] })),
    title: NONE,
    fashion: Object.keys(L.fashion).map((slot) => ({ slot, name: NONE })),
    buffs,
    card_grades: options.cards.names.map((name) => ({ name, grade: 'L' })),
    card_bonus_levels: Object.fromEntries(Object.keys(options.defaults.build1.card_bonus_levels).map((attr) => [attr, L.limits.card_bonus_level[1]])),
    collection_level: L.limits.collection_level[1],
  };
}

function chooseEquipment(build, jobs, log) {
  for (const item of build.equipment) {
    const names = legendCandidates(jobs, item.slot);
    if (!names.length) { log.push(`no Lv70 Legend ${item.slot}`); continue; }
    item.name = names[0];
    item.enhance = Math.max(...Object.keys(equipmentEntry(jobs, item.name).entry.enhance || { 0: 0 }).map(Number));
  }
  for (const item of build.equipment) {
    const names = legendCandidates(jobs, item.slot);
    if (names.length > 1) pickBest(build, names, (b, name) => { b.equipment.find((e) => e.slot === item.slot).name = name; });
  }
  for (const item of build.equipment) {
    const found = equipmentEntry(jobs, item.name);
    if (!found) continue;
    const suffixes = Object.keys(found.entry.suffix || {});
    if (suffixes.length) pickBest(build, suffixes, (b, suffix) => { b.equipment.find((e) => e.slot === item.slot).suffix = suffix; });
    const rolls = potentialRolls('legend', item.name.split(' ').at(-1));
    if (rolls.length) pickBest(build, rolls, (b, keys) => { b.equipment.find((e) => e.slot === item.slot).enchants = [...keys]; });
    else log.push(`no potential pool for ${item.name}`);
  }
}

function chooseJewelry(build, log) {
  for (const item of build.jewelry) {
    const lookup = item.slot.startsWith('Ring') ? 'Ring' : item.slot;
    const names = Object.entries(options.accessories[lookup] || {}).filter(([, m]) => m.level === 'Lv70 Legend').map(([n]) => n);
    if (!names.length) { log.push(`no Lv70 Legend ${item.slot}`); continue; }
    item.name = names[0];
    const variants = Object.values(tables.jewelry.variant_labels);
    pickBest(build, names.length > 1 ? names : [names[0]], (b, name) => { b.jewelry.find((j) => j.slot === item.slot).name = name; });
    pickBest(build, variants, (b, variant) => { b.jewelry.find((j) => j.slot === item.slot).variant = variant; });
    const rolls = potentialRolls('legend', JEWELRY_NOUN[item.slot]);
    if (rolls.length) pickBest(build, rolls, (b, keys) => { b.jewelry.find((j) => j.slot === item.slot).enchants = [...keys]; });
  }
}

function chooseCostumes(build) {
  for (const piece of build.fashion) {
    const choices = (L.fashion[piece.slot] || []).filter((n) => n !== NONE);
    const lv70 = choices.filter((n) => n.includes('(Lv70)'));
    pickBest(build, lv70.length ? lv70 : choices, (b, name) => { b.fashion.find((f) => f.slot === piece.slot).name = name; });
  }
}

const engravingKind = (slot) => (['Helmet', 'Upper', 'Lower', 'Gloves', 'Shoes'].includes(slot) ? 'Armor DEF/MDEF'
  : ['Main weapon', 'Secondary weapon'].includes(slot) ? 'Weapon PATK/MATK'
    : ['Necklace', 'Earring', 'Ring 1', 'Ring 2'].includes(slot) ? 'Accessory HP' : '3-piece Crit');

function chooseEngravings(build) {
  const E = L.engraving;
  build.engravings = E.slots.map((slot) => {
    const kind = engravingKind(slot);
    const main = last(E.main_values[`${kind}|L`]);
    const secondary = last(E.secondary_values[`${kind}|L`]);
    return { slot, grade: 'L', value_rank: main, main_value: number(main), secondary_value: number(secondary), extra: NONE, extra_tier: NONE, extra_value: 0 };
  });
  const extras = E.extras.filter((e) => e !== NONE);
  const topValue = (extra) => number(last(E.extra_ranks[extra]));
  // Extras are additive, so the best one is the same on every slot.
  const best = pickBest(build, extras, (b, extra) => { for (const item of b.engravings) Object.assign(item, { extra, extra_tier: 'high', extra_value: topValue(extra) }); });
  return best;
}

function chooseEnhancementPlates(build) {
  const level = 'Lv70';
  const plates = Object.keys(tables.heraldry.a[level] || {});
  const extras = L.glyph_a.extras.filter((e) => e !== NONE);
  const blocked = (plate, extra) => (options.glyph_a_blocked?.[plate] || []).includes(extra);
  const ranked = [...extras];
  const probe = structuredClone(build);
  probe.glyph_a = [{ level, name: plates[0], extra: NONE }];
  const extraPower = Object.fromEntries(ranked.map((extra) => { const t = structuredClone(probe); t.glyph_a[0].extra = extra; return [extra, power(t)]; }));
  ranked.sort((a, b) => extraPower[b] - extraPower[a]);
  const extraFor = (plate) => ranked.find((e) => !blocked(plate, e)) || NONE;
  build.glyph_a = [];
  for (let i = 0; i < 11; i += 1) {
    const worn = new Set(build.glyph_a.map((g) => g.name));
    const left = plates.filter((p) => !worn.has(p));
    if (!left.length) break;
    pickBest(build, left, (b, plate) => { b.glyph_a[i] = { level, name: plate, extra: extraFor(plate) }; });
  }
}

function chooseFellowshipPlates(build) {
  const level = 'Lv70';
  build.glyph_s = [];
  const byPlate = new Map();
  for (const variant of rng.fellowship.filter((v) => v.level === level)) {
    const list = byPlate.get(variant.plate) || [];
    for (const set of variant.sets) list.push({ variant, set });
    byPlate.set(variant.plate, list);
  }
  let i = 0;
  for (const [plate, choices] of byPlate) {
    if (i >= 4) break;
    pickBest(build, choices, (b, { variant, set }) => {
      const main = set.lines.slice(0, set.ranks.length).map(([stat]) => stat);
      const item = { level, name: plate, focus: variant.focus, extra: set.lines[set.ranks.length]?.[0] ?? NONE };
      for (let n = 1; n <= 4; n += 1) Object.assign(item, { [`base_attr${n}`]: main[n - 1] ?? NONE, [`rank${n}`]: set.ranks[n - 1] ?? NONE });
      b.glyph_s[i] = item;
    });
    i += 1;
  }
}

// A Legend rune has six lines and any stat on at most two, so an attack rune is three stats doubled.
function chooseRunes(build) {
  const rank = last(L.runes.ranks);
  const attrs = DAMAGE_RUNE_ATTRS.filter((a) => tables.runes.normal[RUNE_LEVEL]?.Attack?.[a]);
  const combos = [];
  for (let a = 0; a < attrs.length; a += 1) for (let b = a + 1; b < attrs.length; b += 1) for (let c = b + 1; c < attrs.length; c += 1) combos.push([attrs[a], attrs[b], attrs[c]]);
  const entries = (stats) => stats.flatMap((attr) => [{ attr, rank }, { attr, rank }]);
  const defense = entries(['VIT', 'HP', 'DEF']);
  build.normal_runes = [
    { type: 'Attack', level: RUNE_LEVEL, entries: [] }, { type: 'Attack', level: RUNE_LEVEL, entries: [] },
    { type: 'Defense', level: RUNE_LEVEL, entries: defense }, { type: 'Defense', level: RUNE_LEVEL, entries: defense },
  ];
  pickBest(build, combos, (b, stats) => { b.normal_runes[0].entries = entries(stats); b.normal_runes[1].entries = entries(stats); });
  const conversions = L.runes.conversions.filter((c) => c !== NONE && tables.runes.core[CORE.level]?.[c]);
  pickBest(build, conversions, (b, conversion) => {
    b.core_rune = { level: CORE.level, conversion, ratio_rank: CORE.ratio, coeff_rank: CORE.coeff, enhance: CORE.enhance };
  });
}

function summarize(build) {
  const rune = build.normal_runes[0].entries.map((e) => e.attr).filter((a, i, all) => all.indexOf(a) === i);
  return {
    gear: build.equipment.map((e) => `${e.name} +${e.enhance} ${e.suffix}`),
    potentials: build.equipment[5]?.enchants || [],
    accessories: `${build.jewelry[0].name} (${build.jewelry[0].variant})`,
    title: build.title,
    costumeAccessories: build.fashion.filter((f) => !f.name.includes('(Lv')).map((f) => f.name),
    engravingExtra: build.engravings[0]?.extra,
    plates: build.glyph_a.map((g) => `${g.name.replace(' Enhancement Heraldry', '')} (${g.extra})`),
    fellowship: build.glyph_s.map((g) => `${g.name.replace(' Fellowship Heraldry', '')}: ${[1, 2, 3, 4].map((n) => g[`base_attr${n}`] !== NONE ? `${g[`base_attr${n}`]} ${g[`rank${n}`]}` : '').filter(Boolean).join(', ')}${g.extra !== NONE ? ` + ${g.extra}` : ''}`),
    attackRune: rune,
    coreRune: build.core_rune.conversion,
  };
}

export function referenceBuild(secondJob) {
  const log = [];
  const jobs = jobsOf(secondJob);
  const build = baseBuild(secondJob);
  chooseEquipment(build, jobs, log);
  chooseJewelry(build, log);
  chooseCostumes(build);
  pickBest(build, L.titles, (b, title) => { b.title = title; });
  chooseEngravings(build);
  chooseEnhancementPlates(build);
  chooseFellowshipPlates(build);
  chooseRunes(build);
  // Earlier picks were made before the plates and runes existed; one more pass settles them.
  for (const item of build.equipment) {
    const found = equipmentEntry(jobs, item.name);
    if (found) pickBest(build, Object.keys(found.entry.suffix || {}), (b, suffix) => { b.equipment.find((e) => e.slot === item.slot).suffix = suffix; });
  }
  for (const item of build.jewelry) pickBest(build, Object.values(tables.jewelry.variant_labels), (b, variant) => { b.jewelry.find((j) => j.slot === item.slot).variant = variant; });
  pickBest(build, L.titles, (b, title) => { b.title = title; });
  const result = calc.calculate(build, { summaryOnly: true }).summary;
  return { build, log, power: result.effective_panel, summary: result, choices: summarize(build) };
}

function main() {
  const classes = Object.keys(tables.effective_panel).filter((job) => tables.job_map[job]);
  const out = { generatedAt: new Date().toISOString(), assumptions: ASSUMPTIONS, classes: {} };
  const builds = {};
  for (const job of classes) {
    const started = Date.now();
    const { build, power: p, log, summary, choices } = referenceBuild(job);
    builds[job] = build;
    out.classes[job] = {
      power: Math.round(p),
      attack: Math.round(Math.max(summary.physical_average, summary.magic_average)),
      finalPercent: Number(summary.final_percent.toFixed(1)),
      critPercent: Number(summary.crit_percent.toFixed(1)),
      critDamagePercent: Number(summary.crit_damage_percent.toFixed(1)),
      choices,
      notes: log,
    };
    console.log(`${job.padEnd(16)} ${String(Math.round(p)).padStart(7)}  ${((Date.now() - started) / 1000).toFixed(1)}s${log.length ? `  ${log.join('; ')}` : ''}`);
    if (VERBOSE) console.log(JSON.stringify(choices, null, 1));
  }
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  fs.writeFileSync(BUILDS_OUT, `${JSON.stringify(builds)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT)} and ${path.relative(ROOT, BUILDS_OUT)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

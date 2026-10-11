// One build's answer: rows, summary, core rune preview and every per-item bonus the page shows.
const NONE = 'None';
const has = (value) => value !== null && value !== undefined && value !== NONE && value !== '';

export function buildResult(calc, tables, build) {
  const { rows, summary } = calc.calculate(build);
  const first = build.first_job; const second = build.second_job;
  const ranksS = tables.lists.glyph_s.ranks;
  const runeRanks = tables.lists.runes.ranks.filter(has);

  const glyphSRanks = (item) => {
    const out = {};
    for (const n of [1, 2, 3, 4]) {
      const base = item[`base_attr${n}`];
      if (!has(base)) continue;
      const byRank = {};
      for (const rank of ranksS) {
        const stats = tables.heraldry.s[item.level]?.[item.name]?.[base]?.[rank];
        if (stats) byRank[rank] = stats;
      }
      out[n] = byRank;
    }
    return out;
  };
  const runeRankValues = (rune) => (rune.entries || []).map((entry) => {
    const byRank = {};
    for (const rank of runeRanks) {
      const value = tables.runes.normal[rune.level]?.[rune.type]?.[entry.attr]?.[rank];
      if (value) byRank[rank] = value;
    }
    return byRank;
  });
  // Card column with and without the mastery.
  const masteryGain = () => {
    const out = {};
    const base = new Map(rows.map((r) => [r.attr, r.card || 0]));
    for (const [attr, level] of Object.entries(build.card_bonus_levels || {})) {
      if (!Number(level)) continue;
      const without = JSON.parse(JSON.stringify(build));
      without.card_bonus_levels[attr] = 0;
      const withoutRows = calc.calculate(without).rows;
      const gain = {};
      for (const r of withoutRows) {
        const delta = (base.get(r.attr) || 0) - (r.card || 0);
        if (Math.abs(delta) > 1e-9) gain[r.attr] = delta;
      }
      out[attr] = gain;
    }
    return out;
  };
  const keyed = (list, key, attrs) => Object.fromEntries(list.map((entry) => [key(entry), attrs(entry)]));

  const sets = calc.setBonusBreakdown(build.equipment || [], build.jewelry || [], first, second)
    .map((s) => ({ ...s, tiers: Object.keys(tables.sets.bonus[String(s.setId)] || {}).map(Number).sort((a, b) => a - b) }));
  const items = {
    equipment: (build.equipment || []).map((item) => calc.equipmentAttrs(item, first, second)),
    jewelry: (build.jewelry || []).map((item) => calc.jewelryAttrs(item)),
    engravings: (build.engravings || []).map((item) => calc.engravingAttrs(item)),
    glyph_a: (build.glyph_a || []).map((item) => calc.glyphAAttrs(item)),
    glyph_s: (build.glyph_s || []).map((item) => calc.glyphSAttrs(item)),
    glyph_s_ranks: (build.glyph_s || []).map(glyphSRanks),
    normal_runes: (build.normal_runes || []).map((rune) => calc.runeAttrsForItem(rune, build.core_rune?.enhance)),
    rune_ranks: (build.normal_runes || []).map(runeRankValues),
    talismans: (build.talismans || []).map((item) => calc.talismanAttrs(item)),
    fashion: keyed((build.fashion || []).filter((f) => has(f.name)), (f) => f.name, (f) => calc.fashionAttrs(f.name)),
    cards: keyed((build.card_grades || []).filter((c) => has(c.grade)), (c) => `${c.name}|${c.grade}`, (c) => calc.cardAttrs(c.name, c.grade)),
    mastery: keyed(build.mastery || [], (m) => `${m.name}|${m.level}`, (m) => calc.masteryAttrs(m.name, m.level)),
    mastery_gain: masteryGain(),
    titles: has(build.title) ? { [build.title]: calc.titleAttrs(build.title) } : {},
    collection: { [String(build.collection_level ?? 0)]: calc.collectionAttrs(build.collection_level) },
    sets,
  };
  return { rows, summary, preview: calc.coreRunePreview(build), items };
}

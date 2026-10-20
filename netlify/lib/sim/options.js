// The browser's share of the tables: lists, defaults and item facts, no stats.
// Nested {a: {b: {c: {rank: stats}}}} -> {a: {b: {c: [ranks with stats]}}}.
const rankKeys = (tree, depth) => Object.fromEntries(Object.entries(tree || {}).map(([key, sub]) => [key,
  depth > 1 ? rankKeys(sub, depth - 1) : Object.keys(sub || {}).filter((rank) => Object.values(sub[rank] ?? 0).some(Number) || Number(sub[rank]))]));

// Enhancement heraldry extras a plate cannot roll: the game never gives a plate its own stat (Magic has no MATK extra).
const baseStat = (key) => key.replace(/ (min|max)$/, '').replace(/ (min|max) %$/, ' %').replace(/ %$/, '');
function glyphABlockedExtras(heraldry) {
  const own = {};
  for (const plates of Object.values(heraldry.a || {})) {
    for (const [name, stats] of Object.entries(plates)) for (const key of Object.keys(stats)) (own[name] ??= new Set()).add(baseStat(key));
  }
  const extraStats = {};
  for (const extras of Object.values(heraldry.a_extra || {})) {
    for (const [extra, stats] of Object.entries(extras)) for (const key of Object.keys(stats)) (extraStats[extra] ??= new Set()).add(baseStat(key));
  }
  return Object.fromEntries(Object.entries(own).map(([name, stats]) => [name,
    // The picker lists "MATK"; the data keys it "MATK max", so both forms are blocked.
    Object.entries(extraStats).filter(([, keys]) => [...keys].some((k) => stats.has(k))).flatMap(([extra]) => [extra, extra.replace(/ max$/, '')])
      .filter((e, i, all) => all.indexOf(e) === i)]).filter(([, list]) => list.length));
}

export function buildOptions(tables) {
  // Items point into suffix_sets by index.
  const suffixSets = []; const suffixIndex = new Map();
  const suffixSet = (names) => {
    const key = JSON.stringify(names);
    if (!suffixIndex.has(key)) { suffixIndex.set(key, suffixSets.length); suffixSets.push(names); }
    return suffixIndex.get(key);
  };
  const gear = {};
  for (const [job, items] of Object.entries(tables.equipment)) {
    gear[job] = {};
    for (const [name, item] of Object.entries(items)) gear[job][name] = { level: item.level, suffix: suffixSet(Object.keys(item.suffix || {})) };
  }
  const accessories = {};
  const labels = tables.jewelry.variant_labels;
  for (const [slot, items] of Object.entries(tables.jewelry.items)) {
    accessories[slot] = {};
    for (const [name, item] of Object.entries(items)) {
      accessories[slot][name] = { level: item.level, variants: Object.keys(item.variants || {}).map((code) => labels[code] || code) };
    }
  }
  return {
    lists: tables.lists,
    defaults: tables.defaults,
    attribute_order: tables.attribute_order,
    job_map: tables.job_map,
    cards: { names: tables.cards.names, levels: tables.cards.levels },
    // Party and guild buffs carry their max-level stats for the party buff buttons.
    buffs: Object.fromEntries(Object.entries(tables.buffs || {}).map(([key, b]) => [key, {
      category: b.category, source: b.source, skill: b.skill, max_level: b.max_level,
      ...(/^(Party|Guild) buff$/.test(b.category) ? { stats: b.levels?.[String(b.max_level)] || {} } : {}),
    }])),
    // Which ranks exist per rune line and fellowship stat, so pickers offer only those.
    rune_ranks: rankKeys(tables.runes.normal, 3),
    glyph_a_blocked: glyphABlockedExtras(tables.heraldry),
    glyph_s_ranks: rankKeys(tables.heraldry.s, 3),
    gear,
    suffix_sets: suffixSets,
    accessories,
  };
}

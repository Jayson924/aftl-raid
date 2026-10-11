// The browser's share of the tables: lists, defaults and item facts, no stats.
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
    gear,
    suffix_sets: suffixSets,
    accessories,
  };
}

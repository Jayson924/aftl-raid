// The page's calculator, answered by the simulate function; helpers read the last answer by build identity.
const ENDPOINT = '/.netlify/functions/simulate';
const DEBOUNCE_MS = 120;
const CACHE_MAX = 64;
// Both builds with their party and gearscore views, or one window per character on My Characters.
const KEEP_BUILDS = 32;
// The simulate function's per-request limit.
const BATCH = 4;
const EMPTY = Object.freeze({ rows: [], summary: {} });
const ITEM_FIELDS = ['equipment', 'jewelry', 'engravings', 'glyph_a', 'glyph_s', 'normal_runes', 'talismans'];

export const NONE = 'None';
const norm = (value) => (value === null || value === undefined ? '' : String(value).trim());

export function createRemoteCalculator({ onResult, jobMap }) {
  const cache = new Map();     // build JSON -> answer, insertion ordered
  const builds = new Map();    // build object -> its JSON at the last calculate()
  const pending = new Set();   // build JSON in flight
  let timer = null;

  function remember(sig, result) {
    cache.delete(sig);
    cache.set(sig, result);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  const resultOf = (build) => cache.get(builds.get(build));
  function locate(item) {
    for (const build of builds.keys()) {
      for (const field of ITEM_FIELDS) {
        const index = (build[field] || []).indexOf(item);
        if (index >= 0) return { result: resultOf(build), field, index };
      }
    }
    return {};
  }
  const itemAttrs = (item, field) => {
    const found = locate(item);
    return (found.field === field && found.result?.items[field][found.index]) || {};
  };
  // Build-independent bonuses can come from any answer.
  function shared(kind, key) {
    for (const result of cache.values()) {
      const hit = result.items[kind]?.[key];
      if (hit) return hit;
    }
    return {};
  }

  const wanted = () => [...builds.values()].filter((sig) => !cache.has(sig) && !pending.has(sig));
  function schedule() {
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
  }
  async function flush() {
    timer = null;
    const sigs = [...new Set(wanted())].slice(0, BATCH);
    if (!sigs.length) return;
    let answered = false;
    for (const sig of sigs) pending.add(sig);
    // Sent verbatim so the answer matches the cached signature.
    const body = `{"builds":{${sigs.map((sig, i) => `"b${i}":${sig}`).join(',')}}}`;
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `The calculator did not answer (${res.status})`);
      sigs.forEach((sig, i) => { if (data.results?.[`b${i}`]) remember(sig, data.results[`b${i}`]); });
      answered = true;
      onResult?.(null);
    } catch (err) {
      onResult?.(err);
    } finally {
      for (const sig of sigs) pending.delete(sig);
      // A failed request is not retried on its own; the next change asks again.
      if (answered && wanted().length) schedule();
    }
  }

  return {
    jobs(firstJob, secondJob) {
      const first = norm(firstJob); const second = norm(secondJob);
      return [second, first, jobMap[second]?.base_class || first];
    },
    // Empty rows until the answer arrives.
    calculate(build) {
      const sig = JSON.stringify(build);
      builds.delete(build);
      builds.set(build, sig);
      while (builds.size > KEEP_BUILDS) builds.delete(builds.keys().next().value);
      if (!cache.has(sig)) schedule();
      return cache.get(sig) || EMPTY;
    },
    pending: () => timer !== null || pending.size > 0,
    coreRunePreview: (build) => resultOf(build)?.preview || {},
    skills: (build) => resultOf(build)?.skills || [],
    setBonusBreakdown(equipment) {
      for (const build of builds.keys()) if (build.equipment === equipment) return resultOf(build)?.items.sets || [];
      return [];
    },
    masteryGain: (build, attr) => resultOf(build)?.items.mastery_gain[attr] || {},
    equipmentAttrs: (item) => itemAttrs(item, 'equipment'),
    jewelryAttrs: (item) => itemAttrs(item, 'jewelry'),
    engravingAttrs: (item) => itemAttrs(item, 'engravings'),
    glyphAAttrs: (item) => itemAttrs(item, 'glyph_a'),
    glyphSAttrs: (item) => itemAttrs(item, 'glyph_s'),
    runeAttrsForItem: (rune) => itemAttrs(rune, 'normal_runes'),
    talismanAttrs: (item) => itemAttrs(item, 'talismans'),
    glyphSRankAttrs(item, n, rank) {
      const found = locate(item);
      return (found.field === 'glyph_s' && found.result?.items.glyph_s_ranks[found.index]?.[n]?.[rank]) || null;
    },
    runeRankValue(rune, entryIndex, rank) {
      const found = locate(rune);
      return (found.field === 'normal_runes' && found.result?.items.rune_ranks[found.index]?.[entryIndex]?.[rank]) || 0;
    },
    cardAttrs: (name, grade) => shared('cards', `${name}|${grade}`),
    masteryAttrs: (name, level) => shared('mastery', `${name}|${level}`),
    fashionAttrs: (name) => shared('fashion', name),
    titleAttrs: (title) => shared('titles', title),
    collectionAttrs: (level) => shared('collection', String(level ?? 0)),
  };
}

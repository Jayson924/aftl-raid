// Port of the meter's BuildCalculator over the English tables; golden.json pins every number. Buffs are phase 2.

export const SOURCE_ATTRS = ['STR', 'AGI', 'INT', 'VIT'];
export const NONE = 'None';

const FLAT_TARGETS = {
  HP: ['HP'],
  MP: ['MP'],
  PATK: ['PATK min', 'PATK max'],
  MATK: ['MATK min', 'MATK max'],
  DEF: ['DEF'],
  MDEF: ['MDEF'],
  Crit: ['Crit'],
  'Crit damage': ['Crit damage'],
};
const DISPLAY_TO_TARGET = {
  'PATK min': 'PATK', 'PATK max': 'PATK', 'MATK min': 'MATK', 'MATK max': 'MATK',
};
const PERCENT_ATTR = {
  HP: 'HP %', MP: 'MP %', STR: 'STR %', AGI: 'AGI %', INT: 'INT %', VIT: 'VIT %',
  'PATK min': 'PATK %', 'PATK max': 'PATK %', 'MATK min': 'MATK %', 'MATK max': 'MATK %',
  DEF: 'DEF %', MDEF: 'MDEF %', Crit: 'Crit %', 'Crit damage': 'Crit damage %',
  'Final damage': 'Final damage %',
};
const ELEMENTS = ['Fire', 'Water', 'Light', 'Dark'];
const ELEMENT_ATTACK = { Fire: 'Fire attack %', Water: 'Water attack %', Light: 'Light attack %', Dark: 'Dark attack %' };
const ELEMENT_ATTRS = new Set(Object.values(ELEMENT_ATTACK));
const PERCENT_ALIASES = { 'PATK %': ['PATK min %', 'PATK max %'], 'MATK %': ['MATK min %', 'MATK max %'] };
const OPTION_ALIASES = { PATK: ['PATK', 'PATK max'], MATK: ['MATK', 'MATK max'] };
const FREE_PERCENT_INPUT_ATTRS = {
  'Final damage %': 'Final damage', 'Crit %': 'Crit', 'Crit Dmg %': 'Crit damage',
  'Critical Damage %': 'Crit damage', 'Crit damage %': 'Crit damage',
};
const ENGRAVING_ARMOR_SLOTS = new Set(['Helmet', 'Upper', 'Lower', 'Gloves', 'Shoes']);
const ENGRAVING_WEAPON_SLOTS = new Set(['Main weapon', 'Secondary weapon']);
const ENGRAVING_JEWELRY_SLOTS = new Set(['Necklace', 'Earring', 'Ring 1', 'Ring 2']);
// The engraving extra labels (engraving.json extra_values) mapped onto panel attributes.
const ENGRAVING_EXTRA_ALIASES = {
  'Defense %': 'DEF %', 'Phys Defense %': 'DEF %', 'Magic Defense %': 'MDEF %', 'MDEF %': 'MDEF %',
  'Critical %': 'Crit %', 'Max HP %': 'HP %', 'Max MP %': 'MP %', 'Final Damage %': 'Final damage %',
  'Fire Damage %': 'Fire attack %', 'Ice Damage %': 'Water attack %', 'Water Damage %': 'Water attack %',
  'Light Damage %': 'Light attack %', 'Dark Damage %': 'Dark attack %',
};
const DEFENSE_LEVEL_REDUCTION_BASE = { 70: 8655.0, 75: 10339.0 };
const DEFENSE_RATE_CAP = 0.999899983406067;
const DEFENSE_REDUCTION_CAP_PERCENT = 30.0;
const ATTACK_ATTRS = new Set(['PATK', 'PATK min', 'PATK max', 'MATK', 'MATK min', 'MATK max']);

// Buff attribute names for phase 2, reusing the meter's English labels.
const BUFF = {
  damage: ['Damage bonus %'],
  physDamage: ['Physical damage bonus %'],
  magDamage: ['Magic damage bonus %'],
  critResistDown: ['Crit resist down %'],
  defDown: ['Defense down %'],
  physDefDown: ['Physical defense down %'],
  magDefDown: ['Magic defense down %'],
  resistDown: {
    Fire: ['Fire resist down %', 'All resist down %'],
    Water: ['Water resist down %', 'All resist down %'],
    Light: ['Light resist down %', 'All resist down %'],
    Dark: ['Dark resist down %', 'All resist down %'],
  },
  critExtra: ['Crit extra damage %'],
  independent: ['Independent damage multiplier %'],
  sniperChance: ['Sniper crit chance %'],
  sniperExtra: ['Sniper crit extra damage %'],
  hpHigh: ['HP above 30% coefficient %'],
  hpLow: ['HP below 50% coefficient %'],
  panel: { 'Final damage': ['Final damage panel %'], Crit: ['Crit panel %'], 'Crit damage': ['Crit damage panel %'] },
  independentSource: {
    STR: ['STR independent %', 'STR/INT independent %'],
    AGI: ['AGI independent %'],
    INT: ['INT independent %', 'STR/INT independent %'],
    VIT: ['VIT independent %'],
  },
  strToMatk: 'STR to MATK %',
  intToMatk: 'INT to MATK %',
  intToPatk: 'INT to PATK %',
};

export const norm = (value) => (value === null || value === undefined ? '' : String(value).trim());

export function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Python's round(x, d): both round the exact binary value, and for d >= 1 no exact tie exists.
export const pyRound = (x, digits) => Number(x.toFixed(digits));
const trunc = (x) => Math.trunc(x) || 0;
const isPercent = (attr) => norm(attr).endsWith('%');
const isNone = (text) => !text || text === NONE;

const get = (bucket, attr) => bucket[attr] ?? 0;
const inc = (bucket, attr, amount) => { bucket[attr] = (bucket[attr] ?? 0) + amount; };

export function addAttr(bucket, attr, amount) {
  const name = norm(attr);
  const value = num(amount);
  if (isNone(name) || value === 0) return;
  if (name === 'PATK') { inc(bucket, 'PATK min', value); inc(bucket, 'PATK max', value); }
  else if (name === 'MATK') { inc(bucket, 'MATK min', value); inc(bucket, 'MATK max', value); }
  else inc(bucket, name, value);
}

export function getDisplayAttr(bucket, attr) {
  const aliases = PERCENT_ALIASES[attr];
  if (!aliases) return get(bucket, attr);
  const values = aliases.map((a) => get(bucket, a)).filter((v) => Math.abs(v) > 1e-9);
  return get(bucket, attr) + (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
}

const optionKeys = (value) => OPTION_ALIASES[norm(value)] ?? [norm(value)];

function truncateFixed(bucket) {
  for (const attr of Object.keys(bucket)) if (!isPercent(attr)) bucket[attr] = trunc(bucket[attr]);
}

function addStats(bucket, stats) {
  for (const [attr, value] of Object.entries(stats || {})) addAttr(bucket, attr, value);
}

function sumKeys(buffs, keys) {
  let total = 0;
  for (const [key, value] of Object.entries(buffs)) if (keys.includes(norm(key))) total += num(value);
  return total;
}

function splitConversion(text) {
  for (const sep of ['→', '->', '>']) {
    if (text.includes(sep)) {
      const [left, right] = text.split(sep);
      return [norm(left), norm(right)];
    }
  }
  return ['', ''];
}

export function finalPercent(value) {
  return value <= 3116.25
    ? pyRound(value / 69.25, 1)
    : 45 + pyRound((value - 3116.25) / 161.583333333333, 1);
}

export function defensePercent(value, playerLevel = 70) {
  const defense = Math.max(0, num(value));
  if (defense <= 0) return 0;
  const base = DEFENSE_LEVEL_REDUCTION_BASE[playerLevel] ?? DEFENSE_LEVEL_REDUCTION_BASE[70];
  let reduction;
  if (base < 0) reduction = Math.max(50, 741 - 0.975 * defense);
  else {
    const lookupLevel = Math.min(playerLevel + 5, 100);
    reduction = (DEFENSE_LEVEL_REDUCTION_BASE[lookupLevel] ?? base) + 20;
  }
  return pyRound(Math.min(defense / (defense + reduction), DEFENSE_RATE_CAP) * 100, 1);
}

function defenseReductionChannels(buffs, cap = DEFENSE_REDUCTION_CAP_PERCENT) {
  let general = 0; let physical = 0; let magical = 0;
  for (const [key, raw] of Object.entries(buffs || {})) {
    const value = Math.max(0, num(raw));
    const text = norm(key);
    if (BUFF.defDown.includes(text)) general = Math.max(general, value);
    else if (BUFF.physDefDown.includes(text)) physical = Math.max(physical, value);
    else if (BUFF.magDefDown.includes(text)) magical = Math.max(magical, value);
  }
  return [Math.min(cap, general + physical), Math.min(cap, general + magical)];
}

function defenseReductionForAttack(buffs, attack, physicalWeight = 1, magicalWeight = 1) {
  const [physical, magical] = defenseReductionChannels(buffs);
  const text = norm(attack);
  if (text === 'PATK') return physical;
  if (text === 'MATK') return magical;
  const pw = Math.max(0, num(physicalWeight));
  const mw = Math.max(0, num(magicalWeight));
  const total = pw + mw;
  if (total <= 1e-12) return Math.max(physical, magical);
  return (physical * pw + magical * mw) / total;
}

const TABLE_NAMES = ['equipment', 'jewelry', 'sets', 'potentials', 'heraldry', 'cards', 'talismans', 'runes',
  'engraving', 'costumes', 'titles', 'collection', 'mastery', 'class_base', 'job_map', 'effective_panel',
  'attribute_order', 'conversion', 'lists', 'defaults', 'buffs'];

export function createCalculator(tables) {
  for (const name of TABLE_NAMES) if (!tables[name]) throw new Error(`simulator tables: missing ${name}`);
  return new BuildCalculator(tables);
}

class BuildCalculator {
  constructor(tables) {
    this.t = tables;
    this.attributeOrder = tables.attribute_order;
    this.classBase = {};
    for (const seconds of Object.values(tables.class_base)) Object.assign(this.classBase, seconds);
    this.costumeByName = {};
    for (const items of Object.values(tables.costumes)) Object.assign(this.costumeByName, items);
    this.variantCodes = Object.fromEntries(Object.entries(tables.jewelry.variant_labels).map(([c, l]) => [l, c]));
    this.collectionLevels = Object.keys(tables.collection).map(Number).sort((a, b) => a - b);
  }

  jobFamily(secondJob, fallback = '') {
    return this.t.job_map[norm(secondJob)]?.base_class || fallback;
  }

  jobs(firstJob, secondJob) {
    const first = norm(firstJob); const second = norm(secondJob);
    return [second, first, this.jobFamily(second, first)];
  }

  // ---- categories -------------------------------------------------------------------

  addCharacterAndMisc(bucket, build, secondJob) {
    addStats(bucket, this.classBase[norm(secondJob)]);
    const level = trunc(num(build.collection_level));
    for (const current of this.collectionLevels) if (current <= level) addStats(bucket, this.t.collection[current]);
    addStats(bucket, this.t.titles[norm(build.title)]);
    for (const item of build.fashion || []) addStats(bucket, this.costumeByName[norm(item.name)]);
    this.addEngravings(bucket, build);
    this.addFreeInputs(bucket, build);
  }

  addEngravings(bucket, build) {
    for (const item of build.engravings || []) {
      const slot = norm(item.slot);
      let mainValue = num(item.main_value);
      let secondaryValue = num(item.secondary_value);
      if (!mainValue && 'fixed1' in item) {
        const armorOrWeapon = ENGRAVING_ARMOR_SLOTS.has(slot) || ENGRAVING_WEAPON_SLOTS.has(slot);
        if (ENGRAVING_JEWELRY_SLOTS.has(slot) || !armorOrWeapon) {
          mainValue = num(item.fixed2) || num(item.fixed1) * 2;
          secondaryValue = num(item.fixed1);
        } else {
          mainValue = num(item.fixed1);
          secondaryValue = num(item.fixed2);
        }
      }
      if (ENGRAVING_ARMOR_SLOTS.has(slot)) {
        addAttr(bucket, 'DEF %', mainValue);
        addAttr(bucket, 'MDEF %', mainValue);
      } else if (ENGRAVING_WEAPON_SLOTS.has(slot)) {
        addAttr(bucket, 'PATK %', mainValue);
        addAttr(bucket, 'MATK %', mainValue);
      } else if (ENGRAVING_JEWELRY_SLOTS.has(slot)) {
        addAttr(bucket, 'HP %', mainValue);
        addAttr(bucket, 'PATK %', secondaryValue);
        addAttr(bucket, 'MATK %', secondaryValue);
      } else {
        addAttr(bucket, 'Crit %', mainValue);
        addAttr(bucket, 'PATK %', secondaryValue);
        addAttr(bucket, 'MATK %', secondaryValue);
      }
      const extra = this.engravingExtraAttr(item.extra);
      if (extra) addAttr(bucket, extra, item.extra_value);
    }
  }

  engravingExtraAttr(attr) {
    const text = norm(attr);
    if (isNone(text)) return '';
    return ENGRAVING_EXTRA_ALIASES[text] ?? text;
  }

  addEquipment(bucket, build, jobs, setCounts) {
    for (const item of build.equipment || []) {
      const name = norm(item.name);
      if (isNone(name)) continue;
      let matchedJob = '';
      for (const job of jobs) {
        if (!job) continue;
        const entry = this.t.equipment[job]?.[name];
        if (entry) {
          matchedJob = job;
          addStats(bucket, entry.base);
          const setId = this.t.sets.equipment[job]?.[name];
          if (setId) setCounts.set(setId, (setCounts.get(setId) ?? 0) + 1);
          break;
        }
      }
      const enhanceLevel = trunc(num(item.enhance));
      const candidates = matchedJob ? [matchedJob] : jobs.filter(Boolean);
      for (const job of candidates) {
        const stats = this.t.equipment[job]?.[name]?.enhance?.[String(enhanceLevel)];
        if (stats) { addStats(bucket, stats); break; }
      }
      const suffix = norm(item.suffix);
      if (!isNone(suffix)) {
        for (const job of candidates) {
          const stats = this.t.equipment[job]?.[name]?.suffix?.[suffix];
          if (stats) { addStats(bucket, stats); break; }
        }
      }
      for (const enchant of item.enchants || []) this.addEnchant(bucket, enchant);
    }
  }

  jewelryLookup(item) {
    const slot = norm(item.slot);
    const lookupSlot = slot.startsWith('Ring') ? 'Ring' : slot;
    let variant = norm(item.variant);
    variant = this.variantCodes[variant] ?? variant;
    if (variant === NONE) variant = '';
    return { lookupSlot, name: norm(item.name), variant };
  }

  addJewelry(bucket, build, setCounts) {
    for (const item of build.jewelry || []) {
      const { lookupSlot, name, variant } = this.jewelryLookup(item);
      if (isNone(name)) continue;
      addStats(bucket, this.t.jewelry.items[lookupSlot]?.[name]?.variants?.[variant]);
      const setId = this.t.sets.jewelry[lookupSlot]?.[name];
      if (setId) setCounts.set(setId, (setCounts.get(setId) ?? 0) + 1);
      for (const enchant of item.enchants || []) this.addEnchant(bucket, enchant);
    }
  }

  addEnchant(bucket, enchant) {
    const name = norm(enchant);
    if (name === NONE) return;
    addStats(bucket, this.t.potentials[name]?.stats);
  }

  addSetBonus(bucket, setCounts) {
    for (const [setId, count] of setCounts) {
      const tiers = this.t.sets.bonus[String(setId)] || {};
      for (const [pieces, stats] of Object.entries(tiers)) if (Number(pieces) <= count) addStats(bucket, stats);
    }
  }

  addCards(bucket, build) {
    const raw = {};
    const override = build.card_initial_totals;
    if (override && typeof override === 'object' && !Array.isArray(override)) {
      for (const [attr, amount] of Object.entries(override)) addAttr(raw, attr, amount);
    } else {
      for (const item of build.card_grades || []) {
        const name = norm(item.name);
        const grade = norm(item.grade) || NONE;
        if (isNone(name)) continue;
        addStats(raw, this.t.cards.lookup[name]?.[grade]);
      }
    }
    const bonusLevels = build.card_bonus_levels || {};
    for (const [attr, amount] of Object.entries(raw)) {
      const bonusKey = DISPLAY_TO_TARGET[attr] ?? attr;
      const level = bonusKey === 'Crit damage' ? 0 : num(bonusKey in bonusLevels ? bonusLevels[bonusKey] : bonusLevels[attr]);
      addAttr(bucket, attr, amount * (1 + level * 0.05));
    }
  }

  addTalismans(bucket, build) {
    for (const item of build.talismans || []) {
      if (!item || typeof item !== 'object') continue;
      addStats(bucket, this.talismanAttrs(item));
    }
  }

  addGlyphs(bucket, build) {
    for (const item of build.glyph_a || []) addStats(bucket, this.glyphAAttrs(item, false));
    for (const item of build.glyph_s || []) addStats(bucket, this.glyphSAttrs(item, false));
  }

  addNormalRunes(bucket, build) {
    const boost = 1 + num(build.core_rune?.enhance) / 100;
    for (const rune of build.normal_runes || []) {
      const level = norm(rune.level); const type = norm(rune.type);
      for (const entry of rune.entries || []) {
        const amount = this.t.runes.normal[level]?.[type]?.[norm(entry.attr)]?.[norm(entry.rank)] ?? 0;
        addAttr(bucket, entry.attr, amount * boost);
      }
    }
  }

  coreNode(build) {
    const core = build.core_rune || {};
    const level = norm(core.level); const conversion = norm(core.conversion);
    if (!level || !conversion) return null;
    const [source, target] = splitConversion(conversion);
    if (!source || !target) return null;
    const node = this.t.runes.core[level]?.[conversion];
    return { core, source, target, node };
  }

  // A selection equal to a table value wins; an old 1..21 rank above every value reads the rank column.
  coreSelectedValue(map, selected) {
    const text = norm(selected);
    if (!text || !map) return 0;
    const values = Object.values(map).map((v) => num(v, NaN)).filter((v) => !Number.isNaN(v));
    const number = num(selected, NaN);
    const byValue = values.filter((v) => v === number);
    if (byValue.length) return byValue.reduce((s, v) => s + v, 0) / byValue.length;
    const maxValue = values.length ? Math.max(...values) : 0;
    const isOldRank = !Number.isNaN(number) && Number.isInteger(number) && number >= 1 && number <= 21 && number > maxValue;
    if (!isOldRank) return 0;
    const byRank = Object.entries(map).filter(([rank]) => norm(rank) === text).map(([, v]) => num(v)).filter(Boolean);
    return byRank.length ? byRank.reduce((s, v) => s + v, 0) / byRank.length : 0;
  }

  coreSourceValue(values, attr) {
    if (attr === 'PATK') return (get(values, 'PATK min') + get(values, 'PATK max')) / 2;
    if (attr === 'MATK') return (get(values, 'MATK min') + get(values, 'MATK max')) / 2;
    return get(values, attr);
  }

  addCoreRune(bucket, build, sourceValues, exempt) {
    const found = this.coreNode(build);
    if (!found) return;
    const { core, source, target, node } = found;
    const ratio = this.coreSelectedValue(node?.ratio, core.ratio_rank);
    const coeff = this.coreSelectedValue(node?.coefficient, core.coeff_rank);
    const maxDeduct = num(node?.cap);
    if (ratio <= 0 || coeff <= 0) return;
    const sourceValue = this.coreSourceValue(sourceValues, source);
    const capped = maxDeduct > 0 ? Math.min(sourceValue, maxDeduct) : sourceValue;
    const deducted = capped * ratio / 100;
    const gained = deducted * coeff;
    addAttr(bucket, source, -deducted);
    addAttr(bucket, target, gained);
    if ((target === 'PATK' || target === 'MATK') && exempt) addAttr(exempt, target, gained);
  }

  addMastery(bucket, build, exempt) {
    for (const item of build.mastery || []) {
      const stats = this.t.mastery[norm(item.name)]?.[String(trunc(num(item.level)))] || {};
      for (const [attr, value] of Object.entries(stats)) {
        addAttr(bucket, attr, value);
        if (ATTACK_ATTRS.has(norm(attr)) && exempt) addAttr(exempt, attr, value);
      }
    }
  }

  addFreeInputs(bucket, build) {
    const free = build.free_inputs || {};
    for (const [attr, amount] of Object.entries(free.stats || {})) addAttr(bucket, attr, amount);
    for (const [attr, amount] of Object.entries(free.stat_percent || {})) addAttr(bucket, attr, amount);
  }

  freePercentBonus(build, attr) {
    let total = 0;
    for (const [label, value] of Object.entries(build.free_inputs?.percent || {})) {
      if (FREE_PERCENT_INPUT_ATTRS[norm(label)] === attr) total += num(value);
    }
    return total;
  }

  // ---- panels -----------------------------------------------------------------------

  sumCategories(categories) {
    const total = {};
    for (const bucket of Object.values(categories)) for (const [attr, amount] of Object.entries(bucket)) inc(total, attr, amount);
    return total;
  }

  actualAttributes(preSpecial, special) {
    const actual = {};
    const attrs = [...new Set([...this.attributeOrder, ...Object.keys(preSpecial), ...Object.keys(special)])];
    for (const attr of attrs) {
      const base = get(preSpecial, attr);
      const extra = get(special, attr);
      if (isPercent(attr)) { actual[attr] = base + extra; continue; }
      const percentAttr = PERCENT_ATTR[attr];
      const percent = percentAttr ? getDisplayAttr(preSpecial, percentAttr) : 0;
      actual[attr] = base * (1 + percent / 100) + extra;
    }
    return actual;
  }

  convertAttributes(actual, preSpecial, firstJob, secondJob) {
    const out = { ...actual };
    const job = this.jobFamily(secondJob, firstJob);
    const rates = this.t.conversion[job] || {};
    for (const [target, displays] of Object.entries(FLAT_TARGETS)) {
      let delta = 0;
      for (const source of SOURCE_ATTRS) delta += get(actual, source) * (rates[source]?.[target] ?? 0);
      for (const display of displays) {
        const pct = getDisplayAttr(preSpecial, PERCENT_ATTR[display] ?? '');
        inc(out, display, delta * (1 + pct / 100));
      }
    }
    return out;
  }

  actualWithSourceBuffs(actual, preSpecial, buffs) {
    const out = { ...actual };
    for (const attr of SOURCE_ATTRS) {
      const fixed = get(buffs, attr);
      const percent = get(buffs, `${attr} %`);
      const independent = BUFF.independentSource[attr].reduce((s, key) => s + get(buffs, key), 0);
      if (Math.abs(fixed) < 1e-9 && Math.abs(percent) < 1e-9 && Math.abs(independent) < 1e-9) continue;
      const equipmentPercent = getDisplayAttr(preSpecial, PERCENT_ATTR[attr] ?? '');
      const fixedAfterEquipment = fixed * (1 + equipmentPercent / 100);
      out[attr] = (get(actual, attr) + fixedAfterEquipment) * (1 + percent / 100) * (1 + independent / 100);
    }
    return out;
  }

  // Skill rows at the highest level named per skill, one per exclusive group; skill-scoped effects
  // only count inside their trigger window, so the panel leaves them out.
  buffValues(build) {
    const out = {};
    const rows = this.t.buffs || {};
    const keys = (this.t.lists?.buffs || {})[norm(build.second_job)] || Object.keys(rows);
    const chosen = new Map();
    for (const item of build.buffs || []) {
      const skill = norm(item?.skill);
      const level = num(item?.level);
      if (!skill || skill === NONE || level <= 0) continue;
      const key = (item?.key && rows[item.key] ? item.key : null)
        ?? keys.find((k) => rows[k] && (k === skill || rows[k].skill === skill))
        ?? Object.keys(rows).find((k) => k === skill || rows[k].skill === skill);
      if (!key) continue;
      const slot = rows[key].exclusive_group || key;
      const current = chosen.get(slot);
      if (!current || level > current.level) chosen.set(slot, { key, level });
    }
    for (const { key, level } of chosen.values()) {
      const entry = rows[key];
      if (entry.skill_scope) continue;
      for (const [attr, value] of Object.entries(entry.levels[String(level)] || {})) addAttr(out, attr, value);
    }
    for (const [attr, value] of Object.entries(build.extra_buff_attrs || {})) addAttr(out, attr, value);
    return out;
  }

  applyBuffs(converted, buffs, skipAttrs, percentExempt) {
    const out = { ...converted };
    for (const attr of this.attributeOrder) {
      if (skipAttrs.has(attr)) { out[attr] = get(converted, attr); continue; }
      if (ELEMENT_ATTRS.has(attr)) out[attr] = get(converted, attr) + get(buffs, attr);
      else if (attr.endsWith('%')) out[attr] = get(converted, attr);
      else {
        const base = DISPLAY_TO_TARGET[attr] ?? attr;
        let fixed = get(buffs, attr);
        if (base !== attr) fixed += get(buffs, base);
        const percent = get(buffs, `${base} %`);
        const exemptFixed = get(percentExempt, attr);
        let value = (get(converted, attr) - exemptFixed) * (1 + percent / 100) + exemptFixed + fixed;
        if (base === 'MATK') {
          value += get(converted, 'STR') * get(buffs, BUFF.strToMatk) / 100;
          value += get(converted, 'INT') * get(buffs, BUFF.intToMatk) / 100;
        } else if (base === 'PATK') {
          value += get(converted, 'INT') * get(buffs, BUFF.intToPatk) / 100;
        }
        out[attr] = trunc(value);
      }
    }
    return out;
  }

  staticPanels(build) {
    const firstJob = norm(build.first_job); const secondJob = norm(build.second_job);
    const jobs = this.jobs(firstJob, secondJob);
    const categories = { base: {}, equipment: {}, card: {}, talisman: {}, glyph: {}, normal_rune: {}, core_mastery: {} };
    const setCounts = new Map();
    this.addCharacterAndMisc(categories.base, build, secondJob);
    this.addEquipment(categories.equipment, build, jobs, setCounts);
    this.addJewelry(categories.equipment, build, setCounts);
    this.addSetBonus(categories.equipment, setCounts);
    this.addCards(categories.card, build);
    this.addTalismans(categories.talisman, build);
    this.addGlyphs(categories.glyph, build);
    this.addNormalRunes(categories.normal_rune, build);
    for (const bucket of Object.values(categories)) truncateFixed(bucket);
    const preSpecial = this.sumCategories(categories);
    truncateFixed(preSpecial);
    const exempt = {};
    // Mastery sits on the fixed panel before the core rune converts its source attribute.
    this.addMastery(categories.core_mastery, build, exempt);
    truncateFixed(categories.core_mastery);
    const actualBeforeCore = this.actualAttributes(preSpecial, categories.core_mastery);
    truncateFixed(actualBeforeCore);
    const convertedBeforeCore = this.convertAttributes(actualBeforeCore, preSpecial, firstJob, secondJob);
    truncateFixed(convertedBeforeCore);
    this.addCoreRune(categories.core_mastery, build, convertedBeforeCore, exempt);
    truncateFixed(categories.core_mastery);
    truncateFixed(exempt);
    const actual = this.actualAttributes(preSpecial, categories.core_mastery);
    truncateFixed(actual);
    const converted = this.convertAttributes(actual, preSpecial, firstJob, secondJob);
    truncateFixed(converted);
    return { firstJob, secondJob, categories, preSpecial, actual, converted, exempt };
  }

  calculate(build, { summaryOnly = false } = {}) {
    const { firstJob, secondJob, categories, preSpecial, actual, converted, exempt } = this.staticPanels(build);
    const buffs = this.buffValues(build);
    const buffActual = this.actualWithSourceBuffs(actual, preSpecial, buffs);
    truncateFixed(buffActual);
    const buffConverted = this.convertAttributes(buffActual, preSpecial, firstJob, secondJob);
    truncateFixed(buffConverted);
    const buffed = this.applyBuffs(buffConverted, buffs, new Set(SOURCE_ATTRS), exempt);
    const rows = [];
    if (!summaryOnly) {
      const rowAttrs = [...this.attributeOrder];
      for (const bucket of [...Object.values(categories), actual, converted, buffed]) {
        for (const attr of Object.keys(bucket)) if (!rowAttrs.includes(attr)) rowAttrs.push(attr);
      }
      for (const attr of rowAttrs) {
        const row = {
          attr,
          base: getDisplayAttr(categories.base, attr),
          equipment: getDisplayAttr(categories.equipment, attr),
          card: getDisplayAttr(categories.card, attr),
          talisman: getDisplayAttr(categories.talisman, attr),
          glyph: getDisplayAttr(categories.glyph, attr),
          normal_rune: getDisplayAttr(categories.normal_rune, attr),
          core_mastery: getDisplayAttr(categories.core_mastery, attr),
          actual: getDisplayAttr(actual, attr),
          converted: getDisplayAttr(converted, attr),
          buffed: getDisplayAttr(buffed, attr),
          percent: null,
        };
        if (attr === 'Final damage') row.percent = finalPercent(row.buffed);
        else if (attr === 'Crit') row.percent = Math.min(pyRound(row.buffed / 433, 1), 90);
        else if (attr === 'Crit damage') row.percent = pyRound(row.buffed / 62500 * 100, 3);
        rows.push(row);
      }
      for (const [attr, source] of [['DEF rate %', 'DEF'], ['MDEF rate %', 'MDEF']]) {
        rows.push({
          attr, base: 0, equipment: 0, card: 0, talisman: 0, glyph: 0, normal_rune: 0, core_mastery: 0,
          actual: defensePercent(get(actual, source)),
          converted: defensePercent(get(converted, source)),
          buffed: defensePercent(get(buffed, source)),
          percent: null,
        });
      }
    }
    const effectiveSecondJob = norm(build.effective_second_job) || secondJob;
    const summary = this.effectivePanel(effectiveSecondJob, build, buffed, buffs);
    return { rows, summary };
  }

  panelPercentBonus(buffs, attr) {
    return sumKeys(buffs, BUFF.panel[attr] ?? [`${attr} panel %`]);
  }

  elementResists(build) {
    const old = num('element_resist_percent' in build ? build.element_resist_percent : build.element_resist);
    const values = Object.fromEntries(ELEMENTS.map((e) => [e, old]));
    const raw = build.element_resists;
    if (raw && typeof raw === 'object') for (const e of ELEMENTS) if (e in raw) values[e] = num(raw[e]);
    return values;
  }

  damageAmpPercent(buffs, attack, phys, magic) {
    const universal = sumKeys(buffs, BUFF.damage);
    const physical = sumKeys(buffs, BUFF.physDamage);
    const magical = sumKeys(buffs, BUFF.magDamage);
    const text = norm(attack);
    if (text === 'PATK') return Math.min(100, universal + physical);
    if (text === 'MATK') return Math.min(100, universal + magical);
    if (text === 'Both') {
      const total = phys + magic;
      if (total <= 0) return Math.min(100, universal + Math.max(physical, magical));
      return Math.min(100, universal + (physical * phys + magical * magic) / total);
    }
    return Math.min(100, universal);
  }

  effectivePanel(secondJob, build, buffed, buffs) {
    const parts = this.t.effective_panel[norm(secondJob)] || [];
    const physicalMin = get(buffed, 'PATK min'); const physicalMax = get(buffed, 'PATK max');
    const magicMin = get(buffed, 'MATK min'); const magicMax = get(buffed, 'MATK max');
    const phys = (physicalMin + physicalMax) / 2;
    const magic = (magicMin + magicMax) / 2;
    const finalPct = finalPercent(get(buffed, 'Final damage')) + this.freePercentBonus(build, 'Final damage') + this.panelPercentBonus(buffs, 'Final damage');
    const critPct = Math.min(pyRound(get(buffed, 'Crit') / 433, 1) + this.freePercentBonus(build, 'Crit') + this.panelPercentBonus(buffs, 'Crit'), 90);
    const critDamagePct = Math.min(pyRound(get(buffed, 'Crit damage') / 62500 * 100, 3) + this.freePercentBonus(build, 'Crit damage') + this.panelPercentBonus(buffs, 'Crit damage'), 100);
    const finalRate = finalPct / 100;
    const critRate = critPct / 100;
    const critResistValue = num('crit_resist_value' in build ? build.crit_resist_value : build.crit_resist);
    const critResistReductionPct = Math.max(0, ...Object.entries(buffs).filter(([k]) => BUFF.critResistDown.includes(norm(k))).map(([, v]) => Math.max(0, num(v))));
    const effectiveCritResistValue = Math.max(0, critResistValue * (1 - Math.min(100, critResistReductionPct) / 100));
    const critResistPct = Math.min(pyRound(effectiveCritResistValue / 433, 1), 90);
    const critResist = critResistPct / 100;
    const critDamage = 2 + critDamagePct / 100;
    const effectiveCritRate = critRate * Math.max(0, 1 - critResist);
    const critMultiplier = 1 + effectiveCritRate * (critDamage - 1);
    const critExtraPct = sumKeys(buffs, BUFF.critExtra);
    const critExtraMultiplier = 1 + effectiveCritRate * critExtraPct / 100;
    const sniperChance = sumKeys(buffs, BUFF.sniperChance);
    const sniperExtra = sumKeys(buffs, BUFF.sniperExtra);
    const sniperMultiplier = sniperChance <= 0 || sniperExtra <= 0 ? 1 : 1 + effectiveCritRate * sniperChance / 100 * sniperExtra / 100;
    const highHp = sumKeys(buffs, BUFF.hpHigh) * 24.5;
    const lowHp = sumKeys(buffs, BUFF.hpLow) * 37.5;
    const hpConditionalMultiplier = (1 + highHp / 100) * (1 + lowHp / 100);
    const independentMultiplier = Math.max(0, 1 + sumKeys(buffs, BUFF.independent) / 100);
    const monsterDefense = num(build.monster_defense);
    const defenseReductionPct = defenseReductionForAttack(buffs, '', phys, magic);
    const effectiveMonsterDefense = Math.max(0, monsterDefense * (1 - defenseReductionPct / 100));
    const resists = this.elementResists(build);
    const effectiveResists = {};
    for (const e of ELEMENTS) effectiveResists[e] = resists[e] - sumKeys(buffs, BUFF.resistDown[e]);
    let total = 0; let weightTotal = 0;
    for (const part of parts) {
      const attack = norm(part.attack); const element = norm(part.element);
      const weight = num(part.weight); const fixed = num(part.fixed); const extraFinal = num(part.extra_final);
      if (isNone(attack) || weight <= 0) continue;
      const panel = attack === 'PATK' ? phys : attack === 'MATK' ? magic : attack === 'Both' ? phys + magic : 0;
      const elemRate = ELEMENT_ATTACK[element];
      const effectiveResist = effectiveResists[element] ?? 0;
      const elementMultiplier = elemRate ? (1 + get(buffed, elemRate) / 100) * (1 - effectiveResist / 100) : 1;
      const damageAmpMultiplier = 1 + this.damageAmpPercent(buffs, attack, phys, magic) / 100;
      const attackDefense = Math.max(0, monsterDefense * (1 - defenseReductionForAttack(buffs, attack, phys, magic) / 100));
      const defenseMultiplier = Math.max(0, 1 - defensePercent(attackDefense) / 100);
      total += (panel * weight / 100 + fixed) * (1 + finalRate + extraFinal / 100) * critMultiplier * critExtraMultiplier
        * sniperMultiplier * hpConditionalMultiplier * independentMultiplier * elementMultiplier * damageAmpMultiplier * defenseMultiplier;
      weightTotal += weight;
    }
    const effective = weightTotal ? total / (weightTotal / 100) : 0;
    const allSame = new Set(Object.values(resists)).size === 1;
    return {
      HP: get(buffed, 'HP'),
      effective_panel: effective,
      final_percent: finalPct,
      crit_percent: critPct,
      crit_damage_percent: critDamagePct,
      crit_resist_percent: critResistPct,
      effective_crit_resist_value: effectiveCritResistValue,
      crit_resist_reduction_percent: critResistReductionPct,
      monster_defense: monsterDefense,
      effective_monster_defense: effectiveMonsterDefense,
      defense_reduction_percent: defenseReductionPct,
      monster_defense_rate: defensePercent(effectiveMonsterDefense),
      element_resist_percent: allSame ? resists.Fire : 0,
      physical_min: physicalMin,
      physical_max: physicalMax,
      physical_average: phys,
      magic_min: magicMin,
      magic_max: magicMax,
      magic_average: magic,
      'Fire attack %': get(buffed, 'Fire attack %'),
      'Water attack %': get(buffed, 'Water attack %'),
      'Light attack %': get(buffed, 'Light attack %'),
      'Dark attack %': get(buffed, 'Dark attack %'),
      'Fire resistance %': resists.Fire,
      'Water resistance %': resists.Water,
      'Light resistance %': resists.Light,
      'Dark resistance %': resists.Dark,
      'Fire effective resistance %': effectiveResists.Fire,
      'Water effective resistance %': effectiveResists.Water,
      'Light effective resistance %': effectiveResists.Light,
      'Dark effective resistance %': effectiveResists.Dark,
      'Damage increase %': get(buffs, BUFF.damage[0]),
      'Physical damage increase %': get(buffs, BUFF.physDamage[0]),
      'Magic damage increase %': get(buffs, BUFF.magDamage[0]),
      'Crit extra damage %': critExtraPct,
      'Crit expected gain %': (sniperMultiplier - 1) * 100,
      'Dedicate Crow average gain %': get(buffs, BUFF.hpHigh[0]) * 24.5,
      'Ecstatic Dance average gain %': get(buffs, BUFF.hpLow[0]) * 37.5,
      'Independent damage multiplier %': (independentMultiplier - 1) * 100,
    };
  }

  coreRunePreview(build) {
    const found = this.coreNode(build);
    if (!found) return {};
    const { firstJob, secondJob, categories, preSpecial } = this.staticPanelsWithoutCore(build);
    const actual = this.actualAttributes(preSpecial, categories.core_mastery);
    truncateFixed(actual);
    const converted = this.convertAttributes(actual, preSpecial, firstJob, secondJob);
    truncateFixed(converted);
    const { core, source, target, node } = found;
    const ratio = this.coreSelectedValue(node?.ratio, core.ratio_rank);
    const coeff = this.coreSelectedValue(node?.coefficient, core.coeff_rank);
    const maxDeduct = num(node?.cap);
    const sourceValue = this.coreSourceValue(converted, source);
    const preview = {
      source_attr: source, target_attr: target, source_value: sourceValue,
      deduct: 0, gain: 0, max_deduct: maxDeduct, normal_boost: num(core.enhance),
    };
    if (ratio <= 0 || coeff <= 0) return preview;
    const capped = maxDeduct > 0 ? Math.min(sourceValue, maxDeduct) : sourceValue;
    preview.deduct = capped * ratio / 100;
    preview.gain = preview.deduct * coeff;
    return preview;
  }

  staticPanelsWithoutCore(build) {
    const firstJob = norm(build.first_job); const secondJob = norm(build.second_job);
    const jobs = this.jobs(firstJob, secondJob);
    const categories = { base: {}, equipment: {}, card: {}, talisman: {}, glyph: {}, normal_rune: {}, core_mastery: {} };
    const setCounts = new Map();
    this.addCharacterAndMisc(categories.base, build, secondJob);
    this.addEquipment(categories.equipment, build, jobs, setCounts);
    this.addJewelry(categories.equipment, build, setCounts);
    this.addSetBonus(categories.equipment, setCounts);
    this.addCards(categories.card, build);
    this.addTalismans(categories.talisman, build);
    this.addGlyphs(categories.glyph, build);
    this.addNormalRunes(categories.normal_rune, build);
    for (const bucket of Object.values(categories)) truncateFixed(bucket);
    const preSpecial = this.sumCategories(categories);
    truncateFixed(preSpecial);
    this.addMastery(categories.core_mastery, build);
    truncateFixed(categories.core_mastery);
    return { firstJob, secondJob, categories, preSpecial };
  }

  // ---- per-item helpers (tooltips on the page) ----------------------------------------

  finish(bucket) { truncateFixed(bucket); return bucket; }

  cardAttrs(name, grade) {
    return { ...(this.t.cards.lookup[norm(name)]?.[norm(grade) || NONE] || {}) };
  }

  glyphAAttrs(item, finish = true) {
    const bucket = {};
    const level = norm(item.level);
    addStats(bucket, this.t.heraldry.a[level]?.[norm(item.name)]);
    const extra = norm(item.extra);
    if (!isNone(extra)) for (const key of optionKeys(extra)) addStats(bucket, this.t.heraldry.a_extra[level]?.[key]);
    return finish ? this.finish(bucket) : bucket;
  }

  glyphSAttrs(item, finish = true) {
    const bucket = {};
    const level = norm(item.level); const name = norm(item.name);
    for (let i = 1; i <= 4; i += 1) {
      const attr = norm(item[`base_attr${i}`]); const rank = norm(item[`rank${i}`]);
      if (!isNone(attr) && !isNone(rank)) addStats(bucket, this.t.heraldry.s[level]?.[name]?.[attr]?.[rank]);
    }
    const extra = norm(item.extra);
    if (!isNone(extra)) for (const key of optionKeys(extra)) addStats(bucket, this.t.heraldry.s_extra[level]?.[name]?.[key]);
    return finish ? this.finish(bucket) : bucket;
  }

  runeAttrsForItem(rune, boostPercent = 0) {
    const bucket = {};
    const level = norm(rune.level); const type = norm(rune.type);
    const boost = 1 + num(boostPercent) / 100;
    for (const entry of rune.entries || []) {
      const amount = this.t.runes.normal[level]?.[type]?.[norm(entry.attr)]?.[norm(entry.rank)] ?? 0;
      addAttr(bucket, entry.attr, amount * boost);
    }
    return this.finish(bucket);
  }

  equipmentAttrs(item, firstJob, secondJob) {
    const bucket = {};
    this.addEquipment(bucket, { equipment: [item] }, this.jobs(firstJob, secondJob), new Map());
    return this.finish(bucket);
  }

  equipmentSetCounts(equipment, firstJob, secondJob) {
    const counts = new Map(); const members = new Map();
    for (const item of equipment || []) {
      const name = norm(item.name);
      if (isNone(name)) continue;
      for (const job of this.jobs(firstJob, secondJob)) {
        if (!job) continue;
        if (this.t.equipment[job]?.[name]) {
          const setId = this.t.sets.equipment[job]?.[name];
          if (setId) { counts.set(setId, (counts.get(setId) ?? 0) + 1); members.set(setId, [...(members.get(setId) || []), name]); }
          break;
        }
      }
    }
    return [counts, members];
  }

  jewelrySetCounts(jewelry) {
    const counts = new Map(); const members = new Map();
    for (const item of jewelry || []) {
      const { lookupSlot, name } = this.jewelryLookup(item);
      if (isNone(name)) continue;
      const setId = this.t.sets.jewelry[lookupSlot]?.[name];
      if (setId) { counts.set(setId, (counts.get(setId) ?? 0) + 1); members.set(setId, [...(members.get(setId) || []), name]); }
    }
    return [counts, members];
  }

  equipmentSetBonusAttrs(equipment, firstJob, secondJob) {
    const bucket = {};
    this.addSetBonus(bucket, this.equipmentSetCounts(equipment, firstJob, secondJob)[0]);
    return this.finish(bucket);
  }

  jewelryAttrs(item) {
    const bucket = {};
    this.addJewelry(bucket, { jewelry: [item] }, new Map());
    return this.finish(bucket);
  }

  jewelrySetBonusAttrs(jewelry) {
    const bucket = {};
    this.addSetBonus(bucket, this.jewelrySetCounts(jewelry)[0]);
    return this.finish(bucket);
  }

  setBonusBreakdown(equipment, jewelry, firstJob, secondJob) {
    const result = [];
    const scopes = [
      ['equipment', ...this.equipmentSetCounts(equipment, firstJob, secondJob)],
      ['jewelry', ...this.jewelrySetCounts(jewelry)],
    ];
    for (const [scope, counts, members] of scopes) {
      for (const [setId, count] of [...counts].sort((a, b) => a[0] - b[0])) {
        const attrs = {}; const tiers = [];
        for (const [pieces, stats] of Object.entries(this.t.sets.bonus[String(setId)] || {})) {
          if (Number(pieces) <= count) { tiers.push(Number(pieces)); addStats(attrs, stats); }
        }
        truncateFixed(attrs);
        result.push({
          scope, setId, count, name: this.t.sets.names[String(setId)] || '',
          members: members.get(setId) || [], appliedTiers: tiers.sort((a, b) => a - b), attributes: attrs,
        });
      }
    }
    return result;
  }

  masteryAttrs(name, level) {
    const bucket = {};
    addStats(bucket, this.t.mastery[norm(name)]?.[String(trunc(num(level)))]);
    return this.finish(bucket);
  }

  fashionAttrs(name) {
    const bucket = {};
    addStats(bucket, this.costumeByName[norm(name)]);
    return this.finish(bucket);
  }

  talismanAttrs(item) {
    const bucket = {};
    const grade = norm(item.grade); const name = norm(item.name); const slot = norm(item.slot);
    const multiplier = (this.t.talismans.slot_percent[slot] ?? 0) / 100;
    if (isNone(grade) || isNone(name) || multiplier <= 0) return {};
    const entry = this.t.talismans.grades[grade]?.[name];
    for (const [attr, value] of Object.entries(entry?.stats || {})) addAttr(bucket, attr, num(value) * multiplier);
    const extra = norm(item.extra);
    if (!isNone(extra)) for (const [attr, value] of Object.entries(entry?.extra?.[extra]?.stats || {})) addAttr(bucket, attr, num(value) * multiplier);
    // Each installed talisman truncates on its own, as the game shows whole numbers per item.
    return this.finish(bucket);
  }

  engravingAttrs(item) {
    const bucket = {};
    this.addEngravings(bucket, { engravings: [item] });
    return this.finish(bucket);
  }

  collectionAttrs(level) {
    const bucket = {};
    const selected = trunc(num(level));
    for (const current of this.collectionLevels) if (current <= selected) addStats(bucket, this.t.collection[current]);
    return this.finish(bucket);
  }

  titleAttrs(title) {
    const bucket = {};
    addStats(bucket, this.t.titles[norm(title)]);
    return this.finish(bucket);
  }
}

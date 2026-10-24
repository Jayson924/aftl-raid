// Rich gearscore tooltip used on recruiting cards, lineups, and lineup editor.
// Provides:
//   renderChipTipBody(player) → inner sections HTML (no wrapper)
//   renderPowerBadge(player) → <span> badge with rich-tip data attached
//   initChipTooltip() → floating tooltip handler (position: fixed, escapes overflow)

import { calculatePowerScore, getPowerTier, formatPower, powerTooltipText, powerGaps, simJobOf, EQUIPMENT_ICONS } from './constants.js';

const RARITY_CLASSES = new Set(['legend', 'unique', 'epic', 'rare']);

const SLOT_LABELS = {
  mainWeapon: 'Main', subWeapon: 'Sub', helmet: 'Helmet', top: 'Top', bottom: 'Bottom',
  gloves: 'Gloves', boots: 'Boots', necklace: 'Necklace', earring: 'Earring', ring1: 'Ring 1', ring2: 'Ring 2',
};

function fmtEnh(n, rarity) {
  if (n == null) return `<span class="chip-tip__dash">–</span>`;
  const cls = RARITY_CLASSES.has(rarity) ? rarity : 'low';
  return `<span class="chip-tip__val chip-tip__val--${cls}">+${n}</span>`;
}

// gear: false keeps only the power line and the breakdown against the class reference.
export function renderChipTipBody(player, { gear = true } = {}) {
  const equip = player.equipment || {};
  const enhVal = (slot, fallback) => {
    const e = equip[slot]?.enhancement;
    if (e != null && e !== '') return Number(e);
    if (fallback != null && fallback !== '') return Number(fallback);
    return null;
  };
  const rarityFor = (slot, fallback) => {
    const r = equip[slot]?.rarity;
    if (r) return r;
    return fallback || null;
  };

  const mw = enhVal('mainWeapon', player.weaponEnhance);
  const mwR = rarityFor('mainWeapon', player.weapon);
  const sw = enhVal('subWeapon', null);
  const swR = rarityFor('subWeapon', player.weapon);
  const armor = [
    ['Helmet', enhVal('helmet', player.armorEnhance), rarityFor('helmet', player.armor)],
    ['Top',    enhVal('top',    player.armorEnhance), rarityFor('top',    player.armor)],
    ['Bottom', enhVal('bottom', player.armorEnhance), rarityFor('bottom', player.armor)],
    ['Gloves', enhVal('gloves', player.armorEnhance), rarityFor('gloves', player.armor)],
    ['Boots',  enhVal('boots',  player.armorEnhance), rarityFor('boots',  player.armor)],
  ];
  const power = calculatePowerScore(player);
  const synced = power.source === 'power';

  const hasWeapon = mw != null || sw != null;
  const hasArmor = armor.some(([, v]) => v != null);
  if (!hasWeapon && !hasArmor && !synced) return '';

  const chip = (label, v, r) => `<span class="chip-tip__chip"><span>${label}</span>${fmtEnh(v, r)}</span>`;
  const gearSection = hasWeapon || hasArmor ? `
    <div class="chip-tip__section">
      <div class="chip-tip__heading">${EQUIPMENT_ICONS.weapon}<span>Gear</span></div>
      <div class="chip-tip__chips">${chip('Main', mw, mwR)}${chip('Sub', sw, swR)}</div>
      <div class="chip-tip__chips">${armor.map(([label, v, r]) => chip(label, v, r)).join('')}</div>
    </div>` : '';

  const powerSection = synced ? `
    <div class="chip-tip__fd">
      <span class="chip-tip__fd-label">Power level</span>
      <span class="chip-tip__fd-val">${formatPower(power.power)} of ${formatPower(power.reference)}</span>
    </div>` : power.source === 'stats' ? `
    <div class="chip-tip__fd">
      <span class="chip-tip__fd-label">Gearscore</span>
      <span class="chip-tip__fd-val">~${power.score} estimate</span>
    </div>` : '';

  const gaps = powerGaps(player);
  const gapSection = gaps.length ? `
    <div class="chip-tip__section">
      <div class="chip-tip__heading"><span>Vs maxed ${simJobOf(player)}</span></div>
      <div class="chip-tip__rows">${gaps.map(g => `
        <div class="chip-tip__gap">
          <div class="chip-tip__row"><span class="chip-tip__label">${g.label}</span><span class="chip-tip__gap-vals"><b>${g.text}</b><i>/ ${g.maxText}</i><em>${Math.round(g.share * 100)}%</em></span></div>
          <div class="chip-tip__bar"><span style="width: ${Math.round(g.share * 100)}%"></span></div>
        </div>`).join('')}</div>
    </div>` : '';

  if (!gear) return `${powerSection}${gapSection}`;
  return `${gearSection}${powerSection}${gapSection}`;
}

// Convenience for places that previously rendered a plain gs-inline span inline.
// Returns the badge with the rich-tip body embedded as an attribute payload.
export function renderPowerBadge(player, { className = 'gs-inline', gear = true } = {}) {
  const { score, source } = calculatePowerScore(player);
  const tier = getPowerTier(score);
  const cls = `${className}${source === 'power' ? '' : ' gs-est'}`;
  const text = source === 'power' ? String(score) : source === 'stats' ? `~${score}` : '–';
  const tipBody = renderChipTipBody(player, { gear });
  if (!tipBody) {
    return `<span class="${cls}" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${powerTooltipText(player)}">${text}</span>`;
  }
  const escaped = tipBody.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<span class="${cls} has-chip-tip" data-chip-tip-html="${escaped}" style="color: ${tier.color}; background: ${tier.bg};">${text}</span>`;
}

let initialized = false;

export function initChipTooltip() {
  if (initialized) return;
  initialized = true;

  const tip = document.createElement('div');
  tip.className = 'chip-tip chip-tip-floating';
  tip.style.display = 'none';
  document.body.appendChild(tip);

  const show = (el) => {
    const html = el.dataset.chipTipHtml;
    if (!html) return;
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.classList.remove('chip-tip-floating--below');
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.top - t.height - 12;
    let placedBelow = false;
    if (top < 8) {
      top = r.bottom + 12;
      placedBelow = true;
    }
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    if (placedBelow) tip.classList.add('chip-tip-floating--below');
  };
  const hide = () => { tip.style.display = 'none'; };

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('.has-chip-tip');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.('.has-chip-tip');
    if (el) hide();
  });
  window.addEventListener('scroll', hide, true);
}

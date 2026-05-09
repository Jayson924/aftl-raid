// Rich gearscore tooltip used on recruiting cards, lineups, and lineup editor.
// Provides:
//   renderChipTipBody(player) → inner sections HTML (no wrapper)
//   renderGearscoreBadge(player) → <span> badge with rich-tip data attached
//   initChipTooltip() → floating tooltip handler (position: fixed, escapes overflow)

import { calculateGearscore, getGearscoreTier, EQUIPMENT_ICONS } from './constants.js';

const RARITY_CLASSES = new Set(['legend', 'unique', 'epic', 'rare']);

function fmtEnh(n, rarity) {
  if (n == null) return `<span class="chip-tip__dash">–</span>`;
  const cls = RARITY_CLASSES.has(rarity) ? rarity : 'low';
  return `<span class="chip-tip__val chip-tip__val--${cls}">+${n}</span>`;
}

export function renderChipTipBody(player) {
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
  const fd = player.characterStats?.finalDamage;

  const hasWeapon = mw != null || sw != null;
  const hasArmor = armor.some(([, v]) => v != null);
  if (!hasWeapon && !hasArmor && !fd) return '';

  const weaponSection = hasWeapon ? `
    <div class="chip-tip__section">
      <div class="chip-tip__heading">${EQUIPMENT_ICONS.weapon}<span>Weapons</span></div>
      <div class="chip-tip__rows">
        <div class="chip-tip__row"><span class="chip-tip__label">Main</span>${fmtEnh(mw, mwR)}</div>
        <div class="chip-tip__row"><span class="chip-tip__label">Sub</span>${fmtEnh(sw, swR)}</div>
      </div>
    </div>` : '';

  const armorRows = armor
    .map(([label, v, r]) => `<div class="chip-tip__row"><span class="chip-tip__label">${label}</span>${fmtEnh(v, r)}</div>`)
    .join('');
  const armorSection = hasArmor ? `
    <div class="chip-tip__section">
      <div class="chip-tip__heading">${EQUIPMENT_ICONS.armor}<span>Armor</span></div>
      <div class="chip-tip__rows">${armorRows}</div>
    </div>` : '';

  const fdSection = fd ? `
    <div class="chip-tip__fd">
      <span class="chip-tip__fd-label">Final Damage</span>
      <span class="chip-tip__fd-val">${Number(fd).toLocaleString()}</span>
    </div>` : '';

  return `${weaponSection}${armorSection}${fdSection}`;
}

// Convenience for places that previously rendered a plain gs-inline span inline.
// Returns the badge with the rich-tip body embedded as an attribute payload.
export function renderGearscoreBadge(player) {
  const gs = calculateGearscore(player);
  const tier = getGearscoreTier(gs);
  const tipBody = renderChipTipBody(player);
  if (!tipBody) {
    return `<span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`;
  }
  const escaped = tipBody.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<span class="gs-inline has-chip-tip" data-chip-tip-html="${escaped}" style="color: ${tier.color}; background: ${tier.bg};">${gs}</span>`;
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

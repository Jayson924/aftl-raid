import { fdToPercent as gameFdToPercent } from './gear-calc.js';
import referencePower from './data/reference-power.json' with { type: 'json' };

// ─── Class Icon Sprite Sheet ───
// Sprite: /icons/classes.png (512×1024)
// Grid: 44×46 cells, gap 11×9, offset 6×5
export const SPRITE_CONFIG = {
  url: '/icons/classes.png',
  sheetW: 512, sheetH: 1024,
  cellW: 44, cellH: 46,
  gapX: 11, gapY: 9,
  offX: 6, offY: 5,
};

// Sprite position map: class name → [row, col]
export const CLASS_SPRITE_MAP = {
  // Base classes
  'Warrior':        [0, 0],
  'Archer':         [0, 1],
  'Sorceress':      [0, 2],
  'Cleric':         [0, 3],
  'Academic':       [0, 4],
  'Kali':           [0, 5],
  'Assassin':       [0, 6],
  // 1st specializations
  'Swordmaster':    [0, 8],
  'Mercenary':      [1, 0],
  'Avenger':        [6, 3],
  'Bowmaster':      [1, 6],
  'Acrobat':        [1, 7],
  'Elemental Lord': [2, 4],
  'Force User':     [2, 5],
  'Paladin':        [3, 2],
  'Priest':         [3, 3],
  'Engineer':       [4, 0],
  'Alchemist':      [4, 3],
  'Screamer':       [4, 6],
  'Dancer':         [5, 0],
  'Chaser':         [5, 3],
  'Bringer':        [5, 6],
  // Final classes
  'Gladiator':      [1, 2],
  'Moon Lord':      [1, 3],
  'Barbarian':      [1, 4],
  'Destroyer':      [1, 5],
  'Dark Avenger':   [6, 4],
  'Sniper':         [2, 0],
  'Artillery':      [2, 1],
  'Wind Walker':    [2, 2],
  'Tempest':        [2, 3],
  'Saleana':        [2, 7],
  'Elestra':        [2, 8],
  'Smasher':        [3, 0],
  'Majesty':        [3, 1],
  'Crusader':       [3, 5],
  'Guardian':       [3, 6],
  'Saint':          [3, 7],
  'Inquisitor':     [3, 8],
  'Shooting Star':  [4, 1],
  'Gear Master':    [4, 2],
  'Adept':          [4, 4],
  'Physician':      [4, 5],
  'Dark Summoner':  [4, 7],
  'Soul Eater':     [4, 8],
  'Blade Dancer':   [5, 1],
  'Spirit Dancer':  [5, 2],
  'Ripper':         [5, 4],
  'Raven':          [5, 5],
  'Light Fury':     [5, 7],
  'Abyss Walker':   [5, 8],
};

// Returns true if a raid type uses 4 slots instead of 8
export function isFourManRaid(raidType) {
  return raidType === '4-man' || raidType === 'DDN Normal';
}

// Every "<X> Classic" raid allows one extra Pania ticket clear per week.
export function usesTickets(raidType) {
  return / Classic$/.test(raidType || '');
}

// Returns the number of lineup slots for a given raid type
// 4-man raids have 4 slots, all others have 8
export function getLineupSize(raidType) {
  return isFourManRaid(raidType) ? 4 : 8;
}

// Display label for a raid type.
export function formatRaidTypeLabel(raidType) {
  if (raidType === '4-man') return '4-Man';
  return raidType || 'Unspecified';
}

// Get inline style for a class sprite icon background
export function getClassSpriteStyle(className) {
  const pos = CLASS_SPRITE_MAP[className];
  if (!pos) return '';
  const { cellW, cellH, gapX, gapY, offX, offY } = SPRITE_CONFIG;
  const srcX = offX + pos[1] * (cellW + gapX);
  const srcY = offY + pos[0] * (cellH + gapY);
  return `background-position: ${-srcX}px ${-srcY}px`;
}

// Game classes available for players
export const CLASSES = [
  'Gladiator',
  'Moon Lord',
  'Barbarian',
  'Destroyer',
  'Dark Avenger',
  'Sniper',
  'Artillery',
  'Tempest',
  'Wind Walker',
  'Saleana',
  'Elestra',
  'Smasher',
  'Majesty',
  'Guardian',
  'Crusader',
  'Saint',
  'Inquisitor',
  'Shooting Star',
  'Gear Master',
  'Adept',
  'Physician',
  'Dark Summoner',
  'Soul Eater',
  'Blade Dancer',
  'Spirit Dancer',
  'Ripper',
  'Raven',
  'Light Fury',
  'Abyss Walker'
];

// Damage amplification sources - each source only counts once even if multiple classes provide it
// This prevents stacking (e.g., Gladiator + Moon Lord don't stack Swordmaster amp)
export const DAMAGE_AMP_SOURCES = {
  paladin: {
    name: 'Armor Break',
    physical: 20,
    magic: 20,
    classes: ['Guardian', 'Crusader']
  },
  saint: {
    name: 'Shock Relic',
    physical: 20,
    magic: 20,
    classes: ['Saint']
  },
  forceUser: {
    name: 'Force Mirror',
    physical: 0,
    magic: 30,
    classes: ['Smasher', 'Majesty']
  },
  bowmaster: {
    name: 'Bulls Eye',
    physical: 20,
    magic: 20,
    classes: ['Sniper', 'Artillery']
  },
  swordmaster: {
    name: 'Provoking Slam',
    physical: 40,
    magic: 40,
    classes: ['Gladiator', 'Moon Lord']
  },
  engineer: {
    name: 'Mecha Duck',
    physical: 12,
    magic: 12,
    classes: ['Gear Master', 'Shooting Star']
  },
  tempest: {
    name: 'Binding Shot EX',
    physical: 30,
    magic: 0,
    classes: ['Tempest']
  },
  windwalker: {
    name: 'Blooming Kick',
    physical: 30,
    magic: 0,
    classes: ['Wind Walker']
  },
  moonlord: {
    name: 'Cyclone Slash EX',
    physical: 0,
    magic: 30,
    classes: ['Moon Lord']
  },
  physicianBoth: {
    name: 'Disease EX',
    physical: 20,
    magic: 20,
    classes: ['Physician']
  },
  screamer: {
    name: 'Summon Puppet',
    physical: 20,
    magic: 20,
    classes: ['Dark Summoner', 'Soul Eater']
  },
  destroyer: {
    name: 'Flying Swing',
    physical: 20,
    magic: 20,
    classes: ['Destroyer']
  },
  avenger: {
    name: 'Dark Stinger',
    physical: 20,
    magic: 20,
    classes: ['Dark Avenger']
  },
  abyssWalker: {
    name: 'Nightfall',
    physical: 25,
    magic: 25,
    classes: ['Abyss Walker']
  },
  lightFury: {
    name: 'Sunshine Spark',
    physical: 20,
    magic: 20,
    classes: ['Light Fury']
  },
  elestra: {
    name: 'Icy Shards',
    physical: 20,
    magic: 20,
    classes: ['Elestra']
  }
};

// Class families for filtering
export const CLASS_FAMILIES = {
  warrior: {
    name: 'Warrior',
    icon: 'warrior.png',
    classes: ['Moon Lord', 'Gladiator', 'Barbarian', 'Destroyer', 'Dark Avenger'],
    specializations: {
      swordmaster: {
        name: 'Swordmaster',
        icon: 'Swordmaster.png',
        classes: ['Moon Lord', 'Gladiator']
      },
      mercenary: {
        name: 'Mercenary',
        icon: 'Mercenary.png',
        classes: ['Barbarian', 'Destroyer']
      },
      avenger: {
        name: 'Avenger',
        icon: 'Avenger.png',
        classes: ['Dark Avenger']
      }
    }
  },
  cleric: {
    name: 'Cleric',
    icon: 'cleric.png',
    classes: ['Saint', 'Inquisitor', 'Crusader', 'Guardian'],
    specializations: {
      paladin: {
        name: 'Paladin',
        icon: 'Paladin.png',
        classes: ['Guardian', 'Crusader']
      },
      priest: {
        name: 'Priest',
        icon: 'Priest.png',
        classes: ['Saint', 'Inquisitor']
      }
    }
  },
  archer: {
    name: 'Archer',
    icon: 'archer.png',
    classes: ['Wind Walker', 'Artillery', 'Sniper', 'Tempest'],
    specializations: {
      bowmaster: {
        name: 'Bowmaster',
        icon: 'Bowmaster.png',
        classes: ['Sniper', 'Artillery']
      },
      acrobat: {
        name: 'Acrobat',
        icon: 'Acrobat.png',
        classes: ['Tempest', 'Wind Walker']
      }
    }
  },
  sorceress: {
    name: 'Sorceress',
    icon: 'sorceress.png',
    classes: ['Elestra', 'Saleana', 'Majesty', 'Smasher'],
    specializations: {
      elementalist: {
        name: 'Elemental Lord',
        icon: 'ElementalLord.png',
        classes: ['Elestra', 'Saleana']
      },
      forceuser: {
        name: 'Force User',
        icon: 'ForceUser.png',
        classes: ['Majesty', 'Smasher']
      }
    }
  },
  academic: {
    name: 'Academic',
    icon: 'academic.png',
    classes: ['Gear Master', 'Physician', 'Adept', 'Shooting Star'],
    specializations: {
      engineer: {
        name: 'Engineer',
        icon: 'Engineer.png',
        classes: ['Gear Master', 'Shooting Star']
      },
      alchemist: {
        name: 'Alchemist',
        icon: 'Alchemist.png',
        classes: ['Physician', 'Adept']
      }
    }
  },
  kali: {
    name: 'Kali',
    icon: 'kali.png',
    classes: ['Dark Summoner', 'Soul Eater', 'Blade Dancer', 'Spirit Dancer'],
    specializations: {
      screamer: {
        name: 'Screamer',
        icon: 'screamer.png',
        classes: ['Dark Summoner', 'Soul Eater']
      },
      dancer: {
        name: 'Dancer',
        icon: 'screamer.png',
        classes: ['Blade Dancer', 'Spirit Dancer']
      }
    }
  },
  assassin: {
    name: 'Assassin',
    icon: 'assassin.png',
    classes: ['Ripper', 'Raven', 'Light Fury', 'Abyss Walker'],
    specializations: {
      chaser: {
        name: 'Chaser',
        icon: 'assassin.png',
        classes: ['Ripper', 'Raven']
      },
      bringer: {
        name: 'Bringer',
        icon: 'assassin.png',
        classes: ['Light Fury', 'Abyss Walker']
      }
    }
  }
};

// Equipment rarities with color codes
export const EQUIPMENT_RARITIES = [
  { value: '', label: 'None', color: '' },
  { value: 'magic', label: 'Magic', color: '#22c55e' },
  { value: 'rare', label: 'Rare', color: '#3b82f6' },
  { value: 'epic', label: 'Epic', color: '#ff9800' },
  { value: 'unique', label: 'Unique', color: '#8f5ce0' },
  { value: 'legend', label: 'Legend', color: '#d62d49' }
];

// ============================================
// MONSTER CARDS
// ============================================
// In-game card UI: pages of 16 slots (4x4 grid) each; the card list is the game's (card-collection.js).
export const CARDS_PER_PAGE = 16;

// Equipment levels (for epic/unique/legend rarity)
export const EQUIPMENT_LEVELS = [
  { value: '70', label: 'Lv70' },
  { value: '60', label: 'Lv60' },
  { value: '50', label: 'Lv50' },
  { value: '40', label: 'Lv40' }
];

// Enhancement levels
export const ENHANCEMENT_LEVELS = [
  { value: '', label: 'Enh' },
  { value: '0', label: '+0' },
  { value: '1', label: '+1' },
  { value: '2', label: '+2' },
  { value: '3', label: '+3' },
  { value: '4', label: '+4' },
  { value: '5', label: '+5' },
  { value: '6', label: '+6' },
  { value: '7', label: '+7' },
  { value: '8', label: '+8' },
  { value: '9', label: '+9' },
  { value: '10', label: '+10' },
  { value: '11', label: '+11' },
  { value: '12', label: '+12' },
  { value: '13', label: '+13' },
  { value: '14', label: '+14' },
  { value: '15', label: '+15' }
];

// Weapon suffixes
export const WEAPON_SUFFIXES = [
  { value: '', label: 'Suffix' },
  { value: 'darkness', label: 'Darkness' },
  { value: 'destruction', label: 'Destruction' },
  { value: 'fire', label: 'Fire' },
  { value: 'harsh', label: 'Harsh' },
  { value: 'intellect', label: 'Intellect' },
  { value: 'ironwall', label: 'Iron Wall' },
  { value: 'light', label: 'Light' },
  { value: 'magic', label: 'Magic' },
  { value: 'tent', label: 'Tent' },
  { value: 'water', label: 'Water' },
  { value: 'wind', label: 'Wind' },
  { value: 'vigor', label: 'Vigor' },
  { value: 'health', label: 'Health' }
];

// Gearscore 0-100: the simulator power level as a share of a maxed character of the same class
// (src/data/reference-power.json, from tools/build-reference-power.mjs). Without a panel, attack and FD
// from the character sheet against the reference's, which ignores crit and element.

const SIM_JOB_NAMES = { 'Moon Lord': 'Moonlord' };
export const POWER_REFERENCES = referencePower;
// The reference sits at 90% crit; a typical character's crit and element leave it this share of the attack x FD ratio
// (median real / estimate over the synced roster, 2026-10-23).
const STATS_ESTIMATE_FACTOR = 0.8;

export function simJobOf(player) {
  return player.build?.second_job || SIM_JOB_NAMES[player.role] || player.role;
}

export function referencePowerFor(player) {
  return referencePower.classes[simJobOf(player)]?.power || 0;
}

export function fdToPercent(rawFd) {
  return gameFdToPercent(rawFd);
}

export function calculatePowerScore(player) {
  const ref = referencePower.classes[simJobOf(player)];
  const reference = ref?.power || 0;
  const power = Number(player.panel?.summary?.effective_panel) || 0;
  if (power > 0 && reference > 0) return { score: Math.min(100, Math.round((power / reference) * 100)), source: 'power', power, reference };
  const stats = player.characterStats || {};
  const attack = Math.max(Number(stats.attackPower) || 0, Number(stats.magicAttack) || 0);
  const fdPercent = fdToPercent(Number(stats.finalDamage) || 0);
  if (attack > 0 && ref?.attack) {
    const share = (attack * (1 + fdPercent / 100)) / (ref.attack * (1 + ref.finalPercent / 100));
    return { score: Math.min(100, Math.round(share * STATS_ESTIMATE_FACTOR * 100)), source: 'stats', power: 0, reference, attack, fdPercent };
  }
  return { score: 0, source: 'none', power: 0, reference };
}

export function powerScore(player) {
  return calculatePowerScore(player).score;
}

// 73400 -> "73.4k".
export function formatPower(raw) {
  if (raw >= 1e6) return `${(raw / 1e6).toFixed(2)}M`;
  if (raw >= 1e3) return `${(raw / 1e3).toFixed(1)}k`;
  return String(Math.round(raw));
}

// Each component of the score next to the class reference's: [{ label, value, max, share, text }].
export function powerGaps(player) {
  const ref = referencePower.classes[simJobOf(player)];
  if (!ref) return [];
  const { source, attack, fdPercent } = calculatePowerScore(player);
  const pct = (v) => `${Number(v).toFixed(1)}%`;
  const rows = [];
  const add = (label, value, max, text, maxText) => rows.push({ label, value, max, share: max > 0 ? Math.min(1, value / max) : 0, text, maxText });
  if (source === 'power') {
    const s = player.panel.summary;
    const atk = Math.max(Number(s.physical_average) || 0, Number(s.magic_average) || 0);
    add('Attack', atk, ref.attack, formatPower(atk), formatPower(ref.attack));
    add('Final damage', Number(s.final_percent) || 0, ref.finalPercent, pct(s.final_percent || 0), pct(ref.finalPercent));
    add('Crit', Number(s.crit_percent) || 0, ref.critPercent, pct(s.crit_percent || 0), pct(ref.critPercent));
    add('Crit damage', Number(s.crit_damage_percent) || 0, ref.critDamagePercent, pct(s.crit_damage_percent || 0), pct(ref.critDamagePercent));
  } else if (source === 'stats') {
    add('Attack', attack, ref.attack, formatPower(attack), formatPower(ref.attack));
    add('Final damage', fdPercent, ref.finalPercent, pct(fdPercent), pct(ref.finalPercent));
  }
  return rows;
}

export function powerTooltipText(player) {
  const { source, power, reference, attack, fdPercent } = calculatePowerScore(player);
  const gaps = powerGaps(player).map((g) => `${g.label} ${Math.round(g.share * 100)}%`).join(' · ');
  if (source === 'power') return `Gearscore · power ${formatPower(power)} of ${formatPower(reference)} for a maxed ${simJobOf(player)} · ${gaps} of max`;
  if (source === 'stats') return `Gearscore estimate from ${attack.toLocaleString()} attack and ${fdPercent.toFixed(1)}% FD, assuming typical crit · ${gaps} of max · sync for the full score`;
  return 'No gearscore yet · sync the character or add a screenshot';
}

// Badge for the power score; an estimate is dimmed and prefixed "~", no stats shows a dash.
export function renderPowerPill(player, className = 'gs-value') {
  const { score, source } = calculatePowerScore(player);
  const tier = getPowerTier(score);
  const est = source !== 'power';
  const text = source === 'power' ? score : source === 'stats' ? `~${score}` : '–';
  return `<span class="${className}${est ? ' gs-est' : ''}" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${powerTooltipText(player)}">${text}</span>`;
}

export const POWER_TIERS = [
  { min: 50, label: 'S', color: '#d62d49', bg: 'rgba(214, 45, 73, 0.15)' },
  { min: 40, label: 'A', color: '#8f5ce0', bg: 'rgba(143, 92, 224, 0.15)' },
  { min: 30, label: 'B', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.15)' },
  { min: 20, label: 'C', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  { min: 0,  label: 'D', color: '#6c757d', bg: 'rgba(108, 117, 125, 0.15)' }
];

export function getPowerTier(score) {
  return POWER_TIERS.find(t => score >= t.min) || POWER_TIERS[POWER_TIERS.length - 1];
}

// Format equipment text for display
// Uses new equipment jsonb, falls back to legacy fields
export function formatEquipmentText(type, player) {
  const equip = player.equipment || {};
  let rarity, enhance;

  if (type === 'weapon') {
    const mw = equip.mainWeapon || {};
    rarity = mw.rarity || player.weapon || '';
    enhance = mw.enhancement != null ? mw.enhancement : (player.weaponEnhance || '');
  } else {
    // Use helmet as representative for armor display
    const helm = equip.helmet || {};
    rarity = helm.rarity || player.armor || '';
    enhance = helm.enhancement != null ? helm.enhancement : (player.armorEnhance || '');
  }

  if (!rarity) return null;

  const rarityInfo = EQUIPMENT_RARITIES.find(r => r.value === rarity);
  const label = rarityInfo?.label || rarity;
  const color = rarityInfo?.color || 'inherit';
  const enhanceStr = enhance ? ' +' + enhance : '';

  return {
    html: `<span class="equipment-item" style="color: ${color}">${EQUIPMENT_ICONS[type]} ${label}${enhanceStr}</span>`,
    color,
    isLevel40: false
  };
}

// Armor slots used for the average-enhancement summary
const ARMOR_SLOTS = ['helmet', 'top', 'bottom', 'gloves', 'boots'];

function rarityInfo(rarity) {
  return EQUIPMENT_RARITIES.find(r => r.value === rarity) || null;
}

function weaponPieceChip(piece, title, abbreviate = false) {
  if (!piece || !piece.rarity) return '';
  const info = rarityInfo(piece.rarity);
  const enh = piece.enhancement != null && piece.enhancement !== '' ? ` +${piece.enhancement}` : '';
  const label = info?.label || piece.rarity;
  const shown = abbreviate ? label.charAt(0).toUpperCase() : label;
  const tip = abbreviate ? `${title} — ${label}` : title;
  return `<span class="equip-piece" style="color: ${info?.color || 'inherit'}" title="${tip}">${shown}${enh}</span>`;
}

// Generate compact equipment + suffix summary HTML for a player.
// Layout: weapons row (main + sub w/ enhance), armor row (avg enhance).
// options.abbreviateRarity collapses rarity names to a single letter (E/U/L…)
// for tight layouts; the full name stays in the chip's tooltip.
export function formatPlayerEquipmentHtml(player, cssClass = 'player-equipment', options = {}) {
  const { abbreviateRarity = false } = options;
  const equip = player.equipment || {};

  // Weapons: main + sub
  const main = equip.mainWeapon || (player.weapon ? { rarity: player.weapon, enhancement: player.weaponEnhance } : null);
  const sub = equip.subWeapon || null;
  const weaponChips = [
    weaponPieceChip(main, 'Main weapon', abbreviateRarity),
    weaponPieceChip(sub, 'Sub weapon', abbreviateRarity)
  ].filter(Boolean);

  // Armor: average enhancement across present pieces
  const armorPieces = ARMOR_SLOTS.map(s => equip[s]).filter(p => p && p.rarity);
  let armorChip = '';
  if (armorPieces.length > 0) {
    const enhVals = armorPieces.map(p => Number(p.enhancement) || 0);
    const avg = enhVals.reduce((a, b) => a + b, 0) / armorPieces.length;
    const avgStr = Number.isInteger(avg) ? `+${avg}` : `+${avg.toFixed(1)}`;

    const counts = {};
    armorPieces.forEach(p => { counts[p.rarity] = (counts[p.rarity] || 0) + 1; });
    const rarities = Object.keys(counts);
    let label, color;
    if (rarities.length === 1) {
      const info = rarityInfo(rarities[0]);
      const full = info?.label || rarities[0];
      label = abbreviateRarity ? full.charAt(0).toUpperCase() : full;
      color = info?.color || 'inherit';
    } else {
      const dominant = rarities.sort((a, b) => counts[b] - counts[a])[0];
      const info = rarityInfo(dominant);
      label = abbreviateRarity ? 'Mix' : 'Mixed';
      color = info?.color || 'inherit';
    }
    const title = `Avg of ${armorPieces.length} armor piece${armorPieces.length === 1 ? '' : 's'}`;
    armorChip = `<span class="equip-piece" style="color: ${color}" title="${title}">${label} ${avgStr}<span class="equip-avg-tag"> (avg)</span></span>`;
  } else if (player.armor) {
    const info = rarityInfo(player.armor);
    const full = info?.label || player.armor;
    const label = abbreviateRarity ? full.charAt(0).toUpperCase() : full;
    const enh = player.armorEnhance ? ` +${player.armorEnhance}` : '';
    armorChip = `<span class="equip-piece" style="color: ${info?.color || 'inherit'}">${label}${enh}</span>`;
  }

  let html = '';
  if (weaponChips.length > 0 || armorChip) {
    html += `<div class="${cssClass}">`;
    if (weaponChips.length > 0) {
      html += `<div class="equip-row equip-row--weapons"><span class="equip-row-icon">${EQUIPMENT_ICONS.weapon}</span>${weaponChips.join('<span class="equip-sep">/</span>')}</div>`;
    }
    if (armorChip) {
      html += `<div class="equip-row equip-row--armor"><span class="equip-row-icon">${EQUIPMENT_ICONS.armor}</span>${armorChip}</div>`;
    }
    html += `</div>`;
  }

  const suffixes = [];
  if (player.suffix1) {
    const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
    suffixes.push(s?.label || player.suffix1);
  }
  if (player.suffix2) {
    const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
    suffixes.push(s?.label || player.suffix2);
  }
  if (suffixes.length > 0) {
    html += `<div class="player-suffixes">${suffixes.join(' + ')}</div>`;
  }

  return html;
}

// SVG icons for equipment
export const EQUIPMENT_ICONS = {
  weapon: `<svg width="16" height="16" viewBox="0 0 290.226 290.226" fill="currentColor">
    <path d="M63.951,243.575c-1.945-3.578-4.401-6.907-7.363-9.869c-3.106-3.102-6.626-5.633-10.4-7.63c-4.51-2.387-0.945-7.5-0.945-7.5c4.616-7.023,8.825-14.079,12.305-20.226l-23.363-23.344H11.504c-4.362,0-7.898-3.539-7.898-7.902c0-4.361,3.536-7.9,7.898-7.9h25.947c2.1,0,4.107,0.832,5.588,2.312l85.379,85.291c1.483,1.483,2.315,3.495,2.315,5.589v26.073c0,4.365-3.537,7.897-7.9,7.897c-4.367,0-7.904-3.531-7.904-7.897v-22.798l-23.27-23.24c-6.281,3.707-13.582,8.252-20.816,13.25C70.842,245.679,66.698,248.629,63.951,243.575z"/>
    <path d="M26.61,237.102c-7.106,0-13.784,2.764-18.812,7.784c-5.019,5.015-7.782,11.686-7.782,18.778c0,7.097,2.764,13.762,7.782,18.776c5.027,5.016,11.706,7.783,18.812,7.785c7.102,0,13.781-2.77,18.804-7.785c5.023-5.015,7.79-11.682,7.79-18.776c0-7.093-2.768-13.764-7.79-18.778C40.392,239.866,33.712,237.102,26.61,237.102z"/>
    <path d="M100.985,182.318c-3.502,3.499-9.232,3.499-12.734,0.001l-8.81-8.801c-3.502-3.498-3.502-9.223,0-12.721L229.832,10.564c3.502-3.498,10.401-6.727,15.33-7.175l36.862-3.352c4.93-0.448,8.596,3.218,8.148,8.148l-3.346,36.791c-0.448,4.93-3.68,11.825-7.182,15.324l-150.4,150.251c-3.502,3.498-9.232,3.498-12.734,0l-8.822-8.813c-3.502-3.498-3.502-9.223,0-12.722L233.608,63.213c1.854-1.848,1.856-4.852,0.003-6.702c-1.848-1.853-4.853-1.853-6.709-0.002L100.985,182.318z"/>
  </svg>`,
  armor: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
    <path d="M156.7 25.83L89 39.38c-.1 58.57-1.74 119.32-43.49 167.22C104.4 246.5 189 260.7 247 248.8v-99L108.3 88.22l7.4-16.44L256 134.2l140.3-62.42 7.4 16.44L265 149.8v99c58 11.9 142.6-2.3 201.5-42.2-41.8-47.9-43.4-108.65-43.5-167.22l-67.7-13.55c-12.9 13.88-20.6 28.15-32.9 40.53C308.9 79.78 289.5 89 256 89c-33.5 0-52.9-9.22-66.4-22.64-12.3-12.38-20-26.65-32.9-40.53zM53.88 232.9C75.96 281 96.07 336.6 102.7 392.8l65 22.8c4.2-52.7 28.2-104 63.7-146.1-55.1 6.3-122.7-5.8-177.52-36.6zm404.22 0c-54.8 30.8-122.4 42.9-177.5 36.6 35.5 42.1 59.5 93.4 63.7 146.1l65.2-22.9c6.6-56.8 26.6-111.8 48.6-159.8zM256 269c-40.5 43.1-67.7 97.9-70.7 152.7l61.7 21.6V336h18v107.3l61.7-21.6c-3.1-54.8-30.2-109.6-70.7-152.7zm151.7 143.4L297 451.1v18.8l110.2-44.1c.1-4.5.3-8.9.5-13.4zm-303.3.1c.3 4.5.4 8.9.5 13.4l110.1 44v-18.7l-110.6-38.7zM279 457.4l-23 8.1-23-8v19.6l23 9.2 23-9.2v-19.7z"/>
  </svg>`
};

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
  // 1st specializations
  'Swordmaster':    [0, 8],
  'Mercenary':      [1, 0],
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
  // Final classes
  'Gladiator':      [1, 2],
  'Moon Lord':      [1, 3],
  'Barbarian':      [1, 4],
  'Destroyer':      [1, 5],
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
};

// Returns true if a raid type uses 4 slots instead of 8
export function isFourManRaid(raidType) {
  return raidType === '4-man' || raidType === 'DDN Normal';
}

// Returns the number of lineup slots for a given raid type
// 4-man raids have 4 slots, all others have 8
export function getLineupSize(raidType) {
  return isFourManRaid(raidType) ? 4 : 8;
}

// Display label for a raid type — legacy "Hardcore"/"Classic" map to GDN
export function formatRaidTypeLabel(raidType) {
  const rt = raidType || 'Hardcore';
  if (rt === 'Unspecified') return 'Unspecified';
  if (rt === '4-man') return '4-Man';
  if (rt === 'Hardcore' || rt === 'Classic') return `GDN ${rt}`;
  return rt;
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
  'Spirit Dancer'
];

// Damage amplification sources - each source only counts once even if multiple classes provide it
// This prevents stacking (e.g., Gladiator + Moon Lord don't stack Swordmaster amp)
export const DAMAGE_AMP_SOURCES = {
  paladin: {
    name: 'Armor Break',
    physical: 16,
    magic: 16,
    classes: ['Guardian', 'Crusader']
  },
  saint: {
    name: 'Shock Relic',
    physical: 14,
    magic: 14,
    classes: ['Saint']
  },
  forceUser: {
    name: 'Force Mirror',
    physical: 0,
    magic: 26,
    classes: ['Smasher', 'Majesty']
  },
  bowmaster: {
    name: 'Bulls Eye',
    physical: 16,
    magic: 16,
    classes: ['Sniper', 'Artillery']
  },
  swordmaster: {
    name: 'Provoking Slam',
    physical: 35,
    magic: 35,
    classes: ['Gladiator', 'Moon Lord']
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
  physicianMagic: {
    name: 'Love Virus',
    physical: 8,
    magic: 8,
    classes: ['Physician']
  },
  physicianBoth: {
    name: 'Disease EX',
    physical: 10,
    magic: 10,
    classes: ['Physician']
  },
  screamer: {
    name: 'Summon Puppet',
    physical: 18,
    magic: 18,
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
    classes: ['Avenger']
  }
};

// Class families for filtering
export const CLASS_FAMILIES = {
  warrior: {
    name: 'Warrior',
    icon: 'warrior.png',
    classes: ['Moon Lord', 'Gladiator', 'Barbarian', 'Destroyer'],
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
  }
};

// Equipment rarities with color codes
export const EQUIPMENT_RARITIES = [
  { value: '', label: 'None', color: '' },
  { value: 'rare', label: 'Rare', color: '#3b82f6' },
  { value: 'epic', label: 'Epic', color: '#ff9800' },
  { value: 'unique', label: 'Unique', color: '#8f5ce0' },
  { value: 'legend', label: 'Legend', color: '#d62d49' }
];

// Equipment levels (for epic/unique/legend rarity)
export const EQUIPMENT_LEVELS = [
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

// Gearscore calculation
// Weighted 0-100 scale based on equipment rarity, level, enhancement, and suffixes
// Gearscore formula: 60% gear, 40% FD
// Gear: 7 equipment (rarity + enhancement) + 4 accessories (rarity only)
// FD: percentage of community-found cap, using breakpoint table

const GS_RARITY_PERCENT = { legend: 1.0, unique: 0.65, epic: 0.35, rare: 0.15, magic: 0.05, normal: 0, '': 0 };
const GS_ENHANCE_PERCENT = { 15: 1.0, 14: 0.85, 13: 0.7, 12: 0.55, 11: 0.4, 10: 0.28, 9: 0.18, 0: 0 };

const GEAR_WEIGHT = 60;
const FD_WEIGHT = 40;
const EQUIP_TOTAL = GEAR_WEIGHT * 0.7; // 42 pts for 7 equipment pieces
const ACCESSORY_TOTAL = GEAR_WEIGHT * 0.3; // 18 pts for 4 accessories
const PER_EQUIP = EQUIP_TOTAL / 7;
const PER_ACCESSORY = ACCESSORY_TOTAL / 4;

// FD table — loaded from Supabase via setFdTable()
let _fdTable = [];

export function setFdTable(table) {
  if (table && table.length > 0) _fdTable = table;
}

export function getFdTable() {
  return _fdTable;
}

export function fdToPercent(rawFd, fdTable) {
  if (!rawFd || rawFd <= 0) return 0;
  const table = fdTable || _fdTable;
  if (!table || table.length === 0) return 0;
  if (rawFd <= table[0].fd) return (rawFd / table[0].fd) * table[0].pct;
  const max = table[table.length - 1];
  if (rawFd >= max.fd) return max.pct;
  for (let i = 0; i < table.length - 1; i++) {
    if (rawFd >= table[i].fd && rawFd < table[i + 1].fd) {
      const range = table[i + 1].fd - table[i].fd;
      const progress = (rawFd - table[i].fd) / range;
      return table[i].pct + progress * (table[i + 1].pct - table[i].pct);
    }
  }
  return max.pct;
}

export function calculateGearscore(player) {
  const equip = player.equipment || {};
  const stats = player.characterStats || {};

  const equipSlots = ['helmet', 'top', 'bottom', 'gloves', 'boots', 'mainWeapon', 'subWeapon'];
  const accessorySlots = ['necklace', 'earring', 'ring1', 'ring2'];

  let gearScore = 0;
  let hasAnyGear = false;

  // Equipment: rarity (50%) + enhancement (50%) per piece
  equipSlots.forEach(slot => {
    const piece = equip[slot];
    if (!piece?.rarity) return;
    hasAnyGear = true;
    const r = GS_RARITY_PERCENT[piece.rarity] || 0;
    const e = GS_ENHANCE_PERCENT[piece.enhancement] || 0;
    gearScore += PER_EQUIP * (r * 0.5 + e * 0.5);
  });

  // Accessories: rarity only
  accessorySlots.forEach(slot => {
    const piece = equip[slot];
    if (!piece?.rarity) return;
    hasAnyGear = true;
    gearScore += PER_ACCESSORY * (GS_RARITY_PERCENT[piece.rarity] || 0);
  });

  // FD portion
  const fd = stats.finalDamage || 0;
  const maxPct = _fdTable.length > 0 ? _fdTable[_fdTable.length - 1].pct : 0;
  const fdPct = fdToPercent(fd);
  const fdScore = maxPct > 0 ? FD_WEIGHT * (fdPct / maxPct) : 0;

  // If no equipment data at all and no FD, fall back to legacy calculation
  if (!hasAnyGear && !fd) {
    return calculateGearscoreLegacy(player);
  }

  return Math.round(gearScore + fdScore);
}

// Legacy formula for characters that haven't been updated yet
function calculateGearscoreLegacy(player) {
  const weaponRarityPoints = { '': 0, 'epic': 5, 'unique': 15, 'legend': 22 };
  const armorRarityPoints = { '': 0, 'epic': 4, 'unique': 12, 'legend': 18 };
  const weaponEnhancePoints = { '': 5, '9': 5, '10': 9, '11': 13, '12': 18, '13': 22, '14': 26, '15': 30 };
  const armorEnhancePoints = { '': 3, '9': 3, '10': 6, '11': 8, '12': 11, '13': 14, '14': 17, '15': 20 };

  const wr = weaponRarityPoints[player.weapon || ''] || 0;
  const ar = armorRarityPoints[player.armor || ''] || 0;
  const we = player.weapon ? (weaponEnhancePoints[player.weaponEnhance || ''] || 5) : 0;
  const ae = player.armor ? (armorEnhancePoints[player.armorEnhance || ''] || 3) : 0;
  const suffixCount = [player.suffix1, player.suffix2].filter(s => s && s !== '').length;

  return wr + ar + we + ae + (suffixCount * 5);
}

// Gearscore tier thresholds and colors
export const GEARSCORE_TIERS = [
  { min: 60, label: 'S', color: '#d62d49', bg: 'rgba(214, 45, 73, 0.15)' },
  { min: 45, label: 'A', color: '#8f5ce0', bg: 'rgba(143, 92, 224, 0.15)' },
  { min: 30, label: 'B', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.15)' },
  { min: 15, label: 'C', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  { min: 0,  label: 'D', color: '#6c757d', bg: 'rgba(108, 117, 125, 0.15)' }
];

export function getGearscoreTier(score) {
  return GEARSCORE_TIERS.find(t => score >= t.min) || GEARSCORE_TIERS[GEARSCORE_TIERS.length - 1];
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

// Generate compact equipment + suffix + FD summary HTML for a player
// Used across lineups, lineup editor, and player selector
export function formatPlayerEquipmentHtml(player, cssClass = 'player-equipment') {
  const parts = [];

  const weaponEquip = formatEquipmentText('weapon', player);
  if (weaponEquip) parts.push(weaponEquip.html);
  const armorEquip = formatEquipmentText('armor', player);
  if (armorEquip) parts.push(armorEquip.html);

  const suffixes = [];
  if (player.suffix1) {
    const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
    suffixes.push(s?.label || player.suffix1);
  }
  if (player.suffix2) {
    const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
    suffixes.push(s?.label || player.suffix2);
  }

  let html = '';
  if (parts.length > 0) {
    html += `<div class="${cssClass}">${parts.join(' ')}</div>`;
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

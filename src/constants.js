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
  'Screamer'
];

// Damage amplification sources - each source only counts once even if multiple classes provide it
// This prevents stacking (e.g., Gladiator + Moon Lord don't stack Swordmaster amp)
export const DAMAGE_AMP_SOURCES = {
  paladin: {
    name: 'Armor Break',
    physical: 18,
    magic: 18,
    classes: ['Guardian', 'Crusader']
  },
  priest: {
    name: 'Shock Relic',
    physical: 14,
    magic: 14,
    classes: ['Inquisitor', 'Saint']
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
    physical: 19,
    magic: 19,
    classes: ['Screamer']
  }
};

// Class families for filtering
export const CLASS_FAMILIES = {
  warrior: {
    name: 'Warrior',
    icon: 'warrior.png',
    classes: ['Moon Lord', 'Gladiator', 'Barbarian', 'Destroyer']
  },
  cleric: {
    name: 'Cleric',
    icon: 'cleric.png',
    classes: ['Saint', 'Inquisitor', 'Crusader', 'Guardian']
  },
  archer: {
    name: 'Archer',
    icon: 'archer.png',
    classes: ['Wind Walker', 'Artillery', 'Sniper', 'Tempest']
  },
  sorceress: {
    name: 'Sorceress',
    icon: 'sorceress.png',
    classes: ['Elestra', 'Saleana', 'Majesty', 'Smasher']
  },
  academic: {
    name: 'Academic',
    icon: 'academic.png',
    classes: ['Gear Master', 'Physician', 'Adept', 'Shooting Star']
  }
};

// Equipment rarities with color codes
export const EQUIPMENT_RARITIES = [
  { value: '', label: 'None', color: '' },
  { value: 'epic', label: 'Epic', color: '#ff9800' },
  { value: 'unique', label: 'Unique', color: '#8f5ce0' },
  { value: 'legend', label: 'Legend', color: '#d62d49' }
];

// Enhancement levels
export const ENHANCEMENT_LEVELS = [
  { value: '', label: 'None' },
  { value: '9', label: '+9' },
  { value: '10', label: '+10' },
  { value: '11', label: '+11' },
  { value: '12', label: '+12' },
  { value: '13', label: '+13' },
  { value: '14', label: '+14' }

];

// Weapon suffixes
export const WEAPON_SUFFIXES = [
  { value: '', label: 'None' },
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

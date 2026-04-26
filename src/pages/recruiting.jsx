import { dataService } from '../data.js';
import { calculateGearscore, getGearscoreTier, getClassSpriteStyle, EQUIPMENT_ICONS, CLASS_FAMILIES, CLASSES } from '../constants.js';
import { toast } from '../toast.js';
import { PlayersPage } from './players.jsx';

// Party accent colors
const PARTY_COLORS = [
  { main: '#4a9eff', glow: 'rgba(74, 158, 255, 0.35)' },
  { main: '#4ece73', glow: 'rgba(78, 206, 115, 0.35)' },
  { main: '#c084fc', glow: 'rgba(192, 132, 252, 0.35)' },
  { main: '#fb923c', glow: 'rgba(251, 146, 60, 0.35)' },
  { main: '#f472b6', glow: 'rgba(244, 114, 182, 0.35)' },
  { main: '#22d3ee', glow: 'rgba(34, 211, 238, 0.35)' },
];

const RARITY_CLASSES = new Set(['legend', 'unique', 'epic', 'rare']);

function fmtEnh(n, rarity) {
  if (n == null) return `<span class="chip-tip__dash">–</span>`;
  const cls = RARITY_CLASSES.has(rarity) ? rarity : 'low';
  return `<span class="chip-tip__val chip-tip__val--${cls}">+${n}</span>`;
}

function renderChipTip(player) {
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

  return `<div class="chip-tip" role="tooltip">${weaponSection}${armorSection}${fdSection}</div>`;
}

function setupMobileTooltips(container, { skipFilledChips = false } = {}) {
  const selector = skipFilledChips ? '[data-tooltip]' : '[data-tooltip], .slot-chip--filled';
  const tooltipEls = container.querySelectorAll(selector);
  tooltipEls.forEach(el => {
    const hasTip = el.hasAttribute('data-tooltip') || el.querySelector('.chip-tip');
    if (!hasTip) return;
    el.addEventListener('touchstart', (e) => {
      const wasVisible = el.classList.contains('tooltip-visible');
      container.querySelectorAll('.tooltip-visible').forEach(t => t.classList.remove('tooltip-visible'));
      if (!wasVisible) {
        el.classList.add('tooltip-visible');
        e.preventDefault();
      }
    }, { passive: false });
  });

  container.addEventListener('touchstart', (e) => {
    if (!e.target.closest(selector)) {
      container.querySelectorAll('.tooltip-visible').forEach(t => t.classList.remove('tooltip-visible'));
    }
  });
}

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 768px)').matches;
}

const CONFIG_KEY = 'recruiting_lineups';
const ACTIVE_CLASSES_KEY = 'recruiting_active_classes';

export const RecruitingPage = {
  allPlayers: [],
  _fullPlayers: [],
  _userMap: {},
  parties: [],
  activeClasses: [],
  isEditMode: false,
  isDirty: false,
  _container: null,

  async render(container) {
    this._container = container;
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = 'none';

    await dataService.loadSession();
    this.isEditMode = dataService.isAdmin();

    container.innerHTML = `
      <div class="recruiting-page">
        <div class="recruiting-hero">
          <h1 class="recruiting-hero__title">Afterlight Guild</h1>
          <p class="recruiting-hero__subtitle">Raid Recruitment</p>
          <div class="recruiting-hero__divider"></div>
          <p class="recruiting-hero__desc">We run raids together weekly. Goal is <span class="recruiting-hero__gs tooltip-wrap" data-tooltip="Legend +12 Weapons&#10;Legend +10 Armor&#10;Legend Accessories&#10;~950 FD">65 Gearscore</span> for DDN parties.</p>
        </div>
        ${this.isEditMode ? `
          <div class="recruiting-admin-toolbar">
            <button id="recruiting-new-party" class="btn btn-ghost">+ New Party</button>
            <button id="recruiting-save" class="btn btn-primary">Save Layout</button>
          </div>
        ` : ''}
        <div class="recruiting-loading">Loading roster...</div>
        <div class="recruiting-content" id="recruiting-content"></div>
      </div>
    `;

    try {
      const [players, appUsers] = await Promise.all([
        dataService.getPlayers(),
        dataService.getAppUsers().catch(() => []),
      ]);
      const playersWithGs = players.map(p => {
        p._gearscore = calculateGearscore(p);
        return p;
      });
      this._fullPlayers = playersWithGs;
      this._userMap = {};
      (appUsers || []).forEach(u => { this._userMap[u.discordId] = u; });
      this.allPlayers = playersWithGs.filter(p => p._gearscore >= 65);

      let saved = await dataService.getAppConfig(CONFIG_KEY);
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch { saved = null; }
      }
      if (saved && Array.isArray(saved) && saved.length > 0) {
        const validNames = new Set(this.allPlayers.map(p => p.name));
        this.parties = saved.map(party => ({
          tank: party.tank && validNames.has(party.tank) ? party.tank : null,
          healer: party.healer && validNames.has(party.healer) ? party.healer : null,
          dps: (party.dps || []).map(name => name && validNames.has(name) ? name : null),
        }));
      } else {
        this.parties = [];
      }

      let savedActive = await dataService.getAppConfig(ACTIVE_CLASSES_KEY);
      if (typeof savedActive === 'string') {
        try { savedActive = JSON.parse(savedActive); } catch { savedActive = null; }
      }
      this.activeClasses = Array.isArray(savedActive) ? savedActive.filter(c => CLASSES.includes(c)) : [];

      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.remove();

      this.renderContent();

      if (this.isEditMode) {
        document.getElementById('recruiting-new-party')?.addEventListener('click', () => this.addParty());
        document.getElementById('recruiting-save')?.addEventListener('click', () => this.saveLayout());
      }
    } catch (err) {
      console.error('Failed to load recruiting data:', err);
      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load roster data.';
    }
  },

  getAssignedNames() {
    const names = new Set();
    this.parties.forEach(party => {
      if (party.tank) names.add(party.tank);
      if (party.healer) names.add(party.healer);
      (party.dps || []).forEach(n => { if (n) names.add(n); });
    });
    return names;
  },

  renderContent() {
    const content = document.getElementById('recruiting-content');
    if (!content) return;

    const playerMap = {};
    this.allPlayers.forEach(p => { playerMap[p.name] = p; });
    const assignedNames = this.getAssignedNames();
    const unassigned = this.allPlayers.filter(p => !assignedNames.has(p.name));

    content.innerHTML = `
      ${this.renderStatsBar()}
      ${this.renderPartyGrid(playerMap)}
      ${this.isEditMode ? this.renderUnassignedPool(unassigned) : ''}
      ${this.renderActivelyRecruiting()}
      <div class="players-page recruiting-roster-host">
        <h3 class="recruiting-roster-host__title">Guild Roster</h3>
        <div id="recruiting-roster-list"></div>
      </div>
    `;

    const rosterEl = document.getElementById('recruiting-roster-list');
    if (rosterEl && this._fullPlayers) {
      PlayersPage._gsFilter = 65;
      PlayersPage.renderRosterView(rosterEl, this._fullPlayers, this._userMap);
    }

    const touch = isTouchDevice();
    setupMobileTooltips(this._container, { skipFilledChips: this.isEditMode && touch });

    if (this.isEditMode) {
      this.setupDragAndDrop();
      this.setupPoolDragHandlers();
      if (touch) this.setupPickerTaps();
      content.querySelectorAll('.party-card__delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteParty(parseInt(btn.dataset.partyIndex));
        });
      });
      const editBtn = content.querySelector('.actively-recruiting__edit');
      if (editBtn) editBtn.addEventListener('click', () => this.openActiveClassesEditor());
    }
  },

  calculateStats() {
    let openSlots = 0;
    this.parties.forEach(p => {
      if (!p.tank) openSlots++;
      if (!p.healer) openSlots++;
      for (let d = 0; d < 6; d++) if (!(p.dps && p.dps[d])) openSlots++;
    });
    return { openSlots, partyCount: this.parties.length };
  },

  renderStatsBar() {
    if (this.parties.length === 0 && !this.isEditMode) {
      return `<div class="recruiting-empty">
        <p>No raid parties configured yet.</p>
        <p>Check back soon!</p>
      </div>`;
    }
    if (this.parties.length === 0 && this.isEditMode) {
      return `<div class="recruiting-empty">
        <p>No parties yet. Click <strong>+ New Party</strong> to get started.</p>
      </div>`;
    }
    const stats = this.calculateStats();
    const partyLabel = stats.partyCount === 1 ? 'DDN ready party' : 'DDN ready parties';
    const slotLabel = stats.openSlots === 1 ? 'slot' : 'slots';
    if (stats.openSlots === 0) {
      return `<div class="recruiting-stats recruiting-stats--full">
        <span class="recruiting-stats__text">All ${stats.partyCount} ${partyLabel} are full — but we'll always make room for a great fit.</span>
      </div>`;
    }
    return `<div class="recruiting-stats">
      <span class="recruiting-stats__big">${stats.openSlots}</span>
      <span class="recruiting-stats__text">open ${slotLabel} across ${stats.partyCount} ${partyLabel}</span>
    </div>`;
  },

  renderPartyGrid(playerMap) {
    if (this.parties.length === 0) return '';
    const cards = this.parties.map((party, i) => this.renderPartyCard(party, i, playerMap)).join('');
    return `<div class="party-grid">${cards}</div>`;
  },

  renderPartyCard(party, partyIndex, playerMap) {
    const color = PARTY_COLORS[partyIndex % PARTY_COLORS.length];
    const filled = (party.tank ? 1 : 0) + (party.healer ? 1 : 0) + (party.dps || []).filter(Boolean).length;
    const deleteBtn = this.isEditMode
      ? `<button class="party-card__delete" data-party-index="${partyIndex}" title="Delete party">×</button>`
      : '';

    const tankChip = this.renderSlotChip(party.tank, partyIndex, 'tank', 0, 'Guardian', playerMap);
    const healerChip = this.renderSlotChip(party.healer, partyIndex, 'healer', 0, 'Saint', playerMap);
    const dpsChips = [];
    for (let d = 0; d < 6; d++) {
      const name = (party.dps || [])[d] || null;
      dpsChips.push(this.renderSlotChip(name, partyIndex, 'dps', d, 'DPS', playerMap));
    }

    return `<div class="party-card" style="--party-color: ${color.main}; --party-glow: ${color.glow}">
      <div class="party-card__header">
        <span class="party-card__name">Party ${partyIndex + 1}</span>
        <span class="party-card__count ${filled === 8 ? 'party-card__count--full' : ''}">${filled}/8</span>
        ${deleteBtn}
      </div>
      <div class="party-card__slots">
        ${tankChip}
        ${healerChip}
        ${dpsChips.join('')}
      </div>
    </div>`;
  },

  renderSlotChip(playerName, partyIndex, slotType, slotIdx, slotLabel, playerMap) {
    const slotKey = `${partyIndex}-${slotType}-${slotIdx}`;
    const droppable = this.isEditMode ? 'data-droppable="true"' : '';
    const slotTypeClass = `slot-chip--${slotType}`;

    const player = playerName ? playerMap[playerName] : null;

    if (!player) {
      const placeholder = this.isEditMode ? '+' : '?';
      return `<div class="slot-chip slot-chip--empty ${slotTypeClass}" data-party="${partyIndex}" data-slot-key="${slotKey}" ${droppable}>
        <div class="slot-chip__icon-placeholder">${placeholder}</div>
        <div class="slot-chip__label">${slotLabel}</div>
        <div class="slot-chip__sub">Open</div>
      </div>`;
    }

    const gs = player._gearscore || 0;
    const tier = getGearscoreTier(gs);
    const spriteStyle = getClassSpriteStyle(player.role);
    const draggable = this.isEditMode ? 'draggable="true"' : '';

    const tipHtml = renderChipTip(player);

    return `<div class="slot-chip slot-chip--filled ${slotTypeClass}" data-party="${partyIndex}" data-slot-key="${slotKey}" data-player-name="${player.name}" ${draggable} ${droppable}
              style="--tier-color: ${tier.color}">
      <div class="slot-chip__icon">
        <span class="class-sprite" style="${spriteStyle}"></span>
      </div>
      <div class="slot-chip__class">${player.role}</div>
      ${this.isEditMode ? `<div class="slot-chip__name">${player.name}</div>` : ''}
      <div class="slot-chip__gs" style="color: ${tier.color}">${gs}</div>
      ${tipHtml}
    </div>`;
  },

  renderUnassignedPool(unassigned) {
    if (unassigned.length === 0) {
      return '<div class="recruit-pool"><p class="recruit-pool__empty">All characters assigned!</p></div>';
    }

    const cards = unassigned.map(player => {
      const gs = player._gearscore || 0;
      const tier = getGearscoreTier(gs);
      const spriteStyle = getClassSpriteStyle(player.role);
      return `<div class="recruit-pool__card" draggable="true" data-player-name="${player.name}" title="${player.name} — ${player.role} (${gs})">
        <div class="recruit-pool__icon">
          <span class="class-sprite" style="${spriteStyle}"></span>
        </div>
        <div class="recruit-pool__details">
          <span class="recruit-pool__name">${player.name}</span>
          <span class="recruit-pool__class">${player.role}</span>
        </div>
        <span class="recruit-pool__gs" style="color: ${tier.color}">${gs}</span>
      </div>`;
    }).join('');

    return `<div class="recruit-pool">
      <h3 class="recruit-pool__title">Available Characters</h3>
      <div class="recruit-pool__grid">${cards}</div>
    </div>`;
  },

  setupPoolDragHandlers() {
    const cards = this._container.querySelectorAll('.recruit-pool__card');
    cards.forEach(card => {
      const playerName = card.dataset.playerName;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', playerName);
        e.dataTransfer.setData('sourceSlotKey', `pool-${playerName}`);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      this.attachTouchDrag(card, { playerName, sourceSlotKey: `pool-${playerName}`, ghostClass: 'recruit-pool__card--ghost' });
    });
  },

  addParty() {
    this.parties.push({ tank: null, healer: null, dps: [null, null, null, null, null, null] });
    this.isDirty = true;
    this.renderContent();
  },

  deleteParty(partyIndex) {
    if (partyIndex < 0 || partyIndex >= this.parties.length) return;
    this.parties.splice(partyIndex, 1);
    this.isDirty = true;
    this.renderContent();
  },

  async saveLayout() {
    try {
      const toSave = this.parties.map(p => ({
        tank: p.tank || null,
        healer: p.healer || null,
        dps: (p.dps || []).map(d => d || null),
      }));
      await dataService.setAppConfig(CONFIG_KEY, JSON.stringify(toSave));
      this.isDirty = false;
      toast.show('Layout saved!', 'success');
    } catch (err) {
      console.error('Failed to save layout:', err);
      toast.show('Failed to save layout', 'error');
    }
  },

  assignToSlot(slotKey, playerName) {
    const [partyStr, slotType, slotIdxStr] = slotKey.split('-');
    const partyIndex = parseInt(partyStr);
    const slotIdx = parseInt(slotIdxStr);
    const party = this.parties[partyIndex];
    if (!party) return null;

    let displaced = null;
    if (slotType === 'tank') {
      displaced = party.tank;
      party.tank = playerName;
    } else if (slotType === 'healer') {
      displaced = party.healer;
      party.healer = playerName;
    } else if (slotType === 'dps') {
      displaced = party.dps[slotIdx];
      party.dps[slotIdx] = playerName;
    }
    return displaced;
  },

  removeFromSlot(slotKey) {
    return this.assignToSlot(slotKey, null);
  },

  setupDragAndDrop() {
    const allChips = this._container.querySelectorAll('.slot-chip');

    allChips.forEach(chip => {
      chip.addEventListener('dragstart', (e) => {
        const playerName = chip.dataset.playerName;
        if (!playerName) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', playerName);
        e.dataTransfer.setData('sourceSlotKey', chip.dataset.slotKey || '');
        chip.classList.add('dragging');
      });

      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));

      if (chip.dataset.droppable === 'true') {
        chip.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          chip.classList.add('drag-over');
        });

        chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));

        chip.addEventListener('drop', (e) => {
          e.preventDefault();
          chip.classList.remove('drag-over');

          const playerName = e.dataTransfer.getData('text/plain');
          const sourceSlotKey = e.dataTransfer.getData('sourceSlotKey');
          const targetSlotKey = chip.dataset.slotKey;

          if (!playerName || !targetSlotKey) return;

          const isFromPool = sourceSlotKey.startsWith('pool-');
          const isFromSlot = sourceSlotKey && !isFromPool;
          const targetCurrentPlayer = chip.dataset.playerName || null;

          if (isFromSlot) {
            if (sourceSlotKey === targetSlotKey) return;
            this.assignToSlot(targetSlotKey, playerName);
            this.assignToSlot(sourceSlotKey, targetCurrentPlayer);
          } else {
            if (targetCurrentPlayer) this.removeFromSlot(targetSlotKey);
            this.assignToSlot(targetSlotKey, playerName);
          }

          this.isDirty = true;
          this.renderContent();
        });
      }

      if (this.isEditMode) {
        chip.addEventListener('dblclick', () => {
          const playerName = chip.dataset.playerName;
          const slotKey = chip.dataset.slotKey;
          if (!playerName || !slotKey) return;
          this.removeFromSlot(slotKey);
          this.isDirty = true;
          this.renderContent();
        });
      }
    });
  },

  setupPickerTaps() {
    const chips = this._container.querySelectorAll('.slot-chip[data-slot-key]');
    chips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.party-card__delete')) return;
        const slotKey = chip.dataset.slotKey;
        if (!slotKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.openSlotPicker(slotKey);
      });

      const playerName = chip.dataset.playerName;
      if (playerName) {
        this.attachTouchDrag(chip, { playerName, sourceSlotKey: chip.dataset.slotKey, ghostClass: 'slot-chip--ghost' });
      }
    });
  },

  renderPickerCard(player, action) {
    const gs = player._gearscore || 0;
    const tier = getGearscoreTier(gs);
    const spriteStyle = getClassSpriteStyle(player.role);
    const draggable = action === 'assign' ? 'draggable="true"' : '';
    return `<button class="slot-picker-card slot-picker-card--${action}" data-action="${action}" data-player-name="${player.name}" ${draggable}>
      <span class="slot-picker-card__icon"><span class="class-sprite" style="${spriteStyle}"></span></span>
      <span class="slot-picker-card__details">
        <span class="slot-picker-card__name">${player.name}</span>
        <span class="slot-picker-card__class">${player.role}</span>
      </span>
      <span class="slot-picker-card__gs" style="color: ${tier.color}">${gs}</span>
    </button>`;
  },

  openSlotPicker(slotKey) {
    this.closeSlotPicker();

    const [partyStr, slotType, slotIdxStr] = slotKey.split('-');
    const partyIndex = parseInt(partyStr);
    const slotIdx = parseInt(slotIdxStr);
    const party = this.parties[partyIndex];
    if (!party) return;

    let currentName = null;
    if (slotType === 'tank') currentName = party.tank;
    else if (slotType === 'healer') currentName = party.healer;
    else if (slotType === 'dps') currentName = (party.dps || [])[slotIdx];

    const playerMap = {};
    this.allPlayers.forEach(p => { playerMap[p.name] = p; });
    const assigned = this.getAssignedNames();
    const available = this.allPlayers
      .filter(p => !assigned.has(p.name))
      .sort((a, b) => (b._gearscore || 0) - (a._gearscore || 0));

    const currentPlayer = currentName ? playerMap[currentName] : null;
    const slotLabelMap = { tank: 'Guardian', healer: 'Saint', dps: 'DPS' };
    const slotLabel = slotLabelMap[slotType] || 'Slot';

    const currentSection = currentPlayer ? `
      <div class="slot-picker__section">
        <div class="slot-picker__section-title">Currently in slot</div>
        ${this.renderPickerCard(currentPlayer, 'remove')}
      </div>
    ` : '';

    const poolSection = available.length > 0 ? `
      <div class="slot-picker__section">
        <div class="slot-picker__section-title">Available characters (${available.length})</div>
        <div class="slot-picker__grid">
          ${available.map(p => this.renderPickerCard(p, 'assign')).join('')}
        </div>
      </div>
    ` : `
      <div class="slot-picker__section">
        <div class="slot-picker__empty">No unassigned characters available.</div>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'slot-picker-overlay';
    const panel = document.createElement('div');
    panel.className = 'slot-picker';
    panel.setAttribute('role', 'dialog');
    panel.innerHTML = `
      <div class="slot-picker__header">
        <div class="slot-picker__title">Drag a character into a slot</div>
        <button class="slot-picker__close" aria-label="Close">×</button>
      </div>
      <div class="slot-picker__body">
        ${currentSection}
        ${poolSection}
      </div>
    `;
    document.body.appendChild(panel);
    document.body.classList.add('slot-picker-open');
    this._activePicker = panel;
    this._activeSlotKey = slotKey;

    const close = () => this.closeSlotPicker();
    panel.querySelector('.slot-picker__close').addEventListener('click', close);

    panel.querySelectorAll('.slot-picker-card').forEach(card => {
      const action = card.dataset.action;
      const playerName = card.dataset.playerName;

      if (action === 'remove') {
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeFromSlot(slotKey);
          this.isDirty = true;
          this.renderContent();
          close();
        });
      }

      if (action === 'assign') {
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', playerName);
          e.dataTransfer.setData('sourceSlotKey', `pool-${playerName}`);
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        this.attachTouchDrag(card, { playerName, sourceSlotKey: `pool-${playerName}`, closePickerOnDrop: true });
      }
    });
  },

  attachTouchDrag(card, { playerName, sourceSlotKey = null, ghostClass = 'slot-picker-card--ghost', closePickerOnDrop = false }) {
    let ghost = null;
    let activeDrop = null;
    let dragging = false;
    let pressTimer = null;
    let startX = 0, startY = 0;
    const HOLD_MS = 320;
    const MOVE_CANCEL = 8;

    const cleanup = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (ghost) { ghost.remove(); ghost = null; }
      if (activeDrop) { activeDrop.classList.remove('drag-over'); activeDrop = null; }
      card.classList.remove('dragging');
      dragging = false;
    };

    const startDrag = (clientX, clientY) => {
      dragging = true;
      ghost = card.cloneNode(true);
      ghost.classList.add(ghostClass);
      ghost.style.width = card.offsetWidth + 'px';
      ghost.style.left = (clientX - card.offsetWidth / 2) + 'px';
      ghost.style.top = (clientY - 20) + 'px';
      document.body.appendChild(ghost);
      card.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(20);
    };

    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = false;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        startDrag(startX, startY);
      }, HOLD_MS);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!dragging) {
        if (pressTimer && Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        return;
      }
      e.preventDefault();
      ghost.style.left = (t.clientX - card.offsetWidth / 2) + 'px';
      ghost.style.top = (t.clientY - 20) + 'px';

      ghost.style.display = 'none';
      const under = document.elementFromPoint(t.clientX, t.clientY);
      ghost.style.display = '';
      const target = under?.closest('[data-droppable="true"]');
      if (activeDrop && activeDrop !== target) {
        activeDrop.classList.remove('drag-over');
        activeDrop = null;
      }
      if (target && target !== activeDrop) {
        target.classList.add('drag-over');
        activeDrop = target;
      }
    }, { passive: false });

    card.addEventListener('touchend', () => {
      if (!dragging) { cleanup(); return; }
      const dropKey = activeDrop?.dataset.slotKey;
      if (dropKey) {
        const targetCurrent = activeDrop.dataset.playerName || null;
        const isFromSlot = sourceSlotKey && !sourceSlotKey.startsWith('pool-');
        if (isFromSlot && sourceSlotKey !== dropKey) {
          this.assignToSlot(dropKey, playerName);
          this.assignToSlot(sourceSlotKey, targetCurrent);
        } else {
          if (targetCurrent) this.removeFromSlot(dropKey);
          this.assignToSlot(dropKey, playerName);
        }
        this.isDirty = true;
        cleanup();
        if (closePickerOnDrop) this.closeSlotPicker();
        this.renderContent();
        return;
      }
      cleanup();
    });

    card.addEventListener('touchcancel', cleanup);
  },

  closeSlotPicker() {
    if (this._activePicker) {
      this._activePicker.remove();
      this._activePicker = null;
    }
    this._activeSlotKey = null;
    document.body.classList.remove('slot-picker-open');
  },

  renderActivelyRecruiting() {
    const hasSelection = this.activeClasses.length > 0;
    const editBtn = this.isEditMode ? `<button class="actively-recruiting__edit">Edit</button>` : '';

    if (!hasSelection && !this.isEditMode) return '';
    if (!hasSelection && this.isEditMode) {
      return `<section class="actively-recruiting actively-recruiting--empty">
        <div class="actively-recruiting__head">
          <h3 class="actively-recruiting__title">Actively Recruiting</h3>
          ${editBtn}
        </div>
        <p class="actively-recruiting__empty">No classes selected. Click <strong>Edit</strong> to highlight classes the guild is hunting for.</p>
      </section>`;
    }

    const cards = this.activeClasses.map(cls => `
      <div class="actively-recruiting__card">
        <span class="actively-recruiting__icon"><span class="class-sprite" style="${getClassSpriteStyle(cls)}"></span></span>
        <span class="actively-recruiting__name">${cls}</span>
      </div>
    `).join('');

    return `<section class="actively-recruiting">
      <div class="actively-recruiting__head">
        <h3 class="actively-recruiting__title">Actively Recruiting</h3>
        ${editBtn}
      </div>
      <div class="actively-recruiting__grid">${cards}</div>
      <p class="actively-recruiting__note">
        Don't see your class? <strong>Apply anyway!</strong> Active and friendly players of any class are always welcome. Preference for main characters.
      </p>
    </section>`;
  },

  openActiveClassesEditor() {
    const existing = document.querySelector('.active-classes-overlay');
    if (existing) existing.remove();

    const selected = new Set(this.activeClasses);
    const families = Object.entries(CLASS_FAMILIES).map(([key, family]) => {
      const items = family.classes.map(cls => `
        <label class="active-classes__item ${selected.has(cls) ? 'is-selected' : ''}">
          <input type="checkbox" value="${cls}" ${selected.has(cls) ? 'checked' : ''} />
          <span class="active-classes__icon"><span class="class-sprite" style="${getClassSpriteStyle(cls)}"></span></span>
          <span class="active-classes__name">${cls}</span>
        </label>
      `).join('');
      return `<div class="active-classes__family">
        <div class="active-classes__family-name">${family.name}</div>
        <div class="active-classes__items">${items}</div>
      </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'active-classes-overlay';
    overlay.innerHTML = `
      <div class="active-classes" role="dialog" aria-modal="true">
        <div class="active-classes__header">
          <h3>Select Recruiting Classes</h3>
          <button class="active-classes__close" aria-label="Close">×</button>
        </div>
        <div class="active-classes__body">${families}</div>
        <div class="active-classes__footer">
          <button class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.active-classes__close').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

    overlay.querySelectorAll('.active-classes__item').forEach(label => {
      const input = label.querySelector('input');
      input.addEventListener('change', () => {
        label.classList.toggle('is-selected', input.checked);
      });
    });

    overlay.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const checked = Array.from(overlay.querySelectorAll('input:checked')).map(i => i.value);
      this.activeClasses = checked;
      try {
        await dataService.setAppConfig(ACTIVE_CLASSES_KEY, JSON.stringify(checked));
        toast.show('Recruiting classes updated', 'success');
      } catch (err) {
        console.error('Failed to save active classes:', err);
        toast.show('Failed to save', 'error');
      }
      close();
      this.renderContent();
    });
  },

  destroy() {
    this.closeSlotPicker();
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = '';
    if (PlayersPage._chartInstance) {
      PlayersPage._chartInstance.destroy();
      PlayersPage._chartInstance = null;
    }
    this.allPlayers = [];
    this._fullPlayers = [];
    this._userMap = {};
    this.parties = [];
    this.isDirty = false;
    this._container = null;
  }
};

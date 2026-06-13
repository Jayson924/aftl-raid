import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import {
  getClassSpriteStyle,
  CARDS_PER_PAGE,
  DEFAULT_CARD_PAGES,
  EQUIPMENT_RARITIES
} from '../constants.js';
import { renderPagination, bindPagination } from '../pagination.js';
import { PlayersPage } from './players.jsx';
import { getBrowserTimezone, getTimezoneShortLabel } from '../availability.js';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';

const CARD_RARITIES = EQUIPMENT_RARITIES.filter(r => r.value);

// Per-character "include bought in totals" prefs, persisted as a playerId->bool map.
const SHOPPING_TOTAL_PREFS_KEY = 'myShoppingTotalAllByPlayer';
function loadShoppingTotalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(SHOPPING_TOTAL_PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

// Shopping list items are free text — escape before injecting into innerHTML.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const MyRaidsPage = {
  _myPlayers: [],
  _personalRaids: [],
  _characterGroups: [], // [{ id, accountNumber, name, sortOrder }]
  _draggingPlayerId: null, // character drag-and-drop (Raids tab)
  _playerCards: [], // [{ id, playerId, slotIndex, rarity }]
  _editingRaidId: null,
  _editingRaidPlayerId: null,
  _lastAddedRaid: null,
  _activeTab: 'raids', // 'raids' | 'shopping' | 'cards'
  _shoppingItems: [], // [{ id, playerId, item, bought, price, sortOrder }]
  _shoppingLoaded: false,
  _shoppingTotalAllByPlayer: loadShoppingTotalPrefs(), // { [playerId]: true } — true = include bought; default un-bought only
  _cardsPageByPlayer: {}, // playerId -> current page
  _cardNames: {}, // slotIndex -> custom card name (from app_config)
  _cardPageCount: DEFAULT_CARD_PAGES,
  _hoveredPlayerId: null, // tracks which character the mouse is over (for Ctrl+V paste-to-character)
  _extrasByPlayer: {}, // playerId -> [{ id, cardName, rarity, amount }]
  _sectionByPlayer: {}, // playerId -> 'slots' | 'extras' (default 'slots')

  async render(container) {
    if (!dataService.isAuthenticated()) {
      container.innerHTML = '<p>Please log in to view your characters.</p>';
      return;
    }

    container.innerHTML = `
      <div class="my-raids-page">
        <h1 class="page-title">My Characters</h1>

        <div class="section display-name-section">
          <h2>Display Name</h2>
          <div class="display-name-form">
            <input type="text" id="display-name-input" value="" maxlength="32" placeholder="Enter your display name">
            <button class="btn btn-primary" id="save-name-btn">Save</button>
          </div>
        </div>

        <div class="section availability-section">
          <h2>Availability</h2>
          <p class="availability-hint">When you're typically online. Used for raids that need scheduling lead time (currently DDN Classic). Enter times in <strong>your local timezone</strong> — others see them converted to theirs.</p>
          <div class="availability-tz-banner" id="availability-tz-label">Detecting your timezone…</div>
          <div class="availability-form">
            <label class="availability-anytime">
              <input type="checkbox" id="availability-anytime-input">
              <span>Available anytime</span>
            </label>
            <label class="availability-field">
              <span class="availability-label">Available from <span class="availability-label-tz" id="availability-from-tz"></span></span>
              <input type="text" id="availability-from-input" placeholder="Pick a time" readonly>
            </label>
            <label class="availability-field">
              <span class="availability-label">Log off time <span class="availability-label-tz" id="availability-off-tz"></span></span>
              <input type="text" id="availability-off-input" placeholder="Pick a time" readonly>
            </label>
            <div class="availability-actions">
              <button class="btn btn-secondary" id="clear-availability-btn">Clear</button>
              <button class="btn btn-primary" id="save-availability-btn">Save</button>
            </div>
          </div>
        </div>

        <div class="mc-tabs">
          <button class="mc-tab active" data-tab="raids">Raids</button>
          <button class="mc-tab" data-tab="cards">Cards</button>
          <button class="mc-tab" data-tab="shopping">Shopping List</button>
        </div>

        <div class="section my-characters-section" data-tab-panel="raids">
          <div class="section-header">
            <h2>Raids
              <button class="btn btn-icon-toggle" id="toggle-columns-btn" title="Toggle two-column layout">
                <img class="col-icon" src="/icons/onecolumn.svg" alt="Toggle columns">
              </button>
            </h2>
            <div class="section-header-actions">
              <button class="btn btn-danger-outline" id="delete-raid-all-btn">Delete All Raids</button>
              <button class="btn btn-secondary" id="add-raid-all-btn">+ Add Raid to All</button>
              <button class="btn btn-primary" id="add-character-btn">+ Add Character</button>
            </div>
          </div>
          <div id="my-characters-list"></div>
        </div>

        <div class="section my-cards-section" data-tab-panel="cards" style="display:none">
          <div class="section-header">
            <h2>Card Collection</h2>
          </div>
          <div id="my-cards-list"></div>
        </div>

        <div class="section my-shopping-section" data-tab-panel="shopping" style="display:none">
          <div class="section-header">
            <h2>Shopping List</h2>
          </div>
          <div id="my-shopping-list"></div>
        </div>
      </div>
    `;

    const nameInput = document.getElementById('display-name-input');
    nameInput.value = dataService.getDisplayName() || '';

    this.setupDisplayNameHandlers();
    this.setupAvailabilityHandlers();
    this.setupAddCharacterHandler();
    this.setupAddRaidToAllHandler();
    this.setupDeleteAllRaidsHandler();
    this.setupColumnToggle();
    this.setupTabHandlers();
    await this.loadMyCharacters();
  },

  destroy() {
    this._myPlayers = [];
    this._personalRaids = [];
    this._characterGroups = [];
    this._draggingPlayerId = null;
    this._playerCards = [];
    this._cardsLoaded = false;
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
    this._lastAddedRaid = null;
    this._activeTab = 'raids';
    this._shoppingItems = [];
    this._shoppingLoaded = false;
    this._cardsPageByPlayer = {};
    this._cardNames = {};
    this._cardPageCount = DEFAULT_CARD_PAGES;
    this._hoveredPlayerId = null;
    this._extrasByPlayer = {};
    this._sectionByPlayer = {};
    if (this._pasteHandler) {
      document.removeEventListener('paste', this._pasteHandler);
      this._pasteHandler = null;
    }
    this._pasteTargetPlayerId = null;
    this._availabilityFromPicker?.destroy();
    this._availabilityOffPicker?.destroy();
    this._availabilityFromPicker = null;
    this._availabilityOffPicker = null;
  },

  // ============================================
  // TABS
  // ============================================

  setupTabHandlers() {
    document.querySelectorAll('.mc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab === this._activeTab) return;
        this._activeTab = tab;
        document.querySelectorAll('.mc-tab').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === tab);
        });
        document.querySelectorAll('[data-tab-panel]').forEach(panel => {
          panel.style.display = panel.dataset.tabPanel === tab ? '' : 'none';
        });
        if (tab === 'cards') this.renderCardsTab();
        if (tab === 'shopping') this.renderShoppingTab();
      });
    });
  },

  // ============================================
  // DISPLAY NAME
  // ============================================

  setupDisplayNameHandlers() {
    const input = document.getElementById('display-name-input');
    const saveBtn = document.getElementById('save-name-btn');

    saveBtn.addEventListener('click', () => this.saveDisplayName());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveDisplayName();
    });
  },

  async saveDisplayName() {
    const input = document.getElementById('display-name-input');
    const newName = input.value.trim();
    if (!newName) {
      toast.error('Display name cannot be empty');
      return;
    }

    try {
      await dataService.updateDisplayName(newName);
      toast.success('Display name updated!');
      // Dispatch event so main.js can re-render navigation with new name
      window.dispatchEvent(new CustomEvent('display-name-changed'));
    } catch (error) {
      toast.error(`Failed to update name: ${error.message}`);
    }
  },

  // ============================================
  // AVAILABILITY
  // ============================================

  setupAvailabilityHandlers() {
    const fromInput = document.getElementById('availability-from-input');
    const offInput = document.getElementById('availability-off-input');
    const anytimeInput = document.getElementById('availability-anytime-input');
    const tzLabel = document.getElementById('availability-tz-label');
    const saveBtn = document.getElementById('save-availability-btn');
    const clearBtn = document.getElementById('clear-availability-btn');

    const current = dataService.getMyAvailability();
    // Time columns come back as HH:MM:SS — flatpickr accepts HH:MM.
    const trim = (t) => t ? t.slice(0, 5) : '';

    const pickerOpts = {
      enableTime: true,
      noCalendar: true,
      dateFormat: 'H:i',          // stored format, 24h — what we send to the DB
      altInput: true,             // show a friendlier value in the visible input
      altFormat: 'h:i K',         // 12-hour with AM/PM
      time_24hr: false,
      minuteIncrement: 15,
      defaultHour: 20,
      allowInput: false
    };

    this._availabilityFromPicker = flatpickr(fromInput, {
      ...pickerOpts,
      defaultDate: trim(current.availableFrom) || null
    });
    this._availabilityOffPicker = flatpickr(offInput, {
      ...pickerOpts,
      defaultDate: trim(current.logOffTime) || null
    });

    anytimeInput.checked = !!current.anytime;

    const browserTz = getBrowserTimezone();
    const tz = current.timezone || browserTz;
    const tzShort = tz ? getTimezoneShortLabel(tz) : '';
    tzLabel.innerHTML = tz
      ? `You're entering times in your local timezone: <strong>${tzShort}</strong> <span class="tz-name">(${tz})</span>`
      : '';
    const fromTzEl = document.getElementById('availability-from-tz');
    const offTzEl = document.getElementById('availability-off-tz');
    if (fromTzEl) fromTzEl.textContent = tzShort ? `(${tzShort})` : '';
    if (offTzEl) offTzEl.textContent = tzShort ? `(${tzShort})` : '';

    const syncDisabled = () => {
      const disabled = anytimeInput.checked;
      // flatpickr's altInput swaps the visible field — disable both.
      [this._availabilityFromPicker, this._availabilityOffPicker].forEach(p => {
        if (!p) return;
        p.input.disabled = disabled;
        if (p.altInput) p.altInput.disabled = disabled;
      });
    };
    syncDisabled();
    anytimeInput.addEventListener('change', syncDisabled);

    saveBtn.addEventListener('click', () => this.saveAvailability());
    clearBtn.addEventListener('click', () => this.clearAvailability());
  },

  async saveAvailability() {
    const anytimeInput = document.getElementById('availability-anytime-input');
    const anytime = anytimeInput.checked;
    // Pickers store the canonical HH:MM in their hidden input (with altInput).
    const fromVal = this._availabilityFromPicker?.input?.value || null;
    const offVal = this._availabilityOffPicker?.input?.value || null;
    const availableFrom = anytime ? null : (fromVal || null);
    const logOffTime = anytime ? null : (offVal || null);

    if (!anytime && !availableFrom && !logOffTime) {
      toast.error('Set at least one time, check "anytime", or use Clear');
      return;
    }

    try {
      await dataService.updateAvailability({
        availableFrom,
        logOffTime,
        timezone: anytime ? null : getBrowserTimezone(),
        anytime
      });
      toast.success('Availability updated!');
    } catch (error) {
      toast.error(`Failed to update availability: ${error.message}`);
    }
  },

  async clearAvailability() {
    try {
      await dataService.updateAvailability({ availableFrom: null, logOffTime: null, timezone: null, anytime: false });
      this._availabilityFromPicker?.clear();
      this._availabilityOffPicker?.clear();
      const anytimeInput = document.getElementById('availability-anytime-input');
      anytimeInput.checked = false;
      anytimeInput.dispatchEvent(new Event('change'));
      toast.success('Availability cleared');
    } catch (error) {
      toast.error(`Failed to clear: ${error.message}`);
    }
  },

  // ============================================
  // MY CHARACTERS
  // ============================================

  async loadMyCharacters() {
    const listEl = document.getElementById('my-characters-list');
    if (!listEl) return;

    try {
      const [allPlayers, groups] = await Promise.all([
        dataService.getPlayers(),
        dataService.getCharacterGroups(),
        this.loadPersonalRaids()
      ]);
      const userId = dataService.getUser()?.id;
      this._myPlayers = allPlayers.filter(p => p.discordId === userId);
      this._characterGroups = groups;

      this.renderRaidsList();
    } catch (error) {
      console.error('Error loading characters:', error);
      listEl.innerHTML = '<p class="empty-state">Failed to load characters.</p>';
    }
  },

  // Render the Raids tab from current local state (no refetch). The Raids tab
  // is the editable surface: drag handles, move buttons, and group management.
  renderRaidsList() {
    const listEl = document.getElementById('my-characters-list');
    if (!listEl) return;

    if (this._myPlayers.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No characters assigned to your account.</p>';
      return;
    }

    // Group personal raids by player ID
    const raidsByPlayer = {};
    this._personalRaids.forEach(raid => {
      if (!raidsByPlayer[raid.playerId]) raidsByPlayer[raid.playerId] = [];
      raidsByPlayer[raid.playerId].push(raid);
    });

    const structure = this.buildAccountStructure(this._myPlayers);
    listEl.innerHTML = this.renderAccountStructure(structure, {
      editable: true,
      containerClass: 'character-cards',
      renderCharacter: (player) => {
        const iconStyle = getClassSpriteStyle(player.role);
        const playerRaids = raidsByPlayer[player.id] || [];
        return `
          <div class="character-block" data-player-id="${player.id}" data-group-id="${player.groupId || ''}" data-account="${player.accountNumber || 1}">
            <div class="character-card">
              <span class="char-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
              <div class="character-info">
                ${iconStyle ? `<div class="class-sprite class-icon" style="${iconStyle}"></div>` : ''}
                <div>
                  <span class="character-name-link" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>
                  <span class="character-class">${player.role}</span>
                </div>
              </div>
              <div class="character-actions">
                ${PlayersPage.renderRaidBadgesHTML(player, true)}
              </div>
            </div>
            ${this.renderCharMoveControls(player)}
            <div class="character-personal-raids">
              ${this.renderPlayerRaidsHTML(player.id, playerRaids)}
              <div class="add-raid-form-container" data-player-id="${player.id}"></div>
            </div>
          </div>
        `;
      }
    });

    this.setupRaidBadgeHandlers();
    this.setupEditCharacterHandlers();
    this.setupPersonalRaidHandlers();
    this.setupAddRaidHandlers();
    this.setupGroupHandlers(listEl);
    this.setupCharacterDnD(listEl);
    this.setupCharacterMoveHandlers(listEl);
  },

  // ============================================
  // SHARED GROUPING STRUCTURE (all tabs)
  // ============================================

  // Build account -> groups -> ordered players. Groups are per-account and
  // come from this._characterGroups; characters with no (or a stale) group
  // fall into an Ungrouped bucket. Within a bucket, sort by sortOrder, name.
  buildAccountStructure(players) {
    const byAccount = {};
    players.forEach(p => {
      const acct = p.accountNumber || 1;
      if (!byAccount[acct]) byAccount[acct] = [];
      byAccount[acct].push(p);
    });

    const sortPlayers = (arr) => arr.slice().sort((a, b) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });

    const accountNumbers = Object.keys(byAccount).sort((a, b) => a - b);
    return accountNumbers.map(acctNum => {
      const acctPlayers = byAccount[acctNum];
      const acctGroups = this._characterGroups
        .filter(g => String(g.accountNumber) === String(acctNum))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const validGroupIds = new Set(acctGroups.map(g => g.id));

      const groups = acctGroups.map(g => ({
        id: g.id,
        name: g.name,
        players: sortPlayers(acctPlayers.filter(p => p.groupId === g.id))
      }));
      const ungrouped = sortPlayers(
        acctPlayers.filter(p => !p.groupId || !validGroupIds.has(p.groupId))
      );

      return {
        accountNumber: Number(acctNum),
        groups,
        ungrouped,
        hasGroups: acctGroups.length > 0
      };
    });
  },

  renderAccountStructure(structure, opts) {
    const { editable, renderCharacter, containerClass = 'character-cards', hideEmptyGroups = false } = opts;
    const multiAccount = structure.length > 1;
    let html = '';

    structure.forEach(acct => {
      const sections = [];

      if (acct.hasGroups || editable) {
        acct.groups.forEach(group => {
          if (hideEmptyGroups && group.players.length === 0) return;
          sections.push(this.renderGroupSection({
            groupId: group.id, name: group.name, players: group.players,
            accountNumber: acct.accountNumber, editable, renderCharacter, containerClass,
            showHeader: true
          }));
        });
        // Ungrouped bucket — header only shown when real groups exist
        if (!(hideEmptyGroups && acct.ungrouped.length === 0)) {
          sections.push(this.renderGroupSection({
            groupId: '', name: 'Ungrouped', players: acct.ungrouped,
            accountNumber: acct.accountNumber, editable, renderCharacter, containerClass,
            showHeader: acct.hasGroups, isUngrouped: true
          }));
        }
      } else {
        // No groups and not editable: flat list (preserves the original look)
        sections.push(this.renderGroupSection({
          groupId: '', name: '', players: acct.ungrouped,
          accountNumber: acct.accountNumber, editable, renderCharacter, containerClass,
          showHeader: false, isUngrouped: true
        }));
      }

      if (sections.every(s => !s)) return;

      html += `<div class="account-group" data-account="${acct.accountNumber}">`;
      if (multiAccount) {
        html += `<div class="account-header">Account ${acct.accountNumber}</div>`;
      }
      if (editable) {
        html += `<div class="character-group-toolbar">
          <button class="btn btn-new-group" data-account="${acct.accountNumber}">+ New Group</button>
        </div>`;
      }
      html += sections.join('');
      html += `</div>`;
    });

    return html;
  },

  renderGroupSection({ groupId, name, players, accountNumber, editable, renderCharacter, containerClass, showHeader, isUngrouped = false }) {
    let html = `<div class="character-group" data-group-id="${groupId}" data-account="${accountNumber}">`;

    if (showHeader) {
      html += `<div class="character-group-header">`;
      html += `<span class="character-group-name"${editable && !isUngrouped ? ` data-group-id="${groupId}" title="Rename group"` : ''}>${escapeHtml(name || 'Ungrouped')}</span>`;
      html += `<span class="character-group-count">${players.length}</span>`;
      if (editable && !isUngrouped) {
        html += `<span class="character-group-controls">
          <button class="group-move-up" data-group-id="${groupId}" title="Move group up">↑</button>
          <button class="group-move-down" data-group-id="${groupId}" title="Move group down">↓</button>
          <button class="group-rename" data-group-id="${groupId}" title="Rename group">✎</button>
          <button class="group-delete" data-group-id="${groupId}" title="Delete group">×</button>
        </span>`;
      }
      html += `</div>`;
    }

    html += `<div class="${containerClass}" data-group-id="${groupId}" data-account="${accountNumber}">`;
    players.forEach(p => { html += renderCharacter(p); });
    if (editable && players.length === 0) {
      html += `<div class="character-group-empty">Drop a character here</div>`;
    }
    html += `</div></div>`;
    return html;
  },

  renderCharMoveControls(player) {
    const acct = player.accountNumber || 1;
    const groups = this._characterGroups
      .filter(g => String(g.accountNumber) === String(acct))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const options = [`<option value="" ${!player.groupId ? 'selected' : ''}>Ungrouped</option>`]
      .concat(groups.map(g => `<option value="${g.id}" ${g.id === player.groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`))
      .join('');
    return `
      <div class="char-move-controls">
        <button class="char-move-up" data-player-id="${player.id}" title="Move up">↑</button>
        <button class="char-move-down" data-player-id="${player.id}" title="Move down">↓</button>
        <label class="char-group-select-label">
          <span>Group</span>
          <select class="char-group-select" data-player-id="${player.id}">${options}</select>
        </label>
      </div>
    `;
  },

  // ============================================
  // GROUP MANAGEMENT (Raids tab)
  // ============================================

  setupGroupHandlers(root) {
    root.querySelectorAll('.btn-new-group').forEach(btn => {
      btn.addEventListener('click', () => this.createGroup(Number(btn.dataset.account)));
    });
    root.querySelectorAll('.group-rename, .character-group-name[data-group-id]').forEach(el => {
      el.addEventListener('click', () => this.renameGroup(el.dataset.groupId));
    });
    root.querySelectorAll('.group-delete').forEach(btn => {
      btn.addEventListener('click', () => this.deleteGroup(btn.dataset.groupId));
    });
    root.querySelectorAll('.group-move-up').forEach(btn => {
      btn.addEventListener('click', () => this.moveGroup(btn.dataset.groupId, -1));
    });
    root.querySelectorAll('.group-move-down').forEach(btn => {
      btn.addEventListener('click', () => this.moveGroup(btn.dataset.groupId, 1));
    });
  },

  async createGroup(accountNumber) {
    const name = await modal.prompt('Name your new group', {
      title: 'New Group', okText: 'Create', placeholder: 'e.g. Favorites'
    });
    if (!name) return;
    try {
      const group = await dataService.addCharacterGroup(accountNumber, name);
      this._characterGroups.push(group);
      this.renderRaidsList();
      toast.success(`Group "${group.name}" created`);
    } catch (e) {
      toast.error(`Failed to create group: ${e.message}`);
    }
  },

  async renameGroup(groupId) {
    const group = this._characterGroups.find(g => g.id === groupId);
    if (!group) return;
    const name = await modal.prompt('Group name', {
      title: 'Rename Group', okText: 'Save', defaultValue: group.name
    });
    if (!name || name === group.name) return;
    try {
      await dataService.renameCharacterGroup(groupId, name);
      group.name = name;
      this.renderRaidsList();
    } catch (e) {
      toast.error(`Failed to rename: ${e.message}`);
    }
  },

  async deleteGroup(groupId) {
    const group = this._characterGroups.find(g => g.id === groupId);
    if (!group) return;
    const confirmed = await modal.confirm(
      `Delete group "${group.name}"? The characters will be moved to Ungrouped.`,
      { title: 'Delete Group', confirmText: 'Delete', cancelText: 'Cancel', danger: true }
    );
    if (!confirmed) return;
    try {
      await dataService.deleteCharacterGroup(groupId);
      this._characterGroups = this._characterGroups.filter(g => g.id !== groupId);
      // DB cleared members via ON DELETE SET NULL — mirror locally
      this._myPlayers.forEach(p => { if (p.groupId === groupId) p.groupId = null; });
      this.renderRaidsList();
      toast.success('Group deleted');
    } catch (e) {
      toast.error(`Failed to delete: ${e.message}`);
    }
  },

  async moveGroup(groupId, delta) {
    const group = this._characterGroups.find(g => g.id === groupId);
    if (!group) return;
    const siblings = this._characterGroups
      .filter(g => String(g.accountNumber) === String(group.accountNumber))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = siblings.findIndex(g => g.id === groupId);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= siblings.length) return;
    siblings.splice(idx, 1);
    siblings.splice(newIdx, 0, group);
    siblings.forEach((g, i) => { g.sortOrder = i; });
    try {
      await dataService.reorderCharacterGroups(siblings.map(g => g.id));
      this.renderRaidsList();
    } catch (e) {
      toast.error(`Failed to reorder groups: ${e.message}`);
    }
  },

  // ============================================
  // CHARACTER REORDER / MOVE (Raids tab)
  // ============================================

  // this._myPlayers in (account, group) in current display order.
  bucketPlayers(accountNumber, groupId) {
    const gid = groupId || null;
    const acctGroupIds = new Set(
      this._characterGroups
        .filter(g => String(g.accountNumber) === String(accountNumber))
        .map(g => g.id)
    );
    return this._myPlayers
      .filter(p => String(p.accountNumber || 1) === String(accountNumber))
      .filter(p => gid ? p.groupId === gid : (!p.groupId || !acctGroupIds.has(p.groupId)))
      .sort((a, b) => {
        const ao = a.sortOrder ?? 0, bo = b.sortOrder ?? 0;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
  },

  // Reassign sequential sortOrder + groupId to a bucket, locally and in the DB.
  async persistBucketOrder(orderedPlayers, groupId) {
    const gid = groupId || null;
    const entries = orderedPlayers.map((p, i) => {
      p.sortOrder = i;
      p.groupId = gid;
      return { id: p.id, groupId: gid, sortOrder: i };
    });
    await dataService.saveCharacterOrder(entries);
  },

  setupCharacterMoveHandlers(root) {
    root.querySelectorAll('.char-move-up').forEach(btn => {
      btn.addEventListener('click', () => this.moveCharacter(btn.dataset.playerId, -1));
    });
    root.querySelectorAll('.char-move-down').forEach(btn => {
      btn.addEventListener('click', () => this.moveCharacter(btn.dataset.playerId, 1));
    });
    root.querySelectorAll('.char-group-select').forEach(sel => {
      sel.addEventListener('change', () => this.changeCharacterGroup(sel.dataset.playerId, sel.value || null));
    });
  },

  async moveCharacter(playerId, delta) {
    const player = this._myPlayers.find(p => p.id === playerId);
    if (!player) return;
    const bucket = this.bucketPlayers(player.accountNumber || 1, player.groupId);
    const idx = bucket.findIndex(p => p.id === playerId);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= bucket.length) return;
    bucket.splice(idx, 1);
    bucket.splice(newIdx, 0, player);
    try {
      await this.persistBucketOrder(bucket, player.groupId);
      this.renderRaidsList();
    } catch (e) {
      toast.error(`Failed to reorder: ${e.message}`);
    }
  },

  async changeCharacterGroup(playerId, newGroupId) {
    const player = this._myPlayers.find(p => p.id === playerId);
    if (!player) return;
    if ((player.groupId || null) === (newGroupId || null)) return;
    const dest = this.bucketPlayers(player.accountNumber || 1, newGroupId).filter(p => p.id !== playerId);
    dest.push(player); // append to end of destination
    try {
      await this.persistBucketOrder(dest, newGroupId);
      this.renderRaidsList();
    } catch (e) {
      toast.error(`Failed to move: ${e.message}`);
    }
  },

  setupCharacterDnD(root) {
    root.querySelectorAll('.character-block').forEach(block => {
      const handle = block.querySelector('.char-drag-handle');
      if (!handle) return;
      // Only make the block draggable while the handle is held — otherwise
      // draggable=true on the parent breaks text selection in the inline
      // "add raid" inputs (a Chrome quirk).
      handle.addEventListener('mousedown', () => block.setAttribute('draggable', 'true'));
      handle.addEventListener('mouseup', () => block.setAttribute('draggable', 'false'));

      block.addEventListener('dragstart', (e) => {
        this._draggingPlayerId = block.dataset.playerId;
        block.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', block.dataset.playerId); } catch (_) {}
      });
      block.addEventListener('dragend', () => {
        block.classList.remove('dragging');
        block.setAttribute('draggable', 'false');
        this._draggingPlayerId = null;
        root.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        root.querySelectorAll('.swap-target').forEach(el => el.classList.remove('swap-target'));
      });
    });

    root.querySelectorAll('.character-cards').forEach(container => {
      container.addEventListener('dragover', (e) => {
        if (!this._draggingPlayerId) return;
        const dragging = this._myPlayers.find(p => p.id === this._draggingPlayerId);
        // Restrict drops to the same account (groups are per-account)
        if (!dragging || String(dragging.accountNumber || 1) !== String(container.dataset.account)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.classList.add('drag-over');
        // Highlight the character the dragged card will swap places with.
        const target = this.getSwapTarget(container, e.clientX, e.clientY);
        root.querySelectorAll('.swap-target').forEach(el => el.classList.remove('swap-target'));
        if (target && target.dataset.playerId !== this._draggingPlayerId) {
          target.classList.add('swap-target');
        }
      });
      container.addEventListener('dragleave', (e) => {
        if (!container.contains(e.relatedTarget)) {
          container.classList.remove('drag-over');
          container.querySelectorAll('.swap-target').forEach(el => el.classList.remove('swap-target'));
        }
      });
      container.addEventListener('drop', (e) => {
        if (!this._draggingPlayerId) return;
        const dragging = this._myPlayers.find(p => p.id === this._draggingPlayerId);
        if (!dragging || String(dragging.accountNumber || 1) !== String(container.dataset.account)) return;
        e.preventDefault();
        container.classList.remove('drag-over');
        container.querySelectorAll('.swap-target').forEach(el => el.classList.remove('swap-target'));
        const target = this.getSwapTarget(container, e.clientX, e.clientY);
        if (target && target.dataset.playerId !== this._draggingPlayerId) {
          this.handleCharacterSwap(this._draggingPlayerId, target.dataset.playerId);
        }
      });
    });
  },

  // The character card the pointer is over — the one to swap with. Prefers the
  // card directly under the pointer, falling back to the nearest by center so a
  // drop in the gap between cards still resolves to the closest character.
  getSwapTarget(container, x, y) {
    const els = [...container.querySelectorAll('.character-block:not(.dragging)')];
    if (!els.length) return null;
    const over = els.find(el => {
      const b = el.getBoundingClientRect();
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    });
    if (over) return over;
    let closest = null;
    let closestDist = Infinity;
    for (const el of els) {
      const b = el.getBoundingClientRect();
      const dist = Math.hypot(x - (b.left + b.width / 2), y - (b.top + b.height / 2));
      if (dist < closestDist) { closestDist = dist; closest = el; }
    }
    return closest;
  },

  // Swap two characters' positions. Within one bucket they trade order slots;
  // across groups (same account) each takes the other's group + slot.
  async handleCharacterSwap(draggedId, targetId) {
    if (draggedId === targetId) return;
    const dragged = this._myPlayers.find(p => p.id === draggedId);
    const target = this._myPlayers.find(p => p.id === targetId);
    if (!dragged || !target) return;
    const acct = dragged.accountNumber || 1;
    const gD = dragged.groupId || null;
    const gT = target.groupId || null;
    try {
      if (gD === gT) {
        const bucket = this.bucketPlayers(acct, gD);
        const i = bucket.findIndex(p => p.id === draggedId);
        const j = bucket.findIndex(p => p.id === targetId);
        if (i === -1 || j === -1) return;
        [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
        await this.persistBucketOrder(bucket, gD);
      } else {
        const bucketD = this.bucketPlayers(acct, gD);
        const bucketT = this.bucketPlayers(acct, gT);
        const i = bucketD.findIndex(p => p.id === draggedId);
        const j = bucketT.findIndex(p => p.id === targetId);
        if (i === -1 || j === -1) return;
        bucketD[i] = target;
        bucketT[j] = dragged;
        await this.persistBucketOrder(bucketD, gD);
        await this.persistBucketOrder(bucketT, gT);
      }
      this.renderRaidsList();
    } catch (e) {
      toast.error(`Failed to swap: ${e.message}`);
    }
  },

  setupRaidBadgeHandlers() {
    document.querySelectorAll('.my-characters-section .raid-badge.clickable').forEach(badge => {
      badge.addEventListener('click', async (e) => {
        const playerId = badge.dataset.playerId;
        const raidType = badge.dataset.raidType;
        const isCurrentlyCompleted = badge.dataset.completed === 'true';
        const newCompleted = !isCurrentlyCompleted;

        badge.style.opacity = '0.5';
        try {
          await dataService.togglePlayerRaidCompletion(playerId, raidType, newCompleted);
          toast.success(`${raidType} ${newCompleted ? 'marked as done' : 'marked as not done'}`);
          await this.loadMyCharacters();
        } catch (error) {
          badge.style.opacity = '1';
          toast.error(`Failed to update: ${error.message}`);
        }
      });
    });
  },

  setupEditCharacterHandlers() {
    document.querySelectorAll('.character-name-link').forEach(link => {
      link.addEventListener('click', async () => {
        const playerId = link.dataset.playerId;
        const player = this._myPlayers.find(p => p.id === playerId);
        if (!player) return;

        PlayersPage._allPlayers = this._myPlayers;
        if (dataService.isAdmin()) {
          PlayersPage._appUsers = await dataService.getAppUsers();
        }

        const originalLoadPlayers = PlayersPage.loadPlayers;
        PlayersPage.loadPlayers = () => {
          PlayersPage.loadPlayers = originalLoadPlayers;
          this.loadMyCharacters();
        };

        PlayersPage.showEditPlayerModal(player);
      });
    });
  },

  setupAddCharacterHandler() {
    document.getElementById('add-character-btn').addEventListener('click', async () => {
      // Set account data from already-loaded characters so account buttons work
      PlayersPage._allPlayers = this._myPlayers;

      // Admins need app users for the owner dropdown
      if (dataService.isAdmin()) {
        PlayersPage._appUsers = await dataService.getAppUsers();
      }

      // Temporarily patch loadPlayers so the modal refreshes our list on success
      const originalLoadPlayers = PlayersPage.loadPlayers;
      PlayersPage.loadPlayers = () => {
        PlayersPage.loadPlayers = originalLoadPlayers;
        this.loadMyCharacters();
      };

      PlayersPage.showAddPlayerModal();
    });
  },

  setupColumnToggle() {
    const btn = document.getElementById('toggle-columns-btn');
    const icon = btn.querySelector('.col-icon');
    const stored = localStorage.getItem('myRaidsTwoColumns');
    const isTwoCol = stored === null ? true : stored === 'true';
    if (isTwoCol) {
      document.getElementById('my-characters-list')?.classList.add('two-columns');
      btn.classList.add('active');
      icon.src = '/icons/twocolumns.svg';
    }

    btn.addEventListener('click', () => {
      const list = document.getElementById('my-characters-list');
      if (!list) return;
      const nowTwo = list.classList.toggle('two-columns');
      btn.classList.toggle('active', nowTwo);
      icon.src = nowTwo ? '/icons/twocolumns.svg' : '/icons/onecolumn.svg';
      localStorage.setItem('myRaidsTwoColumns', nowTwo);
    });
  },

  // ============================================
  // ADD RAID TO ALL CHARACTERS
  // ============================================

  setupAddRaidToAllHandler() {
    document.getElementById('add-raid-all-btn').addEventListener('click', () => {
      this.showAddRaidToAllModal();
    });
  },

  showAddRaidToAllModal() {
    if (this._myPlayers.length === 0) {
      toast.error('No characters to add raids to');
      return;
    }

    // Get unique raid names for autocomplete
    const uniqueRaidNames = [...new Set(this._personalRaids.map(r => r.name))].sort();
    const datalistOptions = uniqueRaidNames.map(name => `<option value="${name}">`).join('');

    const prefillMax = this._lastAddedRaid?.maxClears || 1;

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-content bulk-raid-modal">
        <h2>Add Raid to All Characters</h2>
        <div class="form-group">
          <label for="bulk-raid-name">Raid Name</label>
          <input type="text" id="bulk-raid-name" class="form-control" placeholder="e.g. Abyss Mire" maxlength="50" list="bulk-raid-suggestions" autocomplete="off">
          <datalist id="bulk-raid-suggestions">${datalistOptions}</datalist>
        </div>
        <div class="form-group">
          <label for="bulk-raid-max">Max Clears</label>
          <input type="number" id="bulk-raid-max" class="form-control" min="1" max="99" value="${prefillMax}">
        </div>
        <p class="bulk-raid-hint">Adds to all ${this._myPlayers.length} characters.</p>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="bulk-raid-confirm">Add to All</button>
          <button type="button" class="btn btn-secondary" id="bulk-raid-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#bulk-raid-name');
    const maxInput = overlay.querySelector('#bulk-raid-max');
    const confirmBtn = overlay.querySelector('#bulk-raid-confirm');
    const cancelBtn = overlay.querySelector('#bulk-raid-cancel');

    nameInput.focus();

    // When user picks from autocomplete, fill in max clears
    nameInput.addEventListener('input', () => {
      const existingRaid = this._personalRaids.find(r => r.name === nameInput.value);
      if (existingRaid) maxInput.value = existingRaid.maxClears;
    });

    const close = () => {
      document.removeEventListener('keydown', handleKey);
      if (overlay.parentNode) overlay.remove();
    };

    const submit = async () => {
      const name = nameInput.value.trim();
      const maxClears = parseInt(maxInput.value, 10);

      if (!name) { toast.error('Raid name cannot be empty'); return; }
      if (!maxClears || maxClears < 1) { toast.error('Max clears must be at least 1'); return; }

      const existingPlayerIds = new Set(
        this._personalRaids.filter(r => r.name === name).map(r => r.playerId)
      );
      const playersToAdd = this._myPlayers.filter(p => !existingPlayerIds.has(p.id));

      if (playersToAdd.length === 0) {
        toast.error('All characters already have this raid');
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Adding...';

      try {
        let added = 0;
        for (const player of playersToAdd) {
          await dataService.addPersonalRaid(player.id, name, maxClears);
          added++;
        }
        this._lastAddedRaid = { name, maxClears };
        const skipped = this._myPlayers.length - added;
        const msg = skipped > 0
          ? `Added "${name}" to ${added} characters (${skipped} skipped)`
          : `Added "${name}" to all ${added} characters`;
        toast.success(msg);
        close();
        await this.loadPersonalRaids();
        this.reloadAllPlayerRaids();
      } catch (error) {
        toast.error(`Failed: ${error.message}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Add to All';
      }
    };

    confirmBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const handleKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') submit();
    };
    document.addEventListener('keydown', handleKey);
  },

  reloadAllPlayerRaids() {
    this._myPlayers.forEach(player => {
      this.refreshPlayerRaids(player.id);
    });
  },

  // ============================================
  // DELETE ALL RAIDS
  // ============================================

  setupDeleteAllRaidsHandler() {
    document.getElementById('delete-raid-all-btn').addEventListener('click', () => {
      this.deleteAllRaids();
    });
  },

  async deleteAllRaids() {
    if (this._personalRaids.length === 0) {
      toast.error('No personal raids to delete');
      return;
    }

    const confirmed = await modal.confirm(
      `Delete all ${this._personalRaids.length} personal raids across all your characters?`, {
        title: 'Delete All Personal Raids',
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) return;

    try {
      let deleted = 0;
      for (const raid of [...this._personalRaids]) {
        await dataService.deletePersonalRaid(raid.id);
        deleted++;
      }
      this._personalRaids = [];
      this.reloadAllPlayerRaids();
      toast.success(`Deleted ${deleted} raids`);
    } catch (error) {
      toast.error(`Failed: ${error.message}`);
      // Reload to get accurate state
      await this.loadPersonalRaids();
      this.reloadAllPlayerRaids();
    }
  },

  // ============================================
  // PERSONAL RAIDS
  // ============================================

  async loadPersonalRaids() {
    try {
      this._personalRaids = await dataService.getPersonalRaids();
    } catch (error) {
      console.error('Error loading personal raids:', error);
      this._personalRaids = [];
    }
  },

  renderPlayerRaidsHTML(playerId, raids) {
    let html = '';
    if (raids.length > 0) {
      html += '<div class="personal-raid-cards">';
      raids.forEach(raid => {
        const isComplete = raid.currentClears >= raid.maxClears;
        const progressPct = Math.min((raid.currentClears / raid.maxClears) * 100, 100);

        html += `
          <div class="personal-raid-card ${isComplete ? 'completed' : ''}" data-raid-id="${raid.id}">
            <div class="raid-card-body">
              <div class="raid-card-top">
                <span class="raid-name-link" data-raid-id="${raid.id}">${raid.name}<span class="edit-icon">✎</span></span>
                <span class="progress-text">${raid.currentClears}/${raid.maxClears}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${isComplete ? 'complete' : ''}" style="width: ${progressPct}%"></div>
              </div>
            </div>
            <div class="raid-counter-btns">
              <button class="btn-counter btn-decrement" data-raid-id="${raid.id}" ${raid.currentClears <= 0 ? 'disabled' : ''}>-</button>
              <button class="btn-counter btn-increment" data-raid-id="${raid.id}" ${isComplete ? 'disabled' : ''}>+</button>
            </div>
            <button class="btn-icon raid-delete-btn" data-raid-id="${raid.id}" title="Delete">&times;</button>
          </div>
        `;
      });
      html += '</div>';
    }
    html += `<button class="btn btn-add-raid" data-player-id="${playerId}">+ Add Raid</button>`;
    return html;
  },

  setupPersonalRaidHandlers() {
    // Increment
    document.querySelectorAll('.btn-increment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.incrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears++;
          this.refreshPlayerRaids(raid.playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    // Decrement
    document.querySelectorAll('.btn-decrement').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.decrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears--;
          this.refreshPlayerRaids(raid.playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    // Edit (clickable raid name)
    document.querySelectorAll('.raid-name-link').forEach(link => {
      link.addEventListener('click', () => {
        const raidId = link.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (raid) this.showEditRaidForm(raid);
      });
    });

    // Delete
    document.querySelectorAll('.raid-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (!raid) return;

        const confirmed = await modal.confirm(`Delete "${raid.name}"?`, {
          title: 'Delete Personal Raid',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true
        });

        if (confirmed) {
          try {
            await dataService.deletePersonalRaid(raidId);
            const playerId = raid.playerId;
            this._personalRaids = this._personalRaids.filter(r => r.id !== raidId);
            this.refreshPlayerRaids(playerId);
            toast.success('Raid deleted');
          } catch (error) {
            toast.error(`Failed to delete: ${error.message}`);
          }
        }
      });
    });
  },

  setupAddRaidHandlers() {
    document.querySelectorAll('.btn-add-raid').forEach(btn => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        this.showAddRaidForm(playerId);
      });
    });
  },

  refreshPlayerRaids(playerId) {
    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (!block) return;

    const raidsContainer = block.querySelector('.character-personal-raids');
    if (!raidsContainer) return;

    const playerRaids = this._personalRaids.filter(r => r.playerId === playerId);
    raidsContainer.innerHTML = this.renderPlayerRaidsHTML(playerId, playerRaids)
      + `<div class="add-raid-form-container" data-player-id="${playerId}"></div>`;

    // Re-bind handlers for this character's raids
    raidsContainer.querySelectorAll('.btn-increment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.incrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears++;
          this.refreshPlayerRaids(playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    raidsContainer.querySelectorAll('.btn-decrement').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.decrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears--;
          this.refreshPlayerRaids(playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    raidsContainer.querySelectorAll('.raid-name-link').forEach(link => {
      link.addEventListener('click', () => {
        const raidId = link.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (raid) this.showEditRaidForm(raid);
      });
    });

    raidsContainer.querySelectorAll('.raid-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (!raid) return;

        const confirmed = await modal.confirm(`Delete "${raid.name}"?`, {
          title: 'Delete Personal Raid',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true
        });

        if (confirmed) {
          try {
            await dataService.deletePersonalRaid(raidId);
            this._personalRaids = this._personalRaids.filter(r => r.id !== raidId);
            this.refreshPlayerRaids(playerId);
            toast.success('Raid deleted');
          } catch (error) {
            toast.error(`Failed to delete: ${error.message}`);
          }
        }
      });
    });

    raidsContainer.querySelectorAll('.btn-add-raid').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showAddRaidForm(playerId);
      });
    });
  },

  showAddRaidForm(playerId) {
    this._editingRaidId = null;
    this._editingRaidPlayerId = playerId;

    // Hide any other open forms first
    document.querySelectorAll('.personal-raid-card.adding').forEach(c => c.remove());
    document.querySelectorAll('.btn-add-raid').forEach(b => { b.style.display = ''; });

    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (!block) return;

    // Hide the add button
    const addBtn = block.querySelector('.btn-add-raid');
    if (addBtn) addBtn.style.display = 'none';

    // Get unique raid names for autocomplete (excluding raids already on this character)
    const existingRaidsForPlayer = this._personalRaids
      .filter(r => r.playerId === playerId)
      .map(r => r.name);
    const uniqueRaidNames = [...new Set(this._personalRaids.map(r => r.name))]
      .filter(name => !existingRaidsForPlayer.includes(name))
      .sort();

    // Pre-fill values from last added raid
    const prefillName = this._lastAddedRaid?.name || '';
    const prefillMax = this._lastAddedRaid?.maxClears || 1;

    // Build datalist options
    const datalistOptions = uniqueRaidNames.map(name => `<option value="${name}">`).join('');

    // Insert the inline add form as a card
    const raidCards = block.querySelector('.personal-raid-cards');
    const addFormHTML = `
      <div class="personal-raid-card adding">
        <input type="text" class="raid-edit-name-input" placeholder="Raid name" maxlength="50"
               value="${prefillName}" list="raid-name-suggestions">
        <datalist id="raid-name-suggestions">${datalistOptions}</datalist>
        <div class="raid-edit-max">
          <span>Max</span>
          <input type="number" class="raid-edit-max-input" min="1" max="99" value="${prefillMax}">
        </div>
        <div class="raid-edit-actions">
          <button class="btn btn-small btn-secondary raid-add-cancel">Cancel</button>
          <button class="btn btn-small btn-primary raid-add-save">Add</button>
        </div>
      </div>
    `;

    if (raidCards) {
      raidCards.insertAdjacentHTML('beforeend', addFormHTML);
    } else {
      // No raids yet, create the container
      const raidsContainer = block.querySelector('.character-personal-raids');
      raidsContainer.insertAdjacentHTML('afterbegin', `<div class="personal-raid-cards">${addFormHTML}</div>`);
    }

    const addCard = block.querySelector('.personal-raid-card.adding');
    const nameInput = addCard.querySelector('.raid-edit-name-input');
    const maxInput = addCard.querySelector('.raid-edit-max-input');

    nameInput.focus();
    nameInput.select(); // Select pre-filled text for easy replacement

    addCard.querySelector('.raid-add-cancel').addEventListener('click', () => {
      this.hideAddForm(playerId);
    });

    addCard.querySelector('.raid-add-save').addEventListener('click', () => {
      this.saveNewRaid();
    });

    // When user picks from autocomplete, also fill in max clears from that raid
    nameInput.addEventListener('input', () => {
      const selectedName = nameInput.value;
      const existingRaid = this._personalRaids.find(r => r.name === selectedName);
      if (existingRaid) {
        maxInput.value = existingRaid.maxClears;
      }
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveNewRaid();
      if (e.key === 'Escape') this.hideAddForm(playerId);
    });

    maxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveNewRaid();
      if (e.key === 'Escape') this.hideAddForm(playerId);
    });
  },

  hideAddForm(playerId) {
    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (block) {
      const addCard = block.querySelector('.personal-raid-card.adding');
      if (addCard) addCard.remove();

      const addBtn = block.querySelector('.btn-add-raid');
      if (addBtn) addBtn.style.display = '';
    }
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
  },

  showEditRaidForm(raid) {
    this._editingRaidId = raid.id;
    this._editingRaidPlayerId = raid.playerId;

    // Find the raid card and replace it with inline edit form
    const raidCard = document.querySelector(`.personal-raid-card[data-raid-id="${raid.id}"]`);
    if (!raidCard) return;

    // Store original HTML to restore on cancel
    this._originalRaidCardHTML = raidCard.outerHTML;

    raidCard.outerHTML = `
      <div class="personal-raid-card editing" data-raid-id="${raid.id}">
        <input type="text" class="raid-edit-name-input" value="${raid.name}" maxlength="50" placeholder="Raid name">
        <div class="raid-edit-max">
          <span>Max:</span>
          <input type="number" class="raid-edit-max-input" min="1" max="99" value="${raid.maxClears}">
        </div>
        <div class="raid-edit-actions">
          <button class="btn btn-small btn-secondary raid-edit-cancel">Cancel</button>
          <button class="btn btn-small btn-primary raid-edit-save">Save</button>
        </div>
      </div>
    `;

    const editCard = document.querySelector(`.personal-raid-card[data-raid-id="${raid.id}"]`);
    const nameInput = editCard.querySelector('.raid-edit-name-input');
    const maxInput = editCard.querySelector('.raid-edit-max-input');

    nameInput.focus();
    nameInput.select();

    editCard.querySelector('.raid-edit-cancel').addEventListener('click', () => {
      this.cancelInlineEdit(raid);
    });

    editCard.querySelector('.raid-edit-save').addEventListener('click', () => {
      this.saveEditedRaid();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveEditedRaid();
      if (e.key === 'Escape') this.cancelInlineEdit(raid);
    });

    maxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveEditedRaid();
      if (e.key === 'Escape') this.cancelInlineEdit(raid);
    });
  },

  cancelInlineEdit(raid) {
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
    this.refreshPlayerRaids(raid.playerId);
  },

  hideRaidForm(playerId) {
    const pid = playerId || this._editingRaidPlayerId;
    if (pid) {
      const container = document.querySelector(`.add-raid-form-container[data-player-id="${pid}"]`);
      if (container) container.innerHTML = '';
      const block = document.querySelector(`.character-block[data-player-id="${pid}"]`);
      if (block) {
        const addBtn = block.querySelector('.btn-add-raid');
        if (addBtn) addBtn.style.display = '';
      }
    }
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
  },

  async saveNewRaid() {
    const playerId = this._editingRaidPlayerId;
    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (!block) return;

    const addCard = block.querySelector('.personal-raid-card.adding');
    if (!addCard) return;

    const nameInput = addCard.querySelector('.raid-edit-name-input');
    const maxInput = addCard.querySelector('.raid-edit-max-input');
    const name = nameInput.value.trim();
    const maxClears = parseInt(maxInput.value, 10);

    if (!name) {
      toast.error('Raid name cannot be empty');
      return;
    }
    if (!maxClears || maxClears < 1) {
      toast.error('Max clears must be at least 1');
      return;
    }
    if (!playerId) {
      toast.error('No character selected');
      return;
    }

    try {
      await dataService.addPersonalRaid(playerId, name, maxClears);
      // Remember for pre-filling next add form
      this._lastAddedRaid = { name, maxClears };
      this.hideAddForm(playerId);
      await this.loadPersonalRaids();
      this.refreshPlayerRaids(playerId);
      toast.success('Raid added!');
    } catch (error) {
      if (error.message?.includes('duplicate') || error.code === '23505') {
        toast.error('A raid with that name already exists for this character');
      } else {
        toast.error(`Failed to add raid: ${error.message}`);
      }
    }
  },

  async saveEditedRaid() {
    const editCard = document.querySelector(`.personal-raid-card[data-raid-id="${this._editingRaidId}"]`);
    if (!editCard) return;

    const nameInput = editCard.querySelector('.raid-edit-name-input');
    const maxInput = editCard.querySelector('.raid-edit-max-input');
    const name = nameInput.value.trim();
    const maxClears = parseInt(maxInput.value, 10);
    const playerId = this._editingRaidPlayerId;

    if (!name) {
      toast.error('Raid name cannot be empty');
      return;
    }
    if (!maxClears || maxClears < 1) {
      toast.error('Max clears must be at least 1');
      return;
    }

    try {
      await dataService.updatePersonalRaid(this._editingRaidId, { name, maxClears });
      const raid = this._personalRaids.find(r => r.id === this._editingRaidId);
      if (raid) {
        raid.name = name;
        raid.maxClears = maxClears;
      }
      this._editingRaidId = null;
      this._editingRaidPlayerId = null;
      this.refreshPlayerRaids(playerId);
      toast.success('Raid updated!');
    } catch (error) {
      if (error.message?.includes('duplicate') || error.code === '23505') {
        toast.error('A raid with that name already exists for this character');
      } else {
        toast.error(`Failed to update raid: ${error.message}`);
      }
    }
  },

  // ============================================
  // SHOPPING LIST TAB
  // ============================================

  async renderShoppingTab() {
    const listEl = document.getElementById('my-shopping-list');
    if (!listEl) return;

    if (this._myPlayers.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No characters assigned to your account.</p>';
      return;
    }

    // Lazy-load shopping items on first view
    if (!this._shoppingLoaded) {
      listEl.innerHTML = '<p class="empty-state">Loading…</p>';
      try {
        this._shoppingItems = await dataService.getShoppingList();
        this._shoppingLoaded = true;
      } catch (error) {
        console.error('Error loading shopping list:', error);
        listEl.innerHTML = '<p class="empty-state">Failed to load shopping list.</p>';
        return;
      }
    }

    // Shared account → group → ordered-character structure (read-only here)
    const structure = this.buildAccountStructure(this._myPlayers);
    listEl.innerHTML = this.renderAccountStructure(structure, {
      editable: false,
      containerClass: 'character-cards',
      renderCharacter: (player) => {
        const iconStyle = getClassSpriteStyle(player.role);
        return `
          <div class="character-block shopping-character-block" data-player-id="${player.id}">
            <div class="character-card">
              <div class="character-info">
                ${iconStyle ? `<div class="class-sprite class-icon" style="${iconStyle}"></div>` : ''}
                <div>
                  <span class="character-name">${player.name}</span>
                  <span class="character-class">${player.role}</span>
                </div>
              </div>
            </div>
            <div class="character-shopping" data-player-id="${player.id}">
              ${this.renderShoppingItemsHTML(player.id)}
            </div>
          </div>
        `;
      }
    });
    this.bindShoppingHandlers();
  },

  shoppingTotalFor(playerId) {
    const includeBought = !!this._shoppingTotalAllByPlayer[playerId];
    return this._shoppingItems
      .filter(i => i.playerId === playerId && (includeBought || !i.bought))
      .reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  },

  renderShoppingItemsHTML(playerId) {
    const items = this._shoppingItems.filter(i => i.playerId === playerId);
    let html = '';
    if (items.length > 0) {
      html += '<div class="shopping-items-list">';
      items.forEach(item => {
        html += `
          <div class="shopping-item ${item.bought ? 'bought' : ''}" data-item-id="${item.id}">
            <button class="shopping-check" data-item-id="${item.id}" title="${item.bought ? 'Mark as not bought' : 'Mark as bought'}">${item.bought ? '✓' : ''}</button>
            <span class="shopping-item-text">${escapeHtml(item.item)}</span>
            <input type="number" class="shopping-price-input" data-item-id="${item.id}" value="${item.price || ''}" min="0" step="any" placeholder="0" title="Price">
            <button class="shopping-delete-btn" data-item-id="${item.id}" title="Delete">&times;</button>
          </div>
        `;
      });
      html += '</div>';
    }
    html += `
      <form class="shopping-add-form" data-player-id="${playerId}">
        <input type="text" class="shopping-add-input" placeholder="Add an item…" maxlength="100" autocomplete="off">
        <input type="number" class="shopping-add-price" placeholder="Price" min="0" step="any" autocomplete="off">
        <button type="submit" class="btn btn-add-shopping">+ Add</button>
      </form>
    `;
    if (items.length > 0) {
      const includeBought = !!this._shoppingTotalAllByPlayer[playerId];
      const total = this.shoppingTotalFor(playerId);
      html += `
        <div class="shopping-total-row">
          <label class="shopping-total-toggle" title="Include items already marked as bought in this total">
            <input type="checkbox" class="shopping-total-all" data-player-id="${playerId}" ${includeBought ? 'checked' : ''}>
            <span>Include bought</span>
          </label>
          <span class="shopping-total-label">Total</span>
          <span class="shopping-total-value">${total.toLocaleString()}</span>
        </div>
      `;
    }
    return html;
  },

  refreshShoppingItems(playerId) {
    const container = document.querySelector(`.character-shopping[data-player-id="${playerId}"]`);
    if (!container) return;
    container.innerHTML = this.renderShoppingItemsHTML(playerId);
    this.bindShoppingHandlersFor(container, playerId);
  },

  bindShoppingHandlers() {
    document.querySelectorAll('.character-shopping').forEach(container => {
      this.bindShoppingHandlersFor(container, container.dataset.playerId);
    });
  },

  bindShoppingHandlersFor(container, playerId) {
    // Add item
    const form = container.querySelector('.shopping-add-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.addShoppingItem(playerId, form);
      });
    }

    // Toggle bought
    container.querySelectorAll('.shopping-check').forEach(btn => {
      btn.addEventListener('click', () => this.toggleShoppingItem(btn.dataset.itemId, playerId));
    });

    // Delete
    container.querySelectorAll('.shopping-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteShoppingItem(btn.dataset.itemId, playerId));
    });

    // Edit price (commit on change/blur)
    container.querySelectorAll('.shopping-price-input').forEach(input => {
      input.addEventListener('change', () => this.updateShoppingPrice(input.dataset.itemId, input.value, playerId));
    });

    // Per-card "include bought in total" toggle
    const totalToggle = container.querySelector('.shopping-total-all');
    if (totalToggle) {
      totalToggle.addEventListener('change', () => {
        this._shoppingTotalAllByPlayer[playerId] = totalToggle.checked;
        localStorage.setItem(SHOPPING_TOTAL_PREFS_KEY, JSON.stringify(this._shoppingTotalAllByPlayer));
        const valueEl = container.querySelector('.shopping-total-value');
        if (valueEl) valueEl.textContent = this.shoppingTotalFor(playerId).toLocaleString();
      });
    }
  },

  async addShoppingItem(playerId, form) {
    const input = form.querySelector('.shopping-add-input');
    const text = input.value.trim();
    if (!text) return;

    const priceInput = form.querySelector('.shopping-add-price');
    const price = Number(priceInput.value) || 0;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const { data } = await dataService.addShoppingItem(playerId, text, price);
      this._shoppingItems.push({
        id: data.id,
        playerId,
        item: data.item,
        bought: data.bought,
        price: Number(data.price) || 0,
        sortOrder: data.sort_order
      });
      this.refreshShoppingItems(playerId);
      // Keep focus on the (new) input for fast successive entry
      const newInput = document.querySelector(`.character-shopping[data-player-id="${playerId}"] .shopping-add-input`);
      if (newInput) newInput.focus();
    } catch (error) {
      toast.error(`Failed to add item: ${error.message}`);
      submitBtn.disabled = false;
    }
  },

  async toggleShoppingItem(itemId, playerId) {
    const item = this._shoppingItems.find(i => i.id === itemId);
    if (!item) return;
    const newBought = !item.bought;
    try {
      await dataService.updateShoppingItem(itemId, { bought: newBought });
      item.bought = newBought;
      this.refreshShoppingItems(playerId);
    } catch (error) {
      toast.error(`Failed to update: ${error.message}`);
    }
  },

  async updateShoppingPrice(itemId, value, playerId) {
    const item = this._shoppingItems.find(i => i.id === itemId);
    if (!item) return;
    const newPrice = Number(value) || 0;
    if (newPrice === item.price) return;
    try {
      await dataService.updateShoppingItem(itemId, { price: newPrice });
      item.price = newPrice;
      this.refreshShoppingItems(playerId);
    } catch (error) {
      toast.error(`Failed to update price: ${error.message}`);
    }
  },

  async deleteShoppingItem(itemId, playerId) {
    const item = this._shoppingItems.find(i => i.id === itemId);
    if (!item) return;
    try {
      await dataService.deleteShoppingItem(itemId);
      this._shoppingItems = this._shoppingItems.filter(i => i.id !== itemId);
      this.refreshShoppingItems(playerId);
    } catch (error) {
      toast.error(`Failed to delete: ${error.message}`);
    }
  },

  // ============================================
  // CARDS TAB
  // ============================================

  async renderCardsTab() {
    const listEl = document.getElementById('my-cards-list');
    if (!listEl) return;

    // Characters must be whitelisted (and not excluded) to use the card collection.
    const cardEligiblePlayers = this._myPlayers.filter(p => dataService.isPlayerWhitelisted(p));

    if (this._myPlayers.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No characters assigned to your account.</p>';
      return;
    }
    if (cardEligiblePlayers.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No card-eligible characters on your account.</p>';
      return;
    }

    // Lazy-load cards + extras + custom slot names + page count on first view
    if (!this._cardsLoaded) {
      listEl.innerHTML = '<p class="empty-state">Loading cards…</p>';
      try {
        const playerIds = cardEligiblePlayers.map(p => p.id);
        const [allCards, allExtras, names, pageCount] = await Promise.all([
          dataService.getPlayerCards(),
          dataService.getExtraCards(),
          dataService.getCardSlotNames(),
          dataService.getCardPageCount()
        ]);
        this._playerCards = allCards.filter(c => playerIds.includes(c.playerId));
        // Group extras by player and sort
        const extrasByPlayer = {};
        (allExtras || []).filter(e => playerIds.includes(e.playerId)).forEach(e => {
          if (!extrasByPlayer[e.playerId]) extrasByPlayer[e.playerId] = [];
          extrasByPlayer[e.playerId].push(e);
        });
        const rarityOrder = ['legend', 'unique', 'epic', 'rare', 'magic'];
        Object.values(extrasByPlayer).forEach(list => list.sort((a, b) => {
          if (a.cardName !== b.cardName) return a.cardName.localeCompare(b.cardName);
          return rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
        }));
        this._extrasByPlayer = extrasByPlayer;
        this._cardNames = names || {};
        this._cardPageCount = pageCount || DEFAULT_CARD_PAGES;
        this._cardsLoaded = true;
      } catch (error) {
        console.error('Error loading cards:', error);
        listEl.innerHTML = '<p class="empty-state">Failed to load cards.</p>';
        return;
      }
    }

    this.installCardsPasteHandler();

    // Shared account → group → ordered structure (read-only). Only
    // card-eligible characters appear, so empty group sections are hidden.
    const structure = this.buildAccountStructure(cardEligiblePlayers);
    listEl.innerHTML = this.renderAccountStructure(structure, {
      editable: false,
      containerClass: 'character-cards cards-grid',
      hideEmptyGroups: true,
      renderCharacter: (player) => this.renderCardCharacterBlockHTML(player)
    });

    this.setupCardGridHandlers();
  },

  renderCardCharacterBlockHTML(player) {
    const iconStyle = getClassSpriteStyle(player.role);
    const currentPage = this._cardsPageByPlayer[player.id] || 1;
    const section = this._sectionByPlayer[player.id] || 'slots';
    const showSlots = section === 'slots';
    return `
      <div class="card-character-block" data-player-id="${player.id}">
        <div class="card-character-header">
          <div class="character-info">
            ${iconStyle ? `<div class="class-sprite class-icon" style="${iconStyle}"></div>` : ''}
            <div>
              <span class="character-name">${player.name}</span>
              <span class="character-class">${player.role}</span>
            </div>
          </div>
          <div class="card-character-actions">
            <button class="card-paste-btn" data-player-id="${player.id}" title="Upload or paste a screenshot for the current page" ${showSlots ? '' : 'style="display:none"'}>
              <svg class="card-paste-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>Upload/Paste page ${currentPage}</span>
            </button>
          </div>
        </div>
        <div class="card-section-tabs" data-player-id="${player.id}">
          <button class="card-section-tab ${showSlots ? 'active' : ''}" data-section="slots" data-player-id="${player.id}">Equipped</button>
          <button class="card-section-tab ${!showSlots ? 'active' : ''}" data-section="extras" data-player-id="${player.id}">Extras</button>
        </div>
        <div class="card-section-stack" data-player-id="${player.id}">
          <div class="card-section card-section-slots" data-player-id="${player.id}" data-section-active="${showSlots}">
            <div class="card-grid" data-player-id="${player.id}">
              ${this.renderCardGridHTML(player.id, currentPage)}
            </div>
            <div class="card-pagination-wrap" data-player-id="${player.id}">
              ${renderPagination(currentPage, this._cardPageCount)}
            </div>
          </div>
          <div class="card-section card-section-extras" data-player-id="${player.id}" data-section-active="${!showSlots}">
            ${this.renderExtrasSectionHTML(player.id)}
          </div>
        </div>
      </div>
    `;
  },

  resolveSlotName(slotIndex) {
    return this._cardNames?.[slotIndex] || '';
  },

  renderCardGridHTML(playerId, page) {
    const startIdx = (page - 1) * CARDS_PER_PAGE;
    const playerCards = this._playerCards.filter(c => c.playerId === playerId);
    const byIndex = {};
    playerCards.forEach(c => { byIndex[c.slotIndex] = c.rarity; });

    let html = '';
    for (let i = 0; i < CARDS_PER_PAGE; i++) {
      const slotIndex = startIdx + i;
      const rarity = byIndex[slotIndex] || '';
      const rarityInfo = CARD_RARITIES.find(r => r.value === rarity);
      const color = rarityInfo?.color || '';
      const name = this.resolveSlotName(slotIndex);
      const label = name || `Slot ${slotIndex + 1}`;
      html += `
        <div class="card-slot ${rarity ? 'has-card' : ''}"
             data-player-id="${playerId}"
             data-slot-index="${slotIndex}"
             data-rarity="${rarity}"
             style="${color ? `--rarity-color: ${color}` : ''}"
             title="${label}${rarity ? ` — ${rarityInfo.label}` : ''}">
          <span class="card-slot-label">${label}</span>
        </div>
      `;
    }
    return html;
  },

  renderExtrasSectionHTML(playerId) {
    const extras = this._extrasByPlayer[playerId] || [];
    let rowsHtml = '';
    if (extras.length === 0) {
      rowsHtml = `<p class="card-extras-empty">No extras yet. Add one below.</p>`;
    } else {
      rowsHtml = `<div class="card-extras-list">${extras.map(e => {
        const info = CARD_RARITIES.find(r => r.value === e.rarity);
        const color = info?.color || '';
        return `
          <div class="card-extra-row" data-extra-id="${e.id}">
            <span class="extra-rarity-dot" style="color:${color};background:${color}" title="${info?.label || e.rarity}"></span>
            <span class="extra-card-name">${e.cardName}</span>
            <span class="extra-amount-controls">
              <button class="extra-amount-btn" data-action="extra-dec" data-extra-id="${e.id}">−</button>
              <span class="extra-amount">×${e.amount}</span>
              <button class="extra-amount-btn" data-action="extra-inc" data-extra-id="${e.id}">+</button>
            </span>
            <button class="extra-delete-btn" data-action="extra-delete" data-extra-id="${e.id}" title="Remove">×</button>
          </div>
        `;
      }).join('')}</div>`;
    }

    // Add form: name select from Card Map, rarity, amount
    const uniqueNames = [...new Set(Object.values(this._cardNames || {}).map(n => (n || '').trim()).filter(Boolean))].sort();
    const nameOptions = uniqueNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
    const rarityOptions = CARD_RARITIES.map(r => `<option value="${r.value}">${r.label}</option>`).join('');

    const formHtml = `
      <form class="card-extras-form" data-action="extra-add" data-player-id="${playerId}">
        <select class="extras-name-select" required ${uniqueNames.length === 0 ? 'disabled' : ''}>
          <option value="">${uniqueNames.length === 0 ? 'No cards in Card Map yet' : 'Pick a card…'}</option>
          ${nameOptions}
        </select>
        <select class="extras-rarity-select" required>${rarityOptions}</select>
        <input class="extras-amount-input" type="number" min="1" max="999" value="1" required>
        <button type="submit" class="extras-add-btn">Add</button>
      </form>
    `;

    return `${rowsHtml}${formHtml}`;
  },

  refreshExtrasSection(playerId) {
    document.querySelectorAll(`.card-section-extras[data-player-id="${playerId}"]`).forEach(section => {
      section.innerHTML = this.renderExtrasSectionHTML(playerId);
      this.bindExtrasHandlers(playerId);
    });
  },

  bindExtrasHandlers(playerId) {
    document.querySelectorAll(`.card-section-extras[data-player-id="${playerId}"]`).forEach(section => {
      section.querySelectorAll('[data-action="extra-add"]').forEach(form => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleAddExtra(form, playerId);
        });
      });
      section.querySelectorAll('[data-action="extra-inc"]').forEach(btn => {
        btn.addEventListener('click', () => this.handleExtraAmountDelta(btn.dataset.extraId, +1));
      });
      section.querySelectorAll('[data-action="extra-dec"]').forEach(btn => {
        btn.addEventListener('click', () => this.handleExtraAmountDelta(btn.dataset.extraId, -1));
      });
      section.querySelectorAll('[data-action="extra-delete"]').forEach(btn => {
        btn.addEventListener('click', () => this.handleExtraDelete(btn.dataset.extraId));
      });
    });
  },

  async handleAddExtra(form, playerId) {
    const nameSelect = form.querySelector('.extras-name-select');
    const raritySelect = form.querySelector('.extras-rarity-select');
    const amountInput = form.querySelector('.extras-amount-input');
    const submitBtn = form.querySelector('button[type="submit"]');

    const cardName = nameSelect.value.trim();
    const rarity = raritySelect.value;
    const amount = parseInt(amountInput.value, 10);

    if (!cardName) { toast.error('Pick a card from the list'); return; }
    if (!rarity) { toast.error('Pick a rarity'); return; }
    if (!Number.isFinite(amount) || amount < 1) { toast.error('Amount must be at least 1'); return; }

    submitBtn.disabled = true;
    try {
      await dataService.addExtraCard(playerId, cardName, rarity, amount);
      await this.reloadExtrasFor(playerId);
      nameSelect.value = '';
      amountInput.value = '1';
      toast.success(`Added ${amount} × ${cardName}`);
    } catch (err) {
      toast.error(`Failed to add: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
    }
  },

  async handleExtraAmountDelta(extraId, delta) {
    const list = Object.values(this._extrasByPlayer).flat();
    const extra = list.find(e => e.id === extraId);
    if (!extra) return;
    const newAmount = extra.amount + delta;
    try {
      if (newAmount <= 0) {
        await dataService.removeExtraCard(extraId);
      } else {
        await dataService.setExtraCardAmount(extraId, newAmount);
      }
      await this.reloadExtrasFor(extra.playerId);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
  },

  async handleExtraDelete(extraId) {
    const list = Object.values(this._extrasByPlayer).flat();
    const extra = list.find(e => e.id === extraId);
    if (!extra) return;
    const confirmed = await modal.confirm(
      `Remove "${extra.cardName}" (${extra.rarity}, ×${extra.amount}) from extras?`,
      { title: 'Remove Extra', confirmText: 'Remove', cancelText: 'Cancel', danger: true }
    );
    if (!confirmed) return;
    try {
      await dataService.removeExtraCard(extraId);
      await this.reloadExtrasFor(extra.playerId);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
  },

  async reloadExtrasFor(playerId) {
    try {
      const list = await dataService.getExtraCards(playerId);
      const rarityOrder = ['legend', 'unique', 'epic', 'rare', 'magic'];
      list.sort((a, b) => {
        if (a.cardName !== b.cardName) return a.cardName.localeCompare(b.cardName);
        return rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
      });
      this._extrasByPlayer[playerId] = list;
      this.refreshExtrasSection(playerId);
    } catch (err) {
      console.error('Failed to reload extras:', err);
    }
  },

  bindSectionTabs() {
    document.querySelectorAll('.card-section-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        const section = btn.dataset.section;
        if (this._sectionByPlayer[playerId] === section) return;
        this._sectionByPlayer[playerId] = section;
        // Update tabs
        document.querySelectorAll(`.card-section-tab[data-player-id="${playerId}"]`).forEach(b => {
          b.classList.toggle('active', b.dataset.section === section);
        });
        // Toggle section visibility via data-attr; both stay in the DOM so the
        // grid-stacked container locks to the taller section's height.
        const showSlots = section === 'slots';
        document.querySelectorAll(`.card-section-slots[data-player-id="${playerId}"]`).forEach(s => {
          s.dataset.sectionActive = String(showSlots);
        });
        document.querySelectorAll(`.card-section-extras[data-player-id="${playerId}"]`).forEach(s => {
          s.dataset.sectionActive = String(!showSlots);
        });
        // Hide paste button on extras section
        document.querySelectorAll(`.card-paste-btn[data-player-id="${playerId}"]`).forEach(b => {
          b.style.display = showSlots ? '' : 'none';
        });
      });
    });
  },

  setupCardGridHandlers() {
    // Pagination per character
    this._myPlayers.forEach(player => {
      this.bindPlayerPagination(player.id);
    });

    // Paste/upload buttons
    document.querySelectorAll('.card-paste-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showCardScreenshotUpload(btn.dataset.playerId);
      });
    });

    // Hover tracking: which character is the mouse over?
    // Used by the paste handler to paste-to-the-character-you're-hovering.
    document.querySelectorAll('.card-character-block').forEach(block => {
      const playerId = block.dataset.playerId;
      block.addEventListener('mouseenter', () => { this._hoveredPlayerId = playerId; });
      block.addEventListener('mouseleave', () => {
        if (this._hoveredPlayerId === playerId) this._hoveredPlayerId = null;
      });
    });

    // Slots/Extras section tabs and extras handlers
    this.bindSectionTabs();
    this._myPlayers.forEach(p => this.bindExtrasHandlers(p.id));

    // Slot clicks
    this._myPlayers.forEach(p => this.bindCardSlotHandlers(p.id));
  },

  bindPlayerPagination(playerId) {
    const currentPage = this._cardsPageByPlayer[playerId] || 1;
    const wrap = document.querySelector(`.card-pagination-wrap[data-player-id="${playerId}"] .pagination`);
    bindPagination(wrap, currentPage, this._cardPageCount, (newPage) => {
      this._cardsPageByPlayer[playerId] = newPage;
      // Re-render grid
      const grid = document.querySelector(`.card-grid[data-player-id="${playerId}"]`);
      if (grid) grid.innerHTML = this.renderCardGridHTML(playerId, newPage);
      // Re-render pagination so the active page updates
      const pgWrap = document.querySelector(`.card-pagination-wrap[data-player-id="${playerId}"]`);
      if (pgWrap) pgWrap.innerHTML = renderPagination(newPage, this._cardPageCount);
      // Update paste button label (only the span — keep the icon)
      const pasteLabel = document.querySelector(`.card-paste-btn[data-player-id="${playerId}"] span`);
      if (pasteLabel) pasteLabel.textContent = `Upload/Paste page ${newPage}`;
      this.bindCardSlotHandlers(playerId);
      this.bindPlayerPagination(playerId);
    });
  },

  bindCardSlotHandlers(playerId) {
    document.querySelectorAll(`.card-slot[data-player-id="${playerId}"]`).forEach(slot => {
      slot.addEventListener('click', () => this.cycleSlotRarity(slot));
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.clearSlotRarity(slot);
      });
    });
  },

  async cycleSlotRarity(slot) {
    const playerId = slot.dataset.playerId;
    const slotIndex = parseInt(slot.dataset.slotIndex, 10);
    const current = slot.dataset.rarity || '';
    // Cycle: '' -> magic -> rare -> epic -> unique -> legend -> ''
    const order = ['', 'magic', 'rare', 'epic', 'unique', 'legend'];
    const next = order[(order.indexOf(current) + 1) % order.length];

    slot.style.opacity = '0.5';
    try {
      await dataService.setPlayerCard(playerId, slotIndex, next);
      this.updateLocalCard(playerId, slotIndex, next);
      this.repaintSlot(slot, next);
    } catch (error) {
      toast.error(`Failed to update card: ${error.message}`);
    } finally {
      slot.style.opacity = '1';
    }
  },

  async clearSlotRarity(slot) {
    const playerId = slot.dataset.playerId;
    const slotIndex = parseInt(slot.dataset.slotIndex, 10);
    if (!slot.dataset.rarity) return;

    slot.style.opacity = '0.5';
    try {
      await dataService.removePlayerCard(playerId, slotIndex);
      this.updateLocalCard(playerId, slotIndex, '');
      this.repaintSlot(slot, '');
    } catch (error) {
      toast.error(`Failed to clear card: ${error.message}`);
    } finally {
      slot.style.opacity = '1';
    }
  },

  updateLocalCard(playerId, slotIndex, rarity) {
    this._playerCards = this._playerCards.filter(
      c => !(c.playerId === playerId && c.slotIndex === slotIndex)
    );
    if (rarity) {
      this._playerCards.push({ playerId, slotIndex, rarity });
    }
  },

  repaintSlot(slot, rarity) {
    const rarityInfo = CARD_RARITIES.find(r => r.value === rarity);
    slot.dataset.rarity = rarity;
    slot.classList.toggle('has-card', !!rarity);
    slot.style.setProperty('--rarity-color', rarityInfo?.color || '');
    const slotIndex = parseInt(slot.dataset.slotIndex, 10);
    const label = this.resolveSlotName(slotIndex) || `Slot ${slotIndex + 1}`;
    slot.title = `${label}${rarity ? ` — ${rarityInfo.label}` : ''}`;
  },

  // ============================================
  // CARD SCREENSHOT UPLOAD
  // ============================================

  installCardsPasteHandler() {
    if (this._pasteHandler) return;
    this._pasteHandler = (e) => {
      if (this._activeTab !== 'cards') return;

      // Modal target wins; otherwise paste against whichever character the mouse is over.
      const modalTarget = this._pasteTargetPlayerId;
      const hoverTarget = this._hoveredPlayerId;
      if (!modalTarget && !hoverTarget) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (modalTarget) {
            this.handleCardImageFile(file, modalTarget);
          } else {
            this.hoverPasteAndApply(hoverTarget, file);
          }
          return;
        }
      }
    };
    document.addEventListener('paste', this._pasteHandler);
  },

  async hoverPasteAndApply(playerId, file) {
    if (!file || !file.type.startsWith('image/')) return;

    const player = this._myPlayers.find(p => p.id === playerId);
    if (!player) return;

    const page = this._cardsPageByPlayer[playerId] || 1;
    const block = document.querySelector(`.card-character-block[data-player-id="${playerId}"]`);
    block?.classList.add('analyzing');
    toast.info(`Analyzing ${player.name} page ${page}…`);

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch('/.netlify/functions/analyze-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: file.type, page })
      });
      const data = await response.json();

      if (data.error && !data.slots) {
        toast.error(`Analysis failed: ${data.error}`);
        return;
      }
      if (!Array.isArray(data.slots)) {
        toast.error('Bad response from analyzer');
        return;
      }

      await this.applyAnalyzedSlots(playerId, page, data.slots);
      toast.success(`${player.name} page ${page} updated (${data.confidence || 'unknown'} confidence)`);
    } catch (err) {
      console.error('hoverPasteAndApply error:', err);
      toast.error('Failed to analyze screenshot');
    } finally {
      block?.classList.remove('analyzing');
    }
  },

  showCardScreenshotUpload(playerId) {
    this._pasteTargetPlayerId = playerId;
    const page = this._cardsPageByPlayer[playerId] || 1;
    const player = this._myPlayers.find(p => p.id === playerId);
    const playerName = player?.name || 'character';

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-content card-screenshot-modal">
        <h2>Import Card Page ${page}</h2>
        <p class="modal-hint">Paste (Ctrl+V) or drop a screenshot of <strong>${playerName}</strong>'s card page ${page}. The analyzer detects rarities for the 16 slots on this page.</p>
        <div class="modal-upload-zone" id="card-upload-zone">
          <div class="modal-upload-placeholder">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Click, drop, or paste an image</span>
          </div>
          <img id="card-screenshot-preview" class="modal-screenshot-preview" style="display:none" />
          <input type="file" id="card-screenshot-input" accept="image/*" style="display:none" />
        </div>
        <div class="card-screenshot-actions">
          <span id="card-upload-status" class="upload-status"></span>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" id="card-upload-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="card-analyze-btn" disabled>Analyze & Apply</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const zone = overlay.querySelector('#card-upload-zone');
    const fileInput = overlay.querySelector('#card-screenshot-input');
    const preview = overlay.querySelector('#card-screenshot-preview');
    const placeholder = overlay.querySelector('.modal-upload-placeholder');
    const status = overlay.querySelector('#card-upload-status');
    const analyzeBtn = overlay.querySelector('#card-analyze-btn');
    const cancelBtn = overlay.querySelector('#card-upload-cancel');

    let imageData = null;
    let mimeType = null;

    const handleFile = (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      mimeType = file.type;
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        analyzeBtn.disabled = false;
        imageData = e.target.result.split(',')[1];
      };
      reader.readAsDataURL(file);
    };

    this.handleCardImageFile = handleFile;

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    const close = () => {
      this._pasteTargetPlayerId = null;
      this.handleCardImageFile = null;
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.remove();
    };

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    cancelBtn.addEventListener('click', close);

    analyzeBtn.addEventListener('click', async () => {
      if (!imageData) return;
      analyzeBtn.disabled = true;
      status.textContent = 'Analyzing…';
      status.style.color = '';
      try {
        const response = await fetch('/.netlify/functions/analyze-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageData, mimeType, page })
        });
        const data = await response.json();
        if (data.error && !data.slots) {
          status.textContent = 'Failed: ' + data.error;
          status.style.color = '#e57373';
          toast.error('Analysis failed');
          analyzeBtn.disabled = false;
          return;
        }
        if (!Array.isArray(data.slots)) {
          status.textContent = 'Bad response from analyzer';
          status.style.color = '#e57373';
          analyzeBtn.disabled = false;
          return;
        }

        await this.applyAnalyzedSlots(playerId, page, data.slots);
        toast.success(`Page ${page} updated (${data.confidence || 'unknown'} confidence)`);
        close();
      } catch (err) {
        status.textContent = 'Error analyzing screenshot';
        status.style.color = '#e57373';
        toast.error('Failed to analyze screenshot');
        analyzeBtn.disabled = false;
      }
    });
  },

  async applyAnalyzedSlots(playerId, page, slots) {
    const startIdx = (page - 1) * CARDS_PER_PAGE;
    const validRarities = new Set(CARD_RARITIES.map(r => r.value));
    const entries = slots
      .filter(s => typeof s.position === 'number' && s.position >= 0 && s.position < CARDS_PER_PAGE)
      .map(s => ({
        slotIndex: startIdx + s.position,
        rarity: validRarities.has(s.rarity) ? s.rarity : ''
      }));

    await dataService.bulkSetPlayerCards(playerId, entries);
    entries.forEach(e => this.updateLocalCard(playerId, e.slotIndex, e.rarity));

    // Re-render this player's grid
    this._cardsPageByPlayer[playerId] = page;
    const grid = document.querySelector(`.card-grid[data-player-id="${playerId}"]`);
    if (grid) grid.innerHTML = this.renderCardGridHTML(playerId, page);
    this.bindCardSlotHandlers(playerId);
  }
};

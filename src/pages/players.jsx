import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { inputValidator } from '../input-validator.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, WEAPON_SUFFIXES, CLASS_FAMILIES, calculateGearscore, getGearscoreTier, gearscoreTooltipText, MAX_FD, fdToPercent, formatPlayerEquipmentHtml, getClassSpriteStyle } from '../constants.js';
import { modal } from '../modal.js';
import { panelStats, syncedLabel, syncedAge } from '../sim/panel.js';
import simOptions from '../data/sim/options.json' with { type: 'json' };
import { NONE } from '../sim/remote.js';
import { emptyEngravings, engravingMainOptions, setEngravingRank, ENGRAVING_RARITY } from '../sim/engravings.js';
import { renderPagination, bindPagination } from '../pagination.js';
import { initFixedTooltip } from '../fixed-tooltip.js';
import { GUILD_ONLY_TAG } from '../guild-lock.js';
import itemIcons from '../data/sim-icons.json' with { type: 'json' };
import { cardsForTier, cardCellHtml, tierTabsHtml, raritiesFromGrades, raritiesFromSlots, CARDS_PER_PAGE as GAME_CARDS_PER_PAGE } from '../card-collection.js';
import { createCharacterBuilder, emptyBuildFor, siteClassName } from './simulator.jsx';
import { deriveStats } from '../sim/derive-stats.js';
import { GAME_RAIDS, raidProgress, raidStatus, weeklyClearsThisWeek } from '../raid-clears.js';
import { uploadHtml, setupUpload, renderGearReview } from '../sim/screenshot-import.js';

// Gear slots on the character card: site key, simulator slot, short label.
const CARD_ARMOR = [['helmet', 'Helmet', 'Helm'], ['top', 'Upper', 'Top'], ['bottom', 'Lower', 'Bottom'], ['gloves', 'Gloves', 'Gloves'], ['boots', 'Shoes', 'Boots']];
const CARD_WEAPONS = [['mainWeapon', 'Main weapon', 'Main'], ['subWeapon', 'Secondary weapon', 'Sub']];
const CARD_JEWELRY = [['necklace', 'Necklace', 'Neck'], ['earring', 'Earring', 'Ear'], ['ring1', 'Ring 1', 'Ring'], ['ring2', 'Ring 2', 'Ring']];
// Site class names that the simulator tables spell differently.
const SIM_JOB_NAMES = { 'Moon Lord': 'Moonlord' };
const ICON_SPRITE = '/sim/item-icons.webp';
const ICON_PX = 44;
// Stats a hand-built character may type from the game window: character_stats key, label, has decimals.
const HAND_STATS = [['attackPower', 'ATK'], ['magicAttack', 'MATK'], ['finalDamage', 'FD'], ['hp', 'HP'], ['defense', 'Def'], ['magicDefense', 'MDef'],
  ['criticalRate', 'Crit %', true], ['criticalDamage', 'Crit Dmg %', true], ['fireAttack', 'Fire %', true], ['iceAttack', 'Ice %', true],
  ['lightAttack', 'Light %', true], ['darkAttack', 'Dark %', true]];
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';


Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

export const PlayersPage = {
  // Cache for app users (for owner dropdown)
  _appUsers: [],
  // Open Add/Edit Character builders by form prefix.
  _builders: {},

  // Group by owner toggle state (persisted in localStorage)
  // Flat view disabled for now - grouped view is the only option
  _groupByOwner: true,

  // View mode: 'characters' (grouped), 'browse' (flat searchable), or 'roster'
  _viewMode: 'characters',

  // Browse view state (flat searchable/sortable list of all characters)
  _browseSearch: '',
  _browseSort: localStorage.getItem('playersBrowseSort') || 'owner', // owner | gs | name | class
  _browseDisplay: localStorage.getItem('playersBrowseDisplay') || 'grid', // grid | table
  _browseUserMap: null,
  _browseAccountSizes: {}, // discordId -> count of distinct account numbers

  // Chart instance reference
  _chartInstance: null,

  // Gearscore filter for roster view (0 = show all)
  _gsFilter: 0,

  // Cached data for roster re-renders
  _rosterPlayers: null,
  _rosterUserMap: null,

  // Per-character card view state: { [playerId]: 'stats' | 'cards' } — default 'stats'
  _charCardView: {},

  // Per-character mini-grid page state: { [playerId]: pageNumber } — default 1
  _charCardPageByPlayer: {},

  // Card-collection data (loaded with the page)
  _cardCollection: {
    loaded: false,
    loading: null, // promise while a load is in-flight
    byPlayerId: {}, // playerId -> { [slotIndex]: rarity }
  },

  // Class family colors for chart
  _classFamilyColors: {
    warrior: '#F08A46',
    archer: '#A8F274',
    sorceress: '#DF69FF',
    cleric: '#6CC9EB',
    academic: '#F7DA6F',
    kali: '#756EFF',
    assassin: '#3FD68C'
  },

  // Check if current user can edit a player (using Discord-linked ownership)
  canEditCharacter(player) {
    return dataService.canEditPlayer(player);
  },

  // Inline exclude toggle (admin only) — used in row/card renders
  _buildExcludeToggleHtml(player) {
    if (!dataService.isAdmin()) return '';
    const isOn = !!player.exclude;
    const label = isOn ? 'Excluded' : 'Exclude';
    const tip = isOn ? 'Click to include' : 'Click to exclude from recruiting';
    return `<button type="button" class="exclude-pill ${isOn ? 'is-on' : ''} tooltip-wrap"
      data-action="toggle-exclude" data-player-id="${player.id}" data-exclude="${isOn}"
      data-tooltip="${tip}">${label}</button>`;
  },

  // Inline whitelist tag. Whitelist = "in our guild — gets guild features".
  // Everyone sees the In Guild / Not in Guild tag; only admins can click to toggle.
  _buildWhitelistToggleHtml(player) {
    const isOn = !!player.whitelisted;
    const label = isOn ? 'In Guild' : 'Not in Guild';
    if (!dataService.isAdmin()) {
      // Normal users: only flag the exceptions ("Not in Guild") to cut noise;
      // in-guild characters show no tag.
      if (isOn) return '';
      return `<span class="whitelist-pill is-readonly">${label}</span>`;
    }
    const tip = isOn ? 'Click to remove guild access' : 'Click to whitelist (grant guild access)';
    return `<button type="button" class="whitelist-pill ${isOn ? 'is-on' : ''} tooltip-wrap"
      data-action="toggle-whitelist" data-player-id="${player.id}" data-whitelisted="${isOn}"
      data-tooltip="${tip}">${label}</button>`;
  },

  // ============================================
  // CHARACTER CARD: STATS / CARDS VIEW TOGGLE
  // ============================================

  // Guild members and above see card collections.
  _canSeeCards() {
    return dataService.isPlayer();
  },

  _charViewFor(player) {
    return this._charCardView[player.id] || 'stats';
  },

  // Grades by card name: synced characters from their sync, others from hand-kept slots.
  _cardRarities(player) {
    const synced = raritiesFromGrades(player.build?.card_grades);
    if (player.syncedAt && synced.size) return synced;
    return raritiesFromSlots(this._cardCollection.byPlayerId?.[player.id]);
  },

  _playerHasCards(playerId) {
    const player = (this._allPlayers || []).find(p => p.id === playerId);
    return !!player && this._cardRarities(player).size > 0;
  },

  _buildCharCardToggleHtml(player) {
    // Only whitelisted, non-excluded characters can show a card collection,
    // and only if they actually have at least one card recorded.
    if (!this._canSeeCards()) return '';
    if (!dataService.isPlayerWhitelisted(player)) return '';
    if (!this._playerHasCards(player.id)) return '';
    const view = this._charViewFor(player);
    const tab = (v, label) =>
      `<button type="button" class="char-card-view-tab ${view === v ? 'active' : ''}"
        data-action="char-view" data-player-id="${player.id}" data-view="${v}">${label}</button>`;
    return `<div class="char-card-view-toggle">${tab('stats', 'Stats')}${tab('cards', 'Cards')}</div>`;
  },

  _charCardTier(playerId) {
    return this._charCardTierByPlayer?.[playerId] ?? null;
  },

  _buildMiniCardGridHtml(player, page) {
    const rarities = this._cardRarities(player);
    return cardsForTier(this._charCardTier(player.id))
      .slice((page - 1) * GAME_CARDS_PER_PAGE, page * GAME_CARDS_PER_PAGE)
      .map(({ name, index }) => cardCellHtml({ name, index, rarity: rarities.get(name) || '', className: 'char-card-mini-slot' }))
      .join('');
  },

  _buildCharCardCollectionHtml(player) {
    if (!this._cardCollection.loaded) {
      return `<div class="char-card-collection"><p class="char-card-collection-loading">Loading cards…</p></div>`;
    }
    const pageCount = Math.max(1, Math.ceil(cardsForTier(this._charCardTier(player.id)).length / GAME_CARDS_PER_PAGE));
    const page = Math.min(this._charCardPageByPlayer[player.id] || 1, pageCount);
    return `
      <div class="char-card-collection" data-player-id="${player.id}">
        ${tierTabsHtml(this._charCardTier(player.id), `data-player-id="${player.id}"`)}
        <div class="char-card-mini-grid">${this._buildMiniCardGridHtml(player, page)}</div>
        <div class="char-card-mini-pagination">${renderPagination(page, pageCount)}</div>
      </div>
    `;
  },

  _ccBodyHtml(player) {
    if (this._charViewFor(player) === 'cards' && this._canSeeCards() && dataService.isPlayerWhitelisted(player)) {
      return this._buildCharCardCollectionHtml(player);
    }
    return `${this._cardSlotsHtml(player)}${this._cardStatsHtml(player)}`;
  },

  _buildCharCardBodyHtml(player, detailHtml) {
    if (this._charViewFor(player) === 'cards' && dataService.isPlayerWhitelisted(player)) {
      return this._buildCharCardCollectionHtml(player);
    }
    return `${detailHtml}${player.notes ? `<div class="char-card-notes">${player.notes}</div>` : ''}`;
  },

  async _ensureCardCollectionLoaded() {
    if (this._cardCollection.loaded) return;
    if (this._cardCollection.loading) {
      await this._cardCollection.loading;
      return;
    }
    this._cardCollection.loading = (async () => {
      try {
        const allCards = await dataService.getPlayerCards();
        const byPlayerId = {};
        (allCards || []).forEach(c => {
          if (!byPlayerId[c.playerId]) byPlayerId[c.playerId] = {};
          byPlayerId[c.playerId][c.slotIndex] = c.rarity;
        });
        this._cardCollection.byPlayerId = byPlayerId;
        this._cardCollection.loaded = true;
      } catch (err) {
        console.error('Failed to load card collection:', err);
      } finally {
        this._cardCollection.loading = null;
      }
    })();
    await this._cardCollection.loading;
  },

  _bindCharCardToggles(rootEl = document) {
    rootEl.querySelectorAll('[data-action="char-view"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const playerId = btn.dataset.playerId;
        const view = btn.dataset.view;
        if (this._charCardView[playerId] === view) return;
        this._charCardView[playerId] = view;

        if (view === 'cards' && !this._cardCollection.loaded) {
          await this._ensureCardCollectionLoaded();
        }
        this._refreshCharCardBody(playerId);
      });
    });
  },

  // Replace just the body of every .char-card for this player (there can be
  // duplicates if both grouped + flat-mobile views are rendered).
  _refreshCharCardBody(playerId) {
    const player = (this._allPlayers || []).find(p => p.id === playerId);
    if (!player) return;

    document.querySelectorAll(`.char-card[data-player-id="${playerId}"]`).forEach(card => {
      // Update tab active states
      card.querySelectorAll('[data-action="char-view"]').forEach(b => {
        b.classList.toggle('active', b.dataset.view === this._charViewFor(player));
      });
      const ccBody = card.querySelector('.cc-body');
      if (ccBody) {
        ccBody.innerHTML = this._ccBodyHtml(player);
        this._bindCharCardCollectionPagination(card, playerId);
        return;
      }
      const body = card.querySelector('.char-card-body');
      if (body) {
        const detailHtml = this._buildEquipDetailHtml(player);
        body.innerHTML = this._buildCharCardBodyHtml(player, detailHtml);
        this._bindCharCardCollectionPagination(card, playerId);
      }
    });
  },

  _bindCharCardCollectionPagination(rootEl, playerId) {
    rootEl.querySelectorAll('.char-card-collection [data-card-tier]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._charCardTierByPlayer = this._charCardTierByPlayer || {};
        this._charCardTierByPlayer[playerId] = btn.dataset.cardTier === 'all' ? null : Number(btn.dataset.cardTier);
        this._charCardPageByPlayer[playerId] = 1;
        this._refreshCharCardBody(playerId);
      });
    });
    const wrap = rootEl.querySelector('.char-card-mini-pagination .pagination');
    if (!wrap) return;
    const currentPage = this._charCardPageByPlayer[playerId] || 1;
    const pageCount = Math.max(1, Math.ceil(cardsForTier(this._charCardTier(playerId)).length / GAME_CARDS_PER_PAGE));
    bindPagination(wrap, currentPage, pageCount, (newPage) => {
      this._charCardPageByPlayer[playerId] = newPage;
      this._refreshCharCardBody(playerId);
    });
  },

  // Status pills row under the character info. Admins get the clickable
  // exclude + whitelist toggles; normal users get the read-only In Guild tag.
  _buildAdminPillsRowHtml(player) {
    const exclude = this._buildExcludeToggleHtml(player);   // admin-only ('' otherwise)
    const whitelist = this._buildWhitelistToggleHtml(player); // tag for everyone
    const age = syncedAge(player.syncedAt);
    const synced = age ? `<span class="synced-tag${age.stale ? ' stale' : ''}" data-tooltip="${syncedLabel(player.syncedAt)}">Synced <span class="synced-age">${age.text}</span></span>` : '';
    if (!exclude && !whitelist && !synced) return '';
    return `<div class="admin-pills-row">${exclude}${whitelist}${synced}</div>`;
  },

  async render(container) {
    initFixedTooltip();
    const canViewFull = dataService.isFriend();

    // Guests can only see roster view
    if (!canViewFull) {
      this._viewMode = 'roster';
    }

    container.innerHTML = `
      <div class="players-page">
        <div class="page-header">
          <h1 class="players-title">Characters</h1>
          ${canViewFull ? `
            <nav class="players-tabs">
              ${[['characters', 'Characters'], ['browse', 'Browse'], ['roster', 'Roster']].map(([view, label]) =>
                `<button type="button" class="view-tab ${this._viewMode === view ? 'active' : ''}" data-view="${view}">${label}</button>`).join('')}
            </nav>
          ` : ''}
          ${canViewFull ? `
            <div class="page-header-actions">
              <!-- Flat view disabled for now - grouped view is the only option
              <label class="toggle-switch" id="group-by-owner-wrapper" ${this._viewMode === 'roster' ? 'style="display:none"' : ''}>
                <input type="checkbox" id="group-by-owner-toggle" ${this._groupByOwner ? 'checked' : ''}>
                <span class="toggle-slider"></span>
                <span class="toggle-label">Group by owner</span>
              </label>
              -->
              <button id="add-player-btn" class="btn btn-primary" ${this._viewMode === 'roster' ? 'style="display:none"' : ''}>+ Add Character</button>
            </div>
          ` : ''}
        </div>
        <div id="players-list" class="players-list">
          <div class="loading">Loading characters...</div>
        </div>
      </div>
    `;

    if (canViewFull) {
      document.getElementById('add-player-btn').addEventListener('click', () => {
        this.showAddChooser();
      });

      // Flat view disabled for now - group-by-owner toggle hidden
      // document.getElementById('group-by-owner-toggle').addEventListener('change', (e) => {
      //   this._groupByOwner = e.target.checked;
      //   localStorage.setItem('playersGroupByOwner', this._groupByOwner);
      //   this.loadPlayers();
      // });

      // View tab listeners
      document.querySelectorAll('.view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          this._viewMode = tab.dataset.view;
          document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === this._viewMode));
          // Show/hide character-specific controls
          const isRoster = this._viewMode === 'roster';
          document.getElementById('add-player-btn').style.display = isRoster ? 'none' : '';
          this.loadPlayers();
        });
      });
    }

    this.loadPlayers();
  },

  // Store expanded state for owner groups (collapsed by default)
  _expandedOwners: new Set(),

  // Uncleared-raid filter: bcl = BDN Classic, dhc/dcl/dn = DDN Hardcore/Classic/Normal.
  _raidPriorityFilter: { bcl: false, dhc: false, dcl: false, dn: false },

  // Render the BDN/DDN raid badge group for a player; a clear the game reported can't be toggled off.
  renderRaidBadgesHTML(player, canToggleRaid) {
    const check = '<span class="raid-badge-check">✓</span>';
    const badge = (raidType, cls, label) => {
      const { done, source } = raidStatus(player, raidType);
      const fromGame = source === 'game';
      const clickable = canToggleRaid && !fromGame;
      const attrs = clickable ? `data-player-id="${player.id}" data-raid-type="${raidType}" data-completed="${done}"` : '';
      const title = fromGame ? 'From game' : source === 'marked' ? 'Marked' : '';
      return `<span class="raid-badge ${cls}${done ? ' completed' : ''}${fromGame ? ' from-game' : ''}${clickable ? ' clickable' : ''}"
                ${attrs} title="${title}"><span class="raid-badge-label">${label}</span>${done ? check : ''}</span>`;
    };
    return `
      <div class="raid-badge-group">
        <div class="raid-row bdn-row">
          <span class="raid-row-label">BDN</span>
          ${badge('BDN Classic', 'raid-bdn-classic', 'CL')}
        </div>
        <div class="raid-row ddn-row">
          <span class="raid-row-label">DDN</span>
          ${badge('DDN Hardcore', 'raid-ddn-hardcore', 'HC')}
          ${badge('DDN Classic', 'raid-ddn-classic', 'CL')}
          ${badge('DDN Normal', 'raid-ddn-normal', 'N')}
        </div>
      </div>
    `;
  },

  // Equipment column sort: null, 'weapon', or 'armor'
  _equipmentSort: null,

  // Class family filter state
  _selectedClassFamily: null,
  _expandedClassFamily: null,
  _selectedSpecialization: null,

  // Filter players by class family/specialization
  filterPlayersByClass(players) {
    if (!this._selectedClassFamily && !this._selectedSpecialization) {
      return players;
    }

    return players.filter(player => {
      if (this._selectedSpecialization && this._expandedClassFamily) {
        // Filter by specialization classes
        const family = CLASS_FAMILIES[this._expandedClassFamily];
        const specClasses = family.specializations[this._selectedSpecialization]?.classes || [];
        return specClasses.includes(player.role);
      } else if (this._selectedClassFamily) {
        const familyClasses = CLASS_FAMILIES[this._selectedClassFamily].classes;
        return familyClasses.includes(player.role);
      }
      return true;
    });
  },

  // Count players in a class family
  getClassFamilyCount(familyKey) {
    if (!this._allPlayers) return 0;
    const family = CLASS_FAMILIES[familyKey];
    return this._allPlayers.filter(p => family.classes.includes(p.role)).length;
  },

  // Count players in a specialization
  getSpecializationCount(familyKey, specKey) {
    if (!this._allPlayers) return 0;
    const family = CLASS_FAMILIES[familyKey];
    const spec = family?.specializations?.[specKey];
    if (!spec) return 0;
    return this._allPlayers.filter(p => spec.classes.includes(p.role)).length;
  },

  // Class filter and search for Characters and Browse; Browse adds sort and grid/table.
  renderToolbar(browse) {
    const browseControls = browse ? `
      <div class="browse-controls-right">
        <label class="browse-sort-label">Sort
          <select id="browse-sort" class="browse-sort-select">
            ${[['owner', 'Owner'], ['gs', 'Gearscore'], ['name', 'Name'], ['class', 'Class']].map(([v, l]) => `<option value="${v}" ${this._browseSort === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <div class="browse-display-toggle">
          <button type="button" data-display="grid" class="${this._browseDisplay === 'grid' ? 'active' : ''}" data-tooltip="Grid view">▦</button>
          <button type="button" data-display="table" class="${this._browseDisplay === 'table' ? 'active' : ''}" data-tooltip="Table view">▤</button>
        </div>
      </div>` : '';
    // The class icon filter (with its specialization row) sits above the search row.
    return `
      ${this.renderClassFamilyFilter()}
      <div class="players-toolbar">
        <input type="text" id="browse-search" class="browse-search players-search" placeholder="Search name, owner, or class…" autocomplete="off">
        ${browseControls}
      </div>`;
  },

  // Characters matching the search box (name, owner or class).
  _searchFilter(players, userMap) {
    const q = (this._browseSearch || '').trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => {
      const ownerName = (p.discordId ? userMap?.[p.discordId]?.displayName : '') || '';
      return (p.name || '').toLowerCase().includes(q) || ownerName.toLowerCase().includes(q) || (p.role || '').toLowerCase().includes(q);
    });
  },

  // Render class family filter HTML
  renderClassFamilyFilter() {
    const totalCount = this._allPlayers?.length || 0;

    return `
      <div class="class-filter-header">
        <span class="total-count">${totalCount} character${totalCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="class-family-filter">
        ${Object.entries(CLASS_FAMILIES).map(([key, family]) => {
          const count = this.getClassFamilyCount(key);
          return `
          <button class="class-family-btn ${this._selectedClassFamily === key ? 'active' : ''} ${this._expandedClassFamily === key ? 'expanded' : ''}"
                  data-family="${key}" title="${family.name} (${count})">
            <span class="class-icon-wrapper">
              <div class="class-sprite" style="${getClassSpriteStyle(family.name)}"></div>
            </span>
            ${count > 0 ? `<span class="class-count">${count}</span>` : ''}
          </button>
        `}).join('')}
      </div>
      <div class="specialization-filter" id="specialization-filter">
        ${this.renderSpecializationButtons()}
      </div>
    `;
  },

  // Render specialization buttons for expanded class family
  renderSpecializationButtons() {
    if (!this._expandedClassFamily) {
      return '';
    }

    const family = CLASS_FAMILIES[this._expandedClassFamily];
    if (!family || !family.specializations) {
      return '';
    }

    return Object.entries(family.specializations).map(([key, spec]) => {
      const count = this.getSpecializationCount(this._expandedClassFamily, key);
      return `
      <button class="specialization-btn ${this._selectedSpecialization === key ? 'active' : ''}"
              data-spec="${key}" title="${spec.name} (${count})">
        <div class="spec-icon-wrapper">
          <div class="class-sprite" style="${getClassSpriteStyle(spec.name)}"></div>
        </div>
        <span class="spec-name">${spec.name}</span>
        <span class="spec-count">${count}</span>
      </button>
    `}).join('');
  },

  // Attach event listeners for class family filter
  attachClassFilterListeners() {
    // Class family buttons
    document.querySelectorAll('.players-page .class-family-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const family = btn.dataset.family;

        if (!family) {
          // The All chip clears the class filter.
          this._expandedClassFamily = null;
          this._selectedClassFamily = null;
          this._selectedSpecialization = null;
        } else if (this._expandedClassFamily === family) {
          // Clicking expanded family again - collapse and clear
          this._expandedClassFamily = null;
          this._selectedClassFamily = null;
          this._selectedSpecialization = null;
        } else if (this._selectedClassFamily === family && !this._expandedClassFamily) {
          // Single click was active, now expand to show specializations
          this._expandedClassFamily = family;
          this._selectedSpecialization = null;
        } else {
          // New family - select it and expand
          this._selectedClassFamily = family;
          this._expandedClassFamily = family;
          this._selectedSpecialization = null;
        }

        this.loadPlayers();
      });
    });

    // Specialization buttons
    document.querySelectorAll('.players-page .specialization-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const spec = btn.dataset.spec;

        if (this._selectedSpecialization === spec) {
          // Deselect specialization, keep family selected
          this._selectedSpecialization = null;
        } else {
          // Select this specialization
          this._selectedSpecialization = spec;
        }

        this.loadPlayers();
      });
    });
  },

  // Sort players by raid priority filter, then alphabetically
  // Get a numeric score for equipment for sorting (higher = better)
  _getEquipmentScore(player, type) {
    const rarityKey = type === 'weapon' ? 'weapon' : 'armor';
    const enhanceKey = type === 'weapon' ? 'weaponEnhance' : 'armorEnhance';

    const rarityOrder = { 'legend': 3, 'unique': 2, 'epic': 1, '': 0 };
    const rarity = rarityOrder[player[rarityKey] || ''] || 0;
    const level = parseInt(this._slotLevel(player, type)) || 0;
    const enhance = parseInt(player[enhanceKey] || '0') || 0;

    // Weighted: rarity is most important, then level, then enhancement
    return rarity * 10000 + level * 100 + enhance;
  },

  // Level of the piece the legacy weapon/armor rarity comes from.
  _slotLevel(player, type) {
    return player.equipment?.[type === 'weapon' ? 'mainWeapon' : 'helmet']?.level || '';
  },

  sortPlayersByRaidPriority(players) {
    const filter = this._raidPriorityFilter;
    const activeRaidTypes = [];
    if (filter.bcl) activeRaidTypes.push('BDN Classic');
    if (filter.dhc) activeRaidTypes.push('DDN Hardcore');
    if (filter.dcl) activeRaidTypes.push('DDN Classic');
    if (filter.dn) activeRaidTypes.push('DDN Normal');

    return [...players].sort((a, b) => {
      if (activeRaidTypes.length > 0) {
        const aNeeds = activeRaidTypes.some(rt => dataService.playerNeedsRaid(a, rt));
        const bNeeds = activeRaidTypes.some(rt => dataService.playerNeedsRaid(b, rt));
        // Uncleared (needs raid) comes first
        if (aNeeds && !bNeeds) return -1;
        if (!aNeeds && bNeeds) return 1;
      }

      // Gearscore sort
      if (this._equipmentSort === 'gs') {
        const aGs = calculateGearscore(a);
        const bGs = calculateGearscore(b);
        if (aGs !== bGs) return bGs - aGs;
      }

      // Equipment sort (highest to lowest)
      if (this._equipmentSort === 'weapon' || this._equipmentSort === 'armor') {
        const aScore = this._getEquipmentScore(a, this._equipmentSort);
        const bScore = this._getEquipmentScore(b, this._equipmentSort);
        if (aScore !== bScore) return bScore - aScore;
      }

      // Then sort alphabetically
      return a.name.localeCompare(b.name);
    });
  },

  // Check if a character is "geared" (+11 unique weapon or above)
  isGeared(player) {
    const rarityOrder = { 'legend': 3, 'unique': 2, 'epic': 1, '': 0 };
    const weaponRarity = rarityOrder[player.weapon || ''] || 0;
    const weaponEnhance = parseInt(player.weaponEnhance || '0') || 0;
    // Unique +11 or above (includes legend at any enhance)
    return (weaponRarity === 2 && weaponEnhance >= 11) || weaponRarity >= 3;
  },

  async loadPlayers() {
    const listElement = document.getElementById('players-list');

    if (!dataService.isConfigured()) {
      listElement.innerHTML = '<div class="error">Please configure the database first.</div>';
      return;
    }

    try {
      // Load players and app users in parallel
      const [players, appUsers] = await Promise.all([
        dataService.getPlayers(),
        dataService.getAppUsers()
      ]);

      this._appUsers = appUsers;
      this._allPlayers = players;

      // Create lookup map for owners
      const userMap = {};
      appUsers.forEach(u => {
        userMap[u.discordId] = u;
      });

      if (players.length === 0) {
        listElement.innerHTML = '<div class="empty-state">No characters yet. Add your first character!</div>';
        return;
      }

      const hasAnyEditableCharacters = players.some(p => this.canEditCharacter(p));

      // Render based on view mode
      if (this._viewMode === 'roster') {
        this.renderRosterView(listElement, players, userMap);
        return;
      }

      // Browse view: flat searchable/sortable list of every character.
      // Wires its own listeners, so it returns early like the roster view.
      if (this._viewMode === 'browse') {
        this.renderBrowseView(listElement, players, userMap);
        return;
      }

      // Flat view disabled for now - always use grouped view
      this.renderGroupedView(listElement, players, userMap, hasAnyEditableCharacters);
      // if (this._groupByOwner) {
      //   this.renderGroupedView(listElement, players, userMap, hasAnyEditableCharacters);
      // } else {
      //   this.renderFlatView(listElement, players, userMap, hasAnyEditableCharacters);
      // }

      // Add event listeners for raid priority filter (multi-select)
      document.querySelectorAll('.raid-priority-filter .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const filter = btn.dataset.filter;
          if (!filter) return;
          this._raidPriorityFilter[filter] = !this._raidPriorityFilter[filter];
          this.loadPlayers();
        });
      });

      // Add expand/collapse listeners for flat view table rows
      document.querySelectorAll('.expandable-row').forEach(row => {
        const arrow = row.querySelector('.expand-arrow');
        const playerId = row.dataset.playerId;
        const detailRow = document.querySelector(`.expand-detail-row[data-for="${playerId}"]`);
        if (!detailRow) {
          row.classList.add('no-expand');
          return;
        }

        row.addEventListener('click', (e) => {
          // Don't expand if clicking on interactive elements
          if (e.target.closest('.player-name-link, .raid-badge, a, button')) return;
          const isOpen = detailRow.classList.toggle('open');
          arrow.classList.toggle('open', isOpen);
          row.classList.toggle('expanded', isOpen);
        });
      });

      // Add click listeners for sortable column headers
      document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', () => {
          const sortType = header.dataset.sort;
          // Toggle off if already active, otherwise activate
          this._equipmentSort = this._equipmentSort === sortType ? null : sortType;
          this.loadPlayers();
        });
      });
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading characters: ${error.message}</div>`;
    }
  },

  // ============================================
  // BROWSE VIEW — flat searchable / sortable list of every character
  // (lives alongside the grouped "Characters" view; fully separate so the
  //  grouped view can be reverted to just by switching tabs)
  // ============================================
  renderBrowseView(listElement, players, userMap) {
    this._browseUserMap = userMap;

    // Count distinct account numbers per owner so we can flag multi-account
    const acctSets = {};
    players.forEach(p => {
      if (!p.discordId) return;
      (acctSets[p.discordId] = acctSets[p.discordId] || new Set()).add(p.accountNumber || 1);
    });
    this._browseAccountSizes = {};
    Object.entries(acctSets).forEach(([id, set]) => { this._browseAccountSizes[id] = set.size; });

    listElement.innerHTML = `
      ${this.renderToolbar(true)}
      <div id="browse-results" class="browse-results"></div>
    `;

    // Restore the search text via property assignment (avoids attribute escaping)
    const searchInput = document.getElementById('browse-search');
    if (searchInput) {
      searchInput.value = this._browseSearch;
      // Re-render only the results node so the input keeps focus while typing
      searchInput.addEventListener('input', () => {
        this._browseSearch = searchInput.value;
        this._renderBrowseResults();
      });
    }

    const sortSelect = document.getElementById('browse-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this._browseSort = sortSelect.value;
        localStorage.setItem('playersBrowseSort', this._browseSort);
        this._renderBrowseResults();
      });
    }

    document.querySelectorAll('.browse-display-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        this._browseDisplay = btn.dataset.display;
        localStorage.setItem('playersBrowseDisplay', this._browseDisplay);
        document.querySelectorAll('.browse-display-toggle button').forEach(b =>
          b.classList.toggle('active', b.dataset.display === this._browseDisplay));
        this._renderBrowseResults();
      });
    });

    // Class family filter shares the grouped view's controls; it triggers a
    // full loadPlayers() (the search text survives via this._browseSearch).
    this.attachClassFilterListeners();

    this._renderBrowseResults();
  },

  _browseFilterSort(players) {
    let list = this.filterPlayersByClass(players);

    list = this._searchFilter(list, this._browseUserMap);

    return this._sortBrowsePlayers(list);
  },

  _sortBrowsePlayers(players) {
    const sort = this._browseSort;
    // Unassigned characters sort to the bottom for owner sort
    const ownerKey = (p) => (p.discordId ? (this._browseUserMap[p.discordId]?.displayName || '~') : '~~').toLowerCase();

    return [...players].sort((a, b) => {
      if (sort === 'gs') {
        const d = calculateGearscore(b) - calculateGearscore(a);
        if (d !== 0) return d;
      } else if (sort === 'class') {
        const d = (a.role || '').localeCompare(b.role || '');
        if (d !== 0) return d;
      } else if (sort === 'owner') {
        const d = ownerKey(a).localeCompare(ownerKey(b));
        if (d !== 0) return d;
        const acc = (a.accountNumber || 1) - (b.accountNumber || 1);
        if (acc !== 0) return acc;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  },

  _renderBrowseResults() {
    const resultsEl = document.getElementById('browse-results');
    if (!resultsEl) return;

    const list = this._browseFilterSort(this._allPlayers || []);
    const count = list.length;
    const countHtml = `<div class="browse-count">${count} character${count !== 1 ? 's' : ''}</div>`;

    if (count === 0) {
      resultsEl.innerHTML = `${countHtml}<div class="empty-state">No characters match your search.</div>`;
      return;
    }

    const body = this._browseDisplay === 'table'
      ? this._renderBrowseTable(list)
      : this._renderBrowseGrid(list);
    resultsEl.innerHTML = `${countHtml}${body}`;
    this._attachBrowseResultListeners(resultsEl);
  },

  // Flag class for de-emphasizing characters by guild status (darker border):
  //  - excluded characters get the strongest flag
  //  - non-whitelisted ("not in guild") get a subtler darker border
  _browseFlagClass(player) {
    if (player.exclude) return 'is-excluded';
    if (!dataService.isPlayerWhitelisted(player)) return 'not-in-guild';
    return '';
  },

  // The in-game account nickname the sync reported.
  _accountNameHtml(name) {
    if (!name) return '';
    const safe = String(name).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<span class="account-name">${safe}</span>`;
  },

  _browseAcctBadgeHtml(player) {
    const size = player.discordId ? (this._browseAccountSizes[player.discordId] || 1) : 1;
    if (size <= 1) return '';
    const n = player.accountNumber || 1;
    return `<span class="acct-badge" data-account="${n}" title="Account ${n}">A${n}</span>${this._accountNameHtml(player.accountName)}`;
  },

  _renderBrowseGrid(list) {
    return `
      <div class="character-card-grid browse-grid">
        ${list.map(player => {
          const gs = calculateGearscore(player);
          const tier = getGearscoreTier(gs);
          const canEdit = this.canEditCharacter(player);
          const canToggleRaid = canEdit || dataService.isAdmin();
          const iconStyle = getClassSpriteStyle(player.role);
          const owner = player.discordId ? this._browseUserMap[player.discordId] : null;

          const age = syncedAge(player.syncedAt);
          const pills = [this._buildExcludeToggleHtml(player), this._buildWhitelistToggleHtml(player)].join('');
          return `
            <div class="char-card cc cc-compact browse-card ${this._browseFlagClass(player)}" data-player-id="${player.id}">
              <div class="cc-top">
                ${iconStyle ? `<div class="char-card-icon-wrap"><div class="class-sprite char-card-icon" style="${iconStyle}"></div></div>` : ''}
                <div class="cc-id">
                  <span class="cc-name">${canEdit ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}</span>` : player.name}</span>
                  <span class="cc-class">${player.role || ''}${age ? ` <span class="synced-tag${age.stale ? ' stale' : ''}" data-tooltip-fixed="${syncedLabel(player.syncedAt)}">Synced <span class="synced-age">${age.text}</span></span>` : ''}</span>
                </div>
                <span class="cc-gs" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${gearscoreTooltipText(player)}">${gs}</span>
              </div>
              <div class="cc-raids"><div class="char-card-badges">${this.renderRaidBadgesHTML(player, canToggleRaid)}</div></div>
              <div class="cc-foot">
                ${owner
                  ? `<span class="cc-owner"><img src="${owner.avatarUrl || '/icons/avatar.svg'}" alt="" class="char-card-owner-avatar" onerror="this.src='/icons/avatar.svg'"><span>${owner.displayName}</span>${this._browseAcctBadgeHtml(player)}</span>`
                  : `<span class="cc-owner cc-muted">Unassigned</span>`}
                ${pills ? `<span class="cc-pills">${pills}</span>` : ''}
                ${canEdit ? `<button type="button" class="btn btn-secondary cc-edit" data-player-id="${player.id}">Edit</button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
  },

  _renderBrowseTable(list) {
    const arrow = (key) => this._browseSort === key ? ' ▼' : '';
    const th = (key, label) =>
      `<th class="browse-sort-header ${this._browseSort === key ? 'sort-active' : ''}" data-sort="${key}">${label}${arrow(key)}</th>`;

    return `
      <table class="players-table browse-table">
        <thead>
          <tr>
            ${th('name', 'Name')}
            ${th('owner', 'Owner')}
            <th>Acc</th>
            ${th('class', 'Class')}
            ${th('gs', 'GS')}
            <th>Raids Needed</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(player => {
            const canEdit = this.canEditCharacter(player);
            const canToggleRaid = canEdit || dataService.isAdmin();
            const owner = player.discordId ? this._browseUserMap[player.discordId] : null;
            const gs = calculateGearscore(player);
            const tier = getGearscoreTier(gs);
            const n = player.accountNumber || 1;
            const size = player.discordId ? (this._browseAccountSizes[player.discordId] || 1) : 1;

            return `
            <tr class="${this._browseFlagClass(player)}" data-player-id="${player.id}">
              <td class="player-name ${canEdit ? 'editable' : ''}" data-label="Name">
                ${canEdit
                  ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}</span>`
                  : player.name}
                ${this._buildAdminPillsRowHtml(player)}
              </td>
              <td class="player-owner" data-label="Owner">
                ${owner
                  ? `<div class="owner-badge" title="${owner.displayName}"><img src="${owner.avatarUrl || '/icons/avatar.svg'}" alt="" class="owner-avatar" onerror="this.src='/icons/avatar.svg'"><span class="owner-name">${owner.displayName}</span></div>`
                  : '<span class="no-owner">—</span>'}
              </td>
              <td class="browse-acc-cell" data-label="Acc">${size > 1 ? `<span class="acct-badge" data-account="${n}">A${n}</span>` : '<span class="acct-dash">—</span>'}${this._accountNameHtml(player.accountName)}</td>
              <td class="class-cell" data-label="Class">${player.role ? `<div class="class-sprite table-class-icon" style="${getClassSpriteStyle(player.role)}"></div>` : ''}${player.role || ''}</td>
              <td class="gs-cell" data-label="GS"><span class="gs-value" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${gearscoreTooltipText(player)}">${gs}</span></td>
              <td class="raids-needed" data-label="Raids Needed">${this.renderRaidBadgesHTML(player, canToggleRaid)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  _attachBrowseResultListeners(rootEl) {
    // Edit on name click
    rootEl.querySelectorAll('.player-name-link, .cc-edit').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = link.dataset.playerId;
        const player = (this._allPlayers || []).find(p => p.id === playerId);
        if (player) this.showEditPlayerModal(player);
      });
    });

    // Raid badge toggles — refresh via full reload (re-fetches completion state)
    rootEl.querySelectorAll('.raid-badge.clickable').forEach(badge => {
      badge.addEventListener('click', async () => {
        const playerId = badge.dataset.playerId;
        const raidType = badge.dataset.raidType;
        const newCompleted = badge.dataset.completed !== 'true';
        try {
          badge.style.opacity = '0.5';
          await dataService.togglePlayerRaidCompletion(playerId, raidType, newCompleted);
          toast.success(`${raidType} ${newCompleted ? 'marked as done' : 'marked as not done'}`);
          this.loadPlayers();
        } catch (error) {
          toast.error(`Failed to update: ${error.message}`);
          badge.style.opacity = '';
        }
      });
    });

    // Sortable table headers (keep the Sort dropdown in sync)
    rootEl.querySelectorAll('.browse-sort-header').forEach(header => {
      header.addEventListener('click', () => {
        this._browseSort = header.dataset.sort;
        localStorage.setItem('playersBrowseSort', this._browseSort);
        const sel = document.getElementById('browse-sort');
        if (sel) sel.value = this._browseSort;
        this._renderBrowseResults();
      });
    });

    // Admin exclude toggles
    rootEl.querySelectorAll('.exclude-pill[data-action="toggle-exclude"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const playerId = btn.dataset.playerId;
        const newExclude = btn.dataset.exclude !== 'true';
        try {
          btn.disabled = true;
          await dataService.togglePlayerExclude(playerId, newExclude);
          const player = (this._allPlayers || []).find(p => p.id === playerId);
          if (player) player.exclude = newExclude;
          btn.dataset.exclude = String(newExclude);
          btn.classList.toggle('is-on', newExclude);
          btn.textContent = newExclude ? 'Excluded' : 'Exclude';
          btn.setAttribute('data-tooltip', newExclude ? 'Click to include' : 'Click to exclude from recruiting');
          toast.success(newExclude ? `${player?.name || 'Character'} excluded` : `${player?.name || 'Character'} included`);
        } catch (err) {
          toast.error(`Failed: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Admin whitelist toggles
    rootEl.querySelectorAll('.whitelist-pill[data-action="toggle-whitelist"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const playerId = btn.dataset.playerId;
        const newWhitelisted = btn.dataset.whitelisted !== 'true';
        try {
          btn.disabled = true;
          await dataService.togglePlayerWhitelist(playerId, newWhitelisted);
          const player = (this._allPlayers || []).find(p => p.id === playerId);
          if (player) player.whitelisted = newWhitelisted;
          btn.dataset.whitelisted = String(newWhitelisted);
          btn.classList.toggle('is-on', newWhitelisted);
          btn.textContent = newWhitelisted ? 'In Guild' : 'Not in Guild';
          btn.setAttribute('data-tooltip', newWhitelisted ? 'Click to remove guild access' : 'Click to whitelist (grant guild access)');
          toast.success(newWhitelisted ? `${player?.name || 'Character'} whitelisted` : `${player?.name || 'Character'} removed from whitelist`);
        } catch (err) {
          toast.error(`Failed: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    });
  },

  renderRosterView(listElement, players, userMap) {
    // Cache for slider re-renders
    this._rosterPlayers = players;
    this._rosterUserMap = userMap;
    this._renderRosterFiltered(listElement);
  },

  _renderRosterFiltered(listElement) {
    const allPlayers = this._rosterPlayers;
    const userMap = this._rosterUserMap;
    const minGs = this._gsFilter;

    // Destroy previous chart instance
    if (this._chartInstance) {
      this._chartInstance.destroy();
      this._chartInstance = null;
    }

    // Filter by gearscore threshold
    const players = minGs > 0
      ? allPlayers.filter(p => calculateGearscore(p) >= minGs)
      : allPlayers;

    const totalPlayers = players.length;
    const totalOwners = new Set(players.map(p => p.discordId || p.id)).size;

    // Format equipment as plain text for tooltips (e.g. "Lv50 Unique +12")
    const formatEquipText = (player, type) => {
      const rarityKey = type === 'weapon' ? 'weapon' : 'armor';
      const enhanceKey = type === 'weapon' ? 'weaponEnhance' : 'armorEnhance';
      if (!player[rarityKey]) return '-';
      const rarity = EQUIPMENT_RARITIES.find(r => r.value === player[rarityKey]);
      const label = rarity?.label || player[rarityKey];
      const enhance = player[enhanceKey] ? ' +' + player[enhanceKey] : '';
      const slotLevel = this._slotLevel(player, type);
      const level = slotLevel ? `Lv${slotLevel} ` : '';
      return `${level}${label}${enhance}`;
    };

    // Build tooltip HTML for a list of players, grouped by owner
    const hideNames = !dataService.isFriend();
    const buildTooltipHtml = (clsPlayers) => {
      if (hideNames) {
        // Guests only see gearscore and equipment, no names
        return clsPlayers
          .sort((a, b) => calculateGearscore(b) - calculateGearscore(a))
          .map(p => {
            const gs = calculateGearscore(p);
            const tier = getGearscoreTier(gs);
            return `<div class="roster-tooltip-row"><span class="roster-tooltip-gs" style="color: ${tier.color}">${gs}</span> <span class="roster-tooltip-gear">${EQUIPMENT_ICONS.weapon} ${formatEquipText(p, 'weapon')} ${EQUIPMENT_ICONS.armor} ${formatEquipText(p, 'armor')}</span></div>`;
          })
          .join('');
      }

      // Group by owner
      const byOwner = {};
      clsPlayers.forEach(p => {
        const ownerId = p.discordId || p.id;
        if (!byOwner[ownerId]) byOwner[ownerId] = [];
        byOwner[ownerId].push(p);
      });

      return Object.entries(byOwner).map(([ownerId, ownerPlayers]) => {
        const owner = userMap[ownerId];
        const ownerName = owner?.displayName || 'Unassigned';
        const playerRows = ownerPlayers
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(p => {
            const gs = calculateGearscore(p);
            const tier = getGearscoreTier(gs);
            return `<div class="roster-tooltip-row"><span class="roster-tooltip-name">${p.name}</span> <span class="roster-tooltip-gs" style="color: ${tier.color}">${gs}</span> <span class="roster-tooltip-gear">${EQUIPMENT_ICONS.weapon} ${formatEquipText(p, 'weapon')} ${EQUIPMENT_ICONS.armor} ${formatEquipText(p, 'armor')}</span></div>`;
          })
          .join('');
        return `<div class="roster-tooltip-owner">${ownerName}</div>${playerRows}`;
      }).join('');
    };

    // Count unique owners per class family and per class
    const familyCounts = {};
    const familyPlayers = {}; // Unique owner counts per class
    const familyPlayersList = {}; // Actual player objects per class
    Object.entries(CLASS_FAMILIES).forEach(([key, family]) => {
      const matching = players.filter(p => family.classes.includes(p.role));
      // Count unique owners for this family
      const familyOwners = new Set(matching.map(p => p.discordId || p.id));
      familyCounts[key] = familyOwners.size;
      // Track per individual class
      const classCounts = {};
      const classPlayers = {};
      family.classes.forEach(cls => {
        const clsPlayers = matching.filter(p => p.role === cls);
        if (clsPlayers.length > 0) {
          const classOwners = new Set(clsPlayers.map(p => p.discordId || p.id));
          classCounts[cls] = classOwners.size;
          classPlayers[cls] = clsPlayers;
        }
      });
      familyPlayers[key] = classCounts;
      familyPlayersList[key] = classPlayers;
    });

    // All classes that have 0 members
    const allClasses = CLASSES;
    const presentClassSet = new Set(players.map(p => p.role));
    const missingClasses = allClasses.filter(cls => !presentClassSet.has(cls));

    // Calculate average gearscore
    const avgGearscore = players.length > 0
      ? Math.round(players.reduce((sum, p) => sum + calculateGearscore(p), 0) / players.length)
      : 0;
    const avgTier = getGearscoreTier(avgGearscore);

    listElement.innerHTML = `
      <div class="roster-view">
        <div class="roster-summary roster-tiles">
          <div class="roster-stat roster-tile ${hideNames ? '' : 'roster-stat-tip'}">
            <span class="roster-stat-value">${totalPlayers}</span>
            <span class="roster-stat-label">Characters</span>
            ${hideNames ? '' : `<div class="roster-tooltip">${totalOwners} player${totalOwners !== 1 ? 's' : ''}</div>`}
          </div>
          <div class="roster-stat roster-tile">
            <span class="roster-stat-value" style="color: ${avgTier.color}" data-tooltip="Gearscore">${avgGearscore}</span>
            <span class="roster-stat-label">Avg Gearscore</span>
          </div>
          <div class="roster-gs-slider roster-tile">
            <label>Min Gearscore <span id="gs-slider-value" style="color: ${getGearscoreTier(minGs).color}">${minGs}</span></label>
            <input type="range" id="gs-slider" min="0" max="100" value="${minGs}" />
          </div>
        </div>
        <div class="roster-content">
          <div class="roster-chart-container">
            <div class="roster-chart-wrapper">
              <canvas id="roster-chart"></canvas>
              <div class="roster-chart-center">
                <span class="roster-chart-center-value">${totalPlayers}</span>
                <span class="roster-chart-center-label">total</span>
              </div>
            </div>
            <div class="roster-chart-note">Gearscore is unofficial and is used to help balance our raid teams. Highest value is 100 and would need ${MAX_FD.toLocaleString()} FD and full Lv70 Legend gear at +15.</div>
          </div>
          <div class="roster-breakdown">
            <h3>Class Breakdown</h3>
            <div class="rc-head"><span>Specialization</span><span>Players</span><span>Avg GS</span></div>
            ${Object.entries(CLASS_FAMILIES).map(([key, family]) => {
              const count = familyCounts[key];
              const classes = familyPlayers[key];
              return `
                <div class="roster-family ${count === 0 ? 'missing' : ''}">
                  <div class="roster-family-header">
                    <span class="roster-family-dot" style="background: ${this._classFamilyColors[key]}"></span>
                    <span class="roster-family-icon-wrapper"><div class="class-sprite" style="${getClassSpriteStyle(family.name)}"></div></span>
                    <span class="roster-family-name">${family.name}</span>
                    <span class="roster-family-count">${count}</span>
                  </div>
                  ${Object.keys(classes).length > 0 ? `
                    <div class="roster-class-list rc-table">
                      ${Object.entries(classes).map(([cls, cnt]) => {
                        const clsPlayers = familyPlayersList[key][cls] || [];
                        const clsAvgGs = clsPlayers.length > 0
                          ? Math.round(clsPlayers.reduce((sum, p) => sum + calculateGearscore(p), 0) / clsPlayers.length)
                          : 0;
                        const clsTier = getGearscoreTier(clsAvgGs);
                        return `<div class="roster-class-item roster-class-row"><span class="rc-name">${cls}</span><span class="rc-count">${cnt}</span><span class="roster-gs-badge" style="color: ${clsTier.color}; background: ${clsTier.bg};">${clsAvgGs}</span><div class="roster-tooltip">${buildTooltipHtml(clsPlayers)}</div></div>`;
                      }).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
        ${missingClasses.length > 0 ? `
          <div class="roster-missing">
            <h3>Missing Classes</h3>
            <div class="roster-missing-list">
              ${missingClasses.map(cls => `<span class="roster-missing-class">${cls}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Toggle tooltip on click (for mobile)
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    const closeAllTooltips = () => {
      document.querySelectorAll('.tooltip-active').forEach(el => {
        const tooltip = el.querySelector('.roster-tooltip');
        if (tooltip) {
          tooltip.classList.remove('mobile-positioned');
          tooltip.style.left = '';
          tooltip.style.right = '';
          tooltip.style.top = '';
          tooltip.style.transform = '';
        }
        el.classList.remove('tooltip-active');
      });
    };

    document.querySelectorAll('.roster-class-item, .roster-stat-tip').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = item.classList.contains('tooltip-active');
        closeAllTooltips();
        if (!wasActive) {
          item.classList.add('tooltip-active');
          const tooltip = item.querySelector('.roster-tooltip');
          if (tooltip) {
            if (isMobile) {
              tooltip.classList.add('mobile-positioned');
              const rect = item.getBoundingClientRect();
              // Position above the tapped element
              tooltip.style.top = (rect.top - 8) + 'px';
              tooltip.style.left = '0.75rem';
              // After rendering, adjust vertical to sit above
              requestAnimationFrame(() => {
                const tipRect = tooltip.getBoundingClientRect();
                let top = rect.top - tipRect.height - 8;
                // If it would go off the top, put it below instead
                if (top < 8) top = rect.bottom + 8;
                tooltip.style.top = top + 'px';
              });
            } else {
              // Desktop: prevent tooltip from clipping outside viewport
              tooltip.style.left = '';
              tooltip.style.transform = '';
              requestAnimationFrame(() => {
                const tipRect = tooltip.getBoundingClientRect();
                const viewportWidth = window.innerWidth;
                if (tipRect.right > viewportWidth - 8) {
                  // Overflows right — align tooltip's right edge to item's right edge
                  tooltip.style.left = 'auto';
                  tooltip.style.right = '0';
                  tooltip.style.transform = 'translateY(0)';
                } else if (tipRect.left < 8) {
                  // Overflows left — align tooltip's left edge to item's left edge
                  tooltip.style.left = '0';
                  tooltip.style.transform = 'translateY(0)';
                }
              });
            }
          }
        }
      });
    });

    // Close tooltips when tapping outside
    document.addEventListener('click', closeAllTooltips);

    // Gearscore slider
    const gsSlider = document.getElementById('gs-slider');
    if (gsSlider) {
      gsSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        const tier = getGearscoreTier(val);
        const label = document.getElementById('gs-slider-value');
        if (label) {
          label.textContent = val;
          label.style.color = tier.color;
        }
      });
      gsSlider.addEventListener('change', (e) => {
        this._gsFilter = parseInt(e.target.value);
        this._renderRosterFiltered(listElement);
      });
    }

    // Create the doughnut chart
    const chartData = Object.entries(CLASS_FAMILIES).map(([key, family]) => ({
      label: family.name,
      count: familyCounts[key],
      color: this._classFamilyColors[key]
    }));

    // Only show families with members in the chart, plus a "gap" for missing
    const labels = chartData.map(d => d.label);
    const data = chartData.map(d => d.count);
    const colors = chartData.map(d => d.color);

    // If all zeros, show a placeholder
    const hasData = data.some(d => d > 0);

    const canvas = document.getElementById('roster-chart');
    if (canvas) {
      this._chartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: hasData ? labels : ['No characters'],
          datasets: [{
            data: hasData ? data : [1],
            backgroundColor: hasData ? colors : ['rgba(255,255,255,0.1)'],
            borderColor: 'rgba(0,0,0,0.3)',
            borderWidth: 2,
            hoverBorderColor: 'rgba(255,255,255,0.5)',
            hoverBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '65%',
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: hasData,
              backgroundColor: 'rgba(30,30,30,0.95)',
              titleColor: '#fff',
              bodyColor: 'rgba(255,255,255,0.8)',
              borderColor: 'rgba(255,255,255,0.2)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${ctx.raw} character${ctx.raw !== 1 ? 's' : ''}`
              }
            }
          }
        }
      });
    }
  },

  renderFlatView(listElement, players, userMap, hasAnyEditableCharacters) {
    // Filter by class, then sort by raid priority
    const filteredPlayers = this.filterPlayersByClass(players);
    const sortedPlayers = this.sortPlayersByRaidPriority(filteredPlayers);

    listElement.innerHTML = `
      ${this.renderClassFamilyFilter()}
      <div class="raid-priority-filter mobile-filter">
        <button class="filter-btn bdn ${this._raidPriorityFilter.bcl ? 'active' : ''}" data-filter="bcl">B CL</button>
        <button class="filter-btn ddn ${this._raidPriorityFilter.dhc ? 'active' : ''}" data-filter="dhc">D HC</button>
        <button class="filter-btn ddn ${this._raidPriorityFilter.dcl ? 'active' : ''}" data-filter="dcl">D CL</button>
        <button class="filter-btn ddn ${this._raidPriorityFilter.dn ? 'active' : ''}" data-filter="dn">D N</button>
      </div>
      <table class="players-table expandable-table">
        <thead>
          <tr>
            <th class="expand-col"></th>
            <th>Name</th>
            <th>Owner</th>
            <th>Class</th>
            <th class="sortable-header ${this._equipmentSort === 'gs' ? 'sort-active' : ''}" data-sort="gs" data-tooltip="Gearscore">GS ${this._equipmentSort === 'gs' ? '▼' : ''}</th>
            <th>Equipment</th>
            <th>Raids Needed</th>
            <th>Notes</th>
          </tr>
          <tr class="filter-row">
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>
              <div class="raid-priority-filter">
                <button class="filter-btn bdn ${this._raidPriorityFilter.bcl ? 'active' : ''}" data-filter="bcl">B CL</button>
                <button class="filter-btn ddn ${this._raidPriorityFilter.dhc ? 'active' : ''}" data-filter="dhc">D HC</button>
                <button class="filter-btn ddn ${this._raidPriorityFilter.dcl ? 'active' : ''}" data-filter="dcl">D CL</button>
                <button class="filter-btn ddn ${this._raidPriorityFilter.dn ? 'active' : ''}" data-filter="dn">D N</button>
              </div>
            </td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          ${sortedPlayers.map(player => {
            const canEdit = this.canEditCharacter(player);
            const canToggleRaid = canEdit || dataService.isAdmin();
            const detailHtml = this._buildEquipDetailHtml(player);

            const owner = player.discordId ? userMap[player.discordId] : null;

            return `
            <tr class="expandable-row" data-player-id="${player.id}">
              <td class="expand-toggle-cell">${detailHtml ? '<span class="expand-arrow">▶</span>' : ''}</td>
              <td class="player-name ${canEdit ? 'editable' : ''}" data-label="Name">
                ${canEdit ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>` : player.name}
                ${this._buildAdminPillsRowHtml(player)}
              </td>
              <td class="player-owner" data-label="Owner">
                ${owner ? `
                  <div class="owner-badge" title="${owner.displayName}">
                    <img src="${owner.avatarUrl || '/icons/avatar.svg'}" alt="${owner.displayName}" class="owner-avatar" onerror="this.src='/icons/avatar.svg'">
                    <span class="owner-name">${owner.displayName}</span>
                  </div>
                ` : '<span class="no-owner">—</span>'}
              </td>
              <td class="class-cell" data-label="Class">${player.role ? `<div class="class-sprite table-class-icon" style="${getClassSpriteStyle(player.role)}"></div>` : ''}${player.role}</td>
              <td class="gs-cell" data-label="GS">
                ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-value" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${gearscoreTooltipText(player)}">${gs}</span>`; })()}
              </td>
              <td data-label="Equipment">
                ${this._buildEquipSummaryHtml(player)}
              </td>
              <td class="raids-needed" data-label="Raids Needed">
                ${this.renderRaidBadgesHTML(player, canToggleRaid)}
              </td>
              <td class="notes" data-label="Notes">${player.notes}</td>
            </tr>
            ${detailHtml ? `<tr class="expand-detail-row" data-for="${player.id}"><td colspan="8"><div class="expand-detail-content">${detailHtml}</div></td></tr>` : ''}
          `;
          }).join('')}
        </tbody>
      </table>
      <div class="flat-mobile-cards">
        ${sortedPlayers.map(player => {
          const gs = calculateGearscore(player);
          const tier = getGearscoreTier(gs);
          const canEdit = this.canEditCharacter(player);
          const canToggleRaid = canEdit || dataService.isAdmin();
          const iconStyle = getClassSpriteStyle(player.role);
          const owner = player.discordId ? userMap[player.discordId] : null;
          const detailHtml = this._buildEquipDetailHtml(player);

          return `
            <div class="char-card" data-player-id="${player.id}">
              <div class="char-card-header">
                <div class="char-card-identity">
                  ${iconStyle ? `<div class="char-card-icon-wrap"><div class="class-sprite char-card-icon" style="${iconStyle}"></div></div>` : ''}
                  <div class="char-card-name-block">
                    <span class="char-card-name ${canEdit ? 'editable' : ''}">
                      ${canEdit
                        ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>`
                        : player.name}
                    </span>
                    <span class="char-card-class">${player.role} <span class="char-card-gs" style="color: ${tier.color}; background: ${tier.bg};">${gs}</span></span>
                    ${this._buildAdminPillsRowHtml(player)}
                  </div>
                </div>
                <div class="char-card-badges">
                  ${this.renderRaidBadgesHTML(player, canToggleRaid)}
                </div>
              </div>
              ${owner ? `<div class="char-card-owner"><img src="${owner.avatarUrl || '/icons/avatar.svg'}" alt="" class="char-card-owner-avatar" onerror="this.src='/icons/avatar.svg'"><span>${owner.displayName}</span></div>` : ''}
              ${detailHtml}
              ${player.notes ? `<div class="char-card-notes">${player.notes}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
    `;
  },

  renderGroupedView(listElement, players, userMap, hasAnyEditableCharacters) {
    this._groupArgs = { players, userMap, hasAnyEditableCharacters };
    listElement.innerHTML = `${this.renderToolbar(false)}<div id="owner-groups-wrap"></div>`;
    const search = document.getElementById('browse-search');
    search.value = this._browseSearch || '';
    search.addEventListener('input', () => {
      this._browseSearch = search.value;
      this._renderOwnerGroups();
    });
    this.attachClassFilterListeners();
    this._renderOwnerGroups();
    if (this._canSeeCards() && !this._cardCollection.loaded) {
      this._ensureCardCollectionLoaded().then(() => this._renderOwnerGroups());
    }
  },

  // Owner groups only, so the search box keeps focus while typing.
  _renderOwnerGroups() {
    const wrap = document.getElementById('owner-groups-wrap');
    if (!wrap || !this._groupArgs) return;
    const { players, userMap, hasAnyEditableCharacters } = this._groupArgs;
    const searching = !!(this._browseSearch || '').trim();
    const filtered = this._searchFilter(this.filterPlayersByClass(players), userMap);

    const byOwner = {};
    const unassigned = [];
    for (const player of filtered) {
      if (player.discordId) (byOwner[player.discordId] = byOwner[player.discordId] || []).push(player);
      else unassigned.push(player);
    }
    const ownerIds = Object.keys(byOwner).sort((a, b) => (userMap[a]?.displayName || '').localeCompare(userMap[b]?.displayName || ''));
    // A search opens every owner with a match.
    const collapsed = (id) => !searching && !this._expandedOwners.has(id);
    let html = ownerIds.map((id) => this.renderOwnerGroup(userMap[id], byOwner[id], id, collapsed(id), hasAnyEditableCharacters, userMap)).join('');
    if (unassigned.length) html += this.renderOwnerGroup(null, unassigned, 'unassigned', collapsed('unassigned'), hasAnyEditableCharacters, userMap);
    wrap.innerHTML = `<div class="owner-groups">${html || '<p class="players-empty">No characters match.</p>'}</div>`;

    wrap.querySelectorAll('.owner-group-header').forEach((header) => {
      header.addEventListener('click', () => {
        const ownerId = header.dataset.ownerId;
        if (this._expandedOwners.has(ownerId)) this._expandedOwners.delete(ownerId);
        else this._expandedOwners.add(ownerId);
        this._renderOwnerGroups();
      });
    });
    this._attachBrowseResultListeners(wrap);
    this._bindCharCardToggles(wrap);
    wrap.querySelectorAll('.cc .char-card-collection').forEach((el) => this._bindCharCardCollectionPagination(el.closest('.cc'), el.dataset.playerId));
  },

  renderOwnerGroup(owner, players, ownerId, isCollapsed, hasAnyEditableCharacters, userMap) {
    // Group players by account number within this owner (treat null/undefined as Account 1)
    const byAccount = {};

    players.forEach(player => {
      const accountNum = player.accountNumber || 1;
      if (!byAccount[accountNum]) {
        byAccount[accountNum] = [];
      }
      byAccount[accountNum].push(player);
    });

    // Sort account numbers
    const sortedAccountNums = Object.keys(byAccount).map(n => parseInt(n)).sort((a, b) => a - b);

    const ownerName = owner ? owner.displayName : 'Unassigned';
    const ownerAvatar = `<img src="${owner?.avatarUrl || '/icons/avatar.svg'}" alt="${ownerName}" class="owner-group-avatar" onerror="this.src='/icons/avatar.svg'">`;

    let html = `
      <div class="owner-group ${isCollapsed ? 'collapsed' : ''}">
        <div class="owner-group-header" data-owner-id="${ownerId}">
          <span class="collapse-icon">${isCollapsed ? '>' : 'v'}</span>
          ${ownerAvatar}
          <span class="owner-group-name">${ownerName}</span>
          <span class="owner-group-count">${players.length} character${players.length !== 1 ? 's' : ''}</span>
          <span class="owner-group-best">Best GS ${Math.max(0, ...players.map((p) => calculateGearscore(p)))}</span>
        </div>
    `;

    if (!isCollapsed) {
      html += '<div class="owner-group-content">';

      // Render each account group
      sortedAccountNums.forEach((accountNum, index) => {
        const accountPlayers = byAccount[accountNum];
        const accountName = accountPlayers.find(p => p.accountName)?.accountName;
        // Only show account indicator if there are multiple accounts
        if (sortedAccountNums.length > 1) {
          html += `
            <div class="account-group" data-account="${accountNum}">
              <div class="account-divider"><span class="account-num" data-account="${accountNum}">${accountNum}</span>${this._accountNameHtml(accountName)}</div>
              ${this.renderCharacterCards(accountPlayers, hasAnyEditableCharacters, userMap)}
            </div>
          `;
        } else {
          // Single account - no indicator needed
          html += this.renderCharacterCards(accountPlayers, hasAnyEditableCharacters, userMap);
        }
      });

      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  // Compact equipment summary for table columns
  // Weapons: highest enhancement + count of highest rarity, e.g. "+13 (Legend ×2)"
  // Armor: avg enhancement + count of highest rarity, e.g. "+11 (Legend ×5)"
  _buildEquipSummaryHtml(player) {
    const equip = player.equipment || {};
    const rarityOrder = { 'legend': 4, 'unique': 3, 'epic': 2, 'rare': 1, '': 0 };

    const summarize = (slotIds, useAvg) => {
      const pieces = slotIds.map(id => equip[id]).filter(p => p?.rarity);
      if (!pieces.length) return '';

      // Find highest rarity
      let maxRarityVal = 0;
      pieces.forEach(p => {
        const val = rarityOrder[p.rarity] || 0;
        if (val > maxRarityVal) maxRarityVal = val;
      });
      const topRarity = Object.entries(rarityOrder).find(([, v]) => v === maxRarityVal)?.[0];
      const rInfo = EQUIPMENT_RARITIES.find(r => r.value === topRarity);
      const topCount = pieces.filter(p => p.rarity === topRarity).length;

      // Enhancement
      const enhValues = pieces.map(p => parseInt(p.enhancement) || 0);
      let enhDisplay;
      if (useAvg) {
        const avg = Math.round(enhValues.reduce((a, b) => a + b, 0) / enhValues.length);
        enhDisplay = `+${avg}`;
      } else {
        enhDisplay = `+${Math.max(...enhValues)}`;
      }

      const color = rInfo?.color || 'inherit';
      return `<span class="equip-summary-line"><span style="color: ${color}">${enhDisplay}</span> <span style="color: ${color}">(${rInfo?.label} ×${topCount})</span></span>`;
    };

    const weaponHtml = summarize(['mainWeapon', 'subWeapon'], false);
    const armorHtml = summarize(['helmet', 'top', 'bottom', 'gloves', 'boots'], true);

    // Suffixes
    const suffixes = [];
    if (player.suffix1) {
      const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
      suffixes.push(s?.label || player.suffix1);
    }
    if (player.suffix2) {
      const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
      suffixes.push(s?.label || player.suffix2);
    }

    if (!weaponHtml && !armorHtml) return '';

    return `
      <div class="equip-summary">
        ${weaponHtml ? `<div class="equip-summary-row">${EQUIPMENT_ICONS.weapon} ${weaponHtml}</div>` : ''}
        ${armorHtml ? `<div class="equip-summary-row">${EQUIPMENT_ICONS.armor} ${armorHtml}</div>` : ''}
        ${suffixes.length > 0 ? `<div class="equip-summary-suffixes">${suffixes.join(' + ')}</div>` : ''}
      </div>
    `;
  },

  // Shared helper: builds the 2x2 equipment detail grid for a player
  _buildEquipDetailHtml(player) {
    const equip = player.equipment || {};

    const renderSlot = (id, label) => {
      const piece = equip[id];
      if (!piece?.rarity) return `<div class="equip-cell empty"><span class="equip-cell-label">${label}</span><span class="equip-cell-value">—</span></div>`;
      const rInfo = EQUIPMENT_RARITIES.find(r => r.value === piece.rarity);
      const color = rInfo?.color || 'inherit';
      const enh = piece.enhancement ? ` +${piece.enhancement}` : '';
      const lvl = `Lv${['70', '60', '40'].includes(String(piece.level)) ? piece.level : '50'}`;
      return `<div class="equip-cell"><span class="equip-cell-label">${label}</span><span class="equip-cell-value" style="color: ${color}"><span class="equip-cell-lv">${lvl}</span> ${rInfo?.label || piece.rarity}${enh}</span></div>`;
    };

    const hasEquip = ['mainWeapon','subWeapon','helmet','top','bottom','gloves','boots','necklace','earring','ring1','ring2'].some(id => equip[id]?.rarity);

    const suffixes = [];
    if (player.suffix1) {
      const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
      suffixes.push(s?.label || player.suffix1);
    }
    if (player.suffix2) {
      const s = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
      suffixes.push(s?.label || player.suffix2);
    }

    const stats = player.characterStats || {};
    const statRows = [];
    // A character synced from the meter shows the meter's numbers instead of the typed ones.
    const synced = player.panel && player.syncedAt ? panelStats(player.panel) : [];
    for (const { label, value } of synced) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">${label}</span><span class="equip-cell-value stat-value">${value}</span></div>`);
    if (!synced.length && stats.attackPower) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">ATK</span><span class="equip-cell-value stat-value">${stats.attackPower.toLocaleString()}</span></div>`);
    if (!synced.length && stats.magicAttack) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">MATK</span><span class="equip-cell-value stat-value">${stats.magicAttack.toLocaleString()}</span></div>`);
    if (!synced.length && stats.finalDamage) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">FD</span><span class="equip-cell-value stat-value">${stats.finalDamage.toLocaleString()}</span></div>`);
    if (!synced.length && stats.hp) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">HP</span><span class="equip-cell-value stat-value">${stats.hp.toLocaleString()}</span></div>`);
    if (!synced.length && stats.defense) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">Def</span><span class="equip-cell-value stat-value">${stats.defense.toLocaleString()}</span></div>`);
    if (!synced.length && stats.magicDefense) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">MDef</span><span class="equip-cell-value stat-value">${stats.magicDefense.toLocaleString()}</span></div>`);

    if (!hasEquip && statRows.length === 0) return '';

    return `
      <div class="char-card-equip-section">
        <div class="equip-group-card">
          <div class="equip-group-title">Armor</div>
          ${renderSlot('helmet', 'Helmet')}
          ${renderSlot('top', 'Top')}
          ${renderSlot('bottom', 'Bottom')}
          ${renderSlot('gloves', 'Gloves')}
          ${renderSlot('boots', 'Boots')}
        </div>
        <div class="equip-group-card">
          <div class="equip-group-title">Weapons</div>
          ${renderSlot('mainWeapon', 'Main')}
          ${renderSlot('subWeapon', 'Sub')}
          ${suffixes.length > 0 ? `<div class="equip-group-title" style="margin-top: 0.3rem">Suffixes</div><div class="equip-cell"><span class="equip-cell-value suffix-value">${suffixes.join(' · ')}</span></div>` : ''}
        </div>
        <div class="equip-group-card">
          <div class="equip-group-title">Accessories</div>
          ${renderSlot('necklace', 'Necklace')}
          ${renderSlot('earring', 'Earring')}
          ${renderSlot('ring1', 'Ring 1')}
          ${renderSlot('ring2', 'Ring 2')}
        </div>
        ${statRows.length > 0 ? `
          <div class="equip-group-card">
            <div class="equip-group-title">${synced.length ? 'Stats · synced' : 'Stats'}</div>
            ${statRows.join('')}
            ${synced.length ? `<div class="equip-cell synced-note"><span class="equip-cell-value">${syncedLabel(player.syncedAt)}</span></div>` : ''}
            ${synced.length && player.build ? `<div class="equip-cell synced-note"><span class="equip-cell-value">${this._overridesSummary(player.build)}</span></div>` : ''}
            ${synced.length && weeklyClearsThisWeek(player) ? `<div class="equip-cell synced-note"><span class="equip-cell-value">${this._weeklyClearsSummary(weeklyClearsThisWeek(player))}</span></div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  },

  renderPlayersTable(players, hasAnyEditableCharacters, userMap, accountBadge = null) {
    // Sort players by raid priority then alphabetically
    const sortedPlayers = this.sortPlayersByRaidPriority(players);

    return `
      <table class="players-table expandable-table">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Class</th>
            <th>GS</th>
            <th>Equipment</th>
            <th>Raids Needed</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${sortedPlayers.map(player => {
            const canEdit = this.canEditCharacter(player);
            const canToggleRaid = canEdit || dataService.isAdmin();
            const detailHtml = this._buildEquipDetailHtml(player);

            return `
            <tr class="expandable-row" data-player-id="${player.id}">
              <td class="expand-toggle-cell">${detailHtml ? '<span class="expand-arrow">▶</span>' : ''}</td>
              <td class="player-name ${canEdit ? 'editable' : ''}" data-label="Name">
                ${canEdit ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>` : player.name}
                ${this._buildAdminPillsRowHtml(player)}
              </td>
              <td class="class-cell" data-label="Class">${player.role ? `<div class="class-sprite table-class-icon" style="${getClassSpriteStyle(player.role)}"></div>` : ''}${player.role}</td>
              <td class="gs-cell" data-label="GS">
                ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-value" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${gearscoreTooltipText(player)}">${gs}</span>`; })()}
              </td>
              <td data-label="Equipment">
                ${formatPlayerEquipmentHtml(player)}
              </td>
              <td class="raids-needed" data-label="Raids Needed">
                ${this.renderRaidBadgesHTML(player, canToggleRaid)}
              </td>
              <td class="notes" data-label="Notes">${player.notes}</td>
            </tr>
            ${detailHtml ? `<tr class="expand-detail-row" data-for="${player.id}"><td colspan="7"><div class="expand-detail-content">${detailHtml}</div></td></tr>` : ''}
          `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  // Gear as the simulator's framed slots: armor on one row, weapons and jewelry on the next.
  // Synced characters show their real items; typed ones show an icon only when one item fits.
  _cardSlotsHtml(player) {
    const equip = player.equipment || {};
    const job = player.build?.second_job || SIM_JOB_NAMES[player.role] || player.role;
    const chain = simOptions.job_map[job];
    const jobs = [job, chain?.first_job, chain?.base_class].filter(Boolean);
    const lvOf = (p) => (['70', '60', '40'].includes(String(p.level)) ? String(p.level) : '50');
    const gearLevel = (name) => jobs.map((j) => simOptions.gear[j]?.[name]?.level).find(Boolean);
    const jewelKind = (slot) => (slot.startsWith('Ring') ? 'Ring' : slot);

    const itemName = (simSlot, piece, jewel) => {
      const synced = (jewel ? player.build?.jewelry : player.build?.equipment)?.find((x) => x.slot === simSlot)?.name;
      if (synced && synced !== NONE) return synced;
      const rarity = EQUIPMENT_RARITIES.find((r) => r.value === piece.rarity)?.label;
      const want = `Lv${lvOf(piece)} ${rarity}`;
      const fits = jewel
        ? (simOptions.lists.jewelry[jewelKind(simSlot)] || []).filter((n) => simOptions.accessories[jewelKind(simSlot)]?.[n]?.level === want)
        : (simOptions.lists.equipment[job]?.[simSlot] || []).filter((n) => gearLevel(n) === want);
      return fits.length === 1 ? fits[0] : '';
    };
    const iconCell = (name, jewel) => (jewel ? itemIcons.items.Jewelry?.[name] : jobs.map((j) => itemIcons.items[j]?.[name]).find((c) => c !== undefined));
    const sprite = (cell) => {
      const { cols } = itemIcons;
      return `<i class="sim-icon" style="background-image:url(${ICON_SPRITE});background-size:${cols * ICON_PX}px auto;background-position:-${(cell % cols) * ICON_PX}px -${Math.floor(cell / cols) * ICON_PX}px"></i>`;
    };

    const tile = ([key, simSlot, short], jewel = false) => {
      const piece = equip[key];
      if (!piece?.rarity) return `<span class="sim-slot normal cc-slot" data-tooltip-fixed="${simSlot}: empty"><span class="sim-slot-empty">${short}</span></span>`;
      const r = EQUIPMENT_RARITIES.find((x) => x.value === piece.rarity);
      const name = itemName(simSlot, piece, jewel);
      const cell = name ? iconCell(name, jewel) : undefined;
      const enh = !jewel && piece.enhancement ? `+${piece.enhancement}` : '';
      const tip = `${simSlot} · Lv${lvOf(piece)} ${r?.label || piece.rarity}${enh ? ` ${enh}` : ''}${name ? `\n${name}` : ''}`;
      const inner = cell !== undefined ? sprite(cell) : `<span class="sim-slot-empty">${short}</span>`;
      return `<span class="sim-slot ${piece.rarity} cc-slot" data-tooltip-fixed="${tip.replace(/"/g, '&quot;')}">${inner}${enh ? `<b>${enh}</b>` : ''}</span>`;
    };
    const suffixes = [player.suffix1, player.suffix2].filter(Boolean).map((v) => WEAPON_SUFFIXES.find((x) => x.value === v)?.label || v).join(' · ');
    return `<div class="cc-slots">
      <div class="cc-slot-row">${CARD_ARMOR.map((x) => tile(x)).join('')}</div>
      <div class="cc-slot-row">${CARD_WEAPONS.map((x) => tile(x)).join('')}<span class="cc-slot-gap"></span>${CARD_JEWELRY.map((x) => tile(x, true)).join('')}</div>
      ${suffixes ? `<div class="cc-suffixes">${suffixes}</div>` : ''}
    </div>`;
  },

  // The same twelve stats on every card, three rows of four; blank when none recorded.
  _cardStatsHtml(player) {
    const s = player.characterStats || {};
    const n = (v) => (Number(v) ? Math.round(Number(v)).toLocaleString('en-US') : '—');
    const pct = (v) => (Number(v) ? `${Number(v).toFixed(1).replace(/\.0$/, '')}%` : '—');
    const fd = Number(s.finalDamage) ? `${n(s.finalDamage)} <span class="cc-muted">${pct(fdToPercent(Number(s.finalDamage)))}</span>` : '—';
    // Raw crit values exist only in a synced character's panel; typed ones have just the %.
    const raw = (attr) => (player.panel?.rows || []).find((r) => r.attr === attr)?.buffed;
    const withPct = (value, percent) => (Number(value) && Number(percent) ? `${n(value)} <span class="cc-muted">${pct(percent)}</span>` : pct(percent));
    const cell = ([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`;
    const rows = [
      [['PATK', n(s.attackPower)], ['MATK', n(s.magicAttack)], ['DEF', n(s.defense)], ['MDEF', n(s.magicDefense)]],
      [['FD', fd], ['Crit', withPct(raw('Crit'), s.criticalRate)], ['Crit dmg', withPct(raw('Crit damage'), s.criticalDamage)], ['HP', n(s.hp)]],
      [['Fire', pct(s.fireAttack)], ['Ice', pct(s.iceAttack)], ['Light', pct(s.lightAttack)], ['Dark', pct(s.darkAttack)]],
    ];
    return `<div class="cc-stats">${rows.flat().map(cell).join('')}</div>`;
  },

  renderCharacterCards(players, hasAnyEditableCharacters, userMap) {
    const sortedPlayers = this.sortPlayersByRaidPriority(players);

    return `
      <div class="character-card-grid">
        ${sortedPlayers.map(player => {
          const gs = calculateGearscore(player);
          const tier = getGearscoreTier(gs);
          const canEdit = this.canEditCharacter(player);
          const canToggleRaid = canEdit || dataService.isAdmin();
          const iconStyle = getClassSpriteStyle(player.role);

          const age = syncedAge(player.syncedAt);
          const syncedTip = [syncedLabel(player.syncedAt), player.build ? this._overridesSummary(player.build) : '', weeklyClearsThisWeek(player) ? this._weeklyClearsSummary(weeklyClearsThisWeek(player)) : ''].filter(Boolean).join('\n');
          const pills = [this._buildExcludeToggleHtml(player), this._buildWhitelistToggleHtml(player)].join('');

          return `
            <div class="char-card cc" data-player-id="${player.id}">
              <div class="cc-top">
                ${iconStyle ? `<div class="char-card-icon-wrap"><div class="class-sprite char-card-icon" style="${iconStyle}"></div></div>` : ''}
                <div class="cc-id">
                  <span class="cc-name">${canEdit ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}</span>` : player.name}</span>
                  <span class="cc-class">${player.role}${age ? ` <span class="synced-tag${age.stale ? ' stale' : ''}" data-tooltip-fixed="${syncedTip.replace(/"/g, '&quot;')}">Synced <span class="synced-age">${age.text}</span></span>` : ''}</span>
                </div>
                <span class="cc-gs" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="${gearscoreTooltipText(player)}">${gs}</span>
              </div>
              <div class="cc-raids">
                <div class="char-card-badges">${this.renderRaidBadgesHTML(player, canToggleRaid)}</div>
                ${this._buildCharCardToggleHtml(player)}
              </div>
              <div class="cc-body">${this._ccBodyHtml(player)}</div>
              <div class="cc-foot">
                <span class="cc-notes"${player.notes ? ` data-tooltip-fixed="${String(player.notes).replace(/"/g, '&quot;')}"` : ''}>${player.notes || ''}</span>
                ${pills ? `<span class="cc-pills">${pills}</span>` : ''}
                ${canEdit ? `<button type="button" class="btn btn-secondary cc-edit" data-player-id="${player.id}">Edit</button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
  },

  // Get the max account number for a given owner
  getMaxAccountForOwner(discordId) {
    if (!discordId || !this._allPlayers) return 0;

    let maxAccount = 0;
    this._allPlayers.forEach(p => {
      if (p.discordId === discordId && p.accountNumber) {
        maxAccount = Math.max(maxAccount, p.accountNumber);
      }
    });

    return maxAccount;
  },

  // Render account buttons row
  renderAccountButtons(containerId, selectedAccount = null, maxAccount = 1) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Ensure at least 1 account button, or up to maxAccount
    const numButtons = Math.max(1, maxAccount);

    let html = '<div class="account-buttons">';
    for (let i = 1; i <= numButtons; i++) {
      const isSelected = selectedAccount === i;
      html += `<button type="button" class="account-btn ${isSelected ? 'selected' : ''}" data-account="${i}">Acc ${i}</button>`;
    }
    html += `<button type="button" class="account-btn add-account-btn" title="Add account">+</button>`;
    html += '</div>';

    container.innerHTML = html;

    // Add click handlers
    container.querySelectorAll('.account-btn:not(.add-account-btn)').forEach(btn => {
      btn.addEventListener('click', () => {
        // Toggle selection
        const wasSelected = btn.classList.contains('selected');
        container.querySelectorAll('.account-btn').forEach(b => b.classList.remove('selected'));
        if (!wasSelected) {
          btn.classList.add('selected');
        }
      });
    });

    container.querySelector('.add-account-btn').addEventListener('click', () => {
      const currentButtons = container.querySelectorAll('.account-btn:not(.add-account-btn)');
      const newAccountNum = currentButtons.length + 1;

      // Insert new button before the + button
      const addBtn = container.querySelector('.add-account-btn');
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'account-btn';
      newBtn.dataset.account = newAccountNum;
      newBtn.textContent = `Acc ${newAccountNum}`;

      newBtn.addEventListener('click', () => {
        const wasSelected = newBtn.classList.contains('selected');
        container.querySelectorAll('.account-btn').forEach(b => b.classList.remove('selected'));
        if (!wasSelected) {
          newBtn.classList.add('selected');
        }
      });

      addBtn.parentNode.insertBefore(newBtn, addBtn);
    });
  },

  // Get currently selected account from buttons
  getSelectedAccount(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const selected = container.querySelector('.account-btn.selected');
    return selected ? parseInt(selected.dataset.account) : null;
  },

  // Initialize level toggle buttons (show/hide based on rarity, handle clicks)
  initLevelToggles(selectId, groupId) {
    const raritySelect = document.getElementById(selectId);
    const levelGroup = document.getElementById(groupId);
    if (!raritySelect || !levelGroup) return;

    // Show/hide on rarity change
    raritySelect.addEventListener('change', () => {
      const val = raritySelect.value;
      levelGroup.style.display = val ? 'flex' : 'none';
    });

    // Handle toggle button clicks
    levelGroup.querySelectorAll('.level-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        levelGroup.querySelectorAll('.level-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  // Get selected level from a level toggle group
  getSelectedLevel(groupId) {
    const group = document.getElementById(groupId);
    if (!group) return '50';
    const active = group.querySelector('.level-toggle-btn.active');
    return active ? active.dataset.level : '50';
  },

  // Render class picker (base class icons → specializations → final classes)
  renderClassPicker(containerId, hiddenInputId, selectedClass) {
    const container = document.getElementById(containerId);
    const hiddenInput = document.getElementById(hiddenInputId);
    if (!container) return;

    // Find which family/spec the selected class belongs to
    let activeFamily = null;
    let activeSpec = null;
    if (selectedClass) {
      for (const [familyKey, family] of Object.entries(CLASS_FAMILIES)) {
        if (family.classes.includes(selectedClass)) {
          activeFamily = familyKey;
          for (const [specKey, spec] of Object.entries(family.specializations)) {
            if (spec.classes.includes(selectedClass)) {
              activeSpec = specKey;
              break;
            }
          }
          break;
        }
      }
    }

    let expandedFamily = activeFamily;

    const render = () => {
      const family = expandedFamily ? CLASS_FAMILIES[expandedFamily] : null;

      // Base class family buttons
      let html = `<div class="modal-class-family-filter">
        ${Object.entries(CLASS_FAMILIES).map(([key, fam]) => `
          <button type="button" class="class-family-btn ${expandedFamily === key ? 'expanded' : ''}"
                  data-family="${key}" title="${fam.name}">
            <span class="class-icon-wrapper">
              <div class="class-sprite" style="${getClassSpriteStyle(fam.name)}"></div>
            </span>
          </button>
        `).join('')}
      </div>`;

      // Specialization buttons (when a family is expanded)
      if (family && family.specializations) {
        html += `<div class="modal-specialization-filter">
          ${Object.entries(family.specializations).map(([key, spec]) => `
            <button type="button" class="specialization-btn ${activeSpec === key ? 'active' : ''}"
                    data-spec="${key}" title="${spec.name}">
              <div class="spec-icon-wrapper">
                <div class="class-sprite" style="${getClassSpriteStyle(spec.name)}"></div>
              </div>
              <span class="spec-name">${spec.name}</span>
            </button>
          `).join('')}
        </div>`;

        // Final class buttons (under the active specialization)
        if (activeSpec && family.specializations[activeSpec]) {
          const spec = family.specializations[activeSpec];
          html += `<div class="class-picker-finals">
            ${spec.classes.map(cls => `
              <button type="button" class="final-class-btn ${selectedClass === cls ? 'active' : ''}"
                      data-class="${cls}"><span class="final-class-icon"><div class="class-sprite" style="${getClassSpriteStyle(cls)}"></div></span>${cls}</button>
            `).join('')}
          </div>`;
        }
      }

      // Show selected class
      if (selectedClass) {
        html += `<div class="class-picker-selected">Selected: <strong>${selectedClass}</strong></div>`;
      }

      container.innerHTML = html;

      // Attach events
      container.querySelectorAll('.class-family-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const familyKey = btn.dataset.family;
          if (expandedFamily === familyKey) {
            expandedFamily = null;
            activeSpec = null;
          } else {
            expandedFamily = familyKey;
            activeSpec = null;
          }
          // Don't clear selection when browsing families
          render();
        });
      });

      container.querySelectorAll('.specialization-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const specKey = btn.dataset.spec;
          activeSpec = activeSpec === specKey ? null : specKey;
          render();
        });
      });

      container.querySelectorAll('.final-class-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedClass = btn.dataset.class;
          hiddenInput.value = selectedClass;
          render();
        });
      });
    };

    render();
  },

  // The simulator's General window, plus stats typed from the game window over the calculated ones.
  _builderHtml(prefix) {
    return `
      <div class="form-group">
        <label>Gear:</label>
        <div id="${prefix}-gear-review" class="gear-review" hidden></div>
        <div id="${prefix}-builder" class="modal-builder-window"></div>
      </div>
      <div class="form-group hand-stats">
        <label>Stats in game: <span class="hand-stats-hint">blank uses the calculated value</span></label>
        <div class="stats-form-grid">${HAND_STATS.map(([key, label, decimals]) => `
          <div class="stat-input-row">
            <label for="${prefix}-hs-${key}">${label}</label>
            <input type="number" ${decimals ? 'step="0.01"' : 'step="1"'} id="${prefix}-hs-${key}" data-hand-stat="${key}" />
          </div>`).join('')}
        </div>
      </div>
    `;
  },

  _mountBuilder(prefix, modalElement, build, handStats) {
    const inputs = [...modalElement.querySelectorAll('[data-hand-stat]')];
    for (const input of inputs) {
      const value = handStats?.[input.dataset.handStat];
      if (value != null && value !== '') input.value = value;
    }
    this._builders[prefix] = createCharacterBuilder(modalElement.querySelector(`#${prefix}-builder`), build, {
      onUpdate: (result) => {
        const calculated = deriveStats(result);
        for (const input of inputs) input.placeholder = calculated[input.dataset.handStat] != null ? String(calculated[input.dataset.handStat]) : '';
      },
    });
    return this._builders[prefix];
  },

  _readHandStats(modalElement) {
    const stats = {};
    for (const input of modalElement.querySelectorAll('[data-hand-stat]')) {
      if (input.value !== '' && Number.isFinite(Number(input.value))) stats[input.dataset.handStat] = Number(input.value);
    }
    return stats;
  },

  _closeBuilderModal(prefix, modalElement) {
    this._builders[prefix]?.destroy();
    delete this._builders[prefix];
    modalElement.remove();
  },

  // Name and stats from the analyzer go in the form; class and gear go in the window (screenshot-import.js).
  _setupScreenshotUpload(prefix, modalElement) {
    setupUpload(modalElement, prefix, {
      getTarget: () => this._builders[prefix],
      onAnalyzed: (data) => {
        const nameInput = document.getElementById(`${prefix}-name`);
        if (data.name && nameInput && !nameInput.value) nameInput.value = data.name;
        for (const [key, value] of Object.entries(data.stats || {})) {
          const input = document.getElementById(`${prefix}-hs-${key}`);
          if (input && Number(value)) input.value = value;
        }
      },
      onRead: (slots) => {
        const review = modalElement.querySelector(`#${prefix}-gear-review`);
        if (slots && review) renderGearReview(review, this._builders[prefix], slots.filter((slot) => !slot.sure));
      },
    });
  },

  // Add Character: syncing from the toolbox first, hand entry as the fallback.
  showAddChooser() {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    const close = () => modalElement.remove();
    // Toolbox sync (the meter link) is a guildmate perk; friends add by hand.
    const canSync = dataService.isPlayer();
    const showChoice = () => {
      modalElement.innerHTML = `
        <div class="modal-content modal-add-chooser">
          <h2>Add Character</h2>
          ${canSync
            ? '<button type="button" class="btn btn-primary" id="add-choice-sync">Sync with the toolbox</button>'
            : `<button type="button" class="btn btn-primary guild-only" disabled>Sync with the toolbox${GUILD_ONLY_TAG}</button>`}
          <button type="button" class="btn btn-secondary" id="add-choice-hand">Manual/Screenshot${canSync ? ' (Old version)' : ''}</button>
        </div>
      `;
      modalElement.querySelector('#add-choice-sync')?.addEventListener('click', showSteps);
      modalElement.querySelector('#add-choice-hand').addEventListener('click', () => { close(); this.showAddPlayerModal(); });
    };
    const showSteps = () => {
      modalElement.innerHTML = `
        <div class="modal-content modal-add-chooser">
          <h2>Sync with the toolbox</h2>
          <ol class="sync-steps">
            <li>Download the latest toolbox from the Discord announcements and open it.</li>
            <li>Open Afterlight Sync and press Link with Afterlight. Approve the link on the page it opens.</li>
            <li>Turn on Auto-sync, log in to the game and change maps once.</li>
          </ol>
          <p class="sync-steps-note">Cards arrive on the first map change. Title and card mastery are entered in the toolbox.</p>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" id="add-steps-back">Back</button>
            <button type="button" class="btn btn-primary" id="add-steps-done">Done</button>
          </div>
        </div>
      `;
      modalElement.querySelector('#add-steps-back').addEventListener('click', showChoice);
      modalElement.querySelector('#add-steps-done').addEventListener('click', close);
    };
    modalElement.addEventListener('click', (e) => { if (e.target === modalElement) close(); });
    showChoice();
    document.body.appendChild(modalElement);
  },

  showAddPlayerModal() {
    const isAdmin = dataService.isAdmin();
    const currentUser = dataService.getUser();

    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content modal-equipment modal-builder">
        <h2>Add New Character</h2>
        <form id="add-player-form">
          <div class="modal-builder-head">
            <div class="form-group">
              <label for="player-name">Name: *</label>
              <input type="text" id="player-name" required>
            </div>
            ${isAdmin ? `
            <div class="form-group">
              <label for="player-owner">Owner:</label>
              <select id="player-owner">
                <option value="">No owner (unassigned)</option>
                ${this._appUsers.map(u => `
                  <option value="${u.discordId}" ${currentUser && u.discordId === currentUser.id ? 'selected' : ''}>
                    ${u.displayName} (${u.username})
                  </option>
                `).join('')}
              </select>
            </div>
            ` : ''}
            <div class="form-group" id="account-group">
              <label>Account:</label>
              <div id="account-buttons-container"></div>
            </div>
          </div>
          ${uploadHtml('player')}
          ${this._builderHtml('player')}
          <div class="form-group">
            <label for="player-notes">Notes:</label>
            <textarea id="player-notes" rows="3" maxlength="140"></textarea>
          </div>
          ${isAdmin ? `
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="player-exclude">
              Exclude from recruiting
            </label>
            <div id="player-exclude-fields" style="display: none; margin-top: 0.4rem;">
              <input type="text" id="player-exclude-label" placeholder="Badge label (default: Excluded)" maxlength="20" style="width: 100%; margin-bottom: 0.3rem;">
              <input type="text" id="player-exclude-reason" placeholder="Tooltip reason (e.g., 'Just an alt', 'On break until Apr 30')" maxlength="120" style="width: 100%;">
            </div>
          </div>
          ` : ''}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Add Character</button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);
    const close = () => this._closeBuilderModal('player', modalElement);
    const builder = this._mountBuilder('player', modalElement, emptyBuildFor(''), {});

    const excludeCb = document.getElementById('player-exclude');
    const excludeFields = document.getElementById('player-exclude-fields');
    if (excludeCb && excludeFields) {
      excludeCb.addEventListener('change', () => {
        excludeFields.style.display = excludeCb.checked ? 'block' : 'none';
      });
    }

    const selectedOwnerId = isAdmin
      ? (currentUser?.id || this._appUsers[0]?.discordId || null)
      : (currentUser?.id || null);
    const initialMax = selectedOwnerId ? Math.max(1, this.getMaxAccountForOwner(selectedOwnerId)) : 1;
    this.renderAccountButtons('account-buttons-container', 1, initialMax);

    this._setupScreenshotUpload('player', modalElement);

    if (isAdmin) {
      const ownerSelect = document.getElementById('player-owner');
      ownerSelect.addEventListener('change', () => {
        const selectedOwner = ownerSelect.value;
        const ownerMax = selectedOwner ? Math.max(1, this.getMaxAccountForOwner(selectedOwner)) : 1;
        this.renderAccountButtons('account-buttons-container', null, ownerMax);
      });
    }

    document.getElementById('add-player-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('player-name').value;
      const notes = document.getElementById('player-notes').value;
      const accountNumber = this.getSelectedAccount('account-buttons-container');

      if (!dataService.hasWriteAccess()) {
        toast.warning('Please log in to add characters.', 5000);
        close();
        return;
      }

      const submitBtn = e.target.querySelector('button[type="submit"]');
      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const exclude = document.getElementById('player-exclude')?.checked || false;
        const excludeLabel = document.getElementById('player-exclude-label')?.value || '';
        const excludeReason = document.getElementById('player-exclude-reason')?.value || '';
        const result = await dataService.addPlayer({
          name, role: siteClassName(builder.build.second_job), build: builder.build, handStats: this._readHandStats(modalElement),
          notes, accountNumber: accountNumber || 1, exclude, excludeLabel, excludeReason
        });

        if (isAdmin && result.data?.id) {
          const selectedOwner = document.getElementById('player-owner')?.value || null;
          await dataService.assignCharacterOwner(result.data.id, selectedOwner);
        }

        close();
        toast.success(`Character "${name}" added successfully!`);
        this.loadPlayers();
      } catch (error) {
        toast.error(`Error adding player: ${error.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Character';
      }
    });

    document.getElementById('cancel-btn').addEventListener('click', close);
    modalElement.addEventListener('click', (e) => { if (e.target === modalElement) close(); });
  },

  // Hand-set fields of a synced character; buffs stay on the simulator.
  _overridesHtml(player) {
    const b = player.build || {};
    const L = simOptions.lists;
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const opts = (list, current, label = (v) => v) => list.map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
    const num = (attrs, value, [min, max]) => `<input type="number" ${attrs} min="${min}" max="${max}" step="1" value="${Number(value) || 0}">`;

    const cardCount = (b.card_grades || []).filter((c) => c?.grade && c.grade !== NONE).length;
    const title = b.title || NONE;
    const titles = [NONE, ...L.titles, ...(title !== NONE && !L.titles.includes(title) ? [title] : [])];
    const masteryKeys = Object.keys(simOptions.defaults.build1.card_bonus_levels);
    const masterySet = masteryKeys.filter((key) => Number(b.card_bonus_levels?.[key]) > 0).length;
    const mastery = masteryKeys.map((key) => `
      <label class="ov-tile"><span>${esc(key)}</span>${num(`data-mastery="${esc(key)}"`, b.card_bonus_levels?.[key], L.limits.card_bonus_level)}</label>`).join('');
    const passiveList = this._overridePassives(b, player.role);
    const passives = passiveList.map(({ skill, level, max }) => `
      <label class="ov-row"><span>${esc(skill)}</span>${num(`data-passive="${esc(skill)}"`, level, [0, max])}</label>`).join('');
    const engravingList = this._overrideEngravings(b);
    const engraved = engravingList.filter((item) => item.grade !== NONE).length;
    const engravings = engravingList.map((item) => `
      <div class="ov-engraving${item.grade === NONE ? ' empty' : ''}" data-engraving="${esc(item.slot)}">
        <span>${esc(item.slot)}</span>
        <select data-engraving-grade>${opts(L.engraving.grades, item.grade, (g) => ENGRAVING_RARITY[g] || g)}</select>
        <select data-engraving-rank ${item.grade === NONE ? 'disabled' : ''}>${opts(engravingMainOptions(item), item.value_rank)}</select>
      </div>`).join('');
    const tabs = [
      ['general', 'General', `<label class="ov-field"><span>Title</span><select id="override-title">${opts(titles, title)}</select></label>
        <label class="ov-field ov-narrow"><span>Collection level</span>${num('id="override-collection"', b.collection_level, L.limits.collection_level)}</label>
        <div class="ov-cards"><span>Cards</span><span class="ov-meta">${cardCount} registered</span>
          ${cardCount ? '<button type="button" class="btn btn-danger-ghost" id="override-clear-cards">Clear cards</button>' : ''}</div>`],
      ['mastery', `<span class="ov-long">Card mastery</span><span class="ov-short">Mastery</span> <span class="ov-count">${masterySet}/${masteryKeys.length}</span>`, `<div class="ov-grid ov-mastery">${mastery}</div>`],
      passives && ['passives', `Passives <span class="ov-count">${passiveList.length}</span>`, `<div class="ov-grid ov-pairs">${passives}</div>`],
      ['engravings', `Engravings <span class="ov-count">${engraved}/${engravingList.length}</span>`, `<div class="ov-grid ov-pairs">${engravings}</div><p class="ov-note">Pick the rarity shown in game (Rare, Epic, Unique, Legend), not a letter grade. Extras are set in the simulator.</p>`],
    ].filter(Boolean);

    return `
      <section class="modal-overrides">
        <header class="ov-title"><h3>Set by hand</h3>
          <label class="toggle-switch"><input type="checkbox" id="override-hand-set-wins" ${player.handSetWins ? 'checked' : ''}><span class="toggle-slider"></span><span class="toggle-label">Hand-set beats game</span></label>
        </header>
        <nav class="ov-tabs" role="tablist">${tabs.map(([key, label], i) => `<button type="button" role="tab" class="ov-tab${i ? '' : ' active'}" data-ov-tab="${key}">${label}</button>`).join('')}</nav>
        ${tabs.map(([key, , body], i) => `<div class="ov-panel ov-panel-${key}" data-ov-panel="${key}" ${i ? 'hidden' : ''}>${body}</div>`).join('')}
      </section>`;
  },

  // The class's passive skills at their current level; the sync sends them at their top level.
  _overridePassives(build, role) {
    const keys = simOptions.lists.buffs?.[build.second_job || role] || [];
    return keys.map((key) => simOptions.buffs?.[key]).filter((f) => f?.category === 'Passive').map((f) => {
      const hit = (build.buffs || []).find((x) => x?.skill === f.skill);
      return { skill: f.skill, max: f.max_level || 0, level: Math.min(f.max_level || 0, Number(hit?.level) || 0) };
    });
  },

  _overrideEngravings(build) {
    return emptyEngravings().map((empty) => ({ ...empty, ...(build.engravings || []).find((e) => e.slot === empty.slot) }));
  },

  _setupOverrides(modalElement) {
    modalElement.querySelectorAll('[data-ov-tab]').forEach((tab) => tab.addEventListener('click', () => {
      modalElement.querySelectorAll('[data-ov-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      modalElement.querySelectorAll('[data-ov-panel]').forEach((panel) => { panel.hidden = panel.dataset.ovPanel !== tab.dataset.ovTab; });
    }));
    modalElement.querySelectorAll('[data-engraving-grade]').forEach((select) => select.addEventListener('change', () => {
      const row = select.closest('[data-engraving]');
      const rank = row.querySelector('[data-engraving-rank]');
      const options = engravingMainOptions({ slot: row.dataset.engraving, grade: select.value });
      rank.innerHTML = options.map((v) => `<option value="${v}">${v}</option>`).join('');
      rank.disabled = select.value === NONE;
      row.classList.toggle('empty', select.value === NONE);
    }));
  },

  // Title · Collection Lv · Mastery n/13 set, for the expanded detail.
  _overridesSummary(build) {
    const keys = Object.keys(simOptions.defaults.build1.card_bonus_levels);
    const mastery = keys.filter((k) => Number(build.card_bonus_levels?.[k]) > 0).length;
    const title = (build.title && build.title !== NONE ? build.title : 'No title').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `${title} · Collection Lv ${Number(build.collection_level) || 0} · Mastery ${mastery}/${keys.length} set`;
  },

  // "Weekly clears: Black Dragon Nest (Classic) 1 · Desert Dragon Nest (Normal) 2/4 stages", from this week's sync.
  _weeklyClearsSummary(weeklyClears) {
    const cleared = GAME_RAIDS.map((raid) => [raid, raidProgress(raid, weeklyClears)])
      .filter(([, progress]) => progress.stagesCleared > 0)
      .map(([raid, progress]) => `${raid.name} ${raid.allStages && !progress.done ? `${progress.stagesCleared}/${raid.stages.length} stages` : progress.clears}`);
    return `Weekly clears: ${cleared.length ? cleared.join(' · ') : 'none this week'}`;
  },

  // The section's values as a partial build for character-overrides; unchanged extras ride along.
  _readOverrides(modalElement, player) {
    const b = player.build || {};
    const clamp = (input) => Math.max(Number(input.min), Math.min(Number(input.max), Math.round(Number(input.value) || 0)));
    const card_bonus_levels = { ...(b.card_bonus_levels || {}) };
    modalElement.querySelectorAll('[data-mastery]').forEach((input) => { card_bonus_levels[input.dataset.mastery] = clamp(input); });
    const engravings = this._overrideEngravings(b).map((stored) => {
      const row = modalElement.querySelector(`[data-engraving="${CSS.escape(stored.slot)}"]`);
      const grade = row.querySelector('[data-engraving-grade]').value;
      const rank = row.querySelector('[data-engraving-rank]').value || NONE;
      const item = { ...stored };
      if (grade !== stored.grade) Object.assign(item, { grade, value_rank: NONE, main_value: 0, secondary_value: 0, extra_tier: NONE, extra_value: 0 });
      if (grade !== NONE && rank !== item.value_rank) setEngravingRank(item, rank);
      return item;
    });
    return {
      title: modalElement.querySelector('#override-title').value,
      collection_level: clamp(modalElement.querySelector('#override-collection')),
      card_bonus_levels, engravings,
      buffs: [...modalElement.querySelectorAll('[data-passive]')].map((input) => ({ skill: input.dataset.passive, level: clamp(input) })),
    };
  },

  showEditPlayerModal(player) {
    const isAdmin = dataService.isAdmin();
    const maxAccount = player.discordId ? this.getMaxAccountForOwner(player.discordId) : 0;
    const synced = !!player.syncedAt;

    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content modal-equipment${synced ? '' : ' modal-builder'}">
        <h2>Edit Character</h2>
        <form id="edit-player-form">
          <div class="modal-builder-head">
            <div class="form-group">
              <label for="edit-player-name">Name: *</label>
              <input type="text" id="edit-player-name" required value="${player.name}">
            </div>
            ${isAdmin ? `
            <div class="form-group">
              <label for="edit-player-owner">Owner:</label>
              <select id="edit-player-owner">
                <option value="">No owner (unassigned)</option>
                ${this._appUsers.map(u => `
                  <option value="${u.discordId}" ${player.discordId === u.discordId ? 'selected' : ''}>
                    ${u.displayName} (${u.username})
                  </option>
                `).join('')}
              </select>
            </div>
            ` : ''}
            <div class="form-group" id="edit-account-group">
              <label>Account:</label>
              <div id="edit-account-buttons-container"></div>
            </div>
          </div>
          ${synced ? `
          <div class="modal-synced-note">
            Synced from the meter on ${new Date(player.syncedAt).toLocaleDateString()}
            <span>Re-sync from the toolbox to change gear or stats</span>
          </div>
          ` : uploadHtml('edit-player')}
          ${synced ? `${this._overridesHtml(player)}
          <div class="form-group">
            <label>Class:</label>
            <input type="hidden" id="edit-player-class" value="${player.role || ''}">
            <div class="class-picker locked" id="edit-class-picker" inert></div>
          </div>` : this._builderHtml('edit-player')}
          <div class="form-group">
            <label for="edit-player-notes">Notes:</label>
            <textarea id="edit-player-notes" rows="3" maxlength="140">${player.notes}</textarea>
          </div>
          ${isAdmin ? `
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="edit-player-exclude" ${player.exclude ? 'checked' : ''}>
              Exclude from recruiting
            </label>
            <div id="edit-player-exclude-fields" style="display: ${player.exclude ? 'block' : 'none'}; margin-top: 0.4rem;">
              <input type="text" id="edit-player-exclude-label" placeholder="Badge label (default: Excluded)" maxlength="20" value="${(player.excludeLabel || '').replace(/"/g, '&quot;')}" style="width: 100%; margin-bottom: 0.3rem;">
              <input type="text" id="edit-player-exclude-reason" placeholder="Tooltip reason (e.g., 'Just an alt', 'On break until Apr 30')" maxlength="120" value="${(player.excludeReason || '').replace(/"/g, '&quot;')}" style="width: 100%;">
            </div>
          </div>
          ` : ''}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <button type="button" class="btn btn-secondary" id="cancel-edit-btn">Cancel</button>
            <button type="button" class="btn" style="background-color: #dc3545; color: white;" id="delete-player-btn">Delete</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);
    const close = () => this._closeBuilderModal('edit-player', modalElement);

    // A character from before the builder keeps its typed gear and stats until the window is touched.
    const builder = synced ? null : this._mountBuilder('edit-player', modalElement,
      player.build || emptyBuildFor(player.role), player.handStats || (player.build ? {} : player.characterStats));
    if (synced) this.renderClassPicker('edit-class-picker', 'edit-player-class', player.role || '');

    // Toggle exclude-fields visibility
    const editExcludeCb = document.getElementById('edit-player-exclude');
    const editExcludeFields = document.getElementById('edit-player-exclude-fields');
    if (editExcludeCb && editExcludeFields) {
      editExcludeCb.addEventListener('change', () => {
        editExcludeFields.style.display = editExcludeCb.checked ? 'block' : 'none';
      });
    }

    const editMaxAccount = player.discordId ? Math.max(1, maxAccount, player.accountNumber || 1) : 1;
    this.renderAccountButtons('edit-account-buttons-container', player.accountNumber || 1, editMaxAccount);

    // Setup screenshot upload and equip level buttons
    if (!synced) {
      this._setupScreenshotUpload('edit-player', modalElement);
    } else {
      this._setupOverrides(modalElement);
      document.getElementById('override-clear-cards')?.addEventListener('click', async (e) => {
        const confirmed = await modal.confirm(
          `Clear ${player.name}'s cards? Use this after removing every card in game. The same cards coming back from the toolbox are ignored; new cards replace them.`,
          { title: 'Clear Cards', confirmText: 'Clear', cancelText: 'Cancel', danger: true },
        );
        if (!confirmed) return;
        e.target.disabled = true;
        try {
          await dataService.clearCharacterCards(player.id);
          close();
          toast.success(`Cleared ${player.name}'s cards`);
          this.loadPlayers();
        } catch (error) {
          toast.error(error.message);
          e.target.disabled = false;
        }
      });
    }

    if (isAdmin) {
      const ownerSelect = document.getElementById('edit-player-owner');
      ownerSelect.addEventListener('change', () => {
        const selectedOwner = ownerSelect.value;
        const ownerMax = selectedOwner ? Math.max(1, this.getMaxAccountForOwner(selectedOwner)) : 1;
        this.renderAccountButtons('edit-account-buttons-container', null, ownerMax);
      });
    }

    document.getElementById('edit-player-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('edit-player-name').value;
      const notes = document.getElementById('edit-player-notes').value;
      const accountNumber = this.getSelectedAccount('edit-account-buttons-container');
      const built = !!builder && (!!player.build || builder.dirty);
      const handStats = synced ? {} : this._readHandStats(modalElement);

      const ownerSelect = document.getElementById('edit-player-owner');
      const newOwnerId = ownerSelect ? ownerSelect.value : null;

      if (!dataService.hasWriteAccess()) {
        toast.warning('Please log in to edit characters.', 5000);
        close();
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const exclude = document.getElementById('edit-player-exclude')?.checked ?? player.exclude ?? false;
        const excludeLabel = document.getElementById('edit-player-exclude-label')?.value ?? player.excludeLabel ?? '';
        const excludeReason = document.getElementById('edit-player-exclude-reason')?.value ?? player.excludeReason ?? '';
        // A sent build has the server derive gear and stats; otherwise the stored ones go back unchanged.
        await dataService.updatePlayer({
          ...player, name,
          role: built ? siteClassName(builder.build.second_job) : player.role,
          build: built ? builder.build : undefined,
          handStats: built ? handStats : undefined,
          characterStats: built ? {} : handStats,
          notes, accountNumber: accountNumber || 1, exclude, excludeLabel, excludeReason
        }, player.name);

        if (isAdmin && newOwnerId !== player.discordId) {
          await dataService.assignCharacterOwner(player.id, newOwnerId || null);
        }
        if (synced) await dataService.saveCharacterOverrides(player.id, this._readOverrides(modalElement, player), modalElement.querySelector('#override-hand-set-wins').checked);

        close();
        toast.success(`Character "${name}" updated successfully!`);
        this.loadPlayers();
      } catch (error) {
        toast.error(`Error updating player: ${error.message}`);
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
      }
    });

    const deleteBtn = document.getElementById('delete-player-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await modal.confirm(
          `Are you sure you want to delete ${player.name}? This action cannot be undone.`,
          {
            title: 'Delete Character',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            danger: true
          }
        );

        if (!confirmed) return;

        try {
          await dataService.deletePlayer(player.id);
          close();
          toast.success(`${player.name} deleted! Wala na!!`);
          this.loadPlayers();
        } catch (error) {
          toast.error(`Anong ginawa mo? Error: ${error.message}`);
        }
      });
    }

    document.getElementById('cancel-edit-btn').addEventListener('click', close);
    modalElement.addEventListener('click', (e) => { if (e.target === modalElement) close(); });
  },

  async togglePlayerCompleted(playerName) {
    if (!dataService.hasWriteAccess()) {
      toast.warning('Write access not configured. Please update player manually in Google Sheet or configure Apps Script URL.', 5000);
      return;
    }

    try {
      await dataService.togglePlayerCompleted(playerName);
      toast.success(`Updated ${playerName}`);
      this.loadPlayers();
    } catch (error) {
      toast.error(`??? Hala ano yan error: ${error.message}`);
    }
  },

  destroy() {
    if (this._chartInstance) {
      this._chartInstance.destroy();
      this._chartInstance = null;
    }
  }
};

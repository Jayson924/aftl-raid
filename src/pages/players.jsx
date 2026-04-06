import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { inputValidator } from '../input-validator.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS, WEAPON_SUFFIXES, CLASS_FAMILIES, EQUIPMENT_LEVELS, calculateGearscore, getGearscoreTier, formatPlayerEquipmentHtml, getClassSpriteStyle } from '../constants.js';
import { modal } from '../modal.js';
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

export const PlayersPage = {
  // Cache for app users (for owner dropdown)
  _appUsers: [],

  // Group by owner toggle state (persisted in localStorage)
  _groupByOwner: localStorage.getItem('playersGroupByOwner') === 'true',

  // View mode: 'characters' or 'roster'
  _viewMode: 'characters',

  // Chart instance reference
  _chartInstance: null,

  // Gearscore filter for roster view (0 = show all)
  _gsFilter: 0,

  // Cached data for roster re-renders
  _rosterPlayers: null,
  _rosterUserMap: null,

  // Class family colors for chart
  _classFamilyColors: {
    warrior: '#F08A46',
    archer: '#A8F274',
    sorceress: '#DF69FF',
    cleric: '#6CC9EB',
    academic: '#F7DA6F',
    kali: '#756EFF'
  },

  // Check if current user can edit a player (using Discord-linked ownership)
  canEditCharacter(player) {
    return dataService.canEditPlayer(player);
  },

  async render(container) {
    container.innerHTML = `
      <div class="players-page">
        <div class="page-header">
          <div class="page-title-tabs">
            <h1 class="view-tab ${this._viewMode === 'characters' ? 'active' : ''}" data-view="characters">Characters</h1>
            <span class="title-divider">/</span>
            <h1 class="view-tab ${this._viewMode === 'roster' ? 'active' : ''}" data-view="roster">Roster</h1>
          </div>
          <div class="page-header-actions">
            <label class="toggle-switch" id="group-by-owner-wrapper" ${this._viewMode === 'roster' ? 'style="display:none"' : ''}>
              <input type="checkbox" id="group-by-owner-toggle" ${this._groupByOwner ? 'checked' : ''}>
              <span class="toggle-slider"></span>
              <span class="toggle-label">Group by owner</span>
            </label>
            <button id="add-player-btn" class="btn btn-primary" ${this._viewMode === 'roster' ? 'style="display:none"' : ''}>+ Add Character</button>
          </div>
        </div>
        <div id="players-list" class="players-list">
          <div class="loading">Loading characters...</div>
        </div>
      </div>
    `;

    document.getElementById('add-player-btn').addEventListener('click', () => {
      this.showAddPlayerModal();
    });

    document.getElementById('group-by-owner-toggle').addEventListener('change', (e) => {
      this._groupByOwner = e.target.checked;
      localStorage.setItem('playersGroupByOwner', this._groupByOwner);
      this.loadPlayers();
    });

    // View tab listeners
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._viewMode = tab.dataset.view;
        document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === this._viewMode));
        // Show/hide character-specific controls
        const isRoster = this._viewMode === 'roster';
        document.getElementById('group-by-owner-wrapper').style.display = isRoster ? 'none' : '';
        document.getElementById('add-player-btn').style.display = isRoster ? 'none' : '';
        this.loadPlayers();
      });
    });

    this.loadPlayers();
  },

  // Store expanded state for owner groups (collapsed by default)
  _expandedOwners: new Set(),

  // Filter for prioritizing uncleared raids { hc: boolean, cl: boolean }
  _raidPriorityFilter: { hc: false, cl: false },

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

        if (this._expandedClassFamily === family) {
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
    const levelKey = type === 'weapon' ? 'weaponLevel' : 'armorLevel';
    const enhanceKey = type === 'weapon' ? 'weaponEnhance' : 'armorEnhance';

    const rarityOrder = { 'legend': 3, 'unique': 2, 'epic': 1, '': 0 };
    const rarity = rarityOrder[player[rarityKey] || ''] || 0;
    const level = player[levelKey] ? parseInt(player[levelKey]) : 0;
    const enhance = parseInt(player[enhanceKey] || '0') || 0;

    // Weighted: rarity is most important, then level, then enhancement
    return rarity * 10000 + level * 100 + enhance;
  },

  sortPlayersByRaidPriority(players) {
    return [...players].sort((a, b) => {
      const hasFilter = this._raidPriorityFilter.hc || this._raidPriorityFilter.cl;

      if (hasFilter) {
        const aNeedsHC = dataService.playerNeedsRaid(a, 'Hardcore');
        const aNeedsCL = dataService.playerNeedsRaid(a, 'Classic');
        const bNeedsHC = dataService.playerNeedsRaid(b, 'Hardcore');
        const bNeedsCL = dataService.playerNeedsRaid(b, 'Classic');

        let aNeeds = false, bNeeds = false;
        if (this._raidPriorityFilter.hc && this._raidPriorityFilter.cl) {
          // Both selected - needs either
          aNeeds = aNeedsHC || aNeedsCL;
          bNeeds = bNeedsHC || bNeedsCL;
        } else if (this._raidPriorityFilter.hc) {
          aNeeds = aNeedsHC;
          bNeeds = bNeedsHC;
        } else if (this._raidPriorityFilter.cl) {
          aNeeds = aNeedsCL;
          bNeeds = bNeedsCL;
        }

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

      // Render based on toggle state
      if (this._groupByOwner) {
        this.renderGroupedView(listElement, players, userMap, hasAnyEditableCharacters);
      } else {
        this.renderFlatView(listElement, players, userMap, hasAnyEditableCharacters);
      }

      // Add event listeners for clickable player names
      document.querySelectorAll('.player-name-link').forEach(link => {
        link.addEventListener('click', (e) => {
          const playerId = link.dataset.playerId;
          this.showEditPlayerModal(players.find(p => p.id === playerId));
        });
      });

      // Add event listeners for raid priority filter (multi-select)
      document.querySelectorAll('.raid-priority-filter .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const filter = btn.dataset.filter; // 'hc' or 'cl'
          this._raidPriorityFilter[filter] = !this._raidPriorityFilter[filter];
          this.loadPlayers();
        });
      });

      // Add event listeners for raid badge toggles
      document.querySelectorAll('.raid-badge.clickable').forEach(badge => {
        badge.addEventListener('click', async (e) => {
          const playerId = badge.dataset.playerId;
          const raidType = badge.dataset.raidType;
          const isCurrentlyCompleted = badge.dataset.completed === 'true';

          // Toggle to opposite state
          const newCompleted = !isCurrentlyCompleted;

          try {
            badge.style.opacity = '0.5';
            await dataService.togglePlayerRaidCompletion(playerId, raidType, newCompleted);
            toast.success(`${raidType} ${newCompleted ? 'marked as done' : 'marked as not done'}`);
            this.loadPlayers(); // Refresh the list
          } catch (error) {
            toast.error(`Failed to update: ${error.message}`);
            badge.style.opacity = '';
          }
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

      // Add event listeners for class family filter
      this.attachClassFilterListeners();

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
      const levelKey = type === 'weapon' ? 'weaponLevel' : 'armorLevel';
      if (!player[rarityKey]) return '-';
      const rarity = EQUIPMENT_RARITIES.find(r => r.value === player[rarityKey]);
      const label = rarity?.label || player[rarityKey];
      const enhance = player[enhanceKey] ? ' +' + player[enhanceKey] : '';
      const hasLevel = !!player[rarityKey];
      const level = hasLevel && player[levelKey] ? `Lv${player[levelKey]} ` : '';
      return `${level}${label}${enhance}`;
    };

    // Build tooltip HTML for a list of players, grouped by owner
    const buildTooltipHtml = (clsPlayers) => {
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
        <div class="roster-summary">
          <div class="roster-stat roster-stat-tip">
            <span class="roster-stat-value">${totalPlayers}</span>
            <span class="roster-stat-label">Characters</span>
            <div class="roster-tooltip">${totalOwners} player${totalOwners !== 1 ? 's' : ''}</div>
          </div>
          <div class="roster-stat">
            <span class="roster-stat-value" style="color: ${avgTier.color}" data-tooltip="Gearscore">${avgGearscore}</span>
            <span class="roster-stat-label">Avg Gearscore</span>
          </div>
        </div>
        <div class="roster-gs-slider">
          <label>Min Gearscore: <span id="gs-slider-value" style="color: ${getGearscoreTier(minGs).color}">${minGs}</span></label>
          <input type="range" id="gs-slider" min="0" max="100" value="${minGs}" />
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
            <div class="roster-chart-note">Gearscore is unofficial and is used to help balance our raid teams. Highest value is 100 and would need 2718 FD, +15 weapon, and +15 armor.</div>
          </div>
          <div class="roster-breakdown">
            <h3>Class Breakdown</h3>
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
                    <div class="roster-class-list">
                      ${Object.entries(classes).map(([cls, cnt]) => {
                        const clsPlayers = familyPlayersList[key][cls] || [];
                        const clsAvgGs = clsPlayers.length > 0
                          ? Math.round(clsPlayers.reduce((sum, p) => sum + calculateGearscore(p), 0) / clsPlayers.length)
                          : 0;
                        const clsTier = getGearscoreTier(clsAvgGs);
                        return `<span class="roster-class-item">${cls} <span class="roster-class-count">×${cnt}</span> <span class="roster-gs-badge" style="color: ${clsTier.color}; background: ${clsTier.bg};" data-tooltip="Gearscore">${clsAvgGs}</span><div class="roster-tooltip">${buildTooltipHtml(clsPlayers)}</div></span>`;
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
        <button class="filter-btn ${this._raidPriorityFilter.hc ? 'active' : ''}" data-filter="hc">HC</button>
        <button class="filter-btn ${this._raidPriorityFilter.cl ? 'active' : ''}" data-filter="cl">CL</button>
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
                <button class="filter-btn ${this._raidPriorityFilter.hc ? 'active' : ''}" data-filter="hc">HC</button>
                <button class="filter-btn ${this._raidPriorityFilter.cl ? 'active' : ''}" data-filter="cl">CL</button>
              </div>
            </td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          ${sortedPlayers.map(player => {
            const needsHardcore = dataService.playerNeedsRaid(player, 'Hardcore');
            const needsClassic = dataService.playerNeedsRaid(player, 'Classic');
            const canEdit = this.canEditCharacter(player);
            const canToggleRaid = canEdit || dataService.isAdmin();
            const detailHtml = this._buildEquipDetailHtml(player);

            const owner = player.discordId ? userMap[player.discordId] : null;

            return `
            <tr class="expandable-row" data-player-id="${player.id}">
              <td class="expand-toggle-cell">${detailHtml ? '<span class="expand-arrow">▶</span>' : ''}</td>
              <td class="player-name ${canEdit ? 'editable' : ''}" data-label="Name">
                ${canEdit ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>` : player.name}
              </td>
              <td class="player-owner" data-label="Owner">
                ${owner ? `
                  <div class="owner-badge" title="${owner.displayName}">
                    <img src="${owner.avatarUrl || '/icons/avatar.svg'}" alt="${owner.displayName}" class="owner-avatar" onerror="this.src='/icons/avatar.svg'">
                    <span class="owner-name">${owner.displayName}</span>
                  </div>
                ` : '<span class="no-owner">—</span>'}
              </td>
              <td data-label="Class">${player.role}</td>
              <td class="gs-cell" data-label="GS">
                ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-value" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`; })()}
              </td>
              <td data-label="Equipment">
                ${this._buildEquipSummaryHtml(player)}
              </td>
              <td class="raids-needed" data-label="Raids Needed">
                <span class="raid-badge raid-hardcore ${!needsHardcore ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                      ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Hardcore" data-completed="${!needsHardcore}"` : ''}
                      title="${canToggleRaid ? 'Click to toggle' : ''}">
                  ${!needsHardcore ? '✓ ' : ''}HC
                </span>
                <span class="raid-badge raid-classic ${!needsClassic ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                      ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Classic" data-completed="${!needsClassic}"` : ''}
                      title="${canToggleRaid ? 'Click to toggle' : ''}">
                  ${!needsClassic ? '✓ ' : ''}CL
                </span>
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
          const needsHardcore = dataService.playerNeedsRaid(player, 'Hardcore');
          const needsClassic = dataService.playerNeedsRaid(player, 'Classic');
          const canEdit = this.canEditCharacter(player);
          const canToggleRaid = canEdit || dataService.isAdmin();
          const iconStyle = getClassSpriteStyle(player.role);
          const owner = player.discordId ? userMap[player.discordId] : null;
          const detailHtml = this._buildEquipDetailHtml(player);

          return `
            <div class="char-card">
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
                  </div>
                </div>
                <div class="char-card-badges">
                  <span class="raid-badge raid-hardcore ${!needsHardcore ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                        ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Hardcore" data-completed="${!needsHardcore}"` : ''}
                        title="${canToggleRaid ? 'Click to toggle' : ''}">
                    ${!needsHardcore ? '✓ ' : ''}HC
                  </span>
                  <span class="raid-badge raid-classic ${!needsClassic ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                        ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Classic" data-completed="${!needsClassic}"` : ''}
                        title="${canToggleRaid ? 'Click to toggle' : ''}">
                    ${!needsClassic ? '✓ ' : ''}CL
                  </span>
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
    // Filter by class first
    const filteredPlayers = this.filterPlayersByClass(players);

    // Group filtered players by owner
    const groupedByOwner = {};
    const unassigned = [];

    filteredPlayers.forEach(player => {
      if (player.discordId) {
        if (!groupedByOwner[player.discordId]) {
          groupedByOwner[player.discordId] = [];
        }
        groupedByOwner[player.discordId].push(player);
      } else {
        unassigned.push(player);
      }
    });

    // Sort owners by display name
    const sortedOwnerIds = Object.keys(groupedByOwner).sort((a, b) => {
      const ownerA = userMap[a]?.displayName || '';
      const ownerB = userMap[b]?.displayName || '';
      return ownerA.localeCompare(ownerB);
    });

    // Build grouped HTML with filters at top
    let html = `
      ${this.renderClassFamilyFilter()}
      <div class="raid-priority-filter grouped-filter">
        <button class="filter-btn ${this._raidPriorityFilter.hc ? 'active' : ''}" data-filter="hc">HC</button>
        <button class="filter-btn ${this._raidPriorityFilter.cl ? 'active' : ''}" data-filter="cl">CL</button>
      </div>
      <div class="owner-groups">`;

    // Render each owner group
    sortedOwnerIds.forEach(ownerId => {
      const owner = userMap[ownerId];
      const ownerPlayers = groupedByOwner[ownerId];
      const isCollapsed = !this._expandedOwners.has(ownerId);

      html += this.renderOwnerGroup(owner, ownerPlayers, ownerId, isCollapsed, hasAnyEditableCharacters, userMap);
    });

    // Render unassigned group
    if (unassigned.length > 0) {
      const isCollapsed = !this._expandedOwners.has('unassigned');
      html += this.renderOwnerGroup(null, unassigned, 'unassigned', isCollapsed, hasAnyEditableCharacters, userMap);
    }

    html += '</div>'; // Close owner-groups
    listElement.innerHTML = html;

    // Add event listeners for collapse toggles
    document.querySelectorAll('.owner-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const ownerId = header.dataset.ownerId;
        if (this._expandedOwners.has(ownerId)) {
          this._expandedOwners.delete(ownerId);
        } else {
          this._expandedOwners.add(ownerId);
        }
        this.loadPlayers();
      });
    });
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
          <span class="owner-group-count">(${players.length} character${players.length !== 1 ? 's' : ''})</span>
        </div>
    `;

    if (!isCollapsed) {
      html += '<div class="owner-group-content">';

      // Render each account group
      sortedAccountNums.forEach((accountNum, index) => {
        const accountPlayers = byAccount[accountNum];
        // Only show account indicator if there are multiple accounts
        if (sortedAccountNums.length > 1) {
          html += `
            <div class="account-group" data-account="${accountNum}">
              <div class="account-divider"><span class="account-num" data-account="${accountNum}">${accountNum}</span></div>
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
      const lvl = piece.level === '40' ? 'Lv40' : 'Lv50';
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
    if (stats.attackPower) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">ATK</span><span class="equip-cell-value stat-value">${stats.attackPower.toLocaleString()}</span></div>`);
    if (stats.magicAttack) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">MATK</span><span class="equip-cell-value stat-value">${stats.magicAttack.toLocaleString()}</span></div>`);
    if (stats.finalDamage) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">FD</span><span class="equip-cell-value stat-value">${stats.finalDamage.toLocaleString()}</span></div>`);
    if (stats.hp) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">HP</span><span class="equip-cell-value stat-value">${stats.hp.toLocaleString()}</span></div>`);
    if (stats.defense) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">Def</span><span class="equip-cell-value stat-value">${stats.defense.toLocaleString()}</span></div>`);
    if (stats.magicDefense) statRows.push(`<div class="equip-cell"><span class="equip-cell-label">MDef</span><span class="equip-cell-value stat-value">${stats.magicDefense.toLocaleString()}</span></div>`);

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
            <div class="equip-group-title">Stats</div>
            ${statRows.join('')}
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
            const needsHardcore = dataService.playerNeedsRaid(player, 'Hardcore');
            const needsClassic = dataService.playerNeedsRaid(player, 'Classic');
            const canEdit = this.canEditCharacter(player);
            const canToggleRaid = canEdit || dataService.isAdmin();
            const detailHtml = this._buildEquipDetailHtml(player);

            return `
            <tr class="expandable-row" data-player-id="${player.id}">
              <td class="expand-toggle-cell">${detailHtml ? '<span class="expand-arrow">▶</span>' : ''}</td>
              <td class="player-name ${canEdit ? 'editable' : ''}" data-label="Name">
                ${canEdit ? `<span class="player-name-link" data-action="edit" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>` : player.name}
              </td>
              <td data-label="Class">${player.role}</td>
              <td class="gs-cell" data-label="GS">
                ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-value" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`; })()}
              </td>
              <td data-label="Equipment">
                ${formatPlayerEquipmentHtml(player)}
              </td>
              <td class="raids-needed" data-label="Raids Needed">
                <span class="raid-badge raid-hardcore ${!needsHardcore ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                      ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Hardcore" data-completed="${!needsHardcore}"` : ''}
                      title="${canToggleRaid ? 'Click to toggle' : ''}">
                  ${!needsHardcore ? '✓ ' : ''}HC
                </span>
                <span class="raid-badge raid-classic ${!needsClassic ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                      ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Classic" data-completed="${!needsClassic}"` : ''}
                      title="${canToggleRaid ? 'Click to toggle' : ''}">
                  ${!needsClassic ? '✓ ' : ''}CL
                </span>
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

  renderCharacterCards(players, hasAnyEditableCharacters, userMap) {
    const sortedPlayers = this.sortPlayersByRaidPriority(players);

    return `
      <div class="character-card-grid">
        ${sortedPlayers.map(player => {
          const gs = calculateGearscore(player);
          const tier = getGearscoreTier(gs);
          const needsHardcore = dataService.playerNeedsRaid(player, 'Hardcore');
          const needsClassic = dataService.playerNeedsRaid(player, 'Classic');
          const canEdit = this.canEditCharacter(player);
          const canToggleRaid = canEdit || dataService.isAdmin();
          const iconStyle = getClassSpriteStyle(player.role);

          const detailHtml = this._buildEquipDetailHtml(player);

          return `
            <div class="char-card">
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
                  </div>
                </div>
                <div class="char-card-badges">
                  <span class="raid-badge raid-hardcore ${!needsHardcore ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                        ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Hardcore" data-completed="${!needsHardcore}"` : ''}
                        title="${canToggleRaid ? 'Click to toggle' : ''}">
                    ${!needsHardcore ? '✓ ' : ''}HC
                  </span>
                  <span class="raid-badge raid-classic ${!needsClassic ? 'completed' : ''} ${canToggleRaid ? 'clickable' : ''}"
                        ${canToggleRaid ? `data-player-id="${player.id}" data-raid-type="Classic" data-completed="${!needsClassic}"` : ''}
                        title="${canToggleRaid ? 'Click to toggle' : ''}">
                    ${!needsClassic ? '✓ ' : ''}CL
                  </span>
                </div>
              </div>
              ${detailHtml}
              ${player.notes ? `<div class="char-card-notes">${player.notes}</div>` : ''}
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

  // Helper: generate equipment dropdown row HTML
  _equipSlotHtml(id, label, rarity, enhancement, showEnhance = true, level = '50') {
    const rarityOptions = EQUIPMENT_RARITIES.map(r =>
      `<option value="${r.value}" ${rarity === r.value ? 'selected' : ''}>${r.label}</option>`
    ).join('');
    const enhanceOptions = ENHANCEMENT_LEVELS.map(l =>
      `<option value="${l.value}" ${String(enhancement) === l.value ? 'selected' : ''} ${!l.value ? 'disabled hidden' : ''}>${l.label}</option>`
    ).join('');
    return `
      <div class="equip-slot-row">
        <span class="equip-slot-label">${label}</span>
        <button type="button" class="equip-level-toggle ${level === '40' ? 'level-40' : ''}" id="${id}-level" data-level="${level}" title="Equipment level">Lv${level === '40' ? '40' : '50'}</button>
        <select id="${id}-rarity" class="equipment-select equip-compact">${rarityOptions}</select>
        ${showEnhance ? `<select id="${id}-enhance" class="equipment-select equip-compact enhancement-select">${enhanceOptions}</select>` : ''}
      </div>
    `;
  },

  // Helper: read equipment form into jsonb object
  _readEquipmentForm(prefix) {
    const readSlot = (slotId, hasEnhance) => {
      const rarity = document.getElementById(`${prefix}-${slotId}-rarity`)?.value || '';
      const enhancement = hasEnhance ? parseInt(document.getElementById(`${prefix}-${slotId}-enhance`)?.value || '0', 10) : 0;
      const level = document.getElementById(`${prefix}-${slotId}-level`)?.dataset?.level || '50';
      if (!rarity) return {};
      return { rarity, enhancement, level };
    };

    return {
      helmet: readSlot('helmet', true),
      top: readSlot('top', true),
      bottom: readSlot('bottom', true),
      gloves: readSlot('gloves', true),
      boots: readSlot('boots', true),
      mainWeapon: readSlot('mainWeapon', true),
      subWeapon: readSlot('subWeapon', true),
      necklace: readSlot('necklace', false),
      earring: readSlot('earring', false),
      ring1: readSlot('ring1', false),
      ring2: readSlot('ring2', false)
    };
  },

  // Helper: read stats form
  _readStatsForm(prefix) {
    const val = (id) => {
      const v = document.getElementById(`${prefix}-${id}`)?.value;
      return v ? parseInt(v, 10) : null;
    };
    const stats = {};
    if (val('atk') != null) stats.attackPower = val('atk');
    if (val('matk') != null) stats.magicAttack = val('matk');
    if (val('fd') != null) stats.finalDamage = val('fd');
    if (val('hp') != null) stats.hp = val('hp');
    if (val('def') != null) stats.defense = val('def');
    if (val('mdef') != null) stats.magicDefense = val('mdef');
    return stats;
  },

  // Helper: fill equipment form from analyzed data
  _fillFromScreenshot(prefix, data) {
    const equip = data.equipment || {};
    const stats = data.stats || {};

    // Fill name and class if available
    if (data.name) {
      const nameInput = document.getElementById(`${prefix}-name`);
      if (nameInput && !nameInput.value) nameInput.value = data.name;
    }
    if (data.class) {
      const classInput = document.getElementById(`${prefix}-class`);
      if (classInput) {
        classInput.value = data.class;
        // Re-render class picker to show selection
        const pickerContainer = prefix === 'player' ? 'class-picker' : 'edit-class-picker';
        this.renderClassPicker(pickerContainer, `${prefix}-class`, data.class);
      }
    }

    // Fill equipment dropdowns
    const fillSlot = (slotId, piece, hasEnhance) => {
      if (!piece?.rarity) return;
      const rarityEl = document.getElementById(`${prefix}-${slotId}-rarity`);
      if (rarityEl) rarityEl.value = piece.rarity;
      if (hasEnhance && piece.enhancement) {
        const enhEl = document.getElementById(`${prefix}-${slotId}-enhance`);
        if (enhEl) enhEl.value = String(piece.enhancement);
      }
    };

    fillSlot('helmet', equip.helmet, true);
    fillSlot('top', equip.top, true);
    fillSlot('bottom', equip.bottom, true);
    fillSlot('gloves', equip.gloves, true);
    fillSlot('boots', equip.boots, true);
    fillSlot('mainWeapon', equip.mainWeapon, true);
    fillSlot('subWeapon', equip.subWeapon, true);
    fillSlot('necklace', equip.necklace, false);
    fillSlot('earring', equip.earring, false);
    fillSlot('ring1', equip.ring1, false);
    fillSlot('ring2', equip.ring2, false);

    // Fill stats
    if (stats.attackPower) document.getElementById(`${prefix}-atk`).value = stats.attackPower;
    if (stats.magicAttack) document.getElementById(`${prefix}-matk`).value = stats.magicAttack;
    if (stats.finalDamage) document.getElementById(`${prefix}-fd`).value = stats.finalDamage;
    if (stats.hp) document.getElementById(`${prefix}-hp`).value = stats.hp;
    if (stats.defense) document.getElementById(`${prefix}-def`).value = stats.defense;
    if (stats.magicDefense) document.getElementById(`${prefix}-mdef`).value = stats.magicDefense;
  },

  // Helper: setup screenshot upload handlers
  _setupScreenshotUpload(prefix, modalElement) {
    const uploadZone = modalElement.querySelector('.modal-upload-zone');
    const fileInput = modalElement.querySelector(`#${prefix}-screenshot-input`);
    const analyzeBtn = modalElement.querySelector(`#${prefix}-analyze-btn`);
    const clearBtn = modalElement.querySelector(`#${prefix}-clear-screenshot`);
    const analyzeRow = modalElement.querySelector(`#${prefix}-analyze-row`);
    const preview = modalElement.querySelector(`#${prefix}-screenshot-preview`);
    const placeholder = modalElement.querySelector('.modal-upload-placeholder');
    const status = modalElement.querySelector(`#${prefix}-upload-status`);

    let imageData = null;
    let mimeType = null;

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    const onPaste = (e) => {
      if (!document.body.contains(modalElement)) {
        document.removeEventListener('paste', onPaste);
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleFile(item.getAsFile());
          return;
        }
      }
    };
    document.addEventListener('paste', onPaste);

    const handleFile = (file) => {
      if (!file.type.startsWith('image/')) return;
      mimeType = file.type;
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        clearBtn.style.display = 'inline-flex';
        analyzeRow.style.display = 'flex';
        analyzeBtn.disabled = false;
        imageData = e.target.result.split(',')[1];
      };
      reader.readAsDataURL(file);
    };

    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      imageData = null;
      preview.style.display = 'none';
      placeholder.style.display = 'flex';
      clearBtn.style.display = 'none';
      analyzeRow.style.display = 'none';
      analyzeBtn.disabled = true;
      status.textContent = '';
      status.style.color = '';
      fileInput.value = '';
    });

    analyzeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!imageData) return;
      analyzeBtn.disabled = true;
      status.textContent = 'Analyzing...';
      try {
        const response = await fetch('/.netlify/functions/analyze-screenshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageData, mimeType })
        });
        const data = await response.json();
        if (data.error && !data.raw) {
          status.textContent = 'Failed: ' + data.error;
          toast.error('Analysis failed');
        } else {
          this._fillFromScreenshot(prefix, data);
          status.textContent = `Extracted! (${data.confidence || 'unknown'} confidence)`;
          status.style.color = '#4caf50';
          toast.success('Screenshot analyzed — review and save');
        }
      } catch (err) {
        status.textContent = 'Error analyzing screenshot';
        toast.error('Failed to analyze screenshot');
      } finally {
        analyzeBtn.disabled = false;
      }
    });
  },

  // Helper: setup per-piece equipment level toggle buttons
  _setupEquipLevelButtons(prefix, modalElement) {
    modalElement.querySelectorAll('.equip-level-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const current = btn.dataset.level;
        const next = current === '50' ? '40' : '50';
        btn.dataset.level = next;
        btn.textContent = `Lv${next}`;
        btn.classList.toggle('level-40', next === '40');
      });
    });
  },

  // Helper: generate screenshot upload HTML
  _screenshotUploadHtml(prefix) {
    return `
      <div class="modal-upload-section">
        <div class="modal-upload-zone">
          <div class="modal-upload-placeholder">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Upload character screenshot</span>
          </div>
          <img id="${prefix}-screenshot-preview" class="modal-screenshot-preview" style="display:none" />
          <input type="file" id="${prefix}-screenshot-input" accept="image/*" style="display:none" />
          <button type="button" class="btn-clear-screenshot" id="${prefix}-clear-screenshot" style="display:none">Clear</button>
        </div>
        <div class="modal-upload-analyze-row" style="display:none" id="${prefix}-analyze-row">
          <button type="button" class="btn-analyze" id="${prefix}-analyze-btn" disabled>Analyze Screenshot</button>
          <span class="upload-status" id="${prefix}-upload-status"></span>
        </div>
      </div>
    `;
  },

  _equipmentFormHtml(prefix, equipment, stats, suffix1, suffix2) {
    const eq = equipment || {};
    const st = stats || {};
    const s1 = suffix1 || '';
    const s2 = suffix2 || '';
    const slot = (id, label, hasEnhance = true) => {
      const piece = eq[id] || {};
      return this._equipSlotHtml(`${prefix}-${id}`, label, piece.rarity || '', piece.enhancement || 0, hasEnhance, piece.level || '50');
    };

    const suffixSelect = (id, label, selected) => `
      <div class="equip-slot-row">
        <span class="equip-slot-label">${label}</span>
        <select id="${prefix}-${id}" class="equip-compact" required>
          ${WEAPON_SUFFIXES.map(s =>
            `<option value="${s.value}" ${s.value === selected ? 'selected' : ''}>${s.label}</option>`
          ).join('')}
        </select>
      </div>
    `;

    return `
      <div class="equip-form-section">
        <div class="equip-form-group">
          <h4>Armor</h4>
          ${slot('helmet', 'Helmet')}
          ${slot('top', 'Top')}
          ${slot('bottom', 'Bottom')}
          ${slot('gloves', 'Gloves')}
          ${slot('boots', 'Boots')}
        </div>
        <div class="equip-form-group">
          <h4>Weapons</h4>
          ${slot('mainWeapon', 'Main')}
          ${slot('subWeapon', 'Sub')}
          <h4>Suffixes</h4>
          ${suffixSelect('suffix1', 'Main', s1)}
          ${suffixSelect('suffix2', 'Sub', s2)}
        </div>
        <div class="equip-form-group">
          <h4>Accessories</h4>
          ${slot('necklace', 'Necklace', false)}
          ${slot('earring', 'Earring', false)}
          ${slot('ring1', 'Ring 1', false)}
          ${slot('ring2', 'Ring 2', false)}
        </div>
        <div class="equip-form-group">
          <h4>Stats</h4>
          <div class="stats-form-grid">
            <div class="stat-input-row">
              <label>ATK</label>
              <input type="number" id="${prefix}-atk" value="${st.attackPower || ''}" placeholder="0" />
            </div>
            <div class="stat-input-row">
              <label>MATK</label>
              <input type="number" id="${prefix}-matk" value="${st.magicAttack || ''}" placeholder="0" />
            </div>
            <div class="stat-input-row">
              <label>FD</label>
              <input type="number" id="${prefix}-fd" value="${st.finalDamage || ''}" placeholder="0" required />
            </div>
            <div class="stat-input-row">
              <label>HP</label>
              <input type="number" id="${prefix}-hp" value="${st.hp || ''}" placeholder="0" />
            </div>
            <div class="stat-input-row">
              <label>Def</label>
              <input type="number" id="${prefix}-def" value="${st.defense || ''}" placeholder="0" />
            </div>
            <div class="stat-input-row">
              <label>MDef</label>
              <input type="number" id="${prefix}-mdef" value="${st.magicDefense || ''}" placeholder="0" />
            </div>
          </div>
        </div>
      </div>
    `;
  },

  showAddPlayerModal() {
    const isAdmin = dataService.isAdmin();
    const currentUser = dataService.getUser();

    const initialOwnerId = isAdmin ? (this._appUsers[0]?.discordId || null) : (currentUser?.id || null);
    const maxAccount = initialOwnerId ? this.getMaxAccountForOwner(initialOwnerId) : 0;

    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content modal-equipment">
        <h2>Add New Character</h2>
        <form id="add-player-form">
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
          ${this._screenshotUploadHtml('player')}
          <div class="form-group">
            <label>Class:</label>
            <input type="hidden" id="player-class" value="">
            <div class="class-picker" id="class-picker"></div>
          </div>
          ${this._equipmentFormHtml('player', {}, {}, '', '')}
          <div class="form-group">
            <label for="player-notes">Notes:</label>
            <textarea id="player-notes" rows="3" maxlength="140"></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Add Character</button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    // Initialize class picker
    this.renderClassPicker('class-picker', 'player-class', '');

    // Initialize account buttons
    const selectedOwnerId = isAdmin
      ? (currentUser?.id || this._appUsers[0]?.discordId || null)
      : (currentUser?.id || null);
    const initialMax = selectedOwnerId ? Math.max(1, this.getMaxAccountForOwner(selectedOwnerId)) : 1;
    this.renderAccountButtons('account-buttons-container', 1, initialMax);

    // Setup screenshot upload and equip level buttons
    this._setupScreenshotUpload('player', modalElement);
    this._setupEquipLevelButtons('player', modalElement);

    // Update account buttons when owner changes (admin only)
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
      const role = document.getElementById('player-class').value;
      const notes = document.getElementById('player-notes').value;
      const accountNumber = this.getSelectedAccount('account-buttons-container');
      const equipment = this._readEquipmentForm('player');
      const characterStats = this._readStatsForm('player');

      // Legacy fields from main weapon + helmet
      const weapon = equipment.mainWeapon?.rarity || '';
      const weaponEnhance = equipment.mainWeapon?.enhancement ? String(equipment.mainWeapon.enhancement) : '';
      const armor = equipment.helmet?.rarity || '';
      const armorEnhance = equipment.helmet?.enhancement ? String(equipment.helmet.enhancement) : '';

      if (!dataService.hasWriteAccess()) {
        toast.warning('Please log in to add characters.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const suffix1 = document.getElementById('player-suffix1').value;
        const suffix2 = document.getElementById('player-suffix2').value;
        const result = await dataService.addPlayer({
          name, role, weapon, weaponEnhance, suffix1, suffix2,
          armor, armorEnhance, equipment, characterStats,
          notes, accountNumber: accountNumber || 1
        });

        if (isAdmin && result.data?.id) {
          const selectedOwner = document.getElementById('player-owner')?.value || null;
          await dataService.assignCharacterOwner(result.data.id, selectedOwner);
        }

        document.body.removeChild(modalElement);
        toast.success(`Character "${name}" added successfully!`);
        this.loadPlayers();
      } catch (error) {
        toast.error(`Error adding player: ${error.message}`);
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Character';
      }
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  showEditPlayerModal(player) {
    const isAdmin = dataService.isAdmin();
    const maxAccount = player.discordId ? this.getMaxAccountForOwner(player.discordId) : 0;

    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content modal-equipment">
        <h2>Edit Character</h2>
        <form id="edit-player-form">
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
          ${this._screenshotUploadHtml('edit-player')}
          <div class="form-group">
            <label>Class:</label>
            <input type="hidden" id="edit-player-class" value="${player.role || ''}">
            <div class="class-picker" id="edit-class-picker"></div>
          </div>
          ${this._equipmentFormHtml('edit-player', player.equipment || {}, player.characterStats || {}, player.suffix1 || '', player.suffix2 || '')}
          <div class="form-group">
            <label for="edit-player-notes">Notes:</label>
            <textarea id="edit-player-notes" rows="3" maxlength="140">${player.notes}</textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <button type="button" class="btn btn-secondary" id="cancel-edit-btn">Cancel</button>
            <button type="button" class="btn" style="background-color: #dc3545; color: white;" id="delete-player-btn">Delete</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    this.renderClassPicker('edit-class-picker', 'edit-player-class', player.role || '');

    const editMaxAccount = player.discordId ? Math.max(1, maxAccount, player.accountNumber || 1) : 1;
    this.renderAccountButtons('edit-account-buttons-container', player.accountNumber || 1, editMaxAccount);

    // Setup screenshot upload and equip level buttons
    this._setupScreenshotUpload('edit-player', modalElement);
    this._setupEquipLevelButtons('edit-player', modalElement);

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
      const role = document.getElementById('edit-player-class').value;
      const notes = document.getElementById('edit-player-notes').value;
      const accountNumber = this.getSelectedAccount('edit-account-buttons-container');
      const equipment = this._readEquipmentForm('edit-player');
      const characterStats = this._readStatsForm('edit-player');

      const weapon = equipment.mainWeapon?.rarity || '';
      const weaponEnhance = equipment.mainWeapon?.enhancement ? String(equipment.mainWeapon.enhancement) : '';
      const armor = equipment.helmet?.rarity || '';
      const armorEnhance = equipment.helmet?.enhancement ? String(equipment.helmet.enhancement) : '';

      const ownerSelect = document.getElementById('edit-player-owner');
      const newOwnerId = ownerSelect ? ownerSelect.value : null;

      if (!dataService.hasWriteAccess()) {
        toast.warning('Please log in to edit characters.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const suffix1 = document.getElementById('edit-player-suffix1').value;
        const suffix2 = document.getElementById('edit-player-suffix2').value;
        await dataService.updatePlayer({
          id: player.id, name, role,
          weapon, weaponEnhance, suffix1, suffix2,
          armor, armorEnhance, equipment, characterStats,
          notes, accountNumber: accountNumber || 1
        }, player.name);

        if (isAdmin && newOwnerId !== player.discordId) {
          await dataService.assignCharacterOwner(player.id, newOwnerId || null);
        }

        document.body.removeChild(modalElement);
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
          await dataService.deletePlayer(player.name);
          document.body.removeChild(modalElement);
          toast.success(`${player.name} deleted! Wala na!!`);
          this.loadPlayers();
        } catch (error) {
          toast.error(`Anong ginawa mo? Error: ${error.message}`);
        }
      });
    }

    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
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

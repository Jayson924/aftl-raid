import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS, WEAPON_SUFFIXES, CLASS_FAMILIES, DAMAGE_AMP_SOURCES } from '../constants.js';
import { modal } from '../modal.js';

export const LineupEditorPage = {
  players: [],
  allLineups: [],
  currentLineup: {
    name: '',
    raidType: 'Hardcore',
    status: 'ready',
    players: [],
    ticketSlots: Array(8).fill(false), // Track ticket usage per slot
    pilotSlots: Array(8).fill(''), // Track pilot names per slot (empty string if no pilot)
    completed: false,
    isTemplate: false,
    notes: ''
  },
  selectedClassFamily: null,
  nextWeekMode: false,
  showCarouselLineups: true,
  showCarouselTemplates: false,

  /**
   * Get the most recent Friday 5pm PT reset date (returns epoch timestamp)
   * @returns {number} - Epoch timestamp (milliseconds) of the most recent Friday 5pm PT
   */
  getLastResetDate() {
    const now = Date.now(); // Current time in epoch milliseconds

    // Helper: Get hour in PT timezone for any epoch timestamp
    const getPTHour = (epochMs) => {
      return parseInt(new Date(epochMs).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false
      }));
    };

    // Helper: Get day of week in PT timezone (0=Sun, 5=Fri, 6=Sat)
    const getPTDayOfWeek = (epochMs) => {
      const dayName = new Date(epochMs).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        weekday: 'short'
      });
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days.indexOf(dayName);
    };

    // Get current day/hour in PT
    const dayOfWeek = getPTDayOfWeek(now);
    const currentHourPT = getPTHour(now);

    // Calculate how many days back to the target Friday
    let daysBack;
    if (dayOfWeek === 5) { // Currently Friday in PT
      daysBack = currentHourPT >= 17 ? 0 : 7;
    } else if (dayOfWeek === 6) { // Saturday
      daysBack = 1;
    } else if (dayOfWeek === 0) { // Sunday
      daysBack = 2;
    } else { // Mon-Thu (1-4)
      daysBack = dayOfWeek + 2;
    }

    // Start searching from approximate target (in epoch time)
    // Round down to the nearest hour to start with a clean boundary
    const approximateTarget = now - (daysBack * 24 * 60 * 60 * 1000);
    const oneHour = 60 * 60 * 1000;
    let candidate = Math.floor((approximateTarget - (12 * oneHour)) / oneHour) * oneHour;

    // Search forward hour by hour (up to 48 hours to be safe)
    for (let i = 0; i < 48; i++) {
      const candidateDayOfWeek = getPTDayOfWeek(candidate);
      const candidateHour = getPTHour(candidate);

      if (candidateDayOfWeek === 5 && candidateHour === 17) {
        // Found Friday 5pm PT - candidate is already normalized to hour boundary
        // Now we need to fine-tune to find exactly when PT hour becomes 17
        // Search backwards in 1-minute increments to find the exact moment
        let exactMoment = candidate;
        for (let j = 0; j < 60; j++) {
          const testTime = candidate - (j * 60 * 1000);
          if (getPTHour(testTime) !== 17) {
            // We've gone too far back, the exact moment is one minute forward
            exactMoment = testTime + (60 * 1000);
            break;
          }
        }

        // Round down to the nearest minute for consistency
        return Math.floor(exactMoment / 60000) * 60000;
      }

      // Move forward 1 hour
      candidate += oneHour;
    }

    // Fallback (should never happen)
    console.error('Could not determine last reset date');
    return now;
  },

  /**
   * Check if we've crossed a weekly reset boundary and auto-clear non-template lineups.
   * Cleanup runs server-side (Apps Script) so the state is shared across all devices/browsers.
   */
  async checkAndClearWeeklyLineups() {
    const lastResetTimestamp = this.getLastResetDate();
    console.log('[Weekly Reset Check] sending lastResetTimestamp:', new Date(lastResetTimestamp).toISOString());

    const result = await dataService.checkWeeklyReset(lastResetTimestamp);
    console.log('[Weekly Reset Check]', result);
  },

  async render(container) {
    container.innerHTML = `
      <div class="lineup-editor-page">
        <div class="page-header">
          <h1>Lineup Editor</h1>
        </div>

        <div class="editor-container">
          <div class="lineup-info">
            <div class="lineup-info-left">
              <div class="lineup-info-row">
                <div class="form-group raid-type-group">
                  <label for="raid-type">Raid Type:</label>
                  <select id="raid-type">
                    <option value="Hardcore">GDN Hardcore</option>
                    <option value="Classic">GDN Classic</option>
                  </select>
                </div>
                <div class="form-group lineup-name-group">
                  <label for="lineup-name">Lineup Name:</label>
                  <input type="text" id="lineup-name" placeholder="Enter lineup name...">
                </div>
              </div>
              <div class="lineup-toggles">
                <label class="template-toggle">
                  <input type="checkbox" id="template-toggle">
                  <img src="/icons/group.svg" class="template-checkbox-icon" alt="Template">
                  <span>Template</span>
                </label>
                <label class="template-toggle">
                  <input type="checkbox" id="next-week-toggle">
                  <span>Next Week</span>
                </label>
              </div>
            </div>
            <div class="lineup-info-right">
              <div class="form-group lineup-notes-group">
                <label for="lineup-notes">Notes:</label>
                <textarea id="lineup-notes" placeholder="Add notes for this lineup..." rows="2"></textarea>
              </div>
            </div>
          </div>

          <div class="editor-main">
            <div class="lineup-slots">
              <h3>Raid Lineup (8 characters)</h3>
              <div class="damage-amp-display">
                <div class="damage-amp-bar physical">
                  <span class="damage-amp-label">Physical</span>
                  <div class="damage-amp-track">
                    <div class="damage-amp-fill" id="physical-amp-fill" style="width: 0%"></div>
                  </div>
                  <div class="damage-amp-value-wrapper">
                    <span class="damage-amp-value" id="physical-amp-value">0%</span>
                    <div class="damage-amp-tooltip" id="physical-amp-tooltip"></div>
                  </div>
                </div>
                <div class="damage-amp-bar magic">
                  <span class="damage-amp-label">Magic</span>
                  <div class="damage-amp-track">
                    <div class="damage-amp-fill" id="magic-amp-fill" style="width: 0%"></div>
                  </div>
                  <div class="damage-amp-value-wrapper">
                    <span class="damage-amp-value" id="magic-amp-value">0%</span>
                    <div class="damage-amp-tooltip" id="magic-amp-tooltip"></div>
                  </div>
                </div>
              </div>
              <div id="lineup-slots-container" class="slots-container">
                ${Array(8).fill(0).map((_, idx) => `
                  <div class="slot" data-slot="${idx}">
                    <span class="slot-number">${idx + 1}</span>
                    <div class="slot-content">
                      <div class="empty-slot">Drop or click</div>
                    </div>
                  </div>
                `).join('')}
              </div>
              <div class="lineup-actions">
                <button id="save-lineup-btn" class="btn btn-primary">Save Lineup</button>
                <label class="toggle-cleared">
                  <input type="checkbox" id="cleared-toggle">
                  <span>Cleared</span>
                </label>
                <button id="clear-lineup-btn" class="btn btn-secondary">Remove Characters</button>
              </div>
              <div class="existing-lineups-section">
                <div class="carousel-tabs">
                  <button class="carousel-tab active" data-tab="lineups" id="carousel-tab-lineups">Lineups</button>
                  <button class="carousel-tab" data-tab="templates" id="carousel-tab-templates">Templates</button>
                </div>
                <div class="carousel-wrapper">
                  <button id="editor-carousel-prev" class="carousel-nav-btn carousel-prev" aria-label="Scroll left">◀</button>
                  <div id="existing-lineups-container" class="existing-lineups-container">
                    <div class="loading">Loading lineups...</div>
                  </div>
                  <button id="editor-carousel-next" class="carousel-nav-btn carousel-next" aria-label="Scroll right">▶</button>
                </div>
              </div>
            </div>

            <div class="available-players">
              <h3>Available Characters <span style="font-size: 0.85rem; color: #888; font-weight: normal;">(Drag & drop, double click, click slots)</span></h3>
              <div class="player-filter">
                <input type="text" id="player-search" placeholder="Search characters...">
                <select id="class-filter">
                  <option value="">All Classes</option>
                  ${CLASSES.map(cls => `<option value="${cls}">${cls}</option>`).join('')}
                </select>
              </div>
              <div class="class-family-filter">
                ${Object.entries(CLASS_FAMILIES).map(([key, family]) => `
                  <button class="class-family-btn" data-family="${key}" title="${family.name}">
                    <img src="/icons/${family.icon}" alt="${family.name}">
                  </button>
                `).join('')}
              </div>
              <div class="player-filter-checkboxes">
                <label class="hide-cleared-filter">
                  <input type="checkbox" id="hide-cleared-checkbox">
                  <span>Hide Cleared</span>
                </label>
                <label class="hide-cleared-filter">
                  <input type="checkbox" id="hide-in-lineup-checkbox">
                  <span>Hide in Lineup</span>
                </label>
              </div>
              <div id="available-players-list" class="players-list">
                <div class="loading">Loading players...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.setupCarouselDragScroll();
    this.loadPlayers();
  },

  attachEventListeners() {
    document.getElementById('lineup-name').addEventListener('input', (e) => {
      this.currentLineup.name = e.target.value;
    });

    document.getElementById('raid-type').addEventListener('change', (e) => {
      this.currentLineup.raidType = e.target.value;
      this.renderAvailablePlayers(); // Re-render to update completion badges
      this.loadExistingLineups(); // Re-filter existing lineups by raid type
      this.reRenderLineupSlots(); // Re-render slots to show/hide ticket toggle
    });

    document.getElementById('lineup-notes').addEventListener('input', (e) => {
      this.currentLineup.notes = e.target.value;
    });

    document.getElementById('cleared-toggle').addEventListener('change', (e) => {
      this.currentLineup.completed = e.target.checked;
    });

    document.getElementById('template-toggle').addEventListener('change', (e) => {
      this.currentLineup.isTemplate = e.target.checked;
    });

    document.getElementById('next-week-toggle').addEventListener('change', (e) => {
      this.nextWeekMode = e.target.checked;
      this.renderAvailablePlayers(); // Re-render to show/hide cleared players
    });

    // Carousel tab handlers (toggleable - both can be active)
    document.getElementById('carousel-tab-lineups').addEventListener('click', (e) => {
      this.showCarouselLineups = !this.showCarouselLineups;
      e.target.classList.toggle('active', this.showCarouselLineups);
      // Ensure at least one is selected
      if (!this.showCarouselLineups && !this.showCarouselTemplates) {
        this.showCarouselTemplates = true;
        document.getElementById('carousel-tab-templates').classList.add('active');
      }
      this.loadExistingLineups();
    });

    document.getElementById('carousel-tab-templates').addEventListener('click', (e) => {
      this.showCarouselTemplates = !this.showCarouselTemplates;
      e.target.classList.toggle('active', this.showCarouselTemplates);
      // Ensure at least one is selected
      if (!this.showCarouselLineups && !this.showCarouselTemplates) {
        this.showCarouselLineups = true;
        document.getElementById('carousel-tab-lineups').classList.add('active');
      }
      this.loadExistingLineups();
    });

    document.querySelectorAll('.slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        const slotIndex = parseInt(e.currentTarget.dataset.slot);
        this.showPlayerSelector(slotIndex);
      });
    });

    this.setupDragAndDrop();

    document.getElementById('player-search').addEventListener('input', () => {
      this.filterPlayers();
    });

    document.getElementById('class-filter').addEventListener('change', (e) => {
      // If a specific class is selected, deactivate all class family buttons
      if (e.target.value) {
        this.selectedClassFamily = null;
        document.querySelectorAll('.class-family-btn').forEach(btn => btn.classList.remove('active'));
      }
      this.filterPlayers();
    });

    document.getElementById('hide-cleared-checkbox').addEventListener('change', () => {
      this.filterPlayers();
    });

    document.getElementById('hide-in-lineup-checkbox').addEventListener('change', () => {
      this.filterPlayers();
    });

    // Class family filter buttons
    document.querySelectorAll('.class-family-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const family = btn.dataset.family;

        // Toggle selection
        if (this.selectedClassFamily === family) {
          this.selectedClassFamily = null;
          btn.classList.remove('active');
        } else {
          // Remove active from all buttons
          document.querySelectorAll('.class-family-btn').forEach(b => b.classList.remove('active'));
          // Set new selection
          this.selectedClassFamily = family;
          btn.classList.add('active');
          // Reset class dropdown to "All Classes"
          document.getElementById('class-filter').value = '';
        }

        this.filterPlayers();
      });
    });

    document.getElementById('save-lineup-btn').addEventListener('click', () => {
      this.saveLineup();
    });

    document.getElementById('clear-lineup-btn').addEventListener('click', () => {
      this.clearLineup();
    });

    // Mobile tap-to-toggle for damage amp tooltips
    document.querySelectorAll('.damage-amp-value-wrapper').forEach(wrapper => {
      wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        const tooltip = wrapper.querySelector('.damage-amp-tooltip');
        const isOpen = tooltip.classList.contains('open');

        // Close all other tooltips first
        document.querySelectorAll('.damage-amp-tooltip.open').forEach(t => t.classList.remove('open'));

        // Toggle this tooltip
        if (!isOpen) {
          tooltip.classList.add('open');
        }
      });
    });

    // Close tooltips when clicking elsewhere
    document.addEventListener('click', () => {
      document.querySelectorAll('.damage-amp-tooltip.open').forEach(t => t.classList.remove('open'));
    });
  },

  async loadPlayers() {
    const listElement = document.getElementById('available-players-list');

    if (!dataService.isConfigured()) {
      listElement.innerHTML = '<div class="error">Please configure Google Sheets first.</div>';
      return;
    }

    try {
      // Check and clear weekly lineups before loading
      if (dataService.hasWriteAccess()) {
        await this.checkAndClearWeeklyLineups();
      }

      // Load both players and lineups
      [this.players, this.allLineups] = await Promise.all([
        dataService.getPlayers(),
        dataService.getLineups()
      ]);

      this.renderAvailablePlayers();
      this.loadExistingLineups();
      this.updateDamageAmpDisplay();
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading players: ${error.message}</div>`;
    }
  },

  async loadExistingLineups() {
    const container = document.getElementById('existing-lineups-container');

    try {
      // Refresh lineups from the server
      this.allLineups = await dataService.getLineups();

      // Filter lineups by current raid type and selected tabs
      const lineups = this.allLineups.filter(lineup => {
        const lineupRaidType = lineup.raidType || 'Hardcore'; // Default to Hardcore if not set
        const matchesRaidType = lineupRaidType === this.currentLineup.raidType;
        const matchesFilter = (this.showCarouselLineups && !lineup.isTemplate) ||
                              (this.showCarouselTemplates && lineup.isTemplate);
        return matchesRaidType && matchesFilter;
      });

      if (lineups.length === 0) {
        container.innerHTML = `<div class="empty-state">No ${this.currentLineup.raidType} lineups to show</div>`;
        return;
      }

      const playerMap = new Map(this.players.map(p => [p.name, p]));

      // Sort lineups: cleared ones last
      lineups.sort((a, b) => {
        // Non-cleared first (false < true)
        if (a.completed === b.completed) return 0;
        return a.completed ? 1 : -1;
      });

      container.innerHTML = lineups.map(lineup => {
        // Check if lineup is cleared
        const isCleared = lineup.completed;

        // Create 8 mini player cards in 2x4 grid
        const playerCards = Array(8).fill(0).map((_, idx) => {
          const playerName = lineup.players[idx];

          // Check ticket status for this player
          const hasTicket = lineup.ticketPlayers && lineup.ticketPlayers[idx];

          // Check if this is a guest character
          let player = null;
          let isPub = false;
          if (playerName && playerName.startsWith('[PUB]')) {
            isPub = true;
            const parts = playerName.substring(5).split('|');
            const pubName = parts[0];
            const pubRole = parts[1];
            // If no name, use class name as display name
            player = { name: pubName || pubRole, role: pubName ? pubRole : '' };
          } else {
            player = playerName ? playerMap.get(playerName) : null;
          }

          if (!player) {
            return `
              <div class="mini-player-card empty">
                <div class="mini-player-empty">Empty</div>
              </div>
            `;
          }

          const backgroundStyle = isPub ? 'background: repeating-linear-gradient(45deg, rgba(255, 193, 7, 0.11), rgba(255, 193, 7, 0.15) 10px, rgba(0, 0, 0, 0.3) 10px, rgba(0, 0, 0, 0.3) 20px);' : this.getEquipmentBackground(player);

          // Mini ticket indicator (only for Classic raid)
          const showTicketFlag = lineup.raidType === 'Classic';
          const ticketIndicator = showTicketFlag ? `<div class="ticket-flag-mini ${hasTicket ? 'ticket-flag--active' : 'ticket-flag--inactive'}" title="${hasTicket ? 'Using ticket' : 'No ticket'}"><img src="/icons/ticket.svg" alt="T"></div>` : '';

          // Check pilot status for this player (only for non-guest)
          const pilotName = !isPub && lineup.pilotPlayers && lineup.pilotPlayers[idx] ? lineup.pilotPlayers[idx] : '';
          const pilotDisplay = pilotName ? `<span class="pilot-info-mini"><img src="/icons/headphones.svg" alt="Pilot" class="pilot-info-icon-mini">${pilotName}</span>` : '';

          return `
            <div class="mini-player-card ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">
              ${ticketIndicator}
              <div class="mini-player-info">
                <div class="mini-player-name">${player.name}${isPub ? ' <span class="pub-badge-mini">G</span>' : ''}</div>
                ${pilotDisplay}
                <div class="mini-player-role">${player.role}</div>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="mini-lineup-card ${isCleared ? 'cleared' : ''} ${lineup.isTemplate ? 'template' : ''}" data-lineup-name="${lineup.name}">
            <div class="mini-lineup-header">
              <span class="mini-lineup-name">
                ${lineup.isTemplate ? '<img src="/icons/group.svg" class="template-icon" style="width: 14px; height: 14px; flex-shrink: 0;" title="Template lineup" alt="Template">' : ''}
                ${lineup.name}
              </span>
              <div class="mini-lineup-header-actions">
                <span class="mini-lineup-raid-type">GDN ${lineup.raidType || 'Hardcore'}</span>
                <button class="mini-delete-btn" data-lineup-name="${lineup.name}" data-lineup-raidtype="${lineup.raidType || 'Hardcore'}" title="Delete lineup">×</button>
              </div>
            </div>
            <div class="mini-lineup-grid">
              ${playerCards}
            </div>
          </div>
        `;
      }).join('');

      // Add click handlers to load lineups
      container.querySelectorAll('.mini-lineup-card').forEach(card => {
        // Prevent default drag behavior on cards to allow container drag
        card.addEventListener('mousedown', (e) => {
          // Don't prevent if clicking delete button
          if (e.target.classList.contains('mini-delete-btn')) return;
          e.preventDefault();
        });

        card.addEventListener('click', async (e) => {
          // Don't load if clicking delete button
          if (e.target.classList.contains('mini-delete-btn')) return;

          const lineupName = card.dataset.lineupName;
          const lineups = await dataService.getLineups();
          const lineup = lineups.find(l => l.name === lineupName);
          if (lineup) {
            this.loadLineup(lineup);
          }
        });
      });

      // Add delete button handlers
      container.querySelectorAll('.mini-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lineupName = btn.dataset.lineupName;
          const raidType = btn.dataset.lineupRaidtype;
          await this.deleteLineup(lineupName, raidType);
        });
      });

      // Setup arrow button handlers
      this.setupCarouselArrows();
    } catch (error) {
      container.innerHTML = `<div class="error">Error loading lineups: ${error.message}</div>`;
    }
  },

  setupCarouselArrows() {
    const prevBtn = document.getElementById('editor-carousel-prev');
    const nextBtn = document.getElementById('editor-carousel-next');
    const container = document.getElementById('existing-lineups-container');

    if (prevBtn && nextBtn && container) {
      prevBtn.addEventListener('click', () => {
        container.scrollBy({ left: -300, behavior: 'smooth' });
      });

      nextBtn.addEventListener('click', () => {
        container.scrollBy({ left: 300, behavior: 'smooth' });
      });

      // Update arrow visibility based on scroll position
      const updateArrows = () => {
        const isAtStart = container.scrollLeft <= 0;
        const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 1;

        prevBtn.style.opacity = isAtStart ? '0.3' : '1';
        prevBtn.style.cursor = isAtStart ? 'default' : 'pointer';
        nextBtn.style.opacity = isAtEnd ? '0.3' : '1';
        nextBtn.style.cursor = isAtEnd ? 'default' : 'pointer';
      };

      container.addEventListener('scroll', updateArrows);
      updateArrows(); // Initial check
    }
  },

  setupCarouselDragScroll() {
    const container = document.getElementById('existing-lineups-container');
    if (!container) return;

    let isDown = false;
    let startX;
    let scrollLeft;
    let hasMoved = false;

    // Mouse events
    container.addEventListener('mousedown', (e) => {
      // Allow dragging even when starting on a card
      isDown = true;
      hasMoved = false;
      container.style.cursor = 'grabbing';
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });

    container.addEventListener('mouseleave', () => {
      isDown = false;
      container.style.cursor = 'grab';
    });

    container.addEventListener('mouseup', () => {
      isDown = false;
      container.style.cursor = 'grab';
    });

    container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 2; // Scroll speed multiplier

      // Only consider it a drag if movement exceeds threshold
      if (Math.abs(walk) > 5) {
        e.preventDefault();
        hasMoved = true;
        container.scrollLeft = scrollLeft - walk;
      }
    });

    // Touch events for mobile
    container.addEventListener('touchstart', (e) => {
      isDown = true;
      hasMoved = false;
      const touch = e.touches[0];
      startX = touch.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    }, { passive: true });

    container.addEventListener('touchend', () => {
      isDown = false;
      // Reset hasMoved after a short delay
      setTimeout(() => {
        hasMoved = false;
      }, 50);
    });

    container.addEventListener('touchmove', (e) => {
      if (!isDown) return;
      const touch = e.touches[0];
      const x = touch.pageX - container.offsetLeft;
      const walk = (x - startX) * 2;

      // Only prevent default and scroll if there's actual horizontal movement
      if (Math.abs(walk) > 5) {
        e.preventDefault();
        e.stopPropagation();
        hasMoved = true;
        container.scrollLeft = scrollLeft - walk;
      }
    }, { passive: false });

    // Prevent click events on cards if dragging occurred
    container.addEventListener('click', (e) => {
      if (hasMoved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Set initial cursor
    container.style.cursor = 'grab';
  },

  renderAvailablePlayers() {
    const listElement = document.getElementById('available-players-list');

    if (this.players.length === 0) {
      listElement.innerHTML = '<div class="empty-state">No characters available. Add characters first!</div>';
      return;
    }

    const filteredPlayers = this.getFilteredPlayers();

    // Add the special "Add Guest" card at the top
    const addPubCard = `
      <div class="player-card add-pub-card" data-player-name="[ADD_PUB]" draggable="true">
        <div class="player-info">
          <div class="player-name">➕ Add Guest</div>
          <div class="player-role">Guest character</div>
        </div>
      </div>
    `;

    const playerCards = filteredPlayers.map(player => {
      const isInLineup = this.currentLineup.players.includes(player.name);
      const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
      const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

      // Check completion status based on CURRENT lineup's raid type
      // In Next Week mode, treat all players as needing the raid (ignore current completion status)
      const needsThisRaid = this.nextWeekMode ? true : dataService.playerNeedsRaid(player, this.currentLineup.raidType);

      // Check if player has already used their ticket this week (Classic only)
      const ticketUsed = this.nextWeekMode ? false : dataService.playerTicketUsed(player, this.currentLineup.raidType);

      // Check if player is in another lineup (not the current one)
      // Don't show this in Next Week mode since current week assignments aren't relevant
      let presentInLineup = null;
      if (!this.nextWeekMode && this.allLineups && this.allLineups.length > 0) {
        const otherLineup = this.allLineups.find(lineup => {
          // Skip the current lineup being edited
          if (lineup.name === this.currentLineup.name) return false;
          // Only check lineups of the same raid type
          const lineupRaidType = lineup.raidType || 'Hardcore';
          if (lineupRaidType !== this.currentLineup.raidType) return false;
          // Check if player is in this lineup
          return lineup.players && lineup.players.includes(player.name);
        });
        if (otherLineup) {
          presentInLineup = otherLineup.name;
        }
      }

      const equipmentDisplay = [];
      if (player.weapon) {
        const weaponText = `${weaponRarity?.label || player.weapon}${player.weaponEnhance ? ' +' + player.weaponEnhance : ''}`;
        equipmentDisplay.push(`<span class="equipment-item" style="color: ${weaponRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.weapon} ${weaponText}</span>`);
      }
      if (player.armor) {
        const armorText = `${armorRarity?.label || player.armor}${player.armorEnhance ? ' +' + player.armorEnhance : ''}`;
        equipmentDisplay.push(`<span class="equipment-item" style="color: ${armorRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.armor} ${armorText}</span>`);
      }

      const suffixDisplay = [];
      if (player.suffix1) {
        const suffix1Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
        suffixDisplay.push(suffix1Obj?.label || player.suffix1);
      }
      if (player.suffix2) {
        const suffix2Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
        suffixDisplay.push(suffix2Obj?.label || player.suffix2);
      }

      // Ticket used badge (only for Classic)
      const ticketBadge = ticketUsed ? `<span class="ticket-used-badge" title="Ticket already used this week"><img src="/icons/ticket.svg" alt="T"></span>` : '';

      return `
        <div class="player-card ${!needsThisRaid ? 'completed' : ''} ${isInLineup ? 'in-lineup' : ''} ${ticketUsed ? 'ticket-used' : ''}"
             data-player-name="${player.name}"
             draggable="true">
          ${player.notes ? `<span class="note-icon" data-tooltip="${player.notes.replace(/"/g, '&quot;')}">📝</span>` : ''}
          ${ticketBadge}
          ${!needsThisRaid ? `<span class="completion-badge" title="Already completed ${this.currentLineup.raidType} this week">✓</span>` : (presentInLineup ? `<span class="present-in-badge">${presentInLineup}</span>` : '')}
          <div class="player-info">
            <div class="player-name">${player.name}</div>
            <div class="player-role">${player.role}</div>
            ${equipmentDisplay.length > 0 ? `<div class="player-equipment">${equipmentDisplay.join(' ')}</div>` : ''}
            ${suffixDisplay.length > 0 ? `<div class="player-suffixes">Suffix: ${suffixDisplay.join(' + ')}</div>` : ''}
          </div>
          <div class="player-card-badges">
            ${isInLineup ? '<span class="in-lineup-badge">Added</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    listElement.innerHTML = addPubCard + playerCards;

    this.setupPlayerDragHandlers();
    this.setupAddPubHandler();
  },

  getFilteredPlayers() {
    const searchTerm = document.getElementById('player-search').value.toLowerCase();
    const classFilter = document.getElementById('class-filter').value;
    const hideCleared = document.getElementById('hide-cleared-checkbox').checked;
    const hideInLineup = document.getElementById('hide-in-lineup-checkbox').checked;

    return this.players
      .filter(player => {
        const matchesSearch = player.name.toLowerCase().includes(searchTerm) ||
                            player.role.toLowerCase().includes(searchTerm);
        const matchesClass = !classFilter || player.role === classFilter;

        // Class family filter
        let matchesClassFamily = true;
        if (this.selectedClassFamily) {
          const familyClasses = CLASS_FAMILIES[this.selectedClassFamily].classes;
          matchesClassFamily = familyClasses.includes(player.role);
        }

        // Hide cleared filter - only hide if checkbox is checked
        // In Next Week mode, don't hide anyone regardless of cleared status
        let matchesCompletion = true;
        if (hideCleared && !this.nextWeekMode) {
          // Only show players who need this raid (hide those who already completed)
          matchesCompletion = dataService.playerNeedsRaid(player, this.currentLineup.raidType);
        }

        // Hide in lineup filter - hide players who are in another lineup of the same raid type
        let matchesNotInLineup = true;
        if (hideInLineup && !this.nextWeekMode && this.allLineups && this.allLineups.length > 0) {
          const inOtherLineup = this.allLineups.some(lineup => {
            // Skip the current lineup being edited
            if (lineup.name === this.currentLineup.name) return false;
            // Only check lineups of the same raid type
            const lineupRaidType = lineup.raidType || 'Hardcore';
            if (lineupRaidType !== this.currentLineup.raidType) return false;
            // Check if player is in this lineup
            return lineup.players && lineup.players.includes(player.name);
          });
          matchesNotInLineup = !inOtherLineup;
        }

        return matchesSearch && matchesClass && matchesClassFamily && matchesCompletion && matchesNotInLineup;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  filterPlayers() {
    this.renderAvailablePlayers();
  },

  getEquipmentBackground(player) {
    if (!player) return '';

    const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
    const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

    const weaponColor = weaponRarity?.color || '';
    const armorColor = armorRarity?.color || '';

    if (!weaponColor && !armorColor) {
      return '';
    }

    if (weaponColor === armorColor || !weaponColor || !armorColor) {
      const color = weaponColor || armorColor;
      return `background: linear-gradient(135deg, ${color}22 0%, ${color}44 100%);`;
    }

    return `background: linear-gradient(180deg, ${weaponColor}33 0%, ${armorColor}33 100%);`;
  },

  calculateDamageAmp() {
    // Collect all roles from the lineup
    const roles = [];
    this.currentLineup.players.forEach(playerName => {
      if (!playerName) return;

      let role = null;
      if (playerName.startsWith('[PUB]')) {
        // Guest player - extract role from format [PUB]Name|Role
        const parts = playerName.substring(5).split('|');
        role = parts[1];
      } else {
        const player = this.players.find(p => p.name === playerName);
        if (player) {
          role = player.role;
        }
      }

      if (role) {
        roles.push(role);
      }
    });

    // Check which amp sources are activated (each source only counts once)
    let physicalAmp = 0;
    let magicAmp = 0;
    const physicalSources = [];
    const magicSources = [];

    for (const source of Object.values(DAMAGE_AMP_SOURCES)) {
      // Find which class in the lineup activates this source
      const activatingClass = source.classes.find(cls => roles.includes(cls));
      if (activatingClass) {
        if (source.physical > 0) {
          physicalAmp += source.physical;
          physicalSources.push({
            class: activatingClass,
            skill: source.name,
            value: source.physical
          });
        }
        if (source.magic > 0) {
          magicAmp += source.magic;
          magicSources.push({
            class: activatingClass,
            skill: source.name,
            value: source.magic
          });
        }
      }
    }

    // Return both raw and capped values, plus source breakdowns
    return {
      physical: physicalAmp,
      magic: magicAmp,
      physicalCapped: Math.min(physicalAmp, 100),
      magicCapped: Math.min(magicAmp, 100),
      physicalSources,
      magicSources
    };
  },

  updateDamageAmpDisplay() {
    const { physical, magic, physicalCapped, magicCapped, physicalSources, magicSources } = this.calculateDamageAmp();

    const physicalFill = document.getElementById('physical-amp-fill');
    const physicalValue = document.getElementById('physical-amp-value');
    const physicalTooltip = document.getElementById('physical-amp-tooltip');
    const magicFill = document.getElementById('magic-amp-fill');
    const magicValue = document.getElementById('magic-amp-value');
    const magicTooltip = document.getElementById('magic-amp-tooltip');

    if (physicalFill && physicalValue && physicalTooltip) {
      physicalFill.style.width = `${physicalCapped}%`;
      physicalValue.textContent = `${physical}%`;
      physicalFill.classList.toggle('capped', physical === 100);
      physicalFill.classList.toggle('overcapped', physical > 100);
      physicalValue.classList.toggle('overcapped', physical > 100);

      // Update tooltip
      physicalTooltip.innerHTML = physicalSources.length > 0
        ? physicalSources.map(s => `<div class="tooltip-row"><span class="tooltip-class">${s.class}</span><span class="tooltip-skill">${s.skill}</span><span class="tooltip-value">${s.value}%</span></div>`).join('')
        : '<div class="tooltip-empty">No sources</div>';
    }

    if (magicFill && magicValue && magicTooltip) {
      magicFill.style.width = `${magicCapped}%`;
      magicValue.textContent = `${magic}%`;
      magicFill.classList.toggle('capped', magic === 100);
      magicFill.classList.toggle('overcapped', magic > 100);
      magicValue.classList.toggle('overcapped', magic > 100);

      // Update tooltip
      magicTooltip.innerHTML = magicSources.length > 0
        ? magicSources.map(s => `<div class="tooltip-row"><span class="tooltip-class">${s.class}</span><span class="tooltip-skill">${s.skill}</span><span class="tooltip-value">${s.value}%</span></div>`).join('')
        : '<div class="tooltip-empty">No sources</div>';
    }
  },

  showPlayerSelector(slotIndex) {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';

    modalElement.innerHTML = `
      <div class="modal-content player-selector-modal">
        <h2>Select Player for Slot ${slotIndex + 1}</h2>

        <div class="modal-filters">
          <input type="text" id="modal-player-search" placeholder="Search characters...">
          <select id="modal-class-filter">
            <option value="">All Classes</option>
            ${CLASSES.map(cls => `<option value="${cls}">${cls}</option>`).join('')}
          </select>
        </div>

        <div class="modal-class-family-filter">
          ${Object.entries(CLASS_FAMILIES).map(([key, family]) => `
            <button class="class-family-btn" data-family="${key}" title="${family.name}">
              <img src="/icons/${family.icon}" alt="${family.name}">
            </button>
          `).join('')}
        </div>

        <label class="modal-hide-cleared-filter">
          <input type="checkbox" id="modal-hide-cleared-checkbox">
          <span>Hide Cleared</span>
        </label>

        <div class="player-selector-list" id="modal-player-list">
          <!-- Players will be rendered here -->
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" id="remove-player-btn">Remove Player</button>
          <button class="btn btn-secondary" id="cancel-selector-btn">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalElement);

    // State for modal filters
    let modalSelectedFamily = null;

    // Function to render filtered players
    const renderModalPlayers = () => {
      const searchTerm = document.getElementById('modal-player-search').value.toLowerCase();
      const classFilter = document.getElementById('modal-class-filter').value;
      const hideCleared = document.getElementById('modal-hide-cleared-checkbox').checked;

      const filteredPlayers = this.players
        .filter(player => {
          const matchesSearch = player.name.toLowerCase().includes(searchTerm) ||
                              player.role.toLowerCase().includes(searchTerm);
          const matchesClass = !classFilter || player.role === classFilter;

          // Class family filter
          let matchesClassFamily = true;
          if (modalSelectedFamily) {
            const familyClasses = CLASS_FAMILIES[modalSelectedFamily].classes;
            matchesClassFamily = familyClasses.includes(player.role);
          }

          // Hide cleared filter - respect Next Week mode
          let matchesCompletion = true;
          if (hideCleared && !this.nextWeekMode) {
            matchesCompletion = dataService.playerNeedsRaid(player, this.currentLineup.raidType);
          }

          return matchesSearch && matchesClass && matchesClassFamily && matchesCompletion;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const playerList = document.getElementById('modal-player-list');

      // Add Guest card at the top
      const addGuestCard = `
        <div class="player-option add-guest-option" id="modal-add-guest">
          <div class="player-info">
            <div class="player-name">➕ Add Guest</div>
            <div class="player-role">Guest character</div>
          </div>
        </div>
      `;

      playerList.innerHTML = addGuestCard + filteredPlayers.map(player => {
        const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
        const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);
        // In Next Week mode, treat all players as needing the raid
        const needsThisRaid = this.nextWeekMode ? true : dataService.playerNeedsRaid(player, this.currentLineup.raidType);

        const equipmentDisplay = [];
        if (player.weapon) {
          const weaponText = `${weaponRarity?.label || player.weapon}${player.weaponEnhance ? ' +' + player.weaponEnhance : ''}`;
          equipmentDisplay.push(`<span class="equipment-item" style="color: ${weaponRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.weapon} ${weaponText}</span>`);
        }
        if (player.armor) {
          const armorText = `${armorRarity?.label || player.armor}${player.armorEnhance ? ' +' + player.armorEnhance : ''}`;
          equipmentDisplay.push(`<span class="equipment-item" style="color: ${armorRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.armor} ${armorText}</span>`);
        }

        const suffixDisplay = [];
        if (player.suffix1) {
          const suffix1Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
          suffixDisplay.push(suffix1Obj?.label || player.suffix1);
        }
        if (player.suffix2) {
          const suffix2Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
          suffixDisplay.push(suffix2Obj?.label || player.suffix2);
        }

        return `
          <div class="player-option ${!needsThisRaid ? 'completed' : ''}" data-player-name="${player.name}">
            ${!needsThisRaid ? `<span class="completion-badge" title="Already completed ${this.currentLineup.raidType} this week">✓</span>` : ''}
            <div class="player-info">
              <div class="player-name">${player.name}</div>
              <div class="player-role">${player.role}</div>
              ${equipmentDisplay.length > 0 ? `<div class="player-equipment">${equipmentDisplay.join(' ')}</div>` : ''}
              ${suffixDisplay.length > 0 ? `<div class="player-suffixes">Suffix: ${suffixDisplay.join(' + ')}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');

      // Re-attach click handlers
      playerList.querySelectorAll('.player-option').forEach(option => {
        option.addEventListener('click', () => {
          const playerName = option.dataset.playerName;
          // Check if player is already in another slot and remove them first
          const existingSlotIndex = this.currentLineup.players.findIndex(p => p === playerName);
          if (existingSlotIndex !== -1 && existingSlotIndex !== slotIndex) {
            this.removePlayerFromSlot(existingSlotIndex);
          }
          this.assignPlayerToSlot(slotIndex, playerName);
          document.body.removeChild(modalElement);
        });
      });

      // Add handler for Add Guest option
      const addGuestOption = document.getElementById('modal-add-guest');
      if (addGuestOption) {
        addGuestOption.addEventListener('click', () => {
          document.body.removeChild(modalElement);
          this.showPubCharacterModal(slotIndex);
        });
      }
    };

    // Initial render
    renderModalPlayers();

    // Attach filter event listeners
    document.getElementById('modal-player-search').addEventListener('input', renderModalPlayers);

    document.getElementById('modal-class-filter').addEventListener('change', (e) => {
      if (e.target.value) {
        modalSelectedFamily = null;
        modalElement.querySelectorAll('.class-family-btn').forEach(btn => btn.classList.remove('active'));
      }
      renderModalPlayers();
    });

    document.getElementById('modal-hide-cleared-checkbox').addEventListener('change', renderModalPlayers);

    // Class family filter buttons
    modalElement.querySelectorAll('.class-family-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const family = btn.dataset.family;

        if (modalSelectedFamily === family) {
          modalSelectedFamily = null;
          btn.classList.remove('active');
        } else {
          modalElement.querySelectorAll('.class-family-btn').forEach(b => b.classList.remove('active'));
          modalSelectedFamily = family;
          btn.classList.add('active');
          document.getElementById('modal-class-filter').value = '';
        }

        renderModalPlayers();
      });
    });

    document.getElementById('remove-player-btn').addEventListener('click', () => {
      this.removePlayerFromSlot(slotIndex);
      document.body.removeChild(modalElement);
    });

    document.getElementById('cancel-selector-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  setupAddPubHandler() {
    const addPubCard = document.querySelector('.add-pub-card');
    if (!addPubCard) return;

    // Handle double-click on "Add Guest" card
    addPubCard.addEventListener('dblclick', () => {
      // Find first empty slot
      const emptySlotIndex = this.currentLineup.players.findIndex((p, idx) => !p || p === '');
      if (emptySlotIndex !== -1) {
        this.showPubCharacterModal(emptySlotIndex);
      } else {
        toast.error('All slots are full! Remove a player first.');
      }
    });
  },

  showPubCharacterModal(slotIndex) {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';

    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Add Guest Character to Slot ${slotIndex + 1}</h2>
        <form id="pub-character-form">
          <div class="form-group">
            <label for="pub-name">Character Name:</label>
            <input type="text" id="pub-name" placeholder="Leave empty for placeholder">
          </div>
          <div class="form-group">
            <label for="pub-class">Class: *</label>
            <select id="pub-class" required>
              <option value="">Select a class...</option>
              ${CLASSES.map(cls => `<option value="${cls}">${cls}</option>`).join('')}
            </select>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary">Add to Lineup</button>
            <button type="button" id="cancel-pub-btn" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    const form = document.getElementById('pub-character-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('pub-name').value.trim();
      const role = document.getElementById('pub-class').value;

      if (!role) {
        toast.error('Please select a class');
        return;
      }

      this.assignPubPlayerToSlot(slotIndex, name, role);
      document.body.removeChild(modalElement);
    });

    document.getElementById('cancel-pub-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  showPilotModal(slotIndex) {
    const playerName = this.currentLineup.players[slotIndex];
    const currentPilot = this.currentLineup.pilotSlots[slotIndex] || '';

    const modalElement = document.createElement('div');
    modalElement.className = 'modal';

    modalElement.innerHTML = `
      <div class="modal-content pilot-modal">
        <h2>Set Pilot for ${playerName}</h2>
        <p class="pilot-modal-desc">Who will use this character?:</p>
        <form id="pilot-form">
          <div class="form-group">
            <input type="text" id="pilot-name-input" placeholder="Pilot's name..." value="${currentPilot}">
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" id="clear-pilot-btn" class="btn btn-secondary">Clear</button>
            <button type="button" id="cancel-pilot-btn" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    // Focus the input
    const input = document.getElementById('pilot-name-input');
    input.focus();
    input.select();

    const form = document.getElementById('pilot-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pilotName = input.value.trim();
      this.currentLineup.pilotSlots[slotIndex] = pilotName;
      // Re-render the slot to update display
      this.assignPlayerToSlot(slotIndex, playerName);
      document.body.removeChild(modalElement);
    });

    document.getElementById('clear-pilot-btn').addEventListener('click', () => {
      this.currentLineup.pilotSlots[slotIndex] = '';
      // Re-render the slot to update display
      this.assignPlayerToSlot(slotIndex, playerName);
      document.body.removeChild(modalElement);
    });

    document.getElementById('cancel-pilot-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  assignPubPlayerToSlot(slotIndex, name, role) {
    // Store guest character with special format: [PUB]Name|Class
    const pubPlayerString = `[PUB]${name}|${role}`;
    this.currentLineup.players[slotIndex] = pubPlayerString;

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    const slotContent = slotElement.querySelector('.slot-content');

    // Get current ticket status for this slot (only show for Classic raid)
    const hasTicket = this.currentLineup.ticketSlots[slotIndex];
    const showTicketToggle = this.currentLineup.raidType === 'Classic';

    // If no name provided, display the class name as the name
    const displayName = name || role;

    slotContent.innerHTML = `
      <div class="assigned-player pub-player">
        <div class="player-name">${displayName} <span class="pub-badge">GUEST</span></div>
        ${name ? `<div class="player-role">${role}</div>` : ''}
      </div>
      ${showTicketToggle ? `
        <label class="ticket-toggle" title="Using ticket run">
          <input type="checkbox" class="ticket-checkbox" data-slot="${slotIndex}" ${hasTicket ? 'checked' : ''}>
          <img src="/icons/ticket.svg" alt="Ticket" class="ticket-toggle-icon ${hasTicket ? 'active' : ''}">
        </label>
      ` : ''}
    `;

    // Add ticket checkbox handler (only if shown)
    if (showTicketToggle) {
      const ticketToggle = slotContent.querySelector('.ticket-toggle');
      if (ticketToggle) {
        // Stop click from bubbling to slot (which opens modal)
        ticketToggle.addEventListener('click', (e) => {
          e.stopPropagation();
        });
      }

      const ticketCheckbox = slotContent.querySelector('.ticket-checkbox');
      if (ticketCheckbox) {
        ticketCheckbox.addEventListener('change', (e) => {
          e.stopPropagation();
          this.currentLineup.ticketSlots[slotIndex] = e.target.checked;
          const icon = slotContent.querySelector('.ticket-toggle-icon');
          if (icon) {
            icon.classList.toggle('active', e.target.checked);
          }
        });
      }
    }

    // Add remove button to slot
    let removeBtn = slotElement.querySelector('.slot-remove-btn');
    if (!removeBtn) {
      removeBtn = document.createElement('button');
      removeBtn.className = 'slot-remove-btn';
      removeBtn.title = 'Remove player';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removePlayerFromSlot(slotIndex);
      });
      slotElement.appendChild(removeBtn);
    }

    // Apply warning stripe background style to the whole slot card
    slotElement.style.cssText = 'background: repeating-linear-gradient(45deg, rgba(255, 193, 7, 0.11), rgba(255, 193, 7, 0.15) 10px, rgba(0, 0, 0, 0.6) 10px, rgba(0, 0, 0, 0.6) 20px) !important; border: 2px dashed rgba(255, 193, 7, 0.5) !important; border-radius: 8px;';

    // Remove slot-content border/background so it doesn't create inner rectangle
    slotContent.style.cssText = 'border: none; background: transparent;';

    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();
  },

  assignPlayerToSlot(slotIndex, playerName) {
    // Check if this is a guest character
    if (playerName.startsWith('[PUB]')) {
      const parts = playerName.substring(5).split('|');
      const name = parts[0];
      const role = parts[1];
      this.assignPubPlayerToSlot(slotIndex, name, role);
      return;
    }

    const player = this.players.find(p => p.name === playerName);
    this.currentLineup.players[slotIndex] = playerName;

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    const slotContent = slotElement.querySelector('.slot-content');

    const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
    const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

    const equipmentDisplay = [];
    if (player.weapon) {
      const weaponText = `${weaponRarity?.label || player.weapon}${player.weaponEnhance ? ' +' + player.weaponEnhance : ''}`;
      equipmentDisplay.push(`<span class="equipment-item" style="color: ${weaponRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.weapon} ${weaponText}</span>`);
    }
    if (player.armor) {
      const armorText = `${armorRarity?.label || player.armor}${player.armorEnhance ? ' +' + player.armorEnhance : ''}`;
      equipmentDisplay.push(`<span class="equipment-item" style="color: ${armorRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.armor} ${armorText}</span>`);
    }

    const suffixDisplay = [];
    if (player.suffix1) {
      const suffix1Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
      suffixDisplay.push(suffix1Obj?.label || player.suffix1);
    }
    if (player.suffix2) {
      const suffix2Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
      suffixDisplay.push(suffix2Obj?.label || player.suffix2);
    }

    // Get current ticket status for this slot (only show for Classic raid)
    const hasTicket = this.currentLineup.ticketSlots[slotIndex];
    const showTicketToggle = this.currentLineup.raidType === 'Classic';

    // Get current pilot for this slot
    const pilotName = this.currentLineup.pilotSlots[slotIndex] || '';
    const pilotDisplay = pilotName ? `<span class="pilot-info"><img src="/icons/headphones.svg" alt="Pilot" class="pilot-info-icon">${pilotName}</span>` : '';

    slotContent.innerHTML = `
      <div class="assigned-player">
        <div class="player-name">${player.name}</div>
        ${pilotDisplay}
        <div class="player-role">${player.role}</div>
        ${equipmentDisplay.length > 0 ? `<div class="player-equipment-compact">${equipmentDisplay.join(' ')}</div>` : ''}
        ${suffixDisplay.length > 0 ? `<div class="player-suffixes">Suffix: ${suffixDisplay.join(' + ')}</div>` : ''}
      </div>
      <div class="slot-toggles">
        ${showTicketToggle ? `
          <label class="ticket-toggle" title="Using ticket run">
            <input type="checkbox" class="ticket-checkbox" data-slot="${slotIndex}" ${hasTicket ? 'checked' : ''}>
            <img src="/icons/ticket.svg" alt="Ticket" class="ticket-toggle-icon ${hasTicket ? 'active' : ''}">
          </label>
        ` : ''}
        <button class="pilot-btn ${pilotName ? 'active' : ''}" data-slot="${slotIndex}" title="${pilotName ? `Piloted by: ${pilotName}` : 'Set pilot'}">
          <img src="/icons/headphones.svg" alt="Pilot" class="pilot-icon">
        </button>
      </div>
    `;

    // Add ticket checkbox handler (only if shown)
    if (showTicketToggle) {
      const ticketToggle = slotContent.querySelector('.ticket-toggle');
      if (ticketToggle) {
        // Stop click from bubbling to slot (which opens modal)
        ticketToggle.addEventListener('click', (e) => {
          e.stopPropagation();
        });
      }

      const ticketCheckbox = slotContent.querySelector('.ticket-checkbox');
      if (ticketCheckbox) {
        ticketCheckbox.addEventListener('change', (e) => {
          e.stopPropagation();
          this.currentLineup.ticketSlots[slotIndex] = e.target.checked;
          const icon = slotContent.querySelector('.ticket-toggle-icon');
          if (icon) {
            icon.classList.toggle('active', e.target.checked);
          }
        });
      }
    }

    // Add pilot button handler
    const pilotBtn = slotContent.querySelector('.pilot-btn');
    if (pilotBtn) {
      pilotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showPilotModal(slotIndex);
      });
    }

    // Add remove button to slot (not inside slot-content)
    let removeBtn = slotElement.querySelector('.slot-remove-btn');
    if (!removeBtn) {
      removeBtn = document.createElement('button');
      removeBtn.className = 'slot-remove-btn';
      removeBtn.title = 'Remove player';
      removeBtn.innerHTML = '×';
      slotElement.appendChild(removeBtn);
    }

    // Add event listener for remove button
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      this.removePlayerFromSlot(slotIndex);
    };

    const backgroundStyle = this.getEquipmentBackground(player);
    if (backgroundStyle) {
      slotElement.style.cssText = backgroundStyle;
    } else {
      slotElement.style.cssText = '';
    }

    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();
  },

  removePlayerFromSlot(slotIndex) {
    this.currentLineup.players[slotIndex] = null;
    this.currentLineup.ticketSlots[slotIndex] = false; // Clear ticket status
    this.currentLineup.pilotSlots[slotIndex] = ''; // Clear pilot

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    const slotContent = slotElement.querySelector('.slot-content');

    slotContent.innerHTML = '<div class="empty-slot">Drop or click</div>';

    // Remove the remove button
    const removeBtn = slotElement.querySelector('.slot-remove-btn');
    if (removeBtn) {
      removeBtn.remove();
    }

    // Clear both slot and slot-content styles (for guest character cleanup)
    slotElement.style.cssText = '';
    slotContent.style.cssText = '';

    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();
  },

  reRenderLineupSlots() {
    // Re-render all assigned players to update ticket/pilot toggles based on raid type
    this.currentLineup.players.forEach((playerName, idx) => {
      if (playerName) {
        this.assignPlayerToSlot(idx, playerName);
      }
    });
  },

  async clearLineup() {
    const confirmed = await modal.confirm(
      'Clear confirmation.',
      {
        title: 'Clear Lineup',
        confirmText: 'Clear All',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) return;

    // Preserve the current raid type when clearing
    const currentRaidType = this.currentLineup.raidType;

    this.currentLineup = {
      name: '',
      raidType: currentRaidType,
      status: 'ready',
      players: [],
      ticketSlots: Array(8).fill(false),
      pilotSlots: Array(8).fill(''),
      completed: false,
      isTemplate: false,
      notes: ''
    };

    // Clear the lineup name input field and trigger input event to sync state
    const lineupNameInput = document.getElementById('lineup-name');
    lineupNameInput.value = '';
    lineupNameInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById('raid-type').value = currentRaidType;
    document.getElementById('cleared-toggle').checked = false;
    document.getElementById('template-toggle').checked = false;
    document.getElementById('lineup-notes').value = '';

    document.querySelectorAll('.slot').forEach(slotElement => {
      const slotContent = slotElement.querySelector('.slot-content');
      slotContent.innerHTML = '<div class="empty-slot">Drop or click</div>';
      // Remove any remove buttons
      const removeBtn = slotElement.querySelector('.slot-remove-btn');
      if (removeBtn) {
        removeBtn.remove();
      }
      // Clear both slot and slot-content styles (for guest character cleanup)
      slotElement.style.cssText = '';
      slotContent.style.cssText = '';
    });

    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();
    toast.success('Lineup cleared! Enter a new name to save as a new lineup.');
  },

  async saveLineup() {
    if (!this.currentLineup.name || !this.currentLineup.name.trim()) {
      toast.warning('Lineup name po');
      return;
    }

    const filledSlots = this.currentLineup.players.filter(p => p).length;

    if (filledSlots === 0) {
      toast.warning('??? Save mo na walang tao?');
      return;
    }

    if (!dataService.hasWriteAccess()) {
      toast.warning(`Write access not configured. Please add lineup manually to Google Sheet (${filledSlots}/8 players) or configure Apps Script URL.`, 5000);
      return;
    }

    try {
      const saveBtn = document.getElementById('save-lineup-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      // Build players array with [T] and [P:PilotName] suffixes
      const players = Array(8).fill('').map((_, idx) => {
        const playerName = this.currentLineup.players[idx] || '';
        if (!playerName) return '';
        let result = playerName;
        // Append [T] suffix if using ticket
        if (this.currentLineup.ticketSlots[idx]) {
          result += '[T]';
        }
        // Append [P:PilotName] suffix if pilot is set (only for non-guest players)
        const pilotName = this.currentLineup.pilotSlots[idx];
        if (pilotName && !playerName.startsWith('[PUB]')) {
          result += `[P:${pilotName}]`;
        }
        return result;
      });

      // Check if lineup with this name already exists
      const existingLineups = await dataService.getLineups();
      const trimmedName = this.currentLineup.name.trim();
      const existingLineup = existingLineups.find(l => l.name.trim() === trimmedName && (l.raidType || 'Hardcore') === this.currentLineup.raidType);

      if (existingLineup) {
        // Confirm before updating existing lineup
        const confirmed = await modal.confirm(
          `Overwrite "${this.currentLineup.name}" lineup?`,
          {
            title: 'Update Lineup',
            confirmText: 'Update',
            cancelText: 'Cancel',
            danger: false
          }
        );

        if (!confirmed) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Lineup';
          return;
        }

        // Check if we're unchecking a previously cleared lineup
        const wasCleared = existingLineup.completed;
        const isNowCleared = this.currentLineup.completed;

        console.log('Clear check:', { wasCleared, isNowCleared, lineupName: trimmedName });

        // Update existing lineup - use the actual name from the sheet as oldName
        await dataService.updateLineup({
          name: trimmedName,
          raidType: this.currentLineup.raidType,
          status: 'ready',
          players,
          completed: this.currentLineup.completed,
          isTemplate: this.currentLineup.isTemplate,
          notes: this.currentLineup.notes
        }, existingLineup.name);
        toast.success(`${trimmedName} updated!`);

        // Handle player completion status changes
        // Extract ticket players (those with [T] suffix) and strip suffix for marking
        const nonGuestPlayers = players.filter(p => p && !p.startsWith('[PUB]'));
        const ticketPlayerNames = nonGuestPlayers
          .filter(p => p.endsWith('[T]'))
          .map(p => p.slice(0, -3));
        const playerNames = nonGuestPlayers
          .map(p => p.endsWith('[T]') ? p.slice(0, -3) : p);

        if (wasCleared && !isNowCleared && playerNames.length > 0) {
          // Lineup was cleared but now unchecked - unmark players
          // Use ORIGINAL ticket info from existingLineup, not current UI state
          const originalTicketPlayerNames = existingLineup.ticketPlayers
            ? existingLineup.players
                .filter((p, idx) => p && !p.startsWith('[PUB]') && existingLineup.ticketPlayers[idx])
                .map(p => p) // These are already clean names without [T]
            : [];
          console.log('Unmarking:', playerNames, 'original tickets:', originalTicketPlayerNames, 'for:', this.currentLineup.raidType);
          try {
            const result = await dataService.unmarkPlayersCompleted(playerNames, this.currentLineup.raidType, trimmedName, originalTicketPlayerNames);
            console.log(`Unmark result:`, result);
            console.log(`Unmarked players for ${this.currentLineup.raidType} (lineup unchecked)`);
          } catch (error) {
            console.error('Error unmarking players:', error);
            toast.warning('Saved pero may nangyari sa unmark? Refresh nalang dong');
          }
        } else if (!wasCleared && isNowCleared && playerNames.length > 0) {
          // Lineup was not cleared but now checked - mark players
          try {
            await dataService.markPlayersCompleted(playerNames, this.currentLineup.raidType, ticketPlayerNames);
            console.log(`Cleared ${playerNames.length} players for ${this.currentLineup.raidType}, ${ticketPlayerNames.length} tickets used`);
          } catch (error) {
            console.error('Error marking players as completed:', error);
            toast.warning('Saved pero may nangyari sa mark? Refresh nalang dong');
          }
        } else if (isNowCleared && playerNames.length > 0) {
          // Lineup is still cleared, but players may have changed - mark all players
          try {
            await dataService.markPlayersCompleted(playerNames, this.currentLineup.raidType, ticketPlayerNames);
            console.log(`Cleared ${playerNames.length} players for ${this.currentLineup.raidType}, ${ticketPlayerNames.length} tickets used`);
          } catch (error) {
            console.error('Error marking players as completed:', error);
            toast.warning('Saved pero may nangyari sa mark? Refresh nalang dong');
          }
        }
      } else {
        // Add new lineup
        await dataService.addLineup({
          name: trimmedName,
          raidType: this.currentLineup.raidType,
          status: 'ready',
          players,
          completed: this.currentLineup.completed,
          isTemplate: this.currentLineup.isTemplate,
          notes: this.currentLineup.notes
        });
        toast.success(`${trimmedName} saved!`);

        // If the lineup is marked as cleared, mark all players as completed for this raid type
        if (this.currentLineup.completed) {
          // Get only non-guest players (exclude [PUB] entries), extract ticket players
          const nonGuestPlayers = players.filter(p => p && !p.startsWith('[PUB]'));
          const ticketPlayerNames = nonGuestPlayers
            .filter(p => p.endsWith('[T]'))
            .map(p => p.slice(0, -3));
          const playerNames = nonGuestPlayers
            .map(p => p.endsWith('[T]') ? p.slice(0, -3) : p);

          if (playerNames.length > 0) {
            try {
              await dataService.markPlayersCompleted(playerNames, this.currentLineup.raidType, ticketPlayerNames);
              console.log(`Cleared ${playerNames.length} players for ${this.currentLineup.raidType}, ${ticketPlayerNames.length} tickets used`);
            } catch (error) {
              console.error('Error marking players as completed:', error);
              toast.warning('Saved pero may nangyari? Refresh nalang dong');
            }
          }
        }
      }

      // Refresh player list to show updated completion status and "in lineup" badges
      this.players = await dataService.getPlayers();
      this.renderAvailablePlayers();

      // Refresh the lineup carousel
      this.loadExistingLineups();

      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    } catch (error) {
      toast.error(`Error dong: ${error.message}`);
      const saveBtn = document.getElementById('save-lineup-btn');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    }
  },

  async deleteLineup(lineupName, raidType) {
    const confirmed = await modal.confirm(
      `Delete lineup ${lineupName}?`,
      {
        title: 'Delete Lineup',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) return;

    try {
      await dataService.deleteLineup(lineupName, raidType);
      toast.success(`GG wala nang ${lineupName}!`);
      this.loadExistingLineups(); // Refresh the lineup list
    } catch (error) {
      toast.error(`HOY ano yan bat may error: ${error.message}`);
    }
  },

  loadLineup(lineup) {
    // Build ticketSlots array from lineup.ticketPlayers (if present)
    const ticketSlots = Array(8).fill(false);
    if (lineup.ticketPlayers) {
      lineup.ticketPlayers.forEach((hasTicket, idx) => {
        if (idx < 8) ticketSlots[idx] = hasTicket;
      });
    }

    // Build pilotSlots array from lineup.pilotPlayers (if present)
    const pilotSlots = Array(8).fill('');
    if (lineup.pilotPlayers) {
      lineup.pilotPlayers.forEach((pilotName, idx) => {
        if (idx < 8) pilotSlots[idx] = pilotName || '';
      });
    }

    this.currentLineup = {
      name: lineup.name,
      raidType: lineup.raidType || 'Hardcore',
      status: 'ready',
      players: [...lineup.players],
      ticketSlots,
      pilotSlots,
      completed: lineup.completed || false,
      isTemplate: lineup.isTemplate || false,
      notes: lineup.notes || ''
    };

    document.getElementById('lineup-name').value = lineup.name;
    document.getElementById('raid-type').value = lineup.raidType || 'Hardcore';
    document.getElementById('cleared-toggle').checked = lineup.completed || false;
    document.getElementById('template-toggle').checked = lineup.isTemplate || false;
    document.getElementById('lineup-notes').value = lineup.notes || '';
    // Don't change Next Week mode when loading a lineup - let user control it

    document.querySelectorAll('.slot').forEach(slotElement => {
      const slotContent = slotElement.querySelector('.slot-content');
      slotContent.innerHTML = '<div class="empty-slot">Drop or click</div>';
      // Remove any remove buttons
      const removeBtn = slotElement.querySelector('.slot-remove-btn');
      if (removeBtn) {
        removeBtn.remove();
      }
      // Clear both slot and slot-content styles (for guest character cleanup)
      slotElement.style.cssText = '';
      slotContent.style.cssText = '';
    });

    // Assign players
    lineup.players.forEach((playerName, idx) => {
      if (playerName && idx < 8) {
        // Check if it's a guest player or a regular player
        if (playerName.startsWith('[PUB]')) {
          // Guest player - assign directly
          this.assignPlayerToSlot(idx, playerName);
        } else {
          // Regular player - check if it exists
          const player = this.players.find(p => p.name === playerName);
          if (player) {
            this.assignPlayerToSlot(idx, playerName);
          }
        }
      }
    });

    this.updateDamageAmpDisplay();
  },

  setupPlayerDragHandlers() {
    const playerCards = document.querySelectorAll('.player-card');

    playerCards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', card.dataset.playerName);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', (e) => {
        card.classList.remove('dragging');
      });

      card.addEventListener('dblclick', (e) => {
        const playerName = card.dataset.playerName;

        // Check if player is already in a slot
        const existingSlotIndex = this.currentLineup.players.findIndex(p => p === playerName);
        if (existingSlotIndex !== -1) {
          toast.warning(`${playerName} is already in slot ${existingSlotIndex + 1}`);
          return;
        }

        // Find first empty slot
        let firstEmptySlot = -1;
        for (let i = 0; i < 8; i++) {
          if (!this.currentLineup.players[i]) {
            firstEmptySlot = i;
            break;
          }
        }

        if (firstEmptySlot !== -1) {
          this.assignPlayerToSlot(firstEmptySlot, playerName);
          toast.success(`Added ${playerName} to slot ${firstEmptySlot + 1}`);
        } else {
          toast.warning('Full na po!');
        }
      });
    });
  },

  setupDragAndDrop() {
    const slots = document.querySelectorAll('.slot');

    slots.forEach(slot => {
      // Update draggable attribute based on whether slot is filled
      const updateDraggable = () => {
        const slotIndex = parseInt(slot.dataset.slot);
        if (this.currentLineup.players[slotIndex]) {
          slot.setAttribute('draggable', 'true');
        } else {
          slot.removeAttribute('draggable');
        }
      };

      // Check on mouse enter
      slot.addEventListener('mouseenter', updateDraggable);

      slot.addEventListener('dragstart', (e) => {
        const slotIndex = parseInt(slot.dataset.slot);
        const playerName = this.currentLineup.players[slotIndex];

        if (playerName) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', playerName);
          e.dataTransfer.setData('sourceSlot', slotIndex.toString());
          slot.classList.add('dragging');
        } else {
          e.preventDefault();
        }
      });

      slot.addEventListener('dragend', (e) => {
        slot.classList.remove('dragging');
        updateDraggable(); // Update draggable state after drag ends
      });

      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        const sourceSlot = e.dataTransfer.getData('sourceSlot');
        e.dataTransfer.dropEffect = sourceSlot ? 'move' : 'copy';
        slot.classList.add('drag-over');
      });

      slot.addEventListener('dragleave', (e) => {
        slot.classList.remove('drag-over');
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');

        const playerName = e.dataTransfer.getData('text/plain');
        const sourceSlotIndex = e.dataTransfer.getData('sourceSlot');
        const targetSlotIndex = parseInt(slot.dataset.slot);

        if (sourceSlotIndex !== '') {
          // Dragging from slot to slot - swap or move
          const sourceIndex = parseInt(sourceSlotIndex);
          const targetPlayerName = this.currentLineup.players[targetSlotIndex];

          // Swap ticket status along with players
          const sourceTicket = this.currentLineup.ticketSlots[sourceIndex];
          const targetTicket = this.currentLineup.ticketSlots[targetSlotIndex];

          // Swap pilot status along with players
          const sourcePilot = this.currentLineup.pilotSlots[sourceIndex];
          const targetPilot = this.currentLineup.pilotSlots[targetSlotIndex];

          // Swap players
          this.currentLineup.players[targetSlotIndex] = playerName;
          this.currentLineup.players[sourceIndex] = targetPlayerName || undefined;

          // Swap ticket status
          this.currentLineup.ticketSlots[targetSlotIndex] = sourceTicket;
          this.currentLineup.ticketSlots[sourceIndex] = targetPlayerName ? targetTicket : false;

          // Swap pilot status
          this.currentLineup.pilotSlots[targetSlotIndex] = sourcePilot;
          this.currentLineup.pilotSlots[sourceIndex] = targetPlayerName ? targetPilot : '';

          // Re-render both slots
          if (targetPlayerName) {
            this.assignPlayerToSlot(sourceIndex, targetPlayerName);
          } else {
            this.removePlayerFromSlot(sourceIndex);
          }
          this.assignPlayerToSlot(targetSlotIndex, playerName);
        } else if (playerName) {
          // Dragging from player list to slot
          if (playerName === '[ADD_PUB]') {
            // Show guest character modal instead of assigning
            this.showPubCharacterModal(targetSlotIndex);
          } else {
            // Check if player is already in another slot and remove them first
            const existingSlotIndex = this.currentLineup.players.findIndex(p => p === playerName);
            if (existingSlotIndex !== -1 && existingSlotIndex !== targetSlotIndex) {
              this.removePlayerFromSlot(existingSlotIndex);
            }
            this.assignPlayerToSlot(targetSlotIndex, playerName);
            toast.success(`Assigned ${playerName} to slot ${targetSlotIndex + 1}`);
          }
        }
      });
    });
  }
};

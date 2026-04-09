import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS, WEAPON_SUFFIXES, CLASS_FAMILIES, DAMAGE_AMP_SOURCES, formatEquipmentText, formatPlayerEquipmentHtml, calculateGearscore, getGearscoreTier, getClassSpriteStyle } from '../constants.js';
import { showLineupCreatorModal } from '../modals/lineupcreatormodal.jsx';
import { modal } from '../modal.js';
import moment from 'moment';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';

export const LineupEditorPage = {
  players: [],
  allLineups: [],
  currentLineup: {
    id: null, // UUID from database (null for new unsaved lineups)
    name: '',
    raidType: 'Hardcore',
    status: 'ready',
    players: [],
    ticketSlots: Array(8).fill(false), // Track ticket usage per slot
    pilotSlots: Array(8).fill(''), // Track pilot names per slot (empty string if no pilot)
    completed: false,
    isNextWeek: false,
    notes: '',
    raidTime: null // Scheduled raid time (ISO string)
  },
  selectedClassFamily: null,
  expandedClassFamily: null,
  selectedSpecialization: null,
  selectedFinalClass: null,
  showCarouselLineups: true,
  showCarouselNextWeek: false,
  lineupSubscription: null, // Supabase realtime subscription
  presenceChannel: null, // Presence channel for showing who's viewing
  viewingUsers: [], // Other users currently viewing this page
  pendingDeleteId: null, // Track lineup being deleted by current user to skip self-notification
  flatpickrInstance: null, // Flatpickr date/time picker instance

  async render(container) {
    const isAdmin = dataService.isAdmin();

    // Reset state when re-entering the page (singleton object persists across navigations)
    this.currentLineup = {
      id: null,
      name: '',
      raidType: 'Hardcore',
      status: 'ready',
      players: [],
      ticketSlots: Array(8).fill(false),
      pilotSlots: Array(8).fill(''),
      completed: false,
      isNextWeek: false,
      notes: '',
      raidTime: null
    };
    this.selectedClassFamily = null;
    this.expandedClassFamily = null;
    this.selectedSpecialization = null;
    this.selectedFinalClass = null;
    this.viewingUsers = [];

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
                    <option value="Unspecified">Unspecified</option>
                  </select>
                </div>
                <div class="form-group lineup-name-group">
                  <label for="lineup-name">Lineup Name:</label>
                  <input type="text" id="lineup-name" placeholder="Enter lineup name...">
                </div>
              </div>
              <div class="lineup-toggles">
                <label class="next-week-toggle-label">
                  <input type="checkbox" id="next-week-toggle">
                  <span>Next Week</span>
                </label>
              </div>
            </div>
            <div class="lineup-info-right">
              <div class="form-group lineup-time-group">
                <label>Scheduled Time:</label>
                <div class="raid-time-box" id="raid-time-box">
                  <img src="/icons/calendarclock.svg" alt="" class="raid-time-box-icon">
                  <span class="raid-time-value" id="raid-time-display">Click to set time</span>
                  <button type="button" class="raid-time-clear" id="raid-time-clear" title="Clear time">×</button>
                </div>
              </div>
              <div class="form-group lineup-notes-group">
                <label for="lineup-notes">Notes:</label>
                <textarea id="lineup-notes" placeholder="Add notes for this lineup..." rows="2"></textarea>
              </div>
            </div>
          </div>

          <div class="editor-main">
            <div class="lineup-slots">
              <div class="lineup-slots-header">
                <div class="lineup-slots-header-left">
                  <h3>Lineup</h3>
                  <button id="generate-lineup-btn" class="btn btn-ghost whos-around-btn">Generate Lineup</button>
                  <button id="scan-lineup-btn" class="btn btn-ghost whos-around-btn">Lineup Screenshot</button>
                </div>
                <div id="presence-indicator" class="presence-indicator"></div>
              </div>
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
                <div class="lineup-actions-primary">
                  ${isAdmin ? `<span class="action-side">
                    <button id="save-lineup-btn" class="btn btn-primary">Save Lineup</button>
                  </span>
                  <span class="action-side">
                    <label class="toggle-cleared">
                      <input type="checkbox" id="cleared-toggle">
                      <span>Cleared</span>
                    </label>
                  </span>` : ''}
                </div>
                <div class="lineup-actions-secondary">
                  <span class="action-side">
                    <button id="clear-slots-btn" class="btn btn-ghost">Clear Slots</button>
                  </span>
                  <span class="actions-divider"></span>
                  <span class="action-side">
                    <button id="new-lineup-btn" class="btn btn-ghost">New Lineup</button>
                  </span>
                </div>
              </div>
              <div class="existing-lineups-section">
                <div class="carousel-tabs">
                  <button class="carousel-tab active" data-tab="lineups" id="carousel-tab-lineups">Lineups</button>
                  <button class="carousel-tab" data-tab="next-week" id="carousel-tab-next-week">Next Week</button>
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
              </div>
              <div class="class-family-filter">
                ${Object.entries(CLASS_FAMILIES).map(([key, family]) => `
                  <button class="class-family-btn" data-family="${key}" title="${family.name}">
                    <div class="class-sprite" style="${getClassSpriteStyle(family.name)}"></div>
                  </button>
                `).join('')}
              </div>
              <div class="specialization-filter" id="specialization-filter"></div>
              <div class="final-class-filter" id="final-class-filter"></div>
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
    this.updateRaidTimeDisplay();
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

    // Raid time picker - initialize flatpickr
    this.flatpickrInstance = flatpickr('#raid-time-box', {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      time_24hr: false,
      defaultDate: this.currentLineup.raidTime ? new Date(this.currentLineup.raidTime) : null,
      onChange: (selectedDates) => {
        if (selectedDates.length > 0) {
          this.currentLineup.raidTime = selectedDates[0].toISOString();
          this.updateRaidTimeDisplay();
        }
      }
    });

    document.getElementById('raid-time-clear').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.currentLineup.raidTime = null;
      this.flatpickrInstance.clear();
      this.updateRaidTimeDisplay();
    });

    document.getElementById('cleared-toggle')?.addEventListener('change', (e) => {
      this.currentLineup.completed = e.target.checked;
    });

    document.getElementById('next-week-toggle').addEventListener('change', (e) => {
      this.currentLineup.isNextWeek = e.target.checked;
      this.renderAvailablePlayers(); // Re-render to show/hide cleared players
    });

    // Carousel tab handlers (toggleable - both can be active)
    document.getElementById('carousel-tab-lineups').addEventListener('click', (e) => {
      this.showCarouselLineups = !this.showCarouselLineups;
      e.target.classList.toggle('active', this.showCarouselLineups);
      // Ensure at least one is selected
      if (!this.showCarouselLineups && !this.showCarouselNextWeek) {
        this.showCarouselNextWeek = true;
        document.getElementById('carousel-tab-next-week').classList.add('active');
      }
      this.loadExistingLineups();
    });

    document.getElementById('carousel-tab-next-week').addEventListener('click', (e) => {
      this.showCarouselNextWeek = !this.showCarouselNextWeek;
      e.target.classList.toggle('active', this.showCarouselNextWeek);
      // Ensure at least one is selected
      if (!this.showCarouselLineups && !this.showCarouselNextWeek) {
        this.showCarouselLineups = true;
        document.getElementById('carousel-tab-lineups').classList.add('active');
      }
      this.loadExistingLineups();
    });

    document.querySelectorAll('.slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        const slotIndex = parseInt(e.currentTarget.dataset.slot);
        const playerName = this.currentLineup.players[slotIndex];
        // If slot has a guest with a class set, edit the guest instead
        if (playerName && playerName.startsWith('[PUB]')) {
          const parts = playerName.substring(5).split('|');
          const name = parts[0];
          const role = parts[1];
          if (role) {
            this.showEditGuestModal(slotIndex, name, role);
            return;
          }
        }
        this.showPlayerSelector(slotIndex);
      });
    });

    this.setupDragAndDrop();

    document.getElementById('player-search').addEventListener('input', () => {
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

        // If clicking the same family that's expanded
        if (this.expandedClassFamily === family) {
          // If a specialization is selected, deselect it but keep expanded
          if (this.selectedSpecialization) {
            this.selectedSpecialization = null;
            this.selectedFinalClass = null;
            this.selectedClassFamily = family;
            document.querySelectorAll('.specialization-btn').forEach(b => b.classList.remove('active'));
          } else if (this.selectedClassFamily === family) {
            // If base class was filtering, collapse everything
            this.expandedClassFamily = null;
            this.selectedClassFamily = null;
            this.selectedFinalClass = null;
            btn.classList.remove('active', 'expanded');
            this.renderSpecializations();
          } else {
            // Filter by base class
            this.selectedClassFamily = family;
            btn.classList.add('active');
          }
        } else {
          // Expanding a different family
          document.querySelectorAll('.class-family-btn').forEach(b => b.classList.remove('active', 'expanded'));
          this.expandedClassFamily = family;
          this.selectedClassFamily = family;
          this.selectedSpecialization = null;
          this.selectedFinalClass = null;
          btn.classList.add('active', 'expanded');
          this.renderSpecializations();
        }

        this.filterPlayers();
      });
    });

    document.getElementById('save-lineup-btn')?.addEventListener('click', () => {
      this.saveLineup();
    });

    document.getElementById('clear-slots-btn').addEventListener('click', () => {
      this.clearSlots();
    });

    document.getElementById('new-lineup-btn').addEventListener('click', () => {
      this.newLineup();
    });

    document.getElementById('generate-lineup-btn').addEventListener('click', () => {
      this.openLineupCreator();
    });

    document.getElementById('scan-lineup-btn').addEventListener('click', () => {
      this.showScanLineupModal();
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
      listElement.innerHTML = '<div class="error">Please configure Supabase first.</div>';
      return;
    }

    try {
      // Load both players and lineups
      [this.players, this.allLineups] = await Promise.all([
        dataService.getPlayers(),
        dataService.getLineups()
      ]);

      this.renderAvailablePlayers();
      this.loadExistingLineups();
      this.updateDamageAmpDisplay();

      // Setup realtime subscription (only once)
      this.setupRealtimeSubscription();
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
        const matchesFilter = (this.showCarouselLineups && !lineup.isNextWeek) ||
                              (this.showCarouselNextWeek && lineup.isNextWeek);
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
              ${player.role ? `<div class="class-sprite mini-card-class-bg" style="${getClassSpriteStyle(player.role)}"></div>` : ''}
              <div class="mini-player-info">
                <div class="mini-player-name">${player.name}${isPub ? ' <span class="pub-badge-mini">G</span>' : ''}</div>
                ${pilotDisplay}
                <div class="mini-player-role">${player.role}</div>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="mini-lineup-card ${isCleared ? 'cleared' : ''} ${lineup.isNextWeek ? 'next-week' : ''}" data-lineup-id="${lineup.id}">
            <div class="mini-lineup-header">
              <span class="mini-lineup-name">
                ${lineup.isNextWeek ? '<span class="next-week-badge-mini">NW</span>' : ''}
                ${lineup.name}
              </span>
              <div class="mini-lineup-header-actions">
                <span class="mini-lineup-raid-type">${lineup.raidType === 'Unspecified' ? 'Unspecified' : `GDN ${lineup.raidType || 'Hardcore'}`}</span>
                ${dataService.isAdmin() ? `<button class="mini-delete-btn" data-lineup-id="${lineup.id}" title="Delete lineup">×</button>` : ''}
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

          const lineupId = card.dataset.lineupId;
          const lineups = await dataService.getLineups();
          const lineup = lineups.find(l => l.id === lineupId);
          if (lineup) {
            this.loadLineup(lineup);
          }
        });
      });

      // Add delete button handlers
      container.querySelectorAll('.mini-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lineupId = btn.dataset.lineupId;
          await this.deleteLineup(lineupId);
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
      // Check completion status based on CURRENT lineup's raid type
      // In Next Week mode, treat all players as needing the raid (ignore current completion status)
      const needsThisRaid = this.currentLineup.isNextWeek ? true : dataService.playerNeedsRaid(player, this.currentLineup.raidType);

      // Check if player has already used their ticket this week (Classic only)
      const ticketUsed = this.currentLineup.isNextWeek ? false : dataService.playerTicketUsed(player, this.currentLineup.raidType);

      // Check if player is in another lineup (not the current one)
      // Don't show this in Next Week mode since current week assignments aren't relevant
      let presentInLineup = null;
      if (!this.currentLineup.isNextWeek && this.allLineups && this.allLineups.length > 0) {
        const otherLineup = this.allLineups.find(lineup => {
          // Skip the current lineup being edited (by ID if available, otherwise skip none)
          if (this.currentLineup.id && lineup.id === this.currentLineup.id) return false;
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

      // Ticket used badge (only for Classic)
      const ticketBadge = ticketUsed ? `<span class="ticket-used-badge" title="Ticket already used this week"><img src="/icons/ticket.svg" alt="T"></span>` : '';

      return `
        <div class="player-card ${!needsThisRaid ? 'completed' : ''} ${isInLineup ? 'in-lineup' : ''} ${ticketUsed ? 'ticket-used' : ''}"
             data-player-name="${player.name}"
             draggable="true">
          ${player.notes ? `<span class="note-icon tooltip-wrap tooltip-below tooltip-right" data-tooltip="${player.notes.replace(/"/g, '&quot;')}">📝</span>` : ''}
          ${ticketBadge}
          ${!needsThisRaid ? `<span class="completion-badge" title="Already completed ${this.currentLineup.raidType} this week">✓</span>` : (presentInLineup ? `<span class="present-in-badge">${presentInLineup}</span>` : '')}
          ${player.role ? `<div class="class-sprite player-card-class-bg" style="${getClassSpriteStyle(player.role)}"></div>` : ''}
          <div class="player-info">
            <div class="player-name">${player.name} ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`; })()}</div>
            <div class="player-role">${player.role}</div>
            ${formatPlayerEquipmentHtml(player)}
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
    const hideCleared = document.getElementById('hide-cleared-checkbox').checked;
    const hideInLineup = document.getElementById('hide-in-lineup-checkbox').checked;

    return this.players
      .filter(player => {
        const matchesSearch = player.name.toLowerCase().includes(searchTerm) ||
                            player.role.toLowerCase().includes(searchTerm);

        // Class family, specialization, or final class filter
        let matchesClassFamily = true;
        if (this.selectedFinalClass) {
          matchesClassFamily = player.role === this.selectedFinalClass;
        } else if (this.selectedSpecialization && this.expandedClassFamily) {
          const family = CLASS_FAMILIES[this.expandedClassFamily];
          const specClasses = family.specializations[this.selectedSpecialization]?.classes || [];
          matchesClassFamily = specClasses.includes(player.role);
        } else if (this.selectedClassFamily) {
          const familyClasses = CLASS_FAMILIES[this.selectedClassFamily].classes;
          matchesClassFamily = familyClasses.includes(player.role);
        }

        // Hide cleared filter - only hide if checkbox is checked
        // In Next Week mode, don't hide anyone regardless of cleared status
        let matchesCompletion = true;
        if (hideCleared && !this.currentLineup.isNextWeek) {
          // Only show players who need this raid (hide those who already completed)
          matchesCompletion = dataService.playerNeedsRaid(player, this.currentLineup.raidType);
        }

        // Hide in lineup filter - hide players who are in another lineup of the same raid type
        let matchesNotInLineup = true;
        if (hideInLineup && !this.currentLineup.isNextWeek && this.allLineups && this.allLineups.length > 0) {
          const inOtherLineup = this.allLineups.some(lineup => {
            // Skip the current lineup being edited (by ID if available)
            if (this.currentLineup.id && lineup.id === this.currentLineup.id) return false;
            // Only check lineups of the same raid type
            const lineupRaidType = lineup.raidType || 'Hardcore';
            if (lineupRaidType !== this.currentLineup.raidType) return false;
            // Check if player is in this lineup
            return lineup.players && lineup.players.includes(player.name);
          });
          matchesNotInLineup = !inOtherLineup;
        }

        return matchesSearch && matchesClassFamily && matchesCompletion && matchesNotInLineup;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  filterPlayers() {
    this.renderAvailablePlayers();
  },

  /**
   * Lightweight update of player card CSS classes and badges
   * without rebuilding the entire list (preserves scroll position, no flicker)
   */
  updatePlayerCardStates() {
    const cards = document.querySelectorAll('.player-card[data-player-name]');
    cards.forEach(card => {
      const playerName = card.dataset.playerName;
      if (playerName === '[ADD_PUB]') return;

      const isInLineup = this.currentLineup.players.includes(playerName);
      card.classList.toggle('in-lineup', isInLineup);

      // Update the "Added" badge
      const badgeContainer = card.querySelector('.player-card-badges');
      if (badgeContainer) {
        badgeContainer.innerHTML = isInLineup ? '<span class="in-lineup-badge">Added</span>' : '';
      }
    });
  },

  renderSpecializations() {
    const container = document.getElementById('specialization-filter');
    const finalsContainer = document.getElementById('final-class-filter');
    if (!container) return;

    if (!this.expandedClassFamily) {
      container.innerHTML = '';
      if (finalsContainer) finalsContainer.innerHTML = '';
      return;
    }

    const family = CLASS_FAMILIES[this.expandedClassFamily];
    if (!family || !family.specializations) {
      container.innerHTML = '';
      if (finalsContainer) finalsContainer.innerHTML = '';
      return;
    }

    container.innerHTML = Object.entries(family.specializations).map(([key, spec]) => `
      <button class="specialization-btn ${this.selectedSpecialization === key ? 'active' : ''}"
              data-specialization="${key}"
              data-family="${this.expandedClassFamily}"
              title="${spec.name}">
        <div class="spec-icon-wrapper">
          <div class="class-sprite" style="${getClassSpriteStyle(spec.name)}"></div>
        </div>
        <span class="spec-name">${spec.name}</span>
      </button>
    `).join('');

    // Show final classes in separate container
    if (finalsContainer) {
      if (this.selectedSpecialization && family.specializations[this.selectedSpecialization]) {
        const spec = family.specializations[this.selectedSpecialization];
        finalsContainer.innerHTML = `<div class="class-picker-finals">
          ${spec.classes.map(cls => `
            <button type="button" class="final-class-btn ${this.selectedFinalClass === cls ? 'active' : ''}"
                    data-class="${cls}"><span class="final-class-icon"><div class="class-sprite" style="${getClassSpriteStyle(cls)}"></div></span>${cls}</button>
          `).join('')}
        </div>`;

        finalsContainer.querySelectorAll('.final-class-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const cls = btn.dataset.class;
            this.selectedFinalClass = this.selectedFinalClass === cls ? null : cls;
            this.renderSpecializations();
            this.filterPlayers();
          });
        });
      } else {
        finalsContainer.innerHTML = '';
      }
    }

    // Attach specialization click handlers
    container.querySelectorAll('.specialization-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const spec = btn.dataset.specialization;

        if (this.selectedSpecialization === spec) {
          this.selectedSpecialization = null;
          this.selectedFinalClass = null;
          this.selectedClassFamily = this.expandedClassFamily;
          btn.classList.remove('active');
        } else {
          container.querySelectorAll('.specialization-btn').forEach(b => b.classList.remove('active'));
          this.selectedSpecialization = spec;
          this.selectedFinalClass = null;
          this.selectedClassFamily = null;
          btn.classList.add('active');
          document.querySelectorAll('.class-family-btn').forEach(b => b.classList.remove('active'));
          document.querySelector(`.class-family-btn[data-family="${this.expandedClassFamily}"]`)?.classList.add('expanded');
        }

        this.renderSpecializations();
        this.filterPlayers();
      });
    });
  },

  /**
   * Render class picker (base class icons → specializations → final classes)
   * Same pattern used in the add/edit character modal on the Players page.
   */
  renderClassPickerEl(container, hiddenInput, selectedClass) {
    if (!container || !hiddenInput) return;

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

      if (selectedClass) {
        html += `<div class="class-picker-selected">Selected: <strong>${selectedClass}</strong></div>`;
      }

      container.innerHTML = html;

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

  renderClassPicker(containerId, hiddenInputId, selectedClass) {
    const container = document.getElementById(containerId);
    const hiddenInput = document.getElementById(hiddenInputId);
    this.renderClassPickerEl(container, hiddenInput, selectedClass);
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

  // Check for same-account conflicts in the lineup
  // Returns an object mapping slot indices to their conflict info
  getAccountConflicts() {
    const conflicts = {};
    const slotsByOwnerAccount = {};

    this.currentLineup.players.forEach((playerName, slotIndex) => {
      if (!playerName || playerName.startsWith('[PUB]')) return;

      const player = this.players.find(p => p.name === playerName);
      if (!player || !player.discordId) return;

      // Use accountNumber or default to 1
      const accountNum = player.accountNumber || 1;
      const key = `${player.discordId}-${accountNum}`;

      if (!slotsByOwnerAccount[key]) {
        slotsByOwnerAccount[key] = [];
      }
      slotsByOwnerAccount[key].push({ slotIndex, playerName, player });
    });

    // Find conflicts (more than one player from same owner+account)
    Object.values(slotsByOwnerAccount).forEach(slots => {
      if (slots.length > 1) {
        slots.forEach(({ slotIndex, player }) => {
          conflicts[slotIndex] = {
            accountNumber: player.accountNumber || 1,
            conflictCount: slots.length,
            conflictingSlots: slots.map(s => s.slotIndex).filter(i => i !== slotIndex)
          };
        });
      }
    });

    return conflicts;
  },

  // Update conflict warnings on all slots
  updateConflictWarnings() {
    const conflicts = this.getAccountConflicts();

    document.querySelectorAll('.slot').forEach(slotElement => {
      const slotIndex = parseInt(slotElement.dataset.slot);
      const existingWarning = slotElement.querySelector('.account-conflict-warning');

      if (conflicts[slotIndex]) {
        const conflict = conflicts[slotIndex];
        slotElement.classList.add('has-account-conflict');

        if (!existingWarning) {
          const warning = document.createElement('div');
          warning.className = 'account-conflict-warning';
          warning.innerHTML = `<span class="conflict-badge">!</span>`;
          warning.title = `Same account as slot ${conflict.conflictingSlots.map(s => s + 1).join(', ')}`;
          slotElement.appendChild(warning);
        } else {
          existingWarning.title = `Same account as slot ${conflict.conflictingSlots.map(s => s + 1).join(', ')}`;
        }
      } else {
        slotElement.classList.remove('has-account-conflict');
        if (existingWarning) {
          existingWarning.remove();
        }
      }
    });
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
        </div>

        <div class="modal-class-family-filter">
          ${Object.entries(CLASS_FAMILIES).map(([key, family]) => `
            <button class="class-family-btn" data-family="${key}" title="${family.name}">
              <div class="class-sprite" style="${getClassSpriteStyle(family.name)}"></div>
            </button>
          `).join('')}
        </div>
        <div class="modal-specialization-filter" id="modal-specialization-filter"></div>
        <div id="modal-final-class-filter"></div>

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
    let modalExpandedFamily = null;
    let modalSelectedSpecialization = null;
    let modalSelectedFinalClass = null;

    // Function to render filtered players
    const renderModalPlayers = () => {
      const searchTerm = document.getElementById('modal-player-search').value.toLowerCase();
      const hideCleared = document.getElementById('modal-hide-cleared-checkbox').checked;

      const filteredPlayers = this.players
        .filter(player => {
          const matchesSearch = player.name.toLowerCase().includes(searchTerm) ||
                              player.role.toLowerCase().includes(searchTerm);

          // Class family, specialization, or final class filter
          let matchesClassFamily = true;
          if (modalSelectedFinalClass) {
            matchesClassFamily = player.role === modalSelectedFinalClass;
          } else if (modalSelectedSpecialization && modalExpandedFamily) {
            const family = CLASS_FAMILIES[modalExpandedFamily];
            const specClasses = family.specializations[modalSelectedSpecialization]?.classes || [];
            matchesClassFamily = specClasses.includes(player.role);
          } else if (modalSelectedFamily) {
            const familyClasses = CLASS_FAMILIES[modalSelectedFamily].classes;
            matchesClassFamily = familyClasses.includes(player.role);
          }

          // Hide cleared filter - respect Next Week mode
          let matchesCompletion = true;
          if (hideCleared && !this.currentLineup.isNextWeek) {
            matchesCompletion = dataService.playerNeedsRaid(player, this.currentLineup.raidType);
          }

          return matchesSearch && matchesClassFamily && matchesCompletion;
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
        // In Next Week mode, treat all players as needing the raid
        const needsThisRaid = this.currentLineup.isNextWeek ? true : dataService.playerNeedsRaid(player, this.currentLineup.raidType);

        return `
          <div class="player-option ${!needsThisRaid ? 'completed' : ''}" data-player-name="${player.name}">
            ${!needsThisRaid ? `<span class="completion-badge" title="Already completed ${this.currentLineup.raidType} this week">✓</span>` : ''}
            <div class="player-info">
              <div class="player-name">${player.name} ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`; })()}</div>
              <div class="player-role">${player.role}</div>
              ${formatPlayerEquipmentHtml(player)}
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

    document.getElementById('modal-hide-cleared-checkbox').addEventListener('change', renderModalPlayers);

    // Function to render modal specializations
    const renderModalSpecializations = () => {
      const container = document.getElementById('modal-specialization-filter');
      const finalsContainer = document.getElementById('modal-final-class-filter');
      if (!container) return;

      if (!modalExpandedFamily) {
        container.innerHTML = '';
        if (finalsContainer) finalsContainer.innerHTML = '';
        return;
      }

      const family = CLASS_FAMILIES[modalExpandedFamily];
      if (!family || !family.specializations) {
        container.innerHTML = '';
        if (finalsContainer) finalsContainer.innerHTML = '';
        return;
      }

      container.innerHTML = Object.entries(family.specializations).map(([key, spec]) => `
        <button class="specialization-btn ${modalSelectedSpecialization === key ? 'active' : ''}"
                data-specialization="${key}"
                data-family="${modalExpandedFamily}"
                title="${spec.name}">
          <div class="spec-icon-wrapper">
            <div class="class-sprite" style="${getClassSpriteStyle(spec.name)}"></div>
          </div>
          <span class="spec-name">${spec.name}</span>
        </button>
      `).join('');

      // Render finals in separate container
      if (finalsContainer) {
        if (modalSelectedSpecialization && family.specializations[modalSelectedSpecialization]) {
          const spec = family.specializations[modalSelectedSpecialization];
          finalsContainer.innerHTML = `<div class="class-picker-finals">
            ${spec.classes.map(cls => `
              <button type="button" class="final-class-btn ${modalSelectedFinalClass === cls ? 'active' : ''}"
                      data-class="${cls}"><span class="final-class-icon"><div class="class-sprite" style="${getClassSpriteStyle(cls)}"></div></span>${cls}</button>
            `).join('')}
          </div>`;

          finalsContainer.querySelectorAll('.final-class-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const cls = btn.dataset.class;
              modalSelectedFinalClass = modalSelectedFinalClass === cls ? null : cls;
              renderModalSpecializations();
              renderModalPlayers();
            });
          });
        } else {
          finalsContainer.innerHTML = '';
        }
      }

      // Attach specialization click handlers
      container.querySelectorAll('.specialization-btn').forEach(specBtn => {
        specBtn.addEventListener('click', () => {
          const spec = specBtn.dataset.specialization;

          if (modalSelectedSpecialization === spec) {
            modalSelectedSpecialization = null;
            modalSelectedFinalClass = null;
            modalSelectedFamily = modalExpandedFamily;
            specBtn.classList.remove('active');
          } else {
            container.querySelectorAll('.specialization-btn').forEach(b => b.classList.remove('active'));
            modalSelectedSpecialization = spec;
            modalSelectedFinalClass = null;
            modalSelectedFamily = null;
            specBtn.classList.add('active');
            modalElement.querySelectorAll('.class-family-btn').forEach(b => b.classList.remove('active'));
            modalElement.querySelector(`.class-family-btn[data-family="${modalExpandedFamily}"]`)?.classList.add('expanded');
          }

          renderModalSpecializations();
          renderModalPlayers();
        });
      });
    };

    // Class family filter buttons
    modalElement.querySelectorAll('.class-family-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const family = btn.dataset.family;

        if (modalExpandedFamily === family) {
          if (modalSelectedSpecialization) {
            modalSelectedSpecialization = null;
            modalSelectedFinalClass = null;
            modalSelectedFamily = family;
            document.querySelectorAll('#modal-specialization-filter .specialization-btn').forEach(b => b.classList.remove('active'));
          } else if (modalSelectedFamily === family) {
            modalExpandedFamily = null;
            modalSelectedFamily = null;
            modalSelectedFinalClass = null;
            btn.classList.remove('active', 'expanded');
            renderModalSpecializations();
          } else {
            modalSelectedFamily = family;
            btn.classList.add('active');
          }
        } else {
          modalElement.querySelectorAll('.class-family-btn').forEach(b => b.classList.remove('active', 'expanded'));
          modalExpandedFamily = family;
          modalSelectedFamily = family;
          modalSelectedSpecialization = null;
          modalSelectedFinalClass = null;
          btn.classList.add('active', 'expanded');
          renderModalSpecializations();
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

  showScanLineupModal() {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';

    modalElement.innerHTML = `
      <div class="modal-content" style="max-width: 500px;">
        <h2>Scan Lineup Screenshot</h2>
        <p style="color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-bottom: 1rem;">
          Upload or paste a screenshot of the raid party list. Character names will be matched to existing players; unmatched names will be added as guests.
        </p>
        <div class="modal-upload-zone scan-upload-zone" style="margin-bottom: 1rem;">
          <img id="scan-preview" style="display:none; max-width:100%; max-height:200px; border-radius:4px;" />
          <div class="modal-upload-placeholder">
            <span class="upload-icon">📷</span>
            <span>Click, drag, or paste an image</span>
          </div>
          <input type="file" id="scan-file-input" accept="image/*" style="display:none" />
        </div>
        <div class="form-actions">
          <button type="button" id="scan-analyze-btn" class="btn btn-primary" disabled>Analyze</button>
          <button type="button" class="btn btn-ghost scan-cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalElement);

    const uploadZone = modalElement.querySelector('.scan-upload-zone');
    const fileInput = modalElement.querySelector('#scan-file-input');
    const preview = modalElement.querySelector('#scan-preview');
    const placeholder = modalElement.querySelector('.modal-upload-placeholder');
    const analyzeBtn = modalElement.querySelector('#scan-analyze-btn');
    const cancelBtn = modalElement.querySelector('.scan-cancel-btn');

    let imageData = null;
    let mimeType = null;

    const handleFile = (file) => {
      if (!file.type.startsWith('image/')) return;
      mimeType = file.type;
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        imageData = e.target.result.split(',')[1]; // base64 without prefix
        analyzeBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    };

    uploadZone.addEventListener('click', (e) => {
      if (e.target === analyzeBtn || e.target === cancelBtn) return;
      fileInput.click();
    });
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

    const closeModal = () => {
      document.removeEventListener('paste', onPaste);
      if (modalElement.parentNode) document.body.removeChild(modalElement);
    };

    cancelBtn.addEventListener('click', closeModal);
    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) closeModal();
    });

    analyzeBtn.addEventListener('click', async () => {
      if (!imageData) return;

      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Analyzing...';

      try {
        const knownPlayers = this.players.map(p => p.name);
        const response = await fetch('/.netlify/functions/analyze-lineup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageData, mimeType, knownPlayers })
        });

        const result = await response.json();

        if (result.error) {
          toast.error(`Analysis failed: ${result.error}`);
          analyzeBtn.disabled = false;
          analyzeBtn.textContent = 'Analyze';
          return;
        }

        closeModal();
        this.processLineupScan(result.players || []);
      } catch (err) {
        toast.error(`Analysis failed: ${err.message}`);
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze';
      }
    });
  },

  processLineupScan(scannedPlayers) {
    if (!scannedPlayers.length) {
      toast.error('No characters found in the screenshot');
      return;
    }

    // Clear current lineup slots
    for (let i = 0; i < 8; i++) {
      if (this.currentLineup.players[i]) {
        this.removePlayerFromSlot(i);
      }
    }

    let matched = 0;
    let guests = 0;

    scannedPlayers.slice(0, 8).forEach((scanned, idx) => {
      if (!scanned.name) return;

      // Try to match against known players (case-insensitive)
      const match = this.players.find(p =>
        p.name.toLowerCase() === scanned.name.toLowerCase()
      );

      if (match) {
        this.assignPlayerToSlot(idx, match.name);
        matched++;
      } else {
        // Add as guest — name only, user sets the class
        this.assignPubPlayerToSlot(idx, scanned.name, '');
        guests++;
      }
    });

    const parts = [];
    if (matched) parts.push(`${matched} matched`);
    if (guests) parts.push(`${guests} as guests`);
    toast.success(`Lineup scanned: ${parts.join(', ')}`);
  },

  showGuestClassPicker(slotIndex, guestName) {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';

    modalElement.innerHTML = `
      <div class="modal-content" style="max-width: 450px;">
        <h2>Set Class for ${guestName || 'Guest'}</h2>
        <input type="hidden" class="guest-class-value" value="">
        <div class="class-picker guest-class-picker"></div>
        <div class="modal-actions" style="margin-top: 1rem;">
          <button type="button" class="btn btn-primary guest-class-confirm" disabled>Confirm</button>
          <button type="button" class="btn btn-ghost guest-class-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalElement);

    const pickerEl = modalElement.querySelector('.guest-class-picker');
    const hiddenInput = modalElement.querySelector('.guest-class-value');
    const confirmBtn = modalElement.querySelector('.guest-class-confirm');
    const cancelBtn = modalElement.querySelector('.guest-class-cancel');

    // Render class picker using element references (not IDs)
    this.renderClassPickerEl(pickerEl, hiddenInput, '');

    // Watch for class selection
    const observer = new MutationObserver(() => {
      confirmBtn.disabled = !hiddenInput.value;
    });
    observer.observe(hiddenInput, { attributes: true, attributeFilter: ['value'] });

    // Also listen for clicks on the picker to check value
    pickerEl.addEventListener('click', () => {
      setTimeout(() => { confirmBtn.disabled = !hiddenInput.value; }, 0);
    });

    confirmBtn.addEventListener('click', () => {
      const role = hiddenInput.value;
      if (!role) return;
      observer.disconnect();
      document.body.removeChild(modalElement);
      // Remove the old capture handler before reassigning
      const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
      if (slotElement._guestClassHandler) {
        slotElement.removeEventListener('click', slotElement._guestClassHandler, true);
        delete slotElement._guestClassHandler;
      }
      this.assignPubPlayerToSlot(slotIndex, guestName, role);
    });

    cancelBtn.addEventListener('click', () => {
      observer.disconnect();
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        observer.disconnect();
        document.body.removeChild(modalElement);
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
            <label>Class: *</label>
            <input type="hidden" id="pub-class" value="">
            <div class="class-picker" id="pub-class-picker"></div>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary">Add to Lineup</button>
            <button type="button" id="cancel-pub-btn" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    // Render the class picker (same pattern as add/edit character modal)
    this.renderClassPicker('pub-class-picker', 'pub-class', '');

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

  showEditGuestModal(slotIndex, currentName, currentRole) {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';

    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Edit Guest Character</h2>
        <form id="edit-guest-form">
          <div class="form-group">
            <label for="edit-guest-name">Character Name:</label>
            <input type="text" id="edit-guest-name" value="${currentName || ''}" placeholder="Leave empty for placeholder">
          </div>
          <div class="form-group">
            <label>Class: *</label>
            <input type="hidden" id="edit-guest-class" value="${currentRole || ''}">
            <div class="class-picker" id="edit-guest-class-picker"></div>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" id="cancel-edit-guest-btn" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    this.renderClassPicker('edit-guest-class-picker', 'edit-guest-class', currentRole || '');

    const input = document.getElementById('edit-guest-name');
    input.focus();
    input.select();

    document.getElementById('edit-guest-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      const role = document.getElementById('edit-guest-class').value;
      if (!role) {
        toast.error('Please select a class');
        return;
      }
      this.assignPubPlayerToSlot(slotIndex, name, role);
      document.body.removeChild(modalElement);
    });

    document.getElementById('cancel-edit-guest-btn').addEventListener('click', () => {
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

    // If no name provided, display the class name as the name
    const displayName = name || role || 'Guest';

    slotContent.innerHTML = `
      <div class="assigned-player pub-player">
        <div class="player-name"><span class="pub-name-edit" title="Click to rename">${displayName}</span> <span class="pub-badge">GUEST</span></div>
        ${role ? `<div class="player-role">${role}</div>` : `<div class="player-role no-class">Click to set class</div>`}
      </div>
    `;

    // Click on guest name to edit it
    const nameEl = slotContent.querySelector('.pub-name-edit');
    if (nameEl) {
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.showEditGuestModal(slotIndex, name, role);
      });
    }

    // If no class set, clicking the slot opens class picker instead of player selector
    if (!role) {
      const classClickHandler = (e) => {
        if (e.target.closest('.slot-remove-btn')) return;
        e.stopImmediatePropagation();
        this.showGuestClassPicker(slotIndex, name);
      };
      slotElement._guestClassHandler = classClickHandler;
      slotElement.addEventListener('click', classClickHandler, true);
    } else {
      // Remove handler if previously set
      if (slotElement._guestClassHandler) {
        slotElement.removeEventListener('click', slotElement._guestClassHandler, true);
        delete slotElement._guestClassHandler;
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

    this.updatePlayerCardStates();
    this.updateDamageAmpDisplay();
    this.updateConflictWarnings();
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

    // Get current ticket status for this slot (only show for Classic raid)
    const hasTicket = this.currentLineup.ticketSlots[slotIndex];
    const showTicketToggle = this.currentLineup.raidType === 'Classic';

    // Get current pilot for this slot
    const pilotName = this.currentLineup.pilotSlots[slotIndex] || '';
    const pilotDisplay = pilotName ? `<span class="pilot-info"><img src="/icons/headphones.svg" alt="Pilot" class="pilot-info-icon">${pilotName}</span>` : '';

    slotContent.innerHTML = `
      ${player.role ? `<div class="class-sprite slot-class-bg" style="${getClassSpriteStyle(player.role)}"></div>` : ''}
      <div class="assigned-player">
        <div class="player-name">${player.name} ${(() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`; })()}</div>
        ${pilotDisplay}
        <div class="player-role">${player.role}</div>
        ${formatPlayerEquipmentHtml(player, 'player-equipment-compact')}
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

    this.updatePlayerCardStates();
    this.updateDamageAmpDisplay();
    this.updateConflictWarnings();
  },

  removePlayerFromSlot(slotIndex) {
    this.currentLineup.players[slotIndex] = null;
    this.currentLineup.ticketSlots[slotIndex] = false; // Clear ticket status
    this.currentLineup.pilotSlots[slotIndex] = ''; // Clear pilot

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    // Clean up guest class click handler if present
    if (slotElement._guestClassHandler) {
      slotElement.removeEventListener('click', slotElement._guestClassHandler, true);
      delete slotElement._guestClassHandler;
    }
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

    this.updatePlayerCardStates();
    this.updateDamageAmpDisplay();
    this.updateConflictWarnings();
  },

  reRenderLineupSlots() {
    // Re-render all assigned players to update ticket/pilot toggles based on raid type
    this.currentLineup.players.forEach((playerName, idx) => {
      if (playerName) {
        this.assignPlayerToSlot(idx, playerName);
      }
    });
  },

  /**
   * Clear all 8 slots but keep the lineup identity (name, ID, settings)
   */
  clearSlots() {
    this.currentLineup.players = [];
    this.currentLineup.ticketSlots = Array(8).fill(false);
    this.currentLineup.pilotSlots = Array(8).fill('');

    this._clearSlotElements();
    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();
    this.updateConflictWarnings();

    toast.success('Slots cleared.');
  },

  /**
   * Start a fresh lineup — resets everything
   */
  async newLineup() {
    // Only confirm if there's something to lose
    const hasContent = this.currentLineup.id || this.currentLineup.name || this.currentLineup.players.some(p => p);
    if (hasContent) {
      const confirmed = await modal.confirm(
        'Start a new lineup? Unsaved changes will be lost.',
        { title: 'New Lineup', confirmText: 'New Lineup', cancelText: 'Cancel', danger: true }
      );
      if (!confirmed) return;
    }

    const currentRaidType = this.currentLineup.raidType;

    this.currentLineup = {
      id: null,
      name: '',
      raidType: currentRaidType,
      status: 'ready',
      players: [],
      ticketSlots: Array(8).fill(false),
      pilotSlots: Array(8).fill(''),
      completed: false,
      isNextWeek: false,
      notes: '',
      raidTime: null
    };

    const lineupNameInput = document.getElementById('lineup-name');
    lineupNameInput.value = '';
    lineupNameInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById('raid-type').value = currentRaidType;
    document.getElementById('cleared-toggle').checked = false;
    document.getElementById('next-week-toggle').checked = false;
    document.getElementById('lineup-notes').value = '';
    if (this.flatpickrInstance) {
      this.flatpickrInstance.clear();
    }
    this.updateRaidTimeDisplay();

    this._clearSlotElements();
    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();

    this.leaveLineupPresence();
  },

  /**
   * Reset all slot DOM elements to empty state
   */
  _clearSlotElements() {
    document.querySelectorAll('.slot').forEach(slotElement => {
      const slotContent = slotElement.querySelector('.slot-content');
      slotContent.innerHTML = '<div class="empty-slot">Drop or click</div>';
      const removeBtn = slotElement.querySelector('.slot-remove-btn');
      if (removeBtn) removeBtn.remove();
      slotElement.style.cssText = '';
      slotContent.style.cssText = '';
    });
  },

  async saveLineup() {
    if (!dataService.isAdmin()) {
      toast.error('Only admins can save lineups.');
      return;
    }
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
      toast.warning('You need to be logged in to save lineups.', 5000);
      return;
    }

    const saveBtn = document.getElementById('save-lineup-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const players = Array(8).fill('').map((_, idx) => this.currentLineup.players[idx] || '');
      const ticketPlayers = [...this.currentLineup.ticketSlots];
      const pilotPlayers = [...this.currentLineup.pilotSlots];
      const trimmedName = this.currentLineup.name.trim();
      const isUpdate = !!this.currentLineup.id;

      const lineupData = {
        name: trimmedName,
        raidType: this.currentLineup.raidType,
        status: 'ready',
        players,
        ticketPlayers,
        pilotPlayers,
        completed: this.currentLineup.completed,
        isNextWeek: this.currentLineup.isNextWeek,
        notes: this.currentLineup.notes,
        raidTime: this.currentLineup.raidTime
      };

      // Get non-guest player names and ticket info for completion tracking
      const playerNames = [];
      const ticketPlayerNames = [];
      players.forEach((p, idx) => {
        if (p && !p.startsWith('[PUB]')) {
          playerNames.push(p);
          if (ticketPlayers[idx]) ticketPlayerNames.push(p);
        }
      });

      if (isUpdate) {
        // We have an ID — try to update directly (no confirmation needed)
        lineupData.id = this.currentLineup.id;

        // We need the previous cleared state for completion tracking
        // Use the cached version from allLineups instead of re-fetching
        const cachedLineup = this.allLineups.find(l => l.id === this.currentLineup.id);

        if (!cachedLineup) {
          // Lineup was deleted while editing
          const saveAsNew = await modal.confirm(
            `This lineup has been deleted. Save as a new lineup?`,
            { title: 'Lineup Deleted', confirmText: 'Save as New', cancelText: 'Cancel' }
          );
          if (!saveAsNew) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Lineup';
            return;
          }
          this.currentLineup.id = null;
          delete lineupData.id;
          // Fall through to create-new path below
        } else {
          await dataService.updateLineup(lineupData);
          toast.success(`${trimmedName} updated!`);

          // Handle completion status changes
          await this._handleCompletionChanges(cachedLineup, playerNames, ticketPlayerNames);

          this._refreshAfterSave(saveBtn);
          return;
        }
      }

      // Create new lineup
      const result = await dataService.addLineup(lineupData);
      if (result.data?.id) {
        this.currentLineup.id = result.data.id;
      }
      toast.success(`${trimmedName} saved!`);

      // Mark completion if new lineup is already cleared
      if (this.currentLineup.completed && playerNames.length > 0) {
        try {
          await dataService.markPlayersCompleted(playerNames, this.currentLineup.raidType, ticketPlayerNames);
        } catch (error) {
          console.error('Error marking players as completed:', error);
          toast.warning('Saved pero may nangyari sa mark? Refresh nalang dong');
        }
      }

      this._refreshAfterSave(saveBtn);
    } catch (error) {
      toast.error(`Error dong: ${error.message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    }
  },

  /**
   * Handle player completion status changes when updating an existing lineup
   */
  async _handleCompletionChanges(previousLineup, playerNames, ticketPlayerNames) {
    const wasCleared = previousLineup.completed;
    const isNowCleared = this.currentLineup.completed;

    if (playerNames.length === 0) return;

    try {
      if (wasCleared && !isNowCleared) {
        // Unchecking cleared — unmark players using ORIGINAL ticket info
        const originalTicketPlayerNames = previousLineup.ticketPlayers
          ? previousLineup.players
              .filter((p, idx) => p && !p.startsWith('[PUB]') && previousLineup.ticketPlayers[idx])
              .map(p => p)
          : [];
        await dataService.unmarkPlayersCompleted(playerNames, this.currentLineup.raidType, null, originalTicketPlayerNames);
      } else if (isNowCleared) {
        // Newly cleared or still cleared with possible player changes — mark all
        await dataService.markPlayersCompleted(playerNames, this.currentLineup.raidType, ticketPlayerNames);
      }
    } catch (error) {
      console.error('Error updating completion status:', error);
      toast.warning('Saved pero may nangyari sa completion? Refresh nalang dong');
    }
  },

  /**
   * Refresh UI after a successful save (players + carousel in parallel)
   */
  async _refreshAfterSave(saveBtn) {
    // Fetch players and lineups in parallel
    const [players] = await Promise.all([
      dataService.getPlayers(),
      this.loadExistingLineups() // also refreshes this.allLineups internally
    ]);
    this.players = players;
    this.renderAvailablePlayers();

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Lineup';
  },

  async deleteLineup(lineupId) {
    if (!dataService.isAdmin()) {
      toast.error('Only admins can delete lineups.');
      return;
    }
    // Find the lineup to get its name for the confirmation message
    const lineup = this.allLineups.find(l => l.id === lineupId);
    const lineupName = lineup?.name || 'this lineup';

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
      // Track this delete to skip self-notification
      this.pendingDeleteId = lineupId;
      await dataService.deleteLineup(lineupId);
      toast.success(`GG wala nang ${lineupName}!`);
      this.loadExistingLineups(); // Refresh the lineup list
    } catch (error) {
      toast.error(`HOY ano yan bat may error: ${error.message}`);
    } finally {
      // Clear the pending delete flag after a short delay to allow realtime event to process
      setTimeout(() => {
        this.pendingDeleteId = null;
      }, 1000);
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
      id: lineup.id, // Store the ID for updates
      name: lineup.name,
      raidType: lineup.raidType || 'Hardcore',
      status: 'ready',
      players: [...lineup.players],
      ticketSlots,
      pilotSlots,
      completed: lineup.completed || false,
      isNextWeek: lineup.isNextWeek || false,
      notes: lineup.notes || '',
      raidTime: lineup.raidTime || null
    };

    document.getElementById('lineup-name').value = lineup.name;
    document.getElementById('raid-type').value = lineup.raidType || 'Hardcore';
    document.getElementById('cleared-toggle').checked = lineup.completed || false;
    document.getElementById('next-week-toggle').checked = lineup.isNextWeek || false;
    document.getElementById('lineup-notes').value = lineup.notes || '';
    if (this.flatpickrInstance) {
      this.flatpickrInstance.setDate(lineup.raidTime ? new Date(lineup.raidTime) : null, false);
    }
    this.updateRaidTimeDisplay();

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
    this.updateConflictWarnings();

    // Join presence channel for this specific lineup
    this.joinLineupPresence(lineup.id);
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
  },

  /**
   * Setup realtime subscription for lineup changes
   */
  setupRealtimeSubscription() {
    // Only setup once
    if (this.lineupSubscription) return;

    this.lineupSubscription = dataService.subscribeToLineups((payload) => {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      const changedLineupId = newRecord?.id || oldRecord?.id;

      // Skip notification if this user initiated the delete
      if (eventType === 'DELETE' && this.pendingDeleteId === changedLineupId) {
        return;
      }

      // Check if the change affects the currently edited lineup
      const isCurrentLineup = this.currentLineup.id && this.currentLineup.id === changedLineupId;

      if (isCurrentLineup) {
        if (eventType === 'DELETE') {
          // Lineup was deleted by another user - clear the ID but let them keep editing
          this.currentLineup.id = null;
          this.leaveLineupPresence();
          toast.warning('This lineup has been deleted. You can still save it as a new lineup.');
        } else {
          // Lineup was updated by someone else
          toast.showWithAction(
            'A change was made to this lineup. Reload to see changes.',
            'Reload',
            () => {
              // Find and reload the fresh lineup
              dataService.getLineups().then(lineups => {
                const freshLineup = lineups.find(l => l.id === changedLineupId);
                if (freshLineup) {
                  this.loadLineup(freshLineup);
                }
                this.loadExistingLineups();
              });
            },
            'warning'
          );
        }
      } else {
        // Change to a different lineup - just refresh the carousel
        this.loadExistingLineups();
      }
    });
  },

  /**
   * Join presence channel for a specific lineup
   */
  joinLineupPresence(lineupId) {
    if (!lineupId) return;

    // Leave any existing channel first
    this.leaveLineupPresence();

    console.log('[Presence] Joining lineup channel:', lineupId);

    this.presenceChannel = dataService.joinPresence(`lineup:${lineupId}`, (users) => {
      this.viewingUsers = users;
      this.renderPresenceIndicator();
    });
  },

  /**
   * Leave the current lineup presence channel
   */
  leaveLineupPresence() {
    if (this.presenceChannel) {
      console.log('[Presence] Leaving lineup channel');
      dataService.leavePresence(this.presenceChannel);
      this.presenceChannel = null;
    }
    this.viewingUsers = [];
    this.renderPresenceIndicator();
  },

  /**
   * Render the presence indicator showing other viewers
   */
  renderPresenceIndicator() {
    const indicator = document.getElementById('presence-indicator');
    if (!indicator) return;

    if (this.viewingUsers.length === 0) {
      indicator.innerHTML = '';
      return;
    }

    // Show avatars (up to 3) and count
    const maxAvatars = 3;
    const displayUsers = this.viewingUsers.slice(0, maxAvatars);
    const extraCount = this.viewingUsers.length - maxAvatars;

    const avatarsHtml = displayUsers.map(user => {
      return `<img src="${user.avatar || '/icons/avatar.svg'}" alt="${user.name}" title="${user.name}" class="presence-avatar" onerror="this.src='/icons/avatar.svg'">`;
    }).join('');

    const countHtml = extraCount > 0 ? `<span class="presence-extra">+${extraCount}</span>` : '';
    const label = this.viewingUsers.length === 1 ? '1 other viewing' : `${this.viewingUsers.length} others viewing`;

    indicator.innerHTML = `
      <div class="presence-avatars">${avatarsHtml}${countHtml}</div>
      <span class="presence-label">${label}</span>
    `;
  },

  /**
   * Update the raid time display text and clear button visibility
   */
  updateRaidTimeDisplay() {
    const display = document.getElementById('raid-time-display');
    const clearBtn = document.getElementById('raid-time-clear');
    if (this.currentLineup.raidTime) {
      display.innerHTML = this.formatRaidTimeForDisplay(this.currentLineup.raidTime);
      display.classList.add('has-value');
      clearBtn.style.display = 'flex';
    } else {
      display.textContent = 'Click to set time';
      display.classList.remove('has-value');
      clearBtn.style.display = 'none';
    }
  },

  /**
   * Format raid time for display using moment.js
   */
  formatRaidTimeForDisplay(isoString) {
    if (!isoString) return 'Click to set time';
    const m = moment(isoString);
    const localTime = m.format('ddd, MMM D, h:mm A');

    // Check if user is in GMT+8
    const offsetMinutes = new Date().getTimezoneOffset();
    const isGMT8 = offsetMinutes === -480; // GMT+8 = -480 minutes offset

    if (isGMT8) {
      return localTime;
    }

    // Show GMT+8 time in parentheses with arrow
    // If user offset > -480, GMT+8 is ahead (→), else behind (←)
    const arrow = offsetMinutes > -480 ? '→' : '←';
    const gmt8Time = m.utcOffset(8).format('h:mm A');
    return `${localTime} <span class="raid-time-gmt8">(<span class="raid-time-arrow">${arrow}</span> ${gmt8Time} GMT+8)</span>`;
  },

  /**
   * Apply a generated lineup result to the editor
   */
  applyGeneratedLineup(result, raidType) {
    // Set raid type if provided
    if (raidType) {
      this.currentLineup.raidType = raidType;
      const raidTypeSelect = document.getElementById('raid-type');
      if (raidTypeSelect) raidTypeSelect.value = raidType;
      // Sync editor state for new raid type
      this.loadExistingLineups();
    }

    this.currentLineup.players = [];
    this.currentLineup.ticketSlots = Array(8).fill(false);
    this.currentLineup.pilotSlots = Array(8).fill('');
    this._clearSlotElements();

    for (let idx = 0; idx < result.length; idx++) {
      const entry = result[idx];
      try {
        if (entry.isGuest) {
          this.assignPubPlayerToSlot(idx, '', entry.role);
        } else {
          this.assignPlayerToSlot(idx, entry.name);
        }
      } catch (e) {
        console.error(`Failed to assign slot ${idx}:`, entry, e);
      }
    }

    this.renderAvailablePlayers();
    this.updateDamageAmpDisplay();
    this.updateConflictWarnings();

    const { physical, magic } = this.calculateDamageAmp();
    const guestCount = result.filter(e => e.isGuest).length;
    const guestMsg = guestCount > 0 ? ` (${guestCount} guest slot${guestCount !== 1 ? 's' : ''})` : '';
    toast.success(`Lineup generated! Physical: ${physical}%, Magic: ${magic}%${guestMsg}`);
  },

  /**
   * Open the Lineup Creator modal and apply the generated lineup
   */
  async openLineupCreator() {
    const hasContent = this.currentLineup.players.some(p => p);

    showLineupCreatorModal({
      onLoadInEditor: async ({ result, raidType }) => {
        if (hasContent) {
          const confirmed = await modal.confirm(
            'This will replace the current lineup slots. Continue?',
            { title: 'Generate Lineup', confirmText: 'Generate', cancelText: 'Cancel', danger: true }
          );
          if (!confirmed) return;
        }
        this.applyGeneratedLineup(result, raidType);
      }
    });
  },

  /**
   * Cleanup when leaving the page
   */
  destroy() {
    if (this.flatpickrInstance) {
      this.flatpickrInstance.destroy();
      this.flatpickrInstance = null;
    }
    if (this.lineupSubscription) {
      dataService.unsubscribe(this.lineupSubscription);
      this.lineupSubscription = null;
    }
    this.leaveLineupPresence();
  }
};

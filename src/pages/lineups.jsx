import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { authService } from '../auth.js';
import { modal } from '../modal.js';
import { EQUIPMENT_RARITIES, EQUIPMENT_ICONS, WEAPON_SUFFIXES, DAMAGE_AMP_SOURCES, formatEquipmentText, formatPlayerEquipmentHtml, calculateGearscore, getGearscoreTier, getClassSpriteStyle } from '../constants.js';
import moment from 'moment';

export const LineupsPage = {
  currentRaidType: 'Hardcore',
  currentShowcaseLineup: null,
  allLineups: [],
  cachedPlayerMap: null,
  pendingTicketChanges: {}, // Track unsaved ticket changes per lineup by ID: { lineupId: [true, false, ...] }
  showNextWeek: false,
  lineupSubscription: null, // Supabase realtime subscription
  pendingToggleId: null, // Track lineup being toggled by current user to skip self-notification

  /**
   * Format raid time for display using moment.js
   */
  formatRaidTime(isoString) {
    if (!isoString) return null;
    const m = moment(isoString);
    const formatted = m.format('ddd, MMM D, h:mm A');
    const relative = m.fromNow();
    return `${formatted} <span class="raid-time-relative">(${relative})</span>`;
  },

  async render(container) {
    container.innerHTML = `
      <div class="lineups-page">
        <h1>Ready Raid Lineups</h1>
        <div class="raid-tabs">
          <button class="tab-button ${this.currentRaidType === 'Hardcore' ? 'active' : ''}" data-raid-type="Hardcore">GDN Hardcore</button>
          <button class="tab-button ${this.currentRaidType === 'Classic' ? 'active' : ''}" data-raid-type="Classic">GDN Classic</button>
        </div>
        <div class="tab-content-wrapper">
          <div class="showcase-area">
            <div id="showcase-card-container">
              <div class="loading">Loading lineup...</div>
            </div>
          </div>
          <div class="carousel-area">
            <div class="carousel-header">
              <h3>Lineups</h3>
              <label class="show-next-week-toggle">
                <input type="checkbox" id="show-next-week-checkbox">
                <span>Show Next Week</span>
              </label>
            </div>
            <div class="carousel-wrapper">
              <button id="carousel-prev" class="carousel-nav-btn carousel-prev" aria-label="Scroll left">◀</button>
              <div id="existing-lineups-container" class="existing-lineups-container">
                <div class="loading">Loading lineups...</div>
              </div>
              <button id="carousel-next" class="carousel-nav-btn carousel-next" aria-label="Scroll right">▶</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupTabHandlers();
    this.setupShowcaseSwipeHandlers();
    this.setupCarouselDragScroll();
    this.setupNextWeekToggle();
    this.loadLineups();

    // Close damage amp tooltips when clicking elsewhere
    document.addEventListener('click', () => {
      document.querySelectorAll('.damage-amp-tooltip.open').forEach(t => t.classList.remove('open'));
    });
  },

  setupTabHandlers() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const raidType = button.dataset.raidType;
        this.switchRaidType(raidType);
      });
    });
  },

  setupNextWeekToggle() {
    const checkbox = document.getElementById('show-next-week-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        this.showNextWeek = e.target.checked;
        this.renderCarousel(this.cachedPlayerMap);
        this.setupCarouselHandlers();
      });
    }
  },

  setupShowcaseSwipeHandlers() {
    const showcaseArea = document.querySelector('.showcase-area');
    if (!showcaseArea) return;

    let touchStartX = 0;
    let touchEndX = 0;

    showcaseArea.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    showcaseArea.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleShowcaseSwipe(touchStartX, touchEndX);
    }, { passive: true });
  },

  handleShowcaseSwipe(startX, endX) {
    const swipeThreshold = 50;
    const diff = startX - endX;

    if (Math.abs(diff) > swipeThreshold) {
      const currentRaidLineups = this.allLineups.filter(
        lineup => lineup.raidType === this.currentRaidType && lineup.status === 'Ready'
      );

      if (currentRaidLineups.length === 0) return;

      const currentIndex = currentRaidLineups.findIndex(
        lineup => lineup.id === this.currentShowcaseLineup?.id
      );

      let newIndex;
      if (diff > 0) {
        // Swiped left - next lineup
        newIndex = (currentIndex + 1) % currentRaidLineups.length;
      } else {
        // Swiped right - previous lineup
        newIndex = (currentIndex - 1 + currentRaidLineups.length) % currentRaidLineups.length;
      }

      const newLineup = currentRaidLineups[newIndex];
      this.selectLineup(newLineup.id);
    }
  },

  switchRaidType(raidType) {
    if (this.currentRaidType === raidType) return;

    this.currentRaidType = raidType;

    // Update active tab button
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      if (button.dataset.raidType === raidType) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });

    // Reload lineups for new raid type
    this.loadLineups();
  },

  getEquipmentBackground(player) {
    if (!player) return '';

    const equip = player.equipment || {};
    const weaponRarityVal = equip.mainWeapon?.rarity || player.weapon || '';
    const armorRarityVal = equip.helmet?.rarity || player.armor || '';

    const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === weaponRarityVal);
    const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === armorRarityVal);

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

  calculateDamageAmp(lineup, playerMap) {
    // Collect all roles from the lineup
    const roles = [];
    lineup.players.forEach(playerName => {
      if (!playerName) return;

      let role = null;
      if (playerName.startsWith('[PUB]')) {
        // Guest player - extract role from format [PUB]Name|Role
        const parts = playerName.substring(5).split('|');
        role = parts[1];
      } else {
        const player = playerMap.get(playerName);
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

    return {
      physical: physicalAmp,
      magic: magicAmp,
      physicalCapped: Math.min(physicalAmp, 100),
      magicCapped: Math.min(magicAmp, 100),
      physicalSources,
      magicSources
    };
  },

  async loadLineups() {
    const showcaseContainer = document.getElementById('showcase-card-container');
    const carouselContainer = document.getElementById('existing-lineups-container');

    if (!dataService.isConfigured()) {
      showcaseContainer.innerHTML = `
        <div class="setup-message">
          <h2>Google Sheets Not Configured</h2>
          <p>Please set up your Google Sheet to get started.</p>
          <button id="setup-btn" class="btn btn-primary">Setup Google Sheets</button>
        </div>
      `;

      document.getElementById('setup-btn').addEventListener('click', () => {
        this.showSetupModal();
      });
      carouselContainer.innerHTML = '';
      return;
    }

    try {
      const [lineups, players] = await Promise.all([
        dataService.getLineups(),
        dataService.getPlayers()
      ]);

      // Clear pending ticket changes when fresh data is loaded
      this.pendingTicketChanges = {};

      this.allLineups = lineups.filter(l => l.raidType === this.currentRaidType);

      if (this.allLineups.length === 0) {
        showcaseContainer.innerHTML = `<div class="empty-state">No ${this.currentRaidType} lineups yet!</div>`;
        carouselContainer.innerHTML = `<div class="empty-state">No lineups yet</div>`;
        return;
      }

      this.cachedPlayerMap = new Map(players.map(p => [p.name, p]));

      // Sort lineups: cleared ones last
      this.allLineups.sort((a, b) => {
        // Non-cleared first (false < true)
        if (a.completed === b.completed) return 0;
        return a.completed ? 1 : -1;
      });

      // Auto-select first lineup if none selected or current selection not in filtered list
      if (!this.currentShowcaseLineup) {
        this.currentShowcaseLineup = this.allLineups[0];
      } else {
        // Update to the fresh lineup object (to get updated completed status)
        const freshLineup = this.allLineups.find(l => l.id === this.currentShowcaseLineup.id);
        if (freshLineup) {
          this.currentShowcaseLineup = freshLineup;
        } else {
          // Current lineup no longer exists in this raid type, select first
          this.currentShowcaseLineup = this.allLineups[0];
        }
      }

      // Render showcase and carousel
      this.renderShowcase(this.currentShowcaseLineup, this.cachedPlayerMap);
      this.renderCarousel(this.cachedPlayerMap);
      this.setupCarouselHandlers();

      // Setup realtime subscription (only once)
      this.setupRealtimeSubscription();
    } catch (error) {
      showcaseContainer.innerHTML = `<div class="error">Error loading lineups: ${error.message}</div>`;
      carouselContainer.innerHTML = '';
    }
  },

  renderShowcase(lineup, playerMap) {
    const showcaseContainer = document.getElementById('showcase-card-container');
    const isAdmin = authService.isAdmin();

    // Check if lineup is cleared
    const isCleared = lineup.completed;
    const hasPendingChanges = this.hasPendingTicketChanges(lineup);

    // Determine button text
    let buttonText = isCleared ? 'Not cleared' : 'Clear';
    if (hasPendingChanges && !isCleared) {
      buttonText = 'Save & Clear';
    }

    // Calculate damage amp
    const damageAmp = this.calculateDamageAmp(lineup, playerMap);

    // Build tooltip content
    const physicalTooltip = damageAmp.physicalSources.length > 0
      ? damageAmp.physicalSources.map(s => `<div class="tooltip-row"><span class="tooltip-class">${s.class}</span><span class="tooltip-skill">${s.skill}</span><span class="tooltip-value">${s.value}%</span></div>`).join('')
      : '<div class="tooltip-empty">No sources</div>';
    const magicTooltip = damageAmp.magicSources.length > 0
      ? damageAmp.magicSources.map(s => `<div class="tooltip-row"><span class="tooltip-class">${s.class}</span><span class="tooltip-skill">${s.skill}</span><span class="tooltip-value">${s.value}%</span></div>`).join('')
      : '<div class="tooltip-empty">No sources</div>';

    const raidTimeDisplay = this.formatRaidTime(lineup.raidTime);

    showcaseContainer.innerHTML = `
      <div class="lineup-card showcase-lineup-card ${isCleared ? 'cleared' : ''} ${lineup.isNextWeek ? 'next-week' : ''}">
        <div class="lineup-card-header">
          <div class="lineup-card-title">
            <h3>
              ${lineup.isNextWeek ? '<span class="next-week-badge">Next Week</span>' : ''}
              ${lineup.name}
            </h3>
            ${raidTimeDisplay ? `<span class="raid-time-display"><img src="/icons/calendarclock.svg" alt="" class="raid-time-icon">${raidTimeDisplay}</span>` : ''}
          </div>
          ${isAdmin ? `<button class="btn btn-primary btn-cleared ${hasPendingChanges ? 'has-pending' : ''}" data-lineup-id="${lineup.id}">${buttonText}</button>` : ''}
        </div>
        <div class="damage-amp-display">
          <div class="damage-amp-bar physical">
            <span class="damage-amp-label">Physical</span>
            <div class="damage-amp-track">
              <div class="damage-amp-fill ${damageAmp.physical >= 100 ? (damageAmp.physical > 100 ? 'overcapped' : 'capped') : ''}" style="width: ${damageAmp.physicalCapped}%"></div>
            </div>
            <div class="damage-amp-value-wrapper">
              <span class="damage-amp-value ${damageAmp.physical > 100 ? 'overcapped' : ''}">${damageAmp.physical}%</span>
              <div class="damage-amp-tooltip">${physicalTooltip}</div>
            </div>
          </div>
          <div class="damage-amp-bar magic">
            <span class="damage-amp-label">Magic</span>
            <div class="damage-amp-track">
              <div class="damage-amp-fill ${damageAmp.magic >= 100 ? (damageAmp.magic > 100 ? 'overcapped' : 'capped') : ''}" style="width: ${damageAmp.magicCapped}%"></div>
            </div>
            <div class="damage-amp-value-wrapper">
              <span class="damage-amp-value ${damageAmp.magic > 100 ? 'overcapped' : ''}">${damageAmp.magic}%</span>
              <div class="damage-amp-tooltip">${magicTooltip}</div>
            </div>
          </div>
        </div>
        <div class="lineup-players">
          ${lineup.players.map((playerName, idx) => {
        // Check if lineup is cleared (all players completed)
        const lineupPlayers = lineup.players.map(name => playerMap.get(name)).filter(p => p);

            // Check ticket status for this player (Classic only)
            const hasTicket = lineup.ticketPlayers && lineup.ticketPlayers[idx];
            const showTicketFlag = lineup.raidType === 'Classic';

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
              player = playerMap.get(playerName);
            }

            const backgroundStyle = isPub ? 'background: repeating-linear-gradient(45deg, rgba(255, 193, 7, 0.11), rgba(255, 193, 7, 0.15) 10px, rgba(0, 0, 0, 0.3) 10px, rgba(0, 0, 0, 0.3) 20px); border: 2px dashed rgba(255, 193, 7, 0.5);' : this.getEquipmentBackground(player);

            if (!player) {
              return `
                <div class="player-slot empty">
                  <span class="slot-number">${idx + 1}</span>
                  <span class="player-name">${playerName || 'Empty'}</span>
                </div>
              `;
            }

            // Check pilot status for this player (only for non-guest)
            const pilotName = !isPub && lineup.pilotPlayers && lineup.pilotPlayers[idx] ? lineup.pilotPlayers[idx] : '';
            const pilotDisplay = pilotName ? `<span class="pilot-info"><img src="/icons/headphones.svg" alt="Pilot" class="pilot-info-icon">${pilotName}</span>` : '';

            return `
            <div class="player-slot ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">${showTicketFlag && !isPub ? `<div class="ticket-flag ${hasTicket ? 'ticket-flag--active' : 'ticket-flag--inactive'} ${isAdmin ? 'ticket-flag--clickable' : ''}" data-slot-index="${idx}" title="${hasTicket ? 'Using ticket' : 'No ticket'}${isAdmin ? ' (click to toggle)' : ''}"><img src="/icons/ticket.svg" alt="Ticket"></div>` : ''}
              ${player.role ? `<div class="class-sprite slot-class-bg" style="${getClassSpriteStyle(player.role)}"></div>` : ''}
              <span class="slot-number">${idx + 1}</span>
              <div class="player-slot-info">
                <span class="player-name">${player.name} ${isPub ? '<span class="pub-badge">GUEST</span>' : (() => { const gs = calculateGearscore(player); const tier = getGearscoreTier(gs); return `<span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg};" data-tooltip="Gearscore">${gs}</span>`; })()}</span>
                ${pilotDisplay}
                ${player.role ? `<span class="player-role">${player.role}</span>` : ''}
                ${!isPub ? formatPlayerEquipmentHtml(player, 'player-equipment-compact') : ''}
              </div>
            </div>
          `;
          }).join('')}
          ${Array(8 - lineup.players.length).fill(0).map((_, idx) => `
            <div class="player-slot empty">
              <span class="slot-number">${lineup.players.length + idx + 1}</span>
              <span class="player-name">Empty</span>
            </div>
          `).join('')}
        </div>
        ${lineup.notes ? `<div class="lineup-notes-display"><span class="notes-label">Notes:</span> ${lineup.notes}</div>` : ''}
      </div>
    `;

    // Add click handler for cleared button if admin
    if (isAdmin) {
      const clearedBtn = showcaseContainer.querySelector('.btn-cleared');
      if (clearedBtn) {
        clearedBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lineupId = clearedBtn.dataset.lineupId;
          await this.handleClearedClick(lineupId);
        });
      }

      // Add click handlers for ticket flags (Classic only)
      const ticketFlags = showcaseContainer.querySelectorAll('.ticket-flag--clickable');
      ticketFlags.forEach(flag => {
        flag.addEventListener('click', async (e) => {
          e.stopPropagation();
          const slotIndex = parseInt(flag.dataset.slotIndex, 10);
          await this.handleTicketToggle(lineup, slotIndex);
        });
      });
    }

    // Mobile tap-to-toggle for damage amp tooltips
    const ampWrappers = showcaseContainer.querySelectorAll('.damage-amp-value-wrapper');
    ampWrappers.forEach(wrapper => {
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
  },

  renderCarousel(playerMap) {
    const carouselContainer = document.getElementById('existing-lineups-container');

    // Filter next-week lineups based on toggle
    const lineupsToShow = this.showNextWeek
      ? this.allLineups
      : this.allLineups.filter(l => !l.isNextWeek);

    if (lineupsToShow.length === 0) {
      carouselContainer.innerHTML = `<div class="empty-state">No lineups to show</div>`;
      return;
    }

    carouselContainer.innerHTML = lineupsToShow.map(lineup => {
      // Check if lineup is cleared
      const isCleared = lineup.completed;
      const isSelected = this.currentShowcaseLineup && lineup.id === this.currentShowcaseLineup.id;

      // Create 8 mini player cards in 2x4 grid
      const playerCards = Array(8).fill(0).map((_, idx) => {
        const playerName = lineup.players[idx];

        // Check ticket status for this player (Classic only)
        const hasTicket = lineup.ticketPlayers && lineup.ticketPlayers[idx];
        const showTicketFlag = lineup.raidType === 'Classic';

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

        // Check pilot status for this player (only for non-guest)
        const pilotName = !isPub && lineup.pilotPlayers && lineup.pilotPlayers[idx] ? lineup.pilotPlayers[idx] : '';
        const pilotDisplay = pilotName ? `<span class="pilot-info-mini"><img src="/icons/headphones.svg" alt="Pilot" class="pilot-info-icon-mini">${pilotName}</span>` : '';

        return `
          <div class="mini-player-card ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">${showTicketFlag && !isPub ? `<div class="ticket-flag-mini ${hasTicket ? 'ticket-flag--active' : 'ticket-flag--inactive'}" title="${hasTicket ? 'Using ticket' : 'No ticket'}"><img src="/icons/ticket.svg" alt="T"></div>` : ''}
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
        <div class="mini-lineup-card ${isCleared ? 'cleared' : ''} ${isSelected ? 'selected' : ''} ${lineup.isNextWeek ? 'next-week' : ''}" data-lineup-id="${lineup.id}">
          <div class="mini-lineup-header">
            <span class="mini-lineup-name">
              ${lineup.isNextWeek ? '<span class="next-week-badge-mini">NW</span>' : ''}
              ${lineup.name}
            </span>
            <div class="mini-lineup-header-actions">
              <span class="mini-lineup-raid-type">GDN ${lineup.raidType || 'Hardcore'}</span>
            </div>
          </div>
          <div class="mini-lineup-grid">
            ${playerCards}
          </div>
        </div>
      `;
    }).join('');
  },

  selectLineup(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) return;

    this.currentShowcaseLineup = lineup;

    // Use cached player data for instant rendering
    if (this.cachedPlayerMap) {
      this.renderShowcase(lineup, this.cachedPlayerMap);
      this.updateCarouselSelection(lineupId);
    }
  },

  updateCarouselSelection(lineupId) {
    const carouselCards = document.querySelectorAll('.mini-lineup-card');
    carouselCards.forEach(card => {
      if (card.dataset.lineupId === lineupId) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  },


  setupCarouselHandlers() {
    const carouselCards = document.querySelectorAll('.mini-lineup-card');
    carouselCards.forEach(card => {
      // Prevent default drag behavior on cards to allow container drag
      card.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });

      card.addEventListener('click', () => {
        const lineupId = card.dataset.lineupId;
        this.selectLineup(lineupId);
      });
    });

    // Setup arrow button handlers
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
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

  async handleClearedClick(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) {
      toast.error('Lineup not found');
      return;
    }

    const hasPendingChanges = this.hasPendingTicketChanges(lineup);
    let confirmMessage = `${lineup.completed ? 'Di pa ba na clear' : 'Cleared na ba'} ang lineup <strong>${lineup.name}</strong>?`;

    if (hasPendingChanges && !lineup.completed) {
      confirmMessage += `<br><br><small style="color: #f4c430;">Ticket changes will be saved.</small>`;
    }

    const confirmed = await modal.confirm(
      confirmMessage,
      {
        title: 'Cleared Status',
        confirmText: lineup.completed ? 'Not Cleared' : 'Cleared',
        cancelText: 'Cancel'
      }
    );

    if (!confirmed) return;

    try {
      // If there are pending ticket changes and we're marking as cleared, save them first
      if (hasPendingChanges && !lineup.completed) {
        const ticketPlayers = this.pendingTicketChanges[lineup.id];

        await dataService.updateLineup({
          id: lineup.id,
          name: lineup.name,
          raidType: lineup.raidType,
          status: lineup.status,
          players: lineup.players,
          ticketPlayers: ticketPlayers,
          pilotPlayers: lineup.pilotPlayers,
          completed: lineup.completed,
          isNextWeek: lineup.isNextWeek
        });

        // Clear pending changes after saving
        this.clearPendingTicketChanges(lineup);
      }

      // Mark as pending to skip self-notification from realtime
      this.pendingToggleId = lineup.id;
      await dataService.toggleLineupCompleted(lineup.id);
      // Delay clearing pendingToggleId to give realtime event time to arrive
      setTimeout(() => {
        if (this.pendingToggleId === lineup.id) {
          this.pendingToggleId = null;
        }
      }, 2000);
      toast.success(`Updated cleared status for ${lineup.name}!`);
      // Reload the lineups to show updated cleared status
      await this.loadLineups();
    } catch (error) {
      // Clear immediately on error since no realtime event will arrive
      this.pendingToggleId = null;
      toast.error(`Error: ${error.message}`);
    }
  },

  handleTicketToggle(lineup, slotIndex) {
    // Initialize pending changes from current state if not exists
    if (!this.pendingTicketChanges[lineup.id]) {
      this.pendingTicketChanges[lineup.id] = [...(lineup.ticketPlayers || Array(8).fill(false))];
    }

    // Toggle the ticket status for this slot
    this.pendingTicketChanges[lineup.id][slotIndex] = !this.pendingTicketChanges[lineup.id][slotIndex];

    // Update local lineup state for immediate UI feedback
    lineup.ticketPlayers = [...this.pendingTicketChanges[lineup.id]];

    // Re-render showcase with updated data
    this.renderShowcase(lineup, this.cachedPlayerMap);
    this.renderCarousel(this.cachedPlayerMap);
    this.setupCarouselHandlers();

    const playerName = lineup.players[slotIndex];
    const ticketStatus = this.pendingTicketChanges[lineup.id][slotIndex] ? 'using ticket' : 'no ticket';
    toast.info(`${playerName}: ${ticketStatus} (pending)`);
  },

  hasPendingTicketChanges(lineup) {
    return !!this.pendingTicketChanges[lineup.id];
  },

  clearPendingTicketChanges(lineup) {
    delete this.pendingTicketChanges[lineup.id];
  },

  showSetupModal() {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Google Sheets Setup</h2>
        <div class="setup-instructions">
          <h3>Instructions:</h3>
          <ol>
            <li>Create a new Google Sheet</li>
            <li>Create two sheets: "Players" and "Lineups"</li>
            <li>In Characters sheet, add headers: Name, Class, Notes, Weapon, WeaponEnhance, Armor, ArmorEnhance, Completed</li>
            <li>In Lineups sheet, add headers: Name, Status, Player1, Player2, Player3, Player4, Player5, Player6, Player7, Player8</li>
            <li>Get your Sheet ID from the URL (between /d/ and /edit)</li>
            <li>Create a Google Cloud project and enable Sheets API</li>
            <li>Create an API key with Sheets API access</li>
          </ol>
        </div>
        <form id="setup-form">
          <div class="form-group">
            <label for="sheet-id">Sheet ID:</label>
            <input type="text" id="sheet-id" required placeholder="1a2B3c4D5e6F7g8H9i0J">
            <small style="color: #888;">API key is now securely stored on the server</small>
          </div>
          <div class="form-group">
            <label for="password">Password (optional):</label>
            <input type="text" id="password" placeholder="Share this with editors">
          </div>
          <div class="form-group">
            <label for="apps-script-url">Apps Script URL (for write access):</label>
            <input type="text" id="apps-script-url" placeholder="https://script.google.com/macros/s/.../exec">
            <small style="color: #888;">Leave empty for read-only mode</small>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    document.getElementById('setup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const sheetId = document.getElementById('sheet-id').value;
      const password = document.getElementById('password').value;
      const appsScriptUrl = document.getElementById('apps-script-url').value;

      dataService.configure(sheetId, password, appsScriptUrl);
      document.body.removeChild(modalElement);
      toast.success('Google Sheets configured successfully!');
      this.loadLineups();
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

  /**
   * Setup realtime subscription for lineup changes
   */
  setupRealtimeSubscription() {
    // Only setup once
    if (this.lineupSubscription) return;

    this.lineupSubscription = dataService.subscribeToLineups((payload) => {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      const changedLineupId = newRecord?.id || oldRecord?.id;

      // Skip notification if this user initiated the toggle
      if (this.pendingToggleId === changedLineupId) {
        return;
      }

      // Check if the change affects the currently viewed lineup
      const isCurrentLineup = this.currentShowcaseLineup?.id === changedLineupId;

      if (isCurrentLineup) {
        // Show warning toast with reload button
        toast.showWithAction(
          'This lineup was updated by another user.',
          'Reload',
          () => this.loadLineups(),
          'warning'
        );
      } else {
        // Silently refresh the carousel for other lineups
        this.loadLineups();
      }
    });
  },

  /**
   * Cleanup when leaving the page
   */
  destroy() {
    if (this.lineupSubscription) {
      dataService.unsubscribe(this.lineupSubscription);
      this.lineupSubscription = null;
    }
  }
};

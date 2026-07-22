import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { authService } from '../auth.js';
import { modal } from '../modal.js';
import { EQUIPMENT_RARITIES, EQUIPMENT_ICONS, WEAPON_SUFFIXES, DAMAGE_AMP_SOURCES, formatEquipmentText, formatPlayerEquipmentHtml, calculateGearscore, getGearscoreTier, getClassSpriteStyle, getLineupSize, isFourManRaid, formatRaidTypeLabel } from '../constants.js';
import { renderGearscoreBadge, initChipTooltip } from '../chip-tooltip.js';
import { renderMiniLineupCard, renderMiniPlayerCards, getEquipmentBackground } from '../mini-carousel.js';
import moment from 'moment';
import { formatAvailabilityRange, getBrowserTimezone, shouldShowAvailabilityForRaid } from '../availability.js';
import { initFixedTooltip } from '../fixed-tooltip.js';
import { lootUiMixin } from '../loot-ui.js';

export const LineupsPage = {
  ...lootUiMixin,
  // Re-render after a loot mixin change — the showcase card for a live lineup, or
  // the record's card in the Loot Log section for an archived record.
  _lootRerender(ctx) {
    if (ctx.isRecord) {
      this.rerenderLootRecordCard(ctx);
    } else {
      this.renderShowcase(ctx, this.cachedPlayerMap);
    }
  },
  activeSection: 'lineups', // 'lineups' | 'loot-log'
  currentRaidType: 'DDN Hardcore',
  currentShowcaseLineup: null,
  allLineups: [],
  cachedPlayerMap: null,
  pendingTicketChanges: {}, // Track unsaved ticket changes per lineup by ID: { lineupId: [true, false, ...] }
  showNextWeek: false,
  lineupSubscription: null, // Supabase realtime subscription
  lootSubscription: null, // Supabase realtime subscription for lineup_loot (web ⇄ discord)
  payoutSubscription: null, // Supabase realtime subscription for lineup_payouts (web ⇄ discord)
  lootRecordSubscription: null, // Supabase realtime subscription for loot_records
  pendingToggleId: null, // Track lineup being toggled by current user to skip self-notification
  pendingDeleteId: null, // Track lineup being archived/deleted by current user to skip self-notification
  lootViewActive: null, // Cleared-card loot view: null = auto (on when loot exists), else explicit
  editingLootId: null, // Loot entry currently being inline-edited (null = none)
  editingForceSold: false, // When opening edit via "Mark sold", pre-check the Sold toggle
  lootRecords: [], // Loot Log section: archived loot records
  showSettledLoot: false, // Loot Log filter: hide fully-resolved records by default
  lootScope: 'mine', // Loot Log scope: 'mine' (records I'm in) | 'all'
  lootRaidFilter: 'all', // Loot Log raid-type filter: 'all' | raid type string
  _lootLogRefreshTimer: null,

  /**
   * Escape user-entered text before injecting into innerHTML
   */
  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Format a gold amount with thousands separators
   */
  formatGold(amount) {
    return (Number(amount) || 0).toLocaleString('en-US');
  },

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
        <div class="page-title-tabs">
          <h1 class="view-tab ${this.activeSection === 'lineups' ? 'active' : ''}" data-section="lineups">Raid Lineups</h1>
          <span class="title-divider">/</span>
          <h1 class="view-tab ${this.activeSection === 'loot-log' ? 'active' : ''}" data-section="loot-log">Loot Log</h1>
        </div>

        <div id="lineups-section" class="page-section" ${this.activeSection === 'lineups' ? '' : 'hidden'}>
          <div class="raid-tabs">
            <button class="tab-button ${this.currentRaidType === 'DDN Hardcore' ? 'active' : ''}" data-raid-type="DDN Hardcore">DDN Hardcore</button>
            <button class="tab-button ${this.currentRaidType === 'DDN Classic' ? 'active' : ''}" data-raid-type="DDN Classic">DDN Classic</button>
            <button class="tab-button ${this.currentRaidType === 'Hardcore' ? 'active' : ''}" data-raid-type="Hardcore">GDN Hardcore</button>
            <button class="tab-button ${this.currentRaidType === 'Classic' ? 'active' : ''}" data-raid-type="Classic">GDN Classic</button>
            <button class="tab-button ${this.currentRaidType === 'Unspecified' ? 'active' : ''}" data-raid-type="Unspecified">Unspecified</button>
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

        <div id="loot-log-section" class="page-section loot-log-section" ${this.activeSection === 'loot-log' ? '' : 'hidden'}>
          <div class="loot-log-header">
            <div class="loot-log-filters">
              <div class="loot-scope-toggle">
                <button class="loot-scope-btn ${this.lootScope === 'mine' ? 'active' : ''}" data-scope="mine">My loot</button>
                <button class="loot-scope-btn ${this.lootScope === 'all' ? 'active' : ''}" data-scope="all">All loot</button>
              </div>
              <select class="loot-raid-select" aria-label="Filter by raid">
                <option value="all">All raids</option>
              </select>
              <button class="btn btn-secondary loot-log-filter" type="button"></button>
            </div>
            <p class="loot-log-sub">Loot from cleared raids — finish selling and splitting here. Settled records clear on the next weekly reset.</p>
          </div>
          <div id="loot-log-list"><div class="loot-log-loading">Loading loot records…</div></div>
        </div>
      </div>
    `;

    this.setupSectionTabs();
    this.setupTabHandlers();
    this.setupShowcaseSwipeHandlers();
    this.setupCarouselDragScroll();
    this.setupNextWeekToggle();
    this.setupLootLogFilter();
    this.loadLineups();
    this.setupSubscriptions();
    if (this.activeSection === 'loot-log') this.loadLootRecords();
    initChipTooltip();

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

  setupSectionTabs() {
    document.querySelectorAll('.lineups-page .page-title-tabs .view-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchSection(btn.dataset.section));
    });
  },

  // Toggle between the "Raid Lineups" and "Loot Log" sections of this page.
  switchSection(section) {
    if (this.activeSection === section) return;
    this.activeSection = section;

    document.querySelectorAll('.lineups-page .page-title-tabs .view-tab').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.section === section));
    const lineupsEl = document.getElementById('lineups-section');
    const lootEl = document.getElementById('loot-log-section');
    if (lineupsEl) lineupsEl.hidden = section !== 'lineups';
    if (lootEl) lootEl.hidden = section !== 'loot-log';

    if (section === 'loot-log') this.loadLootRecords();
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
    return getEquipmentBackground(player);
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
      const [lineups, players, appUsers] = await Promise.all([
        dataService.getLineups(),
        dataService.getPlayers(),
        dataService.getAppUsers().catch(() => [])
      ]);

      // Clear pending ticket changes when fresh data is loaded
      this.pendingTicketChanges = {};

      this._userMap = {};
      (appUsers || []).forEach(u => { this._userMap[u.discordId] = u; });

      this.allLineups = lineups.filter(l => l.raidType === this.currentRaidType);

      if (this.allLineups.length === 0) {
        showcaseContainer.innerHTML = `<div class="empty-state">No ${this.currentRaidType} lineups yet!</div>`;
        carouselContainer.innerHTML = `<div class="empty-state">No lineups yet</div>`;
        return;
      }

      this.cachedPlayerMap = new Map(players.map(p => [p.name, p]));

      // Sort lineups: cleared ones last, then by name using natural numeric order
      this.allLineups.sort((a, b) => {
        // Non-cleared first (false < true)
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
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
    } catch (error) {
      showcaseContainer.innerHTML = `<div class="error">Error loading lineups: ${error.message}</div>`;
      carouselContainer.innerHTML = '';
    }
  },

  renderShowcase(lineup, playerMap) {
    const showcaseContainer = document.getElementById('showcase-card-container');
    const canManage = authService.canEditLineups();

    // Check if lineup is cleared
    const isCleared = lineup.completed;
    const hasPendingChanges = this.hasPendingTicketChanges(lineup);

    // Loot view: only on cleared cards. Defaults on when there's loot (auto), and
    // the Loot button can override; only available when there's loot or the user
    // can add some.
    const lootCount = (lineup.loot || []).length;
    const wantLootView = this.lootViewActive === null ? lootCount > 0 : this.lootViewActive;
    const lootViewActive = isCleared && wantLootView && (lootCount > 0 || canManage);

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
      <div class="lineup-card showcase-lineup-card ${isCleared ? 'cleared' : ''} ${lootViewActive ? 'loot-view' : ''} ${lineup.isNextWeek ? 'next-week' : ''} ${lineup.isStatic ? 'static' : ''}">
        <div class="lineup-card-header">
          <div class="lineup-card-title">
            <h3>
              ${lineup.isNextWeek ? '<span class="next-week-badge">Next Week</span>' : ''}
              ${lineup.isStatic ? '<img src="/icons/group.svg" class="static-icon" title="Permanent lineup — same members every week" alt="Permanent">' : ''}
              ${lineup.name}
            </h3>
            ${raidTimeDisplay ? `<span class="raid-time-display"><img src="/icons/calendarclock.svg" alt="" class="raid-time-icon">${raidTimeDisplay}</span>` : ''}
          </div>
          ${canManage && this.currentRaidType === 'Unspecified' ? `
            <select class="raid-type-reassign" data-lineup-id="${lineup.id}">
              <option value="Unspecified" selected>Unspecified</option>
              <option value="DDN Hardcore">DDN Hardcore</option>
              <option value="DDN Classic">DDN Classic</option>
              <option value="Hardcore">GDN Hardcore</option>
              <option value="Classic">GDN Classic</option>
            </select>
          ` : ''}
          ${isCleared && (lootCount > 0 || canManage) ? `<button class="btn btn-secondary btn-loot-toggle ${lootViewActive ? 'active' : ''}" data-lineup-id="${lineup.id}"><img src="/icons/scales.svg" alt="" class="btn-loot-icon">${lootViewActive ? 'Hide Loot' : `Loot${lootCount > 0 ? ` (${lootCount})` : ''}`}</button>` : ''}
          ${isCleared && canManage && !lineup.isStatic ? `<button class="btn btn-secondary btn-keep-week ${lineup.isNextWeek ? 'active' : ''}" data-lineup-id="${lineup.id}" data-tooltip-fixed="${lineup.isNextWeek ? 'Kept for next week. Click to stop keeping' : 'Keep for next week. Survives the reset, runnable again'}"><img src="/icons/calendarclock.svg" alt="" class="btn-loot-icon">${lineup.isNextWeek ? 'Keeping ✓' : 'Keep'}</button>` : ''}
          ${isCleared && canManage && lootCount > 0 && !lineup.isStatic ? `<button class="btn btn-secondary btn-archive-loot" data-lineup-id="${lineup.id}" data-tooltip-fixed="Move loot to the Loot Log and free the members"><img src="/icons/archive.svg" alt="" class="btn-loot-icon">Archive</button>` : ''}
          ${canManage && this.currentRaidType !== 'Unspecified' ? `<button class="btn btn-primary btn-cleared ${hasPendingChanges ? 'has-pending' : ''}" data-lineup-id="${lineup.id}">${buttonText}</button>` : ''}
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
        <div class="lineup-players ${isFourManRaid(lineup.raidType) ? 'four-man' : ''} ${lootViewActive ? 'as-mini' : ''}">
          ${lootViewActive ? `<div class="mini-lineup-grid ${isFourManRaid(lineup.raidType) ? 'four-man' : ''}">${renderMiniPlayerCards(lineup, playerMap)}</div>` : ''}
          ${(() => {
            const showAvail = shouldShowAvailabilityForRaid(lineup.raidType);
            const viewerTz = getBrowserTimezone();
            const userMap = this._userMap || {};
            const ownerAvailHtml = (player) => {
              if (!showAvail || !player?.discordId) return '';
              const owner = userMap[player.discordId];
              if (!owner) return '';
              const text = formatAvailabilityRange({
                availableFrom: owner.availableFrom,
                logOffTime: owner.logOffTime,
                timezone: owner.availabilityTimezone,
                anytime: owner.availableAnytime
              }, viewerTz);
              return text ? `<span class="player-slot-availability" data-tooltip-fixed="When this player is typically online (your timezone)">🕒 ${text}</span>` : '';
            };
            return lineup.players.slice(0, getLineupSize(lineup.raidType)).map((playerName, idx) => {
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
              player = { name: pubName || pubRole || 'Guest', role: (pubName ? pubRole : '') || '' };
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
            <div class="player-slot ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">${showTicketFlag && !isPub ? `<div class="ticket-flag ${hasTicket ? 'ticket-flag--active' : 'ticket-flag--inactive'} ${canManage ? 'ticket-flag--clickable' : ''}" data-slot-index="${idx}" title="${hasTicket ? 'Using ticket' : 'No ticket'}${canManage ? ' (click to toggle)' : ''}"><img src="/icons/ticket.svg" alt="Ticket"></div>` : ''}
              ${player.role ? `<div class="class-sprite slot-class-bg" style="${getClassSpriteStyle(player.role)}"></div>` : ''}
              <span class="slot-number">${idx + 1}</span>
              <div class="player-slot-info">
                <div class="player-name-row">
                  <span class="player-name">${player.name} ${isPub ? '<span class="pub-badge">GUEST</span>' : renderGearscoreBadge(player)}</span>
                  ${!isPub ? ownerAvailHtml(player) : ''}
                </div>
                ${pilotDisplay}
                ${player.role ? `<span class="player-role">${player.role}</span>` : ''}
                ${!isPub ? formatPlayerEquipmentHtml(player, 'player-equipment-compact') : ''}
              </div>
            </div>
          `;
          }).join('');
          })()}
          ${(() => {
            const size = getLineupSize(lineup.raidType);
            const filled = Math.min(lineup.players.length, size);
            return Array(Math.max(0, size - filled)).fill(0).map((_, idx) => `
              <div class="player-slot empty">
                <span class="slot-number">${filled + idx + 1}</span>
                <span class="player-name">Empty</span>
              </div>
            `).join('');
          })()}
        </div>
        ${lineup.notes ? `<div class="lineup-notes-display"><span class="notes-label">Notes:</span> ${lineup.notes}</div>` : ''}
        ${lootViewActive ? this.renderLootSection(lineup, canManage) : ''}
      </div>
    `;

    initFixedTooltip();
    // Scope to the showcase card so we don't grab a Loot Log card's .lineup-loot
    // (both sections live in the DOM at once).
    const showcaseRoot = document.getElementById('showcase-card-container') || document;
    this.setupLootHandlers(lineup, showcaseRoot);
    this.setupPayoutHandlers(lineup, showcaseRoot);

    // Loot view toggle (available to anyone who can see the Loot button)
    const lootToggleBtn = showcaseContainer.querySelector('.btn-loot-toggle');
    if (lootToggleBtn) {
      lootToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentlyOn = this.lootViewActive === null ? (lineup.loot || []).length > 0 : this.lootViewActive;

        // FLIP: capture the roster's current rect, re-render, then animate the new
        // roster from the old size/position to its new one (full ⇄ corner).
        const oldRoster = showcaseContainer.querySelector('.lineup-players');
        const firstRect = oldRoster ? oldRoster.getBoundingClientRect() : null;

        this.lootViewActive = !currentlyOn;
        this.editingLootId = null;
        this.renderShowcase(lineup, this.cachedPlayerMap);

        const newRoster = showcaseContainer.querySelector('.lineup-players');
        if (firstRect && newRoster) this.animateRosterFlip(newRoster, firstRect);
      });
    }

    // Add click handler for cleared button if admin
    if (canManage) {
      const clearedBtn = showcaseContainer.querySelector('.btn-cleared');
      if (clearedBtn) {
        clearedBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lineupId = clearedBtn.dataset.lineupId;
          await this.handleClearedClick(lineupId);
        });
      }

      // Archive: move this cleared lineup's loot into a standalone Loot Log record
      // and delete the lineup, freeing its members for new teams.
      const archiveBtn = showcaseContainer.querySelector('.btn-archive-loot');
      if (archiveBtn) {
        archiveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.handleArchiveClick(archiveBtn.dataset.lineupId);
        });
      }

      // Keep for next week: flag the team to survive the weekly reset (uncleared).
      const keepBtn = showcaseContainer.querySelector('.btn-keep-week');
      if (keepBtn) {
        keepBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.handleKeepClick(keepBtn.dataset.lineupId);
        });
      }

      // Add handler for raid type reassign dropdown (Unspecified tab only)
      const reassignSelect = showcaseContainer.querySelector('.raid-type-reassign');
      if (reassignSelect) {
        reassignSelect.addEventListener('change', async (e) => {
          const newType = e.target.value;
          if (newType === 'Unspecified') return;
          const lineupId = e.target.dataset.lineupId;
          try {
            await dataService.updateLineupRaidType(lineupId, newType);
            toast.show(`Lineup moved to ${formatRaidTypeLabel(newType)}`, 'success');
            this.currentShowcaseLineup = null;
            await this.loadLineups();
          } catch (err) {
            toast.show('Failed to update raid type', 'error');
            e.target.value = 'Unspecified';
          }
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

  /**
   * FLIP-animate the roster between its full size and the loot-view corner.
   * `firstRect` is the roster's bounding rect captured before the re-render; `el`
   * is the freshly-rendered roster. We invert (place it where it was) then
   * transition to its natural position.
   */
  animateRosterFlip(el, firstRect) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lastRect = el.getBoundingClientRect();
    if (!lastRect.width || !lastRect.height) return;

    const dx = firstRect.left - lastRect.left;
    const dy = firstRect.top - lastRect.top;
    const sx = firstRect.width / lastRect.width;
    const sy = firstRect.height / lastRect.height;

    el.style.transformOrigin = 'top left';
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    // Force reflow so the inverted transform is registered before transitioning
    void el.offsetWidth;
    el.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = 'translate(0px, 0px) scale(1, 1)';

    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.removeEventListener('transitionend', cleanup);
    };
    el.addEventListener('transitionend', cleanup);
  },

  renderCarousel(playerMap) {
    const carouselContainer = document.getElementById('existing-lineups-container');

    // Hide pure "Next Week" plans by default, but keep already-cleared teams that
    // were flagged "Keep for next week" visible — they're this week's teams.
    const lineupsToShow = this.showNextWeek
      ? this.allLineups
      : this.allLineups.filter(l => !l.isNextWeek || l.completed);

    if (lineupsToShow.length === 0) {
      carouselContainer.innerHTML = `<div class="empty-state">No lineups to show</div>`;
      return;
    }

    carouselContainer.innerHTML = lineupsToShow.map(lineup => {
      const isSelected = this.currentShowcaseLineup && lineup.id === this.currentShowcaseLineup.id;
      return renderMiniLineupCard(lineup, playerMap, { selected: isSelected });
    }).join('');
  },

  selectLineup(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) return;

    this.currentShowcaseLineup = lineup;
    // Reset loot view to auto + drop any in-progress loot edit when switching lineups
    this.lootViewActive = null;
    this.editingLootId = null;
    this.editingForceSold = false;

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
          isNextWeek: lineup.isNextWeek,
          isStatic: lineup.isStatic
        });

        // Clear pending changes after saving
        this.clearPendingTicketChanges(lineup);
      }

      // Mark as pending to skip self-notification from realtime
      this.pendingToggleId = lineup.id;
      const toggleResult = await dataService.toggleLineupCompleted(lineup.id);
      // Delay clearing pendingToggleId to give realtime event time to arrive
      setTimeout(() => {
        if (this.pendingToggleId === lineup.id) {
          this.pendingToggleId = null;
        }
      }, 2000);

      // When newly cleared, ask the bot to mark the Discord thread cleared
      // (Cleared tag + loot thread). Only if a thread exists. Fire-and-forget.
      if (toggleResult?.completed && lineup.threadId) {
        dataService.requestDiscordThreadClear(lineup.id)
          .catch(err => console.error('[DiscordThread] Clear request failed:', err));
      }

      toast.success(`Updated cleared status for ${lineup.name}!`);
      // Reload the lineups to show updated cleared status
      await this.loadLineups();
    } catch (error) {
      // Clear immediately on error since no realtime event will arrive
      this.pendingToggleId = null;
      toast.error(`Error: ${error.message}`);
    }
  },

  /**
   * Archive a cleared lineup's loot into the Loot Log and delete the lineup,
   * freeing its members for new teams while keeping the loot for tracking.
   */
  async handleArchiveClick(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) {
      toast.error('Lineup not found');
      return;
    }
    // Static teams are permanent — never delete them via Archive. Their loot is
    // rolled into the Loot Log automatically by the weekly cleanup (lineup kept).
    if (lineup.isStatic) {
      toast.error('Static teams archive their loot automatically each week — they aren\'t deleted.');
      return;
    }

    const confirmed = await modal.confirm(
      `Archive <strong>${this.escapeHtml(lineup.name)}</strong>?<br><br>` +
      `This frees the members for new teams and deletes the lineup, but keeps its ` +
      `loot in the <strong>Loot Log</strong> so you can finish selling and splitting it there.`,
      { title: 'Archive Loot', confirmText: 'Archive', cancelText: 'Cancel' }
    );
    if (!confirmed) return;

    try {
      // Skip the self-notification from the lineup DELETE realtime event.
      this.pendingDeleteId = lineup.id;
      await dataService.archiveLineupLoot(lineup.id);
      // Delay clearing so the realtime DELETE event is still suppressed on arrival.
      setTimeout(() => {
        if (this.pendingDeleteId === lineup.id) this.pendingDeleteId = null;
      }, 2000);
      toast.showWithAction(
        `Archived ${lineup.name} to the Loot Log.`,
        'Open Loot Log',
        () => this.switchSection('loot-log'),
        'success'
      );
      await this.loadLineups();
    } catch (error) {
      this.pendingDeleteId = null;
      toast.error(`Failed to archive: ${error.message}`);
    }
  },

  /**
   * Toggle "Keep for next week" on a cleared team. Flags it Next Week
   * (is_template) so it survives the Friday reset; the cleanup then resets its
   * cleared status so it's runnable again. Optimistic + lightweight update.
   */
  async handleKeepClick(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) {
      toast.error('Lineup not found');
      return;
    }

    const next = !lineup.isNextWeek;
    // Optimistic update + skip the self-notification from the realtime UPDATE
    lineup.isNextWeek = next;
    this.pendingToggleId = lineup.id;
    if (this.currentShowcaseLineup?.id === lineupId) this.currentShowcaseLineup.isNextWeek = next;
    this.renderShowcase(lineup, this.cachedPlayerMap);
    this.renderCarousel(this.cachedPlayerMap);
    this.setupCarouselHandlers();

    try {
      await dataService.setLineupNextWeek(lineup.id, next);
      setTimeout(() => {
        if (this.pendingToggleId === lineup.id) this.pendingToggleId = null;
      }, 2000);
      toast.success(next
        ? `${lineup.name} will be kept for next week.`
        : `${lineup.name} will no longer be kept.`);
    } catch (err) {
      // Revert on failure
      lineup.isNextWeek = !next;
      if (this.currentShowcaseLineup?.id === lineupId) this.currentShowcaseLineup.isNextWeek = !next;
      this.pendingToggleId = null;
      this.renderShowcase(lineup, this.cachedPlayerMap);
      this.renderCarousel(this.cachedPlayerMap);
      this.setupCarouselHandlers();
      toast.error(err.message || 'Failed to update');
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

  // Set up all realtime subscriptions once (each guards against re-subscribing).
  // Not gated on lineups existing, so the Loot Log section stays live too.
  setupSubscriptions() {
    this.setupRealtimeSubscription();
    this.setupLootSubscription();
    this.setupPayoutSubscription();
    this.setupLootRecordSubscription();
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

      // Skip notification if this user initiated the toggle or archive/delete
      if (this.pendingToggleId === changedLineupId || this.pendingDeleteId === changedLineupId) {
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
   * Live-sync the loot view when loot is logged from the site or the Discord bot.
   * Refreshes just the affected lineup's loot (no full reload).
   */
  setupLootSubscription() {
    if (this.lootSubscription) return;

    this.lootSubscription = dataService.subscribeToLineupLoot((payload) => {
      const changedLineupId = payload.new?.lineup_id || payload.old?.lineup_id;
      const changedRecordId = payload.new?.record_id || payload.old?.record_id;
      if (changedLineupId) this.refreshLineupLoot(changedLineupId);
      // Loot on an archived record (or moved off a lineup) → refresh the Loot Log.
      if (changedRecordId || !changedLineupId) this.scheduleLootLogRefresh();
    });
  },

  // Subscribe to loot_records changes (e.g. the bot marking a thread closed, or a
  // record created/deleted by the weekly cleanup or another user).
  setupLootRecordSubscription() {
    if (this.lootRecordSubscription) return;
    this.lootRecordSubscription = dataService.subscribeToLootRecords(() => this.scheduleLootLogRefresh());
  },

  /**
   * Re-fetch one lineup's loot and re-render the showcase if it's the one shown.
   * Skips while the user is mid-edit so we don't drop their in-progress form.
   */
  async refreshLineupLoot(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) return;

    const isCurrent = this.currentShowcaseLineup?.id === lineupId;
    if (isCurrent && this.editingLootId) return;

    try {
      const loot = await dataService.getLineupLoot(lineupId);
      lineup.loot = loot;
      if (this.currentShowcaseLineup?.id === lineupId) {
        this.currentShowcaseLineup.loot = loot;
        if (this.cachedPlayerMap) this.renderShowcase(this.currentShowcaseLineup, this.cachedPlayerMap);
      }
    } catch (err) {
      console.error('[loot] live refresh failed:', err);
    }
  },

  /**
   * Live-sync gold-share chips when a member marks their share received on the
   * site or via a Discord ✅ reaction.
   */
  setupPayoutSubscription() {
    if (this.payoutSubscription) return;

    this.payoutSubscription = dataService.subscribeToLineupPayouts((payload) => {
      const changedLineupId = payload.new?.lineup_id || payload.old?.lineup_id;
      const changedRecordId = payload.new?.record_id || payload.old?.record_id;
      if (changedLineupId) this.refreshLineupPayouts(changedLineupId);
      if (changedRecordId || !changedLineupId) this.scheduleLootLogRefresh();
    });
  },

  /**
   * Re-fetch one lineup's payouts and re-render the showcase if it's shown.
   */
  async refreshLineupPayouts(lineupId) {
    const lineup = this.allLineups.find(l => l.id === lineupId);
    if (!lineup) return;

    try {
      const payouts = await dataService.getLineupPayouts(lineupId);
      lineup.payouts = payouts;
      if (this.currentShowcaseLineup?.id === lineupId) {
        this.currentShowcaseLineup.payouts = payouts;
        if (this.cachedPlayerMap) this.renderShowcase(this.currentShowcaseLineup, this.cachedPlayerMap);
      }
    } catch (err) {
      console.error('[payouts] live refresh failed:', err);
    }
  },

  /**
   * Cleanup when leaving the page
   */
  destroy() {
    if (this.lineupSubscription) {
      dataService.unsubscribe(this.lineupSubscription);
      this.lineupSubscription = null;
    }
    if (this.lootSubscription) {
      dataService.unsubscribe(this.lootSubscription);
      this.lootSubscription = null;
    }
    if (this.payoutSubscription) {
      dataService.unsubscribe(this.payoutSubscription);
      this.payoutSubscription = null;
    }
    if (this.lootRecordSubscription) {
      dataService.unsubscribe(this.lootRecordSubscription);
      this.lootRecordSubscription = null;
    }
    clearTimeout(this._lootLogRefreshTimer);
  },

  // ============================================
  // LOOT LOG SECTION (archived loot records)
  // ============================================

  async loadLootRecords() {
    try {
      const [records, players] = await Promise.all([
        dataService.getLootRecords(),
        this.cachedPlayerMap ? Promise.resolve(null) : dataService.getPlayers(),
      ]);
      this.lootRecords = records;
      if (players) this.cachedPlayerMap = new Map(players.map(p => [p.name, p]));
      this.populateRaidFilterOptions();
      this.renderLootLogList();
    } catch (err) {
      console.error('[loot-log] load failed:', err);
      const list = document.getElementById('loot-log-list');
      if (list) list.innerHTML = `<div class="empty-state">Failed to load loot records.</div>`;
    }
  },

  // True if the logged-in user owns any character in this record's roster.
  isMyLootRecord(record) {
    const uid = dataService.getUser()?.id;
    const map = this.cachedPlayerMap;
    if (!uid || !map) return false;
    return this.getPartyMemberNames(record).some(n => map.get(n)?.discordId === uid);
  },

  // Rebuild the raid-type <select> from the raid types actually present in the
  // records (stable order), preserving the current selection.
  populateRaidFilterOptions() {
    const sel = this.getPageEl()?.querySelector('.loot-raid-select');
    if (!sel) return;
    const order = ['DDN Hardcore', 'DDN Classic', 'Hardcore', 'Classic', 'Unspecified'];
    const types = [...new Set(this.lootRecords.map(r => r.raidType).filter(Boolean))]
      .sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    if (this.lootRaidFilter !== 'all' && !types.includes(this.lootRaidFilter)) this.lootRaidFilter = 'all';
    sel.innerHTML = `<option value="all">All raids</option>` +
      types.map(t => `<option value="${this.escapeHtml(t)}" ${t === this.lootRaidFilter ? 'selected' : ''}>${this.escapeHtml(formatRaidTypeLabel(t))}</option>`).join('');
  },

  // Reload + re-render the Loot Log (debounced; skipped mid-edit).
  scheduleLootLogRefresh() {
    if (this.editingLootId) return;
    clearTimeout(this._lootLogRefreshTimer);
    this._lootLogRefreshTimer = setTimeout(() => {
      if (this.activeSection === 'loot-log') this.loadLootRecords();
    }, 300);
  },

  // A record is fully resolved when it has loot, every item is sold, and every
  // LINKED member has withdrawn their full share. Guests are auto-covered (counted
  // in the split, but don't need to confirm). (Mirrors loot_record_is_resolved SQL.)
  isLootRecordResolved(record) {
    const loot = record.loot || [];
    if (loot.length === 0) return false;
    if (loot.some(l => !l.sold)) return false;
    const members = this.getPartyMemberNames(record);
    if (members.length === 0) return false;
    const payoutEach = this._payoutEach(record);
    const withdrawn = new Map((record.payouts || []).map(p => [p.memberName, Number(p.amount) || 0]));
    const linked = members.filter(n => this.cachedPlayerMap?.get(n)?.discordId);
    // Guests auto-considered settled → require every linked member settled.
    return linked.every(n => (withdrawn.get(n) || 0) >= payoutEach);
  },

  setupLootLogFilter() {
    const root = this.getPageEl();
    if (!root) return;

    root.querySelectorAll('.loot-scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.lootScope = btn.dataset.scope;
        this.renderLootLogList();
      });
    });

    const raidSel = root.querySelector('.loot-raid-select');
    if (raidSel) {
      raidSel.addEventListener('change', () => {
        this.lootRaidFilter = raidSel.value;
        this.renderLootLogList();
      });
    }

    const filterBtn = root.querySelector('.loot-log-filter');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        this.showSettledLoot = !this.showSettledLoot;
        this.renderLootLogList();
      });
    }
  },

  renderLootLogList() {
    const list = document.getElementById('loot-log-list');
    if (!list) return;
    const canManage = authService.canEditLineups();
    const root = this.getPageEl();

    // Scope (mine/all) + raid-type filters
    let base = this.lootRecords;
    if (this.lootScope === 'mine') base = base.filter(r => this.isMyLootRecord(r));
    if (this.lootRaidFilter !== 'all') base = base.filter(r => r.raidType === this.lootRaidFilter);

    const unsettled = base.filter(r => !this.isLootRecordResolved(r));
    const settledCount = base.length - unsettled.length;
    const shown = this.showSettledLoot ? base : unsettled;

    // Reflect the active scope button
    root?.querySelectorAll('.loot-scope-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.scope === this.lootScope));

    // Settled toggle button
    const filterBtn = root?.querySelector('.loot-log-filter');
    if (filterBtn) {
      filterBtn.textContent = this.showSettledLoot ? `Hide settled (${settledCount})` : `Show settled (${settledCount})`;
      filterBtn.style.display = settledCount > 0 ? '' : 'none';
    }

    if (shown.length === 0) {
      let msg;
      if (this.lootRecords.length === 0) {
        msg = 'No loot records yet. Cleared raids with loot appear here after they\'re archived.';
      } else if (base.length === 0) {
        msg = this.lootScope === 'mine'
          ? 'None of your characters are in a logged raid here yet. Switch to “All loot” to see everything.'
          : 'No loot records match this raid filter.';
      } else {
        msg = 'No unsettled loot — everything\'s sold and split. 🎉';
      }
      list.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    list.innerHTML = shown.map(r => this.renderLootRecordCard(r, canManage)).join('');
    shown.forEach(r => this.wireLootRecordCard(r));
  },

  renderLootRecordCard(record, canManage) {
    return `
      <div class="loot-record-card ${this.isLootRecordResolved(record) ? 'resolved' : ''}" data-record-id="${record.id}">
        ${this.renderLootRecordInner(record, canManage)}
      </div>
    `;
  },

  renderLootRecordInner(record, canManage) {
    const resolved = this.isLootRecordResolved(record);
    const roster = this.getPartyMemberNames(record);
    const cleared = record.clearedAt ? moment(record.clearedAt) : null;
    return `
      <div class="loot-record-head">
        <div class="loot-record-heading">
          <span class="loot-record-name">${this.escapeHtml(record.name || 'Lineup')}</span>
          ${record.raidType ? `<span class="loot-record-raid">${this.escapeHtml(formatRaidTypeLabel(record.raidType))}</span>` : ''}
          ${resolved ? '<span class="loot-record-badge">Settled</span>' : ''}
        </div>
        <div class="loot-record-meta">
          ${cleared ? `<span class="loot-record-date" title="${cleared.format('ddd, MMM D, YYYY h:mm A')}">cleared ${cleared.fromNow()}</span>` : ''}
          ${canManage ? `<button class="loot-icon-btn loot-record-delete" title="Delete this record">🗑</button>` : ''}
        </div>
      </div>
      ${roster.length ? `<div class="loot-record-roster">${roster.map(n => `<span class="loot-record-member">${this.escapeHtml(n)}</span>`).join('')}</div>` : ''}
      ${this.renderLootSection(record, canManage)}
    `;
  },

  wireLootRecordCard(record) {
    const card = this.getPageEl()?.querySelector(`.loot-record-card[data-record-id="${record.id}"]`);
    if (!card) return;

    this.setupLootHandlers(record, card);
    this.setupPayoutHandlers(record, card);

    const delBtn = card.querySelector('.loot-record-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const confirmed = await modal.confirm(
          `Delete the entire loot record for <strong>${this.escapeHtml(record.name || 'this lineup')}</strong>? This removes all its items and share tracking.`,
          { title: 'Delete Loot Record', confirmText: 'Delete', cancelText: 'Cancel' }
        );
        if (!confirmed) return;
        try {
          await dataService.deleteLootRecord(record.id);
          this.lootRecords = this.lootRecords.filter(r => r.id !== record.id);
          this.renderLootLogList();
          toast.success('Loot record deleted');
        } catch (err) {
          toast.error(err.message || 'Failed to delete record');
        }
      });
    }
  },

  // Re-render one record's card in place (called by the loot mixin after a change).
  rerenderLootRecordCard(record) {
    const card = this.getPageEl()?.querySelector(`.loot-record-card[data-record-id="${record.id}"]`);
    if (!card) { this.renderLootLogList(); return; }
    card.className = `loot-record-card ${this.isLootRecordResolved(record) ? 'resolved' : ''}`;
    card.innerHTML = this.renderLootRecordInner(record, authService.canEditLineups());
    this.wireLootRecordCard(record);
  },

  getPageEl() {
    return document.querySelector('.lineups-page');
  }
};

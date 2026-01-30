import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { authService } from '../auth.js';
import { modal } from '../modal.js';
import { EQUIPMENT_RARITIES, EQUIPMENT_ICONS, WEAPON_SUFFIXES } from '../constants.js';

export const LineupsPage = {
  currentRaidType: 'Hardcore',
  currentShowcaseLineup: null,
  allLineups: [],
  cachedPlayerMap: null,

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
            <h3>Lineups</h3>
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
    this.loadLineups();
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
        lineup => lineup.name === this.currentShowcaseLineup?.name
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
      this.selectLineup(newLineup.name);
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
        const freshLineup = this.allLineups.find(l => l.name === this.currentShowcaseLineup.name && l.raidType === this.currentRaidType);
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
    const isAdmin = authService.isAdmin();

    // Check if lineup is cleared
    const isCleared = lineup.completed;

    showcaseContainer.innerHTML = `
      <div class="lineup-card showcase-lineup-card ${isCleared ? 'cleared' : ''}">
        <div class="lineup-card-header">
          <h3>
            ${lineup.isTemplate ? '<img src="/icons/group.svg" class="template-icon-showcase" style="width: 20px; height: 20px; flex-shrink: 0; vertical-align: middle; margin-right: 0.5rem;" title="Template lineup" alt="Template">' : ''}
            ${lineup.name}
          </h3>
          ${isAdmin ? `<button class="btn btn-primary btn-cleared" data-lineup-name="${lineup.name}">${isCleared ? 'Not cleared' : 'Clear'}</button>` : ''}
        </div>
        <div class="lineup-players">
          ${lineup.players.map((playerName, idx) => {
        // Check if lineup is cleared (all players completed)
        const lineupPlayers = lineup.players.map(name => playerMap.get(name)).filter(p => p);

            // Check if this is a guest character
            let player = null;
            let isPub = false;
            if (playerName && playerName.startsWith('[PUB]')) {
              isPub = true;
              const parts = playerName.substring(5).split('|');
              player = { name: parts[0], role: parts[1] };
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

            return `
            <div class="player-slot ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">
              <span class="slot-number">${idx + 1}</span>
              <div class="player-slot-info">
                <span class="player-name">${player.name} ${isPub ? '<span class="pub-badge">GUEST</span>' : ''}</span>
                ${player.role ? `<span class="player-role">${player.role}</span>` : ''}
                ${!isPub && equipmentDisplay.length > 0 ? `<div class="player-equipment-compact">${equipmentDisplay.join(' ')}</div>` : ''}
                ${!isPub && suffixDisplay.length > 0 ? `<div class="player-suffixes">Suffix: ${suffixDisplay.join(' + ')}</div>` : ''}
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
      </div>
    `;

    // Add click handler for cleared button if admin
    if (isAdmin) {
      const clearedBtn = showcaseContainer.querySelector('.btn-cleared');
      if (clearedBtn) {
        clearedBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lineupName = clearedBtn.dataset.lineupName;
          await this.handleClearedClick(lineupName, this.allLineups);
        });
      }
    }
  },

  renderCarousel(playerMap) {
    const carouselContainer = document.getElementById('existing-lineups-container');

    carouselContainer.innerHTML = this.allLineups.map(lineup => {
      // Check if lineup is cleared
      const isCleared = lineup.completed;
      const isSelected = this.currentShowcaseLineup && lineup.name === this.currentShowcaseLineup.name;

      // Create 8 mini player cards in 2x4 grid
      const playerCards = Array(8).fill(0).map((_, idx) => {
        const playerName = lineup.players[idx];

        // Check if this is a guest character
        let player = null;
        let isPub = false;
        if (playerName && playerName.startsWith('[PUB]')) {
          isPub = true;
          const parts = playerName.substring(5).split('|');
          player = { name: parts[0], role: parts[1] };
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

        return `
          <div class="mini-player-card ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">
            <div class="mini-player-info">
              <div class="mini-player-name">${player.name}${isPub ? ' <span class="pub-badge-mini">G</span>' : ''}</div>
              <div class="mini-player-role">${player.role}</div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="mini-lineup-card ${isCleared ? 'cleared' : ''} ${isSelected ? 'selected' : ''}" data-lineup-name="${lineup.name}">
          <div class="mini-lineup-header">
            <span class="mini-lineup-name">
              ${lineup.isTemplate ? '<img src="/icons/group.svg" class="template-icon" style="width: 14px; height: 14px; flex-shrink: 0;" title="Template lineup" alt="Template">' : ''}
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

  selectLineup(lineupName) {
    const lineup = this.allLineups.find(l => l.name === lineupName);
    if (!lineup) return;

    this.currentShowcaseLineup = lineup;

    // Use cached player data for instant rendering
    if (this.cachedPlayerMap) {
      this.renderShowcase(lineup, this.cachedPlayerMap);
      this.updateCarouselSelection(lineupName);
    }
  },

  updateCarouselSelection(lineupName) {
    const carouselCards = document.querySelectorAll('.mini-lineup-card');
    carouselCards.forEach(card => {
      if (card.dataset.lineupName === lineupName) {
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
        const lineupName = card.dataset.lineupName;
        this.selectLineup(lineupName);
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

  async handleClearedClick(lineupName, lineups) {
    const lineup = lineups.find(l => l.name === lineupName);
    if (!lineup) {
      toast.error('Lineup not found');
      return;
    }

    const confirmed = await modal.confirm(
      `${lineup.completed ? 'Di pa ba na clear' : 'Cleared na ba'} ang lineup <strong>${lineupName}</strong>?<br><br>`,
      {
        title: 'Cleared Status',
        confirmText: lineup.completed ? 'Not Cleared' : 'Cleared',
        cancelText: 'Cancel'
      }
    );

    if (!confirmed) return;

    try {
      await dataService.toggleLineupCompleted(lineupName);
      toast.success(`Updated cleared status for ${lineupName}!`);
      // Reload the lineups to show updated cleared status
      await this.loadLineups();
    } catch (error) {
      toast.error(`Error: ${error.message}`);
    }
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
  }
};

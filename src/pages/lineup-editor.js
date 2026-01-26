import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS, WEAPON_SUFFIXES, CLASS_FAMILIES } from '../constants.js';
import { modal } from '../modal.js';

export const LineupEditorPage = {
  players: [],
  currentLineup: {
    name: '',
    raidType: 'Hardcore',
    status: 'ready',
    players: [],
    completed: false
  },
  selectedClassFamily: null,

  async render(container) {
    container.innerHTML = `
      <div class="lineup-editor-page">
        <div class="page-header">
          <h1>Lineup Editor</h1>
        </div>

        <div class="editor-container">
          <div class="lineup-info">
            <div class="form-group">
              <label for="lineup-name">Lineup Name:</label>
              <input type="text" id="lineup-name" placeholder="Enter lineup name...">
            </div>
            <div class="form-group">
              <label for="raid-type">Raid Type:</label>
              <select id="raid-type">
                <option value="Hardcore">GDN Hardcore</option>
                <option value="Classic">GDN Classic</option>
              </select>
            </div>
          </div>

          <div class="editor-main">
            <div class="lineup-slots">
              <h3>Raid Lineup (8 characters)</h3>
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
                <h3>Existing Lineups</h3>
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
              <label class="hide-cleared-filter">
                <input type="checkbox" id="hide-cleared-checkbox">
                <span>Hide Cleared</span>
              </label>
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
    });

    document.getElementById('cleared-toggle').addEventListener('change', (e) => {
      this.currentLineup.completed = e.target.checked;
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
  },

  async loadPlayers() {
    const listElement = document.getElementById('available-players-list');

    if (!dataService.isConfigured()) {
      listElement.innerHTML = '<div class="error">Please configure Google Sheets first.</div>';
      return;
    }

    try {
      this.players = await dataService.getPlayers();
      this.renderAvailablePlayers();
      this.loadExistingLineups();
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading players: ${error.message}</div>`;
    }
  },

  async loadExistingLineups() {
    const container = document.getElementById('existing-lineups-container');

    try {
      const lineups = await dataService.getLineups();

      if (lineups.length === 0) {
        container.innerHTML = '<div class="empty-state">No lineups yet</div>';
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
          <div class="mini-lineup-card ${isCleared ? 'cleared' : ''}" data-lineup-name="${lineup.name}">
            <div class="mini-lineup-header">
              <span class="mini-lineup-name">${lineup.name}</span>
              <div class="mini-lineup-header-actions">
                <span class="mini-lineup-raid-type">GDN ${lineup.raidType || 'Hardcore'}</span>
                <button class="mini-delete-btn" data-lineup-name="${lineup.name}" title="Delete lineup">×</button>
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
          await this.deleteLineup(lineupName);
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
      const needsThisRaid = dataService.playerNeedsRaid(player, this.currentLineup.raidType);

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
        <div class="player-card ${!needsThisRaid ? 'completed' : ''} ${isInLineup ? 'in-lineup' : ''}"
             data-player-name="${player.name}"
             draggable="true">
          ${player.notes ? `<span class="note-icon" data-tooltip="${player.notes.replace(/"/g, '&quot;')}">📝</span>` : ''}
          ${!needsThisRaid ? `<span class="completion-badge" title="Already completed ${this.currentLineup.raidType} this week">✓</span>` : ''}
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
        let matchesCompletion = true;
        if (hideCleared) {
          // Only show players who need this raid (hide those who already completed)
          matchesCompletion = dataService.playerNeedsRaid(player, this.currentLineup.raidType);
        }

        return matchesSearch && matchesClass && matchesClassFamily && matchesCompletion;
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

          // Hide cleared filter
          let matchesCompletion = true;
          if (hideCleared) {
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
        const needsThisRaid = dataService.playerNeedsRaid(player, this.currentLineup.raidType);

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
            <label for="pub-name">Character Name: *</label>
            <input type="text" id="pub-name" required placeholder="Enter name...">
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

      if (!name || !role) {
        toast.error('Please fill in all required fields');
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

  assignPubPlayerToSlot(slotIndex, name, role) {
    // Store guest character with special format: [PUB]Name|Class
    const pubPlayerString = `[PUB]${name}|${role}`;
    this.currentLineup.players[slotIndex] = pubPlayerString;

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    const slotContent = slotElement.querySelector('.slot-content');

    slotContent.innerHTML = `
      <div class="assigned-player pub-player">
        <div class="player-name">${name} <span class="pub-badge">GUEST</span></div>
        <div class="player-role">${role}</div>
      </div>
    `;

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

    slotContent.innerHTML = `
      <div class="assigned-player">
        <div class="player-name">${player.name}</div>
        <div class="player-role">${player.role}</div>
        ${equipmentDisplay.length > 0 ? `<div class="player-equipment-compact">${equipmentDisplay.join(' ')}</div>` : ''}
        ${suffixDisplay.length > 0 ? `<div class="player-suffixes">Suffix: ${suffixDisplay.join(' + ')}</div>` : ''}
      </div>
    `;

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
  },

  removePlayerFromSlot(slotIndex) {
    this.currentLineup.players[slotIndex] = null;

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

    this.currentLineup = {
      name: '',
      raidType: 'Hardcore',
      status: 'ready',
      players: [],
      completed: false
    };

    document.getElementById('lineup-name').value = '';
    document.getElementById('raid-type').value = 'Hardcore';
    document.getElementById('cleared-toggle').checked = false;

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
  },

  async saveLineup() {
    if (!this.currentLineup.name) {
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

      const players = Array(8).fill('').map((_, idx) => this.currentLineup.players[idx] || '');

      // Check if lineup with this name already exists
      const existingLineups = await dataService.getLineups();
      const existingLineup = existingLineups.find(l => l.name === this.currentLineup.name);

      if (existingLineup) {
        // Update existing lineup
        await dataService.updateLineup({
          name: this.currentLineup.name,
          raidType: this.currentLineup.raidType,
          status: 'ready',
          players,
          completed: this.currentLineup.completed
        }, this.currentLineup.name);
        toast.success(`${this.currentLineup.name} updated!`);
      } else {
        // Add new lineup
        await dataService.addLineup({
          name: this.currentLineup.name,
          raidType: this.currentLineup.raidType,
          status: 'ready',
          players,
          completed: this.currentLineup.completed
        });
        toast.success(`${this.currentLineup.name} saved!`);
      }

      this.loadExistingLineups(); // Refresh the lineup list

      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    } catch (error) {
      toast.error(`Error dong: ${error.message}`);
      const saveBtn = document.getElementById('save-lineup-btn');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    }
  },

  async deleteLineup(lineupName) {
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
      await dataService.deleteLineup(lineupName);
      toast.success(`GG wala nang ${lineupName}!`);
      this.loadExistingLineups(); // Refresh the lineup list
    } catch (error) {
      toast.error(`HOY ano yan bat may error: ${error.message}`);
    }
  },

  loadLineup(lineup) {
    this.currentLineup = {
      name: lineup.name,
      raidType: lineup.raidType || 'Hardcore',
      status: 'ready',
      players: [...lineup.players],
      completed: lineup.completed || false
    };

    document.getElementById('lineup-name').value = lineup.name;
    document.getElementById('raid-type').value = lineup.raidType || 'Hardcore';
    document.getElementById('cleared-toggle').checked = lineup.completed || false;

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

          // Swap players
          this.currentLineup.players[targetSlotIndex] = playerName;
          this.currentLineup.players[sourceIndex] = targetPlayerName || undefined;

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
            this.assignPlayerToSlot(targetSlotIndex, playerName);
            toast.success(`Assigned ${playerName} to slot ${targetSlotIndex + 1}`);
          }
        }
      });
    });
  }
};

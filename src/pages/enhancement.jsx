import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { initFixedTooltip } from '../fixed-tooltip.js';
import ENHANCE from '../data/enhance-tables.js';

// Import images
import berlinImg from '../images/berlin.webp';
import saintHavenImg from '../images/saint haven.webp';
import calderockImg from '../images/calderock.webp';
import manaRidgeImg from '../images/mana ridge.webp';
import lotusMarshImg from '../images/lotus marsh.webp';
import prairieTownImg from '../images/prairie town.webp';
import colosseumImg from '../images/colosseum.png';
import crosshairIcon from '../icons/crosshair.svg';

// Rates, gold and materials per gear slot come from the game client (tools/pak/build_enhance_tables.py).
const DEFAULT_GEAR = '70:mainWeapon';

function gearCurve(key) {
  return ENHANCE.curves[(ENHANCE.slots[key] || ENHANCE.slots[DEFAULT_GEAR]).curve];
}

// +6 and +9 are checkpoints: once reached, a failed attempt never drops below them.
function checkpointFloor(level) {
  return level >= 9 ? 9 : level >= 6 ? 6 : 0;
}

// What a non-breaking failure does at each attempt (+N), from the guild's rate table: the share
// that drops a level and how far. The client's own drop ranges are looser than what players see.
const FAILURE_DROPS = {
  8: { share: 0.5, levels: 1 },
  9: { share: 0.5, levels: 2 },
  11: { share: 1, levels: 1 },
  12: { share: 1, levels: 2 },
  13: { share: 1, levels: 2 },
  14: { share: 1, levels: 2 },
  15: { share: 1, levels: 2 }
};

// A failure breaks the item (break % of failures, unless protected), else drops or keeps the level.
function gearRates(key, protect) {
  return gearCurve(key).map((step, i) => {
    const failure = 100 - step.success;
    const destruction = protect ? 0 : failure * step.break / 100;
    const drop = FAILURE_DROPS[i + 1] || { share: 0, levels: 0 };
    return {
      level: i + 1,
      success: step.success,
      failure,
      destruction,
      downgrade: (failure - destruction) * drop.share,
      disappear: (failure - destruction) * (1 - drop.share),
      downgradeLevel: drop.levels
    };
  });
}

// Available backgrounds
const BACKGROUNDS = [
  { name: 'Saint Haven', path: saintHavenImg },
  { name: 'Calderock', path: calderockImg },
  { name: 'Mana Ridge', path: manaRidgeImg },
  { name: 'Lotus Marsh', path: lotusMarshImg },
  { name: 'Prairie Town', path: prairieTownImg },
  { name: 'Colosseum', path: colosseumImg }
];

export const EnhancementPage = {
  currentLevel: 0,
  useProtection: false,
  useGoldenGoose: false,
  useEventBoost: false,
  useLoadingBar: false,
  attempts: 0,
  successes: 0,
  failures: 0,
  highestLevel: 0,
  milestoneAttempts: {}, // Track attempts at each level when first successfully enhanced
  totalLevelAttempts: {}, // Track total attempts made at each level throughout session
  isProcessing: false, // Prevent double-clicks
  isAutoEnhancing: false, // Track auto-enhance mode
  autoEnhanceCancelled: false, // Track if auto-enhance was cancelled
  materialsUsed: { // Track materials consumed
    essenceOfLife: 0,
    diamond: 0,
    protectionJelly: 0,
    gold: 0
  },
  materialsPerLevel: {}, // Track materials used per level { 0: { essenceOfLife: 0, diamond: 0, protectionJelly: 0, gold: 0 }, ... }
  selectedBackground: 0, // Index of selected background
  selectedGear: DEFAULT_GEAR, // enhance-tables slot key, level:slot
  goalLevel: null, // Target enhancement level
  essenceOfLifePrice: 0, // Gold price per Essence of Life
  polishedDiamondPrice: 0, // Gold price per Polished Diamond
  protectionJellyPrice: 0, // Gold price per Protection Jelly

  // Lv50/60 gear takes Polished Diamonds, Lv70 takes Flawless.
  diamondName() {
    return ENHANCE.diamonds[this.selectedGear.split(':')[0]] || 'Diamond';
  },

  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  formatGold(totalGold) {
    const gold = Math.floor(totalGold);
    const silver = Math.floor((totalGold - gold) * 100);
    const copper = Math.round(((totalGold - gold) * 100 - silver) * 100);

    if (gold === 0 && silver === 0 && copper === 0) {
      return '0g';
    }

    let result = [];
    if (gold > 0) result.push(`${this.formatNumber(gold)}g`);
    if (silver > 0) result.push(`${silver}s`);
    if (copper > 0) result.push(`${copper}c`);

    return result.join(' ');
  },

  getEffectiveRate(rateEntry) {
    if (!this.useEventBoost) return rateEntry;
    const boostedSuccess = Math.min(100, rateEntry.success * 1.3);
    const boostedFailure = 100 - boostedSuccess;
    // Scale failure sub-rates proportionally
    const failureScale = rateEntry.failure > 0 ? boostedFailure / rateEntry.failure : 0;
    return {
      ...rateEntry,
      success: boostedSuccess,
      failure: boostedFailure,
      destruction: rateEntry.destruction * failureScale,
      downgrade: rateEntry.downgrade * failureScale,
      disappear: rateEntry.disappear * failureScale
    };
  },

  showLoadingBar() {
    return new Promise((resolve, reject) => {
      const loadingModal = document.createElement('div');
      loadingModal.className = 'modal loading-bar-modal';
      loadingModal.innerHTML = `
        <div class="modal-content loading-bar-content">
          <h2>Enhancing...</h2>
          <div class="loading-bar-container">
            <div class="loading-bar-fill" id="loading-bar-fill"></div>
          </div>
          <button type="button" class="btn btn-secondary" id="cancel-loading-btn">Cancel</button>
        </div>
      `;

      document.body.appendChild(loadingModal);

      const loadingBarFill = document.getElementById('loading-bar-fill');
      const cancelBtn = document.getElementById('cancel-loading-btn');

      let cancelled = false;

      // Start animation
      loadingBarFill.style.transition = 'width 2.4s linear';
      setTimeout(() => {
        loadingBarFill.style.width = '100%';
      }, 10);

      // Handle completion
      const completionTimeout = setTimeout(() => {
        if (!cancelled) {
          document.body.removeChild(loadingModal);
          resolve();
        }
      }, 2400);

      // Handle cancellation
      const handleCancel = () => {
        cancelled = true;
        clearTimeout(completionTimeout);
        document.body.removeChild(loadingModal);
        reject(new Error('Enhancement cancelled'));
      };

      cancelBtn.addEventListener('click', handleCancel);

      // Close on backdrop click
      loadingModal.addEventListener('click', (e) => {
        if (e.target === loadingModal) {
          handleCancel();
        }
      });

      // Close on Escape key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', handleEscape);
          handleCancel();
        }
      };
      document.addEventListener('keydown', handleEscape);
    });
  },

  render(container) {
    container.innerHTML = `
      <div class="enhancement-page">
        <div class="page-header">
          <h1>Enhancement</h1>
        </div>

        <div class="enhancement-container">
          <div class="enhancement-main">
            <div class="blacksmith-section" style="background-image: url('${BACKGROUNDS[this.selectedBackground].path}');">
              <div class="enh-setup">
                <label class="enh-field">
                  <span>Gear</span>
                  <select id="gear-select">
                    ${[...ENHANCE.meta.levels].reverse().map(lv => `
                      <optgroup label="Level ${lv}">
                        ${Object.entries(ENHANCE.slots).filter(([key]) => key.startsWith(`${lv}:`)).map(([key, slot]) => `
                          <option value="${key}" ${key === this.selectedGear ? 'selected' : ''}>${slot.label}</option>
                        `).join('')}
                      </optgroup>
                    `).join('')}
                  </select>
                </label>
                <label class="enh-field">
                  <span>Background</span>
                  <select id="background-select">
                    ${BACKGROUNDS.map((bg, index) => `
                      <option value="${index}" ${index === this.selectedBackground ? 'selected' : ''}>${bg.name}</option>
                    `).join('')}
                  </select>
                </label>
              </div>
              <img src="${berlinImg}" alt="Blacksmith" class="blacksmith-image" onerror="this.style.display='none'">
              <div class="enhancement-display">
                <div class="current-level">
                  <span class="level-label">Current Level</span>
                  <select id="level-dropdown" class="level-dropdown">
                    <option value="${this.currentLevel}" selected>+${this.currentLevel}</option>
                    <option disabled>──────</option>
                    ${[6, 7, 8, 9, 10, 11, 12, 13, 14].map(level => `
                      <option value="${level}">+${level}</option>
                    `).join('')}
                  </select>
                </div>
                <div class="enhancement-controls">
                  <div class="enhancement-toggles">
                    <label class="protection-toggle">
                      <input type="checkbox" id="protection-toggle" ${this.useProtection ? 'checked' : ''}>
                      <span>Enhancement Jelly</span>
                    </label>
                    <label class="protection-toggle">
                      <input type="checkbox" id="golden-goose-toggle" ${this.useGoldenGoose ? 'checked' : ''}>
                      <span>Golden Goose Ticket</span>
                    </label>
                    <label class="protection-toggle">
                      <input type="checkbox" id="event-boost-toggle" ${this.useEventBoost ? 'checked' : ''}>
                      <span>Event Boost (+30%)</span>
                    </label>
                  </div>
                  <div class="enhance-row">
                    <button id="enhance-btn" class="btn btn-primary" ${this.isAutoEnhancing ? 'disabled' : ''}>Enhance!</button>
                    <button id="auto-enhance-btn" class="btn btn-secondary ${this.isAutoEnhancing ? 'auto-active' : ''}">${this.isAutoEnhancing ? 'Stop' : 'Auto'}</button>
                    <label class="loading-toggle">
                      <input type="checkbox" id="loading-bar-toggle" ${this.useLoadingBar ? 'checked' : ''}>
                      <svg class="progressbar-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                        <path d="M28,21H4a2.0021,2.0021,0,0,1-2-2V13a2.0021,2.0021,0,0,1,2-2H28a2.0021,2.0021,0,0,1,2,2v6A2.0021,2.0021,0,0,1,28,21ZM4,13v6H28V13Z"/>
                        <rect x="6" y="15" width="14" height="2"/>
                      </svg>
                    </label>
                  </div>
                  <button id="reset-btn" class="btn btn-secondary">Reset</button>
                </div>
              </div>
            </div>

            <div class="enh-side">
              <section class="enh-panel enh-session">
                <h3>Session</h3>
                <div id="enh-session-body">${this.renderSessionBody()}</div>
                <div class="enh-prices">
                  <span class="enh-prices-label">Price each</span>
                  ${this.priceFields().map(([id, label, price]) => `
                    <label class="enh-price">
                      <span>${label}</span>
                      <input type="number" id="${id}" min="0" step="0.01" value="${price || ''}" placeholder="0">
                    </label>
                  `).join('')}
                </div>
                <div id="enh-milestones">${this.renderMilestones()}</div>
              </section>

              <section class="enh-panel rates-section">
                <div class="enh-panel-head">
                  <h3>Rates</h3>
                  <span class="enh-rates-mode" id="enh-rates-mode">${this.ratesModeText()}</span>
                </div>
                <div class="rates-table-container">
                  ${this.renderRatesTable()}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  },

  // Material lines for one level's totals, with gold costs where a price is set.
  materialLines(m) {
    const lines = [];
    const priced = this.materials(m);
    priced.forEach(({ label, count, cost }) => {
      if (count > 0) lines.push(`${label}: ${this.formatNumber(count)}${cost > 0 ? ` (${this.formatGold(cost)})` : ''}`);
    });
    lines.push(`Gold: ${this.formatGold(m.gold)}`);
    const extra = priced.reduce((t, x) => t + x.cost, 0);
    if (extra > 0) lines.push(`Total: ${this.formatGold(m.gold + extra)}`);
    return lines.join('\n');
  },

  renderMilestones() {
    const milestones = Object.keys(this.milestoneAttempts)
      .map(level => parseInt(level))
      .filter(level => level >= 7) // Only show levels 7 and above
      .sort((a, b) => a - b);

    if (this.highestLevel < 7 || milestones.length === 0) {
      return '';
    }

    return `
      <div class="enh-milestones">
        <div class="enh-milestones-head">
          <h4>Highest Level</h4>
          <span class="highest-value">+${this.highestLevel}</span>
        </div>
        <table class="enh-table">
          <thead><tr><th>Step</th><th>Taps to first</th><th>Taps total</th></tr></thead>
          <tbody>
            ${milestones.map(level => {
              const prevLevel = level - 1;
              const materials = this.materialsPerLevel[prevLevel];
              const tip = materials ? `data-tooltip-head="Materials used" data-tooltip-fixed="${this.materialLines(materials)}"` : '';
              return `
                <tr ${tip}>
                  <td class="enh-step">+${prevLevel} → +${level}</td>
                  <td>${this.formatNumber(this.milestoneAttempts[level])}</td>
                  <td>${this.formatNumber(this.totalLevelAttempts[prevLevel] || 0)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderRatesTable() {
    const baseRates = gearRates(this.selectedGear, this.useProtection);

    const formatRate = (value) => {
      const v = Math.round(value * 10) / 10;
      if (v <= 0) return '-';
      return Number.isInteger(v) ? v + '%' : v.toFixed(1) + '%';
    };

    return `
      <table class="rates-table${this.isAutoEnhancing ? ' locked' : ''}">
        <thead>
          <tr>
            <th>Level</th>
            <th>Success</th>
            <th>Failure</th>
            <th>Destruction</th>
            <th>Downgrade</th>
            <th>Retain Level</th>
          </tr>
        </thead>
        <tbody>
          ${baseRates.map(baseRate => {
            const rate = this.getEffectiveRate(baseRate);
            // Break, drop and keep columns read as shares of a failure, as in-game.
            const ofFailure = (v) => rate.failure > 0 ? v / rate.failure * 100 : 0;
            const isCurrent = this.currentLevel === rate.level - 1;
            const isGoal = this.goalLevel === rate.level;
            const classes = [];
            if (isCurrent) classes.push('current-row');
            if (isGoal) classes.push('goal-row');

            return `
              <tr class="${classes.join(' ')}" data-level="${rate.level}" ${isCurrent ? 'draggable="true"' : ''}>
                <td>
                  ${isGoal ? `
                    <div class="goal-crosshair">
                      <img src="${crosshairIcon}" alt="Goal" class="crosshair-icon" />
                      <span class="crosshair-level">${rate.level}</span>
                    </div>
                  ` : rate.level}
                </td>
                <td class="success-rate">${formatRate(rate.success)}</td>
                <td class="failure-rate">${formatRate(rate.failure)}</td>
                <td class="destruction-rate">${formatRate(ofFailure(rate.destruction))}</td>
                <td class="downgrade-rate">${formatRate(ofFailure(rate.downgrade))}</td>
                <td class="disappear-rate">${formatRate(ofFailure(rate.disappear))}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  priceFields() {
    return [
      ['essence-price', 'Essence of Life', this.essenceOfLifePrice],
      ['diamond-price', this.diamondName(), this.polishedDiamondPrice],
      ['jelly-price', 'Protection Jelly', this.protectionJellyPrice]
    ];
  },

  materials(m) {
    return [
      { label: 'Essence of Life', count: m.essenceOfLife, cost: m.essenceOfLife * this.essenceOfLifePrice },
      { label: this.diamondName(), count: m.diamond, cost: m.diamond * this.polishedDiamondPrice },
      { label: 'Protection Jelly', count: m.protectionJelly, cost: m.protectionJelly * this.protectionJellyPrice }
    ];
  },

  ratesModeText() {
    return [this.useProtection ? 'With Enhancement Jelly' : 'No protection', this.useEventBoost ? 'Event Boost' : '']
      .filter(Boolean).join(' · ');
  },

  // Attempts and the materials spent so far; costs appear once a price is set.
  renderSessionBody() {
    const used = this.materials(this.materialsUsed);
    const extra = used.reduce((t, x) => t + x.cost, 0);
    return `
      <div class="enh-stats">
        <div><span class="stat-value">${this.formatNumber(this.attempts)}</span><span class="stat-label">Attempts</span></div>
        <div><span class="stat-value success">${this.formatNumber(this.successes)}</span><span class="stat-label">Successes</span></div>
        <div><span class="stat-value failure">${this.formatNumber(this.failures)}</span><span class="stat-label">Failures</span></div>
      </div>
      <div class="enh-rows">
        ${used.map(({ label, count, cost }) => `
          <div class="enh-row">
            <span>${label}</span>
            <span class="enh-count">${this.formatNumber(count)}</span>
            <span class="enh-cost">${cost > 0 ? this.formatGold(cost) : ''}</span>
          </div>
        `).join('')}
        <div class="enh-row">
          <span>Gold</span>
          <span class="enh-count"></span>
          <span class="enh-cost">${this.formatGold(this.materialsUsed.gold)}</span>
        </div>
        ${extra > 0 ? `
          <div class="enh-row enh-total">
            <span>Total</span>
            <span class="enh-count"></span>
            <span class="enh-cost">${this.formatGold(this.materialsUsed.gold + extra)}</span>
          </div>
        ` : ''}
      </div>
    `;
  },

  attachEventListeners() {
    document.getElementById('enhance-btn').addEventListener('click', () => {
      this.attemptEnhancement();
    });

    document.getElementById('auto-enhance-btn').addEventListener('click', () => {
      if (this.isAutoEnhancing) {
        this.stopAutoEnhance();
      } else {
        this.startAutoEnhance();
      }
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      this.reset();
    });

    document.getElementById('protection-toggle').addEventListener('change', (e) => {
      this.useProtection = e.target.checked;
      this.updateRatesTable();
    });

    document.getElementById('golden-goose-toggle').addEventListener('change', (e) => {
      this.useGoldenGoose = e.target.checked;
    });

    document.getElementById('event-boost-toggle').addEventListener('change', (e) => {
      this.useEventBoost = e.target.checked;
      this.updateRatesTable();
    });

    document.getElementById('loading-bar-toggle').addEventListener('change', (e) => {
      this.useLoadingBar = e.target.checked;
    });

    document.getElementById('level-dropdown').addEventListener('change', (e) => {
      const selectedLevel = parseInt(e.target.value);
      if (!isNaN(selectedLevel)) {
        this.setEnhancementLevelViaDrag(selectedLevel + 1); // +1 because setEnhancementLevelViaDrag expects table level (1-15)
        // Reset dropdown to "Choose..." after selection
        e.target.value = '';
      }
    });

    // Costs differ per slot, so a new gear choice starts a fresh session.
    document.getElementById('gear-select').addEventListener('change', (e) => {
      this.selectedGear = e.target.value;
      this.reset();
    });

    document.getElementById('background-select').addEventListener('change', (e) => {
      this.selectedBackground = parseInt(e.target.value);
      this.render(document.querySelector('#app'));
    });

    // Add click handlers for rates table rows to set goal
    this.bindRateRows();

    // Prices sit outside the re-rendered session body, so typing keeps focus.
    this.priceFields().forEach(([id]) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value) || 0;
        if (id === 'essence-price') this.essenceOfLifePrice = value;
        else if (id === 'diamond-price') this.polishedDiamondPrice = value;
        else this.protectionJellyPrice = value;
        this.updateMaterialsDisplay();
      });
    });

    initFixedTooltip();
  },

  bindRateRows() {
    document.querySelectorAll('.rates-table tbody tr').forEach(row => {
      row.addEventListener('click', () => {
        // Prevent changing goal while auto-enhancing
        if (this.isAutoEnhancing) {
          return;
        }

        const level = parseInt(row.dataset.level);

        // Toggle goal: if clicking the same level, remove goal
        this.goalLevel = this.goalLevel === level ? null : level;
        this.updateRatesTable();
      });
    });

    // Set up drag and drop for rates table
    this.setupDragAndDropTableRows();
  },

  setupDragAndDropTableRows() {
    const tableRows = document.querySelectorAll('.rates-table tbody tr');
    let draggedLevel = null;

    tableRows.forEach(row => {
      const level = parseInt(row.dataset.level);
      const isCurrent = row.classList.contains('current-row');

      // Only allow dragging from current-row
      if (isCurrent) {
        row.addEventListener('dragstart', (e) => {
          draggedLevel = level;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('draggedLevel', level.toString());
          row.classList.add('dragging-current');
        });

        row.addEventListener('dragend', (e) => {
          row.classList.remove('dragging-current');

          // Remove drag-over class from all rows
          tableRows.forEach(r => r.classList.remove('drag-over', 'drag-source'));
          draggedLevel = null;
        });
      }

      // All rows are drop targets
      row.addEventListener('dragover', (e) => {
        if (draggedLevel !== null) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          // Add visual feedback
          if (row.classList.contains('current-row')) {
            row.classList.add('drag-over', 'drag-source');
          } else {
            row.classList.add('drag-over');
          }
        }
      });

      row.addEventListener('dragleave', (e) => {
        row.classList.remove('drag-over', 'drag-source');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over', 'drag-source');

        const draggedFromLevel = parseInt(e.dataTransfer.getData('draggedLevel'));
        const targetLevel = level;

        // Only update if dragging to a different level
        if (draggedFromLevel !== targetLevel) {
          this.setEnhancementLevelViaDrag(targetLevel);
        }
      });
    });
  },

  setEnhancementLevelViaDrag(newLevel) {
    // Update current level (newLevel is 1-15, but currentLevel is 0-14)
    const targetLevelIndex = newLevel - 1;

    if (this.currentLevel === targetLevelIndex) {
      return; // No change needed
    }

    // Update current level
    this.currentLevel = targetLevelIndex;

    // Reset ALL statistics to zero
    this.attempts = 0;
    this.successes = 0;
    this.failures = 0;
    this.highestLevel = 0;
    this.goalLevel = null;
    this.milestoneAttempts = {};
    this.totalLevelAttempts = {};
    this.materialsPerLevel = {};
    this.materialsUsed = {
      essenceOfLife: 0,
      diamond: 0,
      protectionJelly: 0,
      gold: 0
    };

    // Show success message
    toast.info(`Enhancement level set to +${targetLevelIndex}`);

    // Re-render the page to reflect all changes
    this.render(document.querySelector('#app'));
  },

  updateMaterialsDisplay() {
    const body = document.getElementById('enh-session-body');
    if (body) body.innerHTML = this.renderSessionBody();
    const milestones = document.getElementById('enh-milestones');
    if (milestones) milestones.innerHTML = this.renderMilestones();
  },

  async attemptEnhancement() {
    // Prevent double-clicking
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    // Bail out if auto-enhance was cancelled (only during auto-enhance)
    if (this.isAutoEnhancing && this.autoEnhanceCancelled) {
      this.isProcessing = false;
      return;
    }

    if (this.currentLevel >= 15) {
      toast.warning('Maximum enhancement level reached!');
      this.isProcessing = false;
      return;
    }

    // Show loading bar if enabled (skip during auto-enhance)
    if (this.useLoadingBar && !this.isAutoEnhancing) {
      try {
        await this.showLoadingBar();
      } catch (error) {
        // User cancelled
        this.isProcessing = false;
        return;
      }
    }

    const currentRates = this.getEffectiveRate(gearRates(this.selectedGear, this.useProtection)[this.currentLevel]);

    // Store current level before incrementing attempts
    const levelBeforeAttempt = this.currentLevel;

    this.attempts++;

    // Track total attempts at this level (before the attempt outcome)
    if (typeof this.totalLevelAttempts[levelBeforeAttempt] === 'undefined') {
      this.totalLevelAttempts[levelBeforeAttempt] = 0;
    }
    this.totalLevelAttempts[levelBeforeAttempt]++;

    // Track materials used for all levels
    const step = gearCurve(this.selectedGear)[levelBeforeAttempt];
    if (step) {
      // Jellies are only spent when protection is on.
      const cost = {
        essenceOfLife: step.essence,
        diamond: step.diamond,
        protectionJelly: this.useProtection ? step.jelly : 0,
        gold: step.copper / 10000
      };
      const goldCost = this.useGoldenGoose ? cost.gold * 0.5 : cost.gold;

      // Track total materials
      this.materialsUsed.essenceOfLife += cost.essenceOfLife;
      this.materialsUsed.diamond += cost.diamond;
      this.materialsUsed.protectionJelly += cost.protectionJelly;
      this.materialsUsed.gold += goldCost;

      // Track materials per level
      if (!this.materialsPerLevel[levelBeforeAttempt]) {
        this.materialsPerLevel[levelBeforeAttempt] = {
          essenceOfLife: 0,
          diamond: 0,
          protectionJelly: 0,
          gold: 0
        };
      }
      this.materialsPerLevel[levelBeforeAttempt].essenceOfLife += cost.essenceOfLife;
      this.materialsPerLevel[levelBeforeAttempt].diamond += cost.diamond;
      this.materialsPerLevel[levelBeforeAttempt].protectionJelly += cost.protectionJelly;
      this.materialsPerLevel[levelBeforeAttempt].gold += goldCost;
    }

    const roll = Math.random() * 100;

    if (roll < currentRates.success) {
      this.currentLevel++;
      this.successes++;

      // Track milestone attempts and highest level
      if (this.currentLevel > this.highestLevel) {
        this.highestLevel = this.currentLevel;
        // Store the attempts made at the previous level (not global difference)
        this.milestoneAttempts[this.currentLevel] = this.totalLevelAttempts[levelBeforeAttempt] || 0;
      }

      // Check if goal was reached
      if (this.goalLevel !== null && this.currentLevel === this.goalLevel) {
        this.render(document.querySelector('#app'));
        this.isProcessing = false;

        modal.alert(
          `Congratulations! You've reached +${this.goalLevel}!<br><br>` +
          `<strong>Total taps:</strong> ${this.attempts}<br>` +
          `<strong>Success rate:</strong> ${((this.successes / this.attempts) * 100).toFixed(1)}%`,
          {
            title: `Enhancement Reached: +${this.goalLevel}`,
            okText: 'Continue'
          }
        );
        return;
      }

      if (!this.isAutoEnhancing) {
        toast.success(`Enhancement success! Now at +${this.currentLevel}`);
      }

      if (this.currentLevel === 15) {
        toast.success('Maximum level achieved! Congratulations!', 5000);
      }
    } else {
      this.failures++;

      const failureRoll = Math.random() * 100;
      const failureRates = currentRates.failure;

      const destructionChance = (currentRates.destruction / failureRates) * 100;
      if (failureRoll < destructionChance) {
        this.currentLevel = 0;
        if (!this.isAutoEnhancing) {
          toast.error('Enhancement failed! Item destroyed!');
        }
      } else {
        const keep = Math.random() * (currentRates.downgrade + currentRates.disappear) >= currentRates.downgrade;
        const drop = keep ? 0 : currentRates.downgradeLevel;
        const newLevel = Math.max(checkpointFloor(this.currentLevel), this.currentLevel - drop);
        if (newLevel < this.currentLevel) {
          if (!this.isAutoEnhancing) {
            toast.error(`Enhancement failed! Item downgraded from +${this.currentLevel} to +${newLevel}`);
          }
          this.currentLevel = newLevel;
        } else if (!this.isAutoEnhancing) {
          toast.info('Enhancement failed! Materials disappeared (no change)');
        }
      }
    }

    // Skip re-render during auto-enhance to avoid flickering
    if (!this.isAutoEnhancing) {
      this.render(document.querySelector('#app'));
    }
    this.isProcessing = false;
  },

  async startAutoEnhance() {
    if (this.isAutoEnhancing || this.currentLevel >= 15) {
      return;
    }

    // Require a goal to be set
    if (this.goalLevel === null) {
      toast.warning('Set a target by clicking on a level in the rates table');
      return;
    }

    // Check if already at or above goal
    if (this.currentLevel >= this.goalLevel) {
      toast.info(`Already at +${this.currentLevel}`);
      return;
    }

    this.isAutoEnhancing = true;
    this.autoEnhanceCancelled = false;

    // Update button states
    const autoBtn = document.getElementById('auto-enhance-btn');
    if (autoBtn) {
      autoBtn.textContent = 'Stop';
      autoBtn.classList.add('auto-active');
    }

    const enhanceBtn = document.getElementById('enhance-btn');
    if (enhanceBtn) {
      enhanceBtn.disabled = true;
    }

    const levelDropdown = document.getElementById('level-dropdown');
    if (levelDropdown) {
      levelDropdown.disabled = true;
    }

    await this.runAutoEnhanceLoop();
  },

  stopAutoEnhance() {
    this.autoEnhanceCancelled = true;
    this.isAutoEnhancing = false;

    // Update button states
    const autoBtn = document.getElementById('auto-enhance-btn');
    if (autoBtn) {
      autoBtn.textContent = 'Auto';
      autoBtn.classList.remove('auto-active');
    }

    const enhanceBtn = document.getElementById('enhance-btn');
    if (enhanceBtn) {
      enhanceBtn.disabled = false;
    }

    const levelDropdown = document.getElementById('level-dropdown');
    if (levelDropdown) {
      levelDropdown.disabled = false;
    }
  },

  async runAutoEnhanceLoop() {
    const targetLevel = this.goalLevel;

    while (this.isAutoEnhancing && !this.autoEnhanceCancelled) {
      const levelBefore = this.currentLevel;

      await this.attemptEnhancement();

      // Check if goal reached
      if (this.currentLevel >= targetLevel) {
        toast.success(`Auto-enhance complete! Reached +${this.currentLevel}`);
        this.stopAutoEnhance();
        break;
      }

      // Check for destruction (level went to 0 from a higher level)
      if (levelBefore > 0 && this.currentLevel === 0) {
        toast.error('Auto-enhance stopped: Item destroyed!');
        this.stopAutoEnhance();
        break;
      }

      // Check if max level reached
      if (this.currentLevel >= 15) {
        this.stopAutoEnhance();
        break;
      }

      // Add delay and update UI if loading bar toggle is on
      // Re-check the current value so user can toggle mid-run
      if (this.useLoadingBar) {
        this.updateStatsDisplay();
        if (levelBefore !== this.currentLevel) {
          this.updateRatesTable();
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    this.render(document.querySelector('#app'));
  },

  reset() {
    this.currentLevel = 0;
    this.attempts = 0;
    this.successes = 0;
    this.failures = 0;
    this.highestLevel = 0;
    this.milestoneAttempts = {};
    this.totalLevelAttempts = {};
    this.materialsUsed = {
      essenceOfLife: 0,
      diamond: 0,
      protectionJelly: 0,
      gold: 0
    };
    this.materialsPerLevel = {};
    this.goalLevel = null;
    this.isProcessing = false;
    this.isAutoEnhancing = false;
    this.autoEnhanceCancelled = false;
    this.render(document.querySelector('#app'));
    toast.info('Enhancement simulator reset');
  },

  updateStatsDisplay() {
    // Update just the session numbers without a full re-render
    const levelDropdown = document.getElementById('level-dropdown');
    if (levelDropdown) {
      levelDropdown.options[0].text = `+${this.currentLevel}`;
      levelDropdown.options[0].value = this.currentLevel;
    }

    this.updateMaterialsDisplay();
  },

  updateRatesTable() {
    const tableContainer = document.querySelector('.rates-table-container');
    if (tableContainer) {
      tableContainer.innerHTML = this.renderRatesTable();
      this.bindRateRows();
    }
    const mode = document.getElementById('enh-rates-mode');
    if (mode) mode.textContent = this.ratesModeText();
  }
};

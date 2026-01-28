import { toast } from '../toast.js';

// Import images
import berlinImg from '../images/berlin.webp';
import saintHavenImg from '../images/saint haven.webp';
import calderockImg from '../images/calderock.webp';
import manaRidgeImg from '../images/mana ridge.webp';
import lotusMarshImg from '../images/lotus marsh.webp';
import prairieTownImg from '../images/prairie town.webp';
import colosseumImg from '../images/colosseum.png';

// Materials cost for enhancements (gold values include silver and copper converted to decimal)
const MATERIALS_COST = {
  0: { essenceOfLife: 1, diamond: 0, protectionJelly: 0, gold: 3.464 },
  1: { essenceOfLife: 1, diamond: 0, protectionJelly: 0, gold: 4.33 },
  2: { essenceOfLife: 1, diamond: 0, protectionJelly: 0, gold: 5.196 },
  3: { essenceOfLife: 2, diamond: 0, protectionJelly: 0, gold: 6.62 },
  4: { essenceOfLife: 2, diamond: 0, protectionJelly: 0, gold: 6.928 },
  5: { essenceOfLife: 2, diamond: 0, protectionJelly: 0, gold: 7.794 },
  6: { essenceOfLife: 3, diamond: 1, protectionJelly: 12, gold: 8.66 },
  7: { essenceOfLife: 3, diamond: 1, protectionJelly: 12, gold: 9.526 },
  8: { essenceOfLife: 3, diamond: 1, protectionJelly: 12, gold: 10.392 },
  9: { essenceOfLife: 4, diamond: 2, protectionJelly: 18, gold: 17.32 },
  10: { essenceOfLife: 4, diamond: 2, protectionJelly: 18, gold: 27.712 },
  11: { essenceOfLife: 4, diamond: 2, protectionJelly: 18, gold: 41.568 },
  12: { essenceOfLife: 5, diamond: 3, protectionJelly: 18, gold: 69.28 },
  13: { essenceOfLife: 5, diamond: 3, protectionJelly: 18, gold: 103.92 }
};

// Enhancement rates data from the game
const ENHANCEMENT_RATES = {
  noProtection: [
    { level: 1, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 2, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 3, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 4, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 5, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 6, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 7, success: 45, failure: 55, destruction: 25, downgrade: 0, disappear: 75, downgradeLevel: 0 },
    { level: 8, success: 40, failure: 60, destruction: 25, downgrade: 37.5, disappear: 37.5, downgradeLevel: 1 },
    { level: 9, success: 35, failure: 65, destruction: 25, downgrade: 37.5, disappear: 37.5, downgradeLevel: 2 },
    { level: 10, success: 30, failure: 70, destruction: 25, downgrade: 0, disappear: 75, downgradeLevel: 0 },
    { level: 11, success: 25, failure: 75, destruction: 25, downgrade: 75, disappear: 0, downgradeLevel: 1 },
    { level: 12, success: 20, failure: 80, destruction: 25, downgrade: 75, disappear: 0, downgradeLevel: 2 },
    { level: 13, success: 15, failure: 85, destruction: 25, downgrade: 75, disappear: 0, downgradeLevel: 2 },
    { level: 14, success: 5, failure: 95, destruction: 25, downgrade: 75, disappear: 0, downgradeLevel: 2 },
    { level: 15, success: 1, failure: 99, destruction: 25, downgrade: 75, disappear: 0, downgradeLevel: 2 }
  ],
  withProtection: [
    { level: 1, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 2, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 3, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 4, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 5, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 6, success: 100, failure: 0, destruction: 0, downgrade: 0, disappear: 0, downgradeLevel: 0 },
    { level: 7, success: 45, failure: 55, destruction: 0, downgrade: 0, disappear: 100, downgradeLevel: 0 },
    { level: 8, success: 40, failure: 60, destruction: 0, downgrade: 50, disappear: 50, downgradeLevel: 1 },
    { level: 9, success: 35, failure: 65, destruction: 0, downgrade: 50, disappear: 50, downgradeLevel: 2 },
    { level: 10, success: 30, failure: 70, destruction: 0, downgrade: 0, disappear: 100, downgradeLevel: 0 },
    { level: 11, success: 25, failure: 75, destruction: 0, downgrade: 100, disappear: 0, downgradeLevel: 1 },
    { level: 12, success: 20, failure: 80, destruction: 0, downgrade: 100, disappear: 0, downgradeLevel: 2 },
    { level: 13, success: 15, failure: 85, destruction: 0, downgrade: 100, disappear: 0, downgradeLevel: 2 },
    { level: 14, success: 5, failure: 95, destruction: 0, downgrade: 100, disappear: 0, downgradeLevel: 2 },
    { level: 15, success: 1, failure: 99, destruction: 0, downgrade: 100, disappear: 0, downgradeLevel: 2 }
  ]
};

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
  attempts: 0,
  successes: 0,
  failures: 0,
  highestLevel: 0,
  milestoneAttempts: {}, // Track attempts at each level when first successfully enhanced
  totalLevelAttempts: {}, // Track total attempts made at each level throughout session
  isProcessing: false, // Prevent double-clicks
  materialsUsed: { // Track materials consumed
    essenceOfLife: 0,
    diamond: 0,
    protectionJelly: 0,
    gold: 0
  },
  materialsPerLevel: {}, // Track materials used per level { 0: { essenceOfLife: 0, diamond: 0, protectionJelly: 0, gold: 0 }, ... }
  selectedBackground: 0, // Index of selected background

  formatGold(totalGold) {
    const gold = Math.floor(totalGold);
    const silver = Math.floor((totalGold - gold) * 100);
    const copper = Math.round(((totalGold - gold) * 100 - silver) * 100);

    if (gold === 0 && silver === 0 && copper === 0) {
      return '0g';
    }

    let result = [];
    if (gold > 0) result.push(`${gold}g`);
    if (silver > 0) result.push(`${silver}s`);
    if (copper > 0) result.push(`${copper}c`);

    return result.join(' ');
  },

  render(container) {
    container.innerHTML = `
      <div class="enhancement-page">
        <div class="page-header">
          <h1>Enhancement Simulator</h1>
        </div>

        <div class="enhancement-container">
          <div class="enhancement-main">
            <div class="blacksmith-section" style="background-image: url('${BACKGROUNDS[this.selectedBackground].path}');">
              <div class="background-selector">
                <select id="background-select" class="background-dropdown">
                  ${BACKGROUNDS.map((bg, index) => `
                    <option value="${index}" ${index === this.selectedBackground ? 'selected' : ''}>
                      ${bg.name}
                    </option>
                  `).join('')}
                </select>
              </div>
              <img src="${berlinImg}" alt="Blacksmith" class="blacksmith-image" onerror="this.style.display='none'">
              <div class="enhancement-display">
                <div class="current-level">
                  <span class="level-label">Current Level:</span>
                  <span class="level-value">+${this.currentLevel}</span>
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
                  </div>
                  <button id="enhance-btn" class="btn btn-primary">Enhance!</button>
                  <button id="reset-btn" class="btn btn-secondary">Reset</button>
                </div>
                <div class="stats">
                  <div class="stat-item">
                    <span class="stat-label">Attempts:</span>
                    <span class="stat-value">${this.attempts}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Successes:</span>
                    <span class="stat-value success">${this.successes}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Failures:</span>
                    <span class="stat-value failure">${this.failures}</span>
                  </div>
                </div>
                ${this.highestLevel >= 7 ? `
                  <div class="highest-level-section">
                    <h3>Highest Level Reached: <span class="highest-value">+${this.highestLevel}</span></h3>
                    ${this.renderMilestones()}
                  </div>
                ` : ''}
                ${this.attempts > 0 ? `
                  <div class="materials-tracker">
                    <h3>Total Materials Used</h3>
                    <div class="materials-list">
                      <div class="material-item">
                        <span class="material-count">${this.materialsUsed.essenceOfLife}</span>
                        <span class="material-name">Essence of Life</span>
                      </div>
                      <div class="material-item">
                        <span class="material-count">${this.materialsUsed.diamond}</span>
                        <span class="material-name">Polished Diamond</span>
                      </div>
                      <div class="material-item">
                        <span class="material-count">${this.materialsUsed.protectionJelly}</span>
                        <span class="material-name">Protection Jelly</span>
                      </div>
                    </div>
                    <div class="gold-section">
                      <div class="material-item gold-item">
                        <span class="material-count">${this.formatGold(this.materialsUsed.gold)}</span>
                        <span class="material-name">Gold</span>
                      </div>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="rates-section">
              <h3>Enhancement Rates</h3>
              <div class="rates-tabs">
                <button class="rates-tab ${!this.useProtection ? 'active' : ''}" data-protection="false">
                  No Protection
                </button>
                <button class="rates-tab ${this.useProtection ? 'active' : ''}" data-protection="true">
                  With Protection
                </button>
              </div>
              <div class="rates-table-container">
                ${this.renderRatesTable()}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  },

  renderMilestones() {
    const milestones = Object.keys(this.milestoneAttempts)
      .map(level => parseInt(level))
      .filter(level => level >= 7) // Only show levels 7 and above
      .sort((a, b) => a - b);

    if (milestones.length === 0) {
      return '';
    }

    return `
      <div class="milestones-list">
        ${milestones.map(level => {
          const prevLevel = level - 1;
          const firstTimeAttempts = this.milestoneAttempts[level];
          const totalAttempts = this.totalLevelAttempts[prevLevel] || 0;
          const materials = this.materialsPerLevel[prevLevel];
          const hasTooltip = materials && (materials.essenceOfLife > 0 || materials.diamond > 0 || materials.protectionJelly > 0 || materials.gold > 0);

          return `
            <div class="milestone-item ${hasTooltip ? 'has-tooltip' : ''}">
              <span class="milestone-level">+${prevLevel} → +${level}</span>
              <span class="milestone-attempts">${firstTimeAttempts} ${firstTimeAttempts === 1 ? 'tap' : 'taps'}</span>
              <span class="milestone-total">(${totalAttempts} total)</span>
              ${hasTooltip ? `
                <div class="milestone-tooltip">
                  <div class="tooltip-title">Total Materials Used</div>
                  <div class="tooltip-item">Essence of Life: ${materials.essenceOfLife}</div>
                  ${materials.diamond > 0 ? `<div class="tooltip-item">Polished Diamond: ${materials.diamond}</div>` : ''}
                  ${materials.protectionJelly > 0 ? `<div class="tooltip-item">Protection Jelly: ${materials.protectionJelly}</div>` : ''}
                  <div class="tooltip-item">Gold: ${this.formatGold(materials.gold)}</div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  renderRatesTable() {
    const rates = this.useProtection ? ENHANCEMENT_RATES.withProtection : ENHANCEMENT_RATES.noProtection;

    return `
      <table class="rates-table">
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
          ${rates.map(rate => `
            <tr class="${this.currentLevel === rate.level - 1 ? 'current-row' : ''}">
              <td>${rate.level}</td>
              <td class="success-rate">${rate.success}%</td>
              <td class="failure-rate">${rate.failure}%</td>
              <td class="destruction-rate">${rate.destruction > 0 ? rate.destruction + '%' : '-'}</td>
              <td class="downgrade-rate">${rate.downgrade > 0 ? rate.downgrade + '%' : '-'}</td>
              <td class="disappear-rate">${rate.disappear > 0 ? rate.disappear + '%' : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  attachEventListeners() {
    document.getElementById('enhance-btn').addEventListener('click', () => {
      this.attemptEnhancement();
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

    document.getElementById('background-select').addEventListener('change', (e) => {
      this.selectedBackground = parseInt(e.target.value);
      this.render(document.querySelector('#app'));
    });

    document.querySelectorAll('.rates-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const useProtection = e.target.dataset.protection === 'true';
        this.useProtection = useProtection;
        document.getElementById('protection-toggle').checked = useProtection;
        this.updateRatesTable();

        document.querySelectorAll('.rates-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
      });
    });

    // Add click handlers for milestone items with tooltips (for mobile)
    document.querySelectorAll('.milestone-item.has-tooltip').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove active class from all other items
        document.querySelectorAll('.milestone-item.has-tooltip').forEach(otherItem => {
          if (otherItem !== item) {
            otherItem.classList.remove('tooltip-visible');
          }
        });
        // Toggle active class on clicked item
        item.classList.toggle('tooltip-visible');
      });
    });

    // Close tooltips when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.milestone-item.has-tooltip')) {
        document.querySelectorAll('.milestone-item.has-tooltip').forEach(item => {
          item.classList.remove('tooltip-visible');
        });
      }
    });
  },

  attemptEnhancement() {
    // Prevent double-clicking
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    if (this.currentLevel >= 15) {
      toast.warning('Maximum enhancement level reached!');
      this.isProcessing = false;
      return;
    }

    const rates = this.useProtection ? ENHANCEMENT_RATES.withProtection : ENHANCEMENT_RATES.noProtection;
    const currentRates = rates[this.currentLevel];

    // Store current level before incrementing attempts
    const levelBeforeAttempt = this.currentLevel;

    this.attempts++;

    // Track total attempts at this level (before the attempt outcome)
    if (typeof this.totalLevelAttempts[levelBeforeAttempt] === 'undefined') {
      this.totalLevelAttempts[levelBeforeAttempt] = 0;
    }
    this.totalLevelAttempts[levelBeforeAttempt]++;

    // Track materials used for all levels
    if (MATERIALS_COST[levelBeforeAttempt]) {
      const cost = MATERIALS_COST[levelBeforeAttempt];
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

      toast.success(`Enhancement success! Now at +${this.currentLevel}`);

      if (this.currentLevel === 15) {
        toast.success('Maximum level achieved! Congratulations!', 5000);
      }
    } else {
      this.failures++;

      const failureRoll = Math.random() * 100;
      const failureRates = currentRates.failure;

      const destructionChance = (currentRates.destruction / failureRates) * 100;
      const downgradeChance = destructionChance + (currentRates.downgrade / failureRates) * 100;

      if (failureRoll < destructionChance) {
        this.currentLevel = 0;
        toast.error('Enhancement failed! Item destroyed!');
      } else if (failureRoll < downgradeChance) {
        const newLevel = Math.max(0, this.currentLevel - currentRates.downgradeLevel);
        toast.error(`Enhancement failed! Item downgraded from +${this.currentLevel} to +${newLevel}`);
        this.currentLevel = newLevel;
      } else {
        toast.info('Enhancement failed! Materials disappeared (no change)');
      }
    }

    this.render(document.querySelector('#app'));
    this.isProcessing = false;
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
    this.isProcessing = false;
    this.render(document.querySelector('#app'));
    toast.info('Enhancement simulator reset');
  },

  updateRatesTable() {
    const tableContainer = document.querySelector('.rates-table-container');
    if (tableContainer) {
      tableContainer.innerHTML = this.renderRatesTable();
    }
  }
};

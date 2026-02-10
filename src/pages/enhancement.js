import { toast } from '../toast.js';
import { modal } from '../modal.js';

// Import images
import berlinImg from '../images/berlin.webp';
import saintHavenImg from '../images/saint haven.webp';
import calderockImg from '../images/calderock.webp';
import manaRidgeImg from '../images/mana ridge.webp';
import lotusMarshImg from '../images/lotus marsh.webp';
import prairieTownImg from '../images/prairie town.webp';
import colosseumImg from '../images/colosseum.png';
import crosshairIcon from '../icons/crosshair.svg';
import progressbarIcon from '../icons/progressbar.svg';

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
  goalLevel: null, // Target enhancement level
  essenceOfLifePrice: 0, // Gold price per Essence of Life
  polishedDiamondPrice: 0, // Gold price per Polished Diamond
  protectionJellyPrice: 0, // Gold price per Protection Jelly
  showMaterialCosts: { // Individual toggles for each material cost
    essenceOfLife: false,
    diamond: false,
    protectionJelly: false
  },
  showMaterialCostTab: false, // Whether Material Cost tab is active

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
                <div class="stats">
                  <div class="stat-item">
                    <span class="stat-label">Attempts:</span>
                    <span class="stat-value">${this.formatNumber(this.attempts)}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Successes:</span>
                    <span class="stat-value success">${this.formatNumber(this.successes)}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Failures:</span>
                    <span class="stat-value failure">${this.formatNumber(this.failures)}</span>
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
                    <div class="materials-header">
                      <h3>Total Materials Used</h3>
                      <div class="toggle-section">
                        <label class="material-cost-toggle">
                          <input type="checkbox" id="material-cost-toggle" ${
                            this.showMaterialCosts.essenceOfLife &&
                            this.showMaterialCosts.diamond &&
                            this.showMaterialCosts.protectionJelly ? 'checked' : ''
                          }>
                          <span>Show Material Cost</span>
                        </label>
                        <p class="material-cost-hint">Or click each material</p>
                      </div>
                    </div>
                    <div class="materials-list">
                      <div class="material-item clickable ${this.showMaterialCosts.essenceOfLife ? 'show-cost' : ''}" data-material="essenceOfLife">
                        <span class="material-count">${this.formatNumber(this.materialsUsed.essenceOfLife)}</span>
                        <span class="material-name">Essence of Life</span>
                        ${this.showMaterialCosts.essenceOfLife && this.essenceOfLifePrice > 0 ? `
                          <span class="material-cost">${this.formatGold(this.materialsUsed.essenceOfLife * this.essenceOfLifePrice)}</span>
                        ` : ''}
                      </div>
                      <div class="material-item clickable ${this.showMaterialCosts.diamond ? 'show-cost' : ''}" data-material="diamond">
                        <span class="material-count">${this.formatNumber(this.materialsUsed.diamond)}</span>
                        <span class="material-name">Polished Diamond</span>
                        ${this.showMaterialCosts.diamond && this.polishedDiamondPrice > 0 ? `
                          <span class="material-cost">${this.formatGold(this.materialsUsed.diamond * this.polishedDiamondPrice)}</span>
                        ` : ''}
                      </div>
                      <div class="material-item clickable ${this.showMaterialCosts.protectionJelly ? 'show-cost' : ''}" data-material="protectionJelly">
                        <span class="material-count">${this.formatNumber(this.materialsUsed.protectionJelly)}</span>
                        <span class="material-name">Protection Jelly</span>
                        ${this.showMaterialCosts.protectionJelly && this.protectionJellyPrice > 0 ? `
                          <span class="material-cost">${this.formatGold(this.materialsUsed.protectionJelly * this.protectionJellyPrice)}</span>
                        ` : ''}
                      </div>
                    </div>
                    <div class="gold-section">
                      <div class="material-item gold-item">
                        <span class="material-count">${this.formatGold(this.materialsUsed.gold)}</span>
                        <span class="material-name">Gold</span>
                      </div>
                      ${(this.showMaterialCosts.essenceOfLife && this.essenceOfLifePrice > 0) ||
                        (this.showMaterialCosts.diamond && this.polishedDiamondPrice > 0) ||
                        (this.showMaterialCosts.protectionJelly && this.protectionJellyPrice > 0) ? `
                        <div class="material-item gold-item total-cost">
                          <span class="material-count">${this.formatGold(
                            this.materialsUsed.gold +
                            (this.showMaterialCosts.essenceOfLife ? this.materialsUsed.essenceOfLife * this.essenceOfLifePrice : 0) +
                            (this.showMaterialCosts.diamond ? this.materialsUsed.diamond * this.polishedDiamondPrice : 0) +
                            (this.showMaterialCosts.protectionJelly ? this.materialsUsed.protectionJelly * this.protectionJellyPrice : 0)
                          )}</span>
                          <span class="material-name">Total Cost</span>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="rates-section">
              <h3>Enhancement Rates</h3>
              <div class="rates-tabs">
                <button class="rates-tab ${!this.useProtection && !this.showMaterialCostTab ? 'active' : ''}" data-tab="no-protection">
                  No Protection
                </button>
                <button class="rates-tab ${this.useProtection && !this.showMaterialCostTab ? 'active' : ''}" data-tab="with-protection">
                  With Protection
                </button>
                <button class="rates-tab ${this.showMaterialCostTab ? 'active' : ''}" data-tab="material-cost">
                  Material Cost
                </button>
              </div>
              <div class="rates-table-container">
                ${this.showMaterialCostTab ? this.renderMaterialCostTab() : this.renderRatesTable()}
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
                  <div class="tooltip-item">Essence of Life: ${materials.essenceOfLife}${
                    this.showMaterialCosts.essenceOfLife && this.essenceOfLifePrice > 0
                      ? ` (${this.formatGold(materials.essenceOfLife * this.essenceOfLifePrice)})`
                      : ''
                  }</div>
                  ${materials.diamond > 0 ? `<div class="tooltip-item">Polished Diamond: ${materials.diamond}${
                    this.showMaterialCosts.diamond && this.polishedDiamondPrice > 0
                      ? ` (${this.formatGold(materials.diamond * this.polishedDiamondPrice)})`
                      : ''
                  }</div>` : ''}
                  ${materials.protectionJelly > 0 ? `<div class="tooltip-item">Protection Jelly: ${materials.protectionJelly}${
                    this.showMaterialCosts.protectionJelly && this.protectionJellyPrice > 0
                      ? ` (${this.formatGold(materials.protectionJelly * this.protectionJellyPrice)})`
                      : ''
                  }</div>` : ''}
                  <div class="tooltip-item">Gold: ${this.formatGold(materials.gold)}</div>
                  ${(this.showMaterialCosts.essenceOfLife && this.essenceOfLifePrice > 0) ||
                    (this.showMaterialCosts.diamond && this.polishedDiamondPrice > 0) ||
                    (this.showMaterialCosts.protectionJelly && this.protectionJellyPrice > 0) ? `
                    <div class="tooltip-item tooltip-total">Total Cost: ${this.formatGold(
                      materials.gold +
                      (this.showMaterialCosts.essenceOfLife ? materials.essenceOfLife * this.essenceOfLifePrice : 0) +
                      (this.showMaterialCosts.diamond ? materials.diamond * this.polishedDiamondPrice : 0) +
                      (this.showMaterialCosts.protectionJelly ? materials.protectionJelly * this.protectionJellyPrice : 0)
                    )}</div>
                  ` : ''}
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
          ${rates.map(rate => {
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
                <td class="success-rate">${rate.success}%</td>
                <td class="failure-rate">${rate.failure}%</td>
                <td class="destruction-rate">${rate.destruction > 0 ? rate.destruction + '%' : '-'}</td>
                <td class="downgrade-rate">${rate.downgrade > 0 ? rate.downgrade + '%' : '-'}</td>
                <td class="disappear-rate">${rate.disappear > 0 ? rate.disappear + '%' : '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  renderMaterialCostTab() {
    return `
      <div class="material-cost-tab">
        <p class="material-cost-description">How much each material costs:</p>
        <div class="material-cost-inputs">
          <div class="form-group">
            <label for="essence-price">Essence of Life:</label>
            <input
              type="number"
              id="essence-price"
              min="0"
              step="0.01"
              value="${this.essenceOfLifePrice}"
              placeholder="0.00"
            >
          </div>
          <div class="form-group">
            <label for="diamond-price">Polished Diamond:</label>
            <input
              type="number"
              id="diamond-price"
              min="0"
              step="0.01"
              value="${this.polishedDiamondPrice}"
              placeholder="0.00"
            >
          </div>
          <div class="form-group">
            <label for="jelly-price">Protection Jelly:</label>
            <input
              type="number"
              id="jelly-price"
              min="0"
              step="0.01"
              value="${this.protectionJellyPrice}"
              placeholder="0.00"
            >
          </div>
        </div>
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

    document.getElementById('background-select').addEventListener('change', (e) => {
      this.selectedBackground = parseInt(e.target.value);
      this.render(document.querySelector('#app'));
    });

    document.querySelectorAll('.rates-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabType = e.target.dataset.tab;

        if (tabType === 'material-cost') {
          this.showMaterialCostTab = true;
        } else {
          this.showMaterialCostTab = false;
          const useProtection = tabType === 'with-protection';
          this.useProtection = useProtection;
          document.getElementById('protection-toggle').checked = useProtection;
        }

        this.updateRatesTable();

        document.querySelectorAll('.rates-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
      });
    });

    // Add click handlers for rates table rows to set goal
    document.querySelectorAll('.rates-table tbody tr').forEach(row => {
      row.addEventListener('click', (e) => {
        // Prevent changing goal while auto-enhancing
        if (this.isAutoEnhancing) {
          return;
        }

        const level = parseInt(row.dataset.level);

        // Toggle goal: if clicking the same level, remove goal
        if (this.goalLevel === level) {
          this.goalLevel = null;
        } else {
          this.goalLevel = level;
        }
        this.updateRatesTable();
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

    // Material cost toggle checkbox - toggle all at once
    const materialCostToggle = document.getElementById('material-cost-toggle');
    if (materialCostToggle) {
      materialCostToggle.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.showMaterialCosts.essenceOfLife = checked;
        this.showMaterialCosts.diamond = checked;
        this.showMaterialCosts.protectionJelly = checked;
        this.render(document.querySelector('#app'));
      });
    }

    // Material item click handlers for toggling cost display
    document.querySelectorAll('.material-item.clickable').forEach(item => {
      item.addEventListener('click', (e) => {
        const material = item.dataset.material;
        if (material) {
          this.showMaterialCosts[material] = !this.showMaterialCosts[material];
          this.render(document.querySelector('#app'));
        }
      });
    });

    // Attach material price input listeners if Material Cost tab is active
    if (this.showMaterialCostTab) {
      this.updateMaterialPrices();
    }

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

  updateMaterialPrices() {
    const essenceInput = document.getElementById('essence-price');
    const diamondInput = document.getElementById('diamond-price');
    const jellyInput = document.getElementById('jelly-price');

    if (essenceInput) {
      essenceInput.addEventListener('input', (e) => {
        this.essenceOfLifePrice = parseFloat(e.target.value) || 0;
        // Update materials display if any cost is being shown
        if (Object.values(this.showMaterialCosts).some(show => show)) {
          this.updateMaterialsDisplay();
        }
      });
    }

    if (diamondInput) {
      diamondInput.addEventListener('input', (e) => {
        this.polishedDiamondPrice = parseFloat(e.target.value) || 0;
        // Update materials display if any cost is being shown
        if (Object.values(this.showMaterialCosts).some(show => show)) {
          this.updateMaterialsDisplay();
        }
      });
    }

    if (jellyInput) {
      jellyInput.addEventListener('input', (e) => {
        this.protectionJellyPrice = parseFloat(e.target.value) || 0;
        // Update materials display if any cost is being shown
        if (Object.values(this.showMaterialCosts).some(show => show)) {
          this.updateMaterialsDisplay();
        }
      });
    }
  },

  updateMaterialsDisplay() {
    // Update the materials tracker display without full re-render
    const materialsTracker = document.querySelector('.materials-tracker');
    if (materialsTracker && this.attempts > 0) {
      const materialsHtml = `
        <div class="materials-header">
          <h3>Total Materials Used</h3>
          <div class="toggle-section">
            <label class="material-cost-toggle">
              <input type="checkbox" id="material-cost-toggle" ${
                this.showMaterialCosts.essenceOfLife &&
                this.showMaterialCosts.diamond &&
                this.showMaterialCosts.protectionJelly ? 'checked' : ''
              }>
              <span>Show Material Cost</span>
            </label>
            <p class="material-cost-hint">Or click each material</p>
          </div>
        </div>
        <div class="materials-list">
          <div class="material-item clickable ${this.showMaterialCosts.essenceOfLife ? 'show-cost' : ''}" data-material="essenceOfLife">
            <span class="material-count">${this.materialsUsed.essenceOfLife}</span>
            <span class="material-name">Essence of Life</span>
            ${this.showMaterialCosts.essenceOfLife && this.essenceOfLifePrice > 0 ? `
              <span class="material-cost">${this.formatGold(this.materialsUsed.essenceOfLife * this.essenceOfLifePrice)}</span>
            ` : ''}
          </div>
          <div class="material-item clickable ${this.showMaterialCosts.diamond ? 'show-cost' : ''}" data-material="diamond">
            <span class="material-count">${this.materialsUsed.diamond}</span>
            <span class="material-name">Polished Diamond</span>
            ${this.showMaterialCosts.diamond && this.polishedDiamondPrice > 0 ? `
              <span class="material-cost">${this.formatGold(this.materialsUsed.diamond * this.polishedDiamondPrice)}</span>
            ` : ''}
          </div>
          <div class="material-item clickable ${this.showMaterialCosts.protectionJelly ? 'show-cost' : ''}" data-material="protectionJelly">
            <span class="material-count">${this.materialsUsed.protectionJelly}</span>
            <span class="material-name">Protection Jelly</span>
            ${this.showMaterialCosts.protectionJelly && this.protectionJellyPrice > 0 ? `
              <span class="material-cost">${this.formatGold(this.materialsUsed.protectionJelly * this.protectionJellyPrice)}</span>
            ` : ''}
          </div>
        </div>
        <div class="gold-section">
          <div class="material-item gold-item">
            <span class="material-count">${this.formatGold(this.materialsUsed.gold)}</span>
            <span class="material-name">Gold</span>
          </div>
          ${(this.showMaterialCosts.essenceOfLife && this.essenceOfLifePrice > 0) ||
            (this.showMaterialCosts.diamond && this.polishedDiamondPrice > 0) ||
            (this.showMaterialCosts.protectionJelly && this.protectionJellyPrice > 0) ? `
            <div class="material-item gold-item total-cost">
              <span class="material-count">${this.formatGold(
                this.materialsUsed.gold +
                (this.showMaterialCosts.essenceOfLife ? this.materialsUsed.essenceOfLife * this.essenceOfLifePrice : 0) +
                (this.showMaterialCosts.diamond ? this.materialsUsed.diamond * this.polishedDiamondPrice : 0) +
                (this.showMaterialCosts.protectionJelly ? this.materialsUsed.protectionJelly * this.protectionJellyPrice : 0)
              )}</span>
              <span class="material-name">Total Cost</span>
            </div>
          ` : ''}
        </div>
      `;
      materialsTracker.innerHTML = materialsHtml;

      // Re-attach checkbox listener
      const materialCostToggle = document.getElementById('material-cost-toggle');
      if (materialCostToggle) {
        materialCostToggle.addEventListener('change', (e) => {
          const checked = e.target.checked;
          this.showMaterialCosts.essenceOfLife = checked;
          this.showMaterialCosts.diamond = checked;
          this.showMaterialCosts.protectionJelly = checked;
          this.render(document.querySelector('#app'));
        });
      }

      // Re-attach click listeners
      document.querySelectorAll('.material-item.clickable').forEach(item => {
        item.addEventListener('click', (e) => {
          const material = item.dataset.material;
          if (material) {
            this.showMaterialCosts[material] = !this.showMaterialCosts[material];
            this.render(document.querySelector('#app'));
          }
        });
      });
    }
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
      const downgradeChance = destructionChance + (currentRates.downgrade / failureRates) * 100;

      if (failureRoll < destructionChance) {
        this.currentLevel = 0;
        if (!this.isAutoEnhancing) {
          toast.error('Enhancement failed! Item destroyed!');
        }
      } else if (failureRoll < downgradeChance) {
        const newLevel = Math.max(0, this.currentLevel - currentRates.downgradeLevel);
        if (!this.isAutoEnhancing) {
          toast.error(`Enhancement failed! Item downgraded from +${this.currentLevel} to +${newLevel}`);
        }
        this.currentLevel = newLevel;
      } else {
        if (!this.isAutoEnhancing) {
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
    // Update just the stats without full re-render
    const levelDropdown = document.getElementById('level-dropdown');
    if (levelDropdown) {
      levelDropdown.options[0].text = `+${this.currentLevel}`;
      levelDropdown.options[0].value = this.currentLevel;
    }

    const statValues = document.querySelectorAll('.stat-value');
    if (statValues.length >= 3) {
      statValues[0].textContent = this.formatNumber(this.attempts);
      statValues[1].textContent = this.formatNumber(this.successes);
      statValues[2].textContent = this.formatNumber(this.failures);
    }
  },

  updateRatesTable() {
    const tableContainer = document.querySelector('.rates-table-container');
    if (tableContainer) {
      tableContainer.innerHTML = this.showMaterialCostTab ? this.renderMaterialCostTab() : this.renderRatesTable();

      if (this.showMaterialCostTab) {
        // Attach listeners for material price inputs
        this.updateMaterialPrices();
      } else {
        // Re-attach click handlers for rates table rows to set goal
        document.querySelectorAll('.rates-table tbody tr').forEach(row => {
          row.addEventListener('click', (e) => {
            // Prevent changing goal while auto-enhancing
            if (this.isAutoEnhancing) {
              return;
            }

            const level = parseInt(row.dataset.level);

            // Toggle goal: if clicking the same level, remove goal
            if (this.goalLevel === level) {
              this.goalLevel = null;
            } else {
              this.goalLevel = level;
            }
            this.updateRatesTable();
          });
        });

        // Set up drag and drop for rates table
        this.setupDragAndDropTableRows();
      }
    }
  }
};

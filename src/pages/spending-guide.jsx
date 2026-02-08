import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { authService } from '../auth.js';

export const SpendingGuidePage = {
  config: {
    usdAmount: 400,
    cashPointsReceived: 500000,
    pointsPerLavish: 5900,
    goldPerLavish: 700,
    goldPrice: 0.44,
    goldCurrency: 'PHP',
    phpPerUsd: 56,
    audPerUsd: 1.55
  },

  tradingHouseCut: 0.10, // 10% cut, always fixed

  async render(container) {
    container.innerHTML = `
      <div class="spending-guide-page">
        <div class="page-header">
          <h1>Spending Guide</h1>
          <p class="page-subtitle">Is Lavish the answer?</p>
        </div>

        <div class="calculator-section">
          <div class="form-group">
            <label for="target-gold">Target Gold Amount:</label>
            <input type="number" id="target-gold" placeholder="e.g. 50000" min="1" value="40000">
          </div>
        </div>

        <div id="results" class="results-section">
          <h2>Results</h2>

          <div class="results-row">
            <div class="result-card cash-shop">
              <h3>Cash Shop (Lavish)</h3>
              <div class="result-details">
                <p><strong>Lavish needed:</strong> <span id="lavish-count">-</span></p>
                <p><strong>Cash points needed:</strong> <span id="cash-points">-</span></p>
                <p><strong>USD cost:</strong> <span id="cash-shop-usd">-</span></p>
                <p class="note">* Includes 10% trading house cut</p>
              </div>
            </div>

            <div class="result-card player-trade">
              <h3>Player Trade</h3>
              <div class="result-details">
                <p><strong>USD equivalent:</strong> <span id="player-usd">-</span></p>
                <p><strong>AUD equivalent:</strong> <span id="player-aud">-</span></p>
                <p><strong>PHP cost:</strong> <span id="player-php">-</span></p>
              </div>
            </div>
          </div>

          <div class="result-card comparison">
            <h3>Comparison</h3>
            <p id="recommendation">-</p>
          </div>
        </div>

        <div class="rates-section">
          <h2>Current Rates</h2>

          <div id="rates-loading" class="loading">Loading rates...</div>

          <div id="rates-form" style="display: none;">
            <div class="rates-grid">
              <div class="rate-group">
                <h4>Cash Shop</h4>
                <div class="form-group">
                  <label>Lavish selling price:</label>
                  <div class="input-with-unit">
                    <span class="unit-prefix">1 Lavish =</span>
                    <input type="number" id="rate-gold-per-lavish" min="1">
                    <span class="unit-suffix">gold</span>
                  </div>
                </div>
              </div>

              <div class="rate-group">
                <h4>Player Trade</h4>
                <div class="form-group">
                  <label>Gold rate:</label>
                  <div class="input-with-unit">
                    <span class="unit-prefix" id="gold-rate-prefix">1 Gold =</span>
                    <input type="number" id="rate-gold-price" min="0.001" step="0.001">
                    <select id="rate-gold-currency">
                      <option value="PHP">PHP</option>
                      <option value="USD">USD</option>
                      <option value="AUD">AUD</option>
                    </select>
                  </div>
                </div>
                <div class="form-group">
                  <label>Exchange rate:</label>
                  <div class="input-with-unit">
                    <span class="unit-prefix">$1 =</span>
                    <input type="number" id="rate-php-per-usd" min="0.01" step="0.01">
                    <span class="unit-suffix">PHP</span>
                    <button type="button" id="refresh-rate-btn" class="btn-icon" title="Fetch current rate">🔄</button>
                  </div>
                </div>
              </div>
            </div>

            ${authService.isAdmin() ? '<button id="save-rates-btn" class="btn btn-secondary">Save Rates</button>' : ''}
          </div>

          <div id="rates-error" class="error" style="display: none;">
            Failed to load rates. <button id="retry-load-btn" class="btn btn-secondary">Retry</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    await this.loadConfig();
  },

  bindEvents() {
    // Auto-calculate as user types
    document.getElementById('target-gold').addEventListener('input', () => {
      this.calculate();
    });

    const saveBtn = document.getElementById('save-rates-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.saveConfig();
      });
    }

    document.getElementById('retry-load-btn').addEventListener('click', () => {
      this.loadConfig();
    });

    document.getElementById('refresh-rate-btn').addEventListener('click', () => {
      this.fetchExchangeRate();
    });

    // Recalculate when currency changes and update label
    document.getElementById('rate-gold-currency').addEventListener('change', () => {
      this.updateGoldRateLabel();
      this.calculate();
    });

    // Recalculate when gold price changes
    document.getElementById('rate-gold-price').addEventListener('input', () => {
      this.calculate();
    });

    // Recalculate when exchange rate changes
    document.getElementById('rate-php-per-usd').addEventListener('input', () => {
      this.calculate();
    });

    // Recalculate when lavish price changes
    document.getElementById('rate-gold-per-lavish').addEventListener('input', () => {
      this.calculate();
    });
  },

  async loadConfig() {
    document.getElementById('rates-loading').style.display = 'block';
    document.getElementById('rates-form').style.display = 'none';
    document.getElementById('rates-error').style.display = 'none';

    if (!dataService.hasWriteAccess()) {
      // Fall back to localStorage if no Apps Script configured
      this.loadFromLocalStorage();
      return;
    }

    try {
      const result = await dataService.getSpendingConfig();
      if (result.success && result.config) {
        this.config = { ...this.config, ...result.config };
      }
      this.updateFormFields();
      document.getElementById('rates-loading').style.display = 'none';
      document.getElementById('rates-form').style.display = 'block';
      this.calculate();
      this.fetchExchangeRate();
    } catch (error) {
      console.error('Failed to load spending config:', error);
      // Try localStorage fallback
      this.loadFromLocalStorage();
    }
  },

  loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem('spending_guide_config');
      if (saved) {
        this.config = { ...this.config, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error('Failed to load from localStorage', e);
    }
    this.updateFormFields();
    document.getElementById('rates-loading').style.display = 'none';
    document.getElementById('rates-form').style.display = 'block';
    this.calculate();
    this.fetchExchangeRate();
  },

  updateFormFields() {
    document.getElementById('rate-gold-per-lavish').value = this.config.goldPerLavish;
    document.getElementById('rate-gold-price').value = this.config.goldPrice;
    document.getElementById('rate-gold-currency').value = this.config.goldCurrency;
    document.getElementById('rate-php-per-usd').value = this.config.phpPerUsd;
    this.updateGoldRateLabel();
  },

  updateGoldRateLabel() {
    const currency = document.getElementById('rate-gold-currency').value;
    const prefix = document.getElementById('gold-rate-prefix');
    prefix.textContent = (currency === 'USD' || currency === 'AUD') ? '100 Gold =' : '1 Gold =';
  },

  readFormFields() {
    this.config.goldPerLavish = parseFloat(document.getElementById('rate-gold-per-lavish').value) || 700;
    this.config.goldPrice = parseFloat(document.getElementById('rate-gold-price').value) || 0.44;
    this.config.goldCurrency = document.getElementById('rate-gold-currency').value || 'PHP';
    this.config.phpPerUsd = parseFloat(document.getElementById('rate-php-per-usd').value) || 56;
  },

  async saveConfig() {
    this.readFormFields();

    const btn = document.getElementById('save-rates-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    // Always save to localStorage as backup
    localStorage.setItem('spending_guide_config', JSON.stringify(this.config));

    if (dataService.hasWriteAccess()) {
      try {
        await dataService.saveSpendingConfig(this.config);
        toast.success('Rates saved!');
      } catch (error) {
        console.error('Failed to save to backend:', error);
        toast.warning('Saved locally only (backend error)');
      }
    } else {
      toast.info('Saved locally (no backend configured)');
    }

    btn.textContent = 'Saved!';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);

    // Auto-recalculate with new rates
    this.calculate();
  },

  calculate() {
    const targetGold = parseFloat(document.getElementById('target-gold').value);

    if (!targetGold || targetGold <= 0) {
      return;
    }

    // Read current form values
    this.readFormFields();

    // Derived values for cash shop
    const pointsPerUsd = this.config.cashPointsReceived / this.config.usdAmount;
    const goldPerLavishAfterCut = this.config.goldPerLavish * (1 - this.tradingHouseCut);

    // Cash shop calculation
    const lavishNeeded = Math.ceil(targetGold / goldPerLavishAfterCut);
    const cashPointsNeeded = lavishNeeded * this.config.pointsPerLavish;
    const cashShopUsd = cashPointsNeeded / pointsPerUsd;

    // Player trade calculation
    let playerUsd, playerPhp, playerAud;
    if (this.config.goldCurrency === 'USD') {
      // Price is in USD per 100 gold
      playerUsd = targetGold * (this.config.goldPrice / 100);
      playerPhp = playerUsd * this.config.phpPerUsd;
      playerAud = playerUsd * this.config.audPerUsd;
    } else if (this.config.goldCurrency === 'AUD') {
      // Price is in AUD per 100 gold, convert to USD
      playerAud = targetGold * (this.config.goldPrice / 100);
      playerUsd = playerAud / this.config.audPerUsd;
      playerPhp = playerUsd * this.config.phpPerUsd;
    } else {
      // Price is in PHP per 1 gold
      playerPhp = targetGold * this.config.goldPrice;
      playerUsd = playerPhp / this.config.phpPerUsd;
      playerAud = playerUsd * this.config.audPerUsd;
    }

    // Display results
    document.getElementById('lavish-count').textContent = lavishNeeded.toLocaleString();
    document.getElementById('cash-points').textContent = cashPointsNeeded.toLocaleString();
    document.getElementById('cash-shop-usd').textContent = `$${cashShopUsd.toFixed(2)}`;
    document.getElementById('player-usd').textContent = `$${playerUsd.toFixed(2)}`;
    document.getElementById('player-aud').textContent = `A$${playerAud.toFixed(2)}`;
    document.getElementById('player-php').textContent = `₱${playerPhp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Recommendation
    const recommendation = document.getElementById('recommendation');
    const savings = Math.abs(cashShopUsd - playerUsd);

    let note = '';
    if (this.config.goldCurrency === 'PHP' && savings < 30) {
      note = '<p class="note">* The difference is LOW, selling lavish is preferable depending on your transaction fees</p>';
    }

    if (cashShopUsd < playerUsd) {
      recommendation.innerHTML = `<span class="better-deal cash">Cash Shop is cheaper</span> by <strong>$${savings.toFixed(2)}</strong>${note}`;
    } else if (playerUsd < cashShopUsd) {
      recommendation.innerHTML = `<span class="better-deal player">Player Trade is cheaper</span> by <strong>$${savings.toFixed(2)}</strong>${note}`;
    } else {
      recommendation.innerHTML = `Both options cost the same!${note}`;
    }
  },

  async fetchExchangeRate() {
    const btn = document.getElementById('refresh-rate-btn');
    const input = document.getElementById('rate-php-per-usd');

    btn.disabled = true;
    btn.textContent = '...';

    try {
      const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=PHP,AUD');
      if (!response.ok) throw new Error('Failed to fetch');

      const data = await response.json();
      const phpRate = data.rates.PHP;
      const audRate = data.rates.AUD;

      input.value = phpRate.toFixed(2);
      this.config.phpPerUsd = phpRate;
      this.config.audPerUsd = audRate;
      this.calculate();

      toast.success(`Rates updated: $1 = ₱${phpRate.toFixed(2)} / A$${audRate.toFixed(2)}`);
    } catch (error) {
      console.error('Failed to fetch exchange rate:', error);
      toast.error('Failed to fetch exchange rate');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄';
    }
  }
};

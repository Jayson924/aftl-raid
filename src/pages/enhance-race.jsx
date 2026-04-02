import { TIEBREAKER_START_LEVEL, TIEBREAKER_TARGET_LEVEL, TIEBREAKER_RATES } from '../arena/arena-constants.js';
import berlinImg from '../images/berlin.webp';

/**
 * Standalone Enhancement Race — shared-screen party mini-game.
 * 2-8 blacksmiths orbit a central enhance button, race from +9 to +13.
 * Fewest taps wins.
 */

const CATCHUP_BOOST_PER_FINISHER = 5;
const CATCHUP_THRESHOLD = 3;

/**
 * Simulate all smiths step-by-step together.
 * Each time a smith finishes, remaining ones get a cumulative rate boost.
 * Returns array of { taps, totalTaps, name, index } sorted by totalTaps asc.
 */
function simulateRace(count) {
  const smiths = [];
  for (let i = 0; i < count; i++) {
    smiths.push({ level: TIEBREAKER_START_LEVEL, taps: [], done: false });
  }

  let finishedCount = 0;

  while (smiths.some(s => !s.done)) {
    for (const smith of smiths) {
      if (smith.done) continue;

      const targetLevel = smith.level + 1;
      const baseRate = TIEBREAKER_RATES[targetLevel];
      const boostCount = Math.max(0, finishedCount - CATCHUP_THRESHOLD);
      const boostedSuccess = baseRate.success + (boostCount * CATCHUP_BOOST_PER_FINISHER);
      const roll = Math.random() * 100;
      const success = roll < boostedSuccess;
      const newLevel = success ? targetLevel : Math.max(TIEBREAKER_START_LEVEL, smith.level - baseRate.failDowngrade);

      smith.taps.push({
        fromLevel: smith.level,
        toLevel: newLevel,
        targetLevel,
        success,
        roll: Math.round(roll * 100) / 100
      });

      smith.level = newLevel;

      if (smith.level >= TIEBREAKER_TARGET_LEVEL) {
        smith.done = true;
        finishedCount++;
      }
    }
  }

  return smiths.map((s, i) => ({
    taps: s.taps,
    totalTaps: s.taps.length,
    finalLevel: s.level,
    index: i
  }));
}

/**
 * Count taps spent at each enhancement level (attempts to go from X to X+1).
 */
function getTapBreakdown(taps) {
  const counts = {};
  for (let l = TIEBREAKER_START_LEVEL; l < TIEBREAKER_TARGET_LEVEL; l++) {
    counts[l] = 0;
  }
  for (const tap of taps) {

    const from = tap.targetLevel - 1;
    if (counts[from] !== undefined) counts[from]++;
  }
  return counts;
}

function buildBreakdownHTML(taps) {
  const counts = getTapBreakdown(taps);
  const rows = Object.entries(counts).map(([from, count]) => {
    const to = Number(from) + 1;
    return `
      <div class="er-bd-row">
        <span class="er-bd-level">+${from} → +${to}</span>
        <span class="er-bd-count">${count}</span>
      </div>
    `;
  }).join('');
  return `<div class="er-breakdown">${rows}</div>`;
}

const MIN_SMITHS = 2;
const MAX_SMITHS = 8;

export const EnhanceRacePage = {
  _container: null,
  _smithCount: 4,
  _names: [],
  _results: null,
  _animating: false,
  _animationTimer: null,
  _winnerId: null,

  async render(container) {
    container.innerHTML = '';
    this._container = container;

    const content = document.createElement('div');
    content.className = 'enhance-race';
    container.appendChild(content);

    this._renderSetup(content);
  },

  _renderSetup(container) {
    const nameInputs = [];
    for (let i = 0; i < this._smithCount; i++) {
      nameInputs.push(`
        <div class="er-name-row">
          <span class="er-name-num">${i + 1}</span>
          <input type="text" class="er-name-input" data-index="${i}"
                 placeholder="Blacksmith ${i + 1}" maxlength="16"
                 value="${this._names[i] || ''}" />
        </div>
      `);
    }

    container.innerHTML = `
      <div class="er-setup">
        <div class="er-title">
          <h2>Enhancement Race</h2>
          <p>+${TIEBREAKER_START_LEVEL} to +${TIEBREAKER_TARGET_LEVEL}: fewest taps wins</p>
        </div>

        <div class="er-count-section">
          <label>Blacksmiths</label>
          <div class="er-count-row">
            <button class="er-count-btn" id="count-down" ${this._smithCount <= MIN_SMITHS ? 'disabled' : ''}>−</button>
            <span class="er-count-value" id="count-display">${this._smithCount}</span>
            <button class="er-count-btn" id="count-up" ${this._smithCount >= MAX_SMITHS ? 'disabled' : ''}>+</button>
          </div>
        </div>

        <div class="er-names-section">
          <label>Names</label>
          <div class="er-names-list" id="names-list">
            ${nameInputs.join('')}
          </div>
        </div>

        <div class="er-rates-section">
          ${Object.entries(TIEBREAKER_RATES).map(([level, rate]) => `
            <span class="er-rate">+${level}: ${rate.success}%${rate.failDowngrade > 0 ? ` / -${rate.failDowngrade}` : ''}</span>
          `).join('')}
        </div>

        <button class="er-start-btn" id="start-btn">Enhance!</button>
      </div>
    `;

    document.getElementById('count-down').addEventListener('click', () => {
      if (this._smithCount > MIN_SMITHS) {
        this._saveNames();
        this._smithCount--;
        this._renderSetup(container);
      }
    });
    document.getElementById('count-up').addEventListener('click', () => {
      if (this._smithCount < MAX_SMITHS) {
        this._saveNames();
        this._smithCount++;
        this._renderSetup(container);
      }
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      this._saveNames();
      this._startRace(container);
    });

    const inputs = container.querySelectorAll('.er-name-input');
    inputs.forEach((input, i) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (i < inputs.length - 1) {
            inputs[i + 1].focus();
          } else {
            this._saveNames();
            this._startRace(container);
          }
        }
      });
    });
  },

  _saveNames() {
    const inputs = document.querySelectorAll('.er-name-input');
    this._names = [];
    inputs.forEach((input, i) => {
      this._names[i] = input.value.trim();
    });
  },

  _getSmithName(i) {
    return this._names[i] || `Blacksmith ${i + 1}`;
  },

  _startRace(container) {
    let results;
    do {
      results = simulateRace(this._smithCount);
      results.forEach(r => r.name = this._getSmithName(r.index));
      results.sort((a, b) => a.totalTaps - b.totalTaps);
    } while (results[0].totalTaps === results[1].totalTaps);

    this._results = results;
    this._winnerId = results[0].index;

    this._renderRace(container);
    this._runAnimation(container);
  },

  _renderRace(container) {
    const count = this._smithCount;
    const orbitRadius = this._getOrbitRadius();

    const smithNodes = [];
    for (let i = 0; i < count; i++) {
      smithNodes.push(`
        <div class="er-smith" id="smith-${i}">
          <img src="${berlinImg}" alt="" class="er-smith-bg" />
          <div class="er-smith-name">${this._getSmithName(i)}</div>
          <div class="er-smith-level" id="smith-level-${i}">+${TIEBREAKER_START_LEVEL}</div>
          <div class="er-smith-bar">
            <div class="er-smith-bar-fill" id="smith-bar-${i}" style="width: 0%"></div>
          </div>
          <div class="er-smith-taps" id="smith-taps-${i}"></div>
          <div class="er-smith-breakdown" id="smith-bd-${i}"></div>
        </div>
      `);
    }

    container.innerHTML = `
      <div class="er-race">
        <div class="er-orbit-container" id="orbit-container">
          <div class="er-center">
            <div class="er-center-label">Enhancing...</div>
          </div>
          ${smithNodes.join('')}
        </div>
      </div>
    `;

    this._positionSmiths();
  },

  _getOrbitRadius() {
    const vw = window.innerWidth;
    if (vw < 500) return Math.min(170, vw * 0.35);
    if (vw < 768) return 260;
    return 400;
  },

  _positionSmiths() {
    const count = this._smithCount;
    const radius = this._getOrbitRadius();

    for (let i = 0; i < count; i++) {
      const el = document.getElementById(`smith-${i}`);
      if (!el) continue;

      const angle = ((i / count) * 360 - 90) * (Math.PI / 180);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }
  },

  async _runAnimation(container) {
    this._animating = true;

    const maxTaps = Math.max(...this._results.map(r => r.totalTaps));
    const TAP_DELAY = 150;

    await new Promise((resolve) => {
      let step = 0;

      const tick = () => {
        if (step >= maxTaps) {
          resolve();
          return;
        }

        for (const r of this._results) {
          const tap = r.taps[step];
          if (tap) {
            this._updateSmith(r.index, tap.toLevel, step + 1, tap.success, r.taps.slice(0, step + 1));
          }
          if (step + 1 === r.totalTaps) {
            const el = document.getElementById(`smith-${r.index}`);
            if (el) el.classList.add('er-smith-done');
          }
        }

        step++;
        if (step < maxTaps) {
          this._animationTimer = setTimeout(tick, TAP_DELAY);
        } else {
          resolve();
        }
      };

      tick();
    });

    this._animating = false;

    await new Promise(r => setTimeout(r, 600));
    this._renderResults(container);
  },

  _updateSmith(index, level, tapCount, success, tapsSlice) {
    const levelEl = document.getElementById(`smith-level-${index}`);
    const barEl = document.getElementById(`smith-bar-${index}`);
    const tapsEl = document.getElementById(`smith-taps-${index}`);

    if (levelEl) {
      levelEl.textContent = `+${level}`;
      levelEl.classList.remove('er-flash-success', 'er-flash-fail');
      void levelEl.offsetWidth;
      levelEl.classList.add(success ? 'er-flash-success' : 'er-flash-fail');
    }

    if (barEl) {
      const progress = ((level - TIEBREAKER_START_LEVEL) / (TIEBREAKER_TARGET_LEVEL - TIEBREAKER_START_LEVEL)) * 100;
      barEl.style.width = `${progress}%`;
    }

    if (tapsEl) {
      tapsEl.textContent = `${tapCount}`;
    }

    if (tapsSlice) {
      const bdEl = document.getElementById(`smith-bd-${index}`);
      if (bdEl) bdEl.innerHTML = buildBreakdownHTML(tapsSlice);
    }
  },

  _renderResults(container) {
    const sorted = this._results;

    const podium = sorted.map((r, rank) => {
      const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '';
      return `
        <div class="er-result-row ${rank === 0 ? 'er-result-winner' : ''}">
          <div class="er-result-top">
            <span class="er-result-rank">${medal || `#${rank + 1}`}</span>
            <span class="er-result-name">${r.name}</span>
            <span class="er-result-taps">${r.totalTaps} taps</span>
          </div>
          ${buildBreakdownHTML(r.taps)}
        </div>
      `;
    }).join('');

    // Build interleaved log
    const maxTaps = Math.max(...sorted.map(r => r.totalTaps));
    const logRows = [];
    for (let i = maxTaps - 1; i >= 0; i--) {
      const entries = sorted.map(r => {
        const tap = r.taps[i];
        if (!tap) return `<span class="er-log-entry er-log-empty">—</span>`;
        const cls = tap.success ? 'er-log-success' : 'er-log-fail';
        return `<span class="er-log-entry ${cls}">+${tap.fromLevel}→+${tap.toLevel}</span>`;
      }).join('');

      logRows.push(`
        <div class="er-log-row" style="grid-template-columns: 2rem repeat(${this._smithCount}, 1fr)">
          <span class="er-log-num">#${i + 1}</span>
          ${entries}
        </div>
      `);
    }

    const logHeader = sorted.map(r => `<span class="er-log-header-name">${r.name}</span>`).join('');

    container.innerHTML = `
      <div class="er-results">
        <div class="er-results-header">
          <h2>Race Complete!</h2>
        </div>

        <div class="er-podium">
          ${podium}
        </div>

        <div class="er-results-actions">
          <button class="er-btn er-btn-primary" id="race-again-btn">Race Again</button>
          <button class="er-btn" id="new-setup-btn">Change Players</button>
        </div>

        <div class="er-log-section">
          <h3>Enhancement Log</h3>
          <div class="er-log-header" style="grid-template-columns: 2rem repeat(${this._smithCount}, 1fr)">
            <span></span>
            ${logHeader}
          </div>
          <div class="er-log" id="er-log">
            ${logRows.join('')}
          </div>
        </div>
      </div>
    `;

    document.getElementById('race-again-btn').addEventListener('click', () => {
      this._startRace(container);
    });

    document.getElementById('new-setup-btn').addEventListener('click', () => {
      this._renderSetup(container);
    });
  },

  destroy() {
    if (this._animationTimer) clearTimeout(this._animationTimer);
    this._animating = false;
    this._results = null;
    this._winnerId = null;
  }
};

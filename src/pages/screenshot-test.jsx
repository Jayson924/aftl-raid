import { EQUIPMENT_RARITIES, getGearscoreTier } from '../constants.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';

// Default FD breakpoints: { fdValue: damagePercent }
// Community-sourced data + estimates for 56-59%
const DEFAULT_FD_TABLE = [
  { fd: 1191, pct: 35 },
  { fd: 1224, pct: 36 },
  { fd: 1260, pct: 37 },
  { fd: 1292, pct: 38 },
  { fd: 1326, pct: 39 },
  { fd: 1359, pct: 40 },
  { fd: 1394, pct: 41 },
  { fd: 1427, pct: 42 },
  { fd: 1461, pct: 43 },
  { fd: 1492, pct: 44 },
  { fd: 1529, pct: 45 },
  { fd: 1599, pct: 46 },
  { fd: 1668, pct: 47 },
  { fd: 1742, pct: 48 },
  { fd: 1842, pct: 49 },
  { fd: 1892, pct: 50 },
  { fd: 1983, pct: 51 },
  { fd: 2044, pct: 52 },
  { fd: 2128, pct: 53 },
  { fd: 2208, pct: 54 },
  { fd: 2287, pct: 55 },
  { fd: 2369, pct: 56 },
  { fd: 2453, pct: 57 },
  { fd: 2539, pct: 58 },
  { fd: 2627, pct: 59 },
  { fd: 2718, pct: 60 }
];

// Convert raw FD to damage percentage using lookup table with interpolation
function fdToPercent(rawFd, fdTable) {
  if (!rawFd || rawFd <= 0) return 0;

  const table = fdTable || DEFAULT_FD_TABLE;

  // Below lowest entry: linear extrapolation from 0
  if (rawFd <= table[0].fd) {
    return (rawFd / table[0].fd) * table[0].pct;
  }

  // Above highest entry: cap at max
  const max = table[table.length - 1];
  if (rawFd >= max.fd) return max.pct;

  // Interpolate between two nearest entries
  for (let i = 0; i < table.length - 1; i++) {
    if (rawFd >= table[i].fd && rawFd < table[i + 1].fd) {
      const range = table[i + 1].fd - table[i].fd;
      const progress = (rawFd - table[i].fd) / range;
      return table[i].pct + progress * (table[i + 1].pct - table[i].pct);
    }
  }

  return max.pct;
}

// Gearscore formula: 60% gear, 40% FD
const RARITY_PERCENT = { legend: 1.0, unique: 0.65, epic: 0.35, rare: 0.15, magic: 0.05, normal: 0, '': 0 };
const ENHANCE_PERCENT = { 15: 1.0, 14: 0.85, 13: 0.7, 12: 0.55, 11: 0.4, 10: 0.28, 9: 0.18, 0: 0 };

const GEAR_WEIGHT = 60;
const FD_WEIGHT = 40;
const EQUIP_TOTAL = GEAR_WEIGHT * 0.7; // 42
const ACCESSORY_TOTAL = GEAR_WEIGHT * 0.3; // 18
const PER_EQUIP = EQUIP_TOTAL / 7; // 6 each
const PER_ACCESSORY = ACCESSORY_TOTAL / 4; // 4.5 each

function calcGearPortion(equipment) {
  const equipSlots = ['helmet', 'top', 'bottom', 'gloves', 'boots', 'mainWeapon', 'subWeapon'];
  const accessorySlots = ['necklace', 'earring', 'ring1', 'ring2'];
  let score = 0;

  equipSlots.forEach(slot => {
    const piece = equipment[slot];
    if (!piece?.rarity) return;
    const r = RARITY_PERCENT[piece.rarity] || 0;
    const e = ENHANCE_PERCENT[piece.enhancement] || 0;
    score += PER_EQUIP * (r * 0.5 + e * 0.5);
  });

  accessorySlots.forEach(slot => {
    const piece = equipment[slot];
    if (!piece?.rarity) return;
    score += PER_ACCESSORY * (RARITY_PERCENT[piece.rarity] || 0);
  });

  return score;
}

function calcScreenshotGearscore(equipment, finalDamage, fdTable) {
  const gearScore = calcGearPortion(equipment);
  const maxPct = fdTable[fdTable.length - 1].pct;
  const fdPct = fdToPercent(finalDamage, fdTable);
  const fdScore = FD_WEIGHT * (fdPct / maxPct);
  return Math.round(gearScore + fdScore);
}

export const ScreenshotTestPage = {
  fdTable: DEFAULT_FD_TABLE,

  async render(container) {
    // Load FD table from config
    try {
      const saved = await dataService.getAppConfig('fd_table');
      if (saved && saved.length > 0) this.fdTable = saved;
    } catch (e) {
      console.error('Failed to load FD table:', e);
    }

    const isAdmin = dataService.isAdmin();

    container.innerHTML = `
      <div class="screenshot-test-page">
        <h2>Screenshot Analyzer <span class="experimental-badge">POC</span></h2>
        <p class="page-description">Upload a character sheet screenshot to extract stats.</p>

        ${isAdmin ? `
        <div class="fd-table-config">
          <div class="fd-table-header">
            <h4>FD Breakpoints <span class="fd-table-hint">(admin only)</span></h4>
            <div class="fd-table-actions">
              <button class="btn btn-secondary btn-sm" id="toggle-fd-table">Edit FD Table</button>
            </div>
          </div>
          <div class="fd-table-editor" id="fd-table-editor" style="display:none">
            <p class="fd-table-desc">Each row maps a raw Final Damage value to its damage percentage. Estimated values are marked. Add new rows as players discover breakpoints.</p>
            <div class="fd-table-rows" id="fd-table-rows"></div>
            <div class="fd-table-add">
              <input type="number" id="fd-new-fd" placeholder="FD value" />
              <input type="number" id="fd-new-pct" placeholder="%" />
              <button class="btn btn-secondary btn-sm" id="fd-add-row">Add Row</button>
            </div>
            <button class="btn btn-primary btn-sm" id="fd-save-table">Save FD Table</button>
          </div>
        </div>
        ` : ''}

        <div class="screenshot-layout">
          <div class="upload-section">
            <div class="upload-zone" id="upload-zone">
              <div class="upload-placeholder" id="upload-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span>Drop screenshot here or click to upload</span>
                <span class="upload-hint">PNG, JPG — character sheet with stats visible</span>
              </div>
              <img id="preview-image" class="preview-image" style="display:none" />
              <input type="file" id="file-input" accept="image/*" style="display:none" />
            </div>
            <div class="upload-actions">
              <button class="btn btn-primary" id="analyze-btn" disabled>Analyze Screenshot</button>
              <button class="btn btn-secondary" id="clear-btn" style="display:none">Clear</button>
            </div>
          </div>

          <div class="results-section" id="results-section" style="display:none">
            <h3>Extracted Stats</h3>
            <div class="results-confidence" id="results-confidence"></div>

            <div class="results-grid">
              <div class="result-group">
                <h4>Character</h4>
                <div class="result-field">
                  <label>Name</label>
                  <input type="text" id="result-name" readonly />
                </div>
                <div class="result-field">
                  <label>Class</label>
                  <input type="text" id="result-class" readonly />
                </div>
                <div class="result-field">
                  <label>Level</label>
                  <input type="text" id="result-level" readonly />
                </div>
              </div>

              <div class="result-group">
                <h4>Armor</h4>
                <div class="result-field">
                  <label>Helmet</label>
                  <span id="result-helmet" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Top</label>
                  <span id="result-top" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Bottom</label>
                  <span id="result-bottom" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Gloves</label>
                  <span id="result-gloves" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Boots</label>
                  <span id="result-boots" class="result-value"></span>
                </div>
              </div>

              <div class="result-group">
                <h4>Weapons</h4>
                <div class="result-field">
                  <label>Main Weapon</label>
                  <span id="result-mainWeapon" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Sub Weapon</label>
                  <span id="result-subWeapon" class="result-value"></span>
                </div>
              </div>

              <div class="result-group">
                <h4>Accessories</h4>
                <div class="result-field">
                  <label>Necklace</label>
                  <span id="result-necklace" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Earring</label>
                  <span id="result-earring" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Ring 1</label>
                  <span id="result-ring1" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Ring 2</label>
                  <span id="result-ring2" class="result-value"></span>
                </div>
              </div>

              <div class="result-group">
                <h4>Stats</h4>
                <div class="result-field">
                  <label>Final Damage</label>
                  <span id="result-fd" class="result-value stat-highlight"></span>
                </div>
                <div class="result-field">
                  <label>FD %</label>
                  <span id="result-fd-pct" class="result-value stat-highlight"></span>
                </div>
                <div class="result-field">
                  <label>HP</label>
                  <span id="result-hp" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Defense</label>
                  <span id="result-def" class="result-value"></span>
                </div>
                <div class="result-field">
                  <label>Magic Defense</label>
                  <span id="result-mdef" class="result-value"></span>
                </div>
              </div>

              <div class="result-group" id="gearscore-group" style="display:none">
                <h4>Gearscore</h4>
                <div class="result-gearscore" id="result-gearscore"></div>
                <div class="gs-breakdown" id="gs-breakdown"></div>
              </div>
            </div>

            <div class="result-notes" id="result-notes" style="display:none"></div>

            <div class="raw-response-toggle">
              <button class="btn btn-secondary btn-sm" id="toggle-raw">Show Raw Response</button>
              <pre class="raw-response" id="raw-response" style="display:none"></pre>
            </div>
          </div>
        </div>

        <div class="analyzing-overlay" id="analyzing-overlay" style="display:none">
          <div class="analyzing-spinner">
            <div class="spinner"></div>
            <span>Analyzing screenshot...</span>
            <span class="analyzing-hint">This may take a few seconds</span>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  },

  setupEventListeners() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    const clearBtn = document.getElementById('clear-btn');
    const toggleRaw = document.getElementById('toggle-raw');

    this.imageData = null;
    this.mimeType = null;

    uploadZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleFile(e.target.files[0]);
    });

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) this.handleFile(e.dataTransfer.files[0]);
    });

    analyzeBtn.addEventListener('click', () => this.analyze());
    clearBtn.addEventListener('click', () => this.clear());

    toggleRaw.addEventListener('click', () => {
      const raw = document.getElementById('raw-response');
      const isHidden = raw.style.display === 'none';
      raw.style.display = isHidden ? 'block' : 'none';
      toggleRaw.textContent = isHidden ? 'Hide Raw Response' : 'Show Raw Response';
    });

    // FD table admin controls
    const toggleFdTable = document.getElementById('toggle-fd-table');
    if (toggleFdTable) {
      toggleFdTable.addEventListener('click', () => {
        const editor = document.getElementById('fd-table-editor');
        const isHidden = editor.style.display === 'none';
        editor.style.display = isHidden ? 'block' : 'none';
        toggleFdTable.textContent = isHidden ? 'Hide FD Table' : 'Edit FD Table';
        if (isHidden) this.renderFdTable();
      });

      document.getElementById('fd-add-row').addEventListener('click', () => {
        const fdInput = document.getElementById('fd-new-fd');
        const pctInput = document.getElementById('fd-new-pct');
        const fd = parseInt(fdInput.value, 10);
        const pct = parseInt(pctInput.value, 10);
        if (!fd || !pct) { toast.error('Enter both FD and % values'); return; }
        this.fdTable.push({ fd, pct });
        this.fdTable.sort((a, b) => a.fd - b.fd);
        fdInput.value = '';
        pctInput.value = '';
        this.renderFdTable();
      });

      document.getElementById('fd-save-table').addEventListener('click', async () => {
        try {
          await dataService.setAppConfig('fd_table', this.fdTable);
          toast.success('FD table saved');
        } catch (e) {
          toast.error('Failed to save: ' + e.message);
        }
      });
    }
  },

  renderFdTable() {
    const container = document.getElementById('fd-table-rows');
    container.innerHTML = this.fdTable.map((row, i) => `
      <div class="fd-table-row">
        <span class="fd-table-fd">${row.fd.toLocaleString()}</span>
        <span class="fd-table-arrow">=</span>
        <span class="fd-table-pct">${row.pct}%</span>
        <button class="fd-table-remove" data-index="${i}" title="Remove">&times;</button>
      </div>
    `).join('');

    container.querySelectorAll('.fd-table-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.fdTable.splice(parseInt(btn.dataset.index, 10), 1);
        this.renderFdTable();
      });
    });
  },

  handleFile(file) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10MB)');
      return;
    }

    this.mimeType = file.type;

    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.getElementById('preview-image');
      const placeholder = document.getElementById('upload-placeholder');

      preview.src = e.target.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';

      this.imageData = e.target.result.split(',')[1];

      document.getElementById('analyze-btn').disabled = false;
      document.getElementById('clear-btn').style.display = 'inline-flex';
    };
    reader.readAsDataURL(file);
  },

  clear() {
    this.imageData = null;
    this.mimeType = null;

    document.getElementById('preview-image').style.display = 'none';
    document.getElementById('upload-placeholder').style.display = 'flex';
    document.getElementById('analyze-btn').disabled = true;
    document.getElementById('clear-btn').style.display = 'none';
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('file-input').value = '';
  },

  async analyze() {
    if (!this.imageData) return;

    const overlay = document.getElementById('analyzing-overlay');
    const analyzeBtn = document.getElementById('analyze-btn');

    overlay.style.display = 'flex';
    analyzeBtn.disabled = true;

    try {
      const response = await fetch('/.netlify/functions/analyze-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: this.imageData,
          mimeType: this.mimeType
        })
      });

      const data = await response.json();

      if (data.error && !data.raw) {
        toast.error('Analysis failed: ' + data.error);
        return;
      }

      this.displayResults(data);
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Failed to analyze screenshot');
    } finally {
      overlay.style.display = 'none';
      analyzeBtn.disabled = false;
    }
  },

  displayResults(data) {
    const section = document.getElementById('results-section');
    section.style.display = 'block';

    // Confidence
    const confidence = document.getElementById('results-confidence');
    const confLevel = data.confidence || 'unknown';
    const confColors = { high: '#4caf50', medium: '#ff9800', low: '#f44336', unknown: '#6c757d' };
    confidence.innerHTML = `<span class="confidence-badge" style="background: ${confColors[confLevel]}20; color: ${confColors[confLevel]}; border: 1px solid ${confColors[confLevel]}40;">Confidence: ${confLevel}</span>`;

    // Character info
    document.getElementById('result-name').value = data.name || '—';
    document.getElementById('result-class').value = data.class || '—';
    document.getElementById('result-level').value = data.level || '—';

    // Equipment
    const equip = data.equipment || {};
    const equipSlots = ['helmet', 'top', 'bottom', 'gloves', 'boots', 'mainWeapon', 'subWeapon', 'necklace', 'earring', 'ring1', 'ring2'];

    const formatEquipSlot = (slot) => {
      if (!slot || !slot.rarity) return '—';
      const match = EQUIPMENT_RARITIES.find(e => e.value === slot.rarity);
      const rarityHtml = match
        ? `<span style="color: ${match.color}">${match.label}</span>`
        : slot.rarity;
      return `${rarityHtml}${slot.enhancement ? ' +' + slot.enhancement : ''}`;
    };

    equipSlots.forEach(slot => {
      const el = document.getElementById(`result-${slot}`);
      if (el) el.innerHTML = formatEquipSlot(equip[slot]);
    });

    // Stats
    const stats = data.stats || {};
    const fd = stats.finalDamage || 0;
    const fdPct = fdToPercent(fd, this.fdTable);

    document.getElementById('result-fd').textContent = fd ? fd.toLocaleString() : '—';
    document.getElementById('result-fd-pct').textContent = fd ? `${fdPct.toFixed(1)}%` : '—';
    document.getElementById('result-hp').textContent = stats.hp != null ? stats.hp.toLocaleString() : '—';
    document.getElementById('result-def').textContent = stats.defense != null ? stats.defense.toLocaleString() : '—';
    document.getElementById('result-mdef').textContent = stats.magicDefense != null ? stats.magicDefense.toLocaleString() : '—';

    // Calculate gearscore
    const hasAnyGear = equipSlots.some(s => equip[s]?.rarity);
    if (hasAnyGear || fd) {
      const gs = calcScreenshotGearscore(equip, fd, this.fdTable);
      const tier = getGearscoreTier(gs);

      const gearPortion = calcGearPortion(equip);
      const maxPct = this.fdTable[this.fdTable.length - 1].pct;
      const fdPortion = FD_WEIGHT * (fdPct / maxPct);

      const gsGroup = document.getElementById('gearscore-group');
      gsGroup.style.display = 'block';
      document.getElementById('result-gearscore').innerHTML = `
        <span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg}; font-size: 1.5em; padding: 6px 16px;">
          ${gs} <span style="font-size: 0.7em; opacity: 0.7;">${tier.label}</span>
        </span>
      `;
      document.getElementById('gs-breakdown').innerHTML = `
        <div class="gs-breakdown-row">
          <span>Gear</span>
          <span>${Math.round(gearPortion)} / ${GEAR_WEIGHT}</span>
          <div class="gs-bar"><div class="gs-bar-fill" style="width: ${(gearPortion / GEAR_WEIGHT) * 100}%; background: #3b82f6;"></div></div>
        </div>
        <div class="gs-breakdown-row">
          <span>FD</span>
          <span>${Math.round(fdPortion)} / ${FD_WEIGHT}</span>
          <div class="gs-bar"><div class="gs-bar-fill" style="width: ${(fdPortion / FD_WEIGHT) * 100}%; background: #ff9800;"></div></div>
        </div>
        <div class="gs-breakdown-note">FD: ${fd.toLocaleString()} = ${fdPct.toFixed(1)}% (cap: ${maxPct}% at ${this.fdTable[this.fdTable.length - 1].fd.toLocaleString()})</div>
      `;
    }

    // Notes
    if (data.notes) {
      const notesEl = document.getElementById('result-notes');
      notesEl.style.display = 'block';
      notesEl.innerHTML = `<strong>Notes:</strong> ${data.notes}`;
    }

    // Raw response
    document.getElementById('raw-response').textContent = JSON.stringify(data, null, 2);
  },

  destroy() {}
};

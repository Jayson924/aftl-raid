import { dataService } from '../data.js';
import { calculateGearscore, getGearscoreTier, getClassSpriteStyle, EQUIPMENT_ICONS, CLASS_FAMILIES, CLASSES } from '../constants.js';
import { renderChipTipBody } from '../chip-tooltip.js';
import { toast } from '../toast.js';
import { PlayersPage } from './players.jsx';

// Party accent colors
const PARTY_COLORS = [
  { main: '#4a9eff', glow: 'rgba(74, 158, 255, 0.35)' },
  { main: '#4ece73', glow: 'rgba(78, 206, 115, 0.35)' },
  { main: '#c084fc', glow: 'rgba(192, 132, 252, 0.35)' },
  { main: '#fb923c', glow: 'rgba(251, 146, 60, 0.35)' },
  { main: '#f472b6', glow: 'rgba(244, 114, 182, 0.35)' },
  { main: '#22d3ee', glow: 'rgba(34, 211, 238, 0.35)' },
];

function renderChipTip(player) {
  const body = renderChipTipBody(player);
  if (!body) return '';
  return `<div class="chip-tip" role="tooltip">${body}</div>`;
}

function setupMobileTooltips(container) {
  const selector = '[data-tooltip], .slot-chip--filled';
  const tooltipEls = container.querySelectorAll(selector);
  tooltipEls.forEach(el => {
    const hasTip = el.hasAttribute('data-tooltip') || el.querySelector('.chip-tip');
    if (!hasTip) return;
    el.addEventListener('touchstart', (e) => {
      const wasVisible = el.classList.contains('tooltip-visible');
      container.querySelectorAll('.tooltip-visible').forEach(t => t.classList.remove('tooltip-visible'));
      if (!wasVisible) {
        el.classList.add('tooltip-visible');
        e.preventDefault();
      }
    }, { passive: false });
  });

  container.addEventListener('touchstart', (e) => {
    if (!e.target.closest(selector)) {
      container.querySelectorAll('.tooltip-visible').forEach(t => t.classList.remove('tooltip-visible'));
    }
  });
}

const ACTIVE_CLASSES_KEY = 'recruiting_active_classes';

const TANK_CLASSES = ['Guardian', 'Crusader', 'Destroyer'];
const HEALER_CLASSES = ['Saint'];

function isGuestSlot(value) {
  return typeof value === 'string' && value.startsWith('[PUB]');
}

function isFilledSlot(value) {
  return !!value && !isGuestSlot(value);
}

// Parse "[PUB]PreferredName|Role" → { preference, role }. Either piece may be empty.
function parseGuest(value) {
  if (!isGuestSlot(value)) return null;
  const parts = value.substring(5).split('|');
  return { preference: (parts[0] || '').trim(), role: (parts[1] || '').trim() };
}

// Derive a recruiting party { tank, healer, dps[6] } from a DDN Classic lineup.
// Real players slot in by their actual class; [PUB] guests slot in by their declared
// role and render as open slots with the preferred name as preference text.
function lineupToParty(lineup, playerMap) {
  let tank = null;
  let healer = null;
  const remaining = [];
  for (const name of lineup.players || []) {
    if (!name) continue;
    let role;
    if (isGuestSlot(name)) {
      role = parseGuest(name).role;
    } else {
      role = playerMap[name]?.role;
    }
    if (!tank && TANK_CLASSES.includes(role)) {
      tank = name;
    } else if (!healer && HEALER_CLASSES.includes(role)) {
      healer = name;
    } else {
      remaining.push(name);
    }
  }
  const dps = Array(6).fill(null);
  for (let i = 0; i < remaining.length && i < 6; i++) dps[i] = remaining[i];
  return { tank, healer, dps, lineupName: lineup.name };
}

export const RecruitingPage = {
  _fullPlayers: [],
  _userMap: {},
  parties: [],
  activeClasses: [],
  isEditMode: false,
  _container: null,

  async render(container) {
    this._container = container;
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = 'none';

    await dataService.loadSession();
    this.isEditMode = dataService.isAdmin();
    this.showPlayerNames = dataService.isPlayer();

    container.innerHTML = `
      <div class="recruiting-page">
        <div class="recruiting-hero">
          <h1 class="recruiting-hero__title">Afterlight Guild</h1>
          <p class="recruiting-hero__subtitle">Raid Recruitment</p>
          <div class="recruiting-hero__divider"></div>
          <p class="recruiting-hero__desc">We run raids together weekly. Goal is <span class="recruiting-hero__gs tooltip-wrap" data-tooltip="Legend +12 Weapons&#10;Legend +10 Armor&#10;Legend Accessories&#10;~950 FD">65 Gearscore</span> for DDN parties.</p>
        </div>
        <div class="recruiting-loading">Loading roster...</div>
        <div class="recruiting-content" id="recruiting-content"></div>
      </div>
    `;

    try {
      const [players, appUsers, lineups] = await Promise.all([
        dataService.getPlayers(),
        dataService.getAppUsers().catch(() => []),
        dataService.getLineups().catch(() => []),
      ]);
      const playersWithGs = players.map(p => {
        p._gearscore = calculateGearscore(p);
        return p;
      });
      this._fullPlayers = playersWithGs;
      this._userMap = {};
      (appUsers || []).forEach(u => { this._userMap[u.discordId] = u; });

      const playerMap = {};
      playersWithGs.forEach(p => { playerMap[p.name] = p; });

      // Pull active DDN Classic lineups and convert to recruiting parties.
      const ddnLineups = (lineups || [])
        .filter(l => l.raidType === 'DDN Classic' && !l.completed && !l.isNextWeek)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
      this.parties = ddnLineups.map(l => lineupToParty(l, playerMap));

      let savedActive = await dataService.getAppConfig(ACTIVE_CLASSES_KEY);
      if (typeof savedActive === 'string') {
        try { savedActive = JSON.parse(savedActive); } catch { savedActive = null; }
      }
      this.activeClasses = Array.isArray(savedActive) ? savedActive.filter(c => CLASSES.includes(c)) : [];

      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.remove();

      this.renderContent();
    } catch (err) {
      console.error('Failed to load recruiting data:', err);
      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load roster data.';
    }
  },

  renderContent() {
    const content = document.getElementById('recruiting-content');
    if (!content) return;

    const playerMap = {};
    this._fullPlayers.forEach(p => { playerMap[p.name] = p; });

    content.innerHTML = `
      ${this.renderStatsBar()}
      ${this.renderPartyGrid(playerMap)}
      ${this.renderActivelyRecruiting()}
      <div class="players-page recruiting-roster-host">
        <h3 class="recruiting-roster-host__title">Guild Roster</h3>
        <div id="recruiting-roster-list"></div>
      </div>
    `;

    const rosterEl = document.getElementById('recruiting-roster-list');
    if (rosterEl && this._fullPlayers) {
      PlayersPage._gsFilter = 65;
      PlayersPage.renderRosterView(rosterEl, this._fullPlayers, this._userMap);
    }

    setupMobileTooltips(this._container);

    if (this.isEditMode) {
      const editBtn = content.querySelector('.actively-recruiting__edit');
      if (editBtn) editBtn.addEventListener('click', () => this.openActiveClassesEditor());
    }
  },

  calculateStats() {
    let openSlots = 0;
    this.parties.forEach(p => {
      if (!isFilledSlot(p.tank)) openSlots++;
      if (!isFilledSlot(p.healer)) openSlots++;
      for (let d = 0; d < 6; d++) if (!isFilledSlot(p.dps && p.dps[d])) openSlots++;
    });
    return { openSlots, partyCount: this.parties.length };
  },

  renderStatsBar() {
    if (this.parties.length === 0) {
      return `<div class="recruiting-empty">
        <p>No raid parties configured yet.</p>
        <p>Check back soon!</p>
      </div>`;
    }
    const stats = this.calculateStats();
    const partyLabel = stats.partyCount === 1 ? 'DDN ready party' : 'DDN ready parties';
    const slotLabel = stats.openSlots === 1 ? 'slot' : 'slots';
    if (stats.openSlots === 0) {
      return `<div class="recruiting-stats recruiting-stats--full">
        <span class="recruiting-stats__text">All ${stats.partyCount} ${partyLabel} are full — but we'll always make room for a great fit.</span>
      </div>`;
    }
    return `<div class="recruiting-stats">
      <span class="recruiting-stats__big">${stats.openSlots}</span>
      <span class="recruiting-stats__text">open ${slotLabel} across ${stats.partyCount} ${partyLabel}</span>
    </div>`;
  },

  renderPartyGrid(playerMap) {
    if (this.parties.length === 0) return '';
    const cards = this.parties.map((party, i) => this.renderPartyCard(party, i, playerMap)).join('');
    return `<div class="party-grid">${cards}</div>`;
  },

  renderPartyCard(party, partyIndex, playerMap) {
    const color = PARTY_COLORS[partyIndex % PARTY_COLORS.length];
    const filled = (isFilledSlot(party.tank) ? 1 : 0)
      + (isFilledSlot(party.healer) ? 1 : 0)
      + (party.dps || []).filter(isFilledSlot).length;

    const tankChip = this.renderSlotChip(party.tank, 'tank', 'Guardian', playerMap);
    const healerChip = this.renderSlotChip(party.healer, 'healer', 'Saint', playerMap);
    const dpsChips = [];
    for (let d = 0; d < 6; d++) {
      const name = (party.dps || [])[d] || null;
      dpsChips.push(this.renderSlotChip(name, 'dps', 'DPS', playerMap));
    }

    const partyName = party.lineupName || `Party ${partyIndex + 1}`;
    return `<div class="party-card" style="--party-color: ${color.main}; --party-glow: ${color.glow}">
      <div class="party-card__header">
        <span class="party-card__name">${partyName}</span>
        <span class="party-card__count ${filled === 8 ? 'party-card__count--full' : ''}">${filled}/8</span>
      </div>
      <div class="party-card__slots">
        ${tankChip}
        ${healerChip}
        ${dpsChips.join('')}
      </div>
    </div>`;
  },

  renderSlotChip(playerName, slotType, slotLabel, playerMap) {
    const slotTypeClass = `slot-chip--${slotType}`;

    if (isGuestSlot(playerName)) {
      const guest = parseGuest(playerName);
      const role = guest.role || slotLabel;
      const iconHtml = guest.role
        ? `<span class="class-sprite" style="${getClassSpriteStyle(guest.role)}"></span>`
        : `<div class="slot-chip__icon-placeholder">?</div>`;
      const preference = guest.preference
        ? `<div class="slot-chip__preference" title="${guest.preference}">${guest.preference}</div>`
        : '';
      return `<div class="slot-chip slot-chip--empty slot-chip--guest ${slotTypeClass}">
        <div class="slot-chip__icon slot-chip__icon--ghost">${iconHtml}</div>
        <div class="slot-chip__label">${role}</div>
        <div class="slot-chip__sub">Open</div>
        ${preference}
      </div>`;
    }

    const player = playerName ? playerMap[playerName] : null;

    if (!player) {
      return `<div class="slot-chip slot-chip--empty ${slotTypeClass}">
        <div class="slot-chip__icon-placeholder">?</div>
        <div class="slot-chip__label">${slotLabel}</div>
        <div class="slot-chip__sub">Open</div>
      </div>`;
    }

    const gs = player._gearscore || 0;
    const tier = getGearscoreTier(gs);
    const spriteStyle = getClassSpriteStyle(player.role);
    const tipHtml = renderChipTip(player);
    const nameHtml = this.showPlayerNames
      ? `<div class="slot-chip__name" title="${player.name}">${player.name}</div>`
      : '';

    return `<div class="slot-chip slot-chip--filled ${slotTypeClass}" data-player-name="${player.name}"
              style="--tier-color: ${tier.color}">
      <div class="slot-chip__icon">
        <span class="class-sprite" style="${spriteStyle}"></span>
      </div>
      <div class="slot-chip__class">${player.role}</div>
      ${nameHtml}
      <div class="slot-chip__gs" style="color: ${tier.color}">${gs}</div>
      ${tipHtml}
    </div>`;
  },

  renderActivelyRecruiting() {
    const hasSelection = this.activeClasses.length > 0;
    const editBtn = this.isEditMode ? `<button class="actively-recruiting__edit">Edit</button>` : '';

    if (!hasSelection && !this.isEditMode) return '';
    if (!hasSelection && this.isEditMode) {
      return `<section class="actively-recruiting actively-recruiting--empty">
        <div class="actively-recruiting__head">
          <h3 class="actively-recruiting__title">Actively Recruiting</h3>
          ${editBtn}
        </div>
        <p class="actively-recruiting__empty">No classes selected. Click <strong>Edit</strong> to highlight classes the guild is hunting for.</p>
      </section>`;
    }

    const cards = this.activeClasses.map(cls => `
      <div class="actively-recruiting__card">
        <span class="actively-recruiting__icon"><span class="class-sprite" style="${getClassSpriteStyle(cls)}"></span></span>
        <span class="actively-recruiting__name">${cls}</span>
      </div>
    `).join('');

    return `<section class="actively-recruiting">
      <div class="actively-recruiting__head">
        <h3 class="actively-recruiting__title">Actively Recruiting</h3>
        ${editBtn}
      </div>
      <div class="actively-recruiting__grid">${cards}</div>
      <p class="actively-recruiting__note">
        Don't see your class? <strong>Apply anyway!</strong> Active and friendly players of any class are always welcome. Preference for main characters.
      </p>
    </section>`;
  },

  openActiveClassesEditor() {
    const existing = document.querySelector('.active-classes-overlay');
    if (existing) existing.remove();

    const selected = new Set(this.activeClasses);
    const families = Object.entries(CLASS_FAMILIES).map(([key, family]) => {
      const items = family.classes.map(cls => `
        <label class="active-classes__item ${selected.has(cls) ? 'is-selected' : ''}">
          <input type="checkbox" value="${cls}" ${selected.has(cls) ? 'checked' : ''} />
          <span class="active-classes__icon"><span class="class-sprite" style="${getClassSpriteStyle(cls)}"></span></span>
          <span class="active-classes__name">${cls}</span>
        </label>
      `).join('');
      return `<div class="active-classes__family">
        <div class="active-classes__family-name">${family.name}</div>
        <div class="active-classes__items">${items}</div>
      </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'active-classes-overlay';
    overlay.innerHTML = `
      <div class="active-classes" role="dialog" aria-modal="true">
        <div class="active-classes__header">
          <h3>Select Recruiting Classes</h3>
          <button class="active-classes__close" aria-label="Close">×</button>
        </div>
        <div class="active-classes__body">${families}</div>
        <div class="active-classes__footer">
          <button class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.active-classes__close').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

    overlay.querySelectorAll('.active-classes__item').forEach(label => {
      const input = label.querySelector('input');
      input.addEventListener('change', () => {
        label.classList.toggle('is-selected', input.checked);
      });
    });

    overlay.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const checked = Array.from(overlay.querySelectorAll('input:checked')).map(i => i.value);
      this.activeClasses = checked;
      try {
        await dataService.setAppConfig(ACTIVE_CLASSES_KEY, JSON.stringify(checked));
        toast.show('Recruiting classes updated', 'success');
      } catch (err) {
        console.error('Failed to save active classes:', err);
        toast.show('Failed to save', 'error');
      }
      close();
      this.renderContent();
    });
  },

  destroy() {
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = '';
    if (PlayersPage._chartInstance) {
      PlayersPage._chartInstance.destroy();
      PlayersPage._chartInstance = null;
    }
    this._fullPlayers = [];
    this._userMap = {};
    this.parties = [];
    this._container = null;
  }
};

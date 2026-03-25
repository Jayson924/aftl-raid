import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { TOURNAMENT_PHASES } from './arena-constants.js';
import { arenaConfirm } from './arena-confirm.js';

/**
 * Arena Setup — Admin-only tournament setup page.
 * Create tournament, drag-and-drop players into brackets.
 * Route: /arena-setup
 */
export const ArenaSetupPage = {
  _tournament: null,
  _participants: null,
  _signups: null,
  _appUsers: null,
  _signupSubscription: null,

  async render(container) {
    container.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'arena-setup';
    content.innerHTML = '<div class="arena-empty"><p>Loading...</p></div>';
    container.appendChild(content);

    try {
      await this._loadData();
      this._renderContent(content);
    } catch (err) {
      console.error('Arena setup error:', err);
      this._renderCreateForm(content);
    }
  },

  async _loadData() {
    const tournaments = await arenaData.getTournaments();
    this._tournament = tournaments.find(t =>
      t.status !== 'complete' && t.name !== 'Quick Match'
    ) || null;

    this._appUsers = await arenaData.getAllAppUsers();

    if (this._tournament) {
      const [participants, signups, matches] = await Promise.all([
        arenaData.getParticipants(this._tournament.id),
        arenaData.getSignups(this._tournament.id),
        arenaData.getMatches(this._tournament.id)
      ]);
      this._participants = participants;
      this._signups = signups;
      this._matches = matches;

      // Live signup updates during registration
      if (this._signupSubscription) arenaData.unsubscribe(this._signupSubscription);
      if (this._tournament.current_phase === 'registration') {
        this._signupSubscription = arenaData.subscribeToSignups(this._tournament.id, async () => {
          this._signups = await arenaData.getSignups(this._tournament.id);
          const content = document.querySelector('.arena-setup');
          if (content) this._renderContent(content);
        });
      }
    } else {
      this._participants = [];
      this._signups = [];
      this._matches = [];
    }
  },

  _getDisplayName(discordId) {
    const user = this._appUsers?.find(u => u.discord_id === discordId);
    return user?.display_name || user?.username || discordId;
  },

  _getAvatarUrl(discordId) {
    const user = this._appUsers?.find(u => u.discord_id === discordId);
    return user?.avatar_url || null;
  },

  // ============================================
  // PLAYER PICKER (custom dropdown with avatars)
  // ============================================

  _renderPlayerPicker(id, placeholder, users) {
    const sorted = [...users].sort((a, b) => {
      const nameA = (a.display_name || a.username || '').toLowerCase();
      const nameB = (b.display_name || b.username || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return `
      <div class="arena-player-picker" id="${id}">
        <div class="picker-selected" data-value="">
          <span class="picker-placeholder">${placeholder}</span>
          <span class="picker-arrow">&#9662;</span>
        </div>
        <div class="picker-dropdown">
          ${sorted.map(u => `
            <div class="picker-option" data-value="${u.discord_id}">
              ${u.avatar_url
                ? `<img src="${u.avatar_url}" alt="" class="picker-avatar" onerror="this.style.display='none'">`
                : '<span class="picker-avatar picker-avatar-placeholder"></span>'}
              <span class="picker-name">${u.display_name || u.username}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  _attachPickerListeners(container) {
    container.querySelectorAll('.arena-player-picker').forEach(picker => {
      const selected = picker.querySelector('.picker-selected');
      const dropdown = picker.querySelector('.picker-dropdown');

      selected.addEventListener('click', (e) => {
        e.stopPropagation();
        container.querySelectorAll('.arena-player-picker.open').forEach(p => {
          if (p !== picker) p.classList.remove('open');
        });
        picker.classList.toggle('open');
      });

      dropdown.querySelectorAll('.picker-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const value = opt.dataset.value;
          selected.dataset.value = value;
          selected.innerHTML = opt.innerHTML + '<span class="picker-arrow">&#9662;</span>';
          selected.classList.add('has-value');
          picker.classList.remove('open');
        });
      });
    });

    document.addEventListener('click', () => {
      container.querySelectorAll('.arena-player-picker.open').forEach(p => p.classList.remove('open'));
    });
  },

  _getPickerValue(id) {
    const picker = document.getElementById(id);
    return picker?.querySelector('.picker-selected')?.dataset.value || '';
  },

  _renderCreateForm(container) {
    container.innerHTML = `
      <a href="#" class="arena-back-link" data-route="arena">&larr; Back to Arena</a>
      <div class="arena-panel" style="max-width: 500px; margin: 2rem auto;">
        <div class="arena-panel-header">
          <h2>Create Tournament</h2>
        </div>
        <div class="arena-form">
          <div class="arena-form-group">
            <label>Tournament Name</label>
            <input type="text" id="tournament-name" class="arena-input" placeholder="e.g. AFTL Arena Season 1" maxlength="64">
          </div>
          <div class="arena-form-group">
            <label>Number of Brackets</label>
            <div class="arena-bracket-count-row">
              ${[2, 3, 4, 5, 6].map(n => `
                <button class="arena-btn bracket-count-btn ${n === 4 ? 'arena-btn-primary' : ''}" data-count="${n}">${n}</button>
              `).join('')}
            </div>
          </div>
          <div class="arena-form-group">
            <label>Match Format</label>
            <div class="arena-bracket-count-row">
              ${[1, 2, 3].map(n => `
                <button class="arena-btn format-btn ${n === 1 ? 'arena-btn-primary' : ''}" data-format="${n}">${n}v${n}</button>
              `).join('')}
            </div>
          </div>
          <div class="arena-form-group">
            <label>Prize Pool (Gold) <span style="color: rgba(255,255,255,0.4); font-weight: 400;">— optional</span></label>
            <input type="number" id="tournament-prize-pool" class="arena-input" placeholder="e.g. 50000" min="0" step="1000">
          </div>
          <button class="arena-btn arena-btn-primary" id="create-tournament-btn" style="width: 100%; margin-top: 1rem;">
            Create Tournament
          </button>
        </div>
      </div>
    `;

    let selectedCount = 4;
    let selectedFormat = 1;
    container.querySelectorAll('.bracket-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.bracket-count-btn').forEach(b => b.classList.remove('arena-btn-primary'));
        btn.classList.add('arena-btn-primary');
        selectedCount = parseInt(btn.dataset.count);
      });
    });
    container.querySelectorAll('.format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.format-btn').forEach(b => b.classList.remove('arena-btn-primary'));
        btn.classList.add('arena-btn-primary');
        selectedFormat = parseInt(btn.dataset.format);
      });
    });

    document.getElementById('create-tournament-btn').addEventListener('click', async () => {
      const name = document.getElementById('tournament-name').value.trim();
      if (!name) {
        toast.error('Enter a tournament name');
        return;
      }
      const poolInput = document.getElementById('tournament-prize-pool').value;
      const prizePool = poolInput ? parseInt(poolInput) : 0;
      const prizes = prizePool > 0 ? { pool: prizePool } : null;
      try {
        this._tournament = await arenaData.createTournament(name, selectedCount, selectedFormat, prizes);
        this._participants = [];
        this._signups = [];
        toast.success('Tournament created! Registration is now open.');
        this._renderContent(container);
      } catch (err) {
        toast.error('Failed: ' + err.message);
      }
    });
  },

  _renderContent(container) {
    const t = this._tournament;
    const phaseName = t.current_phase?.replace(/_/g, ' ') || 'setup';
    const isRegistration = t.current_phase === 'registration';
    const isSetup = t.current_phase === 'setup';
    const isActive = !isSetup && !isRegistration && t.current_phase !== 'complete';

    const currentPool = t.prizes?.pool || 0;

    container.innerHTML = `
      <a href="#" class="arena-back-link" data-route="arena">&larr; Back to Arena</a>
      <div class="arena-setup-header arena-panel">
        <div class="arena-panel-header">
          <h2>${t.name}</h2>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span class="arena-badge ${isRegistration ? 'badge-green' : 'badge-gold'}">${phaseName}</span>
            ${isActive ? `<button class="arena-btn arena-btn-danger arena-btn-small" id="stop-tournament-btn">Stop Tournament</button>` : ''}
            <button class="arena-btn arena-btn-danger arena-btn-small" id="delete-tournament-btn">Delete</button>
          </div>
        </div>
        <div class="setup-prize-pool">
          <label>Prize Pool:</label>
          <input type="number" id="prize-pool-input" class="arena-input" value="${currentPool || ''}" placeholder="0" min="0" step="1000" style="width: 120px;">
          <span class="prize-pool-gold">Gold</span>
          <button class="arena-btn arena-btn-small" id="save-prize-pool-btn">Save</button>
          ${currentPool > 0 ? `<span class="prize-pool-current">${currentPool.toLocaleString()} Gold</span>` : ''}
        </div>
      </div>

      ${isRegistration ? this._renderRegistrationManagement() : ''}
      ${isSetup ? this._renderDragDropEditor() : ''}
      ${!isRegistration && !isSetup ? this._renderPhaseControls() : ''}
    `;

    this._attachPickerListeners(container);
    this._attachEventListeners(container);
    if (isSetup) this._initDragDrop(container);
    if (isRegistration) this._attachRegistrationManagementListeners(container);
  },

  // ============================================
  // REGISTRATION MANAGEMENT (admin view during registration phase)
  // ============================================

  _renderRegistrationManagement() {
    const signups = this._signups || [];
    const signupDiscordIds = new Set(signups.map(s => s.discord_id));

    // Users who haven't signed up (for manual add)
    const availableUsers = (this._appUsers || [])
      .filter(u => !signupDiscordIds.has(u.discord_id))
      .sort((a, b) => {
        const nameA = (a.display_name || a.username || '').toLowerCase();
        const nameB = (b.display_name || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

    return `
      <div class="arena-panel setup-registration-management">
        <div class="arena-panel-header">
          <h3>Registered Players</h3>
          <span class="arena-badge badge-green">${signups.length} signed up</span>
        </div>

        <div class="registration-player-list">
          ${signups.length === 0
            ? '<div class="registration-empty">No one has signed up yet. Share the link or add players manually.</div>'
            : signups.map(s => `
              <div class="setup-player-card in-bracket">
                ${this._getAvatarUrl(s.discord_id)
                  ? `<img src="${this._getAvatarUrl(s.discord_id)}" alt="" class="setup-player-avatar" onerror="this.style.display='none'">`
                  : '<span class="setup-player-avatar setup-avatar-placeholder"></span>'}
                <span class="setup-player-name">${this._getDisplayName(s.discord_id)}</span>
                <button class="setup-remove-btn registration-remove-btn" data-signup-id="${s.id}" data-discord-id="${s.discord_id}" title="Remove">&times;</button>
              </div>
            `).join('')}
        </div>

        <div class="registration-controls">
          <div class="registration-add-manual">
            ${this._renderPlayerPicker('manual-add-picker', 'Add player manually...', availableUsers)}
            <button class="arena-btn arena-btn-small" id="manual-add-btn">Add</button>
          </div>
          <button class="arena-btn arena-btn-primary" id="close-registration-btn" ${signups.length < 2 ? 'disabled' : ''}>
            Close Registration & Arrange Brackets
          </button>
        </div>
      </div>
    `;
  },

  _attachRegistrationManagementListeners(container) {
    // Remove signup buttons
    container.querySelectorAll('.registration-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await arenaData.removeSignUp(btn.dataset.signupId);
          this._signups = (this._signups || []).filter(s => s.id !== btn.dataset.signupId);
          this._renderContent(container);
          toast.info('Player removed from registration');
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    });

    // Manual add
    const addBtn = container.querySelector('#manual-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const discordId = this._getPickerValue('manual-add-picker');
        if (!discordId) {
          toast.error('Select a player to add');
          return;
        }
        try {
          await arenaData.signUp(this._tournament.id, discordId);
          this._signups = await arenaData.getSignups(this._tournament.id);
          this._renderContent(container);
          toast.success('Player added');
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Close registration
    const closeBtn = container.querySelector('#close-registration-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', async () => {
        if (!await arenaConfirm('Close registration and move to bracket arrangement? Players will no longer be able to sign up.', { title: 'Close Registration', confirmText: 'Close Registration' })) return;
        closeBtn.disabled = true;
        closeBtn.textContent = 'Closing...';
        try {
          const participants = await arenaData.closeRegistration(this._tournament.id);
          this._participants = participants;
          this._tournament.current_phase = 'setup';
          this._tournament.status = 'setup';
          toast.success('Registration closed! Arrange your brackets.');
          this._renderContent(container);
        } catch (err) {
          toast.error('Failed: ' + err.message);
          closeBtn.disabled = false;
          closeBtn.textContent = 'Close Registration & Arrange Brackets';
        }
      });
    }
  },

  _renderDragDropEditor() {
    const bracketCount = this._tournament.bracket_count || 4;
    const participantIds = new Set(this._participants.map(p => p.discord_id));

    // Separate participants into assigned (in a bracket) and unassigned (pool)
    const unassigned = [];
    const brackets = {};
    for (let i = 1; i <= bracketCount; i++) brackets[i] = [];
    for (const p of this._participants) {
      if (p.bracket_number && brackets[p.bracket_number]) {
        brackets[p.bracket_number].push(p);
      } else {
        unassigned.push(p);
      }
    }

    // Non-participant users available for manual add
    const availableUsers = [...this._appUsers]
      .filter(u => !participantIds.has(u.discord_id))
      .sort((a, b) => {
        const nameA = (a.display_name || a.username || '').toLowerCase();
        const nameB = (b.display_name || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

    const poolCount = unassigned.length;
    const allAssigned = poolCount === 0 && this._participants.length > 0;

    return `
      <div class="setup-drag-layout">
        <div class="setup-brackets">
          <div class="arena-panel">
            <div class="arena-panel-header">
              <h3>Brackets</h3>
              <div style="display: flex; gap: 0.5rem;">
                <button class="arena-btn arena-btn-small" id="randomize-btn">Randomize</button>
                <button class="arena-btn arena-btn-primary arena-btn-small" id="start-group-stage-btn" ${this._participants.length < 2 ? 'disabled' : ''}>Start Group Stage</button>
              </div>
            </div>
            <div class="arena-bracket-grid">
              ${Object.entries(brackets).map(([bn, players]) => `
                <div class="arena-bracket-column">
                  <h4>Bracket ${bn} <span class="arena-badge badge-blue">${players.length}</span></h4>
                  <div class="arena-bracket-drop" data-bracket="${bn}">
                    ${players.length === 0
                      ? '<div class="bracket-drop-hint">Drop players here</div>'
                      : players.map(p => this._renderBracketPlayer(p)).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="setup-pool arena-panel">
          <div class="arena-panel-header">
            <h3>Player Pool</h3>
            <span class="arena-badge badge-blue">${poolCount}</span>
          </div>
          <div class="setup-pool-list" id="player-pool" data-bracket="pool">
            ${unassigned.length > 0
              ? unassigned.map(p => this._renderBracketPlayer(p)).join('')
              : (allAssigned
                ? '<p class="setup-pool-empty">All players assigned to brackets</p>'
                : '<p class="setup-pool-empty">No players yet</p>')}
          </div>
          ${availableUsers.length > 0 ? `
            <div class="setup-manual-add">
              ${this._renderPlayerPicker('setup-manual-add-picker', 'Add player...', availableUsers)}
              <button class="arena-btn arena-btn-small" id="setup-manual-add-btn">Add</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  _renderPoolPlayer(user) {
    const avatar = user.avatar_url;
    const name = user.display_name || user.username;
    return `
      <div class="setup-player-card" draggable="true" data-discord-id="${user.discord_id}" data-source="pool">
        ${avatar
          ? `<img src="${avatar}" alt="" class="setup-player-avatar" onerror="this.style.display='none'">`
          : '<span class="setup-player-avatar setup-avatar-placeholder"></span>'}
        <span class="setup-player-name">${name}</span>
      </div>
    `;
  },

  _renderBracketPlayer(participant) {
    const avatar = this._getAvatarUrl(participant.discord_id);
    const name = this._getDisplayName(participant.discord_id);
    return `
      <div class="setup-player-card in-bracket" draggable="true" data-participant-id="${participant.id}" data-discord-id="${participant.discord_id}" data-source="bracket">
        ${avatar
          ? `<img src="${avatar}" alt="" class="setup-player-avatar" onerror="this.style.display='none'">`
          : '<span class="setup-player-avatar setup-avatar-placeholder"></span>'}
        <span class="setup-player-name">${name}</span>
        <button class="setup-remove-btn" data-participant-id="${participant.id}" title="Remove">&times;</button>
      </div>
    `;
  },

  _renderPhaseControls() {
    const t = this._tournament;
    const phase = t.current_phase;
    const matches = this._matches || [];

    // Count matches for the current phase
    const phaseMatches = matches.filter(m => m.phase === phase);
    const completedCount = phaseMatches.filter(m => m.status === 'complete').length;
    const totalCount = phaseMatches.length;
    const incompleteCount = totalCount - completedCount;
    const allComplete = incompleteCount === 0 && totalCount > 0;

    let actionHtml = '';
    let nextPhaseLabel = '';

    if (phase === 'group_stage') {
      nextPhaseLabel = 'Semifinals';
      actionHtml = allComplete
        ? `<button class="arena-btn arena-btn-primary" id="advance-btn">Advance to Semifinals</button>`
        : `
          <button class="arena-btn arena-btn-primary" id="advance-btn" ${totalCount === 0 ? 'disabled' : ''}>Advance to Semifinals</button>
          ${incompleteCount > 0 ? `<button class="arena-btn arena-btn-danger" id="force-advance-btn">Force Advance (forfeit ${incompleteCount} match${incompleteCount > 1 ? 'es' : ''})</button>` : ''}
        `;
    } else if (phase === 'semifinals') {
      nextPhaseLabel = 'Finals';
      actionHtml = allComplete
        ? `<button class="arena-btn arena-btn-primary" id="advance-btn">Advance to Finals</button>`
        : `
          <button class="arena-btn arena-btn-primary" id="advance-btn" ${totalCount === 0 ? 'disabled' : ''}>Advance to Finals</button>
          ${incompleteCount > 0 ? `<button class="arena-btn arena-btn-danger" id="force-advance-btn">Force Advance (forfeit ${incompleteCount} match${incompleteCount > 1 ? 'es' : ''})</button>` : ''}
        `;
    } else if (phase === 'finals') {
      actionHtml = allComplete
        ? `<button class="arena-btn arena-btn-primary" id="complete-tournament-btn">Complete Tournament</button>`
        : `
          <button class="arena-btn arena-btn-primary" id="complete-tournament-btn" disabled>Complete Tournament</button>
          ${incompleteCount > 0 ? `<button class="arena-btn arena-btn-danger" id="force-advance-btn">Force Complete (forfeit ${incompleteCount} match${incompleteCount > 1 ? 'es' : ''})</button>` : ''}
        `;
    }

    return `
      <div class="arena-panel" style="margin-top: 1rem;">
        <div class="arena-panel-header">
          <h3>Phase Controls</h3>
        </div>
        <p>Current phase: <strong>${phase?.replace(/_/g, ' ')}</strong></p>
        ${totalCount > 0 ? `<p>Matches: <strong>${completedCount}/${totalCount}</strong> complete${incompleteCount > 0 ? ` — <span style="color: #e8a44a;">${incompleteCount} incomplete</span>` : ''}</p>` : ''}
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
          ${actionHtml}
        </div>
      </div>
    `;
  },

  // ============================================
  // DRAG AND DROP
  // ============================================

  _initDragDrop(container) {
    let draggedEl = null;

    // Make all player cards draggable
    container.querySelectorAll('.setup-player-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedEl = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Store info for drop handler
        e.dataTransfer.setData('text/plain', JSON.stringify({
          source: card.dataset.source,
          discordId: card.dataset.discordId,
          participantId: card.dataset.participantId || null
        }));
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        draggedEl = null;
        container.querySelectorAll('.drag-over').forEach(z => z.classList.remove('drag-over'));
      });
    });

    // All drop zones: bracket columns + player pool
    const dropZones = container.querySelectorAll('.arena-bracket-drop, #player-pool');
    dropZones.forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
      });

      zone.addEventListener('dragleave', (e) => {
        // Only remove if actually leaving the zone (not entering a child)
        if (!zone.contains(e.relatedTarget)) {
          zone.classList.remove('drag-over');
        }
      });

      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');

        let data;
        try {
          data = JSON.parse(e.dataTransfer.getData('text/plain'));
        } catch { return; }

        const targetBracket = zone.dataset.bracket; // 'pool' or '1', '2', etc.

        if (data.participantId && targetBracket !== 'pool') {
          // Participant (from bracket or pool) → bracket: move
          await this._moveBetweenBrackets(data.participantId, parseInt(targetBracket), container);
        } else if (data.participantId && targetBracket === 'pool') {
          // Participant → Pool: unassign bracket
          await this._unassignFromBracket(data.participantId, container);
        } else if (!data.participantId && data.source === 'pool' && targetBracket !== 'pool') {
          // Non-participant pool user → Bracket: add as participant
          await this._addToBracket(data.discordId, parseInt(targetBracket), container);
        }
      });
    });

    // Remove buttons (×)
    container.querySelectorAll('.setup-remove-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._removeFromBracket(btn.dataset.participantId, container);
      });
    });
  },

  async _addToBracket(discordId, bracketNumber, container) {
    try {
      const participant = await arenaData.addParticipant(
        this._tournament.id,
        discordId,
        bracketNumber,
        null
      );
      this._participants.push(participant);
      this._renderContent(container);
    } catch (err) {
      toast.error('Failed to add: ' + err.message);
    }
  },

  async _removeFromBracket(participantId, container) {
    try {
      await arenaData.removeParticipant(participantId);
      this._participants = this._participants.filter(p => p.id !== participantId);
      this._renderContent(container);
    } catch (err) {
      toast.error('Failed to remove: ' + err.message);
    }
  },

  async _unassignFromBracket(participantId, container) {
    try {
      await arenaData.updateParticipant(participantId, { bracket_number: null, seed_position: null });
      const p = this._participants.find(p => p.id === participantId);
      if (p) {
        p.bracket_number = null;
        p.seed_position = null;
      }
      this._renderContent(container);
    } catch (err) {
      toast.error('Failed to unassign: ' + err.message);
    }
  },

  async _moveBetweenBrackets(participantId, newBracket, container) {
    try {
      await arenaData.updateParticipant(participantId, { bracket_number: newBracket });
      const p = this._participants.find(p => p.id === participantId);
      if (p) p.bracket_number = newBracket;
      this._renderContent(container);
    } catch (err) {
      toast.error('Failed to move: ' + err.message);
    }
  },

  // ============================================
  // OTHER EVENT LISTENERS
  // ============================================

  _attachEventListeners(container) {
    // Randomize
    const randomizeBtn = document.getElementById('randomize-btn');
    if (randomizeBtn) {
      randomizeBtn.addEventListener('click', async () => {
        const bracketCount = this._tournament.bracket_count || 4;
        const shuffled = [...this._participants].sort(() => Math.random() - 0.5);

        const updates = shuffled.map((p, i) => ({
          id: p.id,
          bracket_number: (i % bracketCount) + 1,
          seed_position: Math.floor(i / bracketCount) + 1
        }));

        try {
          await arenaData.bulkUpdateParticipants(updates);
          for (const u of updates) {
            const p = this._participants.find(p => p.id === u.id);
            if (p) {
              p.bracket_number = u.bracket_number;
              p.seed_position = u.seed_position;
            }
          }
          toast.success('Brackets randomized!');
          this._renderContent(container);
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Start group stage
    const startBtn = document.getElementById('start-group-stage-btn');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        if (!await arenaConfirm('This will generate all bracket matches.', { title: 'Start Group Stage', confirmText: 'Start' })) return;
        try {
          await arenaData.generateGroupMatches(this._tournament.id);
          toast.success('Group stage started! Matches generated.');
          router.navigate('arena');
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Phase advancement buttons
    const advanceBtn = document.getElementById('advance-btn');
    if (advanceBtn) {
      advanceBtn.addEventListener('click', async () => {
        const phase = this._tournament.current_phase;
        const nextLabel = phase === 'group_stage' ? 'Semifinals' : 'Finals';
        if (!await arenaConfirm(`Advance to ${nextLabel} using current standings?`, { title: `Advance to ${nextLabel}`, confirmText: 'Advance' })) return;
        try {
          let result;
          if (phase === 'group_stage') {
            result = await arenaData.generateSemifinalMatches(this._tournament.id);
          } else {
            result = await arenaData.generateFinalMatch(this._tournament.id);
          }
          if (result?.skipped) {
            toast.success('Only 1 semifinal winner — tournament complete!');
            router.navigate('arena');
          } else {
            toast.success(`${nextLabel} generated!`);
            this._loadData().then(() => this._renderContent(container));
          }
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    const forceAdvanceBtn = document.getElementById('force-advance-btn');
    if (forceAdvanceBtn) {
      forceAdvanceBtn.addEventListener('click', async () => {
        const phase = this._tournament.current_phase;
        if (phase === 'finals') {
          // Force complete finals — forfeit incomplete final matches
          if (!await arenaConfirm('Forfeit all incomplete final matches (Player 1 wins by default) and complete the tournament?', { title: 'Force Complete', confirmText: 'Force Complete', danger: true })) return;
          try {
            const incompleteMatches = (this._matches || []).filter(m => m.phase === 'finals' && m.status !== 'complete');
            for (const m of incompleteMatches) {
              await arenaData.forfeitMatch(m.id, m.player1_id);
            }
            await arenaData.updateTournament(this._tournament.id, {
              status: 'complete',
              current_phase: 'complete'
            });
            toast.success('Tournament force-completed!');
            router.navigate('arena');
          } catch (err) {
            toast.error('Failed: ' + err.message);
          }
        } else {
          const nextLabel = phase === 'group_stage' ? 'Semifinals' : 'Finals';
          if (!await arenaConfirm(`Forfeit all incomplete matches (Player 1 wins by default) and advance to ${nextLabel}?`, { title: 'Force Advance', confirmText: 'Force Advance', danger: true })) return;
          try {
            let result;
            if (phase === 'group_stage') {
              result = await arenaData.generateSemifinalMatches(this._tournament.id, { forceAdvance: true });
            } else {
              result = await arenaData.generateFinalMatch(this._tournament.id, { forceAdvance: true });
            }
            if (result?.skipped) {
              toast.success('Only 1 semifinal winner — tournament complete!');
              router.navigate('arena');
            } else {
              toast.success(`${nextLabel} generated!`);
              this._loadData().then(() => this._renderContent(container));
            }
          } catch (err) {
            toast.error('Failed: ' + err.message);
          }
        }
      });
    }

    const completeBtn = document.getElementById('complete-tournament-btn');
    if (completeBtn) {
      completeBtn.addEventListener('click', async () => {
        if (!await arenaConfirm('Mark the tournament as complete?', { title: 'Complete Tournament', confirmText: 'Complete' })) return;
        try {
          await arenaData.updateTournament(this._tournament.id, {
            status: 'complete',
            current_phase: 'complete'
          });
          toast.success('Tournament complete!');
          router.navigate('arena');
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Stop tournament
    const stopBtn = document.getElementById('stop-tournament-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        if (!await arenaConfirm('All matches, rounds, and results will be deleted. Participants and brackets are kept.', { title: 'Stop Tournament', confirmText: 'Stop', danger: true })) return;
        try {
          await arenaData.stopTournament(this._tournament.id);
          toast.success('Tournament stopped — back to setup');
          await this._loadData();
          this._renderContent(container);
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Manual add (setup phase - add non-registered user as participant)
    const manualAddBtn = document.getElementById('setup-manual-add-btn');
    if (manualAddBtn) {
      manualAddBtn.addEventListener('click', async () => {
        const discordId = this._getPickerValue('setup-manual-add-picker');
        if (!discordId) {
          toast.error('Select a player to add');
          return;
        }
        try {
          const participant = await arenaData.addParticipant(this._tournament.id, discordId, null, null);
          this._participants.push(participant);
          toast.success('Player added to pool');
          this._renderContent(container);
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Save prize pool
    const savePrizeBtn = document.getElementById('save-prize-pool-btn');
    if (savePrizeBtn) {
      savePrizeBtn.addEventListener('click', async () => {
        const poolInput = document.getElementById('prize-pool-input');
        const pool = parseInt(poolInput?.value) || 0;
        try {
          const prizes = pool > 0 ? { pool } : null;
          await arenaData.updateTournament(this._tournament.id, { prizes });
          this._tournament.prizes = prizes;
          toast.success(pool > 0 ? `Prize pool set to ${pool.toLocaleString()} Gold` : 'Prize pool removed');
          this._renderContent(container);
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    // Delete tournament
    const deleteBtn = document.getElementById('delete-tournament-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!await arenaConfirm('Delete this tournament entirely? This cannot be undone.', { title: 'Delete Tournament', confirmText: 'Delete', danger: true })) return;
        try {
          await arenaData.deleteTournament(this._tournament.id);
          toast.success('Tournament deleted');
          this._tournament = null;
          this._participants = [];
          this._renderCreateForm(container);
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }
  },

  destroy() {
    if (this._signupSubscription) {
      arenaData.unsubscribe(this._signupSubscription);
      this._signupSubscription = null;
    }
  }
};

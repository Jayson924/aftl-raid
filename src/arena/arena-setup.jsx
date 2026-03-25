import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { TOURNAMENT_PHASES } from './arena-constants.js';

/**
 * Arena Setup — Admin-only tournament setup page.
 * Create tournament, drag-and-drop players into brackets.
 * Route: /arena-setup
 */
export const ArenaSetupPage = {
  _tournament: null,
  _participants: null,
  _appUsers: null,

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
      this._participants = await arenaData.getParticipants(this._tournament.id);
    } else {
      this._participants = [];
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

  _renderCreateForm(container) {
    container.innerHTML = `
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
      try {
        this._tournament = await arenaData.createTournament(name, selectedCount, selectedFormat);
        this._participants = [];
        toast.success('Tournament created!');
        this._renderContent(container);
      } catch (err) {
        toast.error('Failed: ' + err.message);
      }
    });
  },

  _renderContent(container) {
    const t = this._tournament;
    const phaseName = t.current_phase?.replace(/_/g, ' ') || 'setup';
    const isSetup = t.current_phase === 'setup';
    const isActive = !isSetup && t.current_phase !== 'complete';

    container.innerHTML = `
      <div class="arena-setup-header arena-panel">
        <div class="arena-panel-header">
          <h2>${t.name}</h2>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span class="arena-badge badge-gold">${phaseName}</span>
            ${isActive ? `<button class="arena-btn arena-btn-danger arena-btn-small" id="stop-tournament-btn">Stop Tournament</button>` : ''}
            <button class="arena-btn arena-btn-danger arena-btn-small" id="delete-tournament-btn">Delete</button>
          </div>
        </div>
      </div>

      ${isSetup ? this._renderDragDropEditor() : this._renderPhaseControls()}
    `;

    this._attachEventListeners(container);
    if (isSetup) this._initDragDrop(container);
  },

  _renderDragDropEditor() {
    const bracketCount = this._tournament.bracket_count || 4;
    const participantIds = new Set(this._participants.map(p => p.discord_id));

    // Available players = all users not yet added as participants
    const availableUsers = [...this._appUsers]
      .filter(u => !participantIds.has(u.discord_id))
      .sort((a, b) => {
        const nameA = (a.display_name || a.username || '').toLowerCase();
        const nameB = (b.display_name || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

    // Build bracket groups
    const brackets = {};
    for (let i = 1; i <= bracketCount; i++) brackets[i] = [];
    for (const p of this._participants) {
      const bn = p.bracket_number || 1;
      if (brackets[bn]) brackets[bn].push(p);
      else brackets[1].push(p);
    }

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
            <span class="arena-badge badge-blue">${availableUsers.length}</span>
          </div>
          <div class="setup-pool-list" id="player-pool" data-bracket="pool">
            ${availableUsers.length === 0
              ? '<p class="setup-pool-empty">All players added</p>'
              : availableUsers.map(u => this._renderPoolPlayer(u)).join('')}
          </div>
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

    let actionHtml = '';
    if (phase === 'group_stage') {
      actionHtml = `<button class="arena-btn arena-btn-primary" id="advance-semifinals-btn">Advance to Semifinals</button>`;
    } else if (phase === 'semifinals') {
      actionHtml = `<button class="arena-btn arena-btn-primary" id="advance-finals-btn">Advance to Finals</button>`;
    } else if (phase === 'finals') {
      actionHtml = `<button class="arena-btn arena-btn-primary" id="complete-tournament-btn">Complete Tournament</button>`;
    }

    return `
      <div class="arena-panel" style="margin-top: 1rem;">
        <div class="arena-panel-header">
          <h3>Phase Controls</h3>
        </div>
        <p>Current phase: <strong>${phase?.replace(/_/g, ' ')}</strong></p>
        ${actionHtml}
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

        if (data.source === 'pool' && targetBracket !== 'pool') {
          // Pool → Bracket: add participant
          await this._addToBracket(data.discordId, parseInt(targetBracket), container);
        } else if (data.source === 'bracket' && targetBracket === 'pool') {
          // Bracket → Pool: remove participant
          await this._removeFromBracket(data.participantId, container);
        } else if (data.source === 'bracket' && targetBracket !== 'pool') {
          // Bracket → Different bracket: move participant
          await this._moveBetweenBrackets(data.participantId, parseInt(targetBracket), container);
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
        if (!confirm('Start the group stage? This will generate all bracket matches.')) return;
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
    const semisBtn = document.getElementById('advance-semifinals-btn');
    if (semisBtn) {
      semisBtn.addEventListener('click', async () => {
        if (!confirm('Advance to semifinals?')) return;
        try {
          await arenaData.generateSemifinalMatches(this._tournament.id);
          toast.success('Semifinals generated!');
          this._loadData().then(() => this._renderContent(container));
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    const finalsBtn = document.getElementById('advance-finals-btn');
    if (finalsBtn) {
      finalsBtn.addEventListener('click', async () => {
        if (!confirm('Advance to finals?')) return;
        try {
          await arenaData.generateFinalMatch(this._tournament.id);
          toast.success('Final match generated!');
          this._loadData().then(() => this._renderContent(container));
        } catch (err) {
          toast.error('Failed: ' + err.message);
        }
      });
    }

    const completeBtn = document.getElementById('complete-tournament-btn');
    if (completeBtn) {
      completeBtn.addEventListener('click', async () => {
        if (!confirm('Complete the tournament?')) return;
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
        if (!confirm('Stop this tournament? All matches, rounds, and results will be deleted. Participants and brackets are kept.')) return;
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

    // Delete tournament
    const deleteBtn = document.getElementById('delete-tournament-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete this tournament entirely? This cannot be undone.')) return;
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
    // cleanup done
  }
};

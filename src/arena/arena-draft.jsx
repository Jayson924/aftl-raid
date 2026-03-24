import { ArenaShell } from './arena-shell.jsx';
import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { TIMERS, DRAFT_RULES, CLASS_ABILITIES, getAbilityForClass } from './arena-constants.js';

/**
 * Arena Draft — Character selection phase before a match.
 * Players pick 3 characters from their roster (+ optional hire).
 * Route: /arena-draft?match=<id>
 */
export const ArenaDraftPage = {
  _match: null,
  _matchSubscription: null,
  _myParticipant: null,
  _opponentParticipant: null,
  _myCharacters: [],
  _hireableCharacters: [],
  _selectedCharacters: [],
  _timerInterval: null,
  _timeLeft: TIMERS.DRAFT_PHASE,
  _locked: false,
  _participants: null,

  async render(container) {
    ArenaShell.activate();
    container.innerHTML = '';
    ArenaShell.renderHeader(container, 'arena');

    const content = document.createElement('div');
    content.className = 'arena-draft';
    content.innerHTML = '<div class="arena-empty"><p>Loading draft...</p></div>';
    container.appendChild(content);

    const params = new URLSearchParams(window.location.search);
    const matchId = params.get('match');
    if (!matchId) {
      content.innerHTML = '<div class="arena-empty"><h3>No match specified</h3></div>';
      return;
    }

    try {
      await this._loadData(matchId);
      this._renderContent(content);
      this._startTimer(content);
    } catch (err) {
      console.error('Draft error:', err);
      content.innerHTML = `<div class="arena-empty"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async _loadData(matchId) {
    this._match = await arenaData.getMatch(matchId);
    if (!this._match) throw new Error('Match not found');

    const currentUser = dataService.getUser();
    if (!currentUser) throw new Error('Not logged in');

    // Get participants
    this._participants = await arenaData.getParticipants(this._match.tournament_id);
    const p1 = this._participants.find(p => p.id === this._match.player1_id);
    const p2 = this._participants.find(p => p.id === this._match.player2_id);

    if (p1?.discord_id === currentUser.id) {
      this._myParticipant = p1;
      this._opponentParticipant = p2;
    } else if (p2?.discord_id === currentUser.id) {
      this._myParticipant = p2;
      this._opponentParticipant = p1;
    } else {
      throw new Error('You are not a player in this match');
    }

    // Load my characters
    this._myCharacters = await arenaData.getPlayersByDiscordId(currentUser.id);

    // Load hireable characters (from other brackets, not opponent's)
    await this._loadHireableCharacters();

    // Subscribe to match changes (to detect when both drafted → roster reveal)
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToMatch(this._match.id, (payload) => {
      this._onMatchUpdate(payload);
    });

    this._selectedCharacters = [];
    this._locked = false;
    this._timeLeft = TIMERS.DRAFT_PHASE;
  },

  async _loadHireableCharacters() {
    // Get all participants in the same bracket
    const myBracket = this._myParticipant.bracket_number;
    const sameBracketIds = this._participants
      .filter(p => p.bracket_number === myBracket)
      .map(p => p.discord_id);

    // Get all app users
    const appUsers = await arenaData.getAllAppUsers();
    const otherUserIds = appUsers
      .map(u => u.discord_id)
      .filter(id => !sameBracketIds.includes(id));

    // Load characters for hire candidates
    const allHireable = [];
    for (const userId of otherUserIds) {
      const chars = await arenaData.getPlayersByDiscordId(userId);
      for (const c of chars) {
        allHireable.push({ ...c, isHired: true });
      }
    }
    this._hireableCharacters = allHireable;
  },

  _renderContent(container) {
    const myName = this._getDisplayName(this._myParticipant.discord_id);
    const oppName = this._getDisplayName(this._opponentParticipant.discord_id);
    const hiredCount = this._selectedCharacters.filter(c => c.isHired).length;

    container.innerHTML = `
      <div class="draft-header arena-panel">
        <div class="draft-matchup">
          <span class="draft-player-name">${myName}</span>
          <span class="draft-vs">vs</span>
          <span class="draft-player-name">${oppName}</span>
        </div>
        <div class="draft-timer" id="draft-timer">
          <span class="timer-value">${this._timeLeft}s</span>
        </div>
        <div class="draft-status">
          Pick ${DRAFT_RULES.CHARACTERS_PER_DRAFT} characters for battle
          ${this._locked ? ' — <strong>Locked in!</strong> Waiting for opponent...' : ''}
        </div>
      </div>

      <div class="draft-selected arena-panel" id="draft-selected">
        <div class="arena-panel-header">
          <h3>Your Team (${this._selectedCharacters.length}/${DRAFT_RULES.CHARACTERS_PER_DRAFT})</h3>
          <button class="arena-btn arena-btn-primary" id="lock-in-btn" ${this._selectedCharacters.length !== DRAFT_RULES.CHARACTERS_PER_DRAFT || this._locked ? 'disabled' : ''}>
            ${this._locked ? 'Locked In' : 'Lock In'}
          </button>
        </div>
        <div class="draft-selected-slots">
          ${[0, 1, 2].map(i => {
            const char = this._selectedCharacters[i];
            if (char) {
              const ability = getAbilityForClass(char.role);
              return `
                <div class="draft-slot filled" data-index="${i}">
                  <div class="draft-slot-name">${char.name}</div>
                  <div class="draft-slot-class">${char.role}</div>
                  ${ability ? `<div class="draft-slot-ability">${ability.icon} ${ability.name}</div>` : ''}
                  ${char.isHired ? '<span class="arena-badge badge-gold">Hired</span>' : ''}
                  ${!this._locked ? `<button class="draft-remove-btn" data-index="${i}">&times;</button>` : ''}
                </div>
              `;
            }
            return `<div class="draft-slot empty">Empty</div>`;
          }).join('')}
        </div>
      </div>

      <div class="draft-tabs">
        <button class="arena-btn draft-tab active" data-tab="my-chars">My Characters</button>
        <button class="arena-btn draft-tab" data-tab="hire">Hire (${hiredCount}/${DRAFT_RULES.MAX_HIRED})</button>
      </div>

      <div class="draft-character-list arena-panel" id="draft-my-chars">
        ${this._renderCharacterGrid(this._myCharacters, false)}
      </div>

      <div class="draft-character-list arena-panel" id="draft-hire" style="display: none;">
        ${this._renderCharacterGrid(this._hireableCharacters, true)}
      </div>
    `;

    this._attachListeners(container);
  },

  _renderCharacterGrid(characters, isHire) {
    if (characters.length === 0) {
      return '<p style="text-align: center; opacity: 0.5;">No characters available</p>';
    }

    return `
      <div class="draft-grid">
        ${characters.map(c => {
          const isSelected = this._selectedCharacters.some(s => s.id === c.id);
          const ability = getAbilityForClass(c.role);
          const hiredCount = this._selectedCharacters.filter(s => s.isHired).length;
          const cantHire = isHire && hiredCount >= DRAFT_RULES.MAX_HIRED && !isSelected;

          return `
            <div class="draft-card ${isSelected ? 'selected' : ''} ${cantHire ? 'disabled' : ''} ${this._locked ? 'locked' : ''}"
                 data-char-id="${c.id}" data-is-hire="${isHire}">
              <div class="draft-card-name">${c.name}</div>
              <div class="draft-card-class">${c.role}</div>
              ${ability ? `<div class="draft-card-ability">${ability.icon} ${ability.name}</div>` : ''}
              ${isHire ? '<div class="draft-card-hire-badge">Hire</div>' : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  _attachListeners(container) {
    // Tab switching
    container.querySelectorAll('.draft-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.draft-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        document.getElementById('draft-my-chars').style.display = tabName === 'my-chars' ? '' : 'none';
        document.getElementById('draft-hire').style.display = tabName === 'hire' ? '' : 'none';
      });
    });

    // Character card clicks
    container.querySelectorAll('.draft-card').forEach(card => {
      card.addEventListener('click', () => {
        if (this._locked) return;
        const charId = card.dataset.charId;
        const isHire = card.dataset.isHire === 'true';
        this._toggleCharacter(charId, isHire, container);
      });
    });

    // Remove buttons
    container.querySelectorAll('.draft-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._locked) return;
        const index = parseInt(btn.dataset.index);
        this._selectedCharacters.splice(index, 1);
        this._renderContent(container);
      });
    });

    // Lock in button
    const lockBtn = document.getElementById('lock-in-btn');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => this._lockIn(container));
    }
  },

  _toggleCharacter(charId, isHire, container) {
    const existingIndex = this._selectedCharacters.findIndex(c => c.id === charId);
    if (existingIndex >= 0) {
      this._selectedCharacters.splice(existingIndex, 1);
    } else {
      if (this._selectedCharacters.length >= DRAFT_RULES.CHARACTERS_PER_DRAFT) {
        toast.error(`Max ${DRAFT_RULES.CHARACTERS_PER_DRAFT} characters`);
        return;
      }
      const hiredCount = this._selectedCharacters.filter(c => c.isHired).length;
      if (isHire && hiredCount >= DRAFT_RULES.MAX_HIRED) {
        toast.error(`Max ${DRAFT_RULES.MAX_HIRED} hired character`);
        return;
      }

      const pool = isHire ? this._hireableCharacters : this._myCharacters;
      const char = pool.find(c => c.id === charId);
      if (char) {
        this._selectedCharacters.push({ ...char, isHired: isHire });
      }
    }
    this._renderContent(container);
  },

  async _lockIn(container) {
    if (this._selectedCharacters.length !== DRAFT_RULES.CHARACTERS_PER_DRAFT) return;
    if (this._locked) return;

    this._locked = true;

    try {
      const characters = this._selectedCharacters.map(c => ({
        playerId: c.id,
        playerName: c.name,
        className: c.role,
        isHired: c.isHired || false
      }));

      await arenaData.submitDraft(
        this._match.id,
        this._myParticipant.discord_id,
        characters
      );

      toast.success('Draft locked in!');
      this._renderContent(container);
    } catch (err) {
      this._locked = false;
      toast.error('Failed to lock in: ' + err.message);
      this._renderContent(container);
    }
  },

  _startTimer(container) {
    if (this._timerInterval) clearInterval(this._timerInterval);
    this._timeLeft = TIMERS.DRAFT_PHASE;

    this._timerInterval = setInterval(() => {
      this._timeLeft--;
      const timerEl = document.getElementById('draft-timer');
      if (timerEl) {
        timerEl.querySelector('.timer-value').textContent = `${this._timeLeft}s`;
        if (this._timeLeft <= 10) timerEl.classList.add('timer-urgent');
      }

      if (this._timeLeft <= 0) {
        clearInterval(this._timerInterval);
        if (!this._locked) {
          this._autoRandomDraft(container);
        }
      }
    }, 1000);
  },

  async _autoRandomDraft(container) {
    // Auto-pick random characters
    const available = [...this._myCharacters];
    this._selectedCharacters = [];
    for (let i = 0; i < DRAFT_RULES.CHARACTERS_PER_DRAFT && available.length > 0; i++) {
      const idx = Math.floor(Math.random() * available.length);
      this._selectedCharacters.push({ ...available[idx], isHired: false });
      available.splice(idx, 1);
    }

    if (this._selectedCharacters.length > 0) {
      toast.info('Time\'s up! Auto-picked random characters.');
      await this._lockIn(container);
    }
  },

  _onMatchUpdate(payload) {
    const newMatch = payload.new;
    if (!newMatch) return;

    this._match = newMatch;

    if (newMatch.status === 'roster_reveal' || newMatch.status === 'in_progress') {
      // Both players drafted — show reveal then navigate to match
      toast.success('Both players drafted! Starting match...');
      if (this._timerInterval) clearInterval(this._timerInterval);
      setTimeout(() => {
        router.navigate(`arena-match?match=${this._match.id}`);
      }, 2000);
    }
  },

  _getDisplayName(discordId) {
    const user = this._participants?.find(p => p.discord_id === discordId);
    // Fall back to data service
    return discordId;
  },

  destroy() {
    if (this._matchSubscription) {
      arenaData.unsubscribe(this._matchSubscription);
      this._matchSubscription = null;
    }
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    ArenaShell.deactivate();
  }
};

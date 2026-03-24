import { ArenaShell } from './arena-shell.jsx';
import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { ArenaCombat } from './arena-combat.js';
import { TIMERS, BASE_HP, MAX_HP, getAbilityForClass, MATCH_STATUS } from './arena-constants.js';

/**
 * Arena Match — The main combat screen.
 * Side-by-side portraits, HP bars, action buttons, ability button, turn history.
 * Route: /arena-match?match=<id>
 */
export const ArenaMatchPage = {
  _match: null,
  _matchSubscription: null,
  _roundSubscription: null,
  _combat: null,
  _presenceChannel: null,
  _spectatorCount: 0,
  _myParticipant: null,
  _opponentParticipant: null,
  _participants: null,
  _appUsers: null,
  _currentRound: null,
  _currentTurn: null,
  _myAction: null,
  _myAbility: false,
  _committed: false,
  _timerInterval: null,
  _timeLeft: TIMERS.ACTION_PICK,
  _isPlayer: false,
  _playerSide: null, // 'player1' or 'player2'

  async render(container) {
    ArenaShell.activate();
    container.innerHTML = '';
    ArenaShell.renderHeader(container, 'arena');

    const content = document.createElement('div');
    content.className = 'arena-match';
    content.innerHTML = '<div class="arena-empty"><p>Loading match...</p></div>';
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
    } catch (err) {
      console.error('Match error:', err);
      content.innerHTML = `<div class="arena-empty"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async _loadData(matchId) {
    this._match = await arenaData.getMatch(matchId);
    if (!this._match) throw new Error('Match not found');

    const [participants, appUsers] = await Promise.all([
      arenaData.getParticipants(this._match.tournament_id),
      arenaData.getAllAppUsers()
    ]);

    this._participants = participants;
    this._appUsers = appUsers;

    const currentUser = dataService.getUser();
    const p1 = participants.find(p => p.id === this._match.player1_id);
    const p2 = participants.find(p => p.id === this._match.player2_id);

    if (currentUser && p1?.discord_id === currentUser.id) {
      this._isPlayer = true;
      this._playerSide = 'player1';
      this._myParticipant = p1;
      this._opponentParticipant = p2;
    } else if (currentUser && p2?.discord_id === currentUser.id) {
      this._isPlayer = true;
      this._playerSide = 'player2';
      this._myParticipant = p2;
      this._opponentParticipant = p1;
    } else {
      this._isPlayer = false;
      this._playerSide = null;
      this._myParticipant = null;
      this._opponentParticipant = null;
    }

    // Load current round
    const rounds = await arenaData.getRounds(matchId);
    this._currentRound = rounds[rounds.length - 1] || null;

    // Init combat display
    this._combat = new ArenaCombat(matchId, (event, data) => this._onCombatEvent(event, data));

    if (this._currentRound) {
      await this._combat.loadTurnHistory(this._currentRound.id);
      this._combat.subscribeToTurns(this._currentRound.id);

      // Load current turn
      const turns = await arenaData.getTurns(this._currentRound.id);
      const unresolvedTurn = turns.find(t => !t.resolved);
      this._currentTurn = unresolvedTurn || null;

      // Check if we already committed
      if (this._currentTurn && this._playerSide) {
        this._committed = this._currentTurn[`${this._playerSide}_committed`];
      }
    }

    // Subscribe to match changes
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToMatch(matchId, (payload) => {
      this._onMatchUpdate(payload);
    });

    // Subscribe to round changes (for character send phase)
    if (this._currentRound) {
      if (this._roundSubscription) arenaData.unsubscribe(this._roundSubscription);
      this._roundSubscription = arenaData.subscribeToRounds(matchId, (payload) => {
        this._onRoundUpdate(payload);
      });
    }

    // Join presence
    if (currentUser) {
      this._presenceChannel = arenaData.joinMatchPresence(matchId, currentUser, (users) => {
        this._spectatorCount = users.length;
        const countEl = document.getElementById('spectator-count');
        if (countEl) countEl.textContent = `${this._spectatorCount} watching`;
      });
    }

    this._myAction = null;
    this._myAbility = false;
    this._timeLeft = TIMERS.ACTION_PICK;
  },

  _getDisplayName(discordId) {
    const user = this._appUsers?.find(u => u.discord_id === discordId);
    return user?.display_name || user?.username || 'Unknown';
  },

  _getParticipantName(participantId) {
    const p = this._participants?.find(p => p.id === participantId);
    if (!p) return 'Unknown';
    return this._getDisplayName(p.discord_id);
  },

  _renderContent(container) {
    const m = this._match;
    const p1Name = this._getParticipantName(m.player1_id);
    const p2Name = this._getParticipantName(m.player2_id);
    const round = this._currentRound;

    const p1Hp = round?.player1_hp || BASE_HP;
    const p2Hp = round?.player2_hp || BASE_HP;
    const p1HpPct = Math.max(0, (p1Hp / MAX_HP) * 100);
    const p2HpPct = Math.max(0, (p2Hp / MAX_HP) * 100);

    const p1Char = round?.player1_character;
    const p2Char = round?.player2_character;
    const p1Ability = p1Char ? getAbilityForClass(p1Char.className) : null;
    const p2Ability = p2Char ? getAbilityForClass(p2Char.className) : null;

    const isComplete = m.status === 'complete';
    const isTiebreaker = m.status === 'tiebreaker';

    // Check if we need to send a character for this round
    const needsCharacterSend = this._isPlayer && round && !isComplete && !isTiebreaker &&
      !round[`${this._playerSide}_character`];
    const waitingForOpponentChar = this._isPlayer && round && !isComplete && !isTiebreaker &&
      round[`${this._playerSide}_character`] && !this._currentTurn;

    container.innerHTML = `
      <div class="match-scoreboard">
        <div class="match-score-display">
          <span class="score-player">${p1Name}</span>
          <span class="score-rounds">${m.player1_rounds_won} - ${m.player2_rounds_won}</span>
          <span class="score-player">${p2Name}</span>
        </div>
        ${round ? `<div class="match-round-label">Round ${round.round_number}</div>` : ''}
        <div class="match-spectators" id="spectator-count">${this._spectatorCount} watching</div>
      </div>

      <div class="match-arena">
        <div class="match-fighter match-fighter-left">
          <div class="fighter-portrait">
            <div class="fighter-portrait-inner">
              ${p1Char ? `<span class="fighter-class-icon">${p1Ability?.icon || ''}</span>` : ''}
            </div>
          </div>
          <div class="fighter-name">${p1Char?.playerName || p1Name}</div>
          ${p1Char ? `<div class="fighter-class">${p1Char.className}</div>` : ''}
          <div class="hp-bar-container">
            <div class="hp-bar" style="width: ${p1HpPct}%" data-hp="${p1Hp}"></div>
            <span class="hp-text">${p1Hp} / ${MAX_HP}</span>
          </div>
          ${p1Ability && !round?.player1_ability_used ? `
            <div class="fighter-ability-ready">${p1Ability.icon} ${p1Ability.name}</div>
          ` : ''}
          ${round?.player1_status?.highlander ? '<div class="fighter-status-effect">Highlander Active</div>' : ''}
          ${round?.player1_status?.chargedMissile ? '<div class="fighter-status-effect">Charged! (x2 next)</div>' : ''}
        </div>

        <div class="match-center">
          ${isComplete ? `
            <div class="match-result-banner">
              <div class="result-label">${m.winner_id ? 'Winner' : 'Draw'}</div>
              ${m.winner_id ? `<div class="result-winner">${this._getParticipantName(m.winner_id)}</div>` : ''}
            </div>
          ` : isTiebreaker ? `
            <div class="match-result-banner">
              <div class="result-label">Tiebreaker!</div>
              <button class="arena-btn arena-btn-primary" id="go-tiebreaker-btn">Enter Enhancement Race</button>
            </div>
          ` : `
            <div class="match-vs-badge">VS</div>
          `}
        </div>

        <div class="match-fighter match-fighter-right">
          <div class="fighter-portrait">
            <div class="fighter-portrait-inner">
              ${p2Char ? `<span class="fighter-class-icon">${p2Ability?.icon || ''}</span>` : ''}
            </div>
          </div>
          <div class="fighter-name">${p2Char?.playerName || p2Name}</div>
          ${p2Char ? `<div class="fighter-class">${p2Char.className}</div>` : ''}
          <div class="hp-bar-container">
            <div class="hp-bar" style="width: ${p2HpPct}%" data-hp="${p2Hp}"></div>
            <span class="hp-text">${p2Hp} / ${MAX_HP}</span>
          </div>
          ${p2Ability && !round?.player2_ability_used ? `
            <div class="fighter-ability-ready">${p2Ability.icon} ${p2Ability.name}</div>
          ` : ''}
          ${round?.player2_status?.highlander ? '<div class="fighter-status-effect">Highlander Active</div>' : ''}
          ${round?.player2_status?.chargedMissile ? '<div class="fighter-status-effect">Charged! (x2 next)</div>' : ''}
        </div>
      </div>

      ${needsCharacterSend ? this._renderCharacterSelect() : ''}
      ${waitingForOpponentChar ? `
        <div class="match-action-panel" id="action-panel">
          <div class="action-waiting">Waiting for opponent to pick their character...</div>
        </div>
      ` : ''}

      ${this._isPlayer && !isComplete && !isTiebreaker && this._currentRound && this._currentTurn ? `
        <div class="match-action-panel" id="action-panel">
          <div class="action-timer" id="action-timer">${this._timeLeft}s</div>
          ${this._committed ? `
            <div class="action-waiting">Waiting for opponent...</div>
          ` : `
            <div class="action-buttons">
              <button class="arena-btn action-btn action-btn-attack ${this._myAction === 'attack' ? 'selected' : ''}" data-action="attack">
                Attack<br><span class="action-damage">${TIMERS.ACTION_PICK > 0 ? '12 dmg' : ''}</span>
              </button>
              <button class="arena-btn action-btn action-btn-defend ${this._myAction === 'defend' ? 'selected' : ''}" data-action="defend">
                Defend<br><span class="action-damage">8 counter</span>
              </button>
              <button class="arena-btn action-btn action-btn-strong ${this._myAction === 'strong_attack' ? 'selected' : ''}" data-action="strong_attack">
                Strong Attack<br><span class="action-damage">16 dmg</span>
              </button>
            </div>
            ${this._canUseAbility() ? `
              <button class="arena-btn action-btn-ability ${this._myAbility ? 'active' : ''}" id="ability-btn">
                ${this._getMyAbility()?.icon || ''} ${this._getMyAbility()?.name || 'Ability'}
                <span class="ability-desc">${this._getMyAbility()?.description || ''}</span>
              </button>
            ` : ''}
            <button class="arena-btn arena-btn-primary" id="commit-action-btn" ${!this._myAction ? 'disabled' : ''}>
              Commit Action
            </button>
          `}
        </div>
      ` : ''}

      <div class="match-history arena-panel" id="match-history">
        <div class="arena-panel-header">
          <h3>Turn History</h3>
        </div>
        <div class="history-content" id="history-content">
          ${this._combat ? this._combat.buildHistoryHtml(p1Name, p2Name) : '<p class="history-empty">No turns yet</p>'}
        </div>
      </div>
    `;

    this._attachListeners(container);
    if (!this._committed && !isComplete && !isTiebreaker && this._currentTurn) {
      this._startActionTimer();
    }
  },

  _canUseAbility() {
    if (!this._currentRound || !this._playerSide) return false;
    return !this._currentRound[`${this._playerSide}_ability_used`];
  },

  _getMyAbility() {
    if (!this._currentRound || !this._playerSide) return null;
    const char = this._currentRound[`${this._playerSide}_character`];
    if (!char) return null;
    return getAbilityForClass(char.className);
  },

  _renderCharacterSelect() {
    const draft = this._match[`${this._playerSide}_draft`] || [];
    if (draft.length === 0) {
      return `<div class="match-action-panel"><div class="action-waiting">No characters drafted</div></div>`;
    }

    // Figure out which characters have already been used in previous rounds
    // (we'll check this asynchronously, for now show all drafted characters)
    return `
      <div class="match-action-panel" id="char-select-panel">
        <h3 class="char-select-title">Send a Character for Round ${this._currentRound?.round_number || '?'}</h3>
        <div class="char-select-grid">
          ${draft.map((c, i) => {
            const ability = getAbilityForClass(c.className);
            return `
              <button class="arena-btn char-select-card" data-char-index="${i}">
                <span class="char-select-name">${c.playerName}</span>
                <span class="char-select-class">${c.className}</span>
                ${ability ? `<span class="char-select-ability">${ability.icon} ${ability.name}</span>` : ''}
                ${c.isHired ? '<span class="char-select-hired">Hired</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  _attachListeners(container) {
    // Character select buttons
    container.querySelectorAll('.char-select-card').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.dataset.charIndex);
        const draft = this._match[`${this._playerSide}_draft`] || [];
        const character = draft[index];
        if (!character) return;

        // Disable all char select buttons
        container.querySelectorAll('.char-select-card').forEach(b => {
          b.disabled = true;
          b.classList.remove('selected');
        });
        btn.classList.add('selected');
        btn.textContent = 'Sending...';

        try {
          const result = await arenaData.sendCharacter(
            this._match.id,
            this._currentRound.id,
            this._myParticipant.discord_id,
            character
          );

          // Reload round data to get updated character fields
          const rounds = await arenaData.getRounds(this._match.id);
          this._currentRound = rounds[rounds.length - 1] || null;

          if (result.bothReady && this._currentRound) {
            // Both characters sent — a turn should now exist
            const turns = await arenaData.getTurns(this._currentRound.id);
            this._currentTurn = turns.find(t => !t.resolved) || null;
          }

          this._renderContent(container);
        } catch (err) {
          toast.error('Failed to send character: ' + err.message);
          container.querySelectorAll('.char-select-card').forEach(b => b.disabled = false);
          btn.textContent = character.playerName;
        }
      });
    });

    // Action buttons
    container.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this._committed) return;
        this._myAction = btn.dataset.action;
        container.querySelectorAll('.action-btn[data-action]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const commitBtn = document.getElementById('commit-action-btn');
        if (commitBtn) commitBtn.disabled = false;
      });
    });

    // Ability button
    const abilityBtn = document.getElementById('ability-btn');
    if (abilityBtn) {
      abilityBtn.addEventListener('click', () => {
        if (this._committed) return;
        this._myAbility = !this._myAbility;
        abilityBtn.classList.toggle('active', this._myAbility);
      });
    }

    // Commit button
    const commitBtn = document.getElementById('commit-action-btn');
    if (commitBtn) {
      commitBtn.addEventListener('click', () => this._commitAction(container));
    }

    // Tiebreaker button
    const tbBtn = document.getElementById('go-tiebreaker-btn');
    if (tbBtn) {
      tbBtn.addEventListener('click', () => {
        router.navigate(`arena-tiebreaker?match=${this._match.id}`);
      });
    }
  },

  async _commitAction(container) {
    if (!this._myAction || this._committed) return;
    this._committed = true;

    try {
      await arenaData.submitAction(
        this._match.id,
        this._currentRound.id,
        this._currentTurn.id,
        this._myParticipant.discord_id,
        this._myAction,
        this._myAbility
      );

      if (this._timerInterval) clearInterval(this._timerInterval);
      this._renderContent(container);
    } catch (err) {
      this._committed = false;
      toast.error('Failed: ' + err.message);
    }
  },

  _startActionTimer() {
    if (this._timerInterval) clearInterval(this._timerInterval);
    this._timeLeft = TIMERS.ACTION_PICK;

    this._timerInterval = setInterval(() => {
      this._timeLeft--;
      const timerEl = document.getElementById('action-timer');
      if (timerEl) {
        timerEl.textContent = `${this._timeLeft}s`;
        if (this._timeLeft <= 5) timerEl.classList.add('timer-urgent');
      }

      if (this._timeLeft <= 0) {
        clearInterval(this._timerInterval);
        if (!this._committed) {
          // Auto-random action
          const actions = ['attack', 'defend', 'strong_attack'];
          this._myAction = actions[Math.floor(Math.random() * actions.length)];
          this._myAbility = false;
          const content = document.querySelector('.arena-match');
          if (content) this._commitAction(content);
          toast.info('Time\'s up! Random action submitted.');
        }
      }
    }, 1000);
  },

  _onRoundUpdate(payload) {
    const updatedRound = payload.new;
    if (!updatedRound || updatedRound.id !== this._currentRound?.id) return;

    this._currentRound = updatedRound;

    // If both characters are now set but no turn exists yet, check for new turn
    if (updatedRound.player1_character && updatedRound.player2_character && !this._currentTurn) {
      arenaData.getTurns(updatedRound.id).then(turns => {
        const unresolved = turns.find(t => !t.resolved);
        if (unresolved) {
          this._currentTurn = unresolved;
          this._combat.subscribeToTurns(updatedRound.id);
          const content = document.querySelector('.arena-match');
          if (content) this._renderContent(content);
        }
      });
    } else {
      // Re-render to update character display / HP
      const content = document.querySelector('.arena-match');
      if (content) this._renderContent(content);
    }
  },

  _onCombatEvent(event, data) {
    if (event === 'turn_resolved') {
      // Turn resolved — update HP, refresh UI
      this._committed = false;
      this._myAction = null;
      this._myAbility = false;

      // Reload round data for updated HP
      arenaData.getRounds(this._match.id).then(rounds => {
        this._currentRound = rounds[rounds.length - 1] || null;

        // Check for new unresolved turn
        if (this._currentRound) {
          arenaData.getTurns(this._currentRound.id).then(turns => {
            this._currentTurn = turns.find(t => !t.resolved) || null;
            const content = document.querySelector('.arena-match');
            if (content) this._renderContent(content);
          });
        }
      });
    } else if (event === 'turn_update') {
      // Partial update (e.g., opponent committed)
      this._currentTurn = data;
    }
  },

  _onMatchUpdate(payload) {
    const newMatch = payload.new;
    if (!newMatch) return;

    const oldStatus = this._match.status;
    this._match = newMatch;

    if (newMatch.status === 'complete') {
      if (this._timerInterval) clearInterval(this._timerInterval);
      const winnerName = newMatch.winner_id ? this._getParticipantName(newMatch.winner_id) : null;
      toast.success(winnerName ? `Match over! ${winnerName} wins!` : 'Match ended in a draw!');
      const content = document.querySelector('.arena-match');
      if (content) this._renderContent(content);
    } else if (newMatch.status === 'tiebreaker') {
      toast.info('Match tied 1-1! Enhancement race tiebreaker!');
      const content = document.querySelector('.arena-match');
      if (content) this._renderContent(content);
    } else if (oldStatus !== newMatch.status) {
      // Status changed — reload rounds
      arenaData.getRounds(this._match.id).then(rounds => {
        const newRound = rounds[rounds.length - 1];
        if (newRound && newRound.id !== this._currentRound?.id) {
          this._currentRound = newRound;
          this._combat.loadTurnHistory(newRound.id);
          this._combat.subscribeToTurns(newRound.id);
          this._committed = false;
          this._myAction = null;
          this._myAbility = false;

          arenaData.getTurns(newRound.id).then(turns => {
            this._currentTurn = turns.find(t => !t.resolved) || null;
            const content = document.querySelector('.arena-match');
            if (content) this._renderContent(content);
          });
        }
      });
    }
  },

  destroy() {
    if (this._matchSubscription) {
      arenaData.unsubscribe(this._matchSubscription);
      this._matchSubscription = null;
    }
    if (this._roundSubscription) {
      arenaData.unsubscribe(this._roundSubscription);
      this._roundSubscription = null;
    }
    if (this._combat) {
      this._combat.destroy();
      this._combat = null;
    }
    if (this._presenceChannel) {
      arenaData.leavePresence(this._presenceChannel);
      this._presenceChannel = null;
    }
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    ArenaShell.deactivate();
  }
};

import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { ArenaCombat } from './arena-combat.js';
import { BASE_HP, MAX_HP, REACTIONS, REACTION_COOLDOWN_MS, getAbilityForClass } from './arena-constants.js';

/**
 * Arena Spectate — Watch a match in progress. Same layout as match but no action buttons.
 * Shows "Choosing..." until both committed. 5 emoji reaction buttons.
 * Route: /arena-spectate?match=<id>
 */
export const ArenaSpectatePage = {
  _match: null,
  _matchSubscription: null,
  _combat: null,
  _presenceChannel: null,
  _spectatorCount: 0,
  _participants: null,
  _appUsers: null,
  _currentRound: null,
  _currentTurn: null,
  _reactionSubscription: null,
  _lastReactionTime: 0,

  async render(container) {
    container.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'arena-spectate';
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
      console.error('Spectate error:', err);
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

    // Load round data
    const rounds = await arenaData.getRounds(matchId);
    this._currentRound = rounds[rounds.length - 1] || null;

    // Combat display
    this._combat = new ArenaCombat(matchId, (event, data) => this._onCombatEvent(event, data));

    if (this._currentRound) {
      await this._combat.loadTurnHistory(this._currentRound.id);
      this._combat.subscribeToTurns(this._currentRound.id);

      const turns = await arenaData.getTurns(this._currentRound.id);
      this._currentTurn = turns.find(t => !t.resolved) || null;
    }

    // Subscribe to match changes
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToMatch(matchId, (payload) => {
      this._onMatchUpdate(payload);
    });

    // Subscribe to reactions
    if (this._reactionSubscription) arenaData.unsubscribe(this._reactionSubscription);
    this._reactionSubscription = arenaData.subscribeToReactions(matchId, (payload) => {
      this._onReaction(payload);
    });

    // Join presence
    const currentUser = dataService.getUser();
    if (currentUser) {
      this._presenceChannel = arenaData.joinMatchPresence(matchId, currentUser, (users) => {
        this._spectatorCount = users.length;
        const countEl = document.getElementById('spectator-count');
        if (countEl) countEl.textContent = `${this._spectatorCount + 1} watching`;
      });
    }
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
    const bothCommitted = this._currentTurn?.player1_committed && this._currentTurn?.player2_committed;
    const waitingMsg = this._currentTurn && !this._currentTurn.resolved && !bothCommitted;

    container.innerHTML = `
      <div class="match-scoreboard">
        <div class="match-score-display">
          <span class="score-player">${p1Name}</span>
          <span class="score-rounds">${m.player1_rounds_won} - ${m.player2_rounds_won}</span>
          <span class="score-player">${p2Name}</span>
        </div>
        ${round ? `<div class="match-round-label">Round ${round.round_number}</div>` : ''}
        <div class="match-spectators" id="spectator-count">${this._spectatorCount + 1} watching</div>
        <div class="spectate-badge">SPECTATING</div>
      </div>

      <div class="match-arena match-arena-1v1">
        <div class="match-fighter match-fighter-left">
          <div class="fighter-portrait">
            <div class="fighter-portrait-inner">
              ${p1Char ? `<span class="fighter-class-icon">${p1Ability?.icon || ''}</span>` : ''}
            </div>
          </div>
          <div class="fighter-name">${p1Char?.playerName || p1Name}</div>
          ${p1Char ? `<div class="fighter-class">${p1Char.className}</div>` : ''}
          <div class="hp-bar-container">
            <div class="hp-bar" style="width: ${p1HpPct}%"></div>
            <span class="hp-text">${p1Hp} / ${MAX_HP}</span>
          </div>
        </div>

        <div class="match-center">
          ${isComplete ? `
            <div class="match-result-banner">
              <div class="result-label">${m.winner_id ? 'Winner' : 'Draw'}</div>
              ${m.winner_id ? `<div class="result-winner">${this._getParticipantName(m.winner_id)}</div>` : ''}
            </div>
          ` : waitingMsg ? `
            <div class="spectate-choosing">Choosing...</div>
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
            <div class="hp-bar" style="width: ${p2HpPct}%"></div>
            <span class="hp-text">${p2Hp} / ${MAX_HP}</span>
          </div>
        </div>
      </div>

      <div class="spectate-reactions" id="reaction-bar">
        <div class="reaction-buttons">
          ${REACTIONS.map(emoji => `
            <button class="reaction-btn" data-emoji="${emoji}">${emoji}</button>
          `).join('')}
        </div>
        <div class="reaction-bubbles" id="reaction-bubbles"></div>
      </div>

      <div class="match-history arena-panel">
        <div class="arena-panel-header">
          <h3>Turn History</h3>
        </div>
        <div class="history-content">
          ${this._combat ? this._combat.buildHistoryHtml(p1Name, p2Name) : '<p class="history-empty">No turns yet</p>'}
        </div>
      </div>
    `;

    this._attachListeners(container);
  },

  _attachListeners(container) {
    container.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const now = Date.now();
        if (now - this._lastReactionTime < REACTION_COOLDOWN_MS) {
          return; // Rate limited
        }

        const currentUser = dataService.getUser();
        if (!currentUser) {
          toast.error('Login to react');
          return;
        }

        this._lastReactionTime = now;
        btn.blur();
        const emoji = btn.dataset.emoji;

        try {
          await arenaData.submitReaction(this._match.id, currentUser.id, emoji);
          this._showReactionBubble(emoji);
        } catch (err) {
          // Silently fail for rate limits
        }
      });
    });
  },

  _onReaction(payload) {
    const reaction = payload.new;
    if (reaction) {
      this._showReactionBubble(reaction.emoji);
    }
  },

  _showReactionBubble(emoji) {
    const container = document.getElementById('reaction-bubbles');
    if (!container) return;

    const bubble = document.createElement('div');
    bubble.className = 'reaction-bubble';
    bubble.textContent = emoji;
    bubble.style.left = `${20 + Math.random() * 60}%`;
    container.appendChild(bubble);

    setTimeout(() => bubble.remove(), 2000);
  },

  _onCombatEvent(event, data) {
    if (event === 'turn_resolved') {
      arenaData.getRounds(this._match.id).then(rounds => {
        this._currentRound = rounds[rounds.length - 1] || null;
        if (this._currentRound) {
          arenaData.getTurns(this._currentRound.id).then(turns => {
            this._currentTurn = turns.find(t => !t.resolved) || null;
            const content = document.querySelector('.arena-spectate');
            if (content) this._renderContent(content);
          });
        }
      });
    }
  },

  _onMatchUpdate(payload) {
    const newMatch = payload.new;
    if (!newMatch) return;
    this._match = newMatch;

    if (newMatch.status === 'complete') {
      const winnerName = newMatch.winner_id ? this._getParticipantName(newMatch.winner_id) : null;
      toast.success(winnerName ? `${winnerName} wins!` : 'Match over!');
    }

    // Reload rounds for new round transitions
    arenaData.getRounds(this._match.id).then(rounds => {
      const newRound = rounds[rounds.length - 1];
      if (newRound && newRound.id !== this._currentRound?.id) {
        this._currentRound = newRound;
        this._combat.loadTurnHistory(newRound.id);
        this._combat.subscribeToTurns(newRound.id);
      }

      if (this._currentRound) {
        arenaData.getTurns(this._currentRound.id).then(turns => {
          this._currentTurn = turns.find(t => !t.resolved) || null;
          const content = document.querySelector('.arena-spectate');
          if (content) this._renderContent(content);
        });
      }
    });
  },

  destroy() {
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    if (this._reactionSubscription) arenaData.unsubscribe(this._reactionSubscription);
    if (this._combat) this._combat.destroy();
    if (this._presenceChannel) arenaData.leavePresence(this._presenceChannel);
    // cleanup done
  }
};

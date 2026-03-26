import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { ArenaCombat } from './arena-combat.js';
import { BASE_HP, MAX_HP, REACTIONS, REACTION_COOLDOWN_MS, BET_INCREMENTS, BETTING_WINDOW_SECONDS, MAX_BET_PERCENTAGE, getAbilityForClass, getRemainingSeconds } from './arena-constants.js';

/**
 * Arena Spectate — Watch a match in progress. Same layout as match but no action buttons.
 * Shows "Choosing..." until both committed. 5 emoji reaction buttons.
 * Betting panel for tournament participants not in the match.
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
  // Betting state
  _bets: [],
  _myParticipant: null,
  _betSubscription: null,
  _goldSubscription: null,
  _bettingTimer: null,
  _bettingTimeLeft: 0,

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

    const [participants, appUsers, bets] = await Promise.all([
      arenaData.getParticipants(this._match.tournament_id),
      arenaData.getAllAppUsers(),
      arenaData.getBetsForMatch(matchId).catch(() => [])
    ]);

    this._participants = participants;
    this._appUsers = appUsers;
    this._bets = bets;

    // Find current user's participant record
    const currentUser = dataService.getUser();
    this._myParticipant = currentUser
      ? participants.find(p => p.discord_id === currentUser.id) || null
      : null;

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

    // Subscribe to bets for live odds
    if (this._betSubscription) arenaData.unsubscribe(this._betSubscription);
    this._betSubscription = arenaData.subscribeToBets(matchId, async () => {
      try {
        this._bets = await arenaData.getBetsForMatch(matchId);
        this._updateBettingUI();
      } catch (e) { console.error('Bet refresh error:', e); }
    });

    // Subscribe to participant gold changes
    if (this._goldSubscription) arenaData.unsubscribe(this._goldSubscription);
    this._goldSubscription = arenaData.subscribeToParticipantGold(this._match.tournament_id, async () => {
      try {
        this._participants = await arenaData.getParticipants(this._match.tournament_id);
        const currentUser = dataService.getUser();
        this._myParticipant = currentUser
          ? this._participants.find(p => p.discord_id === currentUser.id) || null
          : null;
        this._updateBettingUI();
      } catch (e) { console.error('Gold refresh error:', e); }
    });

    // Join presence
    if (currentUser) {
      this._presenceChannel = arenaData.joinMatchPresence(matchId, currentUser, (users) => {
        this._spectatorCount = users.length;
        const countEl = document.getElementById('spectator-count');
        if (countEl) countEl.textContent = `${this._spectatorCount + 1} watching`;
      });
    }

    // Start betting countdown
    this._startBettingTimer();
  },

  _startBettingTimer() {
    if (this._bettingTimer) clearInterval(this._bettingTimer);

    const m = this._match;
    if (!m.betting_closes_at || m.status === 'complete') {
      this._bettingTimeLeft = 0;
      return;
    }

    this._bettingTimeLeft = getRemainingSeconds(m.betting_closes_at, 0);
    if (this._bettingTimeLeft <= 0) {
      this._bettingTimeLeft = 0;
      return;
    }

    this._bettingTimer = setInterval(() => {
      this._bettingTimeLeft--;
      if (this._bettingTimeLeft <= 0) {
        this._bettingTimeLeft = 0;
        clearInterval(this._bettingTimer);
        this._bettingTimer = null;
      }
      // Update timer display
      const timerEl = document.getElementById('betting-timer');
      if (timerEl) {
        if (this._bettingTimeLeft > 0) {
          timerEl.textContent = `Betting closes in ${this._bettingTimeLeft}s`;
          timerEl.classList.toggle('betting-urgent', this._bettingTimeLeft <= 15);
        } else {
          timerEl.textContent = 'Betting closed';
          timerEl.classList.remove('betting-urgent');
        }
      }
      // Disable buttons when closed
      if (this._bettingTimeLeft <= 0) {
        document.querySelectorAll('.bet-btn').forEach(b => b.disabled = true);
      }
    }, 1000);
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
      <a href="#" class="arena-back-link" data-route="arena">&larr; Back to Arena</a>
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
            <button class="reaction-btn" data-emoji="${emoji}">${emoji}<span class="cooldown-overlay"></span></button>
          `).join('')}
        </div>
        <div class="reaction-bubbles" id="reaction-bubbles"></div>
      </div>

      ${this._renderBettingPanel()}

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

  _renderBettingPanel() {
    const m = this._match;
    const myP = this._myParticipant;

    // Can't bet on own match
    const isInMatch = myP && (myP.id === m.player1_id || myP.id === m.player2_id);
    if (isInMatch) return '';

    // Match already complete — show results if participant
    if (m.status === 'complete') {
      return myP ? this._renderBetResults() : '';
    }

    // Show during pending, drafting, or when betting window exists
    const isPreMatch = m.status === 'pending' || m.status === 'drafting' || m.status === 'roster_reveal';
    if (!isPreMatch && !m.betting_closes_at) return '';

    const canBet = !!myP && !isInMatch;
    // Betting open during pre-match (no timer) or while timer > 0
    const bettingOpen = isPreMatch || this._bettingTimeLeft > 0;
    const increments = BET_INCREMENTS[m.phase] || BET_INCREMENTS.group_stage;

    // Calculate totals per side
    const activeBets = this._bets.filter(b => b.status === 'active');
    const p1Bets = activeBets.filter(b => b.backed_participant_id === m.player1_id);
    const p2Bets = activeBets.filter(b => b.backed_participant_id === m.player2_id);
    const p1Total = p1Bets.reduce((s, b) => s + b.amount, 0);
    const p2Total = p2Bets.reduce((s, b) => s + b.amount, 0);

    // My bets on each side
    const myP1Bets = myP ? p1Bets.filter(b => b.bettor_id === myP.id) : [];
    const myP2Bets = myP ? p2Bets.filter(b => b.bettor_id === myP.id) : [];
    const myP1Total = myP1Bets.reduce((s, b) => s + b.amount, 0);
    const myP2Total = myP2Bets.reduce((s, b) => s + b.amount, 0);

    // Lock to one side — if you've bet on P1, can't bet on P2
    const lockedToP1 = myP1Total > 0;
    const lockedToP2 = myP2Total > 0;

    // Potential winnings
    const p1Potential = myP1Total > 0 && p1Total > 0
      ? Math.floor(myP1Total + p2Total * (myP1Total / p1Total)) - myP1Total
      : 0;
    const p2Potential = myP2Total > 0 && p2Total > 0
      ? Math.floor(myP2Total + p1Total * (myP2Total / p2Total)) - myP2Total
      : 0;

    const maxBet = Math.floor((myP?.gold || 0) * MAX_BET_PERCENTAGE);
    const totalMyActiveBets = myP ? activeBets.filter(b => b.bettor_id === myP.id).reduce((s, b) => s + b.amount, 0) : 0;
    const remainingBetBudget = maxBet - totalMyActiveBets;

    const p1Name = this._getParticipantName(m.player1_id);
    const p2Name = this._getParticipantName(m.player2_id);

    const timerHtml = isPreMatch && !m.betting_closes_at
      ? 'Open during draft'
      : (this._bettingTimeLeft > 0 ? `Betting closes in ${this._bettingTimeLeft}s` : 'Betting closed');

    return `
      <div class="betting-panel" id="betting-panel">
        <div class="betting-header">
          <h4>${canBet ? 'Place Your Bet' : 'Betting Odds'}</h4>
          ${canBet ? `<span class="betting-gold">Your Gold: <strong>${(myP?.gold || 0).toLocaleString()}G</strong></span>` : ''}
          <span class="betting-timer ${this._bettingTimeLeft <= 15 && this._bettingTimeLeft > 0 ? 'betting-urgent' : ''}" id="betting-timer">
            ${timerHtml}
          </span>
        </div>
        ${!canBet ? '<p style="color: rgba(255,255,255,0.4); font-size: 0.85rem; margin: 0 0 0.5rem;">Only tournament participants can place bets</p>' : ''}
        <div class="betting-sides">
          <div class="betting-side ${myP1Total > 0 ? 'betting-side-active' : ''} ${lockedToP2 ? 'betting-side-locked' : ''}">
            <span class="betting-player-name">${p1Name}</span>
            <span class="betting-total">${p1Total.toLocaleString()}G wagered</span>
            ${myP1Total > 0 ? `<span class="betting-potential">Win: +${p1Potential.toLocaleString()}G</span>` : ''}
            ${canBet && !lockedToP2 ? `<div class="betting-buttons">
              ${increments.map(inc => `
                <button class="bet-btn" data-backed="${m.player1_id}" data-amount="${inc}" ${!bettingOpen || inc > remainingBetBudget ? 'disabled' : ''}>+${inc}</button>
              `).join('')}
            </div>` : ''}
            ${myP1Total > 0 ? `<span class="betting-my-bet">Your bet: ${myP1Total.toLocaleString()}G</span>` : ''}
          </div>
          <div class="betting-side ${myP2Total > 0 ? 'betting-side-active' : ''} ${lockedToP1 ? 'betting-side-locked' : ''}">
            <span class="betting-player-name">${p2Name}</span>
            <span class="betting-total">${p2Total.toLocaleString()}G wagered</span>
            ${myP2Total > 0 ? `<span class="betting-potential">Win: +${p2Potential.toLocaleString()}G</span>` : ''}
            ${canBet && !lockedToP1 ? `<div class="betting-buttons">
              ${increments.map(inc => `
                <button class="bet-btn" data-backed="${m.player2_id}" data-amount="${inc}" ${!bettingOpen || inc > remainingBetBudget ? 'disabled' : ''}>+${inc}</button>
              `).join('')}
            </div>` : ''}
            ${myP2Total > 0 ? `<span class="betting-my-bet">Your bet: ${myP2Total.toLocaleString()}G</span>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  _renderBetResults() {
    const m = this._match;
    const myP = this._myParticipant;
    if (!myP) return '';

    const myBets = this._bets.filter(b => b.bettor_id === myP.id);
    if (myBets.length === 0) return '';

    const totalWagered = myBets.reduce((s, b) => s + b.amount, 0);
    const totalPayout = myBets.reduce((s, b) => s + b.payout, 0);
    const net = totalPayout - totalWagered;
    const won = net > 0;
    const lost = net < 0;

    return `
      <div class="betting-panel">
        <div class="betting-header">
          <h4>Bet Results</h4>
          <span class="betting-gold" style="color: ${won ? '#4ade80' : lost ? '#ef4444' : 'inherit'}">
            ${won ? `+${net.toLocaleString()}G` : lost ? `${net.toLocaleString()}G` : 'Refunded'}
          </span>
        </div>
      </div>
    `;
  },

  _updateBettingUI() {
    const panel = document.getElementById('betting-panel');
    if (!panel) return;

    // Re-render just the betting panel contents
    const newHtml = this._renderBettingPanel();
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    const newPanel = temp.querySelector('.betting-panel');
    if (newPanel && panel) {
      panel.replaceWith(newPanel);
      this._attachBetListeners();
    }
  },

  _attachListeners(container) {
    // Reaction buttons
    const allBtns = container.querySelectorAll('.reaction-btn');
    allBtns.forEach(btn => {
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

        // Start cooldown animation on all buttons
        this._startCooldown(allBtns);

        try {
          await arenaData.submitReaction(this._match.id, currentUser.id, emoji);
        } catch (err) {
          // Silently fail for rate limits
        }
      });
    });

    // Bet buttons
    this._attachBetListeners();
  },

  _attachBetListeners() {
    document.querySelectorAll('.bet-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const currentUser = dataService.getUser();
        if (!currentUser || !this._myParticipant) return;

        const backed = btn.dataset.backed;
        const amount = parseInt(btn.dataset.amount);

        btn.disabled = true;
        try {
          await arenaData.placeBet(this._match.id, currentUser.id, backed, amount);
          // UI updates via Realtime subscription
        } catch (err) {
          toast.error(err.message || 'Bet failed');
          btn.disabled = false;
        }
      });
    });
  },

  _startCooldown(buttons) {
    buttons.forEach(btn => {
      btn.classList.add('on-cooldown');
      const overlay = btn.querySelector('.cooldown-overlay');
      if (overlay) {
        // Reset to full height instantly
        overlay.style.transition = 'none';
        overlay.style.height = '100%';
        // Force reflow then animate to 0
        void overlay.offsetHeight;
        overlay.style.transition = `height ${REACTION_COOLDOWN_MS}ms linear`;
        overlay.style.height = '0%';
      }
    });

    setTimeout(() => {
      buttons.forEach(btn => btn.classList.remove('on-cooldown'));
    }, REACTION_COOLDOWN_MS);
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
      // Refresh bets to show results
      arenaData.getBetsForMatch(this._match.id).then(bets => {
        this._bets = bets;
      });
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
    if (this._betSubscription) arenaData.unsubscribe(this._betSubscription);
    if (this._goldSubscription) arenaData.unsubscribe(this._goldSubscription);
    if (this._combat) this._combat.destroy();
    if (this._presenceChannel) arenaData.leavePresence(this._presenceChannel);
    if (this._bettingTimer) {
      clearInterval(this._bettingTimer);
      this._bettingTimer = null;
    }
  }
};

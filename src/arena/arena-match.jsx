import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { ArenaCombat } from './arena-combat.js';
import { TIMERS, BASE_HP, MAX_HP, getAbilityForClass, getClassIconPath, MATCH_STATUS, getMatchFormat } from './arena-constants.js';

/**
 * Arena Match — The main combat screen.
 * Side-by-side portraits, HP bars, action buttons, ability button, turn history.
 * Route: /arena-match?match=<id>
 */
export const ArenaMatchPage = {
  _match: null,
  _matchSubscription: null,
  _roundSubscription: null,
  _reactionSubscription: null,
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
  _revealInProgress: false,
  _autoSending: false,

  async render(container) {
    container.innerHTML = '';

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

    // Load all rounds (need history for used-character tracking)
    const rounds = await arenaData.getRounds(matchId);
    this._allRounds = rounds;
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

    // Subscribe to spectator reactions
    if (this._reactionSubscription) arenaData.unsubscribe(this._reactionSubscription);
    this._reactionSubscription = arenaData.subscribeToReactions(matchId, (payload) => {
      if (payload.new?.emoji) this._showReactionBubble(payload.new.emoji);
    });

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
    const fmt = getMatchFormat(m.match_format);
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
    let needsCharacterSend = this._isPlayer && round && !isComplete && !isTiebreaker &&
      !round[`${this._playerSide}_character`];
    const waitingForOpponentChar = this._isPlayer && round && !isComplete && !isTiebreaker &&
      round[`${this._playerSide}_character`] && !this._currentTurn;

    // Auto-send for 1v1 (only 1 character available)
    if (needsCharacterSend && fmt.charsPerDraft === 1) {
      const draft = m[`${this._playerSide}_draft`] || [];
      if (draft.length === 1 && !this._autoSending) {
        this._autoSending = true;
        needsCharacterSend = false; // Don't show select UI
        arenaData.sendCharacter(m.id, round.id, this._myParticipant.discord_id, draft[0]).then(async (result) => {
          const rounds = await arenaData.getRounds(m.id);
          this._allRounds = rounds;
          this._currentRound = rounds[rounds.length - 1] || null;
          if (result.bothReady && this._currentRound) {
            const turns = await arenaData.getTurns(this._currentRound.id);
            this._currentTurn = turns.find(t => !t.resolved) || null;
          }
          this._autoSending = false;
          this._renderContent(container);
        }).catch(() => { this._autoSending = false; });
      }
    }

    // Build bench characters (drafted but not currently fighting)
    const p1Draft = m.player1_draft || [];
    const p2Draft = m.player2_draft || [];
    const p1Bench = p1Draft.filter(c => c.playerName !== p1Char?.playerName);
    const p2Bench = p2Draft.filter(c => c.playerName !== p2Char?.playerName);

    // Build outcome map: playerId → 'won' | 'lost' | 'draw' from previous rounds
    const charOutcomes = {};
    const previousRounds = (this._allRounds || []).filter(r => r.id !== this._currentRound?.id);
    for (const pr of previousRounds) {
      const p1c = pr.player1_character;
      const p2c = pr.player2_character;
      if (!p1c || !p2c) continue;
      if (!pr.winner_id) {
        // Draw round (double KO)
        if (p1c.playerId) charOutcomes[p1c.playerId] = 'draw';
        if (p2c.playerId) charOutcomes[p2c.playerId] = 'draw';
      } else if (pr.winner_id === m.player1_id) {
        if (p1c.playerId) charOutcomes[p1c.playerId] = 'won';
        if (p2c.playerId) charOutcomes[p2c.playerId] = 'lost';
      } else {
        if (p1c.playerId) charOutcomes[p1c.playerId] = 'lost';
        if (p2c.playerId) charOutcomes[p2c.playerId] = 'won';
      }
    }

    container.innerHTML = `
      <div class="match-scoreboard">
        <div class="match-score-display">
          <span class="score-player ${this._playerSide === 'player1' ? 'score-you' : ''}">${p1Name}${this._playerSide === 'player1' ? ' <span class="you-badge">YOU</span>' : ''}</span>
          ${fmt.charsPerDraft > 1 ? `<span class="score-rounds">${m.player1_rounds_won} - ${m.player2_rounds_won}</span>` : '<span class="score-rounds">VS</span>'}
          <span class="score-player ${this._playerSide === 'player2' ? 'score-you' : ''}">${p2Name}${this._playerSide === 'player2' ? ' <span class="you-badge">YOU</span>' : ''}</span>
        </div>
        ${fmt.charsPerDraft > 1 && round ? `<div class="match-round-label">Round ${round.round_number} &middot; ${fmt.label}</div>` : ''}
        ${fmt.charsPerDraft === 1 ? `<div class="match-round-label">${fmt.label}</div>` : ''}
        <div class="match-spectators" id="spectator-count">${this._spectatorCount} watching</div>
      </div>

      ${isComplete ? `
        <div class="match-result-banner">
          <div class="result-label">${m.winner_id ? 'Winner' : 'Draw'}</div>
          ${m.winner_id ? `<div class="result-winner">${this._getParticipantName(m.winner_id)}</div>` : ''}
          <button class="arena-btn arena-btn-primary" id="back-to-hub-btn" style="margin-top: 0.75rem;">Back to Arena</button>
        </div>
      ` : ''}
      ${isTiebreaker ? `
        <div class="match-result-banner">
          <div class="result-label">Tiebreaker!</div>
          <button class="arena-btn arena-btn-primary" id="go-tiebreaker-btn">Enter Enhancement Race</button>
        </div>
      ` : ''}

      <div class="match-arena ${fmt.charsPerDraft === 1 ? 'match-arena-1v1' : ''}">
        ${fmt.charsPerDraft > 1 ? `
          <div class="bench bench-left ${this._playerSide === 'player1' ? 'your-side' : ''}">
            ${p1Bench.map(c => {
              const outcome = charOutcomes[c.playerId] || '';
              const iconPath = getClassIconPath(c.className);
              return `
                <div class="bench-card ${outcome ? 'bench-' + outcome : ''}">
                  ${iconPath ? `<div class="bench-card-icon"><img src="${iconPath}" alt="${c.className}"></div>` : ''}
                  <div class="bench-card-name">${c.playerName}</div>
                  <div class="bench-card-class">${c.className}</div>
                  ${c.isHired ? '<span class="bench-hired">Hired</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        <div class="match-fighter match-fighter-left ${this._playerSide === 'player1' ? 'your-side' : ''}">
          <div class="fighter-portrait">
            <div class="fighter-portrait-inner">
              ${p1Char ? `<img class="fighter-class-icon" src="${getClassIconPath(p1Char.className) || ''}" alt="${p1Char.className}">` : ''}
            </div>
          </div>
          <div class="fighter-name">${p1Char?.playerName || p1Name}</div>
          ${p1Char ? `<div class="fighter-class">${p1Char.className}</div>` : ''}
          <div class="hp-bar-container">
            <div class="hp-bar" style="width: ${p1HpPct}%" data-hp="${p1Hp}"></div>
            <span class="hp-text">${p1Hp} / ${MAX_HP}</span>
          </div>
          ${p1Ability ? `
            <div class="fighter-ability-ready ${round?.player1_ability_used ? 'ability-used' : ''}">${p1Ability.icon} ${p1Ability.name}</div>
          ` : ''}
          ${round?.player1_status?.highlander ? '<div class="fighter-status-effect">Highlander Active</div>' : ''}
          ${round?.player1_status?.chargedMissile ? '<div class="fighter-status-effect">Charged! (x2 next)</div>' : ''}
        </div>

        <div class="match-center">
          <div class="match-vs-badge">VS</div>
        </div>

        <div class="match-fighter match-fighter-right ${this._playerSide === 'player2' ? 'your-side' : ''}">
          <div class="fighter-portrait">
            <div class="fighter-portrait-inner">
              ${p2Char ? `<img class="fighter-class-icon" src="${getClassIconPath(p2Char.className) || ''}" alt="${p2Char.className}">` : ''}
            </div>
          </div>
          <div class="fighter-name">${p2Char?.playerName || p2Name}</div>
          ${p2Char ? `<div class="fighter-class">${p2Char.className}</div>` : ''}
          <div class="hp-bar-container">
            <div class="hp-bar" style="width: ${p2HpPct}%" data-hp="${p2Hp}"></div>
            <span class="hp-text">${p2Hp} / ${MAX_HP}</span>
          </div>
          ${p2Ability ? `
            <div class="fighter-ability-ready ${round?.player2_ability_used ? 'ability-used' : ''}">${p2Ability.icon} ${p2Ability.name}</div>
          ` : ''}
          ${round?.player2_status?.highlander ? '<div class="fighter-status-effect">Highlander Active</div>' : ''}
          ${round?.player2_status?.chargedMissile ? '<div class="fighter-status-effect">Charged! (x2 next)</div>' : ''}
        </div>

        ${fmt.charsPerDraft > 1 ? `
          <div class="bench bench-right ${this._playerSide === 'player2' ? 'your-side' : ''}">
            ${p2Bench.map(c => {
              const outcome = charOutcomes[c.playerId] || '';
              const iconPath = getClassIconPath(c.className);
              return `
                <div class="bench-card ${outcome ? 'bench-' + outcome : ''}">
                  ${iconPath ? `<div class="bench-card-icon"><img src="${iconPath}" alt="${c.className}"></div>` : ''}
                  <div class="bench-card-name">${c.playerName}</div>
                  <div class="bench-card-class">${c.className}</div>
                  ${c.isHired ? '<span class="bench-hired">Hired</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>

      <div class="reaction-bubbles-overlay" id="reaction-bubbles"></div>

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
            ${this._getMyAbility() ? `
              <button class="arena-btn action-btn-ability ${this._myAbility ? 'active' : ''} ${!this._canUseAbility() ? 'used' : ''}" id="ability-btn" ${!this._canUseAbility() ? 'disabled' : ''}>
                ${this._getMyAbility().icon} ${this._getMyAbility().name}
                <span class="ability-desc">${!this._canUseAbility() ? 'Already used' : this._getMyAbility().description}</span>
              </button>
            ` : ''}
            <div class="action-triangle">
              <div class="action-triangle-top">
                <button class="arena-btn action-btn ${this._myAction === 'defend' ? 'selected' : ''}" data-action="defend">
                  Defend<br><span class="action-damage">8 counter</span>
                </button>
              </div>
              <div class="action-triangle-arrows">
                <span class="triangle-arrow arrow-left" title="Strong Attack beats Defend">↑ <span class="beats-label">beats</span></span>
                <span class="triangle-arrow arrow-right" title="Defend beats Attack"><span class="beats-label">beats</span> ↓</span>
              </div>
              <div class="action-triangle-bottom">
                <button class="arena-btn action-btn ${this._myAction === 'strong_attack' ? 'selected' : ''}" data-action="strong_attack">
                  Strong Atk<br><span class="action-damage">16 dmg</span>
                </button>
                <span class="triangle-arrow arrow-bottom">← <span class="beats-label">beats</span></span>
                <button class="arena-btn action-btn ${this._myAction === 'attack' ? 'selected' : ''}" data-action="attack">
                  Attack<br><span class="action-damage">12 dmg</span>
                </button>
              </div>
            </div>
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

  /**
   * Play the turn reveal animation sequence.
   * Steps through resolution events with timed delays, then calls callback.
   */
  _playRevealSequence(turnData, callback) {
    if (this._revealInProgress) {
      // Another reveal is already playing — don't call callback,
      // the running reveal's callback will handle the post-reveal refresh.
      return;
    }
    this._revealInProgress = true;

    const events = turnData.resolution_log?.events || [];
    const p1Fighter = document.querySelector('.match-fighter-left');
    const p2Fighter = document.querySelector('.match-fighter-right');
    const vsCenter = document.querySelector('.match-center');

    if (!p1Fighter || !p2Fighter) {
      this._revealInProgress = false;
      if (callback) callback();
      return;
    }

    const p1Name = this._currentRound?.player1_character?.playerName;
    const p2Name = this._currentRound?.player2_character?.playerName;

    // Helper: which fighter element does a player name map to?
    const getFighterEl = (name) => {
      if (name === p1Name) return p1Fighter;
      if (name === p2Name) return p2Fighter;
      return null;
    };
    const getSide = (name) => name === p1Name ? 'left' : 'right';

    // Helper: show floating number over a fighter
    const showFloating = (fighterEl, text, cssClass) => {
      const el = document.createElement('div');
      el.className = `reveal-damage ${cssClass}`;
      el.textContent = text;
      fighterEl.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    };

    // Helper: show action label over a fighter
    const showActionLabel = (fighterEl, action) => {
      const labels = { attack: 'Attack', defend: 'Defend', strong_attack: 'Strong Attack' };
      const classes = { attack: 'action-attack', defend: 'action-defend', strong_attack: 'action-strong' };
      const el = document.createElement('div');
      el.className = `reveal-action-label ${classes[action] || ''}`;
      el.textContent = labels[action] || action;
      fighterEl.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    };

    // Helper: add and auto-remove a CSS class
    const flashClass = (el, cls, duration = 800) => {
      if (!el) return;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), duration);
    };

    // Build a timeline of effects from events
    let delay = 0;
    const schedule = (fn, extraDelay) => {
      delay += extraDelay;
      setTimeout(fn, delay);
    };

    // Step 1: Show action labels (action_reveal events)
    const actionReveals = events.filter(e => e.type === 'action_reveal');
    if (actionReveals.length >= 2) {
      schedule(() => {
        showActionLabel(p1Fighter, actionReveals[0].action);
        showActionLabel(p2Fighter, actionReveals[1].action);
      }, 200);
    }

    // Step 2: Process combat result events
    for (const event of events) {
      if (event.type === 'action_reveal') continue; // already handled

      switch (event.type) {
        case 'rps_win':
          schedule(() => {
            const winnerEl = getFighterEl(event.winner);
            const loserEl = getFighterEl(event.loser);
            flashClass(winnerEl, 'fighter-flash-green', 600);
            flashClass(loserEl, 'fighter-flash-red', 600);
          }, 600);
          break;

        case 'clash':
          schedule(() => {
            if (vsCenter) flashClass(vsCenter, 'vs-clash', 700);
          }, 600);
          break;

        case 'damage_received':
          schedule(() => {
            const el = getFighterEl(event.player);
            if (el) {
              flashClass(el, 'fighter-hit', 500);
              showFloating(el, `-${event.amount}`, 'damage-number');
            }
          }, 500);
          break;

        case 'heal':
          schedule(() => {
            const el = getFighterEl(event.player);
            if (el) {
              flashClass(el, 'fighter-heal', 800);
              showFloating(el, `+${event.amount}`, 'heal-number');
            }
          }, 500);
          break;

        case 'ability_activate':
          schedule(() => {
            const el = getFighterEl(event.player);
            if (el) {
              showFloating(el, event.abilityName, 'clash-number');
            }
          }, 400);
          break;

        case 'highlander_trigger':
          schedule(() => {
            const el = getFighterEl(event.player);
            if (el) {
              flashClass(el, 'fighter-highlander', 900);
              showFloating(el, '1 HP!', 'heal-number');
            }
          }, 500);
          break;

        case 'food_dispenser_result':
          // Shown via ability_activate, skip separate animation
          break;

        case 'ko':
          schedule(() => {
            const el = getFighterEl(event.player);
            if (el) {
              flashClass(el, 'fighter-ko', 1200);
            }
          }, 600);
          break;
      }
    }

    // Step 3: After all animations, update HP bars smoothly then callback
    schedule(() => {
      // Animate HP bars to final values
      const p1HpAfter = turnData.player1_hp_after;
      const p2HpAfter = turnData.player2_hp_after;
      if (p1HpAfter != null) {
        const bar = p1Fighter.querySelector('.hp-bar');
        const text = p1Fighter.querySelector('.hp-text');
        if (bar) bar.style.width = `${Math.max(0, (p1HpAfter / MAX_HP) * 100)}%`;
        if (text) text.textContent = `${Math.max(0, p1HpAfter)} / ${MAX_HP}`;
      }
      if (p2HpAfter != null) {
        const bar = p2Fighter.querySelector('.hp-bar');
        const text = p2Fighter.querySelector('.hp-text');
        if (bar) bar.style.width = `${Math.max(0, (p2HpAfter / MAX_HP) * 100)}%`;
        if (text) text.textContent = `${Math.max(0, p2HpAfter)} / ${MAX_HP}`;
      }
    }, 400);

    // Step 4: Finish — re-render with fresh data
    schedule(() => {
      this._revealInProgress = false;
      if (callback) callback();
    }, 800);
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

    // Characters already used in previous rounds can't be picked again
    const previousRounds = (this._allRounds || []).filter(r => r.id !== this._currentRound?.id);
    const usedPlayerIds = previousRounds
      .map(r => r[`${this._playerSide}_character`]?.playerId)
      .filter(Boolean);

    return `
      <div class="match-action-panel" id="char-select-panel">
        <h3 class="char-select-title">Send a Character for Round ${this._currentRound?.round_number || '?'}</h3>
        <div class="char-select-grid">
          ${draft.map((c, i) => {
            const ability = getAbilityForClass(c.className);
            const alreadyUsed = usedPlayerIds.includes(c.playerId);
            return `
              <button class="arena-btn char-select-card ${alreadyUsed ? 'used' : ''}" data-char-index="${i}" ${alreadyUsed ? 'disabled' : ''}>
                <span class="char-select-name">${c.playerName}</span>
                <span class="char-select-class">${c.className}</span>
                ${ability ? `<span class="char-select-ability">${ability.icon} ${ability.name}</span>` : ''}
                ${c.isHired ? '<span class="char-select-hired">Hired</span>' : ''}
                ${alreadyUsed ? '<span class="char-select-used">Already fought</span>' : ''}
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
          this._allRounds = rounds;
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

    // Back to hub button
    const hubBtn = document.getElementById('back-to-hub-btn');
    if (hubBtn) {
      hubBtn.addEventListener('click', () => {
        router.navigate('arena');
      });
    }
  },

  async _commitAction(container) {
    if (!this._myAction || this._committed) return;
    this._committed = true;

    try {
      const result = await arenaData.submitAction(
        this._match.id,
        this._currentRound.id,
        this._currentTurn.id,
        this._myParticipant.discord_id,
        this._myAction,
        this._myAbility
      );

      if (this._timerInterval) clearInterval(this._timerInterval);

      if (result.resolved) {
        // Turn was resolved immediately (we were the second to commit).
        // Build a turn-like object from the response for the reveal sequence.
        const revealTurn = {
          player1_hp_after: result.p1Hp,
          player2_hp_after: result.p2Hp,
          resolution_log: { events: result.events || [] }
        };

        // Play reveal animation, then fetch fresh state
        this._playRevealSequence(revealTurn, async () => {
          this._committed = false;
          this._myAction = null;
          this._myAbility = false;

          const rounds = await arenaData.getRounds(this._match.id);
          this._allRounds = rounds;
          this._currentRound = rounds[rounds.length - 1] || null;

          if (this._currentRound) {
            this._combat.subscribeToTurns(this._currentRound.id);

            const turns = await arenaData.getTurns(this._currentRound.id);
            this._currentTurn = turns.find(t => !t.resolved) || null;

            if (!this._currentTurn) {
              await new Promise(r => setTimeout(r, 600));
              const retryTurns = await arenaData.getTurns(this._currentRound.id);
              this._currentTurn = retryTurns.find(t => !t.resolved) || null;
            }
          }

          this._match = await arenaData.getMatch(this._match.id);
          this._renderContent(container);
        });
      } else {
        // Waiting for opponent — just re-render with "Waiting..."
        this._renderContent(container);
      }
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

    // Don't re-render during reveal animation
    if (this._revealInProgress) return;

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
      // Turn resolved — play reveal animation, then refresh
      const turnData = data; // the resolved turn from Realtime

      this._playRevealSequence(turnData, () => {
        this._committed = false;
        this._myAction = null;
        this._myAbility = false;

        arenaData.getRounds(this._match.id).then(rounds => {
          this._allRounds = rounds;
          this._currentRound = rounds[rounds.length - 1] || null;

          if (this._currentRound) {
            arenaData.getTurns(this._currentRound.id).then(turns => {
              this._currentTurn = turns.find(t => !t.resolved) || null;
              const content = document.querySelector('.arena-match');
              if (content) this._renderContent(content);

              if (!this._currentTurn) {
                setTimeout(() => {
                  arenaData.getTurns(this._currentRound.id).then(retryTurns => {
                    const newTurn = retryTurns.find(t => !t.resolved);
                    if (newTurn && !this._currentTurn) {
                      this._currentTurn = newTurn;
                      const c = document.querySelector('.arena-match');
                      if (c) this._renderContent(c);
                    }
                  });
                }, 500);
              }
            });
          }
        });
      });
    } else if (event === 'turn_update') {
      // New turn inserted or opponent committed
      if (this._revealInProgress) {
        // Store for after reveal finishes
        this._currentTurn = data;
        return;
      }
      if (data && !data.resolved && !this._currentTurn) {
        // New unresolved turn arrived — we were waiting for it
        this._currentTurn = data;
        this._committed = false;
        this._myAction = null;
        this._myAbility = false;
        const content = document.querySelector('.arena-match');
        if (content) this._renderContent(content);
      } else {
        this._currentTurn = data;
      }
    }
  },

  _onMatchUpdate(payload) {
    const newMatch = payload.new;
    if (!newMatch) return;

    const oldStatus = this._match.status;
    const oldP1Rounds = this._match.player1_rounds_won;
    const oldP2Rounds = this._match.player2_rounds_won;
    this._match = newMatch;

    // Don't re-render during reveal animation (data is still updated above)
    if (this._revealInProgress) return;

    const roundScoreChanged = newMatch.player1_rounds_won !== oldP1Rounds ||
      newMatch.player2_rounds_won !== oldP2Rounds;

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
    } else if (oldStatus !== newMatch.status || roundScoreChanged) {
      // Status changed or round score changed (KO → new round) — reload rounds
      arenaData.getRounds(this._match.id).then(rounds => {
        this._allRounds = rounds;
        const newRound = rounds[rounds.length - 1];
        if (newRound && newRound.id !== this._currentRound?.id) {
          this._currentRound = newRound;
          this._currentTurn = null;
          this._combat.loadTurnHistory(newRound.id);
          this._combat.subscribeToTurns(newRound.id);
          this._committed = false;
          this._myAction = null;
          this._myAbility = false;

          // Subscribe to round changes for the new round
          if (this._roundSubscription) arenaData.unsubscribe(this._roundSubscription);
          this._roundSubscription = arenaData.subscribeToRounds(this._match.id, (p) => {
            this._onRoundUpdate(p);
          });

          arenaData.getTurns(newRound.id).then(turns => {
            this._currentTurn = turns.find(t => !t.resolved) || null;
            const content = document.querySelector('.arena-match');
            if (content) this._renderContent(content);
          });
        }
      });
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

  destroy() {
    if (this._matchSubscription) {
      arenaData.unsubscribe(this._matchSubscription);
      this._matchSubscription = null;
    }
    if (this._roundSubscription) {
      arenaData.unsubscribe(this._roundSubscription);
      this._roundSubscription = null;
    }
    if (this._reactionSubscription) {
      arenaData.unsubscribe(this._reactionSubscription);
      this._reactionSubscription = null;
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
    // cleanup done
  }
};

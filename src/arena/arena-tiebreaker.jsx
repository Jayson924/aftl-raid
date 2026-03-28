import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { TIEBREAKER_START_LEVEL, TIEBREAKER_TARGET_LEVEL, TIEBREAKER_RATES } from './arena-constants.js';

/**
 * Arena Tiebreaker — Auto Enhancement Race.
 * Both players auto-enhance from +9 to +13. Fewest taps wins.
 * Either player triggers the roll — server simulates both runs at once.
 * Route: /arena-tiebreaker?match=<id>
 */
export const ArenaTiebreakerPage = {
  _match: null,
  _tiebreaker: null,
  _tbSubscription: null,
  _matchSubscription: null,
  _participants: null,
  _appUsers: null,
  _isPlayer: false,
  _playerSide: null,
  _rolling: false,
  _animating: false,
  _animationTimer: null,

  async render(container) {
    container.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'arena-tiebreaker';
    content.innerHTML = '<div class="arena-empty"><p>Loading tiebreaker...</p></div>';
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
      console.error('Tiebreaker error:', err);
      content.innerHTML = `<div class="arena-empty"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async _loadData(matchId) {
    this._match = await arenaData.getMatch(matchId);
    if (!this._match) throw new Error('Match not found');

    const [participants, appUsers, tiebreaker] = await Promise.all([
      arenaData.getParticipants(this._match.tournament_id),
      arenaData.getAllAppUsers(),
      arenaData.getTiebreaker(matchId)
    ]);

    this._participants = participants;
    this._appUsers = appUsers;
    this._tiebreaker = tiebreaker;

    if (!this._tiebreaker) throw new Error('No tiebreaker data');

    const currentUser = dataService.getUser();
    const p1 = participants.find(p => p.id === this._match.player1_id);
    const p2 = participants.find(p => p.id === this._match.player2_id);

    if (currentUser && p1?.discord_id === currentUser.id) {
      this._isPlayer = true;
      this._playerSide = 'player1';
    } else if (currentUser && p2?.discord_id === currentUser.id) {
      this._isPlayer = true;
      this._playerSide = 'player2';
    }

    // Subscribe to tiebreaker changes — both players animate from Realtime
    if (this._tbSubscription) arenaData.unsubscribe(this._tbSubscription);
    this._tbSubscription = arenaData.subscribeToTiebreaker(matchId, async (payload) => {
      const oldTb = this._tiebreaker;
      this._tiebreaker = payload.new;

      if (this._animating) return;

      const content = document.querySelector('.arena-tiebreaker');
      if (!content) return;

      const oldP1Taps = oldTb?.player1_taps || [];
      const newP1Taps = payload.new.player1_taps || [];
      const newP2Taps = payload.new.player2_taps || [];

      // Race just started — taps went from empty to populated
      if (oldP1Taps.length === 0 && newP1Taps.length > 0 && newP2Taps.length > 0) {
        this._animating = true;
        try {
          await this._animateRace(newP1Taps, newP2Taps, payload.new.winner_id);
          this._match = await arenaData.getMatch(this._match.id);
          this._tiebreaker = await arenaData.getTiebreaker(this._match.id);
          this._renderContent(content);
          const winnerName = this._getParticipantName(payload.new.winner_id);
          toast.success(`${winnerName} wins the enhancement race!`);
        } finally {
          this._animating = false;
          this._rolling = false;
        }
        return;
      }

      this._renderContent(content);
    });

    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToMatch(matchId, (payload) => {
      this._match = payload.new;
      if (!this._animating) {
        const content = document.querySelector('.arena-tiebreaker');
        if (content) this._renderContent(content);
      }
    });
  },

  _getDisplayName(discordId) {
    if (discordId === 'BOT_PLAYER') return 'Arena Bot';
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
    const tb = this._tiebreaker;
    const p1Name = this._getParticipantName(m.player1_id);
    const p2Name = this._getParticipantName(m.player2_id);
    const isComplete = tb.winner_id || m.status === 'complete';
    const p1Taps = tb.player1_taps || [];
    const p2Taps = tb.player2_taps || [];
    const canRoll = this._isPlayer && !isComplete && !this._rolling && p1Taps.length === 0;

    container.innerHTML = `
      <div class="tb-header arena-panel">
        <h2>Enhancement Race</h2>
        <p>Auto-enhance from <strong>+${TIEBREAKER_START_LEVEL}</strong> to <strong>+${TIEBREAKER_TARGET_LEVEL}</strong> — fewest taps wins!</p>
      </div>

      <div class="tb-arena">
        <div class="tb-player">
          <div class="tb-player-name">${p1Name}</div>
          ${this._renderEnhanceDisplay('p1', tb.player1_level, p1Taps)}
        </div>

        <div class="tb-vs">VS</div>

        <div class="tb-player">
          <div class="tb-player-name">${p2Name}</div>
          ${this._renderEnhanceDisplay('p2', tb.player2_level, p2Taps)}
        </div>
      </div>

      ${canRoll ? `
        <div class="tb-action arena-panel">
          <button class="arena-btn arena-btn-primary tb-enhance-btn" id="roll-btn">
            Roll Enhancement Race!
          </button>
        </div>
      ` : ''}

      ${!isComplete && !canRoll && p1Taps.length === 0 ? `
        <div class="tb-action arena-panel">
          <div class="tb-waiting">Waiting for a player to start the race...</div>
        </div>
      ` : ''}

      ${isComplete ? `
        <div class="tb-result arena-panel">
          <div class="result-label">Winner</div>
          <div class="result-winner">${this._getParticipantName(tb.winner_id || m.winner_id)}</div>
          <div class="tb-result-detail">${p1Name}: ${p1Taps.length} taps — ${p2Name}: ${p2Taps.length} taps</div>
          <button class="arena-btn" id="back-btn" style="margin-top: 0.75rem;">Back to Arena</button>
        </div>
      ` : ''}

      <div class="tb-history arena-panel">
        <div class="arena-panel-header">
          <h3>Enhancement Log</h3>
        </div>
        <div class="tb-log" id="tb-log">
          ${this._renderLog(tb, p1Name, p2Name)}
        </div>
      </div>
    `;

    const rollBtn = document.getElementById('roll-btn');
    if (rollBtn) {
      rollBtn.addEventListener('click', () => this._startRace());
    }

    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => router.navigate('arena'));
    }
  },

  _renderEnhanceDisplay(id, level, taps) {
    const progress = ((level - TIEBREAKER_START_LEVEL) / (TIEBREAKER_TARGET_LEVEL - TIEBREAKER_START_LEVEL)) * 100;

    return `
      <div class="tb-enhance-display">
        <div class="tb-level" id="${id}-level">+${level}</div>
        <div class="tb-progress-bar">
          <div class="tb-progress-fill" id="${id}-progress" style="width: ${progress}%"></div>
        </div>
        <div class="tb-level-markers">
          ${[9, 10, 11, 12, 13].map(l => `
            <span class="tb-marker ${level >= l ? 'reached' : ''}" id="${id}-marker-${l}">${l}</span>
          `).join('')}
        </div>
        <div class="tb-tap-count" id="${id}-taps">${taps.length > 0 ? `${taps.length} taps` : ''}</div>
      </div>
    `;
  },

  _renderLog(tb, p1Name, p2Name) {
    const p1Taps = tb.player1_taps || [];
    const p2Taps = tb.player2_taps || [];

    if (p1Taps.length === 0 && p2Taps.length === 0) {
      return '<p style="text-align: center; opacity: 0.5;">No taps yet</p>';
    }

    // Interleave taps: show both players' attempts side by side by index
    const maxLen = Math.max(p1Taps.length, p2Taps.length);
    const rows = [];
    for (let i = maxLen - 1; i >= 0; i--) {
      const t1 = p1Taps[i];
      const t2 = p2Taps[i];
      rows.push(`
        <div class="tb-log-row">
          <span class="tb-log-tap-num">#${i + 1}</span>
          <span class="tb-log-entry ${t1 ? (t1.success ? 'success' : 'fail') : 'empty'}">
            ${t1 ? `${p1Name}: +${t1.fromLevel} → +${t1.toLevel}` : '—'}
          </span>
          <span class="tb-log-entry ${t2 ? (t2.success ? 'success' : 'fail') : 'empty'}">
            ${t2 ? `${p2Name}: +${t2.fromLevel} → +${t2.toLevel}` : '—'}
          </span>
        </div>
      `);
    }
    return rows.join('');
  },

  async _startRace() {
    if (this._rolling) return;
    this._rolling = true;

    const rollBtn = document.getElementById('roll-btn');
    if (rollBtn) {
      rollBtn.disabled = true;
      rollBtn.textContent = 'Rolling...';
    }

    try {
      const currentUser = dataService.getUser();
      // Submit to server — Realtime subscription handles animation for both players
      await arenaData.submitTiebreakerTap(this._match.id, currentUser.id);
    } catch (err) {
      this._rolling = false;
      toast.error('Race failed: ' + err.message);
      const content = document.querySelector('.arena-tiebreaker');
      if (content) this._renderContent(content);
    }
  },

  /**
   * Animate both players' enhancement sequences side by side.
   * Steps through taps one at a time with delays.
   */
  _animateRace(p1Taps, p2Taps, winnerId) {
    return new Promise(resolve => {
      const winnerLen = Math.min(p1Taps.length, p2Taps.length);
      const maxLen = Math.max(p1Taps.length, p2Taps.length);
      let step = 0;
      let resolved = false;
      const TAP_DELAY = 150; // ms per tap

      const tick = () => {
        if (step >= maxLen) {
          if (!resolved) resolve();
          return;
        }

        const t1 = p1Taps[step];
        const t2 = p2Taps[step];

        if (t1) this._updateDisplay('p1', t1.toLevel, step + 1, t1.success);
        if (t2) this._updateDisplay('p2', t2.toLevel, step + 1, t2.success);

        step++;

        // Resolve as soon as the winner's sequence finishes
        if (!resolved && step >= winnerLen) {
          resolved = true;
          resolve();
        }

        // Keep animating the loser's remaining taps in the background
        if (step < maxLen) {
          this._animationTimer = setTimeout(tick, TAP_DELAY);
        }
      };

      tick();
    });
  },

  /**
   * Update one player's display during animation.
   */
  _updateDisplay(id, level, tapCount, success) {
    const levelEl = document.getElementById(`${id}-level`);
    const progressEl = document.getElementById(`${id}-progress`);
    const tapsEl = document.getElementById(`${id}-taps`);

    if (levelEl) {
      levelEl.textContent = `+${level}`;
      // Flash effect
      levelEl.classList.remove('tb-flash-success', 'tb-flash-fail');
      void levelEl.offsetWidth; // reflow to restart animation
      levelEl.classList.add(success ? 'tb-flash-success' : 'tb-flash-fail');
    }

    if (progressEl) {
      const progress = ((level - TIEBREAKER_START_LEVEL) / (TIEBREAKER_TARGET_LEVEL - TIEBREAKER_START_LEVEL)) * 100;
      progressEl.style.width = `${progress}%`;
    }

    if (tapsEl) {
      tapsEl.textContent = `${tapCount} taps`;
    }

    // Update markers
    for (let l = TIEBREAKER_START_LEVEL; l <= TIEBREAKER_TARGET_LEVEL; l++) {
      const marker = document.getElementById(`${id}-marker-${l}`);
      if (marker) {
        marker.classList.toggle('reached', level >= l);
      }
    }
  },

  destroy() {
    if (this._tbSubscription) arenaData.unsubscribe(this._tbSubscription);
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    if (this._animationTimer) clearTimeout(this._animationTimer);
    // cleanup done
  }
};

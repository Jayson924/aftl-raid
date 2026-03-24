import { ArenaShell } from './arena-shell.jsx';
import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { TIEBREAKER_START_LEVEL, TIEBREAKER_TARGET_LEVEL, TIEBREAKER_RATES, TIMERS } from './arena-constants.js';

/**
 * Arena Tiebreaker — Enhancement Race.
 * Both players tap to enhance from +9 to +13. First to +13 wins.
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
  _tapping: false, // prevent double-tap during suspense

  async render(container) {
    ArenaShell.activate();
    container.innerHTML = '';
    ArenaShell.renderHeader(container, 'arena');

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

    // Subscribe to tiebreaker changes
    if (this._tbSubscription) arenaData.unsubscribe(this._tbSubscription);
    this._tbSubscription = arenaData.subscribeToTiebreaker(matchId, (payload) => {
      this._tiebreaker = payload.new;
      const content = document.querySelector('.arena-tiebreaker');
      if (content) this._renderContent(content);
    });

    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToMatch(matchId, (payload) => {
      this._match = payload.new;
      if (this._match?.status === 'complete') {
        const winnerName = this._match.winner_id ? this._getParticipantName(this._match.winner_id) : null;
        toast.success(winnerName ? `${winnerName} wins the tiebreaker!` : 'Tiebreaker complete!');
        const content = document.querySelector('.arena-tiebreaker');
        if (content) this._renderContent(content);
      }
    });
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
    const tb = this._tiebreaker;
    const p1Name = this._getParticipantName(m.player1_id);
    const p2Name = this._getParticipantName(m.player2_id);
    const isComplete = m.status === 'complete';

    container.innerHTML = `
      <div class="tb-header arena-panel">
        <h2>Enhancement Race</h2>
        <p>First to <strong>+${TIEBREAKER_TARGET_LEVEL}</strong> wins!</p>
      </div>

      <div class="tb-arena">
        <div class="tb-player">
          <div class="tb-player-name">${p1Name}</div>
          ${this._renderEnhanceDisplay(tb.player1_level, tb.player1_taps || [])}
          ${this._isPlayer && this._playerSide === 'player1' && !isComplete && !tb.winner_id ?
            `<button class="arena-btn arena-btn-primary tb-enhance-btn" id="enhance-btn" ${this._tapping ? 'disabled' : ''}>
              Enhance!
            </button>` : ''
          }
        </div>

        <div class="tb-vs">VS</div>

        <div class="tb-player">
          <div class="tb-player-name">${p2Name}</div>
          ${this._renderEnhanceDisplay(tb.player2_level, tb.player2_taps || [])}
          ${this._isPlayer && this._playerSide === 'player2' && !isComplete && !tb.winner_id ?
            `<button class="arena-btn arena-btn-primary tb-enhance-btn" id="enhance-btn" ${this._tapping ? 'disabled' : ''}>
              Enhance!
            </button>` : ''
          }
        </div>
      </div>

      ${isComplete || tb.winner_id ? `
        <div class="tb-result arena-panel">
          <div class="result-label">Winner</div>
          <div class="result-winner">${this._getParticipantName(tb.winner_id || m.winner_id)}</div>
          <button class="arena-btn" onclick="window.history.back()">Back to Arena</button>
        </div>
      ` : ''}

      <div class="tb-history arena-panel">
        <div class="arena-panel-header">
          <h3>Enhancement Log</h3>
        </div>
        <div class="tb-log">
          ${this._renderLog(tb, p1Name, p2Name)}
        </div>
      </div>
    `;

    const enhanceBtn = document.getElementById('enhance-btn');
    if (enhanceBtn) {
      enhanceBtn.addEventListener('click', () => this._tap());
    }
  },

  _renderEnhanceDisplay(level, taps) {
    const progress = ((level - TIEBREAKER_START_LEVEL) / (TIEBREAKER_TARGET_LEVEL - TIEBREAKER_START_LEVEL)) * 100;
    const lastTap = taps[taps.length - 1];
    const lastResult = lastTap ? (lastTap.success ? 'SUCCESS' : 'FAILED') : '';

    return `
      <div class="tb-enhance-display">
        <div class="tb-level">+${level}</div>
        <div class="tb-progress-bar">
          <div class="tb-progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="tb-level-markers">
          ${[9, 10, 11, 12, 13].map(l => `
            <span class="tb-marker ${level >= l ? 'reached' : ''}">${l}</span>
          `).join('')}
        </div>
        ${lastResult ? `
          <div class="tb-last-result ${lastTap?.success ? 'success' : 'fail'}">
            ${lastResult}
          </div>
        ` : ''}
        <div class="tb-rate">
          ${level < TIEBREAKER_TARGET_LEVEL ? `Next: ${TIEBREAKER_RATES[level + 1]?.success || 0}% chance` : 'MAX!'}
        </div>
      </div>
    `;
  },

  _renderLog(tb, p1Name, p2Name) {
    const allTaps = [
      ...(tb.player1_taps || []).map(t => ({ ...t, player: p1Name })),
      ...(tb.player2_taps || []).map(t => ({ ...t, player: p2Name }))
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (allTaps.length === 0) return '<p style="text-align: center; opacity: 0.5;">No taps yet</p>';

    return allTaps.map(t => `
      <div class="tb-log-entry ${t.success ? 'success' : 'fail'}">
        <span class="tb-log-player">${t.player}</span>
        <span>+${t.fromLevel} → +${t.toLevel}</span>
        <span class="tb-log-result">${t.success ? 'SUCCESS' : 'FAILED'}</span>
      </div>
    `).join('');
  },

  async _tap() {
    if (this._tapping) return;
    this._tapping = true;

    const enhanceBtn = document.getElementById('enhance-btn');
    if (enhanceBtn) enhanceBtn.disabled = true;

    try {
      const currentUser = dataService.getUser();
      const result = await arenaData.submitTiebreakerTap(this._match.id, currentUser.id);

      // Suspense delay
      await new Promise(resolve => setTimeout(resolve, TIMERS.TIEBREAKER_SUSPENSE * 1000));

      if (result.tap.success) {
        toast.success(`+${result.newLevel}! SUCCESS!`);
      } else {
        toast.error(`Failed! Dropped to +${result.newLevel}`);
      }

      if (result.won) {
        toast.success('You reached +13! YOU WIN!');
      }
    } catch (err) {
      toast.error('Tap failed: ' + err.message);
    } finally {
      this._tapping = false;
      // Re-render will happen from subscription
    }
  },

  destroy() {
    if (this._tbSubscription) arenaData.unsubscribe(this._tbSubscription);
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    ArenaShell.deactivate();
  }
};

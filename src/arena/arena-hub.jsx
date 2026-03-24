import { ArenaShell } from './arena-shell.jsx';
import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { MATCH_STATUS, TOURNAMENT_PHASES } from './arena-constants.js';

/**
 * Arena Hub — Tournament overview, bracket panels, standings, live match links.
 * Includes player-to-player challenge system and admin Quick Match.
 * Route: /arena
 */
export const ArenaHubPage = {
  _matchSubscription: null,
  _challengeSubscription: null,
  _challengeUpdateSub: null,
  _challengeTimer: null,
  _pendingChallenge: null,
  _outgoingChallenge: null,
  _tournament: null,
  _participants: null,
  _matches: null,
  _appUsers: null,

  async render(container) {
    ArenaShell.activate();
    container.innerHTML = '';
    ArenaShell.renderHeader(container, 'arena');

    const content = document.createElement('div');
    content.className = 'arena-hub';
    content.innerHTML = '<div class="arena-empty"><p>Loading arena...</p></div>';
    container.appendChild(content);

    // Always load app users
    try {
      this._appUsers = await arenaData.getAllAppUsers();
    } catch (e) {
      this._appUsers = [];
    }

    // Start listening for incoming challenges
    this._startChallengeListener();

    try {
      await this._loadData();
      this._renderContent(content);
    } catch (err) {
      console.error('Arena hub error:', err);
      content.innerHTML = `
        <div class="arena-empty">
          <h3>No Active Tournament</h3>
          <p>There are no tournaments to display yet.</p>
          ${dataService.isAdmin() ? '<p>Go to <strong>Setup</strong> to create one.</p>' : ''}
        </div>
        ${this._renderChallengeSection()}
        ${dataService.isAdmin() ? this._renderQuickMatchButton() : ''}
      `;
      this._attachChallengeListeners(content);
      this._attachQuickMatchListener(content);
    }
  },

  async _loadData() {
    const tournaments = await arenaData.getTournaments();
    // Get the most recent active tournament (or most recent overall)
    this._tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
    if (!this._tournament) throw new Error('No tournament');

    const [participants, matches, appUsers] = await Promise.all([
      arenaData.getParticipants(this._tournament.id),
      arenaData.getMatches(this._tournament.id),
      arenaData.getAllAppUsers()
    ]);

    this._participants = participants;
    this._matches = matches;
    this._appUsers = appUsers;

    // Subscribe to match changes
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToMatches(this._tournament.id, (payload) => {
      this._onMatchUpdate(payload);
    });
  },

  _getDisplayName(discordId) {
    const user = this._appUsers?.find(u => u.discord_id === discordId);
    return user?.display_name || user?.username || discordId;
  },

  _getParticipantName(participantId) {
    const p = this._participants?.find(p => p.id === participantId);
    if (!p) return 'Unknown';
    return this._getDisplayName(p.discord_id);
  },

  // ============================================
  // CHALLENGE SYSTEM
  // ============================================

  _startChallengeListener() {
    const currentUser = dataService.getUser();
    if (!currentUser) return;

    // Subscribe to challenges where I am the target
    if (this._challengeSubscription) arenaData.unsubscribe(this._challengeSubscription);
    this._challengeSubscription = arenaData.subscribeToChallenges(currentUser.id, (payload) => {
      if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
        this._showIncomingChallenge(payload.new);
      }
    });
  },

  _showIncomingChallenge(challenge) {
    // Don't show if we already have a pending challenge popup
    if (this._pendingChallenge) return;
    this._pendingChallenge = challenge;

    const challengerName = this._getDisplayName(challenge.challenger_discord_id);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'arena-challenge-overlay';
    overlay.id = 'challenge-overlay';
    overlay.innerHTML = `
      <div class="arena-challenge-popup">
        <div class="challenge-popup-header">
          <span class="challenge-swords">&#9876;</span>
          <h3>Challenge!</h3>
        </div>
        <p class="challenge-popup-text"><strong>${challengerName}</strong> challenges you to a fight!</p>
        <div class="challenge-popup-timer">
          <div class="challenge-timer-bar" id="challenge-timer-bar"></div>
        </div>
        <span class="challenge-timer-text" id="challenge-timer-text">15s</span>
        <div class="challenge-popup-actions">
          <button class="arena-btn arena-btn-primary" id="challenge-accept-btn">Accept</button>
          <button class="arena-btn arena-btn-danger" id="challenge-decline-btn">Decline</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Timer countdown
    let remaining = 15;
    const timerBar = document.getElementById('challenge-timer-bar');
    const timerText = document.getElementById('challenge-timer-text');

    this._challengeTimer = setInterval(() => {
      remaining--;
      if (timerBar) timerBar.style.width = `${(remaining / 15) * 100}%`;
      if (timerText) timerText.textContent = `${remaining}s`;

      if (remaining <= 0) {
        this._respondToChallenge(challenge.id, 'expired');
      }
    }, 1000);

    // Accept
    document.getElementById('challenge-accept-btn')?.addEventListener('click', () => {
      this._respondToChallenge(challenge.id, 'accepted');
    });

    // Decline
    document.getElementById('challenge-decline-btn')?.addEventListener('click', () => {
      this._respondToChallenge(challenge.id, 'declined');
    });
  },

  async _respondToChallenge(challengeId, status) {
    // Clean up popup
    clearInterval(this._challengeTimer);
    this._challengeTimer = null;
    const overlay = document.getElementById('challenge-overlay');
    if (overlay) overlay.remove();

    const challenge = this._pendingChallenge;
    this._pendingChallenge = null;

    try {
      await arenaData.updateChallenge(challengeId, { status });

      if (status === 'accepted') {
        toast.success('Challenge accepted! Creating match...');
        const result = await arenaData.createQuickMatch(
          challenge.challenger_discord_id,
          challenge.challenged_discord_id
        );
        // Link match to challenge
        await arenaData.updateChallenge(challengeId, { match_id: result.matchId });
        router.navigate(`arena-draft?match=${result.matchId}`);
      } else if (status === 'declined') {
        toast.info('Challenge declined');
      }
      // 'expired' — silent, no toast
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  },

  _renderChallengeSection() {
    const currentUser = dataService.getUser();
    if (!currentUser) return '';

    const users = (this._appUsers || []).filter(u => u.discord_id !== currentUser.id);
    if (users.length === 0) return '';

    return `
      <div class="arena-panel arena-challenge-panel">
        <div class="arena-panel-header">
          <h3>Challenge a Player</h3>
          <span class="arena-badge badge-red">PvP</span>
        </div>
        <p class="challenge-desc">Pick an opponent and send a challenge. They have 15 seconds to accept.</p>
        <div class="challenge-picker">
          <select id="challenge-target" class="arena-input">
            <option value="">Choose opponent...</option>
            ${users.map(u => `<option value="${u.discord_id}">${u.display_name || u.username}</option>`).join('')}
          </select>
          <button class="arena-btn arena-btn-primary" id="challenge-send-btn">Challenge</button>
        </div>
        <div class="challenge-status" id="challenge-status"></div>
      </div>
    `;
  },

  _attachChallengeListeners(container) {
    const sendBtn = container.querySelector('#challenge-send-btn');
    if (!sendBtn) return;

    sendBtn.addEventListener('click', async () => {
      const select = document.getElementById('challenge-target');
      const targetId = select?.value;
      const currentUser = dataService.getUser();

      if (!targetId) {
        toast.error('Pick an opponent');
        return;
      }
      if (!currentUser) {
        toast.error('You must be logged in');
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';

      try {
        const challenge = await arenaData.createChallenge(currentUser.id, targetId);
        this._outgoingChallenge = challenge;

        const targetName = this._getDisplayName(targetId);
        const statusEl = document.getElementById('challenge-status');
        if (statusEl) {
          statusEl.innerHTML = `
            <div class="challenge-waiting">
              <span class="challenge-waiting-dots">Waiting for <strong>${targetName}</strong> to respond</span>
              <span class="challenge-waiting-timer" id="outgoing-timer">15s</span>
            </div>
          `;
        }

        // Countdown for outgoing challenge
        let remaining = 15;
        const outgoingInterval = setInterval(() => {
          remaining--;
          const timerEl = document.getElementById('outgoing-timer');
          if (timerEl) timerEl.textContent = `${remaining}s`;
          if (remaining <= 0) {
            clearInterval(outgoingInterval);
            this._onOutgoingChallengeEnd('expired');
          }
        }, 1000);

        // Subscribe to this challenge for accept/decline
        if (this._challengeUpdateSub) arenaData.unsubscribe(this._challengeUpdateSub);
        this._challengeUpdateSub = arenaData.subscribeToChallengeUpdates(challenge.id, (payload) => {
          const updated = payload.new;
          if (updated.status === 'accepted') {
            clearInterval(outgoingInterval);
            this._onOutgoingChallengeAccepted(updated);
          } else if (updated.status === 'declined') {
            clearInterval(outgoingInterval);
            this._onOutgoingChallengeEnd('declined');
          } else if (updated.status === 'expired') {
            clearInterval(outgoingInterval);
            this._onOutgoingChallengeEnd('expired');
          }
        });
      } catch (err) {
        toast.error('Failed to send challenge: ' + err.message);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Challenge';
      }
    });
  },

  async _onOutgoingChallengeAccepted(challenge) {
    if (this._challengeUpdateSub) {
      arenaData.unsubscribe(this._challengeUpdateSub);
      this._challengeUpdateSub = null;
    }

    toast.success('Challenge accepted!');

    // The accepting player creates the match and stores match_id on the challenge.
    // Poll briefly to get the match_id.
    let matchId = challenge.match_id;
    if (!matchId) {
      // Small delay for the acceptor to create the match
      await new Promise(r => setTimeout(r, 1500));
      try {
        const updated = await arenaData.getChallenge(challenge.id);
        matchId = updated.match_id;
      } catch (e) { /* ignore */ }
    }

    if (matchId) {
      router.navigate(`arena-draft?match=${matchId}`);
    } else {
      // Fallback: refresh page
      const statusEl = document.getElementById('challenge-status');
      if (statusEl) statusEl.innerHTML = '<p style="color: var(--arena-green, #4ade80);">Match created! Redirecting...</p>';
      setTimeout(() => router.navigate('arena'), 2000);
    }
  },

  _onOutgoingChallengeEnd(reason) {
    if (this._challengeUpdateSub) {
      arenaData.unsubscribe(this._challengeUpdateSub);
      this._challengeUpdateSub = null;
    }
    this._outgoingChallenge = null;

    const statusEl = document.getElementById('challenge-status');
    const sendBtn = document.getElementById('challenge-send-btn');

    if (reason === 'declined') {
      if (statusEl) statusEl.innerHTML = '<p class="challenge-result-declined">Challenge declined</p>';
      toast.info('Your challenge was declined');
    } else {
      if (statusEl) statusEl.innerHTML = '<p class="challenge-result-expired">No response — challenge expired</p>';
    }

    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Challenge';
    }
  },

  // ============================================
  // RENDER
  // ============================================

  _renderContent(container) {
    const t = this._tournament;
    const phaseName = t.current_phase?.replace(/_/g, ' ') || 'setup';

    container.innerHTML = `
      <div class="arena-tournament-header">
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h2>${t.name || 'Tournament'}</h2>
            <span class="arena-badge badge-gold">${phaseName}</span>
          </div>
          <div class="tournament-info">
            <span>${this._participants?.length || 0} players</span>
            <span>${t.bracket_count || 0} brackets</span>
            <span>${this._matches?.filter(m => m.status === 'complete').length || 0}/${this._matches?.length || 0} matches done</span>
          </div>
        </div>
      </div>

      <div class="arena-brackets" id="arena-brackets"></div>

      <div class="arena-live-matches" id="arena-live-matches"></div>

      ${this._renderChallengeSection()}
      ${dataService.isAdmin() ? this._renderQuickMatchButton() : ''}
    `;

    this._renderBrackets();
    this._renderLiveMatches();
    this._attachChallengeListeners(container);
    this._attachQuickMatchListener(container);
  },

  _renderBrackets() {
    const bracketsContainer = document.getElementById('arena-brackets');
    if (!bracketsContainer) return;

    // Group participants by bracket
    const brackets = {};
    for (const p of this._participants) {
      const bn = p.bracket_number || 0;
      if (!brackets[bn]) brackets[bn] = [];
      brackets[bn].push(p);
    }

    const bracketNumbers = Object.keys(brackets).sort((a, b) => a - b);

    if (bracketNumbers.length === 0) {
      bracketsContainer.innerHTML = '<div class="arena-empty"><p>No brackets set up yet.</p></div>';
      return;
    }

    bracketsContainer.innerHTML = bracketNumbers.map(bn => {
      const players = brackets[bn].sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.losses - b.losses;
      });

      return `
        <div class="arena-panel arena-bracket-panel">
          <div class="arena-panel-header">
            <h3>Bracket ${bn}</h3>
            <span class="arena-badge badge-blue">${players.length} players</span>
          </div>
          <table class="arena-standings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>W</th>
                <th>L</th>
              </tr>
            </thead>
            <tbody>
              ${players.map((p, i) => `
                <tr class="${i === 0 && p.wins > 0 ? 'standings-leader' : ''}">
                  <td>${i + 1}</td>
                  <td>${this._getDisplayName(p.discord_id)}</td>
                  <td class="standings-wins">${p.wins}</td>
                  <td class="standings-losses">${p.losses}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }).join('');
  },

  _renderLiveMatches() {
    const liveContainer = document.getElementById('arena-live-matches');
    if (!liveContainer) return;

    const liveMatches = this._matches?.filter(m =>
      m.status !== 'complete' && m.status !== 'pending'
    ) || [];

    const pendingMatches = this._matches?.filter(m => m.status === 'pending') || [];
    const completedMatches = this._matches?.filter(m => m.status === 'complete') || [];

    let html = '';

    if (liveMatches.length > 0) {
      html += `
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h3>Live Matches</h3>
            <span class="arena-badge badge-red">${liveMatches.length} in progress</span>
          </div>
          <div class="arena-match-list">
            ${liveMatches.map(m => this._renderMatchCard(m, true)).join('')}
          </div>
        </div>
      `;
    }

    if (pendingMatches.length > 0) {
      html += `
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h3>Upcoming Matches</h3>
            <span class="arena-badge badge-gold">${pendingMatches.length} pending</span>
          </div>
          <div class="arena-match-list">
            ${pendingMatches.map(m => this._renderMatchCard(m, false)).join('')}
          </div>
        </div>
      `;
    }

    if (completedMatches.length > 0) {
      html += `
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h3>Completed Matches</h3>
          </div>
          <div class="arena-match-list">
            ${completedMatches.map(m => this._renderMatchCard(m, false)).join('')}
          </div>
        </div>
      `;
    }

    if (!html) {
      html = '<div class="arena-empty"><p>No matches scheduled yet.</p></div>';
    }

    liveContainer.innerHTML = html;

    // Attach watch/spectate button listeners
    liveContainer.querySelectorAll('.arena-watch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const matchId = btn.dataset.matchId;
        const match = this._matches.find(m => m.id === matchId);
        if (!match) return;

        const currentUser = dataService.getUser();
        const isPlayer = currentUser &&
          (this._participants.find(p => p.id === match.player1_id)?.discord_id === currentUser.id ||
           this._participants.find(p => p.id === match.player2_id)?.discord_id === currentUser.id);

        if (isPlayer) {
          if (match.status === 'drafting') {
            router.navigate(`arena-draft?match=${matchId}`);
          } else {
            router.navigate(`arena-match?match=${matchId}`);
          }
        } else {
          router.navigate(`arena-spectate?match=${matchId}`);
        }
      });
    });

    // Admin start-match buttons
    liveContainer.querySelectorAll('.arena-start-match-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const matchId = btn.dataset.matchId;
        try {
          await arenaData.updateMatch(matchId, { status: 'drafting' });
          toast.success('Match started — draft phase begun!');

          const match = this._matches.find(m => m.id === matchId);
          const currentUser = dataService.getUser();
          if (match && currentUser) {
            const isParticipant =
              this._participants.find(p => p.id === match.player1_id)?.discord_id === currentUser.id ||
              this._participants.find(p => p.id === match.player2_id)?.discord_id === currentUser.id;
            if (isParticipant) {
              router.navigate(`arena-draft?match=${matchId}`);
            }
          }
        } catch (err) {
          toast.error('Failed to start match: ' + err.message);
        }
      });
    });
  },

  _renderMatchCard(match, isLive) {
    const p1Name = this._getParticipantName(match.player1_id);
    const p2Name = this._getParticipantName(match.player2_id);
    const isAdmin = dataService.isAdmin();
    const statusLabel = match.status.replace(/_/g, ' ');

    const scoreHtml = match.status !== 'pending' ?
      `<span class="match-score">${match.player1_rounds_won} - ${match.player2_rounds_won}</span>` : '';

    const winnerName = match.winner_id ? this._getParticipantName(match.winner_id) : '';

    return `
      <div class="arena-match-card ${isLive ? 'match-live' : ''} ${match.status === 'complete' ? 'match-complete' : ''}">
        <div class="match-players">
          <span class="match-player ${match.winner_id === match.player1_id ? 'match-winner' : ''}">${p1Name}</span>
          <span class="match-vs">vs</span>
          <span class="match-player ${match.winner_id === match.player2_id ? 'match-winner' : ''}">${p2Name}</span>
        </div>
        ${scoreHtml}
        <div class="match-meta">
          <span class="arena-badge ${isLive ? 'badge-red' : match.status === 'complete' ? 'badge-green' : 'badge-gold'}">${statusLabel}</span>
          ${winnerName ? `<span class="match-winner-label">Winner: ${winnerName}</span>` : ''}
        </div>
        <div class="match-actions">
          ${isLive ? `<button class="arena-btn arena-btn-small arena-watch-btn" data-match-id="${match.id}">Watch</button>` : ''}
          ${match.status === 'pending' && isAdmin ? `<button class="arena-btn arena-btn-primary arena-btn-small arena-start-match-btn" data-match-id="${match.id}">Start</button>` : ''}
          ${match.status === 'complete' ? `<button class="arena-btn arena-btn-small arena-watch-btn" data-match-id="${match.id}">Replay</button>` : ''}
        </div>
      </div>
    `;
  },

  // ============================================
  // ADMIN QUICK MATCH (kept separate)
  // ============================================

  _renderQuickMatchButton() {
    const users = this._appUsers || [];
    return `
      <div class="arena-panel arena-quick-match-panel">
        <div class="arena-panel-header">
          <h3>Quick Match</h3>
          <span class="arena-badge badge-blue">Admin</span>
        </div>
        <p class="quick-match-desc">Force-start a match between any two players (no challenge needed).</p>
        <div class="quick-match-pickers">
          <select id="qm-player1" class="arena-input">
            <option value="">Player 1...</option>
            ${users.map(u => `<option value="${u.discord_id}">${u.display_name || u.username}</option>`).join('')}
          </select>
          <span class="quick-match-vs">vs</span>
          <select id="qm-player2" class="arena-input">
            <option value="">Player 2...</option>
            ${users.map(u => `<option value="${u.discord_id}">${u.display_name || u.username}</option>`).join('')}
          </select>
        </div>
        <button class="arena-btn arena-btn-primary" id="qm-start-btn" style="width: 100%; margin-top: 0.75rem;">
          Start Quick Match
        </button>
      </div>
    `;
  },

  _attachQuickMatchListener(container) {
    const startBtn = container.querySelector('#qm-start-btn');
    if (!startBtn) return;

    startBtn.addEventListener('click', async () => {
      const p1Select = document.getElementById('qm-player1');
      const p2Select = document.getElementById('qm-player2');
      const p1Id = p1Select?.value;
      const p2Id = p2Select?.value;

      if (!p1Id || !p2Id) {
        toast.error('Pick both players');
        return;
      }
      if (p1Id === p2Id) {
        toast.error("Can't fight yourself");
        return;
      }

      startBtn.disabled = true;
      startBtn.textContent = 'Creating...';

      try {
        const result = await arenaData.createQuickMatch(p1Id, p2Id);
        toast.success('Quick match created!');

        const currentUser = dataService.getUser();
        if (currentUser && (currentUser.id === p1Id || currentUser.id === p2Id)) {
          router.navigate(`arena-draft?match=${result.matchId}`);
        } else {
          router.navigate(`arena-spectate?match=${result.matchId}`);
        }
      } catch (err) {
        toast.error('Failed: ' + err.message);
        startBtn.disabled = false;
        startBtn.textContent = 'Start Quick Match';
      }
    });
  },

  _onMatchUpdate(payload) {
    this._loadData().then(() => {
      const content = document.querySelector('.arena-hub');
      if (content) this._renderContent(content);
    });
  },

  destroy() {
    if (this._matchSubscription) {
      arenaData.unsubscribe(this._matchSubscription);
      this._matchSubscription = null;
    }
    if (this._challengeSubscription) {
      arenaData.unsubscribe(this._challengeSubscription);
      this._challengeSubscription = null;
    }
    if (this._challengeUpdateSub) {
      arenaData.unsubscribe(this._challengeUpdateSub);
      this._challengeUpdateSub = null;
    }
    if (this._challengeTimer) {
      clearInterval(this._challengeTimer);
      this._challengeTimer = null;
    }
    // Clean up any popup overlay
    const overlay = document.getElementById('challenge-overlay');
    if (overlay) overlay.remove();

    this._pendingChallenge = null;
    this._outgoingChallenge = null;
    ArenaShell.deactivate();
  }
};

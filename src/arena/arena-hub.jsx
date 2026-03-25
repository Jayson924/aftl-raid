import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';

/**
 * Arena Hub — Challenge-first landing page.
 * Shows challenge system, recent/active matches, and active tournament (if any).
 * Route: /arena
 */
export const ArenaHubPage = {
  _matchSubscription: null,
  _challengeSubscription: null,
  _challengeUpdateSub: null,
  _challengeTimer: null,
  _pendingChallenge: null,
  _outgoingChallenge: null,
  _recentMatches: null,
  _allParticipants: null,
  _appUsers: null,
  _tournament: null,
  _tournamentParticipants: null,
  _tournamentMatches: null,

  async render(container) {
    container.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'arena-hub';
    content.innerHTML = '<div class="arena-empty"><p>Loading arena...</p></div>';
    container.appendChild(content);

    try {
      await this._loadData();
      this._renderContent(content);
    } catch (err) {
      console.error('Arena hub error:', err);
      content.innerHTML = '<div class="arena-empty"><h3>Failed to load arena</h3></div>';
    }
  },

  async _loadData() {
    // Load everything in parallel
    const [appUsers, recentMatches, allParticipants, tournaments] = await Promise.all([
      arenaData.getAllAppUsers(),
      arenaData.getRecentMatches(20),
      arenaData.getAllParticipants(),
      arenaData.getTournaments()
    ]);

    this._appUsers = appUsers;
    this._recentMatches = recentMatches;
    this._allParticipants = allParticipants;

    // Find a real tournament (not a "Quick Match" throwaway)
    this._tournament = tournaments.find(t =>
      t.status !== 'complete' && t.name !== 'Quick Match'
    ) || null;

    if (this._tournament) {
      const [tParticipants, tMatches] = await Promise.all([
        arenaData.getParticipants(this._tournament.id),
        arenaData.getMatches(this._tournament.id)
      ]);
      this._tournamentParticipants = tParticipants;
      this._tournamentMatches = tMatches;
    }

    // Subscribe to match changes
    if (this._matchSubscription) arenaData.unsubscribe(this._matchSubscription);
    this._matchSubscription = arenaData.subscribeToAllMatches(() => {
      this._refreshMatches();
    });

    // Start listening for incoming challenges
    this._startChallengeListener();
  },

  async _refreshMatches() {
    try {
      this._recentMatches = await arenaData.getRecentMatches(20);
      this._allParticipants = await arenaData.getAllParticipants();
      const content = document.querySelector('.arena-hub');
      if (content) this._renderContent(content);
    } catch (e) {
      console.error('Failed to refresh matches:', e);
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

  _getParticipantName(participantId) {
    const p = this._allParticipants?.find(p => p.id === participantId);
    if (!p) return 'Unknown';
    return this._getDisplayName(p.discord_id);
  },

  _getParticipantDiscordId(participantId) {
    const p = this._allParticipants?.find(p => p.id === participantId);
    return p?.discord_id || null;
  },

  _renderAvatar(discordId, size = 24) {
    const url = this._getAvatarUrl(discordId);
    if (url) {
      return `<img src="${url}" alt="" class="match-avatar" style="width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;object-fit:cover;" onerror="this.style.display='none'">`;
    }
    return `<span class="match-avatar" style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:rgba(255,255,255,0.1);flex-shrink:0;"></span>`;
  },

  // ============================================
  // CHALLENGE SYSTEM
  // ============================================

  _startChallengeListener() {
    const currentUser = dataService.getUser();
    if (!currentUser) return;

    if (this._challengeSubscription) arenaData.unsubscribe(this._challengeSubscription);
    this._challengeSubscription = arenaData.subscribeToChallenges(currentUser.id, (payload) => {
      if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
        this._showIncomingChallenge(payload.new);
      }
    });
  },

  _showIncomingChallenge(challenge) {
    if (this._pendingChallenge) return;
    this._pendingChallenge = challenge;

    const challengerName = this._getDisplayName(challenge.challenger_discord_id);

    const overlay = document.createElement('div');
    overlay.className = 'arena-challenge-overlay';
    overlay.id = 'challenge-overlay';
    overlay.innerHTML = `
      <div class="arena-challenge-popup">
        <div class="challenge-popup-header">
          <span class="challenge-swords">&#9876;</span>
          <h3>Challenge!</h3>
        </div>
        <p class="challenge-popup-text"><strong>${challengerName}</strong> challenges you to a <strong>${challenge.match_format || 1}v${challenge.match_format || 1}</strong> fight!</p>
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

    document.getElementById('challenge-accept-btn')?.addEventListener('click', () => {
      this._respondToChallenge(challenge.id, 'accepted');
    });

    document.getElementById('challenge-decline-btn')?.addEventListener('click', () => {
      this._respondToChallenge(challenge.id, 'declined');
    });
  },

  async _respondToChallenge(challengeId, status) {
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
          challenge.challenged_discord_id,
          challenge.match_format || 1
        );
        await arenaData.updateChallenge(challengeId, { match_id: result.matchId });
        router.navigate(`arena-draft?match=${result.matchId}`);
      } else if (status === 'declined') {
        toast.info('Challenge declined');
      }
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
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
        // Close other open pickers
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

    // Close on outside click
    document.addEventListener('click', () => {
      container.querySelectorAll('.arena-player-picker.open').forEach(p => p.classList.remove('open'));
    });
  },

  _getPickerValue(id) {
    const picker = document.getElementById(id);
    return picker?.querySelector('.picker-selected')?.dataset.value || '';
  },

  // ============================================
  // RENDER
  // ============================================

  _renderContent(container) {
    const currentUser = dataService.getUser();
    const isAdmin = dataService.isAdmin();

    container.innerHTML = `
      ${this._renderChallengeSection()}
      ${isAdmin ? this._renderQuickMatchButton() : ''}
      ${this._renderMatchList()}
      ${this._tournament ? this._renderTournamentPanel() : ''}
      ${isAdmin ? '<div class="arena-panel" style="text-align: center;"><a href="#" class="arena-btn" data-route="arena-setup">Tournament Setup</a></div>' : ''}
    `;

    this._attachPickerListeners(container);
    this._attachChallengeListeners(container);
    this._attachQuickMatchListener(container);
    this._attachMatchListeners(container);
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
          ${this._renderPlayerPicker('challenge-target', 'Choose opponent...', users)}
          <button class="arena-btn arena-btn-primary" id="challenge-send-btn">Challenge</button>
        </div>
        <div class="challenge-format">
          <span class="challenge-format-label">Format:</span>
          ${[1, 2, 3].map(n => `
            <button class="arena-btn arena-btn-small challenge-format-btn ${n === 1 ? 'arena-btn-primary' : ''}" data-format="${n}">${n}v${n}</button>
          `).join('')}
        </div>
        <div class="challenge-status" id="challenge-status"></div>
      </div>
    `;
  },

  _attachChallengeListeners(container) {
    const sendBtn = container.querySelector('#challenge-send-btn');
    if (!sendBtn) return;

    // Format buttons
    let challengeFormat = 1;
    container.querySelectorAll('.challenge-format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.challenge-format-btn').forEach(b => b.classList.remove('arena-btn-primary'));
        btn.classList.add('arena-btn-primary');
        challengeFormat = parseInt(btn.dataset.format);
      });
    });

    sendBtn.addEventListener('click', async () => {
      const targetId = this._getPickerValue('challenge-target');
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
        const challenge = await arenaData.createChallenge(currentUser.id, targetId, challengeFormat);
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

    let matchId = challenge.match_id;
    if (!matchId) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const updated = await arenaData.getChallenge(challenge.id);
        matchId = updated.match_id;
      } catch (e) { /* ignore */ }
    }

    if (matchId) {
      router.navigate(`arena-draft?match=${matchId}`);
    } else {
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
  // MATCH LIST (all recent matches)
  // ============================================

  _renderMatchList() {
    const matches = this._recentMatches || [];

    const pendingMatches = matches.filter(m => m.status === 'pending');
    const liveMatches = matches.filter(m =>
      m.status !== 'complete' && m.status !== 'pending'
    );
    const completedMatches = matches.filter(m => m.status === 'complete');

    let html = '';

    if (pendingMatches.length > 0) {
      // Group pending matches by bracket (via participant lookup)
      const bracketGroups = {};
      for (const m of pendingMatches) {
        const p1 = this._allParticipants?.find(p => p.id === m.player1_id);
        const bn = p1?.bracket_number || 0;
        if (!bracketGroups[bn]) bracketGroups[bn] = [];
        bracketGroups[bn].push(m);
      }
      const bracketNums = Object.keys(bracketGroups).sort((a, b) => a - b);

      html += `
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h3>Upcoming Matches</h3>
            <span class="arena-badge badge-gold">${pendingMatches.length} pending</span>
          </div>
          <div class="upcoming-brackets-grid">
            ${bracketNums.map(bn => `
              <div class="upcoming-bracket-col">
                <h4 class="upcoming-bracket-label">Bracket ${bn}</h4>
                <div class="upcoming-bracket-list">
                  ${bracketGroups[bn].map(m => this._renderMatchCard(m, false, true)).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (liveMatches.length > 0) {
      html += `
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h3>Active Matches</h3>
            <span class="arena-badge badge-red">${liveMatches.length} in progress</span>
          </div>
          <div class="arena-match-list">
            ${liveMatches.map(m => this._renderMatchCard(m, true)).join('')}
          </div>
        </div>
      `;
    }

    if (completedMatches.length > 0) {
      html += `
        <div class="arena-panel">
          <div class="arena-panel-header">
            <h3>Recent Matches</h3>
          </div>
          <div class="arena-match-list">
            ${completedMatches.map(m => this._renderMatchCard(m, false)).join('')}
          </div>
        </div>
      `;
    }

    if (!html) {
      html = `
        <div class="arena-panel">
          <div class="arena-empty" style="padding: 1.5rem;">
            <p>No matches yet. Challenge someone to get started!</p>
          </div>
        </div>
      `;
    }

    return html;
  },

  _renderMatchCard(match, isLive, isPending = false) {
    const p1Name = this._getParticipantName(match.player1_id);
    const p2Name = this._getParticipantName(match.player2_id);
    const p1Discord = this._getParticipantDiscordId(match.player1_id);
    const p2Discord = this._getParticipantDiscordId(match.player2_id);
    const statusLabel = match.status.replace(/_/g, ' ');

    const scoreHtml = match.status !== 'pending' ?
      `<span class="match-score">${match.player1_rounds_won} - ${match.player2_rounds_won}</span>` : '';

    const winnerName = match.winner_id ? this._getParticipantName(match.winner_id) : '';

    // Check if current user is a participant in this match
    const currentUser = dataService.getUser();
    const isParticipant = currentUser && (p1Discord === currentUser.id || p2Discord === currentUser.id);

    return `
      <div class="arena-match-card ${isLive ? 'match-live' : ''} ${match.status === 'complete' ? 'match-complete' : ''} ${isPending ? 'match-pending' : ''}">
        <div class="match-players">
          <span class="match-player ${match.winner_id === match.player1_id ? 'match-winner' : ''}">${this._renderAvatar(p1Discord)} ${p1Name}</span>
          <span class="match-vs">vs</span>
          <span class="match-player ${match.winner_id === match.player2_id ? 'match-winner' : ''}">${this._renderAvatar(p2Discord)} ${p2Name}</span>
        </div>
        ${scoreHtml}
        <div class="match-meta">
          <span class="arena-badge ${isLive ? 'badge-red' : match.status === 'complete' ? 'badge-green' : 'badge-gold'}">${statusLabel}</span>
          ${winnerName ? `<span class="match-winner-label">Winner: ${winnerName}</span>` : ''}
        </div>
        <div class="match-actions">
          ${isPending && isParticipant ? `<button class="arena-btn arena-btn-primary arena-btn-small arena-start-match-btn" data-match-id="${match.id}">Start Match</button>` : ''}
          ${isLive ? `<button class="arena-btn arena-btn-small arena-watch-btn" data-match-id="${match.id}">Watch</button>` : ''}
          ${match.status === 'complete' ? `<button class="arena-btn arena-btn-small arena-watch-btn" data-match-id="${match.id}">View</button>` : ''}
        </div>
      </div>
    `;
  },

  _attachMatchListeners(container) {
    // Start Match buttons (pending → drafting)
    container.querySelectorAll('.arena-start-match-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const matchId = btn.dataset.matchId;
        btn.disabled = true;
        btn.textContent = 'Starting...';
        try {
          await arenaData.updateMatch(matchId, { status: 'drafting' });
          router.navigate(`arena-draft?match=${matchId}`);
        } catch (err) {
          toast.error('Failed to start match: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Start Match';
        }
      });
    });

    // Watch / View buttons
    container.querySelectorAll('.arena-watch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const matchId = btn.dataset.matchId;
        const match = this._recentMatches?.find(m => m.id === matchId);
        if (!match) return;

        const currentUser = dataService.getUser();
        const p1 = this._allParticipants?.find(p => p.id === match.player1_id);
        const p2 = this._allParticipants?.find(p => p.id === match.player2_id);
        const isPlayer = currentUser && (p1?.discord_id === currentUser.id || p2?.discord_id === currentUser.id);

        if (isPlayer) {
          if (match.status === 'drafting') {
            router.navigate(`arena-draft?match=${matchId}`);
          } else if (match.status === 'tiebreaker') {
            router.navigate(`arena-tiebreaker?match=${matchId}`);
          } else {
            router.navigate(`arena-match?match=${matchId}`);
          }
        } else {
          router.navigate(`arena-spectate?match=${matchId}`);
        }
      });
    });
  },

  // ============================================
  // TOURNAMENT PANEL (only if a real tournament exists)
  // ============================================

  _renderTournamentPanel() {
    const t = this._tournament;
    const phaseName = t.current_phase?.replace(/_/g, ' ') || 'setup';
    const participants = this._tournamentParticipants || [];
    const matches = this._tournamentMatches || [];

    // Group participants by bracket
    const brackets = {};
    for (const p of participants) {
      const bn = p.bracket_number || 0;
      if (!brackets[bn]) brackets[bn] = [];
      brackets[bn].push(p);
    }

    const bracketNumbers = Object.keys(brackets).sort((a, b) => a - b).filter(bn => bn > 0);

    return `
      <div class="arena-panel arena-tournament-panel">
        <div class="arena-panel-header">
          <h3>${t.name || 'Tournament'}</h3>
          <span class="arena-badge badge-gold">${phaseName}</span>
        </div>
        <div class="tournament-info">
          <span>${participants.length} players</span>
          <span>${matches.filter(m => m.status === 'complete').length}/${matches.length} matches done</span>
        </div>
        ${bracketNumbers.length > 0 ? `
          <div class="arena-brackets-mini">
            ${bracketNumbers.map(bn => {
              const players = brackets[bn].sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return a.losses - b.losses;
              });
              return `
                <div class="arena-bracket-mini">
                  <h4>Bracket ${bn}</h4>
                  <div class="bracket-mini-list">
                    ${players.map((p, i) => `
                      <div class="bracket-mini-row ${i === 0 && p.wins > 0 ? 'standings-leader' : ''}">
                        <span class="bracket-mini-player">${this._renderAvatar(p.discord_id, 20)} ${this._getDisplayName(p.discord_id)}</span>
                        <span class="bracket-mini-record">${p.wins}W ${p.losses}L</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  },

  // ============================================
  // ADMIN QUICK MATCH
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
          ${this._renderPlayerPicker('qm-player1', 'Player 1...', users)}
          <span class="quick-match-vs">vs</span>
          ${this._renderPlayerPicker('qm-player2', 'Player 2...', users)}
        </div>
        <div class="quick-match-format" style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.5rem;">
          <span style="color: rgba(255,255,255,0.5); align-self: center; font-size: 0.85rem;">Format:</span>
          ${[1, 2, 3].map(n => `
            <button class="arena-btn arena-btn-small qm-format-btn ${n === 1 ? 'arena-btn-primary' : ''}" data-format="${n}">${n}v${n}</button>
          `).join('')}
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

    let qmFormat = 1;
    container.querySelectorAll('.qm-format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.qm-format-btn').forEach(b => b.classList.remove('arena-btn-primary'));
        btn.classList.add('arena-btn-primary');
        qmFormat = parseInt(btn.dataset.format);
      });
    });

    startBtn.addEventListener('click', async () => {
      const p1Id = this._getPickerValue('qm-player1');
      const p2Id = this._getPickerValue('qm-player2');

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
        const result = await arenaData.createQuickMatch(p1Id, p2Id, qmFormat);
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
    const overlay = document.getElementById('challenge-overlay');
    if (overlay) overlay.remove();

    this._pendingChallenge = null;
    this._outgoingChallenge = null;
  }
};

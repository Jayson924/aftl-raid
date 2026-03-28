import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { router } from '../router.js';
import { arenaConfirm } from './arena-confirm.js';
import { distributePrizePool, BET_INCREMENTS, getDynamicBetIncrements, MAX_BET_PERCENTAGE, getRemainingSeconds } from './arena-constants.js';

/**
 * Arena Hub — Challenge-first landing page.
 * Shows challenge system, recent/active matches, and active tournament (if any).
 * Route: /arena
 */
export const ArenaHubPage = {
  _matchSubscription: null,
  _signupSubscription: null,
  _tournamentSubscription: null,
  _participantGoldSubscription: null,
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
  _tournamentSignups: null,
  _matchBets: {},          // matchId → bets array
  _myParticipant: null,    // current user's participant record
  _bettingTimers: {},      // matchId → interval ID
  _showChallenges: false,
  _showBotMatches: false,

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
      arenaData.getRecentMatches(100),
      arenaData.getAllParticipants(),
      arenaData.getTournaments()
    ]);

    this._appUsers = appUsers;
    this._recentMatches = recentMatches;
    this._allParticipants = allParticipants;

    // Find a real tournament (not a "Quick Match" throwaway)
    // Prefer active tournaments; fall back to most recently completed
    this._tournament = tournaments.find(t =>
      t.status !== 'complete' && t.name !== 'Quick Match' && t.name !== 'Solo Match'
    ) || tournaments.find(t =>
      t.status === 'complete' && t.name !== 'Quick Match' && t.name !== 'Solo Match'
    ) || null;

    if (this._tournament) {
      const [tParticipants, tMatches, tSignups] = await Promise.all([
        arenaData.getParticipants(this._tournament.id),
        arenaData.getMatches(this._tournament.id),
        arenaData.getSignups(this._tournament.id)
      ]);
      this._tournamentParticipants = tParticipants;
      this._tournamentMatches = tMatches;
      this._tournamentSignups = tSignups;

      // Subscribe to signup changes for live updates
      if (this._signupSubscription) arenaData.unsubscribe(this._signupSubscription);
      if (this._tournament.current_phase === 'registration') {
        this._signupSubscription = arenaData.subscribeToSignups(this._tournament.id, () => {
          this._refreshSignups();
        });
      }

      // Subscribe to tournament changes (e.g. prize pool updates)
      if (this._tournamentSubscription) arenaData.unsubscribe(this._tournamentSubscription);
      this._tournamentSubscription = arenaData.subscribeToTournament(this._tournament.id, (payload) => {
        if (payload.new) {
          this._tournament = payload.new;
          const content = document.querySelector('.arena-hub');
          if (content) this._renderContent(content);
        }
      });

      // Subscribe to participant gold changes (live betting updates)
      if (this._participantGoldSubscription) arenaData.unsubscribe(this._participantGoldSubscription);
      this._participantGoldSubscription = arenaData.subscribeToParticipantGold(this._tournament.id, async () => {
        try {
          this._tournamentParticipants = await arenaData.getParticipants(this._tournament.id);
          this._updateMyParticipant();
          const content = document.querySelector('.arena-hub');
          if (content) this._renderContent(content);
        } catch (e) { console.error('Failed to refresh participant gold:', e); }
      });

      // Find current user's participant + load bets for bettable matches
      this._updateMyParticipant();
      await this._loadMatchBets().catch(() => {});
    }

    // Poll bets every 10 seconds — update pool numbers in-place to avoid scroll reset
    if (this._betPollInterval) clearInterval(this._betPollInterval);
    this._betPollInterval = setInterval(async () => {
      try {
        await this._loadMatchBets();
        // Patch bet pool totals in the DOM without full re-render
        document.querySelectorAll('.hub-betting[data-match-id]').forEach(el => {
          const matchId = el.dataset.matchId;
          const bets = this._matchBets[matchId] || [];
          const match = (this._recentMatches || []).find(m => m.id === matchId);
          if (!match) return;
          const pools = el.querySelectorAll('.hub-bet-pool');
          if (pools.length >= 2) {
            const p1Total = bets.filter(b => b.backed_participant_id === match.player1_id).reduce((s, b) => s + b.amount, 0);
            const p2Total = bets.filter(b => b.backed_participant_id === match.player2_id).reduce((s, b) => s + b.amount, 0);
            pools[0].textContent = `${p1Total}G`;
            pools[1].textContent = `${p2Total}G`;
          }
        });
      } catch (e) { /* ignore */ }
    }, 10000);

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
      this._recentMatches = await arenaData.getRecentMatches(100);
      this._allParticipants = await arenaData.getAllParticipants();
      if (this._tournament) {
        this._tournamentParticipants = await arenaData.getParticipants(this._tournament.id);
        this._updateMyParticipant();
        await this._loadMatchBets();
      }
      const content = document.querySelector('.arena-hub');
      if (content) this._renderContent(content);
    } catch (e) {
      console.error('Failed to refresh matches:', e);
    }
  },

  async _refreshSignups() {
    try {
      if (!this._tournament) return;
      this._tournamentSignups = await arenaData.getSignups(this._tournament.id);
      const content = document.querySelector('.arena-hub');
      if (content) this._renderContent(content);
    } catch (e) {
      console.error('Failed to refresh signups:', e);
    }
  },

  _getDisplayName(discordId) {
    if (discordId === 'BOT_PLAYER') return 'Arena Bot';
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
      return `<img src="${url}" alt="" class="match-avatar" style="width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;object-fit:cover;" onerror="this.outerHTML='<span class=\\'match-avatar match-avatar-empty\\' style=\\'width:${size}px;height:${size}px;\\'></span>'">`;
    }
    return `<span class="match-avatar match-avatar-empty" style="width:${size}px;height:${size}px;"></span>`;
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
  // BETTING HELPERS
  // ============================================

  _updateMyParticipant() {
    const currentUser = dataService.getUser();
    if (currentUser && this._tournamentParticipants) {
      this._myParticipant = this._tournamentParticipants.find(p => p.discord_id === currentUser.id) || null;
    } else {
      this._myParticipant = null;
    }
  },

  async _loadMatchBets() {
    // Load bets for all tournament matches (including complete for results display)
    const bettableMatches = (this._recentMatches || []).filter(m => {
      if (this._tournament && m.tournament_id !== this._tournament?.id) return false;
      return true;
    });
    const results = await Promise.all(
      bettableMatches.map(m => arenaData.getBetsForMatch(m.id).then(bets => [m.id, bets]))
    );
    this._matchBets = {};
    for (const [matchId, bets] of results) {
      this._matchBets[matchId] = bets;
    }
  },

  _canBetOnMatch(match) {
    if (!this._myParticipant) return false;
    if (this._myParticipant.id === match.player1_id || this._myParticipant.id === match.player2_id) return false;
    if (match.status === 'complete') return false;
    if (this._tournament && match.tournament_id !== this._tournament.id) return false;
    // Open for pending, drafting; otherwise need betting_closes_at with time left
    const isPreMatch = match.status === 'pending' || match.status === 'drafting' || match.status === 'roster_reveal';
    if (!isPreMatch && !match.betting_closes_at) return false;
    return true;
  },

  _shouldShowBetting(match) {
    if (match.status === 'complete') return false;
    if (this._tournament && match.tournament_id !== this._tournament.id) return false;
    const isPreMatch = match.status === 'pending' || match.status === 'drafting' || match.status === 'roster_reveal';
    if (!isPreMatch && !match.betting_closes_at) {
      // Still show if there are existing bets on this match
      const bets = this._matchBets[match.id] || [];
      if (bets.length > 0) return true;
      return false;
    }
    return true;
  },

  _getBettingTimeLeft(match) {
    if (!match.betting_closes_at) return 0;
    return getRemainingSeconds(match.betting_closes_at, 0);
  },

  _startBettingTimers() {
    // Clear old timers
    Object.values(this._bettingTimers).forEach(id => clearInterval(id));
    this._bettingTimers = {};

    const bettableMatches = (this._recentMatches || []).filter(m => this._shouldShowBetting(m));
    for (const match of bettableMatches) {
      const timeLeft = this._getBettingTimeLeft(match);
      if (timeLeft <= 0) continue;

      this._bettingTimers[match.id] = setInterval(() => {
        const remaining = this._getBettingTimeLeft(match);
        const timerEl = document.getElementById(`betting-timer-${match.id}`);
        if (timerEl) {
          if (remaining > 0) {
            timerEl.textContent = `${remaining}s`;
            timerEl.classList.toggle('betting-urgent', remaining <= 15);
          } else {
            timerEl.textContent = 'Closed';
            timerEl.classList.remove('betting-urgent');
          }
        }
        if (remaining <= 0) {
          clearInterval(this._bettingTimers[match.id]);
          delete this._bettingTimers[match.id];
          // Disable bet buttons for this match
          document.querySelectorAll(`.hub-bet-btn[data-match-id="${match.id}"]`).forEach(b => b.disabled = true);
        }
      }, 1000);
    }
  },

  // ============================================
  // RENDER
  // ============================================

  _renderContent(container) {
    const currentUser = dataService.getUser();
    const isAdmin = dataService.isAdmin();

    const isRegistration = this._tournament?.current_phase === 'registration';

    container.innerHTML = `
      ${this._renderChallengeSection()}
      ${isRegistration ? this._renderRegistrationPanel() : ''}
      ${this._renderMatchList()}
      ${this._tournament && !isRegistration ? this._renderTournamentPanel() : ''}
      ${isAdmin ? this._renderQuickMatchButton() : ''}
      ${isAdmin ? '<div class="arena-panel" style="text-align: center;"><a href="#" class="arena-btn" data-route="arena-setup">Tournament Setup</a></div>' : ''}
    `;

    this._attachPickerListeners(container);
    this._attachChallengeListeners(container);
    this._attachQuickMatchListener(container);
    this._attachMatchListeners(container);
    this._attachRegistrationListeners(container);
    this._startBettingTimers();
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
        <button class="arena-btn" id="solo-match-btn" style="width: 100%; margin-top: 0.75rem; opacity: 0.7;">Solo Bot Practice</button>
      </div>
    `;
  },

  _attachChallengeListeners(container) {
    // Solo match button
    const soloBtn = container.querySelector('#solo-match-btn');
    if (soloBtn) {
      soloBtn.addEventListener('click', async () => {
        const currentUser = dataService.getUser();
        if (!currentUser) { toast.error('You must be logged in'); return; }
        soloBtn.disabled = true;
        soloBtn.textContent = 'Creating...';
        try {
          const result = await arenaData.createSoloMatch(currentUser.id);
          toast.success('Solo match created!');
          router.navigate(`arena-draft?match=${result.matchId}`);
        } catch (err) {
          toast.error('Failed: ' + err.message);
          soloBtn.disabled = false;
          soloBtn.textContent = 'Solo Bot Practice';
        }
      });
    }

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
    const allMatches = this._recentMatches || [];
    const matches = allMatches.filter(m => {
      const tName = m.arena_tournaments?.name;
      if (tName === 'Solo Match' && !this._showBotMatches) return false;
      if (tName === 'Quick Match' && !this._showChallenges) return false;
      return true;
    });

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

    const hasChallenges = allMatches.some(m => m.arena_tournaments?.name === 'Quick Match');
    const hasBotMatches = allMatches.some(m => m.arena_tournaments?.name === 'Solo Match');

    html += `
      <div class="arena-panel">
        <div class="arena-panel-header">
          <h3>Recent Matches</h3>
          <div class="match-filter-toggles">
            ${hasChallenges ? `<label class="match-filter-toggle"><input type="checkbox" id="toggle-challenges" ${this._showChallenges ? 'checked' : ''}> Challenges</label>` : ''}
            ${hasBotMatches ? `<label class="match-filter-toggle"><input type="checkbox" id="toggle-bot" ${this._showBotMatches ? 'checked' : ''}> Bot</label>` : ''}
          </div>
        </div>
        ${completedMatches.length > 0 ? `
          <div class="arena-match-list arena-match-list-scrollable">
            ${completedMatches.map(m => this._renderMatchCard(m, false)).join('')}
          </div>
        ` : `
          <div class="arena-empty" style="padding: 1.5rem;">
            <p>No matches yet. Challenge someone to get started!</p>
          </div>
        `}
      </div>
    `;

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

    const isAdmin = dataService.isAdmin();
    const canForfeit = isAdmin && match.status !== 'complete';

    // Betting section
    const showBetting = this._shouldShowBetting(match);
    const canBet = this._canBetOnMatch(match);
    const bettingTimeLeft = showBetting ? this._getBettingTimeLeft(match) : 0;
    let bettingHtml = '';

    if (showBetting) {
      const myP = this._myParticipant;
      const bets = this._matchBets[match.id] || [];
      const activeBets = bets.filter(b => b.status === 'active');
      const p1Bets = activeBets.filter(b => b.backed_participant_id === match.player1_id);
      const p2Bets = activeBets.filter(b => b.backed_participant_id === match.player2_id);
      const p1Total = p1Bets.reduce((s, b) => s + b.amount, 0);
      const p2Total = p2Bets.reduce((s, b) => s + b.amount, 0);

      const myP1Total = myP ? p1Bets.filter(b => b.bettor_id === myP.id).reduce((s, b) => s + b.amount, 0) : 0;
      const myP2Total = myP ? p2Bets.filter(b => b.bettor_id === myP.id).reduce((s, b) => s + b.amount, 0) : 0;

      const p1Potential = myP1Total > 0 && p1Total > 0
        ? Math.floor(myP1Total + p2Total * (myP1Total / p1Total)) - myP1Total : 0;
      const p2Potential = myP2Total > 0 && p2Total > 0
        ? Math.floor(myP2Total + p1Total * (myP2Total / p2Total)) - myP2Total : 0;

      const myGold = myP?.gold || 0;
      const pool = this._tournament?.prizes?.pool || 0;
      const participantCount = (this._tournamentParticipants || []).length;
      const prizes = pool > 0 ? distributePrizePool(pool, participantCount) : null;
      const goldFloor = prizes?.participation ? Math.floor(prizes.participation * MAX_BET_PERCENTAGE) : 0;
      const totalMyActiveBets = myP ? activeBets.filter(b => b.bettor_id === myP.id).reduce((s, b) => s + b.amount, 0) : 0;
      const remainingBudget = Math.max(0, myGold - goldFloor) - totalMyActiveBets;

      const startGold = prizes?.participation || 0;
      const betIncrements = startGold > 0 ? getDynamicBetIncrements(startGold, participantCount) : BET_INCREMENTS;
      const increments = betIncrements[match.phase] || betIncrements.group_stage;
      const isPreMatch = match.status === 'pending' || match.status === 'drafting' || match.status === 'roster_reveal';
      const bettingOpen = isPreMatch || bettingTimeLeft > 0;

      // Lock to one side
      const lockedToP1 = myP1Total > 0;
      const lockedToP2 = myP2Total > 0;

      const timerLabel = isPreMatch && !match.betting_closes_at
        ? 'Open' : (bettingTimeLeft > 0 ? `${bettingTimeLeft}s` : 'Closed');

      bettingHtml = `
        <div class="hub-betting" data-match-id="${match.id}">
          <div class="hub-bet-sides">
            <div class="hub-bet-side ${lockedToP2 ? 'hub-bet-locked' : ''} ${lockedToP1 ? 'hub-bet-active' : ''}">
              <span class="hub-bet-player">${p1Name}</span>
              <span class="hub-bet-pool">${p1Total}G</span>
              ${myP1Total > 0 ? `<span class="hub-bet-mine">You: ${myP1Total}G</span>` : ''}
              ${canBet && !lockedToP2 ? `<div class="hub-bet-btns">${increments.map(inc => `<button class="hub-bet-btn" data-match-id="${match.id}" data-backed="${match.player1_id}" data-amount="${inc}" ${!bettingOpen || inc > remainingBudget ? 'disabled' : ''}>+${inc}</button>`).join('')}</div>` : ''}
            </div>
            <div class="hub-bet-divider">
              <span class="hub-bet-timer ${bettingTimeLeft > 0 && bettingTimeLeft <= 15 ? 'betting-urgent' : ''}" id="betting-timer-${match.id}">${timerLabel}</span>
            </div>
            <div class="hub-bet-side ${lockedToP1 ? 'hub-bet-locked' : ''} ${lockedToP2 ? 'hub-bet-active' : ''}">
              <span class="hub-bet-player">${p2Name}</span>
              <span class="hub-bet-pool">${p2Total}G</span>
              ${myP2Total > 0 ? `<span class="hub-bet-mine">You: ${myP2Total}G</span>` : ''}
              ${canBet && !lockedToP1 ? `<div class="hub-bet-btns">${increments.map(inc => `<button class="hub-bet-btn" data-match-id="${match.id}" data-backed="${match.player2_id}" data-amount="${inc}" ${!bettingOpen || inc > remainingBudget ? 'disabled' : ''}>+${inc}</button>`).join('')}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    // Completed matches — show final bet totals
    if (match.status === 'complete') {
      const bets = this._matchBets[match.id] || [];
      if (bets.length > 0) {
        const p1Bets = bets.filter(b => b.backed_participant_id === match.player1_id);
        const p2Bets = bets.filter(b => b.backed_participant_id === match.player2_id);
        const p1Total = p1Bets.reduce((s, b) => s + b.amount, 0);
        const p2Total = p2Bets.reduce((s, b) => s + b.amount, 0);

        const myP = this._myParticipant;
        const myBets = myP ? bets.filter(b => b.bettor_id === myP.id) : [];
        const myWagered = myBets.reduce((s, b) => s + b.amount, 0);
        const myPayout = myBets.reduce((s, b) => s + (b.payout || 0), 0);
        const myNet = myPayout - myWagered;

        bettingHtml = `
          <div class="hub-betting hub-betting-final">
            <div class="hub-bet-sides">
              <div class="hub-bet-side ${match.winner_id === match.player1_id ? 'hub-bet-won' : 'hub-bet-lost'}">
                <span class="hub-bet-player">${p1Name}</span>
                <span class="hub-bet-pool">${p1Total}G</span>
              </div>
              <div class="hub-bet-divider">
                <span class="hub-bet-timer">Final</span>
              </div>
              <div class="hub-bet-side ${match.winner_id === match.player2_id ? 'hub-bet-won' : 'hub-bet-lost'}">
                <span class="hub-bet-player">${p2Name}</span>
                <span class="hub-bet-pool">${p2Total}G</span>
              </div>
            </div>
            ${myWagered > 0 ? `
              <div class="hub-bet-result ${myNet > 0 ? 'hub-bet-result-win' : myNet < 0 ? 'hub-bet-result-loss' : ''}">
                ${myNet > 0 ? `+${myNet.toLocaleString()}G` : myNet < 0 ? `${myNet.toLocaleString()}G` : 'Refunded'}
              </div>
            ` : ''}
          </div>
        `;
      }
    }

    const tiebreakerBadge = match.phase === 'tiebreaker' ? '<span class="arena-badge badge-orange" style="margin-bottom: 0.25rem;">Tiebreaker</span>' : '';

    // Upcoming/pending cards get a dedicated matchup layout
    if (isPending) {
      return `
        <div class="upcoming-match-card">
          ${canForfeit ? `
            <div class="upcoming-admin-menu">
              <button class="upcoming-admin-toggle" title="Admin actions">&#9881;</button>
              <div class="upcoming-admin-dropdown">
                <button class="admin-force-start-btn" data-match-id="${match.id}">Force Start</button>
                <button class="arena-forfeit-btn" data-match-id="${match.id}" data-winner-id="${match.player1_id}" data-winner-name="${p1Name}">
                  ${p1Name} wins
                </button>
                <button class="arena-forfeit-btn" data-match-id="${match.id}" data-winner-id="${match.player2_id}" data-winner-name="${p2Name}">
                  ${p2Name} wins
                </button>
              </div>
            </div>
          ` : ''}
          ${tiebreakerBadge}
          <div class="upcoming-matchup">
            <div class="upcoming-fighter upcoming-fighter-left">
              ${this._renderAvatar(p1Discord, 32)}
              <span class="upcoming-fighter-name">${p1Name}</span>
            </div>
            <div class="upcoming-vs">VS</div>
            <div class="upcoming-fighter upcoming-fighter-right">
              ${this._renderAvatar(p2Discord, 32)}
              <span class="upcoming-fighter-name">${p2Name}</span>
            </div>
          </div>
          ${bettingHtml}
          ${isParticipant ? `
            <div class="upcoming-footer">
              <button class="arena-btn arena-btn-primary arena-btn-small arena-start-match-btn" data-match-id="${match.id}">Start Match</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Live / complete cards — matchup layout
    const isComplete = match.status === 'complete';
    const p1Won = match.winner_id === match.player1_id;
    const p2Won = match.winner_id === match.player2_id;

    return `
      <div class="live-match-card ${isLive ? 'live-match-active' : ''} ${isComplete ? 'live-match-complete' : ''}">
        ${canForfeit ? `
          <div class="upcoming-admin-menu">
            <button class="upcoming-admin-toggle" title="Admin actions">&#9881;</button>
            <div class="upcoming-admin-dropdown">
              <button class="arena-forfeit-btn" data-match-id="${match.id}" data-winner-id="${match.player1_id}" data-winner-name="${p1Name}">
                ${p1Name} wins
              </button>
              <button class="arena-forfeit-btn" data-match-id="${match.id}" data-winner-id="${match.player2_id}" data-winner-name="${p2Name}">
                ${p2Name} wins
              </button>
            </div>
          </div>
        ` : ''}
        <div class="live-match-matchup">
          <div class="live-match-fighter live-match-fighter-left ${p1Won ? 'live-match-winner' : ''} ${p2Won ? 'live-match-loser' : ''}">
            <span class="live-match-fighter-name">${p1Name}</span>
            <span class="live-match-avatar-wrap">${this._renderAvatar(p1Discord, 36)}${p1Won ? '<span class="winner-crown">&#9818;</span>' : ''}</span>
          </div>
          <div class="live-match-center">
            ${match.status !== 'pending' ? `
              <span class="live-match-score">${match.player1_rounds_won} - ${match.player2_rounds_won}</span>
            ` : `
              <span class="live-match-vs">VS</span>
            `}
            <span class="arena-badge ${isLive ? 'badge-red' : 'badge-green'}">${statusLabel}</span>
            ${tiebreakerBadge}
          </div>
          <div class="live-match-fighter live-match-fighter-right ${p2Won ? 'live-match-winner' : ''} ${p1Won ? 'live-match-loser' : ''}">
            <span class="live-match-avatar-wrap">${this._renderAvatar(p2Discord, 36)}${p2Won ? '<span class="winner-crown">&#9818;</span>' : ''}</span>
            <span class="live-match-fighter-name">${p2Name}</span>
          </div>
        </div>
        ${bettingHtml}
        <div class="live-match-footer">
          ${isLive ? `<button class="arena-btn arena-btn-primary arena-btn-small arena-watch-btn" data-match-id="${match.id}">Watch</button>` : ''}
          ${isComplete ? `<button class="arena-btn arena-btn-small arena-watch-btn" data-match-id="${match.id}">View</button>` : ''}
        </div>
      </div>
    `;
  },

  _attachMatchListeners(container) {
    // Match filter toggles
    const toggleChallenges = container.querySelector('#toggle-challenges');
    if (toggleChallenges) {
      toggleChallenges.addEventListener('change', () => {
        this._showChallenges = toggleChallenges.checked;
        this._renderContent(container.closest('.arena-hub') || container);
      });
    }
    const toggleBot = container.querySelector('#toggle-bot');
    if (toggleBot) {
      toggleBot.addEventListener('change', () => {
        this._showBotMatches = toggleBot.checked;
        this._renderContent(container.closest('.arena-hub') || container);
      });
    }

    // Start Match buttons (pending → drafting)
    container.querySelectorAll('.arena-start-match-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const matchId = btn.dataset.matchId;
        const match = this._recentMatches?.find(m => m.id === matchId);
        if (!match) return;

        btn.disabled = true;
        btn.textContent = 'Checking...';
        try {
          // Check if either player is already in an active match
          const [p1Active, p2Active] = await Promise.all([
            arenaData.getActiveMatchForParticipant(match.player1_id),
            arenaData.getActiveMatchForParticipant(match.player2_id)
          ]);

          const busyPlayers = [];
          if (p1Active) busyPlayers.push(this._getParticipantName(match.player1_id));
          if (p2Active) busyPlayers.push(this._getParticipantName(match.player2_id));

          if (busyPlayers.length > 0) {
            toast.error(`Can't start — ${busyPlayers.join(' and ')} already in an active match`);
            btn.disabled = false;
            btn.textContent = 'Start Match';
            return;
          }

          btn.textContent = 'Starting...';
          await arenaData.updateMatch(matchId, { status: 'drafting' });
          router.navigate(`arena-draft?match=${matchId}`);
        } catch (err) {
          toast.error('Failed to start match: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Start Match';
        }
      });
    });

    // Forfeit buttons (admin picks winner)
    container.querySelectorAll('.arena-forfeit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const matchId = btn.dataset.matchId;
        const winnerId = btn.dataset.winnerId;
        const winnerName = btn.dataset.winnerName;
        if (!await arenaConfirm(`Forfeit this match and give the win to ${winnerName}?`, {
          title: 'Forfeit Match',
          confirmText: 'Forfeit',
          danger: true
        })) return;
        btn.disabled = true;
        try {
          await arenaData.forfeitMatch(matchId, winnerId);
          toast.success(`${winnerName} wins by forfeit`);
          await this._loadData();
          const content = document.querySelector('.arena-hub');
          if (content) this._renderContent(content);
        } catch (err) {
          toast.error('Forfeit failed: ' + err.message);
          btn.disabled = false;
        }
      });
    });

    // Admin menu toggles
    container.querySelectorAll('.upcoming-admin-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = btn.closest('.upcoming-admin-menu');
        const wasOpen = menu.classList.contains('open');
        // Close all other open menus
        container.querySelectorAll('.upcoming-admin-menu.open').forEach(m => m.classList.remove('open'));
        if (!wasOpen) menu.classList.add('open');
      });
    });

    // Close admin menus when clicking outside
    document.addEventListener('click', () => {
      container.querySelectorAll('.upcoming-admin-menu.open').forEach(m => m.classList.remove('open'));
    });

    // Force Start buttons (admin starts match on behalf of participants)
    container.querySelectorAll('.admin-force-start-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const matchId = btn.dataset.matchId;
        const match = this._recentMatches?.find(m => m.id === matchId);
        if (!match) return;

        if (!await arenaConfirm('Force start this match? Both players will enter the draft phase.', {
          title: 'Force Start Match',
          confirmText: 'Start',
        })) return;

        btn.disabled = true;
        btn.textContent = 'Starting...';
        try {
          // Check if either player is already in an active match
          const [p1Active, p2Active] = await Promise.all([
            arenaData.getActiveMatchForParticipant(match.player1_id),
            arenaData.getActiveMatchForParticipant(match.player2_id)
          ]);

          const busyPlayers = [];
          if (p1Active) busyPlayers.push(this._getParticipantName(match.player1_id));
          if (p2Active) busyPlayers.push(this._getParticipantName(match.player2_id));

          if (busyPlayers.length > 0) {
            toast.error(`Can't start — ${busyPlayers.join(' and ')} already in an active match`);
            btn.disabled = false;
            btn.textContent = 'Force Start';
            return;
          }

          await arenaData.updateMatch(matchId, { status: 'drafting' });
          toast.success('Match started');
          await this._loadData();
          const content = document.querySelector('.arena-hub');
          if (content) this._renderContent(content);
        } catch (err) {
          toast.error('Failed to start match: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Force Start';
        }
      });
    });

    // Hub bet buttons
    container.querySelectorAll('.hub-bet-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const currentUser = dataService.getUser();
        if (!currentUser || !this._myParticipant) return;

        const matchId = btn.dataset.matchId;
        const backed = btn.dataset.backed;
        const amount = parseInt(btn.dataset.amount);

        btn.disabled = true;
        try {
          await arenaData.placeBet(matchId, currentUser.id, backed, amount);
          // Refresh bets and re-render
          this._matchBets[matchId] = await arenaData.getBetsForMatch(matchId);
          this._tournamentParticipants = await arenaData.getParticipants(this._tournament.id);
          this._updateMyParticipant();
          const content = document.querySelector('.arena-hub');
          if (content) this._renderContent(content);
        } catch (err) {
          toast.error(err.message || 'Bet failed');
          btn.disabled = false;
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
  // REGISTRATION PANEL (shown when tournament is in registration phase)
  // ============================================

  _renderRegistrationPanel() {
    const t = this._tournament;
    const signups = this._tournamentSignups || [];
    const currentUser = dataService.getUser();
    const isSignedUp = currentUser && signups.some(s => s.discord_id === currentUser.id);
    const formatLabel = `${t.match_format || 1}v${t.match_format || 1}`;

    return `
      <div class="arena-panel arena-registration-panel">
        <div class="arena-panel-header">
          <h3>${t.name || 'Tournament'}</h3>
          <span class="arena-badge badge-green">Registration Open</span>
        </div>
        <p class="registration-desc">${formatLabel} format &middot; ${t.bracket_count} brackets &middot; Sign up to participate!</p>
        <div class="registration-player-list">
          ${signups.length === 0
            ? '<div class="registration-empty">No one has signed up yet. Be the first!</div>'
            : signups.map(s => `
              <div class="registration-player-row">
                ${this._renderAvatar(s.discord_id, 22)}
                <span>${this._getDisplayName(s.discord_id)}</span>
              </div>
            `).join('')}
        </div>
        <div class="registration-footer">
          <span class="registration-count">${signups.length} player${signups.length !== 1 ? 's' : ''} signed up</span>
          <div class="registration-actions">
            ${!currentUser
              ? '<span class="registration-login-hint">Log in to sign up</span>'
              : isSignedUp
                ? `<button class="arena-btn arena-btn-danger arena-btn-small" id="registration-leave-btn">Leave</button>`
                : `<button class="arena-btn arena-btn-primary" id="registration-signup-btn">Sign Up</button>`
            }
          </div>
        </div>
      </div>
    `;
  },

  _attachRegistrationListeners(container) {
    const signupBtn = container.querySelector('#registration-signup-btn');
    if (signupBtn) {
      signupBtn.addEventListener('click', async () => {
        const currentUser = dataService.getUser();
        if (!currentUser || !this._tournament) return;
        signupBtn.disabled = true;
        signupBtn.textContent = 'Signing up...';
        try {
          await arenaData.signUp(this._tournament.id, currentUser.id);
          toast.success('You\'re signed up!');
          await this._refreshSignups();
        } catch (err) {
          toast.error('Failed to sign up: ' + err.message);
          signupBtn.disabled = false;
          signupBtn.textContent = 'Sign Up';
        }
      });
    }

    const leaveBtn = container.querySelector('#registration-leave-btn');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', async () => {
        const currentUser = dataService.getUser();
        if (!currentUser || !this._tournament) return;
        leaveBtn.disabled = true;
        try {
          await arenaData.leaveSignUp(this._tournament.id, currentUser.id);
          toast.info('You left the tournament');
          await this._refreshSignups();
        } catch (err) {
          toast.error('Failed: ' + err.message);
          leaveBtn.disabled = false;
        }
      });
    }
  },

  // ============================================
  // TOURNAMENT PANEL (only if a real tournament exists)
  // ============================================

  _renderTournamentPanel() {
    const t = this._tournament;
    const phaseName = t.current_phase?.replace(/_/g, ' ') || 'setup';
    const participants = this._tournamentParticipants || [];
    const matches = this._tournamentMatches || [];
    const pool = t.prizes?.pool || 0;
    const prizeDistribution = pool > 0 ? distributePrizePool(pool, participants.length) : null;

    // Group participants by bracket
    const brackets = {};
    for (const p of participants) {
      const bn = p.bracket_number || 0;
      if (!brackets[bn]) brackets[bn] = [];
      brackets[bn].push(p);
    }

    const bracketNumbers = Object.keys(brackets).sort((a, b) => a - b).filter(bn => bn > 0);

    const isComplete = t.status === 'complete';

    // Current user's gold callout
    const myGoldHtml = this._myParticipant != null && !isComplete
      ? `<div class="tournament-my-gold">Your Gold: <strong>${(this._myParticipant.gold || 0).toLocaleString()}G</strong></div>`
      : '';

    // Final results for completed tournaments
    let finalResultsHtml = '';
    if (isComplete) {
      const semiMatches = matches.filter(m => m.phase === 'semifinals' && m.status === 'complete');
      const finalsMatches = matches.filter(m => m.phase === 'finals' && m.status === 'complete');
      const grandFinalMatch = matches.find(m => m.phase === 'grand_final' && m.status === 'complete');
      const championshipMatch = grandFinalMatch || (finalsMatches.length === 1 ? finalsMatches[0] : null);
      const hasGrandFinal = grandFinalMatch || finalsMatches.length > 1;
      const startingGold = prizeDistribution?.participation || 0;

      // Build placements
      const placements = [];
      if (championshipMatch?.winner_id) {
        placements.push({ pid: championshipMatch.winner_id, place: '1st' });
        const champLoser = championshipMatch.player1_id === championshipMatch.winner_id ? championshipMatch.player2_id : championshipMatch.player1_id;
        placements.push({ pid: champLoser, place: '2nd' });
      } else {
        const semiWinners = semiMatches.map(m => m.winner_id).filter(Boolean);
        if (semiWinners.length === 1) placements.push({ pid: semiWinners[0], place: '1st' });
      }
      // Finals losers get 3rd/4th when grand final exists
      if (hasGrandFinal) {
        const finalsLosers = finalsMatches
          .map(m => m.winner_id ? (m.player1_id === m.winner_id ? m.player2_id : m.player1_id) : null)
          .filter(pid => pid && !placements.some(s => s.pid === pid));
        finalsLosers.forEach(pid => {
          const usedPlaces = placements.map(s => s.place);
          placements.push({ pid, place: !usedPlaces.includes('3rd') ? '3rd' : '4th' });
        });
      }
      const placedIds = new Set(placements.map(s => s.pid));
      const semiLosers = semiMatches
        .map(m => m.winner_id ? (m.player1_id === m.winner_id ? m.player2_id : m.player1_id) : null)
        .filter(pid => pid && !placedIds.has(pid));
      semiLosers.forEach(pid => {
        const usedPlaces = placements.map(s => s.place);
        placements.push({ pid, place: !usedPlaces.includes('3rd') ? '3rd' : !usedPlaces.includes('4th') ? '4th' : `${placements.length + 1}th` });
      });
      const allPlacedIds = new Set(placements.map(s => s.pid));
      const rest = participants
        .filter(p => !allPlacedIds.has(p.id))
        .sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses) || ((b.gold || 0) - (a.gold || 0)));
      let nextPlace = placements.length + 1;
      rest.forEach(p => {
        const suffix = nextPlace === 1 ? 'st' : nextPlace === 2 ? 'nd' : nextPlace === 3 ? 'rd' : 'th';
        placements.push({ pid: p.id, place: `${nextPlace}${suffix}` });
        nextPlace++;
      });

      const placeClasses = { '1st': 'tree-place-1st', '2nd': 'tree-place-2nd', '3rd': 'tree-place-3rd', '4th': 'tree-place-4th' };

      finalResultsHtml = `
        <div class="tournament-final-results">
          <div class="final-results-header">Final Results</div>
          <div class="final-results-list">
            ${placements.map(s => {
              const part = participants.find(p => p.id === s.pid);
              const prizeKey = ['1st','2nd','3rd','4th'].includes(s.place) ? s.place : 'participation';
              const prizeAmount = prizeDistribution?.[prizeKey] || 0;
              const bonus = prizeKey !== 'participation' ? Math.max(0, prizeAmount - startingGold) : 0;
              return `
                <div class="final-results-row ${placeClasses[s.place] || ''}">
                  <span class="final-results-place">${s.place}</span>
                  <span class="final-results-player">${this._renderAvatar(part?.discord_id, 22)} ${this._getDisplayName(part?.discord_id)}</span>
                  <span class="final-results-record">${part?.wins || 0}W ${part?.losses || 0}L</span>
                  ${bonus > 0 ? `<span class="final-results-prize">+${bonus.toLocaleString()}G</span>` : ''}
                  <span class="final-results-gold">${(part?.gold || 0).toLocaleString()}G</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    return `
      <div class="arena-panel arena-tournament-panel">
        <div class="arena-panel-header">
          <h3>${t.name || 'Tournament'}</h3>
          <span class="arena-badge ${isComplete ? 'badge-green' : 'badge-gold'}">${isComplete ? 'complete' : phaseName}</span>
        </div>
        <div class="tournament-info">
          <span>${participants.length} players</span>
          <span>${matches.filter(m => m.status === 'complete').length}/${matches.length} matches done</span>
          ${pool > 0 ? `<span class="tournament-prize-pool-label">${pool.toLocaleString()} Gold Prize Pool</span>` : ''}
        </div>
        ${myGoldHtml}
        ${!isComplete && pool > 0 && prizeDistribution ? `
          <div class="tournament-prize-breakdown">
            ${prizeDistribution['1st'] ? `<span class="prize-tier prize-1st">1st: ${prizeDistribution['1st'].toLocaleString()}G</span>` : ''}
            ${prizeDistribution['2nd'] ? `<span class="prize-tier prize-2nd">2nd: ${prizeDistribution['2nd'].toLocaleString()}G</span>` : ''}
            ${prizeDistribution['3rd'] ? `<span class="prize-tier prize-3rd">3rd: ${prizeDistribution['3rd'].toLocaleString()}G</span>` : ''}
            ${prizeDistribution['4th'] ? `<span class="prize-tier prize-4th">4th: ${prizeDistribution['4th'].toLocaleString()}G</span>` : ''}
            ${prizeDistribution['participation'] ? `<span class="prize-tier prize-participation">Participation: ${prizeDistribution['participation'].toLocaleString()}G</span>` : ''}
          </div>
        ` : ''}
        ${finalResultsHtml}
        ${!isComplete && bracketNumbers.length > 0 ? `
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
                        <span class="bracket-mini-right">
                          <span class="bracket-mini-gold">${(p.gold || 0).toLocaleString()}G</span>
                          <span class="bracket-mini-record">${p.wins}W ${p.losses}L</span>
                        </span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
        ${this._renderTournamentTree(matches, participants, isComplete)}
      </div>
    `;
  },

  _renderTournamentTree(matches, participants, isComplete = false) {
    const semiMatches = matches.filter(m => m.phase === 'semifinals');
    const finalsMatches = matches.filter(m => m.phase === 'finals');
    const grandFinalMatches = matches.filter(m => m.phase === 'grand_final');

    const phase = this._tournament?.current_phase;
    const isActive = phase === 'group_stage' || phase === 'tiebreaker' || phase === 'semifinals'
      || phase === 'finals' || phase === 'grand_final' || phase === 'complete';
    if (!isActive && semiMatches.length === 0 && finalsMatches.length === 0) return '';

    // Determine bracket structure:
    // From actual semi matches if they exist, otherwise predict from bracket count
    const bracketNumbers = [...new Set(
      participants.map(p => p.bracket_number).filter(bn => bn && bn > 0)
    )];
    const bracketCount = bracketNumbers.length || 1;
    // 2+ brackets each send 2 → bracketCount semi matches. Single bracket → 2 semis (top 4 → 2 matches)
    const expectedSemiCount = semiMatches.length > 0 ? semiMatches.length
      : (bracketCount >= 2 ? bracketCount : 2);
    const needsGrandFinal = expectedSemiCount > 2;

    const getName = (pid) => {
      if (!pid) return 'TBD';
      const p = participants.find(pp => pp.id === pid);
      return p ? this._getDisplayName(p.discord_id) : 'TBD';
    };
    const getDiscord = (pid) => {
      const p = participants.find(pp => pp.id === pid);
      return p?.discord_id;
    };
    const renderSlot = (pid, isWinner, isLoser, showCrown = false) => {
      const name = getName(pid);
      const cls = isWinner ? 'tree-slot-winner' : (isLoser ? 'tree-slot-loser' : '');
      return `<div class="tree-slot ${cls}">
        ${pid ? this._renderAvatar(getDiscord(pid), 20) : ''}
        <span class="tree-slot-name">${name}</span>
        ${showCrown && isWinner ? '<span class="tree-slot-crown">&#9818;</span>' : ''}
      </div>`;
    };

    // Render a match — accepts real match object, virtual match with just player IDs, or null for TBD
    const renderMatch = (m, label, isFinal = false) => {
      if (!m) {
        return `<div class="tree-match tree-match-tbd">
          <div class="tree-match-label">${label}</div>
          ${renderSlot(null, false, false)}
          ${renderSlot(null, false, false)}
        </div>`;
      }
      // Virtual match — just has player1_id/player2_id, no status
      if (!m.status) {
        return `<div class="tree-match tree-match-tbd">
          <div class="tree-match-label">${label}</div>
          ${renderSlot(m.player1_id, false, false)}
          ${renderSlot(m.player2_id, false, false)}
        </div>`;
      }
      const isDone = m.status === 'complete';
      const score = isDone || m.player1_rounds_won || m.player2_rounds_won
        ? `${m.player1_rounds_won}-${m.player2_rounds_won}` : '';
      return `<div class="tree-match ${isDone ? 'tree-match-done' : ''}">
        <div class="tree-match-label">${label}${score ? ` <span class="tree-match-score">${score}</span>` : ''}</div>
        ${renderSlot(m.player1_id, isDone && m.winner_id === m.player1_id, isDone && m.winner_id && m.winner_id !== m.player1_id, isFinal)}
        ${renderSlot(m.player2_id, isDone && m.winner_id === m.player2_id, isDone && m.winner_id && m.winner_id !== m.player2_id, isFinal)}
      </div>`;
    };

    // Get semifinal winners (in order of SF 1, SF 2, etc.)
    const semiWinners = semiMatches.map(m =>
      m.status === 'complete' ? m.winner_id : null
    );

    // Build virtual finals slots from semi winners (if actual finals matches don't exist yet)
    const buildFinalsSlots = () => {
      if (finalsMatches.length > 0) return finalsMatches;
      // Pair semi winners: SF1 winner vs SF(last) winner, SF2 winner vs SF(last-1) winner
      const slots = [];
      const half = Math.floor(semiWinners.length / 2);
      for (let i = 0; i < half; i++) {
        const p1 = semiWinners[i] || null;
        const p2 = semiWinners[semiWinners.length - 1 - i] || null;
        slots.push({ player1_id: p1, player2_id: p2 }); // virtual match
      }
      return slots;
    };

    // Build virtual grand final slot from finals winners
    const buildGrandFinalSlot = (finalsSlots) => {
      if (grandFinalMatches.length > 0) return grandFinalMatches[0];
      const finalsWinners = finalsSlots.map(m =>
        m.status === 'complete' ? m.winner_id : null
      );
      if (finalsWinners.some(w => w)) {
        return { player1_id: finalsWinners[0] || null, player2_id: finalsWinners[1] || null };
      }
      return null; // fully TBD
    };

    // Build virtual final slot from semi winners (2-round bracket)
    const buildFinalSlot = () => {
      if (finalsMatches.length > 0) return finalsMatches[0];
      const p1 = semiWinners[0] || null;
      const p2 = semiWinners[1] || null;
      if (p1 || p2) return { player1_id: p1, player2_id: p2 };
      return null;
    };

    // The championship match for standings
    const championshipMatch = grandFinalMatches[0] || (!needsGrandFinal && finalsMatches.length === 1 ? finalsMatches[0] : null);

    // Build standings from bracket results
    const standings = [];
    if (championshipMatch?.status === 'complete' && championshipMatch.winner_id) {
      standings.push({ pid: championshipMatch.winner_id, place: '1st' });
      const champLoser = championshipMatch.player1_id === championshipMatch.winner_id ? championshipMatch.player2_id : championshipMatch.player1_id;
      standings.push({ pid: champLoser, place: '2nd' });
    }
    if (needsGrandFinal) {
      const finalsLosers = finalsMatches
        .filter(m => m.status === 'complete' && m.winner_id)
        .map(m => m.player1_id === m.winner_id ? m.player2_id : m.player1_id)
        .filter(pid => !standings.some(s => s.pid === pid));
      finalsLosers.forEach(pid => standings.push({ pid, place: standings.length < 3 ? '3rd' : '4th' }));
    }
    const semiLosers = semiMatches
      .filter(m => m.status === 'complete' && m.winner_id)
      .map(m => m.player1_id === m.winner_id ? m.player2_id : m.player1_id)
      .filter(pid => !standings.some(s => s.pid === pid));
    semiLosers.forEach(pid => {
      const usedPlaces = standings.map(s => s.place);
      const place = !usedPlaces.includes('3rd') ? '3rd' : !usedPlaces.includes('4th') ? '4th' : `${standings.length + 1}th`;
      standings.push({ pid, place });
    });

    const placedIds = new Set(standings.map(s => s.pid));
    const allBracketPlayerIds = new Set([
      ...semiMatches.flatMap(m => [m.player1_id, m.player2_id]),
      ...finalsMatches.flatMap(m => [m.player1_id, m.player2_id]),
      ...grandFinalMatches.flatMap(m => [m.player1_id, m.player2_id])
    ].filter(Boolean));
    const rest = participants
      .filter(p => !placedIds.has(p.id) && !allBracketPlayerIds.has(p.id))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return (b.gold || 0) - (a.gold || 0);
      });
    let nextPlace = standings.length + 1;
    rest.forEach(p => {
      standings.push({ pid: p.id, place: `${nextPlace}${nextPlace === 1 ? 'st' : nextPlace === 2 ? 'nd' : nextPlace === 3 ? 'rd' : 'th'}` });
      nextPlace++;
    });

    const placeClasses = { '1st': 'tree-place-1st', '2nd': 'tree-place-2nd', '3rd': 'tree-place-3rd', '4th': 'tree-place-4th' };

    // Pad semis to expected count
    const semis = [...semiMatches];
    while (semis.length < expectedSemiCount) semis.push(null);

    // Build bracket HTML
    let bracketHtml;
    if (needsGrandFinal) {
      const finalsSlots = buildFinalsSlots();
      const finals = [...finalsSlots];
      while (finals.length < 2) finals.push(null);
      const gf = buildGrandFinalSlot(finalsSlots);

      bracketHtml = `
        <div class="tree-bracket tree-bracket-3round">
          <div class="tree-round tree-round-semis">
            <div class="tree-round-label">Semifinals</div>
            ${semis.map((m, i) => renderMatch(m, `SF ${i + 1}`)).join('')}
          </div>
          <div class="tree-connectors">
            <div class="tree-connector"></div>
          </div>
          <div class="tree-round tree-round-finals">
            <div class="tree-round-label">Finals</div>
            ${finals.map((m, i) => renderMatch(m, `F ${i + 1}`)).join('')}
          </div>
          <div class="tree-connectors">
            <div class="tree-connector"></div>
          </div>
          <div class="tree-round tree-round-grand-final">
            <div class="tree-round-label">Grand Final</div>
            ${renderMatch(gf, 'Grand Final', true)}
          </div>
        </div>
      `;
    } else {
      const finalSlot = buildFinalSlot();
      bracketHtml = `
        <div class="tree-bracket">
          <div class="tree-round tree-round-semis">
            <div class="tree-round-label">Semifinals</div>
            ${semis.map((m, i) => renderMatch(m, `SF ${i + 1}`)).join('')}
          </div>
          <div class="tree-connectors">
            <div class="tree-connector"></div>
          </div>
          <div class="tree-round tree-round-final">
            <div class="tree-round-label">Final</div>
            ${renderMatch(finalSlot, 'Final', true)}
          </div>
        </div>
      `;
    }

    return `
      <div class="tournament-tree">
        <div class="tree-header">Tournament Bracket</div>
        ${bracketHtml}
        ${standings.length > 0 && !isComplete ? `
          <div class="tree-standings">
            <div class="tree-standings-label">Standings</div>
            <div class="tree-standings-list">
              ${standings.map(s => {
                const part = participants.find(p => p.id === s.pid);
                return `
                <div class="tree-standings-row ${placeClasses[s.place] || ''}">
                  <span class="tree-standings-place">${s.place}</span>
                  <span class="tree-standings-player">${this._renderAvatar(getDiscord(s.pid), 20)} ${getName(s.pid)}</span>
                  <span class="tree-standings-record">${part?.wins || 0}W ${part?.losses || 0}L</span>
                  <span class="tree-standings-gold">${(part?.gold || 0).toLocaleString()}G</span>
                </div>
                `;
              }).join('')}
            </div>
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
    if (this._signupSubscription) {
      arenaData.unsubscribe(this._signupSubscription);
      this._signupSubscription = null;
    }
    if (this._tournamentSubscription) {
      arenaData.unsubscribe(this._tournamentSubscription);
      this._tournamentSubscription = null;
    }
    if (this._participantGoldSubscription) {
      arenaData.unsubscribe(this._participantGoldSubscription);
      this._participantGoldSubscription = null;
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

    if (this._betPollInterval) {
      clearInterval(this._betPollInterval);
      this._betPollInterval = null;
    }
    // Clean up betting timers
    Object.values(this._bettingTimers).forEach(id => clearInterval(id));
    this._bettingTimers = {};
    this._matchBets = {};
    this._myParticipant = null;

    this._pendingChallenge = null;
    this._outgoingChallenge = null;
  }
};

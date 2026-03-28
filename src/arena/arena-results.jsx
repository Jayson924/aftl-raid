import { arenaData } from './arena-data.js';
import { dataService } from '../data.js';
import { router } from '../router.js';
import { ArenaCombat } from './arena-combat.js';
import { DEFAULT_PRIZES, distributePrizePool } from './arena-constants.js';

/**
 * Arena Results — Final standings, prize distribution, match history replay.
 * Route: /arena-results?tournament=<id>
 */
export const ArenaResultsPage = {
  _tournament: null,
  _participants: null,
  _matches: null,
  _appUsers: null,

  async render(container) {
    container.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'arena-results';
    content.innerHTML = '<div class="arena-empty"><p>Loading results...</p></div>';
    container.appendChild(content);

    const params = new URLSearchParams(window.location.search);
    const tournamentId = params.get('tournament');

    try {
      if (tournamentId) {
        this._tournament = await arenaData.getTournament(tournamentId);
      } else {
        // Get most recent completed tournament
        const tournaments = await arenaData.getTournaments();
        this._tournament = tournaments.find(t => t.status === 'complete') || tournaments[0];
      }

      if (!this._tournament) throw new Error('No tournament found');

      const [participants, matches, appUsers] = await Promise.all([
        arenaData.getParticipants(this._tournament.id),
        arenaData.getMatches(this._tournament.id),
        arenaData.getAllAppUsers()
      ]);

      this._participants = participants;
      this._matches = matches;
      this._appUsers = appUsers;

      this._renderContent(content);
    } catch (err) {
      console.error('Results error:', err);
      content.innerHTML = '<div class="arena-empty"><h3>No results available</h3></div>';
    }
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
    const t = this._tournament;
    const pool = t.prizes?.pool || 0;
    const prizes = pool > 0
      ? distributePrizePool(pool, this._participants.length)
      : (t.prizes || DEFAULT_PRIZES);

    // Sort participants by placement
    const finalMatch = this._matches.find(m => m.phase === 'finals' && m.status === 'complete');
    const semiMatches = this._matches.filter(m => m.phase === 'semifinals' && m.status === 'complete');

    // Build placements
    const placements = [];
    if (finalMatch?.winner_id) {
      placements.push({ participantId: finalMatch.winner_id, place: '1st', prize: prizes['1st'] });
      const loserId = finalMatch.winner_id === finalMatch.player1_id ? finalMatch.player2_id : finalMatch.player1_id;
      placements.push({ participantId: loserId, place: '2nd', prize: prizes['2nd'] });
    }

    // Semi losers = 3rd/4th
    for (const semi of semiMatches) {
      if (semi.winner_id) {
        const loserId = semi.winner_id === semi.player1_id ? semi.player2_id : semi.player1_id;
        if (!placements.some(p => p.participantId === loserId)) {
          placements.push({ participantId: loserId, place: '3rd-4th', prize: prizes['3rd'] });
        }
      }
    }

    // Everyone else
    for (const p of this._participants) {
      if (!placements.some(pl => pl.participantId === p.id)) {
        placements.push({ participantId: p.id, place: 'Participant', prize: prizes['participation'] });
      }
    }

    container.innerHTML = `
      <div class="results-header arena-panel">
        <h2>${t.name} - Results</h2>
      </div>

      <div class="results-podium">
        ${placements.slice(0, 4).map((p, i) => `
          <div class="podium-card ${i === 0 ? 'podium-first' : i === 1 ? 'podium-second' : 'podium-third'}">
            <div class="podium-place">${p.place}</div>
            <div class="podium-name">${this._getParticipantName(p.participantId)}</div>
            ${p.prize ? `<div class="podium-prize">${p.prize.toLocaleString()} Gold</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div class="results-standings arena-panel">
        <div class="arena-panel-header">
          <h3>Final Standings</h3>
        </div>
        <table class="arena-standings-table">
          <thead>
            <tr>
              <th>Place</th>
              <th>Player</th>
              <th>W</th>
              <th>L</th>
              <th>Prize</th>
            </tr>
          </thead>
          <tbody>
            ${placements.map(p => {
              const participant = this._participants.find(pt => pt.id === p.participantId);
              return `
                <tr>
                  <td>${p.place}</td>
                  <td>${this._getParticipantName(p.participantId)}</td>
                  <td class="standings-wins">${participant?.wins || 0}</td>
                  <td class="standings-losses">${participant?.losses || 0}</td>
                  <td>${p.prize ? `${p.prize.toLocaleString()} G` : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="results-matches arena-panel">
        <div class="arena-panel-header">
          <h3>Match History</h3>
        </div>
        <div class="results-match-list">
          ${this._matches.filter(m => m.status === 'complete').map(m => `
            <div class="arena-match-card match-complete">
              <div class="match-players">
                <span class="match-player ${m.winner_id === m.player1_id ? 'match-winner' : ''}">${this._getParticipantName(m.player1_id)}</span>
                <span class="match-vs">vs</span>
                <span class="match-player ${m.winner_id === m.player2_id ? 'match-winner' : ''}">${this._getParticipantName(m.player2_id)}</span>
              </div>
              <span class="match-score">${m.player1_rounds_won} - ${m.player2_rounds_won}</span>
              <span class="arena-badge badge-blue">${m.phase.replace(/_/g, ' ')}</span>
              <button class="arena-btn arena-btn-small arena-replay-btn" data-match-id="${m.id}">View</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Replay buttons
    container.querySelectorAll('.arena-replay-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        router.navigate(`arena-spectate?match=${btn.dataset.matchId}`);
      });
    });
  },

  destroy() {
    // cleanup done
  }
};

/**
 * Arena Combat Display Logic
 *
 * Client-side helper for the match screen. Handles:
 * - Subscribing to realtime turn updates
 * - Animating HP changes
 * - Building turn history
 * - Managing ability state display
 */

import { arenaData } from './arena-data.js';
import { ACTION_OUTCOMES, DAMAGE, ABILITY_EFFECTS, getAbilityForClass } from './arena-constants.js';

export class ArenaCombat {
  constructor(matchId, onStateChange) {
    this.matchId = matchId;
    this.onStateChange = onStateChange;
    this._roundSubscription = null;
    this._turnSubscription = null;
    this._currentRoundId = null;
    this.turnHistory = [];
  }

  /**
   * Subscribe to round changes for the match
   */
  subscribeToRounds(callback) {
    this._roundSubscription = arenaData.subscribeToRounds(this.matchId, callback);
    return this._roundSubscription;
  }

  /**
   * Subscribe to turn changes for a specific round
   */
  subscribeToTurns(roundId) {
    // Unsub from previous round's turns
    if (this._turnSubscription) {
      arenaData.unsubscribe(this._turnSubscription);
    }

    this._currentRoundId = roundId;
    this._turnSubscription = arenaData.subscribeToTurns(roundId, (payload) => {
      const turn = payload.new;
      if (turn && turn.resolved) {
        this.turnHistory.push(turn);
        this.onStateChange('turn_resolved', turn);
      } else if (turn) {
        this.onStateChange('turn_update', turn);
      }
    });

    return this._turnSubscription;
  }

  /**
   * Load existing turn history for a round
   */
  async loadTurnHistory(roundId) {
    const turns = await arenaData.getTurns(roundId);
    this.turnHistory = turns.filter(t => t.resolved);
    return this.turnHistory;
  }

  /**
   * Get display label for an action
   */
  static getActionLabel(action) {
    const labels = {
      attack: 'Attack',
      defend: 'Defend',
      strong_attack: 'Strong Attack'
    };
    return labels[action] || action;
  }

  /**
   * Get CSS class for an action
   */
  static getActionClass(action) {
    const classes = {
      attack: 'action-attack',
      defend: 'action-defend',
      strong_attack: 'action-strong'
    };
    return classes[action] || '';
  }

  /**
   * Format a resolution log entry for display
   */
  static formatResolutionEvent(event) {
    switch (event.type) {
      case 'action_reveal':
        return `${event.player} used <strong>${this.getActionLabel(event.action)}</strong>`;
      case 'ability_activate':
        return `${event.player} activated <strong>${event.abilityName}</strong>!`;
      case 'rps_win':
        return `<strong>${event.winner}</strong>'s ${this.getActionLabel(event.winAction)} beats ${event.loser}'s ${this.getActionLabel(event.loseAction)}`;
      case 'damage_dealt':
        return `${event.player} dealt <strong>${event.amount} damage</strong>`;
      case 'damage_received':
        return `${event.player} took <strong>${event.amount} damage</strong>`;
      case 'heal':
        return `${event.player} healed <strong>${event.amount} HP</strong>`;
      case 'highlander_trigger':
        return `${event.player}'s <strong>Highlander</strong> prevented lethal damage!`;
      case 'food_dispenser_result':
        return `Food Dispenser: ${event.label}`;
      case 'clash':
        return event.message || 'Clash! Both used the same action!';
      case 'ko':
        return `${event.player} has been knocked out!`;
      default:
        return event.message || '';
    }
  }

  /**
   * Build turn history HTML
   */
  buildHistoryHtml(p1Name, p2Name) {
    if (this.turnHistory.length === 0) return '<p class="history-empty">No turns yet</p>';

    return [...this.turnHistory].reverse().map(turn => {
      const log = turn.resolution_log;
      const events = log?.events || [];

      return `
        <div class="history-turn">
          <div class="history-turn-header">Turn ${turn.turn_number}</div>
          <div class="history-actions">
            <span class="history-action ${ArenaCombat.getActionClass(turn.player1_action)}">
              ${p1Name}: ${ArenaCombat.getActionLabel(turn.player1_action)}
              ${turn.player1_ability ? ' + Ability' : ''}
            </span>
            <span class="history-action ${ArenaCombat.getActionClass(turn.player2_action)}">
              ${p2Name}: ${ArenaCombat.getActionLabel(turn.player2_action)}
              ${turn.player2_ability ? ' + Ability' : ''}
            </span>
          </div>
          <div class="history-result">
            HP: ${turn.player1_hp_after} vs ${turn.player2_hp_after}
          </div>
          ${events.length > 0 ? `
            <div class="history-events">
              ${events.map(e => `<div class="history-event">${ArenaCombat.formatResolutionEvent(e)}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  destroy() {
    if (this._roundSubscription) arenaData.unsubscribe(this._roundSubscription);
    if (this._turnSubscription) arenaData.unsubscribe(this._turnSubscription);
  }
}

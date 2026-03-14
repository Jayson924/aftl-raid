/**
 * Who's Around — user selection modal + lineup auto-generation
 *
 * Shows a modal where you pick which players are available,
 * then generates an optimised 8-player lineup.
 * Remaining slots are filled with guest class suggestions.
 */

import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { CLASSES, DAMAGE_AMP_SOURCES } from '../constants.js';

// Essential roles that a lineup should always contain
const TANK_CLASSES = ['Guardian', 'Crusader', 'Destroyer'];
const HEALER_CLASSES = ['Saint'];

// ============================================
// MODAL
// ============================================

/**
 * Open the "Who's Around?" modal.
 * @param {Object} opts
 * @param {Array}  opts.players        - All loaded player objects
 * @param {Object} opts.currentLineup  - The current lineup state from the editor
 * @param {Function} opts.onGenerate   - Callback with the generated result array
 */
export async function showWhosAroundModal({ players, currentLineup, onGenerate }) {
  const appUsers = await dataService.getAppUsers();
  const aroundUsers = new Set();

  // Count characters per user
  const charCountByUser = {};
  players.forEach(p => {
    if (p.discordId) {
      charCountByUser[p.discordId] = (charCountByUser[p.discordId] || 0) + 1;
    }
  });

  // Only show users who have characters
  const usersWithChars = appUsers.filter(u => charCountByUser[u.discordId] > 0);

  if (usersWithChars.length === 0) {
    toast.warning('No users with characters found.');
    return;
  }

  const modalElement = document.createElement('div');
  modalElement.className = 'modal';

  modalElement.innerHTML = `
    <div class="modal-content whos-around-modal">
      <h2>Who's Around?</h2>
      <p class="whos-around-desc">Select players who are available, then generate a lineup.</p>
      <div class="whos-around-list" id="whos-around-list">
        ${usersWithChars.map(user => {
          const charCount = charCountByUser[user.discordId] || 0;
          const avatarHtml = user.avatarUrl
            ? `<img class="whos-around-avatar" src="${user.avatarUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : '';
          const initialsHtml = `<div class="whos-around-avatar whos-around-avatar-initials" style="${user.avatarUrl ? 'display:none' : ''}">${(user.displayName || '?').charAt(0).toUpperCase()}</div>`;
          return `
            <div class="whos-around-user" data-discord-id="${user.discordId}">
              ${avatarHtml}
              ${initialsHtml}
              <span class="whos-around-name">${user.displayName}</span>
              <span class="whos-around-chars">${charCount} char${charCount !== 1 ? 's' : ''}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="whos-around-summary" id="whos-around-summary">
        <span>0 players selected</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="generate-lineup-btn" disabled>Generate Lineup</button>
        <button class="btn btn-secondary" id="cancel-around-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);

  const updateSummary = () => {
    const summary = document.getElementById('whos-around-summary');
    const generateBtn = document.getElementById('generate-lineup-btn');
    const totalChars = [...aroundUsers].reduce((sum, id) => sum + (charCountByUser[id] || 0), 0);
    const atMax = aroundUsers.size >= 8;
    summary.innerHTML = `<span>${aroundUsers.size}/8 player${aroundUsers.size !== 1 ? 's' : ''} selected (${totalChars} characters)</span>`;
    generateBtn.disabled = aroundUsers.size === 0;

    // Disable/enable unselected rows when at max
    modalElement.querySelectorAll('.whos-around-user').forEach(r => {
      if (!r.classList.contains('active')) {
        r.classList.toggle('disabled', atMax);
      }
    });
  };

  // Toggle user selection
  modalElement.querySelectorAll('.whos-around-user').forEach(row => {
    row.addEventListener('click', () => {
      const discordId = row.dataset.discordId;
      if (aroundUsers.has(discordId)) {
        aroundUsers.delete(discordId);
        row.classList.remove('active');
      } else {
        if (aroundUsers.size >= 8) return; // Max 8
        aroundUsers.add(discordId);
        row.classList.add('active');
      }
      updateSummary();
    });
  });

  // Generate lineup button
  document.getElementById('generate-lineup-btn').addEventListener('click', async () => {
    const result = generateOptimalLineup([...aroundUsers], players, currentLineup);
    if (!result) return;

    // Check if current lineup has content
    const hasContent = currentLineup.players.some(p => p);
    if (hasContent) {
      const confirmed = await modal.confirm(
        'This will replace the current lineup slots. Continue?',
        { title: 'Generate Lineup', confirmText: 'Generate', cancelText: 'Cancel', danger: true }
      );
      if (!confirmed) return;
    }

    onGenerate(result);
    document.body.removeChild(modalElement);
  });

  // Cancel button
  document.getElementById('cancel-around-btn').addEventListener('click', () => {
    document.body.removeChild(modalElement);
  });

  // Close on backdrop click
  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) {
      document.body.removeChild(modalElement);
    }
  });
}

// ============================================
// LINEUP GENERATION
// ============================================

/**
 * Generate an optimal 8-player lineup from selected users' character pools.
 * Prioritises getting both physical and magic damage amp close to 100%.
 * Always includes a tank (Guardian/Crusader/Destroyer) and a healer (Saint).
 * Remaining slots are filled with guest placeholders suggesting the best class.
 *
 * @param {string[]} aroundDiscordIds - Discord IDs of available users
 * @param {Array}    players          - All player objects
 * @param {Object}   currentLineup    - Current lineup state (for raid type)
 * @returns {Array|null} Array of 8 { name, role, isGuest } entries, or null on failure
 */
export function generateOptimalLineup(aroundDiscordIds, players, currentLineup) {
  const candidates = players.filter(p =>
    aroundDiscordIds.includes(p.discordId) && p.role
  );

  if (candidates.length === 0) {
    toast.error('No characters found for selected players.');
    return null;
  }

  const hasTank = candidates.some(c => TANK_CLASSES.includes(c.role));

  // Phase 1: Greedily pick real characters
  // If we have a tank, try each as seed. Otherwise, try all candidates as seed
  // and we'll fill the tank role via guest later.
  const seeds = hasTank
    ? candidates.filter(c => TANK_CLASSES.includes(c.role))
    : candidates;

  let bestRealLineup = null;
  let bestRealScore = -1;

  for (const seed of seeds) {
    const lineup = [seed];
    const usedUsers = new Set();
    usedUsers.add(seed.discordId);

    // Max real characters = number of selected users
    for (let i = 1; i < aroundDiscordIds.length; i++) {
      let bestCandidate = null;
      let bestCandidateScore = -1;

      for (const candidate of candidates) {
        if (lineup.some(p => p.name === candidate.name)) continue;

        // One character per user
        if (usedUsers.has(candidate.discordId)) continue;

        const testLineup = [...lineup, candidate];
        const score = scoreLineup(testLineup, currentLineup);

        if (score > bestCandidateScore) {
          bestCandidateScore = score;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate) {
        lineup.push(bestCandidate);
        usedUsers.add(bestCandidate.discordId);
      } else {
        break;
      }
    }

    const totalScore = scoreLineup(lineup, currentLineup);
    if (totalScore > bestRealScore) {
      bestRealScore = totalScore;
      bestRealLineup = lineup;
    }
  }

  if (!bestRealLineup || bestRealLineup.length === 0) {
    toast.error('Could not generate a lineup from selected players.');
    return null;
  }

  // Phase 2: Fill remaining slots with guest class suggestions
  const result = bestRealLineup.map(p => ({ name: p.name, role: p.role, isGuest: false }));
  const slotsRemaining = 8 - result.length;

  if (slotsRemaining > 0) {
    const needsTank = () => !result.some(p => TANK_CLASSES.includes(p.role));
    const needsHealer = () => !result.some(p => HEALER_CLASSES.includes(p.role));

    for (let i = 0; i < slotsRemaining; i++) {
      const currentRoles = result.map(p => p.role);
      const currentScore = scoreRoles(currentRoles);
      let bestClass = null;
      let bestClassScore = -Infinity;

      // Force essential roles first: tank, then healer
      let classPool = CLASSES;
      if (needsTank()) {
        classPool = TANK_CLASSES;
      } else if (needsHealer()) {
        classPool = HEALER_CLASSES;
      }

      for (const cls of classPool) {
        const testRoles = [...currentRoles, cls];
        const ampScore = scoreRoles(testRoles);
        const marginalAmp = ampScore - currentScore;

        // Penalize picking a class that shares all amp sources with existing roles
        // (i.e. adds nothing new). Prefer unique classes for diversity.
        const isDuplicate = currentRoles.includes(cls);
        const diversityBonus = isDuplicate ? -10 : 0;

        // Count how many NEW amp sources this class activates
        let newSources = 0;
        for (const source of Object.values(DAMAGE_AMP_SOURCES)) {
          const alreadyActive = source.classes.some(c => currentRoles.includes(c));
          const wouldActivate = source.classes.includes(cls);
          if (wouldActivate && !alreadyActive) newSources++;
        }

        const score = marginalAmp + diversityBonus + (newSources * 2);
        if (score > bestClassScore) {
          bestClassScore = score;
          bestClass = cls;
        }
      }

      result.push({ name: '', role: bestClass, isGuest: true });
    }
  }

  return result;
}

// ============================================
// SCORING
// ============================================

/**
 * Score a lineup of player objects based on damage amp coverage.
 * Higher is better. Max score = 200 (100% physical + 100% magic).
 * Slight bonus for uncleared characters.
 */
function scoreLineup(lineup, currentLineup) {
  const roles = lineup.map(p => p.role).filter(Boolean);
  const baseScore = scoreRoles(roles);

  // Small bonus for characters that still need this raid (prefer uncleared)
  let unclearedBonus = 0;
  for (const player of lineup) {
    if (player.discordId && dataService.playerNeedsRaid(player, currentLineup.raidType)) {
      unclearedBonus += 0.5;
    }
  }

  return baseScore + unclearedBonus;
}

/**
 * Score a list of class roles by damage amp coverage.
 * Max = 200 (100 physical + 100 magic). Overcapping not rewarded.
 */
function scoreRoles(roles) {
  let physicalAmp = 0;
  let magicAmp = 0;

  for (const source of Object.values(DAMAGE_AMP_SOURCES)) {
    const activated = source.classes.some(cls => roles.includes(cls));
    if (activated) {
      physicalAmp += source.physical;
      magicAmp += source.magic;
    }
  }

  return Math.min(physicalAmp, 100) + Math.min(magicAmp, 100);
}

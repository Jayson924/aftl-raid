/**
 * Lineup Creator — generates an optimised 8-player lineup.
 *
 * Picks characters maximising amp coverage + gearscore.
 * Always includes a tank and healer when possible.
 * Remaining slots filled with guest class suggestions, or
 * optionally with characters from any user in the system.
 */

import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { CLASSES, DAMAGE_AMP_SOURCES, calculateGearscore, getGearscoreTier, getLineupSize } from '../constants.js';

// Essential roles that a lineup should always contain
const TANK_CLASSES = ['Guardian', 'Crusader', 'Destroyer'];
const HEALER_CLASSES = ['Saint'];

/**
 * Open the Lineup Creator modal.
 * @param {Object} opts
 * @param {Function} opts.onLoadInEditor - Callback with { result, raidType }
 */
export async function showLineupCreatorModal({ onLoadInEditor }) {
  const [players, appUsers, lineups] = await Promise.all([
    dataService.getPlayers(),
    dataService.getAppUsers(),
    dataService.getLineups()
  ]);

  // Build set of character names already in any lineup
  const namesInLineups = new Set();
  for (const lineup of lineups) {
    if (lineup.completed) continue;
    for (const name of lineup.players) {
      if (name) namesInLineups.add(name);
    }
  }

  // State
  let poolMode = 'all'; // 'all' or 'select'
  let includeCleared = false;
  let includeInExisting = false;
  let selectedUsersOnly = false;
  let raidType = 'DDN Hardcore';
  const selectedUsers = new Set();
  let generatedResult = null;

  // Owners flagged as excluded — their characters are skipped during generation
  const excludedOwnerIds = new Set(
    appUsers.filter(u => u.exclude).map(u => u.discordId)
  );

  // Count characters per user
  const charCountByUser = {};
  players.forEach(p => {
    if (p.discordId) {
      charCountByUser[p.discordId] = (charCountByUser[p.discordId] || 0) + 1;
    }
  });

  const usersWithChars = appUsers.filter(u => charCountByUser[u.discordId] > 0 && !u.exclude);

  const modalElement = document.createElement('div');
  modalElement.className = 'modal';

  const renderModal = () => {
    modalElement.innerHTML = `
      <div class="modal-content lineup-creator-modal">
        <h2>Generate Lineup</h2>

        <div class="creator-section">
          <label class="creator-label">Raid Type</label>
          <div class="creator-toggle-group">
            <button class="creator-toggle ${raidType === 'DDN Hardcore' ? 'active' : ''}" data-raid-type="DDN Hardcore">DDN Hardcore</button>
            <button class="creator-toggle ${raidType === 'DDN Classic' ? 'active' : ''}" data-raid-type="DDN Classic">DDN Classic</button>
            <button class="creator-toggle ${raidType === 'Hardcore' ? 'active' : ''}" data-raid-type="Hardcore">GDN Hardcore</button>
            <button class="creator-toggle ${raidType === 'Classic' ? 'active' : ''}" data-raid-type="Classic">GDN Classic</button>
            <button class="creator-toggle ${raidType === 'Unspecified' ? 'active' : ''}" data-raid-type="Unspecified">Unspecified</button>
          </div>
        </div>

        <div class="creator-section">
          <label class="creator-label">Player Pool</label>
          <div class="creator-toggle-group">
            <button class="creator-toggle ${poolMode === 'all' ? 'active' : ''}" data-pool="all">All Characters</button>
            <button class="creator-toggle ${poolMode === 'select' ? 'active' : ''}" data-pool="select">Select Users</button>
          </div>
        </div>

        ${poolMode === 'select' ? `
          <div class="creator-user-list" id="creator-user-list">
            ${usersWithChars.map(user => {
              const charCount = charCountByUser[user.discordId] || 0;
              const isSelected = selectedUsers.has(user.discordId);
              const avatarHtml = `<img class="whos-around-avatar" src="${user.avatarUrl || '/icons/avatar.svg'}" alt="" onerror="this.src='/icons/avatar.svg'">`;
              const initialsHtml = '';
              return `
                <div class="whos-around-user ${isSelected ? 'active' : ''}" data-discord-id="${user.discordId}">
                  ${avatarHtml}
                  ${initialsHtml}
                  <span class="whos-around-name">${user.displayName}</span>
                  <span class="whos-around-chars">${charCount} char${charCount !== 1 ? 's' : ''}</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="creator-user-summary">
            ${selectedUsers.size} user${selectedUsers.size !== 1 ? 's' : ''} selected
          </div>
        ` : ''}

        <div class="creator-checkboxes">
          <label class="whos-around-option">
            <input type="checkbox" id="creator-include-cleared" ${includeCleared ? 'checked' : ''}>
            <span>Include cleared</span>
          </label>
          <label class="whos-around-option">
            <input type="checkbox" id="creator-include-existing" ${includeInExisting ? 'checked' : ''}>
            <span>Include in existing lineup</span>
          </label>
          <label class="whos-around-option">
            <input type="checkbox" id="creator-selected-only" ${selectedUsersOnly ? 'checked' : ''}>
            <span>Selected users only</span>
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" id="creator-generate-btn" ${poolMode === 'select' && selectedUsers.size === 0 ? 'disabled' : ''}>Generate</button>
          <button class="btn btn-secondary" id="creator-cancel-btn">Cancel</button>
        </div>

        ${generatedResult ? renderPreview(generatedResult, players) : ''}
      </div>
    `;

    attachHandlers();
  };

  const renderPreview = (result, allPlayers) => {
    const playerMap = new Map(allPlayers.map(p => [p.name, p]));

    const cards = result.map((entry, idx) => {
      const player = entry.isGuest ? null : playerMap.get(entry.name);
      const gs = player ? calculateGearscore(player) : 0;
      const tier = player ? getGearscoreTier(gs) : null;

      return `
        <div class="preview-slot ${entry.isGuest ? 'preview-guest' : ''}">
          <span class="preview-slot-num">${idx + 1}</span>
          <div class="preview-slot-info">
            <span class="preview-slot-name">${entry.isGuest ? (entry.role || 'Guest') : entry.name}</span>
            <span class="preview-slot-role">${entry.isGuest ? 'Guest suggestion' : entry.role}</span>
          </div>
          ${player ? `<span class="preview-gs" style="color: ${tier.color}">${gs}</span>` : ''}
        </div>
      `;
    }).join('');

    // Calculate amp totals
    const roles = result.map(e => e.role).filter(Boolean);
    let physicalAmp = 0, magicAmp = 0;
    for (const source of Object.values(DAMAGE_AMP_SOURCES)) {
      if (source.classes.some(cls => roles.includes(cls))) {
        physicalAmp += source.physical;
        magicAmp += source.magic;
      }
    }

    const realCount = result.filter(e => !e.isGuest).length;
    const guestCount = result.filter(e => e.isGuest).length;

    return `
      <div class="creator-preview">
        <div class="creator-preview-header">
          <h3>Preview</h3>
          <div class="creator-preview-stats">
            <span>${realCount} players${guestCount > 0 ? `, ${guestCount} guest${guestCount !== 1 ? 's' : ''}` : ''}</span>
            <span class="preview-amp">Phys ${Math.min(physicalAmp, 100)}% / Magic ${Math.min(magicAmp, 100)}%</span>
          </div>
        </div>
        <div class="creator-preview-grid">
          ${cards}
        </div>
        <button class="btn btn-primary" id="creator-load-btn">Load in Editor</button>
      </div>
    `;
  };

  const attachHandlers = () => {
    // Raid type toggles
    modalElement.querySelectorAll('[data-raid-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        raidType = btn.dataset.raidType;
        generatedResult = null;
        renderModal();
      });
    });

    // Pool mode toggles
    modalElement.querySelectorAll('[data-pool]').forEach(btn => {
      btn.addEventListener('click', () => {
        poolMode = btn.dataset.pool;
        generatedResult = null;
        renderModal();
      });
    });

    // User selection (when in select mode) — toggle in-place without re-rendering
    modalElement.querySelectorAll('.whos-around-user').forEach(row => {
      row.addEventListener('click', () => {
        const discordId = row.dataset.discordId;
        if (selectedUsers.has(discordId)) {
          selectedUsers.delete(discordId);
          row.classList.remove('active');
        } else {
          selectedUsers.add(discordId);
          row.classList.add('active');
        }
        generatedResult = null;

        // Update summary and generate button in-place
        const summary = modalElement.querySelector('.creator-user-summary');
        if (summary) {
          summary.textContent = `${selectedUsers.size} user${selectedUsers.size !== 1 ? 's' : ''} selected`;
        }
        const generateBtn = document.getElementById('creator-generate-btn');
        if (generateBtn) {
          generateBtn.disabled = selectedUsers.size === 0;
        }
      });
    });

    // Include cleared checkbox
    const clearedCb = document.getElementById('creator-include-cleared');
    if (clearedCb) {
      clearedCb.addEventListener('change', (e) => {
        includeCleared = e.target.checked;
        generatedResult = null;
      });
    }

    // Include in existing lineup checkbox
    const existingCb = document.getElementById('creator-include-existing');
    if (existingCb) {
      existingCb.addEventListener('change', (e) => {
        includeInExisting = e.target.checked;
        generatedResult = null;
      });
    }

    // Selected users only checkbox
    const selectedOnlyCb = document.getElementById('creator-selected-only');
    if (selectedOnlyCb) {
      selectedOnlyCb.addEventListener('change', (e) => {
        selectedUsersOnly = e.target.checked;
        generatedResult = null;
      });
    }

    // Generate button
    const generateBtn = document.getElementById('creator-generate-btn');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        const allDiscordIds = usersWithChars.map(u => u.discordId);
        const activeIds = poolMode === 'all' ? allDiscordIds : [...selectedUsers];

        if (activeIds.length === 0) {
          toast.warning('No users selected.');
          return;
        }

        const lineupState = { raidType, players: [] };
        const excludeNames = includeInExisting ? null : namesInLineups;
        generatedResult = generateOptimalLineup(activeIds, players, lineupState, { includeCleared, excludeNames, excludedOwnerIds });

        // Fill guest slots with real characters from all users (unless restricted)
        if (generatedResult && !selectedUsersOnly) {
          generatedResult = fillGuestSlotsWithPlayers(generatedResult, players, lineupState, { includeCleared, excludeNames, excludedOwnerIds });
        }

        if (generatedResult) {
          renderModal();
        }
      });
    }

    // Cancel button
    const cancelBtn = document.getElementById('creator-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modalElement);
      });
    }

    // Load in editor button
    const loadBtn = document.getElementById('creator-load-btn');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        document.body.removeChild(modalElement);
        onLoadInEditor({ result: generatedResult, raidType });
      });
    }
  };

  document.body.appendChild(modalElement);
  renderModal();

  // Close on backdrop click
  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) {
      document.body.removeChild(modalElement);
    }
  });
}

// ============================================
// FILL GUEST SLOTS
// ============================================

/**
 * Replace guest slots with real characters from ALL users (not just selected).
 * One character per user. Greedy by amp + gearscore.
 */
function fillGuestSlotsWithPlayers(result, players, currentLineup, { includeCleared = false, excludeNames = null, excludedOwnerIds = null } = {}) {
  const candidates = players.filter(p =>
    p.discordId && p.role
    && !p.exclude
    && (!excludedOwnerIds || !excludedOwnerIds.has(p.discordId))
    && (includeCleared || dataService.playerNeedsRaid(p, currentLineup.raidType))
    && (!excludeNames || !excludeNames.has(p.name))
  );

  const usedUsers = new Set();
  const usedNames = new Set();
  for (const entry of result) {
    if (entry.isGuest) continue;
    usedNames.add(entry.name);
    const player = candidates.find(p => p.name === entry.name);
    if (player) usedUsers.add(player.discordId);
  }

  const filled = [...result];

  // Check which essential roles are only covered by guest slots
  const realRoles = filled.filter(e => !e.isGuest).map(e => e.role);
  const hasTankReal = realRoles.some(r => TANK_CLASSES.includes(r));
  const hasHealerReal = realRoles.some(r => HEALER_CLASSES.includes(r));

  for (let i = 0; i < filled.length; i++) {
    if (!filled[i].isGuest) continue;

    // Don't replace a guest tank/healer if no real one exists — the lineup needs them
    if (!hasTankReal && TANK_CLASSES.includes(filled[i].role)) continue;
    if (!hasHealerReal && HEALER_CLASSES.includes(filled[i].role)) continue;

    const currentRoles = filled.map(e => e.role).filter(Boolean);
    const currentAmp = scoreRoles(currentRoles);
    let bestCandidate = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      if (usedNames.has(candidate.name)) continue;
      if (usedUsers.has(candidate.discordId)) continue;

      const testRoles = [...currentRoles, candidate.role];
      const ampGain = scoreRoles(testRoles) - currentAmp;
      const gsBonus = calculateGearscore(candidate) * 0.1;
      const score = ampGain + gsBonus;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      filled[i] = { name: bestCandidate.name, role: bestCandidate.role, isGuest: false };
      usedNames.add(bestCandidate.name);
      usedUsers.add(bestCandidate.discordId);
    }
  }

  return filled;
}

// ============================================
// LINEUP GENERATION
// ============================================

/**
 * Generate an optimal 8-player lineup from selected users' character pools.
 * Prioritises getting both physical and magic damage amp close to 100%.
 * Always includes a tank and healer when real candidates exist; reserves
 * guest slots for missing essential roles.
 */
function generateOptimalLineup(aroundDiscordIds, players, currentLineup, { includeCleared = false, excludeNames = null, excludedOwnerIds = null } = {}) {
  const candidates = players.filter(p =>
    aroundDiscordIds.includes(p.discordId) && p.role
    && !p.exclude
    && (!excludedOwnerIds || !excludedOwnerIds.has(p.discordId))
    && (includeCleared || dataService.playerNeedsRaid(p, currentLineup.raidType))
    && (!excludeNames || !excludeNames.has(p.name))
  );

  if (candidates.length === 0) {
    toast.error('No characters found for selected players.');
    return null;
  }

  const tankCandidates = candidates.filter(c => TANK_CLASSES.includes(c.role));
  const healerCandidates = candidates.filter(c => HEALER_CLASSES.includes(c.role));

  // Phase 1: Greedily pick real characters
  // Try each tank+healer combo as seed pair. If no tanks or no healers available,
  // those roles will be filled via guest suggestions in Phase 2.
  const seedPairs = [];

  if (tankCandidates.length > 0 && healerCandidates.length > 0) {
    for (const tank of tankCandidates) {
      for (const healer of healerCandidates) {
        if (tank.discordId === healer.discordId) continue;
        seedPairs.push([tank, healer]);
      }
    }
  }

  if (tankCandidates.length > 0 && seedPairs.length === 0) {
    for (const tank of tankCandidates) seedPairs.push([tank]);
  } else if (healerCandidates.length > 0 && seedPairs.length === 0) {
    for (const healer of healerCandidates) seedPairs.push([healer]);
  }

  // Fallback: no tanks or healers at all
  if (seedPairs.length === 0) {
    for (const c of candidates) seedPairs.push([c]);
  }

  // Reserve guest slots for missing essential roles
  const reservedSlots = (tankCandidates.length === 0 ? 1 : 0) + (healerCandidates.length === 0 ? 1 : 0);

  let bestRealLineup = null;
  let bestRealScore = -1;

  for (const seedPair of seedPairs) {
    const lineup = [...seedPair];
    const usedUsers = new Set(seedPair.map(p => p.discordId));

    const targetSize = getLineupSize(currentLineup.raidType);
    const maxSlots = Math.min(aroundDiscordIds.length, targetSize - reservedSlots);
    for (let i = lineup.length; i < maxSlots; i++) {
      let bestCandidate = null;
      let bestCandidateScore = -1;

      for (const candidate of candidates) {
        if (lineup.some(p => p.name === candidate.name)) continue;
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
    const tankInLineup = lineup.find(p => TANK_CLASSES.includes(p.role));
    const seedPriority = tankInLineup ? TANK_CLASSES.indexOf(tankInLineup.role) : 999;
    const bestTank = bestRealLineup?.find(p => TANK_CLASSES.includes(p.role));
    const bestSeedPriority = bestTank ? TANK_CLASSES.indexOf(bestTank.role) : 999;
    if (totalScore > bestRealScore || (totalScore === bestRealScore && seedPriority < bestSeedPriority)) {
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
  const slotsRemaining = getLineupSize(currentLineup.raidType) - result.length;

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

        const isDuplicate = currentRoles.includes(cls);
        const diversityBonus = isDuplicate ? -10 : 0;

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

function scoreLineup(lineup, currentLineup) {
  const roles = lineup.map(p => p.role).filter(Boolean);
  const baseScore = scoreRoles(roles);

  let gearscoreBonus = 0;
  let unclearedBonus = 0;
  for (const player of lineup) {
    gearscoreBonus += calculateGearscore(player) * 0.1;
    if (player.discordId && dataService.playerNeedsRaid(player, currentLineup.raidType)) {
      unclearedBonus += 0.5;
    }
  }

  return baseScore + gearscoreBonus + unclearedBonus;
}

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

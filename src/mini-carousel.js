import { EQUIPMENT_RARITIES, getClassSpriteStyle, getLineupSize } from './constants.js';
import { dataService } from './data.js';

/**
 * Get equipment-based background gradient for a player card.
 */
export function getEquipmentBackground(player) {
  if (!player) return '';

  const equip = player.equipment || {};
  const weaponRarityVal = equip.mainWeapon?.rarity || player.weapon || '';
  const armorRarityVal = equip.helmet?.rarity || player.armor || '';

  const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === weaponRarityVal);
  const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === armorRarityVal);

  const weaponColor = weaponRarity?.color || '';
  const armorColor = armorRarity?.color || '';

  if (!weaponColor && !armorColor) {
    return '';
  }

  if (weaponColor === armorColor || !weaponColor || !armorColor) {
    const color = weaponColor || armorColor;
    return `background: linear-gradient(135deg, ${color}22 0%, ${color}44 100%);`;
  }

  return `background: linear-gradient(180deg, ${weaponColor}33 0%, ${armorColor}33 100%);`;
}

const PUB_BACKGROUND = 'background: repeating-linear-gradient(45deg, rgba(255, 193, 7, 0.11), rgba(255, 193, 7, 0.15) 10px, rgba(0, 0, 0, 0.3) 10px, rgba(0, 0, 0, 0.3) 20px);';

/**
 * Render a single mini player card HTML string.
 */
function renderMiniPlayerCard(playerName, playerMap, lineup, idx) {
  const hasTicket = lineup.ticketPlayers && lineup.ticketPlayers[idx];
  const showTicketFlag = lineup.raidType === 'Classic';

  let player = null;
  let isPub = false;
  if (playerName && playerName.startsWith('[PUB]')) {
    isPub = true;
    const parts = playerName.substring(5).split('|');
    const pubName = parts[0];
    const pubRole = parts[1];
    player = { name: pubName || pubRole || 'Guest', role: (pubName ? pubRole : '') || '' };
  } else {
    player = playerName ? playerMap.get(playerName) : null;
  }

  if (!player && !playerName) {
    return `
      <div class="mini-player-card empty">
        <div class="mini-player-empty">Empty</div>
      </div>
    `;
  }

  if (!player) {
    // Character was deleted but was in the lineup
    return `
      <div class="mini-player-card">
        <div class="mini-player-info">
          <div class="mini-player-name">${playerName}</div>
        </div>
      </div>
    `;
  }

  const backgroundStyle = isPub ? PUB_BACKGROUND : getEquipmentBackground(player);

  const ticketHtml = showTicketFlag && !isPub
    ? `<div class="ticket-flag-mini ${hasTicket ? 'ticket-flag--active' : 'ticket-flag--inactive'}" title="${hasTicket ? 'Using ticket' : 'No ticket'}"><img src="/icons/ticket.svg" alt="T"></div>`
    : '';

  const pilotName = !isPub && lineup.pilotPlayers && lineup.pilotPlayers[idx] ? lineup.pilotPlayers[idx] : '';
  const pilotDisplay = pilotName ? `<span class="pilot-info-mini"><img src="/icons/headphones.svg" alt="Pilot" class="pilot-info-icon-mini">${pilotName}</span>` : '';

  return `
    <div class="mini-player-card ${isPub ? 'pub-player' : ''}" style="${backgroundStyle}">
      ${ticketHtml}
      ${player.role ? `<div class="class-sprite mini-card-class-bg" style="${getClassSpriteStyle(player.role)}"></div>` : ''}
      <div class="mini-player-info">
        <div class="mini-player-name">${player.name}${isPub ? ' <span class="pub-badge-mini">G</span>' : ''}</div>
        ${pilotDisplay}
        ${player.role ? `<div class="mini-player-role">${player.role}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render mini player cards for a lineup (size depends on raid type).
 * 4-man raids render 4 cards, all others render 8.
 */
export function renderMiniPlayerCards(lineup, playerMap) {
  const size = getLineupSize(lineup.raidType);
  return Array(size).fill(0).map((_, idx) => {
    const playerName = lineup.players[idx];
    return renderMiniPlayerCard(playerName, playerMap, lineup, idx);
  }).join('');
}

/**
 * Render a full mini lineup card (header + player grid).
 * @param {Object} lineup - The lineup object
 * @param {Map} playerMap - Player name → player object map
 * @param {Object} options - Optional settings
 * @param {boolean} options.selected - Whether this card is selected
 * @param {boolean} options.showDeleteButton - Whether to show admin delete button
 */
export function renderMiniLineupCard(lineup, playerMap, options = {}) {
  const isCleared = lineup.completed;
  const { selected = false, showDeleteButton = false } = options;

  const playerCards = renderMiniPlayerCards(lineup, playerMap);

  const deleteBtn = showDeleteButton && dataService.isAdmin()
    ? `<button class="mini-delete-btn" data-lineup-id="${lineup.id}" title="Delete lineup">×</button>`
    : '';

  return `
    <div class="mini-lineup-card ${isCleared ? 'cleared' : ''} ${selected ? 'selected' : ''} ${lineup.isNextWeek ? 'next-week' : ''}" data-lineup-id="${lineup.id}">
      <div class="mini-lineup-header">
        <span class="mini-lineup-name">
          ${lineup.isNextWeek ? '<span class="next-week-badge-mini">NW</span>' : ''}
          ${lineup.name}
        </span>
        <div class="mini-lineup-header-actions">
          <span class="mini-lineup-raid-type">${lineup.raidType === 'Unspecified' ? 'Unspecified' : (lineup.raidType === '4-man' ? '4-Man' : `GDN ${lineup.raidType || 'Hardcore'}`)}</span>
          ${deleteBtn}
        </div>
      </div>
      <div class="mini-lineup-grid ${lineup.raidType === '4-man' ? 'four-man' : ''}">
        ${playerCards}
      </div>
    </div>
  `;
}

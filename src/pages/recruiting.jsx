import { dataService } from '../data.js';
import { calculateGearscore, getGearscoreTier, getClassSpriteStyle } from '../constants.js';

const TANK_CLASSES = ['Guardian'];
const HEALER_CLASSES = ['Saint'];
const SUPPORT_CLASSES = ['Crusader', 'Physician', 'Inquisitor'];

function getClassRole(role) {
  if (TANK_CLASSES.includes(role)) return 'tank';
  if (HEALER_CLASSES.includes(role)) return 'healer';
  if (SUPPORT_CLASSES.includes(role)) return 'support';
  return 'dps';
}

// Party accent colors
const PARTY_COLORS = [
  { main: '#4a9eff', glow: 'rgba(74, 158, 255, 0.35)' },
  { main: '#4ece73', glow: 'rgba(78, 206, 115, 0.35)' },
  { main: '#c084fc', glow: 'rgba(192, 132, 252, 0.35)' },
  { main: '#fb923c', glow: 'rgba(251, 146, 60, 0.35)' },
  { main: '#f472b6', glow: 'rgba(244, 114, 182, 0.35)' },
  { main: '#22d3ee', glow: 'rgba(34, 211, 238, 0.35)' },
];

function generateLineups(players) {
  const tanks = players.filter(p => getClassRole(p.role) === 'tank');
  const healers = players.filter(p => getClassRole(p.role) === 'healer');
  const others = players.filter(p => getClassRole(p.role) !== 'tank' && getClassRole(p.role) !== 'healer');

  const sortByGs = (a, b) => (b._gearscore || 0) - (a._gearscore || 0);
  tanks.sort(sortByGs);
  healers.sort(sortByGs);
  others.sort(sortByGs);

  const lineups = [];
  const usedPlayers = new Set();
  const pairCount = Math.max(tanks.length, healers.length, 1);

  for (let i = 0; i < pairCount; i++) {
    const tank = tanks[i] || null;
    const healer = healers[i] || null;
    const lineup = { tank, healer, dps: [] };

    if (tank) usedPlayers.add(tank.id);
    if (healer) usedPlayers.add(healer.id);

    const lineupAccounts = new Set();
    if (tank?.discordId && tank.accountNumber) lineupAccounts.add(`${tank.discordId}-${tank.accountNumber}`);
    if (healer?.discordId && healer.accountNumber) lineupAccounts.add(`${healer.discordId}-${healer.accountNumber}`);

    for (const player of others) {
      if (lineup.dps.length >= 6) break;
      if (usedPlayers.has(player.id)) continue;
      const accountKey = player.discordId && player.accountNumber ? `${player.discordId}-${player.accountNumber}` : null;
      if (accountKey && lineupAccounts.has(accountKey)) continue;
      lineup.dps.push(player);
      usedPlayers.add(player.id);
      if (accountKey) lineupAccounts.add(accountKey);
    }

    lineups.push(lineup);
  }

  return lineups;
}

// Organic sprawling layout — cores at center, DPS hug outward
function calculateLayout(lineups) {
  const nodes = [];
  const edges = [];

  const numParties = lineups.length;

  // Work in arbitrary units, we'll normalize to viewBox at the end
  const corePairGap = 60;
  const coreOrbitRadius = numParties === 1 ? 0 : 90 + numParties * 20;
  const dpsRadius = 150;

  // Place nodes at origin (0,0) center, then normalize later
  const rawNodes = [];

  lineups.forEach((lineup, pi) => {
    const partyAngle = numParties === 1
      ? -Math.PI / 2
      : (2 * Math.PI * pi / numParties) - Math.PI / 2;

    const coreCx = Math.cos(partyAngle) * coreOrbitRadius;
    const coreCy = Math.sin(partyAngle) * coreOrbitRadius;

    const perpAngle = partyAngle + Math.PI / 2;
    const tankX = coreCx + Math.cos(perpAngle) * corePairGap;
    const tankY = coreCy + Math.sin(perpAngle) * corePairGap;
    const healerX = coreCx - Math.cos(perpAngle) * corePairGap;
    const healerY = coreCy - Math.sin(perpAngle) * corePairGap;

    rawNodes.push({ x: tankX, y: tankY, partyIndex: pi, player: lineup.tank, slotType: 'tank', slotLabel: 'Tank (Guardian)' });
    rawNodes.push({ x: healerX, y: healerY, partyIndex: pi, player: lineup.healer, slotType: 'healer', slotLabel: 'Healer (Saint)' });

    const dpsCount = 6;
    const fanArc = numParties === 1 ? Math.PI * 1.5 : Math.PI * 0.9;
    const halfFan = fanArc / 2;

    for (let d = 0; d < dpsCount; d++) {
      const t = dpsCount === 1 ? 0.5 : d / (dpsCount - 1);
      const angle = partyAngle - halfFan + fanArc * t;
      const stagger = (d % 2 === 0) ? 0 : 30;
      const r = dpsRadius + stagger;

      rawNodes.push({
        x: coreCx + Math.cos(angle) * r,
        y: coreCy + Math.sin(angle) * r,
        partyIndex: pi, player: lineup.dps[d] || null, slotType: 'dps', slotLabel: 'DPS / Support'
      });
    }
  });

  // Compute bounding box and normalize all positions into a 100-900 range (with padding)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  rawNodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const pad = 100; // viewBox padding
  const vbSize = 1000;
  const usable = vbSize - pad * 2;

  // Scale uniformly to preserve aspect ratio
  const scale = Math.min(usable / rangeX, usable / rangeY);
  const offsetX = (vbSize - rangeX * scale) / 2;
  const offsetY = (vbSize - rangeY * scale) / 2;

  rawNodes.forEach(n => {
    n.x = (n.x - minX) * scale + offsetX;
    n.y = (n.y - minY) * scale + offsetY;
  });

  // Now build edges from normalized positions
  // rawNodes are our final nodes array — push into `nodes` which was declared above
  rawNodes.forEach(n => nodes.push(n));
  let nodeIdx = 0;

  lineups.forEach((lineup, pi) => {
    const tankNode = nodes[nodeIdx];
    const healerNode = nodes[nodeIdx + 1];
    edges.push({ x1: tankNode.x, y1: tankNode.y, x2: healerNode.x, y2: healerNode.y, partyIndex: pi });

    const dpsStart = nodeIdx + 2;
    const dpsNodes = nodes.slice(dpsStart, dpsStart + 6);

    dpsNodes.forEach(dn => {
      const distToTank = Math.hypot(dn.x - tankNode.x, dn.y - tankNode.y);
      const distToHealer = Math.hypot(dn.x - healerNode.x, dn.y - healerNode.y);
      const connectTo = distToTank < distToHealer ? tankNode : healerNode;
      edges.push({ x1: connectTo.x, y1: connectTo.y, x2: dn.x, y2: dn.y, partyIndex: pi });
    });

    for (let d = 0; d < dpsNodes.length - 1; d++) {
      edges.push({ x1: dpsNodes[d].x, y1: dpsNodes[d].y, x2: dpsNodes[d + 1].x, y2: dpsNodes[d + 1].y, partyIndex: pi });
    }

    nodeIdx += 8; // 2 core + 6 dps
  });

  // Cross-links between adjacent parties' cores
  if (numParties > 1) {
    for (let i = 0; i < numParties; i++) {
      const next = (i + 1) % numParties;
      const healerNode = nodes[i * 8 + 1];
      const tankNode = nodes[next * 8];
      edges.push({ x1: healerNode.x, y1: healerNode.y, x2: tankNode.x, y2: tankNode.y, partyIndex: -1 });
    }
  }

  return { nodes, edges };
}

function renderWebSVG(edges) {
  const lines = edges.map(e => {
    const isCrossLink = e.partyIndex === -1;
    const color = isCrossLink ? 'rgba(255,255,255,0.08)' : PARTY_COLORS[e.partyIndex % PARTY_COLORS.length].main;
    const opacity = isCrossLink ? 0.3 : 0.18;
    const cls = isCrossLink ? 'web-edge web-edge--cross' : 'web-edge web-edge--party';
    return `<line class="${cls}" data-party="${e.partyIndex}" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${isCrossLink ? 1 : 1.5}" />`;
  });

  return `<svg class="recruit-web__svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">${lines.join('')}</svg>`;
}

function renderNode(node, index) {
  const { x, y, partyIndex, player, slotType, slotLabel } = node;
  const color = PARTY_COLORS[partyIndex % PARTY_COLORS.length];
  const isCore = slotType === 'tank' || slotType === 'healer';
  const sizeClass = isCore ? 'web-node--core' : 'web-node--dps-size';

  if (!player) {
    return `<div class="web-node web-node--empty ${sizeClass}" data-party="${partyIndex}" data-index="${index}"
              style="--nx: ${x}; --ny: ${y}; --party-color: ${color.main}; --party-glow: ${color.glow}">
      <div class="web-node__bubble web-node__bubble--empty">
        <span class="web-node__question">?</span>
      </div>
      <div class="web-node__info">
        <span class="web-node__label">${slotLabel}</span>
        <span class="web-node__recruiting">Recruiting</span>
      </div>
    </div>`;
  }

  const gs = player._gearscore || 0;
  const tier = getGearscoreTier(gs);
  const spriteStyle = getClassSpriteStyle(player.role);
  const roleType = getClassRole(player.role);

  return `<div class="web-node web-node--filled web-node--${roleType} ${sizeClass}" data-party="${partyIndex}" data-index="${index}"
            style="--nx: ${x}; --ny: ${y}; --party-color: ${color.main}; --party-glow: ${color.glow}; --tier-color: ${tier.color}">
    <div class="web-node__bubble" style="border-color: ${tier.color}">
      <div class="class-sprite web-node__icon" style="${spriteStyle}"></div>
    </div>
    <div class="web-node__info">
      <span class="web-node__name">${player.name}</span>
      <span class="web-node__class">${player.role}</span>
      <span class="web-node__gs" style="color: ${tier.color}">${gs}</span>
    </div>
  </div>`;
}

function setupHoverInteraction(container) {
  const allNodes = container.querySelectorAll('.web-node');
  const allEdges = container.querySelectorAll('.web-edge--party');
  const webEl = container.querySelector('.recruit-web');

  function highlightParty(partyIndex) {
    webEl.classList.add('has-highlight');
    allNodes.forEach(n => {
      n.classList.toggle('web-node--highlighted', n.dataset.party === partyIndex);
      n.classList.toggle('web-node--dimmed', n.dataset.party !== partyIndex);
    });
    allEdges.forEach(e => {
      const isMatch = e.dataset.party === partyIndex;
      e.style.strokeOpacity = isMatch ? '0.7' : '0.04';
      e.style.strokeWidth = isMatch ? '2.5' : '1';
    });
  }

  function clearHighlight() {
    webEl.classList.remove('has-highlight');
    allNodes.forEach(n => n.classList.remove('web-node--highlighted', 'web-node--dimmed'));
    allEdges.forEach(e => { e.style.strokeOpacity = ''; e.style.strokeWidth = ''; });
  }

  allNodes.forEach(node => {
    node.addEventListener('mouseenter', () => highlightParty(node.dataset.party));
    node.addEventListener('mouseleave', clearHighlight);
    node.addEventListener('touchstart', (e) => { e.preventDefault(); highlightParty(node.dataset.party); }, { passive: false });
  });

  webEl.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.web-node')) clearHighlight();
  });
}

export const RecruitingPage = {
  async render(container) {
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = 'none';

    container.innerHTML = `
      <div class="recruiting-page">
        <div class="recruiting-hero">
          <h1 class="recruiting-hero__title">AFTL Guild</h1>
          <p class="recruiting-hero__subtitle">Raid Recruitment</p>
          <div class="recruiting-hero__divider"></div>
          <p class="recruiting-hero__desc">We're recruiting geared players for endgame content. Every lineup will have a <strong>Guardian</strong> and a <strong>Saint</strong> at its core.</p>
        </div>
        <div class="recruiting-loading">Loading roster...</div>
        <div class="recruit-web" id="recruit-web"></div>
        <div class="recruiting-legend" id="recruiting-legend"></div>
      </div>
    `;

    try {
      const players = await dataService.getPlayers();
      const qualified = players.map(p => {
        p._gearscore = calculateGearscore(p);
        return p;
      }).filter(p => p._gearscore >= 65);

      const lineups = generateLineups(qualified);
      const { nodes, edges } = calculateLayout(lineups);

      const webContainer = document.getElementById('recruit-web');
      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.remove();

      if (lineups.length === 0) {
        webContainer.innerHTML = `
          <div class="recruiting-empty">
            <p>No raid-ready characters found (gearscore 65+).</p>
            <p>We need <strong>all roles</strong> — join us!</p>
          </div>
        `;
        return;
      }

      const svgHtml = renderWebSVG(edges);
      const nodesHtml = nodes.map((n, i) => renderNode(n, i)).join('');

      webContainer.innerHTML = `
        <div class="recruit-web__canvas">
          ${svgHtml}
          <div class="recruit-web__nodes">${nodesHtml}</div>
        </div>
        <div class="recruit-web__parties">
          ${lineups.map((l, i) => {
            const filled = (l.tank ? 1 : 0) + (l.healer ? 1 : 0) + l.dps.length;
            const c = PARTY_COLORS[i % PARTY_COLORS.length];
            return `<span class="party-tag" data-party="${i}" style="--party-color: ${c.main}">
              Party ${i + 1}: ${filled}/8
            </span>`;
          }).join('')}
        </div>
      `;

      setupHoverInteraction(container);

      // Summary
      let totalOpen = 0;
      const neededRoles = { tank: 0, healer: 0, dps: 0 };
      lineups.forEach(l => {
        if (!l.tank) neededRoles.tank++;
        if (!l.healer) neededRoles.healer++;
        const dpsOpen = 6 - l.dps.length;
        neededRoles.dps += dpsOpen;
        totalOpen += (l.tank ? 0 : 1) + (l.healer ? 0 : 1) + dpsOpen;
      });

      const legendContainer = document.getElementById('recruiting-legend');
      if (totalOpen > 0) {
        const needs = [];
        if (neededRoles.tank > 0) needs.push(`<span class="recruit-need recruit-need--tank">${neededRoles.tank} Guardian${neededRoles.tank > 1 ? 's' : ''}</span>`);
        if (neededRoles.healer > 0) needs.push(`<span class="recruit-need recruit-need--healer">${neededRoles.healer} Saint${neededRoles.healer > 1 ? 's' : ''}</span>`);
        if (neededRoles.dps > 0) needs.push(`<span class="recruit-need recruit-need--dps">${neededRoles.dps} DPS / Support</span>`);

        legendContainer.innerHTML = `
          <div class="recruiting-summary">
            <h3>We're Looking For</h3>
            <div class="recruiting-summary__needs">${needs.join('')}</div>
            <p class="recruiting-summary__note">Minimum gearscore: <strong>65</strong> | All classes welcome for DPS slots</p>
          </div>
        `;
      } else {
        legendContainer.innerHTML = `
          <div class="recruiting-summary recruiting-summary--full">
            <h3>All Parties Full!</h3>
            <p>Check back later for openings.</p>
          </div>
        `;
      }
    } catch (err) {
      console.error('Failed to load recruiting data:', err);
      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load roster data.';
    }
  },

  destroy() {
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = '';
  }
};

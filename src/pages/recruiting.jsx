import { dataService } from '../data.js';
import { calculateGearscore, getGearscoreTier, getClassSpriteStyle } from '../constants.js';
import { toast } from '../toast.js';

function getClassRole(role) {
  if (role === 'Guardian') return 'tank';
  if (role === 'Saint') return 'healer';
  return 'dps';
}

// DPS slot definitions — each party has 6 DPS slots
const DPS_SLOTS = [
  { key: 'swordmaster', label: 'Swordmaster',  classes: ['Gladiator', 'Moon Lord'] },
  { key: 'force_user',  label: 'Force User',   classes: ['Majesty', 'Smasher'] },
  { key: 'ice',         label: 'Elestra',       classes: ['Elestra'] },
  { key: 'mercenary',   label: 'Mercenary',     classes: ['Destroyer', 'Barbarian'] },
  { key: 'acrobat',     label: 'Acrobat',       classes: ['Tempest', 'Wind Walker'] },
  { key: 'dps',         label: 'DPS',           classes: ['Sniper', 'Artillery', 'Shooting Star', 'Gear Master', 'Dark Summoner', 'Soul Eater', 'Blade Dancer', 'Spirit Dancer', 'Crusader', 'Inquisitor', 'Physician', 'Adept', 'Saleana'] },
];

// Saleana/Adept/Elestra special pairing logic:
// If Saleana is in DPS slot → ice slot must be Adept
// If Adept is in ice slot but no Saleana → Elestra is preferred for ice
function getIceSlotLabel(party, playerMap) {
  const dps = party.dps || [];
  const dpsSlotPlayer = dps[5] ? playerMap[dps[5]] : null;
  const iceSlotPlayer = dps[2] ? playerMap[dps[2]] : null;

  if (dpsSlotPlayer?.role === 'Saleana') return 'Adept';
  if (iceSlotPlayer?.role === 'Adept') return 'Saleana';
  if (iceSlotPlayer?.role === 'Saleana') return 'Adept';
  return 'Elestra';
}

function getDpsSlotLabel(dpsIndex, party, playerMap) {
  if (dpsIndex === 2 && party && playerMap) {
    return getIceSlotLabel(party, playerMap);
  }
  if (dpsIndex === 5 && party && playerMap) {
    // If Adept is in ice slot, show "Saleana" hint for DPS slot
    const icePlayer = (party.dps || [])[2] ? playerMap[(party.dps || [])[2]] : null;
    if (icePlayer?.role === 'Adept') return 'Saleana';
  }
  return DPS_SLOTS[dpsIndex]?.label || 'DPS';
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

// Layout: parties in constellation
function calculateLayout(parties, rawParties, playerMap) {
  const nodes = [];
  const edges = [];
  const rawNodes = [];

  const numParties = parties.length;
  const corePairGap = numParties <= 2 ? 70 : 60;
  const coreOrbitRadius = numParties <= 1 ? 0 : 100 + numParties * 35;
  const dpsRadius = numParties <= 2 ? 180 : 160 + numParties * 10;

  // Central hub node at origin (only for multi-party)
  let hubNode = null;
  if (numParties > 1) {
    hubNode = { x: 0, y: 0, partyIndex: -1, player: null, slotType: 'hub', slotKey: 'hub', slotLabel: 'AFTL' };
    rawNodes.push(hubNode);
  }

  parties.forEach((party, pi) => {
    const partyAngle = numParties <= 1
      ? -Math.PI / 2
      : (2 * Math.PI * pi / numParties) - Math.PI / 2;

    const coreCx = Math.cos(partyAngle) * coreOrbitRadius;
    const coreCy = Math.sin(partyAngle) * coreOrbitRadius;

    const perpAngle = partyAngle + Math.PI / 2;
    const tankX = coreCx + Math.cos(perpAngle) * corePairGap;
    const tankY = coreCy + Math.sin(perpAngle) * corePairGap;
    const healerX = coreCx - Math.cos(perpAngle) * corePairGap;
    const healerY = coreCy - Math.sin(perpAngle) * corePairGap;

    rawNodes.push({ x: tankX, y: tankY, partyIndex: pi, player: party.tankPlayer, slotType: 'tank', slotKey: `${pi}-tank-0`, slotLabel: 'Guardian' });
    rawNodes.push({ x: healerX, y: healerY, partyIndex: pi, player: party.healerPlayer, slotType: 'healer', slotKey: `${pi}-healer-0`, slotLabel: 'Saint' });

    const dpsCount = 6;
    const fanArc = numParties <= 1 ? Math.PI * 1.5 : Math.PI * Math.min(1.1, 0.7 + numParties * 0.1);
    const halfFan = fanArc / 2;

    for (let d = 0; d < dpsCount; d++) {
      const t = dpsCount === 1 ? 0.5 : d / (dpsCount - 1);
      const angle = partyAngle - halfFan + fanArc * t;
      const stagger = (d % 2 === 0) ? 0 : 30;
      const r = dpsRadius + stagger;

      rawNodes.push({
        x: coreCx + Math.cos(angle) * r,
        y: coreCy + Math.sin(angle) * r,
        partyIndex: pi, player: party.dpsPlayers[d] || null, slotType: 'dps', slotKey: `${pi}-dps-${d}`, slotLabel: getDpsSlotLabel(d, rawParties?.[pi], playerMap)
      });
    }
  });

  if (rawNodes.length === 0) return { nodes: [], edges: [], hubCenter: null };

  // Normalize all nodes to fit viewBox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  rawNodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const pad = 100;
  const vbSize = 1000;
  const usable = vbSize - pad * 2;
  const scale = Math.min(usable / rangeX, usable / rangeY);
  const offsetX = (vbSize - rangeX * scale) / 2;
  const offsetY = (vbSize - rangeY * scale) / 2;

  rawNodes.forEach(n => {
    n.x = (n.x - minX) * scale + offsetX;
    n.y = (n.y - minY) * scale + offsetY;
  });

  // Repulsion pass — push overlapping non-hub nodes apart
  const minDist = 75; // minimum distance between node centers in viewBox units
  const partyNodes = rawNodes.filter(n => n.slotType !== 'hub');
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < partyNodes.length; i++) {
      for (let j = i + 1; j < partyNodes.length; j++) {
        const a = partyNodes[i], b = partyNodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist && dist > 0) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  rawNodes.forEach(n => nodes.push(n));

  // Hub center coordinates (after normalization) for SVG text
  const hubCenter = hubNode ? { x: hubNode.x, y: hubNode.y } : null;

  // Offset for party node indexing (skip hub node if present)
  const hubOffset = hubNode ? 1 : 0;

  // Build edges for party nodes
  let nodeIdx = hubOffset;
  parties.forEach((party, pi) => {
    const tankNode = nodes[nodeIdx];
    const healerNode = nodes[nodeIdx + 1];
    edges.push({ x1: tankNode.x, y1: tankNode.y, x2: healerNode.x, y2: healerNode.y, partyIndex: pi });

    // Connect cores to hub
    if (hubCenter) {
      edges.push({ x1: hubCenter.x, y1: hubCenter.y, x2: tankNode.x, y2: tankNode.y, partyIndex: -2 });
      edges.push({ x1: hubCenter.x, y1: hubCenter.y, x2: healerNode.x, y2: healerNode.y, partyIndex: -2 });
    }

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

    nodeIdx += 8;
  });

  // Cross-links between adjacent parties
  if (numParties > 1) {
    for (let i = 0; i < numParties; i++) {
      const next = (i + 1) % numParties;
      const healerNode = nodes[i * 8 + hubOffset + 1];
      const tankNode = nodes[next * 8 + hubOffset];
      edges.push({ x1: healerNode.x, y1: healerNode.y, x2: tankNode.x, y2: tankNode.y, partyIndex: -1 });
    }
  }

  return { nodes, edges, hubCenter };
}

function renderWebSVG(edges, hubCenter) {
  const lines = edges.map(e => {
    const isHubLink = e.partyIndex === -2;
    const isCrossLink = e.partyIndex === -1;
    if (isHubLink) {
      return `<line class="web-edge web-edge--hub" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="rgba(244, 196, 48, 0.15)" stroke-opacity="0.4" stroke-width="1" />`;
    }
    const color = isCrossLink ? 'rgba(255,255,255,0.08)' : PARTY_COLORS[e.partyIndex % PARTY_COLORS.length].main;
    const opacity = isCrossLink ? 0.3 : 0.18;
    const cls = isCrossLink ? 'web-edge web-edge--cross' : 'web-edge web-edge--party';
    return `<line class="${cls}" data-party="${e.partyIndex}" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${isCrossLink ? 1 : 1.5}" />`;
  });

  // Hub label in center
  const hubSvg = hubCenter ? `
    <text x="${hubCenter.x}" y="${hubCenter.y - 20}" text-anchor="middle" dominant-baseline="middle"
          font-size="18" font-weight="700" fill="rgba(244, 196, 48, 0.45)" letter-spacing="3">Afterlight</text>
    <text x="${hubCenter.x}" y="${hubCenter.y + 2}" text-anchor="middle" dominant-baseline="middle"
          font-size="18" font-weight="700" fill="rgba(244, 196, 48, 0.45)" letter-spacing="3">Desert Dragon</text>
    <text x="${hubCenter.x}" y="${hubCenter.y + 24}" text-anchor="middle" dominant-baseline="middle"
          font-size="18" font-weight="700" fill="rgba(244, 196, 48, 0.45)" letter-spacing="3">Lineups</text>
  ` : '';

  return `<svg class="recruit-web__svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">${lines.join('')}${hubSvg}</svg>`;
}

function renderNode(node, index, isAdmin) {
  const { x, y, partyIndex, player, slotType, slotLabel, slotKey } = node;
  const color = PARTY_COLORS[partyIndex % PARTY_COLORS.length];
  const isCore = slotType === 'tank' || slotType === 'healer';
  const sizeClass = isCore ? 'web-node--core' : 'web-node--dps-size';
  const draggable = isAdmin && player ? 'draggable="true"' : '';
  const droppable = isAdmin ? 'data-droppable="true"' : '';

  if (!player) {
    const dropLabel = isAdmin ? 'Drop here' : 'Recruiting';
    return `<div class="web-node web-node--empty ${sizeClass}" data-party="${partyIndex}" data-index="${index}" data-slot-key="${slotKey}" ${droppable}
              style="--nx: ${x}; --ny: ${y}; --party-color: ${color.main}; --party-glow: ${color.glow}">
      <div class="web-node__bubble web-node__bubble--empty">
        <span class="web-node__question">?</span>
      </div>
      <div class="web-node__info">
        <span class="web-node__label">${slotLabel}</span>
        <span class="web-node__recruiting">${dropLabel}</span>
      </div>
    </div>`;
  }

  const gs = player._gearscore || 0;
  const tier = getGearscoreTier(gs);
  const spriteStyle = getClassSpriteStyle(player.role);
  const roleType = getClassRole(player.role);

  // Build equipment tooltip
  const tooltipParts = [];
  if (player.weaponEnhance) tooltipParts.push(`Weapon: +${player.weaponEnhance}`);
  if (player.armorEnhance) tooltipParts.push(`Armor: +${player.armorEnhance}`);
  const fd = player.characterStats?.finalDamage;
  if (fd) tooltipParts.push(`FD: ${Number(fd).toLocaleString()}`);
  const tooltipAttr = tooltipParts.length > 0 ? `data-tooltip="${tooltipParts.join('\n')}"` : '';
  const tooltipClass = tooltipParts.length > 0 ? 'tooltip-wrap' : '';

  return `<div class="web-node web-node--filled web-node--${roleType} ${sizeClass} ${tooltipClass}" ${tooltipAttr} data-party="${partyIndex}" data-index="${index}" data-slot-key="${slotKey}" data-player-name="${player.name}" ${draggable} ${droppable}
            style="--nx: ${x}; --ny: ${y}; --party-color: ${color.main}; --party-glow: ${color.glow}; --tier-color: ${tier.color}">
    <div class="web-node__bubble" style="border-color: ${tier.color}">
      <div class="class-sprite web-node__icon" style="${spriteStyle}"></div>
    </div>
    <div class="web-node__info">
      ${isAdmin ? `<span class="web-node__name">${player.name}</span>` : ''}
      <span class="web-node__class">${player.role}</span>
      <span class="web-node__gs" style="color: ${tier.color}">${gs}</span>
    </div>
  </div>`;
}

function setupHoverInteraction(container) {
  const allNodes = container.querySelectorAll('.web-node');
  const allEdges = container.querySelectorAll('.web-edge--party');
  const webEl = container.querySelector('.recruit-web');
  if (!webEl) return;

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
    container.querySelectorAll('.web-node').forEach(n => n.classList.remove('web-node--highlighted', 'web-node--dimmed'));
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

function setupMobileTooltips(container) {
  const tooltipEls = container.querySelectorAll('[data-tooltip], .recruit-need');
  tooltipEls.forEach(el => {
    el.addEventListener('touchstart', (e) => {
      const hasTooltip = el.hasAttribute('data-tooltip') || el.querySelector('.recruit-tip');
      if (!hasTooltip) return;
      const wasVisible = el.classList.contains('tooltip-visible');
      container.querySelectorAll('.tooltip-visible').forEach(t => t.classList.remove('tooltip-visible'));
      if (!wasVisible) {
        el.classList.add('tooltip-visible');
        e.preventDefault();
      }
    }, { passive: false });
  });

  container.addEventListener('touchstart', (e) => {
    if (!e.target.closest('[data-tooltip]') && !e.target.closest('.recruit-need')) {
      container.querySelectorAll('.tooltip-visible').forEach(t => t.classList.remove('tooltip-visible'));
    }
  });
}

const CONFIG_KEY = 'recruiting_lineups';

export const RecruitingPage = {
  allPlayers: [],
  parties: [],       // [{tank: 'name'|null, healer: 'name'|null, dps: ['name'|null x6]}]
  isEditMode: false,
  isDirty: false,
  _container: null,
  _currentPartyIndex: 0,
  _isMobile: false,
  _resizeHandler: null,

  async render(container) {
    this._container = container;
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = 'none';

    // Mobile detection
    this._isMobile = window.matchMedia('(max-width: 600px)').matches;
    this._currentPartyIndex = 0;
    this._resizeHandler = () => {
      const wasMobile = this._isMobile;
      this._isMobile = window.matchMedia('(max-width: 600px)').matches;
      if (wasMobile !== this._isMobile) this.renderConstellation();
    };
    window.addEventListener('resize', this._resizeHandler);

    // Check admin status (session may already be loaded from main.js init)
    await dataService.loadSession();
    this.isEditMode = dataService.isAdmin();

    container.innerHTML = `
      <div class="recruiting-page">
        <div class="recruiting-hero">
          <h1 class="recruiting-hero__title">AFTL Guild</h1>
          <p class="recruiting-hero__subtitle">Raid Recruitment</p>
          <div class="recruiting-hero__divider"></div>
          <p class="recruiting-hero__desc">We're recruiting geared players for endgame content. Every party is built around a <strong>Guardian</strong> and a <strong>Saint</strong>.</p>
        </div>
        ${this.isEditMode ? `
          <div class="recruiting-admin-toolbar">
            <button id="recruiting-new-party" class="btn btn-ghost">+ New Party</button>
            <button id="recruiting-save" class="btn btn-primary">Save Layout</button>
          </div>
        ` : ''}
        <div class="recruiting-loading">Loading roster...</div>
        <div class="recruit-web" id="recruit-web"></div>
        <div class="recruiting-legend" id="recruiting-legend"></div>
      </div>
    `;

    try {
      // Load all players
      const players = await dataService.getPlayers();
      this.allPlayers = players.map(p => {
        p._gearscore = calculateGearscore(p);
        return p;
      }).filter(p => p._gearscore >= 65);

      // Load saved layout
      let saved = await dataService.getAppConfig(CONFIG_KEY);
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch { saved = null; }
      }
      if (saved && Array.isArray(saved) && saved.length > 0) {
        // Clean up stale names — characters that were deleted from the database
        const validNames = new Set(players.map(p => p.name));
        this.parties = saved.map(party => ({
          tank: party.tank && validNames.has(party.tank) ? party.tank : null,
          healer: party.healer && validNames.has(party.healer) ? party.healer : null,
          dps: (party.dps || []).map(name => name && validNames.has(name) ? name : null),
        }));
      } else {
        this.parties = [];
      }

      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.remove();

      this.renderConstellation();

      // Wire up admin buttons
      if (this.isEditMode) {
        document.getElementById('recruiting-new-party')?.addEventListener('click', () => this.addParty());
        document.getElementById('recruiting-save')?.addEventListener('click', () => this.saveLayout());
      }
    } catch (err) {
      console.error('Failed to load recruiting data:', err);
      const loadingEl = container.querySelector('.recruiting-loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load roster data.';
    }
  },

  // Resolve party data (names) into party objects with player references
  resolveParties() {
    const playerMap = {};
    this.allPlayers.forEach(p => { playerMap[p.name] = p; });

    return this.parties.map(party => ({
      tankPlayer: party.tank ? (playerMap[party.tank] || null) : null,
      healerPlayer: party.healer ? (playerMap[party.healer] || null) : null,
      dpsPlayers: (party.dps || []).map(name => name ? (playerMap[name] || null) : null),
    }));
  },

  getAssignedNames() {
    const names = new Set();
    this.parties.forEach(party => {
      if (party.tank) names.add(party.tank);
      if (party.healer) names.add(party.healer);
      (party.dps || []).forEach(n => { if (n) names.add(n); });
    });
    return names;
  },

  renderConstellation() {
    const webContainer = document.getElementById('recruit-web');
    if (!webContainer) return;

    const resolved = this.resolveParties();
    const playerMap = {};
    this.allPlayers.forEach(p => { playerMap[p.name] = p; });
    const assignedNames = this.getAssignedNames();
    const unassigned = this.allPlayers.filter(p => !assignedNames.has(p.name));

    if (this.parties.length === 0 && !this.isEditMode) {
      webContainer.innerHTML = `
        <div class="recruiting-empty">
          <p>No raid parties configured yet.</p>
          <p>Check back soon!</p>
        </div>
      `;
      this.renderSummary();
      return;
    }

    if (this.parties.length === 0 && this.isEditMode) {
      webContainer.innerHTML = `
        <div class="recruiting-empty" style="margin-top: 12px;">
          <p>No parties yet. Click <strong>+ New Party</strong> to get started.</p>
        </div>
        ${this.renderUnassignedPool(unassigned)}
      `;
      this.setupPoolDragHandlers();
      return;
    }

    // Mobile: one party at a time with swipe
    if (this._isMobile && this.parties.length > 0) {
      this.renderMobileCarousel(webContainer, resolved, unassigned, playerMap);
      return;
    }

    const { nodes, edges, hubCenter } = calculateLayout(resolved, this.parties, playerMap);

    const svgHtml = renderWebSVG(edges, hubCenter);
    const partyNodes = nodes.filter(n => n.slotType !== 'hub');
    const nodesHtml = partyNodes.map((n, i) => renderNode(n, i, this.isEditMode)).join('');

    webContainer.innerHTML = `
      <div class="recruit-web__canvas">
        ${svgHtml}
        <div class="recruit-web__nodes">${nodesHtml}</div>
      </div>
      <div class="recruit-web__parties">
        ${this.parties.map((p, i) => {
          const filled = (p.tank ? 1 : 0) + (p.healer ? 1 : 0) + (p.dps || []).filter(Boolean).length;
          const c = PARTY_COLORS[i % PARTY_COLORS.length];
          const deleteBtn = this.isEditMode ? `<button class="party-tag__delete" data-party-index="${i}" title="Delete party">&times;</button>` : '';
          return `<span class="party-tag" data-party="${i}" style="--party-color: ${c.main}">
            Party ${i + 1}: ${filled}/8 ${deleteBtn}
          </span>`;
        }).join('')}
      </div>
      ${this.isEditMode ? this.renderUnassignedPool(unassigned) : ''}
    `;

    setupHoverInteraction(this._container);
    setupMobileTooltips(this._container);
    this.renderSummary();

    if (this.isEditMode) {
      this.setupDragAndDrop();
      this.setupPoolDragHandlers();
      // Delete party buttons
      webContainer.querySelectorAll('.party-tag__delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteParty(parseInt(btn.dataset.partyIndex));
        });
      });
    }
  },

  renderMobileCarousel(webContainer, resolved, unassigned, playerMap) {
    // Clamp index
    if (this._currentPartyIndex >= this.parties.length) {
      this._currentPartyIndex = Math.max(0, this.parties.length - 1);
    }

    const pi = this._currentPartyIndex;
    const singleResolved = [resolved[pi]];
    const { nodes, edges, hubCenter } = calculateLayout(singleResolved, [this.parties[pi]], playerMap);

    // Remap nodes/edges to use real party index (not 0)
    nodes.forEach(n => {
      n.slotKey = n.slotKey.replace(/^0-/, `${pi}-`);
      n.partyIndex = pi;
    });
    edges.forEach(e => {
      if (e.partyIndex === 0) e.partyIndex = pi;
    });

    const svgHtml = renderWebSVG(edges, hubCenter);
    const nodesHtml = nodes.map((n, i) => renderNode(n, i, this.isEditMode)).join('');

    const party = this.parties[pi];
    const filled = (party.tank ? 1 : 0) + (party.healer ? 1 : 0) + (party.dps || []).filter(Boolean).length;
    const color = PARTY_COLORS[pi % PARTY_COLORS.length];
    const deleteBtn = this.isEditMode ? `<button class="party-tag__delete" data-party-index="${pi}" title="Delete party">&times;</button>` : '';

    // Dot indicators
    const dots = this.parties.map((_, i) => {
      const c = PARTY_COLORS[i % PARTY_COLORS.length];
      const active = i === pi ? 'recruit-web__dot--active' : '';
      return `<span class="recruit-web__dot ${active}" data-index="${i}" style="--dot-color: ${c.main}"></span>`;
    }).join('');

    webContainer.innerHTML = `
      <div class="recruit-web__mobile-carousel">
        <div class="recruit-web__canvas">
          ${svgHtml}
          <div class="recruit-web__nodes">${nodesHtml}</div>
        </div>
        <div class="recruit-web__party-label" style="--party-color: ${color.main}">
          Party ${pi + 1}: ${filled}/8 ${deleteBtn}
        </div>
        ${this.parties.length > 1 ? `<div class="recruit-web__dots">${dots}</div>` : ''}
      </div>
      ${this.isEditMode ? this.renderUnassignedPool(unassigned) : ''}
    `;

    setupHoverInteraction(this._container);
    setupMobileTooltips(this._container);
    this.renderSummary();

    // Swipe handling
    this.setupMobileSwipe();

    // Dot clicks
    webContainer.querySelectorAll('.recruit-web__dot').forEach(dot => {
      dot.addEventListener('click', () => {
        this._currentPartyIndex = parseInt(dot.dataset.index);
        this.renderConstellation();
      });
    });

    // Delete party button
    webContainer.querySelectorAll('.party-tag__delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteParty(parseInt(btn.dataset.partyIndex));
      });
    });

    if (this.isEditMode) {
      this.setupDragAndDrop();
      this.setupPoolDragHandlers();
    }
  },

  setupMobileSwipe() {
    const carousel = this._container.querySelector('.recruit-web__mobile-carousel');
    if (!carousel) return;

    let touchStartX = 0;
    carousel.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    carousel.addEventListener('touchend', (e) => {
      const diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          this._currentPartyIndex = (this._currentPartyIndex + 1) % this.parties.length;
        } else {
          this._currentPartyIndex = (this._currentPartyIndex - 1 + this.parties.length) % this.parties.length;
        }
        this.renderConstellation();
      }
    }, { passive: true });
  },

  renderSummary() {
    const legendContainer = document.getElementById('recruiting-legend');
    if (!legendContainer) return;

    if (this.parties.length === 0) {
      legendContainer.innerHTML = '';
      return;
    }

    // Build player map for label resolution
    const playerMap = {};
    this.allPlayers.forEach(p => { playerMap[p.name] = p; });

    // Collect open slots, deduplicated by label with count
    const slotMap = new Map(); // label -> { key, label, classes, count }

    this.parties.forEach(p => {
      if (!p.tank) {
        const existing = slotMap.get('Tank');
        if (existing) { existing.count++; } else { slotMap.set('Tank', { key: 'tank', label: 'Tank', classes: ['Guardian'], count: 1 }); }
      }
      if (!p.healer) {
        const existing = slotMap.get('Healer');
        if (existing) { existing.count++; } else { slotMap.set('Healer', { key: 'healer', label: 'Healer', classes: ['Saint'], count: 1 }); }
      }
      const dps = p.dps || [];
      for (let d = 0; d < 6; d++) {
        if (!dps[d]) {
          const slot = DPS_SLOTS[d];
          if (!slot) continue;
          const label = getDpsSlotLabel(d, p, playerMap);
          const existing = slotMap.get(label);
          if (existing) {
            existing.count++;
          } else {
            let displayClasses;
            if (slot.key === 'ice') {
              // Ice slot: only show the specific class the pairing logic resolved
              displayClasses = [label];
            } else if (slot.key === 'dps') {
              // DPS slot: handled by marquee, classes don't matter for display
              displayClasses = [...slot.classes];
            } else {
              displayClasses = [...slot.classes];
            }
            slotMap.set(label, {
              key: slot.key,
              label,
              classes: displayClasses,
              count: 1,
            });
          }
        }
      }
    });

    const openSlots = [...slotMap.values()];

    if (openSlots.length === 0) {
      legendContainer.innerHTML = `
        <div class="recruiting-summary recruiting-summary--full">
          <h3>All Parties Full</h3>
          <p class="recruiting-summary__note">Guardians and Saints are always welcome — we'll build a new team around you.</p>
        </div>
      `;
      return;
    }

    // Build marquee content for DPS slots
    const dpsClasses = DPS_SLOTS.find(s => s.key === 'dps')?.classes || [];
    const marqueeItems = dpsClasses.map(cls => {
      const spriteStyle = getClassSpriteStyle(cls);
      return `<span class="recruit-marquee__item">
        <span class="recruit-marquee__icon"><span class="class-sprite" style="${spriteStyle}"></span></span>
        <span class="recruit-marquee__name">${cls}</span>
      </span>`;
    }).join('');

    // Build one row per slot type (deduplicated, with count)
    const rows = openSlots.map(({ label, classes, key, count }) => {
      const countBadge = `<span class="recruit-slot__count">${count > 1 ? count + 'x' : ''}</span>`;

      // DPS slot — inline marquee instead of class list
      if (key === 'dps') {
        return `<div class="recruit-slot recruit-slot--dps">
          ${countBadge}
          <span class="recruit-slot__label">${label}</span>
          <div class="recruit-marquee">
            <div class="recruit-marquee__track">
              ${marqueeItems}${marqueeItems}
            </div>
          </div>
        </div>`;
      }

      const classChips = classes.map(cls => {
        const spriteStyle = getClassSpriteStyle(cls);
        return `<span class="recruit-slot__class">
          <span class="recruit-slot__icon"><span class="class-sprite" style="${spriteStyle}"></span></span>
          <span class="recruit-slot__classname">${cls}</span>
        </span>`;
      });

      // Join with "or" separators
      const classesHtml = classChips.reduce((acc, chip, i) => {
        if (i === 0) return chip;
        return acc + '<span class="recruit-slot__or">or</span>' + chip;
      }, '');

      return `<div class="recruit-slot">
        ${countBadge}
        <span class="recruit-slot__label">${label}</span>
        <div class="recruit-slot__classes">${classesHtml}</div>
      </div>`;
    });

    legendContainer.innerHTML = `
      <div class="recruiting-summary">
        <h3>Recruiting</h3>
        <div class="recruiting-summary__slots">${rows.join('')}</div>
      </div>
    `;
  },

  renderUnassignedPool(unassigned) {
    if (unassigned.length === 0) return '<div class="recruit-pool"><p class="recruit-pool__empty">All characters assigned!</p></div>';

    const cards = unassigned.map(player => {
      const gs = player._gearscore || 0;
      const tier = getGearscoreTier(gs);
      const spriteStyle = getClassSpriteStyle(player.role);
      return `<div class="recruit-pool__card" draggable="true" data-player-name="${player.name}" title="${player.name} — ${player.role} (${gs})">
        <div class="recruit-pool__icon">
          <div class="class-sprite" style="${spriteStyle}"></div>
        </div>
        <div class="recruit-pool__details">
          <span class="recruit-pool__name">${player.name}</span>
          <span class="recruit-pool__class">${player.role}</span>
        </div>
        <span class="recruit-pool__gs" style="color: ${tier.color}">${gs}</span>
      </div>`;
    }).join('');

    return `<div class="recruit-pool">
      <h3 class="recruit-pool__title">Available Characters</h3>
      <div class="recruit-pool__grid">${cards}</div>
    </div>`;
  },

  setupPoolDragHandlers() {
    const cards = this._container.querySelectorAll('.recruit-pool__card');
    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        const playerName = card.dataset.playerName;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', playerName);
        e.dataTransfer.setData('sourceSlotKey', `pool-${playerName}`);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

    });
  },

  addParty() {
    this.parties.push({ tank: null, healer: null, dps: [null, null, null, null, null, null] });
    this.isDirty = true;
    this.renderConstellation();
  },

  deleteParty(partyIndex) {
    if (partyIndex < 0 || partyIndex >= this.parties.length) return;
    this.parties.splice(partyIndex, 1);
    this.isDirty = true;
    this.renderConstellation();
  },

  async saveLayout() {
    try {
      // Clean up null-only dps arrays for saving
      const toSave = this.parties.map(p => ({
        tank: p.tank || null,
        healer: p.healer || null,
        dps: (p.dps || []).map(d => d || null),
      }));
      await dataService.setAppConfig(CONFIG_KEY, JSON.stringify(toSave));
      this.isDirty = false;
      toast.show('Layout saved!', 'success');
    } catch (err) {
      console.error('Failed to save layout:', err);
      toast.show('Failed to save layout', 'error');
    }
  },

  // Assign a player name to a slot, return the displaced player name (if any)
  assignToSlot(slotKey, playerName) {
    const [partyStr, slotType, slotIdxStr] = slotKey.split('-');
    const partyIndex = parseInt(partyStr);
    const slotIdx = parseInt(slotIdxStr);
    const party = this.parties[partyIndex];
    if (!party) return null;

    let displaced = null;
    if (slotType === 'tank') {
      displaced = party.tank;
      party.tank = playerName;
    } else if (slotType === 'healer') {
      displaced = party.healer;
      party.healer = playerName;
    } else if (slotType === 'dps') {
      displaced = party.dps[slotIdx];
      party.dps[slotIdx] = playerName;
    }
    return displaced;
  },

  // Remove player from a slot, return the removed name
  removeFromSlot(slotKey) {
    return this.assignToSlot(slotKey, null);
  },

  // Find which slot a player is in, return slotKey or null
  findPlayerSlot(playerName) {
    for (let pi = 0; pi < this.parties.length; pi++) {
      const party = this.parties[pi];
      if (party.tank === playerName) return `${pi}-tank-0`;
      if (party.healer === playerName) return `${pi}-healer-0`;
      for (let d = 0; d < (party.dps || []).length; d++) {
        if (party.dps[d] === playerName) return `${pi}-dps-${d}`;
      }
    }
    return null;
  },

  setupDragAndDrop() {
    const allNodes = this._container.querySelectorAll('.web-node');

    allNodes.forEach(node => {
      // Drag start — filled party slots can be dragged
      node.addEventListener('dragstart', (e) => {
        const playerName = node.dataset.playerName;
        if (!playerName) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', playerName);
        e.dataTransfer.setData('sourceSlotKey', node.dataset.slotKey || '');
        node.classList.add('dragging');
      });

      node.addEventListener('dragend', () => {
        node.classList.remove('dragging');
      });

      // Drop target — party slots accept drops from other slots or from the pool
      if (node.dataset.droppable === 'true') {
        node.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          node.classList.add('drag-over');
        });

        node.addEventListener('dragleave', () => {
          node.classList.remove('drag-over');
        });

        node.addEventListener('drop', (e) => {
          e.preventDefault();
          node.classList.remove('drag-over');

          const playerName = e.dataTransfer.getData('text/plain');
          const sourceSlotKey = e.dataTransfer.getData('sourceSlotKey');
          const targetSlotKey = node.dataset.slotKey;

          if (!playerName || !targetSlotKey) return;

          const isFromPool = sourceSlotKey.startsWith('pool-');
          const isFromSlot = sourceSlotKey && !isFromPool;
          const targetCurrentPlayer = node.dataset.playerName || null;

          if (isFromSlot) {
            if (sourceSlotKey === targetSlotKey) return;
            this.assignToSlot(targetSlotKey, playerName);
            this.assignToSlot(sourceSlotKey, targetCurrentPlayer);
          } else {
            // From pool — displace existing if any
            if (targetCurrentPlayer) {
              this.removeFromSlot(targetSlotKey);
            }
            this.assignToSlot(targetSlotKey, playerName);
          }

          this.isDirty = true;
          this.renderConstellation();
        });
      }

      // Double-click a filled slot to remove back to pool
      if (this.isEditMode) {
        node.addEventListener('dblclick', () => {
          const playerName = node.dataset.playerName;
          const slotKey = node.dataset.slotKey;
          if (!playerName || !slotKey) return;
          this.removeFromSlot(slotKey);
          this.isDirty = true;
          this.renderConstellation();
        });
      }
    });
  },

  destroy() {
    const nav = document.querySelector('nav.main-nav');
    if (nav) nav.style.display = '';
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    this.allPlayers = [];
    this.parties = [];
    this.isDirty = false;
    this._currentPartyIndex = 0;
    this._isMobile = false;
    this._container = null;
  }
};

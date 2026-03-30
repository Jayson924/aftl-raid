import { dataService } from '../data.js';
import { calculateGearscore, getGearscoreTier, getClassSpriteStyle } from '../constants.js';
import { toast } from '../toast.js';

const TANK_CLASSES = ['Guardian'];
const HEALER_CLASSES = ['Saint', 'Physician'];
const SUPPORT_CLASSES = ['Crusader', 'Physician', 'Inquisitor'];

function getClassRole(role) {
  if (TANK_CLASSES.includes(role)) return 'tank';
  if (HEALER_CLASSES.includes(role)) return 'healer';
  if (SUPPORT_CLASSES.includes(role)) return 'support';
  return 'dps';
}

// DPS slot types — each party has 6 DPS slots in this order
const DPS_SLOT_TYPES = [
  { key: 'super_armor',    label: 'Super Armor',          classes: ['Dark Summoner', 'Barbarian', 'Destroyer'] },
  { key: 'ice_debuff',     label: 'Ice Debuff',           classes: ['Adept', 'Elestra'] },
  { key: 'cooldown_mgmt',  label: 'Cooldown Buff',        classes: ['Smasher', 'Majesty'] },
  { key: 'utility_buff',   label: 'Utility Buff',         classes: ['Tempest', 'Wind Walker', 'Physician'] },
  { key: 'open',           label: 'Open Slot',            classes: [] },
  { key: 'open',           label: 'Open Slot',            classes: [] },
];

function getDpsSlotLabel(dpsIndex) {
  return DPS_SLOT_TYPES[dpsIndex]?.label || 'Open Slot';
}

// Find the preferred DPS slot index for a given class
function getPreferredDpsSlot(className) {
  for (let i = 0; i < DPS_SLOT_TYPES.length; i++) {
    if (DPS_SLOT_TYPES[i].classes.includes(className)) return i;
  }
  return -1; // no preferred slot, use any open
}

// Saleana/Adept pairing detection
function detectPairingNeeds(parties, playerMap) {
  const needs = [];
  parties.forEach((party, pi) => {
    const dpsRoles = (party.dps || []).map(name => name ? playerMap[name]?.role : null);
    const hasSaleana = dpsRoles.includes('Saleana');
    const hasAdept = dpsRoles.includes('Adept');
    if (hasSaleana && !hasAdept) {
      needs.push({ need: 'Adept', reason: 'Saleana needs an Adept for synergy + ice debuffs' });
    }
    if (hasAdept && !hasSaleana) {
      needs.push({ need: 'Saleana', reason: 'Adept needs a Saleana for synergy' });
    }
  });
  return needs;
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
function calculateLayout(parties) {
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

    rawNodes.push({ x: tankX, y: tankY, partyIndex: pi, player: party.tankPlayer, slotType: 'tank', slotKey: `${pi}-tank-0`, slotLabel: 'Tank (Guardian)' });
    rawNodes.push({ x: healerX, y: healerY, partyIndex: pi, player: party.healerPlayer, slotType: 'healer', slotKey: `${pi}-healer-0`, slotLabel: 'Healer' });

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
        partyIndex: pi, player: party.dpsPlayers[d] || null, slotType: 'dps', slotKey: `${pi}-dps-${d}`, slotLabel: getDpsSlotLabel(d)
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
          <p class="recruiting-hero__desc">We're recruiting geared players for endgame content. Every lineup will have a <strong>Guardian</strong> and a <strong>Healer</strong> at its core.</p>
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
      }).filter(p => p._gearscore >= 65 && p.name !== 'LycanBolt');

      // Load saved layout
      let saved = await dataService.getAppConfig(CONFIG_KEY);
      if (typeof saved === 'string') {
        try { saved = JSON.parse(saved); } catch { saved = null; }
      }
      if (saved && Array.isArray(saved) && saved.length > 0) {
        this.parties = saved;
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
      this.renderMobileCarousel(webContainer, resolved, unassigned);
      return;
    }

    const { nodes, edges, hubCenter } = calculateLayout(resolved);

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

  renderMobileCarousel(webContainer, resolved, unassigned) {
    // Clamp index
    if (this._currentPartyIndex >= this.parties.length) {
      this._currentPartyIndex = Math.max(0, this.parties.length - 1);
    }

    const pi = this._currentPartyIndex;
    const singleResolved = [resolved[pi]];
    const { nodes, edges, hubCenter } = calculateLayout(singleResolved);

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

    // Count open slots by role
    const neededRoles = { tank: 0, healer: 0 };
    // Count open DPS slots by type
    const dpsSlotNeeds = {};
    DPS_SLOT_TYPES.forEach(st => {
      if (!dpsSlotNeeds[st.key]) dpsSlotNeeds[st.key] = { label: st.label, count: 0 };
    });

    this.parties.forEach(p => {
      if (!p.tank) neededRoles.tank++;
      if (!p.healer) neededRoles.healer++;
      const dps = p.dps || [];
      for (let d = 0; d < 6; d++) {
        if (!dps[d]) {
          const slotType = DPS_SLOT_TYPES[d];
          dpsSlotNeeds[slotType.key].count++;
        }
      }
    });

    // Build player map for pairing detection
    const playerMap = {};
    this.allPlayers.forEach(p => { playerMap[p.name] = p; });
    const pairingNeeds = detectPairingNeeds(this.parties, playerMap);

    let totalOpen = neededRoles.tank + neededRoles.healer;
    Object.values(dpsSlotNeeds).forEach(s => { totalOpen += s.count; });

    const needs = [];

    // Helper: build HTML tooltip with class icons for a list of class names
    function classIconTooltip(classNames) {
      if (!classNames || classNames.length === 0) return '';
      const items = classNames.map(cls => {
        const style = getClassSpriteStyle(cls);
        return `<div class="recruit-tip__item"><div class="class-sprite" style="${style}"></div><span>${cls}</span></div>`;
      }).join('');
      return `<div class="recruit-tip">${items}</div>`;
    }

    // Always show Guardian and Healer
    const alwaysMsg = '<div class="recruit-tip"><div class="recruit-tip__msg">A new team will be created for new Guardians and Healers if the vibes are good!</div></div>';
    if (neededRoles.tank > 0) {
      needs.push(`<span class="recruit-need recruit-need--tank">${neededRoles.tank} Guardian${neededRoles.tank > 1 ? 's' : ''}${classIconTooltip(['Guardian'])}</span>`);
    } else {
      needs.push(`<span class="recruit-need recruit-need--tank recruit-need--always">Guardian${alwaysMsg}</span>`);
    }
    if (neededRoles.healer > 0) {
      needs.push(`<span class="recruit-need recruit-need--healer">${neededRoles.healer} Healer${neededRoles.healer > 1 ? 's' : ''}${classIconTooltip(['Saint', 'Physician'])}</span>`);
    } else {
      needs.push(`<span class="recruit-need recruit-need--healer recruit-need--always">Healer${alwaysMsg}</span>`);
    }

    // Show DPS needs by slot type (skip if 0)
    const dpsTypeStyles = {
      super_armor: 'dps',
      ice_debuff: 'ice',
      cooldown_mgmt: 'cooldown',
      utility_buff: 'utility',
      open: 'dps',
    };
    // Map slot keys to their class lists from DPS_SLOT_TYPES
    const slotClassMap = {};
    DPS_SLOT_TYPES.forEach(st => {
      if (!slotClassMap[st.key]) slotClassMap[st.key] = st.classes;
    });

    Object.entries(dpsSlotNeeds).forEach(([key, { label, count }]) => {
      if (count > 0) {
        const style = dpsTypeStyles[key] || 'dps';
        const tooltip = key !== 'open' ? classIconTooltip(slotClassMap[key] || []) : '';
        needs.push(`<span class="recruit-need recruit-need--${style}">${count} ${label}${tooltip}</span>`);
      }
    });

    // Pairing needs
    pairingNeeds.forEach(({ need, reason }) => {
      needs.push(`<span class="recruit-need recruit-need--pairing"><span class="recruit-need__text">${need}</span><div class="recruit-tip"><div class="recruit-tip__msg">${reason}</div></div></span>`);
    });

    if (totalOpen > 0 || pairingNeeds.length > 0) {
      legendContainer.innerHTML = `
        <div class="recruiting-summary">
          <h3>We're Looking For</h3>
          <div class="recruiting-summary__needs">${needs.join('')}</div>
          <p class="recruiting-summary__note">Minimum gearscore: <strong class="gs-req tooltip-wrap" data-tooltip="Legend +12 Weapons\nLegend +10 Armor\nLegend Accessories\n~950 FD">65</strong></p>
        </div>
      `;
    } else {
      legendContainer.innerHTML = `
        <div class="recruiting-summary">
          <h3>We're Looking For</h3>
          <div class="recruiting-summary__needs">${needs.join('')}</div>
          <p class="recruiting-summary__note">All current parties are full, but we're always welcoming new Guardians and Healers!</p>
        </div>
      `;
    }
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

      // Double-click to auto-assign
      card.addEventListener('dblclick', () => {
        const playerName = card.dataset.playerName;
        const player = this.allPlayers.find(p => p.name === playerName);
        if (!player) return;

        // Check tank/healer first
        for (let pi = 0; pi < this.parties.length; pi++) {
          const party = this.parties[pi];
          if (!party.tank && TANK_CLASSES.includes(player.role)) {
            this.assignToSlot(`${pi}-tank-0`, playerName);
            this.isDirty = true;
            this.renderConstellation();
            return;
          }
          if (!party.healer && HEALER_CLASSES.includes(player.role)) {
            this.assignToSlot(`${pi}-healer-0`, playerName);
            this.isDirty = true;
            this.renderConstellation();
            return;
          }
        }

        // For DPS: prefer the slot that matches the class role
        const preferredIdx = getPreferredDpsSlot(player.role);

        // First pass: try preferred slot index across all parties
        if (preferredIdx >= 0) {
          for (let pi = 0; pi < this.parties.length; pi++) {
            const party = this.parties[pi];
            if (!(party.dps || [])[preferredIdx]) {
              this.assignToSlot(`${pi}-dps-${preferredIdx}`, playerName);
              this.isDirty = true;
              this.renderConstellation();
              return;
            }
          }
        }

        // Second pass: any open DPS slot
        for (let pi = 0; pi < this.parties.length; pi++) {
          const party = this.parties[pi];
          for (let d = 0; d < (party.dps || []).length; d++) {
            if (!party.dps[d]) {
              this.assignToSlot(`${pi}-dps-${d}`, playerName);
              this.isDirty = true;
              this.renderConstellation();
              return;
            }
          }
        }
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

// Reads the gear slots of a character window screenshot: finds the 11 slot frames, then which icon each shows.
import icons from '../data/sim-icons.json' with { type: 'json' };

const SHEET = '/sim/item-icons.webp';
const GRID = 20;  // icons are compared at 20 x 20
// Only the icon's middle is compared: the +N badge, swap and lock buttons sit on its corners.
const INSET = 0.2;
const MIN_SLOT = 20;
const MAX_SLOT = 110;
// Frames are found on a copy at most this wide; a full screen would take seconds otherwise.
const DETECT_WIDTH = 2000;
// Within this score of the winner, another item is offered as an alternative.
const CLOSE = 0.08;
// Below this the match is shown for the user to check.
const SURE_SCORE = 0.45;

let sheetPromise = null;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
}

const loadSheet = () => (sheetPromise ??= loadImage(SHEET));

const scratch = document.createElement('canvas');
scratch.width = GRID; scratch.height = GRID;
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
scratchCtx.imageSmoothingQuality = 'high';

// RGB of a source rectangle scaled to GRID x GRID, mean-removed and unit length.
function signature(source, x, y, w, h) {
  scratchCtx.clearRect(0, 0, GRID, GRID);
  scratchCtx.drawImage(source, x, y, w, h, 0, 0, GRID, GRID);
  const { data } = scratchCtx.getImageData(0, 0, GRID, GRID);
  const out = new Float32Array(GRID * GRID * 3);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4) for (let c = 0; c < 3; c += 1, j += 1) { out[j] = data[i + c]; sum += data[i + c]; }
  const mean = sum / out.length;
  let norm = 0;
  for (let j = 0; j < out.length; j += 1) { out[j] -= mean; norm += out[j] * out[j]; }
  norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < out.length; j += 1) out[j] /= norm;
  return out;
}

const dot = (a, b) => { let s = 0; for (let j = 0; j < a.length; j += 1) s += a[j] * b[j]; return s; };

const iconCache = new Map();
function iconSignature(sheet, cell) {
  if (!iconCache.has(cell)) {
    const { size, cols } = icons;
    const inset = size * INSET;
    iconCache.set(cell, signature(sheet, (cell % cols) * size + inset, Math.floor(cell / cols) * size + inset, size - 2 * inset, size - 2 * inset));
  }
  return iconCache.get(cell);
}

// Slot frames are a bright colored ring on a dark band: a square scores its ring's chroma minus the band's.
// Returns the best squares and the scorer, in the coordinates of a copy at most DETECT_WIDTH wide (scale f).
async function frameHits(image) {
  const f = Math.min(1, DETECT_WIDTH / image.naturalWidth);
  const W = Math.round(image.naturalWidth * f); const H = Math.round(image.naturalHeight * f);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y += 1) {
    let row = 0;
    for (let x = 0; x < W; x += 1) {
      const p = (y * W + x) * 4;
      row += Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]);
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const box = (x0, y0, x1, y1) => I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
  const score = (x, y, s) => {
    const t = Math.max(2, Math.round(s * 0.08));
    if (x - t < 0 || y - t < 0 || x + s + t > W || y + s + t > H) return -Infinity;
    const outer = box(x, y, x + s, y + s);
    const ring = (outer - box(x + t, y + t, x + s - t, y + s - t)) / (s * s - (s - 2 * t) ** 2);
    return ring - (box(x - t, y - t, x + s + t, y + s + t) - outer) / ((s + 2 * t) ** 2 - s * s);
  };
  const hits = [];
  const maxSlot = Math.min(MAX_SLOT, Math.floor(Math.min(W, H) * 0.3));
  // Big screenshots are scanned on every other pixel; each kept square is refined below.
  const stride = W * H > 1e6 ? 2 : 1;
  for (let s = MIN_SLOT; s <= maxSlot; s += Math.max(1, Math.round(s * 0.03))) {
    const top = [];
    let floor = -Infinity;
    for (let y = 0; y < H - s; y += stride) {
      for (let x = 0; x < W - s; x += stride) {
        const v = score(x, y, s);
        if (v <= floor) continue;
        top.push({ score: v, x, y, s });
        if (top.length > 60) { top.sort((p, q) => q.score - p.score); top.length = 60; floor = top[59].score; }
      }
    }
    hits.push(...top);
    await new Promise((resolve) => setTimeout(resolve));  // keeps the page responsive
  }
  hits.sort((p, q) => q.score - p.score);
  const pool = [];
  for (const h of hits) {
    if (pool.every((k) => Math.abs(h.x - k.x) > k.s * 0.6 || Math.abs(h.y - k.y) > k.s * 0.6)) pool.push(h);
    if (pool.length >= 40) break;
  }
  return { pool: stride > 1 ? pool.map((h) => bestNear(score, h.x, h.y, h.s, stride, stride)) : pool, score, f };
}

// The best square of size s within rx, ry of (x, y).
function bestNear(score, x, y, s, rx, ry) {
  let best = null;
  for (let yy = Math.round(y - ry); yy <= y + ry; yy += 1) {
    for (let xx = Math.round(x - rx); xx <= x + rx; xx += 1) {
      const v = score(xx, yy, s);
      if (!best || v > best.score) best = { score: v, x: xx, y: yy, s };
    }
  }
  return best;
}

// The window's layout: a row of 4 accessories, and a column of 7 gear slots just right of it and above it.
// Column slots the scan missed (the helmet's "on" badge lowers its score) are searched where the spacing puts them.
function slotLayout({ pool, score }) {
  let best = null;
  for (const a of pool) {
    const s = a.s;
    const same = (h) => Math.abs(h.s - s) < s * 0.12;
    const row = pool.filter((h) => same(h) && Math.abs(h.y - a.y) < s * 0.25).slice(0, 4).sort((p, q) => p.x - q.x);
    if (row.length < 4) continue;
    const near = pool.filter((h) => same(h) && h.x - row[3].x > 0.5 * s && h.x - row[3].x < 2 * s && row[0].y - h.y > 0 && row[0].y - h.y < 8 * s);
    if (near.length < 4) continue;
    const lead = near.reduce((p, q) => (q.score > p.score ? q : p));
    const found = near.filter((h) => Math.abs(h.x - lead.x) < s * 0.5).sort((p, q) => p.y - q.y);
    if (found.length < 4) continue;
    const bottom = found[found.length - 1];
    if (row[0].y - bottom.y < 0.8 * s || row[0].y - bottom.y > 2 * s) continue;
    const step = Math.min(...found.slice(1).map((h, i) => h.y - found[i].y));
    const column = [];
    for (let k = 6; k >= 0; k -= 1) {
      const y = bottom.y - k * step;
      column.push(found.find((h) => Math.abs(h.y - y) < step * 0.3) || bestNear(score, bottom.x, y, s, s * 0.5, step * 0.3));
    }
    const total = [...row, ...column].reduce((sum, h) => sum + h.score, 0);
    if (!best || total > best.total) best = { total, column, row };
  }
  return best && { gear: best.column, jewelry: best.row };
}

// The candidate whose icon best fits a slot box, searched a little around it.
// Returns { name, score, margin, alternatives: likely other names, best first }.
function matchSlot(sheet, image, box, candidates) {
  const usable = candidates.filter((c) => c.cell !== undefined);
  if (!usable.length) return null;
  const sigs = usable.map((c) => iconSignature(sheet, c.cell));
  const best = new Float32Array(usable.length).fill(-1);
  for (const scale of [0.92, 1, 1.08]) {
    const inner = box.s * scale * (1 - 2 * INSET);
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const cx = box.x + box.s / 2 + (dx / 3) * 0.1 * box.s;
        const cy = box.y + box.s / 2 + (dy / 3) * 0.1 * box.s;
        const sig = signature(image, cx - inner / 2, cy - inner / 2, inner, inner);
        sigs.forEach((s, k) => { const v = dot(sig, s); if (v > best[k]) best[k] = v; });
      }
    }
  }
  const order = usable.map((c, k) => ({ ...c, score: best[k] })).sort((a, b) => b.score - a.score);
  const winner = order[0];
  const other = order.find((c) => c.cell !== winner.cell);
  const margin = winner.score - (other?.score ?? -1);
  // Same icon, or nearly as good: the user picks between them.
  const alternatives = order.slice(1).filter((c) => c.cell === winner.cell || winner.score - c.score < CLOSE).map((c) => c.name);
  return { name: winner.name, score: winner.score, margin, alternatives };
}

// The specialization whose gear icons best fit the 7 gear slots, each read once at its box's middle.
function guessJob(sheet, image, boxes, jobs, gearOf) {
  const sigs = boxes.map((box) => {
    const inner = box.s * (1 - 2 * INSET);
    return signature(image, box.x + box.s * INSET, box.y + box.s * INSET, inner, inner);
  });
  let best = null;
  for (const job of jobs) {
    let total = 0;
    sigs.forEach((sig, i) => {
      let top = -1;
      for (const c of gearOf(job, i)) if (c.cell !== undefined) top = Math.max(top, dot(sig, iconSignature(sheet, c.cell)));
      total += top;
    });
    if (!best || total > best.total) best = { job, total };
  }
  return best?.job ?? null;
}

// Returns { job, slots } (slots: { field, index, name, alternatives, sure }), or null when the window is not found.
// candidatesOf(field, index) gives [{ name, cell }] for the build's class. With guess ({ jobs, gearOf(job, index) })
// the class is told from the gear icons first, and job is the specialization picked.
export async function readGear(src, candidatesOf, guess) {
  const [sheet, image] = await Promise.all([loadSheet(), loadImage(src)]);
  const hits = await frameHits(image);
  const found = slotLayout(hits);
  if (!found) return null;
  const toImage = (h) => ({ x: h.x / hits.f, y: h.y / hits.f, s: h.s / hits.f });
  const boxes = { equipment: found.gear.map(toImage), jewelry: found.jewelry.map(toImage) };
  const job = guess ? guessJob(sheet, image, boxes.equipment, guess.jobs, guess.gearOf) : null;
  const slots = [];
  for (const field of ['equipment', 'jewelry']) {
    boxes[field].forEach((box, index) => {
      const hit = matchSlot(sheet, image, box, job && field === 'equipment' ? guess.gearOf(job, index) : candidatesOf(field, index));
      if (!hit) return;
      slots.push({ field, index, ...hit, sure: hit.score >= SURE_SCORE && !hit.alternatives.length });
    });
  }
  return { job, slots };
}

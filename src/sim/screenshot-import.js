// Character window screenshot -> class, +N and gear in a simulator window (the simulator page or the Add Character builder).
// The target needs build, candidates(), apply(), openSlot() and setJob(), as SimulatorPage has.
import { readGear } from './icon-match.js';
import { toast } from '../toast.js';

// The analyzer's gear keys in the simulator's equipment order.
const VISION_GEAR_KEYS = ['helmet', 'top', 'bottom', 'gloves', 'boots', 'mainWeapon', 'subWeapon'];
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function uploadHtml(prefix) {
  return `
    <div class="modal-upload-section">
      <div class="modal-upload-zone">
        <div class="modal-upload-placeholder">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>Upload/Paste character screenshot</span>
        </div>
        <img id="${prefix}-screenshot-preview" class="modal-screenshot-preview" style="display:none" />
        <input type="file" id="${prefix}-screenshot-input" accept="image/*" style="display:none" />
        <button type="button" class="btn-clear-screenshot" id="${prefix}-clear-screenshot" style="display:none">Clear</button>
      </div>
      <div class="modal-upload-analyze-row" style="display:none" id="${prefix}-analyze-row">
        <button type="button" class="btn-analyze" id="${prefix}-analyze-btn" disabled>Analyze Screenshot</button>
        <span class="upload-status" id="${prefix}-upload-status"></span>
      </div>
    </div>
  `;
}

// Name, class, stats and +N from the Vision analyzer; { error } when it fails.
async function analyze(dataUrl) {
  try {
    const [head, image] = dataUrl.split(',');
    const response = await fetch('/.netlify/functions/analyze-screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mimeType: head.match(/^data:([^;]+)/)?.[1] || 'image/png' }),
    });
    const data = await response.json();
    return data.error && !data.raw ? { error: data.error } : data;
  } catch (err) {
    console.error('Screenshot analysis failed:', err);
    return { error: 'The analyzer did not answer' };
  }
}

// Gear from the slot icons, +N from the analyzer; returns the read slots, or null when no window was found.
// Without the analyzer's class, the gear icons decide it; the window's own specialization goes first,
// so it stays when its gear fits (specializations of one class share gear).
async function readGearInto(target, src, vision) {
  const visionEquipment = vision?.equipment;
  const current = target.build.second_job;
  const jobs = [current, ...target.jobNames().filter((job) => job !== current)];
  const guess = vision?.class ? undefined : { jobs, gearOf: (job, index) => target.gearFor(job, index) };
  const read = await readGear(src, (field, index) => target.candidates(field, index), guess);
  if (!read) return null;
  const { job, slots } = read;
  if (job) {
    if (job !== current) target.setJob(job);
    toast.info(`Class not read, so it was told from the gear: ${job}. Check the specialization.`);
  }
  const changes = [];
  for (const slot of slots) {
    const path = `${slot.field}.${slot.index}`;
    // Potentials can't be seen in the screenshot; a different item doesn't keep the old one's.
    if (target.build[slot.field][slot.index].name !== slot.name) changes.push([`${path}.enchants`, []]);
    changes.push([`${path}.name`, slot.name]);
    // Without an analyzer answer the window's +N stays; with one, an unread +N is 0.
    if (slot.field === 'equipment' && visionEquipment) changes.push([`${path}.enhance`, Number(visionEquipment[VISION_GEAR_KEYS[slot.index]]?.enhancement) || 0]);
  }
  target.apply(changes);
  return slots;
}

// Slots whose icon is shared or close to another item's: the user confirms or swaps them.
export function renderGearReview(el, target, slots) {
  const draw = () => {
    el.hidden = !slots.length;
    el.innerHTML = slots.length ? `
      <div class="gear-review-head"><strong>Check ${slots.length === 1 ? 'this slot' : `these ${slots.length} slots`}</strong><span>the icons look alike</span>
        <button type="button" class="gear-review-done" data-review-done>Done</button></div>
      ${slots.map((slot, i) => {
        const item = target.build[slot.field][slot.index];
        const names = [slot.name, ...slot.alternatives];
        return `<div class="gear-review-row">
          <button type="button" class="gear-review-slot" data-review-open="${i}">${esc(item.slot)}</button>
          <div class="gear-review-picks">${names.map((name) => `<button type="button" class="${name === item.name ? 'active' : ''}" data-review-pick="${i}" data-name="${esc(name)}">${esc(name)}</button>`).join('')}</div>
        </div>`;
      }).join('')}` : '';
  };
  el.onclick = (e) => {
    if (e.target.closest('[data-review-done]')) { slots = []; draw(); return; }
    const open = e.target.closest('[data-review-open]');
    const pick = e.target.closest('[data-review-pick]');
    const slot = slots[Number(open ? open.dataset.reviewOpen : pick?.dataset.reviewPick)];
    if (!slot) return;
    const path = `${slot.field}.${slot.index}`;
    if (pick) target.apply([[`${path}.name`, pick.dataset.name]]);
    target.openSlot(path);
    draw();
  };
  draw();
}

// Wires an uploadHtml block: paste, drop or pick an image, then Analyze reads it into getTarget().
// onAnalyzed(data) gets the analyzer's answer first (name, stats); onRead(slots) gets the gear slots read.
export function setupUpload(root, prefix, { getTarget, onAnalyzed, onRead }) {
  const uploadZone = root.querySelector('.modal-upload-zone');
  const fileInput = root.querySelector(`#${prefix}-screenshot-input`);
  const analyzeBtn = root.querySelector(`#${prefix}-analyze-btn`);
  const clearBtn = root.querySelector(`#${prefix}-clear-screenshot`);
  const analyzeRow = root.querySelector(`#${prefix}-analyze-row`);
  const preview = root.querySelector(`#${prefix}-screenshot-preview`);
  const placeholder = root.querySelector('.modal-upload-placeholder');
  const status = root.querySelector(`#${prefix}-upload-status`);
  let loaded = false;

  const handleFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
      clearBtn.style.display = 'inline-flex';
      analyzeRow.style.display = 'flex';
      analyzeBtn.disabled = false;
      loaded = true;
    };
    reader.readAsDataURL(file);
  };

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  const onPaste = (e) => {
    if (!document.body.contains(root)) { document.removeEventListener('paste', onPaste); return; }
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    handleFile(item.getAsFile());
  };
  document.addEventListener('paste', onPaste);

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    loaded = false;
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
    clearBtn.style.display = 'none';
    analyzeRow.style.display = 'none';
    analyzeBtn.disabled = true;
    status.textContent = '';
    status.style.color = '';
    fileInput.value = '';
  });

  analyzeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!loaded) return;
    analyzeBtn.disabled = true;
    status.textContent = 'Analyzing...';
    status.style.color = '';
    const answer = await analyze(preview.src);
    const data = answer.error ? null : answer;
    const target = getTarget();
    // The class decides which gear the icons are matched against.
    if (data) {
      onAnalyzed?.(data);
      if (data.class) target.setJob(data.class);
    }
    let slots = null;
    try {
      slots = await readGearInto(target, preview.src, data);
    } catch (err) {
      console.error('Reading gear from the screenshot failed:', err);
    }
    status.textContent = [data ? 'Class and stats read' : `Class and stats not read (${answer.error})`, slots ? `${slots.length} gear slots read` : 'gear slots not found'].join(' · ');
    status.style.color = data && slots ? '#4caf50' : '';
    if (data || slots) toast.success('Screenshot read — check the gear before saving');
    else toast.error('Could not read the screenshot');
    analyzeBtn.disabled = false;
    onRead?.(slots, data);
  });
}

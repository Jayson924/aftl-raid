import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

const PORTRAIT_WIDTH = 300;
const PORTRAIT_HEIGHT = 400;
const ASPECT_RATIO = 3 / 4;

/**
 * Portrait Upload Modal — Upload and crop character portrait to 3:4 ratio.
 * Uses canvas-based cropping, saves to Supabase Storage bucket `arena-portraits`.
 */
export function showPortraitUploadModal(playerId, onUploaded) {
  const currentUser = dataService.getUser();
  if (!currentUser) {
    toast.error('Login required');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <h2>Upload Portrait</h2>
      <div class="portrait-upload-area" id="portrait-upload-area">
        <input type="file" id="portrait-file-input" accept="image/*" style="display: none;">
        <canvas id="portrait-canvas" width="${PORTRAIT_WIDTH}" height="${PORTRAIT_HEIGHT}" style="display: none;"></canvas>
        <div class="portrait-preview" id="portrait-preview">
          <p>Click or drag to upload an image</p>
        </div>
      </div>
      <div class="portrait-crop-controls" id="portrait-crop-controls" style="display: none;">
        <label>Zoom</label>
        <input type="range" id="portrait-zoom" min="1" max="3" step="0.05" value="1">
        <label>X Offset</label>
        <input type="range" id="portrait-offset-x" min="-100" max="100" step="1" value="0">
        <label>Y Offset</label>
        <input type="range" id="portrait-offset-y" min="-100" max="100" step="1" value="0">
      </div>
      <div class="form-actions" style="margin-top: 1rem;">
        <button class="btn btn-secondary" id="portrait-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="portrait-save-btn" disabled>Upload</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let loadedImage = null;

  const fileInput = document.getElementById('portrait-file-input');
  const canvas = document.getElementById('portrait-canvas');
  const ctx = canvas.getContext('2d');
  const preview = document.getElementById('portrait-preview');
  const cropControls = document.getElementById('portrait-crop-controls');
  const zoomSlider = document.getElementById('portrait-zoom');
  const offsetXSlider = document.getElementById('portrait-offset-x');
  const offsetYSlider = document.getElementById('portrait-offset-y');
  const saveBtn = document.getElementById('portrait-save-btn');

  // Click to upload
  preview.addEventListener('click', () => fileInput.click());

  // Drag and drop
  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('drag-over'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('drag-over'));
  preview.addEventListener('drop', (e) => {
    e.preventDefault();
    preview.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        loadedImage = img;
        canvas.style.display = 'block';
        cropControls.style.display = 'block';
        saveBtn.disabled = false;
        preview.innerHTML = '';
        preview.appendChild(canvas);
        drawCroppedImage();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function drawCroppedImage() {
    if (!loadedImage) return;

    const zoom = parseFloat(zoomSlider.value);
    const offsetX = parseInt(offsetXSlider.value);
    const offsetY = parseInt(offsetYSlider.value);

    ctx.clearRect(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    ctx.fillStyle = '#1a1209';
    ctx.fillRect(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);

    // Calculate fitting
    const imgRatio = loadedImage.width / loadedImage.height;
    let drawW, drawH;

    if (imgRatio > ASPECT_RATIO) {
      drawH = PORTRAIT_HEIGHT * zoom;
      drawW = drawH * imgRatio;
    } else {
      drawW = PORTRAIT_WIDTH * zoom;
      drawH = drawW / imgRatio;
    }

    const x = (PORTRAIT_WIDTH - drawW) / 2 + offsetX;
    const y = (PORTRAIT_HEIGHT - drawH) / 2 + offsetY;

    ctx.drawImage(loadedImage, x, y, drawW, drawH);
  }

  zoomSlider.addEventListener('input', drawCroppedImage);
  offsetXSlider.addEventListener('input', drawCroppedImage);
  offsetYSlider.addEventListener('input', drawCroppedImage);

  // Cancel
  document.getElementById('portrait-cancel-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Save
  saveBtn.addEventListener('click', async () => {
    if (!loadedImage) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Uploading...';

    try {
      // Convert canvas to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      const filePath = `${currentUser.id}/${playerId}.jpg`;

      // Upload to Supabase Storage
      const { error } = await supabase.storage
        .from('arena-portraits')
        .upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('arena-portraits')
        .getPublicUrl(filePath);

      toast.success('Portrait uploaded!');
      modal.remove();
      if (onUploaded) onUploaded(urlData.publicUrl);
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Upload';
    }
  });
}

/**
 * Get portrait URL for a character, returns null if not found
 */
export function getPortraitUrl(discordId, playerId) {
  const { data } = supabase.storage
    .from('arena-portraits')
    .getPublicUrl(`${discordId}/${playerId}.jpg`);
  return data?.publicUrl || null;
}

/**
 * Arena-styled confirmation modal.
 * Returns a Promise that resolves true (confirm) or false (cancel).
 */
export function arenaConfirm(message, options = {}) {
  const {
    title = 'Confirm',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'arena-confirm-overlay';
    overlay.innerHTML = `
      <div class="arena-confirm-modal">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="arena-confirm-actions">
          <button class="arena-btn ${danger ? 'arena-btn-danger' : 'arena-btn-primary'}" id="arena-confirm-yes">${confirmText}</button>
          <button class="arena-btn" id="arena-confirm-no">${cancelText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      document.removeEventListener('keydown', handleEscape);
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('#arena-confirm-yes').addEventListener('click', () => cleanup(true));
    overlay.querySelector('#arena-confirm-no').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    const handleEscape = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };
    document.addEventListener('keydown', handleEscape);

    overlay.querySelector('#arena-confirm-no').focus();
  });
}

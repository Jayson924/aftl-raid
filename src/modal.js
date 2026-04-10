// Modal service for confirmations and alerts
class ModalService {
  // Show a confirmation modal with custom message and buttons
  confirm(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Confirm',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        confirmClass = 'btn-primary',
        danger = false
      } = options;

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content confirmation-modal">
          <h2>${title}</h2>
          <p class="confirmation-message">${message}</p>
          <div class="form-actions">
            <button type="button" class="btn ${danger ? 'btn-danger' : confirmClass}" id="confirm-btn">
              ${confirmText}
            </button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">
              ${cancelText}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const confirmBtn = document.getElementById('confirm-btn');
      const cancelBtn = document.getElementById('cancel-btn');

      const cleanup = (result) => {
        document.body.removeChild(modal);
        resolve(result);
      };

      confirmBtn.addEventListener('click', () => cleanup(true));
      cancelBtn.addEventListener('click', () => cleanup(false));

      // Close on backdrop click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup(false);
        }
      });

      // Close on Escape key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', handleEscape);
          cleanup(false);
        }
      };
      document.addEventListener('keydown', handleEscape);

      // Focus the cancel button by default (safer default)
      cancelBtn.focus();
    });
  }

  // Show a prompt modal for single-line text input.
  // Resolves with the trimmed input string, or null if cancelled.
  prompt(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Input',
        okText = 'OK',
        cancelText = 'Cancel',
        placeholder = '',
        defaultValue = '',
        required = true
      } = options;

      const modalEl = document.createElement('div');
      modalEl.className = 'modal';
      modalEl.innerHTML = `
        <div class="modal-content confirmation-modal">
          <h2>${title}</h2>
          <p class="confirmation-message">${message}</p>
          <input type="text" class="prompt-input" id="prompt-input" placeholder="${placeholder}" value="${defaultValue.replace(/"/g, '&quot;')}">
          <div class="form-actions">
            <button type="button" class="btn btn-primary" id="ok-btn">${okText}</button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">${cancelText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);

      const input = modalEl.querySelector('#prompt-input');
      const okBtn = modalEl.querySelector('#ok-btn');
      const cancelBtn = modalEl.querySelector('#cancel-btn');

      const cleanup = (result) => {
        document.removeEventListener('keydown', handleKey);
        document.body.removeChild(modalEl);
        resolve(result);
      };

      const submit = () => {
        const value = input.value.trim();
        if (required && !value) {
          input.focus();
          input.classList.add('prompt-input-error');
          return;
        }
        cleanup(value);
      };

      input.addEventListener('input', () => {
        input.classList.remove('prompt-input-error');
      });

      okBtn.addEventListener('click', submit);
      cancelBtn.addEventListener('click', () => cleanup(null));

      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) cleanup(null);
      });

      const handleKey = (e) => {
        if (e.key === 'Escape') {
          cleanup(null);
        } else if (e.key === 'Enter' && document.activeElement === input) {
          e.preventDefault();
          submit();
        }
      };
      document.addEventListener('keydown', handleKey);

      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  // Show an alert modal with just an OK button
  alert(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Alert',
        okText = 'OK'
      } = options;

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content confirmation-modal">
          <h2>${title}</h2>
          <p class="confirmation-message">${message}</p>
          <div class="form-actions">
            <button type="button" class="btn btn-primary" id="ok-btn">
              ${okText}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const okBtn = document.getElementById('ok-btn');

      const cleanup = () => {
        document.body.removeChild(modal);
        resolve();
      };

      okBtn.addEventListener('click', cleanup);

      // Close on backdrop click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
        }
      });

      // Close on Escape key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', handleEscape);
          cleanup();
        }
      };
      document.addEventListener('keydown', handleEscape);

      // Focus the OK button
      okBtn.focus();
    });
  }
}

export const modal = new ModalService();

// Toast notification system

class ToastManager {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    // Create toast container
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', duration = 3000) {
    // Clear all existing toasts
    const existingToasts = this.container.querySelectorAll('.toast');
    existingToasts.forEach(existingToast => {
      this.hide(existingToast);
    });

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Add icon based on type
    const icon = this.getIcon(type);

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close">&times;</button>
    `;

    this.container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('toast-show'), 10);

    // Close button
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.hide(toast));

    // Auto hide
    if (duration > 0) {
      setTimeout(() => this.hide(toast), duration);
    }

    return toast;
  }

  hide(toast) {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  getIcon(type) {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
      default:
        return 'ℹ';
    }
  }

  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }

  /**
   * Show a toast with an action button
   * @param {string} message - The message to display
   * @param {string} actionText - Text for the action button
   * @param {Function} actionCallback - Function to call when action is clicked
   * @param {string} type - Toast type (default 'warning')
   * @returns {HTMLElement} The toast element
   */
  showWithAction(message, actionText, actionCallback, type = 'warning') {
    // Clear all existing toasts
    const existingToasts = this.container.querySelectorAll('.toast');
    existingToasts.forEach(existingToast => {
      this.hide(existingToast);
    });

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} toast-with-action`;

    const icon = this.getIcon(type);

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-action">${actionText}</button>
      <button class="toast-close">&times;</button>
    `;

    this.container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('toast-show'), 10);

    // Action button
    const actionBtn = toast.querySelector('.toast-action');
    actionBtn.addEventListener('click', () => {
      actionCallback();
      this.hide(toast);
    });

    // Close button
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.hide(toast));

    // No auto-hide - user must click action or close

    return toast;
  }
}

export const toast = new ToastManager();

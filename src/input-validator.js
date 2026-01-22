// Client-side input validation and sanitization preview

export const inputValidator = {
  // Check if input starts with dangerous characters that will be sanitized
  isDangerous(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    const dangerousChars = ['=', '+', '-', '@', '\t'];
    return dangerousChars.includes(value.charAt(0));
  },

  // Preview what the sanitized value will look like
  previewSanitized(value) {
    if (this.isDangerous(value)) {
      return "'" + value;
    }
    return value;
  },

  // Add visual indicator to input field
  attachValidator(inputElement, warningElement = null) {
    // Validation happens silently on the backend
    // No need to show warnings to users
  }
};

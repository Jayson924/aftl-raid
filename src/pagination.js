/**
 * Pagination control: «  ‹  1  2  3  ›  »
 *
 * Usage:
 *   container.innerHTML = renderPagination(currentPage, totalPages, { id: 'foo' });
 *   bindPagination(container, currentPage, totalPages, (newPage) => { ... });
 *
 * Caller is responsible for re-rendering and re-binding when page changes.
 */

export function renderPagination(currentPage, totalPages, options = {}) {
  if (totalPages <= 1) return '';
  const { id = '', extraClass = '' } = options;
  const idAttr = id ? ` data-pagination-id="${id}"` : '';

  const atFirst = currentPage <= 1;
  const atLast = currentPage >= totalPages;

  const btn = (action, content, isActive = false, isDisabled = false, extra = '') => `
    <button class="pagination-btn ${extra} ${isActive ? 'active' : ''}"
            data-page-action="${action}"
            ${isDisabled ? 'disabled' : ''}>${content}</button>
  `;

  let pages = '';
  for (let p = 1; p <= totalPages; p++) {
    pages += btn(String(p), String(p), p === currentPage, false, 'pagination-num');
  }

  return `
    <div class="pagination ${extraClass}"${idAttr}>
      ${btn('first', '«', false, atFirst, 'pagination-jump')}
      ${btn('prev', '‹', false, atFirst, 'pagination-arrow')}
      ${pages}
      ${btn('next', '›', false, atLast, 'pagination-arrow')}
      ${btn('last', '»', false, atLast, 'pagination-jump')}
    </div>
  `;
}

/**
 * Bind click handlers on a pagination root element.
 * Calls onChange(newPage) when the user picks a different page.
 */
export function bindPagination(rootEl, currentPage, totalPages, onChange) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-page-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.pageAction;
      let next = currentPage;
      if (action === 'first') next = 1;
      else if (action === 'last') next = totalPages;
      else if (action === 'prev') next = Math.max(1, currentPage - 1);
      else if (action === 'next') next = Math.min(totalPages, currentPage + 1);
      else next = parseInt(action, 10);
      if (Number.isFinite(next) && next !== currentPage && next >= 1 && next <= totalPages) {
        onChange(next);
      }
    });
  });
}

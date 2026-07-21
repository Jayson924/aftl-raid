import { dataService } from './data.js';
import { toast } from './toast.js';
import { modal } from './modal.js';
import { getLineupSize } from './constants.js';

/**
 * Shared loot UI — rendering + interaction wiring for the loot box and the
 * "gold shares received" tracker. Used by BOTH the Lineups showcase card (loot on
 * a live lineup) and the Loot Log page (loot on an archived record). Mix in with
 * `Object.assign(Page, lootUiMixin)` or spread `...lootUiMixin`.
 *
 * The host object must provide:
 *   - escapeHtml(str), formatGold(n)          — small formatting helpers
 *   - cachedPlayerMap                         — Map(name → { discordId, ... })
 *   - editingLootId, editingForceSold         — inline-edit state (host owns)
 *   - _lootRerender(ctx)                      — re-render the card for `ctx`
 *
 * `ctx` is a lineup or a loot record. Records set `isRecord: true`; both expose
 * `id`, `raidType`, `players` (roster names), `loot`, and `payouts`. The mixin
 * picks the matching data.js methods based on `ctx.isRecord`.
 */
export const lootUiMixin = {
  // --- data method routing (lineup vs archived record) -------------------------
  _lootAdd(ctx, item, heldBy) {
    return ctx.isRecord
      ? dataService.addLootRecordItem(ctx.id, item, heldBy)
      : dataService.addLineupLoot(ctx.id, item, heldBy);
  },
  _lootMarkShare(ctx, member, owner) {
    return ctx.isRecord
      ? dataService.markRecordShareReceived(ctx.id, member, owner)
      : dataService.markShareReceived(ctx.id, member, owner);
  },
  _lootUnmarkShare(ctx, member, owner) {
    return ctx.isRecord
      ? dataService.unmarkRecordShareReceived(ctx.id, member, owner)
      : dataService.unmarkShareReceived(ctx.id, member, owner);
  },

  /**
   * Resolve the display names of the characters/guests in a party, for the loot
   * "held by" dropdown and payout chips. Records store already-resolved names.
   */
  getPartyMemberNames(ctx) {
    const size = getLineupSize(ctx.raidType);
    const names = [];
    (ctx.players || []).slice(0, size).forEach(playerName => {
      if (!playerName) return;
      if (playerName.startsWith('[PUB]')) {
        const parts = playerName.substring(5).split('|');
        names.push(parts[0] || parts[1] || 'Guest');
      } else {
        names.push(playerName);
      }
    });
    return names;
  },

  /**
   * Build the "held by" <select> options from the party roster. Keeps the
   * current holder selected even if they're no longer in the party.
   */
  renderHolderSelect(ctx, selected, className) {
    const members = this.getPartyMemberNames(ctx);
    const opts = [`<option value="">— holder —</option>`];
    members.forEach(n => {
      opts.push(`<option value="${this.escapeHtml(n)}" ${n === selected ? 'selected' : ''}>${this.escapeHtml(n)}</option>`);
    });
    if (selected && !members.includes(selected)) {
      opts.push(`<option value="${this.escapeHtml(selected)}" selected>${this.escapeHtml(selected)} (not in party)</option>`);
    }
    return `<select class="${className}">${opts.join('')}</select>`;
  },

  /**
   * Group loot by holder, ordered: party members (roster order), then named
   * holders no longer in the party, then Unassigned last.
   * Returns [{ holder, inParty, items, total }].
   */
  groupLootByHolder(ctx) {
    const loot = ctx.loot || [];
    const members = this.getPartyMemberNames(ctx);
    const byHolder = new Map();
    loot.forEach(l => {
      const key = l.heldBy || '';
      if (!byHolder.has(key)) byHolder.set(key, []);
      byHolder.get(key).push(l);
    });

    const groups = [];
    members.forEach(name => {
      if (byHolder.has(name)) {
        groups.push({ holder: name, inParty: true, items: byHolder.get(name) });
        byHolder.delete(name);
      }
    });
    [...byHolder.keys()]
      .filter(k => k !== '')
      .sort((a, b) => a.localeCompare(b))
      .forEach(name => {
        groups.push({ holder: name, inParty: false, items: byHolder.get(name) });
        byHolder.delete(name);
      });
    if (byHolder.has('')) {
      groups.push({ holder: '', inParty: false, items: byHolder.get('') });
    }

    return groups.map(g => ({
      ...g,
      total: g.items.reduce((s, l) => s + (Number(l.price) || 0), 0)
    }));
  },

  /**
   * Render a single loot row — view mode, or inline-edit form when active.
   * The holder is shown by the enclosing group header, so rows omit it.
   */
  renderLootItemRow(ctx, l, canManage) {
    if (this.editingLootId === l.id && canManage) {
      const sold = l.sold || this.editingForceSold;
      return `
        <form class="loot-item loot-item--editing" data-loot-id="${l.id}">
          <input type="text" class="loot-edit-item" value="${this.escapeHtml(l.item)}" required>
          ${this.renderHolderSelect(ctx, l.heldBy, 'loot-edit-holder')}
          <label class="loot-sold-toggle" title="Mark as sold">
            <input type="checkbox" class="loot-edit-sold" ${sold ? 'checked' : ''}> Sold
          </label>
          <input type="number" class="loot-edit-price" value="${l.price || ''}" min="0" step="1" placeholder="Gold" ${sold ? '' : 'disabled'}>
          <button type="submit" class="loot-icon-btn loot-save-btn" title="Save">✓</button>
          <button type="button" class="loot-icon-btn loot-cancel-btn" title="Cancel">×</button>
        </form>
      `;
    }
    const sourceBadge = l.source === 'discord'
      ? `<span class="loot-source" title="Logged from Discord">D</span>`
      : '';
    const statusHtml = l.sold
      ? `<span class="loot-item-price">🪙 ${this.formatGold(l.price)}</span>`
      : `<span class="loot-item-status loot-item-status--unsold">Not yet sold</span>`;
    return `
      <div class="loot-item ${l.sold ? '' : 'loot-item--unsold'}" data-loot-id="${l.id}">
        <span class="loot-item-name">${sourceBadge}${this.escapeHtml(l.item)}</span>
        ${statusHtml}
        ${canManage ? `
          ${!l.sold ? `<button class="loot-icon-btn loot-sell-btn" data-loot-id="${l.id}" title="Mark sold">💰</button>` : ''}
          <button class="loot-icon-btn loot-edit-btn" data-loot-id="${l.id}" title="Edit">✎</button>
          <button class="loot-icon-btn loot-delete-btn" data-loot-id="${l.id}" title="Delete">×</button>
        ` : ''}
      </div>
    `;
  },

  /**
   * "Gold shares received" tracker — one chip per party member. A member can
   * toggle their OWN character's chip; editors/admins can toggle anyone's. Chips
   * reflect the shared lineup_payouts table (also driven by Discord ✅ reactions).
   */
  renderPayoutTracker(ctx, canManage) {
    const members = this.getPartyMemberNames(ctx);
    if (members.length === 0) return '';

    const receivedSet = new Set((ctx.payouts || []).map(p => p.memberName));
    const playerMap = this.cachedPlayerMap;
    const currentUserId = dataService.getUser()?.id || null;
    const receivedCount = members.filter(n => receivedSet.has(n)).length;
    const allPaid = receivedCount === members.length;

    const chips = members.map(name => {
      const owner = playerMap?.get(name)?.discordId || null;
      const received = receivedSet.has(name);
      const isYou = !!(owner && currentUserId && owner === currentUserId);
      const canToggle = canManage || isYou;
      const title = canToggle
        ? (received ? 'Click to un-mark' : 'Click when you\'ve got your share')
        : (received ? 'Share received' : 'Not yet received');
      return `
        <button type="button" class="loot-payout-chip ${received ? 'received' : ''} ${canToggle ? '' : 'locked'}"
          data-member="${this.escapeHtml(name)}" ${canToggle ? '' : 'disabled'} title="${title}">
          <span class="loot-payout-check">${received ? '✓' : ''}</span>
          <span class="loot-payout-name">${this.escapeHtml(name)}</span>
          ${isYou ? '<span class="loot-payout-you">you</span>' : ''}
        </button>
      `;
    }).join('');

    return `
      <div class="loot-payouts">
        <div class="loot-payouts-head">
          <span class="loot-payouts-label">Gold shares received</span>
          <span class="loot-payouts-count ${allPaid ? 'all-paid' : ''}">${receivedCount}/${members.length}</span>
        </div>
        <div class="loot-payouts-chips">${chips}</div>
      </div>
    `;
  },

  /**
   * Render the loot box. Loot is grouped by holder; the header keeps the sold
   * total + per-person payout pinned on top while the items scroll. Editors/admins
   * can add, edit, sell, and delete.
   */
  renderLootSection(ctx, canManage) {
    const loot = ctx.loot || [];
    // Only sold items contribute gold (unsold price is 0, but guard anyway)
    const total = loot.reduce((sum, l) => sum + (l.sold ? (Number(l.price) || 0) : 0), 0);
    const partySize = this.getPartyMemberNames(ctx).length;
    const payout = partySize > 0 ? Math.floor(total / partySize) : 0;

    const groupsHtml = loot.length === 0
      ? `<div class="loot-empty">No loot logged yet${canManage ? '. Add the first item below.' : '.'}</div>`
      : `<div class="loot-groups">${this.groupLootByHolder(ctx).map(g => {
          const holderLabel = g.holder
            ? `<span class="loot-group-holder"><img src="/icons/scales.svg" alt="" class="loot-holder-icon">${this.escapeHtml(g.holder)}${g.inParty ? '' : ' <span class="loot-group-note">(not in party)</span>'}</span>`
            : `<span class="loot-group-holder loot-group-holder--none">Unassigned</span>`;
          return `
            <div class="loot-group">
              <div class="loot-group-header">
                ${holderLabel}
                <span class="loot-group-meta">
                  <span class="loot-group-count">${g.items.length}</span>
                  ${g.total > 0 ? `<span class="loot-group-total">🪙 ${this.formatGold(g.total)}</span>` : ''}
                </span>
              </div>
              <div class="loot-items">
                ${g.items.map(l => this.renderLootItemRow(ctx, l, canManage)).join('')}
              </div>
            </div>
          `;
        }).join('')}</div>`;

    const addFormHtml = canManage ? `
      <form class="loot-add-form">
        <input type="text" class="loot-add-item" placeholder="Item name" required>
        ${this.renderHolderSelect(ctx, '', 'loot-add-holder')}
        <button type="submit" class="btn btn-primary loot-add-btn">Add</button>
      </form>
    ` : '';

    return `
      <div class="lineup-loot">
        <div class="lineup-loot-header">
          <span class="loot-title">Loot</span>
          <span class="loot-count">${loot.length}</span>
          ${total > 0 ? `<span class="loot-total">🪙 ${this.formatGold(total)}</span>` : ''}
          ${total > 0 && partySize > 0 ? `<span class="loot-payout" title="Total ÷ ${partySize} in party">🪙 ${this.formatGold(payout)} each</span>` : ''}
        </div>
        <div class="lineup-loot-body">
          ${addFormHtml}
          ${total > 0 ? this.renderPayoutTracker(ctx, canManage) : ''}
          ${groupsHtml}
        </div>
      </div>
    `;
  },

  /**
   * Wire up the "gold shares received" chips within `root`. Not gated to editors —
   * a member may toggle their own chip (data.js verifies ownership); editors any.
   */
  setupPayoutHandlers(ctx, root = document) {
    const section = root.querySelector('.lineup-loot');
    if (!section) return;

    const playerMap = this.cachedPlayerMap;
    section.querySelectorAll('.loot-payout-chip:not([disabled])').forEach(chip => {
      chip.addEventListener('click', async () => {
        const member = chip.dataset.member;
        if (!member) return;
        const owner = playerMap?.get(member)?.discordId || null;
        ctx.payouts = ctx.payouts || [];
        const already = ctx.payouts.some(p => p.memberName === member);

        // Optimistic update + re-render
        ctx.payouts = already
          ? ctx.payouts.filter(p => p.memberName !== member)
          : [...ctx.payouts, { memberName: member, discordId: owner, source: 'web' }];
        this._lootRerender(ctx);

        try {
          if (already) {
            await this._lootUnmarkShare(ctx, member, owner);
          } else {
            await this._lootMarkShare(ctx, member, owner);
          }
        } catch (err) {
          // Revert on failure
          ctx.payouts = already
            ? [...ctx.payouts, { memberName: member, discordId: owner, source: 'web' }]
            : ctx.payouts.filter(p => p.memberName !== member);
          toast.error(err.message || 'Failed to update share');
          this._lootRerender(ctx);
        }
      });
    });
  },

  /**
   * Wire up loot section interactions within `root` (editors/admins only).
   */
  setupLootHandlers(ctx, root = document) {
    const section = root.querySelector('.lineup-loot');
    if (!section) return;

    const canManage = dataService.canEditLineups();
    if (!canManage) return;

    // Add new loot entry (starts unsold — no gold yet)
    const addForm = section.querySelector('.loot-add-form');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const itemInput = addForm.querySelector('.loot-add-item');
        const holderSelect = addForm.querySelector('.loot-add-holder');
        const item = itemInput.value.trim();
        if (!item) return;
        const heldBy = holderSelect ? holderSelect.value : '';
        try {
          const newLoot = await this._lootAdd(ctx, item, heldBy);
          ctx.loot = [...(ctx.loot || []), newLoot];
          this._lootRerender(ctx);
          // Refocus the item input for fast consecutive entry
          const freshInput = root.querySelector('.loot-add-item');
          if (freshInput) freshInput.focus();
        } catch (err) {
          toast.error(`Failed to add loot: ${err.message}`);
        }
      });
    }

    // Edit buttons → switch the row into edit mode
    section.querySelectorAll('.loot-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.editingLootId = btn.dataset.lootId;
        this.editingForceSold = false;
        this._lootRerender(ctx);
      });
    });

    // "Mark sold" buttons → open edit with the Sold toggle pre-checked, focus price
    section.querySelectorAll('.loot-sell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.editingLootId = btn.dataset.lootId;
        this.editingForceSold = true;
        this._lootRerender(ctx);
        const priceInput = root.querySelector('.loot-item--editing .loot-edit-price');
        if (priceInput) priceInput.focus();
      });
    });

    // Cancel edit
    section.querySelectorAll('.loot-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.editingLootId = null;
        this.editingForceSold = false;
        this._lootRerender(ctx);
      });
    });

    // Sold checkbox → enable/disable the price input live
    section.querySelectorAll('.loot-edit-sold').forEach(cb => {
      cb.addEventListener('change', () => {
        const priceInput = cb.closest('.loot-item--editing')?.querySelector('.loot-edit-price');
        if (!priceInput) return;
        priceInput.disabled = !cb.checked;
        if (cb.checked) priceInput.focus();
      });
    });

    // Save edit
    section.querySelectorAll('.loot-item--editing').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const lootId = form.dataset.lootId;
        const item = form.querySelector('.loot-edit-item').value.trim();
        const sold = form.querySelector('.loot-edit-sold')?.checked || false;
        const priceRaw = form.querySelector('.loot-edit-price').value;
        const holderSelect = form.querySelector('.loot-edit-holder');
        const heldBy = holderSelect ? holderSelect.value : '';
        if (!item) return;
        const price = sold ? Math.max(0, Math.round(Number(priceRaw) || 0)) : 0;
        try {
          await dataService.updateLineupLoot(lootId, { item, heldBy, sold, price });
          const entry = (ctx.loot || []).find(l => l.id === lootId);
          if (entry) {
            entry.item = item;
            entry.sold = sold;
            entry.price = price;
            entry.heldBy = heldBy.trim();
          }
          this.editingLootId = null;
          this.editingForceSold = false;
          this._lootRerender(ctx);
        } catch (err) {
          toast.error(`Failed to update loot: ${err.message}`);
        }
      });
    });

    // Delete buttons
    section.querySelectorAll('.loot-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lootId = btn.dataset.lootId;
        const entry = (ctx.loot || []).find(l => l.id === lootId);
        const confirmed = await modal.confirm(
          `Delete loot entry <strong>${this.escapeHtml(entry?.item || '')}</strong>?`,
          { title: 'Delete Loot', confirmText: 'Delete', cancelText: 'Cancel' }
        );
        if (!confirmed) return;
        try {
          await dataService.deleteLineupLoot(lootId);
          ctx.loot = (ctx.loot || []).filter(l => l.id !== lootId);
          if (this.editingLootId === lootId) this.editingLootId = null;
          this._lootRerender(ctx);
        } catch (err) {
          toast.error(`Failed to delete loot: ${err.message}`);
        }
      });
    });
  },
};

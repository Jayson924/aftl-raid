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
  _lootMarkShare(ctx, member, owner, amount) {
    return ctx.isRecord
      ? dataService.markRecordShareReceived(ctx.id, member, owner, amount)
      : dataService.markShareReceived(ctx.id, member, owner, amount);
  },

  // Current per-person payout for a lineup/record: sold gold ÷ party size.
  _payoutEach(ctx) {
    const total = (ctx.loot || []).reduce((s, l) => s + (l.sold ? (Number(l.price) || 0) : 0), 0);
    const partySize = this.getPartyMemberNames(ctx).length;
    return partySize > 0 ? Math.floor(total / partySize) : 0;
  },

  // The pilot name recorded for a roster member: records carry a {name → pilot}
  // snapshot; live lineups have slot-aligned players/pilotPlayers arrays.
  _pilotNameOf(ctx, memberName) {
    if (ctx.isRecord) return ((ctx.pilots || {})[memberName] || '').trim();
    const size = getLineupSize(ctx.raidType);
    const raw = (ctx.players || []).slice(0, size);
    for (let i = 0; i < raw.length; i++) {
      const rn = raw[i];
      if (!rn) continue;
      let resolved = rn;
      if (rn.startsWith('[PUB]')) {
        const parts = rn.substring(5).split('|');
        resolved = parts[0] || parts[1] || 'Guest';
      }
      if (resolved === memberName) return (((ctx.pilotPlayers || [])[i]) || '').trim();
    }
    return '';
  },

  // Is the logged-in user this member's PILOT? Pilot names are display-name
  // strings — match against the user's display name / username (the same
  // convention the Discord bot uses). Server-side re-verified in data.js.
  _isPilotOfMember(ctx, memberName) {
    const pilot = this._pilotNameOf(ctx, memberName).toLowerCase();
    if (!pilot) return false;
    const user = dataService.getUser();
    if (!user) return false;
    const dn = (dataService.getDisplayName?.() || '').trim().toLowerCase();
    const un = (user.username || user.name || '').trim().toLowerCase();
    return (!!dn && pilot === dn) || (!!un && pilot === un);
  },

  // "Mine" = a character the user owns OR pilots.
  _isMyMember(ctx, memberName) {
    const uid = dataService.getUser()?.id;
    if (!uid) return false;
    if (this.cachedPlayerMap?.get(memberName)?.discordId === uid) return true;
    return this._isPilotOfMember(ctx, memberName);
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
  renderPayoutTracker(ctx, canManage, payoutEach = 0) {
    const members = this.getPartyMemberNames(ctx);
    if (members.length === 0) return '';

    const payoutMap = new Map((ctx.payouts || []).map(p => [p.memberName, p]));
    const playerMap = this.cachedPlayerMap;
    const currentUserId = dataService.getUser()?.id || null;

    // Guests = roster members with no owning Discord account. They're counted in
    // the split but auto-settle once every linked member is settled (so the record
    // resolves without anyone having to tick them).
    const isGuest = (name) => !(playerMap?.get(name)?.discordId);
    const settledByAmount = (name) => {
      const row = payoutMap.get(name);
      return !!row && (Number(row.amount) || 0) >= payoutEach;
    };
    const linkedNames = members.filter(n => !isGuest(n));
    const allLinkedSettled = linkedNames.length > 0 && linkedNames.every(settledByAmount);

    // A member is "settled" once they've withdrawn at least the current share.
    // If a forgotten item was sold after they confirmed, they're "partial":
    // withdrew the old amount, still owe the difference.
    const stateOf = (name) => {
      const row = payoutMap.get(name);
      const withdrawn = row ? (Number(row.amount) || 0) : 0;
      // Guests ride on the party: settled once all linked members are settled.
      if (isGuest(name) && allLinkedSettled) return { settled: true, partial: false, withdrawn, auto: true };
      if (row && withdrawn >= payoutEach) return { settled: true, partial: false, withdrawn };
      if (row && withdrawn > 0) return { settled: false, partial: true, withdrawn };
      return { settled: false, partial: false, withdrawn: 0 };
    };

    const settledCount = members.filter(n => stateOf(n).settled).length;
    const allPaid = settledCount === members.length;

    // One-click self-claim: covers every character the viewer owns OR pilots.
    const myNames = currentUserId ? members.filter(n => this._isMyMember(ctx, n)) : [];
    const myOwed = myNames.reduce((s, n) => {
      const st = stateOf(n);
      return s + (st.settled ? 0 : Math.max(0, payoutEach - st.withdrawn));
    }, 0);
    const myClaimed = myNames.length > 0 && myNames.every(n => stateOf(n).settled);
    const claimBtn = myNames.length === 0 ? '' : myClaimed
      ? `<button type="button" class="loot-claim-btn claimed" title="You've claimed your ${myNames.length > 1 ? 'shares' : 'share'} — click to un-claim">✓ Claimed</button>`
      : `<button type="button" class="loot-claim-btn" title="Mark ${myNames.length > 1 ? `all ${myNames.length} of your characters'` : 'your'} share as received — 🪙 ${this.formatGold(myOwed)}">🪙 Claim</button>`;

    const chips = members.map(name => {
      const owner = playerMap?.get(name)?.discordId || null;
      const st = stateOf(name);
      // "You" covers characters the viewer owns or pilots.
      const isYou = !!currentUserId && this._isMyMember(ctx, name);
      // Piloted slot: everyone sees the pilot icon; the pilot themselves gets it
      // inside their "you" badge.
      const pilotName = this._pilotNameOf(ctx, name);
      const iAmPilot = !!pilotName && this._isPilotOfMember(ctx, name);
      const pilotIcon = `<img src="/icons/headphones.svg" alt="pilot" class="loot-payout-pilot-icon">`;
      // Auto-covered guests aren't manually toggled (they follow the party) —
      // unless the viewer pilots that guest slot (then it's genuinely theirs).
      const canToggle = (!st.auto || isYou) && (canManage || isYou);
      const owed = Math.max(0, payoutEach - st.withdrawn);
      const title = st.auto
        ? 'Guest — auto-covered once all members are paid'
        : canToggle
          ? (st.settled ? 'Click to un-mark'
            : st.partial ? `Already withdrew ${this.formatGold(st.withdrawn)} — grab the remaining ${this.formatGold(owed)}, then click`
            : 'Click when you\'ve got your share')
          : (st.settled ? 'Share received' : st.partial ? `Withdrew ${this.formatGold(st.withdrawn)}, owes ${this.formatGold(owed)}` : 'Not yet received');
      const cls = `${st.settled ? 'received' : st.partial ? 'partial' : ''} ${st.auto ? 'auto' : ''}`;
      return `
        <button type="button" class="loot-payout-chip ${cls} ${canToggle ? '' : 'locked'}"
          data-member="${this.escapeHtml(name)}" ${canToggle ? '' : 'disabled'} title="${title}">
          <span class="loot-payout-check">${st.settled ? '✓' : st.partial ? '½' : ''}</span>
          <span class="loot-payout-name">${this.escapeHtml(name)}</span>
          ${st.partial ? `<span class="loot-payout-owed">+${this.formatGold(owed)}</span>` : ''}
          ${isYou ? `<span class="loot-payout-you">you${iAmPilot ? pilotIcon : ''}</span>` : ''}
          ${pilotName && !iAmPilot ? `<span class="loot-payout-pilot" title="Piloted by ${this.escapeHtml(pilotName)}">${pilotIcon}</span>` : ''}
        </button>`;
    }).join('');

    return `
      <div class="loot-payouts">
        <div class="loot-payouts-head">
          <span class="loot-payouts-label">Gold shares received</span>
          <span class="loot-payouts-count ${allPaid ? 'all-paid' : ''}">${settledCount}/${members.length}</span>
          ${claimBtn}
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
          ${total > 0 && partySize > 0 ? `<span class="loot-payout" title="Your share — ${this.formatGold(total)} total ÷ ${partySize} in party">🪙 ${this.formatGold(payout)} each</span>` : ''}
          ${total > 0 ? `<span class="loot-total" title="Total sold gold">🪙 ${this.formatGold(total)} total</span>` : ''}
        </div>
        <div class="lineup-loot-body">
          ${addFormHtml}
          ${total > 0 ? this.renderPayoutTracker(ctx, canManage, payout) : ''}
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
    const payoutEach = this._payoutEach(ctx);

    // "Claim my share" — marks (or un-marks) every character the viewer owns in
    // this roster in one click, at the current full share.
    const claimBtn = section.querySelector('.loot-claim-btn');
    if (claimBtn) {
      claimBtn.addEventListener('click', async () => {
        const uid = dataService.getUser()?.id;
        if (!uid) return;
        const mine = this.getPartyMemberNames(ctx).filter(n => this._isMyMember(ctx, n));
        if (mine.length === 0) return;

        ctx.payouts = ctx.payouts || [];
        const ownerOf = (n) => playerMap?.get(n)?.discordId || null; // pilots authorize via the pilot path
        const isSettled = (n) => {
          const r = ctx.payouts.find(p => p.memberName === n);
          return !!r && (Number(r.amount) || 0) >= payoutEach;
        };
        const targets = mine.filter(n => !isSettled(n)); // unsettled → claim these
        const claiming = targets.length > 0;             // none left → un-claim all
        const before = ctx.payouts.map(p => ({ ...p })); // snapshot for revert

        if (claiming) {
          ctx.payouts = [
            ...ctx.payouts.filter(p => !targets.includes(p.memberName)),
            ...targets.map(n => ({ memberName: n, discordId: ownerOf(n), source: 'web', amount: payoutEach })),
          ];
        } else {
          ctx.payouts = ctx.payouts.filter(p => !mine.includes(p.memberName));
        }
        this._lootRerender(ctx);

        try {
          if (claiming) {
            for (const n of targets) await this._lootMarkShare(ctx, n, ownerOf(n), payoutEach);
          } else {
            for (const n of mine) await this._lootUnmarkShare(ctx, n, ownerOf(n));
          }
        } catch (err) {
          ctx.payouts = before;
          toast.error(err.message || 'Failed to update share');
          this._lootRerender(ctx);
        }
      });
    }

    section.querySelectorAll('.loot-payout-chip:not([disabled])').forEach(chip => {
      chip.addEventListener('click', async () => {
        const member = chip.dataset.member;
        if (!member) return;
        const owner = playerMap?.get(member)?.discordId || null;
        ctx.payouts = ctx.payouts || [];
        const existing = ctx.payouts.find(p => p.memberName === member);
        // Settled = already withdrew at least the current share. Clicking a
        // settled chip un-marks; clicking an unsettled OR partial one marks it
        // received at the full current share (topping up a partial).
        const settled = existing && (Number(existing.amount) || 0) >= payoutEach;
        const before = ctx.payouts.map(p => ({ ...p })); // snapshot for revert

        if (settled) {
          ctx.payouts = ctx.payouts.filter(p => p.memberName !== member);
        } else {
          ctx.payouts = [
            ...ctx.payouts.filter(p => p.memberName !== member),
            { memberName: member, discordId: owner, source: 'web', amount: payoutEach }
          ];
        }
        this._lootRerender(ctx);

        try {
          if (settled) {
            await this._lootUnmarkShare(ctx, member, owner);
          } else {
            await this._lootMarkShare(ctx, member, owner, payoutEach);
          }
        } catch (err) {
          ctx.payouts = before; // revert on failure
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

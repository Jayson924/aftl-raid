import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { authService } from '../auth.js';
import { modal } from '../modal.js';
import { formatRaidTypeLabel } from '../constants.js';
import { lootUiMixin } from '../loot-ui.js';
import moment from 'moment';

/**
 * Loot Log — persistent loot records that outlived their lineups. When a cleared
 * lineup is archived (to free its members) or swept by the weekly cleanup, its
 * loot + payout rows are moved onto a loot_record (see supabase/loot-records.sql)
 * and shown here, still fully editable so sales and gold-shares can be finished
 * after the team has disbanded. Fully-resolved records (all sold + all shares
 * received) are removed by the following weekly cleanup.
 *
 * Reuses the shared loot UI (loot-ui.js) — each record is a `ctx` with isRecord.
 */
export const LootLogPage = {
  ...lootUiMixin,

  container: null,
  records: [],
  cachedPlayerMap: null,
  showSettled: false,             // filter: hide fully-resolved records by default
  editingLootId: null,            // inline-edit state (owned by the loot mixin)
  editingForceSold: false,
  lootSubscription: null,
  payoutSubscription: null,
  recordSubscription: null,
  _refreshTimer: null,

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatGold(amount) {
    return (Number(amount) || 0).toLocaleString('en-US');
  },

  // A record is fully resolved when it has loot, every item is sold, and every
  // roster member has received their share. (Mirrors loot_record_is_resolved SQL.)
  isResolved(record) {
    const loot = record.loot || [];
    if (loot.length === 0) return false;
    if (loot.some(l => !l.sold)) return false;
    const received = new Set((record.payouts || []).map(p => p.memberName));
    const members = this.getPartyMemberNames(record);
    return members.length > 0 && members.every(n => received.has(n));
  },

  // Re-render a single record card in place after a loot/payout change.
  _lootRerender(record) {
    const card = this.container?.querySelector(`.loot-record-card[data-record-id="${record.id}"]`);
    if (!card) { this.renderList(); return; }
    card.className = `loot-record-card ${this.isResolved(record) ? 'resolved' : ''}`;
    card.innerHTML = this.renderRecordInner(record, authService.canEditLineups());
    this.wireCard(record);
  },

  async render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="loot-log-page">
        <div class="loot-log-header">
          <div class="loot-log-title-row">
            <h1>Loot Log</h1>
            <button class="btn btn-secondary loot-log-filter" type="button"></button>
          </div>
          <p class="loot-log-sub">Loot from disbanded raids — finish selling and splitting here. Settled records clear on the next weekly reset.</p>
        </div>
        <div id="loot-log-list"><div class="loot-log-loading">Loading loot records…</div></div>
      </div>
    `;
    this.setupFilterButton();
    await this.load();
    this.setupSubscriptions();
  },

  async load() {
    try {
      const [records, players] = await Promise.all([
        dataService.getLootRecords(),
        dataService.getPlayers()
      ]);
      this.records = records;
      this.cachedPlayerMap = new Map(players.map(p => [p.name, p]));
      this.renderList();
    } catch (err) {
      console.error('[loot-log] load failed:', err);
      const list = document.getElementById('loot-log-list');
      if (list) list.innerHTML = `<div class="empty-state">Failed to load loot records.</div>`;
    }
  },

  renderList() {
    const list = document.getElementById('loot-log-list');
    if (!list) return;
    const canManage = authService.canEditLineups();

    const unsettledCount = this.records.filter(r => !this.isResolved(r)).length;
    const shown = this.showSettled ? this.records : this.records.filter(r => !this.isResolved(r));

    // Filter button reflects/toggles whether settled records are shown
    const filterBtn = this.container?.querySelector('.loot-log-filter');
    if (filterBtn) {
      const settledCount = this.records.length - unsettledCount;
      filterBtn.textContent = this.showSettled
        ? `Hide settled (${settledCount})`
        : `Show settled (${settledCount})`;
      filterBtn.style.display = settledCount > 0 ? '' : 'none';
    }

    if (shown.length === 0) {
      list.innerHTML = `<div class="empty-state">${
        this.records.length === 0
          ? 'No loot records yet. Archived raids with loot will appear here.'
          : 'No unsettled loot — everything’s sold and split. 🎉'
      }</div>`;
      return;
    }

    list.innerHTML = shown.map(r => this.renderRecordCard(r, canManage)).join('');
    shown.forEach(r => this.wireCard(r));
  },

  renderRecordCard(record, canManage) {
    return `
      <div class="loot-record-card ${this.isResolved(record) ? 'resolved' : ''}" data-record-id="${record.id}">
        ${this.renderRecordInner(record, canManage)}
      </div>
    `;
  },

  renderRecordInner(record, canManage) {
    const resolved = this.isResolved(record);
    const roster = this.getPartyMemberNames(record);
    const cleared = record.clearedAt ? moment(record.clearedAt) : null;
    return `
      <div class="loot-record-head">
        <div class="loot-record-heading">
          <span class="loot-record-name">${this.escapeHtml(record.name || 'Lineup')}</span>
          ${record.raidType ? `<span class="loot-record-raid">${this.escapeHtml(formatRaidTypeLabel(record.raidType))}</span>` : ''}
          ${resolved ? '<span class="loot-record-badge">Settled</span>' : ''}
        </div>
        <div class="loot-record-meta">
          ${cleared ? `<span class="loot-record-date" title="${cleared.format('ddd, MMM D, YYYY h:mm A')}">cleared ${cleared.fromNow()}</span>` : ''}
          ${canManage ? `<button class="loot-icon-btn loot-record-delete" title="Delete this record">🗑</button>` : ''}
        </div>
      </div>
      ${roster.length ? `<div class="loot-record-roster">${roster.map(n => `<span class="loot-record-member">${this.escapeHtml(n)}</span>`).join('')}</div>` : ''}
      ${this.renderLootSection(record, canManage)}
    `;
  },

  wireCard(record) {
    const card = this.container?.querySelector(`.loot-record-card[data-record-id="${record.id}"]`);
    if (!card) return;

    this.setupLootHandlers(record, card);
    this.setupPayoutHandlers(record, card);

    const delBtn = card.querySelector('.loot-record-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const confirmed = await modal.confirm(
          `Delete the entire loot record for <strong>${this.escapeHtml(record.name || 'this lineup')}</strong>? This removes all its items and share tracking.`,
          { title: 'Delete Loot Record', confirmText: 'Delete', cancelText: 'Cancel' }
        );
        if (!confirmed) return;
        try {
          await dataService.deleteLootRecord(record.id);
          this.records = this.records.filter(r => r.id !== record.id);
          this.renderList();
          toast.success('Loot record deleted');
        } catch (err) {
          toast.error(err.message || 'Failed to delete record');
        }
      });
    }
  },

  setupSubscriptions() {
    // Loot rows, payout rows, and record rows can all change from Discord or
    // another browser. Any change → debounced reload.
    this.lootSubscription = dataService.subscribeToLineupLoot(() => this.scheduleRefresh());
    this.payoutSubscription = dataService.subscribeToLineupPayouts(() => this.scheduleRefresh());
    this.recordSubscription = dataService.subscribeToLootRecords(() => this.scheduleRefresh());
  },

  scheduleRefresh() {
    // Don't yank the card out from under an in-progress inline edit.
    if (this.editingLootId) return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.load(), 300);
  },

  setupFilterButton() {
    const btn = this.container?.querySelector('.loot-log-filter');
    if (btn) {
      btn.addEventListener('click', () => {
        this.showSettled = !this.showSettled;
        this.renderList();
      });
    }
  },

  destroy() {
    clearTimeout(this._refreshTimer);
    [this.lootSubscription, this.payoutSubscription, this.recordSubscription].forEach(sub => {
      if (sub) dataService.unsubscribe(sub);
    });
    this.lootSubscription = null;
    this.payoutSubscription = null;
    this.recordSubscription = null;
    this.editingLootId = null;
    this.editingForceSold = false;
  },
};

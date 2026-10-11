// The few roster numbers from the panel the meter sent with a synced character.

const row = (panel, attr) => (panel?.rows || []).find((r) => r.attr === attr);
const n = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function panelStats(panel) {
  const summary = panel?.summary || {};
  const out = [];
  const patk = Math.round(n(summary.physical_average));
  const matk = Math.round(n(summary.magic_average));
  if (patk) out.push({ label: 'ATK', value: patk.toLocaleString('en-US') });
  if (matk) out.push({ label: 'MATK', value: matk.toLocaleString('en-US') });
  const fd = row(panel, 'Final damage');
  if (fd) out.push({ label: 'FD', value: `${Math.round(n(fd.buffed)).toLocaleString('en-US')} (${n(summary.final_percent).toFixed(1)}%)` });
  if (n(summary.crit_percent)) out.push({ label: 'Crit', value: `${n(summary.crit_percent).toFixed(1)}%` });
  const hp = n(summary.HP) || n(row(panel, 'HP')?.buffed);
  if (hp) out.push({ label: 'HP', value: Math.round(hp).toLocaleString('en-US') });
  const def = n(row(panel, 'DEF')?.buffed);
  if (def) out.push({ label: 'Def', value: Math.round(def).toLocaleString('en-US') });
  const mdef = n(row(panel, 'MDEF')?.buffed);
  if (mdef) out.push({ label: 'MDef', value: Math.round(mdef).toLocaleString('en-US') });
  return out;
}

const STALE_DAYS = 14;

// "5m ago", "3h ago", "12d ago"; stale past two weeks.
export function syncedAge(syncedAt) {
  const time = new Date(syncedAt).getTime();
  if (!syncedAt || Number.isNaN(time)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  const days = Math.floor(minutes / 1440);
  const text = minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${days}d ago`;
  return { text, stale: days > STALE_DAYS };
}

export function syncedLabel(syncedAt) {
  if (!syncedAt) return '';
  const date = new Date(syncedAt);
  if (Number.isNaN(date.getTime())) return 'Synced from the meter';
  return `Synced from the meter on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

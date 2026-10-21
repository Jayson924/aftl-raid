// The site's stat columns (character_stats) from a calculated panel; shared by the sync and the hand builder.
export function deriveStats(panel) {
  const summary = panel?.summary || {};
  const row = (attr) => (panel?.rows || []).find((r) => r.attr === attr)?.buffed;
  const stats = {};
  const put = (key, value, decimals = 0) => {
    const n = Number(value);
    if (value != null && Number.isFinite(n)) stats[key] = Number(n.toFixed(decimals));
  };
  put('attackPower', summary.physical_max);
  put('magicAttack', summary.magic_max);
  put('finalDamage', row('Final damage'));
  put('hp', summary.HP);
  put('defense', row('DEF'));
  put('magicDefense', row('MDEF'));
  put('criticalRate', summary.crit_percent, 2);
  // The meter gives the bonus over the base 200%; the form stores the total the game shows.
  if (summary.crit_damage_percent != null) put('criticalDamage', 200 + Number(summary.crit_damage_percent), 2);
  put('fireAttack', summary['Fire attack %'], 2);
  put('iceAttack', summary['Water attack %'], 2);
  put('lightAttack', summary['Light attack %'], 2);
  put('darkAttack', summary['Dark attack %'], 2);
  return stats;
}

/**
 * Helpers for the per-user "Available from / Log off time" feature.
 *
 * Times are stored as HH:MM (or HH:MM:SS) in the user's own IANA timezone.
 * Viewers convert to their own local timezone on display.
 */

// Raid types where availability should be surfaced in the UI.
// Currently only DDN Classic, since prog raids run long and need scheduling lead time.
const AVAILABILITY_RAID_TYPES = new Set(['DDN Classic']);

export function shouldShowAvailabilityForRaid(raidType) {
  return AVAILABILITY_RAID_TYPES.has(raidType);
}

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Get a short label for a timezone, e.g. "PT", "GMT+8". Falls back to the
 * raw IANA name if Intl can't produce a short name.
 */
export function getTimezoneShortLabel(tz) {
  if (!tz) return '';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName');
    return part?.value || tz;
  } catch {
    return tz;
  }
}

// Compute the UTC offset (in minutes) for a given IANA timezone at a given moment.
function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  // Intl renders hour as "24" for midnight in some locales — normalize.
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    hour,
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return (asUTC - date.getTime()) / 60000;
}

/**
 * Convert "HH:MM(:SS)" interpreted in ownerTz to HH:MM in viewerTz, returning
 * { hours, minutes }. Uses today's date as the reference so DST is correct.
 */
function convertTimeOfDay(timeStr, ownerTz, viewerTz) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

  // If we can't resolve TZs, return the raw owner time unchanged.
  if (!ownerTz || !viewerTz || ownerTz === viewerTz) {
    return { hours: h, minutes: m };
  }

  const now = new Date();
  const ownerOffsetMin = tzOffsetMinutes(ownerTz, now);
  const viewerOffsetMin = tzOffsetMinutes(viewerTz, now);
  const deltaMin = viewerOffsetMin - ownerOffsetMin;

  let totalMin = h * 60 + m + deltaMin;
  // Normalize into [0, 1440)
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

function formatHM({ hours, minutes }) {
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  const mm = String(minutes).padStart(2, '0');
  return `${h12}:${mm} ${ampm}`;
}

/**
 * Format an availability window for display in the viewer's timezone.
 * Returns "Anytime" if the anytime flag is set, "8:00 PM – 2:00 AM" for a range,
 * or "" if no availability set.
 */
export function formatAvailabilityRange(availability, viewerTz) {
  if (!availability) return '';
  if (availability.anytime) return 'Anytime';

  const { availableFrom, logOffTime, timezone } = availability;
  if (!availableFrom && !logOffTime) return '';

  const vtz = viewerTz || getBrowserTimezone();
  const from = availableFrom ? convertTimeOfDay(availableFrom, timezone, vtz) : null;
  const off = logOffTime ? convertTimeOfDay(logOffTime, timezone, vtz) : null;

  if (from && off) return `${formatHM(from)} – ${formatHM(off)}`;
  if (from) return `from ${formatHM(from)}`;
  if (off) return `until ${formatHM(off)}`;
  return '';
}

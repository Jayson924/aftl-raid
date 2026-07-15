/**
 * Helpers for the per-user "Available from / Log off time" feature.
 *
 * Times are stored as HH:MM (or HH:MM:SS) in the user's own IANA timezone.
 * Viewers convert to their own local timezone on display.
 */

// Raid types where availability should be surfaced in the UI.
// Only the DDN raids, since prog raids run long and need scheduling lead time.
const AVAILABILITY_RAID_TYPES = new Set(['DDN Classic', 'DDN Hardcore']);

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
export function convertTimeOfDay(timeStr, ownerTz, viewerTz) {
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
 * or "" if no availability set. The off-time is wrapped in
 * `<span class="availability-next-day">…</span>` when the window crosses midnight
 * (i.e. off-time is the next day), so callers can render it as HTML.
 */
export function formatAvailabilityRange(availability, viewerTz) {
  if (!availability) return '';
  if (availability.anytime) return 'Anytime';

  const { availableFrom, logOffTime, timezone } = availability;
  if (!availableFrom && !logOffTime) return '';

  const vtz = viewerTz || getBrowserTimezone();
  const from = availableFrom ? convertTimeOfDay(availableFrom, timezone, vtz) : null;
  const off = logOffTime ? convertTimeOfDay(logOffTime, timezone, vtz) : null;

  if (from && off) {
    const fromMin = from.hours * 60 + from.minutes;
    const offMin = off.hours * 60 + off.minutes;
    const crossesMidnight = offMin < fromMin;
    const offText = formatHM(off);
    const offHtml = crossesMidnight
      ? `<span class="availability-next-day">${offText}</span>`
      : offText;
    return `${formatHM(from)} – ${offHtml}`;
  }
  if (from) return `from ${formatHM(from)}`;
  if (off) return `until ${formatHM(off)}`;
  return '';
}

/**
 * Format a number of minutes from midnight (0-1439) as "h:mm AM/PM".
 */
export function formatMinutesAsTime(totalMin) {
  const m = ((totalMin % 1440) + 1440) % 1440;
  return formatHM({ hours: Math.floor(m / 60), minutes: m % 60 });
}

/**
 * Check whether a player's availability window overlaps the viewer-supplied
 * [fromMin, toMin] range. Both endpoints are minutes-from-midnight in the
 * viewer's timezone. Player's availability times are stored in their own
 * timezone and converted before comparison.
 *
 * Returns { hasPref, match }:
 *   - hasPref: true if the owner has any availability info saved (anytime, from, or off)
 *   - match:   true if the windows overlap (always true for "anytime")
 */
export function availabilityMatchesRange(availability, viewerTz, fromMin, toMin) {
  if (!availability) return { hasPref: false, match: false };
  if (availability.anytime) return { hasPref: true, match: true };

  const { availableFrom, logOffTime, timezone } = availability;
  if (!availableFrom && !logOffTime) return { hasPref: false, match: false };

  const vtz = viewerTz || getBrowserTimezone();
  const from = availableFrom ? convertTimeOfDay(availableFrom, timezone, vtz) : null;
  const off = logOffTime ? convertTimeOfDay(logOffTime, timezone, vtz) : null;

  // Normalize endpoints into [0, 1440). Both the filter range and the player's
  // window may cross midnight, in which case we split into two spans before
  // running the overlap check.
  const f = ((fromMin % 1440) + 1440) % 1440;
  const t = ((toMin % 1440) + 1440) % 1440;
  if (f === t) {
    // Zero-length / full-wrap range — treat as no constraint.
    return { hasPref: true, match: true };
  }

  // Build player spans (may be 1 or 2 if crossing midnight).
  let playerStart, playerEnd;
  if (from && off) {
    playerStart = from.hours * 60 + from.minutes;
    playerEnd = off.hours * 60 + off.minutes;
  } else if (from) {
    // "Available from X onward" — treat as X to midnight.
    playerStart = from.hours * 60 + from.minutes;
    playerEnd = 1440;
  } else {
    // "Available until X" — treat as midnight to X.
    playerStart = 0;
    playerEnd = off.hours * 60 + off.minutes;
  }

  const playerSpans = playerEnd > playerStart
    ? [[playerStart, playerEnd]]
    : [[playerStart, 1440], [0, playerEnd]];

  const filterSpans = t > f
    ? [[f, t]]
    : [[f, 1440], [0, t]];

  const overlaps = playerSpans.some(([ps, pe]) =>
    filterSpans.some(([fs, fe]) => ps < fe && pe > fs)
  );
  return { hasPref: true, match: overlaps };
}

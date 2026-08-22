export function roundToMaxTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeMaxTwoDecimals(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value)
    ? roundToMaxTwoDecimals(value)
    : fallback;
}

export function formatMaxTwoDecimals(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(roundToMaxTwoDecimals(value));
}

// Human-readable duration from a whole number of minutes: "45m", "4h 12m",
// "3h". Used for print-time estimates, which are never sub-minute.
export function formatDurationMinutes(minutes: number) {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

// Binary (1024-based) byte formatting, ≤ 2 decimal places, matching how
// hosting providers typically report data usage (e.g. "1.7 TiB").
export function formatBytes(bytes: number) {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  let unitIndex = 0;
  let scaled = value;
  while (scaled >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${formatMaxTwoDecimals(scaled)} ${BYTE_UNITS[unitIndex]}`;
}

// Same binary-unit formatting as formatBytes, with a "/s" suffix for a live
// throughput rate (bytes per second).
export function formatBytesPerSecond(bytesPerSecond: number) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Local sender preference, in bits/second. This is not a signaling field. */
export const VIDEO_BITRATE_OPTIONS = [500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000, 16_000_000, 24_000_000] as const;
export const VIDEO_BITRATE_STORAGE_KEY = 'gs.videoBitrateLimit';

export function normalizeVideoBitrateLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return (VIDEO_BITRATE_OPTIONS as readonly number[]).includes(number) ? number : null;
}

export function readVideoBitrateLimit(): number | null {
  try { return normalizeVideoBitrateLimit(window.localStorage.getItem(VIDEO_BITRATE_STORAGE_KEY)); }
  catch { return null; }
}

export function saveVideoBitrateLimit(value: number | null): void {
  try {
    if (value === null) window.localStorage.removeItem(VIDEO_BITRATE_STORAGE_KEY);
    else window.localStorage.setItem(VIDEO_BITRATE_STORAGE_KEY, String(value));
  } catch { /* The current session still applies the preference if storage is unavailable. */ }
}

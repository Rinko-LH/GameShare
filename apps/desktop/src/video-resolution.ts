import type { QualityLevel } from '@game-share/protocol';

export const VIDEO_RESOLUTIONS = [360, 540, 1080] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = 540;
export const VIDEO_RESOLUTION_STORAGE_KEY = 'gs.videoResolution';

export function normalizeVideoResolution(value: unknown): VideoResolution {
  const height = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return (VIDEO_RESOLUTIONS as readonly number[]).includes(height) ? height as VideoResolution : DEFAULT_VIDEO_RESOLUTION;
}

export function qualityForResolution(height: VideoResolution): QualityLevel {
  return height === 360 ? 'THUMBNAIL' : height === 1080 ? 'FOCUS' : 'GRID';
}

export function readVideoResolution(): VideoResolution {
  try { return normalizeVideoResolution(window.localStorage.getItem(VIDEO_RESOLUTION_STORAGE_KEY)); }
  catch { return DEFAULT_VIDEO_RESOLUTION; }
}

export function saveVideoResolution(height: VideoResolution): void {
  try { window.localStorage.setItem(VIDEO_RESOLUTION_STORAGE_KEY, String(height)); }
  catch { /* This session still applies the preference. */ }
}

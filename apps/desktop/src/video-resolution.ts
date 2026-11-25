import type { QualityLevel } from '@game-share/protocol';

export const VIDEO_RESOLUTIONS = [360, 540, 1080] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = 540;
export const VIDEO_RESOLUTION_STORAGE_KEY = 'gs.videoResolution';
const VIDEO_QUALITY_STORAGE_KEY = 'gs.videoQuality';

export const VIDEO_QUALITY_PRESETS = [
  { id: 'auto', height: 1080, bitrateLimit: 2_000_000 },
  { id: 'smooth', height: 360, bitrateLimit: null },
  { id: 'standard', height: 540, bitrateLimit: null },
  { id: 'hd', height: 1080, bitrateLimit: null },
] as const satisfies readonly { id: string; height: VideoResolution; bitrateLimit: number | null }[];

export type VideoQualityPreset = typeof VIDEO_QUALITY_PRESETS[number];

export function readVideoQuality(): VideoQualityPreset {
  try {
    const stored = window.localStorage.getItem(VIDEO_QUALITY_STORAGE_KEY);
    const preset = VIDEO_QUALITY_PRESETS.find(item => item.id === stored);
    if (preset) return preset;
    const legacyHeight = Number(window.localStorage.getItem(VIDEO_RESOLUTION_STORAGE_KEY));
    return VIDEO_QUALITY_PRESETS.find(item => item.id !== 'auto' && item.height === legacyHeight) ?? VIDEO_QUALITY_PRESETS[0];
  } catch { return VIDEO_QUALITY_PRESETS[0]; }
}

export function saveVideoQuality(preset: VideoQualityPreset): void {
  try { window.localStorage.setItem(VIDEO_QUALITY_STORAGE_KEY, preset.id); }
  catch { /* This session still applies the preference. */ }
}

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

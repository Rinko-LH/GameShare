/** Legacy invitation and preference migration only; the UI uses independent ConnectionConfig. */
export type ConnectionMode = 'lan' | 'public' | 'cloudflare' | 'mixed';
export type MediaPolicy = 'local-auto' | 'internet-auto' | 'selected-ip' | 'selected-ip-experimental';

export function normalizeConnectionMode(value: unknown): ConnectionMode | null {
  if (value === 'uu') return 'lan';
  return value === 'lan' || value === 'public' || value === 'cloudflare' || value === 'mixed' ? value : null;
}

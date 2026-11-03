import { DEFAULT_SIGNALING_PORT, DEFAULT_SIGNALING_URL } from './constants';

/** Keep full URLs intact; bare IP/host inputs use the application's port. */
export function normalizeSignalingAddress(input: string): string {
  const raw = input.trim();
  if (!raw) return DEFAULT_SIGNALING_URL;
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let host = raw;
  // Bare IPv6 needs brackets before passing it to the URL parser.
  if (!explicitScheme && !host.startsWith('[') && (host.match(/:/g)?.length ?? 0) > 1) {
    host = `[${host}]`;
  }
  let url: URL;
  try {
    url = new URL(explicitScheme ? raw : `http://${host}`);
  } catch {
    throw new Error('地址格式不正确，请输入 IP、IP:端口或完整的 http(s) 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error('请使用不含用户名和密码的 http(s) 服务器地址');
  }
  const hasExplicitPort = /:\d+$/.test(host.split(/[/?#]/)[0] ?? '');
  if (!explicitScheme && !hasExplicitPort) url.port = String(DEFAULT_SIGNALING_PORT);
  return url.toString().replace(/\/$/, '');
}

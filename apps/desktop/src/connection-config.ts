import { normalizeConnectionMode } from './connection-modes';

export type SignalingMethod = 'ip' | 'external' | 'cloudflare';
export type MediaStrategy = 'internet-auto' | 'local-auto' | 'selected-ip-experimental';
export interface ConnectionConfig { signaling: SignalingMethod; mediaPolicy: MediaStrategy }

export const SIGNALING_METHODS: Array<{ value: SignalingMethod; label: string; hint: string }> = [
  { value: 'ip', label: 'IP 直连', hint: '选择朋友可访问的本机 IP：同一局域网选真实网卡，已用 UU 组网选 UU 网卡；也可使用可达的本机公网 IP。' },
  { value: 'external', label: '自备外网地址', hint: '填写花生壳、Funnel、端口映射等提供的完整 http(s) 地址。映射需支持 HTTP / WebSocket，只转发房间信令。' },
  { value: 'cloudflare', label: 'Cloudflare 自动隧道', hint: '软件自动准备临时房间网址，无需单独安装组件。朋友只使用邀请里的地址，不需要在他电脑上开隧道。' },
];
export const MEDIA_STRATEGIES: Array<{ value: MediaStrategy; label: string; hint: string }> = [
  { value: 'internet-auto', label: '自动协商（推荐）', hint: '自动尝试可达的音视频路径，使用 STUN 和已配置的可选 TURN。受限网络下仍可能连接失败。' },
  { value: 'local-auto', label: '局域网 / UU 自动连接', hint: '双方先连同一局域网或完成虚拟组网；自动使用本机网卡候选，不配置 STUN / TURN，不锁定某一张网卡。' },
  { value: 'selected-ip-experimental', label: '指定本机 IP（实验）', hint: '每人选择自己的可达媒体 IP，不配置 STUN / TURN。限制候选并核对实际路径，目前不是严格的底层 IP 绑定。' },
];
export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = { signaling: 'cloudflare', mediaPolicy: 'internet-auto' };

export function parseConnectionConfig(value: unknown): ConnectionConfig | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!SIGNALING_METHODS.some(method => method.value === item.signaling) || !MEDIA_STRATEGIES.some(policy => policy.value === item.mediaPolicy)) return null;
  return { signaling: item.signaling as SignalingMethod, mediaPolicy: item.mediaPolicy as MediaStrategy };
}

/** Previous mode names are read only for migration, never used to couple the new choices. */
export function configFromLegacyMode(value: unknown): ConnectionConfig | null {
  const mode = normalizeConnectionMode(value);
  if (!mode) return null;
  return { signaling: mode === 'cloudflare' ? 'cloudflare' : mode === 'public' ? 'external' : 'ip', mediaPolicy: mode === 'mixed' ? 'selected-ip-experimental' : mode === 'lan' ? 'local-auto' : 'internet-auto' };
}

export function saveConnectionConfig(config: ConnectionConfig): void {
  try { localStorage.setItem('gs.connectionConfig', JSON.stringify(config)); } catch { /* Current selection still applies. */ }
}

export function readConnectionConfig(): ConnectionConfig {
  try {
    const stored = localStorage.getItem('gs.connectionConfig');
    if (stored !== null) {
      try { return parseConnectionConfig(JSON.parse(stored)) ?? { ...DEFAULT_CONNECTION_CONFIG }; }
      catch { return { ...DEFAULT_CONNECTION_CONFIG }; }
    }
    const migrated = configFromLegacyMode(localStorage.getItem('gs.connectionMode'));
    if (migrated) { saveConnectionConfig(migrated); return migrated; }
  } catch { /* Storage may be unavailable. */ }
  return { ...DEFAULT_CONNECTION_CONFIG };
}

export type ConnectionMode = 'lan' | 'public' | 'cloudflare' | 'mixed';
export type MediaPolicy = 'local-auto' | 'internet-auto' | 'selected-ip' | 'selected-ip-experimental';

export const MIXED_MODE_NOTICE = '实验模式：限制公布的媒体候选并核对实际路径，尚不保证底层严格绑定 IP；检测到地址不符时停止该媒体连接。';

export const CONNECTION_MODES: Array<{ id: ConnectionMode; name: string; description: string; steps: string; note: string; unavailable?: string }> = [
  { id: 'lan', name: 'IP 连接', description: '同一局域网，或已通过 UU 等工具建立虚拟局域网。', steps: '确认双方网络互通，选择朋友可访问的 IP，再创建房间并复制邀请。', note: '本地网络选择局域网 IP；使用 UU 时选择 UU 显示的虚拟 IP。访客网络、设备隔离和防火墙可能阻止互通。' },
  { id: 'public', name: '公网连接', description: '使用房主准备好的公网 IPv4 / IPv6 和端口。', steps: '确认公网地址和端口可达，选择或填写对外地址，再创建房间并复制邀请。', note: 'IPv4 通常需要端口映射；IPv6 需要双方网络支持并放行入站。地址格式正确不代表外网可达。' },
  { id: 'cloudflare', name: '异地便捷连接', description: '通过 Cloudflare Tunnel 自动生成临时房间入口。', steps: '房主创建房间，等待临时地址就绪，再复制邀请。加入者粘贴邀请即可。', note: '隧道只帮助连接房间，不转发画面和声音。临时地址就绪不代表音视频已连通；无法直连时需要在高级设置中配置 TURN。' },
  { id: 'mixed', name: '混合模式 · 实验', description: '独立选择 IP / Cloudflare 信令与本机媒体 IP。', steps: '分别配置房间信令和媒体 IP。', note: MIXED_MODE_NOTICE },
];

export function normalizeConnectionMode(value: unknown): ConnectionMode | null {
  if (value === 'uu') return 'lan';
  return CONNECTION_MODES.find((mode) => mode.id === value)?.id ?? null;
}

export function mediaPolicyForMode(mode: ConnectionMode): MediaPolicy {
  return mode === 'mixed' ? 'selected-ip-experimental' : mode === 'lan' ? 'local-auto' : 'internet-auto';
}

export function readConnectionMode(): ConnectionMode | null {
  try {
    const mode = normalizeConnectionMode(localStorage.getItem('gs.connectionMode'));
    if (mode === 'lan') localStorage.setItem('gs.connectionMode', mode);
    return mode;
  } catch { return null; }
}

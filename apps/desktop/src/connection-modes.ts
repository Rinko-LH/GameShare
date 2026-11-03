export type ConnectionMode = 'uu' | 'lan' | 'public' | 'cloudflare';

export const CONNECTION_MODES: Array<{ id: ConnectionMode; name: string; description: string; steps: string; note: string }> = [
  { id: 'uu', name: 'UU 云联机', description: '已经和朋友进入同一个 UU 云联机房间。', steps: '双方先进入同一个 UU 房间。房主创建房间，把 UU 虚拟 IP 或邀请发给朋友。', note: '请选择 UU 显示的虚拟 IP；能看到 UU 延迟，不代表 GameShare 一定能够互通。' },
  { id: 'lan', name: '本地局域网', description: '连接同一个路由器、Wi-Fi 或手机热点。', steps: '房主创建房间，把本机局域网地址或邀请发给朋友。', note: '访客 Wi-Fi、校园网或开启了设备隔离的热点，可能不允许设备之间连接。' },
  { id: 'public', name: '公网直连', description: '房主有朋友能访问的公网 IPv4 或 IPv6 地址。', steps: '房主先确认公网地址和端口可访问，再创建房间并发送地址或邀请。', note: 'IPv4 通常需要端口映射；IPv6 需要双方网络支持并放行入站。仅有公网地址不保证可达。' },
  { id: 'cloudflare', name: 'Cloudflare 异地连接', description: '不在同一个网络，通过互联网邀请朋友加入。', steps: '房主创建房间，等待异地地址准备好，再复制邀请发给朋友。', note: '隧道只帮助连接房间，不转发画面和声音。画面无法直连时，需要在高级设置中另外配置 TURN 中继。' },
];

export function readConnectionMode(): ConnectionMode | null {
  try {
    const value = localStorage.getItem('gs.connectionMode');
    return CONNECTION_MODES.find((mode) => mode.id === value)?.id ?? null;
  } catch { return null; }
}

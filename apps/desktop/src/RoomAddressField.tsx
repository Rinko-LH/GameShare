import { normalizeSignalingAddress } from '@game-share/shared';

interface Props {
  addresses: string[];
  value: string | null;
  onChange: (value: string) => void;
  source: 'local' | 'external';
  disabled: boolean;
  port: number;
}

/** The invitation has one public-facing address, chosen from local adapters or entered manually. */
export function RoomAddressField({ addresses, value, onChange, source, disabled, port }: Props) {
  let healthUrl: string | null = null;
  try { if (value?.trim()) healthUrl = new URL('/health', normalizeSignalingAddress(value)).href; } catch { /* Shown on create, never turn invalid input into a working link. */ }

  return <div className="room-address">
    {source === 'local' ? <>
      <label className="ip-connect__field"><span className="hint">房间邀请地址（选你自己的可达地址）</span>
        <select data-room-address="local" className="field__input field__input--compact" value={addresses.includes(value ?? '') ? value! : ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
          <option value="" disabled>请选择朋友能访问的地址</option>
          {addresses.map(url => <option key={url} value={url}>{url}</option>)}
        </select>
      </label>
      {addresses.length === 0 && <p className="hint hint--warn">没有找到可用地址，请连接网络后刷新；使用 UU 时先完成组网。</p>}
      <p className="hint hint--dim">同一局域网选真实网卡地址；双方用 UU 组网时选自己的 UU 地址。真实私网地址（如 192.168.x.x）通常不能从异地直接访问。</p>
    </> : <>
      <label className="ip-connect__field"><span className="hint">房间邀请地址（完整外网网址）</span>
        <input data-room-address="external" className="field__input field__input--compact" value={value ?? ''} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder="https://你的域名 或 http://公网IP:外网端口" spellCheck={false} />
      </label>
      <p className="hint hint--dim">复制内网穿透软件中的“外网访问地址”，带上 http:// 或 https:// 和外网端口；不要填“内网服务”，也不要只复制“映射 IP”。外网端口不一定是 {port}。</p>
      <details className="connection-help"><summary>花生壳 / Funnel 应该怎么对应？</summary>
        <p>穿透软件的转发目标：本机运行 GameShare 的地址与端口 {port}。先在浏览器确认该目标的 /health 返回 game-share-signaling，再建立映射；HTTP 服务不要误选成 HTTPS 后端。</p>
        <p>GameShare 这里填写穿透软件提供的完整外网入口，例如 https://你的域名 或 http://公网IP:映射端口。映射需支持 HTTP 和 WebSocket。它只负责房间连接，音视频不经过该映射。</p>
        <p>使用公网 IP 而不使用穿透时：需允许信令端口入站；IPv4 可能需要路由器端口映射，IPv6 需要双方支持 IPv6。</p>
      </details>
    </>}
    {healthUrl && <p className="hint room-address__check"><a href={healthUrl} target="_blank" rel="noreferrer">打开信令健康页</a><span>让朋友也访问；应返回 ok: true 和 game-share-signaling。这只检查房间入口，不代表音视频连通。</span></p>}
  </div>;
}

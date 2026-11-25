import { normalizeSignalingAddress } from '@game-share/shared';

interface Props {
  addresses: string[];
  value: string | null;
  onChange: (value: string) => void;
  source: 'local' | 'external';
  disabled: boolean;
}

/** The invitation has one public-facing address, chosen from local adapters or entered manually. */
export function RoomAddressField({ addresses, value, onChange, source, disabled }: Props) {
  let healthUrl: string | null = null;
  try { if (value?.trim()) healthUrl = new URL('/health', normalizeSignalingAddress(value)).href; } catch { /* Shown on create, never turn invalid input into a working link. */ }

  return <div className="room-address">
    {source === 'local' ? <>
      <label className="ip-connect__field"><span>房间邀请地址</span>
        <select data-room-address="local" className="field__input field__input--compact" value={addresses.includes(value ?? '') ? value! : ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
          <option value="" disabled>请选择朋友能访问的地址</option>
          {addresses.map(url => <option key={url} value={url}>{url}</option>)}
        </select>
      </label>
      {addresses.length === 0 && <p className="hint hint--warn">没有可用地址，请连接网络后刷新。</p>}
    </> : <>
      <label className="ip-connect__field"><span>房间邀请地址</span>
        <input data-room-address="external" className="field__input field__input--compact" value={value ?? ''} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder="https://你的域名 或 http://公网IP:外网端口" spellCheck={false} />
      </label>
    </>}
    {healthUrl && <p className="hint room-address__check"><a href={healthUrl} target="_blank" rel="noreferrer">检查房间地址</a></p>}
  </div>;
}

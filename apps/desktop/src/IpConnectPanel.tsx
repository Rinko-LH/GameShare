import { useState } from 'react';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress } from '@game-share/shared';
import { ShareSession } from './session/ShareSession';
import type { EmbeddedServerStatus, TunnelStatus } from './types/global';
import { CONNECTION_MODES, type ConnectionMode } from './connection-modes';

interface Props {
  mode: ConnectionMode;
  session: ShareSession;
  nickname: string;
  disabled: boolean;
  joined: boolean;
  busy: boolean;
  server: EmbeddedServerStatus | null;
  tunnel: TunnelStatus | null;
  inviteAddress: string | null;
  onInviteAddress: (address: string) => void;
  onServerUrl: (url: string) => void;
  onBusy: (busy: boolean) => void;
  onServer: (status: EmbeddedServerStatus) => void;
  onTunnel: (status: TunnelStatus) => void;
  onJoinInvitation: (text: string) => Promise<void>;
}

export function IpConnectPanel(props: Props) {
  const [role, setRole] = useState<'host' | 'guest'>('host');
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [invitation, setInvitation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locked = props.disabled || props.busy;
  const mode = CONNECTION_MODES.find((item) => item.id === props.mode)!;
  const cloud = props.mode === 'cloudflare';
  const lanOnly = props.mode === 'uu' || props.mode === 'lan';
  const addresses = [...new Set(props.mode === 'public'
    ? [...(props.server?.publicV4Urls ?? []), ...(props.server?.publicV6Urls ?? [])]
    : props.server?.lanUrls ?? [])];

  async function connect(create: boolean) {
    setError(null);
    props.onBusy(true);
    try {
      if (!create && invitation.trim()) { await props.onJoinInvitation(invitation); return; }
      if (!create && !address.trim()) throw new Error(cloud ? '请粘贴房主发来的完整邀请。' : '请输入房主的 IP 地址或粘贴完整邀请。');
      if (!create && !lanOnly && !roomCode.trim()) throw new Error('公网直连请填写房间码，或粘贴房主发来的完整邀请。');
      const url = create ? DEFAULT_SIGNALING_URL : normalizeSignalingAddress(address);
      if (create) {
        const api = window.gameShare?.server;
        if (!api) throw new Error('请在 GameShare 桌面窗口中创建房间，浏览器预览不支持本机服务。');
        const status = await api.setEnabled(true);
        props.onServer(status);
        if (status.state !== 'running' && status.state !== 'port-in-use') throw new Error(status.detail ?? '无法启动本机服务。');
        if (cloud) {
          const tunnel = window.gameShare?.tunnel;
          if (!tunnel || !props.tunnel?.available) throw new Error('此版本的异地连接组件不可用，请检查完整的软件文件。');
          const result = await tunnel.setEnabled(true);
          props.onTunnel(result);
          if (result.state === 'failed' || result.state === 'stopped') throw new Error(result.detail ?? '异地连接启动失败，请重试。');
        }
      }
      props.onServerUrl(url);
      await props.session.connectAndWait(url, lanOnly);
      if (create) await props.session.createRoom(props.nickname, lanOnly);
      else await props.session.joinRoom(roomCode.trim().toUpperCase(), props.nickname, lanOnly && !roomCode.trim());
    } catch (err) {
      const message = ShareSession.describeError(err);
      setError(message); props.session.pushLog(message);
    } finally { props.onBusy(false); }
  }

  return <section className="panel panel--tight ip-connect">
    <h2>{mode.name}</h2>
    {props.joined ? <p className="hint">已进入房间。可以选择屏幕共享，或等待朋友的画面。</p> : <p className="hint">{mode.steps}</p>}
    {!props.joined && <div className="connection-roles" aria-label="你想做什么">
      <button className={`btn ${role === 'host' ? 'btn--primary' : ''}`} type="button" disabled={locked} aria-pressed={role === 'host'} onClick={() => { setRole('host'); setError(null); }}>创建房间</button>
      <button className={`btn ${role === 'guest' ? 'btn--primary' : ''}`} type="button" disabled={locked} aria-pressed={role === 'guest'} onClick={() => { setRole('guest'); setError(null); }}>加入朋友</button>
    </div>}
    {role === 'host' ? <>
      {!props.disabled && <button className="btn btn--primary" type="button" disabled={locked} onClick={() => void connect(true)}>{props.busy ? '正在准备房间…' : '创建共享房间'}</button>}
      {!cloud && <>
        {addresses.length > 0 ? <label className="ip-connect__field">
          <span className="hint">发给朋友的地址{props.mode === 'uu' ? '（请选择 UU 显示的虚拟 IP）' : ''}</span>
          <select className="field__input field__input--compact" value={props.inviteAddress ?? ''} disabled={props.busy} onChange={(e) => props.onInviteAddress(e.target.value)}>
            {addresses.map((url) => <option key={url} value={url}>{url}</option>)}
          </select>
        </label> : <p className="hint hint--warn">{props.mode === 'public' ? '没有检测到本机公网地址。如果使用路由器端口映射，请在下方填写对外地址。' : '暂未检测到地址，请检查网络连接后刷新。'}</p>}
        {props.mode === 'public' && <label className="ip-connect__field"><span className="hint">对外地址（有端口映射时填写）</span>
          <input className="field__input field__input--compact" value={props.inviteAddress ?? ''} disabled={props.busy} placeholder="http://你的公网IP:映射端口" onChange={(e) => props.onInviteAddress(e.target.value)} />
        </label>}
        <button className="btn btn--tiny" type="button" disabled={props.busy} onClick={() => void window.gameShare?.server.getStatus().then(props.onServer).catch((err: unknown) => setError(ShareSession.describeError(err)))}>刷新本机地址</button>
      </>}
      {cloud && props.joined && <p className={`hint ${props.tunnel?.state === 'failed' ? 'hint--warn' : ''}`}>
        {props.tunnel?.state === 'running' ? '异地地址已准备好，可以复制邀请。' : props.tunnel?.state === 'failed' ? `异地地址准备失败：${props.tunnel.detail}` : '正在准备异地地址，请稍候；地址就绪后才能复制邀请。'}
      </p>}
      {cloud && props.joined && (props.tunnel?.state === 'failed' || props.tunnel?.state === 'stopped') && <button className="btn" type="button" disabled={props.busy} onClick={() => {
        props.onBusy(true);
        void window.gameShare?.tunnel.setEnabled(true).then(props.onTunnel).catch((err: unknown) => setError(ShareSession.describeError(err))).finally(() => props.onBusy(false));
      }}>重新准备异地地址</button>}
    </> : !props.joined && <form onSubmit={(e) => { e.preventDefault(); if (!locked) void connect(false); }}>
      <label className="ip-connect__field"><span className="hint">粘贴房主发来的完整邀请</span>
        <textarea className="field__input field__input--compact" value={invitation} onChange={(e) => setInvitation(e.target.value)} disabled={locked} rows={3} placeholder="一起玩 GameShare！GS1.…" />
      </label>
      {!cloud && <details><summary>没有邀请？手动输入 IP 地址</summary>
        <label className="ip-connect__field"><span className="hint">房主的{props.mode === 'uu' ? ' UU 虚拟' : props.mode === 'public' ? '公网' : '局域网'} IP</span>
          <input className="field__input field__input--compact" value={address} onChange={(e) => setAddress(e.target.value)} disabled={locked} placeholder="IP 或 IP:端口（默认 8080）" spellCheck={false} />
        </label>
        <label className="ip-connect__field"><span className="hint">{lanOnly ? '房间码（只有一个 IP 房间时可以不填）' : '房间码（必填）'}</span>
          <input className="field__input field__input--compact" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} disabled={locked} maxLength={8} spellCheck={false} />
        </label>
      </details>}
      <button className="btn btn--primary" type="submit" disabled={locked || (!invitation.trim() && !address.trim())}>{props.busy ? '正在加入…' : '连接并加入'}</button>
    </form>}
    {!props.joined && <p className="hint hint--dim">{mode.note}</p>}
    {error && <p className="hint hint--warn" role="alert">{error}</p>}
  </section>;
}

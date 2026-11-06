import { useEffect, useState } from 'react';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress } from '@game-share/shared';
import { parseInvitation } from './invitations';
import { ShareSession } from './session/ShareSession';
import type { EmbeddedServerStatus, TunnelStatus } from './types/global';
import { CONNECTION_MODES, mediaPolicyForMode, type ConnectionMode } from './connection-modes';

interface Props {
  mode: ConnectionMode;
  mixedSignaling: 'ip' | 'cloudflare';
  onMixedSignaling: (value: 'ip' | 'cloudflare') => void;
  mediaIp: string;
  onMediaIp: (value: string) => void;
  initialInvitation: string;
  role: 'host' | 'guest';
  onRoleChange: (role: 'host' | 'guest') => void;
  onConnectionError: (error: string | null) => void;
  onCreatingRoom: (creating: boolean) => void;
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
  const role = props.role;
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [invitation, setInvitation] = useState(props.initialInvitation);
  useEffect(() => { if (props.initialInvitation) setInvitation(props.initialInvitation); }, [props.initialInvitation]);
  const [error, setError] = useState<string | null>(null);
  const locked = props.disabled || props.busy;
  const mixed = props.mode === 'mixed';
  const mode = CONNECTION_MODES.find((item) => item.id === props.mode)!;
  const cloud = props.mode === 'cloudflare' || (mixed && props.mixedSignaling === 'cloudflare');
  const lanOnly = mediaPolicyForMode(props.mode) === 'local-auto';
  const addresses = [...new Set(props.mode === 'public'
    ? [...(props.server?.publicV4Urls ?? []), ...(props.server?.publicV6Urls ?? [])]
    : mixed ? [...(props.server?.lanUrls ?? []), ...(props.server?.publicV4Urls ?? []), ...(props.server?.publicV6Urls ?? [])] : props.server?.lanUrls ?? [])];

  async function connect(create: boolean) {
    if (locked) return;
    setError(null);
    props.onConnectionError(null);
    if (create) props.onCreatingRoom(true);
    props.onBusy(true);
    try {
      if (mixed) {
        const status = await window.gameShare?.server.getStatus();
        if (!props.mediaIp || !status?.mediaAddresses.some(item => item.address === props.mediaIp)) throw new Error('请先选择当前电脑上有效的媒体 IP。');
      }
      if (create && !cloud) {
        if (!props.inviteAddress) throw new Error('请先选择或填写朋友可访问的信令地址。');
        normalizeSignalingAddress(props.inviteAddress);
        if (lanOnly && !addresses.includes(props.inviteAddress)) throw new Error('所选 IP 已不可用，请刷新地址并重新选择。');
      }
      if (!create && invitation.trim()) { await props.onJoinInvitation(invitation); return; }
      if (!create && !address.trim()) throw new Error(cloud ? '请粘贴房主发来的邀请链接。' : '请输入房主的 IP 地址或粘贴邀请链接。');
      if (!create && !lanOnly && !roomCode.trim()) throw new Error('公网连接请填写房间码，或粘贴房主发来的邀请链接。');
      let url = create ? DEFAULT_SIGNALING_URL : normalizeSignalingAddress(address);
      if (create) {
        const api = window.gameShare?.server;
        if (!api) throw new Error('请在 GameShare 桌面窗口中创建房间，浏览器预览不支持本机服务。');
        const status = await api.setEnabled(true);
        props.onServer(status);
        url = status.localUrl;
        if (status.state !== 'running' && status.state !== 'port-in-use') throw new Error(status.detail ?? '无法启动本机服务。');
        if (cloud) {
          const tunnel = window.gameShare?.tunnel;
          if (!tunnel || !props.tunnel?.available) throw new Error('此版本的异地连接组件不可用，请检查完整的软件文件。');
          const result = await tunnel.setEnabled(true);
          props.onTunnel(result);
          if (result.state === 'failed' || result.state === 'stopped') throw new Error(result.detail ?? '异地连接启动失败，请重试。');
        }
      }
      props.session.configureMediaIp(mixed ? props.mediaIp : null);
      props.onServerUrl(url);
      await props.session.connectAndWait(url, mixed || lanOnly);
      if (create) await props.session.createRoom(props.nickname, lanOnly);
      else await props.session.joinRoom(roomCode.trim().toUpperCase(), props.nickname, lanOnly && !roomCode.trim());
    } catch (err) {
      const message = ShareSession.describeError(err);
      props.onConnectionError(message);
      setError(message); props.session.pushLog(message);
    } finally { if (create) props.onCreatingRoom(false); props.onBusy(false); }
  }

  return <section className="panel panel--tight ip-connect">
    <h2>{mode.name}</h2>
    {props.joined ? <p className="hint">已进入房间。可以选择屏幕共享，或等待朋友的画面。</p> : <p className="hint">{role === 'host' ? mode.steps : '确认已具备该模式需要的网络条件，粘贴房主邀请，再连接并加入。'}</p>}
    {mixed && <p className="hint hint--warn">{mode.note}</p>}
    {!props.joined && <fieldset className="connection-roles" disabled={locked}>
      <legend>第一步：选择角色</legend>
      <label><input type="radio" name="connection-role" value="host" checked={role === 'host'} onChange={() => { props.onRoleChange('host'); setError(null); }} />我是房主</label>
      <label><input type="radio" name="connection-role" value="guest" checked={role === 'guest'} onChange={() => { props.onRoleChange('guest'); setError(null); }} />我要加入</label>
    </fieldset>}
    {mixed && <>
      {props.initialInvitation && !props.mediaIp && <p className="hint">已识别混合模式邀请，请先选择你自己电脑上的媒体 IP，再点击加入。</p>}
      <fieldset className="connection-roles" disabled={locked}>
        <legend>第二步：房间信令连接</legend>
        <label><input type="radio" name="mixed-signaling" value="ip" checked={props.mixedSignaling === 'ip'} onChange={() => props.onMixedSignaling('ip')} />IP 直连</label>
        <label><input type="radio" name="mixed-signaling" value="cloudflare" checked={props.mixedSignaling === 'cloudflare'} onChange={() => props.onMixedSignaling('cloudflare')} />Cloudflare</label>
      </fieldset>
      <label className="ip-connect__field"><span className="hint">第三步：本机媒体 IP（每人选择自己的地址）</span>
        <select className="field__input field__input--compact media-ip-select" value={props.mediaIp} disabled={locked} onChange={e => props.onMediaIp(e.target.value)}>
          <option value="">请选择媒体 IP</option>
          {(props.server?.mediaAddresses ?? []).map(item => <option key={`${item.interfaceName}/${item.address}`} value={item.address}>{item.interfaceName} · {item.address}（{item.family}）</option>)}
        </select>
      </label>
      {!props.joined && <button className="btn btn--tiny" type="button" disabled={locked} onClick={() => void window.gameShare?.server.getStatus().then(props.onServer).catch(err => setError(ShareSession.describeError(err)))}>刷新媒体 IP</button>}
      <p className="hint hint--dim">使用 UU 时请选择 UU 虚拟 IP；信令地址与媒体 IP 可以不同。双方都需使用支持混合实验模式的版本。</p>
      {props.joined && <p className="hint">已选择媒体 IP：{props.mediaIp}。实际地址请查看每位成员的“音视频实际路径”。修改配置需先离开房间。</p>}
    </>}
    {role === 'host' ? <>
      {!props.joined && <p className="hint">{mixed ? '信令入口：' : '第二步：'}{cloud ? '自动准备临时房间入口' : '选择朋友可访问的信令地址'}</p>}
      {!cloud && !props.joined && <>
        {addresses.length > 0 ? <label className="ip-connect__field">
          <span className="hint">发给朋友的地址{props.mode === 'lan' ? '（局域网或 UU 虚拟 IP）' : ''}</span>
          <select className="field__input field__input--compact" value={addresses.includes(props.inviteAddress ?? '') ? props.inviteAddress! : ''} disabled={locked} onChange={(e) => props.onInviteAddress(e.target.value)}>
            <option value="" disabled>请选择朋友可访问的地址</option>
            {addresses.map((url) => <option key={url} value={url}>{url}</option>)}
          </select>
        </label> : <p className="hint hint--warn">{props.mode === 'public' ? '没有检测到本机公网地址。如果使用路由器端口映射，请在下方填写对外地址。' : '暂未检测到地址，请检查网络连接后刷新。'}</p>}
        {(props.mode === 'public' || mixed) && <label className="ip-connect__field"><span className="hint">对外地址（有端口映射时填写）</span>
          <input className="field__input field__input--compact" value={props.inviteAddress ?? ''} disabled={locked} placeholder="http://你的公网IP:映射端口" onChange={(e) => props.onInviteAddress(e.target.value)} />
        </label>}
        <button className="btn btn--tiny" type="button" disabled={props.busy} onClick={() => void window.gameShare?.server.getStatus().then(props.onServer).catch((err: unknown) => setError(ShareSession.describeError(err)))}>刷新本机地址</button>
      </>}
      {!props.joined && <p className="hint">{mixed ? '配置完成：' : '第三步：'}创建房间，再复制邀请发给朋友。</p>}
      {!props.disabled && <button className="btn btn--primary" type="button" disabled={locked || (mixed && !props.mediaIp)} onClick={() => void connect(true)}>{props.busy ? '正在准备房间…' : '创建房间'}</button>}
      {cloud && props.joined && <p className={`hint ${props.tunnel?.state === 'failed' ? 'hint--warn' : ''}`}>
        {props.tunnel?.state === 'running' ? '异地地址已准备好，可以复制邀请。' : props.tunnel?.state === 'failed' ? `异地地址准备失败：${props.tunnel.detail}` : '正在准备异地地址，请稍候；地址就绪后才能复制邀请。'}
      </p>}
      {cloud && props.joined && (props.tunnel?.state === 'failed' || props.tunnel?.state === 'stopped') && <button className="btn" type="button" disabled={props.busy} onClick={() => {
        props.onBusy(true);
        void window.gameShare?.tunnel.setEnabled(true).then(props.onTunnel).catch((err: unknown) => setError(ShareSession.describeError(err))).finally(() => props.onBusy(false));
      }}>重新准备异地地址</button>}
    </> : !props.joined && <form onSubmit={(e) => { e.preventDefault(); if (!locked) void connect(false); }}>
      <label className="ip-connect__field"><span className="hint">第二步：粘贴朋友发来的邀请链接</span>
        <textarea className="field__input field__input--compact" value={invitation} onChange={(e) => { setInvitation(e.target.value); const parsed = parseInvitation(e.target.value); if (mixed && parsed?.signaling) props.onMixedSignaling(parsed.signaling); }} disabled={locked} rows={3} placeholder={mixed ? 'GS2.…' : 'GS1.… / GS2.…'} />
      </label>
      {(!cloud || mixed) && <details><summary>没有邀请？手动输入信令地址</summary>
        <label className="ip-connect__field"><span className="hint">{mixed ? '房主的信令地址（IP 或隧道 URL）' : <>房主的{props.mode === 'public' ? '公网' : '局域网或虚拟局域网'} IP</>}</span>
          <input className="field__input field__input--compact" value={address} onChange={(e) => setAddress(e.target.value)} disabled={locked} placeholder="IP 或 IP:端口（默认 8080）" spellCheck={false} />
        </label>
        <label className="ip-connect__field"><span className="hint">{lanOnly ? '房间码（只有一个 IP 房间时可以不填）' : '房间码（必填）'}</span>
          <input className="field__input field__input--compact" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} disabled={locked} maxLength={8} spellCheck={false} />
        </label>
      </details>}
      <button className="btn btn--primary" type="submit" disabled={locked || (mixed && !props.mediaIp) || (!invitation.trim() && !address.trim())}>{props.busy ? '正在加入…' : '连接并加入'}</button>
    </form>}
    {!props.joined && !mixed && <p className="hint hint--dim">{mode.note}</p>}
    {props.joined && <p className="hint hint--dim">房间信令已连接。画面、语音和共享声音的连接状态请分别查看成员卡片。</p>}
    {error && <p className="hint hint--dim">{cloud ? '房间连接失败：检查临时邀请是否有效，以及房主隧道是否仍在运行。' : '房间连接失败：检查所选地址、服务端口和防火墙；IP 连接还需确认局域网或虚拟网络互通。'}</p>}
    {error && <p className="hint hint--warn" role="alert">{error}</p>}
  </section>;
}

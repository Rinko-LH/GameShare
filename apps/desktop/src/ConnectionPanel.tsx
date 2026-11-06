import { useEffect, useState } from 'react';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress } from '@game-share/shared';
import { parseInvitation } from './invitations';
import { MEDIA_STRATEGIES, SIGNALING_METHODS, type ConnectionConfig } from './connection-config';
import { ShareSession } from './session/ShareSession';
import type { EmbeddedServerStatus, TunnelStatus } from './types/global';
import { RoomAddressField } from './RoomAddressField';

interface Props {
  config: ConnectionConfig;
  onConfig: (config: ConnectionConfig) => void;
  mediaIp: string;
  onMediaIp: (value: string) => void;
  initialInvitation: string;
  onInvitation: (text: string) => void;
  role: 'host' | 'guest';
  onRoleChange: (role: 'host' | 'guest') => void;
  connectionError: string | null;
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

export function ConnectionPanel(props: Props) {
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [invitation, setInvitation] = useState(props.initialInvitation);
  useEffect(() => { setInvitation(props.initialInvitation); }, [props.initialInvitation]);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseInvitation(invitation);
  const locked = props.disabled || props.busy;
  const inherited = props.role === 'guest' && Boolean(parsed?.server && parsed.room && !parsed.error && (parsed.config || parsed.mode || parsed.mediaPolicy));
  const { signaling, mediaPolicy } = props.config;
  const selectedIp = mediaPolicy === 'selected-ip-experimental';
  const cloud = signaling === 'cloudflare';
  const addresses = [...new Set([...(props.server?.lanUrls ?? []), ...(props.server?.publicV4Urls ?? []), ...(props.server?.publicV6Urls ?? [])])];
  const shownError = parsed?.error ?? error ?? props.connectionError;
  const signalingInfo = SIGNALING_METHODS.find(item => item.value === signaling)!;
  const mediaInfo = MEDIA_STRATEGIES.find(item => item.value === mediaPolicy)!;
  const bareIpJoin = signaling === 'ip' && mediaPolicy === 'local-auto';

  async function connect() {
    if (locked) return;
    setError(null); props.onConnectionError(null); props.onBusy(true);
    const create = props.role === 'host';
    if (create) props.onCreatingRoom(true);
    try {
      if (!create && invitation.trim()) { await props.onJoinInvitation(invitation); return; }
      if (selectedIp) {
        const status = await window.gameShare?.server.getStatus();
        if (!props.mediaIp || !status?.mediaAddresses.some(item => item.address === props.mediaIp)) throw new Error('请先选择当前电脑上有效的媒体 IP。');
      }
      if (create && !cloud) {
        if (!props.inviteAddress?.trim()) throw new Error('请先选择或填写朋友可访问的房间地址。');
        normalizeSignalingAddress(props.inviteAddress);
        if (signaling === 'ip' && !addresses.includes(props.inviteAddress)) throw new Error('所选 IP 已不可用，请刷新地址并重新选择。');
      }
      if (!create && !address.trim()) throw new Error('请粘贴朋友的完整邀请，或填写房主地址和房间码。');
      if (!create && !bareIpJoin && !roomCode.trim()) throw new Error('请填写房间码，或直接粘贴完整邀请。');
      let url = create ? DEFAULT_SIGNALING_URL : normalizeSignalingAddress(address);
      if (create) {
        const api = window.gameShare?.server;
        if (!api) throw new Error('请在 GameShare 桌面窗口中创建房间。');
        const status = await api.setEnabled(true);
        props.onServer(status);
        if (status.state !== 'running' && status.state !== 'port-in-use') throw new Error(status.detail ?? '无法启动本机服务。');
        url = status.localUrl;
        if (cloud) {
          const tunnel = window.gameShare?.tunnel;
          if (!tunnel || !props.tunnel?.available) throw new Error('Cloudflare 组件不可用，请检查完整的软件文件。');
          const result = await tunnel.setEnabled(true);
          props.onTunnel(result);
          if (result.state === 'failed' || result.state === 'stopped') throw new Error(result.detail ?? '临时入口准备失败，请重试。');
        }
      }
      props.session.configureMediaIp(selectedIp ? props.mediaIp : null);
      props.onServerUrl(url);
      await props.session.connectAndWait(url, mediaPolicy !== 'internet-auto');
      if (create) await props.session.createRoom(props.nickname, bareIpJoin);
      else await props.session.joinRoom(roomCode.trim().toUpperCase(), props.nickname, bareIpJoin && !roomCode.trim());
    } catch (err) {
      const message = ShareSession.describeError(err);
      props.onConnectionError(message); setError(message); props.session.pushLog(message);
    } finally { if (create) props.onCreatingRoom(false); props.onBusy(false); }
  }

  const refresh = () => void window.gameShare?.server.getStatus().then(props.onServer).catch(err => setError(ShareSession.describeError(err)));
  return <section className="panel panel--tight connection-panel">
    <h2>连接配置</h2>
    <fieldset className="connection-roles" disabled={locked}>
      <legend>第一步：选择角色</legend>
      <label><input type="radio" name="connection-role" value="host" checked={props.role === 'host'} onChange={() => { props.onRoleChange('host'); setError(null); }} />创建房间</label>
      <label><input type="radio" name="connection-role" value="guest" checked={props.role === 'guest'} onChange={() => { props.onRoleChange('guest'); setError(null); }} />加入房间</label>
    </fieldset>
    <form className="connection-config-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      {props.role === 'guest' && !props.joined && <>
        <label className="ip-connect__field"><span className="hint">粘贴房主的完整邀请</span>
          <textarea data-invitation className="field__input" value={invitation} disabled={locked} onChange={event => {
            setInvitation(event.target.value); setError(null); props.onInvitation(event.target.value);
          }} placeholder="GS3.…（也兼容旧版 GS1 / GS2 邀请）" rows={3} spellCheck={false} />
        </label>
        {parsed?.server && parsed.room && !parsed.error && <p className="hint invite-recognized">已识别房间 {parsed.room}。{inherited ? '信令与音视频配置已从邀请自动读取。' : '旧邀请没有完整策略，请确认下方设置与房主一致。'}{selectedIp ? '请选择你自己电脑上的媒体 IP。' : '点击“连接并加入”即可。'}</p>}
      </>}
      <label className="ip-connect__field"><span>第二步：信令连接方式（进入房间）</span>
        <select data-signaling className="field__input field__input--compact" value={signaling} disabled={locked || inherited} onChange={event => props.onConfig({ ...props.config, signaling: event.target.value as ConnectionConfig['signaling'] })}>
          {SIGNALING_METHODS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <p className="hint hint--dim">{signalingInfo.hint}</p>
      {props.role === 'host' && !props.joined && !cloud && <>
        <RoomAddressField source={signaling === 'external' ? 'external' : 'local'} addresses={addresses} value={props.inviteAddress} onChange={props.onInviteAddress} disabled={locked} port={props.server?.port ?? 8080} />
        <button className="btn btn--tiny" type="button" disabled={locked} onClick={refresh}>刷新本机地址</button>
      </>}
      <label className="ip-connect__field connection-step"><span>第三步：音视频连接方式（传画面和声音）</span>
        <select data-media-policy className="field__input field__input--compact" value={mediaPolicy} disabled={locked || inherited} onChange={event => props.onConfig({ ...props.config, mediaPolicy: event.target.value as ConnectionConfig['mediaPolicy'] })}>
          {MEDIA_STRATEGIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <p className={`hint ${selectedIp ? 'hint--warn' : 'hint--dim'}`}>{mediaInfo.hint}</p>
      {selectedIp && <>
        <label className="ip-connect__field"><span className="hint">我的媒体 IP（每个人选择自己电脑上的地址）</span>
          <select data-media-ip className="field__input field__input--compact media-ip-select" value={props.mediaIp} disabled={locked} onChange={event => props.onMediaIp(event.target.value)}>
            <option value="">请选择自己的媒体 IP</option>
            {(props.server?.mediaAddresses ?? []).map(item => <option key={`${item.interfaceName}/${item.address}`} value={item.address}>{item.interfaceName} · {item.address}（{item.family}）</option>)}
          </select>
        </label>
        {!props.joined && <button className="btn btn--tiny" type="button" disabled={locked} onClick={refresh}>刷新媒体 IP</button>}
        <p className="hint">使用 UU 时双方各选自己的 UU IP；同一局域网可以选真实网卡 IP。这里不填朋友的 IP，也不填穿透映射 IP。</p>
        <details className="connection-help"><summary>选真实网卡 IP 和实验限制</summary><p>异地双方的 192.168.x.x、10.x.x.x 等私网地址通常不能互通；信令穿透不会打通媒体网络。当前仅限制候选并核对实际路径，尚不保证底层严格绑定 IP。所选 IP 失效会停止媒体，房间信令保留；离房后才能重新配置。</p></details>
      </>}
      {props.role === 'guest' && !props.joined && <details className="connection-help"><summary>没有邀请？手动填写地址和房间码</summary>
        <p>先清空邀请，选择与房主一致的两项连接配置，再输入房主提供的信息。</p>
        <label className="ip-connect__field"><span>房主地址</span><input data-join-address className="field__input" value={address} onChange={event => setAddress(event.target.value)} disabled={locked} placeholder="https://房主域名 或 IP:端口" /></label>
        <label className="ip-connect__field"><span>{bareIpJoin ? '房间码（唯一 IP 房间时可不填）' : '房间码'}</span><input data-join-code className="field__input" value={roomCode} onChange={event => setRoomCode(event.target.value)} disabled={locked} maxLength={8} spellCheck={false} /></label>
      </details>}
      {!props.joined && <>
        <p className="hint hint--dim">{props.role === 'host' ? cloud ? '创建房间后等待临时网址就绪，再从顶部复制邀请发给朋友。' : '创建房间后从顶部复制邀请，朋友粘贴后会自动读取上述两项配置。' : '邀请只传连接要求，不会复制房主的本机媒体 IP。'}</p>
        <button className="btn btn--primary" type="submit" disabled={locked || (selectedIp && !props.mediaIp) || (props.role === 'guest' && (Boolean(parsed?.error) || (!invitation.trim() && !address.trim())))}>{props.busy ? '正在连接…' : props.role === 'host' ? '创建房间' : '连接并加入'}</button>
      </>}
    </form>
    {props.joined && <p className="hint">房间已连接，配置已锁定。到“屏幕共享”选择画面；修改网络配置需先离开房间。</p>}
    {props.joined && props.role === 'host' && cloud && <>
      <p className="hint">{props.tunnel?.state === 'running' ? '邀请网址已准备好，可从顶部复制。' : props.tunnel?.state === 'failed' || props.tunnel?.state === 'stopped' ? '临时入口未就绪，请重试。' : '正在准备临时邀请网址…'}</p>
      {props.tunnel?.detail && <p className="hint hint--warn">{props.tunnel.detail}</p>}
      {(props.tunnel?.state === 'failed' || props.tunnel?.state === 'stopped') && <button type="button" className="btn" disabled={props.busy} onClick={() => {
        props.onBusy(true); void window.gameShare?.tunnel.setEnabled(true).then(props.onTunnel).catch(err => setError(ShareSession.describeError(err))).finally(() => props.onBusy(false));
      }}>重新准备邀请网址</button>}
    </>}
    <details className="connection-help"><summary>连接失败，下一步检查什么？</summary><ol>
      <li>没进房：让朋友访问房间地址的 /health，确认返回 ok: true 和 game-share-signaling。检查房主服务、映射和防火墙；临时网址更换后重发邀请。</li>
      <li>已进房、等待共享：请共享者到“屏幕共享”选择屏幕或窗口。</li>
      <li>已共享、媒体失败：检查双方组网与媒体 IP 可达性。自动协商可以使用房主已配置的 TURN；另外两项媒体策略不使用 TURN。</li>
    </ol><p>信令连通与媒体连通分别判断。Cloudflare 隧道等房间入口不转发画面和声音。</p></details>
    {shownError && <p className="hint hint--warn" role="alert">{shownError}</p>}
  </section>;
}

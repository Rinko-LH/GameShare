import { useEffect, useState } from 'react';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress } from '@game-share/shared';
import { parseInvitation } from './invitations';
import { MEDIA_STRATEGIES, SIGNALING_METHODS, type ConnectionConfig } from './connection-config';
import { ShareSession } from './session/ShareSession';
import type { EmbeddedServerStatus, TunnelStatus } from './types/global';
import { RoomAddressField } from './RoomAddressField';
import { t } from './i18n';

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
  onNickname: (nickname: string) => void;
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
          if (!tunnel || !(props.tunnel ?? await tunnel.getStatus()).available) throw new Error('Cloudflare 组件不可用，请检查完整的软件文件。');
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

  if (props.joined) return null;

  const refresh = () => void window.gameShare?.server.getStatus().then(props.onServer).catch(err => setError(ShareSession.describeError(err)));
  return <section className="panel panel--tight connection-panel">
    <fieldset className="connection-roles" aria-label="房间操作" disabled={locked}>
      <label><input type="radio" name="connection-role" value="host" checked={props.role === 'host'} onChange={() => { props.onRoleChange('host'); setError(null); }} />创建房间</label>
      <label><input type="radio" name="connection-role" value="guest" checked={props.role === 'guest'} onChange={() => { props.onRoleChange('guest'); setError(null); }} />加入房间</label>
    </fieldset>
    <form className="connection-config-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label className="ip-connect__field"><span>{t('conn.nickname')}</span>
        <input name="nickname" className="field__input field__input--compact" value={props.nickname} onChange={event => props.onNickname(event.target.value)} maxLength={16} disabled={locked} />
      </label>
      {props.role === 'guest' && <>
        <label className="ip-connect__field"><span>房间邀请</span>
          <textarea data-invitation className="field__input" value={invitation} disabled={locked} onChange={event => {
            setInvitation(event.target.value); setError(null); props.onInvitation(event.target.value);
          }} placeholder="粘贴完整邀请" rows={2} spellCheck={false} />
        </label>
        {parsed?.server && parsed.room && !parsed.error && <p className="hint" role="status">
          已识别房间 {parsed.room}{!inherited && '。请核对房主的连接配置。'}
        </p>}
      </>}
      <label className="ip-connect__field"><span>信令连接</span>
        <select data-signaling className="field__input field__input--compact" value={signaling} disabled={locked || inherited} onChange={event => props.onConfig({ ...props.config, signaling: event.target.value as ConnectionConfig['signaling'] })}>
          {SIGNALING_METHODS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {props.role === 'host' && !cloud && <>
        <RoomAddressField source={signaling === 'external' ? 'external' : 'local'} addresses={addresses} value={props.inviteAddress} onChange={props.onInviteAddress} disabled={locked} />
        {signaling === 'ip' && <button className="btn btn--tiny" type="button" disabled={locked} onClick={refresh}>刷新本机地址</button>}
      </>}
      <label className="ip-connect__field"><span>音视频连接</span>
        <select data-media-policy className="field__input field__input--compact" value={mediaPolicy} disabled={locked || inherited} onChange={event => props.onConfig({ ...props.config, mediaPolicy: event.target.value as ConnectionConfig['mediaPolicy'] })}>
          {MEDIA_STRATEGIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {selectedIp && <>
        <label className="ip-connect__field" title="UU 组网时选择自己的 UU IP"><span>本机媒体 IP</span>
          <select data-media-ip className="field__input field__input--compact media-ip-select" value={props.mediaIp} disabled={locked} onChange={event => props.onMediaIp(event.target.value)}>
            <option value="">请选择自己的媒体 IP</option>
            {(props.server?.mediaAddresses ?? []).map(item => <option key={`${item.interfaceName}/${item.address}`} value={item.address}>{item.interfaceName} · {item.address}（{item.family}）</option>)}
          </select>
        </label>
        <button className="btn btn--tiny" type="button" disabled={locked} onClick={refresh}>刷新媒体 IP</button>
      </>}
      {props.role === 'guest' && <details><summary>手动填写地址和房间码</summary>
        {invitation.trim() && <p className="hint">清空邀请后可手动加入。</p>}
        <label className="ip-connect__field"><span>房主地址</span><input data-join-address className="field__input" value={address} onChange={event => setAddress(event.target.value)} disabled={locked} placeholder="https://房主域名 或 IP:端口" /></label>
        <label className="ip-connect__field"><span>{bareIpJoin ? '房间码（唯一 IP 房间时可不填）' : '房间码'}</span><input data-join-code className="field__input" value={roomCode} onChange={event => setRoomCode(event.target.value)} disabled={locked} maxLength={8} spellCheck={false} /></label>
      </details>}
      <button className="btn btn--primary" type="submit" disabled={locked || (selectedIp && !props.mediaIp) || (props.role === 'guest' && (Boolean(parsed?.error) || (!invitation.trim() && !address.trim())))}>{props.busy ? '正在连接…' : props.role === 'host' ? '创建房间' : '连接并加入'}</button>
    </form>
    {shownError && <p className="hint hint--warn" role="alert">{shownError}</p>}
  </section>;
}

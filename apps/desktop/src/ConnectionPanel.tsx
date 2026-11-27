import { useEffect, useId, useState } from 'react';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress } from '@game-share/shared';
import { parseInvitation } from './invitations';
import { MEDIA_STRATEGIES, SIGNALING_METHODS, type ConnectionConfig } from './connection-config';
import { ShareSession } from './session/ShareSession';
import type { EmbeddedServerStatus, TunnelStatus } from './types/global';
import { RoomAddressField } from './RoomAddressField';
import { fmt, t } from './i18n';

const TAURI_SIGNALING_LABELS = {
  cloudflare: 'conn.signaling.cloudflareShort',
  ip: 'conn.signaling.directIpShort',
  external: 'conn.signaling.publicForwardingShort',
} as const;
const TAURI_MEDIA_LABELS = {
  'internet-auto': 'conn.media.automaticShort',
  'selected-ip-experimental': 'conn.media.manualIp',
} as const;

function RecommendationStar() {
  return <svg className="connection-recommendation-star" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="m8 1 2.05 4.2 4.64.67-3.35 3.28.79 4.63L8 11.6l-4.13 2.18.79-4.63L1.31 5.87l4.64-.67Z" />
  </svg>;
}

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
  const formId = useId();
  const isTauri = window.gameShare?.runtime === 'tauri';
  const OptionGroup = isTauri ? 'fieldset' : 'div';
  const parsed = parseInvitation(invitation);
  const locked = props.disabled || props.busy;
  const joining = props.role === 'guest';
  const inherited = joining && Boolean(parsed?.server && parsed.room && !parsed.error && (parsed.config || parsed.mode || parsed.mediaPolicy));
  const { signaling, mediaPolicy } = props.config;
  const selectedIp = mediaPolicy === 'selected-ip-experimental';
  const cloud = signaling === 'cloudflare';
  const addresses = [...new Set([...(props.server?.lanUrls ?? []), ...(props.server?.publicV4Urls ?? []), ...(props.server?.publicV6Urls ?? [])])];
  const invitationError = joining ? parsed?.error : null;
  const shownError = invitationError ?? error ?? props.connectionError;
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
    <form className="connection-config-form" aria-label={t('conn.roomSetup')} aria-busy={props.busy} onSubmit={event => { event.preventDefault(); void connect(); }}>
      <fieldset className="connection-roles" aria-label={t('conn.roomAction')} disabled={locked}>
        <label>
          <input type="radio" name="connection-role" value="host" checked={!joining} onChange={() => { props.onRoleChange('host'); setError(null); }} />
          {t('room.create')}
        </label>
        <label>
          <input type="radio" name="connection-role" value="guest" checked={joining} onChange={() => { props.onRoleChange('guest'); setError(null); }} />
          {t('conn.join')}
        </label>
      </fieldset>
      <label className="ip-connect__field"><span>{t('conn.nickname')}</span>
        <input name="nickname" className="field__input field__input--compact" value={props.nickname} onChange={event => props.onNickname(event.target.value)} maxLength={16} disabled={locked} />
      </label>
      {joining && <>
        <label className="ip-connect__field"><span>{t('conn.invitation')}</span>
          <textarea
            data-invitation className="field__input" value={invitation} disabled={locked}
            aria-invalid={Boolean(invitationError)} aria-describedby={invitationError ? `${formId}-error` : `${formId}-invitation-status`}
            onChange={event => {
              setInvitation(event.target.value);
              setError(null);
              props.onInvitation(event.target.value);
            }}
            placeholder={t('conn.invitationPlaceholder')} rows={2} spellCheck={false}
          />
        </label>
        <div id={`${formId}-invitation-status`} className="connection-invite-status" role="status">
          {parsed?.server && parsed.room && !parsed.error && <p className="hint">
            {fmt(inherited ? 'conn.inviteSettingsApplied' : 'conn.inviteCheckSettings', { room: parsed.room })}
          </p>}
        </div>
        <details className="connection-manual">
          <summary>{t('conn.manual')}</summary>
          <div className="connection-manual__fields">
            {invitation.trim() && <p className="hint">{t('conn.manualHint')}</p>}
            <label className="ip-connect__field"><span>{t('conn.hostAddress')}</span>
              <input data-join-address className="field__input" value={address} onChange={event => setAddress(event.target.value)} disabled={locked} placeholder={t('conn.hostAddressPlaceholder')} spellCheck={false} />
            </label>
            <label className="ip-connect__field"><span>{t(bareIpJoin ? 'conn.roomCodeOptional' : 'conn.roomCode')}</span>
              <input data-join-code className="field__input" value={roomCode} onChange={event => setRoomCode(event.target.value)} disabled={locked} maxLength={8} spellCheck={false} />
            </label>
          </div>
        </details>
      </>}
      <fieldset className="connection-network">
        <legend>{t('conn.network')}</legend>
        <OptionGroup className="connection-option">
          {isTauri ? <>
            <legend id={`${formId}-signaling-title`}>{t('conn.signaling.roomConnection')}</legend>
            <div className="settings-options settings-options--three segmented-control" role="group" aria-labelledby={`${formId}-signaling-title`}>
              {(Object.keys(TAURI_SIGNALING_LABELS) as Array<ConnectionConfig['signaling']>).map(value => (
                <button key={value} type="button" className="btn" data-signaling={value} aria-pressed={signaling === value}
                  aria-label={value === 'cloudflare' ? fmt('conn.recommendedOption', { option: t(TAURI_SIGNALING_LABELS[value]) }) : undefined}
                  title={value === 'cloudflare' ? t('conn.recommended') : undefined}
                  disabled={locked || inherited} onClick={() => { if (signaling !== value) props.onConfig({ ...props.config, signaling: value }); }}>
                  {value === 'cloudflare' && <RecommendationStar />}
                  {t(TAURI_SIGNALING_LABELS[value])}
                </button>
              ))}
            </div>
          </> : <label className="ip-connect__field"><span>{t('conn.signaling')}</span>
            <select data-signaling className="field__input field__input--compact" value={signaling} disabled={locked || inherited} onChange={event => props.onConfig({ ...props.config, signaling: event.target.value as ConnectionConfig['signaling'] })}>
              {SIGNALING_METHODS.map(({ value }) => <option key={value} value={value}>{t(`conn.signaling.${value}`)}</option>)}
            </select>
          </label>}
          {!joining && !cloud && <>
            <RoomAddressField source={signaling === 'external' ? 'external' : 'local'} addresses={addresses} value={props.inviteAddress} onChange={props.onInviteAddress} disabled={locked} hideLocalLabel={isTauri} externalHint={isTauri ? t('conn.publicForwardingHint') : undefined} />
            {signaling === 'ip' && <button className="btn btn--tiny" type="button" disabled={locked} onClick={refresh}>{t('ip.refresh')}</button>}
          </>}
        </OptionGroup>
        <OptionGroup className="connection-option">
          {isTauri ? <>
            <legend id={`${formId}-media-title`}>{t('conn.media.streamConnection')}</legend>
            <div className="settings-options segmented-control connection-media-options" role="group" aria-labelledby={`${formId}-media-title`}>
              {(Object.keys(TAURI_MEDIA_LABELS) as Array<keyof typeof TAURI_MEDIA_LABELS>).map(value => (
                <button key={value} type="button" className="btn" data-media-policy={value} aria-pressed={mediaPolicy === value}
                  aria-label={value === 'internet-auto' ? fmt('conn.recommendedOption', { option: t(TAURI_MEDIA_LABELS[value]) }) : undefined}
                  title={value === 'internet-auto' ? t('conn.recommended') : undefined}
                  disabled={locked || inherited} onClick={() => { if (mediaPolicy !== value) props.onConfig({ ...props.config, mediaPolicy: value }); }}>
                  {value === 'internet-auto' && <RecommendationStar />}
                  {t(TAURI_MEDIA_LABELS[value])}
                </button>
              ))}
            </div>
            {mediaPolicy === 'local-auto' && <p className="hint">{t('conn.media.local-auto')}</p>}
          </> : <label className="ip-connect__field"><span>{t('conn.media')}</span>
            <select data-media-policy className="field__input field__input--compact" value={mediaPolicy} disabled={locked || inherited} onChange={event => props.onConfig({ ...props.config, mediaPolicy: event.target.value as ConnectionConfig['mediaPolicy'] })}>
              {MEDIA_STRATEGIES.map(({ value }) => <option key={value} value={value}>{t(`conn.media.${value}`)}</option>)}
            </select>
          </label>}
          {selectedIp && <>
            <label className="ip-connect__field">{!isTauri && <span>{t('conn.mediaIp')}</span>}
              <select data-media-ip className="field__input field__input--compact media-ip-select" value={props.mediaIp} disabled={locked} aria-label={isTauri ? t('conn.mediaIp') : undefined} aria-describedby={`${formId}-media-hint`} onChange={event => props.onMediaIp(event.target.value)}>
                <option value="" disabled={isTauri}>{t('conn.chooseMediaIp')}</option>
                {(props.server?.mediaAddresses ?? []).map(item => <option key={`${item.interfaceName}/${item.address}`} value={item.address}>{item.interfaceName} · {item.address} ({item.family})</option>)}
              </select>
            </label>
            <p id={`${formId}-media-hint`} className="hint">{t(isTauri ? 'conn.mediaIpVirtualLanHint' : 'conn.mediaIpHint')}</p>
            <button className="btn btn--tiny" type="button" disabled={locked} onClick={refresh}>{t('conn.refreshMediaIp')}</button>
          </>}
        </OptionGroup>
      </fieldset>
      {shownError && <p id={`${formId}-error`} className="hint hint--warn connection-error" role="alert">{shownError}</p>}
      <button className="btn btn--primary connection-submit" type="submit" disabled={locked || (selectedIp && !props.mediaIp) || (joining && (Boolean(invitationError) || (!invitation.trim() && !address.trim())))}>
        {t(props.busy ? 'ip.connecting' : joining ? 'ip.connect' : 'room.create')}
      </button>
    </form>
  </section>;
}

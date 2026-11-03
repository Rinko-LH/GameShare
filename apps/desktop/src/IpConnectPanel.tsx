import { useState } from 'react';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress } from '@game-share/shared';
import { ShareSession } from './session/ShareSession';
import type { EmbeddedServerStatus } from './types/global';
import { t } from './i18n';

interface Props {
  session: ShareSession;
  nickname: string;
  disabled: boolean;
  busy: boolean;
  server: EmbeddedServerStatus | null;
  inviteAddress: string | null;
  onInviteAddress: (address: string) => void;
  onServerUrl: (url: string) => void;
  onBusy: (busy: boolean) => void;
  onServer: (status: EmbeddedServerStatus) => void;
}

export function IpConnectPanel(props: Props) {
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locked = props.disabled || props.busy;
  const addresses = [...new Set([
    ...(props.server?.lanUrls ?? []),
    ...(props.server?.publicV4Urls ?? []),
    ...(props.server?.publicV6Urls ?? []),
    ...(props.inviteAddress ? [props.inviteAddress] : []),
  ])];

  async function connect(create: boolean) {
    setError(null);
    props.onBusy(true);
    try {
      if (!create && !address.trim()) throw new Error(t('ip.needAddress'));
      const url = create ? DEFAULT_SIGNALING_URL : normalizeSignalingAddress(address);
      if (create && window.gameShare?.server) {
        const status = await window.gameShare.server.setEnabled(true);
        props.onServer(status);
        if (status.state !== 'running' && status.state !== 'port-in-use') {
          throw new Error(status.detail ?? t('ip.serverFailed'));
        }
      }
      props.onServerUrl(url);
      await props.session.connectAndWait(url);
      if (create) await props.session.createRoom(props.nickname, true);
      else await props.session.joinRoom(roomCode.trim().toUpperCase(), props.nickname, !roomCode.trim());
    } catch (err) {
      const message = ShareSession.describeError(err);
      setError(message);
      props.session.pushLog(message);
    } finally {
      props.onBusy(false);
    }
  }

  return (
    <section className="panel panel--tight ip-connect">
      <h2>{t('ip.title')}</h2>
      <p className="hint hint--dim">{t('ip.hint')}</p>
      <button className="btn" type="button" disabled={locked} onClick={() => void connect(true)}>
        {t('ip.create')}
      </button>
      {addresses.length > 0 && (
        <label className="ip-connect__field">
          <span className="hint">{t('ip.inviteAddress')}</span>
          <select className="field__input field__input--compact" value={props.inviteAddress ?? ''}
            onChange={(e) => props.onInviteAddress(e.target.value)}>
            {addresses.map((url) => <option key={url} value={url}>{url}</option>)}
          </select>
        </label>
      )}
      {window.gameShare?.server && (
        <button className="btn btn--tiny" type="button" disabled={props.busy}
          onClick={() => void window.gameShare?.server.getStatus().then(props.onServer).catch((err: unknown) => setError(ShareSession.describeError(err)))}>
          {t('ip.refresh')}
        </button>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (!locked) void connect(false); }}>
        <label className="ip-connect__field">
          <span className="hint">{t('ip.remoteAddress')}</span>
          <input className="field__input field__input--compact" value={address}
            onChange={(e) => setAddress(e.target.value)} disabled={locked}
            placeholder="10.0.0.2 / 10.0.0.2:8080" spellCheck={false} required />
        </label>
        <label className="ip-connect__field">
          <span className="hint">{t('ip.roomCode')}</span>
          <input className="field__input field__input--compact" value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)} disabled={locked} maxLength={8}
            placeholder={t('ip.roomOptional')} spellCheck={false} />
        </label>
        <button className="btn btn--primary" type="submit" disabled={locked || !address.trim()}>
          {props.busy ? t('ip.connecting') : t('ip.connect')}
        </button>
      </form>
      {error && <p className="hint hint--warn" role="alert">{error}</p>}
    </section>
  );
}

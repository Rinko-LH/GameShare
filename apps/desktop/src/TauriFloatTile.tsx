import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { listenNative, native } from './tauri-native';
import {
  localTileDescription, MIN_FLOAT_OPACITY, readFloatOpacity, sendTileSignal, watchFloatOpacity, writeFloatOpacity,
  type TileSignal,
} from './tauri-tiles';
import type { FloatTilePeer } from './types/global';
import { ViewerIcon } from './ViewerIcon';
import { HoverVolume, type VolumeChannel } from './HoverVolume';
import './tauri-float-tile.css';

export default function TauriFloatTile({ label }: { label: string }) {
  const t = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [peerState, setPeerState] = useState<FloatTilePeer | null>(null);
  const [opacity, setOpacity] = useState(readFloatOpacity);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => watchFloatOpacity(setOpacity), []);
  useEffect(() => {
    const player = video.current!;
    const peer = new RTCPeerConnection({ iceServers: [] });
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const onError = (reason: unknown) => { if (!disposed) setError(String(reason)); };
    peer.ontrack = ({ track }) => {
      player.srcObject = new MediaStream([track]);
      void player.play().catch(onError);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') onError('浮窗视频连接失败');
    };

    async function handle(message: TileSignal) {
      if (message.kind === 'peer' || message.kind === 'offer') {
        setPeerState(message.peer);
      }
      if (message.kind === 'offer') {
        await peer.setRemoteDescription(message.description);
        const description = await localTileDescription(peer, await peer.createAnswer());
        if (!disposed) await sendTileSignal(label, { kind: 'answer', description });
      }
    }
    void listenNative<{ message: TileSignal }>('tile-signal', label, ({ message }) =>
      void handle(message).catch(onError),
    ).then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        return sendTileSignal(label, { kind: 'ready' });
      }
    }).catch(onError);
    return () => {
      disposed = true;
      unlisten?.();
      peer.close();
      player.srcObject = null;
    };
  }, [label]);

  const name = peerState?.name ?? t('tileFloat.defaultPeer');
  const globalMuted = peerState?.globalMuted ?? false;
  const voiceMuted = globalMuted || (peerState?.voiceMuted ?? false);
  const pictureHidden = peerState?.pictureHidden ?? false;
  const sharePaused = peerState?.shareAudioPaused ?? false;
  const shareMuted = sharePaused || globalMuted || (peerState?.muted ?? false);
  const shareAudioAction = pictureHidden
    ? t(sharePaused ? 'view.resumeIncomingShareAudio' : 'view.pauseIncomingShareAudio')
    : t(shareMuted ? 'view.unmuteShareAudio' : 'view.muteShareAudio');
  const changeVolume = (channel: VolumeChannel, volume: number) => {
    const key = channel === 'voice' ? 'voiceVolume' : 'shareVolume';
    setPeerState((current) => current && { ...current, [key]: volume });
    void sendTileSignal(label, { kind: 'volume', channel, volume }).catch(console.error);
  };

  return <div className={`tilewin tilewin--tauri${playing ? '' : ' tilewin--idle'}`} data-tile-index={label}
    onMouseDown={(event) => {
      if (event.button !== 0 || (event.target as Element).closest('.tilewin__actions, .tilewin__settings, .tilewin__grip')) return;
      void native('plugin:window|start_dragging').catch(console.error);
    }}>
    <video ref={video} className="tilewin__canvas tilewin__video" muted autoPlay playsInline
      hidden={pictureHidden} style={{ opacity }}
      onPlaying={() => setPlaying(true)} onEmptied={() => setPlaying(false)} />
    {(pictureHidden || !playing || error) && <div className={`tilewin__wait${pictureHidden ? ' tilewin__wait--hidden' : ''}`}>
      <span>{pictureHidden ? t(sharePaused ? 'view.pictureAndAudioPaused' : 'view.pictureHidden') : error || t('tileFloat.waiting')}</span>
    </div>}
    <div className="tilewin__bar">
      <div className="tilewin__header">
        <span className="tilewin__name" title={name}>{name}</span>
        <div className="tilewin__actions">
          <button type="button" className="tilewin__action" data-float-action="picture"
            aria-label={t('view.hidePicture')} aria-pressed={pictureHidden} disabled={!peerState}
            title={t(!pictureHidden ? 'view.hidePicture' : sharePaused ? 'view.showPictureAndAudio' : 'view.showPicture')}
            onClick={() => void sendTileSignal(label, { kind: 'toggle-picture' }).catch(console.error)}>
            <ViewerIcon name="picture" off={pictureHidden} />
          </button>
          <HoverVolume channel="voice" muted={voiceMuted} value={peerState?.voiceVolume ?? 1} label={t('view.voiceVolume')}
            disabled={!peerState || globalMuted} onChange={(value) => changeVolume('voice', value)}
            button={{ className: 'tilewin__action', 'data-float-action': 'voice', 'aria-label': t('view.muteVoice'),
              'aria-pressed': voiceMuted, disabled: !peerState || globalMuted,
              title: t(globalMuted ? 'view.globalMuteHint' : voiceMuted ? 'view.unmuteVoice' : 'view.muteVoice'),
              onClick: () => void sendTileSignal(label, { kind: 'mute-voice' }).catch(console.error) }} />
          <HoverVolume channel="share" muted={shareMuted} value={peerState?.shareVolume ?? 1} label={t('view.shareVolume')}
            disabled={!peerState || globalMuted || sharePaused} onChange={(value) => changeVolume('share', value)}
            button={{ className: 'tilewin__action', 'data-float-action': 'share-audio', 'aria-label': shareAudioAction,
              'aria-pressed': shareMuted, disabled: !peerState || globalMuted,
              title: globalMuted ? t('view.globalMuteHint') : shareAudioAction,
              onClick: () => void sendTileSignal(label, { kind: 'mute' }).catch(console.error) }} />
          <button type="button" className="tilewin__action" aria-label={t('win.close')} title={t('win.close')}
            onClick={() => void native('plugin:window|close').catch(console.error)}>
            <span className="winctl__glyph winctl__glyph--close" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="tilewin__settings">
        <label className="tilewin__slider" title={t('float.opacityTitle')}>
          <span>{t('float.opacity')}</span>
          <input data-float-opacity type="range" min={MIN_FLOAT_OPACITY * 100} max={100} step={5}
            value={Math.round(opacity * 100)} aria-label={t('view.opacity')} aria-valuetext={`${Math.round(opacity * 100)}%`}
            onChange={(event) => setOpacity(writeFloatOpacity(Number(event.target.value) / 100))} />
          <span aria-hidden="true">{Math.round(opacity * 100)}%</span>
        </label>
      </div>
    </div>
    <div className="tilewin__grip" title={t('tileFloat.gripTitle')}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        void native('plugin:window|start_resize_dragging', { value: 'SouthEast' }).catch(console.error);
      }} />
  </div>;
}

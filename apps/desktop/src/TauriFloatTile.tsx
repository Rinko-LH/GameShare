import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getLang, subscribeLang, t } from './i18n';
import { listenNative, native } from './tauri-native';
import { localTileDescription, sendTileSignal, type TileSignal } from './tauri-tiles';

export default function TauriFloatTile({ label }: { label: string }) {
  useSyncExternalStore(subscribeLang, getLang);
  const video = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState(() => t('tileFloat.defaultPeer'));
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [error, setError] = useState('');

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
        setName(message.peer.name);
        setMuted(message.peer.muted ?? false);
        setVolume(message.peer.volume ?? 1);
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

  return <div className={`tilewin tilewin--tauri${playing ? '' : ' tilewin--idle'}`} data-tile-index={label}
    onMouseDown={(event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('.tilewin__bar, .tilewin__grip')) return;
      void native('plugin:window|start_dragging').catch(console.error);
    }}
    onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
    <video ref={video} className="tilewin__canvas tilewin__video" muted autoPlay playsInline
      onPlaying={() => setPlaying(true)} onEmptied={() => setPlaying(false)} />
    {(!playing || error) && <div className="tilewin__wait">{error || t('tileFloat.waiting')}</div>}
    <span className={`tilewin__name${muted ? ' tilewin__name--muted' : ''}`} title={name}>{name}</span>
    <div className={`tilewin__bar${hovering ? ' tilewin__bar--on' : ''}`}>
      <label className="tilewin__volume">
        <span>{t('tile.volume')}</span>
        <input type="range" min={0} max={100} value={Math.round(volume * 100)} aria-label={t('tileFloat.volumeTitle')}
          onChange={(event) => {
            const next = Number(event.target.value) / 100;
            setVolume(next);
            void sendTileSignal(label, { kind: 'volume', volume: next }).catch(console.error);
          }} />
        <span>{Math.round(volume * 100)}%</span>
      </label>
      <button type="button" className={`tilewin__mute${muted ? ' tilewin__mute--on' : ''}`}
        title={muted ? t('tileFloat.unmuteTitle') : t('tileFloat.muteTitle')}
        onClick={() => void sendTileSignal(label, { kind: 'mute' }).catch(console.error)}>
        {muted ? t('tileFloat.muted') : t('tileFloat.live')}
      </button>
      <button type="button" className="tilewin__mute" aria-label={t('win.close')} title={t('win.close')}
        onClick={() => void native('plugin:window|close').catch(console.error)}>×</button>
    </div>
    <div className={`tilewin__grip${hovering ? ' tilewin__grip--on' : ''}`} title={t('tileFloat.gripTitle')}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        void native('plugin:window|start_resize_dragging', { value: 'SouthEast' }).catch(console.error);
      }} />
  </div>;
}

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { fmt, useI18n } from './i18n';
import { HoverVolume, type VolumeChannel } from './HoverVolume';
import { SpeakingMark } from './SpeakingPlayers';
import { ViewerIcon } from './ViewerIcon';
import './share-viewer.css';

type Layout = 'focus' | 'grid';
type TileVariant = 'main' | 'thumb' | 'grid';

export interface ShareViewerParticipant {
  id: string;
  name: string;
  sharing: boolean;
  speaking: boolean;
  pictureHidden?: boolean;
  shareAudioPaused?: boolean;
  voiceMuted?: boolean;
  shareAudioMuted?: boolean;
  voiceVolume?: number;
  shareAudioVolume?: number;
}

interface ShareViewerProps {
  participants: ShareViewerParticipant[];
  layout: Layout;
  showStats: boolean;
  focusedPeerId: string | null;
  floating: boolean;
  fullscreen: boolean;
  busy: boolean;
  floatingCount: number;
  modeError?: string | null;
  opacity?: { value: number; min: number; onChange: (value: number) => void };
  empty: ReactNode;
  onLayoutChange: (layout: Layout) => void;
  onToggleStats: () => void;
  onFocus: (peerId: string) => void;
  onToggleFloat: () => void;
  onToggleFullscreen: () => void;
  onToggleVoice: (peerId: string) => void;
  onToggleShareAudio: (peerId: string) => void;
  onTogglePicture: (peerId: string) => void;
  onVolumeChange: (peerId: string, channel: VolumeChannel, volume: number) => void;
  renderMedia: (peer: ShareViewerParticipant, variant: TileVariant) => ReactNode;
}

export function ShareViewer({
  participants, layout, showStats, focusedPeerId, floating, fullscreen, busy, floatingCount, modeError, opacity, empty,
  onLayoutChange, onToggleStats, onFocus, onToggleFloat, onToggleFullscreen,
  onToggleVoice, onToggleShareAudio, onTogglePicture, onVolumeChange, renderMedia,
}: ShareViewerProps) {
  const t = useI18n();
  const mainCard = useRef<HTMLElement>(null);
  const focusMainCard = useRef(false);
  const screens = participants.filter((peer) => peer.sharing);
  const main = screens.find((peer) => peer.id === focusedPeerId) ?? screens[0];
  const roster = participants.filter((peer) => floating || !peer.sharing);
  const opacityPercent = opacity ? Math.round(opacity.value * 100) : 100;

  useLayoutEffect(() => {
    if (!focusMainCard.current) return;
    focusMainCard.current = false;
    mainCard.current?.focus();
  }, [layout, main?.id]);

  const audioControls = (peer: ShareViewerParticipant) => (
    <ParticipantControls
      peer={peer}
      onToggleVoice={onToggleVoice}
      onToggleShareAudio={onToggleShareAudio}
      onTogglePicture={onTogglePicture}
      onVolumeChange={onVolumeChange}
    />
  );

  const screenTile = (peer: ShareViewerParticipant, variant: TileVariant) => {
    const focused = variant === 'main';
    const focusLabel = t('tile.enlarge');
    return (
      <article
        className="share-viewer__card"
        key={peer.id}
        ref={focused ? mainCard : undefined}
        tabIndex={focused ? -1 : undefined}
        data-viewer-peer={peer.id}
        data-focused={focused}
        data-speaking={peer.speaking}
        aria-label={peer.name}
      >
        <div className="share-viewer__card-chrome">
          <span className="share-viewer__name" title={peer.name}>
            <SpeakingMark active={peer.speaking} />{peer.name}
          </span>
          <div className="share-viewer__card-actions">
            {audioControls(peer)}
          </div>
        </div>
        <div className="share-viewer__picture">
          {peer.pictureHidden ? (
            <div className="share-viewer__placeholder" data-viewer-picture-hidden>
              <ViewerIcon name="picture" off />
              <span>{t(peer.shareAudioPaused ? 'view.pictureAndAudioPaused' : 'view.pictureHidden')}</span>
            </div>
          ) : renderMedia(peer, variant)}
          {!focused && (
            <button type="button" className="share-viewer__picture-trigger" data-viewer-action="focus"
              aria-label={`${focusLabel} · ${peer.name}`}
              onClick={(event) => {
                focusMainCard.current = event.detail === 0;
                onFocus(peer.id);
              }} />
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="share-viewer" data-share-viewer data-layout={layout} data-floating={floating}>
      <div className="share-viewer__toolbar" hidden={fullscreen}>
        {!floating && (
          <div className="share-viewer__layout" role="group" aria-label={t('view.layout')}>
            <button type="button" className="share-viewer__button" data-viewer-action="layout-focus"
              aria-pressed={layout === 'focus'} onClick={() => onLayoutChange('focus')}>
              <ViewerIcon name="focus" />
              <span>{t('view.layoutFocus')}</span>
            </button>
            <button type="button" className="share-viewer__button" data-viewer-action="layout-grid"
              aria-pressed={layout === 'grid'} onClick={() => onLayoutChange('grid')}>
              <ViewerIcon name="grid" />
              <span>{t('view.layoutGrid')}</span>
            </button>
          </div>
        )}
        <div className="share-viewer__modes">
          <button type="button" className="share-viewer__button" data-viewer-action="float" data-float-toggle=""
            disabled={busy} aria-pressed={floating} onClick={onToggleFloat}>
            <ViewerIcon name="floating" />
            <span>{t(floating ? 'view.exitFloat' : 'float.mode')}</span>
          </button>
          <button type="button" className="share-viewer__button" data-viewer-action="fullscreen"
            disabled={busy || screens.length === 0} onClick={onToggleFullscreen}>
            <ViewerIcon name="fullscreen" />
            <span>{t('view.fullscreen')}</span>
          </button>
        </div>
        {!floating && (
          <button type="button" className="share-viewer__button share-viewer__stats-toggle" data-viewer-action="show-stats"
            aria-pressed={showStats} onClick={onToggleStats}>
            <ViewerIcon name="stats" />
            <span>{t('view.showStats')}</span>
          </button>
        )}
      </div>
      {modeError && <p className="share-viewer__error" role="alert">{modeError}</p>}
      {floating ? (
        <div className="share-viewer__floating">
          <ViewerIcon name="floating" />
          <h2>{t('view.floatingActive')}</h2>
          <p>{screens.length > 0 || floatingCount > 0 ? fmt('view.floatingCount', { n: floatingCount }) : t('view.floatingNoShares')}</p>
          {opacity && (
            <label className="share-viewer__opacity">
              <span>{t('view.opacity')}</span>
              <input type="range" min={Math.round(opacity.min * 100)} max={100} step={5}
                value={opacityPercent} aria-label={t('view.opacity')} aria-valuetext={`${opacityPercent}%`}
                data-viewer-action="opacity" onChange={(event) => opacity.onChange(Number(event.target.value) / 100)} />
              <span aria-hidden="true">{opacityPercent}%</span>
            </label>
          )}
          {floatingCount > 0 && <p>{t('view.floatingViewerHint')}</p>}
        </div>
      ) : !main ? (
        empty
      ) : layout === 'focus' ? (
        <div className="share-viewer__focused">
          {screenTile(main, 'main')}
          {screens.length > 1 && <div className="share-viewer__rail">
            {screens.filter((peer) => peer.id !== main.id).map((peer) => screenTile(peer, 'thumb'))}
          </div>}
        </div>
      ) : (
        <div className="share-viewer__grid" data-share-count={screens.length}>
          {screens.map((peer) => screenTile(peer, 'grid'))}
        </div>
      )}
      {roster.length > 0 && (
        <section className="share-viewer__roster" aria-label={t('view.participants')}>
          <h2>{t('view.participants')}</h2>
          <ul>
            {roster.map((peer) => (
              <li key={peer.id} data-viewer-peer={peer.id} data-speaking={peer.speaking}>
                <span className="share-viewer__name" title={peer.name}>
                  <SpeakingMark active={peer.speaking} />{peer.name}
                </span>
                {audioControls(peer)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface ParticipantControlsProps extends Pick<ShareViewerProps, 'onToggleVoice' | 'onToggleShareAudio' | 'onTogglePicture' | 'onVolumeChange'> {
  peer: ShareViewerParticipant;
}

function ParticipantControls({
  peer, onToggleVoice, onToggleShareAudio, onTogglePicture, onVolumeChange,
}: ParticipantControlsProps) {
  const t = useI18n();
  const voiceMuted = Boolean(peer.voiceMuted);
  const sharePaused = Boolean(peer.shareAudioPaused);
  const audioMuted = Boolean(peer.shareAudioMuted) || sharePaused;
  const muteClass = 'share-viewer__button share-viewer__icon-button share-viewer__mute';
  const shareAudioAction = peer.pictureHidden
    ? t(sharePaused ? 'view.resumeIncomingShareAudio' : 'view.pauseIncomingShareAudio')
    : t(audioMuted ? 'view.unmuteShareAudio' : 'view.muteShareAudio');

  return (
    <div className="share-viewer__peer-controls" role="group" aria-label={`${t('view.localControls')} · ${peer.name}`}>
      <div className="share-viewer__peer-buttons">
        <HoverVolume channel="voice" muted={voiceMuted} value={peer.voiceVolume ?? 1} label={t('view.voiceVolume')}
          onChange={(value) => onVolumeChange(peer.id, 'voice', value)}
          button={{ className: muteClass, 'data-viewer-action': 'voice', 'aria-label': t('view.muteVoice'),
            'aria-pressed': voiceMuted,
            title: t(voiceMuted ? 'view.unmuteVoice' : 'view.muteVoice'),
            onClick: () => onToggleVoice(peer.id) }} />
        <HoverVolume channel="share" muted={audioMuted} value={peer.shareAudioVolume ?? 1} label={t('view.shareVolume')}
          disabled={sharePaused} onChange={(value) => onVolumeChange(peer.id, 'share', value)}
          button={{ className: muteClass, 'data-viewer-action': 'share-audio', 'aria-label': shareAudioAction,
            'aria-pressed': audioMuted, title: shareAudioAction,
            onClick: () => onToggleShareAudio(peer.id) }} />
        {peer.sharing && (
          <button type="button" className="share-viewer__button share-viewer__icon-button share-viewer__mute"
            data-viewer-action="picture" aria-label={t('view.hidePicture')} aria-pressed={Boolean(peer.pictureHidden)}
            title={t(!peer.pictureHidden ? 'view.hidePicture' : sharePaused ? 'view.showPictureAndAudio' : 'view.showPicture')}
            onClick={() => onTogglePicture(peer.id)}>
            <ViewerIcon name="picture" off={peer.pictureHidden} />
          </button>
        )}
      </div>
    </div>
  );
}

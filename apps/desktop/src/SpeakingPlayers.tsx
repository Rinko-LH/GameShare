import { useI18n } from './i18n';
import type { SpeakingPlayer } from './types/global';
import { ViewerIcon } from './ViewerIcon';
import './speaking-players.css';

export function SpeakingMark({ active }: { active: boolean }) {
  const t = useI18n();
  const label = t('view.speaking');
  return <span className="speaking-mark" data-active={active} role="img" aria-label={label}>
    <ViewerIcon name="speaking" />
  </span>;
}

export function SpeakingPlayers({ players, className }: { players: readonly SpeakingPlayer[]; className: string }) {
  if (players.length === 0) return null;
  const names = players.map(({ name }) => name);
  return (
    <div className={`speaking-players ${className}`} data-speaking-players>
      <SpeakingMark active />
      <span className="speaking-players__names">{names.join(' · ')}</span>
    </div>
  );
}

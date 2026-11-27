import { useId } from 'react';
import { normalizeSignalingAddress } from '@game-share/shared';
import { t } from './i18n';

interface Props {
  addresses: string[];
  value: string | null;
  onChange: (value: string) => void;
  source: 'local' | 'external';
  disabled: boolean;
  hideLocalLabel?: boolean;
  externalHint?: string;
}

/** The invitation has one public-facing address, chosen from local adapters or entered manually. */
export function RoomAddressField({ addresses, value, onChange, source, disabled, hideLocalLabel, externalHint }: Props) {
  const hintId = useId();
  let healthUrl: string | null = null;
  try { if (value?.trim()) healthUrl = new URL('/health', normalizeSignalingAddress(value)).href; } catch { /* Shown on create, never turn invalid input into a working link. */ }

  return <div className="room-address">
    {source === 'local' ? <>
      <label className="ip-connect__field">{!hideLocalLabel && <span>{t('conn.inviteAddress')}</span>}
        <select data-room-address="local" className="field__input field__input--compact" value={addresses.includes(value ?? '') ? value! : ''} disabled={disabled} aria-label={hideLocalLabel ? t('conn.inviteAddress') : undefined} aria-describedby={addresses.length === 0 ? hintId : undefined} onChange={event => onChange(event.target.value)}>
          <option value="" disabled>{t('conn.chooseInviteAddress')}</option>
          {addresses.map(url => <option key={url} value={url}>{url}</option>)}
        </select>
      </label>
      {addresses.length === 0 && <p id={hintId} className="hint hint--warn">{t('conn.noInviteAddress')}</p>}
    </> : <>
      <label className="ip-connect__field">{!externalHint && <span>{t('conn.inviteAddress')}</span>}
        <input data-room-address="external" className="field__input field__input--compact" value={value ?? ''} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder={t('conn.inviteAddressPlaceholder')} aria-label={externalHint ? t('conn.signaling.publicForwarding') : undefined} aria-describedby={externalHint ? hintId : undefined} spellCheck={false} />
      </label>
      {externalHint && <p id={hintId} className="hint room-address__hint">{externalHint}</p>}
    </>}
    {healthUrl && <p className="hint room-address__check"><a href={healthUrl} target="_blank" rel="noreferrer">{t('conn.checkInviteAddress')}</a></p>}
  </div>;
}

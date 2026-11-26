import { useId } from 'react';
import { normalizeSignalingAddress } from '@game-share/shared';
import { t } from './i18n';

interface Props {
  addresses: string[];
  value: string | null;
  onChange: (value: string) => void;
  source: 'local' | 'external';
  disabled: boolean;
}

/** The invitation has one public-facing address, chosen from local adapters or entered manually. */
export function RoomAddressField({ addresses, value, onChange, source, disabled }: Props) {
  const noAddressId = useId();
  let healthUrl: string | null = null;
  try { if (value?.trim()) healthUrl = new URL('/health', normalizeSignalingAddress(value)).href; } catch { /* Shown on create, never turn invalid input into a working link. */ }

  return <div className="room-address">
    {source === 'local' ? <>
      <label className="ip-connect__field"><span>{t('conn.inviteAddress')}</span>
        <select data-room-address="local" className="field__input field__input--compact" value={addresses.includes(value ?? '') ? value! : ''} disabled={disabled} aria-describedby={addresses.length === 0 ? noAddressId : undefined} onChange={event => onChange(event.target.value)}>
          <option value="" disabled>{t('conn.chooseInviteAddress')}</option>
          {addresses.map(url => <option key={url} value={url}>{url}</option>)}
        </select>
      </label>
      {addresses.length === 0 && <p id={noAddressId} className="hint hint--warn">{t('conn.noInviteAddress')}</p>}
    </> : <>
      <label className="ip-connect__field"><span>{t('conn.inviteAddress')}</span>
        <input data-room-address="external" className="field__input field__input--compact" value={value ?? ''} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder={t('conn.inviteAddressPlaceholder')} spellCheck={false} />
      </label>
    </>}
    {healthUrl && <p className="hint room-address__check"><a href={healthUrl} target="_blank" rel="noreferrer">{t('conn.checkInviteAddress')}</a></p>}
  </div>;
}

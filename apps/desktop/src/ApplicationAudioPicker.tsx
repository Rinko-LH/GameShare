import { useState } from 'react';
import { t } from './i18n';
import { listAudioApplications, type AudioApplication } from './media/process-audio';

export function ApplicationAudioPicker({ active, disabled, onSelect, onStop }: {
  active: string | null;
  disabled: boolean;
  onSelect: (app: AudioApplication) => Promise<void>;
  onStop: () => void;
}) {
  const [applications, setApplications] = useState<AudioApplication[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setPending(true);
    setError('');
    try {
      setApplications(await listAudioApplications());
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  };

  const select = async (app: AudioApplication) => {
    setPending(true);
    setError('');
    try {
      await onSelect(app);
      setApplications(null);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  };

  return <div className="application-audio">
    {active && <p className="hint" role="status">{t('share.audioApplication.label')} · {active}</p>}
    {applications === null ? <div className="row">
      <button className="btn btn--tiny" type="button" disabled={disabled || pending} onClick={() => void refresh()}>
        {t(active ? 'share.audioApplication.change' : 'share.audioApplication.choose')}
      </button>
      {active && <button className="btn btn--tiny btn--shrink" type="button" disabled={disabled || pending} onClick={onStop}>
        {t('share.audioApplication.stop')}
      </button>}
    </div> : <div className="application-audio">
      <label>
        <span className="share-setting__label">{t('share.audioApplication.label')}</span>
        <select className="field__input field__input--compact" value="" onChange={event => {
          const app = applications.find(item => String(item.pid) === event.target.value);
          if (app) void select(app);
        }}
          disabled={disabled || pending || applications.length === 0}>
          <option value="">{t(applications.length ? 'share.audioApplication.placeholder' : 'share.audioApplication.empty')}</option>
          {applications.map(app => <option key={app.pid} value={app.pid}>{app.title}</option>)}
        </select>
      </label>
      <div className="row">
        <button className="btn btn--tiny btn--shrink" type="button" disabled={disabled || pending} onClick={() => void refresh()}>
          {t('share.audioApplication.refresh')}
        </button>
        <button className="btn btn--tiny btn--shrink" type="button" disabled={pending} onClick={() => {
          setApplications(null);
          setError('');
        }}>{t('mic.cancelKey')}</button>
      </div>
    </div>}
    {error && <p className="hint hint--warn" role="alert">{error}</p>}
  </div>;
}

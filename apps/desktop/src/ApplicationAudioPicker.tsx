import { useId, useRef, useState } from 'react';
import { t } from './i18n';
import { listAudioApplications, type AudioApplication } from './media/process-audio';

export function ApplicationAudioPicker({ active, muted, disabled, onSelect, onToggleMute }: {
  active: AudioApplication | null;
  muted: boolean;
  disabled: boolean;
  onSelect: (app: AudioApplication) => Promise<void>;
  onToggleMute: () => void;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [applications, setApplications] = useState<AudioApplication[]>([]);
  const [pending, setPending] = useState<'loading' | 'switching' | null>(null);
  const [error, setError] = useState<'listError' | 'switchError' | null>(null);

  const refresh = async () => {
    if (disabled || pending) return;
    setPending('loading');
    setError(null);
    try {
      setApplications(await listAudioApplications());
    } catch {
      setError('listError');
    } finally {
      setPending(null);
    }
  };

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const select = async (app: AudioApplication) => {
    if (disabled || pending || active?.pid === app.pid) return;
    setPending('switching');
    setError(null);
    try {
      await onSelect(app);
      close();
    } catch {
      setError('switchError');
    } finally {
      setPending(null);
    }
  };

  return <div className="application-audio" onKeyDown={event => {
    if (event.key !== 'Escape' || !open || pending === 'switching') return;
    event.stopPropagation();
    close();
  }}>
    {active && <p className="hint" role="status">{t('share.audioApplication.label')} · {active.title}</p>}
    <div className="row">
      <button ref={trigger} className="btn btn--tiny" type="button" disabled={disabled}
        aria-expanded={open} aria-controls={open ? listId : undefined} aria-disabled={pending === 'switching'}
        onClick={() => {
          if (pending === 'switching') return;
          if (open) {
            close();
          } else {
            setApplications([]);
            setOpen(true);
            void refresh();
          }
        }}>
        {t(active ? 'share.audioApplication.change' : 'share.audioApplication.choose')}
      </button>
      {active && <button className="btn btn--tiny btn--shrink application-audio__mute" type="button"
        aria-label={t('share.audioApplication.mute')} aria-pressed={muted}
        title={t(muted ? 'share.audioApplication.unmute' : 'share.audioApplication.mute')}
        disabled={disabled} onClick={onToggleMute}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2 6h3l4-3v10l-4-3H2z" />
          {muted ? <path d="m2 2 12 12" /> : <path d="M11 6a2.8 2.8 0 0 1 0 4m2-6a5.7 5.7 0 0 1 0 8" />}
        </svg>
      </button>}
    </div>
    {open && <div id={listId} className="application-audio">
      {pending && <p className="hint hint--dim" role="status">
        {t(pending === 'loading' ? 'share.audioApplication.loading' : 'share.audioApplication.switching')}
      </p>}
      {applications.length > 0 && <ul className="application-audio__list" aria-label={t('share.audioApplication.label')}>
        {applications.map(app => {
          const current = app.pid === active?.pid;
          return <li key={app.pid}>
            <button type="button" className="btn btn--tiny application-audio__option"
              aria-current={current ? 'true' : undefined} aria-disabled={current || !!pending}
              disabled={disabled || current} onClick={() => void select(app)}>
              {app.title}
              {current && <span className="tag">{t('share.audioApplication.current')}</span>}
            </button>
          </li>;
        })}
      </ul>}
      {error && <p className="hint hint--warn" role="alert">
        {t(error === 'listError' ? 'share.audioApplication.listError' : 'share.audioApplication.switchError')}
      </p>}
      {!pending && !error && applications.length === 0 && <p className="hint hint--dim" role="status">
        {t('share.audioApplication.empty')}
      </p>}
      <div className="row">
        <button className="btn btn--tiny btn--shrink" type="button" disabled={disabled}
          aria-disabled={!!pending} onClick={() => void refresh()}>
          {t('share.audioApplication.refresh')}
        </button>
        <button className="btn btn--tiny btn--shrink" type="button" disabled={pending === 'switching'} onClick={close}>
          {t('mic.cancelKey')}
        </button>
      </div>
    </div>}
  </div>;
}

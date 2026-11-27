import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ShareSession } from './session/ShareSession';
import { t } from './i18n';
import { bindingFromEvent, describeVoiceBinding, saveVoicePreferences, type VoiceBinding } from './voice-settings';

export function useVoiceHotkey(session: ShareSession, binding: VoiceBinding | null, recording: boolean): string | null {
  const { micEnabled, voiceMode, room } = useSyncExternalStore(session.subscribe, session.getState);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(-1), request = useRef(0);
  useEffect(() => { saveVoicePreferences({ mode: voiceMode, binding }); }, [voiceMode, binding]);
  useEffect(() => {
    const api = window.gameShare?.voiceHotkey;
    return api?.onState(status => {
      if (status.revision !== revision.current) return;
      session.setVoiceHeld('keyboard', status.pressed);
      setError(status.error);
    });
  }, [session]);
  useEffect(() => {
    const api = window.gameShare?.voiceHotkey;
    const current = ++request.current;
    revision.current = -1;
    session.setVoiceHeld('keyboard', false);
    const active = Boolean(room && micEnabled && voiceMode === 'push-to-talk' && !recording);
    if (!api) { setError(active && binding ? t('mic.hotkeyUnavailable') : null); return; }
    void api.configure({ active, binding }).then(status => {
      if (request.current !== current) return;
      revision.current = status.revision;
      session.setVoiceHeld('keyboard', status.pressed);
      setError(status.error);
    }).catch(() => { if (request.current === current) setError(t('mic.hotkeyUnavailable')); });
    return () => {
      request.current++; revision.current = -1;
      session.setVoiceHeld('keyboard', false);
      void api.configure({ active: false, binding: null }).catch(() => undefined);
    };
  }, [session, Boolean(room), micEnabled, voiceMode, binding, recording]);
  return error;
}

export function VoicePanel({ session, busy, visible, run, binding, setBinding, recording, setRecording, error }: {
  session: ShareSession; busy: boolean; visible: boolean; run: (fn: () => Promise<unknown>) => Promise<void>;
  binding: VoiceBinding | null; setBinding: (binding: VoiceBinding | null) => void;
  recording: boolean; setRecording: (recording: boolean) => void; error: string | null;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { micEnabled, micTransmitting, micError, voiceMode, room } = state;
  const [candidate, setCandidate] = useState<VoiceBinding | null>(null);
  const [keyError, setKeyError] = useState(false);
  const recordRef = useRef<HTMLDivElement>(null);
  const bindRef = useRef<HTMLButtonElement>(null);
  const restoreBindFocus = useRef(false);
  useEffect(() => {
    const release = () => { session.setVoiceHeld('button', false); setRecording(false); };
    window.addEventListener('blur', release);
    const hide = () => { if (document.hidden) release(); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hide); release(); };
  }, [session]);
  useEffect(() => { if (!visible) { session.setVoiceHeld('button', false); setRecording(false); } }, [visible, session]);
  useEffect(() => {
    if (recording) {
      recordRef.current?.focus();
    } else if (restoreBindFocus.current) {
      restoreBindFocus.current = false;
      bindRef.current?.focus();
    }
  }, [recording]);

  const resetHolds = () => { session.clearVoiceHolds(); setRecording(false); setCandidate(null); setKeyError(false); };
  const finishRecording = () => {
    restoreBindFocus.current = true;
    resetHolds();
  };

  return <section className="panel panel--tight voice-control" data-voice-panel>
    <div className="voice-control__header">
      <h2>{t('mic.title')}</h2>
      <div className={`voice-control__state${micTransmitting ? ' voice-control__state--live' : ''}`} role="status" data-voice-status>
        {!micEnabled ? t('mic.closed') : micTransmitting ? t('mic.transmitting') : t('mic.waiting')}
      </div>
    </div>
    <div className="settings-options settings-options--three voice-control__options segmented-control" role="group"
      aria-label={t('mic.title')} data-mic-enabled={micEnabled}>
      <button type="button" data-voice-enable className="btn settings-option--divider-after"
        aria-label={t(micEnabled ? 'mic.opened' : 'mic.closed')}
        aria-pressed={micEnabled} title={t(micEnabled ? 'mic.on' : 'mic.off')}
        disabled={busy} onClick={() => void run(() => session.setMicEnabled(!micEnabled))}>
        <svg className="voice-control__mic-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="6" y="1.5" width="4" height="8" rx="2" />
          <path d="M3.75 7.5a4.25 4.25 0 0 0 8.5 0M8 11.75v2.5M6 14.25h4" />
          {!micEnabled && <path d="m2 2 12 12" />}
        </svg>
      </button>
      {(['continuous', 'push-to-talk'] as const).map(mode => <button key={mode} type="button" data-voice-mode={mode}
        className="btn" aria-pressed={voiceMode === mode}
        onClick={() => { resetHolds(); session.setVoiceMode(mode); }}>{t(mode === 'continuous' ? 'mic.continuous' : 'mic.pushToTalk')}</button>)}
    </div>
    {voiceMode === 'push-to-talk' && <div className="voice-control__ptt">
      <button type="button" data-voice-hold className={`btn voice-control__hold${micTransmitting ? ' btn--primary' : ''}`}
        disabled={!micEnabled || !room || recording}
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); session.setVoiceHeld('button', true); }}
        onPointerUp={() => session.setVoiceHeld('button', false)} onPointerCancel={() => session.setVoiceHeld('button', false)}
        onLostPointerCapture={() => session.setVoiceHeld('button', false)} onBlur={() => session.setVoiceHeld('button', false)}
        onKeyDown={e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); session.setVoiceHeld('button', true); } }}
        onKeyUp={e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); session.setVoiceHeld('button', false); } }}>
        {t('mic.holdButton')}
      </button>
      <div className="voice-control__shortcut">
        <div className="voice-control__binding">
          <span className="share-setting__label">{t('mic.hotkey')}</span>
          {binding
            ? <kbd data-voice-binding>{describeVoiceBinding(binding)}</kbd>
            : <span data-voice-binding>{t('mic.unbound')}</span>}
        </div>
        {!recording && <div className="voice-control__actions">
          <button ref={bindRef} type="button" className="btn btn--tiny" data-voice-bind
            aria-label={t(binding ? 'mic.changeKey' : 'mic.setKey')}
            onClick={() => { resetHolds(); setRecording(true); }}>
            {t(binding ? 'mic.changeKeyAction' : 'mic.setKeyAction')}
          </button>
          {binding && <button type="button" className="btn btn--tiny btn--ghost" data-voice-clear onClick={() => {
            bindRef.current?.focus();
            resetHolds();
            setBinding(null);
          }}>{t('mic.clearKey')}</button>}
        </div>}
      </div>
      {recording && <div ref={recordRef} tabIndex={0} data-voice-recorder className="voice-control__recorder" role="group" aria-labelledby="voice-record-key" onKeyDown={e => {
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finishRecording();
          return;
        }
        if (e.target !== e.currentTarget || e.code === 'Tab') return;
        e.preventDefault();
        e.stopPropagation();
        if (/^(Control|Shift|Alt)(Left|Right)$/.test(e.code)) return;
        const next = bindingFromEvent(e.nativeEvent); setCandidate(next); setKeyError(!next);
      }}>
        <p className="hint" id="voice-record-key">{t('mic.recordKey')}</p>
        {candidate && <kbd>{describeVoiceBinding(candidate)}</kbd>}
        {keyError && <p className="hint hint--warn" role="alert">{t('mic.invalidKey')}</p>}
        <div className="voice-control__actions">
          <button type="button" className="btn btn--tiny btn--primary" data-voice-save disabled={!candidate} onClick={() => { setBinding(candidate); finishRecording(); }}>{t('mic.saveKey')}</button>
          <button type="button" className="btn btn--tiny" onClick={finishRecording}>{t('mic.cancelKey')}</button>
        </div>
      </div>}
      {error && <p className="hint hint--warn" data-voice-key-error>{error}</p>}
    </div>}
    {micError && <p className="hint hint--warn">{micError}</p>}
  </section>;
}

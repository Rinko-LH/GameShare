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
  const { micEnabled, micTransmitting, micError, micSettings, voiceMode, room } = state;
  const [candidate, setCandidate] = useState<VoiceBinding | null>(null);
  const [keyError, setKeyError] = useState(false);
  const recordRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const release = () => { session.setVoiceHeld('button', false); setRecording(false); };
    window.addEventListener('blur', release);
    const hide = () => { if (document.hidden) release(); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hide); release(); };
  }, [session]);
  useEffect(() => { if (!visible) { session.setVoiceHeld('button', false); setRecording(false); } }, [visible, session]);
  useEffect(() => { if (recording) recordRef.current?.focus(); }, [recording]);

  const resetHolds = () => { session.clearVoiceHolds(); setRecording(false); setCandidate(null); setKeyError(false); };
  return <section className="panel panel--tight" data-voice-panel>
    <h2>{t('mic.title')}</h2>
    <div className="row">
      <button type="button" data-voice-enable className={micEnabled ? 'btn btn--danger' : 'btn'} disabled={busy}
        onClick={() => void run(() => session.setMicEnabled(!micEnabled))}>{micEnabled ? t('mic.on') : t('mic.off')}</button>
    </div>
    <div className="row" role="group" aria-label={t('mic.mode')}>
      {(['continuous', 'push-to-talk'] as const).map(mode => <button key={mode} type="button" data-voice-mode={mode}
        className={`btn btn--tiny${voiceMode === mode ? ' btn--primary' : ''}`} aria-pressed={voiceMode === mode}
        onClick={() => { resetHolds(); session.setVoiceMode(mode); }}>{t(mode === 'continuous' ? 'mic.continuous' : 'mic.pushToTalk')}</button>)}
    </div>
    <p className="hint" role="status" data-voice-status>{!micEnabled ? t('mic.closed') : micTransmitting ? t('mic.transmitting') : t('mic.waiting')}</p>
    {voiceMode === 'push-to-talk' && <>
      <button type="button" data-voice-hold className={`btn${micTransmitting ? ' btn--primary' : ''}`}
        disabled={!micEnabled || !room || recording}
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); session.setVoiceHeld('button', true); }}
        onPointerUp={() => session.setVoiceHeld('button', false)} onPointerCancel={() => session.setVoiceHeld('button', false)}
        onLostPointerCapture={() => session.setVoiceHeld('button', false)} onBlur={() => session.setVoiceHeld('button', false)}
        onKeyDown={e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); session.setVoiceHeld('button', true); } }}
        onKeyUp={e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); session.setVoiceHeld('button', false); } }}>
        {t('mic.holdButton')}
      </button>
      <p className="hint">{t('mic.hotkey')}: <span data-voice-binding>{binding ? describeVoiceBinding(binding) : t('mic.unbound')}</span></p>
      <div className="row">
        <button type="button" className="btn btn--tiny" data-voice-bind onClick={() => { resetHolds(); setRecording(true); }}>{t(binding ? 'mic.changeKey' : 'mic.setKey')}</button>
        <button type="button" className="btn btn--tiny" disabled={!binding} data-voice-clear onClick={() => { resetHolds(); setBinding(null); }}>{t('mic.clearKey')}</button>
      </div>
      {recording && <div ref={recordRef} tabIndex={0} data-voice-recorder className="panel panel--tight" onKeyDown={e => {
        e.preventDefault(); e.stopPropagation();
        if (e.code === 'Escape') { resetHolds(); return; }
        if (/^(Control|Shift|Alt)(Left|Right)$/.test(e.code)) return;
        const next = bindingFromEvent(e.nativeEvent); setCandidate(next); setKeyError(!next);
      }}>
        <p className="hint">{t('mic.recordKey')} {describeVoiceBinding(candidate)}</p>
        {keyError && <p className="hint hint--warn">{t('mic.invalidKey')}</p>}
        <div className="row">
          <button type="button" className="btn btn--tiny" data-voice-save disabled={!candidate} onClick={() => { session.clearVoiceHolds(); setBinding(candidate); setRecording(false); }}>{t('mic.saveKey')}</button>
          <button type="button" className="btn btn--tiny" onClick={resetHolds}>{t('mic.cancelKey')}</button>
        </div>
      </div>}
      {error && <p className="hint hint--warn" data-voice-key-error>{error}</p>}
    </>}
    {micEnabled && micSettings && <p className="hint hint--dim">
      {t('mic.statsEcho')} {micSettings.echoCancellation ? t('mic.on2') : t('mic.off2')} · {t('mic.statsNs')} {micSettings.noiseSuppression ? t('mic.on2') : t('mic.off2')} · {t('mic.statsAgc')} {micSettings.autoGainControl ? t('mic.on2') : t('mic.off2')}
    </p>}
    {micError && <p className="hint hint--warn">{micError}</p>}
  </section>;
}

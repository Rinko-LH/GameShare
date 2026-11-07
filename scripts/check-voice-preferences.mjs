import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, '.cache/voice-ptt/unit.mjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
await build({ stdin: { contents: `export * from './apps/desktop/src/voice-settings'; export { MicCapture } from './apps/desktop/src/media/MicCapture'; export { ShareSession } from './apps/desktop/src/session/ShareSession';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', external: ['socket.io-client'], outfile: out });
const V = await import(pathToFileURL(out));
const binding = { code: 'KeyV', ctrl: true, alt: false, shift: false };
const storage = new Map();
globalThis.window = { localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
assert.deepEqual(V.readVoicePreferences(), { mode: 'continuous', binding: null });
V.saveVoicePreferences({ mode: 'push-to-talk', binding });
assert.deepEqual(V.readVoicePreferences(), { mode: 'push-to-talk', binding });
for (const raw of ['{', 'null', 'false', '{}', '{"mode":"bad","binding":{"code":"Tab"}}']) {
  storage.set(V.VOICE_STORAGE_KEY, raw); assert.deepEqual(V.readVoicePreferences(), { mode: 'continuous', binding: null });
}
for (const code of ['KeyA','KeyZ','Digit0','Digit9','F1','F12','Space','CapsLock','ArrowLeft','PageUp','Numpad0','NumpadAdd']) assert.ok(V.normalizeVoiceBinding({ ...binding, code }));
for (const code of ['Tab','Escape','ControlLeft','MetaLeft','__proto__','KeyNotReal']) assert.equal(V.normalizeVoiceBinding({ ...binding, code }), null);
for (const b of [{ ...binding, code:'F4', alt:true }, { ...binding, code:'Delete', alt:true }, { ...binding, code:'KeyG', alt:true }]) assert.equal(V.normalizeVoiceBinding(b), null);
assert.equal(V.bindingFromEvent({ code:'KeyV',ctrlKey:false,altKey:false,shiftKey:false,metaKey:true }),null);
const pressed = new Set([0x56,0x11]), detector = new V.VoiceHoldDetector(), down = k => pressed.has(k);
assert.equal(detector.sample(binding, down), false, 'Held key at activation must not open mic');
pressed.clear(); detector.sample(binding, down); pressed.add(0x56); assert.equal(detector.sample(binding,down), false);
pressed.add(0x11); assert.equal(detector.sample(binding,down), true); pressed.add(0x10); assert.equal(detector.sample(binding,down), false);
pressed.delete(0x10); assert.equal(detector.sample(binding,down), true); pressed.delete(0x56); assert.equal(detector.sample(binding,down), false);
Object.defineProperty(globalThis.window, 'localStorage', { get() { throw Error('Storage blocked'); } });
assert.doesNotThrow(() => V.saveVoicePreferences({ mode:'continuous',binding:null })); assert.equal(V.readVoicePreferences().binding,null);

let pending = [];
Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable:true, value: { getUserMedia: () => new Promise((resolve,reject) => pending.push({resolve,reject})) } });
function stream() { const track = { readyState:'live', enabled:true, stop(){ this.readyState='ended'; }, addEventListener(){}, getSettings(){return {};} };return { track, getAudioTracks:()=>[track], getTracks:()=>[track] }; }
const mic = new V.MicCapture(), first = mic.start(); mic.stop(); const late = stream(); pending.shift().resolve(late);
await assert.rejects(first,/取消/); assert.equal(late.track.readyState,'ended'); assert.equal(mic.live,false);
const obsolete = mic.start(); mic.stop(); const replacement = mic.start();
const oldCapture = pending.shift(), newCapture = pending.shift(), oldStream = stream(), newStream = stream();
newCapture.resolve(newStream); await replacement; oldCapture.resolve(oldStream); await assert.rejects(obsolete,/取消/);
assert.equal(oldStream.track.readyState,'ended'); assert.equal(mic.track,newStream.track); assert.equal(mic.live,true); mic.stop();
for (const action of ['disconnect','leaveRoom','dispose']) {
  const interrupted = new V.ShareSession(), acquiring = interrupted.setMicEnabled(true);
  try { await interrupted[action](); } catch { /* 无信令时离房仍必须取消本地采集 */ }
  const abandoned = stream(); pending.shift().resolve(abandoned); await acquiring;
  assert.equal(abandoned.track.readyState,'ended', action + ' must stop a late capture');
  assert.equal(interrupted.getState().micEnabled,false); interrupted.dispose();
}
const session = new V.ShareSession();
session.setVoiceMode('push-to-talk');
const opening = session.setMicEnabled(true); await session.setMicEnabled(false);
const cancelled = stream(); pending.shift().resolve(cancelled); await opening;
assert.equal(cancelled.track.readyState,'ended'); assert.equal(session.getState().micEnabled,false);
const next = session.setMicEnabled(true), live = stream(); pending.shift().resolve(live); await next;
assert.equal(live.track.enabled,false,'PTT must start muted');
session.setVoiceHeld('keyboard',true); assert.equal(live.track.enabled,false,'Out of room must not transmit PTT');
session.setVoiceMode('continuous'); assert.equal(live.track.enabled,true);
session.setVoiceMode('push-to-talk'); assert.equal(live.track.enabled,false);
session.disconnect(); assert.equal(live.track.readyState,'ended');
const denied = session.setMicEnabled(true); pending.shift().reject(new globalThis.DOMException('test','NotAllowedError'));
await assert.rejects(denied,/权限/); assert.equal(session.getState().micTransmitting,false); session.dispose();
delete globalThis.window;
console.log('PASS: voice defaults/storage/key validation, fresh press, modifiers, cancelled mic acquisition, mode gates and permission failure');

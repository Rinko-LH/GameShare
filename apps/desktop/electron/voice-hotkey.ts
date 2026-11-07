import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import path from 'node:path';
import { normalizeVoiceBinding, VoiceHoldDetector, type VoiceBinding, type VoiceHotkeyConfig, type VoiceHotkeyStatus } from '../src/voice-settings';

let host: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;
let config: VoiceHotkeyConfig = { active: false, binding: null };
let state: VoiceHotkeyStatus = { pressed: false, error: null, revision: 0 };
let locked = false, suspended = false;
let readKey: ((key: number) => number) | null = null;
function publish(pressed: boolean, error: string | null = null): void {
  if (state.pressed === pressed && state.error === error) return;
  state = { ...state, pressed, error };
  if (host && !host.isDestroyed()) host.webContents.send('voice:hotkey-state', state);
}
function stop(): void { if (timer) clearInterval(timer); timer = null; publish(false); }
function loadReader(): (key: number) => number {
  if (readKey) return readKey;
  if (process.platform !== 'win32') throw new Error('全局按住发言目前仅支持 Windows');
  const candidates = ['koffi', path.join(process.resourcesPath, 'audio-ffi', 'node_modules', 'koffi')];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffi = require(candidate) as { load(name: string): { func(signature: string): (key: number) => number } };
      readKey = ffi.load('user32.dll').func('int16 GetAsyncKeyState(int vKey)');
      return readKey;
    } catch { /* 开发路径失败后尝试随应用分发的 FFI */ }
  }
  throw new Error('无法读取全局按键，请使用界面按住发言按钮');
}
function restart(): void {
  stop();
  if (!config.active || !config.binding || locked || suspended || !host || host.isDestroyed()) return;
  try {
    const read = loadReader(), detector = new VoiceHoldDetector(), binding: VoiceBinding = config.binding;
    const tick = () => {
      try { publish(detector.sample(binding, key => read(key) < 0)); }
      catch { stop(); publish(false, '全局按键读取失败，请使用界面按钮'); }
    };
    tick(); timer = setInterval(tick, 20);
  } catch (error) { publish(false, error instanceof Error ? error.message : String(error)); }
}
export function setVoiceHotkeyHost(win: BrowserWindow): void {
  stop(); host = win; config = { active: false, binding: null };
  const release = () => { if (host === win) { config = { active: false, binding: null }; stop(); } };
  win.on('closed', () => { release(); if (host === win) host = null; });
  win.webContents.on('render-process-gone', release);
  win.webContents.on('did-start-loading', release);
}
export function registerVoiceHotkeyHandlers(): void {
  ipcMain.handle('voice:configure-hotkey', (event, value: unknown): VoiceHotkeyStatus => {
    if (!host || event.sender !== host.webContents) throw new Error('仅主窗口可配置语音快捷键');
    const v = value as Partial<VoiceHotkeyConfig> | null;
    const binding = normalizeVoiceBinding(v?.binding);
    stop(); state = { pressed: false, error: null, revision: state.revision + 1 };
    config = { active: v?.active === true, binding };
    if (v?.binding != null && !binding) { config.active = false; publish(false, '无效或保留的快捷键'); }
    else restart();
    return state;
  });
  powerMonitor.on('lock-screen', () => { locked = true; stop(); });
  powerMonitor.on('unlock-screen', () => { locked = false; restart(); });
  powerMonitor.on('suspend', () => { suspended = true; stop(); });
  powerMonitor.on('resume', () => { suspended = false; restart(); });
  app.on('before-quit', stop);
}

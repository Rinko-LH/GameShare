import { BrowserWindow, app, globalShortcut, ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeAllTiles, getTilesEnabled, keepAliveTiles, setTilesChangeListener, setTilesEnabled, setTilesOpacity } from './float-tiles';

const HOTKEY = 'Control+Alt+G';
export const MIN_OPACITY = 0.3;
export const MAX_OPACITY = 1;
export interface FloatWindowStatus {
  enabled: boolean;
  tilesEnabled: boolean;
  opacity: number;
  minOpacity: number;
  hotkeyAvailable: boolean;
  hotkey: string;
}
let enabled = false;
let opacity = 0.9;
let hotkeyAvailable = false;
let hostWindow: BrowserWindow | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;
function configPath(): string { return path.join(app.getPath('userData'), 'float-window.json'); }
function persist(): void {
  try { mkdirSync(path.dirname(configPath()), { recursive: true }); writeFileSync(configPath(), JSON.stringify({ opacity })); }
  catch (err) { console.warn('无法保存浮窗透明度', err); }
}
function status(): FloatWindowStatus { return { enabled, tilesEnabled: getTilesEnabled(), opacity, minOpacity: MIN_OPACITY, hotkeyAvailable, hotkey: HOTKEY }; }
function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('float:status', status());
}
setTilesChangeListener(broadcast);
export function setPrimaryWindow(win: BrowserWindow): void {
  hostWindow = win;
  win.on('closed', () => { closeAllTiles(); enabled = false; hostWindow = null; if (keepAliveTimer) clearInterval(keepAliveTimer); keepAliveTimer = null; });
}
export function setFloatEnabled(next: boolean): FloatWindowStatus {
  enabled = next;
  // 主窗口始终保持普通窗口的大小、焦点、透明度和任务栏入口。
  if (hostWindow && !hostWindow.isDestroyed()) { hostWindow.setOpacity(1); hostWindow.setAlwaysOnTop(false); hostWindow.setFocusable(true); }
  if (next) { setTilesOpacity(opacity); setTilesEnabled(true); if (!keepAliveTimer) keepAliveTimer = setInterval(keepAliveTiles, 300); }
  else { closeAllTiles(); if (keepAliveTimer) clearInterval(keepAliveTimer); keepAliveTimer = null; }
  broadcast(); return status();
}
export function toggleFloat(): void { setFloatEnabled(!enabled); }
export function setFloatOpacity(value: number): FloatWindowStatus {
  if (!Number.isFinite(value)) return status();
  opacity = Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, value));
  setTilesOpacity(opacity); persist(); broadcast(); return status();
}
export function registerWindowModeHandlers(): void {
  try { const stored = JSON.parse(readFileSync(configPath(), 'utf8')) as { opacity?: number }; if (typeof stored.opacity === 'number' && Number.isFinite(stored.opacity)) opacity = Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, stored.opacity)); } catch { /* 首次启动使用默认透明度 */ }
  const isHost = (event: Electron.IpcMainInvokeEvent) => event.sender === hostWindow?.webContents;
  ipcMain.handle('float:get-status', () => status());
  ipcMain.handle('float:set-enabled', (event, value: unknown) => isHost(event) ? setFloatEnabled(value === true) : status());
  ipcMain.handle('float:set-opacity', (event, value: unknown) => isHost(event) ? setFloatOpacity(typeof value === 'number' ? value : Number.NaN) : status());
  // 旧版主浮窗的拖动通道不再移动主窗口；独立小窗使用自己的受校验通道。
  ipcMain.on('float:move-to', () => undefined);
  ipcMain.on('float:resize-to', () => undefined);
  ipcMain.on('win:minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on('win:toggle-maximize', event => { const win = BrowserWindow.fromWebContents(event.sender); if (!win || win.isDestroyed()) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.on('win:close', event => BrowserWindow.fromWebContents(event.sender)?.close());
  hotkeyAvailable = globalShortcut.register(HOTKEY, toggleFloat);
  app.on('browser-window-created', (_event, win) => { const push = () => { if (!win.isDestroyed()) win.webContents.send('win:maximized', win.isMaximized()); }; win.on('maximize', push); win.on('unmaximize', push); });
  app.on('will-quit', () => { if (keepAliveTimer) clearInterval(keepAliveTimer); globalShortcut.unregisterAll(); });
}

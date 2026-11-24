import type { GameShareApi, TunnelStatus } from './types/global';
import { TauriTiles } from './tauri-tiles';

import { listenNative, native } from './tauri-native';
import { bindingVirtualKey, normalizeVoiceBinding, type VoiceHotkeyStatus } from './voice-settings';

export async function installTauriBridge(): Promise<void> {
  if (!window.__TAURI__ || new URLSearchParams(location.search).has('floatTile')) return;
  const tiles = new TauriTiles();
  await tiles.initialize();
  const tunnelListeners = new Set<(status: TunnelStatus) => void>();
  await listenNative<TunnelStatus>('tunnel-status', 'main', (status) => {
    for (const callback of tunnelListeners) callback(status);
  });
  const control = (action: string) => void native('control_window', { action }).catch(console.error);
  window.gameShare = {
    runtime: 'tauri',
    voiceHotkey: {
      configure({ active, binding }) {
        const valid = normalizeVoiceBinding(binding);
        return native('configure_voice_hotkey', {
          active,
          binding: valid && { key: bindingVirtualKey(valid), ctrl: valid.ctrl, alt: valid.alt, shift: valid.shift },
        });
      },
      onState(callback) {
        let stop: (() => void) | undefined;
        let disposed = false;
        void listenNative<VoiceHotkeyStatus>('voice-hotkey', 'main', (status) => {
          if (!disposed) callback(status);
        }).then((unsubscribe) => {
          if (disposed) unsubscribe();
          else stop = unsubscribe;
        }).catch(console.error);
        return () => { disposed = true; stop?.(); };
      },
    },
    server: {
      getStatus: () => native('signaling_status'),
      setEnabled: (enabled) => native('set_signaling', { enabled }),
      onStatus: () => () => undefined,
    },
    tunnel: {
      getStatus: () => native('tunnel_status'),
      setEnabled: (enabled) => native('set_tunnel', { enabled }),
      onStatus(callback) {
        tunnelListeners.add(callback);
        return () => tunnelListeners.delete(callback);
      },
    },
    getAppInfo: () => native('app_info'),
    clipboard: {
      async writeText(value) {
        try { await navigator.clipboard.writeText(value); return true; }
        catch { return false; }
      },
    },
    windowMode: tiles.windowMode,
    floatTiles: tiles.api,
    windowControl: {
      minimize: () => control('minimize'),
      toggleMaximize: () => control('toggle-maximize'),
      close: () => control('close'),
      startDragging: () => control('drag'),
      onMaximized(callback) {
        const refresh = () => void native<boolean>('is_maximized').then(callback).catch(console.error);
        window.addEventListener('resize', refresh);
        refresh();
        return () => window.removeEventListener('resize', refresh);
      },
    },
  } satisfies GameShareApi;
}

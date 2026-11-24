interface TauriRuntime {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(name: string, callback: (event: { payload: T }) => void, options: { target: string }): Promise<() => void>;
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriRuntime;
  }
}

export function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__!.core.invoke(command, args);
}

export function listenNative<T>(name: string, target: string, callback: (payload: T) => void): Promise<() => void> {
  return window.__TAURI__!.event.listen<T>(name, ({ payload }) => callback(payload), { target });
}

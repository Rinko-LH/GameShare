import { listenNative, native } from './tauri-native';
import type { FloatTilePeer, FloatTilesStatus, FloatWindowStatus, GameShareApi } from './types/global';

const FLOAT_OPACITY_KEY = 'gs.tauri.floatOpacity';
export const MIN_FLOAT_OPACITY = 0.25;

function normalizeFloatOpacity(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(MIN_FLOAT_OPACITY, value)) : 1;
}

export function readFloatOpacity(): number {
  return normalizeFloatOpacity(Number(window.localStorage.getItem(FLOAT_OPACITY_KEY) ?? 1));
}

export function writeFloatOpacity(value: number): number {
  const opacity = normalizeFloatOpacity(value);
  window.localStorage.setItem(FLOAT_OPACITY_KEY, String(opacity));
  return opacity;
}

// Every floating WebView uses the main WebView's origin and profile. The storage
// event synchronizes the picture opacity while keeping the local slider responsive.
export function watchFloatOpacity(callback: (opacity: number) => void): () => void {
  const update = (event: StorageEvent) => {
    if (event.key === FLOAT_OPACITY_KEY || event.key === null) callback(readFloatOpacity());
  };
  window.addEventListener('storage', update);
  return () => window.removeEventListener('storage', update);
}

export type TileSignal =
  | { kind: 'ready' | 'mute' | 'mute-voice' | 'toggle-picture' }
  | { kind: 'offer'; description: RTCSessionDescriptionInit; peer: FloatTilePeer }
  | { kind: 'answer'; description: RTCSessionDescriptionInit }
  | { kind: 'peer'; peer: FloatTilePeer }
  | { kind: 'volume'; volume: number; channel: 'voice' | 'share' };
interface Tile {
  label: string;
  slot: number;
  peer: FloatTilePeer;
  track: MediaStreamTrack | null;
  closing?: boolean;
  connection?: RTCPeerConnection;
  sender?: RTCRtpSender;
}

class Listeners<T> {
  private callbacks = new Set<(value: T) => void>();
  subscribe = (callback: (value: T) => void): (() => void) => {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  };
  emit(value: T): void {
    for (const callback of this.callbacks) callback(value);
  }
}

export async function localTileDescription(peer: RTCPeerConnection, description: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('等待浮窗 ICE 超时')), 6000);
      const check = () => {
        if (peer.iceGatheringState === 'complete') finish();
        if (peer.signalingState === 'closed') finish(new Error('浮窗连接已关闭'));
      };
      function finish(error?: Error) {
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', check);
        peer.removeEventListener('signalingstatechange', check);
        if (error) reject(error);
        else resolve();
      }
      peer.addEventListener('icegatheringstatechange', check);
      peer.addEventListener('signalingstatechange', check);
      check();
    });
  }
  return peer.localDescription!.toJSON();
}

export const sendTileSignal = (label: string, message: TileSignal) =>
  native<void>('tile_signal', { label, message });

export class TauriTiles {
  private enabled = false;
  private serial = 0;
  private pending = Promise.resolve<FloatTilesStatus>({ enabled: false, tiles: [] });
  private tiles = new Map<string, Tile>();
  private desired = new Map<string, FloatTilePeer>();
  private dismissed = new Set<string>();
  private tracks = new Map<string, MediaStreamTrack>();
  private windows = new Listeners<FloatWindowStatus>();
  private statuses = new Listeners<FloatTilesStatus>();
  private mute = new Listeners<string>();
  private muteVoice = new Listeners<string>();
  private togglePicture = new Listeners<string>();
  private volume = new Listeners<{ peerId: string; volume: number; channel: 'voice' | 'share' }>();

  async initialize(): Promise<void> {
    await listenNative<{ label: string; message: TileSignal }>('tile-signal', 'main', ({ label, message }) =>
      void this.onSignal(label, message).catch((error) => {
        if (this.tiles.has(label)) console.error('浮窗连接失败', error);
      }),
    );
    await listenNative<string>('tile-closed', 'main', (label) => {
      const tile = this.tiles.get(label);
      if (!tile) return;
      this.remove(label);
      if (!tile.closing && this.enabled) {
        if (![...this.tiles.values()].some((remaining) => !remaining.closing)) {
          this.disable();
          this.windows.emit(this.mode());
        } else if (this.desired.has(tile.peer.peerId)) {
          this.dismissed.add(tile.peer.peerId);
        }
      }
      this.statuses.emit(this.status());
    });
    const stopWatchingOpacity = watchFloatOpacity(() => this.windows.emit(this.mode()));
    window.addEventListener('pagehide', () => {
      stopWatchingOpacity();
      for (const label of this.tiles.keys()) this.remove(label);
    }, { once: true });
  }

  private mode(): FloatWindowStatus {
    return { enabled: this.enabled, tilesEnabled: this.enabled, opacity: readFloatOpacity(), minOpacity: MIN_FLOAT_OPACITY,
      hotkeyAvailable: false, hotkey: '' };
  }

  private status(): FloatTilesStatus {
    return { enabled: this.enabled, tiles: [...this.tiles.values()].map(({ slot, peer }) =>
      ({ index: slot, peerId: peer.peerId, name: peer.name, width: 360, height: 225 })) };
  }

  private remove(label: string): void {
    this.tiles.get(label)?.connection?.close();
    this.tiles.delete(label);
  }

  private disable(): void {
    this.enabled = false;
    this.desired.clear();
    this.dismissed.clear();
  }

  private sync(): Promise<FloatTilesStatus> {
    const apply = async () => {
      const peers = this.enabled ? this.desired : new Map<string, FloatTilePeer>();
      for (const [label, tile] of this.tiles) {
        if (peers.has(tile.peer.peerId)) continue;
        tile.closing = true;
        try {
          await native('close_tile', { label });
        } catch (error) {
          tile.closing = false;
          throw error;
        }
        this.remove(label);
      }
      for (const peer of peers.values()) {
        if (!this.enabled) break;
        if (!this.desired.has(peer.peerId) || this.dismissed.has(peer.peerId)) continue;
        const tile = [...this.tiles.values()].find((candidate) => candidate.peer.peerId === peer.peerId);
        if (tile) {
          tile.peer = peer;
          if (tile.connection) await sendTileSignal(tile.label, { kind: 'peer', peer });
          continue;
        }
        const slots = new Set([...this.tiles.values()].map((entry) => entry.slot));
        const slot = [0, 1, 2, 3, 4, 5, 6].find((index) => !slots.has(index));
        if (slot === undefined) break;
        const label = `tile-${++this.serial}`;
        this.tiles.set(label, { label, peer, slot, track: this.tracks.get(peer.peerId) ?? null });
        try {
          await native('open_tile', { label, title: peer.name, slot });
        } catch (error) {
          this.remove(label);
          throw error;
        }
      }
      const status = this.status();
      this.statuses.emit(status);
      return status;
    };
    this.pending = this.pending.then(apply, apply);
    return this.pending;
  }

  private updateTracks(tracks: ReadonlyMap<string, MediaStreamTrack>): void {
    this.tracks = new Map(tracks);
    for (const tile of this.tiles.values()) {
      const track = this.tracks.get(tile.peer.peerId) ?? null;
      if (track === tile.track) continue;
      tile.track = track;
      void tile.sender?.replaceTrack(track).catch((error) => {
        if (this.tiles.has(tile.label)) console.error('浮窗视频轨更换失败', error);
      });
    }
  }

  private async onSignal(label: string, message: TileSignal): Promise<void> {
    const tile = this.tiles.get(label);
    if (!tile) return;
    if (message.kind === 'mute') this.mute.emit(tile.peer.peerId);
    if (message.kind === 'mute-voice') this.muteVoice.emit(tile.peer.peerId);
    if (message.kind === 'toggle-picture') this.togglePicture.emit(tile.peer.peerId);
    if (message.kind === 'volume' && Number.isFinite(message.volume) && (message.channel === 'voice' || message.channel === 'share')) {
      this.volume.emit({ peerId: tile.peer.peerId, volume: Math.min(1, Math.max(0, message.volume)), channel: message.channel });
    }
    if (message.kind === 'ready') {
      tile.connection?.close();
      const connection = new RTCPeerConnection({ iceServers: [] });
      tile.connection = connection;
      const transceiver = connection.addTransceiver('video', { direction: 'sendonly' });
      tile.sender = transceiver.sender;
      if (tile.track) await tile.sender.replaceTrack(tile.track);
      const description = await localTileDescription(connection, await connection.createOffer());
      if (tile.connection === connection && this.tiles.has(label)) {
        await sendTileSignal(label, { kind: 'offer', description, peer: tile.peer });
      }
    }
    if (message.kind === 'answer' && tile.connection?.signalingState === 'have-local-offer') {
      await tile.connection.setRemoteDescription(message.description);
    }
  }

  windowMode: GameShareApi['windowMode'] = {
    getStatus: async () => this.mode(),
    setEnabled: async (enabled) => {
      if (enabled) this.enabled = true;
      else this.disable();
      await this.sync();
      const mode = this.mode();
      this.windows.emit(mode);
      return mode;
    },
    onStatus: this.windows.subscribe,
    setOpacity: async (opacity) => {
      writeFloatOpacity(opacity);
      const mode = this.mode();
      this.windows.emit(mode);
      return mode;
    },
    moveTo: () => undefined,
    resizeTo: () => undefined,
  };

  api: GameShareApi['floatTiles'] = {
    getStatus: async () => this.status(),
    syncPeers: (peers) => {
      if (!this.enabled) return Promise.resolve(this.status());
      this.desired = new Map(peers.map((peer) => [peer.peerId, peer]));
      for (const peerId of this.dismissed) {
        if (!this.desired.has(peerId)) this.dismissed.delete(peerId);
      }
      return this.sync();
    },
    onStatus: this.statuses.subscribe,
    onTileSize: () => () => undefined,
    onTilePort: () => () => undefined,
    onToggleMuteRequest: this.mute.subscribe,
    onToggleVoiceMuteRequest: this.muteVoice.subscribe,
    onTogglePictureRequest: this.togglePicture.subscribe,
    onVolumeRequest: this.volume.subscribe,
    setVideoTracks: (tracks) => this.updateTracks(tracks),
  };
}

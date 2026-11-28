import { useEffect, useRef, useState } from 'react';
import workletUrl from './voice-activity-worklet.js?url&no-inline';

interface VoiceInput {
  track: MediaStreamTrack;
  speaking: boolean;
  stop: () => void;
}

const EMPTY_SPEAKERS: ReadonlySet<string> = new Set();

// One graph per room, with no output path. Playback continues through the existing audio elements.
class VoiceActivity {
  private context: AudioContext | null = null;
  private ready = false;
  private tracks: ReadonlyMap<string, MediaStreamTrack> = new Map();
  private inputs = new Map<string, VoiceInput>();

  constructor(private readonly onChange: (speakers: ReadonlySet<string>) => void) {}

  update(tracks: ReadonlyMap<string, MediaStreamTrack>): void {
    this.tracks = tracks;
    let removedSpeaker = false;
    for (const [id, input] of this.inputs) {
      if (tracks.get(id) === input.track) continue;
      input.stop();
      removedSpeaker ||= input.speaking;
    }
    if (removedSpeaker) this.publish();

    if (!this.context && tracks.size > 0) {
      const context = new AudioContext();
      this.context = context;
      document.addEventListener('pointerup', this.resume);
      document.addEventListener('keydown', this.resume);
      this.resume();
      void context.audioWorklet.addModule(workletUrl).then(() => {
        if (this.context !== context) return;
        this.ready = true;
        this.connectTracks(context);
      }).catch((error) => {
        if (this.context === context) console.error('Voice activity initialization failed', error);
      });
    } else if (this.context && this.ready) {
      this.connectTracks(this.context);
    }
  }

  close(): void {
    document.removeEventListener('pointerup', this.resume);
    document.removeEventListener('keydown', this.resume);
    for (const input of this.inputs.values()) input.stop();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private resume = (): void => {
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => undefined);
  };

  private connectTracks(context: AudioContext): void {
    for (const [id, track] of this.tracks) {
      if (track.readyState !== 'live' || this.inputs.has(id)) continue;
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const meter = new AudioWorkletNode(context, 'gameshare-voice-activity', {
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      const stop = () => {
        track.removeEventListener('ended', ended);
        meter.port.postMessage(null);
        meter.port.close();
        source.disconnect();
        this.inputs.delete(id);
      };
      const ended = () => {
        stop();
        if (input.speaking) this.publish();
      };
      const input: VoiceInput = { track, speaking: false, stop };
      this.inputs.set(id, input);
      track.addEventListener('ended', ended, { once: true });
      meter.port.onmessage = ({ data }: MessageEvent<boolean>) => {
        if (this.inputs.get(id) !== input || input.speaking === data) return;
        input.speaking = data;
        this.publish();
      };
      source.connect(meter);
    }
  }

  private publish(): void {
    this.onChange(new Set([...this.inputs].filter(([, input]) => input.speaking).map(([id]) => id)));
  }
}

export function useSpeakingPeers(roomCode: string | undefined, tracks: ReadonlyMap<string, MediaStreamTrack>): ReadonlySet<string> {
  const activity = useRef<VoiceActivity | null>(null);
  const [speakers, setSpeakers] = useState(EMPTY_SPEAKERS);

  useEffect(() => {
    setSpeakers(EMPTY_SPEAKERS);
    if (!roomCode) return;
    const detector = new VoiceActivity(setSpeakers);
    activity.current = detector;
    return () => {
      detector.close();
      activity.current = null;
    };
  }, [roomCode]);

  useEffect(() => activity.current?.update(tracks), [roomCode, tracks]);
  return speakers;
}

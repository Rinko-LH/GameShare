import workletUrl from './process-audio-worklet.js?url&no-inline';
import { native } from '../tauri-native';

export interface AudioApplication {
  pid: number;
  title: string;
}

export interface ApplicationAudio {
  application: AudioApplication;
  track: MediaStreamTrack;
  ended: Promise<void>;
  stop: () => void;
}

let nextCaptureId = 0;

export function listAudioApplications(): Promise<AudioApplication[]> {
  return native('list_audio_applications');
}

export async function startApplicationAudio(source: number | string): Promise<ApplicationAudio> {
  const captureId = ++nextCaptureId;
  const context = new AudioContext({ sampleRate: 48000 });
  const resume = context.resume();
  let player: AudioWorkletNode | undefined;
  let track: MediaStreamTrack | undefined;
  let requested = false;
  let stopped = false;
  let resolveEnded: (() => void) | undefined;
  const ended = new Promise<void>(resolve => { resolveEnded = resolve; });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    player?.port.close();
    player?.disconnect();
    track?.stop();
    if (requested) {
      void native('stop_application_audio', { captureId }).catch(() => undefined);
    }
    void context.close().catch(() => undefined);
    resolveEnded?.();
  };

  try {
    await Promise.all([resume, context.audioWorklet.addModule(workletUrl)]);
    requested = true;
    const application = await native<AudioApplication>('start_application_audio', {
      captureId,
      ...(typeof source === 'number' ? { pid: source } : { windowSource: source }),
    });
    player = new AudioWorkletNode(context, 'gameshare-process-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    player.port.onmessage = () => {
      void native<ArrayBuffer>('read_application_audio', { captureId }).then(pcm => {
        if (!stopped) player?.port.postMessage(pcm, [pcm]);
      }).catch(stop);
    };
    player.addEventListener('processorerror', stop, { once: true });
    const output = context.createMediaStreamDestination();
    player.connect(output);
    track = output.stream.getAudioTracks()[0];
    return { application, track, ended, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

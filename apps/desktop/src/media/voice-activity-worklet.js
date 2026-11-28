/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const WINDOW_FRAMES = Math.round(sampleRate * 0.02);
const HOLD_FRAMES = Math.round(sampleRate * 0.45);
const START_POWER = 0.012 ** 2;
const HOLD_POWER = 0.006 ** 2;

class VoiceActivityMeter extends AudioWorkletProcessor {
  power = 0;
  frames = 0;
  holdRemaining = 0;
  running = true;

  constructor() {
    super();
    this.port.onmessage = () => { this.running = false; };
  }

  process([input]) {
    if (!this.running) return false;
    const mono = input[0];
    if (mono) {
      for (const sample of mono) this.power += sample * sample;
    }
    this.frames += mono?.length ?? 128;
    if (this.frames < WINDOW_FRAMES) return true;

    const wasSpeaking = this.holdRemaining > 0;
    const threshold = wasSpeaking ? HOLD_POWER : START_POWER;
    this.holdRemaining = this.power / this.frames >= threshold
      ? HOLD_FRAMES
      : Math.max(0, this.holdRemaining - this.frames);
    const speaking = this.holdRemaining > 0;
    if (speaking !== wasSpeaking) this.port.postMessage(speaking);

    this.power = 0;
    this.frames = 0;
    return true;
  }
}

registerProcessor('gameshare-voice-activity', VoiceActivityMeter);

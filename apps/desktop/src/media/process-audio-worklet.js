/* global AudioWorkletProcessor, currentFrame, registerProcessor */

class ProcessAudioPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(9600 * 2);
    this.readAt = 0;
    this.framesQueued = 0;
    this.pending = false;
    this.nextRequest = 0;
    this.port.onmessage = ({ data }) => {
      const incoming = new Int16Array(data);
      const capacity = this.samples.length / 2;
      const overflow = Math.max(0, this.framesQueued + incoming.length / 2 - capacity);
      this.readAt = (this.readAt + overflow) % capacity;
      this.framesQueued -= overflow;
      let writeAt = (this.readAt + this.framesQueued) * 2 % this.samples.length;
      for (const sample of incoming) {
        this.samples[writeAt] = sample;
        writeAt = (writeAt + 1) % this.samples.length;
      }
      this.framesQueued += incoming.length / 2;
      this.pending = false;
    };
  }

  process(_inputs, [[left, right]]) {
    const count = Math.min(this.framesQueued, left.length);
    const capacity = this.samples.length / 2;
    for (let frame = 0; frame < count; frame++) {
      left[frame] = this.samples[this.readAt * 2] / 32768;
      right[frame] = this.samples[this.readAt * 2 + 1] / 32768;
      this.readAt = (this.readAt + 1) % capacity;
    }
    this.framesQueued -= count;
    if (!this.pending && this.framesQueued < 1920 && currentFrame >= this.nextRequest) {
      this.pending = true;
      this.nextRequest = currentFrame + 960;
      this.port.postMessage(null);
    }
    return true;
  }
}

registerProcessor('gameshare-process-audio', ProcessAudioPlayer);

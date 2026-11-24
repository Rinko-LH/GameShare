import { invoke, listen, localDescription } from './peer.js';

const params = new URLSearchParams(location.search);
const index = Number(params.get('index'));
const run = Number(params.get('run'));
const video = document.querySelector('video');
const status = document.querySelector('#status');
const peer = new RTCPeerConnection({ iceServers: [] });

function showError(error) {
  status.textContent = `接收失败：${error instanceof Error ? error.message : String(error)}`;
}

peer.ontrack = ({ track }) => {
  video.srcObject = new MediaStream([track]);
  void video.play().catch(showError);
};

let frames = 0;
let sampleStart = performance.now();
let previous;
let maxGap = 0;

function observeFrame(now) {
  if (previous !== undefined) maxGap = Math.max(maxGap, now - previous);
  previous = now;
  frames += 1;
  video.requestVideoFrameCallback(observeFrame);
}
video.requestVideoFrameCallback(observeFrame);

const timer = setInterval(() => {
  if (previous === undefined) return;
  const now = performance.now();
  const fps = frames * 1000 / (now - sampleStart);
  const gap = Math.max(maxGap, now - previous);
  status.textContent = `第 ${index + 1} 路 · ${fps.toFixed(1)} fps · 最长帧间隔 ${gap.toFixed(0)} ms`;
  status.dataset.fps = fps.toFixed(1);
  status.dataset.gap = gap.toFixed(0);
  frames = 0;
  maxGap = 0;
  sampleStart = now;
}, 1000);

const unlisten = await listen('preview-signal', ({ payload }) => {
  if (payload.kind === 'offer' && payload.index === index && payload.run === run) {
    void answer(payload.description).catch(showError);
  }
}, { target: `tile-${index}` });

async function answer(description) {
  await peer.setRemoteDescription(description);
  const response = await localDescription(peer, await peer.createAnswer());
  await invoke('relay', { index, message: { kind: 'answer', index, run, description: response } });
}

window.addEventListener('pagehide', () => {
  unlisten();
  clearInterval(timer);
  peer.close();
});

await invoke('relay', { index, message: { kind: 'ready', index, run } }).catch(showError);

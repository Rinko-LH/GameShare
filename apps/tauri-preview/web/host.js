import { invoke, listen, localDescription } from './peer.js';

const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
const minimize = document.querySelector('#minimize');
const status = document.querySelector('#status');
let serial = 0;
let active;

function showError(error) {
  status.textContent = `测试失败：${error instanceof Error ? error.message : String(error)}`;
}

async function closePreview() {
  const current = active;
  active = undefined;
  minimize.disabled = true;
  stop.disabled = true;
  if (current) {
    current.worker.terminate();
    for (const { peer, track } of current.streams) {
      peer.close();
      track.stop();
    }
  }
  try {
    await invoke('close_tiles');
    status.textContent = '浮窗已关闭';
  } finally {
    start.disabled = false;
  }
}

function refreshStatus() {
  if (!active) return;
  const connected = active.streams.filter(({ peer }) => peer.connectionState === 'connected').length;
  status.textContent = `${connected} / 3 路 WebRTC 已连接`;
  minimize.disabled = connected === 0;
}

async function openPreview() {
  start.disabled = true;
  if (typeof MediaStreamTrackGenerator !== 'function') {
    throw new Error('当前 WebView2 缺少 MediaStreamTrackGenerator，请更新 WebView2 后重试');
  }

  const run = ++serial;
  const worker = new Worker('./source.js', { type: 'module' });
  active = { run, worker, streams: [] };
  worker.addEventListener('error', (event) => showError(event.message));
  worker.addEventListener('message', ({ data }) => showError(data));
  for (let index = 0; index < 3; index += 1) {
    const track = new MediaStreamTrackGenerator({ kind: 'video' });
    const peer = new RTCPeerConnection({ iceServers: [] });
    active.streams.push({ peer, track, started: false });
    peer.addTrack(track, new MediaStream([track]));
    peer.addEventListener('connectionstatechange', () => {
      refreshStatus();
      if (peer.connectionState === 'failed') showError(`第 ${index + 1} 路连接失败`);
    });
    const output = track.writable;
    worker.postMessage({ index, output }, [output]);
  }
  status.textContent = '正在建立三路 WebRTC 连接…';
  await invoke('open_tiles', { run });
  stop.disabled = false;
}

await listen('preview-signal', ({ payload }) => {
  void handleSignal(payload).catch(showError);
}, { target: 'main' });
await listen('preview-tile-closed', ({ payload: index }) => {
  const stream = active?.streams[index];
  if (!stream) return;
  stream.peer.close();
  active.worker.postMessage({ index, stop: true });
  stream.track.stop();
  refreshStatus();
}, { target: 'main' });

async function handleSignal({ index, kind, run, description }) {
  const current = active;
  const stream = current?.streams[index];
  if (!stream || current.run !== run) return;
  const { peer } = stream;
  if (kind === 'ready' && !stream.started) {
    stream.started = true;
    const offer = await localDescription(peer, await peer.createOffer());
    if (active === current && peer.signalingState !== 'closed') {
      await invoke('relay', { index, message: { kind: 'offer', index, run, description: offer } });
    }
  } else if (kind === 'answer' && peer.signalingState === 'have-local-offer') {
    await peer.setRemoteDescription(description);
  }
}

start.onclick = () => void openPreview().catch(async (error) => {
  try {
    await closePreview();
  } finally {
    showError(error);
  }
});
stop.onclick = () => void closePreview().catch(showError);
minimize.onclick = () => void invoke('minimize_main').catch(showError);

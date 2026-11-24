import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

if (!process.argv[2]) {
  throw new Error('Usage: node tests/check.mjs <path-to-preview.exe>');
}
const exe = path.resolve(process.argv[2]);
const profile = path.resolve(import.meta.dirname, '../../../.cache/tauri-preview-check', 'profile-' + randomUUID());
mkdirSync(profile, { recursive: true });
const port = await new Promise((resolve) => {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1', () => {
    const { port } = listener.address();
    listener.close(() => resolve(port));
  });
});
const endpoint = 'http://127.0.0.1:' + port;
const app = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let errorLog = '';
app.stderr.on('data', (data) => { errorLog += data; });
let commandId = 0;
const sockets = [];
const list = async () => (await (await fetch(endpoint + '/json/list')).json()).filter(x => x.type === 'page');
async function until(check, label, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (app.exitCode !== null) throw new Error('App exited: ' + app.exitCode + '\n' + errorLog);
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await wait(250);
  }
  throw new Error('Timed out: ' + label + '\n' + errorLog);
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return (expression) => new Promise((resolve, reject) => {
    const id = ++commandId;
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', receive);
      reject(new Error('CDP timeout: ' + expression));
    }, 5000);
    function receive(event) {
      const result = JSON.parse(event.data);
      if (result.id !== id) return;
      socket.removeEventListener('message', receive);
      clearTimeout(timeout);
      if (result.error || result.result.exceptionDetails) {
        reject(new Error(JSON.stringify(result.error || result.result.exceptionDetails)));
      } else {
        resolve(result.result.result.value);
      }
    }
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
      expression, returnByValue: true, awaitPromise: true,
    } }));
  });
}
const windowState = (action = 'check') => JSON.parse(execFileSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(import.meta.dirname, 'windows.ps1'), '-AppProcessId', String(app.pid), '-Action', action,
], { encoding: 'utf8', windowsHide: true }));

try {
  const mainTarget = await until(async () => (await list()).find(x => !x.url.includes('tile.html')), 'main WebView');
  const main = await connect(mainTarget);
  const info = await until(async () => {
    const info = await main('({ready: !!document.querySelector("#start")?.onclick, userAgent: navigator.userAgent, generator: typeof MediaStreamTrackGenerator})');
    return info.ready && info;
  }, 'Tauri UI loaded');
  console.log(info);
  await main('document.querySelector("#start").click()');
  let targets;
  try {
    targets = await until(async () => {
      const tiles = (await list()).filter(x => x.url.includes('tile.html'));
      return tiles.length === 3 && tiles.sort((a, b) => a.url.localeCompare(b.url));
    }, 'three floating WebViews');
  } catch (error) {
    console.error(await main('document.querySelector("#status").textContent'));
    throw error;
  }
  const tiles = await Promise.all(targets.map(connect));
  const sample = (tile) => tile(`(() => {
    const video = document.querySelector('video');
    const status = document.querySelector('#status');
    return {
      fps: Number(status.dataset.fps || 0),
      gap: Number(status.dataset.gap || 0),
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
      width: video.videoWidth,
      height: video.videoHeight,
      status: status.textContent,
    };
  })()`);
  try {
    await until(async () => (await Promise.all(tiles.map(sample))).every(x => x.frames > 15), 'three WebRTC videos');
  } catch (error) {
    console.error(await main('document.querySelector("#status").textContent'));
    console.error(await Promise.all(tiles.map(sample)));
    throw error;
  }
  const initial = windowState();
  assert.equal(initial.length, 4);
  const nativeTiles = initial.filter(w => w.tile).sort((a, b) => a.title.localeCompare(b.title));
  assert.equal(nativeTiles.length, 3);
  assert.ok(nativeTiles.every(w => w.topmost && w.resize && !w.minimized));
  const moved = windowState('move').filter(w => w.tile).sort((a, b) => a.title.localeCompare(b.title));
  assert.notDeepEqual(moved[0].bounds, nativeTiles[0].bounds);
  assert.deepEqual(moved.slice(1).map(w => w.bounds), nativeTiles.slice(1).map(w => w.bounds));
  async function measure(label) {
    const reports = [];
    for (let i = 0; i < 4; i += 1) {
      await wait(1150);
      reports.push(await Promise.all(tiles.map(sample)));
    }
    const summary = tiles.map((_, index) => ({
      minFps: Math.min(...reports.map(x => x[index].fps)),
      maxGapMs: Math.max(...reports.map(x => x[index].gap)),
      frames: reports[3][index].frames - reports[0][index].frames,
    }));
    console.log(label, summary);
    assert.ok(reports.flat().every(x => x.width === 640 && x.height === 360));
    assert.ok(summary.every(x => x.minFps >= 24 && x.maxGapMs < 250 && x.frames >= 80));
  }
  await measure('Before minimizing');
  await main('document.querySelector("#minimize").click()');
  await wait(1000);
  const minimized = windowState();
  assert.ok(minimized.find(w => !w.tile).minimized);
  assert.ok(minimized.filter(w => w.tile).every(w => w.topmost && !w.minimized));
  await measure('After minimizing');
  windowState('restore');
  await wait(800);
  assert.equal(windowState().find(w => !w.tile).minimized, false);
  await measure('After restoring');
  await main('document.querySelector("#stop").click()');
  await until(async () => (await list()).filter(x => x.url.includes('tile.html')).length === 0, 'float windows closed');
  await main('document.querySelector("#start").click()');
  await until(async () => (await list()).filter(x => x.url.includes('tile.html')).length === 3, 'float windows reopened');
  console.log('PASS: WebView2, three independent topmost windows, resize, active WebRTC video while minimized, restore, close, reopen');
} finally {
  for (const ws of sockets) ws.close();
  app.kill();
}

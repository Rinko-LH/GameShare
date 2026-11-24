import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';

if (!process.argv[2]) throw new Error('Usage: node apps/tauri/tests/check-client.mjs <gameshare-tauri.exe>');
const exe = path.resolve(process.argv[2]);
const useCloudflare = process.argv.includes('--cloudflare');
const electronArg = process.argv.find((argument) => argument.startsWith('--electron='));
const electronExe = electronArg && path.resolve(electronArg.slice('--electron='.length));
const profiles = path.resolve(import.meta.dirname, '../../../.cache/tauri-client-check', randomUUID());
mkdirSync(profiles, { recursive: true });
const apps = [];
const sockets = [];
const captureTitle = process.argv.includes('--window-capture') ? `GS-Capture-${randomUUID()}` : '';
let captureProcess;
let nextCommand = 0;
let stopping = false;

async function until(check, description, time = 18000) {
  const end = Date.now() + time;
  let lastError;
  while (Date.now() < end) {
    const exit = apps.find(({ process }) => process.exitCode !== null);
    if (!stopping && exit) throw new Error(`Application exited (${exit.process.exitCode}): ${exit.logs}`);
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out: ${description}`, { cause: lastError });
}

async function launch(name, legacy = false) {
  const port = await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
  const profile = path.join(profiles, name);
  const env = legacy
    ? { ...process.env, GAMESHARE_EMBEDDED_SERVER: '0' }
    : { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(legacy ? electronExe : exe, legacy
    ? [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`] : [], {
    env,
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const app = { process: child, logs: '',
    list: async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((entry) => entry.type === 'page'),
  };
  apps.push(app);
  child.stderr.on('data', (data) => { app.logs += data; });
  const target = await until(async () => (await app.list()).find((entry) =>
    (legacy ? entry.url.startsWith('file:') : new URL(entry.url).hostname === 'tauri.localhost') &&
    !entry.url.includes('floatTile=')), `${name} main view`);
  app.evaluate = await attach(target);
  await until(() => app.evaluate(`${legacy ? '!!window.gameShare' : 'window.gameShare?.runtime === "tauri"'} && !!document.querySelector(".connection-panel")`),
    `${name} shared React renderer`);
  return app;
}

async function attach(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return (expression) => new Promise((resolve, reject) => {
    const id = ++nextCommand;
    const timer = setTimeout(() => {
      socket.removeEventListener('message', receive);
      reject(new Error(`CDP timed out: ${expression}`));
    }, 5000);
    function receive(event) {
      const response = JSON.parse(event.data);
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', receive);
      if (response.error || response.result.exceptionDetails) {
        reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
      } else {
        resolve(response.result.result.value);
      }
    }
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    }));
  });
}

const fill = (evaluate, selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
})()`);

const clickText = (evaluate, text) => evaluate(`[...document.querySelectorAll('button')].find(button =>
  button.textContent.trim() === ${JSON.stringify(text)} && button.getClientRects().length).click()`);

let observer;
try {
  if (captureTitle) {
    captureProcess = spawn('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(import.meta.dirname, 'capture-window.ps1'), '-Title', captureTitle,
    ], { stdio: 'ignore', windowsHide: true });
  }
  const host = await launch('host');
  const hostEval = host.evaluate;
  const voice = await hostEval('window.gameShare.voiceHotkey.configure({active:true,binding:{code:"F8",ctrl:false,alt:false,shift:false}})');
  assert.equal(voice.error, null);
  assert.equal(voice.pressed, false);
  const stoppedVoice = await hostEval('window.gameShare.voiceHotkey.configure({active:false,binding:null})');
  assert.ok(stoppedVoice.revision > voice.revision);
  const networks = await hostEval('window.gameShare.server.getStatus()');
  assert.equal(networks.state, 'stopped', 'Test requires a fresh Tauri server');
  let address = networks.lanUrls[0] ?? networks.publicV4Urls[0] ?? networks.publicV6Urls[0];
  assert.ok(address, 'Test requires a non-loopback adapter');
  await fill(hostEval, '[data-signaling]', useCloudflare ? 'cloudflare' : 'ip');
  await fill(hostEval, '[data-media-policy]', 'local-auto');
  if (useCloudflare) {
    // Public smoke tests must never forward to a different instance already on port 8080.
    const local = await hostEval('window.gameShare.server.setEnabled(true)');
    assert.equal(local.state, 'running', 'Public smoke test must own the local test server');
    const tunnel = await hostEval(`(() => {
      window.__tunnelStates = [];
      window.gameShare.tunnel.onStatus(status => window.__tunnelStates.push(status.state));
      return window.gameShare.tunnel.getStatus();
    })()`);
    assert.equal(tunnel.state, 'stopped');
    assert.equal(tunnel.available, true);
  } else {
    await fill(hostEval, '[data-room-address=local]', address);
  }
  await clickText(hostEval, '创建房间');
  let room;
  try {
    room = await until(() => hostEval('document.querySelector(".roomcode__value")?.textContent.trim()'), 'create a room');
  } catch (error) {
    console.error(await hostEval('document.querySelector(".connection-panel [role=alert]")?.textContent'));
    const server = await hostEval('window.gameShare.server.getStatus()');
    console.error({ server, health: await fetch(server.localUrl + '/health').then(res => res.text()).catch(String),
      browser: await hostEval(`fetch(${JSON.stringify(server.localUrl + '/health')}).then(res => res.text()).catch(String)`),
      engine: await fetch(server.localUrl + '/socket.io/?EIO=4&transport=polling').then(res => res.text()).catch(String) });
    throw error;
  }
  assert.match(room, /^[A-Z2-9]{6}$/);
  const status = await hostEval('window.gameShare.server.getStatus()');
  assert.equal(status.state, 'running', 'Test must use the Rust signaling server');
  const health = await (await fetch(status.localUrl + '/health')).json();
  assert.equal(health.service, 'game-share-signaling');
  assert.equal(health.rooms, 1);
  observer = io(status.localUrl, { reconnection: false });
  await new Promise((resolve, reject) => {
    observer.once('connect', resolve);
    observer.once('connect_error', reject);
  });
  const heartbeat = await observer.timeout(3000).emitWithAck('heartbeat', { sentAt: 32 });
  assert.equal(heartbeat.data.sentAt, 32);
  const wrongRoom = await observer.timeout(3000).emitWithAck('join-room', { roomCode: 'bad', nickname: 'observer' });
  assert.equal(wrongRoom.error.code, 'ROOM_NOT_FOUND');

  let invitation;
  if (useCloudflare) {
    let lastDetail;
    const tunnel = await until(async () => {
      const next = await hostEval('window.gameShare.tunnel.getStatus()');
      if (next.detail && next.detail !== lastDetail) {
        lastDetail = next.detail;
        console.log(next.detail);
      }
      return ['running', 'failed'].includes(next.state) && next;
    }, 'Cloudflare downloaded and verified the public origin', 215000);
    if (tunnel.state !== 'running') {
      await hostEval('window.gameShare.tunnel.setEnabled(false)');
      assert.equal(await hostEval('window.gameShare.tunnel.getStatus().then(s => s.state)'), 'stopped');
      throw new Error(tunnel.detail);
    }
    assert.match(tunnel.url, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);
    address = tunnel.url;
    // "running" already means the native client verified the public health endpoint.
    // The guest WebViews below exercise the actual public Socket.IO connection.
    await hostEval(`window.gameShare.clipboard.writeText = async text => { window.__copiedInvite = text; return true; }`);
    await until(async () => {
      try { await clickText(hostEval, '复制邀请'); } catch { return false; }
      return hostEval('!!window.__copiedInvite');
    }, 'copy the public invitation');
    invitation = await hostEval('window.__copiedInvite');
    const encoded = invitation.match(/GS3\.([a-zA-Z0-9+/_=-]+)/)?.[1];
    assert.ok(encoded);
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString());
    assert.equal(decoded.server, address);
    assert.equal(decoded.room, room);
    assert.equal(decoded.signaling, 'cloudflare');
    assert.deepEqual(await hostEval('[...new Set(window.__tunnelStates)]'), ['starting', 'running']);
    console.log('PASS: Cloudflare Quick Tunnel ready, verified health, invitation contains the public address');
  } else {
    invitation = 'GS3.' + Buffer.from(JSON.stringify({
      server: address, room, signaling: 'ip', mediaPolicy: 'local-auto',
    })).toString('base64');
  }
  const guests = [];
  for (let i = 1; i <= 3; i += 1) {
    const guest = await launch(`guest-${i}`, i === 3 && Boolean(electronExe));
    guests.push(guest);
    await fill(guest.evaluate, 'input[placeholder="朋友会看到的名字"]', `Guest ${i}`);
    await guest.evaluate('document.querySelector("input[name=connection-role][value=guest]").click()');
    await fill(guest.evaluate, '[data-invitation]', invitation);
    await clickText(guest.evaluate, '连接并加入');
    await until(() => guest.evaluate(`document.querySelector('.roomcode__value')?.textContent.trim() === ${JSON.stringify(room)}`), `guest ${i} joined room`);
    const useRealCapture = i === 1 && captureTitle;
    if (useRealCapture) console.log(`在 WebView2 选源窗口中选择测试窗口 ${captureTitle}`);
    await clickText(guest.evaluate, useRealCapture ? '选择要共享的窗口或屏幕' : '测试源');
    try {
      await until(() => guest.evaluate('Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "停止共享" && b.getClientRects().length)'),
        `guest ${i} is sharing`, useRealCapture ? 90000 : undefined);
    } catch (error) {
      console.error(await guest.evaluate('Array.from(document.querySelectorAll(".hint--warn")).map(b => b.textContent)'));
      throw error;
    }
    if (useRealCapture) {
      const surfaces = await guest.evaluate(`[...document.querySelectorAll('video')].flatMap(video =>
        video.srcObject?.getVideoTracks().map(track => track.getSettings().displaySurface) ?? [])`);
      assert.ok(surfaces.includes('window'), JSON.stringify(surfaces));
      console.log('PASS: selected Windows test window captured by the real WebView2 API');
    }
  }
  console.log('PASS: Rust server, room creation, GS3 invitation and three remote senders');
  if (electronExe) console.log('PASS: Electron 1.6.2 joined the Tauri room and sent video');
  await hostEval('document.querySelector(".switch--boxed input").click()');
  const windows = await until(async () => {
    const tiles = (await host.list()).filter((entry) => entry.url.includes('floatTile='));
    return tiles.length === 3 && tiles;
  }, 'three independent Tauri float windows');
  const tiles = await Promise.all(windows.map(attach));
  const sample = (tile) => tile(`(() => {
    const video = document.querySelector('video');
    return { frames: video?.getVideoPlaybackQuality().totalVideoFrames ?? 0,
      width: video?.videoWidth ?? 0, name: document.querySelector('.tilewin__name')?.textContent,
      error: document.querySelector('.tilewin__wait')?.textContent };
  })()`);
  try {
    await until(async () => (await Promise.all(tiles.map(sample))).every((tile) => tile.width > 0 && tile.frames > 10), 'all float windows received video');
  } catch (error) {
    console.error(await Promise.all(tiles.map(sample)));
    throw error;
  }
  const before = await Promise.all(tiles.map(sample));
  assert.deepEqual(before.map((tile) => tile.name).sort(), ['Guest 1', 'Guest 2', 'Guest 3']);
  await tiles[0]('document.querySelector(".tilewin__mute").click()');
  await until(() => tiles[0]('document.querySelector(".tilewin__mute").classList.contains("tilewin__mute--on")'), 'float mute updated main state and returned to tile');
  await hostEval('window.gameShare.windowControl.minimize()');
  await sleep(600);
  const start = await Promise.all(tiles.map(sample));
  const period = 2500;
  await sleep(period);
  const end = await Promise.all(tiles.map(sample));
  const fps = end.map((tile, index) => (tile.frames - start[index].frames) * 1000 / period);
  assert.ok(fps.every((rate) => rate >= 15), JSON.stringify(fps));
  console.log('PASS: native float windows, peer identity, mute and continued playback while minimized', fps);
  await clickText(guests[0].evaluate, '停止共享');
  await until(async () => (await host.list()).filter((entry) => entry.url.includes('floatTile=')).length === 2, 'stopping share removed only the matching float window');
  const remaining = (await host.list()).find((entry) => entry.url.includes('floatTile='));
  const float = await attach(remaining);
  await float('document.querySelector(\'.tilewin__bar button[aria-label="关闭"]\').click()');
  await until(async () => (await host.list()).filter((entry) => entry.url.includes('floatTile=')).length === 1, 'close button removed only its own float window');
  await hostEval('window.gameShare.windowMode.setEnabled(false)');
  await until(async () => !(await host.list()).some((entry) => entry.url.includes('floatTile=')), 'disabling float mode closed all float windows');
  console.log('PASS: stopping share, closing one float, and disabling float mode cleaned up the windows');
  if (useCloudflare) {
    await hostEval('window.gameShare.server.setEnabled(false)');
    const stopped = await hostEval('window.gameShare.tunnel.getStatus()');
    assert.equal(stopped.enabled, false);
    assert.equal(stopped.state, 'stopped');
    assert.equal(stopped.url, null);
    console.log('PASS: disabling local signaling closed the Cloudflare tunnel');
  }
} finally {
  stopping = true;
  observer?.disconnect();
  for (const socket of sockets) socket.close();
  for (const app of apps.reverse()) app.process.kill();
  captureProcess?.kill();
}

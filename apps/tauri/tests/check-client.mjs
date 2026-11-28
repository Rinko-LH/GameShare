import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';

if (!process.argv[2]) throw new Error('Usage: node apps/tauri/tests/check-client.mjs <gameshare-tauri.exe>');
const exe = path.resolve(process.argv[2]);
const development = process.argv.includes('--dev');
const captureScreenshots = process.argv.includes('--screenshots');
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
    (legacy ? entry.url.startsWith('file:') : new URL(entry.url).origin ===
      (development ? 'http://127.0.0.1:1420' : 'http://tauri.localhost')) &&
    !entry.url.includes('floatTile=')), `${name} main view`);
  app.evaluate = await attach(target);
  await until(() => app.evaluate(`${legacy ? '!!window.gameShare' : 'window.gameShare?.runtime === "tauri"'} && !!document.querySelector(".connection-panel")`),
    `${name} shared React renderer`);
  return app;
}

async function attach(target) {
  const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextCommand;
    const timer = setTimeout(() => {
      socket.removeEventListener('message', receive);
      reject(new Error(`CDP timed out: ${method}`));
    }, 5000);
    function receive(event) {
      const response = JSON.parse(event.data);
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', receive);
      if (response.error || response.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
      } else {
        resolve(response.result);
      }
    }
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })).result.value;
  evaluate.send = send;
  return evaluate;
}

const fill = (evaluate, selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
})()`);

const clickText = (evaluate, text) => evaluate(`[...document.querySelectorAll('button')].find(button =>
  button.textContent.trim() === ${JSON.stringify(text)} && button.getClientRects().length).click()`);

const viewer = '[data-share-viewer]';
const previewToggle = '[data-local-preview-toggle]';
const previewVideo = '#local-share-preview[open] video';
const control = (action) => `[data-viewer-action="${action}"]`;
const peerSelector = (peerId) => `[data-viewer-peer="${peerId}"]`;
const query = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const click = (evaluate, selector) => evaluate(`(() => {
  const button = ${query(selector)};
  if (!button) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
  if (button.disabled) throw new Error('Disabled control: ' + ${JSON.stringify(selector)});
  button.click();
})()`);
async function clickScreenPoint(evaluate, selector) {
  await evaluate.send('Page.bringToFront');
  const { x, y } = await evaluate(`(() => {
    const button = ${query(selector)};
    if (!button || button.disabled) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)});
    const { x, y, width, height } = button.getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  })()`);
  await evaluate.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await evaluate.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function pressKey(evaluate, key, windowsVirtualKeyCode) {
  const params = { key, code: key, windowsVirtualKeyCode };
  await evaluate.send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' });
  await evaluate.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
}
async function hover(evaluate, selector) {
  const point = await evaluate(`(() => {
    const { x, y, width, height } = ${query(selector)}.getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  })()`);
  await evaluate.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
}
const openVolume = (channel) => `.hover-volume__panel:popover-open [data-volume-channel="${channel}"]`;
const peerNamed = (evaluate, name) => evaluate(`[...document.querySelectorAll('[data-viewer-peer]')]
  .find(element => element.textContent.includes(${JSON.stringify(name)}))?.dataset.viewerPeer`);
const selectedPeer = (evaluate) => evaluate(`${query(`${viewer} [data-focused="true"]`)}?.dataset.viewerPeer`);
const decodedShares = (evaluate) => evaluate(`[...document.querySelectorAll('${viewer} video')]
  .filter(video => video.videoWidth > 0).length`);
const audioSelector = (peerId, role) => `audio[data-audio-peer="${peerId}"][data-audio-role="${role}"]`;
const audioMuted = (evaluate, peerId, role) => evaluate(`${query(audioSelector(peerId, role))}?.muted`);
const audioVolume = (evaluate, peerId, role) => evaluate(`${query(audioSelector(peerId, role))}?.volume`);
const floatSpeakingName = (evaluate) => evaluate(`${query('.tilewin__speakers')}?.textContent.trim() ?? ''`);
const peerSpeaking = (evaluate, peer) => evaluate(`Boolean(${query(`${peer} .speaking-mark[data-active="true"]`)})`);
const setMicGain = (evaluate, value) => evaluate(`window.__viewerTestMic.gain.gain.value = ${value}`);
const setSyntheticMic = (evaluate) => evaluate(`(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    tone.frequency.value = 660;
    gain.gain.value = 0.002;
    tone.connect(gain).connect(destination);
    tone.start();
    window.__viewerTestMic = { context, tone, gain, track: destination.stream.getAudioTracks()[0] };
    return destination.stream;
  };
})()`);

async function screenshot(evaluate, name) {
  if (!captureScreenshots) return;
  const result = await evaluate.send('Page.captureScreenshot');
  const file = path.join(profiles, `${name}.png`);
  writeFileSync(file, Buffer.from(result.data, 'base64'));
  console.log(`Screenshot: ${file}`);
}

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
  await hostEval(`(() => {
    const connections = new Set();
    const setDescription = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function (...args) {
      connections.add(this);
      return setDescription.apply(this, args);
    };
    window.__shareReception = async (peerId) => {
      const voice = [...document.querySelectorAll('audio[data-audio-role="voice"]')]
        .find(audio => audio.dataset.audioPeer === peerId)?.srcObject?.getAudioTracks()[0];
      const pc = [...connections].find(link => link.getReceivers().some(receiver => receiver.track === voice));
      if (!pc) return null;
      const stats = [...(await pc.getStats()).values()];
      return pc.getTransceivers().slice(0, 3).map(({ currentDirection, receiver }) => ({
        currentDirection,
        bytes: stats.find(report => report.type === 'inbound-rtp' && report.trackIdentifier === receiver.track.id)?.bytesReceived ?? 0,
      }));
    };
  })()`);
  assert.equal(await hostEval('document.querySelector("#sidebar-page-room").textContent.includes("高级设置")'), false);
  assert.deepEqual(await hostEval('[...document.querySelectorAll("[data-video-quality-preset]")].map(node => node.textContent.trim())'), ['流畅', '标清', '高清']);
  assert.equal(await hostEval('document.querySelector("[data-video-quality-auto]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await hostEval('document.querySelector("[data-video-quality]").dataset.videoQuality'), 'auto');
  const voice = await hostEval('window.gameShare.voiceHotkey.configure({active:true,binding:{code:"F8",ctrl:false,alt:false,shift:false}})');
  assert.equal(voice.error, null);
  assert.equal(voice.pressed, false);
  const stoppedVoice = await hostEval('window.gameShare.voiceHotkey.configure({active:false,binding:null})');
  assert.ok(stoppedVoice.revision > voice.revision);
  const networks = await hostEval('window.gameShare.server.getStatus()');
  assert.equal(networks.state, 'stopped', 'Test requires a fresh Tauri server');
  let address = networks.lanUrls[0] ?? networks.publicV4Urls[0] ?? networks.publicV6Urls[0];
  assert.ok(address, 'Test requires a non-loopback adapter');
  await click(hostEval, `[data-signaling="${useCloudflare ? 'cloudflare' : 'ip'}"]`);
  await click(hostEval, '[data-media-policy="internet-auto"]');
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
  assert.equal(await hostEval('document.querySelector(".connection-config-form")'), null, 'Room setup must be hidden after joining');
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

  await hostEval(`window.gameShare.clipboard.writeText = async text => { window.__copiedInvite = text; return true; }`);
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
    assert.deepEqual(await hostEval('[...new Set(window.__tunnelStates)]'), ['starting', 'running']);
    console.log('PASS: Cloudflare Quick Tunnel ready, verified health');
  }
  await until(async () => {
    try { await clickText(hostEval, '复制邀请'); } catch { return false; }
    return hostEval('!!window.__copiedInvite');
  }, 'copy the room invitation');
  const invitation = await hostEval('window.__copiedInvite');
  const encoded = invitation.match(/GS3\.([a-zA-Z0-9+/_=-]+)/)?.[1];
  assert.ok(encoded);
  const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString());
  assert.equal(decoded.server, address);
  assert.equal(decoded.room, room);
  assert.equal(decoded.signaling, useCloudflare ? 'cloudflare' : 'ip');
  const guests = [];
  let firstPeerId;
  let secondPeerId;
  for (let i = 1; i <= 3; i += 1) {
    const legacy = i === 3 && Boolean(electronExe);
    const guest = await launch(`guest-${i}`, legacy);
    guests.push(guest);
    await fill(guest.evaluate, legacy ? 'input[placeholder="朋友会看到的名字"]' : 'input[name=nickname]', `Guest ${i}`);
    await guest.evaluate('document.querySelector("input[name=connection-role][value=guest]").click()');
    if (!legacy) {
      assert.equal(await guest.evaluate('Boolean(document.querySelector(".connection-manual [data-join-address]"))'), true);
      assert.equal(await guest.evaluate('Boolean(document.querySelector(".connection-manual [data-signaling]"))'), false);
    }
    const savedConfig = await guest.evaluate('localStorage.getItem("gs.connectionConfig")');
    await fill(guest.evaluate, '[data-invitation]', invitation);
    if (legacy) await clickText(guest.evaluate, '连接并加入');
    else {
      assert.equal(await guest.evaluate('Boolean(document.querySelector(".connection-network, .connection-manual"))'), false);
      assert.equal(await guest.evaluate('localStorage.getItem("gs.connectionConfig")'), savedConfig);
      await guest.evaluate('document.querySelector(".connection-submit").click()');
    }
    await until(() => guest.evaluate(`document.querySelector('.roomcode__value')?.textContent.trim() === ${JSON.stringify(room)}`), `guest ${i} joined room`);
    if (!legacy) assert.equal(await guest.evaluate('localStorage.getItem("gs.connectionConfig")'), savedConfig);
    if (i === 2) {
      secondPeerId = await until(() => peerNamed(hostEval, 'Guest 2'), 'voice-only member has local audio controls');
      const secondPeer = peerSelector(secondPeerId);
      await setSyntheticMic(guest.evaluate);
      await click(guest.evaluate, '[data-voice-mode="continuous"]');
      await click(guest.evaluate, '[data-voice-enable]');
      await until(() => guest.evaluate('window.__viewerTestMic?.track.enabled && document.querySelector("[data-mic-enabled=true]") !== null'), 'voice-only member transmits');
      await until(async () => await audioMuted(hostEval, secondPeerId, 'voice') === false, 'new member voice is audible');
      assert.equal(await peerSpeaking(hostEval, secondPeer), false, 'An open but quiet microphone does not show a speaker');
      await setMicGain(guest.evaluate, 0.075);
      await until(() => peerSpeaking(hostEval, secondPeer), 'a voice-only member is identified in the roster');
      await until(() => peerSpeaking(guest.evaluate, '.member__name:has(.member__self)'), 'the sender’s room entry identifies their speaking status');
      await click(hostEval, `${secondPeer} ${control('voice')}`);
      await until(() => audioMuted(hostEval, secondPeerId, 'voice'), 'voice-only member can be locally muted');
      assert.equal(await peerSpeaking(hostEval, secondPeer), true, 'Local playback mute preserves incoming activity');
      await click(hostEval, `${secondPeer} ${control('voice')}`);
      await until(async () => await audioMuted(hostEval, secondPeerId, 'voice') === false, 'voice-only member can be locally unmuted');
      await setMicGain(guest.evaluate, 0.002);
      await until(async () => !await peerSpeaking(hostEval, secondPeer), 'the speaking indicator clears after silence');
      assert.equal(await hostEval(`${query(secondPeer)}.querySelectorAll('button').length`), 2, 'Voice-only member has only mic and speaker buttons');
      assert.equal(await hostEval(`Boolean(${query(openVolume('voice'))})`), false, 'Volume controls start hidden');
      await hover(hostEval, `${secondPeer} ${control('voice')}`);
      await until(() => hostEval(`Boolean(${query(openVolume('voice'))})`), 'voice volume opens on icon hover');
      await hover(hostEval, openVolume('voice'));
      await fill(hostEval, openVolume('voice'), '35');
      await until(async () => await audioVolume(hostEval, secondPeerId, 'voice') === 0.35, 'voice slider updates playback');
      await hover(hostEval, '.share-viewer__toolbar');
      await until(() => hostEval(`!${query(openVolume('voice'))}`), 'voice slider closes on pointer leave');
    }
    const useRealCapture = i === 1 && captureTitle;
    const testVideoScaling = i === 1 && !useRealCapture;
    if (testVideoScaling || i === 2) {
      await guest.evaluate(`(() => {
        const captureStream = HTMLCanvasElement.prototype.captureStream;
        HTMLCanvasElement.prototype.captureStream = function (...args) {
          if (this.width !== 640 || this.height !== 360) return captureStream.apply(this, args);
          // The first guest needs a larger source for downscaling. The second guest tests the audio controls.
          if (${testVideoScaling}) {
            this.width = 1280;
            this.height = 720;
          }
          const stream = captureStream.apply(this, args);
          // Supply an audio fixture for the shared-audio control checks.
          const context = new AudioContext();
          const tone = context.createOscillator();
          const gain = context.createGain();
          const destination = context.createMediaStreamDestination();
          gain.gain.value = 0.002;
          tone.connect(gain).connect(destination);
          tone.start();
          void context.resume();
          stream.addTrack(destination.stream.getAudioTracks()[0]);
          return stream;
        };
      })()`);
    }
    if (testVideoScaling) {
      await guest.evaluate(`(() => {
        const setParameters = RTCRtpSender.prototype.setParameters;
        window.__videoEncodings = new Map();
        RTCRtpSender.prototype.setParameters = async function (parameters) {
          await setParameters.call(this, parameters);
          const encoding = parameters.encodings[0];
          if (this.track?.kind === 'video' && encoding) {
            window.__videoEncoding = encoding;
            window.__videoEncodings.set(this, encoding);
          }
        };
      })()`);
      await guest.evaluate('document.querySelector("[data-video-quality-preset=smooth]").click()');
      assert.equal(await guest.evaluate('document.querySelector("[data-video-quality-preset=smooth]").getAttribute("aria-pressed")'), 'true');
    }
    if (useRealCapture) console.log(`在 WebView2 选源窗口中选择测试窗口 ${captureTitle}`);
    await clickText(guest.evaluate, useRealCapture ? '选择窗口或屏幕' : '测试源');
    try {
      await until(() => guest.evaluate('Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "停止共享" && b.getClientRects().length)'),
        `guest ${i} is sharing`, useRealCapture ? 90000 : undefined);
    } catch (error) {
      console.error(await guest.evaluate('Array.from(document.querySelectorAll(".hint--warn")).map(b => b.textContent)'));
      throw error;
    }
    if (testVideoScaling) {
      const smooth = await until(() => guest.evaluate('window.__videoEncoding?.scaleResolutionDownBy === 2 && window.__videoEncoding'), 'apply Smooth video encoding');
      await guest.evaluate('document.querySelector("[data-video-quality-preset=standard]").click()');
      const standard = await until(() => guest.evaluate('window.__videoEncoding?.maxBitrate === 1500000 && window.__videoEncoding'), 'apply SD video encoding');
      assert.ok(standard.scaleResolutionDownBy > 1 && standard.scaleResolutionDownBy < smooth.scaleResolutionDownBy);
      await guest.evaluate('document.querySelector("[data-video-quality-auto]").click()');
      const automatic = await until(() => guest.evaluate('window.__videoEncoding?.maxBitrate === 2000000 && window.__videoEncoding'), 'apply Auto video encoding');
      assert.equal(automatic.scaleResolutionDownBy, 1);
      await guest.evaluate('document.querySelector("[data-video-quality-preset=hd]").click()');
      const hd = await until(() => guest.evaluate('window.__videoEncoding?.maxBitrate === 4000000 && window.__videoEncoding'), 'apply HD video encoding');
      assert.equal(hd.scaleResolutionDownBy, 1);
      assert.equal(hd.maxFramerate, smooth.maxFramerate);
      assert.equal(await guest.evaluate('localStorage.getItem("gs.videoQuality")'), 'hd');
      console.log('PASS: quality controls update live scaling and bitrate while keeping frame rate');
    }
    if (i === 1) {
      assert.equal(await guest.evaluate(`document.querySelectorAll('${viewer} video, #local-share-preview video').length`), 0,
        'A local share stays out of the remote viewer and the closed preview');
      await clickScreenPoint(guest.evaluate, previewToggle);
      await until(() => guest.evaluate(`${query(previewVideo)}?.videoWidth > 0`), 'standalone local preview displays live video');
      assert.equal(await guest.evaluate(`${query(previewVideo)}.muted`), true);
      if (useRealCapture) {
        assert.equal(await guest.evaluate(`${query(previewVideo)}.srcObject.getVideoTracks()[0].getSettings().displaySurface`), 'window');
        console.log('PASS: selected Windows test window captured by the real WebView2 API');
      }
      if (useRealCapture) await screenshot(guest.evaluate, 'local-window-capture');
      await pressKey(guest.evaluate, 'Escape', 27);
      await until(() => guest.evaluate(`!${query('#local-share-preview video')} && document.activeElement === ${query(previewToggle)}`),
        'Escape closes preview, removes video and returns focus to its entry');
      console.log('PASS: local preview opens separately and returns focus without stopping sharing');
      firstPeerId = await until(() => peerNamed(hostEval, 'Guest 1'), 'first shared video appears in viewer');
      await until(async () => await selectedPeer(hostEval) === firstPeerId, 'first share is focused by default');
      assert.equal(await hostEval(`${query(viewer)}.dataset.layout`), 'focus');
    }
    if (i === 2) {
      await until(async () => await decodedShares(guest.evaluate) === 1, 'only the other shared screen is visible while sharing');
      assert.equal(await selectedPeer(guest.evaluate), firstPeerId);
      await clickScreenPoint(guest.evaluate, previewToggle);
      await until(() => guest.evaluate(`${query(previewVideo)}?.videoWidth > 0`), 'local preview is available alongside a remote share');
      await screenshot(guest.evaluate, 'local-preview');
      await click(guest.evaluate, '#local-share-preview button[type="submit"]');
      await until(() => guest.evaluate(`!${query(previewVideo)}`), 'close button dismisses local preview');
      assert.equal(await selectedPeer(guest.evaluate), firstPeerId, 'Local preview must preserve the selected remote view');
    }
  }
  console.log('PASS: Rust server, room creation, GS3 invitation and three remote senders');
  if (electronExe) console.log('PASS: Electron 1.6.2 joined the Tauri room and sent video');
  const secondPeer = peerSelector(secondPeerId);
  const voiceControl = `${secondPeer} ${control('voice')}`;
  const shareAudioControl = `${secondPeer} ${control('share-audio')}`;
  const pictureControl = `${secondPeer} ${control('picture')}`;
  const fullscreenControl = control('fullscreen');
  const statsControl = control('show-stats');
  const viewerStatsCount = () => hostEval(`document.querySelectorAll('${viewer} .tile__footer').length`);
  await until(async () => await decodedShares(hostEval) === 3, 'all three shares decoded in the main viewer');
  assert.equal(await selectedPeer(hostEval), firstPeerId, 'New shares must preserve current focus');
  const firstSender = guests[0].evaluate;
  const firstSenderHasThumbnailLinks = (count) => firstSender(`(() => {
    const encodings = [...window.__videoEncodings.values()];
    const thumbnails = encodings.filter(encoding => encoding.maxBitrate === 200000 &&
      encoding.maxFramerate === 10 && encoding.scaleResolutionDownBy === 4);
    const normal = encodings.filter(encoding => encoding.maxBitrate === 4000000 && encoding.scaleResolutionDownBy === 1);
    return encodings.length === 3 && thumbnails.length === ${count} && normal.length === ${3 - count};
  })()`);
  if (!captureTitle) await until(() => firstSenderHasThumbnailLinks(0), 'viewers see the first sender at normal quality');
  await click(hostEval, control('layout-grid'));
  assert.equal(await hostEval(`${query(viewer)}.dataset.layout`), 'grid');
  await until(async () => await decodedShares(hostEval) === 3, 'grid displays all live shares');
  assert.equal(await viewerStatsCount(), 0, 'Stream stats are hidden by default');
  await click(hostEval, statsControl);
  await until(async () => await viewerStatsCount() === 3, 'one switch shows stats for every grid tile');
  await screenshot(hostEval, 'viewer-grid');
  await clickScreenPoint(hostEval, `${secondPeer} .share-viewer__picture ${control('focus')}`);
  assert.equal(await hostEval(`${query(viewer)}.dataset.layout`), 'focus');
  assert.equal(await selectedPeer(hostEval), secondPeerId);
  await until(async () => await decodedShares(hostEval) === 3, 'focus layout keeps all live shares accessible');
  if (!captureTitle) {
    await until(() => firstSenderHasThumbnailLinks(1), 'only the viewer using a thumbnail receives the lower limits');
    await click(hostEval, control('layout-grid'));
    await until(() => firstSenderHasThumbnailLinks(0), 'grid restores the previous thumbnail to sender quality');
    await click(hostEval, control('layout-focus'));
    await until(() => firstSenderHasThumbnailLinks(1), 'returning to focus reapplies the thumbnail limits');
  }
  await screenshot(hostEval, 'viewer-focus');
  await until(async () => await audioMuted(hostEval, secondPeerId, 'share') === false, 'shared audio is playing alongside voice');

  await click(hostEval, voiceControl);
  await until(() => audioMuted(hostEval, secondPeerId, 'voice'), 'mic icon mutes one received voice');
  assert.equal(await audioMuted(hostEval, secondPeerId, 'share'), false);
  await click(hostEval, shareAudioControl);
  await until(() => audioMuted(hostEval, secondPeerId, 'share'), 'speaker icon mutes one received shared audio');
  await click(hostEval, shareAudioControl);
  await until(async () => await audioMuted(hostEval, secondPeerId, 'share') === false, 'speaker icon can restore shared audio');
  assert.equal(await audioMuted(guests[0].evaluate, secondPeerId, 'voice'), false, 'Other listeners must still hear the sender');
  assert.equal(await guests[1].evaluate('window.__viewerTestMic.track.enabled'), true, 'The sender must stay unmuted');

  const shareReception = () => hostEval(`window.__shareReception(${JSON.stringify(secondPeerId)})`);
  await until(async () => (await shareReception())?.every(({ bytes }) => bytes > 0), 'three incoming RTP streams transmit before pause');
  await click(hostEval, pictureControl);
  await until(() => hostEval(`Boolean(${query(`${secondPeer} [data-viewer-picture-hidden]`)})`), 'selected share is locally paused');
  await until(async () => {
    const [video, voice, share] = await shareReception();
    return video.currentDirection === 'sendonly' && voice.currentDirection === 'sendrecv' && share.currentDirection === 'sendonly';
  }, 'video and share audio stop arriving over WebRTC');
  assert.equal(await audioMuted(hostEval, secondPeerId, 'share'), true);
  const earlier = await shareReception();
  await sleep(1200);
  const later = await shareReception();
  assert.equal(later[0].bytes, earlier[0].bytes, 'Paused video RTP bytes must stop growing');
  assert.equal(later[2].bytes, earlier[2].bytes, 'Paused share audio RTP bytes must stop growing');
  assert.ok(later[1].bytes > earlier[1].bytes, 'Voice RTP bytes must still grow');
  assert.equal(await audioMuted(guests[0].evaluate, secondPeerId, 'share'), false, 'Other viewers keep their share audio');
  await click(hostEval, pictureControl);
  await until(async () => {
    const streams = await shareReception();
    return streams.every(({ currentDirection }) => currentDirection === 'sendrecv') &&
      streams[0].bytes > later[0].bytes && streams[2].bytes > later[2].bytes;
  }, 'incoming video and share audio resume');
  await until(() => hostEval(`${query(`${secondPeer} video`)}?.videoWidth > 0`), 'restored share shows live video');

  await until(async () => await audioMuted(hostEval, secondPeerId, 'share') === false, 'resuming reception restores previously enabled shared audio');
  assert.equal(await audioMuted(hostEval, secondPeerId, 'voice'), true, 'Resuming reception must preserve the voice mute');
  await click(hostEval, voiceControl);
  await until(async () => await audioMuted(hostEval, secondPeerId, 'voice') === false, 'restore voice');

  const normalBounds = await hostEval('[innerWidth, innerHeight]');
  await clickScreenPoint(hostEval, fullscreenControl);
  try {
    await until(() => hostEval(`document.fullscreenElement?.contains(${query(viewer)}) &&
      Math.abs(innerWidth - screen.width) <= 2 && Math.abs(innerHeight - screen.height) <= 2`), 'viewer enters native monitor fullscreen');
  } catch (error) {
    console.error('Fullscreen diagnostics:', normalBounds, await hostEval(`({
      fullscreen: document.fullscreenElement?.className,
      area: [innerWidth, innerHeight], outer: [outerWidth, outerHeight],
      screen: [screen.width, screen.height], visible: document.visibilityState,
      error: document.querySelector('.share-viewer__error')?.textContent,
    })`));
    throw error;
  }
  if (!captureTitle) await until(() => firstSenderHasThumbnailLinks(1), 'fullscreen focus keeps the thumbnail limits');
  await until(() => hostEval(`${query('.share-viewer__toolbar')}.getClientRects().length === 0`), 'fullscreen hides the viewer toolbar');
  assert.equal(await viewerStatsCount(), 1, 'Fullscreen honors the stats switch without adding stats to thumbnails');
  await screenshot(hostEval, 'viewer-fullscreen');
  await pressKey(hostEval, 'Escape', 27);
  await until(() => hostEval(`document.fullscreenElement === null &&
    innerWidth === ${normalBounds[0]} && innerHeight === ${normalBounds[1]} &&
    ${query('.share-viewer__toolbar')}.getClientRects().length > 0`), 'Escape restores the normal window and toolbar');
  assert.equal(await selectedPeer(hostEval), secondPeerId, 'Fullscreen round trip must preserve selection');
  await click(hostEval, statsControl);
  await until(async () => await viewerStatsCount() === 0, 'the stats switch hides the footer again');
  console.log('PASS: layouts, fullscreen, local mutes, and incoming share RTP pause with voice retained');

  const floatWindows = async () => (await host.list()).filter((entry) => entry.url.includes('floatTile='));
  const openFloats = async () => {
    await click(hostEval, control('float'));
    const windows = await until(async () => {
      const tiles = await floatWindows();
      return tiles.length === 3 && tiles;
    }, 'three independent Tauri float windows');
    return Promise.all(windows.map(attach));
  };
  await setMicGain(guests[1].evaluate, 0.075);
  await until(() => peerSpeaking(hostEval, `${secondPeer} .share-viewer__card-chrome`), 'the sharing speaker is identified in the card title');
  assert.equal(await hostEval(`Boolean(${query('[data-speaking-players]')})`), false, 'The main viewer does not show a second speaker badge over the picture');
  let tiles = await openFloats();
  if (!captureTitle) await until(() => firstSenderHasThumbnailLinks(0), 'independent floats restore sender quality');
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
  const secondTile = tiles[before.findIndex((tile) => tile.name === 'Guest 2')];
  const floatControl = (action) => `[data-float-action="${action}"]`;
  const leaveFloat = () => secondTile.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -5, y: -5 });
  const floatControlsVisible = (visible) => secondTile(`
    ['.tilewin__header', '.tilewin__settings', '.tilewin__grip'].every(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return Number(style.opacity) === ${visible ? 1 : 0} && style.pointerEvents === '${visible ? 'auto' : 'none'}';
    })`);
  await leaveFloat();
  await until(() => floatControlsVisible(false), 'float controls start hidden with pointer outside');
  await until(async () => (await Promise.all(tiles.map(floatSpeakingName)))
    .every((name, index) => name === (before[index].name === 'Guest 2' ? 'Guest 2' : '')),
    'only the speaker’s float shows their name with controls hidden');
  await secondTile.send('Page.bringToFront');
  await pressKey(secondTile, 'Tab', 9);
  await until(() => floatControlsVisible(true), 'keyboard focus reveals float controls');
  await secondTile('document.activeElement.blur()');
  await until(() => floatControlsVisible(false), 'float controls hide again after keyboard blur');
  await hover(secondTile, '.tilewin__video');
  await until(() => floatControlsVisible(true), 'entering the float reveals its controls');
  await hover(secondTile, floatControl('share-audio'));
  await until(() => secondTile(`Boolean(${query(openVolume('share'))})`), 'float speaker opens its slider');
  await hover(secondTile, openVolume('share'));
  await fill(secondTile, openVolume('share'), '65');
  await until(async () => await audioVolume(hostEval, secondPeerId, 'share') === 0.65, 'float speaker slider changes shared audio');
  assert.equal(await audioVolume(hostEval, secondPeerId, 'voice'), 0.35, 'Float speaker slider preserves voice volume');
  await leaveFloat();
  await until(async () => await floatControlsVisible(false) && await secondTile(`!${query(openVolume('share'))}`),
    'moving directly out of the float closes its volume popover and controls');
  await hover(secondTile, '[data-float-opacity]');
  await until(() => floatControlsVisible(true), 're-entering the float reveals its controls');
  await clickScreenPoint(secondTile, '[data-float-opacity]');
  await leaveFloat();
  await until(() => floatControlsVisible(false), 'float controls hide on leave after a pointer click');
  await hover(secondTile, '.tilewin__video');
  await until(() => floatControlsVisible(true), 'float controls reappear when the pointer returns');
  await click(secondTile, floatControl('share-audio'));
  await until(() => audioMuted(hostEval, secondPeerId, 'share'), 'float speaker button mutes the main window playback');
  assert.equal(await audioMuted(hostEval, secondPeerId, 'voice'), false);
  await click(secondTile, floatControl('voice'));
  await until(() => audioMuted(hostEval, secondPeerId, 'voice'), 'float mic button mutes the main window voice playback');
  await click(secondTile, floatControl('picture'));
  await until(async () => (await shareReception())[0].currentDirection === 'sendonly' &&
    await secondTile('document.querySelector(".tilewin__video").hidden'), 'floating control pauses incoming video');
  const hiddenFrames = (await sample(secondTile)).frames;
  await click(secondTile, floatControl('picture'));
  await until(async () => (await shareReception())[2].currentDirection === 'sendrecv' &&
    await secondTile('!document.querySelector(".tilewin__video").hidden'), 'floating control restores incoming share audio and video');
  await until(async () => (await sample(secondTile)).frames > hiddenFrames, 'restored float picture resumes live frames');
  assert.equal(await audioMuted(hostEval, secondPeerId, 'share'), true, 'Resuming must preserve the earlier share audio mute');
  await click(secondTile, floatControl('share-audio'));
  await click(secondTile, floatControl('voice'));
  const opacitySlider = '[data-float-opacity]';
  const opacityIs = (value) => Promise.all(tiles.map((tile) => tile(`
    Number(${query(opacitySlider)}.value) === ${value} &&
    Number(getComputedStyle(document.querySelector('.tilewin__video')).opacity) === ${value / 100} &&
    Number(getComputedStyle(document.querySelector('.tilewin')).opacity) === 1
  `))).then((matches) => matches.every(Boolean));
  await fill(hostEval, control('opacity'), '65');
  await until(() => opacityIs(65), 'main opacity slider is live across all floating windows');
  await secondTile(`${query(opacitySlider)}.focus()`);
  await pressKey(secondTile, 'ArrowRight', 39);
  await until(() => opacityIs(70), 'float opacity is keyboard-adjustable and syncs all video surfaces');
  await screenshot(secondTile, 'float-opacity');

  await clickScreenPoint(hostEval, fullscreenControl);
  await until(async () => (await floatWindows()).length === 0 && await hostEval('Boolean(document.fullscreenElement)'), 'entering fullscreen closes independent floats');
  await pressKey(hostEval, 'Escape', 27);
  await until(() => hostEval('document.fullscreenElement === null'), 'Escape exits fullscreen after float mode');
  assert.equal(await selectedPeer(hostEval), secondPeerId);
  tiles = await openFloats();
  await until(() => opacityIs(70), 'opacity is preserved after reopening float mode');
  await until(async () => (await Promise.all(tiles.map(sample))).every((tile) => tile.width > 0 && tile.frames > 10), 'reopened floats contain live video');
  console.log('PASS: floating controls update local playback, keyboard opacity syncs live, and switching to fullscreen closes floats');

  await hostEval('window.gameShare.windowControl.minimize()');
  await sleep(600);
  const start = await Promise.all(tiles.map(sample));
  const period = 2500;
  await sleep(period);
  const end = await Promise.all(tiles.map(sample));
  const fps = end.map((tile, index) => (tile.frames - start[index].frames) * 1000 / period);
  assert.ok(fps.every((rate) => rate >= 15), JSON.stringify(fps));
  console.log('PASS: native float windows, peer identity, mute and continued playback while minimized', fps);
  await click(guests[0].evaluate, previewToggle);
  await until(() => guests[0].evaluate(`${query(previewVideo)}?.videoWidth > 0`), 'local preview opened before capture ends');
  await clickText(guests[0].evaluate, '停止共享');
  await until(() => guests[0].evaluate(`!${query('#local-share-preview[open]')} && !${query(previewToggle)}`),
    'ending the share closes the preview and removes its entry');
  await until(async () => (await host.list()).filter((entry) => entry.url.includes('floatTile=')).length === 2, 'stopping share removed only the matching float window');
  const liveFloats = await Promise.all((await floatWindows()).map(attach));
  const floatNames = (await Promise.all(liveFloats.map(sample))).map((tile) => tile.name);
  const float = liveFloats[0];
  await setSyntheticMic(guests[0].evaluate);
  await click(guests[0].evaluate, '[data-voice-mode="continuous"]');
  await click(guests[0].evaluate, '[data-voice-enable]');
  await until(() => guests[0].evaluate('window.__viewerTestMic?.track.enabled'), 'the participant without a float transmits voice');
  await setMicGain(guests[0].evaluate, 0.075);
  await until(() => hostEval(`[...document.querySelectorAll('[data-viewer-peer][data-speaking=true]')].some(element => element.textContent.includes('Guest 1'))`),
    'the room detects the voice-only member speaking');
  assert.deepEqual(await Promise.all(liveFloats.map(floatSpeakingName)), floatNames.map((name) => name === 'Guest 2' ? name : ''),
    'a voice-only member is never shown on other members’ floats');
  await setMicGain(guests[1].evaluate, 0);
  await until(async () => (await Promise.all(liveFloats.map(floatSpeakingName))).every((name) => name === ''),
    'floats clear activity when their own members stop speaking');
  await setMicGain(guests[0].evaluate, 0);
  await float('document.querySelector(\'.tilewin__bar button[aria-label="关闭"]\').click()');
  await until(async () => (await host.list()).filter((entry) => entry.url.includes('floatTile=')).length === 1, 'close button removed only its own float window');
  await hostEval(`window.gameShare.floatTiles.onStatus(status => { window.__viewerTestFloatStatus = status; });`);
  await click(hostEval, voiceControl);
  const updatedFloats = await until(() => hostEval('window.__viewerTestFloatStatus'), 'member mute resynchronized floating windows');
  assert.equal(updatedFloats.tiles.length, 1, 'Changing member mute must keep a manually closed float dismissed');
  assert.equal((await floatWindows()).length, 1, 'Changing member mute must keep a manually closed float dismissed');
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

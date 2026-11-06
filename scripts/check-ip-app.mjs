/** Exercise the shipped renderer and preload through a loopback-only debugging port. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.cache', 'ip-app');
fs.mkdirSync(output, { recursive: true });
const fromSource = process.argv.includes('--source');
const exe = fromSource ? createRequire(import.meta.url)('electron') : path.resolve(root, process.argv[2] ?? 'apps/desktop/release/win-unpacked/GameShare.exe');
const port = await new Promise((resolve) => {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1', () => { const p = listener.address().port; listener.close(() => resolve(p)); });
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [...(fromSource ? [path.join(root, 'apps/desktop')] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(output, 'profile')}`], {
  cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk; });
child.stderr.on('data', (chunk) => { logs += chunk; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value; } catch { /* wait for startup */ }
    await sleep(200);
  }
  throw new Error(message);
}
let ws;
let host;
let visitor;
try {
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
  }, 'Packaged renderer did not load');
  ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data);
    const callback = pending.get(result.id);
    if (callback) { pending.delete(result.id); callback(result); }
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
      pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `window.__testPCs = []; const BasePC = window.RTCPeerConnection; window.RTCPeerConnection = class extends BasePC { constructor(config) { super(config); window.__testPCs.push(this); } };` });
  await evaluate('localStorage.removeItem("gs.connectionConfig"); localStorage.removeItem("gs.connectionMode"); localStorage.removeItem("gs.videoBitrateLimit"); localStorage.removeItem("gs.videoResolution"); location.reload(); true');
  await until(() => evaluate('Array.isArray(window.__testPCs) && Boolean(document.querySelector(".connection-panel"))'), 'Unified connection page missing');
  assert.equal(await evaluate('Boolean(document.querySelector(".mode-chooser, .mode-card"))'), false);
  assert.equal(await evaluate('document.querySelector("[data-signaling]").options.length'), 3);
  assert.equal(await evaluate('document.querySelector("[data-media-policy]").options.length'), 3);
  assert.equal(await evaluate('document.querySelector("[data-signaling]").value'), 'cloudflare');
  assert.equal(await evaluate('document.querySelector("[data-media-policy]").value'), 'internet-auto');
  fs.writeFileSync(path.join(output, 'unified-host.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  async function fill(selector, value) {
    await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  }
  async function role(value) {
    await evaluate(`document.querySelector('input[name="connection-role"][value="${value}"]').click()`);
  }
  async function submit() { await evaluate('document.querySelector(".connection-config-form").requestSubmit()'); }
  async function leave() {
    await evaluate('document.querySelector("#sidebar-tab-room").click()');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.textContent.trim())).click()');
    await until(() => evaluate('!document.querySelector(".roomcode__value")'), 'Room not left');
  }
  async function selectConfig(signaling, mediaPolicy) {
    await fill('[data-signaling]', signaling); await fill('[data-media-policy]', mediaPolicy);
  }
  const status = await evaluate('window.gameShare.server.getStatus()');
  const mediaIp = status.mediaAddresses.find(item => item.family === 'IPv4')?.address ?? status.mediaAddresses[0]?.address;
  assert.ok(mediaIp, 'A local media adapter is required');
  const directAddress = status.lanUrls[0] ?? status.publicV6Urls[0];
  assert.ok(directAddress, 'A signaling adapter address is required');
  assert.equal(await evaluate('Boolean(document.querySelector(".diagnostics-panel"))'), false);
  assert.equal(await evaluate('Boolean(window.gameShare.diagnostics)'), false);
  // Both signaling sources must support all media strategies without changing them.
  for (const signaling of ['ip', 'external']) for (const policy of ['internet-auto', 'local-auto', 'selected-ip-experimental']) {
    await role('host'); await selectConfig(signaling, policy);
    if (signaling === 'ip') await fill('[data-room-address=local]', directAddress);
    else await fill('[data-room-address=external]', 'https://room.example.test:9443');
    if (policy === 'selected-ip-experimental') {
      assert.equal(await evaluate('document.querySelector("[data-media-ip]").value'), '');
      assert.equal(await evaluate('document.querySelector(".connection-config-form button[type=submit]").disabled'), true);
      await fill('[data-media-ip]', mediaIp);
    }
    await submit();
    await until(() => evaluate('Boolean(document.querySelector(".roomcode__value"))'), `Host did not create ${signaling}/${policy}`);
    await until(() => evaluate('document.querySelector("#sidebar-tab-share").getAttribute("aria-selected") === "true"'), 'Joining must open sharing page');
    assert.equal(await evaluate('document.querySelector("[data-signaling]").disabled'), true);
    assert.equal(await evaluate('document.querySelector("[data-media-policy]").disabled'), true);
    const code = await evaluate('document.querySelector(".roomcode__value").textContent');
    visitor = io('http://[::1]:8080', { reconnection: false });
    await new Promise((resolve, reject) => { visitor.once('connect', resolve); visitor.once('connect_error', reject); });
    const before = await evaluate('window.__testPCs.length');
    const joined = await new Promise((resolve, reject) => visitor.timeout(3000).emit('join-room', { roomCode: code, nickname: 'Configuration test viewer' }, (err, value) => err ? reject(err) : resolve(value)));
    assert.equal(joined.ok, true);
    await until(() => evaluate(`window.__testPCs.length > ${before}`), 'No native WebRTC connection created');
    const iceServers = await evaluate('window.__testPCs.at(-1).getConfiguration().iceServers');
    assert.equal(iceServers.length > 0, policy === 'internet-auto', `ICE server policy must follow media choice for ${signaling}/${policy}`);
    await until(() => evaluate('Array.from(document.querySelectorAll(".tile__status")).some(el => el.textContent === "等待共享")'), 'Idle member must wait for sharing');
    visitor.disconnect(); visitor = null;
    await leave();
  }
  console.log('PASS: six host combinations create actual rooms; native ICE configuration follows media choice; room configuration is locked and idle members wait for sharing');

  host = io('http://[::1]:8080', { reconnection: false });
  await new Promise((resolve, reject) => { host.once('connect', resolve); host.once('connect_error', reject); });
  const created = await new Promise((resolve, reject) => host.timeout(3000).emit('create-room', { nickname: 'Invite host', allowIpJoin: true }, (err, value) => err ? reject(err) : resolve(value)));
  assert.equal(created.ok, true);
  const invite = (data, prefix = 'GS3') => `${prefix}.${Buffer.from(JSON.stringify({ server: 'http://[::1]:8080', room: created.data.roomCode, ...data })).toString('base64')}`;
  const tunnelBefore = await evaluate('window.gameShare.tunnel.getStatus()');
  for (const signaling of ['ip', 'external', 'cloudflare']) for (const mediaPolicy of ['internet-auto', 'local-auto', 'selected-ip-experimental']) {
    await role('host'); await role('guest');
    const token = invite({ signaling, mediaPolicy, mediaIp: '192.0.2.123' });
    await fill('[data-invitation]', token);
    await until(() => evaluate(`document.querySelector('[data-signaling]').value === '${signaling}' && document.querySelector('[data-media-policy]').value === '${mediaPolicy}'`), 'Pasting must immediately select both invitation settings');
    assert.equal(await evaluate('document.querySelector("[data-signaling]").disabled'), true);
    assert.equal(await evaluate('document.querySelector("[data-media-policy]").disabled'), true);
    if (mediaPolicy === 'selected-ip-experimental') {
      assert.equal(await evaluate('document.querySelector("[data-media-ip]").value'), '', 'Never copy or default the host media IP');
      assert.equal(await evaluate('document.querySelector("[data-media-ip]").disabled'), false, 'Guest must be able to choose their own adapter');
      assert.equal(await evaluate('document.querySelector(".connection-config-form button[type=submit]").disabled'), true);
      await fill('[data-media-ip]', mediaIp);
      if (signaling === 'cloudflare') {
        await sleep(250);
        fs.writeFileSync(path.join(output, 'unified-guest-ip.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
      }
    } else assert.equal(await evaluate('Boolean(document.querySelector("[data-media-ip]"))'), false);
    const pcCount = await evaluate('window.__testPCs.length');
    await submit(); await until(() => evaluate('Boolean(document.querySelector(".roomcode__value"))'), `GS3 join failed: ${signaling}/${mediaPolicy}`);
    await until(() => evaluate(`window.__testPCs.length > ${pcCount}`), 'Invited client did not create a native media connection');
    assert.equal(await evaluate('window.__testPCs.at(-1).getConfiguration().iceServers.length > 0'), mediaPolicy === 'internet-auto', 'Invited media configuration must follow the invitation, independently of signaling');
    assert.equal((await evaluate('window.gameShare.tunnel.getStatus()')).enabled, tunnelBefore.enabled, 'Guests must not start a tunnel');
    await leave();
  }
  console.log('PASS: all nine GS3 invitation combinations select and lock settings on paste, join real rooms, require only guest-local media IP, and never start guest tunnels');

  for (const fields of [
    { mode: 'lan', mediaPolicy: 'local-auto' },
    { mode: 'public', mediaPolicy: 'internet-auto' },
    { mode: 'cloudflare', mediaPolicy: 'internet-auto' },
    { mode: 'mixed', mediaPolicy: 'selected-ip-experimental', signaling: 'cloudflare' },
  ]) {
    await role('host'); await role('guest');
    await fill('[data-invitation]', invite(fields, fields.mode === 'mixed' ? 'GS2' : 'GS1'));
    await until(() => evaluate(`document.querySelector('[data-media-policy]').value === '${fields.mediaPolicy}'`), 'Legacy policy not migrated');
    if (fields.mode === 'mixed') await fill('[data-media-ip]', mediaIp);
    await submit(); await until(() => evaluate('Boolean(document.querySelector(".roomcode__value"))'), `Legacy ${fields.mode} join failed`); await leave();
  }
  await fill('[data-invitation]', 'GS4.future');
  assert.match(await evaluate('document.querySelector("[role=alert]").textContent'), /更新版本/);
  await fill('[data-invitation]', 'GS3.broken');
  assert.match(await evaluate('document.querySelector("[role=alert]").textContent'), /损坏/);
  assert.equal(await evaluate('document.querySelector(".connection-config-form button[type=submit]").disabled'), true);
  await fill('[data-invitation]', '');
  assert.equal(await evaluate('document.querySelector("[data-signaling]").disabled'), false);
  await selectConfig('external', 'internet-auto');
  await fill('[data-join-address]', 'http://[::1]:8080'); await fill('[data-join-code]', created.data.roomCode);
  await submit(); await until(() => evaluate('Boolean(document.querySelector(".roomcode__value"))'), 'Manual join failed');
  async function resolutionSelected(height) {
    return evaluate(`Array.from(document.querySelectorAll('[data-video-resolution]')).find(button => Number(button.dataset.videoResolution) === ${height})?.getAttribute('aria-checked') === 'true'`);
  }
  // Sender resolution is local and survives focus, float mode and restarts.
  await fill('[data-video-bitrate]', '1000000');
  assert.equal(await evaluate('document.querySelectorAll("[data-video-resolution]").length'), 3);
  assert.equal(await resolutionSelected(540), true);
  await evaluate(`Array.from(document.querySelectorAll('[data-video-resolution]')).find(button => Number(button.dataset.videoResolution) === 1080).click()`);
  await evaluate('Array.from(document.querySelectorAll("#sidebar-page-share button")).find(b => b.title.includes("测试") || b.title.includes("test")).click()');
  await until(() => evaluate('Boolean(document.querySelector("#sidebar-page-share .tag--live"))'), 'Test sharing did not start');
  await evaluate('document.querySelector("#sidebar-tab-room").click(); document.querySelector("#sidebar-tab-share").click()');
  assert.equal(await evaluate('document.querySelector("[data-video-bitrate]").value'), '1000000');
  assert.equal(await evaluate('Boolean(document.querySelector("#sidebar-page-share .tag--live"))'), true);
  const quality = []; host.on('quality-request', value => quality.push(value.payload.level));
  await evaluate('window.gameShare.windowMode.setEnabled(true)');
  await sleep(250);
  assert.equal(await resolutionSelected(1080), true);
  await evaluate('window.gameShare.windowMode.setEnabled(false)');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "放大")?.click()');
  await sleep(250);
  assert.equal(quality.length, 0, 'Focus and floating mode must not request different sender quality');
  assert.equal(await evaluate('localStorage.getItem("gs.videoResolution")'), '1080');
  fs.writeFileSync(path.join(output, 'manual-resolution.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  await leave();
  await evaluate('localStorage.removeItem("gs.connectionConfig"); localStorage.setItem("gs.connectionMode", "uu"); location.reload(); true');
  await until(() => evaluate('document.querySelector("[data-signaling]")?.value === "ip" && document.querySelector("[data-media-policy]")?.value === "local-auto"'), 'Legacy UU preference migration failed');
  await until(() => resolutionSelected(1080), 'Resolution preference must restore');
  await evaluate('localStorage.setItem("gs.videoResolution", "2160"); location.reload(); true');
  await until(() => resolutionSelected(540), 'Invalid stored resolution must restore 540p');
  console.log('PASS: old invites, manual join, live sharing/tab/bitrate preservation, user resolution overrides focus/float, resolution persistence and invalid-value fallback, UU migration');
  await evaluate('setTimeout(() => window.gameShare.windowControl.close(), 100); true');
} catch (error) {
  if (ws?.readyState === 1) {
    const id = 999999;
    ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot' }));
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      ws.addEventListener('message', ({ data }) => {
        const result = JSON.parse(data);
        if (result.id !== id) return;
        if (result.result?.data) fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(result.result.data, 'base64'));
        clearTimeout(timer); resolve();
      });
    });
  }
  throw error;
} finally {
  visitor?.disconnect();
  host?.disconnect();
  ws?.close();
  if (child.exitCode === null) child.kill();
  fs.writeFileSync(path.join(output, 'app.log'), logs);
}

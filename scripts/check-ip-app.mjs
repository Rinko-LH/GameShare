/** Exercise the shipped renderer and preload through a loopback-only debugging port. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
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
function health() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://[::1]:8080/health', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`Health response ${res.statusCode}: ${body}`)); }
      });
    });
    req.on('error', reject);
  });
}
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
  await until(() => evaluate('Boolean(document.querySelector(".mode-chooser, .ip-connect"))'), 'Connection UI is missing');
  await evaluate('localStorage.removeItem("gs.connectionMode"); location.reload(); true');
  await until(() => evaluate('Boolean(document.querySelector(".mode-chooser"))'), 'First launch mode chooser missing');
  assert.equal(await evaluate('document.querySelectorAll(".mode-card").length'), 4);
  fs.writeFileSync(path.join(output, 'mode-chooser.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  async function selectMode(index) {
    await evaluate(`document.querySelectorAll('.mode-card')[${index}].click()`);
    await until(() => evaluate('Boolean(document.querySelector(".ip-connect"))'), 'Mode selection did not open connection panel');
  }
  async function openModes() {
    await until(() => evaluate('!Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("· 切换"))?.disabled'), 'Mode switch remained disabled');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("· 切换")).click()');
    await until(() => evaluate('Boolean(document.querySelector(".mode-chooser"))'), 'Mode switch did not open');
  }
  assert.equal(await evaluate('document.querySelectorAll(".mode-card")[3].disabled'), false, 'Experimental mode must be testable');
  await selectMode(3);
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /实验模式/);
  assert.equal(await evaluate('Boolean(document.querySelector(".diagnostics-panel"))'), false, 'Diagnostic recording UI must be removed');
  assert.equal(await evaluate('Boolean(window.gameShare.diagnostics)'), false, 'Diagnostic export API must be removed');
  assert.equal(await evaluate('document.querySelector(".media-ip-select").value'), '', 'Do not choose a media IP for the user');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".ip-connect button")).find(b => b.innerText === "创建房间").disabled'), true, 'Require a media IP');
  await evaluate('document.querySelector("input[name=mixed-signaling][value=cloudflare]").click()');
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /自动准备临时房间入口/);
  await evaluate('document.querySelector("input[name=mixed-signaling][value=ip]").click()');
  const mixedStatus = await evaluate('window.gameShare.server.getStatus()');
  assert.ok(mixedStatus.mediaAddresses.length > 0, 'No adapter addresses exposed to renderer');
  assert.ok(mixedStatus.mediaAddresses.every(item => item.interfaceName && item.address !== '127.0.0.1' && item.address !== '::1'));
  await evaluate(`(() => { const select = document.querySelector('.media-ip-select'); select.value = ${JSON.stringify(mixedStatus.mediaAddresses[0].address)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`(() => { const select = document.querySelector('.ip-connect select:not(.media-ip-select)'); select.value = ${JSON.stringify(mixedStatus.lanUrls[0])}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate('Array.from(document.querySelectorAll(".ip-connect button")).find(b => b.innerText === "创建房间").click()');
  await until(() => evaluate('Boolean(document.querySelector(".roomcode__value"))'), 'Mixed IP room was not created');
  assert.equal(await evaluate('document.querySelector(".media-ip-select").disabled'), true);
  fs.writeFileSync(path.join(output, 'mixed-mode.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.innerText.trim())).click()');
  await until(() => evaluate('!document.querySelector(".roomcode__value")'), 'Mixed room did not close');
  await openModes();
  await selectMode(0);
  assert.equal(await evaluate('localStorage.getItem("gs.connectionMode")'), 'lan');
  await evaluate('localStorage.setItem("gs.connectionMode", "uu"); location.reload(); true');
  await until(() => evaluate('document.querySelector(".ip-connect h2")?.innerText === "IP 连接"'), 'Saved mode not restored');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".collapse__toggle")).some(b => b.innerText.includes("本机信令服务"))'), false, 'Technical server settings should be hidden');
  await openModes(); await selectMode(1);
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /端口映射/);
  await openModes(); await selectMode(2);
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /不转发画面和声音/);
  await evaluate('document.querySelector(".connection-roles input[value=guest]").click()');
  assert.equal(await evaluate('document.querySelectorAll(".ip-connect form input").length'), 0, 'Cloudflare should offer invitation joining, not LAN IP fields');
  await openModes(); await selectMode(0);
  fs.writeFileSync(path.join(output, 'mode-ip.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  console.log('PASS: four available modes including experimental mixed mode, legacy UU migration, first-run chooser, saved preference, switch, and mode-specific guidance');
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /UU/);
  const sources = await evaluate('window.gameShare.capture.listSources().then(items => items.map(item => ({id:item.id,kind:item.kind})))');
  assert.ok(sources.some((source) => source.kind === 'screen'), 'No real screen capture source');
  const status = await evaluate('window.gameShare.server.getStatus()');
  const lanAddress = new URL(status.lanUrls[0]).hostname;
  console.log('PASS: packaged renderer, preload and real screen enumeration');
  const initialRooms = (await health()).rooms;
  assert.match(await evaluate('document.querySelector(".app__header .status").innerText'), /尚未创建房间/);
  await evaluate(`(() => {
    const select = document.querySelector('.ip-connect select');
    select.value = ${JSON.stringify(status.lanUrls[0])};
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await evaluate('Array.from(document.querySelectorAll(".ip-connect button")).find(b => b.innerText === "创建房间").click()');
  await until(() => evaluate('document.querySelector(".roomcode__value")?.innerText'), 'Create IP room button did not enter a room');
  assert.match(await evaluate('document.querySelector(".app__header .status").innerText'), /房间已创建 · 等待朋友/);
  assert.equal(await evaluate('Boolean(document.querySelector(".app__header .status__rtt"))'), false, 'Host must not show a localhost RTT');
  assert.equal((await health()).rooms, initialRooms + 1);
  const ownRoom = await evaluate('document.querySelector(".roomcode__value").innerText');
  visitor = io('http://[::1]:8080', { reconnection: false });
  await new Promise((resolve, reject) => { visitor.once('connect', resolve); visitor.once('connect_error', reject); });
  const visit = await new Promise((resolve, reject) => visitor.timeout(3000).emit('join-room', { roomCode: ownRoom, nickname: 'Status test friend' }, (err, result) => err ? reject(err) : resolve(result)));
  assert.equal(visit.ok, true);
  await until(() => evaluate('document.querySelector(".app__header .status")?.innerText === "朋友已加入"'), 'Host should show that a friend joined');
  await until(() => evaluate('Array.from(document.querySelectorAll(".tile__status")).some(el => el.innerText === "等待共享")'), 'Idle peer should wait for sharing');
  assert.equal(await evaluate('Boolean(document.querySelector(".tile__diag"))'), false, 'Idle peers must not show media failure diagnostics');
  visitor.emit('share-started', { quality: 'medium' });
  await until(() => evaluate('Array.from(document.querySelectorAll(".tile__status")).some(el => el.innerText.startsWith("音视频 ·"))'), 'Publishing peer should show media connection state');
  visitor.emit('share-stopped', { reason: 'user' });
  await until(() => evaluate('Array.from(document.querySelectorAll(".tile__status")).some(el => el.innerText === "等待共享")'), 'Stopped peer should return to waiting');
  console.log('PASS: idle, publishing and stopped media states are independent of room signaling');
  visitor.disconnect();
  await until(() => evaluate('document.querySelector(".app__header .status")?.innerText.includes("房间已创建 · 等待朋友")'), 'Host should wait again after the friend leaves');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.innerText.trim())).click()');
  await until(async () => (await health()).rooms === initialRooms, 'Test room was not closed');
  await until(() => evaluate('document.querySelector(".app__header .status")?.innerText === "尚未创建房间"'), 'Leaving a room should reset the host status');
  await openModes(); await selectMode(0);
  host = io('http://[::1]:8080', { reconnection: false });
  await new Promise((resolve, reject) => { host.once('connect', resolve); host.once('connect_error', reject); });
  const created = await new Promise((resolve, reject) => host.timeout(3000).emit('create-room', { nickname: 'UI test host', allowIpJoin: true }, (err, result) => err ? reject(err) : resolve(result)));
  assert.equal(created.ok, true);
  await evaluate('document.querySelector(".connection-roles input[value=guest]").click()');
  await until(() => evaluate('Boolean(document.querySelector(".ip-connect details"))'), 'Manual IP form missing');
  assert.match(await evaluate('document.querySelector(".app__header .status").innerText'), /房间连接 · 未连接/);
  await evaluate('document.querySelector(".ip-connect details").open = true');
  await evaluate(`(() => {
    const input = document.querySelector('.ip-connect form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(lanAddress)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  if (initialRooms > 0) {
    await evaluate(`(() => { const input = document.querySelectorAll('.ip-connect form input')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(created.data.roomCode)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  }
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'IP connect button stayed disabled');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(async () => (await evaluate('document.querySelector(".roomcode__value")?.innerText')) === created.data.roomCode, 'IP button did not join the host room');
  assert.match(await evaluate('document.querySelector(".app__header .status").innerText'), /房间连接 · 已连接/);
  console.log(initialRooms > 0 ? 'PASS: actual UI creates/leaves a test room and joins by IP with an explicit code alongside existing rooms' : 'PASS: actual UI creates an IP room, leaves it, and joins by bare IP without a room code');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("· 切换")).disabled'), true, 'Mode switching must be blocked while in a room');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.innerText.trim())).click()');
  await until(() => evaluate('!document.querySelector(".roomcode__value")'), 'Did not leave before invitation test');
  await openModes(); await selectMode(1);
  await evaluate('document.querySelector(".connection-roles input[value=guest]").click()');
  const invitation = `GS1.${Buffer.from(JSON.stringify({ server: 'http://[::1]:8080', room: created.data.roomCode, mode: 'lan', mediaPolicy: 'local-auto' })).toString('base64')}`;
  await evaluate(`(() => { const input = document.querySelector('.ip-connect textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'invalid invitation'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'Malformed invitation input not ready');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(() => evaluate('document.querySelector(".ip-connect [role=alert]")?.innerText.includes("未识别到邀请链接")'), 'Malformed invitation error should be visible');
  await until(() => evaluate('document.querySelector(".app__header .status")?.innerText.includes("房间连接 · 连接失败")'), 'Failed join should show a failed guest connection');
  await evaluate(`(() => { const input = document.querySelector('.ip-connect textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(invitation)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'Invitation join stayed disabled');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(async () => (await evaluate('document.querySelector(".roomcode__value")?.innerText')) === created.data.roomCode, 'Invitation did not join the host room');
  assert.equal(await evaluate('document.querySelector(".ip-connect h2").innerText'), 'IP 连接', 'Invitation must override current public mode');
  console.log('PASS: invitation mode overrides selection and joins a real room, switching is locked during a room');
  assert.match(await evaluate('document.querySelector(".app__header .status").innerText'), /房间连接 · 已连接/);
  console.log('PASS: host room lifecycle (idle, created, friend joined, waiting, left) without local RTT; guest failure/retry/connected status');
  assert.equal(await evaluate('Boolean(document.querySelector(".ip-connect form"))'), false, 'Joined room should hide the connection form');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.innerText.trim())).click()');
  await until(() => evaluate('!document.querySelector(".roomcode__value")'), 'Did not leave before GS2 invitation test');
  await openModes(); await selectMode(1);
  await evaluate('document.querySelector(".connection-roles input[value=guest]").click()');
  const mixedInvitation = `GS2.${Buffer.from(JSON.stringify({ server: 'http://[::1]:8080', room: created.data.roomCode, mode: 'mixed', mediaPolicy: 'selected-ip-experimental', signaling: 'cloudflare' })).toString('base64')}`;
  await evaluate(`(() => { const input = document.querySelector('.ip-connect textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(mixedInvitation)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(() => evaluate('Boolean(document.querySelector(".media-ip-select"))'), 'GS2 invitation did not open mixed configuration');
  assert.equal(await evaluate('document.querySelector(".ip-connect textarea").value'), mixedInvitation, 'Preserve the invitation when asking for the local IP');
  assert.equal(await evaluate('document.querySelector("input[name=mixed-signaling][value=cloudflare]").checked'), true);
  assert.equal(await evaluate('document.querySelector(".ip-connect form button").disabled'), true);
  await evaluate(`(() => { const select = document.querySelector('.media-ip-select'); select.value = ${JSON.stringify(mixedStatus.mediaAddresses[0].address)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'GS2 should allow joining after choosing an IP');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(async () => await evaluate('document.querySelector(".roomcode__value")?.innerText') === created.data.roomCode, 'GS2 invitation did not join');
  assert.equal(await evaluate('document.querySelector(".media-ip-select").value'), mixedStatus.mediaAddresses[0].address);
  console.log('PASS: mixed mode creates an IP room; GS2 restores signaling, requires an independently selected local IP, and joins without starting a guest tunnel');
  const screenshot = await command('Page.captureScreenshot');
  fs.writeFileSync(path.join(output, 'packaged-ip-panel.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('setTimeout(() => window.gameShare.windowControl.close(), 100); true');
} finally {
  visitor?.disconnect();
  host?.disconnect();
  ws?.close();
  if (child.exitCode === null) child.kill();
  fs.writeFileSync(path.join(output, 'app.log'), logs);
}

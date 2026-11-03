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
  await selectMode(1);
  assert.equal(await evaluate('localStorage.getItem("gs.connectionMode")'), 'lan');
  await evaluate('location.reload(); true');
  await until(() => evaluate('document.querySelector(".ip-connect h2")?.innerText === "本地局域网"'), 'Saved mode not restored');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".collapse__toggle")).some(b => b.innerText.includes("本机信令服务"))'), false, 'Technical server settings should be hidden');
  await openModes(); await selectMode(2);
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /端口映射/);
  await openModes(); await selectMode(3);
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /不转发画面和声音/);
  await evaluate('Array.from(document.querySelectorAll(".connection-roles button")).find(b => b.innerText === "加入朋友").click()');
  assert.equal(await evaluate('document.querySelectorAll(".ip-connect form input").length'), 0, 'Cloudflare should offer invitation joining, not LAN IP fields');
  await openModes(); await selectMode(0);
  fs.writeFileSync(path.join(output, 'mode-uu.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  console.log('PASS: four modes, first-run chooser, saved preference, switch, and mode-specific guidance');
  assert.match(await evaluate('document.querySelector(".ip-connect").innerText'), /UU/);
  const sources = await evaluate('window.gameShare.capture.listSources().then(items => items.map(item => ({id:item.id,kind:item.kind})))');
  assert.ok(sources.some((source) => source.kind === 'screen'), 'No real screen capture source');
  const status = await evaluate('window.gameShare.server.getStatus()');
  const lanAddress = new URL(status.lanUrls[0]).hostname;
  console.log('PASS: packaged renderer, preload and real screen enumeration');
  await evaluate('document.querySelector(".ip-connect > button").click()');
  await until(() => evaluate('document.querySelector(".roomcode__value")?.innerText'), 'Create IP room button did not enter a room');
  assert.equal((await health()).rooms, 1);
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.innerText.trim())).click()');
  await until(async () => (await health()).rooms === 0, 'Room was not closed');
  await openModes(); await selectMode(1);
  host = io('http://[::1]:8080', { reconnection: false });
  await new Promise((resolve, reject) => { host.once('connect', resolve); host.once('connect_error', reject); });
  const created = await new Promise((resolve, reject) => host.timeout(3000).emit('create-room', { nickname: 'UI test host', allowIpJoin: true }, (err, result) => err ? reject(err) : resolve(result)));
  assert.equal(created.ok, true);
  await evaluate('Array.from(document.querySelectorAll(".connection-roles button")).find(b => b.innerText === "加入朋友").click()');
  await until(() => evaluate('Boolean(document.querySelector(".ip-connect details"))'), 'Manual IP form missing');
  await evaluate('document.querySelector(".ip-connect details").open = true');
  await evaluate(`(() => {
    const input = document.querySelector('.ip-connect form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(lanAddress)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'IP connect button stayed disabled');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(async () => (await evaluate('document.querySelector(".roomcode__value")?.innerText')) === created.data.roomCode, 'IP button did not join the host room');
  console.log('PASS: actual UI creates an IP room, leaves it, and joins by bare IP without a room code');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("· 切换")).disabled'), true, 'Mode switching must be blocked while in a room');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => /^(离开房间|Leave room)$/.test(b.innerText.trim())).click()');
  await until(() => evaluate('!document.querySelector(".roomcode__value")'), 'Did not leave before invitation test');
  await openModes(); await selectMode(2);
  await evaluate('Array.from(document.querySelectorAll(".connection-roles button")).find(b => b.innerText === "加入朋友").click()');
  const invitation = `GS1.${Buffer.from(JSON.stringify({ server: 'http://[::1]:8080', room: created.data.roomCode })).toString('base64')}`;
  await evaluate(`(() => { const input = document.querySelector('.ip-connect textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'invalid invitation'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'Malformed invitation input not ready');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(() => evaluate('document.querySelector(".ip-connect [role=alert]")?.innerText.includes("未识别到完整邀请")'), 'Malformed invitation error should be visible');
  await evaluate(`(() => { const input = document.querySelector('.ip-connect textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(invitation)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until(() => evaluate('!document.querySelector(".ip-connect form button").disabled'), 'Invitation join stayed disabled');
  await evaluate('document.querySelector(".ip-connect form").requestSubmit()');
  await until(async () => (await evaluate('document.querySelector(".roomcode__value")?.innerText')) === created.data.roomCode, 'Invitation did not join the host room');
  console.log('PASS: public-mode invitation joins a real room, switching is locked during a room');
  assert.equal(await evaluate('Boolean(document.querySelector(".ip-connect form"))'), false, 'Joined room should hide the connection form');
  const screenshot = await command('Page.captureScreenshot');
  fs.writeFileSync(path.join(output, 'packaged-ip-panel.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('setTimeout(() => window.gameShare.windowControl.close(), 100); true');
} finally {
  host?.disconnect();
  ws?.close();
  if (child.exitCode === null) child.kill();
  fs.writeFileSync(path.join(output, 'app.log'), logs);
}

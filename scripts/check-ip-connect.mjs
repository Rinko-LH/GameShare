import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, '.cache', 'ip-connect');
fs.mkdirSync(cache, { recursive: true });
async function load(entry, name) {
  const outfile = path.join(cache, `${name}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], outfile, platform: 'node', format: 'cjs', bundle: true, packages: 'external', logLevel: 'silent' });
  return require(outfile);
}
const { normalizeSignalingAddress: normalize } = await load('packages/shared/src/signaling-address.ts', 'address');
for (const [input, expected] of [
  ['', 'http://localhost:8080'], [' 10.12.0.2 ', 'http://10.12.0.2:8080'],
  ['10.12.0.2:9090', 'http://10.12.0.2:9090'], ['localhost', 'http://localhost:8080'],
  ['10.12.0.2:80', 'http://10.12.0.2'], ['[::1]:80', 'http://[::1]'],
  ['[::1]', 'http://[::1]:8080'], ['::1', 'http://[::1]:8080'],
  ['https://example.com/', 'https://example.com'], ['http://10.12.0.2', 'http://10.12.0.2'],
]) assert.equal(normalize(input), expected);
for (const input of ['ftp://host', 'http://user:pass@host', '10.0.0.999', '10.0.0.2:99999', 'bad address']) {
  assert.throws(() => normalize(input));
}
console.log('PASS: IP/port/IPv6/URL normalization and invalid address handling');

// Bundle workspace source rather than importing .ts from a Node runtime.
const serverBundle = path.join(cache, 'server.cjs');
await build({ entryPoints: [path.join(root, 'apps/signaling/src/embed.ts')], outfile: serverBundle,
  bundle: true, platform: 'node', format: 'cjs', external: ['socket.io'], logLevel: 'silent' });
const { createSignalingServer } = require(serverBundle);
const server = createSignalingServer({ host: '127.0.0.1', port: 0, corsOrigins: '*' });
const clients = [];
function request(socket, event, payload) {
  return new Promise((resolve, reject) => socket.timeout(3000).emit(event, payload, (err, response) => err ? reject(err) : resolve(response)));
}
try {
  const { port } = await server.listen();
  async function client() {
    const socket = io(`http://127.0.0.1:${port}`, { reconnection: false });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const [host, viewer, secondHost] = await Promise.all([client(), client(), client()]);
  const privateRoom = await request(host, 'create-room', { nickname: 'private' });
  assert.equal(privateRoom.ok, true);
  assert.equal((await request(viewer, 'join-room', { nickname: 'viewer', roomCode: '', joinByIp: true })).ok, false);
  await request(host, 'leave-room', {});
  const room = await request(host, 'create-room', { nickname: 'host', allowIpJoin: true });
  const joined = await request(viewer, 'join-room', { nickname: 'viewer', roomCode: '', joinByIp: true });
  assert.equal(joined.ok, true);
  assert.equal(joined.data.roomCode, room.data.roomCode);
  assert.equal(joined.data.peers.length, 1);
  await request(viewer, 'leave-room', {});
  await request(secondHost, 'create-room', { nickname: 'other', allowIpJoin: true });
  const ambiguous = await request(viewer, 'join-room', { nickname: 'viewer', roomCode: '', joinByIp: true });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error.message, /多个/);
  assert.equal((await request(viewer, 'join-room', { nickname: 'viewer', roomCode: room.data.roomCode })).ok, true);
  await request(viewer, 'leave-room', {});
  await request(secondHost, 'leave-room', {});
  // Keep the existing capacity guard for IP joins as well.
  for (let i = 0; i < 7; i++) {
    const member = await client();
    assert.equal((await request(member, 'join-room', { roomCode: '', nickname: `viewer${i}`, joinByIp: true })).ok, true);
  }
  const full = await request(viewer, 'join-room', { roomCode: '', nickname: 'overflow', joinByIp: true });
  assert.equal(full.ok, false);
  assert.equal(full.error.code, 'ROOM_FULL');
  for (const socket of clients) await request(socket, 'leave-room', {});
  assert.equal(server.rooms.roomCount, 0);
  console.log('PASS: real Socket.IO IP joins, private room exclusion, ambiguity, explicit codes, capacity and cleanup');
} finally {
  for (const client of clients) client.disconnect();
  await server.close();
}

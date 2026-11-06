import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.cache/connection-modes');
fs.mkdirSync(output, { recursive: true });
async function load(name) {
  const outfile = path.join(output, `${name.replaceAll('/', '-')}.mjs`);
  await build({ entryPoints: [path.join(root, `apps/desktop/src/${name}.ts`)], bundle: true, platform: 'node', format: 'esm', outfile });
  return import(pathToFileURL(outfile));
}
const config = await load('connection-config');
const { parseInvitation, createInvitation, resolveInvitationConfig } = await load('invitations');
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
for (const [old, expected] of [
  ['uu', { signaling: 'ip', mediaPolicy: 'local-auto' }],
  ['lan', { signaling: 'ip', mediaPolicy: 'local-auto' }],
  ['public', { signaling: 'external', mediaPolicy: 'internet-auto' }],
  ['cloudflare', { signaling: 'cloudflare', mediaPolicy: 'internet-auto' }],
  ['mixed', { signaling: 'ip', mediaPolicy: 'selected-ip-experimental' }],
]) {
  storage.clear(); storage.set('gs.connectionMode', old);
  assert.deepEqual(config.readConnectionConfig(), expected);
  assert.deepEqual(JSON.parse(storage.get('gs.connectionConfig')), expected);
}
for (const bad of ['{broken', 'null', JSON.stringify({ signaling: 'future', mediaPolicy: 'internet-auto' }), JSON.stringify({ signaling: 'ip', mediaPolicy: 'selected-ip' })]) {
  storage.set('gs.connectionConfig', bad);
  assert.deepEqual(config.readConnectionConfig(), config.DEFAULT_CONNECTION_CONFIG);
}
for (const signaling of ['ip', 'external', 'cloudflare']) for (const mediaPolicy of ['local-auto', 'internet-auto', 'selected-ip-experimental']) {
  const expected = { signaling, mediaPolicy };
  config.saveConnectionConfig(expected);
  assert.deepEqual(config.readConnectionConfig(), expected);
  const text = createInvitation('https://room.example.test:9443', 'abc234', { ...expected, mediaIp: '192.168.1.20' });
  assert.ok(text.startsWith('GS3.'));
  const raw = JSON.parse(Buffer.from(text.slice(4), 'base64').toString());
  assert.deepEqual(Object.keys(raw).sort(), ['mediaPolicy', 'room', 'server', 'signaling']);
  const parsed = parseInvitation(text);
  assert.deepEqual(parsed.config, expected);
  assert.deepEqual(resolveInvitationConfig(parsed, config.DEFAULT_CONNECTION_CONFIG), expected);
}
const invite = (fields, prefix = 'GS1') => `${prefix}.${Buffer.from(JSON.stringify(fields)).toString('base64')}`;
const base = { server: 'http://[::1]:8080', room: 'abc234' };
assert.deepEqual(parseInvitation(invite(base)), { ...base, room: 'ABC234', mode: undefined, mediaPolicy: undefined });
for (const mode of ['lan', 'public', 'cloudflare']) {
  const parsed = parseInvitation(invite({ ...base, mode, mediaPolicy: mode === 'lan' ? 'local-auto' : 'internet-auto' }));
  assert.equal(parsed.mode, mode);
  assert.deepEqual(resolveInvitationConfig(parsed, config.DEFAULT_CONNECTION_CONFIG), config.configFromLegacyMode(mode));
}
assert.equal(parseInvitation(invite({ ...base, mode: 'uu' })).mode, 'lan');
assert.match(parseInvitation(invite({ ...base, mode: 'mixed' })).error, /GS2 实验邀请/);
assert.match(parseInvitation(invite({ ...base, mediaPolicy: 'selected-ip' })).error, /严格媒体 IP/);
assert.match(parseInvitation(invite(base, 'GS2')).error, /新版邀请/);
assert.match(parseInvitation(`${invite(base, 'GS2')}\n${invite(base)}`).error, /新版邀请/);
assert.match(parseInvitation(invite({ ...base, mode: 'future' })).error, /未知连接模式/);
assert.match(parseInvitation(invite({ ...base, mode: 'lan', mediaPolicy: 'internet-auto' })).error, /不一致/);
assert.match(parseInvitation(invite({ ...base, mediaPolicy: 'unknown' })).error, /未知媒体策略/);
assert.match(parseInvitation('GS1.broken').error, /损坏/);
assert.match(parseInvitation(invite(null)).error, /格式无效/);
assert.equal(parseInvitation('invalid invitation'), null);
assert.deepEqual(parseInvitation('信令地址：http://192.168.1.2:8080\n房间码：ABC234'), { server: 'http://192.168.1.2:8080', room: 'ABC234' });
assert.deepEqual(parseInvitation('http://192.168.1.2:8080 ABC234'), { server: 'http://192.168.1.2:8080', room: 'ABC234' });
const mixed = { ...base, mode: 'mixed', mediaPolicy: 'selected-ip-experimental', signaling: 'cloudflare' };
assert.equal(parseInvitation(invite(mixed, 'GS2')).signaling, 'cloudflare');
assert.deepEqual(resolveInvitationConfig(parseInvitation(invite(mixed, 'GS2')), config.DEFAULT_CONNECTION_CONFIG), { signaling: 'cloudflare', mediaPolicy: 'selected-ip-experimental' });
assert.match(parseInvitation(invite(mixed)).error, /GS2 实验邀请/);
assert.match(parseInvitation(invite({ ...mixed, signaling: 'invalid' }, 'GS2')).error, /GS2 实验邀请/);
for (const bad of [{}, { signaling: 'future', mediaPolicy: 'internet-auto' }, { signaling: 'ip', mediaPolicy: 'selected-ip' }, { signaling: 'ip', mediaPolicy: 'local-auto', room: '' }, { signaling: 'ip', mediaPolicy: 'local-auto', server: 'javascript:alert(1)' }]) {
  assert.ok(parseInvitation(invite({ ...base, ...bad }, 'GS3')).error);
}
assert.match(parseInvitation('GS4.future').error, /更新版本/);
assert.match(parseInvitation('GS3.broken').error, /损坏/);
assert.throws(() => createInvitation('', 'ABC234', config.DEFAULT_CONNECTION_CONFIG));
assert.throws(() => createInvitation('http://localhost', 'bad', config.DEFAULT_CONNECTION_CONFIG));
const candidate = await load('rtc/media-ip');
assert.equal(candidate.allowsMediaCandidate('candidate:1 1 udp 1 192.168.1.2 5000 typ host', '192.168.1.2'), true);
assert.equal(candidate.allowsMediaCandidate('candidate:1 1 udp 1 192.168.1.3 5000 typ host', '192.168.1.2'), false);
assert.equal(candidate.allowsMediaCandidate('candidate:1 1 udp 1 192.168.1.2 5000 typ relay', '192.168.1.2'), false);
assert.equal(candidate.allowsMediaCandidate('candidate:1 1 udp 1 opaque.local 5000 typ host', '192.168.1.2'), false);
assert.equal(candidate.allowsMediaCandidate('candidate:1 1 udp 1 fd00::1 5000 typ host', 'fd00:0:0:0:0:0:0:1'), true);
const sdp = 'v=0\r\na=candidate:1 1 udp 1 192.168.1.2 5000 typ host\r\na=candidate:2 1 udp 1 192.168.1.3 5001 typ host\r\n';
assert.match(candidate.restrictMediaSdp(sdp, '192.168.1.2'), /192.168.1.2/);
assert.doesNotMatch(candidate.restrictMediaSdp(sdp, '192.168.1.2'), /192.168.1.3/);
delete globalThis.localStorage;
console.log('PASS: nine independent signaling/media combinations, GS3 invitations exclude local IP, legacy migration/invitations, invalid policies and media candidate restrictions');

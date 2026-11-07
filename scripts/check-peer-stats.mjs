import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const output = path.resolve(import.meta.dirname, '../.cache/peer-stats/stats.mjs');
fs.mkdirSync(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.resolve(import.meta.dirname, '../apps/desktop/src/rtc/stats.ts')], bundle: true, platform: 'node', format: 'esm', outfile: output });
const { PeerStats, formatBitrate } = await import(pathToFileURL(output));
let timestamp = 1000, bytes = 1000, frames = 30;
const pc = { async getStats() { return new Map([
  ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', timestamp, bytesReceived: bytes, framesDecoded: frames, frameHeight: 720, framesPerSecond: 30 }],
  ['out', { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp, bytesSent: bytes, framesEncoded: frames }],
  ['local', { id: 'local', type: 'local-candidate', address: '192.0.2.1', candidateType: 'host', protocol: 'udp' }],
  ['remote', { id: 'remote', type: 'remote-candidate', address: '192.0.2.2', candidateType: 'host' }],
  ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', bytesReceived: bytes, localCandidateId: 'local', remoteCandidateId: 'remote' }],
]); } };
const reader = new PeerStats();
const initial = await reader.read(pc);
timestamp += 1000; bytes += 10000; frames += 30;
await reader.read(pc, { routeOnly: true });
const ui = await reader.read(pc);
assert.equal(ui.inbound.bitrateBps, 80000, 'Background IP guard must not consume the UI bitrate interval');
assert.equal(ui.outbound.bitrateBps, 80000, 'Background IP guard must not consume outgoing bitrate');
assert.equal(initial.inbound.bitrateBps, null, 'First sample is unknown, not zero traffic');
const duplicate = await reader.read(pc);
assert.equal(duplicate.inbound.bitrateBps, 80000, 'Repeated cached reports must retain the last measurement');
assert.equal(duplicate.outbound.bitrateBps, 80000);
timestamp -= 100;
assert.equal((await reader.read(pc)).inbound.bitrateBps, 80000, 'An older cached report must not move the baseline backwards');
timestamp += 100;
const route = await reader.read(pc, { routeOnly: true });
assert.equal(route.route.localAddress, '192.0.2.1');
assert.equal(route.inbound, null);
timestamp += 1000;
assert.equal((await reader.read(pc)).inbound.bitrateBps, 0, 'A full interval with no bytes is real zero traffic');
timestamp += 1000; bytes = 100; frames = 1;
assert.equal((await reader.read(pc)).inbound.bitrateBps, null, 'Counter reset starts a new baseline');
timestamp += 1000; bytes += 20000; frames += 30;
assert.equal((await reader.read(pc)).inbound.bitrateBps, 160000);
reader.reset();
assert.equal((await reader.read(pc)).inbound.bitrateBps, null, 'Reconnect must discard the old baseline');
timestamp += 1000; bytes += 30000;
assert.equal((await reader.read(pc)).inbound.bitrateBps, 240000, 'Ordinary sampling still works after reconnect');
assert.equal(formatBitrate(null), '—');
assert.equal(formatBitrate(0), '0 Kbps');
assert.equal(formatBitrate(80000), '80 Kbps');
assert.equal(formatBitrate(1500000), '1.50 Mbps');
console.log('PASS: independent route checks, cached reports, real zero traffic, counter reset, reconnect and bitrate display');

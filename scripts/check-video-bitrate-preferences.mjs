import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.cache/video-bitrate/preferences.mjs'); fs.mkdirSync(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, 'apps/desktop/src/video-bitrate.ts')], bundle: true, platform: 'node', format: 'esm', outfile: output });
const { VIDEO_BITRATE_OPTIONS, VIDEO_BITRATE_STORAGE_KEY, readVideoBitrateLimit, saveVideoBitrateLimit } = await import(pathToFileURL(output));
const storage = new Map();
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
assert.equal(readVideoBitrateLimit(), null);
for (const limit of VIDEO_BITRATE_OPTIONS) { saveVideoBitrateLimit(limit); assert.equal(readVideoBitrateLimit(), limit); }
saveVideoBitrateLimit(null); assert.equal(storage.has(VIDEO_BITRATE_STORAGE_KEY), false);
for (const value of ['0', '-1', 'NaN', 'Infinity', '25000000', '12345', 'garbage']) { storage.set(VIDEO_BITRATE_STORAGE_KEY, value); assert.equal(readVideoBitrateLimit(), null); }
Object.defineProperty(globalThis.window, 'localStorage', { get() { throw new Error('Storage disabled'); } });
assert.equal(readVideoBitrateLimit(), null); assert.doesNotThrow(() => saveVideoBitrateLimit(1000000)); assert.doesNotThrow(() => saveVideoBitrateLimit(null));
delete globalThis.window;
console.log('PASS: automatic default, all bitrate presets, persistence, invalid stored values and unavailable storage');

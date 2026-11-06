'use strict';
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { clearTimeout } = require('node:timers');
const output = path.resolve(__dirname, '../.cache/video-bitrate'); fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const timeout = setTimeout(() => app.exit(1), 60000);
  try {
    const bundle = buildSync({ stdin: { contents: `export { MeshManager } from './apps/desktop/src/rtc/MeshManager'; export * from './apps/desktop/src/video-bitrate';`, resolveDir: path.resolve(__dirname, '..') }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'BitrateTest' }).outputFiles[0].text;
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(bundle);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      async function until(fn, message) { const end = Date.now() + 12000; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw new Error(message); }
      const options = BitrateTest.VIDEO_BITRATE_OPTIONS;
      check(options.length === 7 && options[0] === 500000 && options[6] === 24000000, 'Expected selectable limits');
      for (const invalid of [-1, 0, NaN, Infinity, true, {}, 'bad', 25000000]) check(BitrateTest.normalizeVideoBitrateLimit(invalid) === null, 'Invalid limit must become automatic');
      check(BitrateTest.normalizeVideoBitrateLimit('1000000') === 1000000, 'Stored value normalization');
      // Storage is tested against an actual application page in the application UI regression.
      const buses = new Map(); const meshes = [];
      function signal(id) {
        const listeners = new Map(); buses.set(id, listeners);
        const send = (target, name, payload) => { for (const fn of buses.get(target)?.get(name) ?? []) fn(id, payload); };
        return { on: (name, fn) => { const list = listeners.get(name) ?? new Set(); list.add(fn); listeners.set(name, list); return () => list.delete(fn); },
          sendOffer: (target, sdp) => send(target, 'offer', { sdp }), sendAnswer: (target, sdp) => send(target, 'answer', { sdp }),
          sendIceCandidate: (target, candidate) => send(target, 'iceCandidate', candidate) };
      }
      function mesh(id, limit = null) { const m = new BitrateTest.MeshManager({ selfPeerId: id, signaling: signal(id), iceServers: [], videoBitrateLimit: limit }); m.attach(); meshes.push(m); return m; }
      const sender = mesh('z', 1000000), a = mesh('a'), b = mesh('b');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d'); const paint = setInterval(() => { ctx.fillStyle = Date.now() % 2 ? 'red' : 'blue'; ctx.fillRect(0,0,canvas.width,canvas.height); }, 50);
      const stream = canvas.captureStream(15); const tracks = [...stream.getTracks()];
      sender.setLocalTrack('video', stream.getVideoTracks()[0]);
      sender.syncPeers(['z','a','b']); a.syncPeers(['a','z']); b.syncPeers(['b','z']);
      async function cap(ids, value) { await until(() => ids.every(id => sender.getLink(id)?.readEncodingParams()?.maxBitrate === value), 'Video bitrate not applied: ' + value); }
      try {
        await until(() => ['a','b'].every(id => sender.getLink(id)?.state === 'connected'), 'Two viewers did not connect');
        await cap(['a','b'], 1000000);
        await until(async () => (await a.getLink('z').readStats()).inbound?.framesDecoded > 2, 'No decoded video');
        const audioBefore = sender.getLink('a').pc.getTransceivers().slice(1).map(t => t.sender.getParameters().encodings?.map(e => e.maxBitrate ?? null));
        await Promise.all(['a','b'].map(id => sender.getLink(id).setQuality('FOCUS')));
        sender.setUserFps(120); await cap(['a','b'], 1000000);
        await Promise.all(['a','b'].map(id => sender.getLink(id).setQuality('THUMBNAIL')));
        await until(() => ['a','b'].every(id => sender.getLink(id).readEncodingParams().maxBitrate <= 1000000), 'Thumbnail broke limit');
        sender.setUserFps(30); await cap(['a','b'], 700000); // A higher manual cap must not raise a lower automatic limit.
        const work = ['a','b'].map(id => sender.getLink(id).setQuality('FOCUS_HIGH'));
        sender.setUserFps(120); sender.setVideoBitrateLimit(500000); await Promise.all(work); await cap(['a','b'], 500000);
        const otherCanvas = document.createElement('canvas'); otherCanvas.width = 1280; otherCanvas.height = 720;
        const second = otherCanvas.captureStream(15); tracks.push(...second.getTracks());
        sender.setLocalTrack('video', second.getVideoTracks()[0]); await until(() => sender.getLink('a').localTracks.video === second.getVideoTracks()[0], 'Source replacement did not apply'); await cap(['a','b'], 500000);
        const c = mesh('c'); sender.syncPeers(['z','a','b','c']); c.syncPeers(['c','z']);
        await until(() => sender.getLink('c')?.state === 'connected', 'Late viewer did not connect'); await cap(['a','b','c'], 500000);
        const link = sender.getLink('a'); const old = link.pc.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1]; link.pc.restartIce();
        await until(() => link.pc.localDescription?.sdp.match(/a=ice-ufrag:(.*)/)?.[1] !== old && link.pc.signalingState === 'stable' && link.state === 'connected', 'ICE restart did not complete'); await cap(['a'], 500000);
        sender.syncPeers(['z','a','c']); b.syncPeers(['b']); sender.syncPeers(['z','a','b','c']); b.syncPeers(['b','z']);
        await until(() => sender.getLink('b')?.state === 'connected', 'Recreated viewer did not connect'); await cap(['a','b','c'], 500000);
        const audioAfter = link.pc.getTransceivers().slice(1).map(t => t.sender.getParameters().encodings?.map(e => e.maxBitrate ?? null));
        check(JSON.stringify(audioBefore) === JSON.stringify(audioAfter), 'Audio sender limits changed');
        sender.setVideoBitrateLimit(null); sender.setUserFps(30);
        await Promise.all(['a','b','c'].map(id => sender.getLink(id).setQuality('FOCUS'))); await cap(['a','b','c'], 4000000);
        return { twoInitialViewers: true, lateViewer: true, qualityAndFps: true, sourceReplacement: true, iceRestart: true, reconnect: true, automaticRestored: true, audioUnchanged: true };
      } finally { clearInterval(paint); tracks.forEach(t => t.stop()); meshes.forEach(m => { m.close(); }); }
    })()`);
    assert.ok(result.automaticRestored); console.log('PASS: video bitrate runtime checks', JSON.stringify(result));
    clearTimeout(timeout); win.destroy(); app.exit(0);
  } catch (error) { clearTimeout(timeout); console.error(error); win.destroy(); app.exit(1); }
});

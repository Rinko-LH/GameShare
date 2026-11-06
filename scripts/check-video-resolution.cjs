'use strict';
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const { clearTimeout } = require('node:timers');
const output = path.resolve(__dirname, '../.cache/video-resolution'); fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const timeout = setTimeout(() => app.exit(1), 90000);
  try {
    const bundle = buildSync({ stdin: { contents: `export { MeshManager } from './apps/desktop/src/rtc/MeshManager';`, resolveDir: path.resolve(__dirname, '..') }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ResolutionTest' }).outputFiles[0].text;
    await win.loadURL('about:blank'); await win.webContents.executeJavaScript(bundle);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (value, message) => { if (!value) throw new Error(message); };
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      async function until(fn, message) { const end = Date.now() + 12000; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw new Error(message); }
      const buses = new Map(); const meshes = []; const tracks = []; const canvases = [];
      function signal(id) {
        const listeners = new Map(); buses.set(id, listeners);
        return { on(event, cb) { listeners.set(event, cb); return () => listeners.delete(event); },
          sendOffer(to, sdp) { setTimeout(() => buses.get(to)?.get('offer')?.(id, { sdp }), 0); },
          sendAnswer(to, sdp) { setTimeout(() => buses.get(to)?.get('answer')?.(id, { sdp }), 0); },
          sendIceCandidate(to, payload) { setTimeout(() => buses.get(to)?.get('iceCandidate')?.(id, payload), 0); } };
      }
      function mesh(id, height) { const m = new ResolutionTest.MeshManager({ selfPeerId: id, signaling: signal(id), iceServers: [], videoResolution: height }); m.attach(); meshes.push(m); return m; }
      function source(width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvases.push(canvas); canvas.getContext('2d').fillRect(0,0,width,height); const stream = canvas.captureStream(15); tracks.push(...stream.getTracks()); return stream.getVideoTracks()[0]; }
      const paint = setInterval(() => canvases.forEach(canvas => { const c = canvas.getContext('2d'); c.fillStyle = Date.now() % 2 ? 'red' : 'blue'; c.fillRect(0,0,canvas.width,canvas.height); }), 50);
      const sender = mesh('z', 540), a = mesh('a'), b = mesh('b');
      const first = source(1920,1080); sender.setLocalTrack('video', first); sender.setUserFps(30);
      sender.syncPeers(['z','a','b']); a.syncPeers(['a','z']); b.syncPeers(['b','z']);
      async function params(ids, target, sourceHeight, fps, cap) {
        const expected = Math.max(1, sourceHeight / target);
        await until(() => ids.every(id => { const link = sender.getLink(id); const p = link?.readEncodingParams(); return p && Math.abs(p.scaleResolutionDownBy - expected) < 0.001 && p.maxFramerate === fps && (!cap || p.maxBitrate <= cap) && link.pc.getTransceivers().find(t => t.sender.track?.kind === 'video')?.sender.getParameters().degradationPreference === 'maintain-resolution'; }), 'Wrong sender parameters for ' + target + 'p/' + fps + 'fps');
      }
      async function decoded(viewer, height) { await until(async () => (await viewer.getLink('z').readStats()).inbound?.frameHeight === height, 'Decoded height did not reach ' + height); }
      try {
        await until(() => ['a','b'].every(id => sender.getLink(id)?.state === 'connected'), 'Viewers did not connect');
        await params(['a','b'], 540, 1080, 30); await decoded(a, 540); await decoded(b, 540);
        canvases[0].width = 1280; canvases[0].height = 720;
        await until(() => first.getSettings().height === 720, 'Same-track capture did not resize');
        await Promise.all(['a','b'].map(id => sender.getLink(id).readStats()));
        await params(['a','b'],540,720,30); await decoded(a,540);
        canvases[0].width = 1920; canvases[0].height = 1080;
        await until(() => first.getSettings().height === 1080, 'Same-track capture did not restore');
        await Promise.all(['a','b'].map(id => sender.getLink(id).readStats()));
        const audioBefore = sender.getLink('a').pc.getTransceivers().slice(1).map(t => t.sender.getParameters().encodings?.map(e => e.maxBitrate ?? null));
        for (const height of [360,1080,540]) { sender.setVideoResolution(height); await params(['a','b'], height,1080,30); await decoded(a,height); }
        sender.setVideoResolution(360); sender.setUserFps(120); sender.setVideoBitrateLimit(1000000);
        await params(['a','b'],360,1080,120,1000000);
        await Promise.all(['a','b'].map(id => sender.getLink(id).setQuality('FOCUS_HIGH')));
        await params(['a','b'],360,1080,120,1000000);
        await decoded(a,360);
        sender.setVideoResolution(1080); sender.setUserFps(60);
        sender.setLocalTrack('video',source(1280,720)); await params(['a','b'],1080,720,60,1000000); await decoded(a,720);
        const c = mesh('c'); sender.syncPeers(['z','a','b','c']); c.syncPeers(['c','z']);
        await until(() => sender.getLink('c')?.state === 'connected','Late viewer did not connect'); await params(['a','b','c'],1080,720,60,1000000); await decoded(c,720);
        const link = sender.getLink('a'); const old = link.pc.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1]; link.pc.restartIce();
        await until(() => link.pc.localDescription?.sdp.match(/a=ice-ufrag:(.*)/)?.[1] !== old && link.pc.signalingState === 'stable' && link.state === 'connected','ICE restart failed'); await params(['a','b','c'],1080,720,60,1000000);
        sender.syncPeers(['z','a','c']); b.syncPeers(['b']); sender.syncPeers(['z','a','b','c']); b.syncPeers(['b','z']);
        await until(() => sender.getLink('b')?.state === 'connected','Reconnect failed'); await params(['a','b','c'],1080,720,60,1000000);
        sender.setLocalTrack('video',source(320,180)); await params(['a','b','c'],1080,180,60,1000000); await decoded(a,180);
        const audioAfter = link.pc.getTransceivers().slice(1).map(t => t.sender.getParameters().encodings?.map(e => e.maxBitrate ?? null));
        check(JSON.stringify(audioBefore) === JSON.stringify(audioAfter),'Audio parameters changed');
        return { decoded3605401080:true, allViewers:true, remoteRequestsIgnored:true, independentFps:true, bitrateCap:true, liveSourceResize:true, sourceReplacement:true, noUpscale:true, lateViewer:true, iceRestart:true, reconnect:true, audioUnchanged:true };
      } finally { clearInterval(paint); tracks.forEach(t => t.stop()); meshes.forEach(m => m.close()); }
    })()`);
    console.log('PASS: manual video resolution runtime checks', JSON.stringify(result));
    clearTimeout(timeout); win.destroy(); app.exit(0);
  } catch (error) { clearTimeout(timeout); console.error(error); win.destroy(); app.exit(1); }
});

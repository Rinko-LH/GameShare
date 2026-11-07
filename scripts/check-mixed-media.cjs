'use strict';
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const os = require('node:os');
const path = require('node:path');
const { clearTimeout } = require('node:timers');
app.setPath('userData', path.resolve(__dirname, '../.cache/mixed-media-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const timer = setTimeout(() => app.exit(1), 55000);
  try {
    const address = Object.values(os.networkInterfaces()).flat().find(item => item && !item.internal && item.family === 'IPv4')?.address;
    if (!address) throw new Error('This local test requires an active IPv4 adapter');
    const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../apps/desktop/src/rtc/PeerLink.ts')], bundle: true, write: false, format: 'iife', globalName: 'MixedMediaTest', platform: 'browser' }).outputFiles[0].text;
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(bundle);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const ip = ${JSON.stringify(address)};
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      async function until(check, label) {
        const end = Date.now() + 10000;
        while (Date.now() < end) { if (await check()) return; await pause(100); }
        throw new Error(label);
      }
      async function pair(restart, checkGuard) {
        let a, b;
        const candidates = [];
        const signal = target => ({
          sendOffer: (_, sdp) => { void target().handleOffer(sdp); },
          sendAnswer: (_, sdp) => { void target().handleAnswer(sdp); },
          sendIceCandidate: (_, candidate) => { candidates.push(candidate.candidate); void target().handleIceCandidate(candidate); },
        });
        a = new MixedMediaTest.PeerLink({ selfPeerId: 'z', remotePeerId: 'a', signaling: signal(() => b), iceServers: [], selectedMediaIp: ip });
        b = new MixedMediaTest.PeerLink({ selfPeerId: 'a', remotePeerId: 'z', signaling: signal(() => a), iceServers: [], selectedMediaIp: ip });
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
        const ctx = canvas.getContext('2d');
        let hue = 0;
        const paint = setInterval(() => { ctx.fillStyle = 'hsl(' + (hue += 31) + ',100%,50%)'; ctx.fillRect(0,0,160,90); }, 50);
        const stream = canvas.captureStream(15);
        try {
          await a.setLocalTrack('video', stream.getVideoTracks()[0]);
          await until(async () => { const s = await b.readStats(); return b.state === 'connected' && s.inbound?.framesDecoded > 2; }, 'Selected-IP video did not decode');
          const first = await a.readStats();
          assert(first.route?.localAddress === ip && !first.route.relay, 'Initial media path must match selection');
          assert(candidates.length > 0 && candidates.every(c => c.split(' ')[4] === ip), 'Published candidates must all match selection');
          // 对齐 500ms 路径守卫，界面采样必须仍有正常的收/发码率。
          await Promise.all([a.readStats(), b.readStats()]);
          for (let sample = 0; sample < 3; sample++) {
            await pause(1000);
            const [sent, received] = await Promise.all([a.readStats(), b.readStats()]);
            assert(sent.outbound?.bitrateBps > 0 && received.inbound?.bitrateBps > 0, 'IP guard must not erase live video bitrate');
          }
          if (restart) {
            const oldUfrag = a.pc.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1];
            a.pc.restartIce();
            await until(async () => {
              const fresh = a.pc.localDescription?.sdp.match(/a=ice-ufrag:(.*)/)?.[1];
              const stats = await a.pc.getStats();
              const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
              const selected = transport && stats.get(transport.selectedCandidatePairId);
              const local = selected && stats.get(selected.localCandidateId);
              return fresh !== oldUfrag && local?.usernameFragment === fresh && a.state === 'connected';
            }, 'ICE restart did not select a fresh candidate');
            assert((await a.readStats()).route?.localAddress === ip, 'Restart path must match selection');
          }
          if (checkGuard) {
            // Fault injection exercises the real PeerLink fail-closed observer; it is
            // not evidence that native sockets are bound to an interface.
            const read = a.stats.read.bind(a.stats);
            a.stats.read = async (pc, options) => { const stats = await read(pc, options); if (stats.route) stats.route.localAddress = '203.0.113.250'; return stats; };
            await until(() => a.state === 'failed', 'Background route-only guard did not stop an unexpected IP');
            assert(a.state === 'failed' && a.pc.connectionState === 'closed', 'Unexpected local address must stop media');
            assert(a.diagnosis.summary.includes('203.0.113.250'), 'Failure must name the actual address');
          }
          return { decodedVideo: true, liveBitrate: true, matchingRoute: true, restart, guardChecked: checkGuard };
        } finally { clearInterval(paint); stream.getTracks().forEach(t => t.stop()); a.close(); b.close(); }
      }
      return { initialAndRestart: await pair(true, true), reconnect: await pair(false, false), strictNativeBindingVerified: false };
    })()`);
    console.log('PASS: actual PeerLink selected-IP video, ICE restart, reconnect and unexpected-route shutdown', JSON.stringify(result));
    clearTimeout(timer); win.destroy(); app.exit(0);
  } catch (error) { clearTimeout(timer); console.error(error); app.exit(1); }
});

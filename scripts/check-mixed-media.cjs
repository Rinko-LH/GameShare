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
        const paint = setInterval(() => { ctx.fillStyle = Date.now() % 2 ? 'red' : 'blue'; ctx.fillRect(0,0,160,90); }, 50);
        const stream = canvas.captureStream(15);
        try {
          await a.setLocalTrack('video', stream.getVideoTracks()[0]);
          await until(async () => { const s = await b.readStats(); return b.state === 'connected' && s.inbound?.framesDecoded > 2; }, 'Selected-IP video did not decode');
          const first = await a.readStats();
          assert(first.route?.localAddress === ip && !first.route.relay, 'Initial media path must match selection');
          assert(candidates.length > 0 && candidates.every(c => c.split(' ')[4] === ip), 'Published candidates must all match selection');
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
            a.stats.read = async pc => { const stats = await read(pc); if (stats.route) stats.route.localAddress = '203.0.113.250'; return stats; };
            await a.readStats();
            assert(a.state === 'failed' && a.pc.connectionState === 'closed', 'Unexpected local address must stop media');
            assert(a.diagnosis.summary.includes('203.0.113.250'), 'Failure must name the actual address');
          }
          return { decodedVideo: true, matchingRoute: true, restart, guardChecked: checkGuard };
        } finally { clearInterval(paint); stream.getTracks().forEach(t => t.stop()); a.close(); b.close(); }
      }
      return { initialAndRestart: await pair(true, true), reconnect: await pair(false, false), strictNativeBindingVerified: false };
    })()`);
    console.log('PASS: actual PeerLink selected-IP video, ICE restart, reconnect and unexpected-route shutdown', JSON.stringify(result));
    clearTimeout(timer); win.destroy(); app.exit(0);
  } catch (error) { clearTimeout(timer); console.error(error); app.exit(1); }
});

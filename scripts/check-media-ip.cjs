/** Negative control: withholding candidates is not local IP binding. No app settings are changed. */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { clearTimeout } = require('node:timers');
app.setPath('userData', path.resolve(__dirname, '../.cache/media-ip-profile'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const timer = setTimeout(() => { console.error('Media IP probe timed out'); app.exit(1); }, 45000);
  try {
    await win.loadURL('about:blank');
    const results = await win.webContents.executeJavaScript(`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      async function trial(restart) {
        const a = new RTCPeerConnection({ iceServers: [] });
        const b = new RTCPeerConnection({ iceServers: [] });
        const pending = [];
        let withheld = 0;
        a.onicecandidate = e => { if (e.candidate) withheld++; };
        b.onicecandidate = e => { if (e.candidate) {
          if (a.remoteDescription) void a.addIceCandidate(e.candidate).catch(() => {});
          else pending.push(e.candidate);
        } };
        a.createDataChannel('probe');
        async function negotiate(iceRestart) {
          const offer = await a.createOffer({ iceRestart });
          await a.setLocalDescription(offer);
          // Send the original SDP, before gathering has added any candidates.
          await b.setRemoteDescription(offer);
          const answer = await b.createAnswer();
          await b.setLocalDescription(answer);
          await a.setRemoteDescription(answer);
          for (const candidate of pending.splice(0)) await a.addIceCandidate(candidate);
          const end = Date.now() + 10000;
          while (Date.now() < end && a.connectionState !== 'connected') await pause(100);
          await pause(500);
          const stats = await a.getStats();
          const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
          const pair = transport && stats.get(transport.selectedCandidatePairId);
          const local = pair && stats.get(pair.localCandidateId);
          const remote = pair && stats.get(pair.remoteCandidateId);
          return { state: a.connectionState, local, remote, withheld };
        }
        try {
          const initial = await negotiate(false);
          const afterRestart = restart ? await negotiate(true) : null;
          return { initial, afterRestart };
        } finally { a.close(); b.close(); }
      }
      return { firstConnection: await trial(true), reconnect: await trial(false) };
    })()`);
    const output = path.resolve(__dirname, '../.cache/media-ip-probe.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const demonstrated = results.firstConnection.initial.state === 'connected'
      && results.firstConnection.initial.withheld > 0
      && results.firstConnection.afterRestart.state === 'connected'
      && results.reconnect.initial.state === 'connected'
      && results.firstConnection.initial.local?.usernameFragment
      !== results.firstConnection.afterRestart.local?.usernameFragment;
    fs.writeFileSync(output, JSON.stringify({ electron: process.versions.electron,
      interfaces: os.networkInterfaces(), results, candidateFilteringIsNotBinding: demonstrated,
      strictBindingVerified: false }, null, 2));
    console.log(JSON.stringify({ initial: results.firstConnection.initial.state, iceRestart: results.firstConnection.afterRestart.state, reconnect: results.reconnect.initial.state, candidateFilteringIsNotBinding: demonstrated, strictBindingVerified: false, output }, null, 2));
    if (!demonstrated) throw new Error('Negative control inconclusive; strict binding remains unverified');
    clearTimeout(timer);
    win.destroy();
    app.exit(0);
  } catch (error) { clearTimeout(timer); console.error(error); app.exit(1); }
});

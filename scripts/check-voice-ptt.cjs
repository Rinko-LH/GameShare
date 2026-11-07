'use strict';
const {app,BrowserWindow}=require('electron');
const {buildSync}=require('esbuild');
const path=require('node:path');
const fs=require('node:fs');
const {clearTimeout}=require('node:timers');
const root=path.resolve(__dirname,'..'), out=path.join(root,'.cache/voice-ptt');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
  const timeout=setTimeout(()=>app.exit(1),90000);let server;
  try{
    const serverFile=path.join(out,'server.cjs');
    buildSync({entryPoints:[path.join(root,'apps/signaling/src/embed.ts')],bundle:true,platform:'node',format:'cjs',external:['socket.io'],outfile:serverFile});
    server=require(serverFile).createSignalingServer({port:0,host:'127.0.0.1',corsOrigins:'*'});const listening=await server.listen();
    const bundle=buildSync({stdin:{contents:`export { ShareSession } from './apps/desktop/src/session/ShareSession';`,resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',globalName:'VoiceTest'}).outputFiles[0].text;
    await win.loadURL('about:blank');await win.webContents.executeJavaScript(bundle);
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const check=(ok,msg)=>{if(!ok)throw Error(msg);}, pause=ms=>new Promise(r=>setTimeout(r,ms));
      async function until(fn,msg){const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await pause(70);}throw Error(msg);}
      const sessions=[],contexts=[]; const NativeAudioContext=window.AudioContext; window.AudioContext=class extends NativeAudioContext{constructor(){super({sinkId:{type:'none'}});}};
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{const c=new AudioContext(),tone=c.createOscillator(),gain=c.createGain(),dest=c.createMediaStreamDestination();tone.frequency.value=660;gain.gain.value=.15;tone.connect(gain).connect(dest);tone.start();await c.resume();contexts.push(c);return dest.stream;}}});
      const sender=new VoiceTest.ShareSession(),viewer=new VoiceTest.ShareSession();sessions.push(sender,viewer);
      async function join(s,room){await s.connectAndWait(${JSON.stringify('http://127.0.0.1:') }+${listening.port},true);await s.joinRoom(room,'viewer');}
      function energy(s,id,role){const track=s.getState().remoteTracks[id][role],player=document.createElement('audio');player.srcObject=new MediaStream([track]);player.autoplay=true;document.body.append(player);const c=new AudioContext(),sink=c.createGain();sink.gain.value=0;c.createMediaElementSource(player).connect(sink).connect(c.destination);contexts.push(c);c.resume();player.play().catch(()=>{});return async()=>{const report=await s.mesh.getLink(id).pc.getStats();const audio=[...report.values()].find(r=>r.type==='inbound-rtp'&&r.kind==='audio'&&r.trackIdentifier===track.id);return audio?.audioLevel??0;};}
      try{
        await sender.connectAndWait('http://127.0.0.1:'+${listening.port},true);const room=await sender.createRoom('sender');
        sender.setVoiceMode('push-to-talk');await sender.setMicEnabled(true);const original=sender.mic.track;
        check(!original.enabled,'Initial PTT microphone leaked');
        await sender.startShare({testPattern:true,width:320,height:180,fps:15,toneHz:880,toneGain:.1});
        await join(viewer,room.roomCode);const id=sender.getState().room.self.peerId;
        await until(()=>viewer.getState().remoteTracks[id]?.voice&&viewer.getState().remoteTracks[id]?.appAudio,'Remote tracks missing');
        const voice=energy(viewer,id,'voice'),appAudio=energy(viewer,id,'appAudio');
        await until(()=>Object.values(sender.getState().links).every(l=>l.state==='connected'),'Media did not connect');await until(async()=>await appAudio()>.001,'App audio missing').catch(async e=>{const r=await viewer.mesh.getLink(id).pc.getStats();throw Error(e.message+' '+JSON.stringify({track:viewer.getState().remoteTracks[id].appAudio.id,stats:[...r.values()].filter(x=>x.type==='inbound-rtp'&&x.kind==='audio')}));});await pause(300);check(await voice()<.001,'Voice must start silent');
        let offers=0;const offer=sender.signaling.sendOffer.bind(sender.signaling);sender.signaling.sendOffer=(...args)=>{offers++;return offer(...args);};
        const video=sender.capture.track,audio=sender.capture.audioTrack;
        sender.setVoiceHeld('button',true);await until(async()=>await voice()>.01,'Button did not transmit');
        sender.setVoiceHeld('keyboard',true);sender.setVoiceHeld('button',false);check(original.enabled,'Releasing one source muted another held source');
        const released=performance.now();sender.setVoiceHeld('keyboard',false);check(!original.enabled&&performance.now()-released<100,'Local release was slow');
        await until(async()=>await voice()<.001,'Release did not mute remote voice');check(await appAudio()>.001,'Release muted app audio');
        for(let i=0;i<20;i++){sender.setVoiceHeld('keyboard',true);sender.setVoiceHeld('keyboard',false);}
        check(sender.mic.track===original&&sender.capture.track===video&&sender.capture.audioTrack===audio,'PTT replaced media tracks');check(offers===0,'PTT caused renegotiation');
        const late=new VoiceTest.ShareSession();sessions.push(late);await join(late,room.roomCode);
        await until(()=>late.getState().remoteTracks[id]?.voice,'Late viewer voice missing');const lateVoice=energy(late,id,'voice');await pause(300);check(await lateVoice()<.001,'Late viewer heard unheld mic');
        sender.setVoiceHeld('keyboard',true);await until(async()=>await voice()>.01&&await lateVoice()>.01,'All viewers must hear held speech');
        sender.setVoiceMode('push-to-talk');await until(async()=>await voice()<.001&&await lateVoice()<.001,'Mode reset must clear holds');
        sender.setVoiceMode('continuous');await until(async()=>await voice()>.01,'Continuous mode missing');sender.setVoiceMode('push-to-talk');
        await viewer.leaveRoom();await viewer.joinRoom(room.roomCode,'reconnected');
        await until(()=>viewer.getState().remoteTracks[id]?.voice,'Reconnect voice missing');const reconnected=energy(viewer,id,'voice');
        sender.setVoiceHeld('button',true);await until(async()=>await reconnected()>.01,'Reconnect PTT failed');sender.setVoiceHeld('button',false);await until(async()=>await reconnected()<.001,'Reconnect release failed');
        original.dispatchEvent(new Event('ended'));check(!sender.getState().micEnabled&&!sender.getState().micTransmitting,'Device loss did not stop voice');
        await sender.setMicEnabled(true);const closing=sender.mic.track;sender.setVoiceHeld('keyboard',true);await sender.leaveRoom();check(closing.readyState==='ended'&&!sender.getState().micTransmitting,'Room leave did not release mic');
        return {initialSilence:true,remoteAudioEnergy:true,combinedInputs:true,releaseUnder100ms:true,noRenegotiation:true,lateViewer:true,reconnect:true,continuousMode:true,videoAndAppAudioUnaffected:true,deviceLoss:true,leaveRelease:true};
      }finally{sessions.forEach(s=>s.dispose());await Promise.all(contexts.map(c=>c.close()));}
    })()`);
    console.log('PASS: actual WebRTC push-to-talk',JSON.stringify(result));clearTimeout(timeout);await server.close();win.destroy();app.exit(0);
  }catch(error){clearTimeout(timeout);console.error(error);if(server)await server.close();win.destroy();app.exit(1);}
});

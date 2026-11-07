'use strict';
// Interactive native-input fixture: use Computer Use to press V in the test window.
const {app,BrowserWindow}=require('electron');
const {buildSync}=require('esbuild');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.cache/voice-ptt');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,`native-profile-${process.pid}`));
app.whenReady().then(async()=>{
  const modulePath=path.join(out,'native-hotkey.cjs');
  buildSync({entryPoints:[path.join(root,'apps/desktop/electron/voice-hotkey.ts')],bundle:true,platform:'node',format:'cjs',external:['electron','koffi'],outfile:modulePath});
  const {registerVoiceHotkeyHandlers,setVoiceHotkeyHost}=require(modulePath);registerVoiceHotkeyHandlers();
  const host=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'apps/desktop/dist-electron/preload.cjs'),sandbox:false,contextIsolation:false,backgroundThrottling:false}});
  setVoiceHotkeyHost(host);await host.loadURL('about:blank');
  await host.webContents.executeJavaScript(`window.voiceNativeEvents=[];window.gameShare.voiceHotkey.onState(s=>window.voiceNativeEvents.push({...s,time:performance.now()}));window.gameShare.voiceHotkey.configure({active:true,binding:{code:'KeyV',ctrl:false,alt:false,shift:false}})`);
  const game=new BrowserWindow({width:640,height:340,title:'GameShare PTT Keyboard Test V',webPreferences:{backgroundThrottling:false}});
  await game.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>GameShare PTT Keyboard Test V</title><h1>PTT keyboard test</h1><p>Press V. Keys should reach this window while the voice host is in the background.</p><p>No microphone or screen recording is used.</p>'));
  const keys=[];game.webContents.on('before-input-event',(_event,input)=>{if(input.code==='KeyV')keys.push({type:input.type,time:Date.now()});});
  let finishing=false;
  const timer=setInterval(async()=>{
    if(finishing)return;
    const events=await host.webContents.executeJavaScript('window.voiceNativeEvents');
    fs.writeFileSync(path.join(out,'native-v-result.json'),JSON.stringify({keys,events,foregroundGame:game.isFocused()},null,2));
    if(events.some(e=>e.pressed)&&events.at(-1)?.pressed===false&&keys.some(k=>k.type==='keyDown')&&keys.some(k=>k.type==='keyUp')){
      finishing=true;clearInterval(timer);
      console.log('PASS: native global V down/up detected while backgrounded; foreground window also received key down/up');
      host.destroy();game.destroy();app.quit();
    }
  },100);
  setTimeout(()=>{if(!finishing){clearInterval(timer);host.destroy();game.destroy();app.exit(1);}},120000);
  console.log('READY: press V in GameShare PTT Keyboard Test V');
});

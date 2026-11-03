import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'.cache/view-mode-review');fs.mkdirSync(out,{recursive:true});
const require=createRequire(path.join(root,'package.json')), electron=require('electron');
let nextDebugPort=19430;
const clients=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){let last;for(let n=0;n<100;n++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await sleep(200);}throw new Error(label+': '+(last?.message??''));}
async function open(name){
 const port=await until(async()=>{const p=nextDebugPort++;return await new Promise(resolve=>{const server=net.createServer();server.on('error',()=>resolve(false));server.listen(p,'127.0.0.1',()=>server.close(()=>resolve(p)));});},'free debugger port');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
 const child=spawn(electron,[path.join(root,'apps/desktop'),`--remote-debugging-port=${port}`,'--inspect=0',`--user-data-dir=${path.join(out,name)}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--mute-audio'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const c={child,get logs(){return logs;},close(){this.ws?.close();if(child.exitCode===null)child.kill();fs.writeFileSync(path.join(out,name+'.log'),logs);}};clients.push(c);
 const target=await until(async()=>{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();return list.find(x=>x.type==='page'&&x.url.includes('index.html'));},'renderer');
 c.ws=new globalThis.WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>c.ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();c.ws.addEventListener('message',({data})=>{const p=JSON.parse(data);pending.get(p.id)?.(p);});
 c.cmd=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},10000);pending.set(n,p=>{clearTimeout(timer);pending.delete(n);if(p.error)reject(new Error(p.error.message));else resolve(p.result);});c.ws.send(JSON.stringify({id:n,method,params}));});
 c.eval=async expression=>{const r=await c.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 c.click=async text=>{await until(()=>c.eval(`Array.from(document.querySelectorAll('button')).some(b=>b.innerText.trim()===${JSON.stringify(text)}&&!b.disabled)`),text+' available');await c.eval(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()===${JSON.stringify(text)}).click()`);};
 c.fill=async(selector,value,tag='HTMLInputElement')=>{await c.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
 c.shot=async name=>{const s=await c.cmd('Page.captureScreenshot');fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(s.data,'base64'));};
 await until(()=>c.eval('Boolean(document.querySelector(".mode-chooser,.ip-connect"))'),'UI');
 await c.eval('window.__reviewReloadPending=true;localStorage.removeItem("gs.connectionMode");location.reload();true');await until(()=>c.eval('!window.__reviewReloadPending && document.querySelectorAll(".mode-card").length===4'),'chooser');await c.eval('document.querySelectorAll(".mode-card")[1].click()');await until(()=>c.eval('Boolean(document.querySelector(".ip-connect"))'),'panel');return c;
}
const extraSockets=[];
async function attach(url) {
 const ws=new globalThis.WebSocket(url);extraSockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',({data})=>{const p=JSON.parse(data);pending.get(p.id)?.(p);});
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},10000);pending.set(n,p=>{clearTimeout(timer);pending.delete(n);if(p.error)reject(new Error(p.error.message));else resolve(p.result);});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};return {cmd,eval:evaluate};
}
async function join(c,room) {await c.eval('document.querySelector(".connection-roles input[value=guest]").click()');await until(()=>c.eval('Boolean(document.querySelector(".ip-connect textarea"))'),'guest form');await c.fill('.ip-connect textarea','GS1.'+Buffer.from(JSON.stringify({server:'http://[::1]:8080',room})).toString('base64'),'HTMLTextAreaElement');await c.click('连接并加入');await until(()=>c.eval('Boolean(document.querySelector(".roomcode__value"))'),'joined');}
try {
 const a=await open('host'),b=await open('viewer'),c=await open('sender-two');
 await a.click('创建房间');const room=await until(()=>a.eval('document.querySelector(".roomcode__value")?.innerText'),'created');await join(b,room);await join(c,room);
 await a.click('测试源');await a.click('开启麦克风');await c.click('测试源');
 await until(()=>b.eval('Array.from(document.querySelectorAll(".tile video")).filter(v=>v.videoWidth>0).length===2'),'two decoded sources');
 const inspector=await until(()=>b.logs.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1],'main inspector');
 const native=await attach(inspector);
 const windows=()=>native.eval("process.mainModule.require('electron').BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL(),bounds:w.getBounds(),visible:w.isVisible(),focusable:w.isFocusable(),top:w.isAlwaysOnTop(),opacity:w.getOpacity(),fullscreen:w.isFullScreen()}))");
 await native.eval("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('floatTile=')).show()");const before=(await windows()).find(w=>!w.url.includes('floatTile='));assert.ok(before);const firstTitle=await b.eval('document.querySelector(".grid > .tile .tile__title").innerText');
 await b.eval('window.gameShare.windowMode.setEnabled(true)');await until(()=>b.eval('document.querySelector(".app")?.classList.contains("app--tiles")'),'floating UI');
 await until(async()=> (await windows()).filter(w=>w.url.includes('floatTile=')).length===2,'two floating windows');
 const active=await windows(),main=active.find(w=>w.id===before.id),tiles=active.filter(w=>w.id!==before.id);
 assert.deepEqual(main.bounds,before.bounds,'Main window resized on floating entry');assert.equal(main.visible,true);assert.equal(main.focusable,true);assert.equal(main.top,false);assert.equal(main.opacity,1);assert.ok(tiles.every(w=>w.top&&!w.focusable));
 assert.equal(await b.eval('getComputedStyle(document.querySelector(".app__header")).display'), 'flex');
 assert.equal(await b.eval('getComputedStyle(document.querySelector(".stage--tiles > .grid")).opacity'),'0');
 assert.equal(await b.eval('document.querySelectorAll(".hostbar,.floatbar,.hostball").length'),0);
 const first=tiles.find(w=>new URL(w.url).searchParams.get('floatTile')==='0');const devPort=Number(b.logs.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)[1]);
 const target=await until(async()=>{const list=await(await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();return list.find(t=>t.url===first.url);},'tile debugger');
 const tile=await attach(target.webSocketDebuggerUrl);
 await until(()=>tile.eval('document.querySelector(".tilewin")?.classList.contains("tilewin--idle")===false'),'floating canvas frames');
 const capture=await tile.cmd('Page.captureScreenshot');fs.writeFileSync(path.join(out,'independent-window.png'),Buffer.from(capture.data,'base64'));
 await b.shot('main-floating-controls');
 const audioCount=await b.eval('document.querySelectorAll("audio").length');await tile.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:180,y:100});await tile.eval(`(()=>{const el=document.querySelector('.tilewin__volume input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'25');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await until(()=>b.eval('Array.from(document.querySelectorAll("audio")).filter(e=>e.volume===0.25).length===2'),'target member volume applied');
 assert.equal(await b.eval('Array.from(document.querySelectorAll("audio")).filter(e=>e.volume===1&&!e.muted).length'),audioCount-2,'Other member volume changed');
 await tile.eval('document.querySelector(".tilewin__mute").click()');await until(()=>b.eval('Array.from(document.querySelectorAll("audio")).filter(e=>e.muted).length===2'),'member mute');
 await tile.eval('document.querySelector(".tilewin__mute").click()');await until(()=>b.eval('Array.from(document.querySelectorAll("audio")).every(e=>!e.muted)'),'member unmute');
 const alpha=(await b.eval('document.querySelector(".view-opacity input").value'))==='55'?65:55;await b.fill('.view-opacity input',String(alpha));await until(async()=>{const w=await windows();return w.filter(x=>x.url.includes('floatTile=')).every(x=>Math.abs(x.opacity-alpha/100)<0.02);},'tile native opacity');assert.equal((await windows()).find(w=>w.id===before.id).opacity,1);
 await tile.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:180,y:100});await sleep(150);const tileShot=await tile.cmd('Page.captureScreenshot');fs.writeFileSync(path.join(out,'independent-volume.png'),Buffer.from(tileShot.data,'base64'));
 const pixels=await tile.eval('document.querySelector("canvas").toDataURL()');await native.eval("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('floatTile=')).minimize()");await sleep(500);assert.notEqual(await tile.eval('document.querySelector("canvas").toDataURL()'),pixels,'Floating frames froze after minimizing main');await native.eval("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('floatTile=')).restore()");
 console.log('PASS: main stays visible, unchanged, opaque and focusable; independent windows decode frames, share opacity, and isolate member volume/mute');
 await b.click('全屏模式');await until(()=>b.eval('!document.querySelector(".app__side")'),'sidebar collapsed');await until(()=>b.eval('Boolean(document.querySelector(".stage__main .tile"))'),'default shared view focused');assert.equal(await b.eval('document.querySelector(".stage__main .tile__title").innerText'),firstTitle);assert.equal(await b.eval('document.querySelectorAll(".stage__strip > .tile").length'),1);
 const wideMain=(await windows()).find(w=>w.id===before.id);assert.equal(wideMain.fullscreen,false);assert.deepEqual(wideMain.bounds,before.bounds);assert.equal((await windows()).filter(w=>w.url.includes('floatTile=')).length,0);assert.equal(await b.eval('getComputedStyle(document.querySelector(".app__header")).display'),'flex');await b.shot('main-wide-view');
 await b.click('全屏模式');await until(()=>b.eval('Boolean(document.querySelector(".app__side"))'),'sidebar expanded');assert.equal(await b.eval('Boolean(document.querySelector(".stage__main"))'),false);
 await b.eval('document.querySelector(".grid > .tile:last-child .tile__act").click()');await until(()=>b.eval('Boolean(document.querySelector(".stage__main"))'),'manually selected view');const selectedTitle=await b.eval('document.querySelector(".stage__main .tile__title").innerText');await b.click('全屏模式');await until(()=>b.eval('!document.querySelector(".app__side")'),'wide view with selection');assert.equal(await b.eval('document.querySelector(".stage__main .tile__title").innerText'),selectedTitle);await b.click('全屏模式');await until(()=>b.eval('Boolean(document.querySelector(".app__side"))'),'normal grid restored');
 console.log('PASS: wide mode automatically focuses the first shared view, preserves a selected view, and restores the grid on exit');
 await b.eval('window.gameShare.windowMode.setEnabled(true)');await until(async()=> (await windows()).filter(w=>w.url.includes('floatTile=')).length===2,'float again');
 await c.click('停止共享');await until(async()=> (await windows()).filter(w=>w.url.includes('floatTile=')).length===1,'stopped share closes tile');
 await b.click('离开房间');await until(async()=> (await windows()).filter(w=>w.url.includes('floatTile=')).length===0,'leave clears tiles');
 await b.eval('window.gameShare.windowMode.setEnabled(false)');await c.click('离开房间');await a.click('离开房间');
 console.log('PASS: wide view only collapses sidebar and keeps native bounds/titlebar; toggle restores sidebar; share-stop and room-leave clean up windows');
} finally {for(const ws of extraSockets)ws.close();for(const c of clients)c.close();}

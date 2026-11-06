import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const output = path.resolve('.cache/origin-test'); fs.mkdirSync(output,{recursive:true});
const file = path.join(output,'origin.mjs');
await build({entryPoints:['apps/desktop/electron/signaling-origin.ts'],bundle:true,platform:'node',format:'esm',outfile:file});
const {resolveSignalingOrigin} = await import(pathToFileURL(file));
let validV4=false;
const v4=http.createServer((req,res)=>{res.end(JSON.stringify(validV4?{ok:true,service:'game-share-signaling'}:{Browser:'Steam DevTools'}));});
const v6=http.createServer((req,res)=>{res.end(JSON.stringify({ok:true,service:'game-share-signaling'}));});
const listen=(server,options)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options,resolve);});
try {
 await listen(v4,{host:'127.0.0.1',port:0});const port=v4.address().port;
 await listen(v6,{host:'::1',port,ipv6Only:true});
 assert.equal(await resolveSignalingOrigin(port),`http://[::1]:${port}`);
 await new Promise(resolve=>v6.close(resolve));
 await assert.rejects(()=>resolveSignalingOrigin(port),/未找到有效/);
 validV4=true;assert.equal(await resolveSignalingOrigin(port),`http://127.0.0.1:${port}`);
 console.log('PASS: conflicting IPv4 service is rejected, correct IPv6 selected, valid IPv4 fallback supported');
} finally {v4.close();v6.close();}

// Local image -> actual production recognition -> independently transcribed expectations.
// No provider credentials or network/model requests. Full screenshots remain outside git.
import { _electron as electron } from 'playwright';import {build} from 'esbuild';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),truth=JSON.parse(fs.readFileSync('tests/fixtures/broadcast-truth.json','utf8'));
const root=process.env.WATCHMATE_FIXTURES||path.join(process.env.LOCALAPPDATA,'Temp');
const ids={newscore:'2188f6e9-ab38-42ef-b5c4-da6cca353f66',scoreboard:'27e04215-37f8-4165-89e2-8b14aed8d70c',compact:'0548554c-d6ac-468d-bd07-8ecf6f73d6b6',bpfull:'3402eac5-e245-48dc-bb45-8c90a284062e',scene:'71e703b6-62b5-40e4-9943-e6868cbb57d3',scoreboard2:'22fbf03a-4559-4121-bb40-481f4fcbd734',compact2:'dccc2be1-c7b5-4288-a22c-c41cddfcdd66'};
function data(name){const named=path.join(root,name+'.png');const file=fs.existsSync(named)?named:name.startsWith('observed')?`artifacts/replay-observed-0${name.slice(-1)}.png`:path.join(root,'codex-clipboard-'+ids[name]+'.png');return 'data:image/png;base64,'+fs.readFileSync(file).toString('base64');}
const env={...process.env,WATCHMATE_TEST_MODE:'1',WATCHMATE_DATA_DIR:path.resolve('.smoke-data/regression-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.WATCHMATE_DEV_URL;
await build({entryPoints:['src/ui/broadcast-vision.ts'],bundle:true,format:'iife',globalName:'Vision',outfile:'artifacts/regression.js'});
const executable=process.env.WATCHMATE_EXECUTABLE;
const app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],env});
const results={};const failures=[];
function verify(name,r,complete=true){const e=truth.cases[name];
 try{
  assert.equal(r.layout,e.layout,name+' layout');assert.equal(r.clock,e.clock,name+' clock');
  if(e.layout==='bp'){assert.equal(r.players.length,0);assert.deepEqual(r.picks.map(p=>p.championId),truth.heroes);return;}
  if(e.layout==='scene'){assert.equal(r.players.length,0);assert.deepEqual(r.victims,[]);return;}
  let heroes=e.heroes||truth.heroes;if(e.layout==='compact')heroes=[...heroes.slice(0,5).reverse(),...heroes.slice(5)];
  assert.equal(r.players.length,10);
  r.players.forEach((p,i)=>{
   if(complete||p.championId)assert.equal(p.championId,heroes[i],`${name} ${p.slot} champion`);
   if(e.levels[i]===null)assert.equal(p.level,undefined,`${name} ${p.slot} hidden level`);else assert.equal(p.level,e.levels[i],`${name} ${p.slot} level`);
   if(e.kda)assert.equal([p.kills,p.deaths,p.assists].join('/'),e.kda[i],`${name} ${p.slot} KDA`);
   else assert.equal(p.kills,undefined,`${name} compact must not invent KDA`);
  });
  assert.deepEqual(r.players.filter(p=>p.dead).map(p=>[p.slot,p.timer]),e.dead,name+' deaths');assert.deepEqual(r.victims,e.victims||[],name+' kill feed');
 }catch(error){failures.push(error.message);}
}
try{const page=await app.firstWindow();await page.evaluate(fs.readFileSync('artifacts/regression.js','utf8')+';window.Vision=Vision;window.v=new Vision.BroadcastVision()');
 async function read(name,reset=false,scale=1,forceStats=true){return page.evaluate(async({data,reset,scale,forceStats})=>{
  const v=window.v;if(reset)v.stop();await v.prepare();const im=new Image();im.src=data;await im.decode();const c=document.createElement('canvas');c.width=Math.round(im.width*scale);c.height=Math.round(im.height*scale);c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  // Force only the periodic statistics pass for a static fixture. Matching and cache rules are unchanged.
  if(forceStats)v.lastStats=0;
  return v.read(c);
 },{data:data(name),reset,scale,forceStats});}
 for(const name of ['newscore','compact2','compact']){const r=await read(name,true);results['isolated-'+name]=r;verify(name,r);console.log('isolated',name,r.status);}
 const sequence=['bpfull','scene','observed1','observed2','scoreboard2','scoreboard','observed3','compact2','observed4','compact'];
 for(const [index,name] of sequence.entries()){const r=await read(name,index===0);results['sequence-'+name]=r;verify(name,r);console.log('sequence',name,r.status,Math.round(r.elapsedMs)+'ms');}
 const fast=[];for(let i=0;i<3;i++)fast.push(await read('compact',false,1,false));results.fast=fast;
 for(const r of fast){assert.equal(r.players.find(p=>p.slot==='left-adc').timer,46);assert.deepEqual(r.victims,['Yunara']);}
 // Hold-out rendering scale: the algorithm must use geometry, not screenshot dimensions/IDs.
 const scaled=await read('compact2',true,.8);results.scaled=scaled;verify('compact2',scaled);
 // Deliberately grey a living champion's portrait and add misleading digits.
 // Its actual green health bar remains: timer OCR must not manufacture a death.
 const livingGrey=await page.evaluate(async data=>{
  const im=new Image();im.src=data;await im.decode();const source=document.createElement('canvas');source.width=im.width;source.height=im.height;source.getContext('2d').drawImage(im,0,0);
  const c=window.Vision.gameCanvas(source),ctx=c.getContext('2d');
  ctx.fillStyle='#555';ctx.fillRect(717,826,43,43);ctx.fillStyle='white';ctx.font='bold 22px Arial';ctx.fillText('12',723,853);
  window.v.lastStats=0;return window.v.read(c);
 },data('scoreboard2'));
 results.syntheticLivingGrey=livingGrey;
 assert.equal(livingGrey.players.find(p=>p.slot==='left-top').dead,false,'Live health bar must override grey face/digit illusion');
 const blank=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=1920;c.height=1200;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,1920,1200);return window.v.read(c);});
 results.blank=blank;assert.equal(blank.layout,'unknown');assert.equal(blank.players.length,0);assert.equal(blank.picks.length,0);assert.equal(blank.victims.length,0);
 fs.writeFileSync('artifacts/recognition-regression.json',JSON.stringify({packaged:!!executable,failures,results},null,2));
 console.log('Fast local frame times:',fast.map(r=>r.elapsedMs));
 assert.deepEqual(failures,[]);console.log('Recognition regression passed: 11 real frames, ordered context, held-out scale and blank scene.');
}finally{await app.close();}

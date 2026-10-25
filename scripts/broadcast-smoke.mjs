import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd();
const fixtures=process.env.WATCHMATE_FIXTURES||path.join(process.env.LOCALAPPDATA,'Temp');
const ids={scoreboard:'27e04215-37f8-4165-89e2-8b14aed8d70c',compact:'0548554c-d6ac-468d-bd07-8ecf6f73d6b6',bp:'3402eac5-e245-48dc-bb45-8c90a284062e'};
await build({entryPoints:['src/ui/broadcast-vision.ts'],bundle:true,format:'iife',globalName:'VisionTest',outfile:'artifacts/broadcast-test.js'});
const env={...process.env,WATCHMATE_DATA_DIR:path.join(root,'.smoke-data','broadcast-'+Date.now()),WATCHMATE_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.WATCHMATE_DEV_URL;
const packaged=process.env.WATCHMATE_EXECUTABLE;
const app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],env,cwd:root});
try{
 const page=await app.firstWindow();await page.evaluate(fs.readFileSync('artifacts/broadcast-test.js','utf8')+';window.VisionTest=VisionTest;window.visionTest=new VisionTest.BroadcastVision();');
 await page.evaluate(()=>window.visionTest.prepare());
 const reports={};
 for(const [layout,id] of Object.entries(ids)){
   const named=path.join(fixtures,`${layout==='bp'?'bpfull':layout}.png`);
   const data='data:image/png;base64,'+fs.readFileSync(fs.existsSync(named)?named:path.join(fixtures,`codex-clipboard-${id}.png`)).toString('base64');
   reports[layout]=await page.evaluate(async({data,layout})=>{
     const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);
     return await window.visionTest.read(c);
   },{data,layout});
 }
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/broadcast-regression.json',JSON.stringify({packaged:!!packaged,source:'user original screenshots; BP preview rectangle selected',reports},null,2));
 const s=reports.scoreboard,c=reports.compact;
 assert.equal(s.layout,'scoreboard');assert.equal(s.clock,844);
 assert.deepEqual(s.players.map(p=>p.name),['Xiaoxu','JunJia','HongQ','GALA','Vampire','TheShy','Wei','Rookie','JiaQi','Meiko']);
 assert.equal(s.players.find(p=>p.name==='JunJia').dead,true);assert.equal(s.players.find(p=>p.name==='JunJia').timer,16);
 const jun=s.players.find(p=>p.name==='JunJia');assert.deepEqual([jun.kills,jun.deaths,jun.assists],[1,1,1]);
 const shy=s.players.find(p=>p.name==='TheShy');assert.equal(shy.championId,'Gnar');assert.equal(shy.level,12);assert.deepEqual([shy.kills,shy.deaths,shy.assists],[0,0,0]);
 assert.equal(c.layout,'compact');assert.equal(c.clock,1987);assert.deepEqual(c.victims,['Yunara']);
 const gala=c.players.find(p=>p.slot==='left-adc');assert.equal(gala.championId,'Yunara');assert.equal(gala.dead,true);assert.equal(gala.timer,46);
 assert.deepEqual(c.players.filter(p=>p.dead).map(p=>p.slot),['left-adc']);
 assert.deepEqual(s.players.filter(p=>p.dead).map(p=>p.slot),['left-jungle']);
 assert.equal(reports.bp.layout,'bp');assert.equal(reports.bp.players.length,0);
 const expected=['Ambessa','Chogath','Orianna','Yunara','Seraphine','Gnar','Maokai','Syndra','Tristana','Lulu'];
 for(const p of c.players)assert.equal(p.championId,expected[['left-top','left-jungle','left-mid','left-adc','left-support','right-top','right-jungle','right-mid','right-adc','right-support'].indexOf(p.slot)]);
 assert.equal(s.players.find(p=>p.name==='HongQ').level,11);
 assert.equal(reports.bp.picks.length,10);
 for(const pick of reports.bp.picks)assert.equal(pick.championId,expected[(pick.side==='left'?0:5)+pick.position-1]);
 // Exercise actual IPC -> engine -> renderer -> local TTS with measured image readings.
 // The alive/dead transition below is synthetic: supplied images alone are not a video timeline.
 await app.evaluate(async({BrowserWindow})=>{const w=new BrowserWindow({width:400,height:200,show:false,title:'Broadcast regression source'});await w.loadURL('data:text/html,<title>Broadcast regression source</title>');w.showInactive();BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);});
 await page.evaluate(async({s,c})=>{
   const b=window.watchmate,state=await b.snapshot();
   await b.settings({...state.settings,apiKey:'synthetic-unused',searchKey:'',autoLearn:false,danmakuEnabled:false});
   await b.action({type:'start',mode:'live'});
   const source=(await b.sources()).find(x=>x.name==='Broadcast regression source');if(!source)throw Error('Missing test source');await b.selectSource(source.id);
   const at=Date.now();
   await b.broadcast({...s,at:at-1500,clock:1986,players:s.players.map(p=>({...p,dead:false,timer:null}))});
   await b.broadcast({...c,at:at-1000});await b.broadcast({...c,at:at-500});await b.broadcast({...c,at});
 },{s,c});
 let state;const deadline=Date.now()+20000;
 do {state=await page.evaluate(()=>window.watchmate.snapshot());if(state.messages.some(m=>m.kind==='banter'&&['playing','done'].includes(m.speechStatus)))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
 assert.ok(state.messages.some(m=>m.kind==='banter'&&['playing','done'].includes(m.speechStatus)),'Local speech did not start');
 assert.equal(state.metrics.deaths,1);assert.equal(state.messages.filter(m=>m.kind==='banter').length,1);
 assert.deepEqual(state.messages.find(m=>m.kind==='banter').targets,['left-adc']);
 await page.evaluate(()=>window.watchmate.action({type:'pause'}));
 fs.writeFileSync('artifacts/broadcast-integration.json',JSON.stringify({packaged:!!packaged,transition:'synthetic alive/dead timeline using original image readings',deaths:state.metrics.deaths,banter:state.messages.filter(m=>m.kind==='banter').map(m=>({targets:m.targets,text:m.text,speechStatus:m.speechStatus}))},null,2));
 console.log('Original screenshot regression passed:',{scoreboard:s.status,compact:c.status,bp:reports.bp.status});
 await page.evaluate(()=>window.visionTest.stop());
}finally{await app.close();}

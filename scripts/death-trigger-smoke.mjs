// Synthetic readings through real packaged IPC, engine and local SAPI playback.
// This is scheduling/attribution validation, not real-video accuracy or latency.
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd();
const env={...process.env,WATCHMATE_DATA_DIR:path.join(root,'.smoke-data','death-trigger-'+Date.now()),WATCHMATE_TEST_MODE:'1'};
delete env.ELECTRON_RUN_AS_NODE;delete env.WATCHMATE_DEV_URL;
const packaged=process.env.WATCHMATE_EXECUTABLE;
const app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:root,env});
const errors=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(async({BrowserWindow})=>{
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    const source=new BrowserWindow({width:400,height:200,show:false,title:'Death trigger regression'});
    await source.loadURL('data:text/html,<title>Death trigger regression</title>');source.showInactive();
  });
  await page.evaluate(async()=>{
    const b=window.watchmate,s=await b.snapshot();
    await b.settings({...s.settings,apiKey:'test-unused',autoLearn:false,danmakuEnabled:false});
    await b.action({type:'start',mode:'live'});
    const source=(await b.sources()).find(s=>s.name==='Death trigger regression');
    if(!source)throw Error('Missing isolated test source');await b.selectSource(source.id);
  });
  const start=Date.now();
  const send=async(players,victims=[])=>page.evaluate(({players,victims,start})=>window.watchmate.broadcast({at:Date.now(),elapsedMs:100,layout:'scoreboard',status:'synthetic attribution regression',clock:170+Math.floor((Date.now()-start)/1000),replay:false,picks:[],victims,players}),{players,victims,start});
  const p=(slot,name,championId,dead=false,deaths=0,kills=0)=>({slot,name,championId,confidence:.95,dead,timer:dead?12:null,deaths,kills,assists:0});
  const heng=p('left-jungle','Heng','Pantheon'),shy=p('right-top','TheShy','Gnar'),rookie=p('right-mid','Rookie','Aurora');
  const snapshot=()=>page.evaluate(()=>window.watchmate.snapshot());
  const jokes=s=>s.messages.filter(m=>m.kind==='banter');
  const waitSpeech=async count=>{
    const until=Date.now()+20000;
    while(Date.now()<until){const s=await snapshot();if(jokes(s).length===count&&['playing','done'].includes(jokes(s)[count-1].speechStatus))return;await wait(100);}
    throw Error('Expected actual local speech acknowledgement for message '+count);
  };
  await send([heng,shy,rookie]);await wait(500);await send([heng,shy,rookie]);await wait(500);
  const killed={...shy,dead:true,timer:12},killer={...heng,kills:1};
  await send([killer,killed],['Gnar']);await waitSpeech(1);
  assert.deepEqual(jokes(await snapshot())[0].targets,['right-top']);
  await send([{...killer,deaths:1},killed]);await wait(500);await send([killer,killed]);
  await wait(5500);await send([killer,{...killed,deaths:1}]);await wait(500);await send([killer,{...killed,deaths:1}]);
  await wait(800);assert.equal(jokes(await snapshot()).length,1,'Late counter must not replay the same death');
  await send([{...killer,dead:true,timer:12}]);await waitSpeech(2);
  assert.deepEqual(jokes(await snapshot())[1].targets,['left-jungle']);
  await page.evaluate(()=>window.watchmate.action({type:'broadcast-reset'}));
  await send([{...killer,dead:true,timer:11}]);await wait(6500);
  assert.equal(jokes(await snapshot()).length,2,'Cooldown duplicate must never be held for later output');
  await send([rookie]);await wait(500);await send([rookie]);await wait(500);
  await send([{...rookie,dead:null,deaths:1}]);await wait(800);
  assert.equal(jokes(await snapshot()).length,2);
  await send([{...rookie,dead:null,deaths:1}]);await waitSpeech(3);
  const state=await snapshot();assert.deepEqual(jokes(state)[2].targets,['right-mid']);
  assert.equal(state.usage.length,0);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.watchmate.action({type:'pause'}));assert.equal((await snapshot()).speech,null);
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/death-trigger-v0.5.1.json',JSON.stringify({packaged:!!packaged,passed:true,source:'synthetic readings via real IPC and SAPI; not match pixels',jokes:jokes(state).map(m=>({text:m.text,targets:m.targets,speechStatus:m.speechStatus})),errors},null,2));
  console.log('Killer attribution, OCR noise, late counter merge, per-player cooldown and actual local speech: passed');
}finally{await app.close();}

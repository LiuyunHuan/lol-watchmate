import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import http from 'node:http';
const require=createRequire(import.meta.url),root=process.cwd();
const fixtureDir=process.env.WATCHMATE_FIXTURES||path.join(process.env.LOCALAPPDATA,'Temp');
const image=(name,id)=>'data:image/png;base64,'+fs.readFileSync(fs.existsSync(path.join(fixtureDir,name+'.png'))?path.join(fixtureDir,name+'.png'):path.join(fixtureDir,'codex-clipboard-'+id+'.png')).toString('base64');
const pictures={scoreboard:image('scoreboard','27e04215-37f8-4165-89e2-8b14aed8d70c'),compact:image('compact','0548554c-d6ac-468d-bd07-8ecf6f73d6b6')};
const server=http.createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({phase:'unknown',gameSeconds:null,situation:'本机测试服务',players:[]})}}],usage:{prompt_tokens:1,completion_tokens:1}}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,WATCHMATE_DATA_DIR:path.join(root,'.smoke-data','capture-images-'+Date.now()),WATCHMATE_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.WATCHMATE_DEV_URL;
const packaged=process.env.WATCHMATE_EXECUTABLE;
const app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],env,cwd:root});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(async({BrowserWindow})=>{
   BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
   const source=new BrowserWindow({width:1280,height:800,frame:false,show:false,title:'LPL original screenshot test',webPreferences:{backgroundThrottling:false}});
   await source.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>LPL original screenshot test</title><body style="margin:0;background:black"><img id="image" style="width:100vw;height:100vh"></body>'));source.showInactive();
 });
 const source=(await app.windows()).find(p=>p!==page);
 await source.evaluate(async picture=>{const img=document.getElementById('image');img.src=picture;await img.decode();},pictures.scoreboard);
 await page.evaluate(async baseUrl=>{const b=window.watchmate,s=await b.snapshot();await b.settings({...s.settings,apiKey:'local-test-only',searchKey:'',baseUrl,autoLearn:false,danmakuEnabled:false,captureIntervalMs:60000});await b.action({type:'start',mode:'live'});},`http://127.0.0.1:${server.address().port}/v1`);
 await page.getByRole('button',{name:'选择窗口',exact:true}).click();await page.getByRole('button',{name:'LPL original screenshot test',exact:true}).click();
 const wait=async(layout)=>{let state;const until=Date.now()+60000;do{state=await page.evaluate(()=>window.watchmate.snapshot());if(state.broadcast?.layout===layout&&state.broadcast.clock!==null)return state;await new Promise(r=>setTimeout(r,300));}while(Date.now()<until);
   const capture=await page.evaluate(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return {width:c.width,height:c.height,data:c.toDataURL()};});
   fs.writeFileSync('artifacts/broadcast-captured.png',Buffer.from(capture.data.split(',')[1],'base64'));
   throw Error(JSON.stringify({layout,broadcast:state.broadcast,dimensions:[capture.width,capture.height],errors}));};
 const score=await wait('scoreboard');
 assert.equal(score.broadcast.clock,844);assert.deepEqual(score.broadcast.players.filter(p=>p.dead).map(p=>p.slot),['left-jungle']);
 await source.evaluate(picture=>{document.getElementById('image').src=picture;},pictures.compact);
 const compact=await wait('compact');
 assert.equal(compact.broadcast.clock,1987);assert.deepEqual(compact.broadcast.players.filter(p=>p.dead).map(p=>p.slot),['left-adc']);
 assert.deepEqual(compact.broadcast.victims,['Yunara']);
 await page.evaluate(()=>window.watchmate.action({type:'pause'}));
 assert.equal((await page.evaluate(()=>window.watchmate.snapshot())).speech,null);
 assert.deepEqual(errors,[]);
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/broadcast-capture.json',JSON.stringify({packaged:!!packaged,window:[1280,800],scoreboard:score.broadcast,compact:compact.broadcast,errors},null,2));
 console.log('Actual window capture of both original layouts passed at 1280x800.');
}finally{await app.close();server.close();}

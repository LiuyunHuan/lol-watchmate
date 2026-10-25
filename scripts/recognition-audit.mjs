// Offline regression against user-supplied full-resolution match frames. No provider calls.
import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const fixtures=process.env.WATCHMATE_FIXTURES||path.join(process.env.LOCALAPPDATA,'Temp');
const ids={newscore:'2188f6e9-ab38-42ef-b5c4-da6cca353f66',scoreboard:'27e04215-37f8-4165-89e2-8b14aed8d70c',compact:'0548554c-d6ac-468d-bd07-8ecf6f73d6b6'};
Object.assign(ids,{bpfull:'3402eac5-e245-48dc-bb45-8c90a284062e',scene:'71e703b6-62b5-40e4-9943-e6868cbb57d3',scoreboard2:'22fbf03a-4559-4121-bb40-481f4fcbd734',compact2:'dccc2be1-c7b5-4288-a22c-c41cddfcdd66'});
for(let i=1;i<=4;i++){const file=path.resolve(`artifacts/replay-observed-0${i}.png`);if(fs.existsSync(file))ids[`observed${i}`]=file;}
fs.mkdirSync('artifacts',{recursive:true});
await build({entryPoints:['src/ui/broadcast-vision.ts'],bundle:true,format:'iife',globalName:'VisionTest',outfile:'artifacts/recognition-audit.js'});
const env={...process.env,WATCHMATE_DATA_DIR:path.resolve('.smoke-data/audit-'+Date.now()),WATCHMATE_TEST_MODE:'1'};
delete env.ELECTRON_RUN_AS_NODE;delete env.WATCHMATE_DEV_URL;
const app=await electron.launch({executablePath:require('electron'),args:['.'],env});
try{
 const page=await app.firstWindow();
 await page.evaluate(fs.readFileSync('artifacts/recognition-audit.js','utf8')+';window.VisionTest=VisionTest;window.auditVision=new VisionTest.BroadcastVision();');
 const reports={};
 for(const [name,id] of Object.entries(ids)){
  if(process.argv[2]&&!process.argv.slice(2).includes(name))continue;
  const named=path.join(fixtures,name+'.png');
  const data='data:image/png;base64,'+fs.readFileSync(path.isAbsolute(id)?id:fs.existsSync(named)?named:path.join(fixtures,'codex-clipboard-'+id+'.png')).toString('base64');
  reports[name]=await page.evaluate(async(data)=>{
   const v=window.auditVision;await v.prepare();
   const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);
   const result=await v.read(c);const text=v.lastText;
   const game=window.VisionTest.gameCanvas(c);
   const candidates=['scoreboard','compact'].includes(result.layout)?window.VisionTest.hudBoxes(result.layout).map(box=>v.champions.detailed(game,box)):result.layout==='bp'?Array.from({length:10},(_,i)=>v.champions.draft(game,[i<5?i*160:1120+(i-5)*160,790,158,290])):[];
   const repeats=[];if(result.layout!=='bp')for(let i=0;i<3;i++)repeats.push(await v.read(c));
   v.stop();return {result,text,candidates,repeats};
  },data);
  const r=reports[name].result;
  console.log(name,JSON.stringify({layout:r.layout,clock:r.clock,elapsedMs:r.elapsedMs,heroes:r.players.map(p=>p.championId??'?'),levels:r.players.map(p=>p.level??'?'),kda:r.players.map(p=>[p.kills,p.deaths,p.assists]),dead:r.players.filter(p=>p.dead).map(p=>[p.slot,p.timer]),picks:r.picks,victims:r.victims}));
 }
 fs.writeFileSync('artifacts/recognition-audit.json',JSON.stringify(reports,null,2));
}finally{await app.close();}

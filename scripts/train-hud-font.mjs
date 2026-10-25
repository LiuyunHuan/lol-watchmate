// Extract reusable numeral shapes, not full screenshots or player/champion labels.
import { _electron as electron } from 'playwright';import {build} from 'esbuild';
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),temp=path.join(process.env.LOCALAPPDATA,'Temp');
const sources=[
 ['2188f6e9-ab38-42ef-b5c4-da6cca353f66','06:44',[6,6,7,6,4,7,6,7,5,4],['0/2/0','0/1/0','0/0/0','0/0/0','0/0/0','1/0/1','2/0/0','0/0/0','0/0/0','0/0/0']],
 ['27e04215-37f8-4165-89e2-8b14aed8d70c','14:04',[11,10,11,8,8,12,9,11,9,null],['0/0/0','1/1/1','1/0/0','0/0/1','0/0/1','0/0/0','0/1/0','1/1/0','0/0/0','0/0/0']],
 ['22fbf03a-4559-4121-bb40-481f4fcbd734','13:57',[11,10,11,8,8,12,9,11,9,7],[]],
 [path.resolve('artifacts/replay-observed-03.png'),'19:26',[14,12,13,11,9,14,12,13,11,9],['1/0/0','1/1/2','1/1/0','0/0/1','0/0/1','0/1/1','0/1/1','2/1/0','0/0/0','0/0/0']],
 [path.resolve('artifacts/replay-observed-04.png'),'24:27',[16,13,14,12,11,16,13,14,13,11],['1/0/0','1/2/2','1/1/0','0/0/1','0/1/1','0/1/2','0/1/2','3/1/1','1/0/1','0/0/2']],
 ['71e703b6-62b5-40e4-9943-e6868cbb57d3','01:30',[],[]],
 ['0548554c-d6ac-468d-bd07-8ecf6f73d6b6','33:07',[],[]],
 [path.resolve('artifacts/replay-observed-01.png'),'09:20',[],[]],
];
await build({entryPoints:['src/ui/hud-glyphs.ts'],bundle:true,format:'iife',globalName:'HudFont',outfile:'artifacts/hud-font.js'});
const env={...process.env,WATCHMATE_TEST_MODE:'1',WATCHMATE_DATA_DIR:path.resolve('.smoke-data/font-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.WATCHMATE_DEV_URL;
const app=await electron.launch({executablePath:require('electron'),args:['.'],env});const bank=[];
try{const page=await app.firstWindow();await page.evaluate(fs.readFileSync('artifacts/hud-font.js','utf8')+';window.HudFont=HudFont;');
 for(const [id,clock,levels,kdas] of sources){
  const names={'2188f6e9-ab38-42ef-b5c4-da6cca353f66':'newscore','27e04215-37f8-4165-89e2-8b14aed8d70c':'scoreboard','22fbf03a-4559-4121-bb40-481f4fcbd734':'scoreboard2','71e703b6-62b5-40e4-9943-e6868cbb57d3':'scene','0548554c-d6ac-468d-bd07-8ecf6f73d6b6':'compact'};
  const name=names[id]||(id.match(/replay-observed-0(\d)\.png$/)?.[1] ? 'observed'+id.match(/replay-observed-0(\d)\.png$/)[1] : null);
  const file=process.env.WATCHMATE_FIXTURES&&name?path.join(process.env.WATCHMATE_FIXTURES,name+'.png'):path.isAbsolute(id)?id:path.join(temp,'codex-clipboard-'+id+'.png');const data='data:image/png;base64,'+fs.readFileSync(file).toString('base64');
  for(const scale of [1,.8,.6667]){
  const entries=await page.evaluate(async({data,clock,levels,kdas,id,scale})=>{
   const img=new Image();img.src=data;await img.decode();const resized=document.createElement('canvas');resized.width=Math.round(img.width*scale);resized.height=Math.round(img.height*scale);resized.getContext('2d').drawImage(img,0,0,resized.width,resized.height);
   const c=document.createElement('canvas');c.width=1920;c.height=1080;c.getContext('2d').drawImage(resized,0,(resized.height-resized.width*9/16)/2,resized.width,resized.width*9/16,0,0,1920,1080);
   const samples=[{box:[938,76,46,28],kind:'clock',text:clock}];
   levels.forEach((n,i)=>{if(n!==null)samples.push({box:[i<5?751:1143,854+i%5*52,28,19],kind:'level',text:String(n)});});
   kdas.forEach((n,i)=>samples.push({box:[i<5?871:997,849+i%5*52,52,22],kind:'kda',text:n}));
   if(id.includes('observed-03'))samples.push({box:[1167.46,833.74,24.08,21.5],kind:'timer',text:'15'});
   if(id.startsWith('22fbf03a'))samples.push({box:[726.46,885.54,24.08,21.5],kind:'timer',text:'23'});
   if(id.startsWith('0548554c'))samples.push({box:[608.94,999.36,29.12,26],kind:'timer',text:'46'});
   if(id.startsWith('0548554c'))[13,14,15,15,19,20,15,17,16,14].forEach((n,i)=>samples.push({box:[(i<5?502+i*95.5:984+(i-5)*95.5)+(i<5?-1:29),1047,27,20],kind:'level-compact',text:String(n)}));
   const out=[];for(const s of samples)for(const threshold of [115,145,175,200]){
    const glyphs=window.HudFont.extractGlyphs(c,s.box,s.kind,threshold);
    if(glyphs.length!==s.text.length)continue;
    glyphs.forEach((g,i)=>out.push({char:s.text[i],kind:s.kind,bits:g.bits,aspect:g.aspect}));
   }return out;
  },{data,clock,levels,kdas,id,scale});bank.push(...entries);
  }
 }
 const unique=[...new Map(bank.map(t=>[t.kind+t.char+t.bits.join(''),t])).values()];
 fs.writeFileSync('public/hud-font.json',JSON.stringify({description:'Neutral white numeral glyphs for the LPL 2026 broadcast font. No image or player labels.',templates:unique}));
 console.log('Font templates',unique.length,Object.fromEntries(['clock','level','kda','timer'].map(k=>[k,[...new Set(unique.filter(t=>t.kind===k).map(t=>t.char))].sort().join('')])));
}finally{await app.close();}

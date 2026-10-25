import { createWorker, PSM, Worker } from 'tesseract.js';
import { Box, ChampionVision, saturation } from './champion-vision';
import { BroadcastReading } from '../shared/broadcast';
import { Rect } from '../shared/local';
import { Slot } from '../shared/types';
import { levelGlyphs } from './hud-text';
import { recognizeGlyphs, extractGlyphs } from './hud-glyphs';
import hudFont from '../../public/hud-font.json';
const roster:Slot[]=['left-top','left-jungle','left-mid','left-adc','left-support','right-top','right-jungle','right-mid','right-adc','right-support'];
const compact:Slot[]=['left-support','left-adc','left-mid','left-jungle','left-top',...roster.slice(5)];
export const hudBoxes=(layout:'scoreboard'|'compact'):Box[]=>layout==='scoreboard'
  ?Array.from({length:10},(_,i)=>[i<5?717:1158,826+(i%5)*51.8,43,43])
  :Array.from({length:10},(_,i)=>[i<5?502+i*95.5:984+(i-5)*95.5,990,52,52]);
// Positive health-bar evidence prevents naturally grey skins/faces from being
// mistaken for a death timer by OCR. Absence alone does not prove death.
export function hasLiveHealth(canvas:HTMLCanvasElement, index:number):boolean {
  const pixels=canvas.getContext('2d',{willReadFrequently:true})!.getImageData(index<5?772:1082,856+(index%5)*52,66,8).data;
  let green=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>90&&pixels[i+1]>pixels[i]*1.35&&pixels[i+1]>pixels[i+2]*1.2)green++;
  return green>=6;
}
export function gameCanvas(source:HTMLCanvasElement,viewport:Rect|null=null) {
  // Fullscreen 16:9 video centered inside black player margins; other views can select a video rectangle.
  const w=Math.min(source.width,source.height*16/9),h=w*9/16;
  const b:Box=viewport?[viewport.x*source.width,viewport.y*source.height,viewport.w*source.width,viewport.h*source.height]:[(source.width-w)/2,(source.height-h)/2,w,h];
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  canvas.getContext('2d')!.drawImage(source,...b,0,0,1920,1080);return canvas;
}
type TextRegion={key:string;box:Box;digits?:boolean};
export class BroadcastVision {
  lastText:Record<string,{text:string;confidence:number}>={};
  readonly champions=new ChampionVision();
  private worker?:Worker;
  private pending?:Promise<Worker>;
  private generation=0;
  busy=false;
  private lastNames=0;
  private lastIdentity=0;
  private lastStats=0;
  private statsSamples=0;
  private lastLayout='';
  private names=new Map<Slot,string>();
  private cached=new Map<Slot,string>();
  private draftHeroes=new Map<'left'|'right',Set<string>>();
  async prepare(){
    await this.champions.prepare();
    return this.pending??=(async()=>{
      const g=this.generation,base=new URL('./ocr/',window.location.href).href;
      const worker=await createWorker('eng+chi_sim',1,{workerPath:base+'worker.min.js',langPath:base,corePath:base,workerBlobURL:false,cacheMethod:'none',errorHandler:()=>{}});
      if(g!==this.generation){await worker.terminate();throw Error('stopped');}
      await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1'});this.worker=worker;return worker;
    })();
  }
  stop(){this.generation++;void this.worker?.terminate();this.worker=undefined;this.pending=undefined;this.busy=false;this.names.clear();this.cached.clear();this.draftHeroes.clear();this.lastNames=0;this.lastIdentity=0;this.lastStats=0;this.statsSamples=0;this.lastLayout='';}
  async text(source:HTMLCanvasElement,regions:TextRegion[]) {
    const worker=await this.prepare(),canvas=document.createElement('canvas');canvas.width=400;canvas.height=regions.length*100;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    regions.forEach(({box:[x,y,w,h]},i)=>{
      const scale=Math.min(360/w,65/h),dw=Math.ceil(w*scale),dh=Math.ceil(h*scale);ctx.drawImage(source,x,y,w,h,15,100*i+16,dw,dh);
      const threshold=regions[i].key.endsWith('-kda')?125:160;
      const p=ctx.getImageData(15,100*i+16,dw,dh);for(let j=0;j<p.data.length;j+=4){const v=p.data[j]*.299+p.data[j+1]*.587+p.data[j+2]*.114>threshold?0:255;p.data[j]=p.data[j+1]=p.data[j+2]=v;}ctx.putImageData(p,15,100*i+16);
    });
    const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});
    const words=data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))??[];
    return this.lastText=Object.fromEntries(regions.map((r,i)=>{const row=words.filter(w=>Math.floor((w.bbox.y0+w.bbox.y1)/2/100)===i).sort((a,b)=>a.bbox.x0-b.bbox.x0);return[r.key,{text:row.map(w=>w.text).join('').trim(),confidence:row.length?Math.min(...row.map(w=>w.confidence)):0}];}));
  }
  private async line(source:HTMLCanvasElement,box:Box,characters:string,threshold=160,scale=6,neutral=false,clean=true){
    const worker=await this.prepare(),c=document.createElement('canvas');c.width=Math.ceil(box[2]*scale)+40;c.height=125;
    const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,...box,20,20,c.width-40,84);
    const p=ctx.getImageData(20,20,c.width-40,84);for(let i=0;i<p.data.length;i+=4){
      const lo=Math.min(p.data[i],p.data[i+1],p.data[i+2]),hi=Math.max(p.data[i],p.data[i+1],p.data[i+2]);
      const v=(neutral?lo>threshold&&hi-lo<55:p.data[i]>threshold)?0:255;p.data[i]=p.data[i+1]=p.data[i+2]=v;
    }ctx.putImageData(p,20,20);
    let glyphCount:number|undefined;
    if(neutral){const glyphs=levelGlyphs(source,box,threshold);glyphCount=Number(glyphs.dataset.glyphCount);if(clean){ctx.imageSmoothingEnabled=false;ctx.drawImage(glyphs,20,20,c.width-40,84);}}
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,tessedit_char_whitelist:characters});
    const {data}=await worker.recognize(c);await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''});
    return {text:data.text.trim().replace(/\s/g,''),confidence:data.confidence,glyphCount};
  }
  async read(source:HTMLCanvasElement, viewport:Rect|null=null):Promise<BroadcastReading|null>{
    if(this.busy)return null;this.busy=true;const at=Date.now(),g=this.generation;
    const result:BroadcastReading={at,elapsedMs:0,layout:'unknown',status:'正在匹配转播布局',clock:null,replay:false,players:[],picks:[],victims:[]};
    try{
      await this.prepare();if(g!==this.generation)return null;
      const canvas=gameCanvas(source,viewport);
      const localClock=recognizeGlyphs(canvas,[938,76,46,28],'clock',hudFont.templates);
      let clockText=localClock.confidence>=85?localClock:await this.line(canvas,[938,76,46,28],'0123456789:',160,4);
      if(!/^\d{1,2}:[0-5]\d$/.test(clockText.text)||clockText.confidence<55){
        // Desktop DPI resampling changes condensed scoreboard glyphs; retry a wider aspect.
        const alternate=await this.line(canvas,[938,76,46,28],'0123456789:',160,6);
        if(/^\d{1,2}:[0-5]\d$/.test(alternate.text)&&alternate.confidence>=55)clockText=alternate;
      }
      const parsedClock=/^(\d{1,2}):([0-5]\d)$/.exec(clockText.text);
      if(parsedClock&&clockText.confidence>=55)result.clock=Number(parsedClock[1])*60+Number(parsedClock[2]);
      // Kill feed is present even when an advertisement/graph replaces the scoreboard.
      if(result.clock!==null)for(let row=0;row<4;row++){
        const m=this.champions.match(canvas,[1883,105+row*36,29,29],'icon',false,this.cached.size===10?new Set(this.cached.values()):undefined);
        if(m.score>.72&&m.margin>.12)result.victims.push(m.champion.id);
      }
      const full=this.lastIdentity===0||(this.cached.size<10&&at-this.lastIdentity>10000);
      const restrict=this.cached.size===10?new Set(this.cached.values()):undefined;
      const layouts=(['scoreboard','compact'] as const).map(layout=>{
        const boxes=hudBoxes(layout),matches=boxes.map((box,i)=>this.champions.match(canvas,box,'icon',saturation(canvas,box)<.16,this.draftHeroes.get(i<5?'left':'right')??restrict));
        return {layout,boxes,matches,count:matches.filter(m=>m.score>.63&&m.margin>.06).length};
      }).sort((a,b)=>b.count-a.count);
      const selected=layouts[0];
      if(selected.count<4&&result.clock!==null){
        result.layout='scene';result.status='局内无计分板 · 保留已有数据，仅检查击杀栏';
        const replay=await this.text(canvas,[{key:'replay',box:[810,0,300,65]}]);
        result.replay=/REPLAY|回放/i.test(replay.replay.text)&&replay.replay.confidence>45;
        return result;
      }
      if(selected.count<4||result.clock===null){
        // BP display positions are not player positions. Stable choices are stored separately by the engine.
        const boxes:Box[]=Array.from({length:10},(_,i)=>[i<5?i*160:1120+(i-5)*160,790,158,290]);
        for(let i=0;i<10;i++){
          const m=this.champions.draft(canvas,boxes[i]);if(m.score>.73&&m.margin>.1)result.picks.push({side:i<5?'left':'right',position:i%5+1,championId:m.champion.id,confidence:m.score});
          // Let input, speech and pause run between expensive portrait matches.
          await new Promise(resolve=>setTimeout(resolve,0));if(g!==this.generation)return null;
        }
        if(result.picks.length>=2){
          result.layout='bp';result.status='BP：本地匹配英雄，选手位置待进游戏确认';
          if(this.lastLayout!=='bp'){this.cached.clear();this.names.clear();this.draftHeroes.clear();this.lastIdentity=0;this.lastNames=0;this.lastStats=0;this.statsSamples=0;}
          this.lastLayout='bp';
          for(const side of ['left','right'] as const){const ids=new Set(result.picks.filter(p=>p.side===side).map(p=>p.championId));if(ids.size===5)this.draftHeroes.set(side,ids);}
        }
        else result.status='未匹配LPL布局 · 请确认全屏比赛画面或调整比赛区域';
        return result;
      }
      result.layout=selected.layout;
      const stats=at-this.lastStats>2000||this.statsSamples<2||this.lastLayout!==selected.layout;
      const selectedOrder=selected.layout==='compact'?compact:roster;
      if(full)selected.matches=selected.boxes.map((box,i)=>this.cached.has(selectedOrder[i])||(selected.matches[i].score>.74&&selected.matches[i].margin>.12)||this.draftHeroes.has(i<5?'left':'right')?selected.matches[i]:this.champions.detailed(canvas,box,saturation(canvas,box)<.16));
      this.lastLayout=selected.layout;
      if(full)this.lastIdentity=at;
      const refresh=stats&&(at-this.lastNames>10000||this.names.size<10);
      const regions:TextRegion[]=[{key:'clock',box:[938,76,46,28],digits:true},{key:'replay',box:[810,0,300,65]}];
      const order=selected.layout==='compact'?compact:roster;
      selected.boxes.forEach((box,i)=>{
        const slot=order[i],m=selected.matches[i],grey=saturation(canvas,box)<.18 && !(selected.layout==='scoreboard'&&hasLiveHealth(canvas,i));
        const accepted=m.score>.63&&m.margin>.06;
        if(accepted)this.cached.set(slot,m.champion.id);
        result.players.push({slot,championId:accepted?m.champion.id:this.cached.get(slot),confidence:accepted?Math.min(1,m.score):0,name:this.names.get(slot),dead:grey?null:false,timer:null});
        if(grey)regions.push({key:slot+'-timer',box:[box[0]+box[2]*.22,box[1]+box[3]*.18,box[2]*.56,box[3]*.50],digits:true});
        if(stats&&selected.layout==='scoreboard'){
          const y=824+(i%5)*52;
          regions.push({key:slot+'-kda',box:[i<5?871:997,y+25,52,22],digits:true});
          // Level sits between the portrait and bars, not inside the adjacent ability circle.
          regions.push({key:slot+'-level',box:[i<5?751:1143,y+30,28,19],digits:true});
          if(refresh)regions.push({key:slot+'-name',box:[i<5?791:1052,y+4,i<5?78:78,21]});
        }
        else if(stats)regions.push({key:slot+'-level',box:[box[0]+(i<5?-1:29),1047,27,20],digits:true});
      });
      // Only after the in-game layout identifies four slots may the last obscured portrait
      // be inferred from that side's complete BP set. BP display order is never a role binding.
      for(const side of ['left','right'] as const){
        const ids=this.draftHeroes.get(side),players=result.players.filter(p=>p.slot.startsWith(side));
        const known=new Set(players.map(p=>p.championId).filter((id):id is string=>!!id));
        const missing=players.filter(p=>!p.championId),remaining=ids&&[...ids].filter(id=>!known.has(id));
        if(ids?.size===5&&known.size===4&&missing.length===1&&remaining?.length===1){
          missing[0].championId=remaining[0];missing[0].confidence=.7;missing[0].identitySource='draft-elimination';this.cached.set(missing[0].slot,remaining[0]);
        }
      }
      if(selected.layout==='scoreboard'&&refresh){regions.push({key:'left-team',box:[590,22,70,32]},{key:'right-team',box:[1293,22,45,32]});}
      const texts=await this.text(canvas,regions);if(g!==this.generation)return null;
      // Condensed scoreboard clock fonts need a single-line pass with digits only.
      texts.clock=clockText;
      for(const region of regions){
        if(region.key.endsWith('-timer')){
          const local=recognizeGlyphs(canvas,region.box,'timer',hudFont.templates);
          if(local.confidence>=92){texts[region.key]=local;continue;}
          const timer=await this.line(canvas,region.box,'0123456789',200,5);
          const glyphs=extractGlyphs(canvas,region.box,'timer',175);
          texts[region.key]=/^\d{1,2}$/.test(timer.text)&&timer.confidence>=70&&glyphs.length===timer.text.length?timer:{text:'',confidence:0};
        }
        if(region.key.endsWith('-kda')||region.key.endsWith('-level')){
          const local=recognizeGlyphs(canvas,region.box,region.key.endsWith('-kda')?'kda':selected.layout==='compact'?'level-compact':'level',hudFont.templates);
          if(local.confidence>=92){texts[region.key]=local;continue;}
        }
        if(region.key.endsWith('-kda')&&!/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(texts[region.key].text))texts[region.key]=await this.line(canvas,region.box,'0123456789/');
        if(region.key.endsWith('-level')){
          // White glyphs only: coloured health/mana bars are not parts of a level digit.
          const first=await this.line(canvas,region.box,'0123456789',150,4,true);
          const count=Math.max(...[115,145,175].map(t=>extractGlyphs(canvas,region.box,'level',t).length).filter(n=>n<=2));
          const valid=(t:typeof first)=>/^\d{1,2}$/.test(t.text)&&Number(t.text)>=1&&Number(t.text)<=30&&t.text.length===count;
          if(valid(first)&&first.confidence>=60)texts[region.key]=first;
          else{
            const second=await this.line(canvas,region.box,'0123456789',150,4,true,false);
            const third=await this.line(canvas,region.box,'0123456789',180,6,true,false);
            const options=[first,second,third].filter(valid).sort((a,b)=>b.confidence-a.confidence);
            const chosen=options.find(t=>t.confidence>=60||options.filter(s=>s.text===t.text).length>=2);
            texts[region.key]=chosen?{text:chosen.text,confidence:Math.max(60,chosen.confidence)}:{text:'',confidence:0};
          }
        }
        if(region.key.endsWith('-team'))texts[region.key]=await this.line(canvas,region.box,'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      }
      const clock=texts.clock.text.replace(/[.：]/g,':').replace(/[^0-9:]/g,'');const cm=/^(\d{1,2}):([0-5]\d)$/.exec(clock);
      if(cm&&texts.clock.confidence>=35)result.clock=Number(cm[1])*60+Number(cm[2]);
      result.replay=/REPLAY|回放/i.test(texts.replay.text)&&texts.replay.confidence>45;
      for(const p of result.players){
        const t=texts[p.slot+'-timer'],timer=t?.text.replace(/[.,，]/g,'');if(t&&timer&&/^\d{1,2}$/.test(timer)&&Number(timer)>0&&t.confidence>=40){p.timer=Number(timer);p.dead=true;}
        const k=texts[p.slot+'-kda']?.text.replace(/[|Il]/g,'1');const kd=k&&/^(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/.exec(k);if(kd&&texts[p.slot+'-kda'].confidence>=35){p.kills=Number(kd[1]);p.deaths=Number(kd[2]);p.assists=Number(kd[3]);}
        const level=texts[p.slot+'-level'];if(level&&/^\d{1,2}$/.test(level.text)&&Number(level.text)>=1&&Number(level.text)<=30&&level.confidence>=60)p.level=Number(level.text);
        const name=texts[p.slot+'-name'];if(name&&/^[A-Za-z][A-Za-z0-9._-]{1,24}$/.test(name.text)&&name.confidence>=45){p.name=name.text;this.names.set(p.slot,name.text);}
      }
      if(refresh&&selected.layout==='scoreboard')this.lastNames=at;
      if(stats){this.lastStats=at;this.statsSamples++;}
      if(texts['left-team']&&texts['right-team']&&[texts['left-team'],texts['right-team']].every(t=>/^[A-Za-z0-9]{2,8}$/.test(t.text)&&t.confidence>40))result.teams={left:texts['left-team'].text,right:texts['right-team'].text};
      result.status=`LPL ${result.layout==='compact'?'团战横排':'对线计分板'} · ${result.clock===null?'时钟待确认':result.clock+'s'} · ${result.players.filter(p=>p.championId).length}/10 英雄`;
      return result;
    }catch{result.status='本地图库/OCR不可用，请重启或检查安装资源';return result;}
    finally{result.elapsedMs=Date.now()-at;if(g===this.generation)this.busy=false;}
  }
}

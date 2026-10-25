import type { Box } from './champion-vision';
export interface Glyph { bits:number[]; aspect:number; x:number; y:number; w:number; h:number; }
export interface GlyphTemplate { char:string; kind:string; bits:number[]; aspect:number; }
/** Connected white glyphs, with colour HUD elements removed before OCR. */
export function extractGlyphs(source:HTMLCanvasElement,box:Box,kind:string,threshold=145):Glyph[]{
  const c=document.createElement('canvas');c.width=Math.round(box[2]);c.height=Math.round(box[3]);
  const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,...box,0,0,c.width,c.height);
  const data=ctx.getImageData(0,0,c.width,c.height).data,mask=new Uint8Array(c.width*c.height),seen=new Uint8Array(mask.length);
  for(let i=0;i<mask.length;i++){const lo=Math.min(data[i*4],data[i*4+1],data[i*4+2]),hi=Math.max(data[i*4],data[i*4+1],data[i*4+2]);mask[i]=Number(lo>threshold&&hi-lo<70);}
  const groups:{points:number[];x:number;y:number;w:number;h:number}[]=[];
  for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){
    const queue=[i],points:number[]=[];seen[i]=1;
    while(queue.length){const k=queue.pop()!,x=k%c.width,y=Math.floor(k/c.width);points.push(k);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,j=yy*c.width+xx;if(xx>=0&&yy>=0&&xx<c.width&&yy<c.height&&mask[j]&&!seen[j]){seen[j]=1;queue.push(j);}}
    }
    const xs=points.map(k=>k%c.width),ys=points.map(k=>Math.floor(k/c.width));const x=Math.min(...xs),y=Math.min(...ys);
    if(points.length>=2)groups.push({points,x,y,w:Math.max(...xs)-x+1,h:Math.max(...ys)-y+1});
  }
  groups.sort((a,b)=>a.x-b.x);
  // Merge the vertically separated dots of a colon; never join adjacent digits.
  if(kind==='clock')for(let i=0;i<groups.length-1;i++){const a=groups[i],b=groups[i+1];if(a.h<=5&&b.h<=5&&Math.abs(a.x-b.x)<=1){a.points.push(...b.points);a.h=Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y);a.y=Math.min(a.y,b.y);a.w=Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x);a.x=Math.min(a.x,b.x);groups.splice(i+1,1);}}
  return groups.filter(g=>kind==='clock'?g.h>=7&&g.w<=14:kind==='timer'?g.h>=12&&g.w<=20:kind==='kda'?g.h>=8&&g.w<=17:g.h>=8&&g.h<=19&&g.w>=3&&g.w<=17&&!(g.x>=20&&g.x+g.w===c.width)).map(g=>{
    const local=new Set(g.points);const bits:number[]=[];
    for(let y=0;y<24;y++)for(let x=0;x<16;x++){
      const sx=g.x+Math.min(g.w-1,Math.floor((x+.5)*g.w/16)),sy=g.y+Math.min(g.h-1,Math.floor((y+.5)*g.h/24));bits.push(Number(local.has(sy*c.width+sx)));
    }
    return {...g,bits,aspect:g.w/g.h};
  });
}
export function recognizeGlyphs(source:HTMLCanvasElement,box:Box,kind:string,bank:GlyphTemplate[]){
  const attempts=[];let maxGlyphs=0;
  for(const threshold of [115,145,175]){
    const glyphs=extractGlyphs(source,box,kind,threshold);let text='',confidence=1;
    if(glyphs.length<=(kind==='clock'?5:kind==='kda'?8:2))maxGlyphs=Math.max(maxGlyphs,glyphs.length);
    for(const g of glyphs){
      const scores=new Map<string,number>();
      for(const t of bank){if(t.kind!==kind)continue;let sum=0,overlap=0;for(let i=0;i<g.bits.length;i++){sum+=g.bits[i]+t.bits[i];overlap+=g.bits[i]*t.bits[i];}
        // The small dark holes distinguish 0/6/8/9; foreground-only Dice hides their differences.
        const background=g.bits.length-sum+overlap;
        const score=(2*overlap/Math.max(1,sum)+2*background/Math.max(1,2*g.bits.length-sum))/2-Math.abs(g.aspect-t.aspect)*.12;
        if(score>(scores.get(t.char)??0))scores.set(t.char,score);
      }
      const ranked=[...scores].sort((a,b)=>b[1]-a[1]);
      if(!ranked.length||ranked[0][1]<.78||ranked[0][1]-(ranked[1]?.[1]??0)<.025){text+='?';confidence=0;}
      else {text+=ranked[0][0];confidence=Math.min(confidence,ranked[0][1]);}
    }
    const valid=kind==='clock'?/^\d{1,2}:[0-5]\d$/.test(text):kind==='kda'?/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(text):/^\d{1,2}$/.test(text)&&Number(text)>=1&&Number(text)<=30;
    if(valid)attempts.push({text,confidence:confidence*100});
  }
  // A high threshold can erase a thin second digit; "1" is not a confident reading of "14".
  return attempts.filter(a=>a.text.length>=maxGlyphs).sort((a,b)=>b.confidence-a.confidence)[0]??{text:'',confidence:0};
}

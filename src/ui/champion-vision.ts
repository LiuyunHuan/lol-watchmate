import { features, featureScore, type Features } from './feature-match';
import manifest from '../../public/champions/manifest.json';
import variants from '../../public/champions/variants/manifest.json';
export const champions = manifest.champions;
export type Champion = typeof champions[number];
export const normalizeChampion = (name: string) => champions.find(c => [c.id, c.name, c.title, ...(c.id === 'Yunara' ? ['芸阿娜', '芸阿蕾', '芸阿娜'] : [])].some(v => v.toLowerCase() === name.trim().toLowerCase()));
export type Box = [number, number, number, number];
const N = 24;
let workCanvas: HTMLCanvasElement | undefined;
function pixels(source: CanvasImageSource, box: Box): Float32Array {
  const c = workCanvas ??= document.createElement('canvas'); if(c.width!==N){ c.width = c.height = N; }
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0,0,N,N);
  ctx.drawImage(source, ...box, 0, 0, N, N);
  const p = ctx.getImageData(0, 0, N, N).data, out = new Float32Array(N*N*3);
  for (let i = 0; i < N*N; i++) for (let k = 0; k < 3; k++) out[i*3+k] = p[i*4+k];
  return out;
}
function compare(a: Float32Array, b: Float32Array, grey: boolean) {
  let sa=0,sb=0,saa=0,sbb=0,sab=0,n=0,color=0;
  for(let y=2;y<N-4;y++) for(let x=2;x<N-2;x++) {
    // Death counter obscures the middle; levels and progress bars obscure the bottom.
    if(grey && x>5 && x<19 && y>6 && y<18) continue;
    const i=(y*N+x)*3, av=a[i]*.299+a[i+1]*.587+a[i+2]*.114,bv=b[i]*.299+b[i+1]*.587+b[i+2]*.114;
    sa+=av;sb+=bv;saa+=av*av;sbb+=bv*bv;sab+=av*bv;n++;
    const am=Math.max(30,a[i]+a[i+1]+a[i+2]),bm=Math.max(30,b[i]+b[i+1]+b[i+2]);
    color+=(Math.abs(a[i]/am-b[i]/bm)+Math.abs(a[i+1]/am-b[i+1]/bm)+Math.abs(a[i+2]/am-b[i+2]/bm))/3;
  }
  const corr=(sab-sa*sb/n)/Math.sqrt(Math.max(1,(saa-sa*sa/n)*(sbb-sb*sb/n)));
  return grey?corr:corr*.8+(1-color/n*4)*.2;
}
export function saturation(source: HTMLCanvasElement, box: Box) {
  const p=pixels(source,box);let value=0;
  for(let i=0;i<p.length;i+=3){const max=Math.max(p[i],p[i+1],p[i+2]);value+=max?(max-Math.min(p[i],p[i+1],p[i+2]))/max:0;}
  return value/(p.length/3);
}
export class ChampionVision {
  private templates: { champion: Champion; data: Float32Array; kind: 'icon'|'portrait' }[]=[];
  private pending?: Promise<void>;
  private iconSources=new Map<string,HTMLCanvasElement>();
  private portraitSources=new Map<string,HTMLCanvasElement>();
  private featureCache=new Map<string,Features[]>();
  private draftTemplates:{champion:Champion;data:Float32Array}[]=[];
  private refinements=new Map<string,Float32Array[]>();
  private drafts=new Map<number,{data:Float32Array;result:{champion:Champion;score:number;margin:number;candidates:{id:string;score:number}[]}}>();
  prepare() {
    return this.pending ??= (async()=>{
      let next=0;
      await Promise.all(Array.from({length:8},async()=>{while(next<champions.length){
        const champion=champions[next++];
        for(const kind of ['icon','portrait'] as const){
          const img=new Image();img.src=new URL(`./champions/${champion.id}.${kind==='icon'?'png':'jpg'}`,window.location.href).href;await img.decode();
          for(const flip of [false,true]) {
            const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
            const ctx=canvas.getContext('2d')!;if(flip){ctx.translate(img.width,0);ctx.scale(-1,1);}ctx.drawImage(img,0,0);
            if(kind==='icon'&&!flip)this.iconSources.set(champion.id,canvas);
            if(kind==='portrait'){
              if(!flip)this.portraitSources.set(champion.id,canvas);
              for(const width of [160,200,240,280,320])for(const x of [0,40,80,120])for(const y of [0,40,80,120])
                if(x+width<=348)this.draftTemplates.push({champion,data:pixels(canvas,[x,y,width,width*235/158])});
            }
            // The broadcast HUD zooms some champion faces further than Data Dragon's square.
            if(kind==='icon') for(const size of [80,92,104,116,128]) for(const dx of [-8,0,8]) for(const dy of [-8,0,8])
              this.templates.push({champion,kind,data:pixels(canvas,[(img.width-size)/2+dx,(img.width-size)/2+dy,size,size])});
            else for(const height of [280,360,440,520,560]) for(const top of [0,40,80]) for(const width of [230,308])
              if(top+height<=600)this.templates.push({champion,kind,data:pixels(canvas,[(308-width)/2,top,width,height])});
          }
        }
      }}));
      // Spectator HUDs may show a skin-specific face, distinct from the client default square.
      let variantIndex=0;
      await Promise.all(Array.from({length:6},async()=>{while(variantIndex<variants.entries.length){
        const entry=variants.entries[variantIndex++],champion=champions.find(c=>c.id===entry.championId);
        if(!champion)continue;
        const img=new Image();img.src=new URL(`./champions/variants/${entry.file}`,window.location.href).href;await img.decode();
        for(const flip of [false,true]){
          const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;
          if(flip){ctx.translate(128,0);ctx.scale(-1,1);}ctx.drawImage(img,0,0,128,128);
          for(const size of [104,112,120,128])for(const dx of [-4,0,4])for(const dy of [-4,0,4])
            this.templates.push({champion,kind:'icon',data:pixels(c,[(128-size)/2+dx,(128-size)/2+dy,size,size])});
        }
      }}));
    })();
  }
  match(source: HTMLCanvasElement, box: Box, kind:'icon'|'portrait'='icon', grey=false, restrict?:Set<string>) {
    const p=pixels(source,box), scores=new Map<string,{champion:Champion;score:number}>();
    for(const template of this.templates) {if(template.kind!==kind||(restrict&&!restrict.has(template.champion.id)))continue; const score=compare(p,template.data,grey);if(score>(scores.get(template.champion.id)?.score??-Infinity))scores.set(template.champion.id,{champion:template.champion,score});}
    const ranked=[...scores.values()].sort((a,b)=>b.score-a.score);
    return { ...ranked[0], margin:(ranked[0]?.score??0)-(ranked[1]?.score??0), candidates:ranked.slice(0,8).map(x=>({id:x.champion.id,score:x.score})) };
  }
  detailed(source:HTMLCanvasElement,box:Box,grey=false){
    const base=this.match(source,box,'icon',grey);
    if(base.score>.74&&base.margin>.12)return base;
    const q=document.createElement('canvas');q.width=q.height=128;q.getContext('2d')!.drawImage(source,...box,0,0,128,128);
    const query=features(q,128);
    const p=pixels(source,box),ranked=base.candidates.slice(0,4).map(candidate=>{
      let templates=this.refinements.get(candidate.id);
      if(!templates){
        templates=[];const original=this.iconSources.get(candidate.id)!;
        for(const flip of [false,true]){
          const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;
          if(flip){ctx.translate(128,0);ctx.scale(-1,1);}ctx.drawImage(original,0,0,128,128);
          for(const size of [56,72,88,96,104,112,128])for(const dx of [-16,-8,0,8,16,32])for(const dy of [-16,-8,0,8,16,32])
            templates.push(pixels(c,[(128-size)/2+dx,(128-size)/2+dy,size,size]));
        }
        if(this.refinements.size>=24)this.refinements.delete(this.refinements.keys().next().value!);
        this.refinements.set(candidate.id,templates);
      }
      let score=candidate.score;for(const t of templates)score=Math.max(score,compare(p,t,grey));
      let bank=this.featureCache.get('icon:'+candidate.id);
      if(!bank){bank=[];const asset=this.iconSources.get(candidate.id)!;
        for(const resolution of [43,128])for(const flip of [false,true]){const c=document.createElement('canvas');c.width=c.height=resolution;const ctx=c.getContext('2d')!;if(flip){ctx.translate(resolution,0);ctx.scale(-1,1);}ctx.drawImage(asset,0,0,resolution,resolution);
          for(const width of [80,100,128,160,192,240])bank.push(features(c,width));
        }
        this.featureCache.set('icon:'+candidate.id,bank);
      }
      const count=Math.max(...bank.map(ref=>featureScore(query,ref)));
      if(count>=6)score=Math.max(score,.55+Math.min(.44,count*.022));
      return {id:candidate.id,score};
    }).sort((a,b)=>b.score-a.score);
    return {champion:champions.find(c=>c.id===ranked[0].id)!,score:ranked[0].score,margin:ranked[0].score-ranked[1].score,candidates:ranked};
  }
  draft(source:HTMLCanvasElement,box:Box){
    // Compare the art above the player label. Broadcast cards zoom and mirror loading art.
    const p=pixels(source,[box[0],box[1],box[2],box[3]*235/290]);
    const cached=this.drafts.get(box[0]);if(cached&&compare(p,cached.data,false)>.985)return cached.result;
    const scores=new Map<string,number>();
    for(const t of this.draftTemplates){const score=compare(p,t.data,false);if(score>(scores.get(t.champion.id)??-1))scores.set(t.champion.id,score);}
    const coarseIcons=[0,.15,.3].map(offset=>this.match(source,[box[0],box[1]+box[3]*offset,box[2],box[2]]));
    const candidates=new Set([...scores].sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]));
    for(const m of coarseIcons)for(const c of m.candidates.slice(0,3))candidates.add(c.id);
    const q=document.createElement('canvas');q.width=158;q.height=235;q.getContext('2d')!.drawImage(source,box[0],box[1],box[2],box[3]*235/290,0,0,158,235);
    const query=features(q,158);
    for(const id of candidates){
      let bank=this.featureCache.get(id);
      if(!bank){bank=[];const original=this.portraitSources.get(id)!;
        for(const asset of [original,this.iconSources.get(id)!])for(const flip of [false,true]){const c=document.createElement('canvas');c.width=asset.width;c.height=asset.height;const ctx=c.getContext('2d')!;if(flip){ctx.translate(c.width,0);ctx.scale(-1,1);}ctx.drawImage(asset,0,0);
          for(const width of [120,154,194,244,308])bank.push(features(c,width));
        }
        this.featureCache.set(id,bank);
      }
      const count=Math.max(...bank.map(ref=>featureScore(query,ref)));
      if(count>=6)scores.set(id,.55+Math.min(.44,count*.022));
    }
    const ranked=[...scores].sort((a,b)=>b[1]-a[1]);
    const result={champion:champions.find(c=>c.id===ranked[0][0])!,score:ranked[0][1],margin:ranked[0][1]-ranked[1][1],candidates:ranked.slice(0,8).map(([id,score])=>({id,score}))};
    this.drafts.set(box[0],{data:p,result});return result;
  }
}

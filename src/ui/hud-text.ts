import type { Box } from './champion-vision';

/** Isolate neutral white HUD digits before enlargement; discard bars and portrait fragments. */
export function levelGlyphs(source: HTMLCanvasElement, box: Box, threshold = 150) {
  const c=document.createElement('canvas');c.width=box[2];c.height=box[3];
  const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,...box,0,0,c.width,c.height);
  const {data}=ctx.getImageData(0,0,c.width,c.height),mask=new Uint8Array(c.width*c.height),seen=new Uint8Array(mask.length);
  for(let i=0;i<mask.length;i++){
    const lo=Math.min(data[i*4],data[i*4+1],data[i*4+2]),hi=Math.max(data[i*4],data[i*4+1],data[i*4+2]);
    mask[i]=Number(lo>threshold&&hi-lo<55);
  }
  const components:number[][]=[];
  for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){
    const queue=[i],points:number[]=[];seen[i]=1;
    while(queue.length){const k=queue.pop()!,x=k%c.width,y=Math.floor(k/c.width);points.push(k);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy,j=yy*c.width+xx;
        if(xx>=0&&yy>=0&&xx<c.width&&yy<c.height&&mask[j]&&!seen[j]){seen[j]=1;queue.push(j);}
      }
    }
    const xs=points.map(k=>k%c.width),ys=points.map(k=>Math.floor(k/c.width));
    const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x+1,h=Math.max(...ys)-y+1;
    if(h>=8&&h<=18&&w>=3&&w<=16&&y+h>=12&&!(x>=20&&x+w===c.width))components.push(points);
  }
  ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';
  for(const points of components)for(const k of points)ctx.fillRect(k%c.width,Math.floor(k/c.width),1,1);
  c.dataset.glyphCount=String(components.length);
  return c;
}

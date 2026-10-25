// JSFeat is MIT licensed. Only local pixels are used; no model or network requests.
// @ts-expect-error jsfeat does not publish TypeScript declarations.
import jsfeat from 'jsfeat';
export interface Features { xy:{x:number;y:number}[]; data:Int32Array; }
export function features(source:HTMLCanvasElement,width:number):Features {
  const c=document.createElement('canvas');c.width=width;c.height=Math.round(source.height*width/source.width);
  const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,c.width,c.height);
  const mat=new jsfeat.matrix_t(c.width,c.height,jsfeat.U8_t|jsfeat.C1_t);
  jsfeat.imgproc.grayscale(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height,mat);
  jsfeat.imgproc.gaussian_blur(mat,mat,3);
  jsfeat.yape06.laplacian_threshold=20;jsfeat.yape06.min_eigen_value_threshold=15;
  let points=Array.from({length:c.width*c.height},()=>new jsfeat.keypoint_t(0,0,0,0,0));
  const n=jsfeat.yape06.detect(mat,points,17);points=points.slice(0,n).sort((a,b)=>b.score-a.score).slice(0,220);
  for(const p of points)p.angle=0; // Broadcast art has no rotation; mirrored references are separate.
  const desc=new jsfeat.matrix_t(32,Math.max(1,points.length),jsfeat.U8_t|jsfeat.C1_t);
  jsfeat.orb.describe(mat,points,points.length,desc);
  return {xy:points.map(p=>({x:p.x,y:p.y})),data:new Int32Array(desc.buffer.i32.slice(0,points.length*8))};
}
function pop(v:number){v-=v>>>1&0x55555555;v=(v&0x33333333)+(v>>>2&0x33333333);return ((v+(v>>>4)&0x0f0f0f0f)*0x01010101)>>>24;}
export function featureScore(query:Features,reference:Features){
  const matches:{x:number;y:number;tx:number;ty:number}[]=[];
  for(let i=0;i<query.xy.length;i++){
    let best=257,second=257,index=-1;
    for(let j=0;j<reference.xy.length;j++){let d=0;for(let k=0;k<8;k++)d+=pop(query.data[i*8+k]^reference.data[j*8+k]);
      if(d<best){second=best;best=d;index=j;}else if(d<second)second=d;
    }
    if(best<65&&best<second*.8){const a=query.xy[i],b=reference.xy[index];matches.push({x:a.x,y:a.y,tx:b.x,ty:b.y});}
  }
  // Require several spatially consistent correspondences, not a single similar eye or border.
  let consensus=0;
  for(const scale of [.8,.9,1,1.1,1.2])for(const seed of matches){const ox=seed.x-seed.tx*scale,oy=seed.y-seed.ty*scale;
    const group=matches.filter(m=>Math.abs(m.x-m.tx*scale-ox)<7&&Math.abs(m.y-m.ty*scale-oy)<7);
    if(group.length>consensus&&Math.max(...group.map(m=>m.y))-Math.min(...group.map(m=>m.y))>20)consensus=group.length;
  }
  return consensus;
}

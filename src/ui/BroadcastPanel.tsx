import { useState } from 'react';
import { Action, Snapshot } from '../shared/types';
import { Rect } from '../shared/local';
import { champions } from './champion-vision';
export function DraftPanel({state,action}:{state:Snapshot;action:(a:Action)=>Promise<void>}){
  const [open,setOpen]=useState(false);
  return <div className="panel local-panel"><div className="panel-heading"><span>BP 英雄选择</span><button className="text-button" onClick={()=>setOpen(!open)}>{open?'收起':'查看 / 纠正'}</button></div>
    <p className="small muted">记录英雄选择，不预先绑定选手。中途接入或同时出现的选择，实际第几选待确认；进游戏后按计分板绑定。</p>
    {open&&(['left','right'] as const).map(side=><div key={side}><strong>{side==='left'?'蓝方':'红方'}</strong>{[1,2,3,4,5].map(position=>{
      const pick=state.match.draft?.find(p=>p.side===side&&p.position===position);
      return <div className="draft-row" key={position}><span>展示位 {position}</span><select aria-label={`${side} 展示位 ${position} 英雄`} value={pick?.championId??''} onChange={e=>void action({type:'draft-pick',side,position,championId:e.target.value,order:pick?.order??null})}><option value="">待确认</option>{champions.map(c=><option key={c.id} value={c.id}>{c.title} · {c.name}</option>)}</select><select aria-label={`${side} 展示位 ${position} 顺序`} value={pick?.order??''} onChange={e=>void action({type:'draft-pick',side,position,championId:pick?.championId??'',order:e.target.value?Number(e.target.value):null})}><option value="">顺序待确认</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>第 {n} 选</option>)}</select></div>;
    })}</div>)}
  </div>;
}
export function ViewportDialog({frame,close,save}:{frame:HTMLCanvasElement;close:()=>void;save:(rect:Rect|null)=>Promise<void>}){
  const [image]=useState(()=>frame.toDataURL()),[rect,setRect]=useState<Rect|null>(null),[start,setStart]=useState<{x:number;y:number}|null>(null);
  const point=(e:React.PointerEvent)=>{const b=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};};
  return <div className="modal-backdrop"><section className="modal calibration" role="dialog" aria-label="框选比赛画面"><div className="modal-heading"><h2>框选比赛画面</h2><button onClick={close}>✕</button></div><p>只框选完整的 16:9 转播画面，包含顶部比分和底部选手栏，排除浏览器、黑边、标题和播放控制栏。内部两种布局会自动切换。</p>
    <div className="calibration-surface" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setStart(point(e));}} onPointerMove={e=>{if(start){const p=point(e);setRect({x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)});}}} onPointerUp={()=>setStart(null)}><img src={image} draggable={false}/>{rect&&<div className="calibration-box selected" style={{left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%'}}><span>比赛区域</span></div>}</div>
    <div className="dialog-actions"><button className="button subtle" onClick={()=>void save(null).then(close)}>恢复居中 16:9</button><button className="button primary" disabled={!rect||rect.w*frame.width<320||rect.h*frame.height<180} onClick={()=>void save(rect).then(close)}>保存比赛区域</button></div></section></div>;
}

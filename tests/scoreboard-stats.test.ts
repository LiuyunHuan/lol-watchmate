import { expect, it } from 'vitest';
import { ScoreboardStats } from '../src/core/scoreboard-stats';
import { BroadcastReading } from '../src/shared/broadcast';
const frame=(at:number,clock=404,level=6,deaths=1):BroadcastReading=>({at,clock,elapsedMs:100,layout:'scoreboard',status:'',replay:false,picks:[],victims:[],players:[{slot:'left-jungle',confidence:1,dead:false,timer:null,level,kills:0,deaths,assists:0}]});
it('数字需要两帧确认，单次错误不会污染已确认数据',()=>{
 const s=new ScoreboardStats();expect(s.ingest(frame(1)).players[0].level).toBeUndefined();
 expect(s.ingest(frame(2)).players[0]).toMatchObject({level:6,deaths:1});
 expect(s.ingest(frame(3,405,16,21)).players[0].level).toBeUndefined();
 expect(s.ingest(frame(4,406,16,21)).players[0].deaths).toBeUndefined();
 expect(s.ingest(frame(5,407,6,1)).players[0]).toMatchObject({level:6,deaths:1});
});
it('正常升级/死亡确认，回放可以更新数字但重复时间戳不算第二帧',()=>{
 const s=new ScoreboardStats();s.ingest(frame(1));s.ingest(frame(2));
 const next={...frame(3,405,7,2),players:[{...frame(3).players[0],level:7,deaths:2,dead:true,timer:20}]};
 expect(s.ingest(next).players[0]).toMatchObject({dead:true,timer:20});
 expect(s.ingest(next).players[0].level).toBeUndefined();
 expect(s.ingest({...next,at:4,replay:true}).players[0]).toMatchObject({level:7,deaths:2});
 expect(s.ingest({...next,at:5}).players[0]).toMatchObject({level:7,deaths:2});
});
it('拖动进度重新确认，重置后不沿用上局数字',()=>{
 const s=new ScoreboardStats();s.ingest(frame(1,900,12,3));s.ingest(frame(2,900,12,3));
 expect(s.ingest(frame(3)).players[0].level).toBeUndefined();
 expect(s.ingest(frame(4)).players[0].level).toBe(6);
 s.reset();expect(s.ingest(frame(5)).players[0].level).toBeUndefined();
});
it('快速死亡帧没有统计字段时，不中断两次正常统计采样的确认',()=>{
 const s=new ScoreboardStats();s.ingest(frame(1000));
 const fast=frame(1500);fast.players=[{slot:'left-jungle',confidence:1,dead:false,timer:null}];
 expect(s.ingest(fast).players[0].level).toBeUndefined();
 expect(s.ingest(frame(3000)).players[0].level).toBe(6);
 s.reset();s.ingest(frame(1000));expect(s.ingest(frame(7000)).players[0].level).toBeUndefined();
});

import { describe,it,expect } from 'vitest';
import { BroadcastDetector } from '../src/core/broadcast-detector';
import { BroadcastReading } from '../src/shared/broadcast';
import { demoMatch } from '../src/core/match';
const read=(at:number,clock:number|null,dead:boolean|null=false):BroadcastReading=>({at,clock,elapsedMs:100,layout:'scoreboard',status:'test',replay:false,picks:[],victims:[],players:[{slot:'left-top',championId:'Gnar',confidence:.95,name:'TheShy',dead,timer:dead?16:null,deaths:dead?1:0}]});

describe('死亡证据确认与每人五秒冷却',()=>{
  it('第一帧明确死亡即可触发，持续倒计时不刷屏',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');
    expect(d.ingest(read(1000,100,true),m,1000)).toHaveLength(1);
    for(let at=1500;at<12000;at+=500)expect(d.ingest(read(at,100,true),m,at)).toHaveLength(0);
  });
  it('死亡数增长需要两次确认，短暂OCR错误不触发',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');d.ingest(read(1000,100),m,1000);
    const r=read(3000,102,null);r.players[0].deaths=1;
    expect(d.ingest(r,m,3000)).toHaveLength(0);
    const fast=read(3500,102,null);delete fast.players[0].deaths;
    expect(d.ingest(fast,m,3500)).toHaveLength(0);
    expect(d.ingest({...r,at:4000},m,4000)).toHaveLength(1);
  });
  it('头像与后到KDA合并，超过冷却也不补播暂存信号',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');d.ingest(read(1000,100),m,1000);
    const portrait=read(1500,101,true);portrait.players[0].deaths=0;
    expect(d.ingest(portrait,m,1500)).toHaveLength(1);
    expect(d.ingest(read(2000,101,true),m,2000)).toHaveLength(0);
    const fast=read(3000,102,true);delete fast.players[0].deaths;
    const events=d.ingest(fast,m,3000);expect(events).toHaveLength(0);
    expect(d.ingest({...fast,at:3500},m,3500)).toHaveLength(0);
    expect(d.ingest(read(8000,108,true),m,8000)).toHaveLength(0);
    expect(d.ingest(read(9000,109,true),m,9000)).toHaveLength(0);
  });
  it('4.6秒甚至10秒识别耗时仍触发，不因间隔长而重建存活基线',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');d.ingest(read(1000,100),m,1100);
    expect(d.ingest(read(1500,101,true),m,6107)).toHaveLength(1);
    const r=read(10000,109,null);r.players[0].deaths=2;
    expect(d.ingest(r,m,20000)).toHaveLength(0);
    expect(d.ingest({...r,at:11000},m,21000)).toHaveLength(1);
  });
  it('回放、倒退和前跳可开串，回到更早时间不会被旧水位永久卡住',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');d.ingest(read(1000,500),m,1000);
    expect(d.ingest({...read(3000,200,true),replay:true},m,3000)).toHaveLength(1);
    expect(d.ingest({...read(3500,201,true),replay:true},m,3500)).toHaveLength(0);
    expect(d.ingest(read(5000,600,true),m,5000)).toHaveLength(0);
    expect(d.ingest(read(8000,601,true),m,8000)).toHaveLength(0);
    expect(d.ingest(read(9000,200,true),m,9000)).toHaveLength(1);
  });
  it('时钟不可读或暂时不动不阻止新的头像证据',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');d.ingest(read(1000,100),m,1000);
    expect(d.ingest(read(5000,100,true),m,5000)).toHaveLength(1);
    d.reset();expect(d.ingest(read(6000,null,true),m,6000)).toHaveLength(1);
  });
  it('无计分板时新击杀栏即触发，目标物及相同栏不触发',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');m.players[0].championId='Gnar';
    const r={...read(1000,100),layout:'scene' as const,players:[],victims:['Gnar']};
    expect(d.ingest(r,m,1000)).toHaveLength(1);
    expect(d.ingest({...r,at:1500},m,1500)).toHaveLength(0);
    expect(d.ingest({...r,at:3000,victims:['Turret']},m,3000)).toHaveLength(0);
  });
  it('布局切换保留同一死亡状态，两帧复活后可再次触发',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');d.ingest(read(1000,100,true),m,1000);
    expect(d.ingest({...read(3000,102,true),layout:'compact'},m,3000)).toHaveLength(0);
    d.ingest(read(3500,103),m,3500);d.ingest(read(4000,103),m,4000);
    expect(d.ingest(read(6000,104,true),m,6000)).toHaveLength(1);
  });
  it('旧请求、未来或重复时间戳不触发，超过15秒才丢弃',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');
    expect(d.ingest(read(1000,100,true),m,17000)).toHaveLength(0);
    expect(d.ingest(read(2000,100,true),m,1000)).toHaveLength(0);
    expect(d.ingest(read(1000,100,true),m,1000)).toHaveLength(1);
    expect(d.ingest(read(1000,100,true),m,2000)).toHaveLength(0);
  });
  it('个人保护始终有效，BP和未知布局不能当作死亡',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');m.players[0].allowBanter=false;
    expect(d.ingest({...read(1000,100,true),victims:['Gnar'],replay:true},m,1000)).toHaveLength(0);
    m.players[0].allowBanter=true;
    expect(d.ingest({...read(2000,100,true),layout:'bp'},m,2000)).toHaveLength(0);
    expect(d.ingest({...read(3000,100,true),layout:'unknown'},m,3000)).toHaveLength(0);
  });
  it('Heng击杀TheShy：击杀数增长不是死亡，短暂错读死亡数也不是',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');
    m.players[0].name='Heng';m.players[0].championId='Pantheon';
    m.players[5].name='TheShy';m.players[5].championId='Gnar';
    const r=read(1000,170);r.players=[
      {...r.players[0],championId:'Pantheon',name:'Heng',kills:0,deaths:0},
      {...r.players[0],slot:'right-top',name:'TheShy',championId:'Gnar',kills:0,deaths:0}];
    d.ingest(r,m,1000);
    const kill={...r,at:2000,clock:171,victims:['Gnar'],players:r.players.map(p=>p.name==='Heng'?{...p,kills:1}:{...p,dead:true,timer:12})};
    expect(d.ingest(kill,m,2000).map(e=>e.slot)).toEqual(['right-top']);
    const noise={...kill,at:3000,players:kill.players.map(p=>p.name==='Heng'?{...p,deaths:1}:p)};
    expect(d.ingest(noise,m,3000)).toHaveLength(0);
    expect(d.ingest({...kill,at:4000},m,4000)).toHaveLength(0);
    expect(d.ingest({...kill,at:10000,clock:179},m,10000)).toHaveLength(0);
  });
  it('击杀栏不能覆盖明确存活证据，也不能把重复英雄绑定给两个选手',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');m.players[0].championId='Gnar';
    expect(d.ingest({...read(1000,100),victims:['Gnar']},m,1000)).toHaveLength(0);
    d.reset();m.players[1].championId='Gnar';
    expect(d.ingest({...read(2000,101),layout:'scene',players:[],victims:['Gnar']},m,2000)).toHaveLength(0);
  });
  it('冷却内新死亡丢弃，5000ms边界允许真正新死亡，不互相限制其他选手',()=>{
    const d=new BroadcastDetector(),m=demoMatch('s');
    d.ingest(read(1000,100,true),m,1000);
    d.ingest(read(1500,101),m,1500);d.ingest(read(2000,102),m,2000);
    expect(d.ingest(read(5999,103,true),m,5999)).toHaveLength(0);
    expect(d.ingest(read(6000,104,true),m,6000)).toHaveLength(0);
    d.ingest(read(6500,105),m,6500);d.ingest(read(7000,106),m,7000);
    expect(d.ingest(read(7500,107,true),m,7500)).toHaveLength(1);
  });
});

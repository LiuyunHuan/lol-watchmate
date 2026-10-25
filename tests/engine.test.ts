import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../electron/engine';
import { Storage } from '../electron/storage';
import { AudioCache } from '../electron/audio';
import { settingsSchema } from '../src/shared/types';
import { BroadcastReading } from '../src/shared/broadcast';

let root: string;
let engine: Engine;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'watchmate-test-'));
  const audio = { audio: vi.fn().mockResolvedValue('data:audio/wav;base64,UklGRg=='), abort: vi.fn(), voices: vi.fn().mockResolvedValue([]) } as unknown as AudioCache;
  engine = new Engine(new Storage(root), settingsSchema.parse({}), audio);
});
afterEach(() => {
  engine.dispose(); vi.restoreAllMocks(); vi.useRealTimers();
  if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'watchmate-test-'))) throw new Error('Unsafe test cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
describe('端到端状态编排', () => {
  it('最终输出按选手限流：4999ms不发、5000ms可发，不缓存补播',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
    await engine.action({type:'start',mode:'demo'});
    await engine.action({type:'demo',event:'death'});await vi.advanceTimersByTimeAsync(450);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4549);
    await engine.action({type:'demo',event:'replay'});await vi.advanceTimersByTimeAsync(450);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    await engine.action({type:'demo',event:'death'});await vi.advanceTimersByTimeAsync(450);
    const at=Date.now();expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4550);
    await engine.action({type:'demo',event:'death'});await vi.advanceTimersByTimeAsync(450);
    expect(Date.now()-at).toBe(5000);expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(3);
  });
  it('重置本地检测不能绕过每人冷却，其他选手仍可开串',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
    engine.settings.apiKey='unused';await engine.action({type:'start',mode:'live'});engine.setSource('test');
    const send=(slot:'right-top'|'left-jungle',name:string)=>engine.broadcastReading({at:Date.now(),elapsedMs:1,layout:'scoreboard',status:'test',clock:190,replay:false,picks:[],victims:[],players:[{slot,name,confidence:.9,dead:true,timer:12}]});
    send('right-top','TheShy');await vi.advanceTimersByTimeAsync(650);
    await engine.action({type:'broadcast-reset'});
    send('right-top','TheShy');await vi.advanceTimersByTimeAsync(650);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    send('left-jungle','Heng');await vi.advanceTimersByTimeAsync(650);
    expect(engine.state.messages.filter(m=>m.kind==='banter').map(m=>m.targets)).toEqual([['right-top'],['left-jungle']]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(2);
  });
  it('弹幕延伸也经过冷却，晚返回的内容直接丢弃',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
    engine.settings.apiKey='unused';engine.settings.danmakuEnabled=true;
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'{"text":"泉水等你。"}'}}],usage:{prompt_tokens:1,completion_tokens:1}})));
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    // Inject the visible-danmaku metadata through the existing engine seam; no paid request.
    (engine as any).visibleDanmaku={lines:['这波送了'],at:Date.now(),epoch:(engine as any).epoch,source:(engine as any).sourceGeneration};
    engine.broadcastReading({at:Date.now(),elapsedMs:1,layout:'scoreboard',status:'test',clock:190,replay:false,picks:[],victims:[],players:[{slot:'right-top',name:'TheShy',confidence:.9,dead:true,timer:12}]});
    await vi.advanceTimersByTimeAsync(700);
    expect(fetch).toHaveBeenCalledTimes(1);expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    fetch.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify({choices:[{message:{content:'{"text":"迟到的弹幕梗。"}'}}]}))),6000)));
    const late=(engine as any).extendDanmaku(['又送了'],[{slot:'right-top',observedAt:Date.now()}]);
    await vi.advanceTimersByTimeAsync(6000);await late;
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
  });
  it('独立手动搜梗进入候选，未经选入不播报；取消丢弃晚返回结果',async()=>{
    engine.settings.apiKey='test';
    const source='https://bbs.hupu.com/123.html';
    const page=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{detail:{thread:{tid:'123',title:'ShowMaker',content:'秀兵集合！',createdAt:1688000000000},lights:[],replies:{list:[]}}}}})}</script>`;
    const candidate={text:'秀兵集合，去泉水接许哥。',quote:'秀兵集合！',evidenceIndex:0,target:'ShowMaker',explanation:'粉丝称谓',condition:'death',conditionText:'普通死亡',samePlayer:true,containsMatchResult:false,rewrite:true};
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(u)=>new Response(String(u).includes('bbs.hupu.com')?page:JSON.stringify(String(u).includes('generation')
      ?{output:{search_info:{search_results:[{title:'ShowMaker',url:source}]}},usage:{input_tokens:10,output_tokens:10}}
      :{choices:[{message:{content:JSON.stringify({memes:[candidate]})}}],usage:{prompt_tokens:20,completion_tokens:20}})));
    await engine.action({type:'meme-search',players:[{name:'ShowMaker',team:'DK',focus:false}],cutoff:'2026-10-01'});
    for(let i=0;i<50&&engine.state.learning;i++)await sleep(10);
    expect(engine.state.learning).toBe(false);expect(engine.state.running).toBe(false);expect(engine.state.captureSource).toBeNull();
    const m=engine.state.memes.find(m=>m.origin==='search')!;
    expect(m).toMatchObject({review:'pending',enabled:false});expect(engine.state.speech).toBeNull();expect(fetch).toHaveBeenCalledTimes(4);
    await engine.action({type:'meme-review',ids:[m.id!],operation:'approve'});expect(m.enabled).toBe(true);
    await engine.action({type:'meme-review',ids:[m.id!],operation:'delete'});
    await engine.action({type:'meme-search',players:[{name:'ShowMaker',team:'DK',focus:false}],cutoff:'2026-10-01'});
    for(let i=0;i<50&&engine.state.learning;i++)await sleep(10);
    expect(engine.state.memes.filter(m=>m.text===candidate.text)).toHaveLength(1);
    let release!:(r:Response)=>void;
    fetch.mockImplementation(()=>new Promise(r=>{release=r;}));
    await engine.action({type:'meme-search',players:[{name:'knight',team:'BLG',focus:false}],cutoff:'2026-10-01'});
    expect(engine.state.learning).toBe(true);await engine.action({type:'pause'});const calls=fetch.mock.calls.length;
    release(new Response(JSON.stringify({output:{search_info:{search_results:[{url:source}]}}})));
    await sleep(20);expect(engine.state.learning).toBe(false);expect(fetch).toHaveBeenCalledTimes(calls);
    expect(engine.state.memes.filter(m=>m.origin==='search')).toHaveLength(1);
  });
  it('删除正在等待的梗后语音队列立即撤下，编辑也不补播旧文本',async()=>{
    await engine.action({type:'start',mode:'demo'});
    await engine.action({type:'speaking',value:true});
    await engine.action({type:'demo',event:'death'});await sleep(650);
    const message=engine.state.messages.find(m=>m.kind==='banter')!;
    const meme=engine.state.memes.find(m=>m.text===message.text)!;
    await engine.action({type:'meme-review',ids:[meme.id!],operation:'delete'});
    await engine.action({type:'speaking',value:false});
    expect(engine.state.speech).toBeNull();expect(message.speechStatus).toBe('skipped');
  });
  it('4.6秒慢头像在回放中也立即开串，后到KDA合并且不延后补播',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
    engine.settings.autoLearn=false;engine.settings.apiKey='test';
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    const send=(dead:boolean,deaths:number,age=0,replay=false,clock=208)=>engine.broadcastReading({at:Date.now()-age,elapsedMs:age,layout:'scoreboard',status:'test',clock,replay,picks:[],victims:[],players:[{slot:'right-top',name:'TheShy',championId:'DrMundo',confidence:.95,dead,timer:dead?12:null,kills:0,deaths,assists:0}]});
    send(false,0,6000,false,500);
    send(true,0,4607,true); // The roster accepted this in v0.4.1, the death detector discarded it.
    expect(engine.state.match.players.find(p=>p.name==='TheShy')?.dead).toBe(true);
    expect(engine.state.metrics.deaths).toBe(1);
    await vi.advanceTimersByTimeAsync(700);
    const first=engine.state.messages.find(m=>m.kind==='banter')!;
    expect(first.text).toBe('下雨了。');expect(engine.state.speech?.kind).toBe('banter');
    await vi.advanceTimersByTimeAsync(1000);send(true,1,0,true,209);
    await vi.advanceTimersByTimeAsync(700);
    expect(engine.state.messages.filter(m=>m.kind==='banter').map(m=>m.text)).toEqual(['下雨了。']);
    expect(engine.state.metrics.deaths).toBe(1);
    for(let i=0;i<8;i++){await vi.advanceTimersByTimeAsync(500);send(true,1,0,true,209);}
    expect(engine.state.metrics.deaths).toBe(1);
    await engine.action({type:'player',slot:'right-top',patch:{allowBanter:false}});
    await vi.advanceTimersByTimeAsync(500);send(true,2,0,true,210);
    expect(engine.state.metrics.deaths).toBe(1);
    await engine.action({type:'pause'});await vi.advanceTimersByTimeAsync(500);send(true,3);
    expect(engine.state.metrics.deaths).toBe(1);expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('10秒慢识别结果仍有起播窗口，不会刚进队列就因旧截图时间而过期',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
    engine.settings.autoLearn=false;engine.settings.apiKey='test';
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    engine.broadcastReading({at:Date.now()-10000,elapsedMs:10000,layout:'scoreboard',status:'test',clock:null,replay:false,picks:[],victims:[],players:[{slot:'right-top',name:'TheShy',confidence:1,dead:true,timer:12}]});
    await vi.advanceTimersByTimeAsync(700);
    expect(engine.state.speech?.kind).toBe('banter');
    expect(engine.state.speech!.expiresAt).toBeGreaterThan(Date.now());
  });
  it('稀疏战绩确认两位选手死亡后立即开串，中间无KDA快速帧不吞事件',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
    engine.settings.autoLearn=false;engine.settings.apiKey='test';
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    const send=(deaths?:number)=>{
      const r:BroadcastReading={at:Date.now(),elapsedMs:100,layout:'scoreboard',status:'test',clock:420+Math.floor((Date.now()-new Date('2026-10-23T08:00:00Z').getTime())/1000),replay:false,picks:[],victims:[],
        players:([{slot:'right-top',name:'TheShy',championId:'KSante'},{slot:'right-mid',name:'Rookie',championId:'Aurora'}] as const).map(p=>({...p,confidence:.95,dead:null,timer:null,...(deaths===undefined?{}:{kills:0,deaths,assists:0})}))};
      engine.broadcastReading(r);
    };
    send(0);await vi.advanceTimersByTimeAsync(500);send(0);
    for(let tick=1;tick<=8;tick++){await vi.advanceTimersByTimeAsync(500);send(tick===4||tick===8?1:undefined);}
    expect(engine.state.match.players.filter(p=>p.name==='TheShy'||p.name==='Rookie').map(p=>p.deaths)).toEqual([1,1]);
    expect(engine.state.metrics.deaths).toBe(2);
    await vi.advanceTimersByTimeAsync(700);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(2);
    expect(engine.state.speech?.kind).toBe('banter');
    send(1);await vi.advanceTimersByTimeAsync(500);send(1);await vi.advanceTimersByTimeAsync(700);
    expect(engine.state.metrics.deaths).toBe(2);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('无计分板时保留已确认英雄、等级和战绩，不填造死亡',async()=>{
    engine.settings.autoLearn=false;engine.settings.apiKey='test';
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    const at=Date.now()-1500;
    const r:BroadcastReading={at,elapsedMs:200,layout:'scoreboard',status:'test',clock:844,replay:false,picks:[],victims:[],players:[{slot:'left-top',name:'Xiaoxu',championId:'Ambessa',confidence:.95,level:11,kills:0,deaths:0,assists:0,dead:false,timer:null}]};
    engine.broadcastReading(r);engine.broadcastReading({...r,at:at+500});
    const before={...engine.state.match.players[0]};
    engine.broadcastReading({...r,at:at+1000,clock:845,layout:'scene',players:[]});
    expect(engine.state.match.players[0]).toEqual(before);
    expect(engine.state.match.gameSeconds).toBe(845);expect(engine.state.metrics.deaths).toBe(0);
  });
  it('名单变化、换局、重启不自动搜索；删除墓碑和启用状态持久化',async()=>{
    engine.settings.apiKey='test'; engine.settings.autoLearn=true;
    const fetch=vi.spyOn(globalThis,'fetch');
    await engine.action({type:'start',mode:'live'});
    for (const p of engine.state.match.players) await engine.action({type:'player',slot:p.slot,patch:{name:p.slot}});
    await engine.action({type:'next-game'});
    const meme=engine.state.memes[0];
    await engine.action({type:'meme-review',ids:[meme.id!],operation:'delete'});
    engine.dispose(); const audio={audio:vi.fn().mockResolvedValue(''),abort:vi.fn(),voices:vi.fn().mockResolvedValue([])} as unknown as AudioCache;
    engine=new Engine(new Storage(root),settingsSchema.parse({apiKey:'test',autoLearn:true}),audio);
    expect(engine.state.memes.find(m=>m.id===meme.id)?.review).toBe('deleted');
    expect(fetch).not.toHaveBeenCalled();
    await engine.action({type:'meme-review',ids:[meme.id!],operation:'restore'});
    expect(engine.state.memes.find(m=>m.id===meme.id)?.review).toBe('approved');
  });
  it('通用死亡短句在梗库中可见且开关持久化',async()=>{
    const index=engine.state.memes.findIndex(m=>m.kind==='player'&&m.target==='*');expect(index).toBeGreaterThan(-1);
    await engine.action({type:'meme-toggle',id:engine.state.memes[index].id!,enabled:false});
    expect(JSON.parse(fs.readFileSync(path.join(root,'memes.json'),'utf8'))[index].enabled).toBe(false);
  });
  it('本地 BP 慢匹配仍可保存，不提前分配英雄；手动纠正锁定不被覆盖', async () => {
    engine.settings.autoLearn=false;engine.settings.apiKey='test-only';
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    engine.state.match.players[0].champion='旧版错误识别';
    const frame:BroadcastReading={at:Date.now()-5000,elapsedMs:5000,layout:'bp',status:'bp',clock:null,replay:false,players:[],victims:[],picks:[{side:'left',position:1,championId:'Gnar',confidence:.9}]};
    engine.broadcastReading(frame);engine.broadcastReading({...frame,at:frame.at+1});
    expect(engine.state.match.draft?.[0].championId).toBe('Gnar');
    expect(engine.state.match.players.every(p=>!p.champion)).toBe(true);
    await engine.action({type:'draft-pick',side:'left',position:1,championId:'Fiora',order:1});
    engine.broadcastReading({...frame,at:frame.at+2});
    expect(engine.state.match.draft?.[0]).toMatchObject({championId:'Fiora',order:1,locked:true});
    await engine.action({type:'player',slot:'left-top',patch:{name:'TheShy',champion:'纳尔',locked:true}});
    engine.broadcastReading({...frame,at:Date.now(),elapsedMs:100,layout:'scoreboard',clock:844,picks:[],players:[{slot:'left-top',name:'Wrong',championId:'Fiora',confidence:.99,dead:false,timer:null}]});
    expect(engine.state.match.players[0]).toMatchObject({name:'TheShy',championId:'Gnar',champion:'纳尔'});
  });
  it('没有搜索及专属梗时，死亡仍有本地文字和语音；重复及暂停不补播', async () => {
    engine.settings.autoLearn=false;engine.settings.apiKey='test-only';
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    await engine.action({type:'start',mode:'live'});engine.setSource('test');
    const now=Date.now();
    const frame:BroadcastReading={at:now-1500,elapsedMs:100,layout:'scoreboard',status:'test',clock:1986,replay:false,picks:[],victims:[],players:[{slot:'left-adc',championId:'Yunara',confidence:.9,name:'GALA',dead:false,timer:null}]};
    engine.broadcastReading(frame);
    const death:BroadcastReading={...frame,layout:'compact',at:now-1000,clock:1987,victims:['Yunara'],players:frame.players.map(p=>({...p,dead:true,timer:46}))};
    engine.broadcastReading(death);engine.broadcastReading({...death,at:now-500});
    await sleep(750);
    expect(engine.state.metrics.deaths).toBe(1);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    expect(engine.state.speech?.kind).toBe('banter');
    engine.broadcastReading({...death,at:now});
    await engine.action({type:'pause'});engine.broadcastReading({...death,at:Date.now()});
    await sleep(480);
    expect(engine.state.messages.filter(m=>m.kind==='banter')).toHaveLength(1);
    expect(engine.state.speech).toBeNull();expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('演示无需网络；团战顺序、保护、文字保留和暂停生效', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'demo', event: 'teamfight' });
    await sleep(480);
    const jokes = engine.state.messages.filter(m => m.kind === 'banter');
    expect(jokes.map(m => m.text)).toEqual(['下雨了。', '都发狂了。']);
    expect(engine.state.speech?.text).toBe('下雨了。');
    await engine.action({ type: 'team', side: 'left', protect: true });
    expect(engine.state.speech).toBeNull();
    await engine.action({ type: 'pause' });
    expect(engine.state.running).toBe(false);
    expect(engine.state.messages.filter(m => m.kind === 'banter')).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('回答期间生成的梗保留文字，不抢语音', async () => {
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'question', text: '怎么赢？' });
    await engine.action({ type: 'demo', event: 'death' });
    await sleep(480);
    expect(engine.state.messages.some(m => m.kind === 'banter')).toBe(true);
    expect(engine.state.speech).toBeNull();
    await sleep(120);
    expect(engine.state.speech?.kind).toBe('answer');
  });
  it('暂停丢弃未完成的问答结果', async () => {
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'question', text: 'BP怎么选？' });
    engine.pause();
    await sleep(600);
    expect(engine.state.messages.some(m => m.kind === 'answer')).toBe(false);
    expect(engine.state.speech).toBeNull();
  });
  it('每局写同一MD；下一局读取前局坦克选择并产生亮剑梗', async () => {
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'finish-game' });
    const id = engine.state.match.seriesId;
    expect(fs.existsSync(path.join(root, 'series', `${id}.md`))).toBe(true);
    await engine.action({ type: 'next-game' });
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'player', slot: 'left-top', patch: { champion: '剑姬', locked: true } });
    expect(engine.state.messages.some(m => m.text.includes('上把扛压，这把亮剑'))).toBe(true);
    expect(fs.readdirSync(path.join(root, 'series'))).toHaveLength(1);
  });
  it('实际模式失败时明确报错，未知用量不计为零', async () => {
    engine.settings.apiKey = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    await engine.action({ type: 'start', mode: 'live' });
    await engine.action({ type: 'question', text: '你好' });
    await sleep(50);
    expect(engine.state.messages.some(m => m.text.includes('HTTP 401'))).toBe(true);
    expect(engine.state.usage[0].cost).toBeNull();
    expect(engine.state.unpriced).toBe(1);
    expect(engine.state.speech).toBeNull();
  });
  it('换边后保护和手动优先级跟随选手身份，而不是旧位置', async () => {
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'player', slot: 'left-top', patch: { allowBanter: false, priority: 12 } });
    await engine.action({ type: 'next-game' });
    await engine.action({ type: 'player', slot: 'right-top', patch: { name: 'TheShy' } });
    await engine.action({ type: 'player', slot: 'left-top', patch: { name: 'Bin' } });
    expect(engine.state.match.players.find(p => p.slot === 'right-top')?.allowBanter).toBe(false);
    expect(engine.state.match.players.find(p => p.slot === 'right-top')?.priority).toBe(12);
    expect(engine.state.match.players.find(p => p.slot === 'left-top')?.allowBanter).toBe(true);
  });
  it('语音尚未起播就过期的梗只保留文字', async () => {
    await engine.action({ type: 'start', mode: 'demo' });
    await engine.action({ type: 'demo', event: 'death' });
    await sleep(480);
    expect(engine.state.speech?.kind).toBe('banter');
    engine.state.speech!.expiresAt = Date.now() - 1;
    await sleep(300);
    expect(engine.state.speech).toBeNull();
    expect(engine.state.messages.find(m => m.kind === 'banter')?.speechStatus).toBe('skipped');
  });
  it('跨局只读取Markdown，不把上一局对话送入新的问题上下文', async () => {
    engine.settings.apiKey = 'test';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ text: '测试分析', speech: '', sourceIndexes: [], corrections: [], patchCorrection: '' }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }), { status: 200 }));
    await engine.action({ type: 'start', mode: 'live' });
    await engine.action({ type: 'question', text: '上一局测试专有句' });
    await sleep(50);
    await engine.action({ type: 'next-game' });
    await engine.action({ type: 'start', mode: 'live' });
    await engine.action({ type: 'question', text: '新局问题' });
    await sleep(50);
    const body = JSON.parse(mock.mock.calls.at(-1)![1]!.body as string);
    const input = JSON.parse(body.messages[1].content);
    expect(JSON.stringify(input.recentConversation)).not.toContain('上一局测试专有句');
    expect(input.seriesMemory).toContain('第 1 局');
  });
  it('画面403停止自动请求，重新开始才重试；其他功能仍可使用', async () => {
    engine.settings.apiKey = 'test';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 403 }));
    await engine.action({ type: 'start', mode: 'live' }); engine.setSource('test');
    await engine.frame('data:image/jpeg;base64,test', Date.now());
    expect(engine.state.visionRetryAt).toBe(-1);
    expect(engine.state.running).toBe(true);
    await engine.frame('data:image/jpeg;base64,test', Date.now() + 10000);
    expect(mock).toHaveBeenCalledTimes(1);
    engine.pause(); await engine.action({ type: 'start', mode: 'live' });
    await engine.frame('data:image/jpeg;base64,test', Date.now());
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('暂时性故障退避，不因每帧回调而重复收费请求，成功后恢复', async () => {
    engine.settings.apiKey = 'test';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 503 }));
    await engine.action({ type: 'start', mode: 'live' }); engine.setSource('test');
    const started = Date.now();
    await engine.frame('data:image/jpeg;base64,test', started);
    expect(engine.state.visionRetryAt).toBeGreaterThanOrEqual(started + 5000);
    await engine.frame('data:image/jpeg;base64,test', Date.now());
    expect(mock).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Math.max(engine.state.visionRetryAt, started + engine.settings.captureIntervalMs) + 1);
    mock.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ phase: 'bp', gameSeconds: null, situation: '', players: [], danmaku: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));
    await engine.frame('data:image/jpeg;base64,test', Date.now());
    expect(engine.state.match.phase).toBe('bp');
    expect(engine.state.visionError).toBeNull(); expect(engine.state.visionRetryAt).toBe(0);
  });
  it('问答要求新截图、优先于背景识别，并把截图分析送入回答', async () => {
    engine.settings.apiKey = 'test'; engine.settings.autoLearn = false;
    const requests: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string); requests.push(body);
      const observation = { phase: 'bp', gameSeconds: null, situation: '新截图：左方需要开团', players: [], danmaku: [] };
      const answer = { text: '考虑补开团', speech: '', sourceIndexes: [], corrections: [], patchCorrection: '' };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body.model.includes('vl') ? observation : answer) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
    await engine.action({ type: 'start', mode: 'live' }); engine.setSource('test');
    await engine.action({ type: 'question', text: '左边怎么赢' });
    const request = engine.state.questionFrameRequest!;
    expect(request).not.toBeNull();
    await engine.frame('old', Date.now()); expect(requests).toHaveLength(0);
    engine.questionFrame({ id: request.id, image: 'data:image/jpeg;base64,NEW', at: Date.now() });
    await sleep(60);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0].messages)).toContain('base64,NEW');
    expect(JSON.stringify(requests[1].messages)).toContain('新截图：左方需要开团');
    expect(engine.state.messages.some(m => m.kind === 'answer')).toBe(true);
  });
  it('低频云端死亡不能重复触发本地玩梗', async () => {
    engine.settings.apiKey = 'test'; engine.settings.autoLearn = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ phase: 'live', gameSeconds: 100, situation: '',
        players: [{ slot: 'left-top', name: 'TheShy', dead: true, deaths: 1, confidence: 1, evidence: '云端死亡' }] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));
    await engine.action({ type: 'start', mode: 'live' }); engine.setSource('test');
    await engine.frame('test', Date.now());
    expect(engine.state.metrics.deaths).toBe(0);
  });
  it('提问取消未完成的周期视觉，旧结果不能清除新任务状态或覆盖场景', async () => {
    engine.settings.apiKey = 'test'; engine.settings.autoLearn = false;
    let calls = 0, cancelled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      calls++; const body = JSON.parse(init!.body as string);
      if (calls === 1) return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { cancelled = true; reject(new Error('abort')); });
      });
      const content = body.model.includes('vl') ? { phase: 'bp', gameSeconds: null, situation: '问题新画面', players: [] }
        : { text: '新画面分析', speech: '', corrections: [], sourceIndexes: [], patchCorrection: '' };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
    await engine.action({ type: 'start', mode: 'live' }); engine.setSource('test');
    const background = engine.frame('old', Date.now());
    await engine.action({ type: 'question', text: '怎么赢' });
    const request = engine.state.questionFrameRequest!;
    engine.questionFrame({ id: request.id, image: 'new', at: Date.now() });
    await background; await sleep(60);
    expect(cancelled).toBe(true); expect(engine.state.match.situation).toBe('问题新画面');
    expect(engine.state.frameBusy).toBe(false);
    expect(engine.state.messages.some(m => m.text.includes('请求超时'))).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hupuUrl, parseHupu, HupuReader } from '../electron/hupu';
import { Evidence, mentions, searchMemes, validateCandidates } from '../electron/meme-search';
import { Providers } from '../electron/providers';
import { migrateMemes, playable } from '../src/core/meme-library';
import { demoMatch } from '../src/core/match';

const url='https://bbs.hupu.com/60964641.html';
const html=(detail:unknown)=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{detail}}})}</script>`;
const detail={ thread:{tid:'1',title:'ShowMaker 赛后讨论',content:'<p>正文</p><a href="huputiyu://lol/lol/1">评分</a>',createdAt:1688000000000},
  lights:[{pid:'2',content:'<p>秀兵集合！</p>',count:5058,createdAt:1688000000000,quote:{content:'<p>许哥</p>'}}],
  replies:{list:[{pid:'2',content:'秀兵集合！'},{pid:'3',content:'隐藏评论',isHidden:true},{pid:'4',content:'AI评论',containsAi:1},
    {pid:'5',content:'<p>许哥再来</p>',count:2,createdAt:1688000000000}]}, hot:[{pid:'6',content:'推荐垃圾'}] };
afterEach(()=>vi.restoreAllMocks());
describe('虎扑采集与候选审核边界',()=>{
  it('正文/热评/普通评论保留上下文、标识与赞数；排除重复/隐藏/推荐/AI',()=>{
    const page=parseHupu(html(detail),url);
    expect(page.comments.map(c=>c.id)).toEqual(['thread:1','2','5']);
    expect(page.comments[1]).toMatchObject({quote:'许哥',likes:5058,hot:true});
    expect(page.ratingStatus).toContain('评分页未读取');
    expect(()=>parseHupu('<html>验证</html>',url)).toThrow('验证');
    expect(()=>parseHupu(html({thread:{},lights:[]}),url)).toThrow('结构变化');
  });
  it('阻止伪域名、带认证地址、App 跳转及非公开路径',()=>{
    for(const u of ['https://bbs.hupu.com.evil/1.html','https://evil@bbs.hupu.com/1.html','https://bbs.hupu.com/api/private','https://127.0.0.1/1.html'])expect(hupuUrl(u)).toBeNull();
    expect(hupuUrl('http://bbs.hupu.com/1.html')).toBe('https://bbs.hupu.com/1.html');
    expect(hupuUrl(url+'?tracking=1')).toBe(url);
  });
  it('引用必须逐字可追溯；对象混淆和条件不足的句子不自动播报',()=>{
    const evidence:Evidence[]=[{id:'2',text:'秀兵集合！',quote:'许哥',date:'2023-06-29',threadDate:'2023-06-29',likes:5058,hot:true,url,title:'ShowMaker 赛后'}];
    const c={text:'秀兵集合，去泉水接许哥。',quote:'秀兵集合！',evidenceIndex:0,target:'ShowMaker',explanation:'粉丝称谓',condition:'death',conditionText:'死亡',samePlayer:true,containsMatchResult:false,rewrite:true};
    const parse=(x:unknown)=>validateCandidates(JSON.stringify({memes:[x]}),evidence,{name:'ShowMaker',team:'DK',focus:false});
    expect(parse(c)[0]).toMatchObject({review:'pending',enabled:false,evidence:{commentId:'2'}});
    expect(parse({...c,quote:'不存在的原文'})).toEqual([]);
    expect(parse({...c,target:'knight'})).toEqual([]);
    expect(parse({...c,containsMatchResult:true})).toEqual([]);
    const special=parse({...c,text:'贯穿中路。'})[0];expect(special.condition).toBe('manual-only');
    expect(playable({...special,review:'approved',enabled:true})).toBe(false);
    expect(mentions('左手杰斯，右手纳尔，绝症哥','knight')).toBe(false);
  });
  it('旧梗迁移保持启停状态；四队友存活条件未知时拒绝',()=>{
    const [m]=migrateMemes([{kind:'player',target:'TheShy',text:'测试',scene:'death',sources:[],origin:'builtin',enabled:false}],()=> 'stable');
    expect(m).toMatchObject({id:'stable',enabled:false,review:'approved'});
    const match=demoMatch('test');
    expect(playable({...m,enabled:true,condition:'four-allies-alive'},match,'left-top')).toBe(true);
    match.players[1].dead=null;
    expect(playable({...m,enabled:true,condition:'four-allies-alive'},match,'left-top')).toBe(false);
    expect(playable({...m,enabled:true,review:'pending'},match,'left-top')).toBe(false);
  });
  it('同帖缓存共享，403不伪装空页，取消后不再发请求',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(html(detail)));
    const controller=new AbortController(),reader=new HupuReader(controller.signal);
    await reader.read(url); await reader.read(url); expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response('',{status:403}));
    await expect(reader.read('https://bbs.hupu.com/2.html')).rejects.toThrow('403');
    controller.abort(); expect(()=>reader.read(url)).toThrow();expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('每人搜索/页面/评论数量有上限；单页失败继续，重点倍增',async()=>{
    const provider={search:vi.fn().mockResolvedValue(Array.from({length:20},(_,i)=>({url:`https://bbs.hupu.com/${i+1}.html`}))),
      chat:vi.fn().mockResolvedValue('{"memes":[]}')} as unknown as Providers;
    const reader={read:vi.fn(async(u:string)=>{if(u.endsWith('/1.html'))throw new Error('403');return {...parseHupu(html(detail),url),url:u,comments:Array.from({length:80},(_,i)=>({id:`${u}:${i}`,text:`ShowMaker ${u} comment ${i}`,quote:'',date:'2023-01-01',likes:i,hot:true}))};})} as unknown as HupuReader;
    await searchMemes([{name:'ShowMaker',team:'DK',focus:false}], '2026-10-01',provider,new AbortController().signal,()=>{},()=>{},reader);
    expect(provider.search).toHaveBeenCalledTimes(2); expect(reader.read).toHaveBeenCalledTimes(4);
    let input=JSON.parse((vi.mocked(provider.chat).mock.calls[0][1][1] as any).content);
    expect(input.evidence).toHaveLength(60);
    vi.mocked(provider.search).mockClear(); vi.mocked(reader.read).mockClear();vi.mocked(provider.chat).mockClear();
    await searchMemes([{name:'ShowMaker',team:'DK',focus:true}], '2026-10-01',provider,new AbortController().signal,()=>{},()=>{},reader);
    expect(provider.search).toHaveBeenCalledTimes(4);expect(reader.read).toHaveBeenCalledTimes(8);
    input=JSON.parse((vi.mocked(provider.chat).mock.calls[0][1][1] as any).content);expect(input.evidence).toHaveLength(120);
  });
});

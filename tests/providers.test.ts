import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers, parseJson } from '../electron/providers';
import { observationSchema, settingsSchema, UsageRecord } from '../src/shared/types';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('云端适配边界', () => {
  it('ASR发送WAV数据，依据服务返回秒数计价', async () => {
    const config = settingsSchema.parse({ apiKey: 'local-test', asrSecondRate: 0.001 });
    const records: UsageRecord[] = [];
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '下一手抢什么' } }],
      usage: { prompt_tokens: 70, completion_tokens: 7, seconds: 2 },
    }), { status: 200 }));
    const p = new Providers(() => config, () => true, record => records.push(record));
    const text = await p.chat('asr', [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,AAAA' } }] }], {}, 2.2);
    expect(text).toBe('下一手抢什么');
    const request = JSON.parse(mock.mock.calls[0][1]!.body as string);
    expect(request.model).toBe('qwen3-asr-flash');
    expect(request.asr_options.language).toBe('zh');
    expect(records[0].cost).toBe(0.002);
  });
  it('原生检索只采用真实来源，按域名和日期过滤，费用拆分且未知不为零',async()=>{
    const cfg=settingsSchema.parse({apiKey:'test',qwenSearchRate:.003,searchInputRate:1,searchOutputRate:2});
    const records:UsageRecord[]=[];
    const mock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({
      output:{search_info:{search_results:[
        {title:'来源',url:'https://bbs.hupu.com/123.html',datePublished:'2026-01-01'},
        {title:'未来',url:'https://bbs.hupu.com/456.html',datePublished:'2026-11-01'},
        {title:'外站',url:'https://example.org/1'},
      ]}},usage:{input_tokens:100,output_tokens:20,plugins:{search:{count:1}}}
    })));
    const p=new Providers(()=>cfg,()=>true,r=>records.push(r));
    expect(await p.search('test','2026-10-01','bbs.hupu.com')).toHaveLength(1);
    const body=JSON.parse(mock.mock.calls[0][1]!.body as string);
    expect(body.parameters.search_options.assigned_site_list).toEqual(['bbs.hupu.com']);
    expect(body.parameters.search_options.enable_source).toBe(true);
    expect(String(mock.mock.calls[0][0])).toContain('/api/v1/services/aigc/text-generation/generation');
    expect(records.map(r=>r.category)).toEqual(['text','search']);
    expect(records[1].status).toBe('unknown'); expect(records[1].cost).toBe(.003);
    mock.mockResolvedValue(new Response(JSON.stringify({output:{choices:[{message:{content:'https://fake.example'}}]}})));
    await expect(p.search('test','2026-10-01')).rejects.toThrow('未返回真实搜索来源');
    expect(records.at(-1)?.cost).toBeNull();
  });
  it('暂停禁止新网络请求且不虚记费用', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'), record = vi.fn();
    const p = new Providers(() => settingsSchema.parse({ apiKey: 'test' }), () => false, record);
    await expect(p.chat('text', [])).rejects.toThrow('暂停');
    expect(fetch).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
  });
  it('模型同一帧重复位置被拒绝，不能伪造两帧确认', () => {
    const player = { slot: 'left-top', dead: true, deaths: 1, confidence: 1, evidence: 'test' };
    expect(() => parseJson(JSON.stringify({ phase: 'live', gameSeconds: 100, situation: '', players: [player, player] }), observationSchema)).toThrow();
  });
  it('403标出失败服务与安全错误码，绝不反射服务返回的密钥或提示词', async () => {
    const config = settingsSchema.parse({ apiKey: 'secret-key', searchKey: 'search-secret' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      error: { code: 'AccessDenied.Unpurchased', message: 'secret-key PRIVATE USER CONTENT' },
    }), { status: 403 }));
    const p = new Providers(() => config, () => true, () => {});
    await expect(p.chat('vision', [])).rejects.toThrow('画面识别（qwen3-vl-plus）：HTTP 403（AccessDenied.Unpurchased）');
    await expect(p.search('test', '2026-10-01')).rejects.toThrow('联网搜索：HTTP 403');
    try { await p.chat('text', []); } catch (e) {
      expect(String(e)).not.toContain('secret-key'); expect(String(e)).not.toContain('PRIVATE');
    }
  });
  it('模型等待超过25秒仍可继续，到配置上限才中止并说明超时来源', async () => {
    vi.useFakeTimers();
    const config = settingsSchema.parse({ apiKey: 'test', modelTimeoutMs: 60000 });
    let aborted = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('abort')); });
    }));
    const p = new Providers(() => config, () => true, () => {});
    const pending = expect(p.chat('vision', [])).rejects.toThrow('画面识别（qwen3-vl-plus）：等待 60 秒');
    await vi.advanceTimersByTimeAsync(25001); expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(35000); await pending; expect(aborted).toBe(true);
  });
  it('达到token上限的部分JSON不作为成功结果使用', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: '{"phase":' } }],
      usage: { prompt_tokens: 100, completion_tokens: 2200 },
    })));
    const records: UsageRecord[] = [];
    const p = new Providers(() => settingsSchema.parse({ apiKey: 'test' }), () => true, r => records.push(r));
    await expect(p.chat('vision', [])).rejects.toThrow('输出达到长度上限');
    expect(records).toHaveLength(1); expect(records[0].status).toBe('reported');
  });
  it('403停止重复请求并可显式恢复，不反射任意错误正文',async()=>{
    const cfg=settingsSchema.parse({apiKey:'secret'}),records:UsageRecord[]=[];
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({message:'secret PRIVATE'}),{status:403}));
    const p=new Providers(()=>cfg,()=>true,r=>records.push(r));
    await expect(p.search('test','2026-10-01')).rejects.toThrow('HTTP 403');
    await expect(p.search('test2','2026-10-01')).rejects.toThrow('HTTP 403');
    expect(fetch).toHaveBeenCalledTimes(1);expect(records).toHaveLength(2);expect(p.searchBlocked).toBe(true);
    p.resetSearch();fetch.mockResolvedValue(new Response(JSON.stringify({output:{search_info:{search_results:[]}}})));
    expect(await p.search('test','2026-10-01')).toEqual([]);expect(fetch).toHaveBeenCalledTimes(2);
  });
});

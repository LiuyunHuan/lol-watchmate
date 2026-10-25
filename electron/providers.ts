import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { estimateCost } from '../src/core/budget';
import { Settings, Source, UsageRecord } from '../src/shared/types';

export function parseJson<S extends z.ZodTypeAny>(text: string, schema: S): z.output<S> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return schema.parse(JSON.parse(stripped));
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'ProviderError'; }
}
// Never expose arbitrary upstream messages: they can echo keys, recordings or prompts.
const knownErrors: Record<string, string> = {
  'AccessDenied.Unpurchased': '未开通服务或没有该模型的调用资格，请检查账号与业务空间授权',
  'Model.AccessDenied': '没有该模型的访问权限，请检查业务空间授权',
  'InvalidApiKey': '密钥无效，请检查密钥及其所属地域',
  'invalid_api_key': '密钥无效，请检查密钥及其所属地域',
  'model_not_found': '模型不存在或当前账号无法访问，请核对模型 ID、地域及开通状态',
  'ModelNotFound': '模型不存在或当前账号无法访问，请核对模型 ID、地域及开通状态',
  'Arrearage': '账户欠费，请到服务商控制台检查账单',
};

export class Providers {
  searchSummary = '';
  private pending = new Map<AbortController, string>();
  private searchBlock?: { key: string; url: string; error: ProviderError };
  get searchBlocked() { return !!this.searchBlock && this.searchBlock.key === this.config().apiKey && this.searchBlock.url === this.config().baseUrl; }
  resetSearch() { this.searchBlock = undefined; }
  constructor(
    private config: () => Settings,
    private active: () => boolean,
    private record: (usage: UsageRecord) => void,
  ) {}
  abort() { for (const c of this.pending.keys()) c.abort(); this.pending.clear(); }
  abortVision() { for (const [c, label] of this.pending) if (label.startsWith('画面识别')) c.abort(); }
  private async request(url: string, key: string, body: unknown, label: string, timeout = 25000): Promise<any> {
    if (!this.active()) throw new Error('Agent 已暂停');
    if (!key) throw new Error('尚未配置 API 密钥，请先打开设置');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))) {
      throw new Error('服务地址须使用 HTTPS（本地服务除外）');
    }
    const controller = new AbortController();
    this.pending.set(controller, label);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        let code = '';
        try { const data = await response.json(); code = String(data.error?.code ?? data.code ?? ''); } catch {}
        const known = Object.prototype.hasOwnProperty.call(knownErrors, code) && !code.includes(key);
        const fallback = response.status === 403 ? '访问被拒绝，请检查该服务的权限、额度和开通状态'
          : response.status === 429 ? '请求被限流，请降低请求频率或检查服务配额'
          : '请检查该服务的地址、权限、模型名称与额度';
        throw new ProviderError(`${label}：HTTP ${response.status}${known ? `（${code}）` : ''}。${known ? knownErrors[code] : fallback}`, response.status);
      }
      const text = await response.text();
      if (text.length > 4_000_000) throw new Error('服务响应过大');
      return JSON.parse(text);
    } catch (e) {
      if (controller.signal.aborted) throw new ProviderError(this.active()
        ? `${label}：等待 ${timeout / 1000} 秒仍未收到完整响应，已中止本次请求。可检查网络、切换响应更快的模型或调整模型请求超时；降低采样频率不会缩短单次响应。`
        : 'Agent 已暂停');
      if (e instanceof ProviderError) throw e;
      if (e instanceof Error && e.message.startsWith('服务')) throw e;
      throw new ProviderError(`${label}：无法连接服务或返回格式异常，请检查服务地址与网络`);
    } finally { clearTimeout(timer); this.pending.delete(controller); }
  }
  async chat(category: 'text' | 'vision' | 'asr', messages: unknown[], extra: Record<string, unknown> = {}, seconds = 0): Promise<string> {
    const cfg = this.config();
    if (!this.active()) throw new Error('Agent 已暂停');
    if (!cfg.apiKey) throw new Error('尚未配置 API 密钥');
    const model = category === 'vision' ? cfg.visionModel : category === 'asr' ? cfg.asrModel : cfg.textModel;
    const label = `${category === 'vision' ? '画面识别' : category === 'asr' ? '语音识别' : '战术问答'}（${model}）`;
    const id = randomUUID(), at = Date.now();
    let reported = false;
    try {
      const data = await this.request(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, cfg.apiKey, {
        model, messages, stream: false,
        ...(category === 'asr' ? { asr_options: { language: 'zh', enable_itn: true } } : {
          temperature: category === 'vision' ? 0.1 : 0.6,
          max_tokens: category === 'vision' ? 2200 : 2400,
          ...(/^qwen/i.test(model) ? { enable_thinking: false } : {}),
        }),
        ...extra,
      }, label, cfg.modelTimeoutMs);
      const usage = data.usage;
      const input = Number(usage?.prompt_tokens ?? 0), output = Number(usage?.completion_tokens ?? 0);
      const audioSeconds = Number(usage?.seconds ?? seconds);
      const valid = Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens);
      this.record({
        id, at, category, model, input: valid ? input : 0, output: valid ? output : 0,
        seconds: audioSeconds,
        cost: valid ? estimateCost(cfg, category, input, output, audioSeconds) : null,
        status: valid ? 'reported' : 'unknown', note: valid ? undefined : '服务未返回完整用量',
      });
      reported = true;
      const content = data.choices?.[0]?.message?.content;
      if (data.choices?.[0]?.finish_reason === 'length') throw new ProviderError(`${label}：输出达到长度上限，结果可能不完整，未采用本次结果`);
      if (typeof content !== 'string' || !content.trim()) throw new Error('服务未返回文本内容');
      return content;
    } catch (e) {
      if (!reported) this.record({ id, at, category, model, input: 0, output: 0, seconds, cost: null, status: 'unknown', note: '中断或失败；服务端可能已计费，请核对账单' });
      throw e;
    }
  }
  async search(query: string, before: string, domain?: string): Promise<Source[]> {
    this.searchSummary = '';
    const cfg = this.config(), at = Date.now();
    if (!this.active()) throw new Error('Agent 已暂停');
    if (!cfg.apiKey) throw new Error('尚未配置百炼密钥');
    if (this.searchBlocked) throw this.searchBlock!.error;
    const base = new URL(cfg.baseUrl);
    if (!(/^(dashscope(?:-intl|-us)?\.aliyuncs\.com|[a-z0-9.-]+\.maas\.aliyuncs\.com)$/.test(base.hostname) || ['localhost', '127.0.0.1'].includes(base.hostname)))
      throw new Error('联网检索需要百炼地址；请配置对应地域的百炼兼容接口 Base URL');
    let reported = false;
    try {
      const data = await this.request(`${base.origin}/api/v1/services/aigc/text-generation/generation`, cfg.apiKey, {
        model: cfg.searchModel, input: { messages: [{ role: 'user', content: `检索资料并简要列出依据。资料截止日期为 ${before}，排除之后的比赛结果。${query.slice(0,800)}` }] },
        parameters: { result_format: 'message', enable_search: true, enable_thinking: false, max_tokens: 1200,
          search_options: { forced_search: true, enable_source: true, search_strategy: 'turbo', ...(domain ? { assigned_site_list: [domain] } : {}) } },
      }, '联网搜索', cfg.modelTimeoutMs);
      if (data.code) throw new ProviderError('联网搜索：百炼拒绝请求，请核对模型、地域和开通状态');
      const u = data.usage, valid = Number.isFinite(u?.input_tokens) && Number.isFinite(u?.output_tokens);
      this.record({ id: randomUUID(), at, category: 'text', model: cfg.searchModel, input: valid ? u.input_tokens : 0, output: valid ? u.output_tokens : 0, seconds: 0,
        cost: valid && cfg.searchInputRate !== null && cfg.searchOutputRate !== null ? (u.input_tokens * cfg.searchInputRate + u.output_tokens * cfg.searchOutputRate) / 1e6 : null,
        status: valid ? 'reported' : 'unknown', note: '联网检索模型 Token，与搜索工具费用分别统计' });
      const count = u?.plugins?.search?.count;
      this.record({ id: randomUUID(), at, category: 'search', model: 'DashScope turbo', input: 0, output: 0, seconds: 0,
        cost: Number.isInteger(count) && count > 0 && cfg.qwenSearchRate !== null ? count * cfg.qwenSearchRate : null,
        status: 'unknown', note: `搜索意图次数 ${Number.isInteger(count) ? count : '未知'}，不是已完成/计费次数；金额仅按意图估算，请核对账单` });
      reported = true;
      const pages = data.output?.search_info?.search_results;
      if (!Array.isArray(pages)) throw new ProviderError('联网搜索：未返回真实搜索来源，未采用模型自行生成的链接');
      const sources: Source[] = pages.slice(0, 20).flatMap((page: any) => {
        let url: URL; try { url = new URL(page.url); } catch { return []; }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return [];
        if (domain && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return [];
        const date = String(page.published_at ?? page.datePublished ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        if (date && date > before) return [];
        return [{ title: String(page.title ?? '').slice(0,200), url: url.href, publishedAt: date,
          snippet: String(page.snippet ?? page.summary ?? '').slice(0,3500) }];
      });
      const summary = data.output?.choices?.[0]?.message?.content;
      if (sources.length && typeof summary === 'string') this.searchSummary = summary.slice(0,6000);
      return sources;
    } catch (e) {
      if (e instanceof ProviderError && [400,401,402,403,404].includes(e.status ?? 0)) this.searchBlock = { key: cfg.apiKey, url: cfg.baseUrl, error: e };
      if (!reported) for (const category of ['search', 'text'] as const) this.record({ id: randomUUID(), at, category, model: cfg.searchModel, input: 0, output: 0, seconds: 0, cost: null, status: 'unknown', note: '联网检索中断或失败；模型与工具可能已计费' });
      throw e;
    }
  }
}

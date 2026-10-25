/** Public forum documents only. No cookies, private APIs, login or app protocol handlers. */
export interface HupuComment {
  id: string; text: string; quote: string; date: string; likes: number | null; hot: boolean;
}
export interface HupuPage {
  url: string; title: string; date: string; comments: HupuComment[]; ratingStatus: string; ratingLinks?: string[];
}
export function ratingUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port
      || !['bbs.hupu.com','m.hupu.com','score.hupu.com'].includes(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
export function hupuUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port || u.hostname !== 'bbs.hupu.com'
      || !/^\/\d+(?:-\d+)?\.html$/.test(u.pathname)) return null;
    // Search indexes often return the legacy HTTP URL. The same public path is fetched only over HTTPS.
    return `https://bbs.hupu.com${u.pathname}`;
  } catch { return null; }
}
export function plainHtml(value: unknown): string {
  return String(value ?? '').replace(/<(script|style|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:[^\"'<>]|\"[^\"]*\"|'[^']*')*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
      const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }).replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, n: string) => ({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[n] || ''))
    .replace(/\s+/g, ' ').trim().slice(0, 6000);
}
function date(value: unknown): string {
  const n = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : '';
}
export function parseHupu(html: string, url: string): HupuPage {
  if (!hupuUrl(url)) throw new Error('不支持的虎扑公开页面地址');
  const json = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) throw new Error(/登录|验证|captcha/i.test(html) ? '页面要求登录或验证，未读取评论' : '页面结构变化或空页，未读取评论');
  let d: any;
  try { d = JSON.parse(json).props?.pageProps?.detail; } catch { throw new Error('虎扑页面数据格式异常'); }
  if (!d?.thread || !Array.isArray(d.lights) || !Array.isArray(d.replies?.list)) throw new Error('虎扑评论结构变化，未读取评论');
  const t = d.thread, comments: HupuComment[] = [], ids = new Set<string>(), texts = new Set<string>();
  const add = (c: any, hot: boolean) => {
    if (!c || c.isHidden || c.isDelete || c.isSelfDelete || c.containsAi) return;
    const text = plainHtml(c.content), id = String(c.pid ?? '');
    if (!id || text.length < 2 || ids.has(id) || texts.has(text)) return;
    ids.add(id); texts.add(text);
    comments.push({ id, text, quote: plainHtml(c.quote?.content), date: date(c.createdAt),
      likes: typeof c.count === 'number' && c.count >= 0 ? c.count : null, hot });
  };
  add({ ...t, pid: `thread:${t.tid}` }, false);
  for (const c of d.lights) add(c, true);
  for (const c of d.replies.list) add(c, false);
  // Only these public forum documents have a verified parser. Do not label app links as read ratings.
  const ratingStatus = /huputiyu:|评分|打分/.test(String(t.content))
    ? '评分页未读取：仅采集公开讨论帖及可见评论；App 跳转或未支持的评分入口不计入评分热评'
    : '已读取公开帖子及可见评论（不代表全部评论）';
  const ratingLinks = [...String(t.content).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(m => /评分|打分/.test(plainHtml(m[2]))).map(m => ratingUrl(m[1].replace(/&amp;/g,'&'))).filter((x):x is string => !!x);
  return { url, title: plainHtml(t.title).slice(0,200), date: date(t.createdAt), comments, ratingStatus, ratingLinks };
}
export class HupuReader {
  private cache = new Map<string, Promise<HupuPage>>();
  constructor(private signal: AbortSignal) {}
  async probeRating(value: string): Promise<string> {
    this.signal.throwIfAborted();
    const url = ratingUrl(value); if (!url) return '评分页未读取：未支持的入口';
    // An actual HTTPS entry from a public post may redirect to the app/login. Never follow it there.
    try {
      const response = await fetch(url, { method:'GET', redirect:'manual', credentials:'omit',
        signal:AbortSignal.any([this.signal,AbortSignal.timeout(15000)]) });
      await response.body?.cancel();
      return `评分页未读取：HTTPS 入口响应 ${response.status}，尚无验证过的公开评分数据结构；保留讨论帖评论`;
    } catch { this.signal.throwIfAborted(); return '评分页未读取：HTTPS 入口无法访问'; }
  }
  read(value: string): Promise<HupuPage> {
    this.signal.throwIfAborted();
    const url = hupuUrl(value); if (!url) return Promise.reject(new Error('仅支持虎扑公开讨论帖'));
    if (!this.cache.has(url)) this.cache.set(url, this.fetchPage(url));
    return this.cache.get(url)!;
  }
  private async fetchPage(url: string): Promise<HupuPage> {
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(15000)]);
    let current = url;
    for (let i = 0; i < 4; i++) {
      signal.throwIfAborted();
      const res = await fetch(current, { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'text/html' } });
      if (res.status >= 300 && res.status < 400) {
        const next = hupuUrl(new URL(res.headers.get('location') || '', current).href);
        await res.body?.cancel();
        if (!next) throw new Error('虎扑跳转到登录、验证或未支持页面，已停止读取');
        current = next; continue;
      }
      if (!res.ok) { await res.body?.cancel(); throw new Error(`虎扑页面 HTTP ${res.status}，继续处理其他页面`); }
      const reader = res.body?.getReader(); if (!reader) throw new Error('虎扑返回空页');
      let size = 0; const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > 3_000_000) throw new Error('虎扑页面过大，已停止读取'); chunks.push(value);
        }
      } finally { await reader.cancel(); }
      signal.throwIfAborted();
      return parseHupu(Buffer.concat(chunks).toString('utf8'), current);
    }
    throw new Error('虎扑页面跳转次数过多');
  }
}

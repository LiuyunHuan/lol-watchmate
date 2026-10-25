// Explicit opt-in validation. Never prints or exports settings/credentials.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { HupuReader } from '../electron/hupu';
import { Providers } from '../electron/providers';
import { searchMemes } from '../electron/meme-search';
import { Meme, UsageRecord, settingsSchema } from '../src/shared/types';

const root = process.cwd();
app.setName('lol-watchmate');
app.setPath('userData', path.join(root,'.smoke-data',`hupu-${Date.now()}`));
app.whenReady().then(async()=>{
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 480000);
  const report: any = { at:new Date().toISOString(), mode:process.env.WATCHMATE_LIVE_QWEN==='1'?'real-qwen':'public-pages-only', pages:[], progress:[], candidates:[], usage:[] };
  try {
    const reader = new HupuReader(controller.signal);
    for (const url of ['https://bbs.hupu.com/60964641.html','https://bbs.hupu.com/642266977.html','https://bbs.hupu.com/640104329.html','https://bbs.hupu.com/640958705.html']) {
      try {
        const p = await reader.read(url);
        if (!p.comments.length || !p.date || p.comments.some(c=>!c.id)) throw new Error('公开页面缺少预期评论或日期');
        if(url.endsWith('/60964641.html') && !p.comments.some(c=>c.id==='57755' && c.text==='秀兵集合！' && c.likes===5058)) throw new Error('已人工核对的热评与采集结果不一致');
        report.pages.push({url,title:p.title,date:p.date,comments:p.comments.length,hot:p.comments.filter(c=>c.hot).length,
          quotes:p.comments.filter(c=>c.quote).length,ratingStatus:p.ratingStatus,ratingLinks:p.ratingLinks,
          samples:p.comments.filter(c=>c.likes).sort((a,b)=>(b.likes||0)-(a.likes||0)).slice(0,3)});
      } catch(e) { report.pages.push({url,error:e instanceof Error?e.message:'读取失败'}); }
    }
    if(process.env.WATCHMATE_LIVE_QWEN==='1') {
      // User explicitly requested the real Qwen path. Decrypt only in this process,
      // never copy the personal config into a test directory or log it.
      const settingsPath=path.join(app.getPath('appData'),'lol-watchmate','settings.json');
      let raw: any; try { raw=JSON.parse(fs.readFileSync(settingsPath,'utf8').replace(/^\uFEFF/,'')); } catch { throw new Error('验证未执行：无法读取现有凭据存储'); }
      let key=''; try { key=raw.apiKey ? (raw.encrypted !== true && /^sk-/.test(raw.apiKey) ? raw.apiKey : safeStorage.decryptString(Buffer.from(raw.apiKey,'base64'))) : ''; } catch { throw new Error('验证未执行：系统凭据解密不可用'); }
      if (!key) throw new Error('现有凭据不可用，真实 Qwen 验证未执行');
      const cfg=settingsSchema.parse({apiKey:key,baseUrl:raw.baseUrl,textModel:'qwen-plus',searchModel:'qwen-plus',modelTimeoutMs:90000,
        textInputRate:raw.searchInputRate??null,textOutputRate:raw.searchOutputRate??null,
        searchInputRate:raw.searchInputRate??null,searchOutputRate:raw.searchOutputRate??null,qwenSearchRate:raw.qwenSearchRate??null});
      const p=new Providers(()=>cfg,()=>!controller.signal.aborted,(r:UsageRecord)=>report.usage.push(r));
      controller.signal.addEventListener('abort',()=>p.abort());
      await searchMemes([{name:'ShowMaker',team:'DK',focus:false},{name:'knight',team:'BLG',focus:false}],
        new Date(Date.now()-86400000).toISOString().slice(0,10),p,controller.signal,
        s=>{report.progress.push(s);console.log(s);},(m:Meme[])=>report.candidates.push(...m),reader);
      if(!['ShowMaker','knight'].every(name=>report.candidates.some((m:Meme)=>m.target===name))) report.error='真实 Qwen 未为两位选手均生成可追溯候选，质量验收尚未通过';
    }
  } catch(e) { report.error=e instanceof Error && !/JSON|ENOENT|decrypt/i.test(e.message)?e.message:'凭据不可用或验证配置无法加载；未导出任何个人配置'; }
  finally {
    clearTimeout(timer);fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
    fs.writeFileSync(path.join(root,'artifacts',`hupu-${report.mode}-v0.5.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify({mode:report.mode,pages:report.pages.length,candidates:report.candidates.length,error:report.error||null}));app.exit(report.error || report.pages.some((p:any)=>p.error)?1:0);
  }
});

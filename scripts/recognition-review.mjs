import fs from 'node:fs';import path from 'node:path';
const report=JSON.parse(fs.readFileSync('artifacts/recognition-regression.json','utf8'));
const truth=JSON.parse(fs.readFileSync('tests/fixtures/broadcast-truth.json','utf8'));
const ids={newscore:'2188f6e9-ab38-42ef-b5c4-da6cca353f66',scoreboard:'27e04215-37f8-4165-89e2-8b14aed8d70c',compact:'0548554c-d6ac-468d-bd07-8ecf6f73d6b6',bpfull:'3402eac5-e245-48dc-bb45-8c90a284062e',scene:'71e703b6-62b5-40e4-9943-e6868cbb57d3',scoreboard2:'22fbf03a-4559-4121-bb40-481f4fcbd734',compact2:'dccc2be1-c7b5-4288-a22c-c41cddfcdd66'};
const esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let html=`<!doctype html><meta charset="utf-8"><title>观赛搭子 v0.4 图片核对</title><style>body{font:16px system-ui;background:#101820;color:#dae8ec;max-width:1360px;margin:40px auto;padding:0 24px}section{padding:24px;background:#182530;margin:24px 0;border-radius:12px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border-bottom:1px solid #40505e;text-align:left;padding:7px}.frame{position:relative}.frame img{width:100%;display:block}.roi{position:absolute;border:1px solid #71f2bc;box-sizing:border-box;pointer-events:none}small{color:#b3cad0}summary{cursor:pointer}strong{color:#8fe4c6}</style><h1>v0.4 识别核对记录</h1><p>11 张真实图片；与人工抄录结果逐项比较。${report.failures.length?'仍有失败：'+esc(report.failures.join('；')):'本轮断言全部通过。'}</p><p>原图保留在本机，不进入源码仓库。下方绿色框是实际识别区域。BP 展示位置不绑定选手；同场顺序测试从 BP 开始，遮挡时允许保留已确认英雄，完整阵容的排除确认有标记。隐藏等级不猜测。数字字形训练使用了部分测试画面，所以这份记录是回归验证，不是未知赛事准确率。</p><p>快速检测样本：${report.results.fast.map(r=>r.elapsedMs+' ms').join(' / ')}。这是本地处理时间，不是画面到语音的端到端延迟。</p>`;
for(const [name,e] of Object.entries(truth.cases)){
 const r=report.results['sequence-'+name]||report.results['isolated-'+name];if(!r)continue;
 const named=process.env.WATCHMATE_FIXTURES?path.join(process.env.WATCHMATE_FIXTURES,name+'.png'):null;
 const file=named||(name.startsWith('observed')?`artifacts/replay-observed-0${name.slice(-1)}.png`:path.join(process.env.LOCALAPPDATA,'Temp/codex-clipboard-'+ids[name]+'.png'));
 const data='data:image/png;base64,'+fs.readFileSync(file).toString('base64');
 const boxes=[[938,76,46,28],...[0,1,2,3].map(i=>[1883,105+i*36,29,29])];
 if(r.layout==='bp')for(let i=0;i<10;i++)boxes.push([i<5?i*160:1120+(i-5)*160,790,158,290]);
 if(r.layout==='scoreboard')for(let i=0;i<10;i++){boxes.push([i<5?717:1158,826+i%5*51.8,43,43]);boxes.push([i<5?871:997,849+i%5*52,52,22]);boxes.push([i<5?751:1143,854+i%5*52,28,19]);}
 if(r.layout==='compact')for(let i=0;i<10;i++){const x=i<5?502+i*95.5:984+(i-5)*95.5;boxes.push([x,990,52,52],[x+(i<5?-1:29),1047,27,20]);}
 html+=`<section><h2>${esc(name)} · ${esc(r.layout)} · ${r.clock===null?'BP':Math.floor(r.clock/60)+':'+String(r.clock%60).padStart(2,'0')}</h2><p>${esc(r.status)} · ${r.elapsedMs} ms</p><details><summary>展开原图及识别区域</summary><div class="frame"><img src="${data}">${boxes.map(([x,y,w,h])=>`<i class="roi" style="left:${x/19.2}%;top:${(y+60)/12}%;width:${w/19.2}%;height:${h/12}%"></i>`).join('')}</div></details>`;
 if(r.picks.length)html+=`<p>BP：${r.picks.map(p=>esc(p.side+' '+p.position+' '+p.championId)).join('；')}</p>`;
 if(r.players.length){html+='<table><tr><th>位置 / ID</th><th>人工英雄 → 软件英雄</th><th>人工等级 → 软件等级</th><th>人工 KDA → 软件 KDA</th><th>死亡计时 / 来源</th></tr>';
 let heroes=e.heroes||truth.heroes;if(r.layout==='compact')heroes=[...heroes.slice(0,5).reverse(),...heroes.slice(5)];
 r.players.forEach((p,i)=>{html+=`<tr><td>${esc(p.slot)} / ${esc(p.name)}</td><td>${heroes[i]} → <strong>${esc(p.championId)}</strong></td><td>${esc(e.levels[i])} → ${esc(p.level)}</td><td>${esc(e.kda?.[i])} → ${p.kills===undefined?'—':[p.kills,p.deaths,p.assists].join('/')}</td><td>${p.dead?'死亡 '+p.timer+' 秒':'未见死亡'}${p.identitySource==='draft-elimination'?' / 完整 BP 排除确认':p.confidence===0?' / 本局已确认缓存':''}</td></tr>`;});html+='</table>';
 }else html+='<p>不读取或覆盖局内选手统计。</p>';
 html+=`<small>右上击杀栏受害者：${esc(r.victims.join(', ')||'无')}。统计由实际识别函数输出，未以选手名或图片编号填入答案。</small></section>`;
}
fs.writeFileSync('artifacts/recognition-review.html',html);console.log('Saved artifacts/recognition-review.html');

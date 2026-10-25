import { useState } from 'react';
import { Action, Meme, Snapshot } from '../shared/types';
import { starPriority } from '../core/match';

export function MemeLibrary({ state, act, report }: { state: Snapshot; act: (a: Action) => Promise<void>; report: (s: string) => void }) {
  const [search, setSearch] = useState(false), [filter, setFilter] = useState('');
  const [view, setView] = useState<'approved' | 'pending' | 'deleted'>('approved');
  const [selected, setSelected] = useState<string[]>([]);
  const [players, setPlayers] = useState<{ name: string; team: string; focus: boolean; checked: boolean }[]>([]);
  const [extra, setExtra] = useState('');
  const [cutoff, setCutoff] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0,10));
  const [edit, setEdit] = useState<{ id?: string; target: string; text: string; kind: 'player' | 'team'; condition?: Meme['condition'] } | null>(null);
  const openSearch = () => {
    setPlayers(state.match.players.filter(p => p.name).map(p => ({ name:p.name, team:state.match.teams[p.side].name,
      focus:p.priority >= 80, checked:p.allowBanter })));
    setSearch(true);
  };
  const change = (a: Action) => { void act(a).catch(e => report(e.message)); };
  const list = state.memes.filter(m => (m.review || 'approved') === view && (!filter || m.target.toLowerCase().includes(filter.toLowerCase())));
  const review = (ids: string[], operation: 'approve' | 'delete' | 'restore') => { change({type:'meme-review', ids, operation}); setSelected([]); };
  return <div className="full-page meme-library">
    <div className="page-heading"><p className="eyebrow">BANTER LIBRARY</p><h1>好梗，得对上人。</h1><p className="muted">手动检索虎扑，核对原文后选入梗库。换局和重启都不会自动搜索。</p>
      <div className="checks"><button className="button primary" disabled={state.learning} onClick={openSearch}>搜索梗库</button>
        <button className="button subtle" onClick={() => setEdit({target:'',text:'',kind:'player'})}>添加梗</button>
        <button className="button subtle" onClick={() => void window.watchmate.importMemes().catch(e=>report(e.message))}>导入 Markdown</button>
        {state.learning && <button className="button danger" onClick={() => change({type:'meme-cancel'})}>取消搜索</button>}</div>
    </div>
    <p className="info-strip">Markdown 模板：## 选手: TheShy（或队伍: *），每个列表项写一句。删除可撤销；已删除的相同句子不会被搜索自动补回。</p>
    {!!state.searchProgress?.length && <details className="panel" open={state.learning}><summary>{state.learning ? '正在搜索…' : '上次搜索记录'}</summary><ul>{state.searchProgress.map((line,i)=><li key={i}>{line}</li>)}</ul></details>}
    <div className="checks" style={{margin:'20px 0'}}>
      {(['approved','pending','deleted'] as const).map(v=><button className={`button ${view===v?'primary':'subtle'}`} key={v} onClick={()=>{setView(v);setSelected([]);}}>{ {approved:'已入库',pending:'候选待审核',deleted:'已删除'}[v] } ({state.memes.filter(m=>(m.review||'approved')===v).length})</button>)}
      <input aria-label="按选手筛选" placeholder="按选手 / 队伍筛选" value={filter} onChange={e=>{setFilter(e.target.value);setSelected([]);}} />
      {view==='pending' && <button className="button primary" disabled={!selected.length} onClick={()=>review(selected,'approve')}>选入梗库 ({selected.length})</button>}
    </div>
    <div className="meme-grid">{list.map(m=><div className="panel meme-card" key={m.id}>
      <div><span className="pill">{m.kind==='team'?'团队':'选手'}</span><strong>{m.target==='*'?'通用短句':m.target}</strong><small>{m.origin==='search'?'虎扑候选':m.origin==='builtin'?'初始梗库':'用户梗库'}</small></div>
      <blockquote>{m.text}</blockquote>
      {m.evidence && <><p><b>{m.evidence.rewrite?'改写':'原句'}</b> · 热度 {m.evidence.likes ?? '未知'} · {m.evidence.publishedAt.slice(0,10)}</p><p>原文：{m.evidence.quote}</p>{m.evidence.context && <p>引用上下文：{m.evidence.context}</p>}<p>{m.evidence.explanation}</p><small>评论标识：{m.evidence.commentId}</small></>}
      <p className="muted">适用：{m.conditionText || (m.kind==='team'?'多人死亡':'普通死亡')}{m.condition==='manual-only'?' · 缺少现场证据，自动播报禁用':''}</p>
      {m.sources.map(s=><button className="source-link" key={s.url} onClick={()=>void window.watchmate.openUrl(s.url)}>{s.title} ↗</button>)}
      <div className="checks">
        {view==='approved' && <label><input type="checkbox" checked={m.enabled!==false} onChange={e=>change({type:'meme-toggle',id:m.id!,enabled:e.target.checked})} /> 启用这句</label>}
        {view==='pending' && <label><input type="checkbox" checked={selected.includes(m.id!)} onChange={e=>setSelected(e.target.checked?[...selected,m.id!]:selected.filter(id=>id!==m.id))} /> 选入候选</label>}
        {view!=='deleted' && <><button className="text-button" onClick={()=>setEdit({id:m.id,target:m.target,text:m.text,kind:m.kind,condition:m.condition})}>编辑</button><button className="text-button danger" onClick={()=>review([m.id!],'delete')}>删除</button></>}
        {view==='deleted' && <button className="button subtle" onClick={()=>review([m.id!],'restore')}>撤销删除</button>}
      </div>
    </div>)}</div>
    {!list.length && <p className="muted">这里还没有内容。</p>}
    {search && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="搜索梗库"><h2>搜索梗库</h2><p>受保护选手默认不选；搜索选择不会更改盾牌。普通选手最多 2 次检索 / 4 页 / 60 条评论；重点搜索翻倍，最多返回 6 条候选。</p>
      <label>资料截止日期（录像建议选比赛开始前一天）<input type="date" value={cutoff} max={new Date().toISOString().slice(0,10)} onChange={e=>setCutoff(e.target.value)} /></label>
      {players.map((p,i)=><div className="checks" key={i}><label><input type="checkbox" checked={p.checked} onChange={e=>setPlayers(players.map((x,j)=>j===i?{...x,checked:e.target.checked}:x))} />{p.name} · {p.team}</label><label><input type="checkbox" checked={p.focus} onChange={e=>setPlayers(players.map((x,j)=>j===i?{...x,focus:e.target.checked}:x))} />重点搜索</label></div>)}
      <div className="checks"><input aria-label="补充选手" placeholder="补充选手 ID" value={extra} maxLength={80} onChange={e=>setExtra(e.target.value)} /><button className="button subtle" onClick={()=>{if(extra.trim()&&!players.some(p=>p.name.toLowerCase()===extra.trim().toLowerCase()))setPlayers([...players,{name:extra.trim(),team:'',focus:starPriority(extra.trim())>=80,checked:true}]);setExtra('');}}>添加选手</button></div>
      <p className="muted">会使用已保存百炼密钥，产生模型与搜索费用；不启动窗口采集。来源时间不明的内容不会进入候选。</p>
      <div className="checks"><button className="button primary" disabled={!players.some(p=>p.checked)||!cutoff||state.learning} onClick={()=>{change({type:'meme-search',players:players.filter(p=>p.checked).map(({checked,...p})=>p),cutoff});setSearch(false);setView('pending');}}>开始搜索</button><button className="button subtle" onClick={()=>setSearch(false)}>关闭</button></div>
    </section></div>}
    {edit && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="编辑梗"><h2>{edit.id?'编辑梗':'添加梗'}</h2><div className="form-grid">
      <label>对象类型<select value={edit.kind} onChange={e=>setEdit({...edit,kind:e.target.value as Meme['kind']})}><option value="player">选手</option><option value="team">队伍</option></select></label>
      <label>对象名称（* 为通用）<input value={edit.target} maxLength={80} onChange={e=>setEdit({...edit,target:e.target.value})} /></label>
      <label>适用条件<select value={edit.condition || 'death'} onChange={e=>setEdit({...edit,condition:e.target.value as Meme['condition']})}><option value="death">普通死亡</option><option value="four-allies-alive">其他四位队友明确存活</option><option value="manual-only">特殊场景（不自动播报）</option></select></label><label>播报句<textarea value={edit.text} maxLength={100} onChange={e=>setEdit({...edit,text:e.target.value})} /></label></div>
      <p className="muted">请同时确认适用条件。原文证据保留；中路、特定击杀者或装备等缺少现场证据的内容不自动播报。</p>
      <div className="checks"><button className="button primary" disabled={!edit.target.trim()||!edit.text.trim()} onClick={()=>{void act({type:'meme-save',...edit}).then(()=>setEdit(null)).catch(e=>report(e.message));}}>保存</button><button className="button subtle" onClick={()=>setEdit(null)}>取消</button></div>
    </section></div>}
  </div>;
}

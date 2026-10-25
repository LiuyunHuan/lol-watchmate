import { MemeLibrary } from './MemeLibrary';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDown, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Coins, FileText,
  FolderOpen, Headphones, Import, Layers3, MessageCircle, Mic, MicOff, Monitor, Pause, Play,
  Radio, RefreshCw, Send, Settings2, Shield, Sparkles, Swords, Volume2, X, Zap,
} from 'lucide-react';
import { Action, Message, Player, roleLabels, Settings, settingsSchema, Side, Snapshot } from '../shared/types';
import { useMicrophone, useSpeech } from './media';
import { LocalVision, frameCanvas, cloudImage } from './local-vision';
import { Calibration } from './Calibration';
import { BroadcastVision, gameCanvas } from './broadcast-vision';
import { DraftPanel, ViewportDialog } from './BroadcastPanel';
import { champions } from './champion-vision';

const bridge = window.watchmate;
const clock = (seconds: number | null) => seconds === null ? '--:--' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const phaseNames = { unknown: '等待画面', bp: 'BP 阶段', live: '对局进行中', replay: '回放 · 允许开串', ended: '本局已结束' };
type Tab = 'watch' | 'memes' | 'series' | 'usage';

export function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>('watch');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [input, setInput] = useState('');
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [newSeriesOpen, setNewSeriesOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef(true);
  const [unread, setUnread] = useState(0);
  const previousCount = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [calibration, setCalibration] = useState<HTMLCanvasElement | null>(null);
  const localVision = useRef(new LocalVision());
  const broadcastVision = useRef(new BroadcastVision());
  const [viewportFrame,setViewportFrame]=useState<HTMLCanvasElement|null>(null);
  const lastCloudAt = useRef(0);
  const captureGeneration = useRef(0);
  const latest = useRef(state); latest.current = state;
  const notify = (message: string) => setToast(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
  const act = (action: Action) => bridge.action(action).catch(e => notify(String(e.message)));
  useSpeech(state);
  const microphone = useMicrophone(state, notify);
  useEffect(() => {
    if (!bridge) { notify('请使用桌面应用打开。运行 npm run dev 或启动已打包程序。'); return; }
    void bridge.snapshot().then(setState);
    return bridge.subscribe(setState);
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const count = state?.messages.length ?? 0;
    const delta = Math.max(0, count - previousCount.current); previousCount.current = count;
    if (bottomRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight; setUnread(0);
    } else if (delta) setUnread(n => n + delta);
  }, [state?.messages.length, tab]);
  const stopCapture = () => {
    captureGeneration.current++;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (captureVideoRef.current) { captureVideoRef.current.srcObject = null; captureVideoRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCapturing(false);
    localVision.current.stop(); setCalibration(null);
    broadcastVision.current.stop();setViewportFrame(null);
  };
  useEffect(() => { if (!state?.running) stopCapture(); }, [state?.running]);
  useEffect(() => { captureGeneration.current++;broadcastVision.current.stop(); }, [state?.match.seriesId,state?.match.game,state?.viewport?.x,state?.viewport?.y,state?.viewport?.w,state?.viewport?.h]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); localVision.current.stop();broadcastVision.current.stop(); }, []);
  useEffect(() => {
    const request = state?.questionFrameRequest;
    if (!request) return;
    const video = captureVideoRef.current, canvas = video && frameCanvas(video);
    void bridge.questionFrame({ id: request.id, image: canvas ? cloudImage(state?.viewport?gameCanvas(canvas,state.viewport):canvas) : null, at: Date.now() }).catch(e => notify(e.message));
  }, [state?.questionFrameRequest?.id]);
  useEffect(() => {
    if (!capturing || !state?.running) return;
    const timer = setInterval(() => {
      const video = captureVideoRef.current;
      const snapshot = latest.current;
      if (!video || !snapshot?.running) return;
      const canvas = frameCanvas(video); if (!canvas) return;
      if(snapshot.settings.broadcastEnabled&&!broadcastVision.current.busy){
        const generation=captureGeneration.current;
        void broadcastVision.current.read(canvas,snapshot.viewport).then(reading=>{if(reading&&latest.current?.running&&generation===captureGeneration.current)return bridge.broadcast(reading);}).catch(e=>notify(e.message));
      }
      if (snapshot.localArmed && snapshot.localProfile && !localVision.current.busy) {
        void localVision.current.read(canvas, snapshot.localProfile, snapshot.match.players.filter(p => !p.allowBanter).map(p => p.slot))
          .then(reading => { if (reading && latest.current?.running) return bridge.localReading(reading); }).catch(e => notify(e.message));
      }
      if (!snapshot.frameBusy && !snapshot.answering && snapshot.visionRetryAt !== -1 && Date.now() >= snapshot.visionRetryAt && Date.now() - lastCloudAt.current >= snapshot.settings.captureIntervalMs) {
        lastCloudAt.current = Date.now();
        void bridge.frame({ image: cloudImage(snapshot.viewport?gameCanvas(canvas,snapshot.viewport):canvas), at: Date.now() }).catch(e => notify(String(e.message)));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [capturing, state?.running]);
  // Switching away from the watch tab unmounts the video; reattach the same authorized stream.
  useEffect(() => {
    if (tab === 'watch' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current; void videoRef.current.play();
    }
  }, [tab]);
  const selectSource = async (id: string) => {
    stopCapture();
    const generation = captureGeneration.current;
    try {
      await bridge.selectSource(id);
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      if (generation !== captureGeneration.current || !latest.current?.running) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const captureVideo = document.createElement('video');
      captureVideo.muted = true; captureVideo.srcObject = stream;
      captureVideoRef.current = captureVideo; await captureVideo.play();
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      stream.getVideoTracks()[0].onended = () => { stopCapture(); notify('共享窗口已结束。重新选择窗口后继续识别。'); };
      setCapturing(true); setSourceOpen(false);
      lastCloudAt.current = 0;
    } catch (e) { notify(String((e as Error).message)); }
  };
  const submit = () => {
    if (!input.trim()) return;
    void act({ type: 'question', text: input }); setInput('');
    bottomRef.current = true;
  };
  if (!state) return <div className="boot"><Headphones size={40} /><h1>观赛搭子</h1><p>{toast || '正在准备你的观赛席…'}</p></div>;
  const m = state.match;
  const liveStatus = state.userSpeaking ? '正在听你说' : state.answering ? '认真想一想' : state.speech ? '搭子正在说话' : state.running ? '陪你看比赛' : '准备就绪';
  return <div className="app-shell">
    <aside className="rail">
      <div className="brand-mark"><Headphones size={26} /></div>
      <div className="rail-nav">
        <NavButton title="观赛" icon={<Monitor size={21} />} active={tab === 'watch'} onClick={() => setTab('watch')} />
        <NavButton title="梗库" icon={<Sparkles size={21} />} active={tab === 'memes'} onClick={() => setTab('memes')} />
        <NavButton title="系列赛" icon={<BookOpen size={21} />} active={tab === 'series'} onClick={() => setTab('series')} />
        <NavButton title="用量" icon={<Activity size={21} />} active={tab === 'usage'} onClick={() => setTab('usage')} />
      </div>
      <button className="rail-settings" title="设置" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings2 size={22} /></button>
      <div className="version">v0.5.1</div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div><div className="eyebrow">WATCHMATE / LOL</div><h1>一起看场好比赛<span>。</span></h1></div>
        <div className="topbar-actions">
          <div className="cost-chip" onClick={() => setTab('usage')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setTab('usage')}>
            <Coins size={16} /><span>近 1 小时 <strong>¥{state.hourlyCost.toFixed(2)}</strong><small> / {state.settings.hourlyBudget} 元</small></span>
            {state.unpriced > 0 && <i title="有未计价请求">!</i>}
          </div>
          {(state.running || state.learning)
            ? <button className="button subtle" onClick={() => void act({ type: 'pause' })}><Pause size={16} />暂停搭子</button>
            : <><button className="button subtle" onClick={() => void act({ type: 'start', mode: 'demo' })}><Play size={15} />体验演示</button>
              <button className="button primary" onClick={() => void act({ type: 'start', mode: 'live' })}><Radio size={16} />开始观赛</button></>}
        </div>
      </header>
      <div className="session-bar">
        <div className="session-name"><span className={`dot ${state.running ? 'on' : ''}`} /><strong>{m.seriesTitle}</strong><span className="pill">BO5</span><span className="muted">第 {m.game} 局</span></div>
        <div className="session-info">
          <span className={state.mode === 'demo' ? 'demo-label' : 'muted'}>{state.mode === 'demo' ? '演示数据' : '实际观赛'}</span>
          <span className="divider" /><span><Clock3 size={13} />{clock(m.gameSeconds)}</span><span>{!state.running?'已暂停 · 不触发':state.mode==='live'&&!capturing?'等待共享窗口':phaseNames[m.phase]}</span>
          <button className="text-button" onClick={() => setContextOpen(true)}>校正比赛信息 <ChevronRight size={13} /></button>
        </div>
      </div>
      {tab === 'watch' && <div className="watch-grid">
        <section className="match-column">
          <div className="panel capture-panel">
            <div className="panel-heading"><span><Monitor size={16} />比赛视野</span><button className="text-button" disabled={!state.running || state.mode !== 'live'} onClick={() => setSourceOpen(true)}>{capturing ? '更换窗口' : '选择窗口'} <ChevronRight size={13} /></button></div>
            <div className="video-area">
              <video ref={videoRef} autoPlay muted playsInline className={capturing ? '' : 'hidden'} />
              {!capturing && (state.mode === 'demo' ? <DemoMap /> : <div className="capture-empty"><div className="capture-icon"><Monitor size={28} /></div><strong>把比赛画面分享给搭子</strong><p>打开 B站直播，开始观赛后选择窗口</p><span>只采集你选中的窗口 · 不采集系统声音</span></div>)}
              {capturing && <span className="capture-badge"><span className="dot on" />正在共享</span>}
            </div>
            <div className="capture-foot"><span title={state.visionError ?? undefined} className={state.visionError ? 'amber' : state.frameBusy ? 'teal' : 'muted'}><span className={`dot tiny ${state.frameBusy ? 'on' : ''}`} />{state.frameBusy ? '正在理解画面' : state.visionRetryAt === -1 ? '识别已停止 · 请修正配置' : state.visionError ? '识别失败 · 正在退避重试' : capturing ? '等待下一帧' : '尚未采集实际画面'}</span><span>{state.metrics.lastVisionMs !== null ? `上次识别 ${(state.metrics.lastVisionMs / 1000).toFixed(1)}s` : '回放自动去重'}</span></div>
          </div>
          <div className="panel local-panel">
            <div className="panel-heading"><span>自动识别 · LPL 固定布局</span><button className="text-button" disabled={!capturing} onClick={()=>{const v=captureVideoRef.current,c=v&&frameCanvas(v);if(c)setViewportFrame(c);}}>调整比赛区域</button></div>
            <p>{state.settings.broadcastEnabled?(state.broadcast?.status??'等待完整比赛画面 · 图库首次加载约需十秒'):'自动布局识别已关闭'}</p>
            <p className="small muted">支持对线计分板、团战横排和击杀栏。建议全屏播放；识别不到时框选比赛区域。下方选手可点击纠正。</p>
            <p className="small muted">优先少漏报：头像死亡、死亡数增加或击杀栏均可开串，回放也允许；同一静止画面不连续刷屏。</p>
            <button className="text-button" disabled={!state.running} onClick={()=>void act({type:'broadcast-reset'})}>重新检测当前画面</button>
          </div>
          <DraftPanel state={state} action={act}/>
          <div className="panel local-panel">
            <div className="panel-heading"><span><Zap size={16} />备用 · 手动校准检测</span><button className="text-button" disabled={!capturing} onClick={() => {
              const video = captureVideoRef.current, frame = video && frameCanvas(video);
              if (frame) { void act({ type: 'local-arm', value: false }); setCalibration(frame); }
            }}>校准区域</button></div>
            <p>{state.localStatus}</p><div className="local-controls"><label><input type="checkbox" disabled={!state.localProfile || !state.running} checked={state.localArmed} onChange={e => void act({ type: 'local-arm', value: e.target.checked })} />使用手动校准模式</label>
            <span className="small muted">每 0.5 秒尝试 · 无 API 费用{state.localLatencyMs !== null ? ` · 上次 ${Math.round(state.localLatencyMs)}ms` : ''}</span></div>
            <p className="small muted">上方自动模式无需勾选此项。其他布局可框选游戏时钟和存活头像；启用后使用这些区域检测死亡。名单先核对，常用梗提前缓存。</p>
          </div>
          <div className="panel roster-panel">
            <div className="panel-heading"><span><Swords size={16} />本场选手</span><span className="small muted">点击选手可校正 · 盾牌屏蔽黑梗</span></div>
            <div className="teams-grid">
              {(['left', 'right'] as Side[]).map(side => <div className={`team ${side}`} key={side}>
                <div className="team-heading"><span className={`team-square ${side}`} /><strong>{m.teams[side].name}</strong><button className={m.teams[side].allowBanter ? 'icon-button muted' : 'icon-button protected'} title="一键保护主队" onClick={() => void act({ type: 'team', side, protect: true })}><Shield size={14} /></button></div>
                {m.players.filter(p => p.side === side).map(p => <div className={`player ${p.allowBanter ? '' : 'protected-player'}`} key={p.slot}>
                  <button className="player-main" onClick={() => setEditPlayer({ ...p })}>
                    <div className={`role-icon ${p.dead ? 'dead' : ''}`}>{roleLabels[p.role][0]}</div>
                    <div><div className="player-name">{p.name || '待确认'}{p.priority >= 85 && <span className="star">✦</span>}</div><div className="champion">{p.champion || '英雄待确认'}{p.level?` · ${p.level}级`:''}{p.deaths!==null&&p.kills!==undefined?` · ${p.kills}/${p.deaths}/${p.assists??'?'}`:''} · 纠正</div></div>
                  </button>
                  <button className={`protect-toggle ${p.allowBanter ? '' : 'active'}`} aria-label={`${p.allowBanter ? '屏蔽' : '允许'} ${p.name || p.slot} 的黑梗`} title={p.allowBanter ? '点击屏蔽黑梗' : '已保护，点击允许黑梗'} onClick={() => void act({ type: 'player', slot: p.slot, patch: { allowBanter: !p.allowBanter } })}><Shield size={13} /></button>
                </div>)}
                <label className="team-banter"><input type="checkbox" checked={m.teams[side].allowBanter} onChange={e => void act({ type: 'team', side, allowBanter: e.target.checked })} />允许团队梗</label>
              </div>)}
            </div>
            <div className="roster-foot"><Shield size={12} />保护只影响玩梗，正经分析仍考虑完整阵容。</div>
          </div>
          <div className="quick-actions">
            <button onClick={() => void act({ type: 'finish-game' })}><FileText size={15} />结束本局 · 写入文档</button>
            <button onClick={() => void act({ type: 'next-game' })}>下一局 <ArrowRight size={15} /></button>
          </div>
        </section>
        <section className="panel conversation">
          <div className="conversation-heading"><div className="companion-avatar"><Headphones size={21} /></div><div><strong>你的观赛搭子</strong><span><span className={`dot tiny ${state.running ? 'on' : ''}`} />{liveStatus}</span></div><div className="mode-pills"><span><MessageCircle size={12} />认真聊</span><span><Zap size={12} />适时串</span></div></div>
          <div className="feed" ref={feedRef} onScroll={() => {
            const el = feedRef.current!;
            bottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
            if (bottomRef.current) setUnread(0);
          }}>
            <div className="welcome-card"><div className="eyebrow">你的麦，留着聊比赛。</div><h2>好好分析，<br />也好好开个串。</h2><p>问我 BP 和赢法，我认真回答。<br />选手倒下的瞬间，留给熟悉的那一句。</p><div><span><Volume2 size={13} />语音接梗</span><span><FileText size={13} />文字细聊</span><span><Shield size={13} />主队保护</span></div></div>
            <div className="feed-divider"><span>本场观赛记录</span></div>
            {state.messages.map(message => <MessageCard key={message.id} message={message} state={state} />)}
            {state.answering && <div className="thinking"><span /><span /><span /><small>正在结合比赛信息认真想一想</small></div>}
          </div>
          {unread > 0 && <button className="new-messages" onClick={() => { bottomRef.current = true; feedRef.current!.scrollTop = feedRef.current!.scrollHeight; setUnread(0); }}><ArrowDown size={14} />{unread} 条新消息 · 回到实时</button>}
          {state.mode === 'demo' && state.running && <div className="demo-controls"><span>试试场景</span><button onClick={() => void act({ type: 'demo', event: 'death' })}>选手死亡</button><button onClick={() => void act({ type: 'demo', event: 'teamfight' })}>多人团战</button><button onClick={() => void act({ type: 'demo', event: 'replay' })}>识别回放</button><button onClick={() => void act({ type: 'demo', event: 'budget' })}>费用提醒</button></div>}
          <div className="composer">
            <div className="suggestions">{['下一手 BP 抢什么？', '左边怎么才能赢？', '两位中单历史交手胜率？'].map(s => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div>
            <div className="input-box"><textarea aria-label="向搭子提问" placeholder={state.running ? '聊聊这把怎么赢…（Enter 发送，Shift + Enter 换行）' : '先开始观赛，或者体验演示'} value={input} disabled={!state.running} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} rows={2} />
              <div className="input-tools"><button className={`mic-button ${microphone.enabled ? 'active' : ''}`} onClick={microphone.toggle} disabled={!state.running || state.mode !== 'live'}>{microphone.enabled ? <Mic size={16} /> : <MicOff size={16} />}{microphone.enabled ? '麦克风已开启' : '开启语音'}{microphone.enabled && <span className="mic-meter"><i style={{ width: `${microphone.level * 100}%` }} /></span>}</button><button className="send-button" aria-label="发送" disabled={!state.running || !input.trim()} onClick={submit}><ArrowRight size={19} /></button></div>
            </div>
            <div className="composer-note">正经回答优先于玩梗 <span>·</span> 信息不全时会说明，建议供观赛讨论</div>
          </div>
        </section>
      </div>}
      {tab === 'memes' && <MemeLibrary state={state} act={a => bridge.action(a)} report={notify} />}
      {tab === 'series' && <div className="full-page"><PageHeading eyebrow="SERIES NOTES" title="记住这轮，就够了。" description="一个 BO5，一份 Markdown。每局每位选手一行，不给选手贴永久标签。" actions={<><button className="button subtle" onClick={() => void bridge.openData()}><FolderOpen size={16} />打开数据目录</button><button className="button primary" onClick={() => setNewSeriesOpen(true)}><Layers3 size={16} />新建 BO5</button></>} />
        <div className="series-progress">{[1, 2, 3, 4, 5].map(n => <div className={n === m.game ? 'current' : n < m.game ? 'finished' : ''} key={n}><span>{n < m.game ? <Check size={20} /> : `0${n}`}</span><strong>第 {n} 局</strong><small>{n === m.game ? phaseNames[m.phase] : n < m.game ? '已结束' : '待开始'}</small></div>)}</div>
        <div className="panel memory-panel"><div className="panel-heading"><span><FileText size={16} />{m.seriesId}.md</span><button className="text-button" onClick={() => void act({ type: 'finish-game' })}>结束本局并更新</button></div><pre>{state.memory || '# 这轮比赛的故事，还没写下。\n\n每局结束后，点击「结束本局 · 写入文档」。\n记录英雄选择、承担的角色和实际观察到的打法。\n下一局，搭子会记得谁从抗压转向了亮剑。'}</pre></div>
      </div>}
      {tab === 'usage' && <div className="full-page"><PageHeading eyebrow="SESSION INSIGHTS" title="每一次开口，都有数。" description="费用按你填写的单价和服务返回用量估算。异常请求可能已被计费，请以服务商账单为准。" actions={<button className="button subtle" onClick={() => void bridge.exportDiagnostics()}><Import size={16} />导出测试记录</button>} />
        <div className="metrics-grid">{[
          ['近 1 小时估算', `¥${state.hourlyCost.toFixed(3)}`, `提醒线 ¥${state.settings.hourlyBudget}`],
          ['累计估算', `¥${state.totalCost.toFixed(3)}`, `${state.usage.length} 条费用记录`],
          ['未计价请求', `${state.unpriced}`, '缺费率或用量不完整'],
          ['已识别画面', `${state.metrics.frames}`, `云端标记 ${state.metrics.replayFrames} 次回放 · 本地仍可开串`],
        ].map(([label, value, note]) => <div className="panel metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
        <div className="panel usage-table"><div className="panel-heading"><span>请求明细</span><span className="small muted">最近 100 条 · 本地语音不产生 API 费用</span></div><table><thead><tr><th>时间</th><th>类别 / 模型</th><th>用量</th><th>估算费用</th><th>状态</th></tr></thead><tbody>{state.usage.slice(-100).reverse().map(u => <tr key={u.id}><td>{new Date(u.at).toLocaleTimeString('zh-CN')}</td><td>{u.category}<small>{u.model}</small></td><td>{u.category === 'search' ? (u.note || '工具用量未知') : u.status === 'unknown' ? '用量未知' : u.category === 'asr' ? `${u.seconds.toFixed(1)} 秒` : `${u.input} / ${u.output} tokens`}</td><td>{u.cost === null ? '待计价' : `¥${u.cost.toFixed(5)}`}</td><td title={u.note}>{u.status === 'reported' ? '已返回用量' : '账单待核对'}</td></tr>)}</tbody></table>{!state.usage.length && <div className="empty-table">还没有付费请求。演示模式不会记入账单。</div>}</div>
        <div className="panel latency-panel"><h3>语音开始延迟</h3><p>从死亡证据采集到实际开始播放。包含识别、分组、排队和音频准备时间；演示数据单独标注。</p>{state.messages.filter(x => x.latencyMs !== undefined).slice(-12).map(x => <div key={x.id}><span>{x.source === 'demo' ? '演示' : '实际'} · {x.text}</span><strong className={x.latencyMs! <= 3000 ? 'teal' : 'amber'}>{(x.latencyMs! / 1000).toFixed(2)}s</strong></div>)}</div>
      </div>}
      <footer className="app-footer"><span><Headphones size={12} />看得认真，串得开心。</span><span>本地运行 <i />{state.settings.hasApiKey ? '模型已配置' : '模型待配置'} <i />{state.settings.hasSearchKey ? '搜索已配置' : '搜索待配置'}</span></footer>
    </main>
    {toast && <div className="toast" role="alert">{toast}<button onClick={() => setToast('')}><X size={15} /></button></div>}
    {calibration && <Calibration frame={calibration} players={state.match.players} close={() => setCalibration(null)} save={profile => bridge.localProfile(profile)} />}
    {settingsOpen && <SettingsDialog state={state} close={() => setSettingsOpen(false)} report={notify} />}
    {viewportFrame&&<ViewportDialog frame={viewportFrame} close={()=>setViewportFrame(null)} save={rect=>act({type:'broadcast-area',rect})}/>}
    {sourceOpen && <SourceDialog close={() => setSourceOpen(false)} select={selectSource} report={notify} />}
    {editPlayer && <PlayerDialog player={editPlayer} close={() => setEditPlayer(null)} save={p => { void act({ type: 'player', slot: editPlayer.slot, patch: p }); setEditPlayer(null); }} />}
    {contextOpen && <ContextDialog state={state} close={() => setContextOpen(false)} action={act} />}
    {newSeriesOpen && <NewSeriesDialog close={() => setNewSeriesOpen(false)} create={title => { void act({ type: 'new-series', title }); setNewSeriesOpen(false); }} />}
    {state.budgetAlert && <Modal title="到了本小时的预算提醒线" close={() => void act({ type: 'ack-budget' })}><div className="budget-symbol"><Coins size={36} /></div><p>近 1 小时已计价部分约 <strong>¥{state.hourlyCost.toFixed(2)}</strong>，提醒线为 ¥{state.settings.hourlyBudget}。</p>{state.unpriced > 0 && <p className="amber">另有 {state.unpriced} 次未计价请求，实际费用可能更高。</p>}<p className="muted">继续运行会继续产生费用。暂停将停止新请求、采集分析与语音，已发出的请求仍可能计费。</p><div className="dialog-actions"><button className="button subtle" onClick={() => void act({ type: 'ack-budget' })}>继续，本小时不再提醒</button><button className="button primary" onClick={() => { void act({ type: 'ack-budget' }); void act({ type: 'pause' }); }}><Pause size={15} />暂停 Agent</button></div></Modal>}
  </div>;
}

function NavButton({ icon, active, onClick, title }: { icon: React.ReactNode; active: boolean; onClick: () => void; title: string }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{title}</span></button>;
}
function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{description}</p></div><div className="page-actions">{actions}</div></div>;
}
function MessageCard({ message: m, state }: { message: Message; state: Snapshot }) {
  const sourceLabel = m.source === 'demo' ? '演示' : m.source === 'vision' ? '画面触发' : m.source === 'user' ? '' : '搭子';
  if (m.kind === 'system') return <div className="system-message"><span className="dot tiny" /><span>{m.text}</span></div>;
  return <div className={`message message-${m.kind}`}>
    <div className="message-meta"><span>{m.kind === 'user' ? '你' : m.kind === 'answer' ? '认真分析' : <><Zap size={12} />搭子开串</>}</span><small>{clock(m.gameSeconds)}{sourceLabel && ` · ${sourceLabel}`}</small>{m.targets?.map(s => <small key={s}>{state.match.players.find(p => p.slot === s)?.name}</small>)}{m.teamTargets?.map(s => <small key={s}>{state.match.teams[s].name}</small>)}</div>
    <div className="message-text">{m.text}</div>
    {m.sources && m.sources.length > 0 && <div className="message-sources">{m.sources.map((s, i) => <button key={`${s.url}:${i}`} onClick={() => void bridge.openUrl(s.url)}>{i + 1}. {s.title} ↗</button>)}</div>}
    {m.speechStatus && <div className="speech-status"><Volume2 size={11} />{({ pending: '待播报', playing: '正在说', done: '已播报', skipped: '保留文字', error: '语音不可用' })[m.speechStatus]}{m.latencyMs !== undefined && ` · ${(m.latencyMs / 1000).toFixed(1)}s`}</div>}
  </div>;
}
function DemoMap() {
  return <div className="demo-map"><div className="demo-score"><span>蓝方 <b>08</b></span><small>14:52</small><span><b>06</b> 红方</span></div><svg viewBox="0 0 480 210" aria-label="仅用于演示的抽象峡谷画面">
    <defs><linearGradient id="river" x1="0" y1="1" x2="1" y2="0"><stop stopColor="#215355" /><stop offset="1" stopColor="#162c41" /></linearGradient></defs>
    <path d="M70 190L70 40L410 40L410 190Z" fill="#122c28" stroke="#254139" strokeWidth="1" />
    <path d="M90 185Q220 135 250 100T410 25" fill="none" stroke="url(#river)" strokeWidth="22" />
    <path d="M90 180L90 60L390 60M90 180L390 180L390 60M90 180L390 60" fill="none" stroke="#435047" strokeWidth="7" opacity=".6" />
    <path d="M122 136L143 86L194 83L177 120ZM270 140L300 94L350 106L350 152Z" fill="#0e201e" stroke="#294034" />
    {[ [115, 175], [168, 148], [212, 123], [235, 137], [247, 123] ].map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="10" fill="#62d9c3" opacity=".12" /><circle cx={x} cy={y} r="4" fill="#69d8c5" /></g>)}
    {[ [344, 66], [286, 97], [265, 112], [264, 136], [280, 129] ].map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="10" fill="#e69e84" opacity=".12" /><circle cx={x} cy={y} r="4" fill="#e0a087" /></g>)}
    <circle cx="90" cy="180" r="12" fill="#4fb8bd" opacity=".7" /><circle cx="390" cy="60" r="12" fill="#c48477" opacity=".7" />
  </svg><div className="demo-watermark">DEMO <span>示意画面 · 非真实比赛</span></div></div>;
}

function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><X size={20} /></button></div>{children}</section></div>;
}
function SourceDialog({ close, select, report }: { close: () => void; select: (id: string) => Promise<void>; report: (text: string) => void }) {
  const [sources, setSources] = useState<Awaited<ReturnType<typeof bridge.sources>>>([]);
  const [loading, setLoading] = useState(true);
  const refresh = () => { setLoading(true); void bridge.sources().then(setSources).catch(e => report(e.message)).finally(() => setLoading(false)); };
  useEffect(refresh, []);
  return <Modal title="选择比赛所在的窗口" close={close} wide><p className="muted">只共享所选窗口的画面，不采集系统声音。请保持直播窗口展开，避免最小化。</p><button className="text-button" onClick={refresh}><RefreshCw size={14} />刷新窗口列表</button><div className="source-grid">{sources.map(s => <button key={s.id} onClick={() => void select(s.id)}><img src={s.thumbnail} alt="" /><span>{s.name}</span></button>)}</div>{loading && <p>正在读取窗口…</p>}</Modal>;
}
function PlayerDialog({ player, close, save }: { player: Player; close: () => void; save: (patch: Partial<Player>) => void }) {
  const [p, setP] = useState(player);
  return <Modal title={`${player.side === 'left' ? '左方' : '右方'} · ${roleLabels[player.role]}`} close={close}>
    <div className="form-grid"><label>选手 ID<input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></label><label>本局英雄<input list="champion-names" value={p.champion} onChange={e => setP({ ...p, champion: e.target.value })} /><datalist id="champion-names">{champions.map(c=><option key={c.id} value={c.title}>{c.name} · {c.id}</option>)}</datalist></label></div>
    <label className="field">本局角色与观察<input value={p.style} onChange={e => setP({ ...p, style: e.target.value })} placeholder="例如：本局选择坦克，承担前排任务" /></label>
    <label className="field">玩梗优先级 <strong>{p.priority}</strong><input type="range" min="0" max="100" value={p.priority} onChange={e => setP({ ...p, priority: Number(e.target.value) })} /></label>
    <label className="check-row"><input type="checkbox" checked={p.allowBanter} onChange={e => setP({ ...p, allowBanter: e.target.checked })} />允许这位选手的黑梗</label>
    <label className="check-row"><input type="checkbox" checked={p.locked} onChange={e => setP({ ...p, locked: e.target.checked })} />锁定手动信息，不被画面识别覆盖</label>
    <p className="small muted">{p.evidence || '目前没有画面识别证据。手动填写后建议锁定。'}</p>
    <div className="dialog-actions"><button className="button subtle" onClick={close}>取消</button><button className="button primary" onClick={() => save({ name: p.name, champion: p.champion, style: p.style, priority: p.priority, allowBanter: p.allowBanter, locked: p.locked || p.name !== player.name || p.champion !== player.champion })}>保存设置</button></div>
  </Modal>;
}
function ContextDialog({ state, close, action }: { state: Snapshot; close: () => void; action: (a: Action) => Promise<void> }) {
  const m = state.match;
  const [title, setTitle] = useState(m.seriesTitle), [patch, setPatch] = useState(m.patch);
  const [left, setLeft] = useState(m.teams.left.name), [right, setRight] = useState(m.teams.right.name);
  const [lb, setLb] = useState(m.bans.left.join('、')), [rb, setRb] = useState(m.bans.right.join('、'));
  return <Modal title="校正比赛信息" close={close}><label className="field">系列赛名称<input value={title} onChange={e => setTitle(e.target.value)} /></label><div className="form-grid"><label>左方队伍<input value={left} onChange={e => setLeft(e.target.value)} /></label><label>右方队伍<input value={right} onChange={e => setRight(e.target.value)} /></label></div><label className="field">比赛版本<input value={patch} placeholder="待确认，例如 26.18" onChange={e => setPatch(e.target.value)} /></label><div className="form-grid"><label>左方禁用（逗号分隔）<input value={lb} onChange={e => setLb(e.target.value)} /></label><label>右方禁用（逗号分隔）<input value={rb} onChange={e => setRb(e.target.value)} /></label></div>
    <div className="dialog-actions"><button className="button primary" onClick={async () => {
      const split = (s: string) => s.split(/[,，、]/).map(x => x.trim()).filter(Boolean).slice(0, 5);
      await action({ type: 'context', patch, seriesTitle: title, bans: { left: split(lb), right: split(rb) } });
      await action({ type: 'team', side: 'left', name: left }); await action({ type: 'team', side: 'right', name: right }); close();
    }}>保存比赛信息</button></div></Modal>;
}
function NewSeriesDialog({ close, create }: { close: () => void; create: (title: string) => void }) {
  const [title, setTitle] = useState('');
  return <Modal title="开始一场新的 BO5" close={close}><p className="muted">保留已写入的系列赛文档，重置当前名单和观赛消息。新系列赛不会读取旧 BO5 记忆。</p><label className="field">系列赛名称<input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：今晚的半决赛" /></label><div className="dialog-actions"><button className="button primary" onClick={() => create(title || '我的 BO5')}>新建系列赛</button></div></Modal>;
}
function SettingsDialog({ state, close, report }: { state: Snapshot; close: () => void; report: (text: string) => void }) {
  const [settings, setSettings] = useState<Settings>(() => settingsSchema.parse({ ...state.settings, apiKey: '', searchKey: '' }));
  const [voices, setVoices] = useState<{ name: string; culture: string }[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void bridge.voices().then(setVoices).catch(e => report(e.message)); }, []);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => ({ ...s, [key]: value }));
  const textField = (key: keyof Settings, label: string, placeholder?: string, secret = false) => <label>{label}<input type={secret ? 'password' : 'text'} value={String(settings[key] ?? '')} placeholder={placeholder} autoComplete="off" onChange={e => set(key, e.target.value as never)} /></label>;
  const rateField = (key: keyof Settings, label: string) => <label>{label}<input type="number" min="0" step="any" value={settings[key] as number ?? ''} placeholder="未填写，费用未知" onChange={e => set(key, (e.target.value === '' ? null : Number(e.target.value)) as never)} /></label>;
  return <Modal title="搭子的设置" close={close} wide><div className="settings-content">
    <div className="settings-section"><h3>本地识别</h3><label><input type="checkbox" checked={settings.broadcastEnabled} onChange={e => set('broadcastEnabled', e.target.checked)} />启用 LPL 双布局自动识别</label></div><div className="settings-section"><h3>模型服务 <span>默认百炼 · 北京地域</span></h3><div className="form-grid">{textField('baseUrl', '兼容接口 Base URL')}{textField('apiKey', `API 密钥${state.settings.hasApiKey ? '（已保存，留空保持）' : ''}`, '密钥仅在主进程加密保存', true)}{textField('textModel', '战术问答模型')}{textField('visionModel', '画面识别模型')}{textField('asrModel', '语音识别模型')}<label>云端背景识别间隔（毫秒）<input type="number" min="800" max="60000" step="100" value={settings.captureIntervalMs} onChange={e => set('captureIntervalMs', Number(e.target.value))} /></label><label>模型请求超时（秒）<input type="number" min="5" max="120" step="5" value={settings.modelTimeoutMs / 1000} onChange={e => set('modelTimeoutMs', Number(e.target.value) * 1000)} /></label></div><p className="small muted">云端默认每 10 秒最多分析一次背景；提问会立即采集新截图并优先分析，产生额外请求。本地死亡检测每 0.5 秒尝试，不受云端间隔影响，也不调用付费模型。延长超时不会让模型变快。</p></div>
    <div className="settings-section"><h3>联网检索 <span>百炼 Qwen · 共用模型密钥</span></h3><div className="form-grid">{textField('searchModel', '搜梗 / 检索模型（推荐 qwen-plus）')}</div><p className="small muted">搜梗仅在梗库页手动触发，限虎扑公开讨论帖及评论。战术问答按需检索赛事、版本等来源。旧博查配置与自动搜索开关不再生效。</p><label><input type="checkbox" checked={settings.danmakuEnabled} onChange={e=>set('danmakuEnabled',e.target.checked)} />尝试读取画面中的弹幕并延伸</label></div>
    <div className="settings-section"><h3>本地语音 <span>Windows 中文语音 · 不产生 API 费用</span></h3><div className="form-grid"><label>音色<select value={settings.voice} onChange={e => set('voice', e.target.value)}><option value="">自动选择已安装中文音色</option>{voices.map(v => <option key={v.name} value={v.name}>{v.name} · {v.culture}</option>)}</select></label><label>语速（-5～5）<input type="number" min="-5" max="5" value={settings.voiceRate} onChange={e => set('voiceRate', Number(e.target.value))} /></label><label>麦克风触发阈值<input type="number" min=".005" max=".3" step=".005" value={settings.vadThreshold} onChange={e => set('vadThreshold', Number(e.target.value))} /></label></div><p className="small muted">推荐戴耳机，减少解说声误触发。没有中文音色时，在 Windows「语言和区域」中安装中文语音包。</p></div>
    <div className="settings-section"><h3>费用提醒 <span>人民币 · 按账户实际单价填写</span></h3><div className="form-grid"><label>近 1 小时提醒线（元）<input type="number" min=".01" step=".5" value={settings.hourlyBudget} onChange={e => set('hourlyBudget', Number(e.target.value))} /></label>{rateField('qwenSearchRate', '搜索工具 / 意图次（元，非账单次数）')}{rateField('searchInputRate', '搜梗输入 / 百万 tokens（元）')}{rateField('searchOutputRate', '搜梗输出 / 百万 tokens（元）')}{rateField('textInputRate', '问答输入 / 百万 tokens（元）')}{rateField('textOutputRate', '问答输出 / 百万 tokens（元）')}{rateField('visionInputRate', '视觉输入 / 百万 tokens（元）')}{rateField('visionOutputRate', '视觉输出 / 百万 tokens（元）')}{rateField('asrSecondRate', '语音识别 / 秒（元）')}</div><p className="small amber">未填写费率的请求显示“待计价”，预算提醒不能覆盖这部分费用。提醒不会自动暂停。</p></div>
    <div className="settings-section"><h3>数据与密钥</h3><p className="small muted">原始截图与录音不落盘。文字记录、用量、梗库、系列赛文档和本地语音缓存保存在应用数据目录。截图、录音片段与对话上下文会按功能发送给所配置的服务。</p><div className="checks"><button className="text-button" onClick={() => void bridge.openData()}><FolderOpen size={14} />打开数据目录</button><button className="text-button danger" onClick={() => { set('apiKey', '__DELETE__'); set('searchKey', '__DELETE__'); }}>清除已保存密钥（保存后生效）</button></div></div>
  </div><div className="dialog-actions"><span className="small muted">保存后暂停观赛，再次开始时应用配置</span><button className="button subtle" onClick={close}>取消</button><button className="button primary" disabled={saving} onClick={async () => {
    setSaving(true);
    try { await bridge.settings(settingsSchema.parse(settings)); close(); report('设置已保存'); }
    catch (e) { report(e instanceof Error ? e.message : '设置保存失败'); }
    finally { setSaving(false); }
  }}>{saving ? '保存中…' : '保存设置'}</button></div></Modal>;
}

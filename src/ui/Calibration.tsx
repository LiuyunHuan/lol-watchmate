import { useRef, useState } from 'react';
import { LocalProfile, Rect } from '../shared/local';
import { Player, roleLabels, Slot } from '../shared/types';
import { feature } from './local-vision';

export function Calibration({ frame, players, close, save }: {
  frame: HTMLCanvasElement; players: Player[]; close: () => void; save: (profile: LocalProfile) => Promise<void>;
}) {
  const [image] = useState(() => frame.toDataURL('image/png'));
  const [target, setTarget] = useState<string>('clock');
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const known = players.filter(p => p.name);
  const point = (e: React.PointerEvent) => {
    const box = surface.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
  };
  const rectangle = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  });
  return <div className="modal-backdrop"><section className="modal calibration" role="dialog" aria-label="校准本地死亡检测" aria-modal="true">
    <div className="modal-heading"><h2>校准本地死亡检测</h2><button className="icon-button" aria-label="关闭校准" onClick={close}>✕</button></div>
    <p>在正常对局、选手存活时校准。先框选游戏时间（只含 mm:ss），再紧贴框选选手头像，包含死亡后会出现倒计时的位置，避免血条和其他数字。只对已校准的选手触发。</p>
    <div className="calibration-tools"><label>当前框选目标 <select value={target} onChange={e => { setTarget(e.target.value); setPreview(null); }}>
      <option value="clock">游戏时间 {rects.clock ? '✓' : ''}</option>
      <option value="replay">回放标识出现区域（可选） {rects.replay ? '✓' : ''}</option>
      {known.map(p => <option key={p.slot} value={p.slot}>{p.side === 'left' ? '左' : '右'} · {roleLabels[p.role]} · {p.name} {rects[p.slot] ? '✓' : ''}</option>)}
    </select></label><button className="button subtle" onClick={() => setRects(r => { const next = { ...r }; delete next[target]; return next; })}>清除当前区域</button></div>
    <div ref={surface} className="calibration-surface" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(point(e)); setPreview(null); }}
      onPointerMove={e => { if (drag) setPreview(rectangle(drag, point(e))); }}
      onPointerUp={e => {
        if (!drag) return; const r = rectangle(drag, point(e)); setDrag(null); setPreview(null);
        if (r.w * frame.width < 12 || r.h * frame.height < 10) { setError('区域太小，请重新框选'); return; }
        setRects(previous => ({ ...previous, [target]: r })); setError('');
      }}>
      <img src={image} draggable={false} />
      {Object.entries({ ...rects, ...(preview ? { [target]: preview } : {}) }).map(([id, r]) => <div key={id} className={`calibration-box ${id === target ? 'selected' : ''}`}
        style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}><span>{id === 'clock' ? '时钟' : id === 'replay' ? '回放标识' : players.find(p => p.slot === id)?.name}</span></div>)}
    </div>
    <p className="small muted">画面已冻结供框选，直播仍在播放。可额外框选转播中“回放 / REPLAY”标识出现的位置；未校准该区域时仅靠时钟倒退过滤回放。换窗口、改变窗口尺寸或下一局换英雄后要重新校准。黑白头像不适合当作存活样本。尚无名单时请先关闭，校正选手信息。</p>
    {error && <p className="amber">{error}</p>}
    <div className="dialog-actions"><span>{known.filter(p => rects[p.slot]).length} 位选手已框选</span><button className="button primary" disabled={busy || !rects.clock || !known.some(p => rects[p.slot])} onClick={async () => {
      const portraits = known.filter(p => rects[p.slot]).map(p => ({ slot: p.slot as Slot, name: p.name, rect: rects[p.slot], alive: feature(frame, rects[p.slot]) }));
      if (portraits.some(p => p.alive.saturation < .12)) { setError('有头像颜色过少，可能已经死亡或选区不正确；请在存活时重新打开校准。'); return; }
      setBusy(true);
      try { await save({ id: crypto.randomUUID(), width: frame.width, height: frame.height, clock: rects.clock, replay: rects.replay, portraits }); close(); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>{busy ? '保存中…' : '保存并开启本地检测'}</button></div>
  </section></div>;
}

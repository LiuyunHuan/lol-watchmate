import { describe, expect, it } from 'vitest';
import { LocalDeathDetector, similarity } from '../src/core/local-detector';
import { Feature, LocalProfile, LocalReading } from '../src/shared/local';
import { demoMatch } from '../src/core/match';
import { Storage } from '../electron/storage';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const alive: Feature = { saturation: .65, light: 80, pattern: Array.from({ length: 64 }, (_, i) => 20 + i * 2) };
const grey: Feature = { saturation: .03, light: 50, pattern: alive.pattern.map(x => x * .6) };
const profile: LocalProfile = { id: '21c10cfa-1576-4542-b70b-aa9277c898d0', width: 640, height: 420,
  clock: { x: .4, y: .1, w: .2, h: .1 }, portraits: [{ slot: 'left-top', name: 'TheShy', rect: { x: .1, y: .3, w: .1, h: .1 }, alive }] };
const read = (at: number, clock: number | null, dead = false): LocalReading => ({
  profileId: profile.id, at, elapsedMs: 80, clock, clockConfidence: 95, replay: false,
  samples: [{ slot: 'left-top', feature: dead ? grey : alive, timer: dead ? 25 : null, timerConfidence: 90 }],
});
describe('本地检测，不依赖云端', () => {
  it('彩色存活到匹配的灰头像立即触发，持续灰头像不刷屏', () => {
    const d = new LocalDeathDetector(), m = demoMatch('test');
    expect(d.ingest(read(1000, 100), profile, m, 1100).events).toHaveLength(0);
    const result = d.ingest(read(1500, 101, true), profile, m, 1600);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ source: 'local', observedAt: 1500 });
    expect(d.ingest(read(2500, 102, true), profile, m, 2600).events).toHaveLength(0);
  });
  it('匹配的灰头像即使没有倒计时也触发，保护仍然有效', () => {
    const d = new LocalDeathDetector(), m = demoMatch('test');
    d.ingest(read(1000, 100), profile, m, 1100);
    const r = read(1500, 101, true); r.samples[0].timer = null;
    expect(d.ingest(r, profile, m, 1600).events).toHaveLength(1);
    expect(d.ingest(read(2000, 102, true), profile, m, 2100).events).toHaveLength(0);
    m.players[0].allowBanter = false;
    expect(d.ingest(read(2500, 103, true), profile, m, 2600).events).toHaveLength(0);
  });
  it('回放及拖动进度允许开串，重复时间戳与真正过时帧仍丢弃', () => {
    const d = new LocalDeathDetector(), m = demoMatch('test');
    d.ingest(read(1000, 100), profile, m, 1100);
    expect(d.ingest(read(1500, 80, true), profile, m, 1600).events).toHaveLength(1);
    expect(d.ingest(read(4000, 200, true), profile, m, 4100).events).toHaveLength(0);
    expect(d.ingest(read(2500, 201, true), profile, m, 2600).status).toContain('重复');
    expect(d.ingest(read(5000, 201, true), profile, m, 21000).status).toContain('过时');
    expect(d.ingest(read(6000, 200, true), profile, m, 6100).events).toHaveLength(0);
  });
  it('转场仍不触发，但时钟不可读不阻止匹配头像的死亡信号', () => {
    const d = new LocalDeathDetector(), m = demoMatch('test');
    d.ingest(read(1000, 100), profile, m, 1100);
    const r = read(1500, 101, true); r.samples[0].feature = { ...grey, pattern: [...grey.pattern].reverse() };
    expect(similarity(alive, r.samples[0].feature)).toBeLessThan(0);
    expect(d.ingest(r, profile, m, 1600).status).toContain('转场');
    expect(d.ingest(read(2000, null, true), profile, m, 2100).events).toHaveLength(1);
  });
  it('带回放标识也能触发，不要求时钟回到原进度', () => {
    const d = new LocalDeathDetector(), m = demoMatch('test');
    d.ingest(read(1000, 100), profile, m, 1100);
    expect(d.ingest({ ...read(1500, 101, true), replay: true }, profile, m, 1600).events).toHaveLength(1);
    expect(d.ingest({...read(2000, 102, true),replay:true}, profile, m, 2100).events).toHaveLength(0);
  });
  it('旧配置升级为十秒，新版用户自设间隔保留', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watchmate-migrate-'));
    try {
      const s = new Storage(root); s.write('settings.json', { captureIntervalMs: 2000 });
      expect(s.loadSettings(x => x).captureIntervalMs).toBe(10000);
      s.write('settings.json', { capturePolicyVersion: 2, captureIntervalMs: 15000 });
      expect(s.loadSettings(x => x).captureIntervalMs).toBe(15000);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

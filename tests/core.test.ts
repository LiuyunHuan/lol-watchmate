import { describe, expect, it } from 'vitest';
import { DeathDetector } from '../src/core/detector';
import { demoMatch } from '../src/core/match';
import { Observation, SpeechJob, settingsSchema } from '../src/shared/types';
import { builtinMemes, parseMemeMarkdown, permitted, selectBanter } from '../src/core/banter';
import { SpeechQueue } from '../src/core/speech';
import { estimateCost, totals } from '../src/core/budget';
import { previousPicks, updateMemory } from '../src/core/memory';
import { encodeWav } from '../src/ui/media';

function frame(time: number, dead: boolean | null, deaths: number | null, phase: Observation['phase'] = 'live'): Observation {
  return { phase, gameSeconds: time, situation: '', danmaku: [], players: [{
    slot: 'left-top', dead, deaths, confidence: 0.99, evidence: '死亡计时与KDA', name: 'TheShy',
  }] };
}
describe('死亡检测', () => {
  it('首次观察只建基线；两个确认帧触发一次；重复帧不重复触发', () => {
    const d = new DeathDetector(), match = demoMatch('test');
    expect(d.ingest(frame(100, false, 0), match, 0, 0)).toHaveLength(0);
    expect(d.ingest(frame(101, true, 1), match, 1000, 1200)).toHaveLength(0);
    const events = d.ingest(frame(102, true, 1), match, 2000, 2200);
    expect(events).toHaveLength(1); expect(events[0].observedAt).toBe(1000);
    expect(d.ingest(frame(103, true, 1), match, 3000, 3200)).toHaveLength(0);
  });
  it('回放、倒退游戏时间、低置信度、受保护选手都不触发', () => {
    const d = new DeathDetector(), match = demoMatch('test');
    d.ingest(frame(100, false, 0), match, 0, 0);
    for (const f of [frame(101, true, 1, 'replay'), frame(50, true, 1)]) {
      expect(d.ingest(f, match, 1000, 1000)).toHaveLength(0);
      expect(d.ingest(f, match, 1100, 1100)).toHaveLength(0);
    }
    const low = frame(101, true, 1); low.players[0].confidence = 0.5;
    expect(d.ingest(low, match, 1200, 1200)).toHaveLength(0);
    match.players[0].allowBanter = false;
    expect(d.ingest(frame(105, true, 1), match, 1300, 1300)).toHaveLength(0);
    expect(d.ingest(frame(106, true, 1), match, 1400, 1400)).toHaveLength(0);
  });
  it('再次死亡可再次触发，初次挂入已死亡状态不会播放旧梗', () => {
    const d = new DeathDetector(), match = demoMatch('test');
    d.ingest(frame(100, true, 1), match, 0, 0);
    expect(d.ingest(frame(101, true, 1), match, 100, 100)).toHaveLength(0);
    d.ingest(frame(130, false, 1), match, 200, 200);
    d.ingest(frame(131, false, 1), match, 300, 300);
    d.ingest(frame(160, true, 2), match, 400, 400);
    expect(d.ingest(frame(161, true, 2), match, 500, 500)).toHaveLength(1);
  });
  it('灰头像与未变化死亡次数矛盾时不猜死亡', () => {
    const d = new DeathDetector(), match = demoMatch('test');
    d.ingest(frame(100, false, 0), match, 0, 0);
    expect(d.ingest(frame(101, true, 0), match, 10, 10)).toHaveLength(0);
    expect(d.ingest(frame(102, true, 0), match, 20, 20)).toHaveLength(0);
  });
});

describe('玩梗策略', () => {
  const events = ['left-top', 'left-mid', 'left-adc'].map((slot, i) => ({
    id: String(i), slot: slot as 'left-top', game: 1, gameSeconds: 800, observedAt: 1000, detectedAt: 1500, source: 'vision' as const, evidence: '',
  }));
  it('团战先一位明星，再一条团队梗', () => {
    const result = selectBanter(events, demoMatch('test'), builtinMemes, 0);
    expect(result).toHaveLength(2); expect(result[0].targets).toEqual(['left-top']);
    expect(result[1].teamTargets).toEqual(['left']);
  });
  it('保护明星后不把其梗用在其他人身上；团队开关独立', () => {
    const match = demoMatch('test'); match.players[0].allowBanter = false;
    const result = selectBanter(events, match, builtinMemes, 0);
    expect(result).toHaveLength(1); expect(result[0].targets).toEqual([]);
    expect(permitted('还是送姜', ['left-mid'], [], match, builtinMemes)).toBe(false);
    match.teams.left.allowBanter = false;
    expect(selectBanter(events, match, builtinMemes, 0)).toEqual([]);
  });
  it('同一选手在一组事件重复出现不能冒充多人团战', () => {
    const result = selectBanter([events[0], events[0]], demoMatch('test'), builtinMemes, 0);
    expect(result).toHaveLength(1);
  });
  it('Markdown只按指定标题读取短句，普通说明不当作梗', () => {
    const result = parseMemeMarkdown('# 梗库\n说明\n## 选手: TheShy\n- 下雨了\n## 队伍: *\n- 干燥，不亏');
    expect(result).toHaveLength(2); expect(result[1].kind).toBe('team');
  });
});

const job = (id: string, kind: 'answer' | 'banter', expiresAt = 9000): SpeechJob => ({
  id, messageId: id, kind, text: id, createdAt: 0, expiresAt, targets: [], teamTargets: [],
});
describe('语音优先级', () => {
  it('用户说话和正经回答占用时，梗不抢话；过时不补播', () => {
    const q = new SpeechQueue(); q.paused = false;
    q.enqueue(job('梗', 'banter', 1000)); q.userSpeaking = true;
    expect(q.next(100)).toBeNull();
    q.userSpeaking = false; q.answering = true;
    expect(q.next(200)).toBeNull();
    q.enqueue(job('分析', 'answer'));
    expect(q.next(300)?.id).toBe('分析');
    q.finish('分析'); q.answering = false;
    expect(q.next(2000)).toBeNull();
  });
  it('只保留最新一组待播梗，暂停清空', () => {
    const q = new SpeechQueue(); q.paused = false; q.answering = true;
    q.replaceBanter([job('旧', 'banter')]); q.replaceBanter([job('新', 'banter')]);
    q.answering = false; expect(q.next(500)?.id).toBe('新');
    q.clear(); q.paused = true; expect(q.next(600)).toBeNull();
  });
  it('偏好变化能撤销正在播的梗', () => {
    const q = new SpeechQueue(); q.paused = false; q.enqueue(job('梗', 'banter')); q.next(0);
    q.filter(j => j.kind === 'answer'); expect(q.current).toBeNull();
  });
});

describe('BO5文档', () => {
  it('一局10行，重复保存覆盖同局；下一局追加同一文档', () => {
    const match = demoMatch('test');
    let md = updateMemory('', match);
    expect(md.match(/^\| (蓝方|红方)/gm)).toHaveLength(10);
    match.players[0].style = '本局承担前排';
    md = updateMemory(md, match);
    expect(md.match(/## 第 1 局/g)).toHaveLength(1);
    expect(previousPicks(md, 1).get('TheShy')).toBe('奥恩');
    match.game = 2; match.players[0].champion = '剑姬';
    md = updateMemory(md, match);
    expect(md).toContain('## 第 2 局');
    expect(previousPicks(md, 1).get('TheShy')).toBe('奥恩');
    expect(previousPicks(md, 2).get('TheShy')).toBe('剑姬');
  });
});
describe('费用与音频', () => {
  it('未配置费率不伪装成零；按滚动小时计价', () => {
    const settings = settingsSchema.parse({});
    expect(estimateCost(settings, 'vision', 1000, 100)).toBeNull();
    settings.visionInputRate = 2; settings.visionOutputRate = 8;
    expect(estimateCost(settings, 'vision', 1000, 100)).toBeCloseTo(0.0028);
    expect(totals([
      { id: 'old', at: 0, cost: 5, category: 'text', model: '', input: 0, output: 0, seconds: 0, status: 'reported' },
      { id: 'new', at: 3600001, cost: 2, category: 'text', model: '', input: 0, output: 0, seconds: 0, status: 'reported' },
    ], 3600002).hourlyCost).toBe(2);
  });
  it('录音编码为16kHz单声道PCM WAV', () => {
    const result = encodeWav([new Float32Array(48000).fill(0.25)], 48000);
    const bytes = Buffer.from(result.wav.split(',')[1], 'base64');
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt32LE(24)).toBe(16000);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(result.seconds).toBe(1);
    expect(bytes.length).toBe(32044);
  });
});

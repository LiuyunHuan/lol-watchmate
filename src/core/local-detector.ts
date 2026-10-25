import { Feature, LocalProfile, LocalReading } from '../shared/local';
import { DeathEvent, Match } from '../shared/types';
import { BroadcastDetector } from './broadcast-detector';

export function similarity(a: Feature, b: Feature): number {
  const indices = Array.from({ length: 64 }, (_, i) => i).filter(i => i % 8 < 2 || i % 8 >= 6 || i < 16 || i >= 48);
  const am = indices.reduce((s, i) => s + a.pattern[i], 0) / indices.length, bm = indices.reduce((s, i) => s + b.pattern[i], 0) / indices.length;
  let dot = 0, aa = 0, bb = 0;
  for (const i of indices) { const x = a.pattern[i] - am, y = b.pattern[i] - bm; dot += x * y; aa += x * x; bb += y * y; }
  return aa > 25 && bb > 25 ? dot / Math.sqrt(aa * bb) : 0;
}

/** Calibrated portraits use the same replay-tolerant event policy as the automatic HUD. */
export class LocalDeathDetector {
  private detector = new BroadcastDetector();
  private lastAt = -Infinity;
  reset() { this.detector.reset(); this.lastAt = -Infinity; }
  forget(slot: Parameters<BroadcastDetector['forget']>[0]) { this.detector.forget(slot); }
  ingest(reading: LocalReading, profile: LocalProfile, match: Match, now: number): { events: DeathEvent[]; status: string } {
    const stop = (status: string) => ({ events: [] as DeathEvent[], status });
    if (reading.profileId !== profile.id || reading.at <= this.lastAt || now - reading.at > 15000 || reading.at > now + 500) return stop('丢弃过时或重复的本地画面');
    this.lastAt = reading.at;
    if (reading.error) return stop(reading.error);
    const observed = reading.samples.flatMap(sample => {
      const target = profile.portraits.find(p => p.slot === sample.slot);
      const player = match.players.find(p => p.slot === sample.slot);
      if (!target || !player || target.name !== player.name) return [];
      const same = similarity(target.alive, sample.feature) >= 0.45;
      const colored = same && sample.feature.saturation >= Math.max(0.08, target.alive.saturation * 0.65);
      const grey = same && target.alive.saturation >= 0.12 && sample.feature.saturation < target.alive.saturation * 0.5;
      return [{ sample, player, same, colored, grey }];
    });
    if (observed.filter(p => p.same).length < Math.max(1, Math.ceil(profile.portraits.length * 0.6))) return stop('选手栏变化/转场 · 请检查校准区域');
    const clock = reading.clockConfidence >= 55 ? reading.clock : null;
    const players = observed.map(({sample, player, colored, grey}) => ({
      slot: sample.slot, championId: player.championId, confidence: 1,
      dead: grey ? true : colored ? false : null,
      timer: grey && sample.timerConfidence >= 55 ? sample.timer : null,
    }));
    const events = this.detector.ingest({at:reading.at,elapsedMs:reading.elapsedMs,layout:'scoreboard',status:'manual',clock,replay:reading.replay,players,picks:[],victims:[]},match,now);
    for (const sample of players) {
      const p=match.players.find(p=>p.slot===sample.slot)!;
      if(sample.dead!==null)p.dead=sample.dead;
    }
    return { events, status: `本地检测中 · ${clock===null?'时钟待确认':clock+'s'} · ${observed.length} 个校准位置${reading.replay?' · 回放允许开串':''}` };
  }
}

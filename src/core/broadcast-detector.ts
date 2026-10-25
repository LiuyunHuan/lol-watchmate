import { BroadcastReading } from '../shared/broadcast';
import { DeathEvent, Match, Slot } from '../shared/types';

type PlayerState = {
  dead: boolean; alive: number; deaths: number | null; lastEventAt: number;
  counter?: { value: number; at: number }; counterCredits: number;
};
export const BANTER_COOLDOWN_MS = 5000;
/** Portraits remain immediate. Noisy counters need confirmation; signals for the same
 * death are consumed even during cooldown, never queued for a later joke. */
export class BroadcastDetector {
  private lastAt = -Infinity;
  private lastClock: number | null = null;
  private replay = false;
  private serial = 0;
  private players = new Map<Slot, PlayerState>();
  private feed = new Set<string>();
  reset() { this.lastAt = -Infinity; this.lastClock = null; this.replay = false; this.players.clear(); this.feed.clear(); }
  forget(slot: Slot) { this.players.delete(slot); }
  ingest(reading: BroadcastReading, match: Match, now: number): DeathEvent[] {
    // Same lifetime as visible local roster updates. Slow-but-current OCR is useful too.
    if (reading.at <= this.lastAt || now - reading.at > 15000 || reading.at > now + 500) return [];
    const gap = Number.isFinite(this.lastAt) ? reading.at - this.lastAt : 0;
    this.lastAt = reading.at;
    if (!['compact', 'scoreboard', 'scene'].includes(reading.layout)) return [];
    const time = reading.clock ?? this.lastClock ?? match.gameSeconds ?? 0;
    const discontinuity = reading.clock !== null && this.lastClock !== null &&
      (time < this.lastClock - 2 || time - this.lastClock > Math.max(15, gap / 1000 + 5));
    if (discontinuity || reading.replay !== this.replay) {
      // A replay/seek starts a new visible segment, not a ban until the old clock catches up.
      for (const p of this.players.values()) { p.dead = false; p.alive = 0; p.deaths = null; p.counter = undefined; p.counterCredits = 0; }
      this.feed.clear();
    }
    this.replay = reading.replay;
    if (reading.clock !== null) this.lastClock = reading.clock;
    const events: DeathEvent[] = [];
    const samples = reading.layout === 'scene'
      ? match.players.map(p => ({ slot: p.slot, championId: p.championId, dead: null, deaths: undefined, timer: null }))
      : reading.players;
    for (const sample of samples) {
      const player = match.players.find(p => p.slot === sample.slot);
      if (!player?.name || !player.allowBanter) { this.players.delete(sample.slot); continue; }
      let p = this.players.get(sample.slot);
      if (!p) {
        p = { dead: false, alive: 0, deaths: null, lastEventAt: -Infinity, counterCredits: 0 };
        this.players.set(sample.slot, p);
      }
      const evidence: string[] = [];
      const count = sample.deaths;
      const hadCounter = p.deaths !== null;
      let counterAdvanced = false;
      if (count !== undefined && Number.isInteger(count) && count >= 0 && count <= 100) {
        if (p.deaths === null) p.deaths = count; // First count is history, not a new death.
        else if (count > p.deaths) {
          if (p.counter?.value === count && reading.at - p.counter.at <= 5000) {
            const delta = count - p.deaths, covered = Math.min(delta, p.counterCredits);
            if (delta > covered) {
              evidence.push(`KDA死亡增加 ${p.deaths}→${count}（两次确认）`);
              p.dead = true; p.alive = 0;
            }
            p.counterCredits -= covered; p.deaths = count; counterAdvanced = true; p.counter = undefined;
          } else p.counter = { value: count, at: reading.at };
        } else p.counter = undefined;
      }
      let newPhysicalDeath = false;
      if (sample.dead === true) {
        if (!p.dead) { evidence.push(`头像死亡${sample.timer ? ` / 倒计时${sample.timer}` : ''}`); newPhysicalDeath = true; }
        p.dead = true; p.alive = 0;
      } else if (sample.dead === false) {
        // One bright/occluded portrait must not continually rearm the same death.
        if (++p.alive >= 2) p.dead = false;
      }
      const champion = player.locked ? player.championId : sample.championId ?? player.championId;
      // An ambiguous hero-to-player binding or an explicitly alive portrait cannot
      // turn a feed template match into a death of the killer/another player.
      const owners = match.players.filter(other => {
        const s = samples.find(s => s.slot === other.slot);
        return (other.locked ? other.championId : s?.championId ?? other.championId) === champion;
      });
      if (champion && owners.length === 1 && sample.dead !== false && !p.dead && reading.victims.includes(champion) && !this.feed.has(champion)) {
        evidence.push('击杀栏右侧受害者'); newPhysicalDeath = true; p.dead = true; p.alive = 0;
      }
      // A delayed scoreboard update acknowledges the portrait/feed already reported.
      if (newPhysicalDeath && !counterAdvanced && (hadCounter || count === 0)) p.counterCredits++;
      if (evidence.length && now - p.lastEventAt >= BANTER_COOLDOWN_MS) {
        events.push({ id: `${match.seriesId}:${match.game}:${sample.slot}:${++this.serial}`,
          slot: sample.slot, game: match.game, gameSeconds: time, observedAt: reading.at, detectedAt: now,
          source: 'local', evidence: `${reading.layout}${reading.replay ? ' 回放' : ''} ${evidence.join(' / ')}` });
        p.lastEventAt = now;
      }
    }
    this.feed = new Set(reading.victims);
    return events;
  }
}

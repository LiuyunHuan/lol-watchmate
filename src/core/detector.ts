import { DeathEvent, Match, Observation, Slot } from '../shared/types';

/** State transitions require two agreeing frames. Game-clock watermarks reject replays,
 * while per-player death totals suppress scoreboard/replay duplicate observations. */
export class DeathDetector {
  private watermark = -1;
  private players = new Map<Slot, { dead: boolean | null; deaths: number | null; pending: string; count: number; at: number; serial: number }>();
  reset() { this.watermark = -1; this.players.clear(); }
  ingest(observation: Observation, match: Match, at: number, now: number): DeathEvent[] {
    if (observation.phase !== 'live' || observation.gameSeconds === null) return [];
    if (observation.gameSeconds < this.watermark - 1) return [];
    this.watermark = Math.max(this.watermark, observation.gameSeconds);
    const events: DeathEvent[] = [];
    for (const sample of observation.players) {
      const player = match.players.find(p => p.slot === sample.slot);
      if (!player?.name || !player.allowBanter || sample.confidence < 0.88) continue;
      if (sample.dead === null && sample.deaths === null) continue;
      const previous = this.players.get(sample.slot);
      if (!previous) {
        this.players.set(sample.slot, {
          dead: sample.dead, deaths: sample.deaths, pending: '', count: 0, at, serial: 0,
        });
        continue; // attaching mid-game must not announce old deaths
      }
      if (sample.deaths !== null && previous.deaths !== null && sample.deaths < previous.deaths) continue;
      const countUp = sample.deaths !== null && previous.deaths !== null && sample.deaths > previous.deaths;
      const turnedDead = sample.dead === true && previous.dead === false;
      // Stable death counters contradict a grey portrait; prefer the explicit counter.
      const counterContradicts = sample.deaths !== null && previous.deaths !== null && sample.deaths === previous.deaths;
      if (countUp || (turnedDead && !counterContradicts)) {
        const key = countUp ? `count:${sample.deaths}` : 'dead';
        if (previous.pending === key) previous.count++;
        else { previous.pending = key; previous.count = 1; previous.at = at; }
        if (previous.count < 2) continue;
        previous.serial++;
        events.push({
          id: `${match.seriesId}:${match.game}:${sample.slot}:${previous.serial}`,
          slot: sample.slot, game: match.game, gameSeconds: observation.gameSeconds,
          observedAt: previous.at, detectedAt: now, source: 'vision', evidence: sample.evidence,
        });
        previous.dead = true;
        if (sample.deaths !== null) previous.deaths = sample.deaths;
        previous.pending = ''; previous.count = 0;
      } else {
        // Require two live frames before rearming a dead portrait.
        if (sample.dead === false && previous.dead === true) {
          if (previous.pending === 'alive') previous.count++;
          else { previous.pending = 'alive'; previous.count = 1; }
          if (previous.count < 2) continue;
        }
        if (sample.dead !== null) previous.dead = sample.dead;
        if (sample.deaths !== null) previous.deaths = sample.deaths;
        previous.pending = ''; previous.count = 0;
      }
    }
    return events;
  }
  forget(slot: Slot) { this.players.delete(slot); }
}

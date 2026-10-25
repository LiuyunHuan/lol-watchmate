import { BroadcastReading } from '../shared/broadcast';

const fields = ['level', 'kills', 'deaths', 'assists'] as const;
type Field = typeof fields[number];
type Value = { value: number; clock: number };
/** Only numerical scoreboard updates are delayed. Portrait/timer death evidence stays immediate. */
export class ScoreboardStats {
  private confirmed = new Map<string, Value>();
  private pending = new Map<string, { value: number; count: number; at:number }>();
  private clock: number | null = null;
  private at = -Infinity;
  reset() { this.confirmed.clear(); this.pending.clear(); this.clock = null; this.at = -Infinity; }
  ingest(reading: BroadcastReading): BroadcastReading {
    const result = { ...reading, players: reading.players.map(p => ({ ...p })) };
    const omit = () => { for (const p of result.players) for (const f of fields) delete p[f]; return result; };
    if (reading.clock === null || reading.at <= this.at) return omit();
    if (this.clock !== null && (reading.clock < this.clock - 2 || reading.clock > this.clock + 30)) this.reset();
    this.clock = reading.clock; this.at = reading.at;
    for (const p of result.players) for (const field of fields) {
      const key = `${p.slot}:${field}`, value = p[field];
      delete p[field];
      if (value === undefined) { if(reading.at-(this.pending.get(key)?.at??0)>5000)this.pending.delete(key); continue; }
      const old = this.confirmed.get(key);
      if (!this.plausible(field, value, reading.clock, old)) { this.pending.delete(key); continue; }
      const prev = this.pending.get(key);
      const count = prev?.value === value && reading.at-prev.at<=5000 ? prev.count + 1 : 1;
      this.pending.set(key, { value, count, at:reading.at });
      if (count < 2 && old?.value !== value) continue;
      p[field] = value;
      this.confirmed.set(key, { value, clock: old?.value === value ? old.clock : reading.clock });
    }
    return result;
  }
  private plausible(field: Field, value: number, clock: number, old?: Value) {
    if (!Number.isInteger(value) || value < 0) return false;
    // Loose bounds reject obvious OCR joins (e.g. level 16 at six minutes), not strategy assumptions.
    if (field === 'level' && (value < 1 || value > Math.min(30, 3 + Math.floor(clock / 45)))) return false;
    if (field !== 'level' && value > Math.floor(clock / 10) + 5) return false;
    if (!old) return true;
    if (value < old.value) return false;
    const elapsed = clock - old.clock;
    const step = field === 'level' || field === 'deaths' ? 1 : 5;
    return value - old.value <= step + Math.floor(Math.max(0, elapsed) / 30);
  }
}

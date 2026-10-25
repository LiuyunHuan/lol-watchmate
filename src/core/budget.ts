import { Settings, UsageRecord } from '../shared/types';
export function estimateCost(settings: Settings, category: UsageRecord['category'], input: number, output: number, seconds = 0): number | null {
  if (category === 'asr') return settings.asrSecondRate === null ? null : settings.asrSecondRate * seconds;
  if (category === 'search') return settings.searchRate;
  const ir = category === 'text' ? settings.textInputRate : settings.visionInputRate;
  const or = category === 'text' ? settings.textOutputRate : settings.visionOutputRate;
  return ir === null || or === null ? null : (input * ir + output * or) / 1_000_000;
}
export function totals(records: UsageRecord[], now: number) {
  return {
    hourlyCost: records.filter(r => r.at > now - 3600000).reduce((sum, r) => sum + (r.cost ?? 0), 0),
    totalCost: records.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    unpriced: records.filter(r => r.cost === null).length,
  };
}

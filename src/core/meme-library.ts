import { Match, Meme } from '../shared/types';
import { normalize } from './match';

export const memeKey = (m: Pick<Meme, 'kind' | 'target' | 'text'>) =>
  `${m.kind}:${normalize(m.target)}:${normalize(m.text).replace(/[\p{P}\p{Z}]/gu, '')}`;

export function safeCondition(text: string, requested: Meme['condition'] = 'death'): NonNullable<Meme['condition']> {
  if (requested === 'manual-only' || /中路|上路|下路|奎桑提|杀人书|击杀者|参与击杀|单杀|越塔|送塔/.test(text)) return 'manual-only';
  if (requested === 'four-allies-alive' || /四.{0,8}队友.{0,8}活/.test(text)) return 'four-allies-alive';
  return 'death';
}

/** Old enabled flags and evidence survive migration. IDs are persisted, never array offsets. */
export function migrateMemes(memes: Meme[], id: () => string): Meme[] {
  const seen = new Set<string>();
  return memes.filter(m => {
    const key = memeKey(m); if (seen.has(key)) return false; seen.add(key); return true;
  }).map(m => ({ ...m, id: m.id || id(), review: m.review || 'approved', condition: m.condition || 'death' }));
}

export function playable(m: Meme, match?: Match, slot?: string): boolean {
  if (m.enabled === false || (m.review && m.review !== 'approved') || m.condition === 'manual-only') return false;
  if (m.condition === 'four-allies-alive') {
    const player = match?.players.find(p => p.slot === slot);
    if (!player || !match) return false;
    const allies = match.players.filter(p => p.side === player.side && p.slot !== slot);
    return allies.length === 4 && allies.every(p => p.dead === false);
  }
  return true;
}

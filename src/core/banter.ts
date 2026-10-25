import { playable } from './meme-library';
import { DeathEvent, Match, Meme, Side, Slot } from '../shared/types';
import { normalize } from './match';

export const builtinMemes: Meme[] = [
  { kind: 'player', target: 'TheShy', text: '下雨了。', scene: 'death', sources: [], origin: 'builtin' },
  { kind: 'player', target: 'TheShy', text: '送姜。', scene: 'death', sources: [], origin: 'builtin' },
  { kind: 'team', target: '*', text: '都发狂了。', scene: 'teamfight', sources: [], origin: 'builtin' },
  { kind: 'team', target: '*', text: '干燥，不亏。', scene: 'teamfight', sources: [], origin: 'builtin' },
  { kind: 'player', target: '*', text: '先躺一会儿，队友还在上班。', scene: 'death', sources: [], origin: 'builtin' },
  { kind: 'player', target: '*', text: '回泉水冷静一下，这波先记账。', scene: 'death', sources: [], origin: 'builtin' },
];
export interface BanterPart { text: string; targets: Slot[]; teamTargets: Side[]; sources: Meme['sources']; observedAt: number; }

export function permitted(text: string, targets: Slot[], teamTargets: Side[], match: Match, memes: Meme[]): boolean {
  if (memes.some(m => m.text === text && !playable(m, match, targets[0]))) return false;
  if (targets.some(slot => !match.players.find(p => p.slot === slot)?.allowBanter)) return false;
  if (teamTargets.some(side => !match.teams[side].allowBanter)) return false;
  const phrase = (value: string) => normalize(value).replace(/\p{P}/gu, '');
  const n = phrase(text);
  for (const p of match.players.filter(p => !p.allowBanter && p.name)) {
    if (n.includes(phrase(p.name))) return false;
    for (const meme of memes.filter(m => m.kind === 'player' && normalize(m.target) === normalize(p.name))) {
      if (phrase(meme.text).length >= 2 && n.includes(phrase(meme.text))) return false;
    }
  }
  return true;
}

export function selectBanter(events: DeathEvent[], match: Match, memes: Meme[], rotation: number, fallback=false, lastLines?:ReadonlyMap<string,string>): BanterPart[] {
  const choose=(options:Meme[],key:string)=>{
    const different=options.filter(m=>m.text!==lastLines?.get(key));
    const pool=different.length?different:options;
    return pool[rotation%pool.length];
  };
  const seen = new Set<Slot>();
  const eligible = events.filter(e => {
    const p = match.players.find(p => p.slot === e.slot);
    if (!p?.allowBanter || !p.name || seen.has(e.slot)) return false;
    seen.add(e.slot); return true;
  }).sort((a, b) => match.players.find(p => p.slot === b.slot)!.priority - match.players.find(p => p.slot === a.slot)!.priority);
  if (!eligible.length) return [];
  const results: BanterPart[] = [];
  for (const event of eligible) {
    const player = match.players.find(p => p.slot === event.slot)!;
    const candidates = memes.filter(m => playable(m, match, player.slot) && m.kind === 'player' && normalize(m.target) === normalize(player.name) && m.scene === 'death')
      .filter(m => permitted(m.text, [player.slot], [], match, memes));
    if (!candidates.length) {
      if(fallback){
        const generic=memes.filter(m=>playable(m, match, event.slot)&&m.kind==='player'&&m.target==='*'&&m.scene==='death'&&permitted(m.text,[event.slot],[],match,memes));
        const choice=choose(generic,event.slot);
        if(choice){results.push({text:choice.text,targets:[event.slot],teamTargets:[],sources:choice.sources,observedAt:event.observedAt});break;}
      }
      continue;
    }
    const meme = choose(candidates,player.slot);
    results.push({ text: meme.text, targets: [player.slot], teamTargets: [], sources: meme.sources, observedAt: event.observedAt });
    break;
  }
  if (eligible.length >= 2) {
    // Pick the side with more eligible deaths. A team banter has an explicit team target.
    const counts = { left: 0, right: 0 };
    eligible.forEach(e => counts[match.players.find(p => p.slot === e.slot)!.side]++);
    const side: Side = counts.left >= counts.right ? 'left' : 'right';
    const options = memes.filter(m => playable(m, match) && m.kind === 'team' && (m.target === '*' || normalize(m.target) === normalize(match.teams[side].name)))
      .filter(m => permitted(m.text, [], [side], match, memes));
    if (options.length) {
      const meme = choose(options,'team:'+side);
      results.push({ text: meme.text, targets: [], teamTargets: [side], sources: meme.sources, observedAt: eligible[0].observedAt });
    }
  }
  return results;
}

/** Deliberately small, human-editable Markdown format. No instructions are executed. */
export function parseMemeMarkdown(markdown: string): Meme[] {
  const output: Meme[] = [];
  let kind: 'player' | 'team' | null = null;
  let target = '';
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(选手|队伍)\s*[:：]\s*(.{1,80})$/.exec(raw.trim());
    if (heading) { kind = heading[1] === '选手' ? 'player' : 'team'; target = heading[2].trim(); continue; }
    const item = /^-\s+(.{1,100})$/.exec(raw.trim());
    if (item && kind && target) output.push({
      kind, target, text: item[1], scene: kind === 'player' ? 'death' : 'teamfight', sources: [], origin: 'markdown',
    });
  }
  return output.slice(0, 300);
}

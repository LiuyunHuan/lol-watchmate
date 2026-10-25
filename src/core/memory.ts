import { Match } from '../shared/types';
const clean = (s: string) => s.replace(/[\r\n|]/g, ' ').replace(/<!--|-->/g, '').slice(0, 500);
export function gameSection(match: Match): string {
  return [
    `<!-- game:${match.game}:start -->`, `## 第 ${match.game} 局`,
    '| 队伍 | 选手 | 英雄 | 本局角色与观察 |', '| --- | --- | --- | --- |',
    ...match.players.map(p => `| ${clean(match.teams[p.side].name)} | ${clean(p.name || p.slot)} | ${clean(p.champion || '待确认')} | ${clean(p.style || '证据不足，打法待观察')} |`),
    `<!-- game:${match.game}:end -->`,
  ].join('\n');
}
export function updateMemory(existing: string, match: Match): string {
  const section = gameSection(match);
  const pattern = new RegExp(`<!-- game:${match.game}:start -->[\\s\\S]*?<!-- game:${match.game}:end -->`);
  if (pattern.test(existing)) return existing.replace(pattern, section);
  const header = existing || `# ${clean(match.seriesTitle)}\n\n系列赛 ID：${match.seriesId}\n仅记录本系列赛；英雄选择不等于选手的长期性格。\n`;
  return `${header.trim()}\n\n${section}\n`;
}
export function previousPicks(markdown: string, game: number): Map<string, string> {
  const section = markdown.match(new RegExp(`<!-- game:${game}:start -->([\\s\\S]*?)<!-- game:${game}:end -->`))?.[1] ?? '';
  const result = new Map<string, string>();
  for (const line of section.split('\n')) {
    const cols = line.split('|').map(s => s.trim());
    if (cols.length >= 6 && cols[2] !== '选手' && cols[2] !== '---') result.set(cols[2], cols[3]);
  }
  return result;
}

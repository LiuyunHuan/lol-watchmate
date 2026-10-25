import { Match, Player, roles, Side } from '../shared/types';

export const normalize = (s: string) => s.normalize('NFKC').replace(/[\s._-]/g, '').toLowerCase();
export function starPriority(name: string): number {
  const n = normalize(name);
  if (/theshy|faker|uzi/.test(n)) return 100;
  if (/chovy|jackeylove|bin|knight|rookie|showmaker|canyon|gala|ruler/.test(n)) return 85;
  return 50;
}
export function emptyMatch(seriesId: string, title = '我的 BO5'): Match {
  const players: Player[] = (['left', 'right'] as Side[]).flatMap(side =>
    roles.map(role => ({
      slot: `${side}-${role}` as const, side, role, name: '', champion: '', style: '',
      evidence: '', allowBanter: true, priority: 50, locked: false, dead: null, deaths: null,
    })));
  return {
    seriesId, seriesTitle: title, game: 1, gameSeconds: null, phase: 'unknown',
    patch: '', patchLocked: false, teams: {
      left: { name: '左方队伍', allowBanter: true, locked: false },
      right: { name: '右方队伍', allowBanter: true, locked: false },
    }, bans: { left: [], right: [] }, bansLocked: false, players, situation: '', lastFrameAt: null,
  };
}
export function demoMatch(id: string): Match {
  const match = emptyMatch(id, '演示系列赛 · 不代表真实赛程');
  const names = ['TheShy', 'Tian', 'Rookie', 'JackeyLove', 'Meiko', 'Bin', 'Wei', 'knight', 'Elk', 'ON'];
  const champs = ['奥恩', '蔚', '发条魔灵', '霞', '洛', '剑姬', '赵信', '阿狸', '卡莎', '泰坦'];
  match.players.forEach((p, i) => {
    p.name = names[i]; p.champion = champs[i]; p.priority = starPriority(p.name); p.dead = false; p.deaths = 0;
    p.style = i === 0 ? '本局选择坦克，承担前排任务（演示）' : '打法待观察';
  });
  match.teams.left.name = '蓝方'; match.teams.right.name = '红方';
  match.phase = 'live'; match.gameSeconds = 892;
  match.situation = '演示画面：蓝方下路河道集结，红方上路带线。阵容与比赛均为演示，不代表真实对局。';
  return match;
}

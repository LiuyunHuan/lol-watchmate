import { z } from 'zod';
import type { LocalProfile, LocalReading } from './local';
import type { BroadcastReading, DraftPick } from './broadcast';
import type { Rect } from './local';

export const sides = ['left', 'right'] as const;
export type Side = typeof sides[number];
export const roles = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
export type Role = typeof roles[number];
export type Slot = `${Side}-${Role}`;
export const slots = sides.flatMap(side => roles.map(role => `${side}-${role}` as Slot));
export const roleLabels: Record<Role, string> = { top: '上单', jungle: '打野', mid: '中单', adc: '下路', support: '辅助' };
export const slotSchema = z.enum(slots as [Slot, ...Slot[]]);
export const sourceSchema = z.object({
  title: z.string().max(200), url: z.string().url().max(2000),
  publishedAt: z.string().optional(), snippet: z.string().max(8000).optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export interface Player {
  slot: Slot; side: Side; role: Role; name: string; champion: string;
  style: string; evidence: string; allowBanter: boolean; priority: number;
  locked: boolean; dead: boolean | null; deaths: number | null;
  championId?: string; kills?: number; assists?: number; level?: number; localIdentity?: boolean;
}
export interface Match {
  seriesId: string; seriesTitle: string; game: number; gameSeconds: number | null;
  phase: 'unknown' | 'bp' | 'live' | 'replay' | 'ended';
  patch: string; patchLocked: boolean; teams: Record<Side, { name: string; allowBanter: boolean; locked: boolean }>;
  bans: Record<Side, string[]>; bansLocked: boolean; players: Player[]; situation: string; lastFrameAt: number | null;
  draft?: DraftPick[];
}
export interface Message {
  id: string; kind: 'user' | 'answer' | 'banter' | 'system';
  text: string; speech?: string; at: number; game: number; gameSeconds: number | null;
  source: 'demo' | 'vision' | 'user' | 'local' | 'search';
  targets?: Slot[]; teamTargets?: Side[]; sources?: Source[];
  speechStatus?: 'pending' | 'playing' | 'done' | 'skipped' | 'error';
  detectedAt?: number; latencyMs?: number;
}
export interface Meme {
  id?: string;
  review?: 'pending' | 'approved' | 'deleted';
  previousReview?: 'pending' | 'approved';
  condition?: 'death' | 'four-allies-alive' | 'manual-only';
  conditionText?: string;
  evidence?: { quote: string; explanation: string; commentId: string; likes: number | null; publishedAt: string; rewrite: boolean; context: string };
  target: string; kind: 'player' | 'team'; text: string; scene: 'death' | 'teamfight';
  sources: Source[]; origin: 'builtin' | 'markdown' | 'search' | 'manual';
  enabled?: boolean;
}
export const observationSchema = z.object({
  phase: z.enum(['unknown', 'bp', 'live', 'replay', 'ended']),
  gameSeconds: z.number().int().min(0).max(10800).nullable(),
  patch: z.string().max(40).optional(),
  teams: z.object({ left: z.string().max(80), right: z.string().max(80) }).optional(),
  bans: z.object({ left: z.array(z.string().max(50)).max(5), right: z.array(z.string().max(50)).max(5) }).optional(),
  situation: z.string().max(2000),
  players: z.array(z.object({
    slot: slotSchema, name: z.string().max(80).optional(), champion: z.string().max(80).optional(),
    dead: z.boolean().nullable(), deaths: z.number().int().min(0).max(100).nullable(),
    confidence: z.number().min(0).max(1), evidence: z.string().max(300),
    style: z.string().max(120).optional(),
  })).max(10).superRefine((players, ctx) => {
    if (new Set(players.map(p => p.slot)).size !== players.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '每帧同一位置只能出现一次' });
  }),
  danmaku: z.array(z.string().max(160)).max(8).default([]),
});
export type Observation = z.infer<typeof observationSchema>;
export interface DeathEvent {
  id: string; slot: Slot; game: number; gameSeconds: number;
  observedAt: number; detectedAt: number; source: 'demo' | 'vision' | 'local'; evidence: string;
}
export interface SpeechJob {
  id: string; messageId: string; kind: 'answer' | 'banter'; text: string;
  createdAt: number; observedAt?: number; expiresAt: number; targets: Slot[]; teamTargets: Side[];
}
export const settingsSchema = z.object({
  capturePolicyVersion: z.literal(2).default(2),
  baseUrl: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  apiKey: z.string().max(1000).default(''),
  textModel: z.string().min(1).max(120).default('qwen-plus'),
  visionModel: z.string().min(1).max(120).default('qwen3-vl-plus'),
  asrModel: z.string().min(1).max(120).default('qwen3-asr-flash'),
  // Legacy settings are retained solely for migration; no request uses these fields.
  searchUrl: z.string().default(''),
  searchKey: z.string().max(1000).default(''),
  searchModel: z.string().min(1).max(120).default('qwen-plus'),
  searchInputRate: z.number().min(0).nullable().default(null),
  searchOutputRate: z.number().min(0).nullable().default(null),
  qwenSearchRate: z.number().min(0).nullable().default(null),
  captureIntervalMs: z.number().int().min(800).max(60000).default(10000),
  modelTimeoutMs: z.number().int().min(5000).max(120000).default(60000),
  hourlyBudget: z.number().positive().max(10000).default(5),
  textInputRate: z.number().min(0).nullable().default(null),
  textOutputRate: z.number().min(0).nullable().default(null),
  visionInputRate: z.number().min(0).nullable().default(null),
  visionOutputRate: z.number().min(0).nullable().default(null),
  asrSecondRate: z.number().min(0).nullable().default(null),
  searchRate: z.number().min(0).nullable().default(null),
  voice: z.string().max(200).default(''),
  voiceRate: z.number().int().min(-5).max(5).default(1),
  autoLearn: z.boolean().default(false),
  broadcastEnabled: z.boolean().default(true),
  danmakuEnabled: z.boolean().default(true),
  vadThreshold: z.number().min(0.005).max(0.3).default(0.025),
});
export type Settings = z.infer<typeof settingsSchema>;
export type PublicSettings = Omit<Settings, 'apiKey' | 'searchKey'> & { hasApiKey: boolean; hasSearchKey: boolean };
export interface UsageRecord {
  id: string; at: number; category: 'text' | 'vision' | 'asr' | 'search';
  model: string; input: number; output: number; seconds: number;
  cost: number | null; status: 'reported' | 'unknown'; note?: string;
}
export interface Snapshot {
  mode: 'demo' | 'live'; running: boolean; userSpeaking: boolean; answering: boolean;
  match: Match; messages: Message[]; settings: PublicSettings; memes: Meme[];
  memory: string; usage: UsageRecord[]; hourlyCost: number; totalCost: number; unpriced: number;
  budgetAlert: boolean; frameBusy: boolean; learning: boolean;
  searchProgress?: string[];
  visionRetryAt: number; visionError: string | null;
  localProfile: LocalProfile | null; localArmed: boolean; localStatus: string;
  localFrames: number; localLatencyMs: number | null;
  broadcast: BroadcastReading | null; viewport: Rect | null;
  questionFrameRequest: { id: string; requestedAt: number } | null;
  captureSource: string | null; dataDir: string;
  speech: SpeechJob | null;
  metrics: { frames: number; deaths: number; replayFrames: number; errors: number; lastVisionMs: number | null; };
}
export type Action =
  | { type: 'start'; mode: 'demo' | 'live' }
  | { type: 'pause' }
  | { type: 'question'; text: string }
  | { type: 'player'; slot: Slot; patch: Partial<Pick<Player, 'name' | 'champion' | 'allowBanter' | 'priority' | 'style' | 'locked'>> }
  | { type: 'team'; side: Side; name?: string; allowBanter?: boolean; protect?: boolean }
  | { type: 'context'; patch?: string; bans?: Record<Side, string[]>; seriesTitle?: string }
  | { type: 'speaking'; value: boolean }
  | { type: 'speech'; id: string; event: 'started' | 'done' | 'error'; error?: string }
  | { type: 'demo'; event: 'death' | 'teamfight' | 'replay' | 'bp' | 'budget' }
  | { type: 'finish-game' }
  | { type: 'next-game' }
  | { type: 'new-series'; title: string }
  | { type: 'meme-search'; players: { name: string; team: string; focus: boolean }[]; cutoff: string }
  | { type: 'meme-cancel' }
  | { type: 'meme-toggle'; id: string; enabled: boolean }
  | { type: 'meme-save'; id?: string; target: string; text: string; kind: 'player' | 'team'; condition?: 'death' | 'four-allies-alive' | 'manual-only' }
  | { type: 'meme-review'; ids: string[]; operation: 'approve' | 'delete' | 'restore' }
  | { type: 'broadcast-area'; rect: Rect | null }
  | { type: 'broadcast-reset' }
  | { type: 'draft-pick'; side: Side; position: number; championId: string; order: number | null }
  | { type: 'local-arm'; value: boolean }
  | { type: 'ack-budget' };

export interface Bridge {
  snapshot(): Promise<Snapshot>;
  action(action: Action): Promise<void>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  settings(settings: Settings): Promise<void>;
  sources(): Promise<{ id: string; name: string; thumbnail: string }[]>;
  selectSource(id: string): Promise<void>;
  frame(frame: { image: string; at: number }): Promise<void>;
  localProfile(profile: LocalProfile): Promise<void>;
  localReading(reading: LocalReading): Promise<void>;
  broadcast(reading: BroadcastReading): Promise<void>;
  questionFrame(frame: { id: string; image: string | null; at: number }): Promise<void>;
  transcribe(audio: { wav: string; seconds: number }): Promise<void>;
  audio(job: { text: string }): Promise<string>;
  importMemes(): Promise<void>;
  openData(): Promise<void>;
  exportDiagnostics(): Promise<void>;
  openUrl(url: string): Promise<void>;
  voices(): Promise<{ name: string; culture: string }[]>;
}

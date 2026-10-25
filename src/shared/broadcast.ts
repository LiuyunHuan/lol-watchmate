import { z } from 'zod';
import { slotSchema } from './types';
import { rectSchema } from './local';
export const broadcastSchema=z.object({
  at:z.number().finite(), elapsedMs:z.number().min(0).max(120000),
  layout:z.enum(['unknown','scoreboard','compact','scene','bp']), status:z.string().max(300),
  clock:z.number().int().min(0).max(10800).nullable(), replay:z.boolean(),
  players:z.array(z.object({slot:slotSchema,championId:z.string().max(60).optional(),confidence:z.number().min(0).max(1),
    name:z.string().max(60).optional(),identitySource:z.enum(['image','cached','draft-elimination']).optional(), dead:z.boolean().nullable(),timer:z.number().int().min(1).max(99).nullable(),
    kills:z.number().int().min(0).max(100).optional(),deaths:z.number().int().min(0).max(100).optional(),assists:z.number().int().min(0).max(100).optional(),level:z.number().int().min(1).max(30).optional(),
  })).max(10),
  picks:z.array(z.object({side:z.enum(['left','right']),position:z.number().int().min(1).max(5),championId:z.string().max(60),confidence:z.number().min(0).max(1)})).max(10),
  victims:z.array(z.string().max(60)).max(5),teams:z.object({left:z.string().max(40),right:z.string().max(40)}).optional(),
});
export type BroadcastReading=z.infer<typeof broadcastSchema>;
export interface DraftPick {side:'left'|'right';position:number;championId:string;order:number|null;locked:boolean;}
export const viewportSchema=rectSchema.nullable();

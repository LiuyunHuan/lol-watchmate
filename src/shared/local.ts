import { z } from 'zod';
import { slotSchema } from './types';

export const rectSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().positive().max(1), h: z.number().positive().max(1) })
  .refine(r => r.x + r.w <= 1.001 && r.y + r.h <= 1.001, '区域超出画面');
export type Rect = z.infer<typeof rectSchema>;
export const featureSchema = z.object({
  saturation: z.number().min(0).max(1), light: z.number().min(0).max(255),
  pattern: z.array(z.number().min(0).max(255)).length(64),
});
export type Feature = z.infer<typeof featureSchema>;
export const localProfileSchema = z.object({
  id: z.string().uuid(), width: z.number().int().min(100).max(10000), height: z.number().int().min(100).max(10000),
  clock: rectSchema,
  replay: rectSchema.optional(),
  portraits: z.array(z.object({ slot: slotSchema, name: z.string().min(1).max(80), rect: rectSchema, alive: featureSchema })).min(1).max(10),
}).refine(p => new Set(p.portraits.map(p => p.slot)).size === p.portraits.length, '选手区域不能重复');
export type LocalProfile = z.infer<typeof localProfileSchema>;
export const localReadingSchema = z.object({
  profileId: z.string().uuid(), at: z.number().finite(), elapsedMs: z.number().min(0).max(120000),
  clock: z.number().int().min(0).max(10800).nullable(), clockConfidence: z.number().min(0).max(100),
  samples: z.array(z.object({ slot: slotSchema, feature: featureSchema,
    timer: z.number().int().min(1).max(99).nullable(), timerConfidence: z.number().min(0).max(100) })).max(10),
  error: z.string().max(200).optional(),
  replay: z.boolean().default(false),
}).refine(p => new Set(p.samples.map(p => p.slot)).size === p.samples.length);
export type LocalReading = z.infer<typeof localReadingSchema>;

import { z } from 'zod';

export const runResultSchema = z.object({
  model: z.string(),
  durationMs: z.number(),
  failedToolCalls: z.number(),
});

export type RunResult = z.infer<typeof runResultSchema>;

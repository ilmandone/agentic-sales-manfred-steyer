import { z } from 'zod';

export const RETURN_TOOL_RESULT_TO_MODEL = z
  .enum(['model_decides', 'full', 'minimal'])
  .default('model_decides')
  .parse(process.env.RETURN_TOOL_RESULT_TO_MODEL || undefined);

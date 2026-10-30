import type { AgentExecutionOptions } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { z } from 'zod';

export const MAX_ROWS = 1000;

export const MAX_STEPS = 8;

export const MAX_OUTPUT_TOKENS = 4096;

const MODEL_PROVIDER = z
  .enum(['ollama', 'cloudflare'])
  .default('ollama')
  .parse(process.env.MODEL_PROVIDER || undefined);

const THINKING = process.env.MODEL_THINKING === 'true';

const models: Record<typeof MODEL_PROVIDER, OpenAICompatibleConfig> = {
  ollama: {
    providerId: 'ollama',
    modelId: process.env.OLLAMA_MODEL ?? 'gemma4:12b-it-q8_0',
    url: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
  },
  cloudflare: {
    id: 'cloudflare-workers-ai/@cf/google/gemma-4-26b-a4b-it',
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
  },
};

const thinkingOptions = {
  ollama: { ollama: THINKING ? {} : { reasoningEffort: 'none' } },
  cloudflare: {
    'cloudflare-workers-ai': {
      chat_template_kwargs: { enable_thinking: THINKING },
    },
  },
};

export const MODEL = models[MODEL_PROVIDER];

export const DEFAULT_OPTIONS: AgentExecutionOptions<undefined> = {
  maxSteps: MAX_STEPS,
  modelSettings: {
    temperature: Number(process.env.MODEL_TEMPERATURE ?? 0),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  },
  providerOptions: thinkingOptions[MODEL_PROVIDER],
};

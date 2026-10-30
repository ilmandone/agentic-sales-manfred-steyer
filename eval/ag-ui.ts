import { randomUUID } from 'node:crypto';

export const AGENT_URL = process.env.AGENT_URL ?? 'http://127.0.0.1:4111';

const TIMEOUT_MS = 180_000;

export type AgentId = 'salesAgent' | 'dashboardAgent';

export interface Tool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ToolCall {
  name: string;
  args: unknown;
  result?: unknown;
}

export interface RunResult {
  model?: string;
  durationMs?: number;
  failedToolCalls?: number;
}

export interface Trace {
  toolCalls: ToolCall[];
  text: string;
  state: unknown;
  runResult: RunResult;
  error?: string;
}

interface AgUiEvent {
  type: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  content?: string;
  snapshot?: unknown;
  result?: RunResult;
  message?: string;
}

export async function runConversation(
  agentId: AgentId,
  prompts: string[],
  tools: Tool[],
): Promise<Trace[]> {
  const threadId = randomUUID();
  const traces: Trace[] = [];
  let state: unknown = { items: [] };
  for (const prompt of prompts) {
    const trace = await runAgent(agentId, threadId, prompt, tools, state);
    traces.push(trace);
    state = trace.state;
  }
  return traces;
}

async function runAgent(
  agentId: AgentId,
  threadId: string,
  prompt: string,
  tools: Tool[],
  state: unknown,
): Promise<Trace> {
  const response = await fetch(`${AGENT_URL}/ag-ui/${agentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      threadId,
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: 'user', content: prompt }],
      tools,
      context: [],
      state,
      forwardedProps: {},
    }),
  });
  const body = await response.text();
  const events = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)) as AgUiEvent);
  return toTrace(events, state);
}

function toTrace(events: AgUiEvent[], state: unknown): Trace {
  const trace: Trace = { toolCalls: [], text: '', state, runResult: {} };
  const calls = new Map<string, ToolCall>();
  const args = new Map<string, string>();
  for (const event of events) {
    const id = event.toolCallId ?? '';
    switch (event.type) {
      case 'TOOL_CALL_START': {
        const call: ToolCall = { name: event.toolCallName ?? '', args: {} };
        calls.set(id, call);
        trace.toolCalls.push(call);
        break;
      }
      case 'TOOL_CALL_ARGS':
        args.set(id, (args.get(id) ?? '') + (event.delta ?? ''));
        break;
      case 'TOOL_CALL_END':
        updateCall(calls, id, { args: parseJson(args.get(id) ?? '') });
        break;
      case 'TOOL_CALL_RESULT':
        updateCall(calls, id, { result: parseJson(event.content ?? '') });
        break;
      case 'TEXT_MESSAGE_CONTENT':
        trace.text += event.delta ?? '';
        break;
      case 'STATE_SNAPSHOT':
        trace.state = event.snapshot;
        break;
      case 'RUN_FINISHED':
        trace.runResult = event.result ?? {};
        break;
      case 'RUN_ERROR':
        trace.error = event.message;
        break;
    }
  }
  return trace;
}

function updateCall(
  calls: Map<string, ToolCall>,
  id: string,
  update: Partial<ToolCall>,
): void {
  const call = calls.get(id);
  if (call) {
    Object.assign(call, update);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

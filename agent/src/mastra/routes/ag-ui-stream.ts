import {
  EventType,
  type AbstractAgent,
  type BaseEvent,
  type RunAgentInput,
  type RunFinishedEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/client';
import { isValidationError } from '@mastra/core/tools';
import type { RunResult } from '@shared/run-result-schema';
import { coalesceDeltas } from './coalesce-deltas';
import type { SseWriter } from './route-utils';

interface RunTracking {
  model: string;
  started: number;
  clientTools: Set<string>;
  openToolCalls: Set<string>;
}

export async function streamAgentEvents(
  sse: SseWriter,
  agent: AbstractAgent,
  input: RunAgentInput,
  model: string,
): Promise<void> {
  const tracking: RunTracking = {
    model,
    started: Date.now(),
    clientTools: new Set(input.tools.map((tool) => tool.name)),
    openToolCalls: new Set(),
  };
  const send = coalesceDeltas((event: BaseEvent) =>
    sse.writeSSE({ data: JSON.stringify(event) }),
  );

  try {
    await agent.runAgent(input, {
      onEvent: ({ event }) => {
        trackToolCall(event, tracking);
        return send(withRunResult(event, tracking));
      },
    });
  } catch (err) {
    await send({
      type: EventType.RUN_ERROR,
      message: err instanceof Error ? err.message : String(err),
      code: 'run_error',
    } as BaseEvent).catch(() => undefined);
  }
}

function trackToolCall(event: BaseEvent, tracking: RunTracking): void {
  if (isToolCallStart(event) && !tracking.clientTools.has(event.toolCallName)) {
    tracking.openToolCalls.add(event.toolCallId);
  }
  if (isToolCallResult(event) && !isFailedResult(event)) {
    tracking.openToolCalls.delete(event.toolCallId);
  }
}

function withRunResult(event: BaseEvent, tracking: RunTracking): BaseEvent {
  if (!isRunFinished(event)) {
    return event;
  }
  const interrupted = interruptedToolCalls(event);
  const failed = [...tracking.openToolCalls].filter(
    (id) => !interrupted.has(id),
  );
  const result: RunResult = {
    model: tracking.model,
    durationMs: Date.now() - tracking.started,
    failedToolCalls: failed.length,
  };
  return { ...event, result };
}

function interruptedToolCalls(
  event: RunFinishedEvent,
): Set<string | undefined> {
  const interrupts =
    event.outcome?.type === 'interrupt' ? event.outcome.interrupts : [];
  return new Set(interrupts.map((interrupt) => interrupt.toolCallId));
}

function isFailedResult(event: ToolCallResultEvent): boolean {
  if (typeof event.content !== 'string') {
    return false;
  }
  try {
    return isValidationError(JSON.parse(event.content));
  } catch {
    return false;
  }
}

function isToolCallStart(event: BaseEvent): event is ToolCallStartEvent {
  return event.type === EventType.TOOL_CALL_START;
}

function isToolCallResult(event: BaseEvent): event is ToolCallResultEvent {
  return event.type === EventType.TOOL_CALL_RESULT;
}

function isRunFinished(event: BaseEvent): event is RunFinishedEvent {
  return event.type === EventType.RUN_FINISHED;
}

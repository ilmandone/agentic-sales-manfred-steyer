import { Component, computed, effect, input, signal } from '@angular/core';
import { injectAgentStore } from '@copilotkit/angular';
import { RunResult, runResultSchema } from '@shared/run-result-schema';

@Component({
  selector: 'app-run-info',
  template: `
    @let warningText = warning();
    @if (warningText) {
      <p class="run-warning" role="status">{{ warningText }}</p>
    }
    @let text = label();
    @if (text) {
      <p class="run-info">{{ text }}</p>
    }
  `,
})
export class RunInfo {
  readonly agentId = input.required<string>();

  private readonly store = injectAgentStore(this.agentId);

  private readonly lastRun = signal<RunResult | undefined>(undefined);

  protected readonly label = computed(() => toLabel(this.lastRun()));

  protected readonly warning = computed(() => toWarning(this.lastRun()));

  constructor() {
    effect((onCleanup) => {
      const subscription = this.store().agent.subscribe({
        onRunFinishedEvent: ({ event }) =>
          this.lastRun.set(parseRunResult(event.result)),
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }
}

function parseRunResult(value: unknown): RunResult | undefined {
  const result = runResultSchema.safeParse(value);
  return result.data;
}

function toLabel(run: RunResult | undefined): string | undefined {
  if (!run) {
    return undefined;
  }
  return `${run.model} · ${(run.durationMs / 1000).toFixed(1)} s`;
}

function toWarning(run: RunResult | undefined): string | undefined {
  if (!run || run.failedToolCalls === 0) {
    return undefined;
  }
  const calls = run.failedToolCalls === 1 ? 'tool call' : 'tool calls';
  return `${run.failedToolCalls} ${calls} failed during this answer. Check whether the result is complete.`;
}

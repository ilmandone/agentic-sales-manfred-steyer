import { parseArgs } from 'node:util';
import { runConversation, type Trace } from './ag-ui.ts';
import { cases, salesTools, type EvalCase } from './cases.ts';

interface Outcome {
  failures: string[];
  durationMs: number;
  failedToolCalls: number;
  model?: string;
}

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    case: { type: 'string', default: '' },
  },
});

const runs = Number(values.runs);
const selected = cases.filter((evalCase) =>
  evalCase.name.includes(values.case),
);
let passed = 0;
let total = 0;

console.log(`Running ${selected.length} cases, ${runs} run(s) each\n`);
for (const evalCase of selected) {
  const outcomes: Outcome[] = [];
  for (let i = 0; i < runs; i++) {
    outcomes.push(await runCase(evalCase));
  }
  const ok = outcomes.filter((outcome) => outcome.failures.length === 0).length;
  passed += ok;
  total += outcomes.length;
  console.log(formatRow(evalCase, outcomes, ok));
}
console.log(`\nPassed ${passed}/${total} runs`);

async function runCase(evalCase: EvalCase): Promise<Outcome> {
  const started = Date.now();
  try {
    const tools = evalCase.agent === 'salesAgent' ? salesTools : [];
    const traces = await runConversation(
      evalCase.agent,
      evalCase.prompts,
      tools,
    );
    const errors = traces.flatMap((trace) =>
      trace.error ? [`run error: ${trace.error}`] : [],
    );
    const failures = [...errors, ...(await evalCase.check(traces))];
    return {
      failures,
      durationMs: Date.now() - started,
      failedToolCalls: sumFailedToolCalls(traces),
      model: traces[0]?.runResult.model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      failures: [message],
      durationMs: Date.now() - started,
      failedToolCalls: 0,
    };
  }
}

function sumFailedToolCalls(traces: Trace[]): number {
  return traces.reduce(
    (sum, trace) => sum + (trace.runResult.failedToolCalls ?? 0),
    0,
  );
}

function formatRow(
  evalCase: EvalCase,
  outcomes: Outcome[],
  ok: number,
): string {
  const seconds = outcomes.map((outcome) =>
    (outcome.durationMs / 1000).toFixed(1),
  );
  const failedCalls = sumOf(outcomes.map((outcome) => outcome.failedToolCalls));
  const failures = [
    ...new Set(outcomes.flatMap((outcome) => outcome.failures)),
  ];
  const model = outcomes.find((outcome) => outcome.model)?.model ?? '?';
  return [
    `${ok === outcomes.length ? 'PASS' : ok === 0 ? 'FAIL' : 'PART'} ${ok}/${outcomes.length}  ${evalCase.name}`,
    `     ${model}, ${seconds.join(' / ')} s, failed tool calls: ${failedCalls}`,
    ...failures.slice(0, 3).map((failure) => `     - ${failure}`),
  ].join('\n');
}

function sumOf(numbers: number[]): number {
  return numbers.reduce((sum, n) => sum + n, 0);
}

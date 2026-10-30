import { z } from 'zod';
import {
  barChartDescription,
  barChartSchema,
} from '../src/app/agents/sales/widgets/bar-chart-schema.ts';
import {
  pieChartDescription,
  pieChartSchema,
} from '../src/app/agents/sales/widgets/pie-chart-schema.ts';
import {
  pivotTableDescription,
  pivotTableSchema,
} from '../src/app/agents/sales/widgets/pivot-table-schema.ts';
import type { AgentId, Tool, ToolCall, Trace } from './ag-ui.ts';
import {
  aggregate,
  chartsOf,
  parseQueryResult,
  pointsOf,
  runQuery,
  total,
  type AggregateQuery,
  type Point,
} from './data.ts';

export interface EvalCase {
  name: string;
  agent: AgentId;
  prompts: string[];
  check: (traces: Trace[]) => Promise<string[]>;
}

export const salesTools: Tool[] = [
  {
    name: 'barChart',
    description: barChartDescription,
    parameters: z.toJSONSchema(barChartSchema),
  },
  {
    name: 'pieChart',
    description: pieChartDescription,
    parameters: z.toJSONSchema(pieChartSchema),
  },
  {
    name: 'pivotTable',
    description: pivotTableDescription,
    parameters: z.toJSONSchema(pivotTableSchema),
  },
];

const TOLERANCE = 1;

const OTHER = 'Other';

const NOT_SET = '(not set)';

interface ReferenceRow {
  keys: string[];
  value: number;
}

const revenuePerCategory: AggregateQuery = {
  fact: 'Revenue',
  aggregateFn: 'sum',
  dimensions: ['ItemCategory'],
};

const europeVsAmericas: AggregateQuery = {
  fact: 'Revenue',
  aggregateFn: 'sum',
  dimensions: ['Continent', 'ItemCategory'],
  filter: { Continent: ['Europe', 'Americas'] },
};

const bagsPerContinent: AggregateQuery = {
  fact: 'Revenue',
  aggregateFn: 'sum',
  dimensions: ['Continent'],
  filter: { ItemCategory: 'Bags' },
};

const ordersPerMonth: AggregateQuery = {
  fact: 'TransactionId',
  aggregateFn: 'count_distinct',
  dimensions: ['Month'],
};

const dashboardStateSchema = z.object({
  items: z.array(z.object({ spec: z.unknown() })),
});

const barsArgsSchema = z.object({
  bars: z.array(
    z.object({
      label: z.string(),
      series: z.string().nullish(),
      value: z.number(),
    }),
  ),
});

const slicesArgsSchema = z.object({
  slices: z.array(z.object({ label: z.string(), value: z.number() })),
});

export const cases: EvalCase[] = [
  {
    name: 'dashboard: bar chart per category',
    agent: 'dashboardAgent',
    prompts: ['Show me the revenue per category as a bar chart.'],
    check: async ([trace]) => [
      ...expectCount('runQuery calls', callsOf(trace, 'runQuery').length, 1),
      ...expectPoints(
        'bars',
        shownPoints(trace),
        await referenceOf(revenuePerCategory),
        15,
      ),
    ],
  },
  {
    name: 'dashboard: same request twice',
    agent: 'dashboardAgent',
    prompts: [
      'Show me the revenue per category as a bar chart.',
      'Show me the revenue per category as a bar chart.',
    ],
    check: async (traces) =>
      traces.flatMap((trace, i) =>
        expectCount(`charts in answer ${i + 1}`, shownCharts(trace).length, 1),
      ),
  },
  {
    name: 'dashboard: compare two continents',
    agent: 'dashboardAgent',
    prompts: [
      'Compare Europe and the Americas regarding the revenue per category as a bar chart.',
    ],
    check: async ([trace]) => [
      ...expectCount('runQuery calls', callsOf(trace, 'runQuery').length, 1),
      ...expectPoints(
        'bars',
        shownPoints(trace),
        await referenceOf(europeVsAmericas),
        5,
      ),
    ],
  },
  {
    name: 'dashboard: one pie chart per continent',
    agent: 'dashboardAgent',
    prompts: [
      'Show me one pie chart per continent. Each chart should show the revenue of the products in the Bags category.',
    ],
    check: async ([trace]) =>
      expectTotals(
        'chart totals',
        shownCharts(trace).map((chart) => total(pointsOf(chart))),
        await referenceTotals(bagsPerContinent),
      ),
  },
  {
    name: 'dashboard: orders per month',
    agent: 'dashboardAgent',
    prompts: ['How many orders were placed per month?'],
    check: async ([trace]) => [
      ...expectPoints(
        'bars',
        shownPoints(trace),
        await referenceOf(ordersPerMonth),
        3,
      ),
      ...expectText(trace, /1[,.]?714/, 'the orders of 2020-11 (1,714)'),
    ],
  },
  {
    name: 'dashboard: peak week',
    agent: 'dashboardAgent',
    prompts: ['In which week was the revenue peak?'],
    check: async ([trace]) => expectText(trace, /W50/, 'the week 2020-W50'),
  },
  {
    name: 'dashboard: add comparison',
    agent: 'dashboardAgent',
    prompts: [
      'Add a bar chart to the dashboard that compares Europe and the Americas regarding the revenue per category.',
    ],
    check: async ([trace]) => {
      const charts = await dashboardCharts(trace);
      return [
        ...expectCount('dashboard charts', charts.length, 1),
        ...expectPoints(
          'bars',
          charts.flatMap(pointsOf),
          await referenceOf(europeVsAmericas),
          5,
        ),
      ];
    },
  },
  {
    name: 'dashboard: add one pie chart per continent',
    agent: 'dashboardAgent',
    prompts: [
      'Add one pie chart per continent to the dashboard. Each chart should show the revenue of the products in the Bags category.',
    ],
    check: async ([trace]) => {
      const charts = await dashboardCharts(trace);
      return expectTotals(
        'chart totals',
        charts.map((chart) => total(pointsOf(chart))),
        await referenceTotals(bagsPerContinent),
      );
    },
  },
  {
    name: 'sales: bar chart per category',
    agent: 'salesAgent',
    prompts: ['Show me the revenue per category as a bar chart.'],
    check: async ([trace]) =>
      expectPoints(
        'bars',
        argPoints(trace, 'barChart'),
        await referenceOf(revenuePerCategory),
        15,
      ),
  },
  {
    name: 'sales: compare two continents',
    agent: 'salesAgent',
    prompts: [
      'Compare Europe and the Americas regarding the revenue per category as a bar chart.',
    ],
    check: async ([trace]) =>
      expectPoints(
        'bars',
        argPoints(trace, 'barChart'),
        await referenceOf(europeVsAmericas),
        5,
      ),
  },
  {
    name: 'sales: one pie chart per continent',
    agent: 'salesAgent',
    prompts: [
      'Show me one pie chart per continent. Each chart should show the revenue of the products in the Bags category.',
    ],
    check: async ([trace]) =>
      expectTotals(
        'chart totals',
        callsOf(trace, 'pieChart').map((call) => total(slicesOf(call))),
        await referenceTotals(bagsPerContinent),
      ),
  },
];

function callsOf(trace: Trace, name: string): ToolCall[] {
  return trace.toolCalls.filter((call) => call.name === name);
}

function shownCharts(trace: Trace) {
  return callsOf(trace, 'runQuery').flatMap((call) =>
    chartsOf(parseQueryResult(call.result)),
  );
}

function shownPoints(trace: Trace): Point[] {
  return shownCharts(trace).flatMap(pointsOf);
}

function argPoints(trace: Trace, name: string): Point[] {
  return callsOf(trace, name).flatMap((call) => {
    const result = barsArgsSchema.safeParse(call.args);
    return result.data?.bars ?? [];
  });
}

function slicesOf(call: ToolCall): Point[] {
  const result = slicesArgsSchema.safeParse(call.args);
  return result.data?.slices ?? [];
}

async function dashboardCharts(trace: Trace) {
  const parsed = dashboardStateSchema.safeParse(trace.state);
  const items = parsed.data?.items ?? [];
  const results = await Promise.all(items.map((item) => runQuery(item.spec)));
  return results.flatMap(chartsOf);
}

async function referenceOf(query: AggregateQuery): Promise<ReferenceRow[]> {
  const rows = await aggregate(query);
  return rows.map((row) => ({
    keys: query.dimensions.map((dimension) => String(row[dimension])),
    value: Number(row.value),
  }));
}

async function referenceTotals(query: AggregateQuery): Promise<number[]> {
  const rows = await aggregate(query);
  return rows
    .filter((row) => row[query.dimensions[0]] !== '(not set)')
    .map((row) => Number(row.value));
}

function expectCount(what: string, actual: number, expected: number): string[] {
  return actual === expected
    ? []
    : [`${what}: ${actual} instead of ${expected}`];
}

function expectPoints(
  what: string,
  points: Point[],
  reference: ReferenceRow[],
  minCount: number,
): string[] {
  const wrong = points.filter(
    (point) =>
      !expectedValues(point, points, reference).some(
        (expected) => Math.abs(expected - point.value) <= TOLERANCE,
      ),
  );
  return [
    ...(points.length < minCount
      ? [`${what}: ${points.length} instead of at least ${minCount}`]
      : []),
    ...wrong
      .slice(0, 2)
      .map(
        (point) =>
          `${what}: ${point.label}|${point.series ?? ''} = ${point.value} is wrong`,
      ),
  ];
}

function expectedValues(
  point: Point,
  points: Point[],
  reference: ReferenceRow[],
): number[] {
  const keys = keysOf(point);
  if (!keys.includes(OTHER)) {
    const row = reference.find((r) => sameKeys(r.keys, keys));
    return row ? [row.value] : [];
  }
  const group = keys.filter((key) => key !== OTHER);
  const listed = points.map(keysOf).filter((k) => !k.includes(OTHER));
  const rest = reference.filter(
    (row) =>
      group.every((key) => row.keys.includes(key)) &&
      !listed.some((k) => sameKeys(row.keys, k)),
  );
  const withoutNotSet = rest.filter((row) => !row.keys.includes(NOT_SET));
  return [sumOf(rest), sumOf(withoutNotSet)];
}

function keysOf(point: Point): string[] {
  return point.series ? [point.label, point.series] : [point.label];
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

function sumOf(rows: ReferenceRow[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

function expectTotals(
  what: string,
  actual: number[],
  expected: number[],
): string[] {
  const sortedActual = [...actual].sort((a, b) => a - b);
  const sortedExpected = [...expected].sort((a, b) => a - b);
  const matches =
    sortedActual.length === sortedExpected.length &&
    sortedActual.every(
      (value, i) => Math.abs(value - sortedExpected[i]) <= TOLERANCE,
    );
  return matches
    ? []
    : [
        `${what}: [${sortedActual.map(Math.round).join(', ')}] instead of [${sortedExpected.map(Math.round).join(', ')}]`,
      ];
}

function expectText(trace: Trace, pattern: RegExp, what: string): string[] {
  return pattern.test(trace.text) ? [] : [`answer doesn't mention ${what}`];
}

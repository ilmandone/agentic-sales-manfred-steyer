import {
  queryResultSchema,
  type ChartResult,
  type QueryResult,
} from '../shared/query-schema.ts';
import { AGENT_URL } from './ag-ui.ts';

const AGG_SERVER_URL = process.env.AGG_SERVER_URL ?? 'http://127.0.0.1:3000';

export type Row = Record<string, string | number>;

export interface AggregateQuery {
  fact: string;
  aggregateFn: 'sum' | 'avg' | 'count' | 'count_distinct';
  dimensions: string[];
  filter?: Record<string, string | string[]>;
}

export interface Point {
  label: string;
  series?: string | null;
  value: number;
}

export async function aggregate(query: AggregateQuery): Promise<Row[]> {
  const response = await fetch(`${AGG_SERVER_URL}/aggregate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      Fact: query.fact,
      AggregateFn: query.aggregateFn,
      Dimensions: query.dimensions,
      Filter: query.filter ?? {},
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Aggregation server: ${payload.error}`);
  }
  return payload.rows;
}

export async function runQuery(
  spec: unknown,
): Promise<QueryResult | undefined> {
  const response = await fetch(
    `${AGENT_URL}/api/agents/dashboardAgent/tools/run-query/execute`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { spec, purpose: 'show' } }),
    },
  );
  const payload: unknown = await response.json();
  return parseQueryResult(payload);
}

export function parseQueryResult(value: unknown): QueryResult | undefined {
  const result = queryResultSchema.safeParse(value);
  return result.data;
}

export function chartsOf(result: QueryResult | undefined): ChartResult[] {
  if (!result || result.kind === 'message') {
    return [];
  }
  return result.kind === 'split' ? result.charts : [result];
}

export function pointsOf(chart: ChartResult): Point[] {
  switch (chart.kind) {
    case 'barChart':
      return chart.data.bars;
    case 'pieChart':
      return chart.data.slices;
    case 'pivotTable':
      return chart.data.cells.map((cell) => ({
        label: cell.row,
        series: cell.column,
        value: cell.value,
      }));
  }
}

export function total(points: Point[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

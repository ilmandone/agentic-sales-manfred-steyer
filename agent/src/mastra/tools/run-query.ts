import {
  createTool,
  isValidationError,
  type ValidationError,
} from '@mastra/core/tools';
import {
  barsSchema,
  cellsSchema,
  queryResultSchema,
  querySchema,
  slicesSchema,
  type ChartResult,
  type Query,
  type QueryMessage,
  type QueryResult,
} from '@shared/query-schema';
import { z } from 'zod';
import { RETURN_TOOL_RESULT_TO_MODEL } from '../feature-flags';
import {
  EmptyResultError,
  evaluateExpression,
  jsonataDescription,
  jsonataLimitsDescription,
} from './evaluate-jsonata';
import {
  approvalResumeSchema,
  approvalSuspendSchema,
  type ApprovalContext,
} from './row-limit';
import { aggregate, type Filter, type FilterScalar } from './sales/sales-api';

const MAX_SPLIT_VALUES = 12;

const NOT_SET = '(not set)';

const shapeExamples = {
  barChart: '[{ "label": "2020-W50", "value": 59842 }]',
  pieChart: '[{ "label": "Apparel", "value": 171727 }]',
  pivotTable: '[{ "row": "2020-12", "column": "mobile", "value": 60423 }]',
};

type Row = Record<string, FilterScalar>;

const specInputSchema = z.object({ spec: querySchema });

const purposeSchema = z.enum(['show', 'answer']).describe(`
  "show" if the user only asks to see the data, e.g. "show the revenue per month": you
  don't get them. "answer" if the user asks about the values, e.g. "in which week was
  the peak?": the tool returns the data for your answer.
`);

const purposeInputSchema = specInputSchema.extend({ purpose: purposeSchema });

const runQueryInputSchema = specInputSchema.extend({
  purpose: purposeSchema.optional(),
});

type RunQueryInput = z.infer<typeof runQueryInputSchema>;

const runQueryOutputSchema = queryResultSchema.and(
  z.object({ returnData: z.boolean() }),
);

type RunQueryOutput = z.infer<typeof runQueryOutputSchema>;

export const runQuery = createTool({
  id: 'run-query',
  description: `
    Shows the result of a query to the user as a bar chart, pie chart or pivot table,
    depending on its kind: evaluates its JSONata expression. Calling it is what displays
    the chart, in the current answer only: when the user asks for a chart again, call it
    again, even with the same arguments.
    ${jsonataDescription}
    ${jsonataLimitsDescription}
  `,
  inputSchema:
    RETURN_TOOL_RESULT_TO_MODEL === 'model_decides'
      ? purposeInputSchema
      : specInputSchema,
  outputSchema: runQueryOutputSchema,
  suspendSchema: approvalSuspendSchema,
  resumeSchema: approvalResumeSchema,
  execute: async (input, context) => {
    const returnData = returnsData(input);
    try {
      const result = await evaluateQuery(input.spec, context);
      return { ...result, returnData };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: 'message' as const,
        status: 'failed' as const,
        message,
        returnData,
      };
    }
  },
  toModelOutput,
});

function returnsData(input: RunQueryInput): boolean {
  switch (RETURN_TOOL_RESULT_TO_MODEL) {
    case 'full':
      return true;
    case 'minimal':
      return false;
    case 'model_decides':
      return input.purpose === 'answer';
  }
}

function toModelOutput(output: RunQueryOutput | ValidationError) {
  if (isValidationError(output)) {
    return { type: 'json', value: output };
  }
  const { returnData, ...result } = output;
  if (result.kind === 'message' && result.status === 'failed') {
    return {
      type: 'text',
      value: `No visualization was shown to the user: ${result.message}`,
    };
  }
  if (returnData || result.kind === 'message') {
    return { type: 'json', value: result };
  }
  return { type: 'text', value: toShownNote(result) };
}

function toShownNote(result: Exclude<QueryResult, { kind: 'message' }>) {
  if (result.kind === 'split') {
    return (
      `${result.charts.length} visualizations, one per ${result.splitBy}, were shown to the user in this answer. ` +
      'Their data are not part of this result: never mention any values from them. ' +
      'They are not visible in later answers: show them again with a new runQuery call when asked.'
    );
  }
  return (
    `The visualization "${result.data.title}" was shown to the user in this answer. ` +
    'Its data are not part of this result: never mention any values from it. ' +
    'It is not visible in later answers: show it again with a new runQuery call when asked.'
  );
}

export async function evaluateQuery(
  spec: Query,
  context?: ApprovalContext,
): Promise<QueryResult> {
  if (spec.splitBy) {
    return evaluateSplit(spec, spec.splitBy, context);
  }
  return evaluateChart(spec, context);
}

async function evaluateChart(
  spec: Query,
  context?: ApprovalContext,
  filter: Filter = {},
): Promise<ChartResult | QueryMessage> {
  const evaluated = await evaluateExpression(spec.expression, context, filter);
  if (!('result' in evaluated)) {
    return { kind: 'message', ...evaluated };
  }
  if (Array.isArray(evaluated.result) && evaluated.result.length === 0) {
    throw new EmptyResultError(
      'The expression returned no rows. Check the field names and filter values.',
    );
  }
  return toChartResult(spec, evaluated.result);
}

async function evaluateSplit(
  spec: Query,
  splitBy: string,
  context?: ApprovalContext,
): Promise<QueryResult> {
  const { column, values } = await loadSplitValues(splitBy);
  const charts: ChartResult[] = [];
  for (const value of values) {
    const chart = await evaluateSplitChart(
      { ...spec, title: `${spec.title}: ${value}` },
      { [column]: value },
      context,
    );
    if (chart?.kind === 'message') {
      return chart;
    }
    if (chart) {
      charts.push(chart);
    }
  }
  if (charts.length === 0) {
    throw new EmptyResultError(
      `The expression returned nothing for every value of ${column}. Check the field names and filter values.`,
    );
  }
  return { kind: 'split', splitBy: column, charts };
}

async function evaluateSplitChart(
  spec: Query,
  filter: Filter,
  context?: ApprovalContext,
): Promise<ChartResult | QueryMessage | undefined> {
  try {
    return await evaluateChart(spec, context, filter);
  } catch (error) {
    if (error instanceof EmptyResultError) {
      return undefined;
    }
    throw error;
  }
}

async function loadSplitValues(
  splitBy: string,
): Promise<{ column: string; values: FilterScalar[] }> {
  const { dimensions, rows }: { dimensions: string[]; rows: Row[] } =
    await aggregate({
      fact: splitBy,
      aggregateFn: 'count',
      dimensions: [splitBy],
    });
  const column = dimensions[0];
  const values = rows
    .map((row) => row[column])
    .filter((value) => value !== NOT_SET);
  if (values.length > MAX_SPLIT_VALUES) {
    throw new Error(
      `splitBy "${column}" has ${values.length} values, but at most ${MAX_SPLIT_VALUES} ` +
        'charts are possible. Use a column with fewer values.',
    );
  }
  return { column, values };
}

function toChartResult(spec: Query, value: unknown): ChartResult {
  switch (spec.kind) {
    case 'barChart':
      return {
        kind: spec.kind,
        data: {
          title: spec.title,
          valueLabel: spec.valueLabel,
          bars: parseData(barsSchema, value, spec.kind),
        },
      };
    case 'pieChart':
      return {
        kind: spec.kind,
        data: {
          title: spec.title,
          valueLabel: spec.valueLabel,
          slices: parseData(slicesSchema, value, spec.kind),
        },
      };
    case 'pivotTable': {
      const { rowDimension, columnDimension } = spec;
      if (!rowDimension || !columnDimension) {
        throw new Error(
          'A pivotTable needs the spec fields rowDimension and columnDimension, ' +
            'e.g. "rowDimension": "Month", "columnDimension": "DeviceCategory".',
        );
      }
      return {
        kind: spec.kind,
        data: {
          title: spec.title,
          rowDimension,
          columnDimension,
          valueLabel: spec.valueLabel,
          cells: parseData(cellsSchema, value, spec.kind),
        },
      };
    }
  }
}

function parseData<T>(
  schema: z.ZodType<T>,
  value: unknown,
  kind: keyof typeof shapeExamples,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `The expression returned data in the wrong shape for a ${kind}: expected an array ` +
        `like ${shapeExamples[kind]}.\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

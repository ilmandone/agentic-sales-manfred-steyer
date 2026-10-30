import { z } from 'zod';

export const querySchema = z
  .object({
    kind: z.enum(['barChart', 'pieChart', 'pivotTable']),
    title: z.string().describe('Short title, e.g. "Revenue per week"'),
    valueLabel: z
      .string()
      .describe('What the values are, e.g. "Revenue (USD)"'),
    rowDimension: z
      .string()
      .optional()
      .describe('pivotTable only: dimension spanning the rows, e.g. "Month"'),
    columnDimension: z
      .string()
      .optional()
      .describe(
        'pivotTable only: dimension spanning the columns, e.g. "DeviceCategory"',
      ),
    expression: z.string().describe(`
      JSONata expression returning the data, e.g.
      $aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["Week"] }).{ "label": Week, "value": value }
      Several statements need a block: ( $rows := $aggregate({ ... }); $rows.{ "label": Week, "value": value }[] )
      The shape of the data depends on the kind:
      barChart: one bar per aggregate row, e.g. [{ "label": "2020-W50", "value": 59842 }].
        With a second dimension, add its value as series:
        { "label": "Apparel", "series": "Europe", "value": 21530 }. The bars are grouped
        per label with one color per series, at most 8.
      pieChart: one slice per aggregate row, e.g. [{ "label": "Apparel", "value": 171727 }].
        Only for shares of a whole (sum or count, never avg): at most 8 slices, combine
        the smallest ones into a slice named "Other".
      pivotTable: one cell per aggregate row, e.g.
        [{ "row": "2020-12", "column": "mobile", "value": 60423 }]
    `),
    splitBy: z.string().optional().describe(`
      Column for one chart per value, e.g. "Continent" for one pie chart per continent.
      The expression then computes the data of one chart: it runs once per value, with
      the value as an additional filter. Leave it out for a single chart.
    `),
  })
  .describe(
    'Kind, labels and the JSONata expression that computes the data of the visualization',
  );

export type Query = z.infer<typeof querySchema>;

export const barsSchema = z
  .array(
    z.object({
      label: z.string(),
      series: z.string().nullish(),
      value: z.number(),
    }),
  )
  .min(1);

export const slicesSchema = z
  .array(z.object({ label: z.string(), value: z.number() }))
  .min(1);

export const cellsSchema = z
  .array(z.object({ row: z.string(), column: z.string(), value: z.number() }))
  .min(1);

const dataBaseSchema = z.object({ title: z.string(), valueLabel: z.string() });

const barChartResultSchema = z.object({
  kind: z.literal('barChart'),
  data: dataBaseSchema.extend({ bars: barsSchema }),
});

const pieChartResultSchema = z.object({
  kind: z.literal('pieChart'),
  data: dataBaseSchema.extend({ slices: slicesSchema }),
});

const pivotTableResultSchema = z.object({
  kind: z.literal('pivotTable'),
  data: dataBaseSchema.extend({
    rowDimension: z.string(),
    columnDimension: z.string(),
    cells: cellsSchema,
  }),
});

export const chartResultSchema = z.discriminatedUnion('kind', [
  barChartResultSchema,
  pieChartResultSchema,
  pivotTableResultSchema,
]);

export type ChartResult = z.infer<typeof chartResultSchema>;

const splitResultSchema = z.object({
  kind: z.literal('split'),
  splitBy: z.string(),
  charts: z.array(chartResultSchema).min(1),
});

const queryMessageSchema = z.object({
  kind: z.literal('message'),
  status: z.enum(['awaiting-approval', 'declined', 'failed']),
  message: z.string(),
});

export type QueryMessage = z.infer<typeof queryMessageSchema>;

export const queryResultSchema = z.discriminatedUnion('kind', [
  barChartResultSchema,
  pieChartResultSchema,
  pivotTableResultSchema,
  splitResultSchema,
  queryMessageSchema,
]);

export type QueryResult = z.infer<typeof queryResultSchema>;

import { z } from 'zod';

const barSchema = z.object({
  label: z.string(),
  series: z
    .string()
    .nullish()
    .describe('Value of the second dimension for grouped bars, e.g. "Europe"'),
  value: z.number(),
});

export const barChartSchema = z.object({
  title: z.string().describe('Short title, e.g. "Revenue per week"'),
  valueLabel: z.string().describe('What the values are, e.g. "Revenue (USD)"'),
  bars: z.array(barSchema).min(1).describe(`
    One bar per aggregate row, e.g. { "label": "2020-W50", "value": 59842 }. With a second
    dimension, add its value as series: { "label": "Apparel", "series": "Europe", "value": 21530 }
  `),
});

export const barChartDescription = `
  Shows values of one or two dimensions as a bar chart in the chat. Use it for comparisons
  and trends, e.g. revenue per week or per country. For two dimensions, pass the second
  one as series: the bars are grouped per label with one color per series (at most 8).
`;

export type BarChartArgs = z.infer<typeof barChartSchema>;

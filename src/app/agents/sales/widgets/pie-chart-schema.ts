import { z } from 'zod';

const sliceSchema = z.object({ label: z.string(), value: z.number() });

export const pieChartSchema = z.object({
  title: z.string().describe('Short title, e.g. "Revenue share per category"'),
  valueLabel: z.string().describe('What the values are, e.g. "Revenue (USD)"'),
  slices: z
    .array(sliceSchema)
    .min(1)
    .describe(
      'One slice per aggregate row, e.g. { "label": "Apparel", "value": 171727 }',
    ),
});

export const pieChartDescription = `
  Shows shares of a whole (sum or count, never avg) as a pie chart in the chat.
  Use at most 8 slices and combine the smallest ones into a slice named "Other".
`;

export type PieChartArgs = z.infer<typeof pieChartSchema>;

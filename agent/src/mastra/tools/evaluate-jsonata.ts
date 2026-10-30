import { createTool } from '@mastra/core/tools';
import jsonata from 'jsonata';
import { z } from 'zod';
import { MAX_ROWS } from '../config';
import {
  approvalResumeSchema,
  approvalSuspendSchema,
  askForApproval,
  DECLINED,
  isApproved,
  notExecutedSchema,
  rememberApproval,
  type ApprovalContext,
  type NotExecuted,
} from './row-limit';
import {
  aggregate,
  details,
  type AggregateQuery,
  type DetailsQuery,
  type Filter,
} from './sales/sales-api';

const MAX_RESULT_CHARS = 50_000;
const TIMEOUT_MS = 30_000;

const BLOCK_HINT =
  'Several statements need a block in parentheses: ( $a := 1; $b := 2; $a + $b )';

export const jsonataDescription = `
    Functions:
      \`$aggregate({ "fact", "aggregateFn", "dimensions", "filter" })\` returns rows like
        \`{ "Country": "Germany", "value": 123.4 }\`. "aggregateFn" is "sum", "avg", "count"
        or "count_distinct", e.g. orders: \`{ "fact": "TransactionId", "aggregateFn": "count_distinct" }\`
      \`$details({ "columns", "filter", "sort", "limit", "offset" })\` returns
        \`{ "rows", "totalCount" }\`, limit up to 1000
    Here, \`filter\` is a plain object with a value or a list of values per column, e.g.
    \`{ "ItemCategory": "Bags", "Continent": ["Europe", "Americas"] }\`, not a list like
    \`[{ "column": "Country", "value": "Germany" }]\`. A filter can't exclude values: load
    the rows and select them in JSONata, e.g.
      \`$aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["ItemCategory"] })[ItemCategory != "(not set)"]\`
    not \`"filter": { "ItemCategory": { "$ne": "(not set)" } }\`.
    Only "fact", "aggregateFn" and "dimensions" of $aggregate are required. Leave out the
    keys you don't need instead of passing empty values: \`{ "ItemName": "" }\` selects
    the rows with an empty ItemName, i.e. none.

    The value of the expression is the result. Several statements need a block in
    parentheses, with \`;\` between them and the result as the last statement:
      Right: ( $rows := $aggregate({ ... }); $rows.{ "label": Country, "value": value }[] )
      Wrong: $rows := $aggregate({ ... }); $rows.{ "label": Country, "value": value }[]
    JSONata unwraps arrays with a single item: append \`[]\` to a path that must return an
    array, e.g. \`$rows.{ "label": Country }[]\`.

    JSONata is not JavaScript:
      Sort with the order-by operator, e.g. \`$rows^(>value)\` for descending values. A
      \`$sort\` comparator returns a boolean: true if the two items need to be swapped.
      Select by position with a range in double brackets, e.g. \`$rows[[0..6]]\`.
      Functions like \`$sum\` return nothing, not 0, for an empty selection.
      \`and\` and \`or\` return booleans: \`$v or 0\` is no fallback, write \`$exists($v) ? $v : 0\`.
      Inside a filter \`[...]\`, \`$\` is the filtered item: bind an outer value to a variable,
        e.g. \`$map($cats, function($c) { $sum($rows[ItemCategory = $c].value) })\`.
      A function body with several statements needs its own block, e.g.
        \`function($c) { ( $x := $rows[Continent = $c]; { "continent": $c, "rows": $x } ) }\`.

    The 7 largest items plus "Other" for the rest, e.g. the products of a category in a
    continent. Load exactly the rows the question asks for, here with both filters:
      ( $rows := $aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["ItemName"], "filter": { "ItemCategory": "Bags", "Continent": "Europe" } });
        $slices := $rows.{ "label": ItemName, "value": value }^(>value);
        $rest := $slices[[7..$count($slices)]];
        $append($slices[[0..6]], $rest ? { "label": "Other", "value": $sum($rest.value) } : []) )

    One result per value of a dimension in an answer, e.g. the products per continent.
    For one chart per value, set splitBy instead and compute the data of one chart. Bind
    the value before filtering, because \`$\` inside \`[...]\` is the filtered row:
      ( $rows := $aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["Continent", "ItemName"], "filter": { "ItemCategory": "Bags" } });
        $distinct($rows.Continent).( $c := $;
          { "continent": $c, "slices": $rows[Continent = $c].{ "label": ItemName, "value": value }^(>value)[] } )[] )

    The 7 largest series plus "Other" per label, as bars of a bar chart:
      ( $rows := $aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["Continent", "ItemCategory"] });
        $totals := $each($rows{ ItemCategory: $sum(value) }, function($v, $k) { { "series": $k, "value": $v } })^(>value);
        $top := $totals[[0..6]].series;
        $other := $rows[$not(ItemCategory in $top)]{ Continent: $sum(value) };
        $append($rows[ItemCategory in $top].{ "label": Continent, "series": ItemCategory, "value": value },
          $each($other, function($v, $k) { { "label": $k, "series": "Other", "value": $v } })) )

    Compare each row with the previous one, e.g. the growth from month to month in percent:
      ( $rows := $aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["Month"] })^(Month);
        $map($rows[[1..$count($rows)]], function($r, $i) {
          { "label": $r.Month, "value": $round(($r.value - $rows[$i].value) / $rows[$i].value * 100, 1) } }) )
`;

export const jsonataLimitsDescription = `
    Limits: ${TIMEOUT_MS / 1000} s and results of up to ${MAX_RESULT_CHARS} characters.
    A query with more than ${MAX_ROWS} result rows needs the user's approval; the
    expression then runs again from the start.
`;

export const evaluateJsonata = createTool({
  id: 'evaluate-jsonata',
  description: `
    Evaluates a JSONata expression for calculations the aggregation API can't do,
    e.g. shares, growth rates or rankings.
    ${jsonataDescription}
    ${jsonataLimitsDescription}
  `,
  inputSchema: z.object({
    expression: z.string().describe(`
      JSONata expression that loads data with $aggregate or $details and transforms it, e.g.
      ( $rows := $aggregate({ "fact": "Revenue", "aggregateFn": "sum", "dimensions": ["Country"] });
        $total := $sum($rows.value);
        $rows.{ "label": Country, "value": $round(value / $total * 100, 1) }[] )
    `),
  }),
  outputSchema: z.union([z.object({ result: z.unknown() }), notExecutedSchema]),
  suspendSchema: approvalSuspendSchema,
  resumeSchema: approvalResumeSchema,
  execute: async ({ expression }, context) =>
    evaluateExpression(expression, context),
});

export class EmptyResultError extends Error {}

export async function evaluateExpression(
  expression: string,
  context?: ApprovalContext,
  filter: Filter = {},
): Promise<{ result: unknown } | NotExecuted> {
  const agent = context?.agent;
  const approval = agent?.resumeData;
  if (approval && !approval.approved) {
    return DECLINED;
  }
  rememberApproval(context);

  let tooLarge: number | undefined;
  const checkRowLimit = (rows: number) => {
    if (
      agent &&
      rows > MAX_ROWS &&
      !approval?.approved &&
      !isApproved(context, rows)
    ) {
      tooLarge = Math.max(tooLarge ?? 0, rows);
      throw new Error(
        `The result has ${rows} rows (max. ${MAX_ROWS}) and needs approval.`,
      );
    }
  };
  const compiled = compile(expression);
  let result: unknown;

  try {
    result = await compiled.evaluate(undefined, {
      aggregate: async (query: AggregateQuery) => {
        const { rowCount, rows } = await aggregate(withFilter(query, filter));
        checkRowLimit(rowCount);
        return rows;
      },
      details: async (query: DetailsQuery) => {
        const { rows, totalCount } = await details(withFilter(query, filter));
        checkRowLimit(totalCount);
        return { rows, totalCount };
      },
    });
  } catch (err) {
    if (tooLarge === undefined) throw toError(err);
  }

  if (tooLarge !== undefined) {
    return askForApproval(context, tooLarge);
  }
  if (result === undefined) {
    throw new EmptyResultError(
      'The expression returned nothing. Check the field names and filter values.',
    );
  }
  const size = JSON.stringify(result).length;
  if (size > MAX_RESULT_CHARS) {
    throw new Error(
      `The result has ${size} characters of JSON (max. ${MAX_RESULT_CHARS}). ` +
        'Aggregate further or return fewer rows.',
    );
  }
  return { result };
}

function compile(expression: string): jsonata.Expression {
  try {
    return jsonata(expression, { timeout: TIMEOUT_MS });
  } catch (error) {
    if (!isMissingBlock(error)) {
      throw toError(error);
    }
    return compileAsBlock(expression, toError(error));
  }
}

function compileAsBlock(
  expression: string,
  original: Error,
): jsonata.Expression {
  try {
    return jsonata(`( ${expression} )`, { timeout: TIMEOUT_MS });
  } catch {
    throw original;
  }
}

function withFilter<T extends { filter?: Filter }>(
  query: T,
  filter: Filter,
): T {
  return { ...query, filter: { ...query.filter, ...filter } };
}

function isMissingBlock(error: unknown): boolean {
  const { code, token } = error as jsonata.JsonataError;
  return code === 'S0201' && token === ';';
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  const jsonataError = error as jsonata.JsonataError;
  const { code, message, position } = jsonataError;
  const sentence = /[.?!]$/.test(message) ? message : `${message}.`;
  const hint = toHint(jsonataError);
  return new Error(
    `JSONata ${code} at position ${position}: ${sentence}${hint ? ` ${hint}` : ''}`,
  );
}

function toHint(error: jsonata.JsonataError): string {
  const { code, token } = error;
  if (isMissingBlock(error)) {
    return BLOCK_HINT;
  }
  if (code === 'S0202' && token === '..') {
    return 'Select by position with a range in double brackets, e.g. $rows[[0..6]].';
  }
  if (code === 'S0202' && token === '|') {
    return 'JSONata has no pipes: nest the function calls, e.g. $count($rows).';
  }
  if (code === 'T1006') {
    return `$${token} is no function: use the built-in JSONata functions, $aggregate and $details.`;
  }
  return '';
}

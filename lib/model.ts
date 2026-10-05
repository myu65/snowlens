import { z } from "zod";
export const aggregations = [
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COUNT",
  "COUNT_DISTINCT",
  "SEMANTIC",
] as const;
export const operators = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "is_null",
  "not_null",
] as const;
export type Value = string | number | boolean | null;
export type Field = {
  recommended?: boolean;
  id: string;
  label: string;
  type: string;
  description: string;
  category: string;
  suggested: "dimension" | "metric";
  semantic?: "dimension" | "metric";
  expression?: string;
  compatibleDimensions?: string[];
  requiredDimensions?: string[];
};
export type QueryableSource = {
  id: string;
  database: string;
  schema: string;
  name: string;
  kind: "table" | "view" | "dynamic_table" | "semantic_view";
  description: string;
  rowCount?: number;
  fields: Field[];
};
const value = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const querySchema = z
  .object({
    source: z.string().min(1).max(1000),
    dimensions: z.array(z.string()).max(12),
    metrics: z
      .array(
        z
          .object({ field: z.string(), aggregation: z.enum(aggregations) })
          .strict(),
      )
      .max(12),
    filters: z
      .array(
        z
          .object({ field: z.string(), operator: z.enum(operators), value })
          .strict(),
      )
      .max(30),
    sort: z
      .array(
        z
          .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
          .strict(),
      )
      .max(5),
    detail: z.boolean().default(false),
    limit: z.number().int().min(1).max(1000).default(200),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export type Query = z.infer<typeof querySchema>;
export type Result = {
  rows: Record<string, Value>[];
  columns: string[];
  hasMore: boolean;
  elapsedMs: number;
};
export const datasetSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    source: z.string(),
    fields: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().min(1).max(120),
          description: z.string().max(1000),
          recommended: z.boolean(),
        }),
      )
      .min(1)
      .max(500),
    defaultView: querySchema,
    drill: z.record(z.string(), z.array(z.string()).max(12)),
    factDetail: z
      .object({
        source: z.string().min(1).max(1000),
        fields: z.array(z.string().min(1)).min(1).max(500),
        mapping: z.record(z.string(), z.string().min(1)),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Dataset = z.infer<typeof datasetSchema>;
export const savedSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(120),
    query: querySchema,
    datasetId: z.string().optional(),
  })
  .strict();
export type SavedView = z.infer<typeof savedSchema>;
export type AppState = {
  datasets: Dataset[];
  saved: SavedView[];
  favorites: string[];
  recent: string[];
};
export function inferRole(name: string, type: string): Field["suggested"] {
  return /NUMBER|DECIMAL|INT|FLOAT|DOUBLE/i.test(type) &&
    !/(^|_)(ID|NO|CODE|YEAR|LOT)(_|$)/i.test(name)
    ? "metric"
    : "dimension";
}
export const isNumeric = (f: Field) =>
  /NUMBER|DECIMAL|INT|FLOAT|DOUBLE|REAL/i.test(f.type);
export function metricKey(m: Query["metrics"][number]) {
  return `${m.field}__${m.aggregation}`;
}
export function initialQuery(source: QueryableSource): Query {
  return {
    source: source.id,
    dimensions: [],
    metrics: [],
    filters: [],
    sort: [],
    detail: true,
    limit: 200,
    offset: 0,
  };
}
export function validateDataset(
  input: unknown,
  source: QueryableSource,
): Dataset {
  const d = datasetSchema.parse(input);
  if (d.source !== source.id || d.defaultView.source !== source.id)
    throw Error("Dataset source mismatch");
  const ids = new Set(source.fields.map((f) => f.id));
  if (
    new Set(d.fields.map((f) => f.id)).size !== d.fields.length ||
    d.fields.some((f) => !ids.has(f.id))
  )
    throw Error("Invalid dataset fields");
  const published = new Set(d.fields.map((f) => f.id));
  if (
    [
      ...d.defaultView.dimensions,
      ...d.defaultView.metrics.map((m) => m.field),
      ...d.defaultView.filters.map((f) => f.field),
    ].some((id) => !published.has(id))
  )
    throw Error("Initial view uses unpublished fields");
  if (
    Object.entries(d.drill).some(
      ([key, values]) =>
        !published.has(key) || values.some((v) => !published.has(v)),
    )
  )
    throw Error("Invalid drill fields");
  return d;
}

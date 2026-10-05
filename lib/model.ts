import { z } from "zod";
export const aggregations = [
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COUNT",
  "COUNT_ROWS",
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
export const personalTableSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(120),
    columns: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),
            label: z.string().trim().min(1).max(120),
            type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    rows: z
      .array(
        z
          .array(
            z.union([
              z.string().max(2000),
              z.number().finite(),
              z.boolean(),
              z.null(),
            ]),
          )
          .max(12),
      )
      .max(1000),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  })
  .strict();
export type PersonalTable = z.infer<typeof personalTableSchema>;
export const personalJoinSchema = z
  .object({
    tableId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    sourceField: z.string().min(1).max(255),
    tableField: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),
    type: z.enum(["left", "inner"]),
  })
  .strict();
export type PersonalJoin = z.infer<typeof personalJoinSchema>;
export const relationJoinSchema = z
  .object({
    rightSource: z.string().min(1).max(1000),
    sourceField: z.string().min(1).max(255),
    rightField: z.string().min(1).max(255),
    type: z.enum(["left", "inner"]),
  })
  .strict();
export type RelationJoin = z.infer<typeof relationJoinSchema>;
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
    join: z.union([personalJoinSchema, relationJoinSchema]).optional(),
    totals: z.enum(["off", "grand", "subtotals"]).optional(),
  })
  .strict();
export type Query = z.infer<typeof querySchema>;
export type Result = {
  rows: Record<string, Value>[];
  columns: string[];
  hasMore: boolean;
  elapsedMs: number;
  rowLevels?: number[];
  dimensionCount?: number;
  grandTotal?: Record<string, Value>;
  summaryNotice?: string;
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
export const fieldOverrideSchema = z
  .object({
    id: z.string().min(1).max(255),
    label: z.string().trim().min(1).max(120),
    description: z.string().max(1000),
  })
  .strict();
export type FieldOverride = z.infer<typeof fieldOverrideSchema>;
export const savedSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(120),
    query: querySchema,
    datasetId: z.string().optional(),
    fieldOverrides: z.array(fieldOverrideSchema).max(500).optional(),
  })
  .strict();
export type SavedView = z.infer<typeof savedSchema>;
export type AppState = {
  datasets: Dataset[];
  saved: SavedView[];
  favorites: string[];
  recent: string[];
  personalTables?: (PersonalTable & { rowCount?: number })[];
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
  const key = `${m.field}__${m.aggregation}`;
  if (key.length <= 255) return key;
  let hash = 2166136261;
  for (const c of m.field) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `${m.field.slice(0, 160)}__${(hash >>> 0).toString(16)}__${m.aggregation}`;
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

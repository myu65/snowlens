import {
  metricKey,
  type Field,
  type Query,
  type QueryableSource,
  type Result,
} from "./model";

export type ExportContext = {
  query: Query;
  result: Result;
  source: QueryableSource;
  datasetName?: string;
  joinName?: string;
  joinVersion?: number;
  exportedAt: Date;
};
export type ExportColumn = {
  id: string;
  label: string;
  field?: Field;
  metric?: Query["metrics"][number];
};
export const aggregationNames: Record<
  Query["metrics"][number]["aggregation"],
  string
> = {
  SUM: "合計",
  AVG: "平均",
  MIN: "最小",
  MAX: "最大",
  COUNT: "件数",
  COUNT_ROWS: "行数",
  COUNT_DISTINCT: "種類数",
  SEMANTIC: "定義済み",
};

export function exportColumns(context: ExportContext): ExportColumn[] {
  const columns = context.result.columns.map((id) => {
    const metric = context.query.detail
      ? undefined
      : context.query.metrics.find((m) => metricKey(m) === id);
    const field = context.source.fields.find(
      (f) => f.id === (metric?.field || id),
    );
    return {
      id,
      field,
      metric,
      label: metric?.aggregation === "COUNT_ROWS" ? "行数" : field?.label || id,
    };
  });
  const normalize = (name: string) => name.normalize("NFKC").toLowerCase();
  const counts = new Map<string, number>();
  for (const c of columns)
    counts.set(normalize(c.label), (counts.get(normalize(c.label)) || 0) + 1);
  const used = new Set<string>();
  return columns.map((c) => {
    let base = c.label;
    if ((counts.get(normalize(base)) || 0) > 1 && c.metric)
      base += `（${aggregationNames[c.metric.aggregation]}）`;
    // Excel tables require unique, bounded column names. Keep meaning readable.
    base = base.slice(0, 240);
    let label = base,
      index = 2;
    while (used.has(normalize(label))) label = `${base}（${index++}）`;
    used.add(normalize(label));
    return { ...c, label };
  });
}

export function isSubtotal(context: ExportContext, index: number) {
  return (
    !!context.result.rowLevels &&
    context.result.rowLevels[index] <
      (context.result.dimensionCount ?? context.query.dimensions.length)
  );
}
export function exportDataRows(context: ExportContext) {
  return context.result.rows.filter((_, index) => !isSubtotal(context, index));
}
export function exportTitle(context: ExportContext) {
  return context.datasetName || context.source.name;
}
export function exportFilename(
  context: ExportContext,
  extension: "xlsx" | "csv",
) {
  const name = exportTitle(context)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 100);
  return `SnowLens_${name || "結果"}.${extension}`;
}
export function exportScope(context: ExportContext) {
  const { query, result } = context;
  const range = result.rows.length
    ? `${query.offset + 1}〜${query.offset + result.rows.length}行目`
    : "0行";
  return `現在のページ ${range}${result.hasMore ? "（次のページあり）" : ""}。データ${exportDataRows(context).length}行${result.rowLevels ? "。小計を含む画面の行番号" : ""}。`;
}

export function exportConditions(context: ExportContext) {
  const name = (id: string) =>
    context.source.fields.find((f) => f.id === id)?.label || id;
  const ops: Record<Query["filters"][number]["operator"], string> = {
    eq: "等しい",
    neq: "以外",
    gt: "より大きい",
    gte: "以上",
    lt: "より小さい",
    lte: "以下",
    contains: "含む",
    is_null: "空欄",
    not_null: "空欄でない",
  };
  return context.query.filters.map(
    (f) =>
      `${name(f.field)} ${ops[f.operator]}${f.operator === "is_null" || f.operator === "not_null" ? "" : ` ${f.value === null ? "空欄" : String(f.value)}`}`,
  );
}

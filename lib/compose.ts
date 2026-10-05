import { type Field, type Query, isNumeric, metricKey } from "./model";

export type ComposeTarget = "auto" | "dimension" | "metric";
export type ComposeAggregation =
  "auto" | Query["metrics"][number]["aggregation"];

/** A single atomic edit: never aggregate numeric identifiers by inference. */
export function composeColumns(
  query: Query,
  fields: Field[],
  ids: string[],
  target: ComposeTarget,
  aggregation: ComposeAggregation = "auto",
): Query {
  const selected = [...new Set(ids)].map((id) => {
    const field = fields.find((f) => f.id === id);
    if (!field) throw Error("この列は現在の表示で利用できません。");
    return field;
  });
  if (!selected.length) throw Error("列を選んでください。");
  const fresh = target === "auto" && query.detail;
  const dimensions = fresh ? [] : [...query.dimensions];
  const metrics = fresh ? [] : [...query.metrics];
  for (const f of selected) {
    const asMetric =
      target === "metric" ||
      (target === "auto" &&
        (f.semantic === "metric" || (!f.semantic && f.suggested === "metric")));
    if (!asMetric) {
      if (f.semantic === "metric")
        throw Error("定義済みの指標は値に追加してください。");
      if (!dimensions.includes(f.id)) dimensions.push(f.id);
      continue;
    }
    const method =
      f.semantic === "metric"
        ? "SEMANTIC"
        : aggregation === "auto"
          ? isNumeric(f)
            ? "SUM"
            : "COUNT"
          : aggregation;
    if (["SUM", "AVG"].includes(method) && !isNumeric(f))
      throw Error(
        `${f.label}は数値ではありません。件数や種類数を選んでください。`,
      );
    if (method === "SEMANTIC" && f.semantic !== "metric")
      throw Error("定義済みの指標を選んでください。");
    if (
      method === "COUNT_ROWS" &&
      metrics.some((m) => m.aggregation === "COUNT_ROWS")
    )
      continue;
    const metric = {
      field: f.id,
      aggregation: method,
    } as Query["metrics"][number];
    if (!metrics.some((m) => metricKey(m) === metricKey(metric)))
      metrics.push(metric);
  }
  if (
    target === "auto" &&
    !metrics.length &&
    selected.every((f) => !f.semantic)
  )
    metrics.push({ field: selected[0].id, aggregation: "COUNT_ROWS" });
  for (const m of metrics) {
    const f = fields.find((f) => f.id === m.field);
    for (const id of f?.requiredDimensions || []) {
      if (!fields.some((f) => f.id === id))
        throw Error("この指標に必要な行項目を利用できません。");
      if (!dimensions.includes(id)) dimensions.push(id);
    }
  }
  for (const m of metrics) {
    const f = fields.find((f) => f.id === m.field);
    if (
      f?.compatibleDimensions &&
      dimensions.some((id) => !f.compatibleDimensions!.includes(id))
    )
      throw Error(
        "この指標と行項目は組み合わせられません。別の列を選んでください。",
      );
  }
  if (dimensions.length > 12 || metrics.length > 12)
    throw Error("行項目と集計する値は、それぞれ12個まで追加できます。");
  return {
    ...query,
    dimensions,
    metrics,
    detail: false,
    sort: [],
    offset: 0,
    totals: query.totals || "grand",
  };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  )
    return items;
  const result = [...items];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}

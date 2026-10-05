import {
  type QueryableSource,
  type Query,
  querySchema,
  metricKey,
  isNumeric,
} from "./model";
// Identifiers ONLY come from freshly resolved server metadata; unusual quoted names are supported.
export function identifier(name: string): string {
  if (!name || name.length > 255 || /[\x00-\x1f]/.test(name))
    throw Error("Invalid identifier");
  return '"' + name.replaceAll('"', '""') + '"';
}
export function relation(s: QueryableSource) {
  return [s.database, s.schema, s.name].map(identifier).join(".");
}
export function validateQuery(input: unknown, s: QueryableSource): Query {
  const q = querySchema.parse(input);
  if (q.totals === "subtotals" && s.kind === "semantic_view")
    throw Error(
      "小計はTable・View・Dynamic Tableで利用できます。定義済みの指標は総計で確認してください。",
    );
  if (q.source !== s.id) throw Error("Source is not accessible");
  const fields = new Map(s.fields.map((f) => [f.id, f]));
  const get = (id: string) => {
    const f = fields.get(id);
    if (!f) throw Error("Unknown field: " + id);
    return f;
  };
  if (
    new Set(q.dimensions).size !== q.dimensions.length ||
    new Set(q.metrics.map(metricKey)).size !== q.metrics.length
  )
    throw Error("Duplicate selections");
  q.dimensions.forEach((id) => {
    if (get(id).semantic === "metric")
      throw Error("Semantic metric cannot group rows");
  });
  q.metrics.forEach((m) => {
    const f = get(m.field);
    if (
      f.semantic === "metric"
        ? m.aggregation !== "SEMANTIC"
        : m.aggregation === "SEMANTIC"
    )
      throw Error("Invalid semantic aggregation");
    if (["SUM", "AVG"].includes(m.aggregation) && !isNumeric(f))
      throw Error("Numeric field required");
    if (s.kind === "semantic_view" && f.semantic !== "metric")
      throw Error("Choose a defined semantic metric");
    if (
      f.compatibleDimensions &&
      q.dimensions.some((id) => !f.compatibleDimensions!.includes(id))
    )
      throw Error("Invalid semantic dimensions for " + f.label);
    if (
      !q.detail &&
      f.requiredDimensions?.some((id) => !q.dimensions.includes(id))
    )
      throw Error(
        "Required semantic dimensions for " +
          f.label +
          ": " +
          f.requiredDimensions.join(", "),
      );
  });
  q.filters.forEach((filter) => {
    const f = get(filter.field);
    if (s.kind === "semantic_view" && f.semantic === "metric")
      throw Error("Filter a semantic dimension");
    if (!["is_null", "not_null"].includes(filter.operator)) {
      if (filter.value === null) throw Error("Use a null operator");
      if (f.type === "BOOLEAN" && typeof filter.value !== "boolean")
        throw Error("Invalid boolean filter");
      if (isNumeric(f) && typeof filter.value !== "number")
        throw Error("Numeric filter required");
      if (
        /DATE|TIME/.test(f.type) &&
        (typeof filter.value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(filter.value) ||
          Number.isNaN(Date.parse(filter.value)))
      )
        throw Error("Invalid date");
      if (
        filter.operator === "contains" &&
        (typeof filter.value !== "string" || isNumeric(f))
      )
        throw Error("Text filter required");
    }
  });
  if (!q.detail && !q.dimensions.length && !q.metrics.length)
    throw Error("Choose a row field or value");
  const outputs = q.detail
    ? s.fields.filter((f) => f.semantic !== "metric").map((f) => f.id)
    : [...q.dimensions, ...q.metrics.map(metricKey)];
  if (new Set(outputs).size !== outputs.length)
    throw Error("Duplicate result names");
  q.sort.forEach((sort) => {
    if (!outputs.includes(sort.field)) throw Error("Sort field not in result");
    if (
      q.totals === "subtotals" &&
      !q.detail &&
      !q.dimensions.includes(sort.field)
    )
      throw Error("小計表示中は行項目で並べ替えてください。");
  });
  return q;
}
export function compileQuery(
  input: unknown,
  s: QueryableSource,
  resolved?: { from: string; binds: (string | number | boolean)[] },
) {
  const q = validateQuery(input, s);
  if (q.join && !resolved) throw Error("Invalid unresolved personal join");
  const binds: (string | number | boolean)[] = [...(resolved?.binds || [])];
  const fields = new Map(s.fields.map((f) => [f.id, f]));
  const field = (id: string) => identifier(fields.get(id)!.id);
  const sem = (id: string) => {
    const f = fields.get(id)!;
    return (f.expression || f.id).split(".").map(identifier).join(".");
  };
  const filters = q.filters.map((f) => {
    const col = s.kind === "semantic_view" ? sem(f.field) : field(f.field);
    if (f.operator === "is_null") return col + " IS NULL";
    if (f.operator === "not_null") return col + " IS NOT NULL";
    if (f.operator === "contains") {
      binds.push(
        String(f.value)
          .replaceAll("\\", "\\\\")
          .replaceAll("%", "\\%")
          .replaceAll("_", "\\_"),
      );
      return `${col} ILIKE '%' || ? || '%' ESCAPE '\\\\'`;
    }
    binds.push(f.value as string | number | boolean);
    return (
      col +
      " " +
      { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[
        f.operator
      ] +
      " ?"
    );
  });
  let sql: string;
  let columns: string[];
  const rollup =
    q.totals === "subtotals" &&
    !q.detail &&
    q.dimensions.length > 1 &&
    q.metrics.length > 0;
  let levelColumn: string | undefined;
  const level = () =>
    `${q.dimensions.length} - (${q.dimensions.map((id) => `GROUPING(${field(id)})`).join(" + ")})`;
  if (s.kind === "semantic_view") {
    const dims = q.detail
      ? s.fields.filter((f) => f.semantic === "dimension").map((f) => f.id)
      : q.dimensions;
    const clauses = [
      dims.length
        ? "DIMENSIONS " +
          dims.map((id) => sem(id) + " AS " + identifier(id)).join(", ")
        : "",
      !q.detail && q.metrics.length
        ? "METRICS " +
          q.metrics
            .map((m) => sem(m.field) + " AS " + identifier(m.field))
            .join(", ")
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    columns = q.detail ? dims : [...q.dimensions, ...q.metrics.map(metricKey)];
    const selections = q.detail
      ? dims.map(field)
      : [
          ...q.dimensions.map(field),
          ...q.metrics.map(
            (m) => `${field(m.field)} AS ${identifier(metricKey(m))}`,
          ),
        ];
    // Extra filter dimensions must not change the requested grain: filter inside SEMANTIC_VIEW.
    sql = `SELECT ${selections.join(", ")} FROM SEMANTIC_VIEW(${relation(s)} ${clauses}${filters.length ? " WHERE " + filters.join(" AND ") : ""})`;
  } else {
    columns = q.detail
      ? s.fields.map((f) => f.id)
      : [...q.dimensions, ...q.metrics.map(metricKey)];
    const select = q.detail
      ? s.fields.map((f) => field(f.id))
      : [
          ...q.dimensions.map(field),
          ...q.metrics.map(
            (m) =>
              `${m.aggregation === "COUNT_ROWS" ? "COUNT(*)" : m.aggregation === "COUNT_DISTINCT" ? "COUNT(DISTINCT " + field(m.field) + ")" : m.aggregation + "(" + field(m.field) + ")"} AS ${identifier(metricKey(m))}`,
          ),
        ];
    if (rollup) {
      levelColumn = "__snowlens_group_level";
      while (columns.includes(levelColumn)) levelColumn += "_";
      select.push(`${level()} AS ${identifier(levelColumn)}`);
    }
    sql =
      `SELECT ${select.join(", ")} FROM ${resolved?.from || relation(s)}` +
      (filters.length ? " WHERE " + filters.join(" AND ") : "") +
      (!q.detail && q.dimensions.length
        ? " GROUP BY " +
          (rollup
            ? "ROLLUP(" + q.dimensions.map(field).join(", ") + ")"
            : q.dimensions.map(field).join(", "))
        : "") +
      (rollup ? ` HAVING ${level()} > 0` : "");
  }
  // Stable ordering for bounded offset pagination; exact duplicate detail rows remain indistinguishable.
  const ordering = [
    ...q.sort,
    ...columns
      .filter((c) => !q.sort.some((o) => o.field === c))
      .map((field) => ({ field, direction: "asc" as const })),
  ];
  sql += rollup
    ? " ORDER BY " +
      q.dimensions
        .map(
          (id) =>
            `${field(id)} ${q.sort.find((o) => o.field === id)?.direction.toUpperCase() || "ASC"} NULLS LAST, GROUPING(${field(id)}) ASC`,
        )
        .join(", ")
    : " ORDER BY " +
      ordering
        .map(
          (o) =>
            identifier(o.field) +
            " " +
            o.direction.toUpperCase() +
            " NULLS LAST",
        )
        .join(", ");
  sql += ` LIMIT ${q.limit + 1} OFFSET ${q.offset}`;
  return {
    sql,
    binds,
    columns,
    query: q,
    levelColumn,
    validationColumn: undefined as string | undefined,
  };
}

import {
  type QueryableSource,
  type Field,
  type Value,
  type Dataset,
  type Query,
  type Result,
  inferRole,
  initialQuery,
  metricKey,
} from "./model";
import { validateQuery } from "./compiler";
const definitions: [string, string, string, string][] = [
  ["ORDER_DATE", "受注日", "DATE", "日付"],
  ["PRODUCT", "製品", "VARCHAR", "製品"],
  ["CUSTOMER", "顧客", "VARCHAR", "営業"],
  ["DEPARTMENT", "部門", "VARCHAR", "営業"],
  ["REGION", "地域", "VARCHAR", "営業"],
  ["LOT_NO", "ロット番号", "NUMBER", "製造"],
  ["MACHINE_ID", "設備番号", "NUMBER", "製造"],
  ["QUANTITY", "数量 kg", "NUMBER", "値"],
  ["SALES_AMOUNT", "売上 円", "NUMBER", "値"],
  ["TEMPERATURE", "温度 °C", "FLOAT", "品質"],
  ["STATUS", "判定", "VARCHAR", "品質"],
];
const common: Field[] = definitions.map(([id, label, type, category]) => ({
  id,
  label,
  type,
  category,
  description: `${label}。化学製品の業務データ`,
  suggested: inferRole(id, type),
}));
const entries: [string, string, QueryableSource["kind"], string][] = [
  ["SALES", "ORDERS", "table", "受注明細"],
  ["SUPPLY", "INVENTORY", "dynamic_table", "在庫スナップショット"],
  ["PRODUCTION", "PRODUCTION_LOG", "table", "製造実績・設備とロット"],
  ["QUALITY", "QUALITY_EVENTS", "view", "品質異常"],
  ["LAB", "EXPERIMENT_RESULTS", "table", "実験結果・120項目"],
  ["SALES", "SALES_SEMANTIC", "semantic_view", "意味定義済みの受注実績"],
];
export const mockSources: QueryableSource[] = entries.map(
  ([schema, name, kind, description]) => ({
    id: `CHEM.${schema}.${name}`,
    database: "CHEM",
    schema,
    name,
    kind,
    description,
    rowCount: 12000,
    fields:
      name === "EXPERIMENT_RESULTS"
        ? [
            ...common,
            ...Array.from({ length: 109 }, (_, i) => ({
              id: `MEASUREMENT_${i + 1}`,
              label: `測定値 ${i + 1}`,
              type: "FLOAT",
              category: "実験",
              description: `分析装置による測定 ${i + 1}`,
              suggested: "metric" as const,
            })),
          ]
        : kind === "semantic_view"
          ? common.map((f) => ({
              ...f,
              semantic: f.suggested,
              expression: `ORDERS.${f.id}`,
            }))
          : common.map((f) =>
              f.id === "ORDER_DATE"
                ? {
                    ...f,
                    label:
                      (
                        {
                          PRODUCTION: "製造日",
                          LAB: "実験日",
                          QUALITY: "検査日",
                          SUPPLY: "在庫基準日",
                        } as Record<string, string>
                      )[schema] || f.label,
                  }
                : f,
            ),
  }),
);
mockSources.push({
  id: "CHEM.MASTER.PRODUCT_TARGETS",
  database: "CHEM",
  schema: "MASTER",
  name: "PRODUCT_TARGETS",
  kind: "table",
  description: "製品・設備・年度ごとの目標値",
  rowCount: 96,
  fields: [
    common.find((f) => f.id === "PRODUCT")!,
    common.find((f) => f.id === "MACHINE_ID")!,
    {
      id: "YEAR",
      label: "年度",
      type: "NUMBER",
      description: "目標の対象年度",
      category: "目標",
      suggested: "dimension",
    },
    {
      id: "TARGET",
      label: "目標 kg",
      type: "NUMBER",
      description: "製品・設備ごとの目標数量",
      category: "目標",
      suggested: "metric",
    },
  ],
});
mockSources.push({
  id: "CHEM.MASTER.PRODUCTS",
  database: "CHEM",
  schema: "MASTER",
  name: "PRODUCTS",
  kind: "view",
  description: "製品マスタ・製品ごとの分類",
  rowCount: 6,
  fields: [
    common.find((f) => f.id === "PRODUCT")!,
    {
      id: "CATEGORY",
      label: "製品分類",
      type: "VARCHAR",
      description: "製品の業務分類",
      category: "製品",
      suggested: "dimension",
    },
  ],
});
const products = [
  "アクリル樹脂 A-100",
  "エポキシ樹脂 E-200",
  "高純度溶剤 S-300",
  "機能性添加剤 F-400",
  "ポリマー P-500",
  "触媒 C-600",
];
export function mockRows(s: QueryableSource): Record<string, Value>[] {
  if (s.name === "PRODUCT_TARGETS")
    return [2025, 2026].flatMap((year) =>
      products.flatMap((product, i) =>
        Array.from({ length: 8 }, (_, j) => ({
          PRODUCT: product,
          MACHINE_ID: j + 1,
          YEAR: year,
          TARGET: 100 + 10 * i + j,
        })),
      ),
    );
  if (s.name === "PRODUCTS")
    return products.map((product, i) => ({
      PRODUCT: product,
      CATEGORY: i < 2 ? "樹脂" : "その他",
    }));
  const measurements = s.fields.filter((f) => f.id.startsWith("MEASUREMENT_"));
  return Array.from({ length: 12000 }, (_, i) => {
    const row: Record<string, Value> = {
      ORDER_DATE: `2026-${i % 7 === 0 ? "09" : "10"}-${String((i % 28) + 1).padStart(2, "0")}`,
      PRODUCT: products[i % 6],
      CUSTOMER: [
        "東海化学",
        "関東素材",
        "北陸工業",
        "西日本ケミカル",
        "旭製薬",
      ][i % 5],
      DEPARTMENT: ["機能材料", "基礎化学", "電子材料"][i % 3],
      REGION: ["東日本", "西日本", "海外"][i % 3],
      LOT_NO: 260000 + (i % 120),
      MACHINE_ID: (i % 8) + 1,
      QUANTITY: 50 + ((i * 17) % 950),
      SALES_AMOUNT: (50 + ((i * 17) % 950)) * (1200 + (i % 600)),
      TEMPERATURE: Math.round((20 + ((i * 7) % 100) / 10) * 10) / 10,
      STATUS: i % 13 === 0 ? "要確認" : "合格",
    };
    measurements.forEach((f, j) => {
      row[f.id] = Math.round(((i * (j + 3)) % 1000) / 10);
    });
    return row;
  });
}
export function defaultDataset(): Dataset {
  const s = mockSources[0];
  return {
    id: "orders",
    name: "受注実績",
    description: "製品別の売上と数量。顧客・地域へ掘り下げて確認できます。",
    source: s.id,
    fields: s.fields.map((f) => ({
      id: f.id,
      label: f.label,
      description: f.description,
      recommended: [
        "PRODUCT",
        "CUSTOMER",
        "ORDER_DATE",
        "SALES_AMOUNT",
        "QUANTITY",
      ].includes(f.id),
    })),
    defaultView: {
      ...initialQuery(s),
      detail: false,
      dimensions: ["PRODUCT"],
      metrics: [
        { field: "SALES_AMOUNT", aggregation: "SUM" },
        { field: "QUANTITY", aggregation: "SUM" },
      ],
      sort: [{ field: "SALES_AMOUNT__SUM", direction: "desc" }],
    },
    drill: { PRODUCT: ["CUSTOMER", "ORDER_DATE", "REGION"] },
  };
}
export function defaultDatasets(): Dataset[] {
  const orders = defaultDataset();
  const make = (
    index: number,
    id: string,
    name: string,
    description: string,
    dimensions: string[],
    metrics: Query["metrics"],
    filters: Query["filters"] = [],
  ): Dataset => {
    const s = mockSources[index];
    return {
      id,
      name,
      description,
      source: s.id,
      fields: s.fields.map((f) => ({
        id: f.id,
        label: f.label,
        description: f.description,
        recommended: [...dimensions, ...metrics.map((m) => m.field)].includes(
          f.id,
        ),
      })),
      defaultView: {
        ...initialQuery(s),
        detail: false,
        dimensions,
        metrics,
        filters,
      },
      drill: Object.fromEntries(
        dimensions.map((d) => [
          d,
          ["PRODUCT", "MACHINE_ID", "LOT_NO"].filter((id) => id !== d),
        ]),
      ),
    };
  };
  return [
    orders,
    make(
      1,
      "inventory",
      "在庫",
      "製品ごとの在庫数量。ロット・設備から内訳を確認。",
      ["PRODUCT"],
      [{ field: "QUANTITY", aggregation: "SUM" }],
    ),
    make(
      3,
      "quality",
      "品質異常",
      "要確認のロットを製品別に確認します。",
      ["PRODUCT"],
      [{ field: "LOT_NO", aggregation: "COUNT_DISTINCT" }],
      [{ field: "STATUS", operator: "eq", value: "要確認" }],
    ),
  ];
}
export function filterMockRows(
  data: Record<string, Value>[],
  filters: Query["filters"],
) {
  return data.filter((r) =>
    filters.every((f) => {
      const v = r[f.field],
        t = f.value;
      if (f.operator === "is_null") return v == null;
      if (f.operator === "not_null") return v != null;
      if (v == null || t === null) return false;
      switch (f.operator) {
        case "eq":
          return v === t;
        case "neq":
          return v !== t;
        case "contains":
          return String(v).toLowerCase().includes(String(t).toLowerCase());
        case "gt":
          return v > t;
        case "gte":
          return v >= t;
        case "lt":
          return v < t;
        case "lte":
          return v <= t;
      }
    }),
  );
}
export function executeMock(
  input: unknown,
  s: QueryableSource,
  data?: Record<string, Value>[],
): Result {
  const start = performance.now();
  const q = validateQuery(input, s);
  const rows = filterMockRows(data || mockRows(s), q.filters);
  const columns = q.detail
    ? s.fields.filter((f) => f.semantic !== "metric").map((f) => f.id)
    : [...q.dimensions, ...q.metrics.map(metricKey)];
  let result: Record<string, Value>[];
  const rollup =
    q.totals === "subtotals" &&
    !q.detail &&
    q.dimensions.length > 1 &&
    q.metrics.length > 0;
  const levels = new Map<Record<string, Value>, number>();
  if (q.detail)
    result = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
  else {
    result = [];
    const grains = rollup
      ? q.dimensions.map((_, i) => q.dimensions.slice(0, i + 1))
      : [q.dimensions];
    for (const grain of grains) {
      const groups = new Map<string, typeof rows>();
      rows.forEach((r) => {
        const key = JSON.stringify(grain.map((id) => r[id]));
        const group = groups.get(key) || [];
        group.push(r);
        groups.set(key, group);
      });
      if (!grain.length && !groups.size) groups.set("[]", []);
      result.push(
        ...[...groups.values()].map((group) => {
          const r: Record<string, Value> = Object.fromEntries(
            q.dimensions.map((id) => [
              id,
              grain.includes(id) ? (group[0]?.[id] ?? null) : null,
            ]),
          );
          q.metrics.forEach((m) => {
            const values = group
              .map((row) => row[m.field])
              .filter((v) => v !== null);
            const nums = values.map(Number);
            let v: Value = null;
            switch (m.aggregation) {
              case "SUM":
              case "SEMANTIC":
                v = values.length ? nums.reduce((a, b) => a + b, 0) : null;
                break;
              case "AVG":
                v = values.length
                  ? nums.reduce((a, b) => a + b, 0) / nums.length
                  : null;
                break;
              case "COUNT":
                v = values.length;
                break;
              case "COUNT_ROWS":
                v = group.length;
                break;
              case "COUNT_DISTINCT":
                v = new Set(values).size;
                break;
              case "MIN":
                v = values.length
                  ? values.reduce((a, b) => (a! < b! ? a : b))
                  : null;
                break;
              case "MAX":
                v = values.length
                  ? values.reduce((a, b) => (a! > b! ? a : b))
                  : null;
            }
            r[metricKey(m)] = v;
          });
          levels.set(r, grain.length);
          return r;
        }),
      );
    }
  }
  const order = rollup
    ? q.dimensions.map((field) => ({
        field,
        direction:
          q.sort.find((o) => o.field === field)?.direction || ("asc" as const),
      }))
    : q.sort.length
      ? q.sort
      : columns.map((field) => ({ field, direction: "asc" as const }));
  result.sort((a, b) => {
    for (const o of order) {
      const x = a[o.field],
        y = b[o.field];
      if (x === y) {
        if (rollup) {
          const index = q.dimensions.indexOf(o.field);
          const grouping =
            Number(index >= levels.get(a)!) - Number(index >= levels.get(b)!);
          if (grouping) return grouping;
        }
        continue;
      }
      if (x === null) return 1;
      if (y === null) return -1;
      const c = x! < y! ? -1 : 1;
      return o.direction === "asc" ? c : -c;
    }
    return 0;
  });
  return {
    rows: result.slice(q.offset, q.offset + q.limit),
    columns,
    hasMore: result.length > q.offset + q.limit,
    elapsedMs: Math.round(performance.now() - start),
    ...(rollup
      ? {
          rowLevels: result
            .slice(q.offset, q.offset + q.limit)
            .map((r) => levels.get(r)!),
          dimensionCount: q.dimensions.length,
        }
      : {}),
  };
}
export function recommendedQuery(s: QueryableSource, id: string): Query {
  const metrics = s.fields
    .filter(
      (f) =>
        f.semantic === "metric" || (!f.semantic && f.suggested === "metric"),
    )
    .slice(0, 2)
    .map((f) => ({
      field: f.id,
      aggregation: f.semantic ? ("SEMANTIC" as const) : ("SUM" as const),
    }));
  return { ...initialQuery(s), detail: false, dimensions: [id], metrics };
}

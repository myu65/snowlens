import { it, expect } from "vitest";
import { composeColumns, moveItem } from "../lib/compose";
import { compileQuery } from "../lib/compiler";
import { initialQuery, type Query } from "../lib/model";
import { mockSources, executeMock } from "../lib/mock";
import { runQuery } from "../lib/provider";
import { exportCsv } from "../lib/csv";
import { metricKey } from "../lib/model";
const source = mockSources[0];

it("shows a reason instead of inventing grand totals for dimension-required semantic metrics", async () => {
  const semantic = mockSources[5];
  const index = semantic.fields.findIndex((f) => f.id === "SALES_AMOUNT");
  const original = semantic.fields[index];
  semantic.fields[index] = {
    ...original,
    requiredDimensions: ["ORDER_DATE"],
    compatibleDimensions: ["ORDER_DATE"],
  };
  try {
    const result = await runQuery({
      ...initialQuery(semantic),
      detail: false,
      dimensions: ["ORDER_DATE"],
      metrics: [{ field: "SALES_AMOUNT", aggregation: "SEMANTIC" }],
    });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.grandTotal).toBeUndefined();
    expect(result.summaryNotice).toContain("行項目が必要");
  } finally {
    semantic.fields[index] = original;
  }
});

it("supports maximal source column names and rejects result-name collisions", () => {
  const name = "x".repeat(255);
  const extended = {
    ...source,
    fields: [
      ...source.fields,
      { ...source.fields[8], id: name },
      { ...source.fields[1], id: "SALES_AMOUNT__SUM" },
    ],
  };
  const metric = { field: name, aggregation: "SUM" as const };
  const q = { ...initialQuery(source), detail: false, metrics: [metric] };
  expect(metricKey(metric).length).toBeLessThanOrEqual(255);
  expect(compileQuery(q, extended).columns).toEqual([metricKey(metric)]);
  expect(() =>
    compileQuery(
      {
        ...q,
        dimensions: ["SALES_AMOUNT__SUM"],
        metrics: [{ field: "SALES_AMOUNT", aggregation: "SUM" }],
      },
      extended,
    ),
  ).toThrow("Duplicate result");
});

it("composes visible columns atomically and keeps numeric identifiers as row fields", () => {
  const q = composeColumns(
    initialQuery(source),
    source.fields,
    ["PRODUCT", "LOT_NO", "SALES_AMOUNT", "QUANTITY"],
    "auto",
  );
  expect(q.dimensions).toEqual(["PRODUCT", "LOT_NO"]);
  expect(q.metrics).toEqual([
    { field: "SALES_AMOUNT", aggregation: "SUM" },
    { field: "QUANTITY", aggregation: "SUM" },
  ]);
  expect(q.detail).toBe(false);
  const rows = composeColumns(
    initialQuery(source),
    source.fields,
    ["PRODUCT", "CUSTOMER"],
    "auto",
  );
  expect(rows.metrics).toEqual([
    { field: "PRODUCT", aggregation: "COUNT_ROWS" },
  ]);
  expect(() =>
    composeColumns(q, source.fields, ["PRODUCT", "QUANTITY"], "metric", "AVG"),
  ).toThrow("数値");
  expect(q.metrics).toHaveLength(2);
});

it("preserves filters and joins, deduplicates selections, caps both groups and supports ordering", () => {
  const q = {
    ...initialQuery(source),
    join: {
      tableId: "mine",
      sourceField: "PRODUCT",
      tableField: "c1",
      type: "left" as const,
    },
    filters: [{ field: "CUSTOMER", operator: "eq" as const, value: "A" }],
  };
  const result = composeColumns(
    q,
    source.fields,
    ["PRODUCT", "PRODUCT", "CUSTOMER"],
    "dimension",
  );
  expect(result.dimensions).toEqual(["PRODUCT", "CUSTOMER"]);
  expect(result.join).toEqual(q.join);
  expect(result.filters).toEqual(q.filters);
  expect(moveItem(result.dimensions, 1, 0)).toEqual(["CUSTOMER", "PRODUCT"]);
  expect(() =>
    composeColumns(q, source.fields, ["not-published"], "dimension"),
  ).toThrow("利用できません");
  expect(() =>
    composeColumns(
      {
        ...q,
        dimensions: Array.from({ length: 12 }, (_, i) => "existing" + i),
      },
      source.fields,
      ["PRODUCT"],
      "dimension",
    ),
  ).toThrow("12個");
});

it("does not invent combinations of semantic metrics and adds required dimensions", () => {
  const fields = [
    { ...source.fields[0], id: "date", semantic: "dimension" as const },
    { ...source.fields[1], id: "product", semantic: "dimension" as const },
    {
      ...source.fields[2],
      id: "running",
      semantic: "metric" as const,
      requiredDimensions: ["date"],
      compatibleDimensions: ["date"],
    },
  ];
  const q = composeColumns(initialQuery(source), fields, ["running"], "metric");
  expect(q.dimensions).toEqual(["date"]);
  expect(q.metrics[0].aggregation).toBe("SEMANTIC");
  expect(() => composeColumns(q, fields, ["product"], "dimension")).toThrow(
    "組み合わせられません",
  );
});

it("recomputes AVG and distinct counts at every subtotal grain, including genuine NULL keys", () => {
  const q: Query = {
    ...initialQuery(source),
    detail: false,
    dimensions: ["CUSTOMER", "PRODUCT"],
    metrics: [
      { field: "SALES_AMOUNT", aggregation: "AVG" },
      { field: "LOT_NO", aggregation: "COUNT_DISTINCT" },
      { field: "LOT_NO", aggregation: "COUNT_ROWS" },
    ],
    totals: "subtotals",
  };
  const data = [
    { CUSTOMER: "A", PRODUCT: "P", SALES_AMOUNT: 10, LOT_NO: 1 },
    { CUSTOMER: "A", PRODUCT: "P", SALES_AMOUNT: 30, LOT_NO: 2 },
    { CUSTOMER: "A", PRODUCT: "Q", SALES_AMOUNT: 100, LOT_NO: 1 },
    { CUSTOMER: "A", PRODUCT: null, SALES_AMOUNT: 60, LOT_NO: null },
    { CUSTOMER: null, PRODUCT: "R", SALES_AMOUNT: 200, LOT_NO: 3 },
  ];
  const result = executeMock(q, source, data);
  const subtotal = result.rows.findIndex(
    (r, i) => r.CUSTOMER === "A" && result.rowLevels![i] === 1,
  );
  expect(result.rows[subtotal]).toMatchObject({
    PRODUCT: null,
    SALES_AMOUNT__AVG: 50,
    LOT_NO__COUNT_DISTINCT: 2,
    LOT_NO__COUNT_ROWS: 4,
  });
  const actualNull = result.rows.findIndex(
    (r, i) =>
      r.CUSTOMER === "A" && r.PRODUCT === null && result.rowLevels![i] === 2,
  );
  expect(actualNull).toBeLessThan(subtotal);
  expect(result.rows[actualNull].SALES_AMOUNT__AVG).toBe(60);
  const csv = exportCsv(result);
  expect(csv).toContain('"行の種類"');
  expect(csv).toContain('"小計","A",""');
  expect(csv).toContain('"集計行","A",""');
  const c = compileQuery(q, source);
  expect(c.sql).toContain('GROUP BY ROLLUP("CUSTOMER", "PRODUCT")');
  expect(c.sql).toContain('GROUPING("PRODUCT")');
  expect(c.sql).toContain("COUNT(*)");
  expect(c.levelColumn).toBeTruthy();
  expect(c.columns).not.toContain(c.levelColumn);
});

it("returns exact grand totals independently of the current aggregate page", async () => {
  const q: Query = {
    ...initialQuery(source),
    detail: false,
    dimensions: ["LOT_NO"],
    metrics: [
      { field: "SALES_AMOUNT", aggregation: "AVG" },
      { field: "PRODUCT", aggregation: "COUNT_DISTINCT" },
      { field: "LOT_NO", aggregation: "COUNT_ROWS" },
    ],
    limit: 1,
    offset: 8,
  };
  const result = await runQuery(q);
  expect(result.rows).toHaveLength(1);
  const exact = executeMock({ ...q, dimensions: [], offset: 0 }, source)
    .rows[0];
  expect(result.grandTotal).toEqual(exact);
  expect(result.grandTotal?.LOT_NO__COUNT_ROWS).toBe(12000);
  expect(result.grandTotal?.PRODUCT__COUNT_DISTINCT).toBe(6);
  expect((await runQuery({ ...q, totals: "off" })).grandTotal).toBeUndefined();
});

it("rejects metric sorting within a subtotal hierarchy and semantic subtotal requests", () => {
  const q = {
    ...initialQuery(source),
    detail: false,
    dimensions: ["PRODUCT", "CUSTOMER"],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
    totals: "subtotals" as const,
  };
  expect(() =>
    compileQuery(
      { ...q, sort: [{ field: "QUANTITY__SUM", direction: "desc" }] },
      source,
    ),
  ).toThrow("行項目");
  expect(() =>
    compileQuery({ ...q, source: mockSources[5].id }, mockSources[5]),
  ).toThrow("小計");
});

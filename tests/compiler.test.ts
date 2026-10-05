import { describe, it, expect } from "vitest";
import { compileQuery, validateQuery, identifier } from "../lib/compiler";
import { mockSources, executeMock, defaultDataset } from "../lib/mock";
import {
  initialQuery,
  inferRole,
  validateDataset,
  savedSchema,
} from "../lib/model";
import { exportCsv } from "../lib/csv";
const s = mockSources[0];
const q = {
  ...initialQuery(s),
  detail: false,
  dimensions: ["PRODUCT"],
  metrics: [{ field: "SALES_AMOUNT", aggregation: "SUM" as const }],
};
describe("metadata and roles", () => {
  it("does not treat identifiers as measures", () => {
    expect(inferRole("LOT_NO", "NUMBER")).toBe("dimension");
    expect(inferRole("MACHINE_ID", "NUMBER")).toBe("dimension");
    expect(inferRole("YEAR", "NUMBER")).toBe("dimension");
    expect(inferRole("QUANTITY", "NUMBER")).toBe("metric");
  });
  it("allows numeric dimensions", () => {
    expect(
      validateQuery({ ...q, dimensions: ["LOT_NO"] }, s).dimensions,
    ).toEqual(["LOT_NO"]);
  });
});
describe("compiler trust boundary", () => {
  it("quotes metadata identifiers and binds hostile values", () => {
    const c = compileQuery(
      {
        ...q,
        filters: [
          { field: "PRODUCT", operator: "eq", value: "x';DROP TABLE t;--" },
        ],
      },
      s,
    );
    expect(c.sql).toContain('GROUP BY "PRODUCT"');
    expect(c.sql).not.toContain("DROP TABLE");
    expect(c.binds).toEqual(["x';DROP TABLE t;--"]);
    expect(c.sql).toContain("LIMIT 201");
  });
  it.each([
    { source: "unknown" },
    { dimensions: ["SQL;--"] },
    { metrics: [{ field: "PRODUCT", aggregation: "SUM" }] },
    { limit: 1001 },
    { offset: -1 },
    { sql: "SELECT 1" },
    { filters: [{ field: "QUANTITY", operator: "eq", value: "10" }] },
    { filters: [{ field: "ORDER_DATE", operator: "eq", value: "no date" }] },
    { filters: [{ field: "PRODUCT", operator: "LIKE", value: "x" }] },
    { metrics: [{ field: "QUANTITY", aggregation: "EVIL" }] },
    { sort: [{ field: "not output", direction: "asc" }] },
  ])("rejects malformed requests %j", (patch) => {
    expect(() => compileQuery({ ...q, ...patch }, s)).toThrow();
  });
  it("supports quoted names without injecting SQL", () =>
    expect(identifier('odd"name')).toBe('"odd""name"'));
  it("escapes wildcard patterns", () => {
    expect(
      compileQuery(
        {
          ...q,
          filters: [{ field: "PRODUCT", operator: "contains", value: "50%_" }],
        },
        s,
      ).binds,
    ).toEqual(["50\\%\\_"]);
  });
  it("uses native semantic metrics", () => {
    const semantic = mockSources[5];
    const c = compileQuery(
      {
        ...q,
        source: semantic.id,
        metrics: [{ field: "SALES_AMOUNT", aggregation: "SEMANTIC" }],
      },
      semantic,
    );
    expect(c.sql).toContain("SEMANTIC_VIEW(");
    expect(c.sql).toContain('"ORDERS"."SALES_AMOUNT"');
    expect(c.sql).not.toContain("SUM(");
  });
});
describe("mock execution and persistence contracts", () => {
  it("filters before aggregation and pages on server", () => {
    const result = executeMock(
      {
        ...q,
        filters: [
          { field: "PRODUCT", operator: "eq", value: "アクリル樹脂 A-100" },
        ],
      },
      s,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].SALES_AMOUNT__SUM).toBeGreaterThan(0);
    expect(executeMock({ ...initialQuery(s), limit: 10 }, s).rows).toHaveLength(
      10,
    );
  });
  it("round trips saved view JSON", () => {
    const view = { id: "saved-1", name: "test", query: q };
    expect(savedSchema.parse(JSON.parse(JSON.stringify(view))).query).toEqual(
      q,
    );
  });
  it("validates dataset fields and exposed view", () => {
    expect(validateDataset(defaultDataset(), s).name).toBe("受注実績");
    expect(() =>
      validateDataset(
        {
          ...defaultDataset(),
          fields: [
            { id: "unknown", label: "X", description: "", recommended: false },
          ],
        },
        s,
      ),
    ).toThrow();
  });
  it("neutralizes CSV formulas and quotes separators", () => {
    expect(
      exportCsv({
        columns: ["x"],
        rows: [{ x: "=1+1" }, { x: 'a,"b' }],
        elapsedMs: 1,
        hasMore: false,
      }),
    ).toContain('"\'=1+1"');
  });
});

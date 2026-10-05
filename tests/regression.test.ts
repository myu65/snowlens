import { describe, it, expect } from "vitest";
import { compileQuery } from "../lib/compiler";
import { mockSources, executeMock, defaultDataset } from "../lib/mock";
import { initialQuery, validateDataset } from "../lib/model";
const source = mockSources[0];
describe("aggregation and semantic grain regressions", () => {
  it("counts values and distinct values, with MIN/MAX/AVG/SUM", () => {
    const result = executeMock(
      {
        ...initialQuery(source),
        detail: false,
        metrics: [
          { field: "QUANTITY", aggregation: "COUNT" },
          { field: "PRODUCT", aggregation: "COUNT_DISTINCT" },
          { field: "QUANTITY", aggregation: "MIN" },
          { field: "QUANTITY", aggregation: "MAX" },
          { field: "QUANTITY", aggregation: "AVG" },
          { field: "QUANTITY", aggregation: "SUM" },
        ],
      },
      source,
    );
    const row = result.rows[0];
    expect(row.QUANTITY__COUNT).toBe(12000);
    expect(row.PRODUCT__COUNT_DISTINCT).toBe(6);
    expect(row.QUANTITY__MIN).toBe(50);
    expect(row.QUANTITY__MAX).toBe(999);
    expect(row.QUANTITY__AVG).toBeCloseTo(Number(row.QUANTITY__SUM) / 12000);
  });
  it("does not group by filter-only semantic dimensions", () => {
    const s = mockSources[5];
    const compiled = compileQuery(
      {
        ...initialQuery(s),
        detail: false,
        dimensions: ["PRODUCT"],
        metrics: [{ field: "SALES_AMOUNT", aggregation: "SEMANTIC" }],
        filters: [{ field: "REGION", operator: "eq", value: "東日本" }],
      },
      s,
    );
    expect(compiled.sql).toContain(
      'DIMENSIONS "ORDERS"."PRODUCT" AS "PRODUCT" METRICS',
    );
    expect(compiled.sql).not.toContain('DIMENSIONS "ORDERS"."REGION"');
    expect(compiled.sql).toContain('WHERE "ORDERS"."REGION" = ?');
    expect(compiled.columns).toEqual(["PRODUCT", "SALES_AMOUNT__SEMANTIC"]);
  });
  it("adds stable tie breakers when a metric is sorted", () => {
    const c = compileQuery(
      {
        ...initialQuery(source),
        detail: false,
        dimensions: ["PRODUCT"],
        metrics: [{ field: "QUANTITY", aggregation: "SUM" }],
        sort: [{ field: "QUANTITY__SUM", direction: "desc" }],
      },
      source,
    );
    expect(c.sql).toContain(
      'ORDER BY "QUANTITY__SUM" DESC NULLS LAST, "PRODUCT" ASC',
    );
  });
  it("rejects unpublished defaults and invalid drill candidates", () => {
    const d = defaultDataset();
    expect(() =>
      validateDataset(
        { ...d, fields: d.fields.filter((f) => f.id !== "SALES_AMOUNT") },
        source,
      ),
    ).toThrow();
    expect(() =>
      validateDataset({ ...d, drill: { PRODUCT: ["unknown"] } }, source),
    ).toThrow();
  });
});

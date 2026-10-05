import { afterEach, it, expect, vi } from "vitest";
import { resolveSource } from "../lib/provider";
import { compileQuery } from "../lib/compiler";
import { initialQuery } from "../lib/model";
afterEach(() => vi.unstubAllEnvs());
it("resolves a View from caller metadata and rejects arbitrary browser relations", async () => {
  vi.stubEnv("SNOWLENS_MODE", "snowflake");
  const statements: string[] = [];
  const exec = async (sql: string) => {
    statements.push(sql);
    if (sql.startsWith("SHOW VIEWS"))
      return [
        {
          database_name: "CHEM",
          schema_name: "SALES",
          name: "V",
          comment: "view",
        },
      ];
    if (sql.startsWith("SHOW COLUMNS"))
      return [{ column_name: "QUANTITY", data_type: '{"type":"FIXED"}' }];
    return [];
  };
  const s = await resolveSource(JSON.stringify(["CHEM", "SALES", "V"]), exec);
  expect(s.kind).toBe("view");
  expect(s.fields[0].type).toBe("NUMBER");
  expect(statements).toContain('SHOW COLUMNS IN VIEW "CHEM"."SALES"."V"');
  await expect(resolveSource("CHEM;DROP TABLE X", exec)).rejects.toThrow(
    "Source not accessible",
  );
});
it("loads semantic definitions, omits private metrics and compiles qualified aliases", async () => {
  vi.stubEnv("SNOWLENS_MODE", "snowflake");
  const exec = async (sql: string) => {
    if (sql.startsWith("SHOW SEMANTIC VIEWS"))
      return [{ database_name: "CHEM", schema_name: "SALES", name: "S" }];
    if (sql.startsWith("SHOW SEMANTIC DIMENSIONS"))
      return [{ name: "PRODUCT", table_name: "ORDERS", data_type: "VARCHAR" }];
    if (sql.startsWith("SHOW SEMANTIC METRICS"))
      return [
        {
          name: "REVENUE",
          table_name: "ORDERS",
          data_type: "NUMBER",
          is_private: false,
        },
        { name: "PRIVATE", table_name: "ORDERS", is_private: true },
      ];
    return [];
  };
  const s = await resolveSource(JSON.stringify(["CHEM", "SALES", "S"]), exec);
  expect(s.fields.map((f) => f.id)).toEqual([
    "ORDERS.PRODUCT",
    "ORDERS.REVENUE",
  ]);
  const c = compileQuery(
    {
      ...initialQuery(s),
      detail: false,
      dimensions: ["ORDERS.PRODUCT"],
      metrics: [{ field: "ORDERS.REVENUE", aggregation: "SEMANTIC" }],
    },
    s,
  );
  expect(c.sql).toContain('"ORDERS"."REVENUE" AS "ORDERS.REVENUE"');
});

import { describe, it, expect } from "vitest";
import { parseColumn, parseSource, callerToken } from "../lib/metadata";
describe("live metadata parsing", () => {
  it("keeps quoted qualified names unambiguous", () => {
    const s = parseSource(
      {
        database_name: "A.B",
        schema_name: 'odd"schema',
        name: "orders",
        rows: "42",
      },
      "dynamic_table",
    );
    expect(JSON.parse(s.id)).toEqual(["A.B", 'odd"schema', "orders"]);
    expect(s.rowCount).toBe(42);
  });
  it("maps Snowflake FIXED and TEXT to user-facing types", () => {
    expect(
      parseColumn({
        column_name: "QUANTITY",
        data_type: '{"type":"FIXED","precision":38}',
      }),
    ).toMatchObject({ type: "NUMBER", suggested: "metric" });
    expect(
      parseColumn({ column_name: "LOT_NO", data_type: { type: "FIXED" } }),
    ).toMatchObject({ type: "NUMBER", suggested: "dimension" });
    expect(
      parseColumn({ column_name: "PRODUCT", data_type: '{"type":"TEXT"}' })
        .type,
    ).toBe("VARCHAR");
  });
  it("fails on missing source metadata", () =>
    expect(() => parseSource({ name: "orders" }, "table")).toThrow());
  it("requires both rotating runtime and caller credentials", () => {
    expect(callerToken("service\n", "caller")).toBe("service.caller");
    expect(() => callerToken("service", null)).toThrow();
    expect(() => callerToken(null, "caller")).toThrow();
  });
});

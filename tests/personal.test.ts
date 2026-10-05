import { it, expect } from "vitest";
import {
  validatePersonalTable,
  parsePastedTable,
  personalFieldId,
} from "../lib/personal";
import {
  compileJoinedQuery,
  joinedSource,
  joinMockRows,
  validateJoin,
} from "../lib/personal-join";
import { compileQuery } from "../lib/compiler";
import {
  initialQuery,
  type PersonalTable,
  type PersonalJoin,
} from "../lib/model";
import { mockSources, mockRows, executeMock } from "../lib/mock";
const source = mockSources[0];
const table: PersonalTable = {
  id: "my-products",
  name: "個人分類",
  version: 1,
  columns: [
    { id: "product", label: "製品", type: "TEXT" },
    { id: "category", label: "分類", type: "TEXT" },
  ],
  rows: [
    ["アクリル樹脂 A-100", "重点"],
    ["unknown", "その他"],
  ],
};
const join: PersonalJoin = {
  tableId: table.id,
  sourceField: "PRODUCT",
  tableField: "product",
  type: "left",
};
const category = personalFieldId(table.id, "category");
it("parses spreadsheet paste with leading-zero codes, types and quoted multiline cells", () => {
  const parsed = parsePastedTable(
    'コード\t件数\t日付\t有効\t説明\n001\t2\t2026-10-05\ttrue\t"a\tb\nnext"\n002\t3\t2026-10-06\tfalse\t"say ""hi"""\n',
  );
  expect(parsed.columns.map((c) => c.type)).toEqual([
    "TEXT",
    "NUMBER",
    "DATE",
    "BOOLEAN",
    "TEXT",
  ]);
  expect(parsed.rows[0]).toEqual(["001", 2, "2026-10-05", true, "a\tb\nnext"]);
  expect(parsed.rows[1][4]).toBe('say "hi"');
  expect(() => parsePastedTable("a\tb\n1\n")).toThrow();
  expect(() => parsePastedTable('a\n"unterminated')).toThrow();
});
it("rejects malformed private table shapes, types, dates and oversized data", () => {
  expect(() => validatePersonalTable({ ...table, rows: [["x"]] })).toThrow(
    "列数",
  );
  expect(() => validatePersonalTable({ ...table, rows: [[123, "x"]] })).toThrow(
    "型",
  );
  expect(() =>
    validatePersonalTable({
      ...table,
      columns: [table.columns[0], table.columns[0]],
    }),
  ).toThrow("重複");
  expect(() =>
    validatePersonalTable({
      ...table,
      rows: Array.from({ length: 1001 }, () => ["x", "y"]),
    }),
  ).toThrow();
  expect(() =>
    validatePersonalTable({
      ...table,
      columns: [{ id: "date", label: "日付", type: "DATE" }],
      rows: [["2026-02-30"]],
    }),
  ).toThrow("型");
  expect(() =>
    validatePersonalTable({
      ...table,
      rows: Array.from({ length: 200 }, () => [
        "x".repeat(2000),
        "y".repeat(2000),
      ]),
    }),
  ).toThrow("500 KB");
});
it("rejects duplicate/null keys, incompatible types and semantic joins", () => {
  expect(() =>
    validateJoin(source, join, {
      ...table,
      rows: [
        ["x", "a"],
        ["x", "b"],
      ],
    }),
  ).toThrow("重複");
  expect(() =>
    validateJoin(source, join, { ...table, rows: [[null, "a"]] }),
  ).toThrow("空欄");
  expect(() =>
    validateJoin(source, { ...join, sourceField: "LOT_NO" }, table),
  ).toThrow("型");
  expect(() => validateJoin(mockSources[5], join, table)).toThrow("Table");
  expect(() =>
    validateJoin(source, { ...join, tableId: "someone-else" }, table),
  ).toThrow("アクセス");
});
it("binds all private values and retains explicit projection and filter order", () => {
  const hostile = { ...table, rows: [["x';DROP TABLE secrets;--", "group"]] };
  const q = {
    ...initialQuery(source),
    join,
    detail: false,
    dimensions: [category],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
    filters: [{ field: category, operator: "eq" as const, value: "group" }],
  };
  const compiled = compileJoinedQuery(q, source, hostile);
  expect(compiled.sql).toContain("LEFT JOIN");
  expect(compiled.sql).toContain("PARSE_JSON(?)");
  expect(compiled.sql).not.toContain("DROP TABLE");
  expect(compiled.binds).toEqual([JSON.stringify(hostile.rows), "group"]);
  expect(compiled.columns).toEqual([category, "QUANTITY__SUM"]);
  expect(() => compileQuery({ ...initialQuery(source), join }, source)).toThrow(
    "unresolved",
  );
});
it("left joins keep aggregate totals, inner joins retain matches and no page-local join occurs", () => {
  const data = mockRows(source);
  const left = joinMockRows(data, source, join, table);
  const inner = joinMockRows(data, source, { ...join, type: "inner" }, table);
  expect(left).toHaveLength(12000);
  expect(inner).toHaveLength(2000);
  const q = {
    ...initialQuery(source),
    join,
    detail: false,
    dimensions: [category],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
  };
  const grouped = executeMock(q, joinedSource(source, join, table), left);
  const sum = grouped.rows.reduce(
    (sum, row) => sum + Number(row.QUANTITY__SUM),
    0,
  );
  expect(sum).toBe(data.reduce((sum, row) => sum + Number(row.QUANTITY), 0));
  expect(grouped.rows.some((row) => row[category] === null)).toBe(true);
  const empty = joinMockRows(data, source, join, { ...table, rows: [] });
  expect(empty).toHaveLength(12000);
  expect(empty.every((row) => row[category] === null)).toBe(true);
});

it("preserves identifiers beyond JavaScript integer precision as text", () => {
  const parsed = parsePastedTable("コード\n9007199254740993");
  expect(parsed.columns[0].type).toBe("TEXT");
  expect(parsed.rows[0][0]).toBe("9007199254740993");
  expect(() =>
    validatePersonalTable({
      ...table,
      columns: [{ id: "n", label: "n", type: "NUMBER" }],
      rows: [[9007199254740992]],
    }),
  ).toThrow("大きな整数");
});

import { it, expect } from "vitest";
import { initialQuery, type QueryableSource } from "../lib/model";
import { mockSources, mockRows, executeMock } from "../lib/mock";
import {
  compileRelationQuery,
  relationFieldId,
  relationJoinedSource,
  joinRelationRows,
  mockRelationCounts,
  relationCountsSql,
} from "../lib/relation-join";
import {
  applyFieldOverrides,
  validateFieldOverrides,
} from "../lib/definitions";
import { semanticDraft } from "../lib/semantic-draft";
import { privateWrite } from "../lib/private-storage";
const left = mockSources[0],
  right = mockSources.at(-1)!;
const join = {
  rightSource: right.id,
  sourceField: "PRODUCT",
  rightField: "PRODUCT",
  type: "left" as const,
};
it("counts duplicate fanout without constructing a cartesian result", () => {
  const rows = [{ key: "a" }, { key: "a" }, { key: "b" }, { key: null }];
  const counts = mockRelationCounts(
    rows,
    [{ key: "a" }, { key: "a" }, { key: "c" }, { key: null }],
    { ...join, sourceField: "key", rightField: "key" },
  );
  expect(counts).toEqual({
    leftRows: 4,
    rightRows: 4,
    matchedRows: 2,
    unmatchedRows: 2,
    leftResultRows: 6,
    innerResultRows: 4,
    duplicateKeys: 1,
    nullKeys: 1,
  });
  expect(mockRelationCounts([], [], join).leftResultRows).toBe(0);
});
it("joins a physical lookup before grouping and preserves left totals", () => {
  const data = joinRelationRows(
    mockRows(left),
    mockRows(right),
    left,
    right,
    join,
  );
  const field = relationFieldId(right, "CATEGORY");
  const q = {
    ...initialQuery(left),
    join,
    detail: false,
    dimensions: [field],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
  };
  const result = executeMock(q, relationJoinedSource(left, right, join), data);
  expect(data).toHaveLength(12000);
  expect(result.rows.map((r) => r[field]).sort()).toEqual(["その他", "樹脂"]);
  expect(result.rows.reduce((sum, r) => sum + Number(r.QUANTITY__SUM), 0)).toBe(
    mockRows(left).reduce((sum, r) => sum + Number(r.QUANTITY), 0),
  );
  const compiled = compileRelationQuery(
    { ...q, filters: [{ field, operator: "eq" as const, value: "樹脂" }] },
    left,
    right,
  );
  expect(compiled.binds).toEqual(["樹脂"]);
  expect(compiled.columns).toEqual([field, "QUANTITY__SUM"]);
  expect(compiled.sql).toContain('"CHEM"."MASTER"."PRODUCTS"');
});
it("rejects duplicate lookup keys, invalid keys, semantic grain and type coercion", () => {
  expect(() =>
    joinRelationRows(
      mockRows(left),
      [{ PRODUCT: "x" }, { PRODUCT: "x" }],
      left,
      right,
      join,
    ),
  ).toThrow("重複");
  expect(() =>
    compileRelationQuery(
      { ...initialQuery(left), join: { ...join, sourceField: "hidden" } },
      left,
      right,
    ),
  ).toThrow("キー");
  expect(() =>
    compileRelationQuery(
      { ...initialQuery(left), join: { ...join, sourceField: "LOT_NO" } },
      left,
      right,
    ),
  ).toThrow("型");
  expect(() =>
    compileRelationQuery(
      { ...initialQuery(mockSources[5]), join },
      mockSources[5],
      right,
    ),
  ).toThrow("指標");
});
it("keeps joined IDs stable when metadata order changes and quotes identifiers", () => {
  const reordered = { ...right, fields: [...right.fields].reverse() };
  expect(relationFieldId(right, "CATEGORY")).toBe(
    relationFieldId(reordered, "CATEGORY"),
  );
  const hostile: QueryableSource = {
    ...right,
    name: 'lookup"; DROP TABLE x;--',
  };
  expect(relationCountsSql(left, hostile, join)).toContain(
    '"lookup""; DROP TABLE x;--"',
  );
});
it("private labels never add fields or change their types and scopes", () => {
  const overrides = [
    { id: "PRODUCT", label: "自分の製品名", description: "個人の説明" },
  ];
  validateFieldOverrides(overrides, left.fields);
  const fields = applyFieldOverrides(left.fields, overrides);
  expect(fields[1].label).toBe("自分の製品名");
  expect(fields[1].type).toBe(left.fields[1].type);
  expect(() =>
    validateFieldOverrides([...overrides, ...overrides], left.fields),
  ).toThrow("重複");
  expect(() =>
    validateFieldOverrides([{ ...overrides[0], id: "hidden" }], left.fields),
  ).toThrow("利用できない");
  expect(
    applyFieldOverrides(left.fields, [{ ...overrides[0], id: "hidden" }]),
  ).toHaveLength(left.fields.length);
});
it("private storage accepts only scoped procedures with bound payloads", () => {
  const write = privateWrite(
    "personal",
    "id",
    { rows: [["';DROP TABLE secrets;--"]] },
    2,
  );
  expect(write.sql).toBe(
    'CALL "SNOWFLAKE_APPS"."APP"."WRITE_PRIVATE_STATE"(?, ?, ?, ?)',
  );
  expect(write.sql).not.toContain("DROP");
  expect(write.binds).toEqual([
    "personal",
    "id",
    JSON.stringify({ rows: [["';DROP TABLE secrets;--"]] }),
    2,
  ]);
  expect(() => privateWrite("dataset", "id", {})).toThrow("Unsupported");
});

it("checks lookup uniqueness within the query snapshot and uses the same exact text equality for preview and publication", () => {
  const compiled = compileRelationQuery(
    { ...initialQuery(left), join },
    left,
    right,
  );
  expect(compiled.validationColumn).toBeTruthy();
  expect(compiled.columns).not.toContain(compiled.validationColumn);
  expect(compiled.sql).toContain('"__snowlens_right" AS');
  expect(compiled.sql).toContain("HAVING COUNT(*)>1");
  expect(compiled.sql).toContain(
    `COLLATE(l."PRODUCT", '') = COLLATE(r."PRODUCT", '')`,
  );
  expect(relationCountsSql(left, right, join)).toContain(
    `COLLATE("PRODUCT", '') k`,
  );
});

it("exports selected model definitions without private input, filter values, grants or replacements", () => {
  const category = relationFieldId(right, "CATEGORY");
  const q = {
    ...initialQuery(left),
    join,
    detail: false,
    dimensions: [category],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
    filters: [
      {
        field: "CUSTOMER",
        operator: "eq" as const,
        value: "private-secret-filter",
      },
    ],
  };
  const draft = semanticDraft(
    q,
    left,
    ["PUBLIC_DB", "ANALYTICS", "MODEL"],
    right,
  );
  expect(draft.sql).toContain(
    'CREATE VIEW "PUBLIC_DB"."ANALYTICS"."MODEL__BASE"',
  );
  expect(draft.sql).toContain(
    'CREATE SEMANTIC VIEW "PUBLIC_DB"."ANALYTICS"."MODEL"',
  );
  expect(draft.sql).toContain("LEFT JOIN");
  expect(draft.sql).toContain('SUM(joined."fact_1")');
  expect(draft.sql).not.toContain("private-secret-filter");
  expect(draft.sql).not.toContain("OR REPLACE");
  expect(draft.sql).not.toMatch(/^GRANT /m);
  expect(draft.selectedFields).toEqual([category, "QUANTITY"]);
  expect(() =>
    semanticDraft(
      {
        ...q,
        join: {
          tableId: "private",
          sourceField: "PRODUCT",
          tableField: "c1",
          type: "left",
        },
      },
      left,
      ["DB", "S", "V"],
    ),
  ).toThrow("共有入力");
});

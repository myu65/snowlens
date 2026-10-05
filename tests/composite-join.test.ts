import { afterEach, expect, it, vi } from "vitest";
import {
  initialQuery,
  querySchema,
  relationJoinSchema,
  savedSchema,
  type QueryableSource,
  type RelationJoin,
  type Value,
} from "../lib/model";
import { executeMock, mockSources } from "../lib/mock";
import {
  compileRelationCounts,
  compileRelationQuery,
  joinRelationRows,
  mockRelationCounts,
  relationFieldId,
  relationJoinedSource,
  relationJoinKeys,
} from "../lib/relation-join";
import { semanticDraft } from "../lib/semantic-draft";
import { runQueryWithContext } from "../lib/provider";

const left: QueryableSource = {
  ...mockSources[0],
  fields: mockSources[0].fields.filter((f) =>
    ["PRODUCT", "MACHINE_ID", "QUANTITY", "ORDER_DATE"].includes(f.id),
  ),
};
const right = mockSources.find((s) => s.name === "PRODUCT_TARGETS")!;
const join: RelationJoin = {
  rightSource: right.id,
  type: "left",
  keys: [
    { sourceField: "PRODUCT", rightField: "PRODUCT" },
    { sourceField: "MACHINE_ID", rightField: "MACHINE_ID" },
  ],
};
const leftRows = [
  { PRODUCT: "a", MACHINE_ID: 1, QUANTITY: 5 },
  { PRODUCT: "a", MACHINE_ID: 2, QUANTITY: 7 },
  { PRODUCT: "b", MACHINE_ID: 1, QUANTITY: 3 },
  { PRODUCT: null, MACHINE_ID: 1, QUANTITY: 11 },
  { PRODUCT: "a", MACHINE_ID: null, QUANTITY: 13 },
];
const rightRows = [
  { PRODUCT: "a", MACHINE_ID: 1, YEAR: 2025, TARGET: 99 },
  { PRODUCT: "a", MACHINE_ID: 1, YEAR: 2026, TARGET: 10 },
  { PRODUCT: "a", MACHINE_ID: 2, YEAR: 2026, TARGET: 20 },
  { PRODUCT: "b", MACHINE_ID: 1, YEAR: 2025, TARGET: 30 },
  { PRODUCT: null, MACHINE_ID: 1, YEAR: 2026, TARGET: 40 },
  { PRODUCT: null, MACHINE_ID: 1, YEAR: 2026, TARGET: 50 },
];
const scoped: RelationJoin = {
  ...join,
  rightFilters: [{ field: "YEAR", operator: "eq", value: 2026 }],
};
afterEach(() => vi.unstubAllEnvs());

it("counts full tuples, excludes any NULL component and applies node filters before counting", () => {
  expect(mockRelationCounts(leftRows, rightRows, join)).toMatchObject({
    duplicateKeys: 1,
    nullKeys: 2,
    matchedRows: 3,
    leftResultRows: 6,
    innerResultRows: 4,
  });
  expect(mockRelationCounts(leftRows, rightRows, scoped)).toEqual({
    leftRows: 5,
    rightRows: 4,
    matchedRows: 2,
    unmatchedRows: 3,
    leftResultRows: 5,
    innerResultRows: 2,
    duplicateKeys: 0,
    nullKeys: 2,
  });
  expect(
    mockRelationCounts(leftRows, rightRows, {
      ...scoped,
      leftFilters: [{ field: "QUANTITY", operator: "gte", value: 7 }],
    }),
  ).toMatchObject({
    leftRows: 3,
    matchedRows: 1,
    unmatchedRows: 2,
    leftResultRows: 3,
  });
  expect(mockRelationCounts([], rightRows, scoped)).toMatchObject({
    leftRows: 0,
    rightRows: 4,
    leftResultRows: 0,
  });
  expect(mockRelationCounts(leftRows, [], scoped)).toMatchObject({
    leftResultRows: 5,
    innerResultRows: 0,
  });
});

it("preserves LEFT totals with right prefilters, while result filters and INNER deliberately remove unmatched rows", () => {
  const field = relationFieldId(right, "TARGET");
  const data = joinRelationRows(leftRows, rightRows, left, right, scoped);
  expect(data.map((r) => r[field])).toEqual([10, 20, null, null, null]);
  const query = {
    ...initialQuery(left),
    join: scoped,
    detail: false,
    dimensions: [],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
  };
  const source = relationJoinedSource(left, right, scoped);
  expect(executeMock(query, source, data).rows[0].QUANTITY__SUM).toBe(39);
  expect(
    executeMock(
      { ...query, filters: [{ field, operator: "not_null", value: null }] },
      source,
      data,
    ).rows[0].QUANTITY__SUM,
  ).toBe(12);
  expect(
    joinRelationRows(leftRows, rightRows, left, right, {
      ...scoped,
      type: "inner",
    }),
  ).toHaveLength(2);
  expect(() =>
    joinRelationRows(leftRows, rightRows, left, right, join),
  ).toThrow("重複");
});

it("binds left, right and post-join conditions in SQL order and guards the complete filtered tuple in the statement snapshot", () => {
  const joinWithFilters = {
    ...scoped,
    leftFilters: [{ field: "QUANTITY", operator: "gte" as const, value: 7 }],
  };
  const query = {
    ...initialQuery(left),
    join: joinWithFilters,
    filters: [
      { field: "PRODUCT", operator: "eq" as const, value: "private'--value" },
    ],
  };
  const compiled = compileRelationQuery(query, left, right);
  expect(compiled.binds).toEqual([7, 2026, "private'--value"]);
  expect(compiled.sql).toContain('"__snowlens_left" AS (SELECT');
  expect(compiled.sql).toContain('WHERE "QUANTITY" >= ?)');
  expect(compiled.sql).toContain('WHERE "YEAR" = ?)');
  expect(compiled.sql).toContain(
    `COLLATE(l."PRODUCT", '') = COLLATE(r."PRODUCT", '') AND l."MACHINE_ID" = r."MACHINE_ID"`,
  );
  expect(compiled.sql).toContain("GROUP BY 1, 2 HAVING COUNT(*)>1");
  expect(compiled.sql).not.toContain("private'--value");
  const counts = compileRelationCounts(left, right, joinWithFilters);
  expect(counts.binds).toEqual([7, 2026]);
  expect(counts.sql).toContain("FROM l LEFT JOIN r ON l.k1=r.k1 AND l.k2=r.k2");
  expect(counts.sql).toContain("k1 IS NULL OR k2 IS NULL");
  expect(counts.sql).toContain("k1 IS NOT NULL AND k2 IS NOT NULL AND n>1");
});

it("keeps tuple components distinct without separator concatenation, normalisation or lossy type coercion", () => {
  const textSource = {
    ...right,
    fields: right.fields.map((f) =>
      f.id === "MACHINE_ID" ? { ...f, type: "VARCHAR" } : f,
    ),
  };
  const rows: Record<string, Value>[] = [
    { PRODUCT: "a|b", MACHINE_ID: "c", TARGET: 10 },
    { PRODUCT: "a", MACHINE_ID: "b|c", TARGET: 20 },
    { PRODUCT: "A", MACHINE_ID: "b|c", TARGET: 30 },
    { PRODUCT: "a ", MACHINE_ID: "b|c", TARGET: 40 },
  ];
  const data = joinRelationRows(rows, rows, textSource, textSource, join);
  expect(data.map((r) => r[relationFieldId(textSource, "TARGET")])).toEqual([
    10, 20, 30, 40,
  ]);
  expect(mockRelationCounts(rows, rows, join).duplicateKeys).toBe(0);
  const reversed = { ...join, keys: [...relationJoinKeys(join)].reverse() };
  expect(
    joinRelationRows(rows, rows, textSource, textSource, reversed),
  ).toEqual(data);
});

it("rejects incomplete, excessive, repeated or ambiguous key definitions and untrusted node filters", () => {
  expect(relationJoinSchema.safeParse({ ...join, keys: [] }).success).toBe(
    false,
  );
  expect(
    relationJoinSchema.safeParse({
      ...join,
      keys: Array.from({ length: 13 }, (_, i) => ({
        sourceField: "l" + i,
        rightField: "r" + i,
      })),
    }).success,
  ).toBe(false);
  expect(
    relationJoinSchema.safeParse({
      ...join,
      keys: [...relationJoinKeys(join), relationJoinKeys(join)[0]],
    }).success,
  ).toBe(false);
  expect(
    relationJoinSchema.safeParse({
      ...join,
      sourceField: "PRODUCT",
      rightField: "PRODUCT",
    }).success,
  ).toBe(false);
  expect(
    relationJoinSchema.safeParse({
      ...join,
      keys: [{ sourceField: "PRODUCT", rightField: "" }],
    }).success,
  ).toBe(false);
  expect(
    relationJoinSchema.safeParse({
      ...join,
      rightFilters: [
        { field: "YEAR", operator: "eq", value: 2026, sql: "1=1" },
      ],
    }).success,
  ).toBe(false);
  for (const invalid of [
    {
      ...join,
      leftFilters: [
        { field: "NOT_PUBLISHED", operator: "eq" as const, value: "secret" },
      ],
    },
    {
      ...join,
      rightFilters: [
        { field: "YEAR", operator: "eq" as const, value: "not a number" },
      ],
    },
    { ...join, keys: [{ sourceField: "MACHINE_ID", rightField: "PRODUCT" }] },
  ])
    expect(() => compileRelationCounts(left, right, invalid)).toThrow();
});

it("quotes fresh metadata identifiers and binds literal contains values for prefilters", () => {
  const hostile = { ...right, name: 'targets"; DROP TABLE x;--' };
  const filtered = {
    ...join,
    rightFilters: [
      { field: "PRODUCT", operator: "contains" as const, value: "%_'secret\\" },
    ],
  };
  const compiled = compileRelationCounts(left, hostile, filtered);
  expect(compiled.sql).toContain('"targets""; DROP TABLE x;--"');
  expect(compiled.sql).toContain('"PRODUCT" ILIKE');
  expect(compiled.sql).not.toContain("secret");
  expect(compiled.binds).toEqual(["\\%\\_'secret\\\\"]);
});

it("reopens existing single-key definitions and preserves new keys and both node conditions in private recipes", () => {
  const legacy = {
    rightSource: right.id,
    sourceField: "PRODUCT",
    rightField: "PRODUCT",
    type: "left" as const,
  };
  const saved = (join: RelationJoin) => ({
    id: "recipe",
    name: "個人の結合",
    query: { ...initialQuery(left), join },
  });
  expect(savedSchema.parse(saved(legacy)).query.join).toEqual(legacy);
  expect(relationJoinKeys(legacy)).toEqual([
    { sourceField: "PRODUCT", rightField: "PRODUCT" },
  ]);
  const filters = {
    ...scoped,
    leftFilters: [{ field: "QUANTITY", operator: "gte" as const, value: 7 }],
  };
  expect(
    savedSchema.parse(JSON.parse(JSON.stringify(saved(filters)))).query.join,
  ).toEqual(filters);
  expect(querySchema.safeParse(saved(filters).query).success).toBe(true);
});

it("publishes all key equalities but refuses to omit or embed private pre-join conditions", () => {
  const query = {
    ...initialQuery(left),
    join,
    detail: false,
    dimensions: ["PRODUCT"],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
  };
  expect(semanticDraft(query, left, ["DB", "S", "V"], right).sql).toContain(
    `COLLATE(l."PRODUCT", '') = COLLATE(r."PRODUCT", '') AND l."MACHINE_ID" = r."MACHINE_ID"`,
  );
  for (const filter of [
    { ...scoped },
    {
      ...join,
      leftFilters: [{ field: "QUANTITY", operator: "gte" as const, value: 7 }],
    },
  ])
    expect(() =>
      semanticDraft({ ...query, join: filter }, left, ["DB", "S", "V"], right),
    ).toThrow("対象範囲を共有Viewで定義");
});

it("the provider rechecks filtered tuple uniqueness, totals and fresh source field scope for query and export", async () => {
  vi.stubEnv("SNOWLENS_MODE", "mock");
  vi.stubEnv("SNOWLENS_MOCK_FILE", "artifacts/composite-unit-missing.json");
  const source = mockSources[0];
  const query = {
    ...initialQuery(source),
    join: scoped,
    detail: false,
    dimensions: [],
    metrics: [{ field: "QUANTITY", aggregation: "SUM" as const }],
  };
  const context = await runQueryWithContext(query);
  expect(context.joinSource?.id).toBe(right.id);
  expect(context.result.rows[0].QUANTITY__SUM).toBe(6288300);
  await expect(runQueryWithContext({ ...query, join })).rejects.toThrow("重複");
  await expect(
    runQueryWithContext({
      ...query,
      join: {
        ...scoped,
        rightFilters: [{ field: "NOT_REAL", operator: "eq", value: 1 }],
      },
    }),
  ).rejects.toThrow();
});

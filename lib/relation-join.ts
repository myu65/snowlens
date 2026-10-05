import {
  compileQuery,
  compileFilterPredicates,
  validateQuery,
  identifier,
  relation,
} from "./compiler";
import {
  isNumeric,
  initialQuery,
  relationJoinSchema,
  type Query,
  type QueryableSource,
  type RelationJoin,
  type Value,
} from "./model";
import { filterMockRows } from "./mock";

export function relationJoinKeys(join: RelationJoin) {
  return "keys" in join
    ? join.keys
    : [{ sourceField: join.sourceField, rightField: join.rightField }];
}
export function relationJoinCondition(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  return relationJoinKeys(join)
    .map(
      (k) =>
        `${relationKey(left, k.sourceField, "l")} = ${relationKey(right, k.rightField, "r")}`,
    )
    .join(" AND ");
}
function tupleKey(row: Record<string, Value>, fields: string[]) {
  const values = fields.map((f) => row[f]);
  return values.some((v) => v == null) ? null : JSON.stringify(values);
}
function joinInputs(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  const inputs = [left, right].map((source, i) => {
    const filters = (i === 0 ? join.leftFilters : join.rightFilters) || [];
    validateQuery({ ...initialQuery(source), filters }, source);
    const { predicates, binds } = compileFilterPredicates(filters, identifier);
    return {
      sql: `SELECT ${source.fields.map((f) => identifier(f.id)).join(", ")} FROM ${relation(source)}${predicates.length ? " WHERE " + predicates.join(" AND ") : ""}`,
      binds,
    };
  });
  return {
    ctes: `"__snowlens_left" AS (${inputs[0].sql}), "__snowlens_right" AS (${inputs[1].sql})`,
    binds: inputs.flatMap((input) => input.binds),
  };
}

function hash(value: string) {
  let result = 2166136261;
  for (const char of value)
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0).toString(16);
}
export function relationFieldId(source: QueryableSource, field: string) {
  return `__joined_${hash(source.id)}_${hash(field)}_${field.slice(0, 100)}`;
}
export function relationKey(
  source: QueryableSource,
  field: string,
  alias?: string,
) {
  const metadata = source.fields.find((f) => f.id === field);
  if (!metadata) throw Error("結合キーが見つかりません。");
  const column = (alias ? alias + "." : "") + identifier(metadata.id);
  return /CHAR|TEXT|STRING/i.test(metadata.type)
    ? `COLLATE(${column}, '')`
    : column;
}
function keyType(type: string) {
  if (isNumeric({ type } as QueryableSource["fields"][number])) return "NUMBER";
  return /CHAR|TEXT|STRING/i.test(type)
    ? "TEXT"
    : /^(DATE|BOOLEAN)$/i.test(type)
      ? type.toUpperCase()
      : undefined;
}
export function validateRelationJoin(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  relationJoinSchema.parse(join);
  if (left.kind === "semantic_view" || right.kind === "semantic_view")
    throw Error(
      "結合にはTable / View / Dynamic Tableを選んでください。セマンティック指標の粒度は別途定義が必要です。",
    );
  if (join.rightSource !== right.id)
    throw Error("結合先にアクセスできません。");
  for (const key of relationJoinKeys(join)) {
    const l = left.fields.find((f) => f.id === key.sourceField),
      r = right.fields.find((f) => f.id === key.rightField);
    if (!l || !r) throw Error("結合キーが見つかりません。");
    if (!keyType(l.type) || keyType(l.type) !== keyType(r.type))
      throw Error("結合キーの型をそろえてください。");
  }
  validateQuery(
    { ...initialQuery(left), filters: join.leftFilters || [] },
    left,
  );
  validateQuery(
    { ...initialQuery(right), filters: join.rightFilters || [] },
    right,
  );
  const ids = [
    ...left.fields.map((f) => f.id),
    ...right.fields.map((f) => relationFieldId(right, f.id)),
  ];
  if (new Set(ids).size !== ids.length)
    throw Error("結合項目の名前が重複しています。");
}
export function relationJoinedSource(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
): QueryableSource {
  validateRelationJoin(left, right, join);
  return {
    ...left,
    fields: [
      ...left.fields,
      ...right.fields.map((f) => ({
        ...f,
        id: relationFieldId(right, f.id),
        label: `${right.name} · ${f.label}`,
        category: "結合先",
      })),
    ],
  };
}
export function compileRelationQuery(
  q: Query,
  left: QueryableSource,
  right: QueryableSource,
) {
  if (!q.join || !("rightSource" in q.join))
    throw Error("テーブル結合の設定がありません。");
  const join = q.join;
  const source = relationJoinedSource(left, right, join);
  const projection = [
    ...left.fields.map((f) => `l.${identifier(f.id)} AS ${identifier(f.id)}`),
    ...right.fields.map(
      (f) =>
        `r.${identifier(f.id)} AS ${identifier(relationFieldId(right, f.id))}`,
    ),
  ];
  const inputs = joinInputs(left, right, join);
  const from = `(SELECT ${projection.join(", ")} FROM "__snowlens_left" l ${join.type === "left" ? "LEFT" : "INNER"} JOIN "__snowlens_right" r ON ${relationJoinCondition(left, right, join)}) AS "SNOWLENS_JOIN"`;
  const compiled = compileQuery(q, source, { from, binds: inputs.binds });
  let validationColumn = "__snowlens_join_check";
  while ([...compiled.columns, compiled.levelColumn].includes(validationColumn))
    validationColumn += "_";
  const keys = relationJoinKeys(join).map((k) =>
    relationKey(right, k.rightField),
  );
  const check = `(SELECT COUNT(*) FROM (SELECT ${keys.join(", ")} FROM "__snowlens_right" WHERE ${keys.map((key) => `${key} IS NOT NULL`).join(" AND ")} GROUP BY ${keys.map((_, i) => i + 1).join(", ")} HAVING COUNT(*)>1)) AS ${identifier(validationColumn)}`;
  // Check and result share one statement snapshot. A changed lookup never inflates displayed values.
  return {
    ...compiled,
    validationColumn,
    sql:
      `WITH ${inputs.ctes} ` +
      compiled.sql.replace(/^SELECT /, "SELECT " + check + ", "),
  };
}
export type JoinCounts = {
  leftRows: number;
  rightRows: number;
  matchedRows: number;
  unmatchedRows: number;
  leftResultRows: number;
  innerResultRows: number;
  duplicateKeys: number;
  nullKeys: number;
};
export function compileRelationCounts(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  validateRelationJoin(left, right, join);
  const pairs = relationJoinKeys(join),
    inputs = joinInputs(left, right, join);
  const aliases = pairs.map((_, i) => (pairs.length === 1 ? "k" : `k${i + 1}`));
  const group = pairs.map((_, i) => i + 1).join(", ");
  const lkeys = pairs
    .map((k, i) => `${relationKey(left, k.sourceField)} ${aliases[i]}`)
    .join(", ");
  const rkeys = pairs
    .map((k, i) => `${relationKey(right, k.rightField)} ${aliases[i]}`)
    .join(", ");
  return {
    binds: inputs.binds,
    sql: `WITH ${inputs.ctes}, l AS (SELECT ${lkeys}, COUNT(*) n FROM "__snowlens_left" GROUP BY ${group}), r AS (SELECT ${rkeys}, COUNT(*) n FROM "__snowlens_right" GROUP BY ${group})
SELECT COALESCE((SELECT SUM(n) FROM l),0) "leftRows", COALESCE((SELECT SUM(n) FROM r),0) "rightRows",
COALESCE(SUM(IFF(r.n IS NOT NULL,l.n,0)),0) "matchedRows", COALESCE(SUM(IFF(r.n IS NULL,l.n,0)),0) "unmatchedRows",
COALESCE(SUM(l.n*GREATEST(COALESCE(r.n,0),1)),0) "leftResultRows", COALESCE(SUM(l.n*COALESCE(r.n,0)),0) "innerResultRows",
(SELECT COUNT(*) FROM r WHERE ${aliases.map((k) => `${k} IS NOT NULL`).join(" AND ")} AND n>1) "duplicateKeys", COALESCE((SELECT SUM(n) FROM r WHERE ${aliases.map((k) => `${k} IS NULL`).join(" OR ")}),0) "nullKeys"
FROM l LEFT JOIN r ON ${aliases.map((k) => `l.${k}=r.${k}`).join(" AND ")}`,
  };
}
export function relationCountsSql(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  return compileRelationCounts(left, right, join).sql;
}
export function mockRelationCounts(
  left: Record<string, Value>[],
  right: Record<string, Value>[],
  join: RelationJoin,
): JoinCounts {
  const keys = relationJoinKeys(join);
  left = filterMockRows(left, join.leftFilters || []);
  right = filterMockRows(right, join.rightFilters || []);
  const lookup = new Map<string | null, number>();
  for (const r of right) {
    const key = tupleKey(
      r,
      keys.map((k) => k.rightField),
    );
    lookup.set(key, (lookup.get(key) || 0) + 1);
  }
  let matchedRows = 0,
    leftResultRows = 0,
    innerResultRows = 0;
  for (const row of left) {
    const key = tupleKey(
        row,
        keys.map((k) => k.sourceField),
      ),
      matches = key == null ? 0 : lookup.get(key) || 0;
    if (matches) matchedRows++;
    leftResultRows += Math.max(matches, 1);
    innerResultRows += matches;
  }
  return {
    leftRows: left.length,
    rightRows: right.length,
    matchedRows,
    unmatchedRows: left.length - matchedRows,
    leftResultRows,
    innerResultRows,
    duplicateKeys: [...lookup].filter(([key, n]) => key != null && n > 1)
      .length,
    nullKeys: lookup.get(null) || 0,
  };
}
export function joinRelationRows(
  rows: Record<string, Value>[],
  rightRows: Record<string, Value>[],
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  validateRelationJoin(left, right, join);
  const keys = relationJoinKeys(join);
  const lookup = new Map<string, Record<string, Value>>();
  for (const row of filterMockRows(rightRows, join.rightFilters || [])) {
    const key = tupleKey(
      row,
      keys.map((k) => k.rightField),
    );
    if (key == null) continue;
    if (lookup.has(key))
      throw Error(
        "結合先のキーが重複しています。重複がないキーやViewを選んでください。",
      );
    lookup.set(key, row);
  }
  return filterMockRows(rows, join.leftFilters || []).flatMap((row) => {
    const key = tupleKey(
      row,
      keys.map((k) => k.sourceField),
    );
    const match = key === null ? undefined : lookup.get(key);
    if (!match && join.type === "inner") return [];
    return [
      {
        ...row,
        ...Object.fromEntries(
          right.fields.map((f) => [
            relationFieldId(right, f.id),
            match?.[f.id] ?? null,
          ]),
        ),
      },
    ];
  });
}

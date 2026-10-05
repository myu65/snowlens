import { compileQuery, identifier, relation } from "./compiler";
import {
  isNumeric,
  type Query,
  type QueryableSource,
  type RelationJoin,
  type Value,
} from "./model";

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
  if (left.kind === "semantic_view" || right.kind === "semantic_view")
    throw Error(
      "結合にはTable / View / Dynamic Tableを選んでください。セマンティック指標の粒度は別途定義が必要です。",
    );
  if (join.rightSource !== right.id)
    throw Error("結合先にアクセスできません。");
  const l = left.fields.find((f) => f.id === join.sourceField),
    r = right.fields.find((f) => f.id === join.rightField);
  if (!l || !r) throw Error("結合キーが見つかりません。");
  if (!keyType(l.type) || keyType(l.type) !== keyType(r.type))
    throw Error("結合キーの型をそろえてください。");
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
  const from = `(SELECT ${projection.join(", ")} FROM ${relation(left)} l ${join.type === "left" ? "LEFT" : "INNER"} JOIN "__snowlens_right" r ON ${relationKey(left, join.sourceField, "l")} = ${relationKey(right, join.rightField, "r")}) AS "SNOWLENS_JOIN"`;
  const compiled = compileQuery(q, source, { from, binds: [] });
  let validationColumn = "__snowlens_join_check";
  while ([...compiled.columns, compiled.levelColumn].includes(validationColumn))
    validationColumn += "_";
  const key = relationKey(right, join.rightField);
  const check = `(SELECT COUNT(*) FROM (SELECT ${key} FROM "__snowlens_right" WHERE ${key} IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1)) AS ${identifier(validationColumn)}`;
  // Check and result share one statement snapshot. A changed lookup never inflates displayed values.
  return {
    ...compiled,
    validationColumn,
    sql:
      `WITH "__snowlens_right" AS (SELECT ${right.fields.map((f) => identifier(f.id)).join(", ")} FROM ${relation(right)}) ` +
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
export function relationCountsSql(
  left: QueryableSource,
  right: QueryableSource,
  join: RelationJoin,
) {
  validateRelationJoin(left, right, join);
  return `WITH l AS (SELECT ${relationKey(left, join.sourceField)} k, COUNT(*) n FROM ${relation(left)} GROUP BY 1), r AS (SELECT ${relationKey(right, join.rightField)} k, COUNT(*) n FROM ${relation(right)} GROUP BY 1)
SELECT COALESCE((SELECT SUM(n) FROM l),0) "leftRows", COALESCE((SELECT SUM(n) FROM r),0) "rightRows",
COALESCE(SUM(IFF(r.n IS NOT NULL,l.n,0)),0) "matchedRows", COALESCE(SUM(IFF(r.n IS NULL,l.n,0)),0) "unmatchedRows",
COALESCE(SUM(l.n*GREATEST(COALESCE(r.n,0),1)),0) "leftResultRows", COALESCE(SUM(l.n*COALESCE(r.n,0)),0) "innerResultRows",
(SELECT COUNT(*) FROM r WHERE k IS NOT NULL AND n>1) "duplicateKeys", COALESCE((SELECT SUM(n) FROM r WHERE k IS NULL),0) "nullKeys"
FROM l LEFT JOIN r ON l.k=r.k`;
}
export function mockRelationCounts(
  left: Record<string, Value>[],
  right: Record<string, Value>[],
  join: RelationJoin,
): JoinCounts {
  const lookup = new Map<Value, number>();
  for (const r of right)
    lookup.set(r[join.rightField], (lookup.get(r[join.rightField]) || 0) + 1);
  let matchedRows = 0,
    leftResultRows = 0,
    innerResultRows = 0;
  for (const row of left) {
    const key = row[join.sourceField],
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
  const lookup = new Map<Value, Record<string, Value>>();
  for (const row of rightRows) {
    const key = row[join.rightField];
    if (key == null) continue;
    if (lookup.has(key))
      throw Error(
        "結合先のキーが重複しています。重複がないキーやViewを選んでください。",
      );
    lookup.set(key, row);
  }
  return rows.flatMap((row) => {
    const match =
      row[join.sourceField] == null
        ? undefined
        : lookup.get(row[join.sourceField]);
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

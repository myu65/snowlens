import { compileQuery, identifier, relation } from "./compiler";
import {
  type PersonalTable,
  type PersonalJoin,
  type QueryableSource,
  type Query,
  type Value,
  isNumeric,
} from "./model";
import {
  validatePersonalTable,
  personalFields,
  personalFieldId,
} from "./personal";

export const matchField = "__snowlens_personal_match";
export function validateJoin(
  source: QueryableSource,
  join: PersonalJoin,
  input: PersonalTable,
) {
  const table = validatePersonalTable(input);
  if (source.kind === "semantic_view")
    throw Error(
      "個人テーブルの結合にはTable / View / Dynamic Tableを開いてください。",
    );
  if (table.id !== join.tableId)
    throw Error("個人テーブルにアクセスできません。");
  const field = source.fields.find((f) => f.id === join.sourceField);
  const index = table.columns.findIndex((c) => c.id === join.tableField);
  if (!field || index < 0) throw Error("結合キーが見つかりません。");
  const expected = isNumeric(field)
    ? "NUMBER"
    : /^DATE$/i.test(field.type)
      ? "DATE"
      : /^BOOLEAN$/i.test(field.type)
        ? "BOOLEAN"
        : /CHAR|TEXT|STRING/i.test(field.type)
          ? "TEXT"
          : undefined;
  if (expected !== table.columns[index].type)
    throw Error(
      "結合キーの型をそろえてください。文字列の先頭ゼロは保持されます。",
    );
  const seen = new Set<Value>();
  table.rows.forEach((row, i) => {
    const key = row[index];
    if (key === null || key === "")
      throw Error(`個人テーブルの結合キーが${i + 1}行目で空欄です。`);
    if (seen.has(key))
      throw Error(
        `個人テーブルの結合キーが重複しています: ${String(key).slice(0, 40)}`,
      );
    seen.add(key);
  });
  const ids = [
    ...source.fields.map((f) => f.id),
    ...personalFields(table).map((f) => f.id),
    matchField,
  ];
  if (new Set(ids).size !== ids.length)
    throw Error("結合項目の名前が元データと重複しています。");
  return { table, index };
}
export function joinedSource(
  source: QueryableSource,
  join: PersonalJoin,
  table: PersonalTable,
  stats = false,
): QueryableSource {
  validateJoin(source, join, table);
  return {
    ...source,
    fields: [
      ...source.fields,
      ...personalFields(table),
      ...(stats
        ? [
            {
              id: matchField,
              label: "一致",
              type: "NUMBER",
              description: "",
              category: "結合",
              suggested: "metric" as const,
            },
          ]
        : []),
    ],
  };
}
export function compileJoinedQuery(
  q: Query,
  source: QueryableSource,
  table: PersonalTable,
  stats = false,
) {
  if (!q.join || !("tableId" in q.join))
    throw Error("個人テーブルの結合設定がありません。");
  const { join } = q;
  const augmented = joinedSource(source, join, table, stats);
  const cast = {
    TEXT: "VARCHAR",
    NUMBER: "DOUBLE",
    DATE: "DATE",
    BOOLEAN: "BOOLEAN",
  };
  const personal = `(SELECT ${table.columns.map((c, i) => `CASE WHEN IS_NULL_VALUE(f.VALUE[${i}]) THEN NULL ELSE f.VALUE[${i}]::${cast[c.type]} END AS ${identifier(c.id)}`).join(", ")}, 1 AS "__matched" FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?))) f)`;
  const projection = [
    ...source.fields.map((f) => `b.${identifier(f.id)} AS ${identifier(f.id)}`),
    ...table.columns.map(
      (c) =>
        `p.${identifier(c.id)} AS ${identifier(personalFieldId(table.id, c.id))}`,
    ),
    `IFF(p."__matched" IS NULL, 0, 1) AS ${identifier(matchField)}`,
  ];
  const textKey =
    table.columns.find((c) => c.id === join.tableField)!.type === "TEXT";
  const key = (alias: string, id: string) =>
    textKey
      ? `COLLATE(${alias}.${identifier(id)}, '')`
      : `${alias}.${identifier(id)}`;
  const from = `(SELECT ${projection.join(", ")} FROM ${relation(source)} b ${join.type === "left" ? "LEFT" : "INNER"} JOIN ${personal} p ON ${key("b", join.sourceField)} = ${key("p", join.tableField)}) AS "SNOWLENS_JOIN"`;
  return compileQuery(q, augmented, {
    from,
    binds: [JSON.stringify(table.rows)],
  });
}
export function joinMockRows(
  rows: Record<string, Value>[],
  source: QueryableSource,
  join: PersonalJoin,
  table: PersonalTable,
): Record<string, Value>[] {
  const { index } = validateJoin(source, join, table);
  const lookup = new Map(table.rows.map((row) => [row[index], row]));
  return rows.flatMap((row) => {
    const value = row[join.sourceField];
    const match = value !== null ? lookup.get(value) : undefined;
    if (!match && join.type === "inner") return [];
    return [
      {
        ...row,
        ...Object.fromEntries(
          table.columns.map((c, i) => [
            personalFieldId(table.id, c.id),
            match?.[i] ?? null,
          ]),
        ),
        [matchField]: match ? 1 : 0,
      },
    ];
  });
}

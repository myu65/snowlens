import { identifier, relation, validateQuery } from "./compiler";
import {
  relationFieldId,
  relationJoinedSource,
  relationKey,
} from "./relation-join";
import type { Query, QueryableSource } from "./model";
const literal = (value: string) =>
  "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";

// A reviewable DDL artifact. This function never executes DDL or grants access.
// An ordinary base View keeps the explicit LEFT/INNER join and fact grain.
export function semanticDraft(
  q: Query,
  left: QueryableSource,
  target: [string, string, string],
  right?: QueryableSource,
) {
  if (left.kind === "semantic_view")
    throw Error(
      "セマンティックビューの再公開には、元テーブルの定義を用意してください。",
    );
  if (q.join && "tableId" in q.join)
    throw Error(
      "個人テーブルを公開するには、共有入力テーブルへの移行と公開範囲の確認が必要です。",
    );
  const join = q.join && "rightSource" in q.join ? q.join : undefined;
  if (join && !right) throw Error("結合先にアクセスできません。");
  const source = join ? relationJoinedSource(left, right!, join) : left;
  validateQuery(q, source);
  if (q.detail || !q.metrics.length)
    throw Error("公開する行項目と集計を選んでください。");
  if (q.metrics.some((m) => !left.fields.some((f) => f.id === m.field)))
    throw Error("セマンティック定義の集計には、元データの値を選んでください。");
  const columns = [
    ...new Set([...q.dimensions, ...q.metrics.map((m) => m.field)]),
  ];
  function fieldSql(id: string) {
    const l = left.fields.find((f) => f.id === id);
    if (l) return `l.${identifier(l.id)}`;
    const r = right?.fields.find((f) => relationFieldId(right!, f.id) === id);
    if (!r) throw Error("公開項目が見つかりません。");
    return `r.${identifier(r.id)}`;
  }
  const baseName = [target[0], target[1], target[2] + "__BASE"]
    .map(identifier)
    .join(".");
  const viewName = target.map(identifier).join(".");
  const from = join
    ? `${relation(left)} l ${join.type === "left" ? "LEFT" : "INNER"} JOIN ${relation(right!)} r ON ${relationKey(left, join.sourceField, "l")}=${relationKey(right!, join.rightField, "r")}`
    : `${relation(left)} l`;
  const facts = [...new Set(q.metrics.map((m) => m.field))];
  const blocks = [
    `TABLES (joined AS ${baseName})`,
    `FACTS (\n${facts.map((field, i) => `  joined.${identifier("fact_" + (i + 1))} AS joined.${identifier(field)}`).join(",\n")}\n)`,
  ];
  if (q.dimensions.length)
    blocks.push(
      `DIMENSIONS (\n${q.dimensions.map((field, i) => `  joined.${identifier("dimension_" + (i + 1))} AS joined.${identifier(field)} COMMENT=${literal(source.fields.find((f) => f.id === field)!.label)}`).join(",\n")}\n)`,
    );
  blocks.push(
    `METRICS (\n${q.metrics
      .map((m, i) => {
        const fact = `joined.${identifier("fact_" + (facts.indexOf(m.field) + 1))}`;
        const expression =
          m.aggregation === "COUNT_ROWS"
            ? "COUNT(*)"
            : m.aggregation === "COUNT_DISTINCT"
              ? `COUNT(DISTINCT ${fact})`
              : `${m.aggregation}(${fact})`;
        return `  joined.${identifier("metric_" + (i + 1))} AS ${expression} COMMENT=${literal(left.fields.find((f) => f.id === m.field)!.label + " · " + m.aggregation)}`;
      })
      .join(",\n")}\n)`,
  );
  return {
    sql: `-- SnowLens publication draft; validate in the target Snowflake account before use.\n-- Review both source policies, publisher privileges, destination and reader roles.\n-- Search conditions, private display overrides and private rows are omitted.\n-- SELECT on the semantic view may expose base data without base-table SELECT.\n-- No grants or replacements are performed by this artifact.\nCREATE VIEW ${baseName} AS\nSELECT ${columns.map((id) => fieldSql(id) + " AS " + identifier(id)).join(", ")}\nFROM ${from};\n\nCREATE SEMANTIC VIEW ${viewName}\n${blocks.join("\n")};\n`,
    sources: [left.id, ...(right ? [right.id] : [])],
    target,
    baseView: target[2] + "__BASE",
    selectedFields: columns,
    requires: [
      "Destination USAGE and CREATE VIEW / CREATE SEMANTIC VIEW",
      "Publisher SELECT on both source relations",
      "Approved reader roles and policy checks",
      "Two-caller query comparison before granting SELECT",
    ],
  };
}

import {
  personalTableSchema,
  type PersonalTable,
  type Value,
  type Field,
} from "./model";

export function validatePersonalTable(input: unknown): PersonalTable {
  const t = personalTableSchema.parse(input);
  if (
    new Set(t.columns.map((c) => c.id)).size !== t.columns.length ||
    new Set(t.columns.map((c) => c.label)).size !== t.columns.length
  )
    throw Error("個人テーブルの列名は重複できません。");
  if (new TextEncoder().encode(JSON.stringify(t)).length > 500000)
    throw Error("個人テーブルは500 KBまでです。");
  t.rows.forEach((row, index) => {
    if (row.length !== t.columns.length)
      throw Error(`${index + 1}行目の列数が合いません。`);
    row.forEach((v, i) => {
      if (v === null) return;
      if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        !Number.isSafeInteger(v)
      )
        throw Error(`${index + 1}行目の大きな整数は文字列で保存してください。`);
      const type = t.columns[i].type;
      if (
        (type === "TEXT" && typeof v !== "string") ||
        (type === "NUMBER" && typeof v !== "number") ||
        (type === "BOOLEAN" && typeof v !== "boolean") ||
        (type === "DATE" && (typeof v !== "string" || !validDate(v)))
      )
        throw Error(
          `${index + 1}行目「${t.columns[i].label}」の型が合いません。`,
        );
    });
  });
  return t;
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parsePersonalValue(
  value: string,
  type: PersonalTable["columns"][number]["type"],
): Value {
  if (value === "") return null;
  if (type === "TEXT") return value;
  if (
    type === "NUMBER" &&
    value.trim() &&
    Number.isFinite(Number(value)) &&
    (!Number.isInteger(Number(value)) || Number.isSafeInteger(Number(value)))
  )
    return Number(value);
  if (type === "DATE" && validDate(value)) return value;
  if (type === "BOOLEAN" && /^(true|false)$/i.test(value))
    return value.toLowerCase() === "true";
  throw Error(`${type}の値として読み込めません: ${value.slice(0, 40)}`);
}
// Spreadsheet clipboard: TSV with Excel-style quoted multiline cells.
export function parsePastedTable(text: string): {
  columns: PersonalTable["columns"];
  rows: Value[][];
} {
  if (new TextEncoder().encode(text).length > 500000)
    throw Error("貼り付けは500 KBまでです。");
  const data: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '"') {
      if (quoted && normalized[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (cell === "") quoted = true;
      else cell += c;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell);
      cell = "";
      if (c === "\n") {
        data.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw Error("引用符が閉じていません。");
  if (cell !== "" || row.length) {
    row.push(cell);
    data.push(row);
  }
  const headers = data.shift();
  if (
    !headers?.length ||
    headers.length > 12 ||
    data.length > 1000 ||
    headers.some((h) => !h.trim())
  )
    throw Error("先頭行に列名を入れてください。最大12列・1,000行です。");
  if (data.some((row) => row.length !== headers.length))
    throw Error("行ごとの列数が合いません。タブ区切りで貼り付けてください。");
  const columns = headers.map((label, i) => {
    const values = data.map((row) => row[i]).filter((v) => v !== "");
    const type =
      values.length && values.every(validDate)
        ? "DATE"
        : values.length && values.every((v) => /^(true|false)$/i.test(v))
          ? "BOOLEAN"
          : values.length &&
              values.every(
                (v) =>
                  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) &&
                  Number.isFinite(Number(v)) &&
                  (!Number.isInteger(Number(v)) ||
                    Number.isSafeInteger(Number(v))),
              )
            ? "NUMBER"
            : "TEXT";
    return {
      id: "c" + (i + 1),
      label: label.trim(),
      type,
    } as PersonalTable["columns"][number];
  });
  const rows = data.map((row) =>
    row.map((v, i) => parsePersonalValue(v, columns[i].type)),
  );
  validatePersonalTable({ id: "paste", name: "貼り付け", columns, rows });
  return { columns, rows };
}
export function personalFieldId(tableId: string, columnId: string) {
  return `__personal_${tableId}_${columnId}`;
}
export function personalFields(table: PersonalTable): Field[] {
  return table.columns.map((c) => ({
    id: personalFieldId(table.id, c.id),
    label: `${table.name} · ${c.label}`,
    type: c.type === "TEXT" ? "VARCHAR" : c.type,
    description: "自分の個人テーブルから追加した項目",
    category: "個人テーブル",
    suggested: c.type === "NUMBER" ? "metric" : "dimension",
  }));
}

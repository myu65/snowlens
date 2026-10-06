import { z } from "zod";
import {
  initialQuery,
  type Field,
  type QueryableSource,
  type Value,
} from "./model";

export const ledgerIdSchema = z.uuid().transform((id) => id.toLowerCase());
export const ledgerSpaceIdSchema = z.string().regex(/^[a-z0-9_-]{1,50}$/);
export const ledgerTypes = ["text", "number", "date", "boolean"] as const;
export type LedgerType = (typeof ledgerTypes)[number];
export const ledgerSlotCounts: Record<LedgerType, number> = {
  text: 32,
  number: 16,
  date: 16,
  boolean: 16,
};
export const ledgerSlotPrefixes: Record<LedgerType, string> = {
  text: "T",
  number: "N",
  date: "D",
  boolean: "B",
};
export const ledgerSqlTypes: Record<LedgerType, string> = {
  text: "VARCHAR(2000)",
  number: "NUMBER(15,4)",
  date: "DATE",
  boolean: "BOOLEAN",
};
const scalar = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const ledgerFieldSchema = z
  .object({
    id: z.string().regex(/^[TNDB]_[0-9]{2}$/),
    label: z.string().trim().min(1).max(120),
    type: z.enum(ledgerTypes),
    section: z.string().trim().min(1).max(80).default("基本情報"),
    description: z.string().max(500).default(""),
    multiline: z.boolean().default(false),
    required: z.boolean().default(false),
    readOnly: z.boolean().default(false),
    archived: z.boolean().default(false),
    width: z.enum(["half", "full"]).default("half"),
    options: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    defaultValue: scalar.default(null),
  })
  .strict();
export type LedgerField = z.infer<typeof ledgerFieldSchema>;
export const ledgerLayoutSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().max(1000).default(""),
    columns: z.union([z.literal(1), z.literal(2)]).default(2),
    fields: z.array(ledgerFieldSchema).min(1).max(50),
    tableColumns: z
      .array(z.string().regex(/^[TNDB]_[0-9]{2}$/))
      .min(1)
      .max(30),
  })
  .strict();
export type LedgerLayout = z.infer<typeof ledgerLayoutSchema>;
export const ledgerDefinitionSchema = z
  .object({
    id: ledgerIdSchema,
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    layout: ledgerLayoutSchema,
  })
  .strict();
export type LedgerDefinition = z.infer<typeof ledgerDefinitionSchema>;
export const ledgerSpaceSchema = z
  .object({
    id: ledgerSpaceIdSchema,
    label: z.string().min(1).max(120),
    database: z.string().min(1).max(255),
    dataSchema: z.string().min(1).max(255),
    definitionSchema: z.string().min(1).max(255),
    readerRole: z.string().min(1).max(255),
    writerRole: z.string().min(1).max(255),
    storage: z.enum(["hybrid", "standard"]).default("hybrid"),
  })
  .strict()
  .refine(
    (space) => space.dataSchema !== space.definitionSchema,
    "入力データとレイアウトの保存先を分けてください。",
  );
export type LedgerSpace = z.infer<typeof ledgerSpaceSchema>;
export type LedgerCapabilities = {
  insert: boolean;
  update: boolean;
  delete: boolean;
  layout: boolean;
};
export type LedgerRecord = {
  id: string;
  version: number;
  values: Record<string, Value>;
  updatedAt: string;
  updatedBy: string;
};
export type LedgerDetail = {
  definition: LedgerDefinition;
  capabilities: LedgerCapabilities;
  space: Pick<LedgerSpace, "id" | "label">;
  source: QueryableSource;
};
export type LedgerList = {
  records: LedgerRecord[];
  hasMore: boolean;
  offset: number;
};
export type LedgerSummary = {
  id: string;
  version: number;
  title: string;
  description: string;
  spaceId: string;
  fieldCount: number;
};

export class LedgerError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function ledgerTableName(id: string) {
  return "LEDGER_" + ledgerIdSchema.parse(id).replaceAll("-", "").toUpperCase();
}
export function ledgerSlot(type: LedgerType, index: number) {
  return `${ledgerSlotPrefixes[type]}_${String(index).padStart(2, "0")}`;
}
export function nextLedgerSlot(fields: LedgerField[], type: LedgerType) {
  const used = new Set(fields.map((f) => f.id));
  for (let i = 1; i <= ledgerSlotCounts[type]; i++)
    if (!used.has(ledgerSlot(type, i))) return ledgerSlot(type, i);
  throw new LedgerError(
    `${{ text: "文字列", number: "数値", date: "日付", boolean: "真偽値" }[type]}の項目は${ledgerSlotCounts[type]}個までです。`,
  );
}
export function newLedgerField(
  fields: LedgerField[],
  type: LedgerType = "text",
): LedgerField {
  return ledgerFieldSchema.parse({
    id: nextLedgerSlot(fields, type),
    label: `項目${fields.length + 1}`,
    type,
  });
}
export function validateLedgerValue(
  field: LedgerField,
  value: Value,
  allowBlank = false,
): Value {
  if (value === "" && field.type !== "boolean") value = null;
  if (value === null) {
    if (field.required && !allowBlank)
      throw new LedgerError(`${field.label}を入力してください。`);
    return null;
  }
  if (field.type === "text") {
    if (typeof value !== "string" || value.length > 2000)
      throw new LedgerError(
        `${field.label}は2,000文字以内で入力してください。`,
      );
    if (field.options.length && !field.options.includes(value))
      throw new LedgerError(`${field.label}は選択肢から選んでください。`);
    if (field.required && !value.trim() && !allowBlank)
      throw new LedgerError(`${field.label}を入力してください。`);
  } else if (field.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 99999999999.9999 ||
      !/^-?\d{1,11}(?:\.\d{1,4})?$/.test(String(value))
    )
      throw new LedgerError(
        `${field.label}は整数部11桁、小数点以下4桁までの数値を入力してください。`,
      );
  } else if (field.type === "boolean") {
    if (typeof value !== "boolean")
      throw new LedgerError(
        `${field.label}は「はい」「いいえ」から選んでください。`,
      );
  } else {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      throw new LedgerError(`${field.label}に正しい日付を入力してください。`);
  }
  return value;
}
export function validateLedgerLayout(
  input: unknown,
  previous?: LedgerLayout,
): LedgerLayout {
  const layout = ledgerLayoutSchema.parse(input);
  const ids = new Set<string>(),
    labels = new Set<string>();
  for (const field of layout.fields) {
    const slot = Number(field.id.slice(2));
    if (
      field.id[0] !== ledgerSlotPrefixes[field.type] ||
      slot < 1 ||
      slot > ledgerSlotCounts[field.type]
    )
      throw new LedgerError("項目の型と保存先が一致しません。");
    if (ids.has(field.id)) throw new LedgerError("同じ項目が重複しています。");
    ids.add(field.id);
    if (!field.archived) {
      const label = field.label.normalize("NFKC").toLowerCase();
      if (labels.has(label))
        throw new LedgerError(
          "項目名が重複しています。区別できる名前を付けてください。",
        );
      labels.add(label);
    }
    if (
      new Set(field.options).size !== field.options.length ||
      (field.type !== "text" && field.options.length)
    )
      throw new LedgerError(`${field.label}の選択肢を確認してください。`);
    validateLedgerValue(field, field.defaultValue, true);
    if (field.required && field.readOnly && field.defaultValue === null)
      throw new LedgerError(
        `${field.label}は必須のため、初期値を指定するか入力を許可してください。`,
      );
    if (field.required && field.readOnly)
      validateLedgerValue(field, field.defaultValue);
  }
  const active = layout.fields.filter((f) => !f.archived);
  if (!active.length)
    throw new LedgerError("表示する項目を1つ以上残してください。");
  if (
    new Set(layout.tableColumns).size !== layout.tableColumns.length ||
    layout.tableColumns.some((id) => !active.some((f) => f.id === id))
  )
    throw new LedgerError("一覧に表示する項目を確認してください。");
  if (previous)
    for (const old of previous.fields) {
      const next = layout.fields.find((f) => f.id === old.id);
      if (!next)
        throw new LedgerError(
          "入力済みの値を残すため、項目は削除せず非表示にしてください。",
        );
      if (next.type !== old.type)
        throw new LedgerError(
          `${old.label}の型は変更できません。新しい項目を追加してください。`,
        );
    }
  return layout;
}
export function validateLedgerDefinition(input: unknown) {
  const definition = ledgerDefinitionSchema.parse(input);
  return { ...definition, layout: validateLedgerLayout(definition.layout) };
}
export function validateLedgerValues(
  layout: LedgerLayout,
  input: unknown,
  existing?: Record<string, Value>,
) {
  const values = z.record(z.string(), scalar).parse(input);
  const fields = layout.fields.filter((f) => !f.archived);
  if (Object.keys(values).some((id) => !fields.some((f) => f.id === id)))
    throw new LedgerError("この台帳で入力できない項目が含まれています。");
  return Object.fromEntries(
    fields.map((field) => {
      const value = Object.hasOwn(values, field.id)
        ? values[field.id]
        : existing
          ? (existing[field.id] ?? null)
          : field.defaultValue;
      if (
        field.readOnly &&
        value !== (existing ? (existing[field.id] ?? null) : field.defaultValue)
      )
        throw new LedgerError(`${field.label}は参照のみです。`);
      return [
        field.id,
        existing && field.readOnly ? value : validateLedgerValue(field, value),
      ];
    }),
  );
}
export function ledgerSource(
  space: LedgerSpace,
  definition: LedgerDefinition,
): QueryableSource {
  const fields: Field[] = definition.layout.fields
    .filter((f) => !f.archived)
    .map((f) => ({
      id: f.id,
      label: f.label,
      type:
        f.type === "text"
          ? "VARCHAR"
          : f.type === "number"
            ? "NUMBER"
            : f.type.toUpperCase(),
      description: f.description,
      category: f.section,
      suggested: f.type === "number" ? "metric" : "dimension",
    }));
  const name = ledgerTableName(definition.id);
  return {
    id: JSON.stringify([space.database, space.dataSchema, name]),
    database: space.database,
    schema: space.dataSchema,
    name,
    kind: "table",
    label: definition.layout.title,
    description: definition.layout.description,
    fields,
  };
}
export function ledgerInitialQuery(
  space: LedgerSpace,
  definition: LedgerDefinition,
) {
  return initialQuery(ledgerSource(space, definition));
}

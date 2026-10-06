import { identifier, compileFilterPredicates } from "./compiler";
import {
  ledgerSlot,
  ledgerSlotCounts,
  ledgerSqlTypes,
  ledgerTypes,
  ledgerTableName,
  LedgerError,
  type LedgerSpace,
  type LedgerDefinition,
  type LedgerLayout,
  type LedgerRecord,
} from "./ledger-model";
import type { Value } from "./model";

export type LedgerSql = { sql: string; binds: (string | number | boolean)[] };
export type LedgerWritePlan = {
  lock: LedgerSql;
  check: LedgerSql;
  mutation: LedgerSql;
  expectedRecords: number;
};
type Execute = (
  sql: string,
  binds?: (string | number | boolean)[],
) => Promise<Record<string, unknown>[]>;
function affectedRows(rows: Record<string, unknown>[]) {
  const value = Object.entries(rows[0] || {}).find(([key]) =>
    /^number of rows (inserted|updated|deleted)$/i.test(key),
  )?.[1];
  const count = Number(value);
  if (value === undefined || !Number.isSafeInteger(count) || count < 0)
    throw new LedgerError(
      "更新件数を確認できません。保存を取り消しました。",
      503,
    );
  return count;
}
async function transaction(exec: Execute, fn: () => Promise<void>) {
  await exec("BEGIN TRANSACTION");
  try {
    await fn();
    await exec("COMMIT");
  } catch (error) {
    await exec("ROLLBACK").catch(() => {});
    throw error;
  }
}
const versionConflict = () =>
  new LedgerError(
    "他の人が行またはレイアウトを更新しました。読み直して確認してください。",
    409,
  );
export async function executeLedgerWrite(exec: Execute, plan: LedgerWritePlan) {
  await transaction(exec, async () => {
    if (affectedRows(await exec(plan.lock.sql, plan.lock.binds)) !== 1)
      throw versionConflict();
    const count = await exec(plan.check.sql, plan.check.binds);
    if (
      count.length !== 1 ||
      Number(count[0].recordCount) !== plan.expectedRecords
    )
      throw versionConflict();
    if (affectedRows(await exec(plan.mutation.sql, plan.mutation.binds)) !== 1)
      throw versionConflict();
  });
}
export async function executeLedgerLayoutWrite(
  exec: Execute,
  compiled: LedgerSql,
) {
  await transaction(exec, async () => {
    if (affectedRows(await exec(compiled.sql, compiled.binds)) !== 1)
      throw versionConflict();
  });
}
export function ledgerRelation(
  space: LedgerSpace,
  id: string,
  definition = false,
) {
  return [
    space.database,
    definition ? space.definitionSchema : space.dataSchema,
    ledgerTableName(id),
  ]
    .map(identifier)
    .join(".");
}
export function ledgerCreateSql(space: LedgerSpace, id: string) {
  const slots = ledgerTypes.flatMap((type) =>
    Array.from(
      { length: ledgerSlotCounts[type] },
      (_, i) =>
        `${identifier(ledgerSlot(type, i + 1))} ${ledgerSqlTypes[type]}`,
    ),
  );
  const create =
    space.storage === "standard" ? "CREATE TABLE" : "CREATE HYBRID TABLE";
  const key = space.storage === "standard" ? "NOT NULL" : "PRIMARY KEY";
  return [
    `${create} ${ledgerRelation(space, id)} ("ROW_ID" VARCHAR(36) ${key}, "VERSION" NUMBER(15,0) NOT NULL, "UPDATED_AT" TIMESTAMP_NTZ NOT NULL, "UPDATED_BY" VARCHAR NOT NULL, ${slots.join(", ")})`,
    `${create} ${ledgerRelation(space, id, true)} ("ID" VARCHAR(36) ${key}, "VERSION" NUMBER(15,0) NOT NULL, "LAYOUT" VARIANT NOT NULL, "MUTATION_COUNT" NUMBER(15,0) NOT NULL DEFAULT 0)`,
  ];
}
export function ledgerPermissionProbe(space: LedgerSpace, id: string) {
  const data = ledgerRelation(space, id),
    definition = ledgerRelation(space, id, true);
  return `DECLARE can_insert BOOLEAN DEFAULT FALSE; can_update BOOLEAN DEFAULT FALSE; can_delete BOOLEAN DEFAULT FALSE; can_layout BOOLEAN DEFAULT FALSE;
BEGIN
 BEGIN INSERT INTO ${data} ("ROW_ID","VERSION","UPDATED_AT","UPDATED_BY") SELECT UUID_STRING(),1,CURRENT_TIMESTAMP(),CURRENT_USER() WHERE FALSE; can_insert:=TRUE; EXCEPTION WHEN OTHER THEN can_insert:=FALSE; END;
 BEGIN UPDATE ${data} SET "VERSION"="VERSION" WHERE FALSE; can_update:=TRUE; EXCEPTION WHEN OTHER THEN can_update:=FALSE; END;
 BEGIN DELETE FROM ${data} WHERE FALSE; can_delete:=TRUE; EXCEPTION WHEN OTHER THEN can_delete:=FALSE; END;
 BEGIN UPDATE ${definition} SET "VERSION"="VERSION" WHERE FALSE; can_layout:=TRUE; EXCEPTION WHEN OTHER THEN can_layout:=FALSE; END;
 RETURN OBJECT_CONSTRUCT('insert',can_insert,'update',can_update,'delete',can_delete,'layout',can_layout);
END`;
}
export function ledgerListSql(
  space: LedgerSpace,
  definition: LedgerDefinition,
  search: string,
  offset: number,
): LedgerSql {
  const ids = definition.layout.fields
    .filter((f) => !f.archived)
    .map((f) => identifier(f.id));
  const escaped = search
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
  return {
    sql: `SELECT "ROW_ID","VERSION","UPDATED_AT","UPDATED_BY",${ids.join(", ")} FROM ${ledgerRelation(space, definition.id)}${search ? ` WHERE (${ids.map((id) => `TO_VARCHAR(${id}) ILIKE '%' || ? || '%' ESCAPE '\\\\'`).join(" OR ")})` : ""} ORDER BY "UPDATED_AT" DESC,"ROW_ID" ASC LIMIT 51 OFFSET ${offset}`,
    binds: search ? ids.map(() => escaped) : [],
  };
}
export function ledgerRecordSql(
  space: LedgerSpace,
  definition: LedgerDefinition,
  id: string,
): LedgerSql {
  const fields = definition.layout.fields
    .filter((f) => !f.archived)
    .map((f) => identifier(f.id));
  return {
    sql: `SELECT "ROW_ID","VERSION","UPDATED_AT","UPDATED_BY",${fields.join(", ")} FROM ${ledgerRelation(space, definition.id)} WHERE "ROW_ID"=?`,
    binds: [id],
  };
}
export function ledgerWriteSql(
  space: LedgerSpace,
  definition: LedgerDefinition,
  id: string,
  values: Record<string, Value>,
  expected: number,
  remove = false,
  existing?: Record<string, Value>,
): LedgerWritePlan {
  const target = ledgerRelation(space, definition.id),
    meta = ledgerRelation(space, definition.id, true);
  const fields = definition.layout.fields.filter(
    (f) =>
      !f.archived &&
      (expected === 0 ||
        (!f.readOnly &&
          (!existing || values[f.id] !== (existing[f.id] ?? null)))),
  );
  const predicates = compileFilterPredicates(
    [{ field: "ROW_ID", operator: "eq", value: id }],
    identifier,
  );
  const valueExpr = (value: Value) => (value === null ? "NULL" : "?");
  const binds: (string | number | boolean)[] = [];
  let mutation: string;
  if (remove) {
    mutation = `DELETE FROM ${target} WHERE ${predicates.predicates[0]} AND "VERSION"=?`;
    binds.push(id, expected);
  } else if (expected === 0) {
    mutation = `INSERT INTO ${target} ("ROW_ID","VERSION","UPDATED_AT","UPDATED_BY",${fields.map((f) => identifier(f.id)).join(", ")}) VALUES (?,1,CURRENT_TIMESTAMP(),CURRENT_USER(),${fields.map((f) => valueExpr(values[f.id])).join(", ")})`;
    binds.push(
      id,
      ...fields.flatMap((f) =>
        values[f.id] === null
          ? []
          : [values[f.id] as string | number | boolean],
      ),
    );
  } else {
    mutation = `UPDATE ${target} SET ${fields
      .map((f) => `${identifier(f.id)}=${valueExpr(values[f.id])}`)
      .concat(
        '"VERSION"="VERSION"+1',
        '"UPDATED_AT"=CURRENT_TIMESTAMP()',
        '"UPDATED_BY"=CURRENT_USER()',
      )
      .join(", ")} WHERE ${predicates.predicates[0]} AND "VERSION"=?`;
    binds.push(
      ...fields.flatMap((f) =>
        values[f.id] === null
          ? []
          : [values[f.id] as string | number | boolean],
      ),
      id,
      expected,
    );
  }
  return {
    lock: {
      sql: `UPDATE ${meta} SET "MUTATION_COUNT"="MUTATION_COUNT"+1 WHERE "ID"=? AND "VERSION"=?`,
      binds: [definition.id, definition.version],
    },
    check: {
      sql: `SELECT COUNT(*) AS "recordCount" FROM ${target} WHERE "ROW_ID"=?`,
      binds: [id],
    },
    mutation: { sql: mutation, binds },
    expectedRecords: expected === 0 ? 0 : 1,
  };
}
export function ledgerLayoutWriteSql(
  space: LedgerSpace,
  definition: LedgerDefinition,
  layout: LedgerLayout,
): LedgerSql {
  return {
    sql: `UPDATE ${ledgerRelation(space, definition.id, true)} SET "LAYOUT"=PARSE_JSON(?),"VERSION"="VERSION"+1 WHERE "ID"=? AND "VERSION"=?`,
    binds: [JSON.stringify(layout), definition.id, definition.version],
  };
}
export function parseLedgerRecord(
  row: Record<string, unknown>,
  definition: LedgerDefinition,
): LedgerRecord {
  const normalize = (v: unknown): Value =>
    v == null
      ? null
      : v instanceof Date
        ? v.toISOString().slice(0, 10)
        : typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean"
          ? v
          : String(v);
  return {
    id: String(row.ROW_ID),
    version: Number(row.VERSION),
    updatedAt:
      row.UPDATED_AT instanceof Date
        ? row.UPDATED_AT.toISOString()
        : String(row.UPDATED_AT),
    updatedBy: String(row.UPDATED_BY),
    values: Object.fromEntries(
      definition.layout.fields
        .filter((f) => !f.archived)
        .map((f) => [f.id, normalize(row[f.id])]),
    ),
  };
}

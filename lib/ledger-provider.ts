import { z } from "zod";
import { cookies } from "next/headers";
import { mockMode, withSnowflake } from "./snowflake-session";
import { identifier } from "./compiler";
import { parseColumn } from "./metadata";
import {
  LedgerError,
  ledgerIdSchema,
  ledgerSpaceSchema,
  ledgerSource,
  validateLedgerDefinition,
  validateLedgerLayout,
  validateLedgerValues,
  type LedgerCapabilities,
  type LedgerDefinition,
  type LedgerDetail,
  type LedgerList,
  type LedgerRecord,
  type LedgerSpace,
  type LedgerSummary,
} from "./ledger-model";
import {
  createMockLedger,
  demoLedgerRoles,
  demoLedgerSpaces,
  findMockLedger,
  mockLedgerCapabilities,
  mockLedgerRole,
  readMockLedgers,
  writeMockLedgerLayout,
  writeMockLedgerRecord,
} from "./ledger-mock";
import {
  ledgerCreateSql,
  ledgerLayoutWriteSql,
  ledgerListSql,
  ledgerPermissionProbe,
  ledgerRecordSql,
  ledgerRelation,
  ledgerWriteSql,
  executeLedgerWrite,
  executeLedgerLayoutWrite,
  parseLedgerRecord,
} from "./ledger-sql";
import type { QueryableSource } from "./model";

type Execute = (
  sql: string,
  binds?: (string | number | boolean)[],
) => Promise<Record<string, unknown>[]>;
export function configuredLedgerSpaces() {
  if (mockMode()) return demoLedgerSpaces;
  const raw = process.env.SNOWLENS_LEDGER_SPACES;
  if (!raw) return [];
  let spaces: LedgerSpace[];
  try {
    spaces = z.array(ledgerSpaceSchema).max(50).parse(JSON.parse(raw));
  } catch {
    throw new LedgerError(
      "台帳の部署設定を読み込めません。デプロイ管理者に確認してください。",
      503,
    );
  }
  if (new Set(spaces.map((s) => s.id)).size !== spaces.length)
    throw new LedgerError("台帳の部署設定が重複しています。", 503);
  const schemas = spaces.flatMap((s) =>
    [s.dataSchema, s.definitionSchema].map((schema) =>
      JSON.stringify([s.database, schema]),
    ),
  );
  if (new Set(schemas).size !== schemas.length)
    throw new LedgerError(
      "部署ごとの台帳スキーマを分けて設定してください。",
      503,
    );
  return spaces;
}
export async function currentDemoLedgerRole() {
  return mockLedgerRole(
    (await cookies()).get("snowlens_ledger_demo_role")?.value || "sales_writer",
  ).id;
}
function getSpace(id: string) {
  const space = configuredLedgerSpaces().find((s) => s.id === id);
  if (!space) throw new LedgerError("この部署の台帳は利用できません。", 404);
  return space;
}
async function visibleSpace(space: LedgerSpace, exec: Execute) {
  const rows = await exec(
    'SELECT IS_ROLE_IN_SESSION(?) AS "read", IS_ROLE_IN_SESSION(?) AS "write"',
    [space.readerRole, space.writerRole],
  );
  return { read: rows[0]?.read === true, write: rows[0]?.write === true };
}
async function requireSpace(space: LedgerSpace, exec: Execute) {
  const permissions = await visibleSpace(space, exec);
  if (!permissions.read)
    throw new LedgerError("この部署の台帳にアクセスできません。", 403);
  // Each HTTP request uses a fresh caller connection. Read committed ledger
  // writes across sessions, including ledgers created before a storage change.
  await exec("ALTER SESSION SET READ_LATEST_WRITES = TRUE");
  return permissions;
}
function variant(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
async function definitionFor(
  space: LedgerSpace,
  id: string,
  exec: Execute,
): Promise<LedgerDefinition> {
  await requireSpace(space, exec);
  const rows = await exec(
    `SELECT "ID","VERSION","LAYOUT" FROM ${ledgerRelation(space, id, true)} WHERE "ID"=?`,
    [id],
  );
  if (rows.length !== 1)
    throw new LedgerError(
      "台帳の定義が見つからないか重複しています。管理者に確認してください。",
      404,
    );
  const definition = validateLedgerDefinition({
    id: rows[0].ID,
    version: Number(rows[0].VERSION),
    layout: variant(rows[0].LAYOUT),
  });
  const columns = (
    await exec(`SHOW COLUMNS IN TABLE ${ledgerRelation(space, id)}`)
  ).map(parseColumn);
  const required = [
    { id: "ROW_ID", type: "VARCHAR" },
    { id: "VERSION", type: "NUMBER" },
    ...ledgerSource(space, definition).fields,
  ];
  for (const field of required) {
    const column = columns.find((c) => c.id === field.id);
    if (!column || column.type !== field.type)
      throw new LedgerError(
        "台帳の保存先と項目の型が一致しません。管理者に確認してください。",
        503,
      );
  }
  // Require real SELECT even when metadata/grants remain visible after a revocation.
  await exec(`SELECT "ROW_ID" FROM ${ledgerRelation(space, id)} LIMIT 0`);
  return definition;
}
async function capabilitiesFor(
  space: LedgerSpace,
  id: string,
  exec: Execute,
): Promise<LedgerCapabilities> {
  const result = await exec(ledgerPermissionProbe(space, id));
  const raw = z
    .object({
      insert: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
      layout: z.boolean(),
    })
    .strict()
    .parse(variant(Object.values(result[0] || {})[0]));
  // Record writes lock the shared definition row; inputters also edit the layout.
  return {
    ...raw,
    insert: raw.insert && raw.layout,
    update: raw.update && raw.layout,
    delete: raw.delete && raw.layout,
  };
}
export async function listLedgerSpaces() {
  if (mockMode()) {
    const role = await currentDemoLedgerRole(),
      actor = mockLedgerRole(role);
    return {
      mode: "mock",
      demoRole: role,
      demoRoles: demoLedgerRoles,
      spaces: demoLedgerSpaces
        .filter((s) => s.id === actor.space)
        .map((s) => ({ id: s.id, label: s.label, canCreate: actor.write })),
    };
  }
  return withSnowflake(async (exec) => {
    const spaces = [];
    for (const space of configuredLedgerSpaces()) {
      const cap = await visibleSpace(space, exec);
      if (cap.read)
        spaces.push({ id: space.id, label: space.label, canCreate: cap.write });
    }
    return { mode: "snowflake", spaces };
  });
}
export async function listLedgers(spaceId: string): Promise<LedgerSummary[]> {
  const space = getSpace(spaceId);
  if (mockMode()) {
    const role = await currentDemoLedgerRole();
    mockLedgerCapabilities(role, spaceId);
    return (await readMockLedgers()).ledgers
      .filter((l) => l.spaceId === spaceId)
      .map((l) => ({
        id: l.definition.id,
        version: l.definition.version,
        title: l.definition.layout.title,
        description: l.definition.layout.description,
        spaceId,
        fieldCount: l.definition.layout.fields.filter((f) => !f.archived)
          .length,
      }));
  }
  return withSnowflake(async (exec) => {
    await requireSpace(space, exec);
    const objects = await exec(
      `SHOW TABLES LIKE 'LEDGER_%' IN SCHEMA ${[space.database, space.definitionSchema].map(identifier).join(".")} LIMIT 100`,
    );
    const summaries: LedgerSummary[] = [];
    for (const object of objects) {
      const match = /^LEDGER_([0-9A-F]{32})$/.exec(String(object.name));
      if (!match) continue;
      const raw = match[1],
        id =
          `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`.toLowerCase();
      try {
        const d = await definitionFor(space, id, exec);
        summaries.push({
          id,
          version: d.version,
          title: d.layout.title,
          description: d.layout.description,
          spaceId,
          fieldCount: d.layout.fields.filter((f) => !f.archived).length,
        });
      } catch {
        /* Incomplete provisioning and revoked targets are not opened. */
      }
    }
    return summaries;
  });
}
export async function getLedger(
  spaceId: string,
  id: string,
): Promise<LedgerDetail> {
  id = ledgerIdSchema.parse(id);
  const space = getSpace(spaceId);
  if (mockMode()) {
    const role = await currentDemoLedgerRole(),
      ledger = await findMockLedger(role, spaceId, id);
    return {
      definition: ledger.definition,
      capabilities: mockLedgerCapabilities(role, spaceId),
      space: { id: space.id, label: space.label },
      source: ledgerSource(space, ledger.definition),
    };
  }
  return withSnowflake(async (exec) => {
    const definition = await definitionFor(space, id, exec),
      capabilities = await capabilitiesFor(space, id, exec);
    return {
      definition,
      capabilities,
      space: { id: space.id, label: space.label },
      source: ledgerSource(space, definition),
    };
  });
}
export async function listLedgerRecords(
  spaceId: string,
  id: string,
  search = "",
  offset = 0,
): Promise<LedgerList> {
  z.string().max(200).parse(search);
  z.number().int().min(0).max(100000).parse(offset);
  id = ledgerIdSchema.parse(id);
  const space = getSpace(spaceId);
  if (mockMode()) {
    const ledger = await findMockLedger(
      await currentDemoLedgerRole(),
      spaceId,
      id,
    );
    const active = ledger.definition.layout.fields.filter((f) => !f.archived);
    const records = ledger.records
      .filter(
        (r) =>
          !search ||
          active.some((f) =>
            String(r.values[f.id] ?? "")
              .toLowerCase()
              .includes(search.toLowerCase()),
          ),
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
      .slice(offset, offset + 51);
    return {
      records: records.slice(0, 50).map((r) => ({
        ...r,
        values: Object.fromEntries(
          active.map((f) => [f.id, r.values[f.id] ?? null]),
        ),
      })),
      hasMore: records.length > 50,
      offset,
    };
  }
  return withSnowflake(async (exec) => {
    const definition = await definitionFor(space, id, exec),
      compiled = ledgerListSql(space, definition, search, offset);
    const rows = await exec(compiled.sql, compiled.binds);
    return {
      records: rows.slice(0, 50).map((r) => parseLedgerRecord(r, definition)),
      hasMore: rows.length > 50,
      offset,
    };
  });
}
export async function getLedgerRecord(
  spaceId: string,
  id: string,
  recordId: string,
): Promise<LedgerRecord> {
  id = ledgerIdSchema.parse(id);
  recordId = ledgerIdSchema.parse(recordId);
  const space = getSpace(spaceId);
  if (mockMode()) {
    const matches = (
      await findMockLedger(await currentDemoLedgerRole(), spaceId, id)
    ).records.filter((r) => r.id === recordId);
    if (matches.length !== 1)
      throw new LedgerError("この行は削除されたか利用できません。", 404);
    return matches[0];
  }
  return withSnowflake(async (exec) => {
    const definition = await definitionFor(space, id, exec),
      compiled = ledgerRecordSql(space, definition, recordId);
    const rows = await exec(compiled.sql, compiled.binds);
    if (rows.length !== 1)
      throw new LedgerError("この行は削除されたか重複しています。", 404);
    return parseLedgerRecord(rows[0], definition);
  });
}
export async function createLedger(
  spaceId: string,
  id: string,
  input: unknown,
) {
  id = ledgerIdSchema.parse(id);
  const space = getSpace(spaceId),
    layout = validateLedgerLayout(input);
  if (mockMode())
    return createMockLedger(await currentDemoLedgerRole(), spaceId, id, layout);
  return withSnowflake(async (exec) => {
    const cap = await requireSpace(space, exec);
    if (!cap.write)
      throw new LedgerError("台帳を作成する権限がありません。", 403);
    const created: string[] = [];
    try {
      const commands = ledgerCreateSql(space, id);
      await exec(commands[0]);
      created.push(ledgerRelation(space, id));
      await exec(commands[1]);
      created.push(ledgerRelation(space, id, true));
      await exec(
        `INSERT INTO ${ledgerRelation(space, id, true)} ("ID","VERSION","LAYOUT") SELECT ?,1,PARSE_JSON(?)`,
        [id, JSON.stringify(layout)],
      );
      return { id, version: 1, layout };
    } catch (e) {
      let cleanupFailed = false;
      for (const relation of created.reverse()) {
        try {
          await exec(`DROP TABLE ${relation}`);
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed)
        throw new LedgerError(
          "台帳を作成できず、一部の保存先が残りました。管理者に回収を依頼してください。",
          503,
        );
      throw e;
    }
  });
}
export async function saveLedgerLayout(
  spaceId: string,
  id: string,
  version: number,
  input: unknown,
) {
  id = ledgerIdSchema.parse(id);
  z.number().int().positive().parse(version);
  const space = getSpace(spaceId);
  if (mockMode())
    return writeMockLedgerLayout(
      await currentDemoLedgerRole(),
      spaceId,
      id,
      version,
      validateLedgerLayout(input),
    );
  return withSnowflake(async (exec) => {
    const definition = await definitionFor(space, id, exec);
    if (definition.version !== version)
      throw new LedgerError(
        "他の人がレイアウトを更新しました。読み直して確認してください。",
        409,
      );
    const layout = validateLedgerLayout(input, definition.layout);
    if (!(await capabilitiesFor(space, id, exec)).layout)
      throw new LedgerError("レイアウトを変更する権限がありません。", 403);
    const compiled = ledgerLayoutWriteSql(space, definition, layout);
    await executeLedgerLayoutWrite(exec, compiled);
    return { id, version: version + 1, layout };
  });
}
export async function saveLedgerRecord(
  spaceId: string,
  id: string,
  layoutVersion: number,
  recordId: string,
  version: number,
  input: unknown,
  remove = false,
) {
  id = ledgerIdSchema.parse(id);
  recordId = ledgerIdSchema.parse(recordId);
  z.number().int().positive().parse(layoutVersion);
  z.number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
    .parse(version);
  const space = getSpace(spaceId);
  if (remove && version === 0)
    throw new LedgerError("未登録の行は削除できません。");
  if (mockMode())
    return writeMockLedgerRecord(
      await currentDemoLedgerRole(),
      spaceId,
      id,
      layoutVersion,
      recordId,
      version,
      input,
      remove,
    );
  return withSnowflake(async (exec) => {
    const definition = await definitionFor(space, id, exec);
    if (definition.version !== layoutVersion)
      throw new LedgerError(
        "レイアウトが更新されました。読み直して確認してください。",
        409,
      );
    const caps = await capabilitiesFor(space, id, exec);
    if (!(remove ? caps.delete : version === 0 ? caps.insert : caps.update))
      throw new LedgerError("この操作の書き込み権限がありません。", 403);
    let existing: LedgerRecord | undefined;
    if (version > 0) {
      const compiled = ledgerRecordSql(space, definition, recordId),
        rows = await exec(compiled.sql, compiled.binds);
      if (rows.length !== 1 || Number(rows[0].VERSION) !== version)
        throw new LedgerError(
          "他の人がこの行を更新または削除しました。読み直して確認してください。",
          409,
        );
      existing = parseLedgerRecord(rows[0], definition);
    }
    const values = remove
      ? {}
      : validateLedgerValues(definition.layout, input, existing?.values);
    const compiled = ledgerWriteSql(
      space,
      definition,
      recordId,
      values,
      version,
      remove,
      existing?.values,
    );
    await executeLedgerWrite(exec, compiled);
    return { id: recordId, version: version + 1, deleted: remove };
  });
}
export async function resolveRegisteredLedgerSource(
  id: string,
  exec?: Execute,
): Promise<QueryableSource | undefined> {
  let parts: unknown;
  try {
    parts = JSON.parse(id);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parts) || parts.length !== 3) return undefined;
  const match = /^LEDGER_([0-9A-F]{32})$/.exec(parts[2]);
  if (!match) return undefined;
  const space = configuredLedgerSpaces().find(
    (s) => s.database === parts[0] && s.dataSchema === parts[1],
  );
  if (!space) return undefined;
  const raw = match[1],
    ledgerId =
      `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`.toLowerCase();
  if (mockMode())
    return ledgerSource(
      space,
      (await findMockLedger(await currentDemoLedgerRole(), space.id, ledgerId))
        .definition,
    );
  if (!exec) return withSnowflake((e) => resolveRegisteredLedgerSource(id, e));
  return ledgerSource(space, await definitionFor(space, ledgerId, exec));
}
export async function mockRegisteredLedgerRows(source: QueryableSource) {
  if (!mockMode()) return undefined;
  let parts: unknown;
  try {
    parts = JSON.parse(source.id);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parts) || parts.length !== 3) return undefined;
  const space = configuredLedgerSpaces().find(
    (s) => s.database === parts[0] && s.dataSchema === parts[1],
  );
  if (!space) return undefined;
  const match = /^LEDGER_([0-9A-F]{32})$/.exec(parts[2]);
  if (!match) throw new LedgerError("台帳にアクセスできません。", 403);
  const raw = match[1],
    id =
      `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`.toLowerCase();
  return (
    await findMockLedger(await currentDemoLedgerRole(), space.id, id)
  ).records.map((r) => r.values);
}
export function ledgerPublicError(error: unknown) {
  if (error instanceof LedgerError)
    return { error: error.message, status: error.status };
  if (error instanceof z.ZodError)
    return { error: "入力内容と画面の指定を確認してください。", status: 400 };
  const message = error instanceof Error ? error.message : "";
  if (/hybrid.*(trial|not.*enabled|not.*available|not.*support)/i.test(message))
    return {
      error:
        "このアカウントではHybrid Tableを利用できません。デプロイ管理者に台帳の保存方式を確認してください。",
      status: 503,
    };
  if (/Ledger version conflict/.test(message))
    return {
      error:
        "他の人が行またはレイアウトを更新しました。入力内容を確認してから読み直してください。",
      status: 409,
    };
  return {
    error:
      "台帳を読み書きできません。現在の権限と台帳の設定を確認して再試行してください。",
    status: 403,
  };
}

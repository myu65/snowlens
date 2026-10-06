import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, unlink } from "node:fs/promises";
import {
  ledgerFieldSchema,
  ledgerSource,
  newLedgerField,
  validateLedgerLayout,
  validateLedgerValues,
  type LedgerDefinition,
  type LedgerLayout,
} from "../lib/ledger-model";
import {
  ledgerCreateSql,
  ledgerLayoutWriteSql,
  ledgerListSql,
  ledgerPermissionProbe,
  ledgerWriteSql,
  executeLedgerWrite,
} from "../lib/ledger-sql";
import {
  createMockLedger,
  demoLedgerSpaces,
  findMockLedger,
  ledgerMockFile,
  mockLedgerCapabilities,
  writeMockLedgerLayout,
  writeMockLedgerRecord,
} from "../lib/ledger-mock";
const id = "9110b453-21a4-4c9e-832b-22e49dca0001",
  rowId = "9110b453-21a4-4c9e-832b-22e49dca0002";
const fields = [
  ledgerFieldSchema.parse({
    id: "T_01",
    label: "名称",
    type: "text",
    required: true,
  }),
  ledgerFieldSchema.parse({ id: "N_01", label: "数量", type: "number" }),
  ledgerFieldSchema.parse({ id: "D_01", label: "期限", type: "date" }),
  ledgerFieldSchema.parse({
    id: "B_01",
    label: "確認済み",
    type: "boolean",
    defaultValue: false,
  }),
];
const layout: LedgerLayout = validateLedgerLayout({
  title: "テスト台帳",
  fields,
  columns: 2,
  tableColumns: ["T_01", "N_01"],
});
const definition: LedgerDefinition = { id, version: 1, layout },
  space = demoLedgerSpaces[0];
beforeEach(async () => {
  await mkdir("artifacts", { recursive: true });
  vi.stubEnv("SNOWLENS_MODE", "mock");
  vi.stubEnv("SNOWLENS_MOCK_FILE", "artifacts/ledger-unit.json");
  await unlink(ledgerMockFile()).catch(() => {});
});
afterEach(async () => {
  await unlink(ledgerMockFile()).catch(() => {});
  vi.unstubAllEnvs();
});

it("checks dates, literal values, precision, blank required fields, zero and false without implicit conversion", () => {
  expect(
    validateLedgerValues(layout, {
      T_01: "literal');--",
      N_01: 0,
      D_01: "2028-02-29",
      B_01: false,
    }),
  ).toEqual({ T_01: "literal');--", N_01: 0, D_01: "2028-02-29", B_01: false });
  for (const input of [
    { T_01: "" },
    { T_01: "  " },
    { T_01: "x", N_01: "1" },
    { T_01: "x", N_01: 1.00001 },
    { T_01: "x", N_01: 100000000000 },
    { T_01: "x", D_01: "2026-02-30" },
    { T_01: "x", B_01: "false" },
    { T_01: "x", ROW_ID: "forged" },
  ])
    expect(() => validateLedgerValues(layout, input)).toThrow();
});
it("lets writers edit shared layouts while preventing field loss, remapping, duplicates and invalid choices", () => {
  expect(
    validateLedgerLayout(
      {
        ...layout,
        fields: [...fields].reverse(),
        tableColumns: ["N_01", "T_01"],
      },
      layout,
    ).fields[0].id,
  ).toBe("B_01");
  for (const invalid of [
    { ...layout, fields: fields.slice(1) },
    { ...layout, fields: [...fields, fields[0]] },
    { ...layout, tableColumns: ["T_31"] },
    {
      ...layout,
      fields: fields.map((f) => (f.id === "N_01" ? { ...f, type: "text" } : f)),
    },
    {
      ...layout,
      fields: fields.map((f) =>
        f.id === "N_01" ? { ...f, label: "名称" } : f,
      ),
    },
    {
      ...layout,
      fields: fields.map((f) =>
        f.id === "T_01" ? { ...f, readOnly: true } : f,
      ),
    },
  ])
    expect(() => validateLedgerLayout(invalid, layout)).toThrow();
  const archived = validateLedgerLayout(
    {
      ...layout,
      fields: fields.map((f) =>
        f.id === "N_01" ? { ...f, archived: true } : f,
      ),
      tableColumns: ["T_01"],
    },
    layout,
  );
  expect(archived.fields).toHaveLength(4);
  expect(newLedgerField(archived.fields, "number").id).toBe("N_02");
});
it("does not let readonly values be overwritten and keeps old readonly blanks when another field is edited", () => {
  const readonly = {
    ...layout,
    fields: fields.map((f) =>
      f.id === "N_01"
        ? { ...f, readOnly: true, required: true, defaultValue: 0 }
        : f,
    ),
  };
  expect(
    validateLedgerValues(
      readonly,
      { T_01: "edited" },
      { T_01: "old", N_01: null, D_01: null, B_01: false },
    ).N_01,
  ).toBeNull();
  expect(() =>
    validateLedgerValues(
      readonly,
      { T_01: "edited", N_01: 5 },
      { T_01: "old", N_01: 0, D_01: null, B_01: false },
    ),
  ).toThrow("参照のみ");
  expect(validateLedgerValues(readonly, { T_01: "new" }).N_01).toBe(0);
});
it("generates typed physical columns and bound transactional writes without browser SQL or attribution", () => {
  expect(ledgerCreateSql(space, id)[0]).toContain('"N_01" NUMBER(15,4)');
  const compiled = ledgerWriteSql(
    space,
    definition,
    rowId,
    { T_01: "private'); DROP TABLE x;--", N_01: 0, D_01: null, B_01: false },
    0,
  );
  expect(compiled.mutation.sql).not.toContain("private");
  expect(compiled.lock.sql).toContain(
    'SET "MUTATION_COUNT"="MUTATION_COUNT"+1 WHERE "ID"=? AND "VERSION"=?',
  );
  expect(compiled.check.sql).toContain("SELECT COUNT(*)");
  expect(compiled.mutation.sql).toContain("CURRENT_USER()");
  expect(compiled.lock.binds).toEqual([id, 1]);
  expect(compiled.check.binds).toEqual([rowId]);
  expect(compiled.mutation.binds).toEqual([
    rowId,
    "private'); DROP TABLE x;--",
    0,
    false,
  ]);
  const updated = ledgerWriteSql(
    space,
    definition,
    rowId,
    { T_01: "changed", N_01: 0, D_01: null, B_01: false },
    1,
  );
  expect(updated.mutation.binds.slice(-2)).toEqual([rowId, 1]);
  expect(updated.mutation.sql).toContain('AND "VERSION"=?');
  const before = { T_01: "masked", N_01: 0, D_01: null, B_01: false };
  const changed = ledgerWriteSql(
    space,
    definition,
    rowId,
    { ...before, T_01: "changed" },
    1,
    false,
    before,
  );
  expect(changed.mutation.sql).toContain('"T_01"=?');
  expect(changed.mutation.sql).not.toContain('"N_01"=');
  expect(changed.mutation.sql).not.toContain('"D_01"=');
  expect(changed.mutation.sql).not.toContain('"B_01"=');
  expect(changed.mutation.binds).toEqual(["changed", rowId, 1]);
  const unchanged = ledgerWriteSql(
    space,
    definition,
    rowId,
    before,
    1,
    false,
    before,
  );
  expect(unchanged.mutation.sql).not.toContain('"T_01"=');
  expect(unchanged.mutation.sql).toContain('"VERSION"="VERSION"+1');
  const remove = ledgerWriteSql(space, definition, rowId, {}, 2, true);
  expect(remove.mutation.binds).toEqual([rowId, 2]);
  expect(remove.mutation.sql).toContain("DELETE FROM");
});
it("commits only exact single-row mutations and rolls back after stale or unknown affected counts", async () => {
  const plan = ledgerWriteSql(
    space,
    definition,
    rowId,
    { T_01: "name", N_01: 0, D_01: null, B_01: false },
    0,
  );
  for (const outcome of [1, 0, 2, undefined]) {
    const commands: string[] = [];
    const execute = async (sql: string) => {
      commands.push(sql);
      if (sql.startsWith("UPDATE")) return [{ "number of rows updated": 1 }];
      if (sql.startsWith("SELECT")) return [{ recordCount: 0 }];
      if (sql.startsWith("INSERT"))
        return outcome === undefined
          ? []
          : [{ "number of rows inserted": outcome }];
      return [];
    };
    if (outcome === 1) {
      await executeLedgerWrite(execute, plan);
      expect(commands.at(-1)).toBe("COMMIT");
    } else {
      await expect(executeLedgerWrite(execute, plan)).rejects.toThrow();
      expect(commands.at(-1)).toBe("ROLLBACK");
      expect(commands).not.toContain("COMMIT");
    }
  }
});
it("defaults to hybrid keys and permits an explicit deployment-only standard-table configuration", () => {
  expect(ledgerCreateSql(space, id)[0]).toContain("CREATE HYBRID TABLE");
  expect(ledgerCreateSql(space, id)[0]).toContain(
    '"ROW_ID" VARCHAR(36) PRIMARY KEY',
  );
  expect(ledgerCreateSql({ ...space, storage: "standard" }, id)[0]).toContain(
    "CREATE TABLE",
  );
  expect(
    ledgerCreateSql({ ...space, storage: "standard" }, id)[0],
  ).not.toContain("PRIMARY KEY");
});
it("bounds identifiers, escapes literal searches and probes caller privileges without touching rows", () => {
  const hostile = { ...space, dataSchema: 'department"; DROP SCHEMA x;--' };
  expect(ledgerCreateSql(hostile, id)[0]).toContain(
    '"department""; DROP SCHEMA x;--"',
  );
  const searched = ledgerListSql(space, definition, "%_secret'\\", 0);
  expect(searched.sql).not.toContain("secret");
  expect(searched.binds).toEqual(Array(4).fill("\\%\\_secret'\\\\"));
  expect(ledgerPermissionProbe(space, id).match(/WHERE FALSE/g)).toHaveLength(
    4,
  );
  const written = ledgerLayoutWriteSql(space, definition, {
    ...layout,
    title: "private title",
  });
  expect(written.sql).not.toContain("private title");
  expect(written.binds[0]).toContain("private title");
  expect(ledgerSource(space, definition).fields.map((f) => f.label)).toEqual([
    "名称",
    "数量",
    "期限",
    "確認済み",
  ]);
});
it("shares one department's data and layout, while viewers and other departments cannot mutate it", async () => {
  await createMockLedger("sales_writer", "sales", id, layout);
  await writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 0, {
    T_01: "department record",
    N_01: 0,
    B_01: false,
    D_01: null,
  });
  expect(
    (await findMockLedger("sales_reader", "sales", id)).records[0].values.N_01,
  ).toBe(0);
  expect(mockLedgerCapabilities("sales_reader", "sales").layout).toBe(false);
  for (const role of ["sales_reader", "quality_writer"]) {
    await expect(
      writeMockLedgerRecord(role, "sales", id, 1, rowId, 1, { T_01: "forged" }),
    ).rejects.toThrow();
    await expect(
      writeMockLedgerLayout(role, "sales", id, 1, layout),
    ).rejects.toThrow();
  }
  expect(() => mockLedgerCapabilities("ACCOUNTADMIN", "sales")).toThrow();
});
it("rejects replayed inserts, stale row/layout writes and stale deletion after a concurrent update", async () => {
  await createMockLedger("sales_writer", "sales", id, layout);
  await writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 0, {
    T_01: "first",
  });
  await expect(
    writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 0, {
      T_01: "second",
    }),
  ).rejects.toThrow("更新または削除");
  const attempts = await Promise.allSettled([
    writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 1, {
      T_01: "a",
    }),
    writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 1, {
      T_01: "b",
    }),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 1, {}, true),
  ).rejects.toThrow();
  await writeMockLedgerLayout("sales_writer", "sales", id, 1, {
    ...layout,
    title: "new title",
  });
  await expect(
    writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 2, {
      T_01: "stale form",
    }),
  ).rejects.toThrow("レイアウト");
  await expect(
    writeMockLedgerLayout("sales_writer", "sales", id, 1, layout),
  ).rejects.toThrow("レイアウト");
  await writeMockLedgerRecord(
    "sales_writer",
    "sales",
    id,
    2,
    rowId,
    2,
    {},
    true,
  );
  expect(
    (await findMockLedger("sales_writer", "sales", id)).records,
  ).toHaveLength(0);
});
it("retains archived values across a shared layout edit and subsequent record update", async () => {
  await createMockLedger("sales_writer", "sales", id, layout);
  await writeMockLedgerRecord("sales_writer", "sales", id, 1, rowId, 0, {
    T_01: "first",
    N_01: 42,
  });
  const archived = {
    ...layout,
    fields: fields.map((f) => (f.id === "N_01" ? { ...f, archived: true } : f)),
    tableColumns: ["T_01"],
  };
  await writeMockLedgerLayout("sales_writer", "sales", id, 1, archived);
  await writeMockLedgerRecord("sales_writer", "sales", id, 2, rowId, 1, {
    T_01: "changed",
  });
  expect(
    (await findMockLedger("sales_reader", "sales", id)).records[0].values.N_01,
  ).toBe(42);
  await writeMockLedgerLayout("sales_writer", "sales", id, 2, layout);
  expect(
    (await findMockLedger("sales_reader", "sales", id)).records[0].values.N_01,
  ).toBe(42);
});

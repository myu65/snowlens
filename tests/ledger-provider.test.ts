import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  ledgerFieldSchema,
  validateLedgerLayout,
  ledgerSpaceSchema,
} from "../lib/ledger-model";
const transport = vi.hoisted(() => ({ exec: vi.fn(), sessions: vi.fn() }));
vi.mock("../lib/snowflake-session", () => ({
  mockMode: () => false,
  withSnowflake: async (
    run: (exec: typeof transport.exec) => Promise<unknown>,
  ) => {
    transport.sessions();
    return run(transport.exec);
  },
}));
import {
  createLedger,
  getLedger,
  saveLedgerRecord,
  resolveRegisteredLedgerSource,
  configuredLedgerSpaces,
  ledgerPublicError,
} from "../lib/ledger-provider";

const id = "8110b453-21a4-4c9e-832b-22e49dca0001";
const space = ledgerSpaceSchema.parse({
  id: "sales",
  label: "営業部",
  database: "DB",
  dataSchema: "DATA",
  definitionSchema: "DEFS",
  readerRole: "READER",
  writerRole: "WRITER",
});
const layout = validateLedgerLayout({
  title: "営業台帳",
  fields: [
    ledgerFieldSchema.parse({ id: "T_01", type: "text", label: "案件名" }),
  ],
  tableColumns: ["T_01"],
});
let canRead = true,
  canWrite = true;
beforeEach(() => {
  vi.stubEnv("SNOWLENS_MODE", "snowflake");
  vi.stubEnv("SNOWLENS_LEDGER_SPACES", JSON.stringify([space]));
  canRead = true;
  canWrite = true;
  transport.exec.mockReset();
  transport.sessions.mockClear();
  transport.exec.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT IS_ROLE"))
      return [{ read: canRead, write: canWrite }];
    if (sql.startsWith('SELECT "ID"'))
      return [{ ID: id, VERSION: 1, LAYOUT: layout }];
    if (sql.startsWith("SHOW COLUMNS"))
      return [
        { column_name: "ROW_ID", data_type: '{"type":"TEXT"}' },
        { column_name: "VERSION", data_type: '{"type":"FIXED"}' },
        { column_name: "T_01", data_type: '{"type":"TEXT"}' },
      ];
    if (sql.startsWith("DECLARE"))
      return [
        {
          result: {
            insert: canWrite,
            update: canWrite,
            delete: canWrite,
            layout: canWrite,
          },
        },
      ];
    return [];
  });
});
afterEach(() => vi.unstubAllEnvs());
it("uses fresh caller reads/probes and refuses an inactive department role without SQL fallback", async () => {
  expect((await getLedger("sales", id)).capabilities.update).toBe(true);
  canWrite = false;
  expect((await getLedger("sales", id)).capabilities.update).toBe(false);
  await expect(
    saveLedgerRecord("sales", id, 1, id, 0, { T_01: "x" }),
  ).rejects.toMatchObject({ status: 403 });
  canRead = false;
  transport.exec.mockClear();
  await expect(getLedger("sales", id)).rejects.toMatchObject({ status: 403 });
  expect(transport.exec.mock.calls).toHaveLength(1);
  expect(transport.sessions).toHaveBeenCalledTimes(4);
});
it("requires SELECT on actual data after metadata resolution and never returns a revoked source", async () => {
  transport.exec.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT IS_ROLE")) return [{ read: true, write: true }];
    if (sql.startsWith('SELECT "ID"'))
      return [{ ID: id, VERSION: 1, LAYOUT: layout }];
    if (sql.startsWith("SHOW COLUMNS"))
      return ["ROW_ID", "VERSION", "T_01"].map((name) => ({
        column_name: name,
        data_type: JSON.stringify({
          type: name === "VERSION" ? "FIXED" : "TEXT",
        }),
      }));
    if (sql.includes("LIMIT 0")) throw Error("SELECT privilege revoked");
    return [];
  });
  await expect(
    resolveRegisteredLedgerSource(
      '["DB","DATA","LEDGER_8110B45321A44C9E832B22E49DCA0001"]',
    ),
  ).rejects.toThrow("SELECT privilege revoked");
  expect(
    transport.exec.mock.calls.some(([sql]) =>
      sql.includes("READ_LATEST_WRITES = TRUE"),
    ),
  ).toBe(true);
  expect(
    await resolveRegisteredLedgerSource('["DB","DATA","ORDINARY"]'),
  ).toBeUndefined();
});
it("cleans up only newly created objects, retaining an existing table on a UUID collision", async () => {
  let creates = 0;
  transport.exec.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT IS_ROLE")) return [{ read: true, write: true }];
    if (sql.startsWith("CREATE")) {
      creates++;
      if (creates === 2) throw Error("definition creation failed");
    }
    return [];
  });
  await expect(createLedger("sales", id, layout)).rejects.toThrow(
    "definition creation failed",
  );
  expect(
    transport.exec.mock.calls.filter(([sql]) => sql.startsWith("DROP")),
  ).toEqual([[expect.stringContaining('"DB"."DATA".')]]);
  transport.exec.mockClear();
  creates = 1;
  await expect(createLedger("sales", id, layout)).rejects.toThrow();
  expect(
    transport.exec.mock.calls.some(([sql]) => sql.startsWith("DROP")),
  ).toBe(false);
  expect(
    transport.exec.mock.calls.some(([sql]) => /OR REPLACE/.test(sql)),
  ).toBe(false);
});
it("canonicalizes uppercase UUIDs before creating tables and metadata so listing and source links agree", async () => {
  const created = await createLedger("sales", id.toUpperCase(), layout);
  expect(created.id).toBe(id);
  const insert = transport.exec.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT"),
  )!;
  expect(insert[1][0]).toBe(id);
  expect((await getLedger("sales", id.toUpperCase())).definition.id).toBe(id);
});
it("keeps storage configuration on the deployment side and exposes a useful unavailable-hybrid error", () => {
  expect(configuredLedgerSpaces()[0].storage).toBe("hybrid");
  vi.stubEnv(
    "SNOWLENS_LEDGER_SPACES",
    JSON.stringify([{ ...space, owner: "browser-owner" }]),
  );
  expect(() => configuredLedgerSpaces()).toThrow();
  vi.stubEnv(
    "SNOWLENS_LEDGER_SPACES",
    JSON.stringify([space, { ...space, id: "quality" }]),
  );
  expect(() => configuredLedgerSpaces()).toThrow("スキーマを分けて");
  expect(
    ledgerPublicError(
      new Error("Hybrid tables are not supported in trial accounts"),
    ),
  ).toMatchObject({ status: 503 });
});
it("keeps unrelated source browsing usable when the optional ledger configuration is invalid", async () => {
  vi.stubEnv("SNOWLENS_LEDGER_SPACES", "invalid JSON");
  expect(
    await resolveRegisteredLedgerSource('["BUSINESS","SALES","ORDERS"]'),
  ).toBeUndefined();
  expect(() => configuredLedgerSpaces()).toThrow("部署設定");
});

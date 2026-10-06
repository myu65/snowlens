import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  ledgerFieldSchema,
  validateLedgerDefinition,
  validateLedgerLayout,
  validateLedgerValues,
  LedgerError,
  type LedgerDefinition,
  type LedgerLayout,
  type LedgerRecord,
  type LedgerSpace,
  type LedgerCapabilities,
} from "./ledger-model";

export const demoLedgerRoles = [
  {
    id: "sales_writer",
    label: "営業部・入力とレイアウト編集",
    space: "sales",
    write: true,
  },
  {
    id: "sales_reader",
    label: "営業部・閲覧のみ",
    space: "sales",
    write: false,
  },
  {
    id: "quality_writer",
    label: "品質部・入力とレイアウト編集",
    space: "quality",
    write: true,
  },
] as const;
export const demoLedgerSpaces: LedgerSpace[] = [
  {
    id: "sales",
    label: "営業部",
    database: "CHEM",
    dataSchema: "LEDGER_SALES",
    definitionSchema: "LEDGER_SALES_LAYOUTS",
    readerRole: "LEDGER_SALES_READER",
    writerRole: "LEDGER_SALES_WRITER",
    storage: "hybrid",
  },
  {
    id: "quality",
    label: "品質部",
    database: "CHEM",
    dataSchema: "LEDGER_QUALITY",
    definitionSchema: "LEDGER_QUALITY_LAYOUTS",
    readerRole: "LEDGER_QUALITY_READER",
    writerRole: "LEDGER_QUALITY_WRITER",
    storage: "hybrid",
  },
];
type MockLedger = {
  spaceId: string;
  definition: LedgerDefinition;
  records: LedgerRecord[];
};
type MockLedgers = { ledgers: MockLedger[] };
const demoIds = [
  "8110b453-21a4-4c9e-832b-22e49dca0001",
  "8110b453-21a4-4c9e-832b-22e49dca0002",
];
function demoState(): MockLedgers {
  const fields = [
    ledgerFieldSchema.parse({
      id: "T_01",
      label: "案件名",
      type: "text",
      required: true,
      section: "基本情報",
      width: "full",
    }),
    ledgerFieldSchema.parse({
      id: "T_02",
      label: "顧客",
      type: "text",
      required: true,
      section: "基本情報",
    }),
    ledgerFieldSchema.parse({
      id: "T_03",
      label: "担当者",
      type: "text",
      section: "基本情報",
    }),
    ledgerFieldSchema.parse({
      id: "D_01",
      label: "対応期限",
      type: "date",
      section: "進捗",
    }),
    ledgerFieldSchema.parse({
      id: "T_04",
      label: "対応状況",
      type: "text",
      section: "進捗",
      options: ["未着手", "対応中", "完了"],
      defaultValue: "未着手",
      required: true,
    }),
    ledgerFieldSchema.parse({
      id: "N_01",
      label: "見込金額",
      type: "number",
      section: "金額・メモ",
    }),
    ledgerFieldSchema.parse({
      id: "B_01",
      label: "確認済み",
      type: "boolean",
      section: "金額・メモ",
      defaultValue: false,
    }),
    ledgerFieldSchema.parse({
      id: "T_05",
      label: "メモ",
      multiline: true,
      type: "text",
      section: "金額・メモ",
      width: "full",
    }),
  ];
  return {
    ledgers: demoLedgerSpaces.map((space, index) => ({
      spaceId: space.id,
      definition: {
        id: demoIds[index],
        version: 1,
        layout: validateLedgerLayout({
          title: index ? "品質対応台帳" : "営業案件台帳",
          description: index
            ? "不具合や確認事項を部署で共有します。"
            : "案件の進捗と対応予定を部署で共有します。",
          columns: 2,
          fields,
          tableColumns: ["T_01", "T_02", "T_04", "D_01", "N_01"],
        }),
      },
      records: Array.from({ length: index ? 3 : 62 }, (_, i) => ({
        id: `8c110b45-21a4-4c9e-832b-${String(index * 1000 + i + 1).padStart(12, "0")}`,
        version: 1,
        updatedAt: new Date(Date.UTC(2026, 9, 6, 0, 0, 62 - i)).toISOString(),
        updatedBy: index ? "品質担当" : "営業担当",
        values: {
          T_01: index ? `品質確認 ${i + 1}` : `素材の相談 ${i + 1}`,
          T_02: ["東海化学", "関東素材", "北陸工業"][i % 3],
          T_03: ["佐藤", "田中"][i % 2],
          D_01: `2026-10-${String((i % 25) + 1).padStart(2, "0")}`,
          T_04: ["未着手", "対応中", "完了"][i % 3],
          N_01: i === 0 ? 0 : 100000 + i * 15000,
          B_01: i % 3 === 2,
          T_05: "",
        },
      })),
    })),
  };
}
export function mockLedgerRole(role: string) {
  const match = demoLedgerRoles.find((r) => r.id === role);
  if (!match) throw new LedgerError("デモのロールを選び直してください。", 403);
  return match;
}
export function mockLedgerCapabilities(
  role: string,
  spaceId: string,
): LedgerCapabilities {
  const actor = mockLedgerRole(role);
  if (actor.space !== spaceId)
    throw new LedgerError("この台帳にアクセスできません。", 403);
  return {
    insert: actor.write,
    update: actor.write,
    delete: actor.write,
    layout: actor.write,
  };
}
let queue: Promise<unknown> = Promise.resolve();
export function ledgerMockFile() {
  return (
    (process.env.SNOWLENS_MOCK_FILE || ".snowlens-mock.json") + ".ledgers.json"
  );
}
export async function readMockLedgers(): Promise<MockLedgers> {
  try {
    const state = JSON.parse(
      await readFile(/* turbopackIgnore: true */ ledgerMockFile(), "utf8"),
    );
    if (!Array.isArray(state.ledgers)) throw Error("invalid");
    for (const ledger of state.ledgers) {
      ledger.definition = validateLedgerDefinition(ledger.definition);
      if (
        !demoLedgerSpaces.some((s) => s.id === ledger.spaceId) ||
        !Array.isArray(ledger.records)
      )
        throw Error("invalid");
    }
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new LedgerError(
        "デモの台帳を読み込めません。保存ファイルを確認してください。",
        503,
      );
    return demoState();
  }
}
export async function findMockLedger(
  role: string,
  spaceId: string,
  id: string,
) {
  mockLedgerCapabilities(role, spaceId);
  const ledger = (await readMockLedgers()).ledgers.find(
    (l) => l.spaceId === spaceId && l.definition.id === id,
  );
  if (!ledger) throw new LedgerError("台帳が見つかりません。", 404);
  return ledger;
}
async function mutateMock<T>(fn: (state: MockLedgers) => T): Promise<T> {
  const pending = queue.then(async () => {
    const state = await readMockLedgers();
    const result = fn(state);
    const file = ledgerMockFile(),
      temporary = file + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(state), "utf8");
    await rename(temporary, file);
    return result;
  });
  queue = pending.catch(() => {});
  return pending;
}
export async function createMockLedger(
  role: string,
  spaceId: string,
  id: string,
  layout: LedgerLayout,
) {
  if (!mockLedgerCapabilities(role, spaceId).layout)
    throw new LedgerError("台帳を作成する権限がありません。", 403);
  return mutateMock((state) => {
    if (state.ledgers.some((l) => l.definition.id === id))
      throw new LedgerError(
        "この台帳はすでに作成されています。一覧を読み直してください。",
        409,
      );
    const definition = { id, version: 1, layout: validateLedgerLayout(layout) };
    state.ledgers.push({ spaceId, definition, records: [] });
    return definition;
  });
}
export async function writeMockLedgerLayout(
  role: string,
  spaceId: string,
  id: string,
  version: number,
  layout: LedgerLayout,
) {
  if (!mockLedgerCapabilities(role, spaceId).layout)
    throw new LedgerError("レイアウトを編集する権限がありません。", 403);
  return mutateMock((state) => {
    const ledger = state.ledgers.find(
      (l) => l.spaceId === spaceId && l.definition.id === id,
    );
    if (!ledger) throw new LedgerError("台帳が見つかりません。", 404);
    if (ledger.definition.version !== version)
      throw new LedgerError(
        "他の人がレイアウトを更新しました。読み直して変更を確認してください。",
        409,
      );
    ledger.definition = {
      id,
      version: version + 1,
      layout: validateLedgerLayout(layout, ledger.definition.layout),
    };
    return ledger.definition;
  });
}
export async function writeMockLedgerRecord(
  role: string,
  spaceId: string,
  id: string,
  layoutVersion: number,
  recordId: string,
  version: number,
  input: unknown,
  remove = false,
) {
  const caps = mockLedgerCapabilities(role, spaceId);
  if (!(remove ? caps.delete : version === 0 ? caps.insert : caps.update))
    throw new LedgerError(
      "この台帳は閲覧のみです。入力する権限を確認してください。",
      403,
    );
  return mutateMock((state) => {
    const ledger = state.ledgers.find(
      (l) => l.spaceId === spaceId && l.definition.id === id,
    );
    if (!ledger) throw new LedgerError("台帳が見つかりません。", 404);
    if (ledger.definition.version !== layoutVersion)
      throw new LedgerError(
        "レイアウトが更新されました。入力内容を確認してから読み直してください。",
        409,
      );
    const matches = ledger.records.filter((r) => r.id === recordId),
      record = matches[0];
    if (
      matches.length > 1 ||
      (version === 0 ? !!record : !record || record.version !== version)
    )
      throw new LedgerError(
        "他の人がこの行を更新または削除しました。読み直して確認してください。",
        409,
      );
    if (remove) {
      ledger.records = ledger.records.filter((r) => r.id !== recordId);
      return { id: recordId, deleted: true };
    }
    const values = validateLedgerValues(
      ledger.definition.layout,
      input,
      record?.values,
    );
    const updated: LedgerRecord = {
      id: recordId,
      version: version + 1,
      values: { ...record?.values, ...values },
      updatedAt: new Date().toISOString(),
      updatedBy: mockLedgerRole(role).label,
    };
    if (record)
      ledger.records = ledger.records.map((r) =>
        r.id === recordId ? updated : r,
      );
    else ledger.records.push(updated);
    return updated;
  });
}

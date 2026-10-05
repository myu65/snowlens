import { afterEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { exportExcel } from "../lib/excel";
import { exportDataCsv } from "../lib/csv";
import { exportColumns, type ExportContext } from "../lib/export-model";
import { initialQuery } from "../lib/model";
import { mockSources } from "../lib/mock";
import { runQueryWithContext } from "../lib/provider";
import { relationFieldId } from "../lib/relation-join";

const source = mockSources[0];
function sample(): ExportContext {
  return {
    source,
    exportedAt: new Date("2026-10-06T00:00:00Z"),
    query: {
      ...initialQuery(source),
      detail: false,
      dimensions: ["CUSTOMER", "PRODUCT"],
      metrics: [
        { field: "SALES_AMOUNT", aggregation: "AVG" },
        { field: "LOT_NO", aggregation: "COUNT_DISTINCT" },
      ],
      totals: "subtotals",
      offset: 10,
      limit: 3,
      filters: [{ field: "REGION", operator: "eq", value: "東日本" }],
    },
    result: {
      columns: [
        "CUSTOMER",
        "PRODUCT",
        "SALES_AMOUNT__AVG",
        "LOT_NO__COUNT_DISTINCT",
      ],
      rows: [
        {
          CUSTOMER: "A",
          PRODUCT: null,
          SALES_AMOUNT__AVG: 0,
          LOT_NO__COUNT_DISTINCT: 1,
        },
        {
          CUSTOMER: "A",
          PRODUCT: "P",
          SALES_AMOUNT__AVG: 100,
          LOT_NO__COUNT_DISTINCT: 1,
        },
        {
          CUSTOMER: "A",
          PRODUCT: null,
          SALES_AMOUNT__AVG: 66.66666666666667,
          LOT_NO__COUNT_DISTINCT: 1,
        },
      ],
      rowLevels: [2, 2, 1],
      dimensionCount: 2,
      hasMore: true,
      elapsedMs: 5,
      grandTotal: { SALES_AMOUNT__AVG: 80, LOT_NO__COUNT_DISTINCT: 2 },
    },
  };
}
async function load(context: ExportContext) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await exportExcel(context)).buffer as ArrayBuffer);
  return workbook;
}
afterEach(() => vi.unstubAllEnvs());

it("exports every composite key and separates pre-join conditions from result conditions above the displayed data", async () => {
  vi.stubEnv("SNOWLENS_MODE", "mock");
  vi.stubEnv("SNOWLENS_MOCK_FILE", "artifacts/export-unit-missing.json");
  const right = mockSources.find((s) => s.name === "PRODUCT_TARGETS")!;
  const query = {
    ...initialQuery(source),
    limit: 2,
    join: {
      rightSource: right.id,
      type: "left" as const,
      keys: [
        { sourceField: "PRODUCT", rightField: "PRODUCT" },
        { sourceField: "MACHINE_ID", rightField: "MACHINE_ID" },
      ],
      leftFilters: [
        { field: "ORDER_DATE", operator: "gte" as const, value: "2026-10-01" },
      ],
      rightFilters: [{ field: "YEAR", operator: "eq" as const, value: 2026 }],
    },
    filters: [{ field: "QUANTITY", operator: "gte" as const, value: 500 }],
  };
  const context = await runQueryWithContext(query, undefined, undefined, [
    {
      id: relationFieldId(right, "MACHINE_ID"),
      label: "対象設備",
      description: "個人の説明",
    },
    { id: relationFieldId(right, "YEAR"), label: "適用年度", description: "" },
  ]);
  const workbook = await load(context),
    report = workbook.getWorksheet("表示")!;
  const text = JSON.stringify(report.getSheetValues());
  expect(text).toContain("製品 ＝ 製品");
  expect(text).toContain("設備番号 ＝ 対象設備");
  expect(text).toContain("受注日 以上 2026-10-01");
  expect(text).toContain("適用年度 等しい 2026");
  expect(text).toContain("元データの対象条件（結合前）");
  expect(text).toContain("結合先の対象条件（結合前）");
  expect(text).toContain("検索条件");
  expect(text).toContain("数量 kg 以上 500");
  const data = workbook.getWorksheet("データ")!;
  expect(data.getTable("SnowLensData")).toBeDefined();
  const target = relationFieldId(right, "TARGET");
  expect(context.result.rows).toHaveLength(2);
  expect(
    context.result.rows.every((row) => typeof row[target] === "number"),
  ).toBe(true);
  expect(exportDataCsv(context)).not.toContain("結合前");
});

it("keeps scoped context above a readable report and a native data table, without reaggregating AVG or distinct totals", async () => {
  const context = sample(),
    workbook = await load(context);
  expect(workbook.worksheets.map((s) => s.name)).toEqual(["表示", "データ"]);
  const report = workbook.getWorksheet("表示")!,
    data = workbook.getWorksheet("データ")!;
  const text = JSON.stringify(report.getSheetValues());
  expect(text).toContain("11〜13行目");
  expect(text).toContain("東日本");
  expect(text).toContain("平均");
  expect(text).toContain("検索条件に合う全行");
  expect(text).toContain("小計");
  expect(data.getTable("SnowLensData")).toBeDefined();
  const zip = await JSZip.loadAsync(await exportExcel(context));
  const tableXml = await zip.file("xl/tables/table1.xml")!.async("string");
  expect(tableXml).toContain('ref="A7:D9"');
  expect(tableXml).toContain('<autoFilter ref="A7:D9"');
  expect(tableXml).not.toMatch(/__(AVG|COUNT_DISTINCT)| · /);
  expect([1, 2, 3, 4].map((i) => data.getCell(7, i).value)).toEqual(
    exportColumns(context).map((c) => c.label),
  );
  expect(data.getCell("B8").value).toBeNull();
  expect(data.getCell("C8").value).toBe(0);
  expect(data.getCell("C9").value).toBe(100);
  const values: unknown[] = [];
  report.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  expect(values).toContain(66.66666666666667);
  expect(values).toContain(80);
  expect(report.getTables()).toHaveLength(0);
  expect(data.views[0]).toMatchObject({ state: "frozen", ySplit: 7 });
});

it("writes dates/numbers/booleans as typed cells, preserves textual IDs and treats formula-like content as literal text", async () => {
  const context = sample();
  context.query = { ...initialQuery(source) };
  context.source = {
    ...source,
    fields: [
      {
        id: "date",
        category: "結果",
        label: "日付",
        type: "DATE",
        description: "",
        suggested: "dimension",
      },
      {
        id: "id",
        category: "結果",
        label: "コード",
        type: "TEXT",
        description: "",
        suggested: "dimension",
      },
      {
        id: "n",
        category: "結果",
        label: "金額",
        type: "NUMBER",
        description: "",
        suggested: "metric",
      },
      {
        id: "b",
        category: "結果",
        label: "有効",
        type: "BOOLEAN",
        description: "",
        suggested: "dimension",
      },
      {
        id: "t",
        category: "結果",
        label: "説明",
        type: "TEXT",
        description: "",
        suggested: "dimension",
      },
    ],
  };
  context.result = {
    columns: ["date", "id", "n", "b", "t"],
    rows: [
      {
        date: "2026-10-06",
        id: "001",
        n: -12.34567,
        b: false,
        t: '=HYPERLINK("https://example.invalid", "x")',
      },
      { date: null, id: "9007199254740993", n: 0, b: true, t: "\t+CMD" },
    ],
    hasMore: false,
    elapsedMs: 0,
  };
  const workbook = await load(context),
    sheet = workbook.getWorksheet("データ")!;
  expect(sheet.getCell("A8").value).toEqual(new Date("2026-10-06T00:00:00Z"));
  expect(sheet.getCell("A8").numFmt).toBe("yyyy-mm-dd");
  expect(sheet.getCell("B8").value).toBe("001");
  expect(sheet.getCell("B9").value).toBe("9007199254740993");
  expect(sheet.getCell("C8").value).toBe(-12.34567);
  expect(sheet.getCell("D8").value).toBe(false);
  expect(sheet.getCell("E8").type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell("E8").formula).toBeUndefined();
  expect(exportDataCsv(context)).toContain('"-12.34567"');
  expect(exportDataCsv(context)).toContain("\"'=HYPERLINK(");
  expect(exportDataCsv(context)).toContain('"\'\t+CMD"');
});

it("uses readable disambiguation only when needed and keeps native table headers unique", async () => {
  const context = sample();
  context.query.metrics = [
    { field: "SALES_AMOUNT", aggregation: "SUM" },
    { field: "SALES_AMOUNT", aggregation: "AVG" },
  ];
  context.result = {
    columns: ["PRODUCT", "SALES_AMOUNT__SUM", "SALES_AMOUNT__AVG"],
    rows: [{ PRODUCT: "P", SALES_AMOUNT__SUM: 10, SALES_AMOUNT__AVG: 5 }],
    hasMore: false,
    elapsedMs: 0,
  };
  const columns = exportColumns(context);
  expect(columns[1].label).toMatch(/（合計）$/);
  expect(columns[2].label).toMatch(/（平均）$/);
  expect(new Set(columns.map((c) => c.label)).size).toBe(3);
  const sheet = (await load(context)).getWorksheet("データ")!;
  expect([1, 2, 3].map((i) => sheet.getCell(8, i).value)).toEqual(["P", 10, 5]);
  expect(exportDataCsv(context, "ids")).toContain('"SALES_AMOUNT__SUM"');
});

it("keeps aggregated dates sortable and lets long source context move the data table down", async () => {
  const context = sample();
  context.source = {
    ...source,
    database: "長いデータベース名".repeat(25),
    schema: "長いスキーマ名".repeat(25),
    name: "長いテーブル名".repeat(25),
  };
  context.query.dimensions = ["PRODUCT"];
  context.query.metrics = [
    { field: "ORDER_DATE", aggregation: "MIN" },
    { field: "ORDER_DATE", aggregation: "COUNT" },
  ];
  context.result = {
    columns: ["PRODUCT", "ORDER_DATE__MIN", "ORDER_DATE__COUNT"],
    rows: [
      { PRODUCT: "P", ORDER_DATE__MIN: "2026-10-01", ORDER_DATE__COUNT: 5 },
    ],
    hasMore: false,
    elapsedMs: 0,
  };
  const sheet = (await load(context)).getWorksheet("データ")!;
  const rows = sheet.getSheetValues();
  const dataIndex = rows.findIndex((r) => Array.isArray(r) && r[1] === "P");
  expect(dataIndex).toBeGreaterThan(8);
  expect(sheet.getCell(dataIndex, 2).value).toEqual(
    new Date("2026-10-01T00:00:00Z"),
  );
  expect(sheet.getCell(dataIndex, 2).numFmt).toBe("yyyy-mm-dd");
  expect(sheet.getCell(dataIndex, 3).value).toBe(5);
  expect(sheet.getCell(dataIndex, 3).numFmt).toBe("#,##0");
  expect(JSON.stringify(rows)).toContain("出力範囲");
});

it("keeps CSV data clean by default and offers explicitly marked subtotal rows", () => {
  const context = sample(),
    plain = exportDataCsv(context),
    marked = exportDataCsv(context, "labels", true);
  expect(plain.split("\r\n")).toHaveLength(3);
  expect(plain).not.toContain("小計");
  expect(marked.split("\r\n")).toHaveLength(4);
  expect(marked).toContain('"行の種類"');
  expect(marked).toContain('"集計行","A",""');
  expect(marked).toContain('"小計","A",""');
});

it("represents empty result pages without inventing an Excel data row", async () => {
  const context = sample();
  context.result = {
    ...context.result,
    rows: [],
    rowLevels: [],
    grandTotal: undefined,
  };
  const workbook = await load(context);
  expect(workbook.getWorksheet("データ")!.getTables()).toHaveLength(0);
  expect(
    JSON.stringify(workbook.getWorksheet("表示")!.getSheetValues()),
  ).toContain("条件に一致するデータがありません");
  expect(exportDataCsv(context).split("\r\n")).toHaveLength(1);
});

it("refuses lossy XLSX strings and excessive output, retaining CSV for long values", async () => {
  const context = sample();
  context.result.rows[0].PRODUCT = "x".repeat(32768);
  await expect(exportExcel(context)).rejects.toThrow("CSV");
  expect(exportDataCsv(context)).toContain("x".repeat(32768));
  context.result.columns = Array.from({ length: 16385 }, (_, i) => String(i));
  await expect(exportExcel(context)).rejects.toThrow("範囲が大きすぎ");
});

it("validates personal labels against fresh source scope and exports an exact paged total", async () => {
  vi.stubEnv("SNOWLENS_MODE", "mock");
  vi.stubEnv("SNOWLENS_MOCK_FILE", "artifacts/export-unit-missing.json");
  const query = {
    ...initialQuery(source),
    detail: false,
    dimensions: ["LOT_NO"],
    metrics: [{ field: "SALES_AMOUNT", aggregation: "AVG" as const }],
    limit: 1,
    offset: 10,
  };
  const context = await runQueryWithContext(query, undefined, undefined, [
    { id: "SALES_AMOUNT", label: "自分の金額", description: "個人用の説明" },
  ]);
  expect(exportColumns(context)[1].label).toBe("自分の金額");
  expect(context.result.rows).toHaveLength(1);
  expect(context.result.grandTotal).toBeDefined();
  await expect(
    runQueryWithContext(query, undefined, undefined, [
      { id: "NOT_VISIBLE", label: "偽装", description: "" },
    ]),
  ).rejects.toThrow("利用できない");
  await expect(
    runQueryWithContext(query, undefined, undefined, [
      { id: "SALES_AMOUNT", label: "A", description: "" },
      { id: "SALES_AMOUNT", label: "B", description: "" },
    ]),
  ).rejects.toThrow("重複");
});

import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
async function pick(page: Page, title: string, id: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByLabel("項目を検索", { exact: true }).fill(id);
  await dialog.getByRole("button").filter({ hasText: id }).click();
}
async function ready(page: Page) {
  await expect(
    page.getByRole("button", { name: "↓ ダウンロード" }),
  ).toBeEnabled();
  await expect(page.locator(".error-banner")).toHaveCount(0);
}

test("Excel and CSV exports preserve conditions, personal headers, typed tables and mobile controls", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page
    .getByRole("button", { name: "自分用の項目名", exact: true })
    .click();
  const fields = page.getByRole("dialog", { name: "個人用の項目名を編集" });
  await fields
    .getByLabel("PRODUCTの個人表示名", { exact: true })
    .fill("分析用の製品名");
  await fields
    .getByRole("button", { name: "この分析に反映", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ 条件", exact: true }).click();
  await pick(page, "検索条件の項目を選ぶ", "ORDER_DATE");
  await page.getByLabel("条件1の比較").selectOption("gte");
  await page.getByLabel("条件1の値").fill("2026-10-01");
  await ready(page);
  await page.getByRole("button", { name: "↓ ダウンロード" }).click();
  const dialog = page.getByRole("dialog", {
    name: "ダウンロード",
    exact: true,
  });
  await expect(
    dialog.getByRole("radio", { name: /Excel（.xlsx）/ }),
  ).toBeChecked();
  await page.screenshot({ path: "artifacts/download-desktop.png" });
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Excelをダウンロード" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("SnowLens_受注実績.xlsx");
  await download.saveAs("artifacts/export-review.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Uint8Array.from(await readFile("artifacts/export-review.xlsx")).buffer,
  );
  expect(workbook.worksheets.map((s) => s.name)).toEqual(["表示", "データ"]);
  const data = workbook.getWorksheet("データ")!;
  expect(data.getCell("A7").value).toBe("分析用の製品名");
  expect(data.getCell("B7").value).not.toMatch(/SUM|__/);
  expect(data.getCell("B8").type).toBe(ExcelJS.ValueType.Number);
  expect(data.getTable("SnowLensData")).toBeDefined();
  expect(
    JSON.stringify(workbook.getWorksheet("表示")!.getSheetValues()),
  ).toContain("2026-10-01");
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "↓ ダウンロード" }).click();
  await dialog.getByRole("radio", { name: /CSV（.csv）/ }).check();
  await dialog.getByLabel("CSVの列見出し").selectOption("ids");
  await expect(
    dialog.getByRole("button", { name: "CSVをダウンロード" }),
  ).toBeInViewport();
  await page.screenshot({ path: "artifacts/download-mobile.png" });
  const csvDownloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "CSVをダウンロード" }).click();
  const csv = await csvDownloading;
  await csv.saveAs("artifacts/export-review.csv");
  expect(await readFile("artifacts/export-review.csv", "utf8")).toContain(
    '"SALES_AMOUNT__SUM"',
  );
  const catalog = await (await request.get("/api/catalog")).json();
  const source = catalog.sources[0];
  const query = {
    source: source.id,
    dimensions: [],
    metrics: [],
    filters: [],
    sort: [],
    detail: true,
    limit: 1,
    offset: 0,
  };
  expect(
    (
      await request.post("/api/export", {
        data: { query, format: "xlsx", rows: [{ SECRET: "forged" }] },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/export", {
        data: {
          query,
          format: "csv",
          fieldOverrides: [
            { id: "NOT_VISIBLE", label: "偽装", description: "" },
          ],
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/export", {
        headers: { Origin: "https://other.invalid" },
        data: { query, format: "csv" },
      })
    ).status(),
  ).toBe(400);
});
test("raw source: build, SUM, filter, sort, drill, detail, save and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "何を見ますか？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /PRODUCTION_LOG.*製造実績/ }).click();
  await page
    .getByRole("button", { name: "表示を組み立てる", exact: true })
    .click();
  await pick(page, "行の項目を選ぶ", "PRODUCT");
  await page.getByRole("button", { name: "＋ 値を追加" }).click();
  await pick(page, "集計する値を選ぶ", "QUANTITY");
  await ready(page);
  await expect(page.getByLabel("数量 kgの集計方法")).toHaveValue("SUM");
  await page.getByRole("button", { name: "＋ 条件", exact: true }).click();
  await pick(page, "検索条件の項目を選ぶ", "ORDER_DATE");
  await page.getByLabel("条件1の比較").selectOption("gte");
  await page.getByLabel("条件1の値").fill("2026-10-01");
  await ready(page);
  await page.getByRole("button", { name: "数量 kg · SUMで並べ替え" }).click();
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "数量 kg" }),
  ).toHaveAttribute("aria-sort", "ascending");
  await page
    .getByRole("cell")
    .getByRole("button", { name: "アクリル樹脂 A-100", exact: true })
    .click();
  await page.getByRole("button", { name: "別の項目で掘る →" }).click();
  await pick(page, "別の項目で掘り下げる", "CUSTOMER");
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "顧客" }),
  ).toBeVisible();
  await page
    .getByRole("cell")
    .getByRole("button", { name: "東海化学", exact: true })
    .click();
  await page.getByRole("button", { name: "明細を見る", exact: true }).click();
  await ready(page);
  await expect(page.getByText("明細を表示中", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "☆ 表示を保存" }).click();
  await page.getByLabel("保存する表示名").fill("製造 E2E");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "表示を保存" })).toHaveCount(0);
  await page.getByRole("button", { name: /SnowLens/ }).click();
  await page.getByRole("button", { name: /製造 E2E/ }).click();
  await ready(page);
  await expect(page.getByLabel("条件1の値")).toHaveValue("2026-10-01");
});
test("curated: filter, suggested drill, detail and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page.getByRole("button", { name: "＋ 条件", exact: true }).click();
  await pick(page, "検索条件の項目を選ぶ", "ORDER_DATE");
  await page.getByLabel("条件1の比較").selectOption("gte");
  await ready(page);
  await page
    .getByRole("cell")
    .getByRole("button", { name: "アクリル樹脂 A-100", exact: true })
    .click();
  await page.getByRole("button", { name: "顧客別に見る →" }).click();
  await ready(page);
  await page
    .getByRole("cell")
    .getByRole("button", { name: "東海化学", exact: true })
    .click();
  await page.getByRole("button", { name: "明細を見る", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "← 元に戻る" }).click();
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "顧客" }),
  ).toBeVisible();
});
test("numeric grouping, 120-field search, owner publish, favorite, CSV and mobile", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /EXPERIMENT_RESULTS.*実験結果/ })
    .click();
  await page
    .getByRole("button", { name: "表示を組み立てる", exact: true })
    .click();
  await pick(page, "行の項目を選ぶ", "LOT_NO");
  await page.getByRole("button", { name: "＋ 値を追加" }).click();
  await pick(page, "集計する値を選ぶ", "MEASUREMENT_100");
  await page.getByLabel("測定値 100の集計方法").selectOption("AVG");
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "ロット番号" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader").filter({ hasText: "測定値 100" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Datasetとして公開" }).click();
  await page.getByLabel("Dataset名", { exact: true }).fill("実験 E2E");
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Datasetを公開" })).toHaveCount(
    0,
  );
  await ready(page);
  await page.getByRole("button", { name: "お気に入り", exact: true }).click();
  await page.getByRole("button", { name: "↓ ダウンロード" }).click();
  await page.getByRole("radio", { name: /CSV（.csv）/ }).check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSVをダウンロード" }).click();
  await expect((await download).suggestedFilename()).toBe(
    "SnowLens_実験 E2E.csv",
  );
  await page.getByRole("button", { name: "設定を折りたたむ" }).click();
  await expect(page.getByRole("button", { name: "設定を開く" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /SnowLens/ }).click();
  await expect(
    page.getByRole("button", { name: /DATASET 実験 E2E/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "お気に入り", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /EXPERIMENT_RESULTS.*実験結果/ }),
  ).toBeVisible();
});
test("API rejects injection, inaccessible fields, bad aggregation and respects dataset scope", async ({
  request,
}) => {
  const base = {
    source: "CHEM.SALES.ORDERS",
    dimensions: ["PRODUCT"],
    metrics: [{ field: "SALES_AMOUNT", aggregation: "SUM" }],
    filters: [],
    sort: [],
    detail: false,
    limit: 200,
    offset: 0,
  };
  for (const patch of [
    { sql: "SELECT 1" },
    { dimensions: ["PRODUCT; DROP TABLE X"] },
    { metrics: [{ field: "PRODUCT", aggregation: "SUM" }] },
    { limit: 100000 },
  ])
    expect(
      (
        await request.post("/api/query", {
          data: { query: { ...base, ...patch } },
        })
      ).status(),
    ).toBe(400);
  const r = await request.post("/api/query", {
    data: {
      query: {
        ...base,
        filters: [
          { field: "PRODUCT", operator: "eq", value: "x';DROP TABLE t;--" },
        ],
      },
    },
  });
  expect(r.status()).toBe(200);
  expect((await r.json()).rows).toEqual([]);
  const catalog = await (await request.get("/api/catalog")).json();
  const s = catalog.sources[0];
  const dataset = {
    id: "restricted-e2e",
    name: "Restricted",
    description: "test",
    source: s.id,
    fields: [
      { id: "PRODUCT", label: "製品", description: "", recommended: true },
    ],
    defaultView: { ...base, metrics: [] },
    drill: {},
  };
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "dataset", payload: dataset },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/query", {
        data: { query: base, datasetId: dataset.id },
      })
    ).status(),
  ).toBe(400);
});
test("all source kinds, cell include/exclude, paging, virtualization and empty state", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of ["INVENTORY", "QUALITY_EVENTS", "SALES_SEMANTIC"]) {
    await page.getByRole("button", { name: new RegExp(`▦ ${name} `) }).click();
    await page.getByRole("button", { name: "製品別 →" }).click();
    await ready(page);
    await expect(
      page
        .getByRole("cell")
        .getByRole("button", { name: "アクリル樹脂 A-100", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /SnowLens/ }).click();
  }
  await page.getByRole("button", { name: /▦ ORDERS / }).click();
  await ready(page);
  expect(await page.getByRole("row").count()).toBeLessThan(100);
  await page.getByRole("button", { name: "次のページ" }).click();
  await ready(page);
  await page.getByRole("button", { name: "製品別 →" }).click();
  await ready(page);
  await page
    .getByRole("cell")
    .getByRole("button", { name: "アクリル樹脂 A-100", exact: true })
    .click();
  await page.getByRole("button", { name: "この値を除外", exact: true }).click();
  await ready(page);
  await expect(
    page
      .getByRole("cell")
      .getByRole("button", { name: "アクリル樹脂 A-100", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "← 元に戻る" }).click();
  await ready(page);
  await page
    .getByRole("cell")
    .getByRole("button", { name: "アクリル樹脂 A-100", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この値だけ見る", exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole("table")).toHaveAttribute("aria-rowcount", "2");
  await page.getByLabel("条件1の値").fill("存在しない製品");
  await ready(page);
  await expect(
    page.getByText("条件に一致するデータがありません"),
  ).toBeVisible();
});
test("preserves previous results during loading and retries errors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page.route("**/api/query", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.getByRole("button", { name: "売上 円 · SUMで並べ替え" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("更新中…", { exact: true })).toBeVisible();
  await ready(page);
  await page.unroute("**/api/query");
  await page.route("**/api/query", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "接続を確認してください" }),
    }),
  );
  await page.getByRole("button", { name: "↻ 更新" }).click();
  await expect(page.locator(".error-banner")).toContainText(
    "接続を確認してください",
  );
  await expect(page.getByRole("table")).toBeVisible();
  await page.unroute("**/api/query");
  await page.getByRole("button", { name: "再試行" }).click();
  await ready(page);
});
test("editing an existing detail Dataset refreshes unpublished columns", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /▦ ORDERS / }).click();
  await ready(page);
  await page.getByRole("button", { name: "Datasetとして公開" }).click();
  await page.getByLabel("Dataset名", { exact: true }).fill("公開項目 E2E");
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Datasetを公開" })).toHaveCount(
    0,
  );
  await ready(page);
  await expect(
    page.getByRole("button", { name: "温度 °Cで並べ替え" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Datasetを編集" }).click();
  await page.getByLabel("TEMPERATUREを公開").uncheck();
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Datasetを公開" })).toHaveCount(
    0,
  );
  await ready(page);
  await expect(
    page.getByRole("button", { name: "温度 °Cで並べ替え" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "TEMPERATUREで並べ替え" }),
  ).toHaveCount(0);
});

test("filter candidates respect context and aggregate values lead to detail", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page.getByRole("button", { name: "＋ 条件", exact: true }).click();
  await pick(page, "検索条件の項目を選ぶ", "PRODUCT");
  await page.getByRole("button", { name: "候補を取得", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "他の検索条件に合う候補" }),
  ).toBeVisible();
  const choices = await page
    .locator("datalist option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(choices).toContain("アクリル樹脂 A-100");
  await page.getByLabel("条件1の値").fill("アクリル樹脂 A-100");
  await ready(page);
  const row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "アクリル樹脂 A-100",
        exact: true,
      }),
    })
    .first();
  await row.getByRole("cell").last().getByRole("button").click();
  await expect(
    page.getByRole("button", { name: "この値だけ見る", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "この数字の明細を見る", exact: true })
    .click();
  await ready(page);
  await expect(page.getByText("明細を表示中", { exact: false })).toBeVisible();
  await expect(page.getByLabel("条件1の値")).toHaveValue("アクリル樹脂 A-100");
  await page.screenshot({ path: "artifacts/filter-candidates.png" });
});

test("lazy catalog browses database/schema and opens unloaded Datasets", async ({
  page,
}) => {
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: { sources: [], mode: "snowflake" } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "データベースを表示", exact: true })
    .click();
  await page.locator("summary").filter({ hasText: "CHEM" }).click();
  await page
    .getByRole("button", { name: "スキーマを表示", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: /^SALES$/ })
    .click();
  await page
    .locator("summary:visible")
    .filter({ hasText: /^TABLE$/ })
    .click();
  await page.getByRole("button", { name: "データを表示", exact: true }).click();
  await page.getByRole("button", { name: /ORDERS.*受注明細/ }).click();
  await ready(page);
  await page.getByRole("button", { name: /SnowLens/ }).click();
  await page.getByRole("button", { name: /DATASET 品質異常/ }).click();
  await ready(page);
  await page.screenshot({ path: "artifacts/lazy-catalog.png" });
});

test("semantic fact drill-through retains context, projects published fields and fails closed", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/catalog")).json();
  const source = catalog.sources.find(
    (s: { kind: string }) => s.kind === "semantic_view",
  );
  const target = catalog.sources.find(
    (s: { name: string }) => s.name === "ORDERS",
  );
  const query = {
    source: source.id,
    dimensions: ["PRODUCT"],
    metrics: [{ field: "SALES_AMOUNT", aggregation: "SEMANTIC" }],
    filters: [],
    sort: [],
    detail: false,
    limit: 200,
    offset: 0,
  };
  const dataset = {
    id: "semantic-facts-e2e",
    name: "Semantic 明細 E2E",
    description: "",
    source: source.id,
    fields: source.fields.map((f: { id: string; label: string }) => ({
      id: f.id,
      label: f.label,
      description: "",
      recommended: true,
    })),
    defaultView: query,
    drill: {},
    factDetail: {
      source: target.id,
      fields: ["PRODUCT", "LOT_NO"],
      mapping: { PRODUCT: "PRODUCT", REGION: "REGION" },
    },
  };
  const publish = await request.post("/api/state", {
    data: { kind: "dataset", payload: dataset },
  });
  expect(publish.ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET Semantic 明細 E2E/ }).click();
  await ready(page);
  const row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "アクリル樹脂 A-100",
        exact: true,
      }),
    })
    .first();
  await row.getByRole("cell").last().getByRole("button").click();
  await page
    .getByRole("button", { name: "この数字の明細を見る", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "元データの明細" });
  await expect(dialog.getByRole("columnheader")).toHaveCount(2);
  await expect(
    dialog
      .getByRole("cell")
      .getByRole("button", { name: "アクリル樹脂 A-100", exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "次のページ", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/semantic-fact-detail.png" });
  await dialog.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "前のページ", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "集計表に戻る", exact: true })
    .click();
  await expect(
    page.getByRole("columnheader").filter({ hasText: "売上" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Datasetを編集", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Datasetを公開" });
  await editor
    .getByRole("button", { name: "設定を読み込む", exact: true })
    .click();
  await expect(editor.getByLabel("PRODUCTの明細対応")).toHaveValue("PRODUCT");
  await expect(editor.getByLabel("LOT_NOを明細に表示")).toBeChecked();
  await editor.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await ready(page);
  const bad = await request.post("/api/fact-detail", {
    data: {
      datasetId: dataset.id,
      query: {
        ...query,
        filters: [{ field: "CUSTOMER", operator: "eq", value: "X" }],
      },
    },
  });
  expect(bad.status()).toBe(400);
  const hidden = await request.post("/api/fact-detail", {
    data: {
      datasetId: dataset.id,
      query: {
        ...query,
        filters: [{ field: "REGION", operator: "eq", value: "東日本" }],
      },
    },
  });
  expect(hidden.ok()).toBe(true);
  const data = await hidden.json();
  expect(data.result.columns).toEqual(["PRODUCT", "LOT_NO"]);
  expect(data.source.fields.map((f: { id: string }) => f.id)).toEqual([
    "PRODUCT",
    "LOT_NO",
  ]);
  expect(Object.keys(data.result.rows[0])).toEqual(["PRODUCT", "LOT_NO"]);
  expect(
    (
      await request.post("/api/state", {
        data: {
          kind: "dataset",
          payload: {
            ...dataset,
            factDetail: { ...dataset.factDetail, fields: ["SECRET"] },
          },
        },
      })
    ).status(),
  ).toBe(400);
});

test("semantic metric selection adds required dimensions from metadata", async ({
  page,
}) => {
  await page.route("**/api/catalog?source=*&metric=*", async (route) => {
    const response = await route.fetch();
    const source = await response.json();
    source.fields = source.fields.map((f: { id: string }) =>
      f.id === "SALES_AMOUNT"
        ? {
            ...f,
            compatibleDimensions: ["PRODUCT", "ORDER_DATE"],
            requiredDimensions: ["ORDER_DATE"],
          }
        : f,
    );
    await route.fulfill({ json: source });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /SALES_SEMANTIC.*意味定義済み/ })
    .click();
  await page
    .getByRole("button", { name: "表示を組み立てる", exact: true })
    .click();
  await pick(page, "行の項目を選ぶ", "PRODUCT");
  await page.getByRole("button", { name: "＋ 値を追加" }).click();
  await pick(page, "集計する値を選ぶ", "SALES_AMOUNT");
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "受注日" }),
  ).toBeVisible();
  await expect(
    page.getByText(/指標に必要な行項目を追加しました/),
  ).toBeVisible();
});

test("Access-style personal table: paste, join, group, save, reopen and edit", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "＋ 個人テーブルを作る", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "個人テーブルを編集" });
  await editor
    .getByLabel("個人テーブル名", { exact: true })
    .fill("E2E 個人分類");
  await editor.locator("summary").click();
  await editor
    .getByLabel("表を貼り付け", { exact: true })
    .fill(
      "製品\t個人分類\nアクリル樹脂 A-100\t重点\n存在しない製品\tその他"
        .replaceAll("\\t", "\t")
        .replaceAll("\\n", "\n"),
    );
  await editor
    .getByRole("button", { name: "貼り付けを読み込む", exact: true })
    .click();
  await expect(
    editor.getByLabel("1行目 個人分類", { exact: true }),
  ).toHaveValue("重点");
  await editor
    .getByRole("button", { name: "個人テーブルを保存", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page
    .getByRole("button", { name: "個人テーブルを結合", exact: true })
    .click();
  const builder = page.getByRole("dialog", { name: "個人テーブルを結合" });
  await builder
    .getByLabel("元データの結合キー", { exact: true })
    .selectOption("PRODUCT");
  await builder
    .getByLabel("個人テーブルの結合キー", { exact: true })
    .selectOption("c1");
  await builder
    .getByRole("button", { name: "結合を確認", exact: true })
    .click();
  await expect(builder.getByRole("status")).toContainText("一致 2,000行");
  await expect(builder.getByRole("status")).toContainText("未一致 10,000行");
  await page.screenshot({ path: "artifacts/personal-join-builder.png" });
  await builder
    .getByRole("button", { name: "この結合で見る", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "＋ 行の項目を追加", exact: true })
    .click();
  await pick(page, "行の項目を選ぶ", "E2E 個人分類 · 個人分類");
  await ready(page);
  await expect(
    page.getByRole("cell").getByRole("button", { name: "重点", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "☆ 表示を保存", exact: true }).click();
  await page.getByLabel("保存する表示名").fill("個人分類で分析 E2E");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await page.getByRole("button", { name: /SnowLens/ }).click();
  await page.getByRole("button", { name: /個人分類で分析 E2E/ }).click();
  await ready(page);
  await expect(
    page.getByRole("cell").getByRole("button", { name: "重点", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "個人テーブルを編集", exact: true })
    .click();
  await editor.getByLabel("1行目 個人分類", { exact: true }).fill("最重点");
  await editor
    .getByRole("button", { name: "個人テーブルを保存", exact: true })
    .click();
  await ready(page);
  await expect(
    page.getByRole("cell").getByRole("button", { name: "最重点", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/personal-joined-result.png" });
  await page.getByRole("button", { name: "結合を変更", exact: true }).click();
  await builder.getByLabel("一致する行だけ見る", { exact: true }).check();
  await builder
    .getByRole("button", { name: "結合を確認", exact: true })
    .click();
  await expect(
    builder.getByRole("button", { name: "この結合で見る", exact: true }),
  ).toBeEnabled();
  await builder
    .getByRole("button", { name: "この結合で見る", exact: true })
    .click();
  await ready(page);
  await expect(
    page.getByRole("cell").getByRole("button", { name: "最重点", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "結合を外す", exact: true }).click();
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "個人分類" }),
  ).toHaveCount(0);
});

test("personal join API denies unknown tables, duplicate keys, unpublished keys and sharing", async ({
  request,
}) => {
  const source = (
    await (await request.get("/api/catalog")).json()
  ).sources.find((s: { name: string }) => s.name === "ORDERS");
  const query = {
    source: source.id,
    detail: true,
    dimensions: [],
    metrics: [],
    filters: [],
    sort: [],
    limit: 200,
    offset: 0,
    join: {
      tableId: "duplicate-test",
      sourceField: "PRODUCT",
      tableField: "key",
      type: "left",
    },
  };
  const unknown = await request.post("/api/query", { data: { query } });
  expect(unknown.status()).toBe(400);
  const table = {
    id: "duplicate-test",
    name: "重複テスト",
    columns: [{ id: "key", label: "キー", type: "TEXT" }],
    rows: [["a"], ["a"]],
  };
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "personal", payload: table },
      })
    ).ok(),
  ).toBe(true);
  const duplicate = await request.post("/api/join-preview", {
    data: { query },
  });
  expect(duplicate.status()).toBe(400);
  expect((await duplicate.json()).error).toContain("重複");
  await request.post("/api/state", {
    data: { kind: "personal", payload: { ...table, rows: [["a"]] } },
  });
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "personal", payload: table },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/state", {
        data: {
          kind: "personal_delete",
          payload: { id: table.id, version: 1 },
        },
      })
    ).status(),
  ).toBe(400);
  const listed = (
    await (await request.get("/api/state")).json()
  ).personalTables.find((t: { id: string }) => t.id === table.id);
  expect(listed.rows).toEqual([]);
  expect(listed.rowCount).toBe(1);
  const dataset = {
    id: "join-scope",
    name: "公開列の範囲",
    description: "",
    source: source.id,
    fields: [
      { id: "QUANTITY", label: "数量", description: "", recommended: true },
    ],
    defaultView: { ...query, join: undefined },
    drill: {},
  };
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "dataset", payload: dataset },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/query", {
        data: { query, datasetId: dataset.id },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "dataset", payload: { ...dataset, defaultView: query } },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/state", {
        data: {
          kind: "personal_delete",
          payload: { id: table.id, version: 2 },
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post("/api/query", { data: { query } })).status()).toBe(
    400,
  );
});

test("node table join checks row growth, joins lookup and saves private field definitions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page
    .getByRole("button", { name: "テーブル同士を結合", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "テーブル同士を結合" });
  await dialog.getByRole("button", { name: /CHEM.MASTER.PRODUCTS/ }).click();
  await expect(
    dialog.getByLabel("元データのキー 製品", { exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "結合を確認", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("結合後 12,000行");
  await page.screenshot({ path: "artifacts/table-join-nodes.png" });
  await dialog.getByRole("button", { name: "この結合で見る" }).click();
  await ready(page);
  await page.getByRole("button", { name: "＋ 行の項目を追加" }).click();
  await pick(page, "行の項目を選ぶ", "PRODUCTS · 製品分類");
  await ready(page);
  await expect(
    page.getByRole("cell", { name: "樹脂", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "自分用の項目名", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "個人用の項目名を編集" });
  await editor
    .getByLabel("PRODUCTの個人表示名", { exact: true })
    .fill("自分の製品名");
  await editor
    .getByLabel("PRODUCTの個人説明", { exact: true })
    .fill("営業向けの個人説明");
  await editor.getByRole("button", { name: "この分析に反映" }).click();
  await expect(
    page.getByRole("columnheader").filter({ hasText: "自分の製品名" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "☆ 表示を保存" }).click();
  await page.getByLabel("保存する表示名").fill("製品ノード分析 E2E");
  await page
    .getByRole("dialog", { name: "表示を保存" })
    .getByRole("button", { name: "保存する", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "表示を保存" })).toHaveCount(0);
  await page.getByRole("button", { name: "データを探す", exact: true }).click();
  await page.getByRole("button", { name: /製品ノード分析 E2E/ }).click();
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "自分の製品名" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Semantic Viewの下書き", exact: true })
    .click();
  const publication = page.getByRole("dialog", {
    name: "セマンティックビューの公開下書き",
  });
  await publication
    .getByRole("button", { name: "公開SQLを作る", exact: true })
    .click();
  await expect(
    publication.getByLabel("公開SQL", { exact: true }),
  ).toContainText("CREATE SEMANTIC VIEW");
  await expect(
    publication.getByLabel("公開SQL", { exact: true }),
  ).toContainText("LEFT JOIN");
  await expect(
    publication.getByLabel("公開SQL", { exact: true }),
  ).not.toContainText("自分の製品名");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    publication
      .getByRole("button", { name: "公開SQLを保存", exact: true })
      .click(),
  ]);
  expect(download.suggestedFilename()).toBe("ORDERS_ANALYSIS.sql");
  await publication
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "結合を変更", exact: true }).click();
  await dialog.getByText("結合先を選ぶ", { exact: false }).click();
  await dialog
    .getByRole("button", { name: /CHEM.PRODUCTION.PRODUCTION_LOG/ })
    .click();
  await dialog.getByLabel("元データのキー 製品", { exact: true }).click();
  await dialog.getByLabel("結合先のキー 製品", { exact: true }).click();
  await dialog.getByRole("button", { name: "結合を確認", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("結合後 24,000,000行");
  await expect(dialog.getByText(/6種類のキーが重複/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "この結合で見る" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "キャンセル", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "この結合で見る" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/table-join-mobile.png" });
});

test("select visible columns, group measures together and save exact totals and subtotals", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /ORDERS.*受注明細/ }).click();
  await ready(page);
  await page.getByLabel("製品の列を選択", { exact: true }).check();
  await page.getByLabel("顧客の列を選択", { exact: true }).check();
  await page.getByLabel("売上 円の列を選択", { exact: true }).check();
  await expect(page.getByText("3列を選択中", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/columns-selected.png" });
  await page.getByRole("button", { name: "選択列で集計", exact: true }).click();
  await ready(page);
  await expect(page.getByLabel("売上 円の集計方法")).toHaveValue("SUM");
  const query = {
    source: "CHEM.SALES.ORDERS",
    dimensions: [],
    metrics: [{ field: "SALES_AMOUNT", aggregation: "AVG" }],
    filters: [],
    sort: [],
    detail: false,
    limit: 1,
    offset: 0,
  };
  const expected = await (
    await request.post("/api/query", { data: { query } })
  ).json();
  await page.getByLabel("小計を表示").check();
  await ready(page);
  await expect(page.locator(".subtotal-row").first()).toBeVisible();
  await expect(
    page.locator(".subtotal-row").first().getByRole("button").first(),
  ).toBeDisabled();
  await page.getByLabel("売上 円の集計方法").selectOption("AVG");
  await ready(page);
  const total = page.getByRole("region", { name: "条件に合う全行の総計" });
  await expect(total).toContainText(
    expected.rows[0].SALES_AMOUNT__AVG.toLocaleString("ja-JP", {
      maximumFractionDigits: 2,
    }),
  );
  await page.screenshot({ path: "artifacts/grouped-subtotals.png" });
  await page.getByRole("button", { name: "☆ 表示を保存" }).click();
  await page.getByLabel("保存する表示名").fill("明細から一括集計 E2E");
  await page
    .getByRole("dialog", { name: "表示を保存" })
    .getByRole("button", { name: "保存する", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "表示を保存" })).toHaveCount(0);
  await page.getByRole("button", { name: "データを探す", exact: true }).click();
  await page.getByRole("button", { name: /明細から一括集計 E2E/ }).click();
  await ready(page);
  await expect(page.getByLabel("小計を表示")).toBeChecked();
  await expect(page.getByLabel("売上 円の集計方法")).toHaveValue("AVG");
  await expect(total).toContainText(
    expected.rows[0].SALES_AMOUNT__AVG.toLocaleString("ja-JP", {
      maximumFractionDigits: 2,
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(total).toBeVisible();
  await page.screenshot({
    path: "artifacts/grouped-totals-mobile.png",
    fullPage: true,
  });
});

test("drag visible detail columns into rows and values, reorder them and batch pick measures", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ORDERS.*受注明細/ }).click();
  await ready(page);
  await page
    .getByRole("button", { name: "製品で並べ替え", exact: true })
    .dragTo(page.getByTestId("row-drop-zone"));
  await ready(page);
  await expect(
    page.getByRole("columnheader").filter({ hasText: "売上 円" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "顧客で並べ替え", exact: true })
    .dragTo(page.getByTestId("row-drop-zone"));
  await ready(page);
  await page
    .getByRole("button", { name: "売上 円で並べ替え", exact: true })
    .dragTo(page.getByTestId("value-drop-zone"));
  await ready(page);
  await expect(page.getByLabel("売上 円の集計方法")).toHaveValue("SUM");
  await page
    .getByRole("button", { name: "顧客を行で上へ", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "この項目で集計", exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole("columnheader").first()).toContainText("顧客");
  await expect(page.getByRole("columnheader").nth(1)).toContainText("製品");
  await page.getByRole("button", { name: "＋ 値を追加", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "集計する値を選ぶ" });
  await picker.getByLabel("数量 kgを選択", { exact: true }).check();
  await picker.getByLabel("温度 °Cを選択", { exact: true }).check();
  await picker
    .getByRole("button", { name: "選んだ2項目を追加", exact: true })
    .click();
  await ready(page);
  await expect(page.getByLabel("数量 kgの集計方法")).toHaveValue("SUM");
  await expect(page.getByLabel("温度 °Cの集計方法")).toHaveValue("SUM");
  await page.getByRole("button", { name: "← 元に戻る", exact: true }).click();
  await ready(page);
  await expect(page.getByLabel("数量 kgの集計方法")).toHaveCount(0);
  await expect(page.getByLabel("温度 °Cの集計方法")).toHaveCount(0);
});

test("live-mode UI rechecks repeated queries and removes previous results after access denial", async ({
  page,
}) => {
  await page.route("**/api/catalog", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, mode: "snowflake" } });
  });
  let queries = 0;
  await page.route("**/api/query", async (route) => {
    queries++;
    if (queries === 3)
      await route.fulfill({
        status: 403,
        json: { error: "現在の権限でこのデータを閲覧できません。" },
      });
    else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: /DATASET 受注実績/ }).click();
  await ready(page);
  await page.getByLabel("売上 円の集計方法").selectOption("AVG");
  await ready(page);
  await page.getByLabel("売上 円の集計方法").selectOption("SUM");
  await expect(page.locator(".error-banner")).toContainText("現在の権限");
  await expect(page.getByRole("table", { name: "検索結果" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "条件に合う全行の総計" }),
  ).toHaveCount(0);
  expect(queries).toBe(3);
});

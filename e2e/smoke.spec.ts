import { test, expect, type Page } from "@playwright/test";
async function pick(page: Page, title: string, id: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByLabel("項目を検索", { exact: true }).fill(id);
  await dialog.getByRole("button").filter({ hasText: id }).click();
}
async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "↓ CSV" })).toBeEnabled();
  await expect(page.locator(".error-banner")).toHaveCount(0);
}
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
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ CSV" }).click();
  await expect((await download).suggestedFilename()).toBe("snowlens.csv");
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

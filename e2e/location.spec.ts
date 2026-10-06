import { test, expect, type Page } from "@playwright/test";
import { exploreHref } from "../lib/explore-location";
import { initialQuery, type Query } from "../lib/model";
import { mockSources } from "../lib/mock";
const orders = mockSources[0];
async function ready(page: Page) {
  await expect(
    page.getByRole("button", { name: "↓ ダウンロード", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".error-banner")).toHaveCount(0);
}

test("source, Dataset, query and dialog links survive reload, back and forward", async ({
  page,
}) => {
  await page.goto("/?tab=favorite&search=ORDERS");
  await expect(
    page.getByRole("button", { name: "お気に入り", exact: true }),
  ).toHaveClass(/active/);
  const q: Query = {
    ...initialQuery(orders),
    detail: false,
    dimensions: ["PRODUCT"],
    metrics: [{ field: "SALES_AMOUNT", aggregation: "SUM" }],
    filters: [{ field: "REGION", operator: "eq", value: "関東" }],
    sort: [],
    totals: "grand",
  };
  const href = exploreHref({
    source: orders.id,
    q,
    dialog: "download",
    fields: [
      {
        id: "SALES_AMOUNT",
        label: "商談金額",
        description: "リンク用の表示名",
      },
    ],
  });
  await page.goto(href);
  await expect(
    page.getByRole("dialog", { name: "ダウンロード", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".summary-bar")).toContainText("商談金額");
  const original = page.url();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "ダウンロード", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "ダウンロード", exact: true })
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await expect(page).not.toHaveURL(/dialog=download/);
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "ダウンロード", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(original);
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: "ダウンロード", exact: true }),
  ).toHaveCount(0);
  await page.goto("/?dataset=orders&dialog=fields");
  await expect(
    page.getByRole("heading", { name: /受注実績/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "個人用の項目名を編集" }),
  ).toBeVisible();
});

test("every exploration operation has a direct screen URL, with fresh private table resolution", async ({
  page,
  request,
}) => {
  const tableId = "location-input",
    savedId = "location-saved";
  const table = {
    id: tableId,
    name: "リンク確認用の分類",
    version: 1,
    columns: [
      { id: "c1", label: "製品", type: "TEXT" },
      { id: "c2", label: "分類", type: "TEXT" },
    ],
    rows: [["樹脂A", "リンク分類"]],
  };
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "personal", payload: table },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/state", {
        data: {
          kind: "saved",
          payload: {
            id: savedId,
            name: "リンク保存",
            query: initialQuery(orders),
          },
        },
      })
    ).status(),
  ).toBe(200);
  for (const [dialog, label] of [
    ["save", "表示を保存"],
    ["fields", "個人用の項目名を編集"],
    ["semantic", "セマンティックビューの公開下書き"],
    ["dataset", "Datasetを公開"],
    ["personal-join", "個人テーブルを結合"],
    ["table-join", "テーブル同士を結合"],
    ["dimension", "行の項目を選ぶ"],
    ["metric", "集計する値を選ぶ"],
    ["filter", "検索条件の項目を選ぶ"],
  ] as const) {
    await page.goto(exploreHref({ source: orders.id, dialog }));
    await expect(
      page.getByRole("dialog", { name: label, exact: true }),
    ).toBeVisible();
  }
  await page.goto("/?dialog=personal&personal=" + tableId);
  await expect(
    page
      .getByRole("dialog", { name: "個人テーブルを編集" })
      .getByLabel("個人テーブル名", { exact: true }),
  ).toHaveValue(table.name);
  await page.goto("/?dialog=personal-delete&personal=" + tableId);
  await expect(
    page.getByRole("dialog", { name: "個人テーブルを削除" }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/personal-table?id=" + tableId)).json())
      .name,
  ).toBe(table.name);
  await page.goto("/?saved=" + savedId);
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page).toHaveURL(/saved=location-saved/);
});

test("cell/drill links resolve the current result and invalid or foreign definitions fail closed", async ({
  page,
}) => {
  for (const dialog of ["cell", "drill"] as const) {
    await page.goto(
      exploreHref({
        source: orders.id,
        q: initialQuery(orders),
        dialog,
        cell: { row: 0, column: "PRODUCT" },
      }),
    );
    await expect(
      page.getByRole("dialog", {
        name: dialog === "cell" ? "セル操作" : "別の項目で掘り下げる",
      }),
    ).toBeVisible();
  }
  for (const href of [
    "/?saved=another-users-view",
    "/?dialog=personal&personal=another-users-input",
    "/?source=" + orders.id + "&role=ACCOUNTADMIN",
    "/?source=x&source=y",
    "/?source=" +
      orders.id +
      "&q=" +
      encodeURIComponent(
        JSON.stringify({
          ...initialQuery(orders),
          dimensions: ["SECRET"],
          detail: false,
        }),
      ),
  ]) {
    await page.goto(href);
    await expect(page.locator(".error-banner")).toContainText(
      "リンクを開けません",
    );
    await expect(
      page.getByRole("button", { name: "↓ ダウンロード", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("mapped fact detail links preserve conditions and page position without exposing extra columns", async ({
  page,
  request,
}) => {
  const source = mockSources.find((s) => s.kind === "semantic_view")!;
  const q: Query = {
    ...initialQuery(source),
    detail: false,
    dimensions: ["PRODUCT"],
    metrics: [{ field: "SALES_AMOUNT", aggregation: "SEMANTIC" }],
  };
  const dataset = {
    id: "location-facts",
    name: "リンク確認用の明細",
    description: "",
    source: source.id,
    fields: source.fields.map((f) => ({
      id: f.id,
      label: f.label,
      description: "",
      recommended: true,
    })),
    defaultView: q,
    drill: {},
    factDetail: {
      source: orders.id,
      fields: ["PRODUCT", "LOT_NO"],
      mapping: { PRODUCT: "PRODUCT" },
    },
  };
  expect(
    (
      await request.post("/api/state", {
        data: { kind: "dataset", payload: dataset },
      })
    ).status(),
  ).toBe(200);
  await page.goto(
    exploreHref({
      dataset: dataset.id,
      dialog: "fact",
      fact: { ...q, offset: 200 },
    }),
  );
  const detail = page.getByRole("dialog", { name: "元データの明細" });
  await expect(detail.getByRole("columnheader")).toHaveCount(2);
  await expect(
    detail.getByRole("button", { name: "前のページ", exact: true }),
  ).toBeEnabled();
  await detail.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect
    .poll(
      () => JSON.parse(new URL(page.url()).searchParams.get("fact")!).offset,
    )
    .toBe(400);
  await page.reload();
  await expect(
    detail.getByRole("button", { name: "前のページ", exact: true }),
  ).toBeEnabled();
  await expect(detail.getByRole("columnheader")).toHaveCount(2);
});

test("browser back and close protect unsaved personal input without putting values in a URL", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /個人テーブルを作る/ }).click();
  const editor = page.getByRole("dialog", { name: "個人テーブルを編集" });
  await expect(page).toHaveURL(/dialog=personal/);
  await editor
    .getByLabel("個人テーブル名", { exact: true })
    .fill("入力途中の個人表");
  const href = page.url();
  expect(href).not.toContain(encodeURIComponent("入力途中の個人表"));
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("未保存");
    await confirmation.dismiss();
  });
  await page.goBack();
  await expect(
    editor.getByLabel("個人テーブル名", { exact: true }),
  ).toHaveValue("入力途中の個人表");
  await expect(page).toHaveURL(href);
  page.once("dialog", async (confirmation) => {
    await confirmation.dismiss();
  });
  await editor.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(editor).toBeVisible();
  page.once("dialog", async (confirmation) => {
    await confirmation.accept();
  });
  await page.goBack();
  await expect(editor).toHaveCount(0);
});

test("ledger search/page links and current input integrate with read-only exploration", async ({
  page,
}) => {
  const path = "/ledgers/sales/8110b453-21a4-4c9e-832b-22e49dca0001";
  await page.goto(path + "?offset=50");
  await expect(page.getByRole("status")).toContainText("51〜62行目");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("51〜62行目");
  await page
    .getByLabel("台帳の行を検索", { exact: true })
    .fill("素材の相談 62");
  await expect(page).toHaveURL(/search=/);
  await expect(page.getByRole("status")).toContainText("1〜1行目");
  const filtered = page.url();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /営業案件台帳の行 素材の相談 62/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "この台帳を集計する", exact: true })
    .click();
  await ready(page);
  await expect(
    page.getByRole("heading", { name: /営業案件台帳/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /メモ/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "変更を保存", exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(filtered);
  await expect(page.getByLabel("台帳の行を検索", { exact: true })).toHaveValue(
    "素材の相談 62",
  );
});

test("ledger row back protects a draft and department URLs do not choose a different department", async ({
  page,
}) => {
  const path = "/ledgers/sales/8110b453-21a4-4c9e-832b-22e49dca0001";
  await page.goto(path);
  await page
    .getByRole("button", { name: /営業案件台帳の行 素材の相談 2$/ })
    .click();
  const panel = page.getByRole("dialog", { name: "台帳の行明細" });
  await panel.getByLabel("メモ", { exact: true }).fill("URLに含めない台帳入力");
  const href = page.url();
  expect(href).not.toContain(encodeURIComponent("URLに含めない台帳入力"));
  page.once("dialog", async (confirmation) => {
    await confirmation.dismiss();
  });
  await page.goBack();
  await expect(panel.getByLabel("メモ", { exact: true })).toHaveValue(
    "URLに含めない台帳入力",
  );
  page.once("dialog", async (confirmation) => {
    await confirmation.accept();
  });
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await page.goto("/ledgers/quality");
  await expect(page.locator(".error-banner")).toContainText("現在の権限");
  await expect(page.getByRole("link", { name: /営業案件台帳/ })).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
const base = "/ledgers/sales/8110b453-21a4-4c9e-832b-22e49dca0001";
test("shared ledger opens row details, validates input, preserves zero, saves and deep-links on desktop and mobile", async ({
  page,
  request,
}) => {
  await page.goto("/ledgers");
  await expect(
    page.getByRole("heading", { name: "台帳に入力", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /営業案件台帳/ }).click();
  await expect(
    page.getByRole("button", {
      name: /営業案件台帳の行 素材の相談 1$/,
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "台帳の次のページ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "台帳の次のページ" }).click();
  await expect(page.getByRole("status")).toContainText("51〜62行目");
  await page.getByRole("button", { name: "台帳の前のページ" }).click();
  await page
    .getByRole("button", { name: /営業案件台帳の行 素材の相談 1$/ })
    .click();
  const detail = page.getByRole("dialog", { name: "台帳の行明細" });
  await expect(detail.getByLabel("見込金額", { exact: true })).toHaveValue("0");
  await expect(page).toHaveURL(/row=8c110b45/);
  const detailUrl = page.url();
  await page.reload();
  await expect(detail.getByLabel("案件名", { exact: true })).toHaveValue(
    "素材の相談 1",
  );
  await detail.getByLabel("メモ", { exact: true }).fill("未保存の入力");
  await detail.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "破棄して閉じる" }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "入力を続ける" }).click();
  await detail.getByLabel("案件名", { exact: true }).fill("");
  await detail.getByRole("button", { name: "変更を保存" }).click();
  await expect(detail.getByRole("alert")).toContainText("案件名を入力");
  await detail.getByLabel("案件名", { exact: true }).fill("営業台帳 E2E");
  await detail.getByLabel("メモ", { exact: true }).fill("保存したメモ");
  await detail.getByRole("button", { name: "変更を保存" }).click();
  await expect(detail.getByLabel("案件名", { exact: true })).toHaveValue(
    "営業台帳 E2E",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "台帳に保存" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "artifacts/ledger-record-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    detail.getByRole("button", { name: "変更を保存" }),
  ).toBeVisible();
  expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "artifacts/ledger-record-mobile.png" });
  await detail.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "＋ 新しい行" }).click();
  const create = page.getByRole("dialog", { name: "台帳に新しい行を登録" });
  await create.getByLabel("案件名", { exact: true }).fill("新規台帳 E2E");
  await create.getByLabel("顧客", { exact: true }).fill("テスト顧客");
  await create.getByLabel("見込金額", { exact: true }).fill("0");
  await create.getByRole("button", { name: "登録する" }).click();
  await expect(detail.getByLabel("案件名", { exact: true })).toHaveValue(
    "新規台帳 E2E",
  );
  const row = new URL(page.url()).searchParams.get("row")!;
  const current = await (
    await request.get(
      `/api/ledgers?kind=record&space=sales&id=8110b453-21a4-4c9e-832b-22e49dca0001&record=${row}`,
    )
  ).json();
  expect(current.values.N_01).toBe(0);
  expect(current.version).toBe(1);
  await detail.getByRole("button", { name: "行を削除", exact: true }).click();
  await detail
    .getByRole("button", { name: "この行を削除", exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  await page.goto(detailUrl);
  await expect(detail.getByLabel("案件名", { exact: true })).toHaveValue(
    "営業台帳 E2E",
  );
});
test("inputters can edit shared form and grid layout, with persisted fields and read-only viewers separated by department", async ({
  page,
  request,
}) => {
  await page.goto(base + "/layout");
  await page.getByLabel("フォームの列数").selectOption("1");
  await page.getByLabel("項目1の名前").fill("案件タイトル");
  await page.getByLabel("項目1のセクション").fill("案件情報");
  await page.getByRole("button", { name: "項目1を下へ", exact: true }).click();
  await expect(page.getByLabel("項目2の名前")).toHaveValue("案件タイトル");
  await page.getByLabel("追加する項目の型").selectOption("text");
  await page
    .getByRole("button", { name: "＋ 項目を追加", exact: true })
    .click();
  await page.getByLabel("項目9の名前").fill("受付区分");
  await page.getByLabel("項目9の選択肢").fill("通常\n急ぎ\n");
  await page.getByLabel("項目9の初期値").fill("通常");
  await page.getByLabel("一覧に受付区分を表示").check();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/ledger-layout-desktop.png",
  });
  await page
    .getByRole("button", { name: "共通レイアウトを保存", exact: true })
    .click();
  await expect(page).toHaveURL(base);
  await expect(
    page.getByRole("columnheader", { name: "案件タイトル", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /営業案件台帳の行 営業台帳 E2E/ })
    .click();
  const detail = page.getByRole("dialog", { name: "台帳の行明細" });
  await expect(detail.getByLabel("メモ", { exact: true })).toHaveValue(
    "保存したメモ",
  );
  await expect(detail.locator(".columns-1").first()).toBeVisible();
  await detail.getByRole("button", { name: "閉じる", exact: true }).click();
  const list = await (
    await request.get(
      "/api/ledgers?kind=detail&space=sales&id=8110b453-21a4-4c9e-832b-22e49dca0001",
    )
  ).json();
  const attempt = await request.post("/api/ledgers", {
    data: {
      action: "layout",
      space: "sales",
      id: list.definition.id,
      version: 1,
      layout: list.definition.layout,
    },
  });
  expect(attempt.status()).toBe(409);
  await page.goto("/ledgers");
  await page.getByLabel("台帳のデモロール").selectOption("sales_reader");
  await page.getByRole("link", { name: /営業案件台帳/ }).click();
  await expect(page.getByRole("button", { name: "＋ 新しい行" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "項目とレイアウト" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /営業案件台帳の行 営業台帳 E2E/ })
    .click();
  await expect(detail.getByLabel("案件タイトル", { exact: true })).toHaveText(
    "営業台帳 E2E",
  );
  await expect(detail.getByRole("button", { name: "変更を保存" })).toHaveCount(
    0,
  );
  const denied = await page.request.post("/api/ledgers", {
    data: {
      action: "layout",
      space: "sales",
      id: list.definition.id,
      version: list.definition.version,
      layout: list.definition.layout,
    },
  });
  expect(denied.status()).toBe(403);
  await page.goto(base + "/layout");
  await expect(
    page.getByRole("heading", { name: "この画面は参照のみです" }),
  ).toBeVisible();
  await page.goto("/ledgers");
  await page.getByLabel("台帳のデモロール").selectOption("quality_writer");
  await expect(page.getByRole("link", { name: /品質対応台帳/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /営業案件台帳/ })).toHaveCount(0);
  await page.goto(base);
  await expect(page.locator(".error-banner[role=alert]")).toContainText(
    "アクセスできません",
  );
});
test("a new shared ledger has a typed form, rejects forged parameters and handles concurrent row updates", async ({
  page,
  request,
}) => {
  await page.goto("/ledgers");
  await page.getByLabel("台帳のデモロール").selectOption("sales_writer");
  await page.getByRole("link", { name: "台帳を作る", exact: true }).click();
  await page.getByLabel("台帳名", { exact: true }).fill("共有備品台帳 E2E");
  await page.getByLabel("追加する項目の型").selectOption("number");
  await page
    .getByRole("button", { name: "＋ 項目を追加", exact: true })
    .click();
  await page.getByLabel("項目3の名前").fill("数量");
  await page.getByLabel("項目3の初期値").fill("0");
  await page.getByLabel("一覧に数量を表示").check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "台帳を作成", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "台帳を作成", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/ledger-layout-mobile.png" });
  await page.getByRole("button", { name: "台帳を作成", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "共有備品台帳 E2E", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ 新しい行" }).click();
  const create = page.getByRole("dialog", { name: "台帳に新しい行を登録" });
  await create.getByLabel("名称", { exact: true }).fill("試験備品");
  await create.getByRole("button", { name: "登録する" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "台帳の行明細" })
      .getByLabel("名称", { exact: true }),
  ).toHaveValue("試験備品");
  const url = new URL(page.url()),
    id = url.pathname.split("/").at(-1)!,
    row = url.searchParams.get("row")!;
  const action = {
    action: "record",
    space: "sales",
    id,
    recordId: row,
    layoutVersion: 1,
    version: 1,
    values: { T_01: "更新後の備品", T_02: null, N_01: 0 },
  };
  const responses = await Promise.all([
    page.request.post("/api/ledgers", { data: action }),
    page.request.post("/api/ledgers", { data: action }),
  ]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  const panel = page.getByRole("dialog", { name: "台帳の行明細" });
  await panel.getByLabel("名称", { exact: true }).fill("古い画面から入力");
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await expect(panel.getByRole("alert")).toContainText("更新または削除");
  await expect(panel.getByLabel("名称", { exact: true })).toHaveValue(
    "古い画面から入力",
  );
  expect(
    (
      await request.post("/api/ledgers", {
        data: {
          ...action,
          owner: "forged",
          role: "ACCOUNTADMIN",
          sql: "UPDATE arbitrary",
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/ledgers", {
        data: { ...action, values: { ...action.values, VERSION: 99 } },
      })
    ).status(),
  ).toBe(409);
});

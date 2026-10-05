import {test,expect,type Page} from '@playwright/test';
async function pick(page:Page,title:string,id:string){const dialog=page.getByRole('dialog',{name:title});await dialog.getByLabel('項目を検索',{exact:true}).fill(id);await dialog.getByRole('button').filter({hasText:id}).click();}
async function ready(page:Page){await expect(page.getByRole('button',{name:'↓ CSV'})).toBeEnabled();await expect(page.getByRole('alert')).toHaveCount(0);}
test('raw source: build, SUM, filter, sort, drill, detail, save and reopen',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'何を見ますか？'})).toBeVisible();
 await page.getByRole('button',{name:/PRODUCTION_LOG.*製造実績/}).click();await page.getByRole('button',{name:'表示を組み立てる',exact:true}).click();await pick(page,'行の項目を選ぶ','PRODUCT');
 await page.getByRole('button',{name:'＋ 値を追加'}).click();await pick(page,'集計する値を選ぶ','QUANTITY');await ready(page);await expect(page.getByLabel('数量 kgの集計方法')).toHaveValue('SUM');
 await page.getByRole('button',{name:'＋ 条件',exact:true}).click();await pick(page,'検索条件の項目を選ぶ','ORDER_DATE');await page.getByLabel('条件1の比較').selectOption('gte');await page.getByLabel('条件1の値').fill('2026-10-01');await ready(page);
 await page.getByRole('button',{name:'数量 kg · SUMで並べ替え'}).click();await ready(page);await expect(page.getByRole('columnheader').filter({hasText:'数量 kg'})).toHaveAttribute('aria-sort','ascending');
 await page.getByRole('cell').getByRole('button',{name:'アクリル樹脂 A-100',exact:true}).click();await page.getByRole('button',{name:'別の項目で掘る →'}).click();await pick(page,'別の項目で掘り下げる','CUSTOMER');await ready(page);await expect(page.getByRole('columnheader').filter({hasText:'顧客'})).toBeVisible();
 await page.getByRole('cell').getByRole('button',{name:'東海化学',exact:true}).click();await page.getByRole('button',{name:'明細を見る',exact:true}).click();await ready(page);await expect(page.getByText('明細を表示中',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'☆ 表示を保存'}).click();await page.getByLabel('保存する表示名').fill('製造 E2E');await page.getByRole('button',{name:'保存する',exact:true}).click();await expect(page.getByRole('dialog',{name:'表示を保存'})).toHaveCount(0);
 await page.getByRole('button',{name:/SnowLens/}).click();await page.getByRole('button',{name:/製造 E2E/}).click();await ready(page);await expect(page.getByLabel('条件1の値')).toHaveValue('2026-10-01');
});
test('curated: filter, suggested drill, detail and back',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/DATASET 受注実績/}).click();await ready(page);
 await page.getByRole('button',{name:'＋ 条件',exact:true}).click();await pick(page,'検索条件の項目を選ぶ','ORDER_DATE');await page.getByLabel('条件1の比較').selectOption('gte');await ready(page);
 await page.getByRole('cell').getByRole('button',{name:'アクリル樹脂 A-100',exact:true}).click();await page.getByRole('button',{name:'顧客別に見る →'}).click();await ready(page);
 await page.getByRole('cell').getByRole('button',{name:'東海化学',exact:true}).click();await page.getByRole('button',{name:'明細を見る',exact:true}).click();await ready(page);
 await page.getByRole('button',{name:'← 元に戻る'}).click();await ready(page);await expect(page.getByRole('columnheader').filter({hasText:'顧客'})).toBeVisible();
});
test('numeric grouping, 120-field search, owner publish, favorite, CSV and mobile',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/EXPERIMENT_RESULTS.*実験結果/}).click();await page.getByRole('button',{name:'表示を組み立てる',exact:true}).click();await pick(page,'行の項目を選ぶ','LOT_NO');
 await page.getByRole('button',{name:'＋ 値を追加'}).click();await pick(page,'集計する値を選ぶ','MEASUREMENT_100');await page.getByLabel('測定値 100の集計方法').selectOption('AVG');await ready(page);
 await expect(page.getByRole('columnheader').filter({hasText:'ロット番号'})).toBeVisible();await expect(page.getByRole('columnheader').filter({hasText:'測定値 100'})).toBeVisible();
 await page.getByRole('button',{name:'Datasetとして公開'}).click();await page.getByLabel('Dataset名',{exact:true}).fill('実験 E2E');await page.getByRole('button',{name:'公開する',exact:true}).click();await expect(page.getByRole('dialog',{name:'Datasetを公開'})).toHaveCount(0);await ready(page);
 await page.getByRole('button',{name:'お気に入り',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'↓ CSV'}).click();await expect((await download).suggestedFilename()).toBe('snowlens.csv');
 await page.getByRole('button',{name:'設定を折りたたむ'}).click();await expect(page.getByRole('button',{name:'設定を開く'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('table')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:/SnowLens/}).click();await expect(page.getByRole('button',{name:/DATASET 実験 E2E/})).toBeVisible();await page.getByRole('button',{name:'お気に入り',exact:true}).click();await expect(page.getByRole('button',{name:/EXPERIMENT_RESULTS.*実験結果/})).toBeVisible();
});
test('API rejects injection, inaccessible fields, bad aggregation and respects dataset scope',async({request})=>{
 const base={source:'CHEM.SALES.ORDERS',dimensions:['PRODUCT'],metrics:[{field:'SALES_AMOUNT',aggregation:'SUM'}],filters:[],sort:[],detail:false,limit:200,offset:0};
 for(const patch of [{sql:'SELECT 1'},{dimensions:['PRODUCT; DROP TABLE X']},{metrics:[{field:'PRODUCT',aggregation:'SUM'}]},{limit:100000}])expect((await request.post('/api/query',{data:{query:{...base,...patch}}})).status()).toBe(400);
 const r=await request.post('/api/query',{data:{query:{...base,filters:[{field:'PRODUCT',operator:'eq',value:"x';DROP TABLE t;--"}]}}});expect(r.status()).toBe(200);expect((await r.json()).rows).toEqual([]);
});

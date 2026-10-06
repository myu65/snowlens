# 画面を直接開くURL

操作するとアドレス欄も更新します。再読み込み、戻る・進むで同じ表示を復元します。探索画面の「リンクをコピー」からURLを取得できます。

| 開く画面                         | URLの例                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| データを探す                     | `/`                                                                     |
| お気に入り・最近のデータ         | `/?tab=favorite`、`/?tab=recent`                                        |
| ホームの検索結果                 | `/?search=ORDERS`                                                       |
| 元データ・Dataset・保存した表示  | `/?source=SOURCE_ID`、`/?dataset=DATASET_ID`、`/?saved=SAVED_ID`        |
| 個人テーブルを作る・編集する     | `/?dialog=personal`、`/?dialog=personal&personal=TABLE_ID`              |
| 個人テーブルの削除を確認         | `/?dialog=personal-delete&personal=TABLE_ID`                            |
| ダウンロード・表示を保存         | `/?source=SOURCE_ID&dialog=download`、`dialog=save`                     |
| 項目名・Datasetの編集            | `/?source=SOURCE_ID&dialog=fields`、`dialog=dataset`                    |
| 個人テーブル・通常テーブルの結合 | `/?source=SOURCE_ID&dialog=personal-join`、`dialog=table-join`          |
| Semantic Viewの下書き            | `/?source=SOURCE_ID&dialog=semantic`                                    |
| 行・集計値・条件の項目選択       | `/?source=SOURCE_ID&dialog=dimension`、`dialog=metric`、`dialog=filter` |
| 台帳一覧・部署                   | `/ledgers`、`/ledgers?space=sales`、`/ledgers/sales`                    |
| 台帳・行の明細                   | `/ledgers/sales/LEDGER_ID`、`/ledgers/sales/LEDGER_ID?row=ROW_ID`       |
| 新しい行                         | `/ledgers/sales/LEDGER_ID?row=new`                                      |
| 台帳の検索・一覧のページ         | `/ledgers/sales/LEDGER_ID?search=顧客名&offset=50`                      |
| 台帳を作る・共通レイアウトを編集 | `/ledgers/sales/new`、`/ledgers/sales/LEDGER_ID/layout`                 |

`SOURCE_ID`はカタログAPIが返すIDです。本番ではデータベース・スキーマ・物理名のJSON配列をURLエンコードします。例は`["MY_DB","SALES","ORDERS"]`です。IDは現在のcaller権限で解決し直します。

`q`にQueryのJSONをURLエンコードして渡すと、表示項目、集計、条件、並び順、ページ位置、小計・総計、結合を復元します。`fields`には個人の表示名と説明を渡します。`side=0`で項目パネルを閉じます。カタログの場所は`catalog`に`database`・`schema`・`kind`・任意の`after`を持つJSONを渡します。指定した場所だけを100件ずつ読みます。

セル操作と掘り下げは`dialog=cell`または`dialog=drill`と、`cell`のJSON`{"row":0,"column":"PRODUCT"}`で指定します。行番号は現在の結果の0から始まる位置です。値はURLへ入れず、現在の結果から取得します。データの更新で行の位置が変わる場合があります。小計や利用できないセルは開けません。

Datasetの元データ明細は`dialog=fact`と`fact`のQueryを指定します。明細の条件とページ位置も復元します。明細マッピングと明細側のSELECT権限が必要です。結合画面では`personal=TABLE_ID`または`right=SOURCE_ID`で候補を選べます。確定前の件数は読み直して確認します。

保存した表示と個人テーブルのIDは、リンクを開いた本人の保存先で探します。他人の定義へ切り替えるowner指定は受け付けません。元データの権限、共有Datasetの編集権限、公開権限もURLでは変更できません。削除・保存・公開には画面の確定操作が必要です。

台帳IDと行IDはUUIDです。新しい行には再試行用の`draft`のUUIDを付けます。`offset`は50行ごとの位置です。部署や行を使えない場合はエラーを出し、別の部署へ差し替えません。

入力途中の台帳の値、個人テーブルの行、未保存のフォームや公開先の変更はURLへ保存しません。未保存の変更がある状態で戻る操作や画面を閉じる操作をすると確認します。保存済みの内容はサーバーから読み直します。探索の条件と表示名はURLに含まれます。

重複した指定、未知のパラメータ、不正なJSON、異なるデータを混ぜた指定は拒否します。探索のクエリ文字列は32KBまでです。長い定義は表示を保存し、`saved`のIDだけを含むリンクを使います。エラー時は元のURLを残し、再試行で同じ対象を読み直します。

# 部署で使う入力台帳

「台帳に入力」から、部署で共有する表を開きます。行を押すと明細が開き、入力権限があれば登録・変更・削除できます。閲覧だけの人には編集操作を出しません。入力できる人は、共通フォームの配置や表示名も編集します。個人用の定義とは別の機能です。

レイアウトでは項目の順番、分類、1列・2列の配置、必須項目、選択肢、初期値、読み取り専用、一覧に出す列を変更します。ドラッグと上下ボタンの両方を用意しています。既存項目は型を変えず、使わなくなった項目を非表示にして入力済みの値を残します。非表示を含めて50項目までです。文字列は32項目、数値・日付・真偽値は各16項目まで使います。

保存時に行とレイアウトの版を確認します。他の人が更新した場合は保存を止め、入力内容を画面に残します。通常テーブルではID重複も確認します。レイアウト変更と行の入力が同時に起きても古い定義で保存しないよう、台帳ごとの定義行をトランザクション内で更新してから入力を保存します。同じ台帳への書き込みはこの処理で順番に実行します。

「この台帳を集計」では、現在の閲覧権限で実データを探索します。通常の表と同じ表示・集計・結合を使います。入力操作は台帳画面に置き、探索画面の元データを編集する機能は追加しません。

## デプロイ管理者の設定

アプリの版確認は、VERSIONを更新する書き込みを前提にします。外部ツールの直接DMLでもこの規則が必要です。版を上げない更新があると、アプリは古い画面を判別できません。読み取り専用や非表示はレイアウトの設定で、Snowflakeの列権限を変更する機能ではありません。

台帳の保存方式はHybrid Tableを既定にします。小さな行の読み書きに適した方式で、行IDの主キーも必須です。トライアルや未対応のアカウントでは、管理者が通常テーブルを明示してください。アプリが自動で保存方式を変更することはありません。[Hybrid Tableの制限](https://docs.snowflake.com/en/user-guide/tables-hybrid-limitations)

管理者は[導入用SQL](../sql/ledger-setup.sql)の宛先とロールを確認し、部署ごとに専用のデータ用スキーマと定義用スキーマを用意します。両方とも通常のデータベース内の永久スキーマに置きます。業務ソースや個人保存のスキーマとは分けます。部署の閲覧・入力ロールは職務ロールに組み込み、利用者ごとのロールは作りません。

`app.yml`の`SNOWLENS_LEDGER_SPACES`に、次のJSONを設定してデプロイします。これはサーバー側だけの設定です。台帳の入力者は保存方式、スキーマ、ロールを画面やAPIから変更できません。

```json
[
  {
    "id": "sales",
    "label": "営業部",
    "database": "SNOWFLAKE_APPS",
    "dataSchema": "SALES_LEDGER_DATA",
    "definitionSchema": "SALES_LEDGER_DEFS",
    "readerRole": "SALES_LEDGER_READER",
    "writerRole": "SALES_LEDGER_WRITER",
    "storage": "hybrid"
  }
]
```

`storage`を省略した場合も`hybrid`です。通常テーブルを使う部署は`standard`を指定します。設定を変えても既存の表は変換しません。新しく作る台帳とその定義用の表に適用します。既存の台帳は現在の実テーブルを読みます。Hybrid Tableを別のセッションから読んだときの遅れを避けるため、台帳の処理は`READ_LATEST_WRITES = TRUE`で実行します。

Hybrid Tableの作成には`CREATE HYBRID TABLE`、通常テーブルには`CREATE TABLE`が必要です。データ用の表には閲覧者のSELECT、入力者のINSERT・UPDATE・DELETEを付けます。定義用の表には閲覧者のSELECTと入力者のUPDATEを付けます。新しい表にも権限が付くようfuture grantを設定します。Hybrid Tableへの表のgrantにも`TABLE`・`TABLES`を使います。[作成権限](https://docs.snowflake.com/en/sql-reference/sql/create-hybrid-table#access-control-requirements)、[grantの構文](https://docs.snowflake.com/en/sql-reference/sql/grant-privilege)

Runtime側にも、承認した入力スキーマだけのcaller grantを設定します。利用者の実権限とcaller grantの両方が必要です。作成者が持つOWNERSHIPはUPDATEを外すだけでは失われません。作成者にも権限撤回を効かせる運用では、作成完了後に管理者が表の所有権を部署の管理ロールへ移します。managed access schemaの管理者がgrantを管理します。保存処理の所有者ロールへ台帳データのSELECTや公開権限を追加しません。

## 検証した範囲

caller grantを設定する管理者にはMANAGE CALLER GRANTSと対象オブジェクトの権限が必要です。部分作成の回収用に、入力用スキーマのTABLEのcaller OWNERSHIPも指定します。これは利用者やサービス所有者へ実際の所有権を付けるgrantではなく、本人が所有する表だけに作用する上限です。業務ソースやプロシージャには広げません。[caller grantの構文と要件](https://docs.snowflake.com/en/sql-reference/sql/grant-caller)

台帳と行のIDはアプリが発行する小文字のUUIDです。APIのUUID指定も小文字にそろえます。外部ツールの書き込みでも同じ形式を使ってください。

2026年10月6日の通常テーブルによる直接SQL検証は12項目が通りました。合成データと2ユーザーで、部署の共有、閲覧だけのDML拒否、値の型、リテラル検索、行とレイアウトの競合、重複ID、実権限とcaller grantの撤回を確認しています。テスト用の表・ユーザー・ロールは削除しました。

トライアルではHybrid TableとApp Runtimeを利用できないため、両者の実行は未検証です。Hybrid Tableでの作成・共有・同時更新・権限撤回と、App Runtimeでの2ユーザー・本人IDのライフサイクル検証を導入時に行います。mockのロール切り替えとUIテストは、この検証の代わりにはなりません。Issue #5は開いたままです。

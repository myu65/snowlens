# 個人保存と権限の設計

個人定義は利用者本人のもので、元データを読む権限はSnowflakeが判断します。共有Datasetの編集とセマンティックビューの公開は、それぞれ別の権限を割り当てます。以下は実装と導入時の条件です。SQLプロシージャとApp Runtimeでの動作は、接続したアカウントでの検証が必要です。

## ロールは職務、個人保存は本人で分ける

Snowflakeの基本は、オブジェクトの権限をアクセス用のロールにまとめ、職務のロールへ割り当てるRBACです。SnowLensでは既存の業務ロールを使い、閲覧・Dataset編集・公開などの追加権限を共通のロールとして組み合わせます。人数に応じて個人ロールを作る設計ではありません。[公式のロール設計](https://docs.snowflake.com/en/user-guide/security-access-control-considerations)

同じ閲覧ロールを使う2人でも、個人定義と入力の所有者は別です。共通の保存表に本人の変更しないIDを記録し、行ポリシーで読み手を制限します。保存は本人のIDを確認する固定プロシージャを通します。元データのSELECT、個人保存、共有化はそれぞれ別の判断です。

App Runtimeのcaller権限は、サインインした利用者の既定ロールで実行されます。導入時は利用者側の権限と、Runtime側のcaller grantの両方で操作を許可します。SnowLensはブラウザー指定のロールへ切り替えません。実際のロールや行の制限が変わっても、個人保存の所有者は本人のIDで判断します。[App Runtimeの実行権限](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/access-control#execution-context)

ユーザーへの直接grantであるUBACは、個人開発や共同作業を補う選択肢です。現在の共通保存表では、SELECT grantだけでは本人の行に限定できないため、共通ロールと行ポリシーを使います。個人入力ごとに物理テーブルを作れば、本人への直接grantで表単位に分ける構成も使えます。後述の案では、この方式を通常の型付きテーブルとして扱います。[UBACの位置付け](https://docs.snowflake.com/en/user-guide/security-access-control-considerations#comparing-and-contrasting-rbac-with-ubac)

Personal Databaseには通常のテーブルデータを保存できないため、どちらの方式でも個人入力は通常のデータベースに置きます。[Personal Databaseの対象](https://docs.snowflake.com/en/user-guide/personal-databases)

導入時は、1つのデータベース内の権限をdatabase roleにまとめ、職務のaccount roleへ割り当てる構成も使えます。処理所有者のロールは管理者の階層に含め、最上位をSYSADMINへつなぎます。利用者やRuntimeに保存処理の所有者ロールを継承させません。通常のオブジェクト作成にはSYSADMIN配下のロールを使い、ACCOUNTADMINをアプリの実行ロールにしません。[ロールの階層と管理](https://docs.snowflake.com/en/user-guide/security-access-control-considerations#managing-custom-roles)

共有するSemantic Viewの公開先には、管理者がgrantを管理するmanaged access schemaを使う構成を推奨します。これは導入時の構成案です。アプリ内の公開実行やgrantの自動付与は実装していません。[grantの管理](https://docs.snowflake.com/en/user-guide/security-access-control-considerations#centralizing-grant-management-using-managed-access-schemas)

## 保存対象と保存先

| 対象         | 保存先              | 内容                                                                               | 読み手                   |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- | ------------------------ |
| 個人定義     | APP.METADATA        | 保存ビュー、結合、集計、条件、並び順、個人の項目名・説明、お気に入り、最近のデータ | 本人                     |
| 個人入力     | APP.PERSONAL_TABLES | 列の型、入力した行、版                                                             | 本人                     |
| 共有Dataset  | APP.DATASETS        | 業務名、公開項目、初期表示、明細マッピング                                         | アプリの利用者           |
| 保存者の対応 | APP.PRINCIPALS      | Snowflakeユーザー名、変更しない保存者ID、有効状態                                  | ID管理者と対応を読む関数 |

入力データを含む表を、定義だけの表から分けました。個人入力は1テーブル1,000行・12列・500KB、本人につき50テーブルまでです。一覧APIでは行を送らず、行数と列の定義を返します。編集と結合では所有者条件付きで対象IDだけを読み込みます。

本番の保存先はSnowflake内の通常の表です。ブラウザーやRuntimeのファイルシステムへ永続保存しません。小さな入力を毎回のクエリにバインドし、JSONから行に展開して結合します。利用者ごとの物理テーブル作成権限は要りません。一時テーブルはセッションをまたげないため、再利用する個人入力の保存先には使いません。[一時テーブルの仕様](https://docs.snowflake.com/en/user-guide/tables-temp-transient)

ローカルのmockだけは、gitignoreしたJSONファイルに保存します。mockは1人用で、複数人の権限分離を検証する用途には使えません。

## 個人入力をUBACの物理テーブルにする案

個人入力ごとに通常の型付きテーブルを作り、本人へSELECTを直接grantする案です。個人の分類や目標値を、Snowflakeの通常のSQLでも結合できます。個人ロールは作りません。表示名・説明・条件などの個人定義は共通保存表に残し、入力の保存方法だけを分ける構成です。アプリの保存先を変更する実装はまだなく、現在は入力も共通保存表を使います。

| 観点             | 現在の共通保存表             | UBACの物理テーブル案           |
| ---------------- | ---------------------------- | ------------------------------ |
| 入力の保存       | 本人ID付きのJSON             | 入力ごとの型付きテーブル       |
| 本人の参照       | 共通SELECTと行ポリシー       | 本人への表単位のSELECT grant   |
| 結合             | バインドしたJSONから行へ展開 | caller権限で通常のテーブル結合 |
| 管理対象         | 個人入力の行と版             | 表、grant、本人との対応、版    |
| 他ツールでの利用 | アプリが展開して利用         | 本人が通常のSQLで参照          |

UBACではCREATEとOWNERSHIPをユーザーへ渡せず、future grantも使えません。表の所有者には、管理者だけが継承する個人入力用のロールを使います。共通の閲覧ロールで作成すると、そのロールを使う全員が所有者の権限を得るため、個人用の作成には使いません。[直接grantの制約](https://docs.snowflake.com/en/sql-reference/sql/grant-privilege-user)

個人入力専用のmanaged access schemaに表を作り、grantはスキーマ管理者が本人へ付ける構成を想定しています。表の所有者はgrantを変更できません。入力用ロールには業務ソースのSELECTや公開権限を付けず、利用者とRuntimeには所有者ロールを渡しません。PUBLICや共通ロールへの入力表のSELECT、既存・future・inherited grantによる広い参照、WITH GRANT OPTIONは許可しません。[managed access schemaでのgrant](https://docs.snowflake.com/en/sql-reference/sql/grant-privilege-user#access-control-requirements)

作成処理は、認証した本人IDを確認し、サーバー側で物理名を発行します。本人ID・入力ID・物理名・世代・版を管理側の対応表に記録し、型の確認、表の作成、入力の保存、本人へのgrantが終わってから利用可能にします。途中で失敗した表は一覧や結合に出さず、残った表とgrantを回収します。ブラウザーが指定したowner、ユーザー名、物理名、SQLを作成処理へ渡す設計にはしません。未登録の本人は作成・参照を拒否します。アプリのカタログから物理表を選ぶ場合にも、個人入力用スキーマの表はこの対応で確認します。

初期案では、本人へ渡す表の直接権限はSELECTだけにします。アプリ内の編集は、本人との対応と版を確認する固定プロシージャで入力表だけを変更します。作成・grantの管理処理は既存の保存処理と分け、どちらにも業務ソースのSELECTや公開権限を追加しません。直接DMLを他ツールへ開放するとアプリの版管理とずれるため、別途更新・競合の設計が必要です。今回のSQL検証で試した直接DMLは、UBACの権限分離を確かめるテストです。

直接grantが有効になる条件は、全secondary roleの有効化です。ALLは本人に割り当てた他のロールも有効にするため、導入先のセッションポリシー、行・マスキングポリシー、アプリのcaller grantの制限と合わせて確認します。入力表のSELECTと必要なUSAGEだけをRuntimeのcaller grantへ追加し、業務ソースは許可した範囲を保ちます。アプリのセッション設定は今回変更していません。App RuntimeでUBACを使えることは、通常のSQLセッションやSQLプロシージャだけでは確認できません。[secondary roleの動作](https://docs.snowflake.com/en/sql-reference/sql/use-secondary-roles)、[Runtimeのcaller権限](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/access-control#execution-context)

grantの宛先には管理側で確認した現在のSnowflakeユーザーを使い、アプリの所有者は変更しない本人IDで記録します。名前の変更では対応を更新し、削除・退職では本人の無効化と直接grantの撤回を行います。対応表を無効にするだけでは、アプリ外の直接SELECTは止まりません。再作成・復旧では対応を無効にしてから表とgrantを確認し、新しい世代を登録します。同じ物理名だけで古い入力へ差し替えません。アカウントのDISABLE_USER_PRIVILEGE_GRANTSは新しい直接grantを止める設定で、既存grantの撤回にはなりません。[アカウント設定の仕様](https://docs.snowflake.com/en/sql-reference/parameters#disable-user-privilege-grants)

2026年10月6日の合成データによる直接SQL検証では、UBACの13項目が通りました。同じ閲覧ロールの2ユーザーを表単位に分け、本人の結合、権限撤回、名前の変更・再利用、削除後の再作成を確認しています。restricted callerのSQLプロシージャでも、本人に許可した表だけを結合でき、caller grantを外すと拒否されました。App Runtimeの検証はtrialアカウント制限で未実施です。[検証の範囲](snowflake-validation.md)

この案を採用する場合も、個人入力を共有Semantic Viewから直接参照する公開は行いません。共有入力への移行、公開範囲と更新責任の確認を経て、[結合と公開の手順](join-publication.md)に進みます。

## 保存者はロールやユーザー名だけで決めない

ロールが同じ人同士でも個人保存は別にします。所有者にはAPP.PRINCIPALSで管理する変更しないIDを使います。CURRENT_PRINCIPAL()は、Snowflakeが認証したCURRENT_USER()から有効な対応を1件だけ取得します。対応が未登録・重複、保存者IDが空欄、または同じIDが複数の有効ユーザーに割り当てられていればNULLになり、個人の読み書きは許可しません。ブラウザー指定のownerやセッション変数には切り替えません。

ユーザー名は変更・再利用されるため、保存者IDとは分けます。ID管理者はIdP/SCIMの変更しないIDか、本人用に発行したUUIDを登録します。名前の変更では同じIDを引き継ぎます。削除・退職ではアクセスと対応を無効にし、名前を再利用する前に古い対応を止めます。新しい人には新しいIDを発行します。この連携は導入先のID管理手順に組み込む条件で、アプリがSCIMを自動同期する実装ではありません。[SCIMの識別子](https://docs.snowflake.com/en/user-guide/scim-user-api-reference)

利用者が多い導入先では、IdPのグループをSCIMで共通ロールへ同期し、本人IDの登録・変更・無効化も同じ管理手順に含めます。SnowflakeのSCIMユーザーIDは変更しないGUIDですが、SHOW USERSやDESCRIBE USERには出ません。[SCIMのユーザー識別子](https://docs.snowflake.com/en/user-guide/scim-user-api-reference)を管理側で確認して登録し、氏名やLOGIN_NAMEから本人IDを推測しません。現在のアプリにはSCIM連携の処理がないため、この管理手順を省くことはできません。[SCIMのユーザーとグループ](https://docs.snowflake.com/en/user-guide/scim-intro)

利用者とRuntimeにPRINCIPALSの直接更新権限を渡しません。対応を読むSecure Functionの所有者は、対応表のSELECTだけを持ちます。名称の再利用と対応の無効化順序はIssue #5の検証に含めます。

「自分のみ」は一般利用者間の閲覧範囲です。IDやポリシーを変更できる管理者の管理操作を禁止する意味ではありません。対応の変更と復旧は、導入先の監査手順で管理します。

## 権限を操作単位で分ける

| 権限の役割                     | 許可する操作                                             | 保存表・元データへの直接権限                                                        |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| データ閲覧者                   | 現在の権限で表・View・Dynamic Table・Semantic Viewを開く | 許可した元データのSELECT、warehouseと親オブジェクトのUSAGE                          |
| 個人保存を使う利用者           | 自分の定義・入力の作成、変更、削除                       | 行ポリシー付き個人表のSELECT、WRITE_PRIVATE_STATEのUSAGE                            |
| Dataset編集者                  | 共有定義の作成と、自分が所有する定義の変更               | DATASETSのSELECT、WRITE_DATASETのUSAGE                                              |
| セマンティック公開者           | 承認されたソースを、指定スキーマと対象ロールへ公開       | 公開先のCREATE VIEW / CREATE SEMANTIC VIEW、必要なSELECT。閲覧者へのGRANTは別に管理 |
| 本人確認の関数・ポリシー所有者 | 有効な保存者IDの確認と行の閲覧制限                       | PRINCIPALSのSELECT。業務データのSELECTと保存DMLは付けない                           |
| 個人保存の処理所有者           | 所有者条件付きの保存DMLと保存者の対応取得                | 個人保存2表のDMLとCURRENT_PRINCIPALのUSAGE。業務データのSELECTと公開DDLは付けない   |
| Dataset保存の処理所有者        | 所有者条件付きの共有定義DML                              | DATASETSのDMLとCURRENT_PRINCIPALのUSAGE。個人表と業務データには権限を付けない       |

前の設計では利用者に保存表のDMLを付けていました。行アクセスポリシーは行の閲覧を制限しても、INSERTで指定する所有者までは制限しません。そのため、書き込みは固定処理だけを持つ専用プロシージャに絞りました。[行アクセスポリシーの仕様](https://docs.snowflake.com/en/user-guide/security-row-intro)

SQLプロシージャのowner権限は保存DMLに限定します。元データの探索、結合確認、集計、明細、SQL下書きのソース確認は、毎回の新しいrestricted callerセッションで実行します。保存処理から元データをSELECTしたり、読み込みに失敗してowner権限で再試行したりする処理はありません。[ownerとcallerの違い](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)

Runtimeのcaller grantには、利用者自身の権限のうち、許可したソースのSELECT、保存表のSELECT、対応関数・保存プロシージャのUSAGEだけを指定します。保存表の直接DML、業務テーブルのUPDATE、公開DDLは付けません。導入時には継承ロールやPUBLIC経由の古いDML grantも除きます。[restricted caller rights](https://docs.snowflake.com/en/developer-guide/restricted-callers-rights)

## 保存しても元データの権限は増えない

個人定義にはソースIDと項目IDを保存します。開き直すときにソースと結合先のカタログ・項目を再解決します。元データのSELECTがなくなれば実行を止め、保存した定義を別のソースへ差し替えません。

Datasetの公開項目は画面の範囲を決めます。利用者が元テーブルを直接SELECTできる場合、その権限をDatasetで取り消すことはできません。列や行を秘密にする条件は、Snowflakeのgrantとポリシーで設定します。結合先にも同じ確認が必要です。

個人の表示名と説明は、公開された項目の名前を変えるだけです。型や計算式や利用できる項目は増やせません。個人の分類・目標値は入力データであり、元データの行ポリシーやマスキングをコピーする機能ではありません。

## 版、削除、復旧

個人入力の更新・削除は読んだ版を指定します。保存処理は版が合った行だけを変更し、変更件数が1件でなければトランザクションを戻します。古い画面からの上書きは止めます。作成時のIDはUUIDです。標準Snowflake表は一意制約を強制しないため、重複レコードの検出と同時作成の検証も必要です。個人テーブル取得で同じ所有者・IDが複数なら実行を止めます。

保存ビューは入力データの最新の版を参照します。結果のスナップショットは作りません。テーブルを削除した保存ビューは、結合を外すか別の表を選ぶまで開けなくなります。

APIの削除は現在の保存行を削除します。SnowflakeのTime Travel、バックアップ、クエリ履歴、ブラウザーへ渡した既存の結果まで即時に消す操作ではありません。保持期間と管理者の復旧手順は導入先で決めます。個人入力を含むJSONはアプリのログやDDLコメントへ出しません。

## 導入と移行

新規導入はsetup.sql、利用者の対応登録、private-state.sql、dataset-state.sql、各処理の所有者とUSAGE grantの順で行います。行ポリシーにはEnterprise Edition以上が必要です。詳しい手順はdeployment.mdにあります。

旧版のユーザー名OWNERを使う領域は、自動で移行しません。アクセスを停止し、旧ポリシーを外す間の利用者grantを撤回してから、ID管理者が本人との対応を確認してIDへ変換します。新しい行ポリシーを付け、権限を戻して2ユーザーで確認します。現役ユーザーと同名の削除済みユーザーを、名前だけで同じ本人と判断しません。

2026年10月6日に、SnowflakeへSQLを直接実行して保存処理と本人の分離を確認しました。同じ閲覧ロールの2ユーザーによる個人入力の分離、ロール変更、名前の変更・再利用、未登録・重複・無効な対応、直接DMLの拒否、版の競合、Datasetの編集権限を確認しています。App Runtimeはtrialアカウント制限で起動できず、アプリ経由のcaller権限は未検証です。[検証の記録](snowflake-validation.md)に範囲を記載し、Issue #5を残します。

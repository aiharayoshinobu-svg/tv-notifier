# tv-notifier — テレビのつづき

神奈川県で見る番組の次回放送を検出し、iPhoneのホーム画面PWAへWeb Pushを送る**個人用アプリ**です。

**無料の公開GitHubリポジトリ、GitHub Pages/Actions、Cloudflare Workers/D1のFreeプランで使う構成です。クレジットカードの登録、有料プラン、独自ドメイン、Apple Developerの加入は不要です。** 無料枠・提供条件の将来の変更や配信遅延まで保証するものではありません。有料への自動切り替えは行いません。

## 現在の状態と制限

- 初期登録：NHK「弾丸!空港トンボがえりツアー」「地球ドラマチック」「世界ふれあい街歩き」「鉄オタ選手権」、TBS「世界遺産」、日本テレビ「アナザースカイ」。
- NHKは横浜の地域コード `140`、地上波・BS・BSプレミアム4K。BS8Kは除外。
- NHKの番組名は全角/半角・空白を正規化した部分一致。NHK番組は画面から追加できます。その他の民放番組は専用の取得処理を追加する必要があります。
- 毎時17分にチェックを予約。GitHub Actionsの混雑等で遅延・スキップする場合があります。即時性を保証しません。
- NHKはAPI v3の `service=tv` を8日分取得し、7サービスだけ抽出します。8K情報が取得レスポンスに含まれても、保存・表示・通知しません。
- 1時間に1回だけ取得するD1のロックで、NHK APIを**最大192回/日**に抑えます。300回/日の上限まで余裕がありますが、**同じAPIキーを別アプリでも使う場合は合計に注意**してください。失敗した実行もその時間帯は再取得しません。
- **NHKは実APIキー未提供のため、実接続とv3の全フィールドは未検証です。** `publication/name/startDate/identifierまたはid/url` の想定形式をテストしています。実際の形式が異なる場合は取得状態にエラーを表示し、`worker/src/sources.ts` の調整が必要です。
- **TBSと日テレの公開ページ/JSONには接続・抽出確認を行えますが、継続的な自動取得の明示的な許諾は未確認です。初期状態では無効です。** 各局の現行の利用条件を確認し、必要なら許可を得てから有効にしてください。robots.txtの許可だけを利用許可とは扱いません。サイト変更で取得できなくなる場合があります。
- 民放2番組は確認できる放送日のみを表示し、通常の放送時刻を推測で補いません。時刻は公式サイトをご確認ください。
- 再放送の除外はタイトル中の「再放送」「[再]」「［再］」「【再】」等に基づきます。表記のない再放送を完全に判定できません。
- 初回登録時は、掲載済みの今後の放送も通知します。同一の放送IDで日時・見出し・チャンネル等が変われば更新通知します。API側でIDが変わる場合は新規放送扱いです。
- 配信済みリビジョンで通常の重複を防止します。ただし、Push受理直後に記録保存が失敗した場合等の厳密な一度限りの配信は保証できません。Pushサービス受理とiPhoneでの表示は別です。
- 最大20番組・5端末。個人/家庭内で共有する構成で、マルチユーザーの会員サービスではありません。
- 型チェック・lint・17件の単体テスト・Workerのdry-runビルド・ローカルWorker/D1の結合テストを確認しています。外部APIとPushサービスは結合テストでは模擬します。公開環境とiPhone実機での通知受信は別途確認が必要です。

## 構成

```text
iPhone PWA（GitHub Pages）
   │ ADMIN_TOKENで設定・お気に入り・Push通知先を登録
   ▼
Cloudflare Workers API ── Cloudflare D1（短期キャッシュ・設定・通知記録）
   ▲
   │ JOB_TOKEN（端末に渡さない専用キー）
GitHub Actions（毎時・手動実行）
   ├─ NHK公式番組表API / TBS次回予告 / 日テレ公式JSON
   └─ VAPID + aes128gcmで暗号化 → Pushサービス → iPhone
```

データ解析と暗号化はActionsのNode.jsで行い、Workers Freeの短いCPU時間上限に大きな解析処理を載せません。WorkerはD1の小さなAPI操作だけを行います。D1への一括書き込みは20件ずつに分割します。

## 事前に用意するもの

1. 無料のGitHubアカウントと、この**公開**リポジトリ [`aiharayoshinobu-svg/tv-notifier`](https://github.com/aiharayoshinobu-svg/tv-notifier)。非公開リポジトリはPages/Actionsの無料条件が異なるので、この手順では使いません。
2. Cloudflareアカウント。Workers/D1を**Freeのまま**使います。決済情報を登録しません。
3. [NHK番組表API](https://api-portal.nhk.or.jp/accounts/create)の無料利用登録とAPIキー。[利用規約](https://api-portal.nhk.or.jp/terms)・[サービス案内](https://api-portal.nhk.or.jp/service-guide)に同意してください。
4. パソコンのNode.js **22.13以降（22系の最新推奨）**とGit。コマンドは展開したフォルダー内で実行します。
5. iOS 16.4以降のiPhone。

## 1. ソースと鍵を用意する

```sh
npm ci
npm run check
npm run keys
```

`keys.local.json` ができます。既存ファイルがある場合は上書きしません。このファイルは**公開・GitHubアップロード・他人との共有をしないでください**。Gitの除外設定には入っています。値は画面から設定する際に手元で確認してください。鍵生成スクリプトは値をログに出しません。

| 値 | 設定先 |
|---|---|
| `ADMIN_TOKEN` | WorkerのSecret、iPhoneの接続設定だけ |
| `JOB_TOKEN` | WorkerのSecretとGitHub Actions Secretの両方（同じ値） |
| `VAPID_PUBLIC_KEY` | Worker設定とGitHub Actions Secret（同じ値・公開してもよい鍵） |
| `VAPID_PRIVATE_KEY` | GitHub Actions Secretだけ |
| `NHK_API_KEY` | GitHub Actions Secretだけ |
| `VAPID_SUBJECT` | GitHub Actions Secretに `mailto:あなたのメールアドレス` |

**秘密鍵・ADMIN_TOKEN・JOB_TOKEN・NHK APIキーを、HTMLや公開設定ファイルへ書かないでください。**

## 2. Cloudflare D1とWorkerを設定する

```sh
npx wrangler login
npx wrangler d1 create tv-next
```

作成結果の `database_id` を `worker/wrangler.toml` へ記入します。同時に以下も設定します。

```toml
[vars]
FRONTEND_URL = "https://aiharayoshinobu-svg.github.io/tv-notifier/"
VAPID_PUBLIC_KEY = "keys.local.jsonのVAPID_PUBLIC_KEYの値"
```

`FRONTEND_URL` は**実際のGitHub Pages URLを末尾の `/` まで**記入してください。WorkerのCORS制限と通知の戻り先に使います。リポジトリ名が異なる場合は変更します。秘密情報はこのファイルに書きません。

```sh
npm run db:remote
npx wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml
npx wrangler secret put JOB_TOKEN --config worker/wrangler.toml
npm run deploy:worker
```

`secret put` の入力プロンプトに、それぞれ生成した値を貼り付けます。コマンド引数やシェル履歴に直接書かないでください。初回にWorker作成を確認された場合は、この個人用Workerの作成を承認します。

デプロイ結果の `https://...workers.dev` を控えます。独自ドメインは不要です。

## 3. GitHub Pagesを公開する

この実装のPRを確認して `main` にマージした後、Pagesを設定します。`.github/workflows` も必要です。`node_modules`、`.wrangler`、`keys.local.json`、`.dev.vars`、`.env` は置かないでください。コミット前に `git status` で鍵ファイルが含まれていないことを確認してください。

リポジトリの **Settings → Pages → Build and deployment** で：

- Source：**Deploy from a branch**
- Branch：**main**
- Folder：**/docs**

このリポジトリの公開予定URLは `https://aiharayoshinobu-svg.github.io/tv-notifier/` です。公開されたURLがWorkerの `FRONTEND_URL` と合っていることを確認してください。

## 4. GitHub Actionsの接続設定

リポジトリの **Settings → Secrets and variables → Actions** へ設定します。

### Repository secrets

- `JOB_TOKEN`（WorkerのSecretと同じ）
- `NHK_API_KEY`
- `VAPID_PUBLIC_KEY`（Workerの設定と同じ）
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`（例：`mailto:your-address@example.com`）

### Repository variables

- `WORKER_URL`：デプロイした `https://...workers.dev`
- `ENABLE_TBS`：利用条件確認後のみ `true`。未設定または `false` なら無効。
- `ENABLE_NTV`：利用条件確認後のみ `true`。未設定または `false` なら無効。

Actionsタブで **Check TV programs → Run workflow** を押します。初回にActionsを有効化する表示があれば有効化してください。スケジュールはデフォルトブランチのワークフローに対して動きます。

TBS/日テレの無効状態は画面に表示しますが、無効だけを理由にActionsを失敗させません。NHK取得失敗やPush送信失敗は失敗として表示します。ログにAPIキーやPush通知先は出しません。

## 5. iPhoneに追加して通知を受け取る

1. SafariでGitHub Pagesの公開URLを開きます。
2. 共有 → **ホーム画面に追加**。
3. **追加されたアイコンから**アプリを開きます。
4. 「設定」でWorker URLと `ADMIN_TOKEN` を入力し、「接続する」。
5. 「この端末で通知を受け取る」を押して通知を許可します。
6. 「テスト通知を予約」を押します。
7. 次の定期実行を待つか、GitHub Actionsを手動実行します。

**同じ時間帯ですでに取得が実行されていると、手動実行も省略されます。次の時刻（UTCで時間が切り替わった後、日本も毎時00分）に試してください。** GitHubの混雑による遅延もあります。テストの予約は24時間で失効します。

通知許可は必ずボタンの操作直後に要求します。アプリを閉じていてもPushは届きますが、集中モード・通知設定・ネットワークによって表示が遅れる／出ない場合があります。[Apple公式の条件](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## 使い方

- 「登録番組」：通知対象・再放送表記の扱いを切り替え、NHK番組を追加・削除できます。
- 「次回の放送」：登録番組の今後の予定を表示します。**一覧を更新**は保存済み情報の再表示で、外部サイト取得を起動しません。
- 「設定」：各取得元の最終成功・エラー、登録端末を確認します。他の端末を登録解除できます。
- 通知の停止：**この端末の通知を停止**。接続設定の解除だけではPush登録を消しません。
- オフラインではアプリの画面だけを利用できます。個人の番組情報やAPI応答はService Workerでキャッシュしません。

## 開発・検証

```sh
npm run check
npm run build:worker
npm run test:integration
npm run dev
```

`test:integration` は専用のテスト用Worker設定・D1をローカルで起動し、認証・CORS・設定保存・通知先登録・更新通知の記録・削除を検証します。テスト設定のキーは架空のテスト用で、本番では絶対に使いません。

通常のWorkerをローカル起動する場合は `worker/.dev.vars` に `ADMIN_TOKEN` と `JOB_TOKEN` を設定し、`FRONTEND_URL` を開発URLに設定します。`npm run db:local` → `npm run dev:worker`。秘密情報入りの開発ファイルは公開しません。

## 無料運用の注意

- Workers/D1はFreeプランのまま。有料プランへ切り替えない限り、無料枠を超えた処理は制限・停止される運用です。購入画面・カード入力が求められたら契約せず、Free設定を確認してください。
- 公開リポジトリの標準GitHub-hostedランナーを使います。有料のlarger runnersは使いません。
- GitHubでは**公開リポジトリで60日活動がないとスケジュールが自動停止**します。Actions画面で再有効化する等の保守が必要です。24時間365日の永久放置を保証しません。
- Actionsが止まると通知も止まります。取得状態の最終成功日時とActionsの結果を時々確認してください。
- NHK情報は放送日までの短期キャッシュです。期限切れは非表示にし、定期処理で削除します。アーカイブ・エクスポートは行いません。NHKクレジットを画面とNHK通知に表示し、NHKロゴは使いません。
- Push通知先はD1へ保存します。フロント側APIは他端末のendpoint/鍵を返しません。専用 `JOB_TOKEN` のみが通知用情報を読めます。
- `ADMIN_TOKEN` は接続端末のlocalStorageに保存します。家庭の個人端末で使ってください。このキーを知る人は番組設定・端末登録を操作できます。多人数公開サービスにしないでください。
- GitHub Pagesは同じGitHubユーザーの他のリポジトリとOriginを共有します。同じアカウント配下に信頼できないJavaScriptを公開しないでください。
- VAPID鍵を変更した場合は、各端末の旧Push登録を停止して再登録してください。
- サイト構造変更・利用条件変更は取得元ごとに無効化できます。元サイトの長文・画像を転載せず、最小限の見出し・日付・公式リンクを扱います。

## 参考資料

- [NHK API v3](https://api-portal.nhk.or.jp/pg-date-tv-v3) / [利用規約](https://api-portal.nhk.or.jp/terms) / [サービス案内・クレジット](https://api-portal.nhk.or.jp/service-guide)
- [TBS 世界遺産・次回予告](https://www.tbs.co.jp/heritage/next/)
- [日本テレビ アナザースカイ](https://www.ntv.co.jp/anothersky/)
- [GitHub Pagesの作成](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [GitHub Actionsスケジュールの制限](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/) / [D1料金](https://developers.cloudflare.com/d1/platform/pricing/)
- [Apple Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

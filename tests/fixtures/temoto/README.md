# temoto

temotoは、[Instapaper](https://www.instapaper.com/)に保存した記事を手元のマシンに同期し、
オフラインで全文検索するためのツールです。記事の本文と画像をSQLiteに保存し、
ブラウザで開く読書画面から日本語と英語の全文検索ができます。

read-laterサービスに記事を溜めていくと、過去に保存した記事ほど探しにくくなります。
temotoは記事の本文を手元に複製するので、元記事のリンクが切れても、
サービスが終了しても、保存した記事を検索できます。

## 特徴

- 記事のテキストと画像をローカルに保存する（元記事が消えても残る）
- SQLite FTS5（trigramトークナイザー）で日本語と英語を全文検索する
- タグ・フォルダ・日付で絞り込める。検索条件はスマートリストとして保存できる
- 画像内の文字もOCRで検索対象にできる（任意）
- htmxで作ったシンプルなWeb UI。スマートフォンからも読める
- CGOが不要（`modernc.org/sqlite`）で、`go build`だけでビルドできる

## 動作環境

- Go 1.23以上（ビルド時）
- InstapaperのアカウントとAPIキー（必須）

開発と日常の利用はWindows 11で行っています。同期・取得・検索・Web UIの各機能は
OSに依存する処理を含まないのでmacOSとLinuxでも動くはずですが、継続的な動作確認は
していません。次の2つはWindows専用です。

- システムトレイ常駐（`cmd/temoto-tray`）とログイン時の自動起動（`scripts/*.ps1`）
- リポジトリ内の補助スクリプト（PowerShellで書いている）

次の機能は任意です。必要なものが無くても本体は動きます。

| 機能 | 必要なもの |
| --- | --- |
| 画像内テキストのOCR検索 | Tesseract、またはPythonとPaddleOCR |
| PDF記事の取り込み | PythonとPyMuPDF |
| JavaScriptが必要なページの取得 | ChromeまたはChromium |
| 本文抽出のフォールバック | InstaparserのAPIキー |

## セットアップ

### 設定ファイルを作成する

```sh
cp .env.example .env
```

`.env`を編集してAPIキーを入力します。

```
# 常に必要
INSTAPAPER_CONSUMER_KEY=your_key
INSTAPAPER_CONSUMER_SECRET=your_secret

# 初回同期時のみ必要（認証が済んだら削除してよい）
INSTAPAPER_USERNAME=your@email
INSTAPAPER_PASSWORD=your_password

# 省略可: Instaparser 経由の再取得を有効にする（https://www.instaparser.com/）
# INSTAPARSER_API_KEY=your_instaparser_key
```

### OCRをセットアップする（省略可）

画像内のテキストを検索するにはOCRエンジンが必要です。OCRエンジンを
インストールしなくても、記事本文の検索は使えます。

OCRエンジンは次の2つから選べます。

| エンジン | 日本語の精度 | 速度 | 備考 |
| --- | --- | --- | --- |
| PaddleOCR（推奨） | 高い | 遅め | PythonとGPUまたはCPU |
| Tesseract | 普通 | 速い | 単体のバイナリ |

使うエンジンは環境変数`TEMOTO_OCR_ENGINE`で選びます。既定値は`auto`で、
PaddleOCRがあればPaddleOCRを、無ければTesseractを使います。

#### PaddleOCRをインストールする（推奨）

Python 3.9以上が必要です。

```powershell
# PaddlePaddle（CPU 版）
pip install paddlepaddle==3.0.0

# PaddleOCR
pip install paddleocr
```

初めてOCRを実行したときに、日本語モデル（約200 MB）が自動でダウンロードされます。

#### Tesseractをインストールする（代替）

[UB-Mannheimのインストーラー](https://github.com/UB-Mannheim/tesseract/wiki)を
ダウンロードして実行するか、wingetでインストールします。

```powershell
winget install UB-Mannheim.TesseractOCR
```

インストール後、`C:\Program Files\Tesseract-OCR`をPATHに追加してください。

既定の学習データを、より精度の高い`tessdata_best`に差し替えることを推奨します。
管理者として実行したPowerShellで次を実行してください。

```powershell
# 既存ファイルのバックアップ
$dest = "C:\Program Files\Tesseract-OCR\tessdata"
Copy-Item "$dest\jpn.traineddata"      "$dest\jpn.traineddata.bak"
Copy-Item "$dest\jpn_vert.traineddata" "$dest\jpn_vert.traineddata.bak"

# tessdata_best を GitHub から取得する
$base = "https://github.com/tesseract-ocr/tessdata_best/raw/main"
Invoke-WebRequest "$base/jpn.traineddata"      -OutFile "$dest\jpn.traineddata"
Invoke-WebRequest "$base/jpn_vert.traineddata" -OutFile "$dest\jpn_vert.traineddata"
Invoke-WebRequest "$base/eng.traineddata"      -OutFile "$dest\eng.traineddata"
```

#### OCRを実行する

OCRは`sync`の実行時に自動で行われます。OCRだけを実行することもできます。

```powershell
# 全画像を OCR する（初回は時間がかかる）
./temoto sync --only-ocr

# 件数を絞って動作を確認する
./temoto sync --only-ocr --ocr-limit 50
```

### PDFのフォールバック取得を準備する（省略可）

論文や文書形式のPDFは、`INSTAPARSER_API_KEY`を設定していればInstaparser経由で
本文を取得します。スライドをPDFにしたものなど、Instaparserで解析できないPDFは、
Web UIで「再取得」したときに各ページを画像にしてOCRします。このフォールバックには
PythonとPyMuPDFが必要です。

```powershell
pip install pymupdf
```

ページの画像は通常の画像と同じくOCRされ、スライド内のテキストも検索対象になります。
解像度とページ数の上限は`TEMOTO_PDF_DPI`と`TEMOTO_PDF_MAX_PAGES`で調整できます。

### JavaScriptのレンダリングを準備する（省略可）

x.comのユーザープロフィールページなど、JavaScriptが必要なページを再取得するときに
Chromeを使います。

設定は不要です。初めて使うときにChromium（約150 MB）が自動でダウンロードされ、
次の場所にキャッシュされます。

```
%APPDATA%\rod\browser\chromium-{version}\
```

インストール済みのChromeを使う場合は、`TEMOTO_CHROME_PATH`にChromeまたは
Chromiumの実行ファイルのパスを指定します。

```
# .env
TEMOTO_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### ビルドする

```sh
go build -o temoto ./cmd/temoto
```

Windowsでは`-o temoto.exe`としてください。

## 使い方

### 同期

```sh
# 全件を同期する（2 回目以降は差分だけを処理する）
./temoto sync

# テキストと画像の取得を 100 件で打ち切る
./temoto sync --limit 100
```

記事の取得は1秒に1件のペースで進みます。保存した記事が多い場合、初回は
`--limit`を付けて1日100件ずつのように少しずつ取得しても構いません。
`--limit`を付けずに実行し、途中でCtrl-Cで中断した場合も、次回の実行で続きから再開します。

#### 画像の取得と再試行

テキストを取得するとき、記事内の画像も一緒にダウンロードします。ネットワークエラーなどで
取得できなかった画像は、次回の`sync`で自動的に再試行します。3回失敗した画像は
それ以降スキップします。

#### 差分同期

2回目以降の`sync`は、追加・変更・削除された記事だけを処理します。テキストと画像を
取得済みの記事ではAPIを呼び出さないので、定期的に実行しても短時間で終わります。

#### 500件を超えるフォルダ

Instapaper APIは、フォルダごとに最新の500件までしか返しません（ページングもできません）。
差分同期でInstapaper側と照合できるのはこの範囲に限られるので、temotoは照合の対象を、
保存日時の新しい順に450件（500件から余裕分の50件を引いた数）までにしています。

- 451件目以降の記事はtemotoに残り続けますが、Instapaper側でのタイトル変更や
  削除は反映されません。
- Instapaper上で削除した記事が451件目以降にある場合、temotoには残ります。
  不要なら記事一覧から個別に削除してください。
- 501件目以降の記事に付けたハイライト（メモ）は取得できません。取得済みのハイライトは
  消えません。

この制約は、取得できない記事を「削除された」と誤って判定しないためのものです。
余裕分を設けているのは、Instapaper側の並び順と保存日時の順が完全には一致しないためです。

### 検索画面の起動

```sh
./temoto server
```

ブラウザで<http://localhost:8366>を開きます。

既定ではlocalhostでだけ待ち受けるので、同じPCからしかアクセスできません。

```sh
# 起動と同時にブラウザを開く
./temoto server --open

# ポートを変える
./temoto server --addr localhost:9000 --open

# LAN 上の他の端末からもアクセスできるようにする（全インターフェースで待ち受ける）
./temoto server --addr 0.0.0.0:8366 --allow-remote-access
```

temotoには認証機能がありません。そのため、ループバック以外のアドレスを`--addr`に
指定したときは、`--allow-remote-access`も付けないと起動を中断します。詳しくは
「[セキュリティと利用上の前提](#セキュリティと利用上の前提)」を参照してください。
他の端末から使う場合は、LANに公開するよりも次のTailscale Serveを使うほうが安全です。

#### 自分の別の端末から使う（Tailscale Serve）

スマートフォンや別のPCから使う場合は、Tailscale Serveで自分のtailnetの中だけに
公開します。Serveで公開したサーバーには、Tailscaleで認証された自分の端末からしか
到達できず、通信はHTTPSになります。

1. このPCと、アクセスに使う各端末に[Tailscale](https://tailscale.com/)をインストールし、
   同じアカウントでログインします（同じtailnetに参加させます）。
2. Tailscaleの管理コンソールでMagicDNSとHTTPS証明書を有効にします。
   どちらも`tailscale serve`でHTTPSを使うために必要で、個人プランでも使えます。
3. temotoを`./temoto server`で起動します。待ち受けアドレスは既定のlocalhostのままで構いません。
4. tailnetに公開します。

   ```sh
   tailscale serve --bg 8366
   ```

   `https://<マシン名>.<tailnet 名>.ts.net/`へのアクセスが`127.0.0.1:8366`に転送されます。
5. 自分の端末のブラウザで、上記のHTTPSのURLを開きます。
6. 公開の状態は次のコマンドで確認・解除できます。

   ```sh
   tailscale serve status        # 現在の公開設定を確認する
   tailscale serve --bg 8366 off # 公開を解除する
   ```

`tailscale funnel`は使わないでください。funnelはサーバーをインターネット全体に公開するので、
認証の無いtemotoでは、誰でも読書リストを閲覧・削除できる状態になります。

#### サーバーと同期を同時に動かす

`--sync`を付けると、サーバーの起動時に`sync`をバックグラウンドで1回実行します。
`--sync-interval`を付けると、指定した間隔で`sync`を繰り返します。

```sh
# 起動時に sync を 1 回だけ実行する
./temoto server --open --sync

# 起動時と、その後 30 分ごとに sync を実行する
./temoto server --open --sync-interval 30m
```

`temoto sync`と`temoto server`を別々のターミナルで同時に実行しても問題ありません。
SQLiteのWALモードを有効にしているので、サーバーの読み取りと`sync`の書き込みは
互いを待たせません。

### Windowsのシステムトレイに常駐させる

`temoto-tray.exe`は、temotoをシステムトレイに常駐させるGUIアプリです。
サーバー（`temoto.exe`）を子プロセスとして起動・監視し、`temoto.exe server --sync-interval 30m`
（起動時と30分ごとに同期）を動かし続けます。

#### ビルド

```sh
# CLI 本体（コンソールアプリ）
go build -o temoto.exe ./cmd/temoto

# トレイ常駐アプリ（コンソール窓を出さない GUI サブシステム）
go build -ldflags "-H windowsgui" -o temoto-tray.exe ./cmd/temoto-tray
```

`temoto-tray.exe`は、自身と同じフォルダにある`temoto.exe`を起動します。両方を、
`.env`と`data/`があるフォルダに置いてください。

#### トレイメニュー

トレイアイコンをダブルクリックするとブラウザが開きます。右クリックすると次のメニューが出ます。

- ブラウザで開く：`http://localhost:8366`を既定のブラウザで開く
- 起動・停止・再起動：サーバーを制御する（サーバーの状態に応じて選べる項目が変わる）
- ログを開く：サーバーの出力ログ`data/temoto.log`を開く
- 終了：サーバーを停止し、トレイ常駐を終える

#### ログイン時に自動で起動する

スタートアップフォルダにショートカットを作ります。管理者権限は不要です。

```sh
# 登録する
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1

# 解除する
powershell -ExecutionPolicy Bypass -File scripts\uninstall-startup.ps1
```

#### アイコンを作り直す（任意）

[assets/icon.svg](assets/icon.svg)を変更したときは、Goで書いたツール`tools/genicon`で
`.ico`を作り直し、exeに埋め込む`.syso`も作り直します。外部ツールは要りません。
アイコンは次の2種類です。

- 通常のアイコン（`icon.ico`）：`temoto.exe`のexeアイコンと、トレイの通知領域に出るアイコンに使う。
- 「tray」の文字入りアイコン（`icon-tray.ico`）：`temoto-tray.exe`のexeアイコンにだけ使う。
  右下に「tray」の文字を重ね、CLI版と見分けられるようにしている。文字は`-label`オプションで描く。

```sh
# SVG からマルチサイズの ICO を作る（通常版と tray 版）
cd tools/genicon
go run . ../../assets/icon.svg ../../assets/icon.ico
go run . -label tray ../../assets/icon.svg ../../assets/icon-tray.ico
cd ../..

# トレイの通知領域に埋め込むアイコンには通常版を使う
copy assets\icon.ico cmd\temoto-tray\icon.ico

# exe のアイコンリソース（.syso）。tray の exe だけ文字入りを使う
go install github.com/akavel/rsrc@latest
rsrc -ico assets\icon-tray.ico -o cmd\temoto-tray\rsrc_windows.syso
rsrc -ico assets\icon.ico      -o cmd\temoto\rsrc_windows.syso
```

Web UIとPWAに使うPNGは、余白の無い[assets/icon-pwa.svg](assets/icon-pwa.svg)から
同じツールで作ります。出力先の拡張子を`.png`にすると、`-size`で指定した大きさのPNGが1枚できます。

```sh
cd tools/genicon
go run . -size 180 ../../assets/icon-pwa.svg ../../internal/web/static/apple-touch-icon.png
go run . -size 192 ../../assets/icon-pwa.svg ../../internal/web/static/icon-192.png
go run . -size 512 ../../assets/icon-pwa.svg ../../internal/web/static/icon-512.png
cd ../..

copy assets\icon.svg internal\web\static\icon.svg
```

### タグ

Instapaperのタグを取り込み、temoto上で付け外しできます。

- 取得：同期のときに各記事のタグを取り込み、左サイドバーのTAGSに一覧を出します。
  タグをクリックすると`tag:NAME`で絞り込めます。`tag:NAME`は検索欄とスマートリストでも使えます。
- 付与：記事を開いて`t`キーを押すか、`+ タグ`ボタンでタグを付けます。
  付けたタグは`bookmarks/add` APIでInstapaperにも反映されます。
- 削除：temoto上でタグを外せますが、外したことはInstapaperには反映されません。
  Instapaper APIにタグを削除する手段が無いためです。Instapaper側にはタグが残るので、
  `sync --full`を実行するとタグが復活します。
- 既存の記事のタグ：通常の同期は差分だけを取得するので、既存の記事のタグは、
  その記事に変更があるまで取り込まれません。すべての記事のタグをまとめて取り込むには、
  次を実行します。

```powershell
./temoto sync --full
```

### 検索構文

#### キーワード検索

スペースで区切った語は、すべてを含む記事を探します（AND検索）。

```
golang http server
```

語句をそのまま探すには、クォートで囲みます。

```
"go routines"
```

#### 絞り込みの演算子

| 演算子 | 例 | 説明 |
| --- | --- | --- |
| `folder:` | `folder:starred` | フォルダで絞り込む（`unread`・`starred`・`archive`・`memo`、または独自のフォルダ名。`memo`はメモ付きの記事に絞る） |
| `filetype:` | `filetype:pdf` | URLの拡張子で絞り込む |
| `site:` | `site:github.com` | ドメインで絞り込む（サブドメインを含む） |
| `url:` | `url:github.com/*/issues/*` | URLをワイルドカードで絞り込む |
| `-url:` | `-url:*/status/*` | ワイルドカードに一致するURLを除外する |
| `date:` | `date:2026-08-09` | 保存日で絞り込む（指定した粒度の期間全体） |
| `after:` | `after:2026-08-01` | その日以降に保存した記事（その日を含む） |
| `before:` | `before:2026-08-09` | その日より前に保存した記事（その日を含まない） |

演算子とキーワードは組み合わせられます。

```
docker site:github.com filetype:md
```

#### `url:`のワイルドカード

`*`は任意の文字列に一致します。大文字と小文字は区別しません。

```
url:x.com/*               x.com のすべての URL
url:x.com/*/status/*      x.com のポストの URL だけ
url:*.pdf                 PDF の URL
```

#### 除外の演算子`-url:`

`-url:`は、一致するURLを結果から除きます。複数指定すると、どれにも一致しないURLだけが残ります。

```
-url:*/status/*                   /status/ を含む URL を除外する
site:x.com -url:*/status/*        x.com のうち /status/ を含まない URL（プロフィールページなど）
url:x.com/* -url:*/status/*       同上（url: と -url: の組み合わせ）
```

#### 日付での絞り込み

日付で絞り込む対象は、記事をInstapaperに保存した日時です。記事の公開日ではありません。

日付は次の形で書きます。区切りには`-`と`/`のどちらを使っても構いません。

```
2026            年（その年全体）
2026-08         年-月（その月全体）
2026-08-09      年-月-日（その日全体）
today           今日
yesterday       昨日
7d / 2w / 3m / 1y   7 日前・2 週間前・3 か月前・1 年前から今日まで
```

`date:`は、指定した粒度の期間をそのまま対象にします。`after:`はその期間の開始以降、
`before:`はその期間の開始より前を表します。Google検索と同じく、`before:`に指定した日は
含みません。

```
date:2026-08              2026 年 8 月に保存した記事
date:today                今日保存した記事
date:7d                   直近 7 日間に保存した記事
after:2026-08-01          8 月 1 日以降（8 月 1 日を含む）
before:2026-08-09         8 月 9 日より前（8 月 9 日を含まない）
after:2026-08-01 before:2026-09-01   8 月中（両方を指定すると両方の条件を満たす記事）
```

`date:`では`..`で範囲を書けます。範囲の右端に書いた日・月・年は範囲に含まれます。

```
date:2026-08-01..2026-08-09   8 月 1 日から 8 月 9 日まで（両端を含む）
date:2026-08..                8 月 1 日以降（after:2026-08 と同じ）
date:..2026-08-09             8 月 9 日まで（8 月 9 日を含む）
```

日付の指定は、キーワードや他の演算子と組み合わせられます。`7d`のような相対的な指定を
スマートリストに保存すると、表示するたびに期間を計算し直すので、
「直近1週間の未読」のようなリストを作れます。

```
docker after:7d
folder:unread date:7d
```

### 設定ファイルのパスを指定する

```sh
./temoto --config /path/to/my.env sync
```

## 環境変数

設定は、設定ファイルの代わりに環境変数でも指定できます。同じ項目を両方に書いた場合は、
環境変数が優先されます。

| 変数名 | 既定値 | 説明 |
| --- | --- | --- |
| `INSTAPAPER_CONSUMER_KEY` | （必須） | Consumer Key |
| `INSTAPAPER_CONSUMER_SECRET` | （必須） | Consumer Secret |
| `INSTAPAPER_USERNAME` | — | ユーザー名（初回の同期だけで使う） |
| `INSTAPAPER_PASSWORD` | — | パスワード（初回の同期だけで使う） |
| `TEMOTO_FETCH_INTERVAL` | `1s` | テキストを取得するときの記事間の待ち時間（例：`2s`、`500ms`） |
| `TEMOTO_RATELIMIT_WAIT` | `60s` | レート制限（`error_code` 1040）を受けたときの待ち時間（例：`2m`） |
| `TEMOTO_CONSECUTIVE_FAIL_WAIT` | `2h` | 3記事続けて取得に失敗したときに同期を止める時間（`0`で止めない） |
| `TEMOTO_THREAD_DEPTH` | `10` | x.comの記事を取得するときに遡るスレッドの深さ（`0`で遡らない） |
| `TEMOTO_OCR_ENGINE` | `auto` | 使うOCRエンジン。`auto`（PaddleOCRを優先）、`paddle`、`tesseract`のどれか |
| `TEMOTO_PDF_DPI` | `200` | PDFのページを画像にするときの解像度（DPI） |
| `TEMOTO_PDF_MAX_PAGES` | `0` | PDFを画像にする最大ページ数（`0`で無制限） |
| `TEMOTO_CHROME_PATH` | — | JavaScriptのレンダリングに使うChromeまたはChromiumの実行ファイルのパス（省略すると自動で探すか、ダウンロードする） |
| `INSTAPARSER_API_KEY` | — | [Instaparser](https://www.instaparser.com/)のAPIキー（省略可。設定すると、再取得のときにInstaparser経由のフォールバックを使う） |
| `TEMOTO_FX_API_BASE` | `https://api.fxtwitter.com` | x.comの取得に使うFxEmbed APIのベースURL。セルフホストしたインスタンスを指定できる（[docs/fxtwitter-selfhost.md](docs/fxtwitter-selfhost.md)） |
| `TEMOTO_LOCAL_FETCH_ALLOWLIST` | — | SSRFガードの例外。カンマ区切りで指定した`IP:ポート`に限り、内部ネットワークからの取得を許す（[後述](#temoto_local_fetch_allowlist)） |

初回の同期でアクセストークンを取得し、`data/articles.db`に保存します。それ以降は、
ユーザー名とパスワードが無くても同期できます。

### レート制限

Instapaper APIのレート制限の上限値は公開されていません。temotoは`error_code: 1040`を
受け取ると、`TEMOTO_RATELIMIT_WAIT`の時間だけ待ってから同じ記事を再試行します。
3回再試行しても制限が解けない場合は、その記事を飛ばし、次回の`sync`で再試行します。

取得が頻繁に失敗する場合は、`.env`に`TEMOTO_FETCH_INTERVAL=3s`のように書いて、
取得の間隔を広げてください。

x.comの記事は、Instapaperの`get_text`ではなくFxEmbed（fxtwitter）経由で取得するので、
Instapaperとは別の制限を受けます。temotoは、同期・Web UIの再取得ボタン・`refetch`
サブコマンドのどの経路でも、x.comの記事1件ごとに1秒の間隔を空けます。スレッドの親を
遡る記事では1件の取得でAPIを複数回呼びますが、間隔は記事1件分として数えます。

## データ

| パス | 内容 |
| --- | --- |
| `data/articles.db` | SQLiteのデータベース（記事と検索インデックス） |
| `data/images/` | ダウンロードした画像 |

### バックアップ

`scripts\backup-db.ps1`は、DBと画像を外部のストレージに複製します。保存先には既定値が無く、
必ず指定する必要があります。既定値があると、意図しない場所へ書き込むおそれがあるためです。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -Destination E:\backup\temoto

# 環境変数に設定しておくと -Destination を省略できる
setx TEMOTO_BACKUP_DEST E:\backup\temoto
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
```

保存先には、外付けドライブやNASなど、`data\`とは別の物理媒体を指定してください。
`data\`と同じドライブでは、ドライブが故障したときにバックアップも失われます。

| オプション | 内容 |
| --- | --- |
| `-Destination <path>` | 保存先（省略すると環境変数`TEMOTO_BACKUP_DEST`を使う。どちらも無ければエラー） |
| `-SkipImages` | DBだけを複製する（数秒で終わる） |
| `-List` | 保存済みのバックアップを一覧表示する |
| `-MirrorDelete` | 元の場所で削除された画像を保存先からも消す（既定では残す） |

DBは`db\articles_YYYYMMDD.db`という名前で日付ごとに残します。DBの複製にはSQLiteの
`VACUUM INTO`を使うので、temotoを止めずに実行できます（ファイルを単純にコピーすると、
WALに書きかけの状態を複製してしまうおそれがあります）。複製したあと
`PRAGMA integrity_check`で検証し、問題があればエラーで停止します。

画像は`images\`に、日付で分けない1つのミラーとして同期します。temotoは画像を
追加するだけで削除しないので、このミラーには過去のすべての画像が残ります。
そのため、どの日付のDBに戻しても、そのDBが参照する画像はミラーの中にあります。
2回目以降は差分だけをコピーするので、短時間で終わります。

復元の手順は、実行のたびに保存先の`RESTORE.md`に書き出されます。DBを戻すときは、
既存の`articles.db-wal`と`articles.db-shm`を必ず削除してください。残っていると、
古いスナップショットに新しいWALが適用され、内容が食い違います。

### 誤って削除扱いになった記事の復旧

以前のtemotoには、500件の上限を超えてInstapaper APIから返らなくなった記事を、
Instapaper側で削除されたものと誤って判定する不具合がありました。誤判定された記事は、
DB上で削除済みの印が付くだけで、本文・画像・タグは残っています。
`cmd/restore-deleted`は、この印を外して記事を一覧に戻すツールです。
現在のtemotoは照合の対象を450件までに絞っているので（「[500件を超えるフォルダ](#500件を超えるフォルダ)」）、
この誤判定は起きません。

```sh
go run ./cmd/restore-deleted            # 変更せずに対象を表示する（既定）
go run ./cmd/restore-deleted --apply    # 実際に復旧する
```

`--apply`は、temotoが動いている間は実行を拒否します。同期が同時に走ると復旧の結果が変わるためです。

### x.comの本文の一括再取得

x.comのページはJavaScriptとログインを必要とするので、Instapaperの`get_text`では
本文を正しく取得できません。temotoにはFxEmbed（fxtwitter）経由で取得するx.com専用の
フェッチャーがありますが、古いtemotoで同期した記事には、`get_text`で取得した不完全な本文が
残っています。`cmd/xcom-refetch`は、そうした記事を専用のフェッチャーで取得し直すツールです。
どの記事を取得し直すかは、DBに保存されている本文の中身から判定します。

```sh
go run ./cmd/xcom-refetch                       # 変更せずに、分類ごとの件数と所要時間の見積もりを表示する
go run ./cmd/xcom-refetch --sample G            # 指定した分類に入っている記事を数件表示する
go run ./cmd/xcom-refetch --limit 100 --apply   # まず 100 件だけ取得し直す
go run ./cmd/xcom-refetch --apply               # すべて取得し直す（既定では 1 件あたり 3 秒）
```

取得に失敗した記事は、既存のデータをそのまま残します（削除済みのポストは二度と取得できないため）。
上書きする記事も、元のHTMLを`data/xcom-refetch-backup-*.jsonl`に保存してから書き換えます。
実行のたびにDBの中身から対象を判定するので、途中で中断しても、再実行すれば残りから続きます。

実行する前に、`scripts\backup-db.ps1`でDBをバックアップし、temoto（トレイ）を終了してください。
このツールは画像をダウンロードしますがOCRはしないので、完了したら次のコマンドでOCRを実行します。

```sh
temoto.exe sync --only-ocr              # OCR していない画像だけを処理する（中断・再開できる）
```

## セキュリティと利用上の前提

temotoは、自分のマシンで自分ひとりが使うことを前提にしています。公開サーバーとして
運用することは想定していません。

### 認証機能はありません

temotoにはログイン画面もパスワードもありません。サーバーに到達できる人は誰でも、
読書リストを閲覧し、記事を追加・削除できます。そのため、既定では`localhost`でだけ待ち受けます。

ループバック以外のアドレスを`--addr`に指定したときは、`--allow-remote-access`も
付けないと起動を中断します。設定の誤りでLANやインターネットにサーバーを公開してしまう
ことを防ぐためで、このフラグを付ければ意図して公開できます。

外部の端末から使う場合は、LANに公開せず、前述の
[Tailscale Serve](#自分の別の端末から使うtailscale-serve)を使ってください。

### 実装している対策

temotoはローカルで使うことを前提にしていますが、外部から取り込んだ記事本文を画面に
表示するので、次の対策を実装しています。

| 対策 | 内容 |
| --- | --- |
| 記事HTMLのサニタイズ | 取得したHTMLは、タグと属性の許可リストを通してから表示する。`script`・`iframe`・`on*`属性・`javascript:`は除去する |
| CSRFトークン | 状態を変えるすべてのリクエスト（POST・PUT・DELETE）に`X-CSRF-Token`ヘッダーを要求する。トークンは`HttpOnly`の`sid` CookieからHMACで導出する |
| Content-Security-Policy | 外部オリジンからのスクリプトの読み込みと、外部オリジンへの接続を禁止する。`object-src 'none'`・`frame-ancestors 'none'`・`base-uri 'none'`も指定する |
| パストラバーサル対策 | 画像を配信するときはパスを1階層ずつ検証し、シンボリックリンクを解決したうえで、画像ディレクトリの内側にあることを確かめる |
| SSRFガード | 記事を取得するとき、内部ネットワーク（ループバック・プライベートアドレス・リンクローカル・クラウドのメタデータ）への接続を遮断する。リダイレクト先も毎回検査する |
| 外部依存の同梱 | htmxとmark.jsをCDNから読み込まず、リポジトリに同梱する。ネットワークが無くても動き、CDN上のファイルが改ざんされても影響を受けない |
| GETの副作用の禁止 | GETのハンドラーで状態を変えないことを、テストで検査している |

### 実装していないこと

次の対策は、ローカルで使う前提に合わせて実装していません。

- 認証と認可。前述のとおり、サーバーに到達できる人は誰でも操作できます。
- レート制限。検索などのエンドポイントに回数の制限はありません。
- ヘッドレスブラウザ経由の取得に対するSSRFガード。ブラウザが名前解決と接続を自分で行うので、
  Go側の`Dialer.Control`による検査が働きません。ヘッドレスブラウザに渡すURLは
  利用者自身が保存した記事のURLに限られるので、この点は許容しています。
- CSPによるXSS対策の強制。テンプレートにインラインのイベントハンドラーが残っているので、
  CSPで`'unsafe-inline'`を許可しています。XSSに対する防御は、記事HTMLのサニタイズが担っています。
- `.env`の暗号化。`.env`にはInstapaperのConsumer KeyとConsumer Secretが平文で入り、
  初回の同期ではユーザー名とパスワードも入ります。`.env`は`.gitignore`で除外していますが、
  コミットしないよう注意してください。初回の同期が済めばアクセストークンがDBに保存されるので、
  `INSTAPAPER_USERNAME`と`INSTAPAPER_PASSWORD`は削除して構いません。
- DBの暗号化。`data/articles.db`は暗号化していないSQLiteのファイルで、アクセストークンも
  ここに入ります。同期フォルダやバックアップ先に置くときは扱いに注意してください。

### `TEMOTO_LOCAL_FETCH_ALLOWLIST`

`TEMOTO_LOCAL_FETCH_ALLOWLIST`は、SSRFガードに例外を設ける環境変数です。
自宅のサーバーやルーターの管理画面など、内部ネットワークのページを意図して取得したい
ときにだけ指定します。

```sh
TEMOTO_LOCAL_FETCH_ALLOWLIST=127.0.0.1:8080,192.168.1.10:80
```

指定した`IP:ポート`と完全に一致する宛先だけを許可します。ホスト名による指定や、
ポートの省略はできません。ホスト名を許すと、DNSリバインディングでガードを回避できて
しまうためです。既定では何も許可しません。ただし、`TEMOTO_FX_API_BASE`に指定した
セルフホストの宛先は、ここに書かなくても自動で許可します。

### データの扱いと責任の範囲

- データは`data/`に保存されます。DB（`articles.db`）と記事の画像が入り、記事と画像の数に
  よっては数百MBから数GBになります。バックアップには前述の`scripts\backup-db.ps1`を使ってください。
- 取得したコンテンツの著作権は、取得元に帰属します。temotoは、個人が自分の読書履歴を
  手元で検索するためのツールです。取得元のサイトの利用規約と著作権法に従う責任は、利用者にあります。
- 保存したDBや画像を再配布しないでください。第三者の著作物が含まれています。
- 公開サーバーとして運用しないでください。認証が無いうえ、取り込んだ他人のコンテンツを
  不特定多数に配信することになります。
- InstapaperやInstaparserなど、外部サービスのAPIの利用規約に従ってください。
  取得の間隔（`TEMOTO_FETCH_INTERVAL`）を極端に短くしないでください。

## 開発

### ビルドとテスト

```sh
go build ./...
go vet ./...
go test ./...
```

`go test ./...`はネットワークにも外部コマンドにも依存しないので、クリーンな環境でも
そのまま通ります。実際のサイトから取得するテストは、ビルドタグで分けてあります。

```sh
# 実際のネットワークを使う統合テスト（接続が必要）
go test -tags integration ./...
```

`internal/repohygiene`のテストは、リポジトリの状態を次の点で検査します。

- `*_integration_test.go`に`//go:build integration`が付いている
- 追跡しているテキストファイルの改行コードがLFである
- `.env`・証明書・`data/`などを誤って追跡していない

### コードを書くときの約束

- HTTPクライアントは`fetcher.NewSafeClient`で作ってください。`http.Client{}`や
  `http.Get`を直接使うと、SSRFガード（内部ネットワーク宛ての遮断、リダイレクト先の再検査、
  スキームの制限）を通らずに通信してしまいます。
- 記事本文を表示する経路に、サニタイズしていないHTMLを渡さないでください。ビューモデル
  （`internal/web/view.go`）は、サニタイズ済みのHTMLだけを`template.HTML`型で持ちます。
  テンプレートには`string`型のHTMLを渡さないでください。
- GETのハンドラーに副作用を書かないでください。DBの更新・ファイルの書き込み・外部からの
  取得をGETのハンドラーに書くと、`TestGETRoutesHaveNoSideEffects`が失敗します。
- ルートを追加するときにCSRF対策を書き足す必要はありません。`Handler()`がmux全体を
  CSRFの検査で包んでいるためです。GET・HEAD・OPTIONS以外のルートがすべて検査の対象に
  なっていることは、`TestCSRFCoversAllNonSafeRoutes`が確かめます。
- フロントエンドから外部のURLを参照しないでください。CDNもWebフォントも使いません
  （`TestNoExternalFrontendDependencies`が検査します）。ライブラリを追加するときは
  `internal/web/static/vendor/`に同梱し、取得元・SHA-256・ライセンスを
  [vendor/README.md](internal/web/static/vendor/README.md)に記録してください。

### SQLite CLI

DBを直接参照したり、クエリを実行したりするときに使います。

```sh
winget install SQLite.SQLite
```

```sh
# 使用例
sqlite3 data\articles.db "SELECT COUNT(*) FROM bookmarks;"
```

## ライセンス

[MIT License](LICENSE)（Copyright (c) 2026 ngram）

同梱している、または依存している第三者のソフトウェアとそのライセンスは、
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)にまとめています。いずれもMIT・BSD・
Apache-2.0のどれかで、コピーレフトのライセンスのものは含みません。

- `internal/web/static/vendor/`配下のhtmxとmark.jsは、第三者のライブラリを
  そのまま同梱したものです。それぞれのライセンスに従います。
- `internal/web/static/app.js`・`app.css`とすべてのアイコンはtemotoのために作成したもので、
  上記のMIT Licenseが適用されます。
- PDFのページを画像にする処理で使うPyMuPDFのライセンスはAGPL-3.0です。
  temotoはPyMuPDFを同梱もリンクもしておらず、利用者の環境の`python`を通して呼び出すだけです。

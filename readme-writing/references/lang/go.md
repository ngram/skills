# Go

## 検出の手がかり

- `go.mod`がある。`module`の行がモジュールのパスで、`go`の行が必要な版である
- `package main`があればコマンド、無ければライブラリ。`cmd/<名前>/main.go`が並ぶリポジトリでは、`cmd/`の下のディレクトリがコマンドである
- `.goreleaser.yml`（`.goreleaser.yaml`）があれば、リリースのバイナリ、Homebrew、パッケージなどの配布の方法がそこに書いてある

## 入れ方

| 種類 | 書くこと |
|---|---|
| コマンド | `go install <モジュールのパス>/cmd/<名前>@latest`（ルートが`main`なら`go install <モジュールのパス>@latest`） |
| コマンド（配布がある） | リリースのバイナリ、`brew install`などを先に書き、`go install`を後に書く |
| ライブラリ | `go get <モジュールのパス>` |

- `go install`のパスは、`go.mod`の`module`の行と`cmd/`の構成から作り、推測で書かない
- `/v2`以降のモジュールは、パスに`/v2`が入る

## 動作環境の書き方

- ビルドに要るGoの版は、`go.mod`の`go`の行の版を書く（「Go 1.23以降」）
- cgoを使うか（`import "C"`、cgoが要る依存）を確かめる。使うなら、Cコンパイラが要ることを書く
- OSを限るビルドタグ（`//go:build windows`など）があれば、どのOSで動くかを書く

## APIの文書の場所

- 公開しているモジュールの文書は、pkg.go.dev（`https://pkg.go.dev/<モジュールのパス>`）にある。READMEからはここへリンクする
- バッジを付けるなら、pkg.go.devのバッジ（`https://pkg.go.dev/badge/<モジュールのパス>.svg`）を使う
- 関数の説明はソースのdocコメントに書く。READMEに関数の一覧を書かない

## 例の置き場所

- 2つ目以降の例は、`example_test.go`のExampleの関数（`func ExampleToKatakana()`など）に書く。pkg.go.devに関数ごとに表示され、`// Output:`のコメントがあれば`go test`で出力も確かめられる
- READMEの最小の例は、Exampleの関数の1つと同じ内容にして、`go test`で確かめられるようにする

## オプションの一覧の取り方

- `flag`パッケージ：`go run ./cmd/<名前> -h`の出力
- cobra・urfave/cli：`<名前> help`、`<名前> <サブコマンド> --help`の出力
- READMEに一覧を写すときは、出力をそのまま貼り、手で書き換えない（実装と食い違う）

## 規模の手がかり

- 主なコマンド：`cmd/`の下のうち、初めての人が使うもの。メンテナンス用（移行、修復、一括処理）は数えない
- サブコマンド：cobraやurfave/cliのサブコマンドのうち、初めての人が使うもの
- 必須の設定：環境変数を読む処理（`os.Getenv`）や設定ファイルの読み込みのうち、無いと起動しないもの

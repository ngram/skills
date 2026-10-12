# READMEの雛形

種類ごとの雛形を示す。`<…>`は埋める箇所で、入れ方や文書の場所は言語の節（`lang/<言語>.md`）に従って埋める。
当てはまらない節は消す。節を足すときは、[placement.md](placement.md)で移す先が決まっていない内容に限る。

## 見出しの名前

日本語と英語のどちらで書くかは、既存のREADMEとリポジトリのほかの文書に合わせる。

| 英語 | 日本語 |
|---|---|
| Install / Installation | インストール |
| Setup | セットアップ・初期設定 |
| Usage | 使い方 |
| Quick start | はじめかた |
| Documentation | ドキュメント・詳しい情報 |
| Contributing | 開発に参加する |
| License | ライセンス |
| Author / Authors | 作者 |

## CLIツール

````markdown
# <名前>

<何をするツールか、1文>。<何が楽になるか、1〜2文>。

## Install

```sh
<主な入れ方のコマンド>
```

<ほかの入れ方（リリースのバイナリ、パッケージマネージャー）があれば1〜2行>

## Setup

<必須の設定だけ。手順は3つまで>

## Usage

### <作業1>

```sh
<コマンド>
```

### <作業2>

```sh
<コマンド>
```

オプションの一覧は`<名前> -h`で出る。

## Documentation

- [<任意の機能>](docs/<機能>.md)
- [<設定と環境変数>](docs/reference.md)

## License

<ライセンス名>（[LICENSE](LICENSE)）

## Author

<作者>
````

- 作業は、利用者が最初の日に行うものを3〜6個にする。残りはdocs/に移す
- 1つの作業の説明は、見出しのほかに1文までにする

## ライブラリ

````markdown
# <名前>

<何をするライブラリか、1文>。<ほかとの違いや使いどころ、1〜2文>。

## Install

```sh
<パッケージを入れるコマンド>
```

## Example

```<言語>
<最小の例。30行まで>
```

## Documentation

APIの説明と、ほかの例は<APIの文書のURL>にある。

## License

<ライセンス名>（[LICENSE](LICENSE)）
````

- 例は1つにする。ほかの例は、言語の節が示す場所（GoはExampleテスト）に置き、APIの文書から見られるようにする
- 関数やオプションの一覧の表をREADMEに書かない。APIの文書と重なり、どちらかが古くなる

## アプリ・サービス

````markdown
# <名前>

<何をするものか、1文>。<誰がどう使うか、1〜2文>。

## Quick start

1. <入れる・起動する>
2. <必須の設定>
3. <最初の操作>

## Documentation

- [<セットアップの詳細>](docs/setup.md)
- [<運用・データ>](docs/<話題>.md)
- [<セキュリティ上の前提>](docs/security.md)

<安全に関わる注意があれば、ここに要約の1行>

## Contributing

ビルドとテストの方法は[CONTRIBUTING.md](CONTRIBUTING.md)にある。

## License

<ライセンス名>（[LICENSE](LICENSE)）
````

- Quick startは5手順までにする。任意の機能の準備は含めない

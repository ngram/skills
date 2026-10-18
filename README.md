# ngram/skills

日本語の技術文書とGitの作業手順のための、エージェント用のSkill集。
各ディレクトリが[Agent Skills](https://agentskills.io/specification)形式の独立したSkillで、Skillごとに個別にインストールできる。

## インストール

`<name>`をSkill名に置き換える。Skillごとのコマンドは、各ディレクトリのREADMEにある。

| 経路 | コマンド |
| --- | --- |
| Claude Code・Claude Desktop（プラグイン） | `/plugin marketplace add ngram/skills`のあと`/plugin install <name>@ngram-skills` |
| claude.ai（Cowork・クラウドセッション） | [リリース](https://github.com/ngram/skills/releases/latest)に添付した`<name>.skill`の、セッションのファイルのカードの「Save skill」か、claude.aiのCustomize > Skillsのアップロードでの導入 |
| GitHub CLI（gh 2.90以降） | `gh skill install ngram/skills <name> --agent claude-code --scope user` |
| [APM](https://github.com/microsoft/apm) | `apm install -g ngram/skills/<name>` |
| [skills CLI](https://github.com/vercel-labs/skills) | `npx skills add ngram/skills --skill <name>` |
| フォルダのコピー | `npx degit ngram/skills/<name> ~/.claude/skills/<name>` |

Claude Codeのプラグインとして入れたSkillは、`/<name>:<name>`の形で呼び出す。
`/<name>`で呼び出したいときは、gh skill、APM、skills CLIのどれかで`~/.claude/skills/`に入れる。

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。クラウドセッションは手元の`~/.claude/skills/`とプラグインを読まないので、クラウドセッションで使うときはこの経路で入れる。

### バージョンを指定したインストール

バージョンは、リポジトリ全体で1つのタグ（`v0.1.0`など）で表す。タグを指定して入れる方法は次のとおり。

- gh skill：`gh skill install ngram/skills <name>@v0.1.0`。`@v0.1.0`の代わりに`--pin v0.1.0`を付けた導入では、`gh skill update`の対象外（`@v0.1.0`と`--pin`の併用は不可）
- APM：`apm install -g ngram/skills/<name>#v0.1.0`
- Claude Code：`/plugin marketplace add ngram/skills@v0.1.0`
- claude.ai：そのタグのリリースに添付した`<name>.skill`のアップロード

## Skill一覧

<!-- skills:list:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
| Skill | 説明 | 必要なもの | ライセンス |
| --- | --- | --- | --- |
| [git-commit](git-commit/) | Gitのステージング、日本語のコミットメッセージ案とプルリクエストのタイトル・本文の作成、コミットの手順と書式 | gitとNode.js 18以降が必要 | [MIT](LICENSE) |
| [japanese-tech-writing](japanese-tech-writing/) | 日本語の技術文書・書籍原稿の文章規範 | 空白の検査と修正（scripts/fix_spacing.mjs）にはNode.js 18以降が必要 | Unlicense AND MIT。取り込み元の部分はUnlicense（[LICENSE.txt](japanese-tech-writing/LICENSE.txt)）、ngram/skillsで足した部分はMIT（[LICENSE-MIT.txt](japanese-tech-writing/LICENSE-MIT.txt)） |
| [plan-create](plan-create/) | 実装の前の計画（Plan）の作成と、plan/YYYYMMDD_機能名.mdへの保存 | なし | [MIT](LICENSE) |
| [plan-review](plan-review/) | CodexかClaudeによる、plan/配下のPlanファイルのレビュー | Claude Code（手元とクラウドセッション）向け（引数の置換とdisable-model-invocationを使う）。bashと、codex CLIかclaude CLIが必要。claude.aiのチャットは対象外 | [MIT](LICENSE) |
| [readme-writing](readme-writing/) | 初めての人が使い始めるための入口としての、短いREADMEの作成と見直し | 計測のスクリプト（scripts/readme_stats.mjs）にはNode.js 18以降が必要 | [MIT](LICENSE) |
| [repo-privacy-audit](repo-privacy-audit/) | リポジトリと公開済みのパッケージの、個人情報・秘密情報・機微情報の検査と、値を伏せた報告 | gitとNode.js 18以降が必要。公開済みのパッケージを調べるときは、各レジストリのコマンド（gem、npmなど）とネットワーク接続も必要 | [MIT](LICENSE) |
<!-- skills:list:end -->

`git-commit`、`plan-create`、`readme-writing`は、`japanese-tech-writing`が入っていれば、書く文章（コミットメッセージやプルリクエストの本文、Plan、README）をその規範に合わせる。

`japanese-tech-writing`は、keiichiro shikano氏が[gist](https://gist.github.com/fd287c3133457c4fd8f5601d34aa817d)で公開しているSkillに、見出しと用語の逐語訳、手順の書き方、表のセルの書き方、日本語と英数字の間の空白の4つの節と、空白を除くスクリプトを足して収録したものである。取り込み元の行は、frontmatterの`license`を除いて変えていない。

## 開発

- [開発とリリースの手順](docs/development.md)

## ライセンス

Skillごとに独自のライセンスを持つ。各Skillフォルダを参照のこと。

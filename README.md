# ngram/skills

日本語の技術文書とGitの作業手順のための、エージェント用のSkill集。
各ディレクトリが[Agent Skills](https://agentskills.io/specification)形式の独立したSkillで、Skillごとに個別にインストールできる。

## インストール

`<name>`をSkill名に置き換える。Skillごとのコマンドは、各ディレクトリのREADMEにある。

| 経路 | コマンド |
| --- | --- |
| Claude Code・Claude Desktop（プラグイン） | `/plugin marketplace add ngram/skills`のあと`/plugin install <name>@ngram-skills` |
| claude.ai（Cowork・クラウドセッション） | [リリース](https://github.com/ngram/skills/releases/latest)に添付した`<name>.skill`を、セッションのファイルのカードの「Save skill」か、claude.aiのCustomize > Skillsのアップロードで入れる（`plan-review`はサポート外） |
| GitHub CLI（gh 2.90以降） | `gh skill install ngram/skills <name> --agent claude-code --scope user` |
| [APM](https://github.com/microsoft/apm) | `apm install -g ngram/skills/<name>` |
| [skills CLI](https://github.com/vercel-labs/skills) | `npx skills add ngram/skills --skill <name>` |
| フォルダのコピー | `npx degit ngram/skills/<name> ~/.claude/skills/<name>` |

Claude Codeのプラグインとして入れたSkillは、`/<name>:<name>`の形で呼び出す。
`/<name>`で呼び出したいときは、gh skill、APM、skills CLIのどれかで`~/.claude/skills/`に入れる。

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。クラウドセッションは手元の`~/.claude/skills/`とプラグインを読まないので、クラウドセッションで使うときはこの経路で入れる。

## Skill一覧

<!-- skills:list:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
| Skill | 説明 | 必要なもの | ライセンス |
| --- | --- | --- | --- |
| [git-commit](git-commit/) | Git のステージング、日本語のコミットメッセージ案の作成、コミットの手順と書式。 | gitとNode.js 18以降が必要 | MIT |
| [japanese-tech-writing](japanese-tech-writing/) | 日本語の技術文書・書籍原稿の文章規範。 | 空白の検査と修正（scripts/fix_spacing.mjs）にはNode.js 18以降が必要 | Unlicense AND MIT。取り込み元の部分はUnlicense（LICENSE.txt）、ngram/skillsで足した部分はMIT（LICENSE-MIT.txt） |
| [plan-review](plan-review/) | plan/ 配下の Plan ファイルを Codex にレビューさせ、履歴を plan/.reviews/ に蓄積して diff を表示する。 | Claude Code向け（引数の置換とdisable-model-invocationを使う）。手元のbashとcodex CLIが必要で、claude.aiはサポート外 | MIT |
| [repo-privacy-audit](repo-privacy-audit/) | リポジトリと公開済みのパッケージに、個人情報・秘密情報・機微情報が含まれていないかを調べ、値を伏せて報告する。 | gitとNode.js 18以降が必要。公開済みのパッケージを調べるときは、各レジストリのコマンド（gem、npmなど）とネットワーク接続を使う | MIT |
<!-- skills:list:end -->

`git-commit`は、`japanese-tech-writing`が入っていればその規範でコミットメッセージ案を点検する。

`japanese-tech-writing`は、keiichiro shikano氏が[gist](https://gist.github.com/fd287c3133457c4fd8f5601d34aa817d)で公開しているSkillに、日本語と英数字の間の空白を除く節とスクリプトを足して収録したものである（取り込み元の部分はUnlicense、足した部分はMIT。「ライセンス」の節）。取り込み元の部分は変えていない。

## 版の固定

版はリポジトリ全体のタグ（`v0.1.0`など）で表す。タグを指定して入れる方法は次のとおり。

- gh skill：`gh skill install ngram/skills <name>@v0.1.0`（`--pin`を付けると`gh skill update`の対象から外れる）
- APM：`apm install -g ngram/skills/<name>#v0.1.0`
- Claude Code：`/plugin marketplace add ngram/skills@v0.1.0`
- claude.ai：そのタグのリリースに添付した`<name>.skill`をアップロードする

## 開発

- Skillは直下の`<name>/SKILL.md`に置き、ディレクトリ名とfrontmatterの`name`を一致させる
- Skillを足したり、frontmatterを変えたりしたら、`node scripts/sync-skills.mjs`を実行する。各SkillのREADMEのインストール手順、`.claude-plugin/marketplace.json`、上のSkill一覧が生成される
- `node scripts/sync-skills.mjs --check`と`node --test tests/*.test.mjs`はCIでも実行する。CIでは`claude plugin validate .`と`gh skill publish --dry-run`もかける
- リリースは、Actionsの`release`ワークフローを「Run workflow」で版（`v0.1.0`など）を指定して実行して作る。CIと同じ検査を通したあと、`main`の最新のコミットにタグを付け、GitHub Releaseと、Skillごとの`.skill`（`<name>.skill`）をまとめて作る。タグをpushできない環境（クラウドセッションなど）からも使える
- 手元で`gh skill publish --tag v0.1.0`を実行して作ってもよい。このコマンドは`agent-skills`トピックも付ける。公開すると、`.github/workflows/release-assets.yml`が`.skill`を作ってリリースに添付する
- 同じ`.skill`は`node scripts/package-skills.mjs`で手元でも作れる（`dist/`に出力する）。frontmatterにclaude.aiのアップロードで拒否されることがあるキー（skill-creatorの検証が許していないキー）があれば、警告を出す
- claude.aiで使えないSkillは、frontmatterの`metadata`に`claude-ai: unsupported`を書く。そのSkillの`.skill`は作らず、READMEのclaude.aiの節もサポート外の案内になる
- リリースのあと、Claude Codeのクラウドセッションで`node scripts/check-skill-updates.mjs`を実行すると、claude.aiに入っているSkillと最新のリリースの`.skill`を比べ、入れ直しが要る`.skill`を`dist/skill-updates/`に置く。Claudeがこのファイルをセッションに送ると、ファイルのカードの「Save skill」で入れられる。リリースのたびにこれを行うRoutineの設定は、[設計書](docs/design.md)の「claude.aiへの反映」の節にある
- 不変リリース（immutable releases）を有効にしても、`release`ワークフローはそのまま使える。`gh skill publish`で作る場合は、公開したリリースに`.skill`を添付できないので、タグをpushして下書きのリリースを作り、`release-assets`をworkflow_dispatchで実行してから公開する

## ライセンス

Skillごとに独自のライセンスを持つことがある。その場合は、Skillのディレクトリにある`LICENSE.txt`を参照する（`japanese-tech-writing`は、取り込み元の部分がUnlicense（`LICENSE.txt`）、このリポジトリで足した部分がMIT（`LICENSE-MIT.txt`））。
ライセンスを明示していないSkillは、[MIT License](LICENSE)とする。

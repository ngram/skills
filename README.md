# ngram/skills

日本語の技術文書とGitの作業手順のための、エージェント用のSkill集。
各ディレクトリが[Agent Skills](https://agentskills.io/specification)形式の独立したSkillで、Skillごとに個別にインストールできる。

## インストール

`<name>`をSkill名に置き換える。Skillごとのコマンドは、各ディレクトリのREADMEにある。

| 経路 | コマンド |
| --- | --- |
| Claude Code・Claude Desktop（プラグイン） | `/plugin marketplace add ngram/skills`のあと`/plugin install <name>@ngram-skills` |
| GitHub CLI（gh 2.90以降） | `gh skill install ngram/skills <name> --agent claude-code --scope user` |
| [APM](https://github.com/microsoft/apm) | `apm install -g ngram/skills/<name>` |
| [skills CLI](https://github.com/vercel-labs/skills) | `npx skills add ngram/skills --skill <name>` |
| フォルダのコピー | `npx degit ngram/skills/<name> ~/.claude/skills/<name>` |

Claude Codeのプラグインとして入れたSkillは、`/<name>:<name>`の形で呼び出す。
`/<name>`で呼び出したいときは、gh skill、APM、skills CLIのどれかで`~/.claude/skills/`に入れる。

## Skill一覧

<!-- skills:list:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
| Skill | 説明 | 必要なもの | ライセンス |
| --- | --- | --- | --- |
| [git-commit](git-commit/) | Git のステージング、日本語のコミットメッセージ案の作成、コミットの手順と書式。 | gitとNode.js 18以降が必要 | 未設定 |
| [japanese-tech-writing](japanese-tech-writing/) | 日本語の技術文書・書籍原稿の文章規範。 | なし | Unlicense（https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063） |
| [plan-review](plan-review/) | plan/ 配下の Plan ファイルを Codex にレビューさせ、履歴を plan/.reviews/ に蓄積して diff を表示する。 | Claude Code向け（引数の置換とdisable-model-invocationを使う）。bashとcodex CLIが必要 | 未設定 |
<!-- skills:list:end -->

`git-commit`は、`japanese-tech-writing`が入っていればその規範でコミットメッセージ案を点検する。

`japanese-tech-writing`は、keiichiro shikano氏が[gist](https://gist.github.com/fd287c3133457c4fd8f5601d34aa817d)で公開しているSkillを、内容を変えずに収録したものである（Unlicense）。

## 版の固定

版はリポジトリ全体のタグ（`v0.1.0`など）で表す。タグを指定して入れる方法は次のとおり。

- gh skill：`gh skill install ngram/skills <name>@v0.1.0`（`--pin`を付けると`gh skill update`の対象から外れる）
- APM：`apm install -g ngram/skills/<name>#v0.1.0`
- Claude Code：`/plugin marketplace add ngram/skills@v0.1.0`

## 開発

- Skillは直下の`<name>/SKILL.md`に置き、ディレクトリ名とfrontmatterの`name`を一致させる
- Skillを足したり、frontmatterを変えたりしたら、`node scripts/sync-skills.mjs`を実行する。各SkillのREADMEのインストール手順、`.claude-plugin/marketplace.json`、上のSkill一覧が生成される
- `node scripts/sync-skills.mjs --check`と`node --test tests/*.test.mjs`はCIでも実行する。CIでは`claude plugin validate .`と`gh skill publish --dry-run`もかける
- リリースは`gh skill publish --tag v0.1.0`で作る

<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# plan-review

> CodexかClaudeによる、plan/配下のPlanファイルのレビュー。レビューする側は引数か環境変数で選び、既定ではcodexにログイン済みならCodex、そうでなければClaude（claude -p）を使う。履歴をplan/.reviews/に残し、差分を表示する。Planの「外部との入出力」と「実現すること・しないこと」を前提に、レビューする側に指摘を重大度で分けさせ、「重大」の指摘が無くなった時点で終える。ユーザーが/plan-reviewと明示的に指示したときだけ使う。

必要なもの：Claude Code（手元とクラウドセッション）向け（引数の置換とdisable-model-invocationを使う）。bashと、codex CLIかclaude CLIが必要。claude.aiのチャットは対象外

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install plan-review@ngram-skills
```

導入後は`/plan-review:plan-review`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`plan-review.skill`を、claude.aiに入れる。最新版は次のURLで取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/plan-review.skill
```

入れ方は次の2つ。

- Claudeのセッションで、Claudeにこの`.skill`をファイルとして渡してもらい、ファイルのカードの「Save skill」を押す
- claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。`.skill`を選べないときは、拡張子を`.zip`に変える（中身はZIP）

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`を同じ方法で入れ直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills plan-review --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/plan-review
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/plan-review
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill plan-review
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/plan-review ~/.claude/skills/plan-review
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

## 使い方

- 手元のClaude Code：`/plan-review`（プラグインとして入れたときは`/plan-review:plan-review`）
- クラウドセッション（claude.aiに入れたSkill）：`/anthropic-skills:plan-review`
- レビューする側の指定：`/plan-review --reviewer claude 20250621_my-feature`。指定しないときは、`codex`にログイン済みならCodex、そうでなければClaude

モデルと推論の強さを変える環境変数は、[SKILL.md](./SKILL.md)の「レビューする側とモデルの選び方」にある。

## クラウドセッションでCodexを使う

クラウドセッションには`codex`が入っていない。Codexでレビューさせるときは、環境の設定（セッションのタイトルバーの環境のメニューから「Edit」）で、次の3つを行う。設定は、新しく始めるセッションから効く。

1. 環境変数への、OpenAIのAPIキーの`OPENAI_API_KEY`としての追加
2. Network accessの「Allowed domains」への、`api.openai.com`の追加
3. Setup scriptへの、次のコマンドの追加

```bash
npm install -g @openai/codex
printenv OPENAI_API_KEY | codex login --with-api-key
```

APIキーは、Network secretsではなく環境変数に入れる。Network secretsのキーが、送信のときにプロキシが差し込む方式だと、Setup scriptの`printenv`では読めず、`codex login`が失敗する（確かめていない）。

設定しないときは、Claudeでレビューする。

## WindowsでCodexがリポジトリを読めないとき

Codexのサンドボックスを`elevated`（`~/.codex/config.toml`の`[windows] sandbox = "elevated"`）にしていると、Codexがコマンドを1つも起動できず、リポジトリを読めないことがある。
このときCodexは終了コード0で、Planの記述だけに基づく応答を返す。
Codexのデスクトップアプリが動いていて、サンドボックスの準備（setup refresh）で検証するファイルを開いていることが原因と見ている（デスクトップアプリを止めて確かめてはいない）。

- `plan-review`は、Windowsでは既定でサンドボックスを`unelevated`（`-c windows.sandbox="unelevated"`）にしてCodexを呼ぶ。`-s read-only`による書き込みの禁止は保たれる
- `config.toml`の設定に従わせるときは、環境変数`PLAN_REVIEW_CODEX_WINDOWS_SANDBOX`を`config`にする。`elevated`などのほかの値を書くと、その値を渡す
- 実行ログ（`rNN_review.log`）にコマンドを起動できなかった跡（`exec_command failed`か`Failed to create unified exec process`の行）があると、応答の判定を採らず、`UNVERIFIED`としてユーザーに確かめる
- 原因は`~/.codex/.sandbox/sandbox.<日付>.log`で確かめられる。`setup refresh had errors`の行の前に、準備に失敗したファイルと理由（「別のプロセスが使用中」など）が出る
- `elevated`のまま使うときは、Codexのデスクトップアプリを終了してから試す（確かめていない）

`config.toml`の`[windows] sandbox`はCodex全体の設定なので、`plan-review`以外でCodexを使うときにも同じことが起きる。

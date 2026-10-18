<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# plan-review

> CodexかClaudeによる、plan/配下のPlanファイルのレビュー。レビューする側は引数か環境変数で選び、既定ではcodexにログイン済みならCodex、そうでなければClaude（claude -p）を使う。履歴をplan/.reviews/に残し、差分を表示する。Planの「保証の水準」をレビューする側に渡して指摘を重大度で分けさせ、「重大」の指摘が無くなった時点で終える。ユーザーが/plan-reviewと明示的に指示したときだけ使う。

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

1. Network secrets（無ければ環境変数）への、OpenAIのAPIキーの`OPENAI_API_KEY`としての追加
2. Network accessの「Allowed domains」への、`api.openai.com`の追加
3. Setup scriptへの、次のコマンドの追加

```bash
npm install -g @openai/codex
printenv OPENAI_API_KEY | codex login --with-api-key
```

設定しないときは、Claudeでレビューする。

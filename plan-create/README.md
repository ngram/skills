<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# plan-create

> 実装の前に計画（Plan）を書き、plan/YYYYMMDD_<機能名>.mdに残す。節は目的・背景、保証の水準（外部との接続、失敗したときの影響、守るもの、守らないもの）、スコープ、技術選定・前提、実装ステップ、影響範囲、エラーハンドリング・エッジケース、テスト方針、実装時に決める事項、未確定事項・要確認。書く前に前提をコードや実行で確かめ、書いたあとは「実装して」と言われるまで実装しない。/plan-reviewでそのままレビューできる形にする。Claude Codeのplan mode（会話の中で計画を承認する機能）とは別で、計画をファイルに残すためのもの。「実装計画を作成して」「実装計画をしてください」「Planを書いて」「設計してから実装して」と頼まれたときに使用する。

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install plan-create@ngram-skills
```

導入後は`/plan-create:plan-create`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`plan-create.skill`を、claude.aiに入れる。最新版は次のURLで取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/plan-create.skill
```

入れ方は次の2つ。

- Claudeのセッションで、Claudeにこの`.skill`をファイルとして渡してもらい、ファイルのカードの「Save skill」を押す
- claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。`.skill`を選べないときは、拡張子を`.zip`に変える（中身はZIP）

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`を同じ方法で入れ直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills plan-create --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/plan-create
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/plan-create
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill plan-create
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/plan-create ~/.claude/skills/plan-create
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

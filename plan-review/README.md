<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# plan-review

> plan/ 配下の Plan ファイルを Codex にレビューさせ、履歴を plan/.reviews/ に蓄積して diff を表示する。ユーザーが /plan-review と明示的に指示したときだけ使う。

必要なもの：Claude Code向け（引数の置換とdisable-model-invocationを使う）。bashとcodex CLIが必要

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install plan-review@ngram-skills
```

導入後は`/plan-review:plan-review`で呼び出せる。

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

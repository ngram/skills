<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# git-commit

> Git のステージング、日本語のコミットメッセージ案の作成、コミットの手順と書式。1行目は Conventional Commits の型と体言止めの内容、本文は「問題・対応・テスト・影響」の節に分けた体言止めの箇条書き、1行目は表示幅72桁以内で本文は折り返さない。リポジトリに commit.template（.gitmessage）があれば、書式はそちらを優先する。案は japanese-tech-writing の規範と textlint で点検し、ユーザーが「コミットして」と言うまでコミットしない。ステージしてほしい、コミットメッセージ案を出してほしい、コミットしてほしいと頼まれたときに使用する。

必要なもの：gitとNode.js 18以降が必要

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install git-commit@ngram-skills
```

導入後は`/git-commit:git-commit`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`git-commit.zip`をダウンロードし、claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。最新版のZIPは次のURLでも取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/git-commit.zip
```

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版のZIPをアップロードし直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills git-commit --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/git-commit
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/git-commit
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill git-commit
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/git-commit ~/.claude/skills/git-commit
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

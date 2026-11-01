<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# spell-check

> typosによる英単語の綴りの確認と、誤字の直し方、リポジトリのtyposの設定ファイルへの語の登録（ユーザー辞書）。ステージした内容か、指定したファイル（書いた文書、コミットメッセージの下書きなど）を同梱のスクリプトで確かめ、ソースコードのコメントと文書の文章の誤字だけを直し、コードの中の誤字と誤字でない語はユーザーに示す。typosが無ければ、入れるかを尋ねる。綴りを確かめてほしい、スペルチェックしてほしい、typosをかけてほしいと頼まれたときと、ほかのSkill（git-commit、readme-writing、plan-create、japanese-tech-writing）の手順から呼ばれたときに使用する。

必要なもの：Node.js 18以降とtyposが必要。ステージした内容を確かめるときはgitも必要

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install spell-check@ngram-skills
```

導入後は`/spell-check:spell-check`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`spell-check.skill`を、claude.aiに入れる。最新版は次のURLで取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/spell-check.skill
```

入れ方は次の2つ。

- Claudeのセッションで、Claudeにこの`.skill`をファイルとして渡してもらい、ファイルのカードの「Save skill」を押す
- claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。`.skill`を選べないときは、拡張子を`.zip`に変える（中身はZIP）

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`を同じ方法で入れ直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills spell-check --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/spell-check
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/spell-check
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill spell-check
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/spell-check ~/.claude/skills/spell-check
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

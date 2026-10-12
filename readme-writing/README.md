<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# readme-writing

> READMEを、初めての人が使い始めるための入口として短く書く。READMEに置くことを「何か・入れ方・最初の使い方・詳しい情報の場所・ライセンスと作者」に絞り、任意の機能の手順やリファレンスはdocs/などに移してリンクする。分量は予算（既定は200行。リポジトリの規模と開発者の指定で変える）で抑え、同梱のスクリプトで計る。移すときは内容を消さず、移す前のコードブロック、設定の名前、URLが残っているかを確かめる。言語ごとの入れ方と文書の置き場所はreferences/lang/にある（今はGo）。READMEを書いてほしい、READMEが長いので短くしてほしい、READMEを読みやすくしてほしい、READMEを見直してほしいと頼まれたときに使用する。

必要なもの：計測のスクリプト（scripts/readme_stats.mjs）にはNode.js 18以降が必要

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install readme-writing@ngram-skills
```

導入後は`/readme-writing:readme-writing`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`readme-writing.skill`を、claude.aiに入れる。最新版は次のURLで取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/readme-writing.skill
```

入れ方は次の2つ。

- Claudeのセッションで、Claudeにこの`.skill`をファイルとして渡してもらい、ファイルのカードの「Save skill」を押す
- claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。`.skill`を選べないときは、拡張子を`.zip`に変える（中身はZIP）

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`を同じ方法で入れ直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills readme-writing --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/readme-writing
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/readme-writing
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill readme-writing
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/readme-writing ~/.claude/skills/readme-writing
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

## スクリプトだけを使う

Skillを入れずに、計測のスクリプトだけを手元で実行することもできる。Node.js 18以降があれば動く。

```bash
node readme-writing/scripts/readme_stats.mjs README.md
```

全体・地の文・節ごとの行数、見出しの深さ、リンクの切れを、予算（既定は200行）と比べて示す。予算はREADMEと同じディレクトリの`.readme-budget.json`か、オプションで変えられる（[references/budget.md](references/budget.md)）。
README.mdを書き換えたあとは、`--moved-from <書き換える前のREADME> README.md docs/*.md`で、移した内容が残っているかを確かめられる。オプションの一覧は`--help`で出る。

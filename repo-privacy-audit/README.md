<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# repo-privacy-audit

> リポジトリと公開済みのパッケージに、個人情報・秘密情報・機微情報が含まれていないかを調べ、値を伏せて報告する。今のファイルだけでなく、全ブランチ・タグ・PRの参照から辿れる過去の全版、コミットとタグのメッセージ、作成者の名前とメールアドレスまでを同梱のスクリプトで検査し、一致した箇所は前後を読んで誤検知を除く。履歴の書き換えや削除は自分では行わず、対処の選択肢と注意点を渡す。「個人情報や機微情報が入っていないか確認して」「APIキーやパスワードが残っていないか調べて」「過去のコミットも含めてチェックして」と頼まれたとき、リポジトリを公開する前、privateからpublicに切り替える前、パッケージを初めてリリースする前に使用する。

必要なもの：gitとNode.js 18以降が必要。公開済みのパッケージを調べるときは、各レジストリのコマンド（gem、npmなど）とネットワーク接続を使う

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install repo-privacy-audit@ngram-skills
```

導入後は`/repo-privacy-audit:repo-privacy-audit`で呼び出せる。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills repo-privacy-audit --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/repo-privacy-audit
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/repo-privacy-audit
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill repo-privacy-audit
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/repo-privacy-audit ~/.claude/skills/repo-privacy-audit
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

## スクリプトだけを使う

Skillを入れずに、検査のスクリプトだけを手元で実行することもできる。gitとNode.js 18以降があれば動く。

```bash
git clone --mirror https://github.com/<owner>/<repo>.git repo.git
node repo-privacy-audit/scripts/scan.mjs --repo repo.git --terms-file ~/private-terms.txt
```

`~/private-terms.txt`には、探したい語（実名、個人のメールアドレスなど）を1行に1つ書き、リポジトリの外に置く。
見つかった値は、先頭の数文字と長さだけを出して伏せる。オプションの一覧は`--help`で出る。
展開した公開済みのパッケージは`--dir <ディレクトリ>`で調べられる。

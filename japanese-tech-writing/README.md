<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# japanese-tech-writing

> 日本語の技術文書・書籍原稿の文章規範。段落と論証の構成（パラグラフライティング）、論証の厳密さ（ツッコミどころの除去）、読み手の負荷の管理、視点と語り、演出の抑制、LLM っぽい空句の禁止、翻訳調の比喩と擬人化の禁止（「運ぶ」「効く」「開かれた問い」など）、冗長の排除を定める。日本語で技術書の章、草稿、記事、解説文を書くとき、または推敲・リライトするときに使用する。

必要なもの：空白の検査と修正（scripts/fix_spacing.mjs）にはNode.js 18以降が必要

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install japanese-tech-writing@ngram-skills
```

導入後は`/japanese-tech-writing:japanese-tech-writing`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`japanese-tech-writing.skill`をダウンロードし、claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。同じ中身の`japanese-tech-writing.zip`も添付してあり、どちらをアップロードしてもよい。最新版は次のURLでも取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/japanese-tech-writing.skill
```

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`をアップロードし直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills japanese-tech-writing --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/japanese-tech-writing
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/japanese-tech-writing
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill japanese-tech-writing
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/japanese-tech-writing ~/.claude/skills/japanese-tech-writing
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

## 出典

- 作者：keiichiro shikano
- 取り込み元：<https://gist.github.com/fd287c3133457c4fd8f5601d34aa817d>（コミット`8f2d576`）
- ライセンス：Unlicense（<https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063>）。作者がこのgistに置いた本文を、そのまま[LICENSE.txt](./LICENSE.txt)に収録した

`SKILL.md`は、取り込み元の内容に次の部分を足したものである。取り込み元の行は、frontmatterの`license`を除いて変えていない（改行をLFにそろえた以外）。`license`は、取り込み元の部分と足した部分のライセンスを示すように書き換えた。

- 末尾の「日本語と英数字の間の空白」の節と、その節が使う`scripts/fix_spacing.mjs`。`git-commit`のSkillが行っている、日本語と英数字の間の空白の除去と検査を移植した
- frontmatterの`compatibility`の行

足した部分は、ngram/skillsのほかのSkillと同じく[MIT License](./LICENSE-MIT.txt)とする（Copyright (c) 2026 ngram）。取り込み元の部分はUnlicenseのままである。取り込み元の部分の変更は、取り込み元に提案する。

# 開発とリリースの手順

このリポジトリのSkillを変更する人と、リリースを作る人に向けた文書である。利用者向けの説明は[README](../README.md)にある。

## 決まり

- Skillは直下の`<name>/SKILL.md`に置き、ディレクトリ名とfrontmatterの`name`を一致させる
- claude.aiで使えないSkillは、frontmatterの`metadata`に`claude-ai: unsupported`を書く。そのSkillの`.skill`は作らず、READMEのclaude.aiの節もサポート外の案内になる
- 各SkillのREADMEのインストール手順、`.claude-plugin/marketplace.json`、READMEのSkill一覧は、`scripts/sync-skills.mjs`が生成する。手で編集しない

## 変更するとき

1. Skillを足したり、frontmatterを変えたりしたときは、`node scripts/sync-skills.mjs`を実行する
2. コミットの前に、`node scripts/sync-skills.mjs --check`と`node --test tests/*.test.mjs`を通す

CIでもこの2つを実行し、あわせて`claude plugin validate .`と`gh skill publish --dry-run`もかける。

## リリース

1. Actionsの`release`ワークフローを、「Run workflow」で作るバージョン（`v0.1.0`など）を入れて実行する
2. claude.aiに入れたSkillを更新するときは、Claude Codeのクラウドセッションで`node scripts/check-skill-updates.mjs`を実行する。入れ直しが要る`.skill`が`dist/skill-updates/`に置かれる
3. 置かれた`.skill`を、Claudeにセッションへ送ってもらう
4. 届いたファイルのカードの「Save skill」を押す

- `release`ワークフローは、CIと同じ検査を通したあと、`main`の最新のコミットにタグを付け、GitHub Releaseと、Skillごとの`.skill`（`<name>.skill`）をまとめて作る。タグをpushできない環境（クラウドセッションなど）からも使える。不変リリース（immutable releases）を有効にしても、そのまま使える
- `check-skill-updates.mjs`は、claude.aiに入っているSkillと最新のリリースの`.skill`を比べる。このリポジトリで作業するセッションでは、リリースを作り終えたときと、頼まれたときに、Claudeが手順2と3を行う（`CLAUDE.md`、[設計書](design.md)の「claude.aiへの反映」の節）

## 任意

- 手元でリリースを作るときは、`gh skill publish --tag v0.1.0`を実行する。このコマンドは`agent-skills`トピックも付ける。公開すると、`.github/workflows/release-assets.yml`が`.skill`を作ってリリースに添付する
- 不変リリースを有効にしていて、手元でリリースを作るときは、`gh skill publish`で公開したリリースには`.skill`を添付できない。次の順に行う
  1. タグをpushする
  2. そのタグで下書きのリリースを作る
  3. `release-assets`のワークフローを、workflow_dispatchでタグを指定して実行する
  4. リリースを公開する
- `.skill`を手元で作るときは、`node scripts/package-skills.mjs`を実行する（`dist/`に出力する）。frontmatterにclaude.aiのアップロードで拒否されることがあるキー（skill-creatorの検証が許していないキー）があれば、警告を出す

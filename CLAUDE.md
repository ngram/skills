# このリポジトリの保守

Skillを個別にインストールできるように配布するリポジトリ。利用者向けの説明は`README.md`にある。

- Skillは直下の`<name>/SKILL.md`に置く。ディレクトリ名とfrontmatterの`name`を一致させる
- Skillを足したり、frontmatterを変えたりしたら、`node scripts/sync-skills.mjs`を実行する。各SkillのREADMEのインストール手順、`.claude-plugin/marketplace.json`、`README.md`のSkill一覧を生成するので、これらは手で編集しない
- コミットの前に`node scripts/sync-skills.mjs --check`と`node --test tests/*.test.mjs`を通す
- Skillのディレクトリに`bin/`、`hooks/`、`agents/`、`commands/`を作らない。Claude Codeのプラグインの部品として読み込まれる
- テストはSkillのディレクトリではなく`tests/`に置く。Skillのディレクトリの中身は、すべて利用者の環境にコピーされる
- `gh skill install`で入れたコピー（frontmatterに`metadata.github-*`がある）を戻さない。`gh skill publish`がエラーにする
- `japanese-tech-writing/SKILL.md`は、取り込み元のgistの内容に、このリポジトリで足した部分（frontmatterの`compatibility`の行と、末尾のHTMLのコメントより下の節）を加えたもの。取り込み元の行は、frontmatterの`license`（取り込み元の部分と足した部分のライセンスを示す）を除いて変えず、変更は取り込み元に提案する。取り込み元を取り込み直すときは、足した部分を残す。足した部分の検査と修正のスクリプトは`japanese-tech-writing/scripts/fix_spacing.mjs`。足した部分はMIT（`japanese-tech-writing/LICENSE-MIT.txt`）、取り込み元の部分はUnlicense（`japanese-tech-writing/LICENSE.txt`）
- claude.aiで使えないSkill（手元のコマンドを前提にするものなど）は、frontmatterの`metadata`に`claude-ai: unsupported`を書く。リリースに`.skill`とZIPを添付せず、READMEのclaude.aiの節もサポート外の案内になる。今は`plan-review`（手元のcodex CLIが前提）が該当する
- ライセンスはfrontmatterの`license`に書く。MIT以外にするSkillは、ライセンスの本文を`LICENSE.txt`としてSkillのディレクトリに置く。明示していないSkillは、ルートの`LICENSE`（MIT）とする

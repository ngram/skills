# このリポジトリの保守

Skillを個別にインストールできるように配布するリポジトリ。利用者向けの説明は`README.md`にある。

- Skillは直下の`<name>/SKILL.md`に置く。ディレクトリ名とfrontmatterの`name`を一致させる
- Skillを足したり、frontmatterを変えたりしたら、`node scripts/sync-skills.mjs`を実行する。各SkillのREADMEのインストール手順、`.claude-plugin/marketplace.json`、`README.md`のSkill一覧を生成するので、これらは手で編集しない
- コミットの前に`node scripts/sync-skills.mjs --check`と`node --test tests/*.test.mjs`を通す
- Skillのディレクトリに`bin/`、`hooks/`、`agents/`、`commands/`を作らない。Claude Codeのプラグインの部品として読み込まれる
- テストはSkillのディレクトリではなく`tests/`に置く。Skillのディレクトリの中身は、すべて利用者の環境にコピーされる
- `gh skill install`で入れたコピー（frontmatterに`metadata.github-*`がある）を戻さない。`gh skill publish`がエラーにする
- `japanese-tech-writing/SKILL.md`は、取り込み元のgistの内容に、このリポジトリで足した部分（frontmatterの`compatibility`の行と、末尾のHTMLのコメントより下の節）を加えたもの。取り込み元の行は、frontmatterの`license`（取り込み元の部分と足した部分のライセンスを示す）を除いて変えず、変更は取り込み元に提案する。取り込み元を取り込み直すときは、足した部分を残す。足した部分の検査と修正のスクリプトは`japanese-tech-writing/scripts/fix_spacing.mjs`。足した部分はMIT（`japanese-tech-writing/LICENSE-MIT.txt`）、取り込み元の部分はUnlicense（`japanese-tech-writing/LICENSE.txt`）
- claude.aiで使えないSkill（手元のコマンドを前提にするものなど）は、frontmatterの`metadata`に`claude-ai: unsupported`を書く。リリースに`.skill`を添付せず、READMEのclaude.aiの節もサポート外の案内になる。今は`plan-review`（手元のcodex CLIが前提）が該当する
- リリースを作り終えたとき（`release`ワークフローの実行が成功したあと）と、claude.aiのSkillの更新を頼まれたとき（「claude.aiのSkillを更新して」「最新の.skillを出して」など）は、次のことを行う
  - `node scripts/check-skill-updates.mjs`を実行し、最新のリリースの`.skill`とclaude.aiに入っているSkillを比べる
  - 「更新あり」と「未導入」のSkillの`.skill`（`dist/skill-updates/`に置かれる）を、`SendUserFile`で1つずつセッションに送る。ファイルのカードに「Save skill」のボタンが出て、利用者が押すとclaude.aiに入る
  - あわせて、リリースのURLと、Skillごとの結果（同じ、省略など）を短く示す。送るものが無ければ、その旨を伝える
  - リリースを作り終えたときは、先にリリースにSkillごとの`.skill`が添付されていることを確かめる
- ライセンスはfrontmatterの`license`に書く。MIT以外にするSkillは、ライセンスの本文を`LICENSE.txt`としてSkillのディレクトリに置く。明示していないSkillは、ルートの`LICENSE`（MIT）とする

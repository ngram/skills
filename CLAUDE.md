# このリポジトリの保守

Skillを個別にインストールできるように配布するリポジトリ。利用者向けの説明は`README.md`にある。

- Skillは直下の`<name>/SKILL.md`に置く。ディレクトリ名とfrontmatterの`name`を一致させる
- Skillを足したり、frontmatterを変えたりしたら、`node scripts/sync-skills.mjs`を実行する。各SkillのREADMEのインストール手順、`.claude-plugin/marketplace.json`、`README.md`のSkill一覧を生成するので、これらは手で編集しない
- コミットの前に`node scripts/sync-skills.mjs --check`と`node --test tests/*.test.mjs`を通す
- Skillのディレクトリに`bin/`、`hooks/`、`agents/`、`commands/`を作らない。Claude Codeのプラグインの部品として読み込まれる
- テストはSkillのディレクトリではなく`tests/`に置く。Skillのディレクトリの中身は、すべて利用者の環境にコピーされる
- `gh skill install`で入れたコピー（frontmatterに`metadata.github-*`がある）を戻さない。`gh skill publish`がエラーにする
- `japanese-tech-writing/SKILL.md`は取り込み元のgistと同じ内容に保ち、変更は取り込み元に提案する

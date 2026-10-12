# 調査の要約（予算の根拠）

このSkillの予算と構成は、次の調査に基づく。2026年10月に行った。

## GoのOSS 45件のREADME

`scripts/readme_stats.mjs`で計った（地の文は、見出し・コード・表・HTML・画像の行を除いた行。表示幅は全角を2桁とした合計）。

| リポジトリ | 行数 | 地の文 | 表示幅 | H2 | H3 | H4以下 |
|---|---:|---:|---:|---:|---:|---:|
| mattn/goreman | 37 | 10 | 598 | 6 | 0 | 0 |
| mattn/go-isatty | 50 | 5 | 131 | 5 | 0 | 0 |
| golangci/golangci-lint | 66 | 9 | 478 | 7 | 0 | 0 |
| tailscale/tailscale | 87 | 43 | 2,285 | 8 | 0 | 0 |
| goreleaser/goreleaser | 99 | 21 | 932 | 6 | 1 | 0 |
| rakyll/hey | 105 | 19 | 960 | 3 | 1 | 0 |
| restic/restic | 109 | 54 | 2,892 | 4 | 0 | 0 |
| Songmu/ghch | 133 | 15 | 651 | 9 | 5 | 0 |
| uber-go/zap | 149 | 48 | 2,888 | 5 | 0 | 0 |
| mattn/memo | 152 | 22 | 1,055 | 9 | 0 | 0 |
| mattn/twty | 169 | 25 | 1,424 | 7 | 14 | 0 |
| rclone/rclone | 199 | 167 | 5,285 | 5 | 1 | 0 |
| caddyserver/caddy | 225 | 77 | 7,151 | 8 | 4 | 0 |
| gohugoio/hugo | 367 | 93 | 6,451 | 10 | 4 | 0 |
| sirupsen/logrus | 505 | 136 | 8,947 | 0 | 0 | 16 |
| go-chi/chi | 577 | 151 | 10,589 | 10 | 6 | 0 |
| jesseduffield/lazygit | 663 | 177 | 12,508 | 13 | 46 | 3 |
| ngram/temoto | 764 | 253 | 17,030 | 9 | 23 | 17 |
| spf13/viper | 799 | 197 | 8,426 | 8 | 23 | 6 |
| gorilla/mux | 812 | 87 | 8,376 | 4 | 9 | 0 |
| peco/peco | 1,091 | 261 | 28,372 | 23 | 56 | 0 |
| junegunn/fzf | 1,153 | 452 | 20,452 | 16 | 32 | 9 |
| k1LoW/tbls | 1,308 | 215 | 12,096 | 9 | 23 | 6 |

（45件のうち23件を抜き出した。45件の中央値は、行数194、地の文55行、表示幅3,218桁、H2が7個）

読み取れること：

- 大きいプロジェクトほど、READMEを入口に絞り、文書のサイトにリンクしている（golangci-lint、tailscale、goreleaser、restic、caddy）
- 小さいツールは、Install・Usage・License・Authorの最小の構成で、37〜169行に収まる（goreman、hey、ghch、memo、twty）
- 長いREADMEは2つに分かれる。ライブラリのAPIの説明と例を並べたもの（logrus、chi、viper、mux）と、ツールの機能と設定の一覧を並べたもの（lazygit、peco、fzf、tbls）
- temotoは、任意の機能の手順（OCR、トレイ常駐など）とリファレンス（検索構文、環境変数）、データ、セキュリティ、開発の節で約540行（全体の7割）を占める

予算への反映：standardの200行は中央値、smallの120行は小さいツールの範囲、largeの300行は文書のサイトの無い大きめのプロジェクトの上限とした。地の文60行（30%）と表示幅4,800桁は、中央値（55行、3,218桁）に余裕を持たせた値である。

## 指針

- GitHub Docs「About the repository README file」：READMEには、使い始めるのと貢献するのに必要な情報だけを置き、長い文書はwikiに置く（"A README should only contain information necessary for developers to get started using and contributing to your project. Longer documentation is best suited for wikis."）。500KiBを超える部分は表示されない。<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes>
- Google documentation guide「READMEs」「Best practices」：READMEはディレクトリの中身の短い要約である（"A README is a short summary of the contents of a directory."）。Minimum Viable Documentation、Duplication is Evil。<https://google.github.io/styleguide/docguide/READMEs.html>、<https://google.github.io/styleguide/docguide/best_practices.html>
- standard-readme：短い説明は120文字未満、Install・Usage・Licenseは必須、100行以上なら目次を付ける。長い説明は、ページ送りせずに思い出せる量にする（perlmodstyleの引用）。<https://github.com/RichardLitt/standard-readme/blob/main/spec.md>
- Go blog「Testable Examples in Go」：Exampleの関数はパッケージの文書に表示され、テストとして実行して確かめられる。<https://go.dev/blog/examples>

## 似たSkill

- adewale/good-readme（MIT）：作成と改善のモード、採点表、アンチパターン（The Novel、Wall of Text、API Dump）、「Link, don't duplicate」。長さの目安は単純なツールで50〜200行。主眼は実装とのずれで、分量を計る仕組みは無く、日本語も想定していない。<https://github.com/adewale/good-readme>
- 網羅的なREADMEを作る方向のSkill（GLINCKER readme-generatorなど）や、GitHubのプロフィールのREADME向けのSkillは、目的が違う

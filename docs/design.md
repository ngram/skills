# Skill公開の設計

zipを展開した3つのSkillを、1つのGitHubリポジトリ（`ngram/skills`）から、Skillごとに個別にインストールできるように配布するための設計。
配置と生成の仕組みは[mizchi/skills](https://github.com/mizchi/skills)に合わせた。

## 収録したSkill

| Skill | ファイル | 作者・ライセンス | 実行に必要なもの |
|---|---|---|---|
| `git-commit` | `SKILL.md`、`scripts/check_message.mjs`、`assets/gitmessage` | ngram・MIT | git、Node.js 18以降 |
| `japanese-tech-writing` | `SKILL.md`、`scripts/fix_spacing.mjs`、`LICENSE.txt`、`LICENSE-MIT.txt` | keiichiro shikano・Unlicense（ngram/skillsで足した部分はngram・MIT） | なし（スクリプトにはNode.js 18以降） |
| `plan-review` | `SKILL.md` | ngram・MIT | bash、codex CLIかclaude CLI |

`japanese-tech-writing`は、gist（`fd287c3133457c4fd8f5601d34aa817d`）のコミット`8f2d576`の内容に、日本語と英数字の間の空白の節とスクリプトを足したものである（「各Skillに加えた変更」の節）。
zipに入っていたこのgistのクローン（`.git`）は収録していない。

## ライセンス

[mizchi/skills](https://github.com/mizchi/skills#license)と同じく、Skillごとに独自のライセンスを持てるようにし、明示していないSkillはMITとする。

- ルートの`LICENSE`：MIT License（Copyright (c) 2026 ngram）
- `git-commit`と`plan-review`：frontmatterに`license: MIT`
- `japanese-tech-writing`：取り込み元の部分はUnlicense。取り込み元のfrontmatterの`license`が指していたgistに作者が置いた本文を、`japanese-tech-writing/LICENSE.txt`としてそのまま収録した。このリポジトリで足した部分（末尾の節、`scripts/fix_spacing.mjs`、frontmatterの`compatibility`の行）はMITで、本文を`japanese-tech-writing/LICENSE-MIT.txt`に置いた。Skillのディレクトリごと利用者の環境にコピーされるので、どちらの本文も一緒に届く
  - frontmatterの`license`は、両方を示す`Unlicense AND MIT。取り込み元の部分はUnlicense（LICENSE.txt）、ngram/skillsで足した部分はMIT（LICENSE-MIT.txt）`に書き換えた。取り込み元の行のうち、書き換えたのはこの行だけである
  - `scripts/fix_spacing.mjs`の先頭には`SPDX-License-Identifier: MIT`と著作権表示を、`SKILL.md`の足した節の目印のコメントには「MIT License」を書いた

## 個別にインストールする経路

どの経路も、リポジトリ直下の`<name>/SKILL.md`を1つのSkillとして扱う。

| 経路 | 利用者の操作 | リポジトリ側に要るもの |
|---|---|---|
| Claude Code・Claude Desktop（プラグイン） | `/plugin marketplace add ngram/skills`のあと`/plugin install <name>@ngram-skills` | `.claude-plugin/marketplace.json` |
| claude.ai（Cowork・クラウドセッション） | リリースに添付した`<name>.skill`を、セッションのファイルのカードの「Save skill」か、claude.aiのCustomize > Skillsのアップロードで入れる | リリースへの`.skill`の添付（`release.yml`、`release-assets.yml`） |
| GitHub CLI（gh 2.90以降） | `gh skill install ngram/skills <name> --agent claude-code --scope user` | `<name>/SKILL.md`。検索には`agent-skills`トピック、版の固定にはGitHub Release |
| APM（Microsoft Agent Package Manager） | `apm install -g ngram/skills/<name>` | `<name>/SKILL.md` |
| skills CLI（`npx skills`） | `npx skills add ngram/skills --skill <name>` | `<name>/SKILL.md` |
| フォルダのコピー（degit） | `npx degit ngram/skills/<name> ~/.claude/skills/<name>` | `<name>/SKILL.md` |

「apx」は、APM（`apm`）か`npx skills`のことと解釈した。どちらにも対応している。

APMはサブディレクトリのパス（`ngram/skills/<name>`）を指定すると、直下に`SKILL.md`がある1つのSkillとして入れる。
このため、最初の設計で置く予定だったリポジトリ直下の`apm.yml`は不要になった。

claude.aiの個人のSkillを入れる方法は、セッションに送られた`.skill`のファイルのカードの「Save skill」と、画面からのアップロードの2つである。APIでアップロードしたSkill（`/v1/skills`）はclaude.aiでは使えず、クラウドセッションはリポジトリの`.claude/settings.json`で指定したプラグインも読まない。
そこで、skill-creatorの`package_skill.py`が作るのと同じ`.skill`（中身はSkillのディレクトリをルートに置いたZIP）をリリースに添付する。届け方は「claude.aiへの反映」の節にある。

ZIPは添付しない。理由は次のとおり。

- 「Save skill」のボタンで入れる流れは`.skill`を使う。skill-creatorの説明に「The presented `.skill` (or bare `SKILL.md`) file card shows a **Save skill** button」とある
- 画面からのアップロードは、公式のヘルプ（[Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)）ではZIPと書かれていて、`.skill`には触れていない。ただし`.skill`の中身はZIPそのものなので、画面で`.skill`を選べなくても、拡張子を`.zip`に変えれば同じものになる
- v0.1.0とv0.1.1のリリースに添付したZIPは、そのまま残す

## リポジトリの構成

```
.
├── .claude-plugin/
│   └── marketplace.json        生成する。Claude Code・Claude Desktop向けのカタログ
├── git-commit/
│   ├── SKILL.md
│   ├── README.md               インストール手順のブロックを生成する
│   ├── scripts/check_message.mjs
│   └── assets/gitmessage
├── japanese-tech-writing/
│   ├── SKILL.md                取り込み元のgistの行は変えず、末尾に節を足す
│   ├── scripts/fix_spacing.mjs 日本語と英数字の間の空白の検査と修正
│   └── README.md               生成するブロックの後に、手書きの出典を置く
├── plan-review/
│   ├── SKILL.md
│   └── README.md
├── scripts/sync-skills.mjs     生成と検査のスクリプト
├── scripts/package-skills.mjs  claude.ai向けのSkillごとの.skillを作るスクリプト
├── scripts/check-skill-updates.mjs  claude.aiに入っているSkillと最新のリリースの.skillを比べるスクリプト
├── tests/check_message.test.mjs
├── tests/fix_spacing.test.mjs
├── tests/package-skills.test.mjs
├── tests/check-skill-updates.test.mjs
├── docs/design.md              この設計書
├── docs/development.md         開発とリリースの手順。READMEの「開発」の節からリンクする
├── .github/workflows/skills.yml
├── .github/workflows/release.yml  版を指定してタグ、リリース、.skillを作る
├── .github/workflows/release-assets.yml  公開したリリースにSkillごとの.skillを添付する
├── .gitattributes              * text=auto eol=lf
├── .gitignore
├── CLAUDE.md                   保守の決まり
└── README.md                   経路ごとの導入手順と、生成するSkill一覧
```

- Skillのディレクトリの中身は、どの経路でもすべて利用者の環境にコピーされる。テストはSkillのディレクトリではなく`tests/`に置く
- `.gitattributes`で改行をLFにそろえる。Windowsで編集しても、リポジトリにはLFで入る

## 生成するファイル

`node scripts/sync-skills.mjs`が、各Skillのfrontmatter（`name`、`description`、`compatibility`、`license`）から次のファイルを生成する。

- `<name>/README.md`のインストール手順：マーカーで囲んだブロックだけを書き換え、ブロックの外の手書きの部分は残す
- `.claude-plugin/marketplace.json`：Skillごとに1つのプラグインの項目
- `README.md`のSkill一覧：マーカーで囲んだ表。ライセンスの列では、`license`に書いたファイル名（`LICENSE.txt`など）をSkillのディレクトリのファイルへのリンクにし、ファイルを書いていない`MIT`はルートの`LICENSE`へのリンクにする

`--check`を付けると書き込まずに比べ、ずれがあれば終了コード1で終わる。あわせて次の点も検査する。

- `name`とディレクトリ名の一致と、Agent Skills仕様の命名規則
- `description`の長さ（1024文字以内）と`compatibility`の長さ（500文字以内）
- `description`に山括弧（`<`か`>`）が無いか。skill-creatorの`quick_validate.py`と同じ規則で、claude.aiは山括弧を含むSkillを、エラーを出さずに保存しない（v0.2.2の`plan-create`で起きた）
- `description`の最初の文と`compatibility`が体言止めか。どちらもSkill一覧の表のセルになる（`japanese-tech-writing`の「表のセルの書き方」）。判定は`git-commit`の`check_message.mjs`と同じで、表とマーケットプレイスには、最初の文を末尾の句点を除いて入れる
- `license`に書いたファイル（`LICENSE.txt`など）が、Skillのディレクトリにあるか
- `SKILL.md`に、ドル記号に数字が続く形（シェルの位置引数と同じ形）が無いか。Claude Codeは、Skillの本文の`$ARGUMENTS`とこの形を、渡した引数で置き換える。`plan-review`の引数を読むループの位置引数が、引数の値に置き換わったことから足した。波括弧で囲んだ形は置き換わらない
- リポジトリのすべてのテキストファイルで、改行がLFか、見えない文字（BOM、ゼロ幅文字、双方向制御文字）が無いか
- Claude Codeがプラグインの部品として読むディレクトリ（`bin/`、`hooks/`、`agents/`、`commands/`）が無いか
- `gh skill install`が書き込む`metadata.github-*`が残っていないか

## Claude Code向けの定義

生成される`marketplace.json`の項目は次の形になる。

```json
{ "name": "git-commit", "source": "./git-commit", "description": "Git のステージング、日本語のコミットメッセージ案とプルリクエストのタイトル・本文の作成、コミットの手順と書式。" }
```

- `source`でSkillのディレクトリを直接指す。直下に`SKILL.md`があり`skills/`の無いプラグインは、1つのSkillとして読み込まれる。`plugin.json`は置かない
- `description`は、Skillの説明文の最初の文にする
- `version`は書かない。gitで配布するマーケットプレイスでは、コミットごとに新しい版として扱われる
- プラグインのSkillは`/<プラグイン名>:<Skill名>`で呼び出すので、`/plan-review:plan-review`になる。`/plan-review`で呼びたい利用者は、gh skill、APM、skills CLIのどれかで`~/.claude/skills/`に入れる

## 各Skillに加えた変更

### git-commit

- frontmatterへの`compatibility: gitとNode.js 18以降が必要`の追加
- `${CLAUDE_SKILL_DIR}`の初出への一文の追加：「このSKILL.mdのあるディレクトリを指す。Claude Code以外で展開されないときは、そのディレクトリのパスに置き換える」
- `japanese-tech-writing`での点検を「入っていれば」に変更。入っていなくても、元の手順で「特に」として挙げていた2点は見る
- `check_message.mjs`の正規表現に生の文字で入っていたBOM（U+FEFF）の、エスケープ（`/^\uFEFF/`）への書き換え。動作は同じで、APMの「hidden characters」の警告が消えた
- プルリクエストのタイトルと本文の手順と書式（「5. プルリクエストのタイトルと本文を作る」と「書式」の「プルリクエスト」の節）の追加。コミットメッセージと同じ箇条書きで書く
- `check_message.mjs`への、1行目と箇条書きの体言止めの検査と、本文の段落と表の検査の追加。語の終わりの形（「〜する」「〜が無い」など）で判断する目安で、このリポジトリの過去のコミットメッセージでは、指摘はすべて体言止めでない行に当たった
- 箇条書きの終え方の、変更や作業は体言止め、事実や状態は常体の用言止めへの変更。すべての項目に体言止めを求めると、「〜で使えない状態」のように、述語の後ろに「状態」を足した項目が増えたため。`check_message.mjs`は、体言止めを1行目だけに求め、箇条書きでは、述語の後ろに足した「状態」と、です・ます調を指摘する。`readme-writing`のREADMEの箇条書きも同じ規則にし、`readme_stats.mjs`も同じ形を指摘する（表のセルは体言止めのまま）
- 「問題」の節の、問題（何が起きていて、何が困るか）と、一段下げた原因（「〜が原因」）への分け方の追加。起きていることだけを並べると、何が困るのかと、どれが原因なのかが読み取れなかったため。`check_message.mjs`は、「問題」の節の一段下げた項目が「〜が原因」で終わっているかを見る
- 問題が2つ以上あるときの、問題のラベル（`A: `、`B: `…）と、「対応」の節のラベルごとの小見出し（`### A: <見出し>`、共通の対応は`### A・B: <見出し>`、どの問題にも当たらない変更は`### その他の変更`）の追加。「対応」の項目が、どの問題への対応なのかを読み取れなかったため。「テスト」と「影響」の節はラベルで分けない。`check_message.mjs`は、ラベルが上から順に付いているか、小見出しが定義したラベルを指しているか、どの問題にも小見出しがあるかを見る。ラベルの`: `の後ろの空白は、全角文字との間の空白の検査から外す

### plan-review

- frontmatterへの`compatibility`の追加（Claude Code向けで、引数の置換と`disable-model-invocation`を使い、bashと、codex CLIかclaude CLIが要る）
- 説明文の「ユーザーが /plan-review と明示的に指示したときだけ使う」は残した。`disable-model-invocation`を解さないホストでも、自動で呼ばれにくくなる
- レビューする側を、Codex（`codex exec -s read-only`）とClaude（`claude -p --tools "Read,Grep,Glob" --restricted --strict-mcp-config --no-session-persistence`）から選べるようにした。選ぶ順は、引数`--reviewer`、環境変数`PLAN_REVIEW_REVIEWER`、既定の`auto`（`codex`にログイン済みならCodex、そうでなければClaude）。Codexの無いクラウドセッションでも使うためで、Claudeも、Planを書いたセッションとは文脈を共有しない別のプロセスでレビューする
  - Claudeには、読むツール（Read、Grep、Glob）だけを渡す。Codexの`-s read-only`と同じく、Planの記述をリポジトリと照らし合わせられる。ツールを1つも渡さない（`--tools ""`）と、モデルがツールを呼ぼうとしたときに終了コード1で失敗することがあった
  - `--tools`が絞るのは組み込みのツールだけなので、`--restricted`（利用者とプロジェクトの設定ファイルを読まず、ファイルのツールを作業ディレクトリの中に限る）と`--strict-mcp-config`（MCPサーバーを読み込まない）も付ける。Claude Code 2.1.302で、リポジトリの中のファイルは読めて、外のファイルは拒否されることを確かめた
  - 応答は一時ファイルに書き、0で終わり空でないときだけ`rNN_review.md`にする。0以外で終わったときは、応答をレビュー結果として扱わず、実行ログに移す。`claude -p`はエラーの文も標準出力に書き、途中で止まると途中までの応答が残るため
  - 履歴のファイル名を`rNN_review.md`と`rNN_review.log`にした。前の回の応答は、応答の無い回を飛ばしてさかのぼって探し、前の版の`rNN_codex.md`も読む
  - Claudeを`--restricted`で呼ぶので、`apiKeyHelper`など、利用者の設定ファイルで認証している環境では失敗するおそれがある（確かめていない）。SKILL.mdに、そのときの代わりの方法を書いた。クラウドセッションでは動く
  - やり直しは、`ROUND`を1つ増やした新しい回で行う。同じ回で実行し直すと、失敗した回の実行ログが上書きされるため
  - `--reviewer codex`で明示したときは、`codex login status`が失敗しても中断せず、注意を出す。環境変数のAPIキーだけでCodexを使っているときに、ログインの確かめだけが失敗することがあるため
  - モデルと推論の強さの環境変数を、`PLAN_REVIEW_CODEX_*`と`PLAN_REVIEW_CLAUDE_*`に分けた。前の版の`PLAN_REVIEW_MODEL`と`PLAN_REVIEW_EFFORT`は読まない。Claudeの既定は`opus`と`high`
  - Codexの既定を、CLIの既定から`gpt-6.1-sol`と`high`に変えた。CLIの既定に任せると、CLIが古いと古いモデルになり、推論の強さも`gpt-6.1-sol`の既定の`low`になるため。`gpt-6.1-sol`は、Codex CLI 0.164.0に同梱のモデルの一覧で、優先度が最も高い（既定の）モデルである
  - Windowsでは、Codexのサンドボックスを既定で`unelevated`にした（`PLAN_REVIEW_CODEX_WINDOWS_SANDBOX`、`config`で`config.toml`に従う）。`elevated`では、Codexのデスクトップアプリが動いていると、コマンドを起動する前の準備（setup refresh）が「別のプロセスが使用中」で失敗し、Codexがリポジトリを読めないまま終了コード0で応答を返した（Windows 11、Codex CLI 0.162.1で、利用者が確かめた）。`unelevated`でも`-s read-only`の書き込みの禁止が保たれることも、利用者が確かめた。まず`config.toml`に従い、失敗したら`unelevated`でやり直す方式は、失敗する環境では毎回レビューの時間が倍になるので採らなかった
  - Codexがコマンドを起動できなかった跡（`ERROR … error=exec_command failed`か`Failed to create unified exec process`で始まる行）が実行ログにあれば、判定を`UNVERIFIED`にして、ユーザーに確かめる。Codexは`helper_unknown_error`のほかにも`helper_*`の失敗の種類を持つので、種類ではなく、この2つの行の書き出しで見る。Codexは実行ログにプロンプトも書くので、プロンプトと同じ行は除いて探す。自動ではやり直さない。同じ設定でやり直しても、同じく失敗するため
  - プロンプトの出力形式に`VERDICT: UNVERIFIED`を足し、ツールのエラーでリポジトリを読めなかったときは、レビューする側がそう書くようにした。Claudeの読むツール（Read、Grep、Glob）はCodexのサンドボックスを通らないので、Claudeでは実行ログを探さず、この行だけで見る（Windowsでは確かめていない）
- 前の版ではclaude.aiのサポート外（`metadata`の`claude-ai: unsupported`）だったが、その印を外した。claude.aiに入れると、クラウドセッションに同期され、`/anthropic-skills:plan-review`で呼べる。claude.aiのチャットでは、Bashと`codex`・`claude`のコマンドが無いので動かない（`compatibility`に書いた）

### japanese-tech-writing

- 取り込み元の行は、frontmatterの`license`を除いて変えていない（「ライセンス」の節）。出典は`japanese-tech-writing/README.md`の手書きの部分に書いた
- 末尾への「日本語と英数字の間の空白」の節の追加。`git-commit`はtextlintの自動修正（`ja-space-between-half-and-full-width`、`ja-space-around-code`）と`check_message.mjs`で日本語と英数字の間の空白を除いていたが、このSkillには無かった。textlintの設定が無いプロジェクトでも働くように、空白を除くスクリプト`scripts/fix_spacing.mjs`を添えた
  - `--fix`で除くのは、全角文字と英数字の間と、全角文字とインラインコードの間の空白。記号で始まる（または終わる）語の前後は、`check_message.mjs`と同じく場所を示すだけにした（取ると読みにくいときは括弧で示すため）
  - frontmatter、コードブロック、インラインコードの中、URLの前後、行頭の書式の記号の後ろ、表の区切りと強調の記号とHTMLのコメントの区切りの隣は変えない。空白を除くとMarkdownの解釈やURLの範囲が変わるため
  - 全角文字の判定表は`check_message.mjs`の写しを持つ。Skillは1つずつ入れられるので、隣のSkillのファイルは参照できない
  - 全角の絵文字と記号（U+2300〜U+2BFF、U+1F000〜U+1FAFF）は日本語として扱わない。「🤖 Generated」のような空白を除かないため
- 末尾への「見出しと用語の逐語訳」と「手順の書き方」の節の追加（HTMLのコメントの下、「日本語と英数字の間の空白」の節の前）。`readme-writing`でこのリポジトリのREADMEを見直したときに、英語の用語を語ごとに訳した見出し（「版の固定」）と、決まり・必須の手順・任意の手順が混ざった「開発」の節が直らなかったことから足した。日本語の技術文書に一般に当てはまるので、`japanese-tech-writing`を参照するSkill（`git-commit`、`plan-create`、`readme-writing`）のすべてで使えるよう、ここに置いた
- 末尾への「表のセルの書き方」の節の追加（「手順の書き方」の節の後ろ）。READMEのSkill一覧の表で、説明の列に体言止めのセルと動詞で終わるセルが混ざり、末尾の句点の有無も「必要なもの」の列と食い違っていたことから足した。表のセルの書き方は日本語の技術文書に一般に当てはまるので、`readme-writing`ではなく、ここに置いた
- frontmatterへの`compatibility`の追加（スクリプトにNode.js 18以降が要る）

## frontmatterの扱い

- Claude Code独自のフィールド（`argument-hint`、`disable-model-invocation`）は残す。`gh skill publish`もAPMも、これを理由に拒否しない
- Agent Skills仕様の参照実装（`skills-ref validate`）は仕様外のフィールドをエラーにするので、検証には使わない
- 説明文が日本語なので、APMは「non-ASCII」と警告することがある。警告だけで、導入はできる
- `gh skill install`は導入先のfrontmatterを書き直す（キーの並べ替えと`metadata.github-*`の追加）。導入したコピーをこのリポジトリに戻すと`gh skill publish`がエラーにするので、編集は原本で行う

## 版とリリース

- 版はリポジトリ全体で1つのsemverのタグにする（`v0.1.0`から）
- リリースは、`.github/workflows/release.yml`をworkflow_dispatchで版を指定して実行して作る。版の形（`v0.1.0`）、実行したブランチが`main`であること、同じタグが無いことを確かめ、CIと同じ検査（`claude plugin validate .`と`gh skill publish --dry-run`を含む）を通してから、`gh release create`でタグ、GitHub Release、Skillごとの`.skill`を作る
  - タグをpushできない環境（クラウドセッションなど）からもリリースを作れるように、タグの作成をGitHub Actionsの中で行う
  - `gh release create`はファイルを下書きのリリースに添付してから公開するので、不変リリース（immutable releases）を有効にしても動く
  - GITHUB_TOKENで作ったリリースは他のワークフローを起動しないので、`release-assets.yml`は動かない。`.skill`は`release.yml`が添付する
  - `gh skill publish`と違い、`agent-skills`トピックは付けず、不変リリースの有効化も提案しない。どちらもリポジトリの設定から一度だけ行う
- 手元の`gh skill publish --tag v0.1.0`でも作れる。このコマンドが検証、`agent-skills`トピックの追加、GitHub Releaseの作成を行い、不変リリースの有効化も提案する
- 利用者は、gh skillでは`<name>@v0.1.0`、APMでは`ngram/skills/<name>#v0.1.0`、Claude Codeでは`/plugin marketplace add ngram/skills@v0.1.0`で版を固定できる。claude.aiでは、そのタグのリリースに添付した`<name>.skill`をアップロードする
- `.skill`は`scripts/package-skills.mjs`が`git archive`（ZIPの形式）で作るので、gitが管理しているファイルだけが入り、ルートにSkillのディレクトリが1つ置かれる（claude.aiはこの形を求める）。ファイル名を`<name>.skill`に固定したので、`https://github.com/ngram/skills/releases/latest/download/<name>.skill`が常に最新版を指す
- frontmatterの`metadata`に`claude-ai: unsupported`があるSkillは、claude.aiのサポート外として`.skill`を作らない。`sync-skills.mjs`も同じ印を見て、そのSkillのREADMEのclaude.aiの節をサポート外の案内にする。印をSkillのfrontmatterに置くのは、二つのスクリプトが同じところから判断でき、Skillを移しても印が一緒に移るためである。`metadata`はAgent Skillsの仕様が独自の情報のために用意した項目なので、ほかのツールの検証にもかからない
- `package-skills.mjs`は、claude.aiのサポート外ではないSkillのfrontmatterに、skill-creatorの検証（`quick_validate.py`）が許していないキーがあると警告する。許すのは`quick_validate.py`の6つ（`name`、`description`、`license`、`allowed-tools`、`metadata`、`compatibility`）と、claude.aiに保存できると確かめた2つ（`argument-hint`、`disable-model-invocation`）で、ほかのキーがあるとclaude.aiへのアップロードで拒否されることがある。GitHub Actionsの中では、警告を実行結果の注釈として出す
  - Claude Code向けの`argument-hint`と`disable-model-invocation`は、警告の対象から外した。`quick_validate.py`は許さないが、この2つを持つ`plan-review`の`.skill`をclaude.aiに保存でき、クラウドセッションに同期された写しにも残ることを確かめた
- `gh skill publish`などでリリースを公開すると、`.github/workflows/release-assets.yml`がタグの内容から`.skill`を作って添付する。作るためのスクリプトは既定のブランチの最新のものを使うので、古いタグのリリースにも、workflow_dispatchでタグを指定して実行すれば今の形式のファイルを後から添付できる。不変リリースを有効にしていると公開後には添付できないので、その場合はタグをpushして下書きのリリースを作り、`release-assets`をworkflow_dispatchでタグを指定して実行してから公開する

## claude.aiへの反映

GitHubのリリースをclaude.aiに知らせる仕組みも、自動で入れ直す仕組みも無い。そこで、Claude Codeのクラウドセッションで最新のリリースと見比べ、入れ直しが要る`.skill`だけをセッションに送る。利用者の操作は、届いたファイルのカードの「Save skill」を押すことだけになる。

自動では行わず、次のときにセッションの中で行う。手順は`CLAUDE.md`に書いたので、このリポジトリで作業するセッションのClaudeが行う。

- 利用者に頼まれたとき（「claude.aiのSkillを更新して」「最新の.skillを出して」など）
- Claudeがセッションの中でリリースを作ったとき（`release`ワークフローの実行が成功したあと）

手順は次のとおり。

1. `node scripts/check-skill-updates.mjs`を実行する
   - 最新の版（`v`で始まるタグのうち最新のもの）のリリースから`<name>.skill`をダウンロードする（`.skill`の無い古い版では`<name>.zip`を使う）
   - claude.aiの写し（`~/.claude/skills/synced/<id>/<name>/`）と中身を比べ、Skillごとに「同じ」「更新あり」「未導入」「省略」（claude.aiのサポート外）「確かめられない」のどれかを出す
   - claude.aiは取り込むときに`name`を引用符で囲むことがあるので、frontmatterの値の引用符の有無は比べない。`README.md`は利用者向けの説明でClaudeの動作には使わないので比べない
   - 「更新あり」と「未導入」のSkillの`.skill`だけを`dist/skill-updates/`に置く
2. Claudeが置かれた`.skill`をセッションに送り（`SendUserFile`）、リリースのURLもあわせて示す。ファイルのカードに「Save skill」のボタンが出る。送るものが無ければ、その旨を伝える
3. ボタンを押すとclaude.aiのSkillが入れ替わり、Claude Codeのセッションにはセッションの開始時と、その後およそ10分ごとに同期される（公式のヘルプによる）

リリースのたびに自動で行いたくなったときは、Routineを使える。RoutineはGitHubの「Release」のイベントをきっかけに動けるが、イベントごとに新しいクラウドセッションが作られ、既存のセッションには書き込めない。

## CI

pushとプルリクエストで`.github/workflows/skills.yml`が次を実行する。

- `node scripts/sync-skills.mjs --check`
- `node --test tests/*.test.mjs`（`check_message.mjs`、`fix_spacing.mjs`、`scan.mjs`、`package-skills.mjs`、`check-skill-updates.mjs`の動作確認）
- `claude plugin validate .`
- `gh skill publish --dry-run`

## 確かめたこと

ローカルの作業ツリーから、経路ごとに別の作業ディレクトリへ1つずつ入れて確かめた。

- Claude Code 2.1.293：`claude plugin validate . --strict`が通過した。隔離した設定ディレクトリで3つのプラグインを入れ、`claude plugin details`でSkillが1つずつ読み込まれていた
- gh 2.102.0：`gh skill publish --dry-run`はエラーなし。警告は`git-commit`と`plan-review`の`license`の欠落と、タグの保護ルールが無いことだけだった。`gh skill install --from-local`で3つを1つずつ入れ、`SKILL.md`のfrontmatter以外は原本と一致した
- skills CLI 1.7.1：`--list`で3つを認識し、`--skill git-commit --copy`で入れたファイルは原本と一致した
- APM 0.33.0：`apm install <パス>/plan-review`、`<パス>/git-commit`、`apm install -g <パス>/git-commit`のどれでも、原本と一致するファイルが`.claude/skills/`に入った
- `scripts/sync-skills.mjs --check`：nameの不一致、CRLF、`hooks/`の追加、生成物のずれを壊したコピーで検出した

ライセンスを付けた後は、`gh skill publish --dry-run`の`license`の警告が消え、残る警告はタグの保護ルールが無いことだけになった。

## 決めてほしいこと

1. 「apx」が上の解釈（APMか`npx skills`）で合っているか

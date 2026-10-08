# Skill公開の設計

zipを展開した3つのSkillを、1つのGitHubリポジトリ（`ngram/skills`）から、Skillごとに個別にインストールできるように配布するための設計。
配置と生成の仕組みは[mizchi/skills](https://github.com/mizchi/skills)に合わせた。

## 収録したSkill

| Skill | ファイル | 作者・ライセンス | 実行に必要なもの |
|---|---|---|---|
| `git-commit` | `SKILL.md`、`scripts/check_message.mjs`、`assets/gitmessage` | ngram・未設定 | git、Node.js 18以降 |
| `japanese-tech-writing` | `SKILL.md` | keiichiro shikano・Unlicense | なし |
| `plan-review` | `SKILL.md` | ngram・未設定 | bash、codex CLI |

`japanese-tech-writing`は、gist（`fd287c3133457c4fd8f5601d34aa817d`）のコミット`8f2d576`と同じ内容である（改行だけLFにそろえた）。
zipに入っていたこのgistのクローン（`.git`）は収録していない。

## 個別にインストールする経路

どの経路も、リポジトリ直下の`<name>/SKILL.md`を1つのSkillとして扱う。

| 経路 | 利用者の操作 | リポジトリ側に要るもの |
|---|---|---|
| Claude Code・Claude Desktop（プラグイン） | `/plugin marketplace add ngram/skills`のあと`/plugin install <name>@ngram-skills` | `.claude-plugin/marketplace.json` |
| GitHub CLI（gh 2.90以降） | `gh skill install ngram/skills <name> --agent claude-code --scope user` | `<name>/SKILL.md`。検索には`agent-skills`トピック、版の固定にはGitHub Release |
| APM（Microsoft Agent Package Manager） | `apm install -g ngram/skills/<name>` | `<name>/SKILL.md` |
| skills CLI（`npx skills`） | `npx skills add ngram/skills --skill <name>` | `<name>/SKILL.md` |
| フォルダのコピー（degit） | `npx degit ngram/skills/<name> ~/.claude/skills/<name>` | `<name>/SKILL.md` |

「apx」は、APM（`apm`）か`npx skills`のことと解釈した。どちらにも対応している。

APMはサブディレクトリのパス（`ngram/skills/<name>`）を指定すると、直下に`SKILL.md`がある1つのSkillとして入れる。
このため、最初の設計で置く予定だったリポジトリ直下の`apm.yml`は不要になった。

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
│   ├── SKILL.md                取り込み元のgistと同一に保つ
│   └── README.md               生成するブロックの後に、手書きの出典を置く
├── plan-review/
│   ├── SKILL.md
│   └── README.md
├── scripts/sync-skills.mjs     生成と検査のスクリプト
├── tests/check_message.test.mjs
├── .github/workflows/skills.yml
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
- `README.md`のSkill一覧：マーカーで囲んだ表

`--check`を付けると書き込まずに比べ、ずれがあれば終了コード1で終わる。あわせて次の点も検査する。

- `name`とディレクトリ名の一致と、Agent Skills仕様の命名規則
- `description`の長さ（1024文字以内）と`compatibility`の長さ（500文字以内）
- リポジトリのすべてのテキストファイルで、改行がLFか、見えない文字（BOM、ゼロ幅文字、双方向制御文字）が無いか
- Claude Codeがプラグインの部品として読むディレクトリ（`bin/`、`hooks/`、`agents/`、`commands/`）が無いか
- `gh skill install`が書き込む`metadata.github-*`が残っていないか

## Claude Code向けの定義

生成される`marketplace.json`の項目は次の形になる。

```json
{ "name": "git-commit", "source": "./git-commit", "description": "Git のステージング、日本語のコミットメッセージ案の作成、コミットの手順と書式。" }
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

### plan-review

- frontmatterへの`compatibility: Claude Code向け（引数の置換とdisable-model-invocationを使う）。bashとcodex CLIが必要`の追加
- 説明文の「ユーザーが /plan-review と明示的に指示したときだけ使う」は残した。`disable-model-invocation`を解さないホストでも、自動で呼ばれにくくなる

### japanese-tech-writing

- `SKILL.md`は変えていない。出典は`japanese-tech-writing/README.md`の手書きの部分に書いた

## frontmatterの扱い

- Claude Code独自のフィールド（`argument-hint`、`disable-model-invocation`）は残す。`gh skill publish`もAPMも、これを理由に拒否しない
- Agent Skills仕様の参照実装（`skills-ref validate`）は仕様外のフィールドをエラーにするので、検証には使わない
- 説明文が日本語なので、APMは「non-ASCII」と警告することがある。警告だけで、導入はできる
- `gh skill install`は導入先のfrontmatterを書き直す（キーの並べ替えと`metadata.github-*`の追加）。導入したコピーをこのリポジトリに戻すと`gh skill publish`がエラーにするので、編集は原本で行う

## 版とリリース

- 版はリポジトリ全体で1つのsemverのタグにする（`v0.1.0`から）
- リリースは`gh skill publish --tag v0.1.0`で作る。このコマンドが検証、`agent-skills`トピックの追加、GitHub Releaseの作成を行い、不変リリース（immutable releases）の有効化も提案する
- 利用者は、gh skillでは`<name>@v0.1.0`、APMでは`ngram/skills/<name>#v0.1.0`、Claude Codeでは`/plugin marketplace add ngram/skills@v0.1.0`で版を固定できる

## CI

pushとプルリクエストで`.github/workflows/skills.yml`が次を実行する。

- `node scripts/sync-skills.mjs --check`
- `node --test tests/*.test.mjs`（`check_message.mjs`の動作確認）
- `claude plugin validate .`
- `gh skill publish --dry-run`

## 確かめたこと

ローカルの作業ツリーから、経路ごとに別の作業ディレクトリへ1つずつ入れて確かめた。

- Claude Code 2.1.293：`claude plugin validate . --strict`が通過した。隔離した設定ディレクトリで3つのプラグインを入れ、`claude plugin details`でSkillが1つずつ読み込まれていた
- gh 2.102.0：`gh skill publish --dry-run`はエラーなし。警告は`git-commit`と`plan-review`の`license`の欠落と、タグの保護ルールが無いことだけだった。`gh skill install --from-local`で3つを1つずつ入れ、`SKILL.md`のfrontmatter以外は原本と一致した
- skills CLI 1.7.1：`--list`で3つを認識し、`--skill git-commit --copy`で入れたファイルは原本と一致した
- APM 0.33.0：`apm install <パス>/plan-review`、`<パス>/git-commit`、`apm install -g <パス>/git-commit`のどれでも、原本と一致するファイルが`.claude/skills/`に入った
- `scripts/sync-skills.mjs --check`：nameの不一致、CRLF、`hooks/`の追加、生成物のずれを壊したコピーで検出した

## 決めてほしいこと

1. `git-commit`と`plan-review`のライセンス（MIT、Unlicense、Apache-2.0など）。決まったらfrontmatterに`license`を足し、`LICENSE`を置く
2. 「apx」が上の解釈（APMか`npx skills`）で合っているか

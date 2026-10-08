# Skill公開の設計

zipを展開した3つのSkillを、1つのGitHubリポジトリ（`ngram/skills`）から複数の経路で配布するための設計。

## 展開した内容

| Skill | ファイル | 作者・ライセンス | 実行に必要なもの |
|---|---|---|---|
| `git-commit` | `SKILL.md`、`scripts/check_message.mjs`、`assets/gitmessage` | ngram・未設定 | git、Node.js 18以降 |
| `japanese-tech-writing` | `SKILL.md` | keiichiro shikano・Unlicense | なし |
| `plan-review` | `SKILL.md` | ngram・未設定 | bash、codex CLI |

公開の前に直す点は次のとおり。

- `git-commit`と`plan-review`には`license`が無い。`gh skill publish`が警告する
- `git-commit`の`${CLAUDE_SKILL_DIR}`は、Claude Code以外のホストでは展開されない
- `git-commit/scripts/check_message.mjs`の正規表現に、BOM（U+FEFF）が生の文字で入っている。APMが「hidden characters」と警告する
- `plan-review`の`disable-model-invocation`、`argument-hint`、`$ARGUMENTS`は、Claude Code独自の仕組みである
- 改行がCRLFのファイル（`japanese-tech-writing/SKILL.md`）と、CRLFとLFが混ざったファイル（`check_message.mjs`）がある
- `japanese-tech-writing`は他者の著作物で、gist（`fd287c3133457c4fd8f5601d34aa817d`）のコミット`8f2d576`と、改行以外は同一である。zipに入っていたこのgistのクローン（`.git`）は公開物に含めない

## 対応する配布経路

どの経路も`skills/<name>/SKILL.md`という配置（Agent Skills仕様の慣例）を読むので、この配置を共通の土台にする。

| 経路 | 利用者の操作 | リポジトリ側に要るもの |
|---|---|---|
| Claude Code・Claude Desktop（プラグインのマーケットプレイス） | `/plugin marketplace add ngram/skills`のあと`/plugin install git-commit@ngram-skills` | `.claude-plugin/marketplace.json` |
| `gh skill`（GitHub CLI 2.90以降。Copilot、Claude Code、Codex、Cursor、Gemini CLIなど） | `gh skill install ngram/skills git-commit --agent claude-code --scope user` | `skills/<name>/SKILL.md`。検索には`agent-skills`トピック、版の固定にはGitHub Release |
| APM（Microsoft Agent Package Manager、`apm`） | `apm install ngram/skills --skill git-commit` | `skills/<name>/SKILL.md`と、直下の`apm.yml`（「試作で確かめたこと」の節） |
| `npx skills`（skills.sh） | `npx skills add ngram/skills --skill git-commit` | `skills/<name>/SKILL.md` |

「apx」は、APM（`apm`）か`npx skills`のことと解釈した。どちらも上の配置で対応できる。
同名の`apx`（agentprojectcontext）はエージェントの実行環境で、Skillの導入には`npx skills`を使うので、これも同じ配置で足りる。

claude.aiの画面からzipでアップロードする経路もある。
ローカルのリポジトリを前提にしないのは`japanese-tech-writing`だけなので、必要になったらGitHub Releaseにzipを添付する形で足す。

## リポジトリの構成

```
.
├── .claude-plugin/
│   └── marketplace.json      Claude Code・Claude Desktop向けのカタログ
├── skills/
│   ├── git-commit/
│   │   ├── SKILL.md
│   │   ├── scripts/check_message.mjs
│   │   └── assets/gitmessage
│   ├── japanese-tech-writing/
│   │   └── SKILL.md          上流のgistと同一内容に保つ
│   └── plan-review/
│       └── SKILL.md
├── apm.yml                   APM向けのメタデータ（依存は書かない）
├── .github/workflows/validate.yml
├── .gitattributes            * text=auto eol=lf
├── .gitignore
├── LICENSE
└── README.md                 経路ごとの導入手順と出典
```

- Skillの中身は`skills/`の下だけに置き、配布の定義（`marketplace.json`、`apm.yml`）はリポジトリ直下に置く。経路を足しても`skills/`は変わらない
- `.gitattributes`で改行をLFにそろえる。Windowsで編集しても、リポジトリにはLFで入る

## Claude Code向けの定義

```json
{
  "name": "ngram-skills",
  "description": "日本語の技術文書とGitの作業手順のSkill",
  "owner": { "name": "ngram" },
  "plugins": [
    { "name": "git-commit", "source": "./skills/git-commit", "description": "日本語のコミットメッセージ案の作成とコミットの手順" },
    { "name": "japanese-tech-writing", "source": "./skills/japanese-tech-writing", "description": "日本語の技術文書の文章規範" },
    { "name": "plan-review", "source": "./skills/plan-review", "description": "PlanファイルのCodexによるレビューと履歴の蓄積" }
  ]
}
```

- Skillごとに1つのプラグインにする。`gh skill`や`npx skills`と同じく、利用者が必要なSkillだけを選べる
- `source`でSkillのディレクトリを直接指す。直下に`SKILL.md`があり`skills/`の無いプラグインは、1つのSkillとして読み込まれる。`plugin.json`は置かない
- 上の理由で、Skillのディレクトリに`bin/`、`hooks/`、`agents/`、`commands/`を作らない。プラグインの部品として読み込まれる
- `version`は書かない。gitで配布するマーケットプレイスでは、コミットごとに新しい版として扱われる。版を固定したい利用者は`/plugin marketplace add ngram/skills@v0.1.0`のようにタグを指定する
- プラグインのSkillは`/<プラグイン名>:<Skill名>`で呼び出すので、`/plan-review:plan-review`になる。`/plan-review`で呼びたい利用者は、`gh skill install`で`~/.claude/skills/`に入れる

## 各Skillに加える変更

### git-commit

- frontmatterへの`license`と`compatibility: git と Node.js 18 以降が必要`の追加
- `${CLAUDE_SKILL_DIR}`の初出への一文の追加：「このSKILL.mdのあるディレクトリ。Claude Code以外で展開されないときは、そのディレクトリのパスに置き換える」。Agent Skills仕様はSkill直下からの相対パスを推奨しているが、Claude Codeでは`${CLAUDE_SKILL_DIR}`のほうが作業ディレクトリに左右されないので残す
- `japanese-tech-writing`での点検への「入っていれば」の追加。Skillを別々に導入できるので、無い環境がありうる
- `check_message.mjs`の正規表現に生の文字で入っているBOM（U+FEFF）の、エスケープ（`/^\uFEFF/`）への書き換え。動作は同じで、APMの警告が消える

### plan-review

- frontmatterへの`license`と`compatibility: Claude Code 向け（$ARGUMENTS と disable-model-invocation を使う）。bash と codex CLI が必要`の追加
- 説明文の「ユーザーが /plan-review と明示的に指示したときだけ使う」は残す。`disable-model-invocation`を解さないホストでも、自動で呼ばれにくくなる

### japanese-tech-writing

- 内容は変えない。上流のgistと同一に保ち、取り込み直すときに改行以外の差分が出ないようにする
- READMEへの出典（gistのURL、取り込んだコミット`8f2d576`、作者、Unlicense）の記載

## frontmatterの扱い

- Claude Code独自のフィールド（`argument-hint`、`disable-model-invocation`）は残す。`gh skill publish`もAPMも、これを理由に拒否しない
- Agent Skills仕様の参照実装（`skills-ref validate`）は仕様外のフィールドをエラーにするので、検証には使わない
- 説明文が日本語なので、APMは「non-ASCII」と警告する。警告だけで、導入はできる
- `gh skill install`は導入先のfrontmatterを書き直す（キーの並べ替えと`metadata.github-*`の追加）。導入したコピーをこのリポジトリに戻すと`gh skill publish`がエラーにするので、編集は`skills/`の原本で行う

## 版とリリース

- 版はリポジトリ全体で1つのsemverのタグにする（`v0.1.0`から）
- リリースは`gh skill publish --tag v0.1.0`で作る。このコマンドが検証、`agent-skills`トピックの追加、GitHub Releaseの作成を行い、不変リリース（immutable releases）の有効化も提案する
- `apm.yml`の`version`はタグと同じ値に更新する

利用者が版を固定する方法は次のとおり。

- `gh skill`：`gh skill install ngram/skills git-commit@v0.1.0`（`--pin`を付けると`gh skill update`の対象から外れる）
- APM：`apm install ngram/skills#v0.1.0 --skill git-commit`
- Claude Code：`/plugin marketplace add ngram/skills@v0.1.0`

## CI

pushとプルリクエストで次を実行する。

- `claude plugin validate .`：マーケットプレイスと各プラグインの検証
- `gh skill publish --dry-run`：Agent Skills仕様の命名規則、`name`とディレクトリ名の一致、必須フィールドの検証
- `node skills/git-commit/scripts/check_message.mjs`：見本のメッセージでの動作確認

## 試作で確かめたこと

上の構成を作業用のディレクトリに作り、各ツールにかけた。

- `claude plugin validate`（Claude Code 2.1.293）は通過した。3つのプラグインとも導入でき、`claude plugin details`でSkillが1つずつ読み込まれていた
- `gh skill publish --dry-run`（gh 2.102.0）はエラーなしで、警告は`git-commit`と`plan-review`の`license`の欠落だけだった
- `gh skill install --from-local`では`scripts/`と`assets/`も導入され、書き直されたfrontmatterにも`argument-hint`と`disable-model-invocation`が残っていた
- `npx skills add <ディレクトリ> --list`は3つのSkillを認識した
- APM 0.33.0でローカルのディレクトリから導入すると、`apm.yml`が無いときは「no apm.yml, SKILL.md, or plugin.json found」で失敗した。直下に`apm.yml`（name、version、descriptionだけ）を置くと、3つとも`.claude/skills/`に入った。GitHubからの導入では`apm.yml`は不要と文書にあるが、ローカルとの違いをなくすために置く
- APMは`check_message.mjs`のBOMについて「hidden characters」と警告した

まだ確かめていないのは、GitHubに置いた状態での`gh skill install`と`apm install`、APMのマーケットプレイス機能（`.claude-plugin/marketplace.json`を読む）である。公開後に確かめる。

## 決めてほしいこと

1. `git-commit`と`plan-review`のライセンス（MIT、Unlicense、Apache-2.0など）
2. `japanese-tech-writing`を同梱するかどうか。Unlicenseなので同梱できる。`git-commit`が点検に使うので、出典を明記して同梱する案を推す
3. 「apx」が上の解釈（APMか`npx skills`）で合っているか
4. マーケットプレイス名。案は`ngram-skills`で、`/plugin install git-commit@ngram-skills`の`@`より後ろになる

## 実装の手順

1. `skills/`への3つのSkillの配置（LF、`.git`は除く）
2. 「各Skillに加える変更」の反映
3. `marketplace.json`、`apm.yml`、`.gitattributes`、`.gitignore`、`LICENSE`、`README.md`の追加
4. CIの追加と、ローカルでの`claude plugin validate .`と`gh skill publish --dry-run`の通過
5. リポジトリの公開と、`gh skill publish --tag v0.1.0`でのリリース
6. GitHubからの導入の、経路ごとの確認

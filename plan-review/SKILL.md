---
name: plan-review
description: Codexによる、plan/配下のPlanファイルのレビュー。履歴をplan/.reviews/に残し、差分を表示する。Planの「保証の水準」をCodexに渡して指摘を重大度で分けさせ、「重大」の指摘が無くなった時点で終える。ユーザーが/plan-reviewと明示的に指示したときだけ使う。
argument-hint: "[plan-file-name]"
disable-model-invocation: true
compatibility: Claude Code向け（引数の置換とdisable-model-invocationを使う）。手元のbashとcodex CLIが必要で、claude.aiはサポート外
license: MIT
metadata:
  claude-ai: unsupported
---

# /plan-review：PlanをCodexでレビューし、差分を表示する

## 概要

`plan/`にあるPlanファイルを、Codexにレビューさせる。
レビューはPlanの「保証の水準」を前提に行い、「重大」の指摘が無くなった時点で終える。

レビューの履歴は、`plan/.reviews/<ファイル名>/`に`r01_*`、`r02_*`の形で回ごとに残る。
同じPlanを何度レビューしても、前の回の履歴は上書きされない。

VS Codeの`code`コマンドが使える環境では、レビュー結果（`rNN_codex.md`）と、最初のPlan（`r01_before.md`）と最後のPlanの差分を、エディタで開く。
`code`コマンドが無い環境では開かずに進む。

## Planに必要な節

### 保証の水準（必須）

レビューの前に、Planに`## 保証の水準`の節があるかを確かめる（ステップ2a）。
無ければ、ClaudeがPlanの目的と背景から下書きを作り、ユーザーの確認を得てからPlanに加え、そのあとでレビューを始める。
この節が無いと、Codexは考えうるすべての穴を指摘し、レビューが終わらなくなる。

節には次の4点を書く。

- 外部との接続：ローカルと接続先のLLMだけで動くのか、ほかの外部API・サービスを読み書きするのか。例「ローカルのファイルと、接続先のLLMのAPIだけを使う」「GitHubのAPIでIssueを読み、PRを作る」
- 失敗したときの影響：例「データが壊れてもバックアップから戻せる。外部への影響は無い」
- 守るもの：この計画で保証する性質を、3〜5個に絞って挙げる
- 守らないもの：意図して保証しない性質と、その理由（例「電源断」「対象のツール以外のプロセスによる改変」）

次の項目は、当てはまるときだけ書く。

- 同時に使う人・LLM：複数の人やLLMが、同じPlanやデータを同時に読み書きする場合に、その形を書く。書かなければ、1人が1つのセッションで使うものとして扱う。Codexにもステップ4のプロンプトでそう伝える

### 実装時に決める事項（任意）

Planで決めなくても、実装とテストで決められる事項を1行ずつ書く節。
ステップ5aで、指摘の足し先として使う。節が無ければ、ステップ5aで初めて足すときに作る。

## ディレクトリ構造

```
plan/
├── 20250621_my-feature.md          ← 今のPlan（Claudeが編集する）
└── .reviews/
    └── 20250621_my-feature/
        ├── r01_before.md           ← 1回目のレビューを始めた時点のスナップショット
        ├── r01_codex.md            ← 1回目のCodexの応答（最後の応答だけ）
        ├── r01_codex.log           ← 1回目のCodexの実行ログ（見出し・プロンプト・応答）
        ├── r01_triage.md           ← 1回目の指摘の仕分け（REVISEのときだけ）
        ├── r02_before.md           ← 2回目のレビューを始めた時点のスナップショット
        ├── r02_codex.md            ← 2回目のCodexの応答
        └── r02_codex.log           ← 2回目のCodexの実行ログ
```

## 手順

### ステップ1：対象のファイルを決める

まず、`plan/`ディレクトリがあるかを確かめる。無ければ、その旨を伝えて中断する。

```bash
if [ ! -d "plan" ]; then
  echo "エラー: plan/ディレクトリが見つかりません。プロジェクトのルートで実行しているかを確かめてください。"
  exit 1
fi
```

`$ARGUMENTS`が渡されていれば、それをファイル名として扱う（拡張子の`.md`は省略できる）。
渡されていなければ、`plan/`にある`YYYYMMDD_*.md`のうち、更新日時が最も新しい1件を選ぶ。
候補が複数あるときは、選んだファイル名をユーザーに伝えてから進む。

```bash
# 引数が無い場合
PLAN_FILE=$(ls -t plan/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.md 2>/dev/null | head -1)
```

`codex`コマンドが`PATH`に無ければ、その旨をユーザーに伝えて中断する。

### ステップ2：レビューの回の番号を決め、ディレクトリを用意する

ファイル名（拡張子を除く）の名前でレビューのディレクトリを作り、既にある`rNN_before.md`の数から今回の番号を決める。

```bash
PLAN_BASENAME=$(basename "$PLAN_FILE" .md)
REVIEW_DIR="plan/.reviews/${PLAN_BASENAME}"
mkdir -p "$REVIEW_DIR"

# 既にあるレビューの数から、今回の番号を決める
EXISTING=$(ls "$REVIEW_DIR"/r[0-9][0-9]_before.md 2>/dev/null | wc -l)
ROUND=$(printf "%02d" $((EXISTING + 1)))

echo "レビュー対象: $PLAN_FILE"
echo "今回の回: r${ROUND}"
```

### ステップ2a：「保証の水準」の節を確かめる

スナップショット（ステップ3）より前に行う。あとで節を足すと、保存したPlanとCodexに送るPlanが食い違う。

```bash
if grep -q '^## 保証の水準' "$PLAN_FILE"; then
  echo "保証の水準: あり"
else
  echo "保証の水準: なし"
fi
```

節が無ければ、Codexを呼ぶ前に次のことを行う。

1. Planの目的と背景から、「Planに必要な節」の4点で下書きを作る。Planに書かれていない保証は足さない。水準を高く見積もりすぎると、レビューが終わらなくなる
2. 「同時に使う人・LLM」は、Planから同時に使うことが読み取れるときだけ書く
3. 下書きをユーザーに見せ、確認を得る。直すよう頼まれたら、直してもう一度見せる
4. 確認を得たら、Planの「目的・背景」の節の後（その節が無ければ、先頭の見出しの後）に`## 保証の水準`として加える

ユーザーが下書きを却下したら、レビューを始めずに中断する。節が無いままでは、Codexに水準を渡せない。

### ステップ3：レビュー前のスナップショットを保存する

```bash
BEFORE="${REVIEW_DIR}/r${ROUND}_before.md"
cp "$PLAN_FILE" "$BEFORE"
echo "スナップショットを保存: $BEFORE"
```

### ステップ4：Codexでレビューする

2回目以降は、前の回の`rNN_codex.md`があればプロンプトに添付する。
Codexには、前回の指摘が解消したかと、前回の修正で足した仕組みが本当に必要かも確かめさせる。

```bash
CODEX_OUT="${REVIEW_DIR}/r${ROUND}_codex.md"
CODEX_LOG="${REVIEW_DIR}/r${ROUND}_codex.log"
PREV_OUT="${REVIEW_DIR}/r$(printf "%02d" $((10#$ROUND - 1)))_codex.md"

# プロンプトは引数ではなく、一時ファイルを通して標準入力で渡す。
# 引数で渡すと、長いPlanでWindowsのコマンドラインの長さの上限を超える。
PROMPT_FILE="$(mktemp)" || exit 1
trap 'rm -f "$PROMPT_FILE"' EXIT

# 区切りを'EOF'と引用符で囲み、文面の$やバッククォートを展開させない。
{
cat <<'EOF'
あなたはソフトウェア設計のレビュアーです。
以下のPlanを読み、技術的な問題点・曖昧さ・抜け漏れを指摘してください。

【最初に読むこと】
Planの「保証の水準」の節に、この計画が守るものと守らないものが書いてあります。
指摘は、この水準を前提にしてください。
- 同時に使う人やLLMについての記述が無ければ、1人が1つのセッションで使うものとして扱ってください
- 「守らないもの」に挙げた性質を守るよう求める指摘はしないでください
- 水準そのものが目的に照らして低すぎると考える場合は、仕組みを足す指摘ではなく、
  「水準の見直し」として1件にまとめて指摘してください

【レビュー観点】
- 要件や目的が明確か
- 「守るもの」が、Planの設計で実際に守られているか
- 技術的に実現できるか
- 依存関係・順序関係に矛盾がないか
- 設計が、保証の水準に対して過剰でないか（不要な仕組み・複雑さ）

【指摘の分類】
各指摘の先頭に、重大度と種類を付けてください。
- 重大度
  - 重大：このままでは「守るもの」が守れない、または実装できない
  - 中：守れるが、誤解や手戻りを招きやすい
  - 軽微：実装時に決めれば足りる細部
- 種類
  - 誤り：Planの記述が事実や他の記述と矛盾する
  - 欠落：「守るもの」を守るのに必要な決定が無い
  - 過剰：保証の水準に対して不要な仕組みや複雑さがある（削る提案）
  - 実装詳細：Planで決めなくても、実装とテストで決められる

【出力の上限】
- 「重大」と「中」の指摘は、合わせて10件までにしてください。超える場合は重要なものから選んでください
- 「軽微」と「実装詳細」の指摘は、1行ずつの一覧にまとめてください
EOF

if [ -f "$PREV_OUT" ]; then
cat <<'EOF'

【前回のレビューとの関係】
前回のレビュー結果を添付します。次の順で書いてください。
1. 前回の「重大」と「中」の指摘のうち、解消していないもの
2. 前回からの修正で足した仕組みが、本当に必要か（「過剰」に当たらないか）
3. 新しい指摘。ただし、前回の修正で足した仕組みの細部への指摘は、
   それが「守るもの」を損なう場合に限ってください

【前回のレビュー結果】
EOF
cat "$PREV_OUT"
fi

cat <<'EOF'

【Planの内容】
EOF
cat "$PLAN_FILE"

cat <<'EOF'

【出力形式】
指摘を番号付きリストで書いてください。最後の行は次のいずれかにしてください。
VERDICT: APPROVED   （「重大」の指摘が無い）
VERDICT: REVISE     （「重大」の指摘がある）
EOF
} > "$PROMPT_FILE"

# モデルと推論の強さは、環境変数で指定されたときだけ渡す。無ければCodex CLIの既定値を使う。
# 値が空のときに空の引数を渡さないよう、引数を配列に積む。
CODEX_ARGS=(exec -s read-only)
if [ -n "${PLAN_REVIEW_MODEL:-}" ]; then
  CODEX_ARGS+=(-m "$PLAN_REVIEW_MODEL")
fi
if [ -n "${PLAN_REVIEW_EFFORT:-}" ]; then
  CODEX_ARGS+=(-c "model_reasoning_effort=$PLAN_REVIEW_EFFORT")
fi

# 最後の応答だけを-oでrNN_codex.mdに書き、見出しとプロンプトを含む実行ログはrNN_codex.logに書く。
# rNN_codex.mdは次の回のプロンプトに添付するので、実行ログを混ぜない。
codex "${CODEX_ARGS[@]}" -o "$CODEX_OUT" - < "$PROMPT_FILE" > "$CODEX_LOG" 2>&1
CODEX_STATUS=$?

echo "=== Codexのレビュー結果（r${ROUND}） ==="
if [ -f "$CODEX_OUT" ]; then
  cat "$CODEX_OUT"
else
  echo "（応答がありません。実行ログの末尾を示します）"
  tail -n 20 "$CODEX_LOG"
fi

# 使ったモデルと推論の強さは、codexが標準エラー出力に書く見出しから取り出す。
echo "=== 使ったモデル ==="
grep -m 2 -E '^(model|reasoning effort): ' "$CODEX_LOG" || echo "（見出しにモデルの行がありません）"

# 失敗したときは、環境変数が原因かどうかを見分けられるよう、値を示す。
if [ "$CODEX_STATUS" -ne 0 ]; then
  echo "=== codexが終了コード${CODEX_STATUS}で終わりました（ログ: ${CODEX_LOG}） ==="
  echo "PLAN_REVIEW_MODEL : ${PLAN_REVIEW_MODEL:-（未設定）}"
  echo "PLAN_REVIEW_EFFORT: ${PLAN_REVIEW_EFFORT:-（未設定）}"
fi

# レビュー結果をエディタで開く（VS Codeのcodeコマンドがある場合だけ）。
if [ -f "$CODEX_OUT" ] && command -v code >/dev/null 2>&1; then
  code -r "$CODEX_OUT" 2>/dev/null || true
fi
```

`codex`が0以外で終わったときは、示した実行ログの末尾をもとに、どうするかをユーザーに委ねる。

### ステップ5：VERDICTを確かめる

応答の最後の`VERDICT:`の行を読む。応答の末尾に空行や補足が付いていても読み取れる。
`APPROVED`と`REVISE`の直後は、空白か行末に限る。`VERDICT: APPROVED_UNKNOWN`のような行をAPPROVEDと読まないためである。

```bash
VERDICT_LINE=""
if [ -f "$CODEX_OUT" ]; then
  VERDICT_LINE=$(tr -d '\r' < "$CODEX_OUT" | grep '^VERDICT:' | tail -1)
fi
VERDICT=UNKNOWN
if [[ $VERDICT_LINE =~ ^VERDICT:\ (APPROVED|REVISE)([[:space:]]|$) ]]; then
  VERDICT="${BASH_REMATCH[1]}"
fi
echo "判定: ${VERDICT}（${VERDICT_LINE:-VERDICTの行がありません}）"
```

次の条件を上から順に当てはめ、最初に当たったものに従う。

1. **APPROVED**（「重大」の指摘が無い）：ステップ6へ進む。「中」や「軽微」の指摘が残っていても、レビューは終える
2. **UNKNOWN**（`rNN_codex.md`が無い、`VERDICT:`の行が無い、またはAPPROVEDとREVISEのどちらでもない）：ユーザーに確認を求める
3. **REVISE**で、今回が3回目以降：残った指摘と、これまでの`rNN_triage.md`の表をユーザーに見せ、判断を委ねる。続けると言われなければ、ステップ6へ進む
4. **REVISE**で、収束していない兆候がある：保証の水準の見直しをユーザーに提案し、ステップ6へ進む。兆候とは、次の2つがどちらも当てはまることを言う。前回の`rNN_triage.md`が無ければ、この条件は当てはめない
   - 今回の「重大」の指摘が、どれも前回の修正で足した仕組み（前回の`rNN_triage.md`の「足した仕組み」）の細部に関するものである。これは、Claudeがここで今回の応答と前回の`rNN_triage.md`を見比べて判断する。ステップ5aの仕分けは待たない
   - 前回の`rNN_triage.md`の集計で、「「重大」の指摘が、どれも直前の修正で足した仕組みの細部か」が「はい」である
5. **REVISE**：ステップ5aへ進む

条件3か4でステップ6へ進んだときは、APPROVEDで終えたのではなく、「重大」の指摘が残っていることをユーザーに伝える。

#### ステップ5a：指摘を仕分けしてからPlanを直す（REVISEのときだけ）

指摘ごとに、次の順で対処を選ぶ。上の対処で済むなら、下の対処には進まない。

1. 「守らないもの」に当たる指摘：対処しない。その理由を一覧に書く
2. 「過剰」の指摘：仕組みを削る
3. Planの誤り（矛盾・事実の誤り）：記述を直す
4. 保証を狭めれば解消する指摘：「守るもの」を狭め、「守らないもの」に理由を足す
5. 実装とテストで決められる指摘：Planの「実装時に決める事項」の節に1行で足す（節が無ければ作る）
6. 上のどれでも解消しない「重大」の指摘：仕組みを足す

6で仕組みを足すときは、次の2点を一覧に書く。

- その仕組みで守る、「守るもの」の項目
- 足した仕組みと既存の仕組みとの関係（同じデータや同じロックに触れるか）

Planは、Claudeが`$PLAN_FILE`を直接編集して直す。`.reviews/`にある既存のファイルは変えない。

直し終えたら、仕分けの結果を`${REVIEW_DIR}/r${ROUND}_triage.md`に書く。
次の回のステップ5とステップ5aはこのファイルを読むので、会話の文脈だけに残すことはしない。

```markdown
# r01 指摘の仕分け

## 指摘ごとの対処

| 指摘 | 重大度 | 種類 | 対処（1〜6） | 理由（1を選んだときは必須） |
|---|---|---|---|---|
| 1. … | 重大 | 欠落 | 6 | … |

## 足した仕組み

- <仕組み>：対応する「守るもの」は<項目>。既存の仕組みとの関係は<…>

## 削った仕組み

- <仕組み>

## 集計

- 足した仕組みの数：<N>
- 削った仕組みの数：<M>
- 「重大」の指摘が、どれも直前の修正で足した仕組みの細部か：<はい／いいえ>（1回目は「いいえ」）
```

書いたら、指摘ごとの対処と、足した仕組みの数・削った仕組みの数をユーザーに見せる。

今回と前回の`rNN_triage.md`の両方で、足した仕組みの数が削った仕組みの数より多いときは、ステップ3に戻る前に、保証の水準を見直すかどうかをユーザーに確かめる。前回の`rNN_triage.md`が無ければ、この確認はしない。

確かめ終えたら（または当てはまらなければ）、**ステップ3に戻り、`ROUND`を1つ増やして繰り返す**。

### ステップ6：差分を表示して終える

今回の回のスナップショットと、今のPlanを比べる。

```bash
echo ""
echo "=== 差分（r${ROUND}_before → 今のPlan） ==="
diff "$BEFORE" "$PLAN_FILE" || true

echo ""
echo "=== レビュー完了 ==="
echo "Planファイル    : $PLAN_FILE"
echo "スナップショット: $BEFORE"
echo "Codexの応答     : $CODEX_OUT"
echo "Codexのログ     : $CODEX_LOG"
echo "履歴ディレクトリ: $REVIEW_DIR"
grep -m 2 -E '^(model|reasoning effort): ' "$CODEX_LOG" | sed 's/^/Codex /'

# 最後の回のレビュー結果と、最初のPlan（r01_before.md）と今のPlanの差分を、
# エディタで開く（VS Codeのcodeコマンドがある場合だけ）。
if command -v code >/dev/null 2>&1; then
  code -r "$CODEX_OUT" 2>/dev/null || true
  FIRST="${REVIEW_DIR}/r01_before.md"
  if [ -f "$FIRST" ]; then
    code --diff "$FIRST" "$PLAN_FILE" 2>/dev/null || true
  fi
fi
```

Planを変えなかった場合（1回目でAPPROVEDだった場合）は、その旨を伝える。

## 使用例

ファイル名は、先頭の`plan/`と末尾の`.md`を省略できる。

```
# 最も新しいPlanを選んでレビューする
/plan-review

# ファイル名を指定してレビューする
/plan-review 20250621_my-feature
/plan-review plan/20250621_my-feature.md
```

## Codexのモデルと推論の強さ

既定では、モデルも推論の強さも指定せずに`codex exec`を実行する。どちらもCodex CLIの既定値になるので、CLIを更新すると変わることがある。実際に使った値は、レビューのたびに「使ったモデル」として表示され、`rNN_codex.log`の見出し（`model:`と`reasoning effort:`の行）にも残る。

レビューに使う値を決めたいときは、次の環境変数を設定する。空の値は、設定しないのと同じに扱う。

| 環境変数 | Codexへの渡し方 | 設定しないとき |
|---|---|---|
| `PLAN_REVIEW_MODEL` | `-m <値>` | CLIの既定のモデル |
| `PLAN_REVIEW_EFFORT` | `-c model_reasoning_effort=<値>` | CLIの既定の推論の強さ |

`-c`で渡すので、`~/.codex/config.toml`の`model_reasoning_effort`より優先される。`plan-review`以外でのCodexの使い方には影響しない。

常に同じ値を使うときは、Claude Codeの`settings.json`の`env`に書く。

```json
{
  "env": {
    "PLAN_REVIEW_MODEL": "gpt-6.1-sol",
    "PLAN_REVIEW_EFFORT": "high"
  }
}
```

使えるモデルと推論の強さは、Codex CLIの版とアカウントによって変わる。使えない値を設定すると`codex`が0以外で終わり、エラーの文面が`rNN_codex.log`に残る。このとき、設定されている環境変数の値もあわせて表示される。

## .gitignoreの推奨設定

```gitignore
plan/.reviews/
```

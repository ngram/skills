---
name: plan-review
description: CodexかClaudeによる、plan/配下のPlanファイルのレビュー。レビューする側は引数か環境変数で選び、既定ではcodexにログイン済みならCodex、そうでなければClaude（claude -p）を使う。履歴をplan/.reviews/に残し、差分を表示する。Planの「外部との入出力」と「実現すること・しないこと」を前提に、レビューする側に指摘を重大度で分けさせ、「重大」の指摘が無くなった時点で終える。ユーザーが/plan-reviewと明示的に指示したときだけ使う。
argument-hint: "[--reviewer codex|claude|auto] [plan-file-name]"
disable-model-invocation: true
compatibility: Claude Code（手元とクラウドセッション）向け（引数の置換とdisable-model-invocationを使う）。bashと、codex CLIかclaude CLIが必要。claude.aiのチャットは対象外
license: MIT
---

# /plan-review：PlanをCodexかClaudeでレビューし、差分を表示する

## 概要

`plan/`にあるPlanファイルを、CodexかClaudeにレビューさせる。どちらにさせるかは、引数か環境変数で選ぶ（「レビューする側とモデルの選び方」）。
レビューする側は、このセッションとは文脈を共有しない別のプロセスで動き、Planとリポジトリのファイルを読むだけで、ファイルを変えない。
レビューはPlanの「外部との入出力」と「実現すること・しないこと」を前提に行い、「重大」の指摘が無くなった時点で終える。

レビューの履歴は、`plan/.reviews/<ファイル名>/`に`r01_*`、`r02_*`の形で回ごとに残る。
同じPlanを何度レビューしても、前の回の履歴は上書きされない。

VS Codeの`code`コマンドが使える環境では、レビュー結果（`rNN_review.md`）と、最初のPlan（`r01_before.md`）と最後のPlanの差分を、エディタで開く。
`code`コマンドが無い環境では開かずに進む。

## Planに必要な節

### 外部との入出力と、実現すること・しないこと（必須）

レビューの前に、Planにこの2つの節があるかを確かめる（ステップ2a）。
無ければ、ClaudeがPlanの「問題と対応方針」から下書きを作り、ユーザーの確認を得てからPlanに加え、そのあとでレビューを始める。
この2つの節が無いと、レビューする側は考えうるすべての穴を指摘し、レビューが終わらなくなる。

2つの節には、次の4点を書く。

- 読み書きするもの：実装したものが読み書きする外部のもの（ファイル、DB、外部のAPI・サービス、接続先のLLMなど）。「外部との入出力」に書く。例「ローカルのファイルと、接続先のLLMのAPIだけ」「GitHubのAPIでIssueを読み、PRを作る」
- 読み書きしないもの：触れないことを示しておく外部のもの。「外部との入出力」に書く。例「ほかの外部サービスは読み書きしない」
- 実現すること：実装によって成り立つ状態を、3〜5個に絞って挙げる。「実現すること・しないこと」に書く。失敗したときに成り立つこと（例「失敗しても元のデータは残り、〜で作り直せる」）もここに書く
- 実現しないこと：意図して実現しない状態と、その理由。「実現すること・しないこと」に書く。実現しなくても困らないものに限る

次の項目は、当てはまるときだけ「外部との入出力」に書く。

- 同時に使う人・LLM：複数の人やLLMが、同じPlanやデータを同時に読み書きする場合に、その形を書く。書かなければ、1人が1つのセッションで使うものとして扱う。レビューする側にもステップ4のプロンプトでそう伝える

前の版の`plan-create`で書いたPlanには、この2つの節の代わりに`## 保証の水準`の節がある。
この節があれば、2つの節があるものとして扱い、Planを書き換えない。
中の「外部との接続」は「読み書きするもの」に、「守るもの」は「実現すること」に、「守らないもの」は「実現しないこと」に当たる。ステップ4のプロンプトでも、レビューする側にそう伝える。

### 懸念事項（任意）

Planの外に及ぶことを書く節。「この実装の外への影響」（画面、ほかのコンポーネント、運用・事務など）と、「あえて扱わないこと」（困るおそれはあるが、大きすぎるなどの理由で、この計画では扱わないことと、その理由）を書く。
ステップ5aで、この計画で扱うには大きすぎる指摘の足し先として使う。節が無ければ、ステップ5aで初めて足すときに作る。

### 実装時に決める事項（任意）

Planで決めなくても、実装とテストで決められる事項を1行ずつ書く節。
ステップ5aで、指摘の足し先として使う。節が無ければ、ステップ5aで初めて足すときに作る。

### 目次（任意）

Planに「目次」の節があれば、ステップ2aとステップ5aで節を足したときに、目次にも同じ順で足す。

## ディレクトリ構造

```
plan/
├── 20250621_my-feature.md          ← 今のPlan（Claudeが編集する）
└── .reviews/
    └── 20250621_my-feature/
        ├── r01_before.md           ← 1回目のレビューを始めた時点のスナップショット
        ├── r01_review.md           ← 1回目のレビューする側の応答（最後の応答だけ）
        ├── r01_review.log          ← 1回目の実行ログ（レビューする側とモデル、エラーの出力）
        ├── r01_triage.md           ← 1回目の指摘の仕分け（REVISEのときだけ）
        ├── r02_before.md           ← 2回目のレビューを始めた時点のスナップショット
        ├── r02_review.md           ← 2回目のレビューする側の応答
        └── r02_review.log          ← 2回目の実行ログ
```

前の版の`plan-review`で作った履歴（`rNN_codex.md`、`rNN_codex.log`）は、そのまま残す。前の回の応答として、`rNN_codex.md`も読む（ステップ4）。

## 手順

コードブロックごとに別のシェルで動く環境では、前のコードブロックで決まった値（`REVIEWER`、`PLAN_FILE`、`REVIEW_DIR`、`ROUND`など）を、次のコードブロックの先頭で設定し直してから実行する。

### ステップ1：レビューする側と対象のファイルを決める

まず、`plan/`ディレクトリがあるかを確かめる。無ければ、その旨を伝えて中断する。

```bash
if [ ! -d "plan" ]; then
  echo "エラー: plan/ディレクトリが見つかりません。プロジェクトのルートで実行しているかを確かめてください。"
  exit 1
fi
```

次に、レビューする側を決める。引数（`$ARGUMENTS`）から`--reviewer`の値を取り出し、残りをPlanのファイル名（`PLAN_ARG`）にする。
値は、引数、環境変数`PLAN_REVIEW_REVIEWER`、既定の`auto`の順に決める。`auto`は、`codex`が`PATH`にあってログイン済みならCodex、そうでなければClaudeにする。

```bash
# レビューする側を決める
ARGS="$ARGUMENTS"
REVIEWER_ARG=""
PLAN_ARG=""
# 位置引数（ドル記号と数字）は使わない。Claude CodeはSkillの本文のそれを、引数のn番目で置き換えるため。
WANT_VALUE=""
set -f
for WORD in $ARGS; do
  if [ -n "$WANT_VALUE" ]; then
    REVIEWER_ARG="$WORD"
    WANT_VALUE=""
    continue
  fi
  case "$WORD" in
    --reviewer=*) REVIEWER_ARG="${WORD#--reviewer=}" ;;
    --reviewer) WANT_VALUE="yes" ;;
    *) PLAN_ARG="$WORD" ;;
  esac
done
set +f
if [ -n "$WANT_VALUE" ] || { [ -z "$REVIEWER_ARG" ] && [[ " $ARGS " == *" --reviewer= "* ]]; }; then
  echo "エラー: --reviewerの後に、codex、claude、autoのどれかを書いてください。"
  exit 1
fi

if [ -n "$REVIEWER_ARG" ]; then
  REVIEWER="$REVIEWER_ARG"; HOW="引数"
elif [ -n "${PLAN_REVIEW_REVIEWER:-}" ]; then
  REVIEWER="$PLAN_REVIEW_REVIEWER"; HOW="環境変数PLAN_REVIEW_REVIEWER"
else
  REVIEWER="auto"; HOW="既定"
fi
case "$REVIEWER" in
  codex|claude|auto) ;;
  *)
    echo "エラー: レビューする側「${REVIEWER}」（${HOW}）は使えません。codex、claude、autoのどれかにしてください。"
    exit 1 ;;
esac

if [ "$REVIEWER" = "auto" ]; then
  if ! command -v codex >/dev/null 2>&1; then
    REVIEWER="claude"; HOW="${HOW}のauto（codexが無い）"
  elif ! codex login status >/dev/null 2>&1; then
    REVIEWER="claude"; HOW="${HOW}のauto（codexにログインしていない）"
  else
    REVIEWER="codex"; HOW="${HOW}のauto（codexにログイン済み）"
  fi
fi

if ! command -v "$REVIEWER" >/dev/null 2>&1; then
  echo "エラー: ${REVIEWER}コマンドが見つかりません（${HOW}で選びました）。"
  exit 1
fi
# 明示してCodexを選んだときは、ログインの確かめに失敗しても中断しない。
# 環境変数のAPIキーだけで使っているときなど、codex login statusが失敗してもcodex execは動くことがあるため。
if [ "$REVIEWER" = "codex" ] && ! codex login status >/dev/null 2>&1; then
  echo "注意: codex login statusが失敗しました。ログインしていなければ、ステップ4でcodexが失敗します（${HOW}で選びました）。"
fi

# 前の版の環境変数は読まない。設定されていれば、新しい名前を示す。
for OLD in PLAN_REVIEW_MODEL PLAN_REVIEW_EFFORT; do
  if [ -n "${!OLD:-}" ]; then
    echo "注意: ${OLD}は読みません。PLAN_REVIEW_CODEX_${OLD#PLAN_REVIEW_}かPLAN_REVIEW_CLAUDE_${OLD#PLAN_REVIEW_}を使ってください。"
  fi
done

echo "レビューする側: ${REVIEWER}（${HOW}）"
echo "Planの指定    : ${PLAN_ARG:-（なし）}"
```

エラーで中断したときは、その理由をユーザーに伝える。`codex`が無いときと、Codexにログインしていないことでステップ4が失敗したときは、次のことも伝える。

- 手元では、`npm install -g @openai/codex`で入れ、`codex login`でログインする
- クラウドセッションでは、環境の設定（環境変数、Setup script、Network access）が要る。手順はこのSkillの`README.md`の「クラウドセッションでCodexを使う」にある
- `--reviewer claude`を付ければ、Claudeでレビューできる
- `auto`は`codex login status`でログインを確かめる。環境変数のAPIキーだけでCodexを使っていて、`auto`がClaudeを選ぶときは、`--reviewer codex`か`PLAN_REVIEW_REVIEWER=codex`で明示する

決まった`REVIEWER`は、ステップ4で使う。

`PLAN_ARG`が渡されていれば、それをファイル名として扱う（先頭の`plan/`と拡張子の`.md`は省略できる）。
渡されていなければ、`plan/`にある`YYYYMMDD_*.md`のうち、更新日時が最も新しい1件を選ぶ。
候補が複数あるときは、選んだファイル名をユーザーに伝えてから進む。

```bash
# 引数が無い場合
PLAN_FILE=$(ls -t plan/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.md 2>/dev/null | head -1)
```

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

### ステップ2a：必須の節を確かめる

スナップショット（ステップ3）より前に行う。あとで節を足すと、保存したPlanとレビューする側に送るPlanが食い違う。

```bash
# 必須の節を確かめる
for H in "外部との入出力" "実現すること・しないこと" "保証の水準"; do
  if grep -q "^## ${H}" "$PLAN_FILE"; then
    echo "${H}: あり"
  else
    echo "${H}: なし"
  fi
done
```

「外部との入出力」と「実現すること・しないこと」が両方あるか、前の版の「保証の水準」があれば、ステップ3へ進む。

そうでなければ、レビューする側を呼ぶ前に次のことを行う。

1. Planの「問題と対応方針」（前の版のPlanでは「目的・背景」）から、無い節の下書きを「Planに必要な節」の4点で作る。Planに書かれていないことは「実現すること」に足さない。実現することを多く見積もりすぎると、レビューが終わらなくなる
2. 「同時に使う人・LLM」は、Planから同時に使うことが読み取れるときだけ書く
3. 下書きをユーザーに見せ、確認を得る。直すよう頼まれたら、直してもう一度見せる
4. 確認を得たら、Planに加える。「外部との入出力」「実現すること・しないこと」の順に、「実装範囲」の節（前の版のPlanでは「スコープ」）の後に置く。その節が無ければ「問題と対応方針」（前の版のPlanでは「目的・背景」）の後、それも無ければ先頭の見出しの後に置く。片方だけを加えるときは、もう片方の隣に置く。目次があれば、目次にも足す

ユーザーが下書きを却下したら、レビューを始めずに中断する。2つの節が無いままでは、レビューする側に前提を渡せない。

### ステップ3：レビュー前のスナップショットを保存する

```bash
BEFORE="${REVIEW_DIR}/r${ROUND}_before.md"
cp "$PLAN_FILE" "$BEFORE"
echo "スナップショットを保存: $BEFORE"
```

### ステップ4：レビューする側にレビューさせる

2回目以降は、前の回の応答（`rNN_review.md`、前の版の履歴では`rNN_codex.md`）があればプロンプトに添付する。
レビューする側には、前回の指摘が解消したかと、前回の修正で足した仕組みが本当に必要かも確かめさせる。

レビューには数分かかることがある。このコードブロックは、Bashツールの制限時間を600000ミリ秒（10分）にして実行する。制限時間で止まったときは、新しい回（下のやり直しの決まり）で、裏で実行して終わるのを待つ。

```bash
# レビューする側にレビューさせる
REVIEW_OUT="${REVIEW_DIR}/r${ROUND}_review.md"
REVIEW_LOG="${REVIEW_DIR}/r${ROUND}_review.log"
# 応答はいったん一時ファイルに書き、成功したときだけrNN_review.mdにする。
# 途中で止まったときに、途中までの応答がrNN_review.mdとして残り、次の回に添付されないようにするため。
REVIEW_TMP="${REVIEW_OUT}.tmp"

# 前の回の応答を探す。失敗した回（応答の無い回）は飛ばしてさかのぼる。
# 前の版のplan-reviewで作った履歴（rNN_codex.md）からも続けられるようにする。
PREV_OUT=""
N=$((10#$ROUND - 1))
while [ "$N" -ge 1 ] && [ -z "$PREV_OUT" ]; do
  P=$(printf "%02d" "$N")
  for F in "${REVIEW_DIR}/r${P}_review.md" "${REVIEW_DIR}/r${P}_codex.md"; do
    if [ -f "$F" ]; then
      PREV_OUT="$F"
      break
    fi
  done
  N=$((N - 1))
done

# プロンプトは引数ではなく、一時ファイルを通して標準入力で渡す。
# 引数で渡すと、長いPlanでWindowsのコマンドラインの長さの上限を超える。
PROMPT_FILE="$(mktemp)" || exit 1
trap 'rm -f "$PROMPT_FILE" "$REVIEW_TMP"' EXIT

# 区切りを'EOF'と引用符で囲み、文面の$やバッククォートを展開させない。
{
cat <<'EOF'
あなたはソフトウェア設計のレビュアーです。
以下のPlanを読み、技術的な問題点・曖昧さ・抜け漏れを指摘してください。
リポジトリのファイルは読めますが、変更はできません。Planの記述は、必要に応じてリポジトリと照らし合わせてください。

【最初に読むこと】
Planの「外部との入出力」の節に、この計画が読み書きする外部のものが書いてあります。
「実現すること・しないこと」の節に、この計画が実現することと実現しないことが書いてあります。
指摘は、この2つの節を前提にしてください。
- 同時に使う人やLLMについての記述が無ければ、1人が1つのセッションで使うものとして扱ってください
- 「実現しないこと」に挙げたことを実現するよう求める指摘はしないでください
- 「懸念事項」の「あえて扱わないこと」に挙げたことを、この計画で扱うよう求める指摘はしないでください
- 実現することそのものが、Planの目的に照らして足りないと考える場合は、仕組みを足す指摘ではなく、
  「実現することの見直し」として1件にまとめて指摘してください
- 前の版の形式のPlanでは、この2つの節の代わりに「保証の水準」の節があります。
  「外部との接続」は「読み書きするもの」、「守るもの」は「実現すること」、「守らないもの」は「実現しないこと」と読み替えてください

【レビュー観点】
- 問題と対応方針が明確か
- 「実現すること」が、Planの設計で実際に実現されるか
- 技術的に実現できるか
- 依存関係・順序関係に矛盾がないか
- 「変更前後の構成」の図が、実装ステップと変更するファイルに合っているか
- 設計が、実現することに対して過剰でないか（不要な仕組み・複雑さ）

【指摘の分類】
各指摘の先頭に、重大度と種類を付けてください。
- 重大度
  - 重大：このままでは「実現すること」が実現できない、または実装できない
  - 中：実現できるが、誤解や手戻りを招きやすい
  - 軽微：実装時に決めれば足りる細部
- 種類
  - 誤り：Planの記述が事実や他の記述と矛盾する
  - 欠落：「実現すること」を実現するのに必要な決定が無い
  - 過剰：実現することに対して不要な仕組みや複雑さがある（削る提案）
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
   それが「実現すること」を損なう場合に限ってください

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

# モデルと推論の強さは、レビューする側ごとの環境変数で指定する。
# 既定は、Codexがgpt-6.1-solとhigh、Claudeがopusとhigh。
# Codex CLIの既定に任せると、CLIが古ければ古いモデルになり、推論の強さもgpt-6.1-solの既定のlowになるので、明示して渡す。
if [ "$REVIEWER" = "codex" ]; then
  MODEL="${PLAN_REVIEW_CODEX_MODEL:-gpt-6.1-sol}"
  EFFORT="${PLAN_REVIEW_CODEX_EFFORT:-high}"
  REVIEW_ARGS=(exec -s read-only -m "$MODEL" -c "model_reasoning_effort=$EFFORT")
else
  MODEL="${PLAN_REVIEW_CLAUDE_MODEL:-opus}"
  EFFORT="${PLAN_REVIEW_CLAUDE_EFFORT:-high}"
  # ツールは読むものだけを渡す。--restrictedは、利用者とプロジェクトの設定ファイル（hooksや許可の設定）を読まず、
  # ファイルのツールを作業ディレクトリの中に限る。--strict-mcp-configは、MCPサーバーを読み込まない。
  REVIEW_ARGS=(-p --model "$MODEL" --effort "$EFFORT" --tools "Read,Grep,Glob" --restricted --strict-mcp-config --no-session-persistence)
fi

# 実行ログの先頭に、レビューする側と指定したモデルを書く。
{
  echo "plan-review reviewer: ${REVIEWER}"
  echo "plan-review model: ${MODEL}"
  echo "plan-review effort: ${EFFORT}"
  echo "----"
} > "$REVIEW_LOG"

# 最後の応答だけを一時ファイルに書き、見出しやエラーの出力はrNN_review.logに書く。
# 応答は次の回のプロンプトに添付するので、実行ログを混ぜない。
rm -f "$REVIEW_TMP"
if [ "$REVIEWER" = "codex" ]; then
  codex "${REVIEW_ARGS[@]}" -o "$REVIEW_TMP" - < "$PROMPT_FILE" >> "$REVIEW_LOG" 2>&1
else
  claude "${REVIEW_ARGS[@]}" < "$PROMPT_FILE" > "$REVIEW_TMP" 2>> "$REVIEW_LOG"
fi
REVIEW_STATUS=$?

# 0で終わり、応答が空でなければ、rNN_review.mdにする。そうでなければ、出力をレビュー結果として扱わない。
# claudeはエラーの文も標準出力に書くので、一時ファイルの中身を実行ログに移して消す。
# このときrNN_review.mdは作られず、ステップ5の判定はUNKNOWNになり、次の回にも添付されない。
if [ "$REVIEW_STATUS" -eq 0 ] && [ -s "$REVIEW_TMP" ]; then
  mv "$REVIEW_TMP" "$REVIEW_OUT"
elif [ -f "$REVIEW_TMP" ]; then
  {
    echo "---- 応答（終了コード${REVIEW_STATUS}。0以外で終わったか、応答が空のため、レビュー結果として扱わない）"
    cat "$REVIEW_TMP"
  } >> "$REVIEW_LOG"
  rm -f "$REVIEW_TMP"
fi

echo "=== レビュー結果（r${ROUND}、${REVIEWER}） ==="
if [ -f "$REVIEW_OUT" ]; then
  cat "$REVIEW_OUT"
else
  echo "（応答がありません。実行ログの末尾を示します）"
  tail -n 20 "$REVIEW_LOG"
fi

echo "=== 使ったモデル ==="
if [ "$REVIEWER" = "codex" ]; then
  # 実際に使ったモデルと推論の強さは、codexが標準エラー出力に書く見出しから取り出す。
  grep -m 2 -E '^(model|reasoning effort): ' "$REVIEW_LOG" || echo "（見出しにモデルの行がありません）"
else
  echo "model: ${MODEL}"
  echo "effort: ${EFFORT}"
fi

# 失敗したときは、環境変数が原因かどうかを見分けられるよう、値を示す。
if [ "$REVIEW_STATUS" -ne 0 ]; then
  echo "=== ${REVIEWER}が終了コード${REVIEW_STATUS}で終わりました（ログ: ${REVIEW_LOG}） ==="
  if [ "$REVIEWER" = "codex" ]; then
    echo "PLAN_REVIEW_CODEX_MODEL : ${PLAN_REVIEW_CODEX_MODEL:-（未設定。gpt-6.1-solを使った）}"
    echo "PLAN_REVIEW_CODEX_EFFORT: ${PLAN_REVIEW_CODEX_EFFORT:-（未設定。highを使った）}"
  else
    echo "PLAN_REVIEW_CLAUDE_MODEL : ${PLAN_REVIEW_CLAUDE_MODEL:-（未設定。opusを使った）}"
    echo "PLAN_REVIEW_CLAUDE_EFFORT: ${PLAN_REVIEW_CLAUDE_EFFORT:-（未設定。highを使った）}"
  fi
fi

# レビュー結果をエディタで開く（VS Codeのcodeコマンドがある場合だけ）。
if [ -f "$REVIEW_OUT" ] && command -v code >/dev/null 2>&1; then
  code -r "$REVIEW_OUT" 2>/dev/null || true
fi
```

レビューする側が0以外で終わったときは、示した実行ログの末尾をもとに、どうするかをユーザーに委ねる。利用上限、使えないモデル、認証の失敗、ネットワークの拒否などが、ログの末尾に出る。

やり直すときは、ステップ3に戻り、`ROUND`を1つ増やした新しい回で行う。同じ回のままこのコードブロックを実行し直すと、その回の実行ログ（`rNN_review.log`）が上書きされ、失敗の記録が消える。前の回の応答は、応答の無い回を飛ばして探すので、失敗した回をはさんでも添付される。

### ステップ5：VERDICTを確かめる

応答の最後の`VERDICT:`の行を読む。応答の末尾に空行や補足が付いていても読み取れる。
`APPROVED`と`REVISE`の直後は、空白か行末に限る。`VERDICT: APPROVED_UNKNOWN`のような行をAPPROVEDと読まないためである。

```bash
VERDICT_LINE=""
if [ -f "$REVIEW_OUT" ]; then
  VERDICT_LINE=$(tr -d '\r' < "$REVIEW_OUT" | grep '^VERDICT:' | tail -1)
fi
VERDICT=UNKNOWN
if [[ $VERDICT_LINE =~ ^VERDICT:\ (APPROVED|REVISE)([[:space:]]|$) ]]; then
  VERDICT="${BASH_REMATCH[1]}"
fi
echo "判定: ${VERDICT}（${VERDICT_LINE:-VERDICTの行がありません}）"
```

次の条件を上から順に当てはめ、最初に当たったものに従う。

1. **APPROVED**（「重大」の指摘が無い）：ステップ6へ進む。「中」や「軽微」の指摘が残っていても、レビューは終える
2. **UNKNOWN**（`rNN_review.md`が無い、`VERDICT:`の行が無い、またはAPPROVEDとREVISEのどちらでもない。レビューする側が0以外で終わったときは、`rNN_review.md`が無い）：ユーザーに確認を求める。やり直すときは、新しい回で行う（ステップ4のやり直しの決まり）
3. **REVISE**で、応答のあった回（`rNN_review.md`か`rNN_codex.md`がある回）が今回で3回目以降：残った指摘と、これまでの`rNN_triage.md`の表をユーザーに見せ、判断を委ねる。続けると言われなければ、ステップ6へ進む
4. **REVISE**で、収束していない兆候がある：「実現すること・しないこと」の見直しをユーザーに提案し、ステップ6へ進む。兆候とは、次の2つがどちらも当てはまることを言う。前回の`rNN_triage.md`が無ければ、この条件は当てはめない
   - 今回の「重大」の指摘が、どれも前回の修正で足した仕組み（前回の`rNN_triage.md`の「足した仕組み」）の細部に関するものである。これは、Claudeがここで今回の応答と前回の`rNN_triage.md`を見比べて判断する。ステップ5aの仕分けは待たない
   - 前回の`rNN_triage.md`の集計で、「「重大」の指摘が、どれも直前の修正で足した仕組みの細部か」が「はい」である
5. **REVISE**：ステップ5aへ進む

条件3か4でステップ6へ進んだときは、APPROVEDで終えたのではなく、「重大」の指摘が残っていることをユーザーに伝える。

#### ステップ5a：指摘を仕分けしてからPlanを直す（REVISEのときだけ）

指摘ごとに、次の順で対処を選ぶ。上の対処で済むなら、下の対処には進まない。

1. 「実現しないこと」か、「懸念事項」の「あえて扱わないこと」に当たる指摘：対処しない。その理由を一覧に書く
2. 「過剰」の指摘：仕組みを削る
3. Planの誤り（矛盾・事実の誤り）：記述を直す
4. 実現することを狭めれば解消する指摘：「実現すること」を狭め、「実現しないこと」に理由を足す
5. 実装とテストで決められる指摘：Planの「実装時に決める事項」の節に1行で足す（節が無ければ作る）
6. この計画で扱うには大きすぎる指摘：Planの「懸念事項」の「あえて扱わないこと」に、理由とともに足す（節が無ければ作る）。「実現すること」を損なう指摘には使わず、4か7で対処する
7. 上のどれでも解消しない「重大」の指摘：仕組みを足す

前の版のPlan（「保証の水準」の節があるPlan）では、「実現すること」を「守るもの」、「実現しないこと」を「守らないもの」と読み替えて直す。

7で仕組みを足すときは、次の2点を一覧に書く。

- その仕組みで実現する、「実現すること」の項目
- 足した仕組みと既存の仕組みとの関係（同じデータや同じロックに触れるか）

Planは、Claudeが`$PLAN_FILE`を直接編集して直す。`.reviews/`にある既存のファイルは変えない。

直し終えたら、仕分けの結果を`${REVIEW_DIR}/r${ROUND}_triage.md`に書く。
次の回のステップ5とステップ5aはこのファイルを読むので、会話の文脈だけに残すことはしない。

```markdown
# r01 指摘の仕分け

## 指摘ごとの対処

| 指摘 | 重大度 | 種類 | 対処（1〜7） | 理由（1か6を選んだときは必須） |
|---|---|---|---|---|
| 1. … | 重大 | 欠落 | 7 | … |

## 足した仕組み

- <仕組み>：対応する「実現すること」は<項目>。既存の仕組みとの関係は<…>

## 削った仕組み

- <仕組み>

## 集計

- 足した仕組みの数：<N>
- 削った仕組みの数：<M>
- 「重大」の指摘が、どれも直前の修正で足した仕組みの細部か：<はい／いいえ>（1回目は「いいえ」）
```

書いたら、指摘ごとの対処と、足した仕組みの数・削った仕組みの数をユーザーに見せる。

今回と前回の`rNN_triage.md`の両方で、足した仕組みの数が削った仕組みの数より多いときは、ステップ3に戻る前に、「実現すること・しないこと」を見直すかどうかをユーザーに確かめる。前回の`rNN_triage.md`が無ければ、この確認はしない。

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
echo "レビューする側  : $REVIEWER"
echo "応答            : $REVIEW_OUT"
echo "実行ログ        : $REVIEW_LOG"
echo "履歴ディレクトリ: $REVIEW_DIR"
grep -m 3 -E '^plan-review (model|effort): ' "$REVIEW_LOG" | sed 's/^plan-review /指定した /'
if [ "$REVIEWER" = "codex" ]; then
  grep -m 2 -E '^(model|reasoning effort): ' "$REVIEW_LOG" | sed 's/^/Codexが使った /'
fi

# 最後の回のレビュー結果と、最初のPlan（r01_before.md）と今のPlanの差分を、
# エディタで開く（VS Codeのcodeコマンドがある場合だけ）。
if command -v code >/dev/null 2>&1; then
  code -r "$REVIEW_OUT" 2>/dev/null || true
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

# レビューする側を指定する
/plan-review --reviewer claude 20250621_my-feature
/plan-review --reviewer codex
```

claude.aiに入れてクラウドセッションで使うときは、`/anthropic-skills:plan-review`の名前で呼ぶ。Claude Codeのプラグインとして入れたときは、`/plan-review:plan-review`になる。

## レビューする側とモデルの選び方

レビューする側は、引数`--reviewer`、環境変数`PLAN_REVIEW_REVIEWER`、既定の`auto`の順に決まる（ステップ1）。
`auto`は、`codex`が`PATH`にあって`codex login status`が成功すればCodex、そうでなければClaudeを選ぶ。Codexが入っていないクラウドセッションでは、Claudeになる。

モデルと推論の強さは、レビューする側ごとの環境変数で指定する。空の値は、設定しないのと同じに扱う。

| 環境変数 | 渡し方 | 設定しないとき |
|---|---|---|
| `PLAN_REVIEW_REVIEWER` | `codex`、`claude`、`auto`のどれか | `auto` |
| `PLAN_REVIEW_CODEX_MODEL` | `codex exec -m <値>` | `gpt-6.1-sol` |
| `PLAN_REVIEW_CODEX_EFFORT` | `codex exec -c model_reasoning_effort=<値>` | `high` |
| `PLAN_REVIEW_CLAUDE_MODEL` | `claude -p --model <値>` | `opus`（Claude Codeの別名で、最新のOpusを指す） |
| `PLAN_REVIEW_CLAUDE_EFFORT` | `claude -p --effort <値>` | `high` |

- Codexの推論の強さは`-c`で渡すので、`~/.codex/config.toml`の`model_reasoning_effort`より優先される。`plan-review`以外でのCodexの使い方には影響しない
- Codexの既定の`gpt-6.1-sol`は、Codex CLI 0.164.0の既定のモデルである。CLIの既定に任せないのは、CLIが古いと古いモデルになり、推論の強さも`gpt-6.1-sol`の既定の`low`になるからである。より深くレビューさせたいときは、`gpt-6-astra`を指定する
- `gpt-6.1-sol`を知らない古いCLIで動くかは確かめていない。動かなければ、CLIを更新するか、`PLAN_REVIEW_CODEX_MODEL`で使えるモデルを指定する
- 実際に使った値は、レビューのたびに「使ったモデル」として表示され、`rNN_review.log`の見出し（`model:`と`reasoning effort:`の行）にも残る
- Claudeのモデルには、別名（`opus`、`sonnet`、`fable`）か、モデルの名前（`claude-opus-5-5`など）を書ける。Planを書いたセッションと違う系統のモデルでレビューさせたいときは、`fable`を指定する
- 前の版の`PLAN_REVIEW_MODEL`と`PLAN_REVIEW_EFFORT`は読まない。設定されていると、新しい名前を案内する
- Claudeは、`--tools "Read,Grep,Glob" --restricted --strict-mcp-config`で呼ぶ。読むツールだけを使い、利用者とプロジェクトの設定ファイル（hooksや許可の設定）とMCPサーバーを読み込まず、ファイルは作業ディレクトリの中だけを読む。リポジトリの`CLAUDE.md`も、最初には読み込まない（必要ならReadで読める）。Claude Code 2.1.302で確かめた。`--restricted`の無い古い版では`claude`が失敗するので、Claude Codeを更新する
- `--restricted`は利用者の設定ファイルを読まないので、`settings.json`の`apiKeyHelper`など、設定ファイルで認証しているときは`claude`が認証に失敗するおそれがある（確かめていない）。そのときは、設定ファイルによらない認証（Claude Codeへのログインなど）にするか、`--reviewer codex`を使う。Claude Codeのクラウドセッションでは動くことを確かめた

常に同じ値を使うときは、手元ではClaude Codeの`settings.json`の`env`に書く。クラウドセッションでは、環境の設定の環境変数に書く。

```json
{
  "env": {
    "PLAN_REVIEW_REVIEWER": "claude",
    "PLAN_REVIEW_CLAUDE_MODEL": "fable",
    "PLAN_REVIEW_CODEX_MODEL": "gpt-6-astra"
  }
}
```

使えるモデルと推論の強さは、CLIの版とアカウントによって変わる。使えない値を設定したり、利用上限に達したりすると、レビューする側が0以外で終わり、エラーの文面が`rNN_review.log`に残る。このとき、設定されている環境変数の値もあわせて表示される。

## .gitignoreの推奨設定

```gitignore
plan/.reviews/
```

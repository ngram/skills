---
name: plan-review
description: plan/ 配下の Plan ファイルを Codex にレビューさせ、履歴を plan/.reviews/ に蓄積して diff を表示する。ユーザーが /plan-review と明示的に指示したときだけ使う。
argument-hint: "[plan-file-name]"
disable-model-invocation: true
compatibility: Claude Code向け（引数の置換とdisable-model-invocationを使う）。手元のbashとcodex CLIが必要で、claude.aiはサポート外
license: MIT
metadata:
  claude-ai: unsupported
---

# /plan-review — Plan を Codex でレビューしてdiffを表示する

## 概要

`plan/` フォルダ内のPlanファイルを Codex にレビューさせる。
レビュー履歴は `plan/.reviews/<ファイル名>/r01_*`, `r02_*` ... の形式で蓄積される。
同じPlanを何度レビューしても履歴が上書きされず、回数ごとに追記される。

VSCode の `code` CLI が使える環境では、レビュー結果（`rNN_codex.md`）と
「最初の Plan（`r01_before.md`）↔ 最終 Plan」の差分ビューを**自動で editor に開く**
（Plan 作成時に md が自動表示されるのと同じ体験）。`code` が無い環境では黙ってスキップする。

## ディレクトリ構造

```
plan/
├── 20250621_my-feature.md          ← 常にこれが「現在のPlan」（Claudeが編集する）
└── .reviews/
    └── 20250621_my-feature/
        ├── r01_before.md           ← 1回目レビュー開始時点のスナップショット
        ├── r01_codex.md            ← 1回目Codexレビュー結果
        ├── r02_before.md           ← 2回目レビュー開始時点のスナップショット
        └── r02_codex.md            ← 2回目Codexレビュー結果
```

## 手順

### ステップ1: 対象ファイルを特定する

まず `plan/` ディレクトリが存在するか確認する。存在しない場合はその旨を伝えて中断する。

```bash
if [ ! -d "plan" ]; then
  echo "エラー: plan/ ディレクトリが見つかりません。プロジェクトルートで実行しているか確認してください。"
  exit 1
fi
```

`$ARGUMENTS` が渡されていればそのファイル名として扱う（拡張子 `.md` は省略可）。
渡されていない場合は `plan/` 内の `YYYYMMDD_*.md` を更新日時降順で取得し、
最新1件を自動選択する。複数ある場合は自動選択したファイル名をユーザーに伝えてから進む。

```bash
# 引数なしの場合
PLAN_FILE=$(ls -t plan/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.md 2>/dev/null | head -1)
```

`codex` コマンドがPATHに存在しない場合はその旨をユーザーに伝えて中断する。

### ステップ2: レビュー回数を決定してディレクトリを準備する

ファイル名（拡張子なし）をキーにレビューディレクトリを作成し、
既存の `rNN_before.md` の最大番号を調べて次の番号を決める。

```bash
PLAN_BASENAME=$(basename "$PLAN_FILE" .md)
REVIEW_DIR="plan/.reviews/${PLAN_BASENAME}"
mkdir -p "$REVIEW_DIR"

# 既存レビュー数をカウントして次の番号を決定
EXISTING=$(ls "$REVIEW_DIR"/r[0-9][0-9]_before.md 2>/dev/null | wc -l)
ROUND=$(printf "%02d" $((EXISTING + 1)))

echo "レビュー対象: $PLAN_FILE"
echo "今回のラウンド: r${ROUND}"
```

### ステップ3: レビュー前スナップショットを保存する

```bash
BEFORE="${REVIEW_DIR}/r${ROUND}_before.md"
cp "$PLAN_FILE" "$BEFORE"
echo "スナップショット保存: $BEFORE"
```

### ステップ4: Codex でレビューを実行する

```bash
CODEX_OUT="${REVIEW_DIR}/r${ROUND}_codex.md"

# プロンプトは引数ではなく一時ファイル経由で標準入力から渡す。
# 引数で渡すと、長いPlanでWindowsのコマンドラインの長さの上限を超える。
PROMPT_FILE="$(mktemp)" || exit 1
trap 'rm -f "$PROMPT_FILE"' EXIT

# 区切りを 'EOF' と引用符で囲み、文面の $ やバッククォートを展開させない。
{
cat <<'EOF'
あなたはソフトウェア設計のレビュアーです。
以下のPlanドキュメントを読み、技術的な問題点・曖昧さ・抜け漏れを具体的に指摘してください。

【レビュー観点】
- 要件や目的が明確か
- 技術的な実現可能性に問題がないか
- エラーハンドリング・エッジケースの考慮があるか
- 依存関係・順序関係に矛盾がないか
- セキュリティ・パフォーマンス上のリスクがないか

【Planの内容】
EOF
cat "$PLAN_FILE"
cat <<'EOF'

【出力形式】
指摘事項を番号付きリストで記載すること。
最後の行は必ず以下のいずれかで終わること：
VERDICT: APPROVED
VERDICT: REVISE
EOF
} > "$PROMPT_FILE"

# モデルと推論の強さは、環境変数で指定されたときだけ渡す。無ければ Codex CLI の既定値を使う。
# 空の値を -m "" のように渡さないよう、引数を配列に積む。
CODEX_ARGS=(exec -s read-only)
if [ -n "${PLAN_REVIEW_MODEL:-}" ]; then
  CODEX_ARGS+=(-m "$PLAN_REVIEW_MODEL")
fi
if [ -n "${PLAN_REVIEW_EFFORT:-}" ]; then
  CODEX_ARGS+=(-c "model_reasoning_effort=$PLAN_REVIEW_EFFORT")
fi

codex "${CODEX_ARGS[@]}" - < "$PROMPT_FILE" > "$CODEX_OUT" 2>&1
CODEX_STATUS=$?

echo "=== Codex レビュー結果 (r${ROUND}) ==="
cat "$CODEX_OUT"

# 使ったモデルと推論の強さは、codex が標準エラー出力に書く見出しから取り出す。
echo "=== 使用したモデル ==="
grep -m 2 -E '^(model|reasoning effort): ' "$CODEX_OUT" || echo "（見出しにモデルの行がありません）"

# 失敗したときは、環境変数が原因かどうかを見分けられるように値を示す。
if [ "$CODEX_STATUS" -ne 0 ]; then
  echo "=== codex が終了コード ${CODEX_STATUS} で終わりました ==="
  echo "PLAN_REVIEW_MODEL : ${PLAN_REVIEW_MODEL:-（未設定）}"
  echo "PLAN_REVIEW_EFFORT: ${PLAN_REVIEW_EFFORT:-（未設定）}"
fi

# IDE にレビュー結果を自動表示する（VSCode の code CLI があれば editor で開く）。
# Plan 作成時に md が自動で開くのと同じ体験。code が無い環境（headless/cron 等）は黙ってスキップ。
if command -v code >/dev/null 2>&1; then
  code -r "$CODEX_OUT" 2>/dev/null || true
fi
```

### ステップ5: VERDICTを確認する

```bash
tail -3 "$CODEX_OUT"
```

- **VERDICT: APPROVED** → ステップ6へ進む
- **VERDICT: REVISE** → ステップ5aへ進む
- VERDICTが取得できない場合はユーザーに確認を求める

#### ステップ5a: 指摘をもとにPlanを修正する（REVISE時のみ）

`$CODEX_OUT` に記載された指摘事項をもとに `$PLAN_FILE` を修正する。
修正はClaudeが直接 `$PLAN_FILE` を編集する（`.reviews/` 内のファイルは変更しない）。

修正完了後、**ステップ3に戻り `ROUND` をインクリメントして繰り返す**。
ただし合計3ラウンドを超えた場合はユーザーに判断を委ねて中断する。

### ステップ6: diff を表示して完了する

今回のラウンドのスナップショットと現在のPlanを比較する：

```bash
echo ""
echo "=== diff (r${ROUND}_before → 現在) ==="
diff "$BEFORE" "$PLAN_FILE" || true

echo ""
echo "=== レビュー完了 ==="
echo "Planファイル    : $PLAN_FILE"
echo "スナップショット: $BEFORE"
echo "Codex結果       : $CODEX_OUT"
echo "履歴ディレクトリ: $REVIEW_DIR"
grep -m 2 -E '^(model|reasoning effort): ' "$CODEX_OUT" | sed 's/^/Codex /'

# 最終レビュー結果と、最初の Plan ↔ 最終 Plan の差分を VSCode に自動表示する。
# （code CLI がある場合のみ。最初のスナップショットは r01_before.md）
if command -v code >/dev/null 2>&1; then
  code -r "$CODEX_OUT" 2>/dev/null || true
  FIRST="${REVIEW_DIR}/r01_before.md"
  if [ -f "$FIRST" ]; then
    code --diff "$FIRST" "$PLAN_FILE" 2>/dev/null || true
  fi
fi
```

変更がなかった場合（初回でAPPROVEDの場合）はその旨を伝える。

## 使用例

```
# 最新のPlanを自動選択してレビュー
/plan-review

# ファイル名を指定（plan/ プレフィックス・.md 拡張子は省略可）
/plan-review 20250621_my-feature
/plan-review plan/20250621_my-feature.md
```

## Codexのモデルと推論の強さ

既定では、モデルも推論の強さも指定せずに`codex exec`を実行する。どちらもCodex CLIの既定値になるので、CLIを更新すると変わることがある。実際に使った値は、レビューのたびに「使用したモデル」として表示され、`rNN_codex.md`の見出し（`model:`と`reasoning effort:`の行）にも残る。

レビューに使う値を決めたいときは、次の環境変数を設定する。空の値は、設定しないのと同じに扱う。

| 環境変数 | Codexへの渡し方 | 設定しないとき |
|---|---|---|
| `PLAN_REVIEW_MODEL` | `-m <値>` | CLIの既定のモデル |
| `PLAN_REVIEW_EFFORT` | `-c model_reasoning_effort=<値>` | CLIの既定の推論の強さ |

`-c`で渡すので、`~/.codex/config.toml`の`model_reasoning_effort`より優先される。`plan-review`以外のCodexの使い方には影響しない。

常に同じ値を使うときは、Claude Codeの`settings.json`の`env`に書く。

```json
{
  "env": {
    "PLAN_REVIEW_MODEL": "gpt-6.1-sol",
    "PLAN_REVIEW_EFFORT": "high"
  }
}
```

使えるモデルと推論の強さは、Codex CLIの版とアカウントによって変わる。使えない値を設定すると`codex`が0以外で終わり、エラーの文面が`rNN_codex.md`に残る。このとき、設定されている環境変数の値もあわせて表示される。

## .gitignore 推奨設定

```gitignore
plan/.reviews/
```

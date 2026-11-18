<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->
# plan-dispatch

> Planやタスクの説明の、複数のClaude Codeのセッションへの振り分け。リーダーのセッションがタスクに切り分け、利用者がVS Code拡張などで開いた新しいタブのセッションを見つけてワーカーとして招待し、セッション間のメッセージ（ListAgentsとSendMessage）でタスクを1つずつ割り当てて、完了の報告を受ける。チームとタスクの状態はplan/.dispatch/のファイルに残す。ユーザーが/plan-dispatchと明示的に指示したときだけ使う。

必要なもの：Claude Code（同じマシンのセッション間のメッセージを使う。ネイティブのWindowsではv2.1.234以降）が前提。claude.aiのチャットは対象外

## インストール

### Claude Code・Claude Desktop（プラグイン）

```text
/plugin marketplace add ngram/skills
/plugin install plan-dispatch@ngram-skills
```

導入後は`/plan-dispatch:plan-dispatch`で呼び出せる。

### claude.ai（Cowork・クラウドセッション）

[最新のリリース](https://github.com/ngram/skills/releases/latest)に添付した`plan-dispatch.skill`を、claude.aiに入れる。最新版は次のURLで取得できる。

```text
https://github.com/ngram/skills/releases/latest/download/plan-dispatch.skill
```

入れ方は次の2つ。

- Claudeのセッションで、Claudeにこの`.skill`をファイルとして渡してもらい、ファイルのカードの「Save skill」を押す
- claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。`.skill`を選べないときは、拡張子を`.zip`に変える（中身はZIP）

claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`を同じ方法で入れ直す。

### GitHub CLI（gh skill、gh 2.90以降）

```bash
gh skill install ngram/skills plan-dispatch --agent claude-code --scope user
```

`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。

### APM

```bash
apm install -g ngram/skills/plan-dispatch
```

プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。

```yaml
dependencies:
  apm:
    - ngram/skills/plan-dispatch
```

### skills CLI（npx skills）

```bash
npx skills add ngram/skills --skill plan-dispatch
```

### フォルダを直接コピーする

```bash
npx degit ngram/skills/plan-dispatch ~/.claude/skills/plan-dispatch
```

Skillの内容は[SKILL.md](./SKILL.md)にある。
<!-- skills:readme:end -->

## 使い方（VS Code拡張）

1. Planを用意する。`plan-create`で書き、`plan-review`でレビューしたPlanを使える。Planの代わりに、タスクの説明を文で渡してもよい
2. リーダーにするタブで、`/plan-dispatch plan/20261115_my-feature.md`を送る。claude.aiから同期して入れたときは`/anthropic-skills:plan-dispatch`、プラグインで入れたときは`/plan-dispatch:plan-dispatch`と入力する
3. リーダーが示した数だけ、同じVS Codeのウィンドウで、「Claude Code: Open in New Tab」で新しいタブを開く。開いたタブには何も入力しない
4. リーダーのタブで「開いた」と伝える。リーダーが、新しいタブのセッション名とワーカーID（`W01`…）の対応を示すので、確認して招待してよいと答える
5. ワーカーのタブで権限の確認が出たら、そのタブで応える。リーダーが代わりに承認することはできない
6. すべてのタスクが終わると、リーダーが全体のテストを実行し、結果をまとめる。コミットは、頼んだときだけ行う

新しいタブに参加のコマンドを入力して参加させることもできる。コマンドは、リーダーが手順3で示す（`/plan-dispatch join <チームID> W01 <リーダー名>`の形）。

## 注意

- すべてのタブを、権限の確認を省かないモード（`bypassPermissions`以外）で動かす。省くモードのタブとの間では、メッセージが届かない
- チームの状態は`plan/.dispatch/`に置かれる。コミットしないよう、`.gitignore`に`plan/.dispatch/`を入れる
- 同時に動かすセッションの数の上限は、既定で10。`--max-agents 3`の引数か、環境変数`PLAN_DISPATCH_MAX_AGENTS`で変えられる。常に同じ値を使うときは、Claude Codeの`settings.json`の`env`に書く
- 動かすセッションの数に応じて、トークンの使用量が増える
- 進みが止まって見えたら、リーダーのタブで「状況を確かめて」と頼む。リーダーは、メッセージを受けたときにしか動かないので、ワーカーのタブが閉じたことなどに自分では気付けない
- メッセージが届かなかったときは、リーダーかワーカーのタブで「チームのファイルを読んで続けて」と頼む
- ワーカーのタブを閉じても、そのセッションはしばらく残ってから終わる。担当のタスクは、リーダーが次に動いたときに未完了に戻す

## 進捗の表示

mod[plan-dispatch-view](../mods/plan-dispatch-view/)を入れると、チームの進捗（ワーカーとタスクの状態、全体の進み具合）を、チャットパネルの横のペインに表示できる。modが無くても、Skillは同じように動く。

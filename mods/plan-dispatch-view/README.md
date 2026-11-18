# plan-dispatch-view

Skill[plan-dispatch](../../plan-dispatch/)のチームの進捗を、Claude Codeのペインに表示するmod。
チームの状態のファイル（`plan/.dispatch/<チームID>/team.json`）を数秒ごとに読み、ワーカーの状態と担当中のタスク、タスクごとの状態、全体の進み具合を表示する。

表示だけを行い、ファイルを書かず、ネットワークにも接続しない。ペインからタスクを割り当てるなどの操作はできない。

## 必要なもの

- Claude Code。VS Code拡張で表示するときは、拡張機能のバージョン2.1.299以降
- Skill`plan-dispatch`（このmodは、Skillが書いた`team.json`を読むだけである）

## インストール

Claude CodeのCLIでは、プロンプトに次を入力する。

```text
/plugin marketplace add ngram/skills
/plugin install plan-dispatch-view@ngram-skills
```

VS Code拡張のプロンプトでは`/plugin`を使えないので、ターミナルで次を実行する。ターミナルで入れたプラグインは、VS Code拡張でも読み込まれる。既に開いているタブにペインのコマンドが出ないときは、VS Codeのウィンドウを再読み込みする。

```bash
claude plugin marketplace add ngram/skills
claude plugin install plan-dispatch-view@ngram-skills
```

modは、利用者の権限で動くコードである。入れる前に中身を確かめるときは、リポジトリを手元に置いて`claude plugin validate mods/plan-dispatch-view`を実行する。modが呼ぶAPI（ファイルの読み取り、タイマー、ペイン、コマンド、状態）と、使うフック（`session.start`、`command.run`、`prompt.submit`、`ui.close`、`ui.render`）が表示される。

## 使い方

- `/plan-dispatch-view`で、ペインを開く
- 自動で開く設定（`autoOpen`）が有効なら、`/plan-dispatch`（`/plan-dispatch:plan-dispatch`、`/anthropic-skills:plan-dispatch`も同じ）を呼んだタブで、ペインが自動で開く。参加のコマンド（`/plan-dispatch join <チームID> …`）で参加したタブでは、そのチームを表示する
- 招待で参加したワーカーのタブでは、Skillを呼ばないので自動では開かない。`/plan-dispatch-view`で開く

VS Code拡張では、チャットパネルの幅が800ピクセル以上ならペインが会話の横に、それより狭ければプロンプトの上に出る。狭いときは、要約（ワーカーの数、完了したタスクの数など）だけを表示する。

`plan/.dispatch/`の下に複数のチームがあるときは、`team.json`の更新時刻が最も新しいチームを表示する。

## 設定

自動で開く設定（`autoOpen`、既定は有効）は、`/config`の画面に行として出るので、そこで変えられる。値は`settings.json`の`pluginConfigs`に保存される。

## 表示が出ないとき

- 「チームがありません」：`plan/.dispatch/`に`team.json`がまだ無い。リーダーがチームを作ると表示される
- 「modを更新してください」：Skillが書いた`team.json`の版に、このmodが対応していない。modを入れ直す
- ペインが出ない：VS Code拡張のバージョンが2.1.299より前だと、modは描画されない。Skillの動作には影響しない

## ライセンス

MIT（リポジトリの[LICENSE](../../LICENSE)）

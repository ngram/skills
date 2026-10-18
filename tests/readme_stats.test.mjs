// readme-writing/scripts/readme_stats.mjs の動作確認。node --test tests/*.test.mjs で実行する。
// tests/fixtures/temoto/README.md は ngram/temoto の README の写し（出典は同じディレクトリの SOURCE.md）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "readme-writing", "scripts", "readme_stats.mjs");
const TEMOTO = join(ROOT, "tests", "fixtures", "temoto", "README.md");

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { ...r, json: r.status !== 2 && args.includes("--json") ? JSON.parse(r.stdout) : null };
}

// ファイルを置いた一時的なリポジトリ（.git のあるディレクトリ）を作る。
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "readme-stats-"));
  mkdirSync(join(dir, ".git"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const prose = (n, word = "説明の文") => Array.from({ length: n }, (_, i) => `${word}${i + 1}。`).join("\n");

test("temoto の README を計り、予算の超過を示して終了コード1", () => {
  const r = run("--json", "--no-config", TEMOTO);
  assert.equal(r.status, 1, r.stderr);
  const { stats, sections, budget, problems } = r.json;
  assert.equal(stats.lines, 764);
  assert.equal(stats.proseLines, 253);
  assert.deepEqual(stats.headings, { 1: 1, 2: 9, 3: 23, 4: 17 });
  assert.equal(stats.codeBlocks, 40);
  assert.deepEqual(budget.maxLines, { value: 200, source: "既定（standard）" });
  assert.deepEqual(budget.maxProseLines, { value: 60, source: "全体の上限の30%" });
  const byTitle = Object.fromEntries(sections.map((s) => [s.title, s]));
  assert.equal(byTitle["セットアップ"].lines, 133);
  assert.equal(byTitle["使い方"].lines, 319);
  assert.equal(byTitle["使い方"].limit, null, "使い方の節には節の上限をかけない");
  const messages = problems.map((p) => p.message);
  assert.ok(messages.includes("全体が764行で、上限の200行を超えている"));
  assert.ok(messages.includes("節「セットアップ」が133行で、上限の60行を超えている"));
  assert.ok(!messages.some((m) => m.includes("節「使い方」")));
  assert.ok(messages.some((m) => m.startsWith("H4以下の見出しが17個ある")));
});

test("コードブロックの中の # は見出しと数えず、字下げのコードと箇条書きの続きを見分ける", () => {
  const dir = repo({
    "README.md": [
      "# 名前",
      "",
      "```sh",
      "# コメント",
      "## これも見出しではない",
      "```",
      "",
      "1. 手順",
      "",
      "   続きの文。",
      "",
      "        $ go install example.com/x@latest",
      "",
      "Homebrew でも入る。",
      "",
      "    % brew install x",
      "",
      "Setext の見出し",
      "---------------",
      "",
      "本文。",
      "",
    ].join("\n"),
  });
  const r = run("--json", join(dir, "README.md"));
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.json.stats.headings, { 1: 1, 2: 1 });
  assert.equal(r.json.stats.codeBlocks, 3);
  assert.equal(r.json.stats.proseLines, 4);
  assert.deepEqual(r.json.sections.map((s) => s.title), ["（冒頭）", "Setext の見出し"]);
});

test("予算は既定、設定ファイル、オプションの順に上書きし、出どころを示す", () => {
  const dir = repo({ "README.md": `# 名前\n\n${prose(130)}\n` });
  const readme = join(dir, "README.md");
  let r = run("--json", readme);
  assert.equal(r.json.budget.maxLines.source, "既定（standard）");

  writeFileSync(join(dir, ".readme-budget.json"), JSON.stringify({ preset: "small", reason: "小さなツールのため" }));
  r = run("--json", readme);
  assert.deepEqual(r.json.budget.maxLines, { value: 120, source: "設定ファイル（preset: small）" });
  assert.equal(r.json.config.reason, "小さなツールのため");
  assert.equal(r.status, 1, "132行は small の上限120行を超える");

  writeFileSync(join(dir, ".readme-budget.json"), JSON.stringify({ preset: "small", maxLines: 250, maxProseLines: 150 }));
  r = run("--json", readme);
  assert.deepEqual(r.json.budget.maxLines, { value: 250, source: "設定ファイル" });
  assert.deepEqual(r.json.budget.maxSectionLines, { value: 75, source: "全体の上限の30%" });
  assert.deepEqual(r.json.budget.maxProseWidth, { value: 12000, source: "地の文の上限×80桁" });
  assert.equal(r.status, 0, r.stdout);

  r = run("--json", "--max-lines", "100", readme);
  assert.deepEqual(r.json.budget.maxLines, { value: 100, source: "オプション" });
  assert.deepEqual(r.json.budget.maxProseLines, { value: 150, source: "設定ファイル" });

  r = run("--json", "--preset", "large", readme);
  assert.deepEqual(r.json.budget.maxLines, { value: 300, source: "オプション（--preset large）" });

  r = run("--json", "--no-config", readme);
  assert.equal(r.json.config, null);
  assert.equal(r.json.budget.maxLines.source, "既定（standard）");
});

test("設定ファイルの sections と keep で、節ごとの上限を変える", () => {
  const dir = repo({
    "README.md": `# 名前\n\n## 使い方\n\n${prose(70)}\n\n## 検索構文\n\n${prose(70)}\n\n## 設定\n\n${prose(70)}\n\n## 開発\n\n${prose(70)}\n`,
    ".readme-budget.json": JSON.stringify({ maxLines: 400, maxProseLines: 400, keep: ["検索構文", "無い節"], sections: { 設定: 80, 無い節2: null } }),
  });
  const r = run("--json", join(dir, "README.md"));
  const byTitle = Object.fromEntries(r.json.sections.map((s) => [s.title, s]));
  assert.equal(byTitle["使い方"].limit, null);
  assert.deepEqual([byTitle["検索構文"].limit, byTitle["検索構文"].limitSource], [null, "設定ファイル（keep）"]);
  assert.deepEqual([byTitle["設定"].limit, byTitle["設定"].limitSource], [80, "設定ファイル（sections）"]);
  assert.equal(byTitle["開発"].limit, 120);
  assert.ok(r.json.longSections.find((s) => s.path === "検索構文").keep);
  const errors = r.json.problems.filter((p) => p.severity === "error").map((p) => p.message);
  assert.deepEqual(errors, []);
  const warns = r.json.problems.filter((p) => p.severity === "warn").map((p) => p.message);
  assert.ok(warns.some((m) => m.includes("keep の「無い節」")));
  assert.ok(warns.some((m) => m.includes("sections の「無い節2」")));
  assert.equal(r.status, 0);
});

test("相対リンクのファイルとアンカーを確かめ、リポジトリの外を指すリンクは確かめない", () => {
  const dir = repo({
    "README.md": [
      "# 名前",
      "",
      "- [設定](docs/setup.md#ocrをセットアップする省略可)",
      "- [無いアンカー](docs/setup.md#no-such)",
      "- [無いファイル](docs/missing.md)",
      "- [この中](#使い方)",
      "- [Issues](../../issues)",
      "- [外部](https://example.com/x)",
      "- `[コードの中](nope.md)`",
      "",
      "## 使い方",
      "",
      "本文。",
      "",
    ].join("\n"),
    "docs/setup.md": "# 設定\n\n## OCRをセットアップする（省略可）\n\n[戻る](../README.md#使い方)\n[壊れた](scripts/x.ps1)\n",
  });
  const r = run("--json", join(dir, "README.md"), join(dir, "docs", "setup.md"));
  assert.equal(r.status, 1);
  // at は OS のパスのまま返るので、Windows の \ 区切りを / にそろえて比べる。
  const links = r.json.problems.map((p) => `${p.at.slice(dir.length + 1).split(sep).join("/")} ${p.message}`);
  assert.deepEqual(links.sort(), [
    "README.md:4 アンカー「#no-such」が「docs/setup.md」に無い",
    "README.md:5 リンク先「docs/missing.md」が無い",
    "docs/setup.md:6 リンク先「scripts/x.ps1」が無い",
  ]);
});

test("--moved-from で、前の README のコードブロック、インラインコード、URL が残っているかを確かめる", () => {
  const old = [
    "# 名前",
    "",
    "`TEMOTO_DATA`で場所を変える。詳しくは<https://example.com/doc>。",
    "",
    "```sh",
    "$ temoto sync",
    "temoto server --addr :8366",
    "```",
    "",
    "## 古い見出し",
    "",
    "本文。",
    "",
  ].join("\n");
  const dir = repo({
    "old.md": old,
    "README.md": "# 名前\n\n```sh\ntemoto sync\n```\n\n詳しくは[docs](docs/usage.md)。\n",
    "docs/usage.md": "# 使い方\n\n`TEMOTO_DATA`で場所を変える。\n",
  });
  const files = [join(dir, "README.md"), join(dir, "docs", "usage.md")];
  let r = run("--json", "--moved-from", join(dir, "old.md"), ...files);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json.movedFrom.codeBlocks.map((b) => b.missing), [["temoto server --addr :8366"]]);
  assert.deepEqual(r.json.movedFrom.codeSpans, []);
  assert.deepEqual(r.json.movedFrom.urls, ["https://example.com/doc"]);
  assert.deepEqual(r.json.movedFrom.headings.map((h) => h.title), ["古い見出し"]);

  writeFileSync(files[1], `${readFileSync(files[1], "utf8")}\n\`\`\`sh\ntemoto server --addr :8366\n\`\`\`\n\n<https://example.com/doc>\n`);
  r = run("--json", "--moved-from", join(dir, "old.md"), ...files);
  assert.equal(r.status, 0, JSON.stringify(r.json.problems));
  assert.equal(r.json.problems.filter((p) => p.severity === "warn").length, 1, "見出しは注意だけで、終了コードに含めない");
});

test("長いコードブロックは注意だけで、終了コードに含めない", () => {
  const dir = repo({ "README.md": `# 名前\n\n\`\`\`text\n${prose(20, "line")}\n\`\`\`\n` });
  const r = run("--json", join(dir, "README.md"));
  assert.equal(r.status, 0);
  assert.equal(r.json.problems[0].severity, "warn");
  assert.match(r.json.problems[0].message, /コードブロックが20行/);
});

test("使い方と設定ファイルの誤りは終了コード2", () => {
  const dir = repo({ "README.md": "# 名前\n" });
  const readme = join(dir, "README.md");
  assert.equal(run().status, 2);
  assert.equal(run("--unknown", readme).status, 2);
  assert.equal(run("--max-lines", "0", readme).status, 2);
  assert.equal(run("--preset", "huge", readme).status, 2);
  assert.equal(run(join(dir, "missing.md")).status, 2);
  assert.equal(run("--config", join(dir, "missing.json"), readme).status, 2);
  for (const config of ["{", "[]", '{"maxLine": 100}', '{"maxLines": "100"}', '{"preset": "huge"}', '{"keep": "x"}', '{"sections": {"a": 0}}']) {
    writeFileSync(join(dir, ".readme-budget.json"), config);
    const r = run(readme);
    assert.equal(r.status, 2, config);
    assert.match(r.stderr, /\.readme-budget\.json/u);
  }
  assert.equal(run("--help").status, 0);
});

test("全角の範囲の表は check_message.mjs と同じ", () => {
  const table = (file) => readFileSync(join(ROOT, file), "utf8").match(/const WIDE_RANGES = \[([\s\S]*?)\];/u)[1];
  assert.equal(table("readme-writing/scripts/readme_stats.mjs"), table("git-commit/scripts/check_message.mjs"));
});

test("日本語の箇条書き、番号付きの手順、表のセルの体言止めを確かめ、自動生成のブロックとコードブロックは見ない", () => {
  const dir = repo({
    "README.md": [
      "# 名前",
      "",
      "## 使い方",
      "",
      "- 設定ファイルの作成",
      "- 設定ファイルを作る",
      "1. `npm test`の実行（CIでも実行する）",
      "2. テストを通す。",
      "- [開発の手順](docs/development.md)",
      "- Install with `go install`",
      "",
      "| 経路 | 入れ方 |",
      "| --- | --- |",
      "| npm | `npm install`での導入 |",
      "| 手元 | フォルダをコピーする |",
      "",
      "<!-- skills:list:begin（生成する） -->",
      "- 生成された項目を手で直さない",
      "<!-- skills:list:end -->",
      "",
      "```sh",
      "- コードの中は見ない",
      "```",
      "",
    ].join("\n"),
    "docs/development.md": "# 開発\n",
  });
  const r = run("--json", join(dir, "README.md"));
  assert.equal(r.status, 1);
  const found = r.json.problems.filter((p) => p.message.includes("体言止め")).map((p) => `${p.at.slice(dir.length + 1)} ${p.message}`);
  assert.deepEqual(found, [
    "README.md:6 箇条書きが体言止めになっていない（「…を作る」で終わる）",
    "README.md:8 箇条書きが体言止めになっていない（「…を通す」で終わる）",
    "README.md:15 表のセルが体言止めになっていない（「…ーする」で終わる）",
  ]);
});

test("体言止めの判定の表と関数は check_message.mjs と同じ", () => {
  const read = (file) => readFileSync(join(ROOT, file), "utf8");
  const pick = (text) => [
    ...["PREDICATE_END", "NOUN_END", "TRAILER"].map((name) => text.match(new RegExp(`^const ${name} = .*$`, "mu"))[0]),
    text.match(/^function predicateEnding[\s\S]*?^\}$/mu)[0],
  ];
  assert.deepEqual(pick(read("readme-writing/scripts/readme_stats.mjs")), pick(read("git-commit/scripts/check_message.mjs")));
});

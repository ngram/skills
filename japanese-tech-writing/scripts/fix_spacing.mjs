#!/usr/bin/env node
// Markdown の原稿の、日本語（全角文字）と半角の語の間の空白を検査し、--fix で除く。
// 依存パッケージは無く、Node.js 18 以降の標準機能だけで動く。
//
// 使い方: node fix_spacing.mjs [--fix] <ファイル>...
//
// 除く空白（--fix）:
//   - 全角文字と英数字の間（「Claude Code の設定」→「Claude Codeの設定」）。textlint の
//     ja-space-between-half-and-full-width（空白を入れない設定）に当たる
//   - 全角文字とインラインコードの間（「`git log` で」→「`git log`で」）。textlint の ja-space-around-code に当たる
// 場所を示すだけの空白:
//   - 全角文字と、記号で始まる（または終わる）半角の語の間（「テンプレート .gitmessage」「./internal/... の」）。
//     空白を取ると読みにくくなることがあるので、取るか「テンプレート（.gitmessage）」のように括弧で示すかを人が決める。
//     git-commit スキルの check_message.mjs と同じ検査である
// 変えない箇所:
//   - ファイル先頭の frontmatter、コードブロック、インラインコードの中
//   - URL の前後（空白を除くと、URL の自動リンクの範囲が変わる）
//   - 行頭の引用、箇条書き、番号、見出しの記号の後ろ
//   - 表の区切り（|）と強調の記号（* _ ~）の隣（空白を除くと、Markdown の解釈が変わることがある）
//   - HTML のコメントの区切り（<!-- と -->）の隣
//
// 空白が残っていれば、その箇所を示して終了コード1で終わる。--fix のときは、除いた後に残った箇所を示す。
// 改行（LF か CRLF）と先頭の BOM は、読み込んだときのまま書き戻す。

import { readFileSync, writeFileSync } from "node:fs";

const USAGE = "使い方: node fix_spacing.mjs [--fix] <ファイル>...";
const BOM = 0xfeff;

// 行頭の書式の記号（引用、箇条書き、タスクリスト、番号付きの箇条書き、見出し）。この後ろの空白は Markdown の書式に必要なので変えない。
const MARKER = /^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?/u;
// コードブロックの始まりと終わり。
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/u;
// インラインコード（同じ数のバッククォートで囲んだ部分）。
const CODE_SPAN = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)/gu;
const URL = /(?:https?|ftp):\/\/[^\s<>]+|www\.[^\s<>]+/gu;
const GAP = /[ \t]+/gu;
const ASCII = /^[!-~]$/u;
// 隣の空白を --fix で除く半角の文字。英数字と、インラインコードの端のバッククォート。
const FIXABLE = /^[A-Za-z0-9`]$/u;
// 隣の空白を変えない半角の記号と語。
const KEEP_NEXT_TO = new Set(["|", "*", "_", "~"]);
const KEEP_NEXT_TO_WORDS = new Set(["<!--", "-->"]);

// East Asian Width が W（全角）または F（Fullwidth）の範囲。git-commit スキルの check_message.mjs と同じ表である。
const WIDE_RANGES = [
  [0x1100, 0x115F], [0x231A, 0x231B], [0x2329, 0x232A], [0x23E9, 0x23EC], [0x23F0, 0x23F0],
  [0x23F3, 0x23F3], [0x25FD, 0x25FE], [0x2614, 0x2615], [0x2648, 0x2653], [0x267F, 0x267F],
  [0x2693, 0x2693], [0x26A1, 0x26A1], [0x26AA, 0x26AB], [0x26BD, 0x26BE], [0x26C4, 0x26C5],
  [0x26CE, 0x26CE], [0x26D4, 0x26D4], [0x26EA, 0x26EA], [0x26F2, 0x26F3], [0x26F5, 0x26F5],
  [0x26FA, 0x26FA], [0x26FD, 0x26FD], [0x2705, 0x2705], [0x270A, 0x270B], [0x2728, 0x2728],
  [0x274C, 0x274C], [0x274E, 0x274E], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27B0, 0x27B0], [0x27BF, 0x27BF], [0x2B1B, 0x2B1C], [0x2B50, 0x2B50], [0x2B55, 0x2B55],
  [0x2E80, 0x2E99], [0x2E9B, 0x2EF3], [0x2F00, 0x2FD5], [0x2FF0, 0x303E], [0x3041, 0x3096],
  [0x3099, 0x30FF], [0x3105, 0x312F], [0x3131, 0x318E], [0x3190, 0x31E3], [0x31EF, 0x321E],
  [0x3220, 0x3247], [0x3250, 0x4DBF], [0x4E00, 0xA48C], [0xA490, 0xA4C6], [0xA960, 0xA97C],
  [0xAC00, 0xD7A3], [0xF900, 0xFAFF], [0xFE10, 0xFE19], [0xFE30, 0xFE52], [0xFE54, 0xFE66],
  [0xFE68, 0xFE6B], [0xFF01, 0xFF60], [0xFFE0, 0xFFE6], [0x16FE0, 0x16FE4], [0x16FF0, 0x16FF1],
  [0x17000, 0x187F7], [0x18800, 0x18CD5], [0x18D00, 0x18D08], [0x1AFF0, 0x1AFF3], [0x1AFF5, 0x1AFFB],
  [0x1AFFD, 0x1AFFE], [0x1B000, 0x1B122], [0x1B132, 0x1B132], [0x1B150, 0x1B152], [0x1B155, 0x1B155],
  [0x1B164, 0x1B167], [0x1B170, 0x1B2FB], [0x1F004, 0x1F004], [0x1F0CF, 0x1F0CF], [0x1F18E, 0x1F18E],
  [0x1F191, 0x1F19A], [0x1F200, 0x1F202], [0x1F210, 0x1F23B], [0x1F240, 0x1F248], [0x1F250, 0x1F251],
  [0x1F260, 0x1F265], [0x1F300, 0x1F320], [0x1F32D, 0x1F335], [0x1F337, 0x1F37C], [0x1F37E, 0x1F393],
  [0x1F3A0, 0x1F3CA], [0x1F3CF, 0x1F3D3], [0x1F3E0, 0x1F3F0], [0x1F3F4, 0x1F3F4], [0x1F3F8, 0x1F43E],
  [0x1F440, 0x1F440], [0x1F442, 0x1F4FC], [0x1F4FF, 0x1F53D], [0x1F54B, 0x1F54E], [0x1F550, 0x1F567],
  [0x1F57A, 0x1F57A], [0x1F595, 0x1F596], [0x1F5A4, 0x1F5A4], [0x1F5FB, 0x1F64F], [0x1F680, 0x1F6C5],
  [0x1F6CC, 0x1F6CC], [0x1F6D0, 0x1F6D2], [0x1F6D5, 0x1F6D7], [0x1F6DC, 0x1F6DF], [0x1F6EB, 0x1F6EC],
  [0x1F6F4, 0x1F6FC], [0x1F7E0, 0x1F7EB], [0x1F7F0, 0x1F7F0], [0x1F90C, 0x1F93A], [0x1F93C, 0x1F945],
  [0x1F947, 0x1F9FF], [0x1FA70, 0x1FA7C], [0x1FA80, 0x1FA88], [0x1FA90, 0x1FABD], [0x1FABF, 0x1FAC5],
  [0x1FACE, 0x1FADB], [0x1FAE0, 0x1FAE8], [0x1FAF0, 0x1FAF8], [0x20000, 0x2FFFD], [0x30000, 0x3FFFD],
];

function isFull(ch) {
  const cp = ch.codePointAt(0);
  let lo = 0;
  let hi = WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = WIDE_RANGES[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

// インラインコードの中身を、同じ長さの x に置き換える。位置を保ったまま、中身を検査の対象から外す。
function maskCode(line) {
  return line.replace(CODE_SPAN, (m, ticks) => ticks + "x".repeat(m.length - ticks.length * 2) + ticks);
}

// 位置 i の直前の1文字（サロゲートペアの文字も1文字として返す）。
function charBefore(s, i) {
  const cp = s.codePointAt(i - 1);
  if (i >= 2 && cp >= 0xdc00 && cp <= 0xdfff) return String.fromCodePoint(s.codePointAt(i - 2));
  return String.fromCodePoint(cp);
}

// 1行の中の、全角文字と半角の語の間の空白を探す。
function findGaps(line) {
  const masked = maskCode(line);
  const start = masked.match(MARKER)[0].length;
  const urls = [...masked.matchAll(URL)].map((m) => [m.index, m.index + m[0].length]);
  const inUrl = (i) => urls.some(([s, e]) => s <= i && i < e);
  const gaps = [];
  for (const m of masked.slice(start).matchAll(GAP)) {
    const i = start + m.index;
    const j = i + m[0].length;
    if (i === 0 || j >= masked.length) continue; // 行頭の字下げと行末の空白
    const left = charBefore(masked, i);
    const right = String.fromCodePoint(masked.codePointAt(j));
    let half;
    let at;
    let word;
    if (isFull(left) && ASCII.test(right)) {
      half = right;
      at = j;
      word = masked.slice(j).match(/^[!-~]+/u)[0];
    } else if (ASCII.test(left) && isFull(right)) {
      half = left;
      at = i - 1;
      word = masked.slice(0, i).match(/[!-~]+$/u)[0];
    } else {
      continue;
    }
    if (KEEP_NEXT_TO.has(half) || KEEP_NEXT_TO_WORDS.has(word) || inUrl(at)) continue;
    gaps.push({ start: i, end: j, fixable: FIXABLE.test(half) });
  }
  return gaps;
}

// 空白の前後の数文字を、報告用に切り出す。
function context(line, g) {
  const before = [...line.slice(0, g.start)].slice(-6).join("");
  const after = [...line.slice(g.end)].slice(0, 6).join("");
  return before + line.slice(g.start, g.end) + after;
}

function processText(text, fix) {
  const bom = text.charCodeAt(0) === BOM;
  const body = bom ? text.slice(1) : text;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r\n|\n/);
  const problems = [];
  let fixed = 0;
  let inFrontmatter = lines[0] === "---";
  let fence = null;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (inFrontmatter) {
      if (n > 0 && (line === "---" || line === "...")) inFrontmatter = false;
      continue;
    }
    const f = line.match(FENCE);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    let out = line;
    const gaps = findGaps(line);
    for (const g of [...gaps].reverse()) {
      if (fix && g.fixable) {
        out = out.slice(0, g.start) + out.slice(g.end);
        fixed += 1;
      }
    }
    for (const g of gaps) {
      if (!(fix && g.fixable)) problems.push({ line: n + 1, context: context(line, g), fixable: g.fixable });
    }
    lines[n] = out;
  }
  return { text: (bom ? String.fromCharCode(BOM) : "") + lines.join(eol), fixed, problems };
}

function main(argv) {
  const fix = argv.includes("--fix");
  const files = argv.filter((a) => a !== "--fix");
  if (files.length === 0) {
    console.log(USAGE);
    return 2;
  }
  let remaining = 0;
  for (const file of files) {
    const original = readFileSync(file, "utf8");
    const result = processText(original, fix);
    if (fix && result.text !== original) {
      writeFileSync(file, result.text);
      console.log(`${file}: ${result.fixed} か所の空白を除いた`);
    }
    for (const p of result.problems) {
      const note = p.fixable
        ? "全角文字と英数字（またはインラインコード）の間に空白がある。--fix で除ける"
        : "全角文字と、記号で始まる（または終わる）語の間に空白がある。空白を取るか、括弧で示す";
      console.log(`${file}:${p.line}: 「${p.context}」 ${note}`);
    }
    remaining += result.problems.length;
  }
  if (remaining) {
    console.log(`\n${remaining} か所が規則に合いません`);
    return 1;
  }
  console.log("\n全角文字と半角の語の間に空白はありません");
  return 0;
}

process.exitCode = main(process.argv.slice(2));

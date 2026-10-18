#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ngram
//
// README の分量を計り、予算（行数などの上限）と比べる。readme-writing スキルが使う。
// 依存パッケージは無く、Node.js 18 以降の標準機能だけで動く。
//
// 使い方: node readme_stats.mjs [オプション] <README> [ほかのファイル...]
//
// 予算と比べるのは最初のファイル（README）だけである。ほかのファイル（README から移した先の docs/*.md など）は、
// リンクの検査と --moved-from の照合に使う。
//
// 予算は、次の順に上書きして決める（下ほど優先）。
//   1. 既定の段階（standard、200行）
//   2. README と同じディレクトリの .readme-budget.json（--config で別のファイルを指定、--no-config で読まない）
//   3. オプション（--preset、--max-lines など）
// 地の文の行数と節の行数の上限は、指定が無ければ全体の上限の30%とする。地の文の表示幅の上限は、地の文の上限×80桁とする。
// 使い方の節（Usage、使い方など）と、設定ファイルの keep に書いた節には、節の行数の上限をかけない。
//
// 予算のほかに、README の日本語の箇条書き（番号付きの手順を含む）と表のセルが、体言止めかを確かめる。判定は
// git-commit スキルの check_message.mjs と同じである。表のセルは、末尾の句点も指摘する。自動生成のブロック
// （<!-- 〜:begin --> から <!-- 〜:end --> まで）とコードブロックは見ない。
// ほかの節の見出しを含む見出しの節（「インストール」と「バージョンを指定したインストール」など）は、同じ話題の節として注意に出す。
//
// 終了コード: 0 は指摘なし、1 は指摘あり（予算の超過、体言止めでない項目、句点で終わる表のセル、リンクの切れ、
// --moved-from で見つからないもの）、2 は使い方か設定ファイルの誤り。「注意」（長いコードブロック、見つからない見出し、
// 同じ話題の節など）は終了コードに含めない。

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const USAGE = `使い方: node readme_stats.mjs [オプション] <README> [ほかのファイル...]

オプション:
  --preset <small|standard|large>  規模の段階（全体の上限が120行、200行、300行）
  --max-lines <n>                  全体の行数の上限
  --max-prose-lines <n>            地の文の行数の上限（既定は全体の上限の30%）
  --max-prose-width <n>            地の文の表示幅の合計の上限（既定は地の文の上限×80桁）
  --max-section-lines <n>          1つの節の行数の上限（既定は全体の上限の30%）
  --max-code-block-lines <n>       1つのコードブロックの行数の上限（既定は15行）
  --max-heading-depth <n>          見出しの深さの上限（既定は3。H4以下を指摘する）
  --config <file>                  設定ファイル（既定は README と同じディレクトリの .readme-budget.json）
  --no-config                      設定ファイルを読まない
  --moved-from <file>              書き換える前の README。そのコードブロック、インラインコード、URL が、
                                   README とほかのファイルのどこかに残っているかを確かめる
  --json                           結果を JSON で出す`;

const CONFIG_NAME = ".readme-budget.json";
const PRESETS = { small: 120, standard: 200, large: 300 };
const RATIO = 0.3;
const COLUMNS_PER_LINE = 80;
const LIMIT_KEYS = ["maxLines", "maxProseLines", "maxProseWidth", "maxSectionLines", "maxCodeBlockLines", "maxHeadingDepth"];
const CONFIG_KEYS = new Set(["$comment", "preset", ...LIMIT_KEYS, "sections", "keep", "reason"]);
const OPTIONS = {
  "--max-lines": "maxLines",
  "--max-prose-lines": "maxProseLines",
  "--max-prose-width": "maxProseWidth",
  "--max-section-lines": "maxSectionLines",
  "--max-code-block-lines": "maxCodeBlockLines",
  "--max-heading-depth": "maxHeadingDepth",
};
const LABELS = {
  maxLines: "全体",
  maxProseLines: "地の文",
  maxProseWidth: "地の文の表示幅",
  maxSectionLines: "1つの節",
  maxCodeBlockLines: "1つのコードブロック",
  maxHeadingDepth: "見出しの深さ",
};
// 節の行数の上限をかけない節（使い方）の見出し。
const USAGE_TITLE = /^(usage|使い方|使用方法|利用方法)$/iu;
const INTRO = "（冒頭）";

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/u;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/u;
const TABLE = /^[ \t]*\|/u;
const HTML = /^[ \t]*<(?:\/?[A-Za-z]|!--)/u;
// 画像やバッジだけの行。
const MEDIA = /^[ \t]*(?:\[?!\[[^\]]*\]\([^)]*\)(?:\]\([^)]*\))?[ \t]*)+$/u;
const SCHEME = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/u;

// 自動生成のブロックの始まりと終わりの目印（<!-- skills:list:begin … --> など）。
const GENERATED_BEGIN = /^[ \t]*<!--\s*\S+:begin\b/u;
const GENERATED_END = /^[ \t]*<!--\s*\S+:end\b/u;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
// 体言止めでない終わり方。git-commit スキルの check_message.mjs と同じ判定である。
const PREDICATE_END = /(?:[うくぐすぶむるただ]|ない|無い|しい|です|ます|よい|きい|さい|[多長古早遅重軽高低強弱良広狭近遠]い)$/u;
// 上の形に当たるが、名詞として項目の終わりに来る語。
const NOUN_END = /(?:近く|多く|遠く)$/u;
// 末尾の句点、空白、括弧書き。
const TRAILER = /(?:[。.\s]+|（[^（）]*）|\([^()]*\))$/u;

class UsageError extends Error {}

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

function width(s) {
  let w = 0;
  for (const ch of s) w += isFull(ch) ? 2 : 1;
  return w;
}

function readText(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`${file}: 読めない`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/gu, "\n");
}

function indentWidth(line) {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
}

// インラインの書式を除いた文字列。見出しのアンカーと、地の文の表示幅に使う。
function plain(s) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1/gu, "$2")
    .replace(/(\*\*|~~|\*)(?=\S)(.*?\S)\1/gu, "$2")
    .trim();
}

// 行を種類に分ける。種類は blank、fence（コードブロックの区切り）、code、heading、setext（見出しの下線）、
// rule、table、html、media、prose（地の文。箇条書きと引用を含む）。
function classify(text) {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const rows = [];
  let fence = null;
  let block = null;
  let listIndent = -1;
  let prevBlank = true;
  let prevCode = false;
  for (const line of lines) {
    const row = { type: "prose", text: line };
    rows.push(row);
    if (fence) {
      const m = line.match(FENCE);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === "") {
        row.type = "fence";
        fence = null;
      } else {
        row.type = "code";
        row.block = block;
        block.lines++;
      }
      continue;
    }
    const f = line.match(FENCE);
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      row.type = "fence";
      fence = { char: f[1][0], len: f[1].length };
      block = { start: rows.length - 1, lines: 0, info: f[2].trim() };
      row.opens = block;
      prevBlank = false;
      prevCode = false;
      continue;
    }
    if (/^[ \t]*$/u.test(line)) {
      row.type = "blank";
      prevBlank = true;
      continue;
    }
    const ind = indentWidth(line);
    if ((prevBlank || prevCode) && ind >= (listIndent >= 0 ? listIndent + 4 : 4)) {
      if (!prevCode) {
        block = { start: rows.length - 1, lines: 0, info: "", indented: true };
        row.opens = block;
      }
      row.type = "code";
      row.block = block;
      block.lines++;
      prevBlank = false;
      prevCode = true;
      continue;
    }
    const wasBlank = prevBlank;
    prevBlank = false;
    prevCode = false;
    const h = line.match(ATX);
    if (h) {
      row.type = "heading";
      row.level = h[1].length;
      row.title = plain(h[2] ?? "");
      listIndent = -1;
      continue;
    }
    const prev = rows[rows.length - 2];
    if (SETEXT.test(line) && prev && prev.type === "prose" && !prev.list && listIndent < 0 && !wasBlank) {
      prev.type = "heading";
      prev.level = line.trim()[0] === "=" ? 1 : 2;
      prev.title = plain(prev.text);
      row.type = "setext";
      continue;
    }
    if (RULE.test(line)) {
      row.type = "rule";
      continue;
    }
    if (TABLE.test(line)) {
      row.type = "table";
      continue;
    }
    if (HTML.test(line)) {
      row.type = "html";
      continue;
    }
    if (MEDIA.test(line)) {
      row.type = "media";
      continue;
    }
    const li = line.match(LIST_ITEM);
    if (li) {
      row.list = true;
      listIndent = indentWidth(li[1]) + li[2].length + Math.max(li[3].length, 1);
    } else if (wasBlank && ind < Math.max(listIndent, 1)) {
      listIndent = -1;
    }
  }
  return rows;
}

// 体言止めでなければ、終わりの数文字を返す。git-commit スキルの check_message.mjs と同じ関数である。
function predicateEnding(text) {
  let s = text;
  for (let prev = null; s !== prev; ) {
    prev = s;
    s = s.replace(TRAILER, "");
  }
  if (!PREDICATE_END.test(s) || NOUN_END.test(s)) return null;
  return [...s].slice(-3).join("");
}

function proseText(line) {
  return plain(line.replace(/^[ \t]*(?:>[ \t]?)*/u, "").replace(LIST_ITEM, ""));
}

// GitHub と同じ規則の見出しのアンカー。
function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /gu, "-");
}

function anchorsOf(text, rows) {
  const seen = new Map();
  const anchors = new Set();
  for (const r of rows) {
    if (r.type !== "heading") continue;
    const base = slug(r.title);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of text.matchAll(/<[A-Za-z][^>]*\s(?:id|name)=["']([^"']+)["']/gu)) anchors.add(m[1].toLowerCase());
  return anchors;
}

function parse(file) {
  const text = readText(file);
  const rows = classify(text);
  return { file, text, rows };
}

function headingsOf(doc) {
  return doc.rows.flatMap((r, i) => (r.type === "heading" ? [{ level: r.level, title: r.title, index: i }] : []));
}

// 節の一覧。最上位の見出し（H1 が1つだけならその下の階層）を節とし、最初の節より前を「冒頭」とする。
function sectionsOf(doc) {
  const hs = headingsOf(doc);
  const total = doc.rows.length;
  for (let k = 0; k < hs.length; k++) {
    const h = hs[k];
    const next = hs.slice(k + 1).find((x) => x.level <= h.level);
    h.lines = (next ? next.index : total) - h.index;
    const parents = [];
    for (let j = k - 1, level = h.level; j >= 0; j--) {
      if (hs[j].level < level) {
        parents.unshift(hs[j].title);
        level = hs[j].level;
      }
    }
    h.path = [...parents, h.title];
  }
  const h1 = hs.filter((h) => h.level === 1);
  const rest = h1.length === 1 ? hs.filter((h) => h !== h1[0]) : hs;
  // H1 が題名だけのときは、節の道筋に含めない。
  if (h1.length === 1) for (const h of rest) if (h.path[0] === h1[0].title) h.path = h.path.slice(1);
  const level = rest.length > 0 ? Math.min(...rest.map((h) => h.level)) : null;
  const top = rest.filter((h) => h.level === level);
  const introEnd = top.length > 0 ? top[0].index : total;
  const sections = [];
  if (introEnd > 0) sections.push({ title: INTRO, index: 0, lines: introEnd, intro: true });
  for (const h of top) {
    const next = top[top.indexOf(h) + 1];
    sections.push({ title: h.title, index: h.index, lines: (next ? next.index : total) - h.index });
  }
  return { headings: hs, sections, level };
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function loadConfig(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`${path}: JSON として読めない（${e.message}）`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new UsageError(`${path}: オブジェクトではない`);
  for (const k of Object.keys(data)) {
    if (!CONFIG_KEYS.has(k)) throw new UsageError(`${path}: 知らないキー「${k}」`);
  }
  if (data.preset !== undefined && !Object.hasOwn(PRESETS, data.preset)) {
    throw new UsageError(`${path}: preset は ${Object.keys(PRESETS).join("、")} のどれか`);
  }
  for (const k of LIMIT_KEYS) {
    if (data[k] !== undefined && !isPositiveInt(data[k])) throw new UsageError(`${path}: ${k} は正の整数`);
  }
  if (data.sections !== undefined) {
    if (typeof data.sections !== "object" || data.sections === null || Array.isArray(data.sections)) {
      throw new UsageError(`${path}: sections は、節の見出しと行数の上限（null は上限なし）の組`);
    }
    for (const [k, v] of Object.entries(data.sections)) {
      if (v !== null && !isPositiveInt(v)) throw new UsageError(`${path}: sections の「${k}」は正の整数か null`);
    }
  }
  if (data.keep !== undefined && !(Array.isArray(data.keep) && data.keep.every((s) => typeof s === "string"))) {
    throw new UsageError(`${path}: keep は見出しの文字列の配列`);
  }
  if (data.reason !== undefined && typeof data.reason !== "string") throw new UsageError(`${path}: reason は文字列`);
  return data;
}

function resolveBudget(opts, config) {
  const b = {};
  const set = (k, value, source) => {
    b[k] = { value, source };
  };
  set("maxLines", PRESETS.standard, "既定（standard）");
  set("maxCodeBlockLines", 15, "既定");
  set("maxHeadingDepth", 3, "既定");
  if (config) {
    if (config.preset) set("maxLines", PRESETS[config.preset], `設定ファイル（preset: ${config.preset}）`);
    for (const k of LIMIT_KEYS) if (config[k] !== undefined) set(k, config[k], "設定ファイル");
  }
  if (opts.preset) set("maxLines", PRESETS[opts.preset], `オプション（--preset ${opts.preset}）`);
  for (const [k, v] of Object.entries(opts.limits)) set(k, v, "オプション");
  const max = b.maxLines.value;
  if (!b.maxProseLines) set("maxProseLines", Math.round(max * RATIO), `全体の上限の${RATIO * 100}%`);
  if (!b.maxSectionLines) set("maxSectionLines", Math.round(max * RATIO), `全体の上限の${RATIO * 100}%`);
  if (!b.maxProseWidth) set("maxProseWidth", b.maxProseLines.value * COLUMNS_PER_LINE, `地の文の上限×${COLUMNS_PER_LINE}桁`);
  return b;
}

function parseArgs(argv) {
  const opts = { limits: {}, files: [], json: false, noConfig: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} に値が無い`);
      return argv[++i];
    };
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--no-config") opts.noConfig = true;
    else if (a === "--config") opts.config = value();
    else if (a === "--moved-from") opts.movedFrom = value();
    else if (a === "--preset") {
      const v = value();
      if (!Object.hasOwn(PRESETS, v)) throw new UsageError(`--preset は ${Object.keys(PRESETS).join("、")} のどれか`);
      opts.preset = v;
    } else if (Object.hasOwn(OPTIONS, a)) {
      const raw = value();
      const v = Number(raw);
      if (!isPositiveInt(v)) throw new UsageError(`${a} は正の整数（${raw}）`);
      opts.limits[OPTIONS[a]] = v;
    } else if (a.startsWith("-") && a !== "-") throw new UsageError(`知らないオプション: ${a}`);
    else opts.files.push(a);
  }
  return opts;
}

// リンク先を相対パスで解決するときの根。.git のあるディレクトリで、無ければ README のディレクトリ。
function findRoot(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return resolve(dir);
  }
}

function linkTargets(doc) {
  const found = [];
  doc.rows.forEach((r, i) => {
    if (r.type === "code" || r.type === "fence" || r.type === "blank") return;
    const line = r.text.replace(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1/gu, "");
    for (const m of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/gu)) found.push({ target: m[1], index: i });
    const def = line.match(/^[ \t]*\[[^\]]+\]:[ \t]*<?(\S+?)>?(?:[ \t]|$)/u);
    if (def) found.push({ target: def[1], index: i });
    for (const m of line.matchAll(/<(?:a|img|source)\b[^>]*\s(?:href|src)=["']([^"']+)["']/giu)) found.push({ target: m[1], index: i });
  });
  return found;
}

function checkLinks(doc, root, cache, problems) {
  for (const { target, index } of linkTargets(doc)) {
    if (SCHEME.test(target)) continue;
    const hash = target.indexOf("#");
    let path = hash >= 0 ? target.slice(0, hash) : target;
    let anchor = hash >= 0 ? target.slice(hash + 1) : "";
    path = path.replace(/\?.*$/u, "");
    try {
      path = decodeURIComponent(path);
      anchor = decodeURIComponent(anchor);
    } catch {
      // 復号できないものはそのまま比べる
    }
    const resolved = path ? resolve(dirname(doc.file), path) : resolve(doc.file);
    // リポジトリの外を指すリンク（GitHub の ../../issues など）は確かめない。
    if (resolved !== root && !resolved.startsWith(root + sep)) continue;
    const at = `${doc.file}:${index + 1}`;
    if (!existsSync(resolved)) {
      problems.push({ severity: "error", at, message: `リンク先「${target}」が無い` });
      continue;
    }
    if (!anchor || !/\.(md|markdown)$/iu.test(resolved) || !statSync(resolved).isFile()) continue;
    if (!cache.has(resolved)) {
      const d = parse(resolved);
      cache.set(resolved, anchorsOf(d.text, d.rows));
    }
    if (!cache.get(resolved).has(anchor.toLowerCase())) {
      // リンクと同じ / 区切りで示す。Windows の relative() は \ 区切りを返す。
      const where = path ? `「${relative(dirname(doc.file), resolved).split(sep).join("/") || path}」` : "このファイル";
      problems.push({ severity: "error", at, message: `アンカー「#${anchor}」が${where}に無い` });
    }
  }
}

function normalizeLine(s) {
  return s.trim().replace(/^[$%>][ \t]+/u, "").replace(/[ \t]+/gu, " ");
}

// 書き換える前の README の、コードブロック、インラインコード、URL、見出しが、新しいファイルのどこかに残っているかを調べる。
function movedFrom(oldDoc, docs) {
  const all = docs.map((d) => d.text.split("\n").map(normalizeLine).join("\n")).join("\n");
  const headings = new Set(docs.flatMap((d) => headingsOf(d).map((h) => h.title)));
  const result = { from: oldDoc.file, codeBlocks: [], codeSpans: [], urls: [], headings: [] };
  const blocks = new Map();
  oldDoc.rows.forEach((r) => {
    if (r.type === "code" && r.block) {
      if (!blocks.has(r.block)) blocks.set(r.block, []);
      blocks.get(r.block).push(r.text);
    }
  });
  for (const [block, lines] of blocks) {
    const missing = lines.map(normalizeLine).filter((l) => l.length >= 3 && !all.includes(l));
    if (missing.length > 0) result.codeBlocks.push({ line: block.start + 1, lines: lines.length, missing });
  }
  const spans = new Set();
  const urls = new Set();
  oldDoc.rows.forEach((r) => {
    if (r.type === "code" || r.type === "fence") return;
    for (const m of r.text.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1/gu)) {
      const s = m[2].trim();
      if (s.length >= 2) spans.add(s);
    }
    for (const m of r.text.matchAll(/https?:\/\/[^\s<>()"'`]+/gu)) urls.add(m[0].replace(/[.,;:!?。、）]+$/u, ""));
  });
  const raw = docs.map((d) => d.text).join("\n");
  result.codeSpans = [...spans].filter((s) => !raw.includes(s) && !all.includes(normalizeLine(s)));
  result.urls = [...urls].filter((u) => !raw.includes(u));
  result.headings = headingsOf(oldDoc)
    .filter((h) => h.title && !headings.has(h.title))
    .map((h) => ({ line: h.index + 1, title: h.title }));
  return result;
}

function analyze(opts) {
  const [readme, ...others] = opts.files;
  const doc = parse(readme);
  let config = null;
  let configPath = null;
  if (!opts.noConfig) {
    configPath = opts.config ?? join(dirname(readme), CONFIG_NAME);
    if (opts.config && !existsSync(configPath)) throw new UsageError(`${configPath}: 無い`);
    if (existsSync(configPath)) config = loadConfig(configPath);
    else configPath = null;
  }
  const budget = resolveBudget(opts, config);
  const problems = [];
  const { headings, sections } = sectionsOf(doc);

  let proseLines = 0;
  let proseWidth = 0;
  const codeBlocks = [];
  for (const r of doc.rows) {
    if (r.type === "prose") {
      proseLines++;
      proseWidth += width(proseText(r.text));
    }
    if (r.opens) codeBlocks.push(r.opens);
  }
  const levels = {};
  for (const h of headings) levels[h.level] = (levels[h.level] ?? 0) + 1;

  const keep = new Set(config?.keep ?? []);
  const sectionLimits = config?.sections ?? {};
  const lim = (k) => budget[k].value;
  const over = (k, actual, at, what, unit) => {
    if (actual > lim(k)) problems.push({ severity: "error", at, message: `${what}が${actual}${unit}で、上限の${lim(k)}${unit}を超えている` });
  };
  over("maxLines", doc.rows.length, readme, "全体", "行");
  over("maxProseLines", proseLines, readme, "地の文", "行");
  over("maxProseWidth", proseWidth, readme, "地の文の表示幅", "桁");

  for (const s of sections) {
    if (Object.hasOwn(sectionLimits, s.title)) {
      s.limit = sectionLimits[s.title];
      s.limitSource = "設定ファイル（sections）";
    } else if (keep.has(s.title)) {
      s.limit = null;
      s.limitSource = "設定ファイル（keep）";
    } else if (!s.intro && USAGE_TITLE.test(s.title)) {
      s.limit = null;
      s.limitSource = "使い方の節";
    } else if (sections.length === 1) {
      s.limit = null;
      s.limitSource = "節が1つだけ";
    } else {
      s.limit = lim("maxSectionLines");
      s.limitSource = budget.maxSectionLines.source;
    }
    if (s.limit !== null && s.lines > s.limit) {
      problems.push({ severity: "error", at: `${readme}:${s.index + 1}`, message: `節「${s.title}」が${s.lines}行で、上限の${s.limit}行を超えている` });
    }
  }
  for (const name of Object.keys(sectionLimits)) {
    if (!sections.some((s) => s.title === name)) problems.push({ severity: "warn", at: configPath, message: `sections の「${name}」に当たる節が README に無い` });
  }
  for (const name of keep) {
    if (!headings.some((h) => h.title === name)) problems.push({ severity: "warn", at: configPath, message: `keep の「${name}」に当たる見出しが README に無い` });
  }

  // 箇条書き（番号付きの手順を含む）と表のセルの体言止めと、表のセルの末尾の句点。自動生成のブロックとコードブロックは見ない。
  let generated = false;
  doc.rows.forEach((r, i) => {
    if (r.type === "html" && GENERATED_BEGIN.test(r.text)) generated = true;
    const inGenerated = generated;
    if (r.type === "html" && GENERATED_END.test(r.text)) generated = false;
    if (inGenerated) return;
    const items = [];
    if (r.type === "prose" && r.list) items.push(["箇条書き", proseText(r.text)]);
    if (r.type === "table" && !/^[\s|:-]+$/u.test(r.text)) {
      for (const cell of r.text.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|")) items.push(["表のセル", plain(cell)]);
    }
    for (const [what, text] of items) {
      const ending = JAPANESE.test(text) ? predicateEnding(text) : null;
      if (ending) problems.push({ severity: "error", at: `${readme}:${i + 1}`, message: `${what}が体言止めになっていない（「…${ending}」で終わる）` });
      if (what === "表のセル" && /。$/u.test(text.trim())) problems.push({ severity: "error", at: `${readme}:${i + 1}`, message: "表のセルの末尾に句点がある" });
    }
  });

  // ほかの節の見出しを含む見出しの節は、同じ話題の節として、その節の中の節にできることが多い。
  const tops = sections.filter((s) => !s.intro);
  for (const s of tops) {
    const parent = tops.find((t) => t !== s && [...t.title].length >= 2 && s.title.toLowerCase().includes(t.title.toLowerCase()));
    if (parent) {
      problems.push({
        severity: "warn",
        at: `${readme}:${s.index + 1}`,
        message: `節「${s.title}」は、節「${parent.title}」と同じ話題なら、その中の節にする`,
      });
    }
  }

  const deep = headings.filter((h) => h.level > lim("maxHeadingDepth"));
  if (deep.length > 0) {
    const where = deep.slice(0, 5).map((h) => h.index + 1).join("、");
    problems.push({
      severity: "error",
      at: readme,
      message: `H${lim("maxHeadingDepth") + 1}以下の見出しが${deep.length}個ある（${where}${deep.length > 5 ? "、ほか" : ""}行目）`,
    });
  }
  for (const b of codeBlocks) {
    if (b.lines > lim("maxCodeBlockLines")) {
      problems.push({
        severity: "warn",
        at: `${readme}:${b.start + 1}`,
        message: `コードブロックが${b.lines}行で、上限の${lim("maxCodeBlockLines")}行を超えている（-h の出力の写しなど、手で書いていないものなら除いてよい）`,
      });
    }
  }

  const docs = [doc, ...others.map(parse)];
  const root = findRoot(dirname(readme));
  const cache = new Map();
  for (const d of docs) checkLinks(d, root, cache, problems);

  let moved = null;
  if (opts.movedFrom) {
    moved = movedFrom(parse(opts.movedFrom), docs);
    for (const b of moved.codeBlocks) {
      problems.push({ severity: "error", at: `${moved.from}:${b.line}`, message: `コードブロックの${b.missing.length}行がどこにも無い（「${b.missing[0]}」など）` });
    }
    for (const s of moved.codeSpans) problems.push({ severity: "error", at: moved.from, message: `インラインコード「${s}」がどこにも無い` });
    for (const u of moved.urls) problems.push({ severity: "error", at: moved.from, message: `URL「${u}」がどこにも無い` });
    for (const h of moved.headings) problems.push({ severity: "warn", at: `${moved.from}:${h.line}`, message: `見出し「${h.title}」がどこにも無い（名前を変えたなら問題ない）` });
  }

  const longSections = headings
    .filter((h) => h.level >= 2 && h.level <= 3)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 8)
    .map((h) => ({ path: h.path.join(" > "), line: h.index + 1, lines: h.lines, keep: keep.has(h.title) }));

  return {
    file: readme,
    config: configPath ? { path: configPath, reason: config.reason ?? null } : null,
    budget,
    stats: {
      lines: doc.rows.length,
      proseLines,
      proseWidth,
      headings: levels,
      codeBlocks: codeBlocks.length,
      longestCodeBlock: Math.max(0, ...codeBlocks.map((b) => b.lines)),
    },
    sections: sections.map((s) => ({ title: s.title, line: s.index + 1, lines: s.lines, limit: s.limit, limitSource: s.limitSource })),
    longSections,
    codeBlocks: codeBlocks.map((b) => ({ line: b.start + 1, lines: b.lines, info: b.info })),
    movedFrom: moved,
    problems,
  };
}

function report(r) {
  const out = [];
  const b = r.budget;
  const n = (v) => v.toLocaleString("en-US");
  const limit = (k, unit) => `上限${n(b[k].value)}${unit}。${b[k].source}`;
  out.push(r.file);
  out.push(`  全体: ${n(r.stats.lines)}行（${limit("maxLines", "行")}）`);
  out.push(`  地の文: ${n(r.stats.proseLines)}行（${limit("maxProseLines", "行")}）`);
  out.push(`  地の文の表示幅: ${n(r.stats.proseWidth)}桁（${limit("maxProseWidth", "桁")}）`);
  const hs = Object.entries(r.stats.headings).map(([lv, c]) => `H${lv} ${c}`).join("、") || "なし";
  out.push(`  見出し: ${hs}（H${b.maxHeadingDepth.value}まで。${b.maxHeadingDepth.source}）`);
  out.push(`  コードブロック: ${r.stats.codeBlocks}個、最長${r.stats.longestCodeBlock}行（1つ${b.maxCodeBlockLines.value}行まで。${b.maxCodeBlockLines.source}）`);
  if (r.config) out.push(`  設定ファイル: ${r.config.path}${r.config.reason ? `（理由: ${r.config.reason}）` : ""}`);
  out.push("", "節:");
  for (const s of r.sections) {
    const cap = s.limit === null ? `上限なし。${s.limitSource}` : `上限${s.limit}行`;
    out.push(`  ${s.title}: ${s.lines}行（${cap}）`);
  }
  if (r.longSections.length > 0) {
    out.push("", "長い節（H2・H3、行数の多い順）:");
    for (const s of r.longSections) out.push(`  ${s.path}: ${s.lines}行（${s.line}行目から）${s.keep ? " ※keep" : ""}`);
  }
  const errors = r.problems.filter((p) => p.severity === "error");
  const warns = r.problems.filter((p) => p.severity === "warn");
  if (errors.length > 0) {
    out.push("", "指摘:");
    for (const p of errors) out.push(`  - ${p.at}: ${p.message}`);
  }
  if (warns.length > 0) {
    out.push("", "注意:");
    for (const p of warns) out.push(`  - ${p.at}: ${p.message}`);
  }
  out.push("", errors.length > 0 ? `${errors.length}件の指摘があります` : "指摘はありません");
  return out.join("\n");
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.files.length === 0) throw new UsageError("README を指定する");
    const r = analyze(opts);
    console.log(opts.json ? JSON.stringify(r, null, 2) : report(r));
    return r.problems.some((p) => p.severity === "error") ? 1 : 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`readme_stats: ${e.message}`);
    if (!opts?.files?.length) console.error(`\n${USAGE}`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));

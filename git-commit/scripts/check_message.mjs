#!/usr/bin/env node
// コミットメッセージの書式を検査する。依存パッケージは無く、Node.js 18 以降の標準機能だけで動く。
//
// 使い方: node check_message.mjs <メッセージのファイル> [1行目の表示幅の上限（既定 72）]
//
// 検査すること:
//   - 1行目の表示幅（全角2桁、半角1桁）が上限を超えていないか
//   - 本文の箇条書きを折り返していないか（1項目を1行で書く。字下げした続きの行があれば知らせる。
//     入れ子の箇条書きの行は続きの行とみなさない）
//   - 全角文字と、記号で始まる（または終わる）半角の語の間に空白が無いか
//     （例: 「テンプレート .gitmessage」「./internal/... の」）。textlint の
//     ja-space-between-half-and-full-width は半角の英数字との間しか見ないので、この形を検出しない
//   - バッククォートの外に、HTTP のメソッドとパスがくっついた形（GET/v1/views）が無いか。
//     textlint の ja-no-space-around-slash は、半角どうしの間でもスラッシュの前の空白を消すので、
//     「GET /v1/views」を書き換えてしまう。コマンドやパスはバッククォートで囲むと守られる
//   - 1行目が、体言止めになっているか（「〜する」「〜が無い」「〜です」などで終わっていないか）。
//     末尾の「。」と括弧書きは除いて見る。語の形だけで判断する目安なので、名詞なのに当たるときは言い換える
//   - 箇条書きの各項目が、述語の後ろに「状態」を足して名詞にしていないか（「〜で使えない状態」）、
//     です・ます調で終わっていないか。箇条書きは、変更や作業を体言止めに、事実や状態を常体の用言止めにする
//   - 「問題」の節の一段下げた項目（原因）が、「〜が原因」で終わっているか。上の段に問題を、下の段に原因を書く
//   - 本文に、箇条書きでない日本語の行（段落、表）が無いか。本文は節の見出しと箇条書きで書く。
//     日本語を含まない行（Co-Authored-By などのトレーラー、URL、生成元の表示）とコードブロックは見ない
//
// 規則に合わない行があれば、その行を示して終了コード1で終わる。

import { readFileSync } from "node:fs";

const USAGE = `使い方: node check_message.mjs <メッセージのファイル> [1行目の表示幅の上限（既定 72）]`;

// 行頭の書式の記号（箇条書き、番号付きの箇条書き、見出し）。この後ろの空白は Markdown の書式に必要なので検査しない。
const MARKER = /^(\s*(?:[-*+]|\d+\.|#+)\s+)/u;
// 1行目の Conventional Commits の型（fix: / feat(scope): / feat!: など）。
const COMMIT_TYPE = /^([a-z]+(?:\([^)]*\))?!?:\s+)/u;
const ASCII_SYMBOL = /^[!-/:-@[-`{-~]/u;
// インラインコード（バッククォートで囲んだ部分）。textlint の対象外なので、中身は書き換えられない。
const CODE_SPAN = /`[^`]*`/gu;
// スラッシュの前の空白を消された跡。HTTP のメソッドの直後にパスが続く形。
// 前の文字の判定は Python の \b（Unicode の英数字と _ を語の文字とみなす）に合わせる。
const GLUED_METHOD = /(?<![\p{L}\p{N}_])(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\//gu;
const SPACED = /(\S)([ \t]+)(\S)/gu;
// 箇条書きの行頭の記号（見出しの # は含めない）。
const BULLET = /^\s*(?:[-*+]|\d+\.)\s+/u;
const FENCE = /^\s*(```|~~~)/u;
const HEADING = /^\s*#/u;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
// 体言止めでない終わり方。動詞の終止形・過去形、形容詞、「です」「ます」など。
const PREDICATE_END = /(?:[うくぐすぶむるただ]|ない|無い|しい|です|ます|よい|きい|さい|[多長古早遅重軽高低強弱良広狭近遠]い)$/u;
// 上の形に当たるが、名詞として項目の終わりに来る語。
const NOUN_END = /(?:近く|多く|遠く)$/u;
// 末尾の句点、空白、括弧書き。
const TRAILER = /(?:[。.\s]+|（[^（）]*）|\([^()]*\))$/u;
// です・ます調の終わり方。箇条書きは常体で書く。
const POLITE_END = /(?:です|ます|ました|ません|でした|ましょう|ください)$/u;
// 述語の後ろに足して、項目を名詞で終えるための語（「〜で使えない状態」）。用言止めで言える項目なので要らない。
const PADDING_END = /状態$/u;

// 体言止めでなければ、終わりの数文字を返す。
function predicateEnding(text) {
  let s = text;
  for (let prev = null; s !== prev; ) {
    prev = s;
    s = s.replace(TRAILER, "");
  }
  if (!PREDICATE_END.test(s) || NOUN_END.test(s)) return null;
  return [...s].slice(-3).join("");
}

// 末尾の句点と括弧書きを除いた項目。
function stripTrailer(item) {
  let s = item;
  for (let prev = null; s !== prev; ) {
    prev = s;
    s = s.replace(TRAILER, "");
  }
  return s;
}

// 箇条書きの項目の終わり方の問題。末尾の句点と括弧書きは除いて見る。
function itemProblems(item) {
  const s = stripTrailer(item);
  if (!JAPANESE.test(s)) return [];
  const tail = [...s].slice(-5).join("");
  const notes = [];
  if (POLITE_END.test(s)) {
    notes.push(`です・ます調で終わっている（「…${tail}」）。常体の用言止めか体言止めにする`);
  }
  if (PADDING_END.test(s) && predicateEnding(s.replace(PADDING_END, ""))) {
    notes.push(`述語の後ろに「状態」を足している（「…${tail}」）。「…で使えない状態」ではなく「…で使えない」のように、用言止めで終える`);
  }
  return notes;
}

// East Asian Width が W（全角）または F（Fullwidth）の範囲。Unicode 15.1 の unicodedata から生成した。
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

// 全角文字と、記号で始まる／終わる半角の語の間の空白を探す。
function spaceProblems(body) {
  const found = [];
  for (const m of body.matchAll(SPACED)) {
    const [, left, gap, right] = m;
    if (isFull(left) && ASCII_SYMBOL.test(right)) {
      found.push(`全角文字と記号の間に空白: 「${left}${gap}${right}」`);
    } else if (ASCII_SYMBOL.test(left) && isFull(right)) {
      found.push(`記号と全角文字の間に空白: 「${left}${gap}${right}」`);
    }
  }
  return found;
}

function main(argv) {
  if (argv.length < 1) {
    console.log(USAGE);
    return 2;
  }
  const limit = argv.length > 1 ? Number.parseInt(argv[1], 10) : 72;
  if (Number.isNaN(limit)) {
    console.error(`表示幅の上限が数値ではない: ${argv[1]}`);
    return 2;
  }
  // BOM を除き、CRLF と CR を LF にそろえる（Python 版の utf-8-sig とテキストモードの読み込みに合わせる）。
  const text = readFileSync(argv[0], "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  let problems = 0;
  let inFence = false;
  // いま読んでいる節の見出し（「## 問題」なら「問題」）。
  let section = null;
  lines.forEach((line, idx) => {
    const i = idx + 1;
    const w = width(line);
    const notes = [];
    if (i === 1 && w > limit) {
      notes.push(`1行目の表示幅が上限 ${limit} 桁を超えている`);
    }
    const fence = FENCE.test(line);
    if (fence) inFence = !inFence;
    if (!inFence && HEADING.test(line)) section = line.replace(/^\s*#+\s*/u, "").trim();
    const item = i === 1 ? line.replace(COMMIT_TYPE, "") : !inFence && BULLET.test(line) ? line.replace(BULLET, "") : null;
    if (i === 1) {
      const ending = predicateEnding(item);
      if (ending) notes.push(`1行目が体言止めになっていない（「…${ending}」で終わる）。「〜の追加」のように、変更を名詞にして終える`);
    } else if (item !== null) {
      notes.push(...itemProblems(item));
      if (section === "問題" && /^\s+/u.test(line) && JAPANESE.test(item) && !/原因$/u.test(stripTrailer(item))) {
        notes.push("「問題」の節の一段下げた項目は原因を書き、「〜が原因」で終える");
      }
    }
    if (i > 1 && item === null && !fence && !inFence && !HEADING.test(line) && JAPANESE.test(line)) {
      notes.push("箇条書きになっていない（段落や表）。本文は節の見出しと箇条書きで書く");
    }
    if ((line[0] === " " || line[0] === "\t") && !MARKER.test(line)) {
      notes.push("箇条書きを折り返している。本文は折り返さず、1項目を1行で書く");
    }
    const prefix = i === 1 ? COMMIT_TYPE : MARKER;
    const m = line.match(prefix);
    const body = m ? line.slice(m[0].length) : line;
    const outsideCode = body.replace(CODE_SPAN, "");
    notes.push(...spaceProblems(outsideCode));
    for (const g of outsideCode.matchAll(GLUED_METHOD)) {
      notes.push(`HTTP のメソッドとパスがくっついている（${g[0]}…）。コマンドやパスはバッククォートで囲む`);
    }

    const num = String(i).padStart(3);
    if (line) {
      console.log(`${notes.length ? "!" : " "}${num} ${String(w).padStart(3)}  ${line}`);
    }
    for (const n of notes) console.log(`!${num}      ${n}`);
    if (notes.length) problems += 1;
  });
  if (problems) {
    console.log(`\n${problems} 行が規則に合いません`);
    return 1;
  }
  console.log(`\nすべての行が規則に合っています（1行目は表示幅 ${limit} 桁以内、本文は折り返しなし）`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

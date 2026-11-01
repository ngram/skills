// git-commit/scripts/check_message.mjs の一部をコピーしたスクリプトが、元と同じかの確認。node --test tests/*.test.mjs で実行する。
// Skill のディレクトリは別々に配布されるので、ほかの Skill のスクリプトを import できない。そのため、使う側にコピーを置いている。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINAL = "git-commit/scripts/check_message.mjs";

// コピーの一覧。names は元のトップレベルの定義の名前、to はコピー先のファイル。
const COPIES = [
  { names: ["WIDE_RANGES", "isFull"], to: ["readme-writing/scripts/readme_stats.mjs", "japanese-tech-writing/scripts/fix_spacing.mjs"] },
  { names: ["width"], to: ["readme-writing/scripts/readme_stats.mjs"] },
  {
    names: ["JAPANESE", "PREDICATE_END", "NOUN_END", "TRAILER", "predicateEnding"],
    to: ["readme-writing/scripts/readme_stats.mjs", "scripts/sync-skills.mjs"],
  },
  { names: ["POLITE_END", "PADDING_END"], to: ["readme-writing/scripts/readme_stats.mjs"] },
];

const read = (file) => readFileSync(join(ROOT, file), "utf8").replace(/\r\n?/gu, "\n");

// トップレベルの定義（1行の const、[ ] の表の const、function の本体）を名前で取り出す。無ければ null。
function definition(text, name) {
  const m = text.match(new RegExp(`^const ${name} = \\[[\\s\\S]*?^\\];$|^const ${name} = .*;$|^function ${name}\\([\\s\\S]*?^\\}$`, "mu"));
  return m ? m[0] : null;
}

// リポジトリのスクリプト（scripts/ と、各 Skill の scripts/ の .mjs）。
function scripts() {
  const dirs = ["scripts", ...readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => `${e.name}/scripts`)
    .filter((d) => existsSync(join(ROOT, d)))];
  return dirs.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".mjs")).map((f) => `${d}/${f}`));
}

test("コピー先の定義は、元の check_message.mjs と同じ", () => {
  const original = read(ORIGINAL);
  for (const { names, to } of COPIES) {
    for (const name of names) {
      const want = definition(original, name);
      assert.ok(want, `${ORIGINAL} に ${name} が無い`);
      for (const file of to) {
        assert.equal(definition(read(file), name), want, `${file} の ${name} が ${ORIGINAL} と違う`);
      }
    }
  }
});

test("元と同じ定義を持つスクリプトは、すべてコピーの一覧にある", () => {
  const original = read(ORIGINAL);
  const names = [...original.matchAll(/^(?:const|function) ([\w$]+)/gmu)].map((m) => m[1]);
  const listed = new Set(COPIES.flatMap(({ names: n, to }) => n.flatMap((name) => to.map((file) => `${file} ${name}`))));
  for (const file of scripts().filter((f) => f !== ORIGINAL)) {
    const text = read(file);
    for (const name of names) {
      const def = definition(text, name);
      if (def !== null && def === definition(original, name)) {
        assert.ok(listed.has(`${file} ${name}`), `${file} の ${name} は ${ORIGINAL} のコピーなので、COPIES に足す`);
      }
    }
  }
});

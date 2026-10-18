// plan-create と plan-review の「保証の水準」の項目が一致するかの確認。node --test tests/*.test.mjs で実行する。
// 片方の SKILL.md だけを直すと、Plan を書く側とレビューする側で求める項目が食い違う。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_LEAD = "節には次の4点を書く。";
const OPTIONAL_LEAD = "次の項目は、当てはまるときだけ書く。";

// 導入の文の直後に続く箇条書きから、「- 名前：」の名前を取り出す。
function labelsAfter(lines, lead) {
  let i = lines.findIndex((l) => l.trim() === lead);
  if (i === -1) return [];
  for (i++; i < lines.length && lines[i].trim() === ""; i++);
  const labels = [];
  for (; i < lines.length && lines[i].startsWith("- "); i++) {
    const m = lines[i].match(/^- ([^：]+)：/u);
    if (m) labels.push(m[1]);
  }
  return labels;
}

function guaranteeItems(skill) {
  const lines = readFileSync(join(ROOT, skill, "SKILL.md"), "utf8").replace(/\r\n/g, "\n").split("\n");
  return { required: labelsAfter(lines, REQUIRED_LEAD), optional: labelsAfter(lines, OPTIONAL_LEAD) };
}

test("plan-create と plan-review の「保証の水準」の項目（必須と条件付き）が一致する", () => {
  const create = guaranteeItems("plan-create");
  const review = guaranteeItems("plan-review");
  // 書式が変わって両方とも取り出せなくなったときに、空どうしで一致して通らないようにする。
  for (const [name, items] of [["plan-create", create], ["plan-review", review]]) {
    assert.equal(items.required.length, 4, `${name} から必須の4項目を取り出せない: ${JSON.stringify(items.required)}`);
    assert.ok(items.optional.length >= 1, `${name} から条件付きの項目を取り出せない`);
  }
  assert.deepEqual(create, review);
});

// plan-create と plan-review の、必須の節（「外部との入出力」と「実現すること・しないこと」）が一致するかの確認。
// node --test tests/*.test.mjs で実行する。
// 片方の SKILL.md だけを直すと、Plan を書く側とレビューする側で求める項目や節が食い違う。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_LEAD = "2つの節には、次の4点を書く。";
const OPTIONAL_LEAD = "次の項目は、当てはまるときだけ「外部との入出力」に書く。";
// 前の版の plan-create で書いた Plan の節。plan-review は読むが、plan-create はもう書かない。
const OLD_SECTION = "保証の水準";

function skillText(skill) {
  return readFileSync(join(ROOT, skill, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
}

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

function requiredItems(skill) {
  const lines = skillText(skill).split("\n");
  return { required: labelsAfter(lines, REQUIRED_LEAD), optional: labelsAfter(lines, OPTIONAL_LEAD) };
}

test("plan-create と plan-review の必須の節の項目（必須と条件付き）が一致する", () => {
  const create = requiredItems("plan-create");
  const review = requiredItems("plan-review");
  // 書式が変わって両方とも取り出せなくなったときに、空どうしで一致して通らないようにする。
  for (const [name, items] of [["plan-create", create], ["plan-review", review]]) {
    assert.equal(items.required.length, 4, `${name} から必須の4項目を取り出せない: ${JSON.stringify(items.required)}`);
    assert.ok(items.optional.length >= 1, `${name} から条件付きの項目を取り出せない`);
  }
  assert.deepEqual(create, review);
});

test("plan-review が確かめる必須の節が、plan-create のテンプレートにある", () => {
  const m = skillText("plan-review").match(/^# 必須の節を確かめる\nfor H in (.+); do$/mu);
  assert.ok(m, "plan-review/SKILL.md に、必須の節を確かめるコードブロックが無い");
  const headings = [...m[1].matchAll(/"([^"]+)"/gu)].map((x) => x[1]).filter((h) => h !== OLD_SECTION);
  assert.equal(headings.length, 2, `必須の節を取り出せない: ${JSON.stringify(headings)}`);

  const template = skillText("plan-create").match(/^````markdown\n([\s\S]*?)\n````$/mu);
  assert.ok(template, "plan-create/SKILL.md に、Plan のテンプレートが無い");
  for (const h of headings) {
    assert.match(template[1], new RegExp(`^## ${h}$`, "mu"), `plan-create のテンプレートに「## ${h}」が無い`);
  }
  assert.doesNotMatch(template[1], new RegExp(`^## ${OLD_SECTION}`, "mu"), "plan-create のテンプレートに前の版の節が残っている");
});

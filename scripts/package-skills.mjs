#!/usr/bin/env node
// Skill ごとに、claude.ai の Customize > Skills にアップロードできる ZIP を作る。
// 依存パッケージは無く、Node.js 18 以降の標準機能と git だけで動く。
//
// ZIP には、指定した版で git が管理しているファイルだけを入れ、ルートに Skill のディレクトリを1つ置く
// （claude.ai は、ZIP のルートのディレクトリ名と frontmatter の name が一致することを求める）。
// リリースを公開すると、.github/workflows/release-assets.yml がこのスクリプトで ZIP を作り、リリースに添付する。
//
// 使い方:
//   node scripts/package-skills.mjs [--ref <コミットやタグ>] [--out <ディレクトリ>]
//     --ref  ZIP にする版（既定は HEAD）
//     --out  ZIP を書き出すディレクトリ（既定は dist）

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "使い方: node scripts/package-skills.mjs [--ref <コミットやタグ>] [--out <ディレクトリ>]";

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.error) throw new Error(`git を実行できない: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} が失敗した: ${r.stderr.trim()}`);
  return r.stdout;
}

// 直下の <name>/SKILL.md を、作業ツリーではなく指定した版から探す。
function findSkills(ref) {
  return git(["ls-tree", "-r", "--name-only", ref])
    .split("\n")
    .map((p) => p.match(/^([^./][^/]*)\/SKILL\.md$/)?.[1])
    .filter((name) => name && name !== "node_modules")
    .sort();
}

function parseArgs(argv) {
  const opts = { ref: "HEAD", out: "dist" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--ref" || a === "--out") && i + 1 < argv.length) opts[a.slice(2)] = argv[++i];
    else if (a === "-h" || a === "--help") return null;
    else throw new Error(`知らないオプションか、値の無いオプション: ${a}`);
  }
  return opts;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (!opts) {
    console.log(USAGE);
    return 0;
  }
  try {
    const skills = findSkills(opts.ref);
    if (skills.length === 0) throw new Error(`${opts.ref} に <name>/SKILL.md が無い`);
    const out = resolve(opts.out);
    mkdirSync(out, { recursive: true });
    for (const name of skills) {
      const file = join(out, `${name}.zip`);
      git(["archive", "--format=zip", `--output=${file}`, opts.ref, `${name}/`]);
      console.log(`作成: ${relative(process.cwd(), file)}（${statSync(file).size} バイト）`);
    }
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));

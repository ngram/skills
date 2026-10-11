#!/usr/bin/env node
// Skill ごとに、claude.ai の Customize > Skills にアップロードできる ZIP（<name>.zip）と .skill（<name>.skill）を作る。
// 依存パッケージは無く、Node.js 18 以降の標準機能と git だけで動く。
//
// ZIP には、指定した版で git が管理しているファイルだけを入れ、ルートに Skill のディレクトリを1つ置く
// （claude.ai は、ZIP のルートのディレクトリ名と frontmatter の name が一致することを求める）。
// .skill は skill-creator の package_skill.py が作るのと同じ形式（中身は ZIP）で、<name>.zip と同じバイト列にする。
// release.yml と release-assets.yml が、このスクリプトで作ったファイルをリリースに添付する。
//
// frontmatter に、skill-creator の検証（アップロードする .skill 向け）が許すキー以外があれば警告する。
// claude.ai へのアップロードで拒否されることがあるため。警告だけで、ファイルは作る。
//
// 使い方:
//   node scripts/package-skills.mjs [--ref <コミットやタグ>] [--out <ディレクトリ>]
//     --ref  ZIP にする版（既定は HEAD）
//     --out  ZIP と .skill を書き出すディレクトリ（既定は dist）

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "使い方: node scripts/package-skills.mjs [--ref <コミットやタグ>] [--out <ディレクトリ>]";
// skill-creator の quick_validate.py が許す frontmatter のキー。
const UPLOAD_KEYS = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);

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

// frontmatter の最上位のキーのうち、UPLOAD_KEYS に無いもの。
function unsupportedKeys(ref, name) {
  const text = git(["show", `${ref}:${name}/SKILL.md`]).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end === -1) return [];
  return lines
    .slice(1, end)
    .map((l) => l.match(/^([A-Za-z0-9_-]+):/)?.[1])
    .filter((k) => k && !UPLOAD_KEYS.has(k));
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
      const zip = join(out, `${name}.zip`);
      const skill = join(out, `${name}.skill`);
      git(["archive", "--format=zip", `--output=${zip}`, opts.ref, `${name}/`]);
      copyFileSync(zip, skill);
      console.log(`作成: ${relative(process.cwd(), zip)}、${relative(process.cwd(), skill)}（${statSync(zip).size} バイト）`);
      const keys = unsupportedKeys(opts.ref, name);
      if (keys.length) {
        // GitHub Actions の中では、実行結果の画面に注釈として出す。
        const prefix = process.env.GITHUB_ACTIONS === "true" ? "::warning::" : "";
        console.error(
          `${prefix}警告: ${name} の frontmatter の ${keys.join(", ")} は、skill-creator の検証が許していないキー。claude.ai へのアップロードで拒否されることがある`,
        );
      }
    }
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));

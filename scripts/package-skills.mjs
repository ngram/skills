#!/usr/bin/env node
// Skill ごとに、claude.ai に入れる .skill（<name>.skill）を作る。
// 依存パッケージは無く、Node.js 18 以降の標準機能と git だけで動く。
//
// .skill は skill-creator の package_skill.py が作るのと同じ形式で、中身は ZIP である。指定した版で git が管理している
// ファイルだけを入れ、ルートに Skill のディレクトリを1つ置く（claude.ai は、ルートのディレクトリ名と frontmatter の
// name が一致することを求める）。セッションに送るとファイルのカードに「Save skill」のボタンが出て、押すと入る。
// claude.ai の画面からアップロードするときに .skill を選べなければ、拡張子を .zip に変えればよい。
// release.yml と release-assets.yml が、このスクリプトで作ったファイルをリリースに添付する。
//
// frontmatter の metadata に claude-ai: unsupported がある Skill は、claude.ai のサポート外として作らない。
// それ以外の Skill の frontmatter に、skill-creator の検証（アップロードする .skill 向け）が許すキーと、claude.ai に
// 保存できると確かめたキー以外があれば警告する。claude.ai へのアップロードで拒否されることがあるため。警告だけで、ファイルは作る。
//
// 使い方:
//   node scripts/package-skills.mjs [--ref <コミットやタグ>] [--out <ディレクトリ>]
//     --ref  .skill にする版（既定は HEAD）
//     --out  .skill を書き出すディレクトリ（既定は dist）

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "使い方: node scripts/package-skills.mjs [--ref <コミットやタグ>] [--out <ディレクトリ>]";
// skill-creator の quick_validate.py が許す frontmatter のキーと、quick_validate.py は許さないが、claude.ai に保存でき、
// クラウドセッションに同期された写しにも残ると確かめたキー（argument-hint と disable-model-invocation。plan-review で確かめた）。
const UPLOAD_KEYS = new Set([
  "name", "description", "license", "allowed-tools", "metadata", "compatibility",
  "argument-hint", "disable-model-invocation",
]);

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

// 指定した版の SKILL.md の frontmatter から、最上位のキーと metadata の claude-ai の値を読む。
function readFrontmatter(ref, name) {
  const text = git(["show", `${ref}:${name}/SKILL.md`]).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const body = end === -1 ? [] : lines.slice(1, end);
  const keys = body.map((l) => l.match(/^([A-Za-z0-9_-]+):/)?.[1]).filter(Boolean);
  let claudeAi;
  let inMetadata = false;
  for (const l of body) {
    if (/^metadata:\s*$/.test(l)) inMetadata = true;
    else if (/^\S/.test(l)) inMetadata = false;
    else if (inMetadata) claudeAi = l.match(/^\s+claude-ai:\s*["']?([^"'\s]*)["']?\s*$/)?.[1] ?? claudeAi;
  }
  return { unsupportedKeys: keys.filter((k) => !UPLOAD_KEYS.has(k)), claudeAiUnsupported: claudeAi === "unsupported" };
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
      const fm = readFrontmatter(opts.ref, name);
      if (fm.claudeAiUnsupported) {
        console.log(`省略: ${name}（claude.ai のサポート外。frontmatter の metadata に claude-ai: unsupported がある）`);
        continue;
      }
      const skill = join(out, `${name}.skill`);
      // core.autocrlf が true の環境（Windows の既定）では、git archive が改行を CRLF に変えて入れるので、
      // 使う人の設定によらずコミットした内容のまま入れる。.gitattributes の eol の指定は、これまでどおり効く。
      git(["-c", "core.autocrlf=false", "archive", "--format=zip", `--output=${skill}`, opts.ref, `${name}/`]);
      console.log(`作成: ${relative(process.cwd(), skill)}（${statSync(skill).size} バイト）`);
      const keys = fm.unsupportedKeys;
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

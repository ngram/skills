#!/usr/bin/env node
// git リポジトリの全履歴（またはディレクトリ）から、秘密情報と個人情報の手がかりを探す。
// 依存パッケージは無く、Node.js 18 以降の標準機能と git だけで動く。読み取りしかしない。
//
// 使い方:
//   node scan.mjs [--repo <パス>] [オプション]
//     全参照（ブランチ、タグ、リモート追跡、取得してあれば PR の参照）から辿れるすべてのファイルの全版、
//     コミットとタグのメッセージ、作成者・コミッター・タグの作成者、過去に置かれたファイルの名前を調べる
//   node scan.mjs --dir <パス> [オプション]
//     ディレクトリの中のファイルを調べる（展開した公開済みのパッケージなど）
//
// オプション:
//   --term <文字列>       探す語を足す（大文字と小文字を区別しない）。繰り返し指定できる
//   --terms-file <パス>   探す語を1行に1つ書いたファイル（# で始まる行と空行は読み飛ばす）。
//                         チャットやコマンドの履歴に残したくない語（自分の実名など）はこちらに書く
//   --pattern <正規表現>  探す正規表現を足す（大文字と小文字を区別しない）。繰り返し指定できる
//   --exclude <正規表現>  パスがこれに一致するファイルの中身を調べない。繰り返し指定できる
//   --max-bytes <数>      これより大きいファイルの中身は調べない（既定 2000000）
//   --show                見つかった値を伏せずに表示する。既定では値の先頭の数文字と長さだけを出す
//
// 終了コード: 見つかったものがあれば1、無ければ0、使い方の誤りや git の失敗は2。

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const USAGE = `使い方: node scan.mjs [--repo <パス> | --dir <パス>] [オプション]

  --repo <パス>         git リポジトリの全参照から辿れる全履歴を調べる（既定は現在のディレクトリ）
  --dir <パス>          ディレクトリの中のファイルを調べる（展開した公開済みのパッケージなど）
  --term <文字列>       探す語を足す（大文字と小文字を区別しない）。繰り返し指定できる
  --terms-file <パス>   探す語を1行に1つ書いたファイル（# で始まる行と空行は読み飛ばす）
  --pattern <正規表現>  探す正規表現を足す（大文字と小文字を区別しない）。繰り返し指定できる
  --exclude <正規表現>  パスがこれに一致するファイルの中身を調べない。繰り返し指定できる
  --max-bytes <数>      これより大きいファイルの中身は調べない（既定 2000000）
  --show                見つかった値を伏せずに表示する

終了コード: 見つかったものがあれば1、無ければ0、使い方の誤りや git の失敗は2`;

const SEVERITIES = ["高", "中", "低"];
const SHOWN_LOCATIONS = 3;
const SHOWN_VALUES_PER_RULE = 30;
const MAX_ORIGIN_LOOKUPS = 100;

// ---------------------------------------------------------------------------
// 検出の規則

const NOREPLY = /no-?reply/i;
// 例示用に予約されたドメイン（RFC 2606、RFC 6761）。
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|local)$/i;
// 個人が使うことの多いメールのドメイン。ここに当たるアドレスは個人のものとみなして重要度を上げる。
const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.jp", "ymail.ne.jp", "outlook.com", "outlook.jp",
  "hotmail.com", "hotmail.co.jp", "live.com", "live.jp", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "mail.ru", "yandex.ru", "qq.com",
  "163.com", "naver.com", "docomo.ne.jp", "ezweb.ne.jp", "au.com", "softbank.ne.jp", "i.softbank.jp",
  "nifty.com", "biglobe.ne.jp", "so-net.ne.jp", "ocn.ne.jp",
]);
// 例やCI、コンテナでよく使われ、個人を指さないユーザー名。
const GENERIC_USERS = new Set([
  "user", "users", "runner", "runneradmin", "ubuntu", "root", "admin", "administrator", "username", "yourname",
  "your-name", "your_name", "you", "me", "name", "vscode", "codespace", "codespaces", "node", "app", "ec2-user",
  "shared", "public", "default", "all users", "circleci", "travis", "jenkins", "builder", "build", "docker",
  "foo", "bar", "alice", "bob", "test", "guest", "example", "linuxbrew", "git", "postgres", "www-data",
]);
// 決済サービスが公開しているテスト用のカード番号。
const TEST_CARD_NUMBERS = new Set([
  "4242424242424242", "4111111111111111", "4012888888881881", "4000056655665556", "5555555555554444",
  "5105105105105100", "378282246310005", "371449635398431", "6011111111111117", "3530111333300000",
]);
const PLACEHOLDER = /^(?:\$\{?|<|\{\{|%\(|xxx|\*{3}|change[_-]?me|your[_-]|my[_-]|example|sample|dummy|placeholder|password|secret|token|redacted|null|none|undefined|true|false|test)/i;

function emailSeverity(address) {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();
  if (NOREPLY.test(address) || RESERVED_DOMAIN.test(domain)) return null;
  if (/^\d+x\./.test(domain) || /\.(?:png|jpe?g|gif|svg|webp|ico)$/.test(domain)) return null; // icon@2x.png
  if (local === "git") return null; // git@github.com:owner/repo の形の SSH の URL
  return PERSONAL_MAIL_DOMAINS.has(domain) ? "高" : "中";
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

function ipSeverity(ip) {
  const o = ip.split(".").map(Number);
  if (o.some((n) => n > 255) || o[0] === 0 || o[0] === 127) return null;
  if (o.every((n) => n < 10)) return null; // 2.3.1.4 のような節の番号や版番号
  if (o[2] === 0 && o[3] === 0) return null; // 172.16.0.0 のような範囲の先頭や版番号
  if (ip === "169.254.169.254") return null; // クラウドのメタデータサーバー
  // 文書用に予約された範囲（RFC 5737）。
  if ((o[0] === 192 && o[1] === 0 && o[2] === 2) || (o[0] === 198 && o[1] === 51 && o[2] === 100) || (o[0] === 203 && o[1] === 0 && o[2] === 113)) return null;
  const local = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)
    || (o[0] === 169 && o[1] === 254) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || o[0] >= 224;
  return local ? "低" : "中";
}

// value: 記録して伏せる値。prefix: 伏せずに添える文脈（代入のキーなど）。
// check: null を返すとその一致を捨てる。重要度の文字列を返すと、規則の既定の重要度の代わりに使う。
const CONTENT_RULES = [
  { id: "private-key", label: "秘密鍵", severity: "高", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, show: true },
  { id: "aws-key", token: true, label: "AWS のアクセスキー", severity: "高", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "github-token", token: true, label: "GitHub のトークン", severity: "高", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { id: "gitlab-token", token: true, label: "GitLab のトークン", severity: "高", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { id: "slack-token", token: true, label: "Slack のトークン・Webhook", severity: "高", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g },
  { id: "anthropic-key", token: true, label: "Anthropic の API キー", severity: "高", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  {
    id: "openai-key", token: true, label: "OpenAI の API キー", severity: "高", re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
    check: (m) => (/\d/.test(m[0]) && /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0].slice(3)) ? true : null),
  },
  { id: "google-key", token: true, label: "Google の API キー", severity: "高", re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: "stripe-key", token: true, label: "Stripe のシークレットキー", severity: "高", re: /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}/g },
  { id: "npm-token", token: true, label: "npm のトークン", severity: "高", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: "pypi-token", token: true, label: "PyPI のトークン", severity: "高", re: /\bpypi-AgE[A-Za-z0-9_-]{50,}/g },
  { id: "rubygems-key", token: true, label: "RubyGems の API キー", severity: "高", re: /\brubygems_[0-9a-f]{48}\b/g },
  { id: "jwt", label: "JWT", severity: "中", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    id: "url-credentials", label: "URL に埋め込んだパスワード", severity: "高",
    re: /\b([a-z][a-z0-9+.-]*):\/\/[^\s:@/'"`<>]+:([^\s@/'"`<>]+)@([^\s/'"`<>:]+)/gi,
    value: (m) => m[2], prefix: (m) => `${m[1]}://…@${m[3]}`,
    check: (m) => {
      // 説明文の「ユーザー:パスワード@ホスト」のような、ASCII 以外を含む例は捨てる。
      if (/[^\x21-\x7e]/.test(m[0]) || PLACEHOLDER.test(m[2]) || /^(?:pass(?:word)?|pwd|\*+)$/i.test(m[2])) return null;
      return /^(?:localhost|127\.0\.0\.1|db|database|postgres|mysql|redis)$|example/i.test(m[3]) ? "低" : true;
    },
  },
  {
    id: "secret-assignment", label: "パスワード・トークンらしい値の代入", severity: "中",
    re: /(?<![A-Za-z0-9])(?<key>api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|secret|password|passwd|access[_-]?token|auth[_-]?token|_auth(?:token)?|refresh[_-]?token|private[_-]?key|token)(?![A-Za-z0-9])["']?\s*(?:=>|=|:)\s*(?:"(?<dq>[^"\s]{8,})"|'(?<sq>[^'\s]{8,})'|(?<bare>[A-Za-z0-9_\-/+=.]{12,})[ \t]*$)/gim,
    value: (m) => m.groups.dq ?? m.groups.sq ?? m.groups.bare, prefix: (m) => m.groups.key,
    check: (m) => {
      const v = m.groups.dq ?? m.groups.sq ?? m.groups.bare;
      if (PLACEHOLDER.test(v) || /^(.)\1+$/.test(v) || TOKEN_PATTERNS.some((re) => re.test(v))) return null; // トークンの規則で出す
      if (m.groups.bare && !(/\d/.test(v) && /[A-Za-z]/.test(v))) return null; // SecureRandom.hex のようなコード
      return true;
    },
  },
  {
    id: "email", label: "メールアドレス", severity: "中", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    check: (m) => emailSeverity(m[0]), mask: "email",
  },
  {
    id: "phone", label: "電話番号", severity: "中",
    re: /(?<![\d+-])(?:0\d{1,4}-\d{1,4}-\d{4}|0[789]0\d{8}|\+81[- ]?\d{1,4}[- ]?\d{1,4}[- ]?\d{4})(?![\d-])/g,
    check: (m) => {
      const d = m[0].replace(/\D/g, "");
      if (/^(\d)\1+$/.test(d.slice(-8))) return null; // 090-0000-0000 のようなダミー
      return d.startsWith("81") ? (d.length >= 11 && d.length <= 12 ? true : null) : (d.length >= 10 && d.length <= 11 ? true : null);
    },
  },
  { id: "postal-code", label: "郵便番号（〒付き）", severity: "中", re: /〒\s?\d{3}-?\d{4}/g },
  {
    id: "card-number", label: "クレジットカード番号", severity: "高", re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
    check: (m) => {
      const d = m[0].replace(/\D/g, "");
      if (!/^(?:4|5[1-5]|3[47]|6011|35)/.test(d) || /^(\d)\1+$/.test(d) || TEST_CARD_NUMBERS.has(d)) return null;
      return luhn(d) ? true : null;
    },
  },
  {
    id: "home-path", label: "ユーザー名入りのパス", severity: "中",
    re: /(?:\/Users\/|\/home\/|\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)([^\s\\/:*?"'<>|`$%{}]+)/g,
    check: (m) => (GENERIC_USERS.has(m[1].toLowerCase()) ? null : true), mask: "path",
  },
  { id: "cloud-storage-path", label: "個人のクラウドストレージのパス", severity: "低", re: /(?:Dropbox|OneDrive|Google Drive|iCloud Drive)[\\/]/g, show: true },
  {
    id: "ip-address", label: "IP アドレス", severity: "中", re: /(?<![\d.]|[A-Za-z0-9]\/|[vV])(?:\d{1,3}\.){3}\d{1,3}(?!\.?\d)/g,
    check: (m) => ipSeverity(m[0]), show: true,
  },
  {
    id: "internal-host", label: "社内・内部向けのホスト名", severity: "中",
    re: /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:internal|corp|intranet|lan)\b/gi,
    check: (m) => (/^(?:metadata\.google\.internal|host\.docker\.internal|gateway\.docker\.internal)$/i.test(m[0]) ? null : true),
  },
  {
    id: "dev-url", label: "開発用の公開 URL（Codespaces、workers.dev、トンネル）", severity: "低",
    re: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:app\.github\.dev|workers\.dev|ngrok(?:-free)?\.(?:io|app|dev)|trycloudflare\.com|loca\.lt)\b/gi,
    check: (m) => (/example|<|\*/.test(m[0]) || /^[a-z0-9-]+\.workers\.dev$/i.test(m[0]) ? null : true),
  },
  { id: "session-url", label: "AI のセッション・会話の URL", severity: "低", re: /\bclaude\.ai\/code\/session_[A-Za-z0-9]+|\bchatgpt\.com\/(?:share|c)\/[0-9a-f-]{20,}/g },
];

// 過去に一度でも置かれたファイルの名前に当てる規則。中身を見なくても、置いたこと自体が問題になりうる。
const PATH_RULES = [
  {
    id: "env-file", label: ".env ファイル", severity: "高", re: /(?:^|\/)\.env(?:\.[^/]+)?$/,
    check: (p) => !/\.(?:example|sample|template|dist|defaults?|schema)$/i.test(p),
  },
  { id: "key-file", label: "鍵・証明書のファイル", severity: "高", re: /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx|jks|keystore|ppk|kdbx))$/i },
  {
    id: "credential-file", label: "認証情報のファイル", severity: "高",
    re: /(?:^|\/)(?:\.pypirc|\.netrc|\.pgpass|\.git-credentials|\.htpasswd|\.aws\/credentials|\.gem\/credentials|credentials\.(?:json|ya?ml|toml|ini|csv|txt)|secrets?\.(?:json|ya?ml|toml)|service[-_]?account[^/]*\.json|terraform\.tfstate(?:\.backup)?|\.(?:bash|zsh)_history)$/i,
  },
  { id: "registry-config", label: "トークンを書くことがある設定ファイル", severity: "低", re: /(?:^|\/)(?:\.npmrc|\.yarnrc\.yml|\.docker\/config\.json)$/i },
  { id: "data-file", label: "データのダンプ・記録", severity: "中", re: /(?:^|\/)[^/]+\.(?:sqlite3?|db|sql|dump|har|log)$/i },
  { id: "os-metadata", label: "OS が作るファイル（フォルダの名前が残る）", severity: "低", re: /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i },
];

// 代入の値がサービスのトークンなら、トークンの規則だけで出す。
const TOKEN_PATTERNS = CONTENT_RULES.filter((r) => r.token).map((r) => new RegExp(r.re.source));

for (const rule of PATH_RULES) rule.show = true; // パスは秘密ではないので伏せない

const IDENTITY_RULE = { id: "identity-email", label: "作成者・コミッター・タグの作成者のメールアドレス", severity: "中", mask: "email" };

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// 引数

function parseArgs(argv) {
  const opts = { repo: null, dir: null, terms: [], patterns: [], excludes: [], maxBytes: 2_000_000, show: false };
  const need = (i, name) => {
    if (i >= argv.length) throw new Error(`${name} の値が無い`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") opts.repo = need(++i, a);
    else if (a === "--dir") opts.dir = need(++i, a);
    else if (a === "--term") opts.terms.push(need(++i, a));
    else if (a === "--terms-file") {
      const lines = readFileSync(need(++i, a), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
      opts.terms.push(...lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
    } else if (a === "--pattern") opts.patterns.push(need(++i, a));
    else if (a === "--exclude") opts.excludes.push(new RegExp(need(++i, a)));
    else if (a === "--max-bytes") {
      opts.maxBytes = Number.parseInt(need(++i, a), 10);
      if (Number.isNaN(opts.maxBytes)) throw new Error(`--max-bytes が数値ではない: ${argv[i]}`);
    } else if (a === "--show") opts.show = true;
    else if (a === "-h" || a === "--help") return null;
    else throw new Error(`知らないオプション: ${a}`);
  }
  if (opts.repo && opts.dir) throw new Error("--repo と --dir は同時に指定できない");
  return opts;
}

function buildRules(opts) {
  const custom = [
    ...opts.terms.map((t, i) => ({ id: `term-${i + 1}`, label: `指定した語 ${i + 1}`, severity: "高", re: new RegExp(escapeRegExp(t), "gi"), value: (m) => m[0].toLowerCase(), custom: true })),
    ...opts.patterns.map((p, i) => ({ id: `pattern-${i + 1}`, label: `指定した正規表現 ${i + 1}`, severity: "高", re: new RegExp(p, "gi"), custom: true })),
  ];
  return [...custom, ...CONTENT_RULES];
}

// ---------------------------------------------------------------------------
// 見つかったものの記録と、値の伏せ方

class Findings {
  constructor(show) {
    this.show = show;
    this.map = new Map();
  }

  add(rule, value, severity, location, prefix = "") {
    const key = `${rule.id}\0${prefix}\0${value}`;
    let f = this.map.get(key);
    if (!f) {
      f = { rule, value, prefix, severity, locations: [], count: 0 };
      this.map.set(key, f);
    }
    if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(f.severity)) f.severity = severity;
    f.count += 1;
    if (f.locations.length < 50) f.locations.push(location);
  }

  mask(f) {
    const v = f.value;
    if (this.show || f.rule.show) return v;
    if (f.rule.mask === "email") {
      const at = v.lastIndexOf("@");
      return `${v[0]}***@${v.slice(at + 1)}`;
    }
    if (f.rule.mask === "path") return v.replace(/([\\/])([^\\/]+)$/, (_, s, name) => `${s}${name[0]}***`);
    const chars = [...v];
    const keep = Math.min(4, Math.floor(chars.length / 4));
    return `${chars.slice(0, keep).join("")}…（${chars.length}文字）`;
  }

  sorted() {
    return [...this.map.values()].sort((a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.rule.label.localeCompare(b.rule.label) || b.count - a.count);
  }
}

function lineFinder(text) {
  let starts = null;
  return (index) => {
    if (!starts) {
      starts = [0];
      for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function scanText(text, rules, findings, location) {
  const lineAt = lineFinder(text);
  for (const rule of rules) {
    for (const m of text.matchAll(rule.re)) {
      const verdict = rule.check ? rule.check(m) : true;
      if (!verdict) continue;
      const severity = verdict === true ? rule.severity : verdict;
      const value = rule.value ? rule.value(m) : m[0];
      const prefix = rule.prefix ? rule.prefix(m) : "";
      findings.add(rule, value, severity, { ...location, line: lineAt(m.index) }, prefix);
    }
  }
}

function scanPath(path, findings, location) {
  for (const rule of PATH_RULES) {
    if (rule.re.test(path) && (!rule.check || rule.check(path))) findings.add(rule, path, rule.severity, location);
  }
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

// ---------------------------------------------------------------------------
// git

function makeGit(cwd) {
  return (args, { input, buffer = false, maxBuffer = 1 << 30, allowFail = false } = {}) => {
    const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
      cwd, input, maxBuffer, ...(buffer ? {} : { encoding: "utf8" }),
    });
    if (r.error) throw new Error(`git を実行できない: ${r.error.message}`);
    if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} が失敗した: ${String(r.stderr).trim()}`);
    return r;
  };
}

function refKind(ref) {
  if (/^refs\/pull\//.test(ref) || /^refs\/remotes\/[^/]+\/(?:pull|pr)\//.test(ref)) return "PR";
  if (ref.startsWith("refs/heads/")) return "ブランチ";
  if (ref.startsWith("refs/tags/")) return "タグ";
  if (ref.startsWith("refs/remotes/")) return "リモート追跡";
  return "その他";
}

const shortRef = (ref) => ref.replace(/^refs\/(?:heads|tags|remotes)\//, "").replace(/^refs\//, "");

// blob を読み出す。メモリを使いすぎないよう、合計の大きさで区切って git cat-file --batch に渡す。
function* readBlobs(git, entries) {
  const LIMIT = 64 << 20;
  let i = 0;
  while (i < entries.length) {
    const chunk = [];
    let bytes = 0;
    while (i < entries.length && (chunk.length === 0 || bytes + entries[i].size < LIMIT)) {
      bytes += entries[i].size + 100;
      chunk.push(entries[i++]);
    }
    const out = git(["cat-file", "--batch"], { input: `${chunk.map((e) => e.sha).join("\n")}\n`, buffer: true, maxBuffer: bytes + (1 << 20) }).stdout;
    let pos = 0;
    for (const e of chunk) {
      const nl = out.indexOf(10, pos);
      const size = Number(out.toString("utf8", pos, nl).split(" ")[2]);
      yield { ...e, data: out.subarray(nl + 1, nl + 1 + size) };
      pos = nl + 1 + size + 1;
    }
  }
}

function scanRepo(repo, opts, rules, findings) {
  const git = makeGit(repo);
  git(["rev-parse", "--git-dir"]);
  const summary = [];

  const refs = git(["for-each-ref", "--format=%(refname)"]).stdout.split("\n").filter(Boolean).filter((r) => r !== "refs/stash");
  const kinds = { ブランチ: 0, タグ: 0, リモート追跡: 0, PR: 0, その他: 0 };
  for (const r of refs) kinds[refKind(r)] += 1;
  summary.push(`対象: ${repo}（git の全参照）`);
  summary.push(`参照: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join("、")}`);
  if (kinds.PR === 0) {
    summary.push("  PR の参照（refs/pull/*）が無い。GitHub では、マージ後に消したブランチの内容も PR から辿れる。");
    summary.push("  調べるときは git clone --mirror で取り直すか、+refs/pull/*:refs/remotes/origin/pull/* を fetch する");
  }
  const shallow = git(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
  summary.push(`浅いクローン: ${shallow ? "はい（古い履歴が無い。git fetch --unshallow で取り直す）" : "いいえ"}`);

  // すべての参照から辿れるオブジェクトのうち、blob を集める。
  const revList = git(["rev-list", "--objects", "--all"]).stdout;
  const batch = git(["cat-file", "--batch-check=%(objecttype) %(objectname) %(objectsize) %(rest)"], { input: revList }).stdout;
  let commits = 0;
  const blobs = [];
  for (const line of batch.split("\n")) {
    if (!line) continue;
    const [type, sha, size] = line.split(" ", 3);
    if (type === "commit") commits += 1;
    if (type !== "blob") continue;
    const path = line.split(" ").slice(3).join(" ");
    blobs.push({ sha, size: Number(size), path });
  }
  if (commits === 0) {
    summary.push("コミットが無い");
    return summary;
  }

  let large = 0;
  let excluded = 0;
  let binary = 0;
  const targets = [];
  for (const b of blobs) {
    if (opts.excludes.some((re) => re.test(b.path))) excluded += 1;
    else if (b.size > opts.maxBytes) large += 1;
    else targets.push(b);
  }
  for (const b of readBlobs(git, targets)) {
    if (isBinary(b.data)) {
      binary += 1;
      continue;
    }
    scanText(b.data.toString("utf8"), rules, findings, { kind: "blob", path: b.path, blob: b.sha });
  }

  // コミットのメッセージと、作成者・コミッター。
  const identities = new Map();
  const zones = new Map();
  const addIdentity = (name, email, role, commit) => {
    const key = `${name}\0${email}`;
    let id = identities.get(key);
    if (!id) {
      id = { name, email, roles: new Set(), count: 0, commit };
      identities.set(key, id);
    }
    id.roles.add(role);
    id.count += 1;
  };
  const log = git(["log", "--all", "--format=%H%x00%an%x00%ae%x00%ai%x00%cn%x00%ce%x00%ci%x00%B%x1e"]).stdout;
  for (const rec of log.split("\x1e")) {
    const fields = rec.replace(/^\n/, "").split("\x00");
    if (fields.length < 8) continue;
    const [sha, an, ae, ad, cn, ce, cd, body] = fields;
    addIdentity(an, ae, "作成者", sha);
    addIdentity(cn, ce, "コミッター", sha);
    for (const d of [ad, cd]) {
      const z = d.split(" ").pop();
      zones.set(z, (zones.get(z) ?? 0) + 1);
    }
    scanText(body, rules, findings, { kind: "message", commit: sha });
  }

  // 注釈付きタグのメッセージと、タグの作成者。
  let tagMessages = 0;
  const tags = git(["for-each-ref", "refs/tags", "--format=%(refname)%00%(objecttype)%00%(taggername)%00%(taggeremail)%00%(contents)%1e"]).stdout;
  for (const rec of tags.split("\x1e")) {
    const [ref, type, name, email, contents] = rec.replace(/^\n/, "").split("\x00");
    if (type !== "tag") continue;
    tagMessages += 1;
    addIdentity(name, email.replace(/^<|>$/g, ""), "タグの作成者", null);
    scanText(contents, rules, findings, { kind: "tag", ref });
  }

  // 過去に置かれたファイルの名前（追加されたときのパスをすべて見る）。
  const added = git(["log", "--all", "--no-renames", "--diff-filter=A", "--name-only", "--format=%x1e%H"]).stdout;
  for (const rec of added.split("\x1e")) {
    const [sha, ...paths] = rec.trim().split("\n");
    for (const p of paths) if (p) scanPath(p, findings, { kind: "path", path: p, commit: sha });
  }

  // 指定した語は、作成者の名前とメールアドレスにも当てる。一覧では、当たった部分を伏せる。
  const customRules = rules.filter((r) => r.custom);
  const hideTerms = (text) => (opts.show ? text : customRules.reduce((t, r) => t.replace(r.re, (m) => `${m[0]}***`), text));
  for (const id of identities.values()) {
    const where = { kind: "identity", name: hideTerms(id.name), roles: id.roles, commit: id.commit, count: id.count };
    const severity = emailSeverity(id.email);
    if (severity) findings.add(IDENTITY_RULE, id.email, severity, where);
    for (const rule of customRules) {
      for (const m of `${id.name} <${id.email}>`.matchAll(rule.re)) findings.add(rule, m[0], rule.severity, where);
    }
  }

  summary.push(`コミット ${commits}、ファイルの版 ${blobs.length}（中身を調べた ${targets.length - binary}、バイナリ ${binary}、${opts.maxBytes} バイト超 ${large}、除外 ${excluded}）、注釈付きタグ ${tagMessages}`);
  summary.push("");
  summary.push("== 作成者・コミッター・タグの作成者");
  for (const id of [...identities.values()].sort((a, b) => b.count - a.count)) {
    const email = emailSeverity(id.email) && !opts.show ? findings.mask({ rule: IDENTITY_RULE, value: id.email }) : id.email;
    summary.push(`${String(id.count).padStart(6)}  ${hideTerms(id.name)} <${email}>（${[...id.roles].join("・")}）`);
  }
  summary.push(`タイムゾーン: ${[...zones].sort((a, b) => b[1] - a[1]).map(([z, n]) => `${z}（${n}）`).join("、")}`);

  annotateLocations(git, findings);
  return summary;
}

// blob が今の HEAD にあるか、最初に入ったコミット、そのコミットを含む参照を調べて、場所に書き足す。
function annotateLocations(git, findings) {
  const head = git(["ls-tree", "-r", "-z", "HEAD"], { allowFail: true });
  const headBlobs = new Set();
  const headPaths = new Set();
  if (head.status === 0) {
    for (const entry of head.stdout.split("\0")) {
      const m = entry.match(/^\S+ blob (\S+)\t(.*)$/s);
      if (m) {
        headBlobs.add(m[1]);
        headPaths.add(m[2]);
      }
    }
  }
  const origins = new Map();
  const refsOf = new Map();
  const containing = (commit) => {
    if (!refsOf.has(commit)) {
      const out = git(["for-each-ref", "--contains", commit, "--format=%(refname)"], { allowFail: true }).stdout ?? "";
      refsOf.set(commit, out.split("\n").filter((r) => r && r !== "refs/stash"));
    }
    return refsOf.get(commit);
  };
  for (const f of findings.map.values()) {
    for (const loc of f.locations.slice(0, SHOWN_LOCATIONS)) {
      if (loc.kind === "blob") {
        loc.inHead = headBlobs.has(loc.blob);
        if (!origins.has(loc.blob) && origins.size < MAX_ORIGIN_LOOKUPS) {
          const out = git(["log", "--all", "--format=%H", `--find-object=${loc.blob}`], { allowFail: true }).stdout ?? "";
          origins.set(loc.blob, out.trim().split("\n").filter(Boolean).pop() ?? null);
        }
        loc.commit = origins.get(loc.blob);
      } else if (loc.kind === "path") {
        loc.inHead = headPaths.has(loc.path);
      }
      if (loc.commit) loc.refs = containing(loc.commit);
    }
  }
}

// ---------------------------------------------------------------------------
// ディレクトリ

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === ".git" ? [] : listFiles(p);
    return e.isFile() ? [p] : [];
  });
}

function scanDir(dir, opts, rules, findings) {
  let scanned = 0;
  let binary = 0;
  let large = 0;
  let excluded = 0;
  const files = listFiles(dir);
  for (const file of files) {
    const rel = relative(dir, file).split(sep).join("/");
    scanPath(rel, findings, { kind: "file", path: rel });
    if (opts.excludes.some((re) => re.test(rel))) {
      excluded += 1;
      continue;
    }
    if (statSync(file).size > opts.maxBytes) {
      large += 1;
      continue;
    }
    const buf = readFileSync(file);
    if (isBinary(buf)) {
      binary += 1;
      continue;
    }
    scanned += 1;
    scanText(buf.toString("utf8"), rules, findings, { kind: "file", path: rel });
  }
  return [
    `対象: ${dir}（ディレクトリ）`,
    `ファイル ${files.length}（中身を調べた ${scanned}、バイナリ ${binary}、${opts.maxBytes} バイト超 ${large}、除外 ${excluded}）`,
  ];
}

// ---------------------------------------------------------------------------
// 出力

const short = (sha) => (sha ? sha.slice(0, 7) : "?");

function describeRefs(refs) {
  if (!refs) return "";
  if (refs.length === 0) return "、どの参照からも辿れない";
  const onlyPr = refs.every((r) => refKind(r) === "PR");
  const names = refs.slice(0, 2).map(shortRef).join(", ") + (refs.length > 2 ? ` ほか${refs.length - 2}` : "");
  return onlyPr ? `、PR の参照からだけ辿れる: ${names}` : `、参照: ${names}`;
}

function describeLocation(loc) {
  const head = loc.inHead === undefined ? "" : loc.inHead ? "、HEAD にある" : "、履歴だけ";
  switch (loc.kind) {
    case "blob":
      return `${loc.path}:${loc.line}（blob ${short(loc.blob)}、初出 ${loc.commit === undefined ? "未調査" : short(loc.commit)}${head}${describeRefs(loc.refs)}）`;
    case "message":
      return `コミット ${short(loc.commit)} のメッセージ ${loc.line} 行目（${describeRefs(loc.refs).slice(1) || "参照なし"}）`;
    case "tag":
      return `タグ ${shortRef(loc.ref)} のメッセージ ${loc.line} 行目`;
    case "path":
      return `コミット ${short(loc.commit)} で追加${head}${describeRefs(loc.refs)}`;
    case "identity":
      return `${loc.name}（${[...loc.roles].join("・")}、${loc.count} 回、例: コミット ${short(loc.commit)}${describeRefs(loc.refs)}）`;
    case "file":
      return loc.line ? `${loc.path}:${loc.line}` : loc.path;
    default:
      return "";
  }
}

function report(summary, findings) {
  const out = ["== 調べた範囲", ...summary, ""];
  const all = findings.sorted();
  const counts = SEVERITIES.map((s) => `${s} ${all.filter((f) => f.severity === s).length}`).join("、");
  out.push(all.length ? `== 見つかったもの（${counts}）` : "== 見つかったもの: なし");
  const perRule = new Map();
  for (const f of all) {
    const key = `${f.severity}\0${f.rule.id}`;
    const n = (perRule.get(key) ?? 0) + 1;
    perRule.set(key, n);
    if (n === SHOWN_VALUES_PER_RULE + 1) {
      const rest = all.filter((g) => g.severity === f.severity && g.rule.id === f.rule.id).length - SHOWN_VALUES_PER_RULE;
      out.push(`[${f.severity}] ${f.rule.label}: ほか ${rest} 種類（--exclude で絞るか、--show を付けずに個別に確かめる）`);
    }
    if (n > SHOWN_VALUES_PER_RULE) continue;
    const prefix = f.prefix ? `${f.prefix}: ` : "";
    out.push(`[${f.severity}] ${f.rule.label}: ${prefix}${findings.mask(f)}${f.count > 1 ? `（${f.count} か所）` : ""}`);
    for (const loc of f.locations.slice(0, SHOWN_LOCATIONS)) out.push(`    ${describeLocation(loc)}`);
    if (f.count > SHOWN_LOCATIONS) out.push(`    ほか ${f.count - SHOWN_LOCATIONS} か所`);
  }
  if (all.length && !findings.show) {
    out.push("");
    out.push("値は伏せてある。確かめるときは示した場所を開く（git show <blob> など）。報告やプルリクエストには値を書き写さない。");
  }
  return out.join("\n");
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
  const rules = buildRules(opts);
  const findings = new Findings(opts.show);
  let summary;
  try {
    summary = opts.dir ? scanDir(resolve(opts.dir), opts, rules, findings) : scanRepo(resolve(opts.repo ?? "."), opts, rules, findings);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  console.log(report(summary, findings));
  return findings.map.size ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

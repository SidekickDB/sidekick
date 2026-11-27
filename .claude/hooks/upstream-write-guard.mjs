#!/usr/bin/env node
// PreToolUse hook for Bash: blocks commands that write to the upstream
// repository (any repository of the GitHub owner `instantdb`). It splits the
// command like a shell does, so a quoted pull request description that names
// upstream is text, not a target. Fails closed: input it cannot read or a
// command it cannot parse is blocked (exit 2). Commands that do not mention
// `instantdb` or `upstream` are not parsed at all.
//
// Tests: node --test .claude/hooks/upstream-write-guard.test.mjs

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OWNER = "instantdb";
const MAX_DEPTH = 8;

// gh commands that only read, allowed even when they target upstream.
const GH_READS = new Set([
  "pr view",
  "pr diff",
  "pr list",
  "pr checks",
  "pr status",
  "pr checkout",
  "issue view",
  "issue list",
  "issue status",
  "repo view",
  "repo clone",
  "release view",
  "release list",
  "release download",
  "run view",
  "run list",
  "run download",
  "run watch",
  "workflow view",
  "workflow list",
  "label list",
  "cache list",
  "ruleset list",
  "ruleset view",
  "ruleset check",
]);
const GH_READ_GROUPS = new Set(["browse", "search", "status"]);

const KEYWORDS = new Set([
  "{",
  "}",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const PLAIN_WRAPPERS = new Set([
  "command",
  "builtin",
  "exec",
  "noglob",
  "nohup",
  "time",
  "sudo",
  "stdbuf",
]);

class ParseError extends Error {}

// Splits shell source into simple commands (arrays of words, quotes removed).
// Commands inside `$(...)` and backticks are returned in `nested`. With
// `inSub`, parsing stops at the `)` that closes the substitution.
function parseAt(src, start, inSub) {
  const commands = [];
  const nested = [];
  const heredocs = [];
  let words = [];
  let word = null;
  let skip = null; // "target" after a redirection, "heredoc" after << or <<-
  let depth = 0; // open subshell parentheses
  let i = start;

  const add = (s) => (word = (word ?? "") + s);
  const endWord = () => {
    if (word === null) return;
    if (skip === "heredoc") heredocs.push(word);
    else if (skip !== "target") words.push(word);
    skip = null;
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  const take = (inner) => {
    nested.push(...inner.commands, ...inner.nested);
    add("$()");
  };
  const substitution = () => {
    if (src[i] === "`") {
      let end = i + 1;
      while (end < src.length && src[end] !== "`")
        end += src[end] === "\\" ? 2 : 1;
      if (end >= src.length) throw new ParseError("unbalanced backtick");
      take(
        parseAt(src.slice(i + 1, end).replace(/\\([\\`$])/g, "$1"), 0, false),
      );
      i = end + 1;
    } else {
      const inner = parseAt(src, i + 2, true);
      take(inner);
      i = inner.end + 1;
    }
  };
  const skipHeredocs = () => {
    while (heredocs.length) {
      const delimiter = heredocs.shift();
      for (;;) {
        if (i >= src.length) throw new ParseError("unterminated here-document");
        let end = src.indexOf("\n", i);
        if (end < 0) end = src.length;
        const line = src.slice(i, end);
        i = end + 1;
        if (line.replace(/^\t+/, "") === delimiter) break;
      }
    }
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] !== "\n") add(src[i + 1] ?? "");
      i += 2;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new ParseError("unterminated single quote");
      add(src.slice(i + 1, end));
      i = end + 1;
    } else if (c === '"') {
      add("");
      i++;
      for (;;) {
        if (i >= src.length) throw new ParseError("unterminated double quote");
        const d = src[i];
        if (d === '"') {
          i++;
          break;
        }
        if (d === "\\" && '\\"$`\n'.includes(src[i + 1])) {
          if (src[i + 1] !== "\n") add(src[i + 1]);
          i += 2;
        } else if ((d === "$" && src[i + 1] === "(") || d === "`") {
          substitution();
        } else {
          add(d);
          i++;
        }
      }
    } else if ((c === "$" && src[i + 1] === "(") || c === "`") {
      substitution();
    } else if (c === "#" && word === null) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === " " || c === "\t") {
      endWord();
      i++;
    } else if (c === "\n") {
      endCommand();
      i++;
      skipHeredocs();
    } else if (c === ">" || c === "<" || (c === "&" && src[i + 1] === ">")) {
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      const op = /^(<<-|<<<|<<|<>|<&|<|&>>|&>|>>|>&|>\||>)/.exec(
        src.slice(i),
      )[0];
      i += op.length;
      if (op === "<<" || op === "<<-") skip = "heredoc";
      else if ((op === ">&" || op === "<&") && /^[\d-]/.test(src[i] ?? "")) {
        while (/[\d-]/.test(src[i] ?? "")) i++;
      } else skip = "target";
    } else if (c === ")" && inSub && depth === 0) {
      endCommand();
      if (heredocs.length) throw new ParseError("unterminated here-document");
      return { commands, nested, end: i };
    } else if (";&|()".includes(c)) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      endCommand();
      i++;
      while (i < src.length && ";&|".includes(src[i])) i++;
    } else {
      add(c);
      i++;
    }
  }
  if (inSub) throw new ParseError("unbalanced $(");
  endCommand();
  if (heredocs.length) throw new ParseError("unterminated here-document");
  return { commands, nested, end: i };
}

export function parse(src) {
  const { commands, nested } = parseAt(src, 0, false);
  return { commands, nested };
}

const basename = (p) => p.slice(p.lastIndexOf("/") + 1);
const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
const unresolved = (v) => v.includes("$");

function expand(word, env) {
  return word.replace(
    /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
    (m, name) => env.get(name) ?? m,
  );
}

// `[HOST/]OWNER/REPO`, a GitHub URL or an SSH remote, reduced to `owner/repo`.
export function normalizeRepo(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z+]+:\/\//, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^www\./, "")
    .replace(/^github\.com[:/]/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

const isUpstreamRepo = (value) => normalizeRepo(value).split("/")[0] === OWNER;
const isUpstreamUrl = (value) =>
  /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?(?:www\.)?github\.com[:/]instantdb(?:[/.]\S*)?$/i.test(
    value.trim(),
  );

function checkGh(args, env) {
  const targets = [];
  if (env.has("GH_REPO")) targets.push(env.get("GH_REPO"));
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-R" || a === "--repo") targets.push(args[++i] ?? "");
    else if (a.startsWith("--repo=")) targets.push(a.slice(7));
    else if (/^-R./.test(a)) targets.push(a.slice(2));
    else {
      if (isUpstreamUrl(a)) targets.push(a);
      words.push(a);
    }
  }
  const group = words[0] && !words[0].startsWith("-") ? words[0] : "";
  const sub = group && words[1] && !words[1].startsWith("-") ? words[1] : "";
  if (group === "api")
    return checkGhApi(args.slice(args.indexOf("api") + 1), env);
  if (group === "repo") {
    for (const w of words.slice(2)) {
      if (/^[\w.-]+\/[\w.-]+$/.test(normalizeRepo(w)) && !w.startsWith("-"))
        targets.push(w);
    }
  }
  if (GH_READ_GROUPS.has(group) || GH_READS.has(`${group} ${sub}`)) return null;
  const target = targets.find(
    (t) => unresolved(t) || isUpstreamRepo(t) || isUpstreamUrl(t),
  );
  if (target === undefined) return null;
  return unresolved(target)
    ? `\`gh ${group} ${sub}\` with a repository the guard cannot resolve (${target}) in a command that mentions upstream`
    : `\`gh ${group} ${sub}\` writes to ${normalizeRepo(target)}`;
}

function checkGhApi(args, env) {
  let method = null;
  let fields = false;
  let endpoint = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-X" || a === "--method") method = args[++i] ?? "";
    else if (a.startsWith("--method=")) method = a.slice(9);
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (["-f", "-F", "--field", "--raw-field", "--input"].includes(a)) {
      fields = true;
      i++;
    } else if (/^(-[fF].|--field=|--raw-field=|--input=)/.test(a))
      fields = true;
    else if (
      [
        "-H",
        "--header",
        "-q",
        "--jq",
        "-t",
        "--template",
        "--hostname",
        "--cache",
        "-p",
        "--preview",
      ].includes(a)
    )
      i++;
    else if (!a.startsWith("-") && endpoint === null) endpoint = a;
  }
  if (endpoint === null) return null;
  method = (method ?? (fields ? "POST" : "GET")).toUpperCase();
  if (method === "GET" || method === "HEAD") return null;
  if (endpoint === "graphql") {
    return args.some((a) => /\bmutation\b/i.test(a)) &&
      args.some((a) => /instantdb/i.test(a))
      ? "a GraphQL mutation that names instantdb"
      : null;
  }
  const path = endpoint
    .replace(/^https?:\/\/api\.github\.com/i, "")
    .replace(/^\/+/, "");
  const ghRepo = env.get("GH_REPO") ?? "";
  const upstream =
    /^(repos|orgs)\/instantdb(\/|$)/i.test(path) ||
    (path.includes("{owner}") &&
      (isUpstreamRepo(ghRepo) || unresolved(ghRepo)));
  if (upstream) return `\`gh api -X ${method} ${endpoint}\` writes to upstream`;
  if (unresolved(path))
    return `\`gh api -X ${method}\` with an endpoint the guard cannot resolve (${endpoint}) in a command that mentions upstream`;
  return null;
}

function checkGit(args) {
  let i = 0;
  const config = [];
  for (; i < args.length && args[i].startsWith("-"); i++) {
    const a = args[i];
    if (
      [
        "-C",
        "-c",
        "--git-dir",
        "--work-tree",
        "--namespace",
        "--config-env",
      ].includes(a)
    ) {
      if (a === "-c") config.push(args[i + 1] ?? "");
      i++;
    }
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === "push") {
    if (
      config.some((c) =>
        /^(remote\.pushdefault|branch\..*\.pushremote)=upstream$/i.test(c),
      )
    )
      return "`git push` with the push remote set to upstream";
    let remote = null;
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a === "--repo") remote = rest[++j] ?? "";
      else if (a.startsWith("--repo=")) remote = a.slice(7);
      else if (["-o", "--push-option", "--receive-pack", "--exec"].includes(a))
        j++;
      else if (!a.startsWith("-") && remote === null) remote = a;
    }
    if (remote === null) return null;
    if (remote.toLowerCase() === "upstream" || isUpstreamUrl(remote))
      return `\`git push\` to ${remote}`;
    if (unresolved(remote))
      return `\`git push\` to a remote the guard cannot resolve (${remote}) in a command that mentions upstream`;
    return null;
  }
  if (sub === "remote") {
    const action = rest[0];
    const operands = rest.slice(1).filter((a) => !a.startsWith("-"));
    if (
      action === "set-url" &&
      rest.includes("--push") &&
      operands[0] === "upstream" &&
      operands[1] !== "DISABLED"
    )
      return "`git remote set-url --push upstream` would enable pushing to upstream";
    if (action === "add" && operands.slice(1).some(isUpstreamUrl))
      return '`git remote add` for upstream enables pushing; set it up as in UPSTREAM.md "Setup"';
    return null;
  }
  if (sub === "config") {
    const key = rest.findIndex((a) => /^remote\.upstream\.pushurl$/i.test(a));
    if (key < 0) return null;
    if (
      rest.some((a) =>
        ["--get", "--get-all", "-l", "--list", "get"].includes(a),
      )
    )
      return null;
    if (rest[key + 1] === "DISABLED") return null;
    return "changing remote.upstream.pushurl would enable pushing to upstream";
  }
  return null;
}

// curl or wget against the GitHub REST API of upstream with a body or a
// method other than GET or HEAD.
function checkHttp(prog, args) {
  const url = args.find((a) =>
    /api\.github\.com\/(repos|orgs)\/instantdb(\/|$)/i.test(a),
  );
  if (!url) return null;
  const write = args.some(
    (a, j) =>
      /^(-d|-F|-T|--data.*|--form.*|--upload-file|--json|--post-data.*|--post-file.*|--body-data.*|--body-file.*)$/.test(
        a,
      ) ||
      /^(--data|--form|--json|--post-data|--post-file|--body-data|--body-file)=/.test(
        a,
      ) ||
      /^-[dFT]./.test(a) ||
      ((a === "-X" || a === "--request" || a === "--method") &&
        !/^(GET|HEAD)$/i.test(args[j + 1] ?? "")) ||
      /^(-X|--request=|--method=)(?!GET$|HEAD$)./i.test(a),
  );
  return write ? `\`${prog}\` writes to ${url}` : null;
}

function checkSimple(words, env, depth) {
  let w = words.map((x) => expand(x, env));
  while (w.length && KEYWORDS.has(w[0])) w = w.slice(1);
  const local = new Map(env);
  while (w.length && isAssignment(w[0])) {
    const [name, ...value] = w[0].split("=");
    local.set(name, value.join("="));
    w = w.slice(1);
  }
  if (!w.length) {
    for (const [k, v] of local) env.set(k, v);
    return null;
  }
  for (;;) {
    const prog = basename(w[0]);
    if (["export", "declare", "local", "readonly", "typeset"].includes(prog)) {
      for (const a of w.slice(1))
        if (isAssignment(a))
          env.set(a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1));
      return null;
    }
    if (prog === "env") {
      let j = 1;
      for (; j < w.length; j++) {
        if (isAssignment(w[j]))
          local.set(
            w[j].slice(0, w[j].indexOf("=")),
            w[j].slice(w[j].indexOf("=") + 1),
          );
        else if (
          ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"].includes(
            w[j],
          )
        ) {
          if (w[j] === "-S" || w[j] === "--split-string")
            return check(w.slice(j + 1).join(" "), local, depth + 1);
          j++;
        } else if (!w[j].startsWith("-")) break;
      }
      w = w.slice(j);
    } else if (
      PLAIN_WRAPPERS.has(prog) ||
      prog === "nice" ||
      prog === "xargs"
    ) {
      let j = 1;
      while (j < w.length && w[j].startsWith("-")) {
        if (
          ["-n", "-u", "-g", "-I", "-L", "-P", "-d", "-E", "-s", "-a"].includes(
            w[j],
          )
        )
          j++;
        j++;
      }
      w = w.slice(j);
    } else if (prog === "timeout") {
      let j = 1;
      while (j < w.length && w[j].startsWith("-"))
        j += ["-s", "--signal", "-k", "--kill-after"].includes(w[j]) ? 2 : 1;
      w = w.slice(j + 1);
    } else if (SHELLS.has(prog)) {
      const flag = w.findIndex((a, j) => j > 0 && /^-[a-z]*c[a-z]*$/i.test(a));
      return flag > 0 && w[flag + 1] !== undefined
        ? check(w[flag + 1], local, depth + 1)
        : null;
    } else if (prog === "eval") {
      return check(w.slice(1).join(" "), local, depth + 1);
    } else break;
    if (!w.length) return null;
  }
  const prog = basename(w[0]);
  if (prog === "gh") return checkGh(w.slice(1), local);
  if (prog === "git") return checkGit(w.slice(1));
  if (prog === "curl" || prog === "wget") return checkHttp(prog, w.slice(1));
  return null;
}

// Returns why `command` is blocked, or null when it may run. Throws on a
// command it cannot parse.
export function check(command, env = new Map(), depth = 0) {
  if (!/instantdb|upstream/i.test(command)) return null;
  if (depth > MAX_DEPTH) throw new ParseError("commands nested too deeply");
  const { commands, nested } = parse(command);
  for (const words of nested) {
    const reason = checkSimple(words, new Map(env), depth + 1);
    if (reason) return reason;
  }
  for (const words of commands) {
    const reason = checkSimple(words, env, depth);
    if (reason) return reason;
  }
  return null;
}

// Exit code 2 blocks the tool call; stderr is shown to the agent.
export function decide(stdin) {
  let reason;
  try {
    const command = JSON.parse(stdin)?.tool_input?.command;
    if (typeof command !== "string") reason = "the hook input has no command";
    else reason = check(command);
  } catch (e) {
    reason = `the guard could not check this command (${e.message})`;
  }
  if (!reason) return { code: 0, message: "" };
  return {
    code: 2,
    message:
      `Blocked by the SidekickDB upstream write guard: ${reason}. ` +
      "instantdb/instant is fetch-only (.claude/rules/sidekickdb.md). " +
      "Target SidekickDB/sidekick with -R, and pass pull request or issue text with --body-file.",
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let result;
  try {
    result = decide(readFileSync(0, "utf8"));
  } catch (e) {
    result = {
      code: 2,
      message: `Blocked: the upstream write guard failed (${e.message}).`,
    };
  }
  if (result.message) process.stderr.write(result.message + "\n");
  process.exit(result.code);
}

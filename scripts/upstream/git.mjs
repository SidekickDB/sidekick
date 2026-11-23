// Small synchronous git/process helpers for the upstream-sync scripts.

import { spawnSync } from "node:child_process";

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: opts.encoding === null ? null : "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: opts.stdio || ["pipe", "pipe", "pipe"],
    cwd: opts.cwd,
    input: opts.input,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  if (r.error) throw r.error;
  if (!opts.allowFail && r.status !== 0) {
    const err = new Error(
      `${cmd} ${args.join(" ")} failed (exit ${r.status}):\n${r.stderr || ""}`,
    );
    err.status = r.status;
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    throw err;
  }
  return r;
}

/** Run git and return trimmed stdout. Throws on non-zero exit. */
export function git(args, opts = {}) {
  const r = run("git", args, opts);
  return opts.raw ? r.stdout : (r.stdout || "").replace(/\n$/, "");
}

/** Run git, return { status, stdout, stderr } without throwing. */
export function gitTry(args, opts = {}) {
  return run("git", args, { ...opts, allowFail: true });
}

export function lines(s) {
  return s ? s.split("\n").filter(Boolean) : [];
}

export function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]);
}

/** Read a blob (e.g. ':1:path', 'HEAD:path') as a Buffer, or null. */
export function showBlob(spec, cwd) {
  const r = run("git", ["cat-file", "blob", spec], {
    encoding: null,
    allowFail: true,
    cwd,
  });
  return r.status === 0 ? r.stdout : null;
}

// Two-node smoke test: two server nodes against one Postgres, found by each
// other the way the replicas of self-hosting/swarm.yml are, then smoke.mjs
// from clients pinned to each node. Meant for a disposable machine (the
// GitHub Actions workflow .github/workflows/sidekick-two-node-smoke.yml): it
// builds an image, starts and deletes containers and volumes.
//
//   node scripts/smoke/two-node/run.mjs [--out two-node-out] [--skip-build]
//     [--restart]
//
// 1. Builds the server image (server/Dockerfile.self-hosted) as
//    sidekick-smoke/server:local, unless --skip-build.
// 2. Writes an env file from self-hosting/.env.example with generated
//    secrets, and one override.edn with `start.sh generate-override-config`
//    (how the docs say to share it between servers).
// 3. `docker compose up` of self-hosting/docker-compose.yml plus
//    compose.two-node.yml: postgres, storage, createbuckets and two server
//    containers. The dashboard is not started.
// 4. Waits until both nodes answer GET /, then runs smoke.mjs with one node
//    as A and the other as B.
// 5. With --restart, restarts node A, waits for it, and runs smoke.mjs again.
//
// Writes <out>/result.json, and <out>/logs.txt with every container's log.
// On failure it also prints the last lines of each server node's log.
// Exits 1 if a step or check failed.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: path.join(root, "two-node-out") },
    "skip-build": { type: "boolean", default: false },
    restart: { type: "boolean", default: false },
    "ready-timeout-s": { type: "string", default: "420" },
  },
});

const project = "sidekicktwonode";
const serverImage = "sidekick-smoke/server:local";
const registryServices = ["postgres", "storage", "createbuckets"];
const composeFiles = [
  path.join(root, "self-hosting/docker-compose.yml"),
  path.join(here, "compose.two-node.yml"),
];
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const readyTimeoutMs = Number(args["ready-timeout-s"]) * 1000;

// Generated, throwaway secrets: kept out of <out>, which CI uploads.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sidekick-two-node-"));
const envFile = path.join(tmp, "smoke.env");
const configDir = path.join(tmp, "config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.error(`[two-node ${new Date().toISOString()}]`, ...a);
}

function run(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function tryRun(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const dcArgs = [
  "compose",
  "-p",
  project,
  "--env-file",
  envFile,
  ...composeFiles.flatMap((f) => ["-f", f]),
];
const dc = (...a) => run("docker", [...dcArgs, ...a]);
const tryDc = (...a) => tryRun("docker", [...dcArgs, ...a]);

// self-hosting/.env.example with generated secrets, as the benchmark does
// (scripts/bench/self-hosted/run.mjs).
function writeEnvFile() {
  const random = (bytes) =>
    run("openssl", ["rand", "-hex", String(bytes)]).trim();
  const lines = fs
    .readFileSync(path.join(root, "self-hosting/.env.example"), "utf8")
    .split("\n")
    .map((line) => {
      for (const [name, bytes] of [
        ["POSTGRES_PASSWORD", 32],
        ["STORAGE_ACCESS_KEY", 16],
        ["STORAGE_SECRET_KEY", 32],
      ]) {
        if (line.startsWith(`${name}=`)) return `${name}=${random(bytes)}`;
      }
      return line;
    });
  lines.push(`SERVER_IMAGE=${serverImage}`, `SMOKE_CONFIG_DIR=${configDir}`);
  fs.writeFileSync(envFile, lines.join("\n") + "\n", { mode: 0o600 });
}

function imageId(image) {
  const r = tryRun("docker", [
    "image",
    "inspect",
    image,
    "--format",
    "{{.Id}}",
  ]);
  if (!r.ok) throw new Error(`image ${image} is not present locally`);
  return r.stdout.trim();
}

// Every server container with its host port and address on the compose
// network, ordered by name: <project>-server-1 is A, -server-2 is B.
function nodes() {
  const ids = dc("ps", "-a", "-q", "server").trim().split("\n").filter(Boolean);
  if (!ids.length) throw new Error("no server containers");
  const infos = JSON.parse(run("docker", ["inspect", ...ids]));
  infos.sort((x, y) => x.Name.localeCompare(y.Name, "en", { numeric: true }));
  return infos.map((info) => {
    const port = info.NetworkSettings.Ports?.["8888/tcp"]?.[0]?.HostPort;
    return {
      container: info.Name.replace(/^\//, ""),
      id: info.Id,
      image: info.Image,
      state: info.State.Status,
      ip: Object.values(info.NetworkSettings.Networks)[0]?.IPAddress ?? null,
      url: port ? `http://127.0.0.1:${port}` : null,
    };
  });
}

async function httpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    await res.text();
    return res.ok;
  } catch {
    return false;
  }
}

async function waitReady(node) {
  const t0 = Date.now();
  while (Date.now() - t0 < readyTimeoutMs) {
    if (node.url && (await httpOk(`${node.url}/`))) return Date.now() - t0;
    const state = run("docker", [
      "inspect",
      "--format",
      "{{.State.Status}}",
      node.id,
    ]).trim();
    if (state !== "running") {
      throw new Error(`node ${node.container} is ${state}, not running`);
    }
    await sleep(500);
  }
  throw new Error(
    `node ${node.container} did not answer GET / within ${readyTimeoutMs} ms`,
  );
}

function smoke([a, b]) {
  const r = tryRun(
    process.execPath,
    [path.join(here, "smoke.mjs"), "--a", a.url, "--b", b.url],
    { timeout: 180_000 },
  );
  const line = r.stdout.trim().split("\n").filter(Boolean).at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return {
      ok: false,
      error: `smoke.mjs printed no result: ${r.stderr.trim().slice(-2000)} ${r.stdout.slice(-500)}`,
    };
  }
}

function printLogTails(ns) {
  for (const n of ns ?? []) {
    const r = tryRun("docker", ["logs", "--tail", "80", n.id]);
    console.error(`\n----- last lines of ${n.container} (${n.ip}) -----`);
    console.error((r.stdout + r.stderr).trim());
  }
}

const result = { steps: {} };
let ns = null;
let failed = false;

try {
  writeEnvFile();
  if (!args["skip-build"]) {
    log("building the server image");
    run(
      "docker",
      [
        "build",
        "-t",
        serverImage,
        "-f",
        "server/Dockerfile.self-hosted",
        "server",
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
  }
  const builtImage = imageId(serverImage);
  result.server_image = builtImage;

  log("generating one override.edn for both nodes");
  fs.mkdirSync(configDir);
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${configDir}:/out`,
    serverImage,
    "/app/start.sh",
    "generate-override-config",
    "/out/override.edn",
  ]);
  // The container writes it as root; the nodes only read it.
  if (!fs.existsSync(path.join(configDir, "override.edn"))) {
    throw new Error("generate-override-config wrote no override.edn");
  }

  const check = tryDc("config", "--quiet");
  if (!check.ok) throw new Error(`compose config: ${check.stderr.trim()}`);

  log("pulling", registryServices.join(", "));
  dc("pull", "--quiet", ...registryServices);
  tryDc("down", "-v", "--remove-orphans");

  log("starting two server nodes");
  const t0 = Date.now();
  // --pull never: the local tag must not resolve to a registry image.
  dc("up", "-d", "--pull", "never", "server");
  ns = nodes();
  result.nodes = ns;
  for (const n of ns) {
    if (n.image !== builtImage) {
      throw new Error(`${n.container} runs ${n.image}, not ${builtImage}`);
    }
  }
  if (
    ns.length !== 2 ||
    new Set(ns.map((n) => n.url)).size !== 2 ||
    ns.some((n) => !n.url)
  ) {
    throw new Error(`expected two nodes on two ports: ${JSON.stringify(ns)}`);
  }
  const ready = await Promise.all(ns.map(waitReady));
  result.steps.ready_ms = Math.max(...ready);
  log(
    "both nodes ready",
    ns.map((n) => `${n.container} ${n.ip} ${n.url}`).join(", "),
    `after ${Math.round((Date.now() - t0) / 1000)} s`,
  );

  log("smoke");
  result.smoke = smoke(ns);
  log(
    `smoke ${result.smoke.ok ? "ok" : "FAILED"}`,
    JSON.stringify(result.smoke),
  );
  if (!result.smoke.ok) failed = true;

  if (args.restart) {
    log(`restarting node A (${ns[0].container})`);
    const r0 = Date.now();
    run("docker", ["restart", ns[0].id]);
    ns = nodes();
    result.nodes_after_restart = ns;
    result.steps.restart_ready_ms = await waitReady(ns[0]);
    log(`node A back after ${Math.round((Date.now() - r0) / 1000)} s`);
    result.smoke_after_restart = smoke(ns);
    log(
      `smoke after restart ${result.smoke_after_restart.ok ? "ok" : "FAILED"}`,
      JSON.stringify(result.smoke_after_restart),
    );
    if (!result.smoke_after_restart.ok) failed = true;
  }
} catch (e) {
  failed = true;
  result.error = String(e.message ?? e);
  log("failed:", result.error);
}

result.ok = !failed;
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify(result, null, 2),
);
const logs = tryDc("logs", "--timestamps", "--no-color");
fs.writeFileSync(path.join(out, "logs.txt"), logs.stdout + logs.stderr);
if (failed) printLogTails(ns);
tryDc("down", "-v", "--remove-orphans");
fs.rmSync(tmp, { recursive: true, force: true });
log(`wrote ${out}/result.json and ${out}/logs.txt`);
process.exit(failed ? 1 : 0);

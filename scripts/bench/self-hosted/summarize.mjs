// Turns results.json from run.mjs into a Markdown summary.
//
//   node scripts/bench/self-hosted/summarize.mjs bench-out/results.json
//
// Every number is reported over the successful samples as median, min and
// max, plus the count, so the spread is visible. Never quote a single sample.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function med(xs) {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmt(x, unit) {
  if (x == null) return 'n/a';
  if (unit === 's') return (x / 1000).toFixed(1);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function row(label, values, unit) {
  const v = values.filter((x) => typeof x === 'number');
  if (!v.length) return `| ${label} | n/a | | | 0 |`;
  return `| ${label} | ${fmt(med(v), unit)} | ${fmt(Math.min(...v), unit)} | ${fmt(Math.max(...v), unit)} | ${v.length} |`;
}

const get = (obj, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function aggregate(results) {
  const ok = results.samples.filter((s) => !s.error);
  const pick = (p) => ok.map((s) => get(s, p));
  return { ok, pick };
}

export function summarize(results) {
  const { ok, pick } = aggregate(results);
  const env = results.environment;
  const failed = results.samples.filter((s) => s.error);
  const services = [
    ...new Set(ok.flatMap((s) => Object.keys(s.idle?.services ?? {}))),
  ].sort();
  const table = (title, unitLabel, rows) =>
    [
      `### ${title}`,
      '',
      `| Metric (${unitLabel}) | Median | Min | Max | Samples |`,
      '|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n');

  const lines = [
    '# Self-hosted stack baseline',
    '',
    `- **Commit:** \`${env.commit}\``,
    `- **Measured:** ${env.measured_at}${env.github_run ? ` ([run](${env.github_run}))` : ''}`,
    `- **Runner:** ${env.runner.labels ?? 'n/a'}; ${env.runner.image_os ?? ''} ${env.runner.image_version ?? ''}; ${env.runner.cpus} vCPU (${env.runner.cpu_model ?? 'unknown CPU'}), ${env.runner.mem_total_mib} MiB RAM, kernel ${env.runner.kernel}`,
    `- **Docker:** ${env.docker}, Compose ${env.compose}; Node ${env.node}`,
    `- **Samples:** ${ok.length} successful of ${results.samples.length}` +
      (failed.length
        ? ` (failed: ${failed.map((s) => `#${s.sample}: ${s.error.slice(0, 120)}`).join('; ')})`
        : ''),
    `- **Config:** idle ${results.config.idle_seconds} s before the idle snapshot; workload ${results.config.subscribers} subscribers, ${results.config.writes} writes every ${results.config.interval_ms} ms; snapshot ${results.config.settle_seconds} s after the workload`,
    '',
  ];

  if (results.env_file && !results.env_file.as_shipped_env_accepted) {
    lines.push(
      `**Deviation:** Compose ${env.compose} rejected the env file written from \`self-hosting/.env.example\` as shipped (${results.env_file.as_shipped_env_error}). To proceed, the harness added MINIO_ROOT_USER and MINIO_ROOT_PASSWORD with the same values as STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY. Everything else ran on the shipped files.`,
      '',
    );
  }

  if (results.builds) {
    lines.push(
      `Image builds (cold, informational, one each): server ${results.builds.server.seconds} s, dashboard ${results.builds.dashboard.seconds} s.`,
      '',
    );
  }

  lines.push(
    table('Start-up (fresh volumes)', 's from `docker compose up -d`', [
      row(
        '`docker compose up -d` returns',
        pick('cold_start.up_returned_ms'),
        's',
      ),
      row('Server answers `GET /`', pick('cold_start.server_http_ms'), 's'),
      row('`/health/system` WAL ok', pick('cold_start.wal_ok_ms'), 's'),
      row('Compose: server healthy', pick('cold_start.server_healthy_ms'), 's'),
      row('Compose: dashboard healthy', pick('cold_start.www_healthy_ms'), 's'),
      row(
        'Bootstrap JVM (container start to "Starting server...")',
        pick('cold_start.bootstrap_jvm_ms'),
        's',
      ),
      row(
        'Warm restart of the server to `GET /`',
        pick('warm_restart_ms'),
        's',
      ),
    ]),
  );

  for (const [key, title] of [
    ['idle', `Idle, ${results.config.idle_seconds} s after ready`],
    ['after_workload', `${results.config.settle_seconds} s after the workload`],
  ]) {
    lines.push(
      table(`Memory: ${title}`, 'MiB, threads', [
        ...services.map((svc) =>
          row(
            `${svc} container (docker stats)`,
            pick(`${key}.services.${svc}.mem_mib`),
          ),
        ),
        row('Server JVM RSS', pick(`${key}.server_jvm.rss_mib`)),
        row('Server JVM swap', pick(`${key}.server_jvm.swap_mib`)),
        row(
          'Server JVM heap committed',
          pick(`${key}.server_jvm.heap_committed_mib`),
        ),
        row('Server JVM heap used', pick(`${key}.server_jvm.heap_used_mib`)),
        row(
          'Server JVM heap max (reserved)',
          pick(`${key}.server_jvm.heap_reserved_mib`),
        ),
        row(
          'Server JVM metaspace used',
          pick(`${key}.server_jvm.metaspace_used_mib`),
        ),
        row('Server JVM threads', pick(`${key}.server_jvm.threads`)),
        row('Server container PIDs', pick(`${key}.services.server.pids`)),
      ]),
    );
  }

  lines.push(
    table('Workload: live queries and writes', 'ms', [
      row(
        'Pipelined: client-visible update p50',
        pick('workload.visible_ms.p50'),
      ),
      row(
        'Pipelined: client-visible update p95',
        pick('workload.visible_ms.p95'),
      ),
      row(
        'Pipelined: client-visible update max',
        pick('workload.visible_ms.max'),
      ),
      row(
        'Pipelined: visible p50, first half',
        pick('workload.visible_ms_first_half.p50'),
      ),
      row(
        'Pipelined: visible p50, second half',
        pick('workload.visible_ms_second_half.p50'),
      ),
      row('Pipelined: transact-ok p50', pick('workload.ack_ms.p50')),
      row('Pipelined: transact-ok p95', pick('workload.ack_ms.p95')),
      row(
        'Sequential: client-visible update p50',
        pick('workload.sequential_visible_ms.p50'),
      ),
      row(
        'Sequential: client-visible update p95',
        pick('workload.sequential_visible_ms.p95'),
      ),
      row(
        'Sequential: transact-ok p50',
        pick('workload.sequential_ack_ms.p50'),
      ),
      row(
        'Sequential: transact-ok p95',
        pick('workload.sequential_ack_ms.p95'),
      ),
      row(
        'Initial results for every subscriber',
        pick('workload.initial_subscribe_ms'),
      ),
    ]),
    `Missed updates across all samples: ${pick('workload.missing_updates').reduce((a, b) => a + (b ?? 0), 0)} (must be 0). Latency is measured per subscriber and write. Pipelined: ${ok[0]?.workload?.writes ?? 'n/a'} writes ${ok[0]?.workload?.interval_ms ?? 'n/a'} ms apart without waiting, the first ${ok[0]?.workload?.warmup_writes ?? 'n/a'} not counted, ${ok[0]?.workload?.visible_ms?.count ?? 'n/a'} observations per sample. Sequential: ${ok[0]?.workload?.sequential_writes ?? 'n/a'} writes, each sent after every subscriber saw the previous one, ${ok[0]?.workload?.sequential_visible_ms?.count ?? 'n/a'} observations per sample. Each row shows the spread of the per-sample values.`,
    '',
  );

  const jcmdFailed = ok.filter((s) => !s.idle?.server_jvm?.jcmd_ok);
  if (jcmdFailed.length) {
    lines.push(
      `jcmd failed in ${jcmdFailed.length} sample(s): ${jcmdFailed[0].idle?.server_jvm?.jcmd_error}`,
      '',
    );
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: summarize.mjs results.json');
    process.exit(2);
  }
  process.stdout.write(summarize(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

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
  if ((results.config.modes ?? []).length > 1) return summarizeModes(results);
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
    ...(ok.some((s) => s.smoke) ? [`- **Smoke:** ${smokeStatus(ok)}`] : []),
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
  const modeLabel = (results.config.modes ?? []).length === 1
    ? `\`${results.config.modes[0]}\``
    : 'Samples';
  lines.push(...smokeSection([[modeLabel, ok]]));
  return lines.join('\n');
}

// Two or more runtime modes measured in one job. For every metric: median,
// min and max per mode, and whether the ranges overlap. An effect counts only
// when they do not.
function rangeOf(values) {
  const v = values.filter((x) => typeof x === 'number');
  if (!v.length) return null;
  return { med: med(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
}

function cell(r, unit) {
  if (!r) return 'n/a';
  return `${fmt(r.med, unit)} (${fmt(r.min, unit)} to ${fmt(r.max, unit)})`;
}

function verdict(ranges, names, unit) {
  if (ranges.some((r) => !r)) return 'n/a';
  if (ranges.length !== 2) return 'not compared (overlap rule needs two modes)';
  const [a, b] = ranges;
  if (a.max < b.min || b.max < a.min) {
    const lower = a.med < b.med ? names[0] : names[1];
    return `**no overlap**: lower in ${lower} (median difference ${fmt(Math.abs(a.med - b.med), unit)})`;
  }
  return 'overlap: no measurable difference';
}

export function summarizeModes(results) {
  const env = results.environment;
  const modes = results.config.modes;
  const ok = results.samples.filter((s) => !s.error);
  const failed = results.samples.filter((s) => s.error);
  const byMode = Object.fromEntries(
    modes.map((m) => [m, ok.filter((s) => s.mode === m)]),
  );
  const pick = (mode, p) => byMode[mode].map((s) => get(s, p));
  const services = [
    ...new Set(ok.flatMap((s) => Object.keys(s.idle?.services ?? {}))),
  ].sort();

  const metricTable = (title, unitLabel, rows) => [
    `### ${title}`,
    '',
    `| Metric (${unitLabel}) | ${modes.map((m) => `\`${m}\``).join(' | ')} | Ranges |`,
    `|---|${modes.map(() => '---').join('|')}|---|`,
    ...rows.map(([label, p, unit]) => {
      const ranges = modes.map((m) => rangeOf(pick(m, p)));
      return `| ${label} | ${ranges.map((r) => cell(r, unit)).join(' | ')} | ${verdict(ranges, modes, unit)} |`;
    }),
    '',
  ];

  const lines = [
    '# Self-hosted stack: runtime modes compared',
    '',
    `- **Commit:** \`${env.commit}\``,
    `- **Measured:** ${env.measured_at}${env.github_run ? ` ([run](${env.github_run}))` : ''}`,
    `- **Runner:** ${env.runner.labels ?? 'n/a'}; ${env.runner.image_os ?? ''} ${env.runner.image_version ?? ''}; **CPU: ${env.runner.cpu_model ?? 'unknown'}**, ${env.runner.cpus} vCPU, ${env.runner.mem_total_mib} MiB RAM, kernel ${env.runner.kernel}`,
    `- **Docker:** ${env.docker}, Compose ${env.compose}; Node ${env.node}`,
    `- **Modes:** ${modes.map((m) => `\`${m}\` ${byMode[m].length} samples`).join(', ')}, alternating in one job on the same images (${results.samples.length} samples in total${failed.length ? `; failed: ${failed.map((f) => `#${f.sample} ${f.mode}: ${f.error.slice(0, 100)}`).join('; ')}` : ''})`,
    `- **Config:** idle ${results.config.idle_seconds} s before the idle snapshot; workload ${results.config.subscribers} subscribers, ${results.config.writes} writes every ${results.config.interval_ms} ms; snapshot ${results.config.settle_seconds} s after the workload`,
    ...(ok.some((s) => s.smoke) ? [`- **Smoke:** ${smokeStatus(ok)}`] : []),
    '',
    '**Rule:** values are median (min to max) over the samples of each mode. A difference counts as an effect only when the two ranges do not overlap; otherwise it is reported as no measurable difference. Only the modes within this run are comparable with each other: other runs, including the kept baselines, may have run on different hardware (see the CPU above).',
    '',
  ];
  if (results.env_file && !results.env_file.as_shipped_env_accepted) {
    lines.push(
      `**Deviation:** Compose rejected the env file written from \`.env.example\` (${results.env_file.as_shipped_env_error}); the harness added MINIO_ROOT_* to proceed.`,
      '',
    );
  }

  lines.push(
    ...metricTable('Start-up (fresh volumes)', 's', [
      ['`docker compose up -d` returns', 'cold_start.up_returned_ms', 's'],
      ['Server answers `GET /`', 'cold_start.server_http_ms', 's'],
      ['`/health/system` WAL ok', 'cold_start.wal_ok_ms', 's'],
      ['Compose: server healthy', 'cold_start.server_healthy_ms', 's'],
      ['Compose: dashboard healthy', 'cold_start.www_healthy_ms', 's'],
      [
        'Phase: container start to "Starting server..." (bootstrap JVM)',
        'cold_start.bootstrap_jvm_ms',
        's',
      ],
      [
        'Phase: "Starting server..." to first init step (JVM start, loading code, config)',
        'cold_start.server_jvm_to_first_init_ms',
        's',
      ],
      [
        'Phase: first init step to "Finished initializing"',
        'cold_start.init_steps_ms',
        's',
      ],
      [
        'Container start to "Finished initializing"',
        'cold_start.container_to_initialized_ms',
        's',
      ],
      ['Warm restart of the server to `GET /`', 'warm_restart_ms', 's'],
    ]),
    ...metricTable(
      `Memory, idle ${results.config.idle_seconds} s after ready`,
      'MiB, threads',
      [
        ...services.map((svc) => [
          `${svc} container (docker stats)`,
          `idle.services.${svc}.mem_mib`,
        ]),
        ['Server JVM RSS', 'idle.server_jvm.rss_mib'],
        ['Server JVM heap committed', 'idle.server_jvm.heap_committed_mib'],
        ['Server JVM heap used', 'idle.server_jvm.heap_used_mib'],
        ['Server JVM threads', 'idle.server_jvm.threads'],
      ],
    ),
    ...metricTable(
      `Memory, ${results.config.settle_seconds} s after the workload`,
      'MiB, threads',
      [
        [
          'server container (docker stats)',
          'after_workload.services.server.mem_mib',
        ],
        ['Server JVM RSS', 'after_workload.server_jvm.rss_mib'],
        ['Server JVM threads', 'after_workload.server_jvm.threads'],
      ],
    ),
    ...metricTable('Workload', 'ms', [
      ['Pipelined: client-visible update p50', 'workload.visible_ms.p50'],
      ['Pipelined: client-visible update p95', 'workload.visible_ms.p95'],
      ['Pipelined: transact-ok p50', 'workload.ack_ms.p50'],
      [
        'Sequential: client-visible update p50',
        'workload.sequential_visible_ms.p50',
      ],
      ['Sequential: transact-ok p50', 'workload.sequential_ack_ms.p50'],
      ['Initial results for every subscriber', 'workload.initial_subscribe_ms'],
    ]),
  );
  const missed = ok.reduce((a, s) => a + (s.workload?.missing_updates ?? 0), 0);
  lines.push(`Missed updates across all samples: ${missed} (must be 0).`, '');

  // Init steps: median duration of each init.finish span per mode.
  const steps = [
    ...new Set(
      ok.flatMap((s) => [
        ...Object.keys(s.cold_start?.init_finish_ms ?? {}),
        ...(s.cold_start?.init_skipped ?? []),
      ]),
    ),
  ];
  const stepMed = (mode, step) =>
    rangeOf(byMode[mode].map((s) => s.cold_start?.init_finish_ms?.[step]));
  const skippedIn = (mode, step) =>
    byMode[mode].length > 0 &&
    byMode[mode].every((s) =>
      (s.cold_start?.init_skipped ?? []).includes(step),
    );
  steps.sort(
    (x, y) =>
      (stepMed(modes[0], y)?.med ?? 0) - (stepMed(modes[0], x)?.med ?? 0),
  );
  lines.push(
    '### Init steps (`init.finish.<step>` spans, ms)',
    '',
    'From the server log of each cold start. "skipped" means the step logged `init.skip.<step>` in every sample of that mode. Steps that did not run at all (conditional steps such as the `:prod`-only jobs) are not listed.',
    '',
    `| Step | ${modes.map((m) => `\`${m}\``).join(' | ')} |`,
    `|---|${modes.map(() => '---').join('|')}|`,
    ...steps.map(
      (step) =>
        `| ${step} | ${modes.map((m) => (skippedIn(m, step) ? 'skipped' : cell(stepMed(m, step)))).join(' | ')} |`,
    ),
    '',
  );

  lines.push(...smokeSection(modes.map((m) => [`\`${m}\``, byMode[m]])));
  return lines.join('\n');
}

// One line: which samples' smoke runs failed, and how. Used in the header
// and in the smoke section.
export function smokeStatus(samples) {
  const failures = samples
    .filter((s) => !s.smoke?.ok)
    .map((s) => {
      const failed = Object.entries(s.smoke?.checks ?? {})
        .filter(([, r]) => !r?.ok)
        .map(([c]) => c);
      const what = !s.smoke
        ? 'no smoke result'
        : !s.smoke.checks
          ? 'smoke.mjs did not complete'
          : failed.join(', ') || 'failed';
      return `#${s.sample}${s.mode ? ` ${s.mode}` : ''}: ${what}`;
    });
  return failures.length
    ? `**Smoke FAILED** in ${failures.length} of ${samples.length} samples: ${failures.join('; ')}.`
    : `Smoke passed in all ${samples.length} samples.`;
}

// Smoke checks, one column per group of samples ([label, samples]). Every
// sample that ran counts in the denominator: a sample whose smoke.mjs did not
// complete (no `checks`), or that lacks a check, counts as a failure of that
// check, so the table never reads "all passed" for a run that failed.
export function smokeSection(groups) {
  const all = groups.flatMap(([, samples]) => samples);
  if (!all.some((s) => s.smoke)) return [];
  const checks = [
    ...new Set(all.flatMap((s) => Object.keys(s.smoke?.checks ?? {}))),
  ];
  const short = (e) => String(e).replace(/\s+/g, ' ').trim().slice(0, 80);
  const completedCell = (samples) => {
    const done = samples.filter((s) => s.smoke?.checks).length;
    const err = samples.find((s) => !s.smoke?.checks)?.smoke?.error;
    return `${done} of ${samples.length} completed${err ? ` (${short(err)})` : ''}`;
  };
  const checkCell = (samples, c) => {
    const rs = samples.map((s) => s.smoke?.checks?.[c]);
    const pass = rs.filter((r) => r?.ok).length;
    const notRun = rs.filter((r) => !r).length;
    const err = rs.find((r) => r && !r.ok)?.error;
    return (
      `${pass} of ${samples.length} passed` +
      (notRun ? `, ${notRun} did not run` : '') +
      (err ? ` (${short(err)})` : '')
    );
  };
  const lines = [
    '### Smoke checks',
    '',
    smokeStatus(all),
    '',
    `| Check | ${groups.map(([label]) => label).join(' | ')} |`,
    `|---|${groups.map(() => '---').join('|')}|`,
    `| smoke.mjs completed | ${groups.map(([, s]) => completedCell(s)).join(' | ')} |`,
    ...checks.map(
      (c) => `| ${c} | ${groups.map(([, s]) => checkCell(s, c)).join(' | ')} |`,
    ),
    '',
    'headers: `X-Instant-Server-Hostname` on `GET /` is expected in `default` and absent in `self-hosted`. presence: two sessions see each other in a room. streams: one session writes, a second reads the same bytes back. sse: a session whose WebSocket cannot connect falls back to SSE and receives 5 writes made over WebSocket. login: dashboard sign-in with the one-time code the server logs when no email provider is set. storage: a session uploads a file and downloads the same bytes from its presigned URL. backup: the signed-in user starts an on-demand backup of a new app, the job completes, and the backup holds config.json and a non-empty entities/items.jsonl.',
    '',
  ];
  const sse = groups.map(([, samples]) =>
    rangeOf(samples.flatMap((s) => s.smoke?.checks?.sse?.visible_ms ?? [])),
  );
  if (sse.some(Boolean)) {
    lines.push(
      `SSE client-visible update, all writes pooled (ms): ${groups.map(([label], i) => `${label} ${cell(sse[i])}`).join(', ')}.`,
      '',
    );
  }
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: summarize.mjs results.json');
    process.exit(2);
  }
  process.stdout.write(summarize(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

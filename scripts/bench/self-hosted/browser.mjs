// The `browser` smoke check: the dashboard in a real browser (Playwright
// Chromium), against the running stack. smoke.mjs runs it when given a
// Playwright server to connect to (--browser-ws); run.mjs starts one from
// the pinned Playwright image.
//
// - signs in at /dash with the one-time code from the server log;
// - opens the new app in the dashboard, then its Sandbox tab, and checks
//   that the code editor's TypeScript worker starts and answers quick info
//   for `db`, and that its JSON worker starts;
// - opens /_devtool?appId=<id> and checks that it shows the app's explorer;
// - records the host of every request and WebSocket, and fails on any host
//   other than the dashboard and the server.
//
// On failure it saves a screenshot to the given path.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Playwright as pinned in client/pnpm-lock.yaml, installed with the client.
const require = createRequire(
  path.resolve(here, '../../../client/packages/core/package.json'),
);

// Console messages that mean a Monaco worker could not load its code
// (pull request #113: a root-relative path cannot be resolved in a worker).
const WORKER_ERROR = /Failed to parse URL|WorkerGlobalScope/;

// Runs in the page: asks the editor's TypeScript worker for quick info on
// `db` in the Sandbox code, and starts the JSON worker on a JSON model.
async function probeEditor({ timeoutMs }) {
  const m = window.monaco;
  const within = (p, what) =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${what}: no answer after ${timeoutMs} ms`)),
          timeoutMs,
        ),
      ),
    ]);
  const models = m.editor.getModels();
  const ts = models.find((x) => x.uri.toString().endsWith('sandbox.ts'));
  const getTs = await within(
    m.languages.typescript.getTypeScriptWorker(),
    'monaco.languages.typescript.getTypeScriptWorker()',
  );
  const tsWorker = await within(getTs(ts.uri), 'the TypeScript worker');
  const offset = ts.getValue().indexOf('db.');
  const info = await within(
    tsWorker.getQuickInfoAtPosition(ts.uri.toString(), offset),
    'quick info for db',
  );
  const json =
    models.find((x) => x.getLanguageId() === 'json') ??
    m.editor.createModel('{}', 'json');
  const getJson = await within(
    m.languages.json.getWorker(),
    'monaco.languages.json.getWorker()',
  );
  const jsonWorker = await within(getJson(json.uri), 'the JSON worker');
  const diagnostics = await within(
    jsonWorker.doValidation(json.uri.toString()),
    'JSON validation',
  );
  return {
    quick_info: (info?.displayParts ?? []).map((p) => p.text).join(''),
    json_model: json.uri.toString(),
    json_diagnostics: diagnostics.length,
  };
}

export async function browserCheck({
  wsEndpoint,
  dashURI,
  apiURI,
  timeoutMs,
  email,
  waitForLoginCode,
  createApp,
  screenshot,
}) {
  const { chromium } = require('playwright');
  const allowed = new Set([new URL(dashURI).host, new URL(apiURI).host]);
  const hosts = new Set();
  const outside = [];
  const workerScripts = new Set();
  const consoleLines = [];
  const note = (url) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (!/^(https?|wss?):$/.test(u.protocol)) return;
    hosts.add(u.host);
    if (!allowed.has(u.host)) outside.push(url);
  };

  const browser = await chromium.connect(wsEndpoint, { timeout: timeoutMs });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  context.setDefaultTimeout(timeoutMs);
  context.on('request', (r) => note(r.url()));
  context.on('response', (r) => {
    if (/\/monaco\/vs\/.*worker/i.test(r.url())) {
      workerScripts.add(`${r.status()} ${r.url()}`);
    }
  });
  const page = await context.newPage();
  page.on('websocket', (ws) => note(ws.url()));
  // First lines only: a logged error carries its stack.
  const line = (s) => s.split('\n')[0];
  page.on('console', (msg) =>
    consoleLines.push(`${msg.type()}: ${line(msg.text())}`),
  );
  page.on('pageerror', (e) =>
    consoleLines.push(`pageerror: ${line(e.message)}`),
  );
  page.on('worker', (w) => {
    workerScripts.add(`worker ${w.url()}`);
    w.on('console', (msg) =>
      consoleLines.push(`worker ${msg.type()}: ${line(msg.text())}`),
    );
  });

  const observed = () => ({
    hosts: [...hosts].sort(),
    worker_scripts: [...workerScripts],
  });
  // Milliseconds per step, and the step a failure happened in.
  const steps = {};
  let step = null;
  let stepStart = Date.now();
  const mark = (name) => {
    if (step) steps[step] = Date.now() - stepStart;
    step = name;
    stepStart = Date.now();
  };

  try {
    mark('sign in');
    await page.goto(`${dashURI}/dash`);
    await page.getByPlaceholder('Enter your email address').fill(email);
    const since = new Date().toISOString();
    await page.getByRole('button', { name: 'Send Code' }).click();
    const code = await waitForLoginCode(since);
    await page.getByPlaceholder('Your code').fill(code);
    await page.getByRole('button', { name: 'Verify Code' }).click();
    // A new user without apps is sent to the onboarding page.
    await page.waitForURL(/\/dash\/onboarding/);
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('@AUTH') ?? '{}').token,
    );
    if (!token) throw new Error('signed in, but no token in localStorage');

    mark('app in the dashboard');
    const app = await createApp(token);
    await page.goto(`${dashURI}/dash?s=main&app=${app.id}`);
    await page.getByRole('heading', { name: app.title }).waitFor();

    mark('sandbox editor');
    await page.goto(`${dashURI}/dash?s=main&app=${app.id}&t=sandbox`);
    await page.waitForFunction(() =>
      window.monaco?.editor
        .getModels()
        .some(
          (m) =>
            m.uri.toString().endsWith('sandbox.ts') &&
            m.getValue().includes('db.'),
        ),
    );
    const editor = await page.evaluate(probeEditor, { timeoutMs });
    if (!/\bdb\b/.test(editor.quick_info)) {
      throw new Error(
        `quick info for db: ${JSON.stringify(editor.quick_info)}`,
      );
    }
    for (const worker of ['typescript/tsWorker.js', 'json/jsonWorker.js']) {
      if (
        ![...workerScripts].some(
          (w) => w.startsWith('200 ') && w.endsWith(worker),
        )
      ) {
        throw new Error(`no 200 response for ${worker}`);
      }
    }

    mark('devtool');
    await page.goto(`${dashURI}/_devtool?appId=${app.id}`);
    await page.getByRole('button', { name: 'Explorer' }).first().waitFor();
    await page.getByText(app.namespace, { exact: true }).first().waitFor();
    for (const text of [
      "Let's log you in",
      "We couldn't find your app",
      'Failed to load your app',
      'Failed to connect to the server',
    ]) {
      if (await page.getByText(text).count()) {
        throw new Error(`/_devtool shows "${text}"`);
      }
    }

    mark('checks');
    const workerErrors = consoleLines.filter((l) => WORKER_ERROR.test(l));
    if (workerErrors.length) {
      throw new Error(`worker errors in the console: ${workerErrors[0]}`);
    }
    if (outside.length) {
      throw new Error(
        `requests to hosts other than ${[...allowed].join(' and ')}: ${[...new Set(outside)].slice(0, 5).join(', ')}`,
      );
    }
    mark('done');
    return { ...editor, ...observed(), steps_ms: steps };
  } catch (e) {
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const err = new Error(
      `${step}: ${e.message?.split('\n')[0] ?? e}` +
        ` | observed ${JSON.stringify(observed())}` +
        ` | console ${JSON.stringify(consoleLines.slice(-10))}` +
        ` | screenshot ${path.basename(screenshot)}`,
    );
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

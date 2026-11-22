// SidekickDB: network guard for JS tests.
//
// Preload with `node --require <this file>`. scripts/with-network-guard.mjs
// does that through NODE_OPTIONS, so every Node process in the test run is
// guarded: vitest itself, its fork workers, and CLIs spawned by tests.
// worker_threads do not apply NODE_OPTIONS preloads, so the Worker
// constructor is wrapped to load this file first in every thread too.
//
// Any attempt to open a TCP/TLS connection, send UDP, or resolve a host name
// that is not loopback is refused: the caller gets an error, the attempt is
// printed to stderr, and it is appended to $SIDEKICK_NETWORK_GUARD_LOG so the
// wrapper can fail the whole run even if a test swallowed the error.
//
// Allowed: localhost, *.localhost, 127.0.0.0/8, ::1, 0.0.0.0, ::, unix
// sockets, the host of $SIDEKICK_E2E_API_URI (the explicit opt-in backend for
// networked suites) and hosts listed in $SIDEKICK_NETWORK_GUARD_ALLOW (comma
// separated). instantdb.com and its subdomains are always refused.
//
// Not covered: non-Node child processes (curl, browsers) and native addons
// that open sockets themselves.

'use strict';

const dgram = require('node:dgram');
const dns = require('node:dns');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const workerThreads = require('node:worker_threads');
const nodeModule = require('node:module');

const MARK = Symbol.for('sidekickdb.networkGuard');
const CONFIG = Symbol.for('sidekickdb.networkGuardConfig');

if (!globalThis[MARK]) {
  globalThis[MARK] = { violations: [] };
  install();
}

function install() {
  const state = globalThis[MARK];
  // A worker can get a custom `env`; the parent passes its config explicitly.
  const config = globalThis[CONFIG] || {
    logFile: process.env.SIDEKICK_NETWORK_GUARD_LOG,
    allow: process.env.SIDEKICK_NETWORK_GUARD_ALLOW,
    e2eURI: process.env.SIDEKICK_E2E_API_URI,
  };

  const extraAllowed = new Set(
    (config.allow || '')
      .split(',')
      .map((h) => normalizeHost(h))
      .filter(Boolean),
  );
  if (config.e2eURI) {
    try {
      extraAllowed.add(normalizeHost(new URL(config.e2eURI).hostname));
    } catch {
      // An invalid URL is reported by the suites that use it.
    }
  }

  function normalizeHost(host) {
    return String(host || '')
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
  }

  function isDenied(host) {
    return host === 'instantdb.com' || host.endsWith('.instantdb.com');
  }

  function isLoopback(host) {
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
    if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^::ffff:127\.\d+\.\d+\.\d+$/.test(host)) return true;
    return false;
  }

  function isAllowed(rawHost) {
    const host = normalizeHost(rawHost);
    if (isDenied(host)) return false;
    return isLoopback(host) || extraAllowed.has(host);
  }

  function block(kind, target) {
    const message =
      `[sidekick network-guard] BLOCKED ${kind} to ${target} ` +
      `(pid ${process.pid}). Tests must not reach non-localhost hosts; ` +
      `networked suites need SIDEKICK_E2E_API_URI.`;
    const err = new Error(message);
    err.code = 'ERR_SIDEKICK_NETWORK_BLOCKED';
    state.violations.push({ kind, target, pid: process.pid });
    try {
      process.stderr.write(`${err.stack}\n`);
    } catch {}
    if (config.logFile) {
      try {
        fs.appendFileSync(
          config.logFile,
          JSON.stringify({
            kind,
            target,
            pid: process.pid,
            argv: process.argv,
          }) + '\n',
        );
      } catch {}
    }
    return err;
  }

  const lastFn = (args) => {
    for (let i = args.length - 1; i >= 0; i--) {
      if (typeof args[i] === 'function') return args[i];
    }
    return undefined;
  };

  // TCP and TLS. http, https, http2, tls, fetch (undici) and the global
  // WebSocket all end up in net.Socket.prototype.connect.
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    let options = args[0];
    if (Array.isArray(options)) options = options[0]; // internal normalized args
    let host;
    let port;
    let socketPath;
    if (options !== null && typeof options === 'object') {
      socketPath = options.path;
      host = options.host;
      port = options.port;
    } else if (typeof options === 'string' && !/^\d+$/.test(options)) {
      socketPath = options;
    } else {
      port = options;
      host = typeof args[1] === 'string' ? args[1] : undefined;
    }
    if (socketPath === undefined || socketPath === null) {
      const h = host === undefined || host === null ? 'localhost' : host;
      if (!isAllowed(h)) {
        const err = block('connection', `${h}:${port}`);
        process.nextTick(() => this.destroy(err));
        return this;
      }
    }
    return originalConnect.apply(this, args);
  };

  // DNS: refuse to resolve non-loopback names so lookups cannot leak either.
  const dnsFns = [
    'lookup',
    'resolve',
    'resolve4',
    'resolve6',
    'resolveAny',
    'resolveCname',
    'resolveMx',
    'resolveNs',
    'resolveTxt',
    'resolveSrv',
    'resolveNaptr',
    'resolveSoa',
    'resolveCaa',
    'resolvePtr',
  ];
  const patchDns = (target, prefix, promises) => {
    for (const name of dnsFns) {
      const original = target[name];
      if (typeof original !== 'function') continue;
      target[name] = function guardedDns(hostname, ...rest) {
        if (!isAllowed(hostname)) {
          const err = block(`${prefix}${name}`, String(hostname));
          if (promises) return Promise.reject(err);
          const cb = lastFn(rest);
          if (cb) {
            process.nextTick(() => cb(err));
            return undefined;
          }
          throw err;
        }
        return original.call(this, hostname, ...rest);
      };
    }
  };
  patchDns(dns, 'dns.', false);
  patchDns(dns.Resolver.prototype, 'dns.Resolver.', false);
  patchDns(dns.promises, 'dns.promises.', true);
  patchDns(dns.promises.Resolver.prototype, 'dns.promises.Resolver.', true);

  // UDP.
  const originalSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function guardedSend(...args) {
    let addr;
    for (let i = 1; i < args.length; i++) {
      if (typeof args[i] === 'string' && Number.isNaN(Number(args[i]))) {
        addr = args[i];
        break;
      }
    }
    if (addr !== undefined && !isAllowed(addr)) {
      const err = block('udp send', addr);
      const cb = lastFn(args);
      if (cb) process.nextTick(() => cb(err));
      return undefined;
    }
    return originalSend.apply(this, args);
  };
  const originalUdpConnect = dgram.Socket.prototype.connect;
  if (originalUdpConnect) {
    dgram.Socket.prototype.connect = function guardedUdpConnect(port, ...rest) {
      const addr = typeof rest[0] === 'string' ? rest[0] : 'localhost';
      if (!isAllowed(addr)) {
        throw block('udp connect', `${addr}:${port}`);
      }
      return originalUdpConnect.call(this, port, ...rest);
    };
  }

  // worker_threads: load this file at the start of every new thread.
  const OriginalWorker = workerThreads.Worker;
  const guardFile = __filename;
  const prelude =
    `globalThis[Symbol.for('sidekickdb.networkGuardConfig')] = ` +
    `${JSON.stringify(config)};\n`;
  class GuardedWorker extends OriginalWorker {
    constructor(filename, options) {
      const opts = { ...(options || {}) };
      let code;
      if (opts.eval) {
        const src = String(filename);
        code = /^\s*(import|export)\s/m.test(src)
          ? `import ${JSON.stringify(pathToFileURL(guardFile).href)};\n${src}`
          : `${prelude}require(${JSON.stringify(guardFile)});\n${src}`;
        if (code.startsWith('import')) {
          code = `${prelude}${code}`;
        }
      } else {
        let url;
        if (filename instanceof URL) {
          url = filename.href;
        } else if (/^(file|data):/.test(String(filename))) {
          url = String(filename);
        } else {
          url = pathToFileURL(path.resolve(String(filename))).href;
        }
        code =
          `${prelude}require(${JSON.stringify(guardFile)});\n` +
          `import(${JSON.stringify(url)}).catch((e) => ` +
          `process.nextTick(() => { throw e; }));\n`;
      }
      super(code, { ...opts, eval: true });
    }
  }
  workerThreads.Worker = GuardedWorker;
  nodeModule.syncBuiltinESMExports();
}

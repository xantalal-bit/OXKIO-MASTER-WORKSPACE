'use strict';

const { assertEnvironment } = require('../config/environment-contract');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const SHUTDOWN_TIMEOUT_MS = 10_000;

function parsePort(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

function readRuntimeConfig(env = process.env) {
  assertEnvironment(env);
  return Object.freeze({
    port: parsePort(env.PORT),
    host: DEFAULT_HOST,
    filesystem: 'ephemeral',
    executionEnabled: false,
    safeDraftOnly: true,
  });
}

function createRuntimeReadiness() {
  let ready = false;
  return Object.freeze({
    markReady() { ready = true; },
    markNotReady() { ready = false; },
    isReady() { return ready; },
  });
}

function getRuntimeProbe(pathname, method, readiness, runtimeConfig) {
  if (method !== 'GET') return null;
  if (pathname === '/health') {
    return {
      statusCode: 200,
      payload: { ok: true, status: 'healthy', filesystem: runtimeConfig.filesystem },
    };
  }
  if (pathname === '/ready') {
    const ready = readiness.isReady();
    return {
      statusCode: ready ? 200 : 503,
      payload: { ok: ready, status: ready ? 'ready' : 'not_ready' },
    };
  }
  return null;
}

function createShutdownController({
  server,
  readiness,
  cleanup = () => {},
  processRef = process,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
} = {}) {
  if (!server || typeof server.close !== 'function') {
    throw new Error('A closable server is required.');
  }

  let shutdownPromise = null;
  const shutdown = (signal = 'manual') => {
    if (shutdownPromise) return shutdownPromise;
    readiness?.markNotReady();
    shutdownPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Graceful shutdown timed out.')), timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
      server.close((error) => {
        clearTimeout(timeout);
        if (error) return reject(error);
        Promise.resolve()
          .then(() => cleanup())
          .then(() => resolve({ ok: true, signal }), reject);
      });
    });
    return shutdownPromise;
  };

  const handlers = new Map();
  const install = () => {
    ['SIGTERM', 'SIGINT'].forEach((signal) => {
      const handler = () => {
        shutdown(signal)
          .then(() => { processRef.exitCode = 0; })
          .catch(() => { processRef.exitCode = 1; });
      };
      handlers.set(signal, handler);
      processRef.once(signal, handler);
    });
  };
  const uninstall = () => {
    handlers.forEach((handler, signal) => processRef.removeListener(signal, handler));
    handlers.clear();
  };

  return Object.freeze({ install, uninstall, shutdown });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  SHUTDOWN_TIMEOUT_MS,
  createRuntimeReadiness,
  createShutdownController,
  getRuntimeProbe,
  parsePort,
  readRuntimeConfig,
};

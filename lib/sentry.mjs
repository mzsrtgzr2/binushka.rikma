/**
 * Server-side Sentry for the one Vercel function.
 *
 * Stays a no-op until SENTRY_DSN is a real Sentry DSN. console.log, warn, and
 * error become Sentry Logs. console.error also becomes an Issue. Outbound
 * HTTP, request bodies, cookies, and local variables are not recorded:
 * checkout and newsletter handlers see names, phones, emails, and addresses.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scrub = require('./sentry-scrub.js');

export const requestContext = new AsyncLocalStorage();

export function requestContextFor(req, route) {
  return {
    method: scrub.safeMethod(req && req.method),
    route: scrub.safeRoute(route),
  };
}

const DROPPED_INTEGRATIONS = new Set([
  'RequestData',
  'LocalVariablesAsync',
  'Http',
  'NodeFetch',
  'Console',
  'ChildProcess',
  'WorkerThreads',
  'ProcessSession',
  'ExtraErrorData',
]);

const originalError = console.error;
const pending = [];
let installed = false;
let sentryPromise = null;
let capturing = false;

function loadSentry() {
  const dsn = typeof process.env.SENTRY_DSN === 'string' ? process.env.SENTRY_DSN.trim() : '';
  if (!scrub.isSentryDsn(dsn)) return Promise.resolve(null);
  if (!sentryPromise) {
    const environment = scrub.sentryEnvironment(process.env);
    const release = scrub.isRelease(process.env.VERCEL_GIT_COMMIT_SHA)
      ? process.env.VERCEL_GIT_COMMIT_SHA
      : undefined;
    sentryPromise = import('@sentry/node')
      .then((Sentry) => {
        Sentry.init({
          dsn,
          environment,
          release,
          sendDefaultPii: false,
          tracesSampleRate: 0,
          enableOpenTelemetrySetup: false,
          maxValueLength: 250,
          enableLogs: true,
          integrations: (integrations) => {
            const kept = integrations.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name));
            kept.push(Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }));
            return kept;
          },
          beforeSend(event) {
            return scrub.sanitizeEvent(event);
          },
          beforeSendLog(log) {
            return scrub.sanitizeLog(log);
          },
        });
        return Sentry;
      })
      .catch((err) => {
        sentryPromise = null;
        originalError.call(console, 'sentry init failed', err && err.message ? err.message : err);
        return null;
      });
  }
  return sentryPromise;
}

async function send(shaped) {
  const Sentry = await loadSentry();
  if (!Sentry) return;
  const context = requestContext.getStore() || {};
  capturing = true;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      if (context.method) scope.setTag('method', context.method);
      if (context.route) scope.setTag('route', context.route);
      if (shaped.message) scope.setTag('where', shaped.message.slice(0, 120));
      if (shaped.details.length) scope.setContext('detail', { items: shaped.details });
      if (shaped.error) Sentry.captureException(shaped.error);
      else Sentry.captureMessage(shaped.message);
    });
  } finally {
    capturing = false;
  }
}

export async function ensureServerReporting() {
  installServerReporting();
  return loadSentry();
}

export function installServerReporting() {
  if (installed) return;
  installed = true;
  console.error = (...args) => {
    originalError.apply(console, args);
    if (capturing) return;
    try {
      const shaped = scrub.eventsFromConsoleArgs(args);
      if (!shaped) return;
      pending.push(
        send(shaped).catch((err) => {
          originalError.call(console, 'sentry report failed', err && err.message ? err.message : err);
        })
      );
    } catch (err) {
      originalError.call(console, 'sentry report failed', err && err.message ? err.message : err);
    }
  };
}

export async function flushServerReporting() {
  while (pending.length) {
    const batch = pending.splice(0, pending.length);
    await Promise.all(batch);
  }
  if (!sentryPromise) return;
  const Sentry = await sentryPromise;
  if (Sentry) await Sentry.flush(2000);
}

import assert from 'node:assert/strict';
import test from 'node:test';
import * as Sentry from '@sentry/node';
import { sanitizeLog } from '../lib/sentry-scrub.js';

test('console warnings become scrubbed Sentry logs', async () => {
  const envelopes = [];
  Sentry.init({
    dsn: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o12345.ingest.sentry.io/1234567',
    enableLogs: true,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    enableOpenTelemetrySetup: false,
    transport() {
      return {
        send(envelope) {
          envelopes.push(envelope);
          return Promise.resolve({});
        },
        flush() {
          return Promise.resolve(true);
        },
      };
    },
    integrations(integrations) {
      const kept = integrations.filter((integration) => integration.name !== 'Console');
      kept.push(Sentry.consoleLoggingIntegration({ levels: ['warn'] }));
      return kept;
    },
    beforeSendLog(log) {
      return sanitizeLog(log);
    },
  });

  console.warn('Morning retry', { email: 'a@b.co', env: 'sandbox' });
  await Sentry.flush(2000);

  const blob = JSON.stringify(envelopes);
  assert.match(blob, /Morning retry/);
  assert.match(blob, /sandbox/);
  assert.equal(blob.includes('a@b.co'), false);
});

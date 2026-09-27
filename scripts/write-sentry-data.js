#!/usr/bin/env node
/**
 * Write `_data/sentry.yml` from SENTRY_DSN so the browser snippet can load.
 * The file is gitignored. An empty or invalid DSN removes it, and the
 * pages then ship without the SDK.
 */

const fs = require('fs');
const path = require('path');
const { isRelease, isSentryDsn, sentryEnvironment } = require('../lib/sentry-scrub');

function writeSentryDataFile(root, env) {
  const dest = path.join(root, '_data', 'sentry.yml');
  const dsn = typeof env.SENTRY_DSN === 'string' ? env.SENTRY_DSN.trim() : '';
  if (!isSentryDsn(dsn)) {
    fs.rmSync(dest, { force: true });
    return { enabled: false, reason: dsn ? 'invalid' : 'unset' };
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const environment = sentryEnvironment(env);
  const release = isRelease(env.VERCEL_GIT_COMMIT_SHA) ? env.VERCEL_GIT_COMMIT_SHA : '';
  const lines = [
    '# Generated from SENTRY_DSN at build time. Gitignored.',
    `dsn: ${JSON.stringify(dsn)}`,
    `environment: ${JSON.stringify(environment)}`,
  ];
  if (release) lines.push(`release: ${JSON.stringify(release)}`);
  lines.push('');
  fs.writeFileSync(dest, lines.join('\n'));
  return { enabled: true, environment, release };
}

if (require.main === module) {
  const result = writeSentryDataFile(path.join(__dirname, '..'), process.env);
  if (result.enabled) {
    process.stdout.write(`Sentry browser SDK enabled (${result.environment})\n`);
  } else if (result.reason === 'invalid') {
    process.stdout.write('Sentry browser SDK skipped (SENTRY_DSN is not a Sentry DSN)\n');
  } else {
    process.stdout.write('Sentry browser SDK skipped (SENTRY_DSN unset)\n');
  }
}

module.exports = { writeSentryDataFile };

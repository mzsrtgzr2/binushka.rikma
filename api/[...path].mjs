/**
 * The only serverless function. Every /api/* request lands here; lib/routes/dispatch.mjs
 * chooses the handler from the path.
 */

import dispatch, { routeKey } from '../lib/routes/dispatch.mjs';
import {
  ensureServerReporting,
  flushServerReporting,
  requestContext,
  requestContextFor,
} from '../lib/sentry.mjs';

export default async function handler(req, res) {
  const Sentry = await ensureServerReporting();
  const context = requestContextFor(req, routeKey(req));
  const run = () =>
    requestContext.run(context, async () => {
      try {
        return await dispatch(req, res);
      } catch (error) {
        console.error('api handler failed', error);
        throw error;
      } finally {
        await flushServerReporting();
      }
    });

  if (!Sentry) return run();
  return Sentry.withIsolationScope(() => {
    const scope = Sentry.getIsolationScope();
    if (context.method) scope.setAttribute('method', context.method);
    if (context.route) scope.setAttribute('route', context.route);
    return run();
  });
}

/**
 * The only serverless function. Every /api/* request lands here; lib/routes/dispatch.mjs
 * chooses the handler from the path.
 */

import dispatch, { routeKey } from '../lib/routes/dispatch.mjs';
import {
  flushServerReporting,
  installServerReporting,
  requestContext,
  requestContextFor,
} from '../lib/sentry.mjs';

export default async function handler(req, res) {
  installServerReporting();
  const context = requestContextFor(req, routeKey(req));
  return requestContext.run(context, async () => {
    try {
      return await dispatch(req, res);
    } catch (error) {
      console.error('api handler failed', error);
      throw error;
    } finally {
      await flushServerReporting();
    }
  });
}

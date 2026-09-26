/**
 * The only serverless function. Every /api/* request lands here; lib/routes/dispatch.mjs
 * chooses the handler from the path.
 */

import dispatch from '../lib/routes/dispatch.mjs';

export default function handler(req, res) {
  return dispatch(req, res);
}

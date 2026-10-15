import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';

/**
 * Cross-site request gate for cost-bearing and log endpoints. Feeds the
 * request to the pure, unit-tested `admitSameSiteRequest` and answers 403
 * itself when the request is refused. Returns true when it has already
 * responded (the caller returns); false when the handler should continue.
 * Authenticated hosted requests use the public origin supplied by the access
 * middleware, independently of proxy headers and the internal HTTP transport.
 * The direct local/LAN policy continues to refuse forwarding headers. Both
 * policies reject foreign/opaque origins and cross-site browser requests.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} True when a 403 was sent.
 */
export function admitSameSite(req, res) {
  const hostedOrigin =
    req.norsagaSession?.user?.active && req.norsagaPublicOrigin
      ? new URL(req.norsagaPublicOrigin)
      : null;
  const verdict = admitSameSiteRequest({
    hostHeader: hostedOrigin?.host || req.headers?.host,
    protocol:
      hostedOrigin?.protocol || (req.socket?.encrypted ? 'https:' : 'http:'),
    origin: req.headers?.origin,
    secFetchSite: req.headers?.['sec-fetch-site'],
    proxyHeaders: hostedOrigin ? {} : req.headers || {},
  });
  if (verdict.ok) return false;
  res.statusCode = verdict.status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: verdict.error }));
  return true;
}

/**
 * Wrap a middleware handler so cross-site requests are refused with 403
 * before the handler runs. Loopback tools and same-origin browser requests
 * pass straight through.
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: Function) => unknown} handler
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: Function) => unknown}
 */
export function sameSiteGated(handler) {
  return (req, res, next) => {
    if (admitSameSite(req, res)) return undefined;
    return handler(req, res, next);
  };
}

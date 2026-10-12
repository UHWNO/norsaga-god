import { isIP } from 'node:net';
import { normalizeEmail } from './config.js';

const AUTH_ROUTES = new Set([
  '/get-session',
  '/sign-out',
  '/sign-in/magic-link',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/list-user-passkeys',
  '/passkey/update-passkey',
  '/passkey/delete-passkey',
]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(data));
}

async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('JSON required'), { status: 415 });
  }
  if (Number(req.headers['content-length']) > 65_536) {
    req.resume();
    throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65_536)
      throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('Object required');
    return body;
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

export function requestHeaders(req, config) {
  const headers = new Headers();
  for (const key of ['cookie', 'origin', 'content-type', 'sec-fetch-site']) {
    if (typeof req.headers[key] === 'string')
      headers.set(key, req.headers[key]);
  }
  const peer = req.socket.remoteAddress || 'unknown';
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
  const realIP = req.headers['x-real-ip'];
  headers.set(
    'x-real-ip',
    config.trustProxy && loopback && typeof realIP === 'string' && isIP(realIP)
      ? realIP
      : peer,
  );
  return headers;
}

export function createAccessMiddleware(service, { development = false } = {}) {
  const { config } = service;
  return (req, res, next) => {
    void handle(req, res, next).catch((error) => {
      if (!res.headersSent)
        json(res, error.status || 503, {
          error:
            error.status && error.status < 500
              ? error.message
              : 'Access is temporarily unavailable. Please try again later.',
        });
      else res.end();
    });
  };

  async function handle(req, res, next) {
    const url = new URL(req.url || '/', config.origin);
    if (url.origin !== config.origin)
      return json(res, 400, { error: 'Invalid request URL' });
    const path = url.pathname;
    const headers = requestHeaders(req, config);
    if (
      config.local &&
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress,
      )
    ) {
      return json(res, 403, {
        error: 'Local development only accepts loopback connections',
      });
    }
    // Do not store authenticated HTML, documents or API results in shared caches.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    if (MUTATING.has(req.method) && headers.get('origin') !== config.origin) {
      return json(res, 403, { error: 'Request origin rejected' });
    }
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    // Public code/assets contain no authentication secrets. Application data,
    // manuals, panel documents and every provider route require a live session.
    if (
      isRead &&
      (path === '/login.html' ||
        path === '/norsaga/favicon.png' ||
        path === '/norsaga/access-logo.png' ||
        /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2?|png|svg)$/.test(path) ||
        (development &&
          (path === '/@vite/client' ||
            path.startsWith('/src/auth/') ||
            path.startsWith('/node_modules/.vite/') ||
            path.startsWith('/@id/'))))
    )
      return next();
    if (path === '/healthz' && isRead)
      return json(res, 200, { status: 'ok', authentication: 'required' });

    if (path === '/api/auth/sign-in/magic-link' && req.method === 'POST') {
      const body = await readJSON(req);
      let email;
      try {
        email = normalizeEmail(body.email);
      } catch {
        return json(res, 400, { error: 'Enter a valid email address.' });
      }
      const ip = headers.get('x-real-ip');
      const ipAllowed = service.consumeLimit(`login-ip:${ip}`, 5, 60_000);
      const emailAllowed = service.consumeLimit(
        `login-email:${email}`,
        3,
        600_000,
      );
      if (!ipAllowed)
        return json(res, 429, {
          error: 'Too many attempts. Please wait one minute.',
          retryAfter: 60,
        });
      // Address limits return the same generic response, hiding membership and
      // preventing distributed mail floods against one recipient.
      if (emailAllowed) {
        await service.auth.handler(
          new Request(`${config.origin}/api/auth/sign-in/magic-link`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              email,
              callbackURL: '/account.html',
              errorCallbackURL: '/login.html',
            }),
          }),
        );
      }
      return json(res, 200, {
        status: true,
        message:
          'If your address is approved, you’ll receive a login link by email. The link expires in 10 minutes.',
      });
    }
    if (path === '/api/access/redeem' && req.method === 'POST') {
      if (
        !service.consumeLimit(`redeem:${headers.get('x-real-ip')}`, 10, 60_000)
      )
        return json(res, 429, {
          error: 'Please wait one minute before trying again.',
        });
      const body = await readJSON(req);
      if (typeof body.token !== 'string' || !/^[a-zA-Z]{32}$/.test(body.token))
        return json(res, 400, {
          error: 'This link is invalid or expired. Request a new link.',
        });
      const target = new URL('/api/auth/magic-link/verify', config.origin);
      target.searchParams.set('token', body.token);
      target.searchParams.set('callbackURL', '/account.html');
      const response = await service.auth.handler(
        new Request(target, { headers }),
      );
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      const location = response.headers.get('location');
      const success =
        response.ok ||
        (response.status === 302 &&
          location &&
          !new URL(location, config.origin).searchParams.has('error'));
      return json(
        res,
        success ? 200 : 400,
        success
          ? { status: true }
          : { error: 'This link is invalid or expired. Request a new link.' },
      );
    }
    if (path.startsWith('/api/auth/')) {
      const route = path.slice('/api/auth'.length);
      if (!AUTH_ROUTES.has(route))
        return json(res, 404, { error: 'Unknown authentication route' });
      if (route === '/get-session' && isRead) {
        const current = await service.getSession(headers);
        if (!current) return json(res, 200, null);
        const { token: _token, ...session } = current.session;
        return json(res, 200, { user: current.user, session });
      }
      const publicAuth = [
        '/passkey/generate-authenticate-options',
        '/passkey/verify-authentication',
        '/sign-out',
        '/get-session',
      ].includes(route);
      if (!publicAuth && !(await service.getSession(headers)))
        return json(res, 401, { error: 'Login required' });
      const body =
        req.method === 'POST' ? JSON.stringify(await readJSON(req)) : undefined;
      const response = await service.auth.handler(
        new Request(url, { method: req.method, headers, body }),
      );
      for (const [key, value] of response.headers) {
        if (!['set-cookie', 'cache-control'].includes(key))
          res.setHeader(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      if (route === '/passkey/generate-authenticate-options' && response.ok) {
        const options = await response.json();
        return json(res, 200, { ...options, userVerification: 'required' });
      }
      res.statusCode = response.status;
      return res.end(Buffer.from(await response.arrayBuffer()));
    }

    const current = await service.getSession(headers);
    if (!current) {
      if (path.startsWith('/api/') || !isRead)
        return json(res, 401, {
          error: 'Login required',
          loginURL: '/login.html',
        });
      res.statusCode = 302;
      res.setHeader('Location', '/login.html');
      return res.end();
    }
    req.norsagaSession = current;
    if (path === '/api/access/status' && isRead) {
      return json(res, 200, {
        email: current.user.email,
        name: current.user.name,
        role: current.user.role,
        adminVerified: service.isFreshAdmin(current),
        passkeys: service.passkeyCount(current.user.id),
        expiresAt: current.session.expiresAt,
      });
    }
    if (path === '/api/access/activity' && req.method === 'POST') {
      service.db
        .prepare('UPDATE session SET lastActivity = ? WHERE id = ?')
        .run(Date.now(), current.session.id);
      return json(res, 200, { status: true });
    }
    if (path.startsWith('/api/access/admin/')) {
      if (!service.isFreshAdmin(current))
        return json(res, 403, {
          error: 'Verify with a passkey to manage users.',
          passkeyRequired: true,
        });
      if (path === '/api/access/admin/users' && req.method === 'GET')
        return json(res, 200, { users: service.users() });
      if (path === '/api/access/admin/events' && req.method === 'GET')
        return json(res, 200, { events: service.events() });
      if (path === '/api/access/admin/users' && req.method === 'POST') {
        const body = await readJSON(req);
        try {
          service.setUser(current.user.id, body);
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        return json(res, 200, { status: true });
      }
      return json(res, 404, { error: 'Unknown administration route' });
    }
    if (path.startsWith('/api/access/'))
      return json(res, 404, { error: 'Unknown access route' });
    return next();
  }
}

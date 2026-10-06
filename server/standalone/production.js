import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import sirv from 'sirv';
import { localProviderPlugins } from '../providers/local.js';
import { apiNotFoundPlugin } from './api-not-found.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
if (!existsSync('dist/index.html')) throw new Error('Run npm run build first.');

const app = connect();
const server = http.createServer(app);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  next();
});
app.use('/healthz', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', node: process.versions.node }));
});

// Provider routes only. Local credential-writing endpoints remain unavailable
// on the hosted application.
for (const plugin of [...localProviderPlugins(), apiNotFoundPlugin()]) {
  plugin.configurePreviewServer?.({ middlewares: app, httpServer: server });
}

app.use(sirv(`${root}/dist`, { etag: true, single: false, dotfiles: false }));
app.use((_req, res) => {
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(process.env.PORT || 4174, '127.0.0.1', () => {
  console.log(
    `NorSaga production server ready (Node ${process.versions.node})`,
  );
});

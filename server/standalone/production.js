import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import sirv from 'sirv';
import { localProviderPlugins } from '../providers/local.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { BROWSER_HEADERS } from '../../build/browser-security.js';
import { readAuthConfig } from '../auth/config.js';
import { createAccessService } from '../auth/service.js';
import { createAccessMiddleware } from '../auth/middleware.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
if (!existsSync('dist/index.html')) throw new Error('Run npm run build first.');

const app = connect();
const server = http.createServer(app);
const access = await createAccessService(readAuthConfig());

app.use((_req, res, next) => {
  for (const [name, value] of Object.entries(BROWSER_HEADERS))
    res.setHeader(name, value);
  next();
});
app.use(createAccessMiddleware(access));

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
server.once('close', () => {
  void access.close();
});

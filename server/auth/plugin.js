import { readAuthConfig } from './config.js';
import { createAccessService } from './service.js';
import { createAccessMiddleware, json } from './middleware.js';

export function accessPlugin() {
  const install = async (server, development) => {
    let service;
    try {
      service = await createAccessService(readAuthConfig());
    } catch {
      // A missing configuration must never expose feeds or fall back to a
      // client-side password. Build itself does not initialize this plugin.
      server.middlewares.use((_req, res) =>
        json(res, 503, {
          error:
            'Sign-in is not configured. Please contact your administrator.',
        }),
      );
      return;
    }
    server.middlewares.use(createAccessMiddleware(service, { development }));
    server.httpServer?.once('close', () => {
      void service.close();
    });
  };
  return {
    name: 'norsaga-server-access',
    configureServer: (server) => install(server, true),
    configurePreviewServer: (server) => install(server, false),
  };
}

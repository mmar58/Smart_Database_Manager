import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { CONFIG } from './config';
import allRoutes from './routes';

/**
 * Create and configure the Express application.
 * Separating app creation from server.listen() makes integration testing easy.
 */
export function createApp(): {
  app: express.Application;
  sessionMiddleware: ReturnType<typeof session>;
} {
  const app = express();

  const sessionMiddleware = session({
    secret: CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: true,
  });

  app.use(sessionMiddleware);
  app.use(cors({ origin: CONFIG.corsOrigin }));
  app.use(express.json({ limit: '50mb' }));

  // Serve built frontend
  app.use(express.static(CONFIG.publicDir));
  // Serve backup files
  app.use(
    '/backups',
    express.static(CONFIG.backupsDir),
  );

  // All API & auth routes
  app.use('/', allRoutes);

  // SPA fallback — serve index.html for any unmatched route
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CONFIG.publicDir, 'index.html'));
  });

  return { app, sessionMiddleware };
}

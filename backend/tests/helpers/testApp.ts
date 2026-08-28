import { createApp } from '../../src/app';
import http from 'http';
import { initSocketIo } from '../../src/socket';
import session from 'express-session';

/**
 * Creates a fully wired test server (Express + Socket.IO) bound to a random port.
 * Call `close()` in afterEach/afterAll to release the port.
 */
export async function createTestServer(): Promise<{
  httpServer: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const { app, sessionMiddleware } = createApp();
  const httpServer = http.createServer(app);
  initSocketIo(httpServer, sessionMiddleware);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve); // port 0 = OS assigns a free port
  });

  const address = httpServer.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}`;

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });

  return { httpServer, baseUrl, close };
}

import { Router, Request, Response } from 'express';
import { loadServerConnections, saveServerConnections } from '../services/CryptoService';
import type { ServerConnection, ServerConnectionsMap } from '../types';

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string) ||
    req.socket.remoteAddress ||
    req.ip ||
    ''
  );
}

const router: Router = Router();

// POST /api/connections/save
router.post('/save', async (req: Request, res: Response) => {
  try {
    const { id, connection } = req.body as {
      id?: string;
      connection?: ServerConnection;
    };
    if (!id || !connection)
      return res.status(400).json({ error: 'Missing id or connection' });
    if (connection.ipRestriction === 'current') {
      connection.savedIp = getClientIp(req);
    }
    const connections = await loadServerConnections() as ServerConnectionsMap;
    connections[id] = connection;
    await saveServerConnections(connections);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/connections/list
router.get('/list', async (req: Request, res: Response) => {
  try {
    const clientIp = getClientIp(req);
    const connections = await loadServerConnections() as ServerConnectionsMap;
    const authorised: ServerConnectionsMap = {};
    for (const [id, conn] of Object.entries(connections)) {
      const restriction = conn.ipRestriction;
      if (restriction === 'all') {
        authorised[id] = conn;
      } else if (restriction === 'current' && conn.savedIp === clientIp) {
        authorised[id] = conn;
      } else if (
        restriction === 'selected' &&
        (conn.selectedIps ?? []).includes(clientIp)
      ) {
        authorised[id] = conn;
      }
    }
    return res.json({ connections: authorised });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/connections/delete
router.delete('/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.query as { id?: string };
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const connections = await loadServerConnections() as ServerConnectionsMap;
    if (connections[id]) {
      delete connections[id];
      await saveServerConnections(connections);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/connections/edit
router.put('/edit', async (req: Request, res: Response) => {
  try {
    const { id, connection } = req.body as {
      id?: string;
      connection?: Partial<ServerConnection>;
    };
    if (!id || !connection)
      return res.status(400).json({ error: 'Missing id or connection' });
    const connections = await loadServerConnections() as ServerConnectionsMap;
    if (connections[id]) {
      connections[id] = { ...connections[id], ...connection } as ServerConnection;
      await saveServerConnections(connections);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;

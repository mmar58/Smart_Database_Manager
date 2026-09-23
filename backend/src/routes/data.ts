import { Router, Request, Response } from 'express';
import { activeConnections } from '../socket/index';

const router: Router = Router();

// PUT /api/data/update_row
router.put('/update_row', async (req: Request, res: Response) => {
  try {
    const { database, table, primaryKeyColumn, primaryKeyValue, updateData, socketId } = req.body;
    
    if (!socketId) {
      return res.status(400).json({ error: 'Missing socketId' });
    }
    
    const db = activeConnections.get(socketId);
    if (!db) {
      return res.status(400).json({ error: 'No active database connection for this session' });
    }

    await db.updateRow(database, table, primaryKeyColumn, primaryKeyValue, updateData);
    
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;

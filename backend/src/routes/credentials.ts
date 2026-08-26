import { Router, Request, Response } from 'express';
import {
  setSecureCredential,
  getSecureCredential,
  deleteSecureCredential,
} from '../services/CryptoService';

const router: Router = Router();

// POST /api/credential/set
router.post('/set', async (req: Request, res: Response) => {
  const { key, password } = req.body as { key?: string; password?: string };
  if (!key || !password)
    return res.status(400).json({ error: 'Missing key or password' });
  try {
    await setSecureCredential(key, password);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/credential/get
router.get('/get', async (req: Request, res: Response) => {
  const { key } = req.query as { key?: string };
  if (!key) return res.status(400).json({ error: 'Missing key' });
  try {
    const password = await getSecureCredential(key);
    return res.json({ password });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/credential/delete
router.delete('/delete', async (req: Request, res: Response) => {
  const { key } = req.query as { key?: string };
  if (!key) return res.status(400).json({ error: 'Missing key' });
  try {
    await deleteSecureCredential(key);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;

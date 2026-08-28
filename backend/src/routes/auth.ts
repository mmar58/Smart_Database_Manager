import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config';
import type { JwtPayload } from '../types';

const router: Router = Router();

// GET /session-credentials
router.get('/session-credentials', (req: Request, res: Response) => {
  const token = (req.headers.authorization ?? '').split(' ')[1];
  if (!token) return res.json({});
  try {
    const d = jwt.verify(token, CONFIG.jwtSecret) as JwtPayload;
    return res.json({
      host: d.host,
      port: d.port,
      username: d.username,
      database: d.database,
      ssl: d.ssl,
      engine: d.engine,
    });
  } catch {
    return res.json({});
  }
});

// POST /store-credentials
router.post('/store-credentials', (req: Request, res: Response) => {
  const { host, port, username, database, ssl, engine } = req.body as JwtPayload;
  // Note: password is NOT stored in JWT — it lives in the encrypted credentials store
  const token = jwt.sign(
    { host, port, username, database, ssl, engine },
    CONFIG.jwtSecret,
    { expiresIn: '7d' },
  );
  return res.json({ success: true, token });
});

// POST /logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => res.json({ success: true }));
});

export default router;

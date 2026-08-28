import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import { CONFIG } from '../config';

const router: Router = Router();
const upload = multer({ dest: CONFIG.backupsDir });

// POST /api/upload-backup
router.post(
  '/upload-backup',
  upload.single('backupFile'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const originalName = req.file.originalname;
    const newPath = path.join(CONFIG.backupsDir, originalName);
    try {
      await fs.rename(req.file.path, newPath);
      return res.json({
        success: true,
        message: 'Backup uploaded successfully',
        filename: originalName,
      });
    } catch {
      return res.status(500).json({ error: 'Failed to save uploaded file' });
    }
  },
);

export default router;

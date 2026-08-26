import { Router } from 'express';
import connectionsRouter from './connections';
import credentialsRouter from './credentials';
import systemRouter from './system';
import backupRouter from './backup';
import authRouter from './auth';

const router: Router = Router();

router.use('/api/connections', connectionsRouter);
router.use('/api/credential', credentialsRouter);
router.use('/api', systemRouter);
router.use('/api', backupRouter);
router.use('/', authRouter);

export default router;

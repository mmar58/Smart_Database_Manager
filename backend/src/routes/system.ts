import { Router, Request, Response } from 'express';
import os from 'os';
import type { SystemStats, CpuSnapshot } from '../types';

const router: Router = Router();

// Differential CPU measurement state
let prevCpuTimes: CpuSnapshot | null = null;

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string) ||
    req.socket.remoteAddress ||
    req.ip ||
    ''
  );
}

// GET /api/my-ip
router.get('/my-ip', (req: Request, res: Response) => {
  res.json({ ip: getClientIp(req) });
});

// GET /api/system-stats
router.get('/system-stats', (req: Request, res: Response) => {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  cpus.forEach((cpu) => {
    for (const t in cpu.times) total += (cpu.times as Record<string, number>)[t];
    idle += cpu.times.idle;
  });
  idle /= cpus.length;
  total /= cpus.length;

  let cpuUsage = 0;
  if (prevCpuTimes) {
    const idleDiff = idle - prevCpuTimes.idle;
    const totalDiff = total - prevCpuTimes.total;
    cpuUsage = totalDiff > 0 ? Math.round(100 * (1 - idleDiff / totalDiff)) : 0;
  }
  prevCpuTimes = { idle, total };

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const stats: SystemStats = {
    cpuUsage: Math.max(0, Math.min(100, cpuUsage)),
    memUsage: ((usedMem / totalMem) * 100).toFixed(1),
    totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
    usedMem: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
    cpuModel: cpus[0]?.model ?? 'Unknown',
    cpuCount: cpus.length,
    platform: os.platform(),
    uptime: Math.floor(os.uptime()),
  };

  res.json(stats);
});

export default router;

import { Server as HttpServer } from 'http';
import { Server as SocketIoServer } from 'socket.io';
import session from 'express-session';
import express from 'express';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';
import { AnnotationService } from '../services/AnnotationService';
import { SettingsService } from '../services/SettingsService';
import { QueryHistoryService } from '../services/QueryHistoryService';
import { registerDatabaseHandlers } from './handlers/database';
import { registerQueryHandlers } from './handlers/query';
import { registerDataEditHandlers } from './handlers/dataEdit';
import { registerExportHandlers } from './handlers/export';
import { registerImportHandlers } from './handlers/import';
import { registerBackupHandlers } from './handlers/backup';
import { registerAnnotationHandlers } from './handlers/annotations';
import { registerSettingsHandlers } from './handlers/settings';
import { registerHistoryHandlers } from './handlers/history';

/** Shared active DB connections: socket.id → DatabaseManager */
const activeConnections = new Map<string, DatabaseManager>();

const annotationService = new AnnotationService();
const settingsService = new SettingsService();
const historyService = new QueryHistoryService();

export function initSocketIo(
  httpServer: HttpServer,
  sessionMiddleware: ReturnType<typeof session>,
): SocketIoServer {
  const io = new SocketIoServer(httpServer, {
    cors: { origin: CONFIG.corsOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: CONFIG.maxHttpBufferSize,
  });

  // Share the Express session with Socket.IO
  io.use((socket, next) => {
    sessionMiddleware(
      socket.request as Parameters<typeof sessionMiddleware>[0],
      {} as Parameters<typeof sessionMiddleware>[1],
      next as unknown as express.NextFunction
    );
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    registerDatabaseHandlers(socket, activeConnections);
    registerQueryHandlers(socket, activeConnections);
    registerDataEditHandlers(socket, activeConnections);
    registerExportHandlers(socket, activeConnections);
    registerImportHandlers(socket, activeConnections);
    registerBackupHandlers(socket, activeConnections);
    registerAnnotationHandlers(socket, annotationService);
    registerSettingsHandlers(socket, settingsService);
    registerHistoryHandlers(socket, historyService);

    socket.on('disconnect', async () => {
      const db = activeConnections.get(socket.id);
      if (db) {
        await db.disconnect();
        activeConnections.delete(socket.id);
      }
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

export { activeConnections };

import type { Socket } from 'socket.io';
import { SettingsService } from '../../services/SettingsService';
import { setupAutoBackup } from '../../services/BackupService';
import type { AppSettings } from '../../types';

export function registerSettingsHandlers(
  socket: Socket,
  settingsService: SettingsService,
): void {
  socket.on('get_settings', async () => {
    try {
      socket.emit('settings', await settingsService.get());
    } catch { /* non-fatal */ }
  });

  socket.on('save_settings', async (settings: AppSettings) => {
    try {
      await settingsService.save(settings);
      socket.emit('settings_saved', { message: 'Settings saved' });
      // Re-schedule auto-backup jobs whenever settings change
      setupAutoBackup(settings);
    } catch {
      socket.emit('error', { message: 'Failed to save settings' });
    }
  });
}

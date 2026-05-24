import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * When built with electron-builder's `portable` target, data lives next to the .exe
 * so the app can run from a USB stick without touching %APPDATA%.
 */
export function configurePortablePaths(): void {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) {
    return;
  }

  const dataDir = path.join(portableDir, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  app.setPath('userData', dataDir);
  app.setPath('sessionData', dataDir);
}

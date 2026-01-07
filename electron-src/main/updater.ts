/**
 * Auto-Update Module
 * 
 * Handles automatic application updates using electron-updater.
 * Updates are checked on startup and can be checked manually.
 */

import { app, BrowserWindow, ipcMain } from 'electron';

// Type definitions for electron-updater (minimal types to avoid dependency in dev)
interface UpdateInfo {
  version: string;
  releaseNotes?: string | Array<{ note: string }>;
}

interface ProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface AutoUpdater {
  logger: typeof console | null;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update', listener: () => void): this;
  on(event: 'update-available', listener: (info: UpdateInfo) => void): this;
  on(event: 'update-not-available', listener: () => void): this;
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): this;
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

// Dynamically import electron-updater to avoid bundling issues in dev
let autoUpdater: AutoUpdater | null = null;

async function loadAutoUpdater(): Promise<AutoUpdater | null> {
  if (autoUpdater) return autoUpdater;
  
  try {
    const module = await import('electron-updater');
    // Cast to our interface to avoid type mismatch with electron-updater's AppUpdater
    autoUpdater = module.autoUpdater as unknown as AutoUpdater;
    return autoUpdater;
  } catch (error) {
    console.warn('[updater] electron-updater not available:', error);
    return null;
  }
}


export interface UpdateStatus {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  downloading: boolean;
  progress?: number;
  downloaded: boolean;
  error?: string;
}

let mainWindow: BrowserWindow | null = null;
let updateStatus: UpdateStatus = {
  available: false,
  downloading: false,
  downloaded: false,
};

/**
 * Initialize the auto-updater
 */
export async function initUpdater(window: BrowserWindow): Promise<void> {
  mainWindow = window;

  // Check for updates on startup (after a delay)
  if (app.isPackaged) {
    setTimeout(async () => {
      await checkForUpdates();
    }, 10000); // Wait 10 seconds after startup
  }

  const updater = await loadAutoUpdater();
  if (!updater) {
    console.log('[updater] Auto-updater not available (dev mode or missing dependency)');
    return;
  }

  // Configure logging
  updater.logger = console;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;

  // Set up event handlers
  updater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
    sendStatusToWindow();
  });

  updater.on('update-available', (info: UpdateInfo) => {
    console.log('[updater] Update available:', info.version);
    updateStatus = {
      available: true,
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' 
        ? info.releaseNotes 
        : undefined,
      downloading: false,
      downloaded: false,
    };
    sendStatusToWindow();
  });

  updater.on('update-not-available', () => {
    console.log('[updater] No update available');
    updateStatus = {
      available: false,
      downloading: false,
      downloaded: false,
    };
    sendStatusToWindow();
  });

  updater.on('download-progress', (progress: ProgressInfo) => {
    console.log(`[updater] Download progress: ${progress.percent.toFixed(1)}%`);
    updateStatus = {
      ...updateStatus,
      downloading: true,
      progress: progress.percent,
    };
    sendStatusToWindow();
  });

  updater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[updater] Update downloaded:', info.version);
    updateStatus = {
      ...updateStatus,
      downloading: false,
      downloaded: true,
      progress: 100,
    };
    sendStatusToWindow();
  });

  updater.on('error', (error: Error) => {
    console.error('[updater] Error:', error.message);
    updateStatus = {
      ...updateStatus,
      downloading: false,
      error: error.message,
    };
    sendStatusToWindow();
  });
}

/**
 * Check for available updates
 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    console.log('[updater] Skipping update check in development mode');
    return;
  }

  const updater = await loadAutoUpdater();
  if (!updater) return;

  try {
    await updater.checkForUpdates();
  } catch (error) {
    console.error('[updater] Failed to check for updates:', error);
  }
}

/**
 * Download the available update
 */
export async function downloadUpdate(): Promise<void> {
  if (!updateStatus.available) {
    console.log('[updater] No update available to download');
    return;
  }

  const updater = await loadAutoUpdater();
  if (!updater) return;

  try {
    updateStatus.downloading = true;
    sendStatusToWindow();
    await updater.downloadUpdate();
  } catch (error) {
    console.error('[updater] Failed to download update:', error);
    updateStatus.downloading = false;
    updateStatus.error = error instanceof Error ? error.message : 'Download failed';
    sendStatusToWindow();
  }
}

/**
 * Install the downloaded update and restart
 */
export async function installUpdate(): Promise<void> {
  if (!updateStatus.downloaded) {
    console.log('[updater] No update downloaded to install');
    return;
  }

  const updater = await loadAutoUpdater();
  if (!updater) return;

  updater.quitAndInstall(false, true);
}

/**
 * Get current update status
 */
export function getUpdateStatus(): UpdateStatus {
  return { ...updateStatus };
}

/**
 * Send update status to renderer process
 */
function sendStatusToWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', updateStatus);
  }
}

/**
 * Register IPC handlers for updates
 */
export function registerUpdateHandlers(ipc: typeof ipcMain): void {
  ipc.handle('update:check', async () => {
    await checkForUpdates();
    return getUpdateStatus();
  });

  ipc.handle('update:download', async () => {
    await downloadUpdate();
    return getUpdateStatus();
  });

  ipc.handle('update:install', () => {
    installUpdate();
    return { installing: true };
  });

  ipc.handle('update:getStatus', () => {
    return getUpdateStatus();
  });
}


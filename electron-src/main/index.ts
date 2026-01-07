import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from './database/sqlite.js';
import { runMigrations } from './database/migrator.js';
import { registerChatHandlers } from './ipc/chat.ipc.js';
import { registerConversationHandlers } from './ipc/conversations.ipc.js';
import { registerProviderHandlers } from './ipc/providers.ipc.js';
import { registerSettingsHandlers } from './ipc/settings.ipc.js';
import { registerModelsHandlers } from './ipc/models.ipc.js';
import { registerMemoryHandlers } from './ipc/memory.ipc.js';
import { registerFactsHandlers } from './ipc/facts.ipc.js';
import { registerUsageHandlers } from './ipc/usage.ipc.js';
import { initUpdater, registerUpdateHandlers } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'LLM Relay',
    backgroundColor: '#18181b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Disabled to allow ESM preload
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
  });

  // Remove menu in production
  if (!isDev) {
    mainWindow.setMenu(null);
  }

  // Load the app
  if (isDev) {
    await mainWindow.loadURL('http://localhost:5190');
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeApp() {
  // Initialize database
  const dbPath = path.join(app.getPath('userData'), 'llm-relay.sqlite');
  await initDatabase(dbPath);
  
  // Run migrations
  const migrationsPath = isDev
    ? path.join(__dirname, 'database/migrations')
    : path.join(process.resourcesPath, 'migrations');
  await runMigrations(migrationsPath);

  // Register IPC handlers
  registerChatHandlers(ipcMain);
  registerConversationHandlers(ipcMain);
  registerProviderHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  registerModelsHandlers(ipcMain);
  registerMemoryHandlers(ipcMain);
  registerFactsHandlers(ipcMain);
  registerUsageHandlers(ipcMain);
  registerUpdateHandlers(ipcMain);
}

// App lifecycle
app.whenReady().then(async () => {
  await initializeApp();
  await createWindow();

  // Initialize auto-updater after window is created
  if (mainWindow) {
    initUpdater(mainWindow);
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});

// Security: Prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

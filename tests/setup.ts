import { vi } from 'vitest';

// Mock electron modules for testing
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-data'),
    isPackaged: false,
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: {
      send: vi.fn(),
      openDevTools: vi.fn(),
    },
    setMenu: vi.fn(),
  })),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    removeListener: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
}));

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn),
  };

  return {
    default: vi.fn(() => mockDb),
  };
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});


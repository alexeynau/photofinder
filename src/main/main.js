const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

const { processPhotos, DEFAULT_SELECTION_FOLDER } = require('./processor');
const { analyzeText, DEFAULT_PREFIX } = require('../common/parser');

const isDev = process.env.NODE_ENV === 'development';

/**
 * Creates the main BrowserWindow instance.
 */
const createWindow = () => {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#1f2933',
    title: 'PhotoFinder',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  const indexPath = path.join(__dirname, '../renderer/index.html');
  win.loadFile(indexPath);
};

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.photofinder.app');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * IPC handlers
 */
ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

ipcMain.handle('dialog:openExternal', async (_, targetPath) => {
  if (!targetPath) {
    return false;
  }
  try {
    await shell.openPath(targetPath);
    return true;
  } catch (error) {
    console.error('Failed to open path', error);
    return false;
  }
});

ipcMain.handle('photofinder:process', async (_, payload) => {
  try {
    return await processPhotos({
      sourceDir: payload.sourceDir,
      targetDir: payload.targetDir,
      message: payload.message,
      mode: payload.mode ?? 'copy',
      parserMode: payload.parserMode ?? 'smart',
      prefix: payload.prefix ?? DEFAULT_PREFIX,
    });
  } catch (error) {
    console.error('Processing failed:', error);
    return {
      ok: false,
      error:
        'Во время обработки произошла непредвиденная ошибка. Подробности в логе консоли.',
    };
  }
});

ipcMain.handle('photofinder:preview', async (_, payload = {}) => {
  try {
    const { message = '', parserMode = 'smart', prefix = DEFAULT_PREFIX } = payload;
    return analyzeText(message, { mode: parserMode, prefix: prefix || DEFAULT_PREFIX });
  } catch (error) {
    console.error('Preview parsing failed:', error);
    return {
      ids: [],
      matches: [],
    };
  }
});

ipcMain.handle('fs:suggestTarget', async (_, sourcePath) => {
  if (!sourcePath) {
    return null;
  }
  try {
    return path.join(sourcePath, DEFAULT_SELECTION_FOLDER);
  } catch (error) {
    console.error('Failed to build target path', error);
    return null;
  }
});

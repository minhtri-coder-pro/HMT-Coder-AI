// JavaScript, electron.cjs, Electron main-process runtime; target: Windows desktop shell.
const { app, BrowserWindow, shell, ipcMain, safeStorage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

let localServer;
let windowRef;
let fatalDialogShown = false;
let appDataPath;
let cachedAppData = { chats: [], settings: {} };
let workspaceRootPath = '';
let appDataWriteQueue = Promise.resolve();
let quitAfterWrites = false;
let availableUpdate = false;
const inheritedGitHubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => windowRef?.webContents.send('update:state', { state: 'checking' }));
autoUpdater.on('update-available', info => { availableUpdate = true; windowRef?.webContents.send('update:state', { state: 'available', version: info.version }); });
autoUpdater.on('update-not-available', () => { availableUpdate = false; windowRef?.webContents.send('update:state', { state: 'current' }); });
autoUpdater.on('download-progress', progress => windowRef?.webContents.send('update:state', { state: 'downloading', percent: Math.round(progress.percent) }));
autoUpdater.on('update-downloaded', info => windowRef?.webContents.send('update:state', { state: 'downloaded', version: info.version }));
autoUpdater.on('error', error => { logDiagnostic(`Updater error: ${error.stack || error}`); windowRef?.webContents.send('update:state', { state: 'error', message: error.message }); });
let runtimeLog = path.join(process.env.TEMP || process.env.TMP || '.', 'HMT Code AI', 'logs', 'main.log');
function logDiagnostic(message) {
  try {
    fs.mkdirSync(path.dirname(runtimeLog), { recursive: true });
    fs.appendFileSync(runtimeLog, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch { }
}

function errorText(error) {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error, null, 2) || String(error); }
  catch { return String(error); }
}

function logError(origin, error) {
  const detail = `[${new Date().toISOString()}] ${origin}\n${errorText(error)}\n\n`;
  console.error(detail);
  return runtimeLog;
}

function showFatalError(origin, error) {
  const logPath = logError(origin, error);
  if (!fatalDialogShown) {
    fatalDialogShown = true;
    const trace = errorText(error);
    dialog.showErrorBox(`HMT Code AI — ${origin}`, `${trace}\n\nDiagnostic log: ${logPath}`);
  }
  app.exit(1);
}

process.on('uncaughtException', error => showFatalError('Main process exception', error));
process.on('unhandledRejection', reason => showFatalError('Main process unhandled rejection', reason));
logDiagnostic('Main process entry loaded.');

for (const [stream, label] of [[process.stdout, 'STDOUT'], [process.stderr, 'STDERR']]) {
  if (!stream?.write) continue;
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    try {
      const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
      fs.mkdirSync(path.dirname(runtimeLog), { recursive: true });
      fs.appendFileSync(runtimeLog, `[${new Date().toISOString()}] ${label} ${text}`, 'utf8');
    } catch { }
    return originalWrite(chunk, encoding, callback);
  };
}

try {
  const roamingAppData = process.env.APPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Roaming');
  const userDataPath = path.join(roamingAppData, 'HMT Code AI');
  fs.mkdirSync(path.join(userDataPath, 'logs'), { recursive: true });
  app.setPath('userData', userDataPath);
  runtimeLog = path.join(userDataPath, 'logs', 'main.log');
  appDataPath = path.join(userDataPath, 'app-data.json');
  logDiagnostic('User data directory initialized.');
  app.commandLine.appendSwitch('enable-logging', 'file');
  app.commandLine.appendSwitch('log-file', path.join(userDataPath, 'logs', 'chromium.log'));
} catch (error) {
  showFatalError('Could not initialize app data', error);
}

async function createWindow() {
  const appRoot = app.getAppPath();
  process.chdir(app.getPath('userData'));
  logDiagnostic(`Starting local service from ${appRoot}.`);
  const { startServer, setApiKey } = require(path.join(appRoot, 'server.cjs'));
  const githubTokenPath = path.join(app.getPath('userData'), 'github-read-token.bin');
  try {
    if (fs.existsSync(githubTokenPath) && safeStorage.isEncryptionAvailable()) process.env.GH_TOKEN = safeStorage.decryptString(fs.readFileSync(githubTokenPath));
  } catch (error) { logDiagnostic(`Could not load saved GitHub updater credential: ${error.stack || error}`); }
  const credentialPath = path.join(app.getPath('userData'), 'xkiro-credential.bin');
  if (fs.existsSync(credentialPath)) {
    if (safeStorage.isEncryptionAvailable()) setApiKey(safeStorage.decryptString(fs.readFileSync(credentialPath)));
  }
  ipcMain.handle('credential:save', async (_event, key) => {
    if (typeof key !== 'string' || key.trim().length < 8 || key.length > 512) throw new Error('Enter a valid API key.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(credentialPath, safeStorage.encryptString(key.trim()), { mode: 0o600 });
    setApiKey(key.trim());
    return true;
  });
  ipcMain.handle('credential:clear', async () => {
    fs.rmSync(credentialPath, { force: true });
    setApiKey(undefined);
    return true;
  });
  ipcMain.handle('github-credential:save', async (event, token) => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid GitHub credential request.');
    if (typeof token !== 'string' || token.trim().length < 20 || token.trim().length > 512) throw new Error('Enter a valid GitHub fine-grained token.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    fs.writeFileSync(githubTokenPath, safeStorage.encryptString(token.trim()), { mode: 0o600 });
    process.env.GH_TOKEN = token.trim();
    return true;
  });
  ipcMain.handle('github-credential:clear', async event => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid GitHub credential request.');
    fs.rmSync(githubTokenPath, { force: true });
    if (inheritedGitHubToken) process.env.GH_TOKEN = inheritedGitHubToken;
    else delete process.env.GH_TOKEN;
    return true;
  });
  ipcMain.handle('diagnostic:renderer-error', (event, detail) => {
    if (event.sender !== windowRef?.webContents) return false;
    showFatalError('Renderer JavaScript error', new Error(detail));
    return true;
  });
  ipcMain.handle('update:check', event => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid update request.');
    if (!app.isPackaged) return { state: 'development' };
    if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      windowRef.webContents.send('update:state', { state: 'auth-required' });
      return { state: 'auth-required' };
    }
    return autoUpdater.checkForUpdates().then(() => ({ state: 'checking' }));
  });
  ipcMain.handle('update:download', event => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid update request.');
    if (!availableUpdate) throw new Error('No update is available to download.');
    return autoUpdater.downloadUpdate();
  });
  ipcMain.handle('update:install', event => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid update request.');
    autoUpdater.quitAndInstall();
    return true;
  });
  ipcMain.handle('app-data:load', async event => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid app-data request.');
    try {
      cachedAppData = JSON.parse(await fs.promises.readFile(appDataPath, 'utf8'));
      if (!cachedAppData || !Array.isArray(cachedAppData.chats) || typeof cachedAppData.settings !== 'object') throw new Error('Invalid app data format.');
      workspaceRootPath = typeof cachedAppData.workspaceRootPath === 'string' ? cachedAppData.workspaceRootPath : '';
      return { chats: cachedAppData.chats, settings: cachedAppData.settings, workspaceRootPath };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      logDiagnostic(`Could not read app data: ${error.stack || error}`);
      return null;
    }
  });
  ipcMain.handle('app-data:save', async (event, payload) => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid app-data request.');
    if (!payload || !Array.isArray(payload.chats) || !payload.settings || typeof payload.settings !== 'object') throw new Error('Invalid app data.');
    const next = { chats: payload.chats, settings: payload.settings, workspaceRootPath };
    const encoded = JSON.stringify(next);
    if (Buffer.byteLength(encoded, 'utf8') > 200 * 1024 * 1024) throw new Error('Chat history exceeds the 200 MB local storage limit.');
    cachedAppData = next;
    appDataWriteQueue = appDataWriteQueue.catch(() => {}).then(async () => {
      const temporary = `${appDataPath}.tmp`;
      await fs.promises.writeFile(temporary, encoded, 'utf8');
      await fs.promises.rename(temporary, appDataPath);
    });
    await appDataWriteQueue;
    return true;
  });
  ipcMain.handle('workspace:choose', async event => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid workspace request.');
    const result = await dialog.showOpenDialog(windowRef, { title: 'Choose HMT Code AI workspace', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    workspaceRootPath = await fs.promises.realpath(result.filePaths[0]);
    cachedAppData.workspaceRootPath = workspaceRootPath;
    await fs.promises.writeFile(appDataPath, JSON.stringify(cachedAppData), 'utf8');
    return workspaceRootPath;
  });
  ipcMain.handle('workspace:save-files', async (event, entries) => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid workspace request.');
    if (!workspaceRootPath || !Array.isArray(entries) || entries.length < 1 || entries.length > 100) throw new Error('Choose a workspace and provide between 1 and 100 files.');
    const root = await fs.promises.realpath(workspaceRootPath);
    const prepared = [];
    const seenPaths = new Set();
    for (const entry of entries) {
      if (!entry || typeof entry.path !== 'string' || typeof entry.text !== 'string' || Buffer.byteLength(entry.text, 'utf8') > 5 * 1024 * 1024) throw new Error('Invalid file entry or file exceeds 5 MB.');
      const parts = entry.path.replaceAll('\\', '/').split('/');
      if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part.includes(':') || part.includes('\0'))) throw new Error(`Invalid workspace-relative path: ${entry.path}`);
      const normalizedPath = parts.join('/').toLowerCase();
      if (seenPaths.has(normalizedPath)) throw new Error(`Duplicate workspace path: ${entry.path}`);
      seenPaths.add(normalizedPath);
      let current = root;
      for (const part of parts.slice(0, -1)) {
        current = path.join(current, part);
        try { const stat = await fs.promises.lstat(current); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe path component: ${part}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await fs.promises.mkdir(current); }
      }
      const target = path.join(current, parts.at(-1));
      try { const stat = await fs.promises.lstat(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing to overwrite non-file: ${entry.path}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      prepared.push({ target, text: entry.text, relative: entry.path });
    }
    const existing = prepared.filter(file => fs.existsSync(file.target));
    if (existing.length) {
      const answer = await dialog.showMessageBox(windowRef, { type: 'warning', title: 'Replace existing files?', message: `Replace ${existing.length} existing file(s) in the selected workspace?`, detail: existing.map(file => file.relative).join('\n'), buttons: ['Replace files', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      if (answer.response !== 0) return { canceled: true };
    }
    for (const file of prepared) {
      const temporary = `${file.target}.${process.pid}.tmp`;
      await fs.promises.writeFile(temporary, file.text, 'utf8');
      await fs.promises.rename(temporary, file.target);
    }
    return { saved: prepared.length };
  });
  ipcMain.handle('workspace:delete-file', async (event, relativePath) => {
    if (event.sender !== windowRef?.webContents) throw new Error('Invalid workspace request.');
    if (!workspaceRootPath || typeof relativePath !== 'string') throw new Error('Choose a workspace and enter a relative file path.');
    const parts = relativePath.replaceAll('\\', '/').split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part.includes(':') || part.includes('\0'))) throw new Error('Use a relative path inside the selected workspace.');
    const root = await fs.promises.realpath(workspaceRootPath);
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Refusing to follow a symbolic link.');
    }
    const targetStat = await fs.promises.lstat(current);
    if (!targetStat.isFile()) throw new Error('Only regular files can be deleted.');
    const answer = await dialog.showMessageBox(windowRef, { type: 'warning', title: 'Delete workspace file?', message: `Permanently delete “${relativePath}”?`, detail: `Workspace: ${root}`, buttons: ['Delete file', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
    if (answer.response !== 0) return false;
    await fs.promises.unlink(current);
    return true;
  });
  localServer = await startServer(0);
  const { port } = localServer.address();
  logDiagnostic(`Local service listening on 127.0.0.1:${port}.`);
  windowRef = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'HMT Code AI',
    backgroundColor: '#101116',
    icon: path.join(appRoot, 'public', 'assets', 'hmt-code-ai.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(appRoot, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  windowRef.webContents.on('render-process-gone', (_event, details) => {
    const error = new Error(`Renderer exited: reason=${details.reason}, exitCode=${details.exitCode}`);
    showFatalError('Renderer process crashed', error);
  });
  windowRef.once('ready-to-show', () => windowRef.show());
  windowRef.webContents.on('console-message', (_event, details) => {
    const line = `[${new Date().toISOString()}] RENDERER ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})\n`;
    try { fs.appendFileSync(runtimeLog, line, 'utf8'); } catch { }
  });
  windowRef.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) showFatalError('Window failed to load', new Error(`${description} (${code})\nURL: ${validatedURL}`));
  });
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  windowRef.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) event.preventDefault();
  });
  await windowRef.loadURL(`http://127.0.0.1:${port}/`);
  logDiagnostic('Main window loaded successfully.');
  if (app.isPackaged && (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) autoUpdater.checkForUpdates().catch(error => logDiagnostic(`Automatic update check failed: ${error.stack || error}`));
  else if (app.isPackaged) windowRef.webContents.send('update:state', { state: 'auth-required' });
}

app.setAppUserModelId('com.hmt.codeai');
app.whenReady().then(createWindow).catch(error => showFatalError('Startup failed', error));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitAfterWrites) { localServer?.close(); return; }
  event.preventDefault();
  quitAfterWrites = true;
  appDataWriteQueue.catch(error => logDiagnostic(`Final app-data flush failed: ${error.stack || error}`)).finally(() => {
    localServer?.close();
    app.exit(0);
  });
});

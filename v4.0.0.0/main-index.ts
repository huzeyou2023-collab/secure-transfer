import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification } from 'electron';
import * as path from 'path';
import { DiscoveryService } from './discovery/discovery-service';
import { Store } from './secure/store';
import { PeerManager } from './secure/session';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let peers: PeerManager;
let isQuitting = false;

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: '安全传输',
    icon: path.join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#f8f9fc',
    frame: process.platform === 'win32' ? false : true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#f8f9fc', symbolColor: '#5a5a7a', height: 40 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  return mainWindow;
}

function createTray(): void {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../../resources/icon.ico')
    : path.join(__dirname, '../../resources/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('安全传输');

  const menu = Menu.buildFromTemplate([
    { label: '打开安全传输', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow?.show());
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  n.show();
}

async function bootstrap(): Promise<void> {
  const store = new Store();
  const discovery = new DiscoveryService();
  peers = new PeerManager(store, discovery);

  registerIpcHandlers(peers);

  peers.on('contacts', (list) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('contacts:updated', list);
    }
  });
  peers.on('chat', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:message', msg);
      if (!mainWindow.isVisible()) {
        notify('收到新消息', `${msg.name || '好友'}：${msg.text.slice(0, 60)}`);
      }
    }
  });
  peers.on('chat-status', (s) => {
    mainWindow?.webContents.send('chat:status', s);
  });
  peers.on('offer', (offer) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:offer', offer);
    }
    notify(`文件来自 ${offer.peerName}`, offer.name);
  });
  peers.on('file', (p) => {
    mainWindow?.webContents.send('file:progress', p);
  });
  peers.on('secwarn', (w) => {
    mainWindow?.webContents.send('security:warn', w);
    notify('安全警告', `与 ${w.name} 的身份校验失败，连接已拒绝`);
  });

  peers.start();
  createTray();
  const win = await createWindow();
  mainWindow = win;
}

app.setName('安全传输');
process.title = '安全传输';

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  bootstrap();
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

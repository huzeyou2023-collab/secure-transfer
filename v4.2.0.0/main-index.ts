import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryService } from './discovery/discovery-service';
import { Store } from './secure/store';
import { PeerManager } from './secure/session';
import { registerIpcHandlers } from './ipc-handlers';

app.setName('安全传输');
process.title = '安全传输';

// 版本号统一为四位（与 package.json 的 version 一致），前缀小写 v
export const APP_VERSION = (() => {
  try { return 'v' + app.getVersion(); } catch { return 'v4.2.0.0'; }
})();

interface AppearanceSettings {
  backgroundId: string;
  opacity: number;
  blur: number;
  radius: number;
  accent: string;
}

interface AppSettings {
  autoStart: boolean;
  minimizeToTray: boolean;
  appearance: AppearanceSettings;
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  backgroundId: 'aurora',
  opacity: 1,
  blur: 26,
  radius: 20,
  accent: '#5b7cfa',
};

const DEFAULT_SETTINGS: AppSettings = { autoStart: false, minimizeToTray: false, appearance: DEFAULT_APPEARANCE };

// 便携版：resources/app 下存在 portable.flag 或由 electron-builder portable 启动器注入环境变量。
// 便携版无托盘、无自启、关窗即退、不写注册表，数据只落在便携版自身目录。
const isPortable = (() => {
  try {
    const candidates = [
      path.join(process.resourcesPath, 'portable.flag'),
      path.join(process.resourcesPath, 'app', 'portable.flag'),
      path.join(__dirname, '..', 'portable.flag'),
      path.join(__dirname, '..', '..', 'portable.flag'),
    ];
    if (process.env.PORTABLE_EXECUTABLE_DIR) return true;
    return candidates.some((f) => { try { return fs.existsSync(f); } catch { return false; } });
  } catch {
    return false;
  }
})();

// 便携版：userData 与下载目录全部重定向到便携版 exe 所在目录，删文件夹即卸载、零残留
if (isPortable) {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    || path.dirname(process.execPath);
  try {
    app.setPath('userData', path.join(portableDir, 'Data'));
    app.setPath('downloads', path.join(portableDir, '下载'));
  } catch { /* 忽略：目录不可写时退回默认路径 */ }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let peers: PeerManager;
let store: Store;
let isQuitting = false;

function readSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.readJson<Partial<AppSettings>>('settings.json', {}) };
}

function writeSettings(s: AppSettings): void {
  store.writeJson('settings.json', s);
}

function applyAutoStart(on: boolean): void {
  // 便携版绝不触碰注册表（连删除 Run 键都不做）
  if (isPortable) return;
  app.setLoginItemSettings({ openAtLogin: on });
}

const isWin = process.platform === 'win32';

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 540,
    title: '安全传输',
    icon: path.join(__dirname, '../../resources/icon.png'),
    // Liquid Glass：无边框窗口；背景由 CSS 控制（不透明，避免 DWM 合成穿透）
    backgroundColor: '#ffffff',
    transparent: false,
    frame: false,
    hasShadow: true,
    roundedCorners: true,
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

  // 最大化状态同步给渲染层（最大化时去掉透明边距与圆角）
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:state', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:state', false));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    // 便携版：直接退出；安装版：仅当设置“关闭最小化到托盘”开启时才驻留
    const minimize = !isPortable && readSettings().minimizeToTray;
    if (!isQuitting && minimize) {
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
    { label: '打开安全传输', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
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
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
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
  store = new Store();
  const discovery = new DiscoveryService();
  peers = new PeerManager(store, discovery);

  registerIpcHandlers(peers, {
    isPortable,
    getSettings: readSettings,
    setSettings: (s: Partial<AppSettings>) => {
      const next = { ...readSettings(), ...s };
      writeSettings(next);
      applyAutoStart(next.autoStart);
      // 托盘按需创建/销毁
      if (next.minimizeToTray && !isPortable && !tray) createTray();
      if (!next.minimizeToTray && tray) { tray.destroy(); tray = null; }
      return next;
    },
  });

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

  // 安装版：按设置决定是否启用托盘；便携版：永不创建托盘
  if (!isPortable && readSettings().minimizeToTray) createTray();
  applyAutoStart(readSettings().autoStart);

  const win = await createWindow();
  mainWindow = win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  bootstrap();
});

app.on('window-all-closed', () => {
  // 便携版与安装版默认：窗口全部关闭即退出进程
  app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

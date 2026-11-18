import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, screen } from 'electron';
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
  try { return 'v' + app.getVersion(); } catch { return 'v5.1.6.0'; }
})();

interface AppearanceSettings {
  background: string;
  intensity: number;
  opacity: number;
  blur: number;
  radius: number;
  accent: string;
  specular: number;
  shadow: number;
}

/** 回车键行为：enter = Enter 发送 / Shift+Enter 换行；shift-enter = 相反 */
export type SendKeyMode = 'enter' | 'shift-enter';

interface AppSettings {
  autoStart: boolean;
  minimizeToTray: boolean;
  appearance: AppearanceSettings;
  sendKey: SendKeyMode;
  /** 全屏（绿色按钮）时是否保留任务栏：false = 覆盖任务栏（苹果式全屏），true = 保留任务栏 */
  fullscreenTaskbar: boolean;
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  background: '#dce4fa',
  intensity: 82,
  opacity: 1,
  blur: 30,
  radius: 20,
  accent: '#007aff',
  specular: 76,
  shadow: 58,
};

const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  minimizeToTray: false,
  appearance: DEFAULT_APPEARANCE,
  sendKey: 'enter',
  fullscreenTaskbar: false,
};

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
    const dataDir = path.join(portableDir, 'Data');
    const downloadDir = path.join(portableDir, '下载');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(downloadDir, { recursive: true });
    app.setPath('userData', dataDir);
    app.setPath('downloads', downloadDir);
  } catch { /* 忽略：目录不可写时退回默认路径 */ }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let peers: PeerManager;
let store: Store;
let isQuitting = false;
/** 全屏模式：none=窗口化；native=真正全屏（覆盖任务栏）；workarea=全屏但保留任务栏 */
let fullscreenMode: 'none' | 'native' | 'workarea' = 'none';
/** 正在切换全屏（抑制 Electron 事件把状态覆盖掉） */
let fullscreenTransitioning = false;
/** 进入全屏前的窗口位置，用于退出全屏时恢复 */
let windowedBounds: Electron.Rectangle | null = null;

function sendWindowState(v: boolean): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:state', v);
}


/** 让窗口内容区精确铺满目标矩形（透明窗口存在不可见缩放边框，需要按差值补偿，否则右侧/底部留缝） */
function setContentBoundsTo(win: BrowserWindow, rect: Electron.Rectangle): void {
  try {
    const b = win.getBounds();
    const c = win.getContentBounds();
    const dw = Math.max(0, b.width - c.width);
    const dh = Math.max(0, b.height - c.height);
    win.setBounds({
      x: Math.round(rect.x - dw / 2),
      y: Math.round(rect.y - dh / 2),
      width: rect.width + dw,
      height: rect.height + dh,
    });
  } catch { try { win.setBounds(rect); } catch { /* 忽略 */ } }
}
/** 进入全屏：按设置决定覆盖 / 保留任务栏；两种模式四角都露出纯黑 */
function enterWindowFullscreen(win: BrowserWindow): void {
  if (fullscreenMode !== 'none' || win.isDestroyed()) return;
  windowedBounds = win.getBounds();
  fullscreenTransitioning = true;
  try {
    if (readSettings().fullscreenTaskbar) {
      if (win.isFullScreen()) win.setFullScreen(false);
      const d = screen.getDisplayMatching(win.getBounds());
      setContentBoundsTo(win, d.workArea);
      fullscreenMode = 'workarea';
    } else {
      win.setFullScreen(true);
      fullscreenMode = 'native';
    }
  } catch { /* 忽略 */ }
  setTimeout(() => { fullscreenTransitioning = false; }, 400);
  sendWindowState(true);
}

/** 退出全屏：无条件恢复进入前的窗口位置（修复“保留任务栏”后无法退出全屏） */
function exitWindowFullscreen(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (fullscreenMode === 'none' && !win.isFullScreen()) return;
  fullscreenTransitioning = true;
  fullscreenMode = 'none';
  const restore = windowedBounds;
  try { if (win.isFullScreen()) win.setFullScreen(false); } catch { /* 忽略 */ }
  sendWindowState(false);
  setTimeout(() => {
    try {
      if (!win.isDestroyed() && restore) win.setBounds(restore);
    } catch { /* 忽略 */ }
    fullscreenTransitioning = false;
  }, 250);
}

/** 全屏中切换“保留 / 隐藏任务栏”：立即生效，无需退出再进全屏 */
function applyFullscreenTaskbarMode(win: BrowserWindow, keepTaskbar: boolean): void {
  if (fullscreenMode === 'none' || win.isDestroyed()) return;
  fullscreenTransitioning = true;
  try {
    if (keepTaskbar) {
      if (win.isFullScreen()) win.setFullScreen(false);
      const d = screen.getDisplayMatching(win.getBounds());
      setContentBoundsTo(win, d.workArea);
      fullscreenMode = 'workarea';
    } else {
      win.setFullScreen(true);
      fullscreenMode = 'native';
    }
  } catch { /* 忽略 */ }
  setTimeout(() => { fullscreenTransitioning = false; }, 400);
}

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

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    // 窗口尺寸包含 44px 的透明边距（CSS --win-pad），用于绘制真实悬浮投影；
    // 实际内容区域仍约 1120×780。
    width: 1128,
    height: 788,
    minWidth: 768,
    minHeight: 548,
    title: '安全传输',
    icon: path.join(__dirname, '../../resources/icon.png'),
    // Liquid Glass：透明无边框窗口。
    // 窗口本身透明，超椭圆外形与投影全部由渲染层 CSS 绘制，
    // 四角之外的像素真正透出桌面（不再是白色矩形）。
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    hasShadow: false,       // 使用 CSS 投影（窗口内留白边距），避免 DWM 给矩形窗口描边
    roundedCorners: false,  // 关闭系统 8px 圆角裁切，交给 CSS 超椭圆
    thickFrame: true,
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

  // 绿色按钮 = 苹果式全屏（覆盖 / 保留任务栏由设置决定），再按一次还原
  mainWindow.on('enter-full-screen', () => {
    if (fullscreenTransitioning) return;
    fullscreenMode = 'native';
    sendWindowState(true);
  });
  mainWindow.on('leave-full-screen', () => {
    if (fullscreenTransitioning) return;
    fullscreenMode = 'none';
    sendWindowState(false);
  });

  // 鼠标在透明边距/阴影区域时点击穿透到下层窗口，在 UI 区域内正常交互
  ipcMain.removeHandler('set-ignore-mouse');
  ipcMain.handle('set-ignore-mouse', (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
    return { success: true };
  });

  ipcMain.removeHandler('window-action');
  ipcMain.handle('window-action', (e, action: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { success: false };
    if (action === 'minimize') {
      win.minimize();
    } else if (action === 'close') {
      win.close();
    } else if (action === 'maximize') {
      if (fullscreenMode !== 'none' || win.isFullScreen()) exitWindowFullscreen(win);
      else enterWindowFullscreen(win);
    } else if (action === 'toggle-always-on-top') {
      const next = !win.isAlwaysOnTop();
      win.setAlwaysOnTop(next);
      return { success: true, alwaysOnTop: next };
    }
    return { success: true };
  });

  // 最大化 / 全屏状态同步给渲染层（全屏时去掉透明边距，四角用纯黑填充）
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
      const prev = readSettings();
      const next = { ...prev, ...s };
      writeSettings(next);
      applyAutoStart(next.autoStart);
      // 托盘按需创建/销毁
      if (next.minimizeToTray && !isPortable && !tray) createTray();
      if (!next.minimizeToTray && tray) { tray.destroy(); tray = null; }
      // 全屏中切换“保留任务栏”立即生效
      if (next.fullscreenTaskbar !== prev.fullscreenTaskbar && mainWindow && !mainWindow.isDestroyed()) {
        applyFullscreenTaskbarMode(mainWindow, next.fullscreenTaskbar);
      }
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



















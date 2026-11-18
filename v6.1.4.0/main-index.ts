import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, shell, Notification, ipcMain, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DiscoveryService } from './discovery/discovery-service';
import { Store } from './secure/store';
import { PeerManager } from './secure/session';
import { registerIpcHandlers } from './ipc-handlers';
import { DEFAULT_STRENGTH, Strength, normalizeStrength, pskSeedFromPassword } from './secure/keys';
import { cryptSecret, decryptSecret } from './util';

app.setName('安全传输');
process.title = '安全传输';

// 版本号统一为四位（与 package.json 的 version 一致），前缀小写 v
export const APP_VERSION = (() => {
  try { return 'v' + app.getVersion(); } catch { return 'v6.1.4.0'; }
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
  /** 主题模式：light 手动浅色 / dark 手动深色 / system 跟随系统 / time 跟随时间 */
  theme: 'light' | 'dark' | 'system' | 'time';
  /** 窗口控制键：mac 自绘红绿灯 / win 系统原生三键 */
  windowControls: 'mac' | 'win';
  /** 最大化时隐藏任务栏 */
  hideTaskbarOnMax: boolean;
}

/** 回车键行为：enter = Enter 发送 / Shift+Enter 换行；shift-enter = 相反 */
export type SendKeyMode = 'enter' | 'shift-enter';

interface PhysicsSettings {
  enabled: boolean;
  lightX: number;
  lightY: number;
  material: 'glass' | 'frost' | 'metal' | 'jelly';
  bounce: number;
  rebound: number;
  ripple: number;
  particles: number;
  viscosity: number;
  gravity: number;
  thickness: number;
  refraction: number;
}

interface AppSettings {
  autoStart: boolean;
  minimizeToTray: boolean;
  appearance: AppearanceSettings;
  physics: PhysicsSettings;
  sendKey: SendKeyMode;
  /** 加密强度（位）：64/128/192/256/512/1024，默认 256 */
  encStrength: Strength;
  /** 自定义密钥种子（PBKDF2-SHA512 结果 base64，空串 = 使用默认 ECDH 派生密钥）。落盘时经 safeStorage 加密 */
  encSecret: string;
  /** 首次启动简介页是否已跳过 */
  onboardingDone: boolean;
}

const DEFAULT_PHYSICS: PhysicsSettings = {
  enabled: false,
  lightX: 0.72,
  lightY: 0.22,
  material: 'glass',
  bounce: 0.55,
  rebound: 0.62,
  ripple: 0.7,
  particles: 26,
  viscosity: 0.35,
  gravity: 1,
  thickness: 0.55,
  refraction: 0.6,
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
  background: '#dce4fa',
  intensity: 82,
  opacity: 1,
  blur: 30,
  radius: 20,
  accent: '#007aff',
  specular: 76,
  shadow: 58,
  theme: 'light',
  windowControls: 'mac',
  hideTaskbarOnMax: false,
};

const DEFAULT_SETTINGS: AppSettings = {
  // 安全传输常开常连：安装版默认开机自启 + 关窗驻留托盘，保持在线不断线
  autoStart: true,
  minimizeToTray: true,
  appearance: DEFAULT_APPEARANCE,
  physics: DEFAULT_PHYSICS,
  sendKey: 'enter',
  encStrength: DEFAULT_STRENGTH,
  encSecret: '',
  onboardingDone: false,
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

/** 主进程侧主题解析（与渲染层 resolveTheme 同口径：system 看系统、time 按本地时间 6–18 点） */
function resolveThemeMain(mode: 'light' | 'dark' | 'system' | 'time'): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'time') {
    const h = new Date().getHours();
    return h >= 6 && h < 18 ? 'light' : 'dark';
  }
  try { return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'; } catch { return 'light'; }
}

/** 重建主窗口（窗口控制键切换时用）：保留位置 / 最大化 / 全屏 / 可见状态 */
let rebuildTimer: NodeJS.Timeout | null = null;
function rebuildWindow(): void {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null;
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    const bounds = w.getBounds();
    const wasMax = w.isMaximized();
    const wasFull = w.isFullScreen();
    const wasVisible = w.isVisible();
    w.destroy();
    const nw = await createWindow();
    if (wasMax) nw.maximize();
    else if (wasFull) nw.setFullScreen(true);
    else nw.setBounds(bounds);
    if (wasVisible) nw.show();
  }, 80);
}

function readSettings(): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...store.readJson<Partial<AppSettings>>('settings.json', {}) };
  // 外观 / 物理引擎深合并：旧 settings.json 缺新字段时补默认值
  merged.appearance = { ...DEFAULT_APPEARANCE, ...(merged.appearance || {}) };
  merged.physics = { ...DEFAULT_PHYSICS, ...(merged.physics || {}) };
  // 密钥种子落盘时已加密，读出时解密（兼容旧版明文）
  merged.encSecret = decryptSecret(merged.encSecret);
  return merged;
}

function writeSettings(s: AppSettings): void {
  store.writeJson('settings.json', { ...s, encSecret: cryptSecret(s.encSecret) });
}

function applyAutoStart(on: boolean): void {
  // 便携版绝不触碰注册表（连删除 Run 键都不做）
  if (isPortable) return;
  app.setLoginItemSettings({ openAtLogin: on });
}

async function createWindow(): Promise<BrowserWindow> {
  const settings = readSettings();
  // mac 键模式与 Windows 键模式统一走透明无边框超椭圆窗口：
  // 四角真透出桌面、外形由 CSS 绘制，窗口圆角全局由「窗口圆角」设置驱动；
  // 区别只在顶栏按键：mac = 左侧自绘红绿灯，Windows = 右上自绘 —□× 三键。
  mainWindow = new BrowserWindow({
    // 窗口尺寸包含 44px 的透明边距（CSS --win-pad 左右各 22px），用于绘制真实悬浮投影；
    // 实际内容区域约 1124×784。
    width: 1168,
    height: 828,
    minWidth: 800,
    minHeight: 580,
    title: '安全传输',
    icon: path.join(__dirname, '../../resources/icon.png'),
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: true,
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

  // 全屏（隐藏任务栏）逃生通道：Esc / F11 随时退出全屏，杜绝「进得去出不来」
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    const win = mainWindow;
    if (!win || win.isDestroyed() || !win.isFullScreen()) return;
    const k = input.key;
    if (k === 'Escape' || k === 'F11') {
      win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
    }
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
      // 绿色按钮 / 系统三键 = 最大化 / 还原：用系统动画与直角贴合，取消最大化后恢复超椭圆圆角。
      // 外观设置「最大化时隐藏任务栏」开启时，最大化走全屏覆盖（隐藏任务栏），还原时退出全屏。
      const hide = !!readSettings().appearance.hideTaskbarOnMax;
      if (win.isFullScreen()) {
        win.setFullScreen(false);
        if (win.isMaximized()) win.unmaximize();
      } else if (win.isMaximized()) {
        win.unmaximize();
      } else if (hide) {
        win.setFullScreen(true);
      } else {
        win.maximize();
      }
    } else if (action === 'toggle-always-on-top') {
      const next = !win.isAlwaysOnTop();
      win.setAlwaysOnTop(next);
      return { success: true, alwaysOnTop: next };
    }
    return { success: true };
  });

  // 窗口控制键切换（mac 红绿灯 ↔ Windows 系统三键）：写设置并重建窗口，保留位置与最大化状态
  ipcMain.removeHandler('set-window-controls');
  ipcMain.handle('set-window-controls', (_e, mode: 'mac' | 'win') => {
    if (mode !== 'mac' && mode !== 'win') return { success: false };
    const s = readSettings();
    if (s.appearance.windowControls === mode) return { success: true };
    s.appearance.windowControls = mode;
    writeSettings(s);
    rebuildWindow();
    return { success: true };
  });
  // 模式切换「立即重启」：真正重启（relaunch 保留参数与便携版形态），不能只关窗口
  ipcMain.removeHandler('app-restart');
  ipcMain.handle('app-restart', () => {
    app.relaunch();
    app.exit(0);
    return { success: true };
  });
  ipcMain.removeHandler('set-app-icon');
  ipcMain.handle('set-app-icon', (_e, dataUrl: string) => {    try {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return { success: false };
      const img = nativeImage.createFromDataURL(dataUrl);
      if (img.isEmpty()) return { success: false };
      const win = mainWindow;
      if (win && !win.isDestroyed()) win.setIcon(img);
      if (tray) tray.setImage(img.resize({ width: 16, height: 16 }));
      // 桌面快捷方式图标同步跟随主题色（仅安装版：查找指向本 exe 的 .lnk 并重写图标）
      try {
        const userData = app.getPath('userData');
        const iconPng = path.join(userData, 'app-icon.png');
        fs.writeFileSync(iconPng, img.toPNG());
        const desktops = [app.getPath('desktop')];
        try { const od = path.join(desktops[0], 'OneDrive - Personal'); /* 忽略 */ } catch { /* 忽略 */ }
        for (const dir of desktops) {
          let files: string[] = [];
          try { files = fs.readdirSync(dir); } catch { continue; }
          for (const f of files) {
            if (!f.toLowerCase().endsWith('.lnk')) continue;
            const p = path.join(dir, f);
            try {
              const existing = shell.readShortcutLink(p);
              if (!existing || !existing.target) continue;
              const t = path.basename(existing.target.toLowerCase());
              if (t !== 'securetransfer.exe' && t !== '安全传输.exe') continue;
              shell.writeShortcutLink(p, 'replace', {
                target: existing.target,
                args: existing.args || '',
                icon: iconPng,
                iconIndex: 0,
              });
            } catch { /* 单个快捷方式失败不影响整体 */ }
          }
        }
      } catch { /* 快捷方式更新失败不影响窗口/托盘图标 */ }
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  // 系统原生三键主题同步：窗口已全部透明无边框自绘（不再使用 titleBarOverlay），此通道保留为空实现
  ipcMain.removeHandler('set-titlebar-theme');
  ipcMain.handle('set-titlebar-theme', () => ({ success: true }));

  // ── mac 模式自绘缩放手柄：渲染层拖动 → 主进程按屏幕光标差值改窗口大小 ──
  type ResizeEdge = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  let resizeCtx: { edge: ResizeEdge; sx: number; sy: number; bounds: Electron.Rectangle } | null = null;
  let resizeTimer: NodeJS.Timeout | null = null;
  const endResize = () => {
    resizeCtx = null;
    if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null; }
  };
  ipcMain.removeHandler('window-resize-start');
  ipcMain.handle('window-resize-start', (e, edge: ResizeEdge) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isFullScreen() || win.isMaximized()) return { success: false };
    const p = screen.getCursorScreenPoint();
    resizeCtx = { edge, sx: p.x, sy: p.y, bounds: win.getBounds() };
    if (resizeTimer) clearInterval(resizeTimer);
    resizeTimer = setInterval(() => {
      if (!resizeCtx || !win || win.isDestroyed()) { endResize(); return; }
      const c = screen.getCursorScreenPoint();
      const dx = c.x - resizeCtx.sx;
      const dy = c.y - resizeCtx.sy;
      const b = resizeCtx.bounds;
      const minW = 800, minH = 580;
      let { x, y, width, height } = b;
      if (resizeCtx.edge.includes('e')) width = Math.max(minW, b.width + dx);
      if (resizeCtx.edge.includes('s')) height = Math.max(minH, b.height + dy);
      if (resizeCtx.edge.includes('w')) { width = Math.max(minW, b.width - dx); x = b.x + (b.width - width); }
      if (resizeCtx.edge.includes('n')) { height = Math.max(minH, b.height - dy); y = b.y + (b.height - height); }
      win.setBounds({ x, y, width, height }, false);
    }, 16);
    return { success: true };
  });
  ipcMain.removeHandler('window-resize-end');
  ipcMain.handle('window-resize-end', () => { endResize(); return { success: true }; });

  // 传输中心：断点续传与进行中传输的快照
  ipcMain.handle('get-transfers', () => peers.listTransfers());

  // 最大化 / 还原状态同步给渲染层（最大化时去掉透明边距与圆角，直角铺满工作区）
  // 最大化/全屏时临时解除置顶：保证系统自动隐藏任务栏能在鼠标触底时正常唤出，还原后恢复。
  let topBeforeMax = false;
  const suspendTopOnMax = () => {
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    topBeforeMax = w.isAlwaysOnTop();
    if (topBeforeMax) {
      w.setAlwaysOnTop(false);
      w.webContents.send('window:top', false);
    }
  };
  const restoreTopAfterMax = () => {
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    if (topBeforeMax) {
      w.setAlwaysOnTop(true);
      w.webContents.send('window:top', true);
      topBeforeMax = false;
    }
  };
  mainWindow.on('maximize', () => { suspendTopOnMax(); mainWindow?.webContents.send('window:state', true); });
  mainWindow.on('unmaximize', () => { restoreTopAfterMax(); mainWindow?.webContents.send('window:state', false); });
  // 全屏（最大化隐藏任务栏）同样按「最大化」布局处理
  mainWindow.on('enter-full-screen', () => { suspendTopOnMax(); mainWindow?.webContents.send('window:state', true); });
  mainWindow.on('leave-full-screen', () => { restoreTopAfterMax(); mainWindow?.webContents.send('window:state', false); });

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

  mainWindow.on('closed', () => {
    // 清理缩放手柄轮询等（若在关窗时仍挂起）
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
    getCryptoInfo: () => peers.getCryptoInfo(),
    setSettings: (s: Partial<AppSettings>) => {
      const prev = readSettings();
      const next = { ...prev, ...s };
      writeSettings(next);
      applyAutoStart(next.autoStart);
      // 托盘按需创建/销毁
      if (next.minimizeToTray && !isPortable && !tray) createTray();
      if (!next.minimizeToTray && tray) { tray.destroy(); tray = null; }
      // 加密配置变化：立即用于后续所有连接（已建立的会话保持原密钥，重连后生效）
      if (next.encStrength !== prev.encStrength || next.encSecret !== prev.encSecret) {
        peers.setCryptoConfig({ strength: next.encStrength, pskSeed: next.encSecret });
      }
      return next;
    },
    /** 设置加密强度 / 自定义密钥（password 为 null 表示不改动，空串表示清除）
     *  修改或清除密钥时必须先验证旧密钥：oldPassword 派生的种子须与当前存的一致 */
    setEncryption: (strength: Strength, password: string | null, oldPassword?: string) => {
      const prev = readSettings();
      const next: AppSettings = { ...prev, encStrength: normalizeStrength(strength) };
      if (password !== null) {
        const changing = !!prev.encSecret;
        // 已有密钥时，替换或清除都必须验证旧密钥
        if (changing) {
          const oldSeed = (oldPassword && oldPassword.trim())
            ? pskSeedFromPassword(oldPassword.trim()).toString('base64')
            : '';
          if (oldSeed !== prev.encSecret) {
            throw new Error('旧密钥不正确，无法修改');
          }
        }
        next.encSecret = password.trim() ? pskSeedFromPassword(password.trim()).toString('base64') : '';
      }
      writeSettings(next);
      peers.setCryptoConfig({ strength: next.encStrength, pskSeed: next.encSecret });
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
  peers.on('friendreq', (req) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('friend:request', req);
    }
    notify('好友申请', `${req.name} 请求添加你为好友`);
  });
  peers.on('friendaccept', (info) => {
    mainWindow?.webContents.send('friend:accepted', info);
    notify('好友申请通过', `${info.name} 同意了你的好友申请`);
  });
  peers.on('frienddeny', (info) => {
    mainWindow?.webContents.send('friend:denied', info);
    notify('好友申请被拒绝', `${info.name} 拒绝了你的好友申请`);
  });
  peers.on('file', (p) => {
    mainWindow?.webContents.send('file:progress', p);
  });
  peers.on('secwarn', (w) => {
    mainWindow?.webContents.send('security:warn', w);
    notify('安全警告', `与 ${w.name} 的身份校验失败，连接已拒绝`);
  });

  // 先应用一次加密配置，保证后续入站/外连使用正确的强度与密钥
  peers.setCryptoConfig({
    strength: readSettings().encStrength,
    pskSeed: readSettings().encSecret,
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

import { ipcMain, dialog, BrowserWindow, shell, app, clipboard } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { uuidv4 } from './util';
import { PeerManager } from './secure/session';
import { APP_VERSION, type SendKeyMode } from './index';
import { getNetworkInfo } from './net-info';
import { getAmbientInfo } from './ambient';

export interface SettingsApi {
  isPortable: boolean;
  getSettings: () => {
    autoStart: boolean; minimizeToTray: boolean; appearance: any; sendKey: SendKeyMode; fullscreenTaskbar: boolean;
  };
  setSettings: (s: Partial<{
    autoStart: boolean; minimizeToTray: boolean; appearance: any; sendKey: SendKeyMode; fullscreenTaskbar: boolean;
  }>) => {
    autoStart: boolean; minimizeToTray: boolean; appearance: any; sendKey: SendKeyMode; fullscreenTaskbar: boolean;
  };
}

export function registerIpcHandlers(peers: PeerManager, settingsApi: SettingsApi): void {
  ipcMain.handle('get-self', () => peers.getSelfInfo());

  ipcMain.handle('get-runtime-info', () => ({
    version: APP_VERSION,
    isPortable: settingsApi.isPortable,
    settings: settingsApi.getSettings(),
  }));

  ipcMain.handle('get-settings', () => settingsApi.getSettings());

  // 本机网络信息（固定 IPv6 / 公网 IPv4 / 局域网 IPv4），结果在主进程缓存
  ipcMain.handle('get-network-info', () => getNetworkInfo());

  // 环境光 / 桌面背景采样（物理光影模拟使用）
  ipcMain.handle('get-ambient-info', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return getAmbientInfo(win);
  });

  // 复制到系统剪贴板（渲染层 navigator.clipboard 在 file:// 下不可靠）
  ipcMain.handle('copy-text', (_e, text: string) => {
    try {
      clipboard.writeText(String(text ?? ''));
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('set-settings', (_e, s: any) => settingsApi.setSettings(s || {}));

  ipcMain.handle('get-login-item', () => {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  });

  ipcMain.handle('get-contacts', () => peers.getContacts());

  // 手动连接（聊天页「连接」按钮）：忽略退避，立即握手
  ipcMain.handle('connect-peer', async (_e, id: string) => peers.connectNow(id));

  ipcMain.handle('add-friend', async (_e, host: string, port: number) => {
    try {
      const c = await peers.addFriend(host.trim(), Number(port) || 42815);
      return { success: true, contact: c };
    } catch (err: any) {
      return { success: false, error: '配对失败：' + err.message };
    }
  });

  ipcMain.handle('remove-friend', (_e, id: string) => {
    peers.removeFriend(id);
    return { success: true };
  });

  ipcMain.handle('rename-friend', (_e, id: string, name: string) => {
    peers.renameFriend(id, name);
    return { success: true };
  });

  ipcMain.handle('send-text', (_e, peerId: string, text: string) => {
    try {
      peers.sendText(peerId, text);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('send-file', async (_e, peerId: string, filePath: string) => {
    try {
      await peers.sendFile(peerId, filePath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('respond-offer', async (_e, id: string, accepted: boolean) => {
    await peers.respondOffer(id, accepted);
    return { success: true };
  });

  ipcMain.handle('mark-read', (_e, peerId: string) => {
    peers.markRead(peerId);
    return { success: true };
  });

  ipcMain.handle('get-history', (_e, peerId: string) => {
    return peers.getHistory(peerId);
  });

  ipcMain.handle('open-downloads', () => {
    shell.openPath(peers.getDownloadsDir());
    return { success: true };
  });

  ipcMain.handle('select-files', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('set-self-profile', (_e, name: string, avatar: string) => {
    peers.setSelfProfile(name || '', avatar || '');
    return { success: true };
  });

  ipcMain.handle('pick-avatar', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (r.canceled || !r.filePaths.length) return '';
    const buf = fs.readFileSync(r.filePaths[0]);
    return 'data:image/png;base64,' + buf.toString('base64');
  });

  ipcMain.handle('save-voice', async (_e, peerId: string, b64: string, name: string) => {
    try {
      const m = /^data:audio\/(\w+);base64,(.+)$/.exec(b64 || '');
      const ext = m ? m[1] : 'webm';
      const buf = Buffer.from(m ? m[2] : b64, 'base64');
      const fp = path.join(os.tmpdir(), `voice-${uuidv4()}.${ext}`);
      fs.writeFileSync(fp, buf);
      await peers.sendFile(peerId, fp);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

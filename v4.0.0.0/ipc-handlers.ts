import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { PeerManager } from './secure/session';

export function registerIpcHandlers(peers: PeerManager): void {
  ipcMain.handle('get-self', () => peers.getSelfInfo());

  ipcMain.handle('get-contacts', () => peers.getContacts());

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
}

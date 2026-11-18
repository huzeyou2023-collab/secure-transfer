import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  getSelf: () => ipcRenderer.invoke('get-self'),
  getContacts: () => ipcRenderer.invoke('get-contacts'),
  addFriend: (host: string, port: number, key?: string, strength?: number) => ipcRenderer.invoke('add-friend', host, port, key, strength),
  connectPeer: (id: string) => ipcRenderer.invoke('connect-peer', id),
  removeFriend: (id: string) => ipcRenderer.invoke('remove-friend', id),
  renameFriend: (id: string, name: string) => ipcRenderer.invoke('rename-friend', id, name),

  sendText: (peerId: string, text: string) => ipcRenderer.invoke('send-text', peerId, text),
  getHistory: (peerId: string) => ipcRenderer.invoke('get-history', peerId),
  markRead: (peerId: string) => ipcRenderer.invoke('mark-read', peerId),
  sendFile: (peerId: string, filePath: string) => ipcRenderer.invoke('send-file', peerId, filePath),
  getTransfers: () => ipcRenderer.invoke('get-transfers'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  // Electron 32+ 移除了 File.path，拖入文件需经 webUtils 取真实路径
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  setSelfProfile: (name: string, avatar: string) => ipcRenderer.invoke('set-self-profile', name, avatar),
  pickAvatar: () => ipcRenderer.invoke('pick-avatar'),
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  getAmbientInfo: () => ipcRenderer.invoke('get-ambient-info'),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s: any) => ipcRenderer.invoke('set-settings', s),
  getCryptoInfo: () => ipcRenderer.invoke('get-crypto-info'),
  setEncryption: (strength: number, password: string | null, oldPassword?: string) => ipcRenderer.invoke('set-encryption', strength, password, oldPassword),
  setContactEnc: (id: string, strength: number) => ipcRenderer.invoke('set-contact-enc', id, strength),
  getLoginItem: () => ipcRenderer.invoke('get-login-item'),
  saveVoice: (peerId: string, b64: string, name: string) => ipcRenderer.invoke('save-voice', peerId, b64, name),
  respondFriendRequest: (id: string, accepted: boolean) => ipcRenderer.invoke('respond-friend-request', id, accepted),
  openDownloads: () => ipcRenderer.invoke('open-downloads'),
  getCacheInfo: () => ipcRenderer.invoke('get-cache-info'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  // 运行时同步任务栏/窗口/托盘图标（底色=主题色、盾牌按明暗自适应）
  setAppIcon: (dataUrl: string) => ipcRenderer.invoke('set-app-icon', dataUrl),
  // 窗口控制键切换：mac 红绿灯 ↔ Windows 系统三键（主进程重建窗口）
  setWindowControls: (mode: 'mac' | 'win') => ipcRenderer.invoke('set-window-controls', mode),
  // 系统原生三键（titleBarOverlay）亮暗主题同步
  setTitlebarTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke('set-titlebar-theme', theme),
  // mac 模式自绘缩放手柄：开始 / 结束一次拖拽改大小
  windowResizeStart: (edge: string) => ipcRenderer.invoke('window-resize-start', edge),
  windowResizeEnd: () => ipcRenderer.invoke('window-resize-end'),
  // 模式切换「立即重启」：保存设置后真正重启应用（app.relaunch + exit）
  restartApp: () => ipcRenderer.invoke('app-restart'),

  onContacts: (cb: (list: any[]) => void) => {
    ipcRenderer.on('contacts:updated', (_e, list) => cb(list));
  },
  onChat: (cb: (msg: any) => void) => {
    ipcRenderer.on('chat:message', (_e, msg) => cb(msg));
  },
  onChatStatus: (cb: (s: any) => void) => {
    ipcRenderer.on('chat:status', (_e, s) => cb(s));
  },
  onFriendRequest: (cb: (req: any) => void) => {
    ipcRenderer.on('friend:request', (_e, req) => cb(req));
  },
  onFriendAccept: (cb: (info: any) => void) => {
    ipcRenderer.on('friend:accepted', (_e, info) => cb(info));
  },
  onFriendDeny: (cb: (info: any) => void) => {
    ipcRenderer.on('friend:denied', (_e, info) => cb(info));
  },
  onFileProgress: (cb: (p: any) => void) => {
    ipcRenderer.on('file:progress', (_e, p) => cb(p));
  },
  onSecWarn: (cb: (w: any) => void) => {
    ipcRenderer.on('security:warn', (_e, w) => cb(w));
  },
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
  windowAction: (action: 'close' | 'minimize' | 'maximize') => ipcRenderer.invoke('window-action', action),
  onWindowState: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('window:state', (_e, maximized: boolean) => cb(maximized));
  },
  onWindowTop: (cb: (top: boolean) => void) => {
    ipcRenderer.on('window:top', (_e, top: boolean) => cb(top));
  },
};

contextBridge.exposeInMainWorld('api', api);

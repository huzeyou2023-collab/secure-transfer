import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getSelf: () => ipcRenderer.invoke('get-self'),
  getContacts: () => ipcRenderer.invoke('get-contacts'),
  addFriend: (host: string, port: number, key?: string) => ipcRenderer.invoke('add-friend', host, port, key),
  connectPeer: (id: string) => ipcRenderer.invoke('connect-peer', id),
  removeFriend: (id: string) => ipcRenderer.invoke('remove-friend', id),
  renameFriend: (id: string, name: string) => ipcRenderer.invoke('rename-friend', id, name),

  sendText: (peerId: string, text: string) => ipcRenderer.invoke('send-text', peerId, text),
  getHistory: (peerId: string) => ipcRenderer.invoke('get-history', peerId),
  markRead: (peerId: string) => ipcRenderer.invoke('mark-read', peerId),
  sendFile: (peerId: string, filePath: string) => ipcRenderer.invoke('send-file', peerId, filePath),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  setSelfProfile: (name: string, avatar: string) => ipcRenderer.invoke('set-self-profile', name, avatar),
  pickAvatar: () => ipcRenderer.invoke('pick-avatar'),
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  getAmbientInfo: () => ipcRenderer.invoke('get-ambient-info'),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s: any) => ipcRenderer.invoke('set-settings', s),
  getCryptoInfo: () => ipcRenderer.invoke('get-crypto-info'),
  setEncryption: (strength: number, password: string | null) => ipcRenderer.invoke('set-encryption', strength, password),
  getLoginItem: () => ipcRenderer.invoke('get-login-item'),
  saveVoice: (peerId: string, b64: string, name: string) => ipcRenderer.invoke('save-voice', peerId, b64, name),
  respondOffer: (id: string, accepted: boolean) => ipcRenderer.invoke('respond-offer', id, accepted),
  openDownloads: () => ipcRenderer.invoke('open-downloads'),

  onContacts: (cb: (list: any[]) => void) => {
    ipcRenderer.on('contacts:updated', (_e, list) => cb(list));
  },
  onChat: (cb: (msg: any) => void) => {
    ipcRenderer.on('chat:message', (_e, msg) => cb(msg));
  },
  onChatStatus: (cb: (s: any) => void) => {
    ipcRenderer.on('chat:status', (_e, s) => cb(s));
  },
  onOffer: (cb: (offer: any) => void) => {
    ipcRenderer.on('file:offer', (_e, offer) => cb(offer));
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
};

contextBridge.exposeInMainWorld('api', api);

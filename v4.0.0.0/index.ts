import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getSelf: () => ipcRenderer.invoke('get-self'),
  getContacts: () => ipcRenderer.invoke('get-contacts'),
  addFriend: (host: string, port: number) => ipcRenderer.invoke('add-friend', host, port),
  removeFriend: (id: string) => ipcRenderer.invoke('remove-friend', id),
  renameFriend: (id: string, name: string) => ipcRenderer.invoke('rename-friend', id, name),

  sendText: (peerId: string, text: string) => ipcRenderer.invoke('send-text', peerId, text),
  getHistory: (peerId: string) => ipcRenderer.invoke('get-history', peerId),
  markRead: (peerId: string) => ipcRenderer.invoke('mark-read', peerId),
  sendFile: (peerId: string, filePath: string) => ipcRenderer.invoke('send-file', peerId, filePath),
  selectFiles: () => ipcRenderer.invoke('select-files'),
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
};

contextBridge.exposeInMainWorld('api', api);

export type SecureTransferAPI = typeof api;

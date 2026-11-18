export interface Contact {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  lan?: boolean;
  fp?: string;
}

export interface NetworkInfo {
  fixedIpv6: string;
  ipv6: string[];
  publicIpv4: string;
  localIpv4: string[];
  publicIpv4At: number;
}

export type MsgStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatMessage {
  id: string;
  peer: string;
  dir: 'in' | 'out';
  ts: number;
  text: string;
  status: MsgStatus;
  name?: string;
}

export interface FileOffer {
  id: string;
  peerId: string;
  peerName: string;
  name: string;
  size: number;
}

export interface FileProgress {
  id: string;
  name: string;
  percent: number;
  bytes: number;
  size: number;
  direction: 'in' | 'out';
  status: 'waiting' | 'transferring' | 'done' | 'failed' | 'rejected';
  error?: string;
  peerName?: string;
  savePath?: string;
}

declare global {
  interface Window {
    api: {
      getSelf(): Promise<{ id: string; name: string }>;
      getContacts(): Promise<Contact[]>;
      addFriend(host: string, port: number): Promise<{ success: boolean; error?: string; contact?: Contact }>;
      removeFriend(id: string): Promise<any>;
      renameFriend(id: string, name: string): Promise<any>;
      sendText(peerId: string, text: string): Promise<any>;
      getHistory(peerId: string): Promise<ChatMessage[]>;
      markRead(peerId: string): Promise<any>;
      sendFile(peerId: string, filePath: string): Promise<any>;
      selectFiles(): Promise<string[]>;
      respondOffer(id: string, accepted: boolean): Promise<any>;
      openDownloads(): Promise<any>;
      onContacts(cb: (list: Contact[]) => void): void;
      onChat(cb: (msg: ChatMessage) => void): void;
      onChatStatus(cb: (s: { peer: string; id: string; status: MsgStatus }) => void): void;
      onOffer(cb: (offer: FileOffer) => void): void;
      onFileProgress(cb: (p: FileProgress) => void): void;
      onSecWarn(cb: (w: any) => void): void;
      removeAllListeners(channel: string): void;
      windowAction(action: 'close' | 'minimize' | 'maximize'): Promise<{ success: boolean }>;
      onWindowState(cb: (maximized: boolean) => void): void;
      getRuntimeInfo(): Promise<any>;
      getNetworkInfo(): Promise<NetworkInfo>;
      copyText(text: string): Promise<{ success: boolean }>;
      getLoginItem(): Promise<boolean>;
      getSettings(): Promise<any>;
      setSettings(s: any): Promise<any>;
      setSelfProfile(name: string, avatar: string): Promise<any>;
      pickAvatar(): Promise<string>;
    };
  }
}

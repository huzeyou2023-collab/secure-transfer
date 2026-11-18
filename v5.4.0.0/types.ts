export interface Contact {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  /** 正在建立连接（界面显示“连接中…”） */
  connecting?: boolean;
  lan?: boolean;
  fp?: string;
  /** 该好友是否单独设置了自定义密钥 */
  hasCustomKey?: boolean;
  /** 当前会话实际使用的加密强度（位） */
  strength?: EncryptionStrength;
}

/** 加密强度（位）：64 兼容通道；128/192/256 单层 AES-NI；512/1024 多段 256 位级联 */
export type EncryptionStrength = 64 | 128 | 192 | 256 | 512 | 1024;

export const ENCRYPTION_STRENGTHS: EncryptionStrength[] = [64, 128, 192, 256, 512, 1024];
export const DEFAULT_ENCRYPTION_STRENGTH: EncryptionStrength = 256;

export interface NetworkInfo {
  fixedIpv6: string;
  ipv6: string[];
  publicIpv4: string;
  localIpv4: string[];
  publicIpv4At: number;
}

/** 环境光 / 桌面背景采样 */
export interface AmbientInfo {
  color: string;
  brightness: number;
  lux: number;
  hasSensor: boolean;
  updatedAt: number;
}

/** 回车键行为：enter = Enter 发送 / Shift+Enter 换行；shift-enter = 相反 */
export type SendKeyMode = 'enter' | 'shift-enter';

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

/** 好友申请（申请列表项） */
export interface FriendRequest {
  id: string;
  name: string;
  host: string;
  port: number;
}

declare global {
  interface Window {
    api: {
      getSelf(): Promise<{ id: string; name: string }>;
      getContacts(): Promise<Contact[]>;
      addFriend(host: string, port: number, key?: string): Promise<{ success: boolean; error?: string; pending?: boolean }>;
      connectPeer(id: string): Promise<{ success: boolean; error?: string }>;
      removeFriend(id: string): Promise<any>;
      renameFriend(id: string, name: string): Promise<any>;
      sendText(peerId: string, text: string): Promise<any>;
      getHistory(peerId: string): Promise<ChatMessage[]>;
      markRead(peerId: string): Promise<any>;
      sendFile(peerId: string, filePath: string): Promise<any>;
      selectFiles(): Promise<string[]>;
      respondFriendRequest(id: string, accepted: boolean): Promise<any>;
      openDownloads(): Promise<any>;
      getCacheInfo(): Promise<{ path: string; size: number }>;
      clearCache(): Promise<{ success: boolean; path?: string; size?: number; error?: string }>;
      onContacts(cb: (list: Contact[]) => void): void;
      onChat(cb: (msg: ChatMessage) => void): void;
      onChatStatus(cb: (s: { peer: string; id: string; status: MsgStatus }) => void): void;
      onFriendRequest(cb: (req: FriendRequest) => void): void;
      onFriendAccept(cb: (info: { id: string; name: string }) => void): void;
      onFriendDeny(cb: (info: { id: string; name: string }) => void): void;
      onFileProgress(cb: (p: FileProgress) => void): void;
      onSecWarn(cb: (w: any) => void): void;
      removeAllListeners(channel: string): void;
      windowAction(action: 'close' | 'minimize' | 'maximize' | 'toggle-always-on-top'): Promise<{ success: boolean; alwaysOnTop?: boolean }>;
      setIgnoreMouse(ignore: boolean): Promise<{ success: boolean }>;
      onWindowState(cb: (maximized: boolean) => void): void;
      getRuntimeInfo(): Promise<any>;
      getNetworkInfo(): Promise<NetworkInfo>;
      getAmbientInfo(): Promise<AmbientInfo>;
      copyText(text: string): Promise<{ success: boolean }>;
      getLoginItem(): Promise<boolean>;
      getSettings(): Promise<any>;
      setSettings(s: any): Promise<any>;
      getCryptoInfo(): Promise<{ strength: EncryptionStrength; hasCustomKey: boolean }>;
      setEncryption(strength: EncryptionStrength, password: string | null): Promise<{ success: boolean; error?: string; settings?: any }>;
      setSelfProfile(name: string, avatar: string): Promise<any>;
      pickAvatar(): Promise<string>;
    };
  }
}

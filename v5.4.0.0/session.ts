/**
 * 会话管理器：
 *  - IPv4/IPv6 双栈监听 + 主动外连（联系人），心跳保活、自动重连、幂等去重
 *  - 文字：豪密层 → AES-256-GCM 通道；离线暂存、重连自动重投、送达/已读回执、去重
 *  - 文件：分块流式、窗口控速、SHA-256 校验、断线/重启后断点续传
 */
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { EventEmitter } from 'events';
import { uuidv4, cryptSecret, decryptSecret } from '../util';
import { Store } from './store';
import {
  SecureChannel, clientHandshake, serverHandshake,
  IdentityKey, WireMessage,
} from './channel';
import { createBook, haomiEncipher, haomiDecipher, HaoMiBook } from './haomi';
import {
  DEFAULT_STRENGTH,
  Strength,
  normalizeStrength,
  pskMaterial,
  pskSeedFromPassword,
} from './keys';
import { DiscoveryService } from '../discovery/discovery-service';
import { Peer } from '../discovery/types';

const DEFAULT_PORT = 42815;
const PING_INTERVAL = 15_000;
const DEAD_TIMEOUT = 45_000;
const CHUNK = 64 * 1024;
const ACK_EVERY = 256 * 1024;
const WINDOW = 2 * 1024 * 1024;
const SEEN_CAP = 2000;

export interface Contact {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  /** 正在尝试建立连接（界面显示“连接中…”） */
  connecting?: boolean;
  lan?: boolean;
  fp?: string;
  /** 该好友是否单独设置了自定义密钥 */
  hasCustomKey?: boolean;
  /** 当前会话实际使用的加密强度（在线时才有） */
  strength?: Strength;
}

interface ChatMsg {
  id: string;
  peer: string;
  dir: 'in' | 'out';
  ts: number;
  text: string;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
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

interface ContactRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  fp: string;
  /** 该好友的固定密钥种子（PBKDF2 结果 base64）；缺省 = 使用全局密钥/默认密钥 */
  pskSeed?: string;
}

interface OutboxEntry {
  id: string;
  peer: string;
  ts: number;
  text: string;
  name: string;
}

interface TransferRecord {
  id: string;
  peer: string;
  path: string;
  name: string;
  size: number;
  sent: number;
}

interface Conn {
  id: string;
  name: string;
  channel: SecureChannel;
  role: 'client' | 'server';
  book: HaoMiBook;
  strength: Strength;
  lastActive: number;
  timers: ReturnType<typeof setInterval>[];
  /** 对端可达地址（client 侧为发起时填写，server 侧为实际来源 IP） */
  host: string;
  port: number;
  fp: string;
}

interface RecvState {
  name: string;
  size: number;
  received: number;
  partPath: string;
  fd: number | null;
  hash: crypto.Hash;
  lastAck: number;
}

function fingerprint(pubB64: string): string {
  return crypto.createHash('sha256').update(pubB64).digest('hex').slice(0, 16);
}

function localIps(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const a of iface) {
      if (!a.internal && !a.address.startsWith('169.254')) out.push(a.address);
    }
  }
  return out;
}

export class PeerManager extends EventEmitter {
  private store: Store;
  private identity: IdentityKey;
  private discovery: DiscoveryService;
  private self: { id: string; name: string };
  private server: net.Server | null = null;
  private listenPort = DEFAULT_PORT;

  private contacts: ContactRecord[] = [];
  private conns = new Map<string, Conn>();
  private backoff = new Map<string, number>();
  private recv = new Map<string, RecvState>();
  private seen: string[] = [];
  private outbox: OutboxEntry[] = [];
  private transfers: TransferRecord[] = [];
  private lanPeers: Peer[] = [];
  private started = false;
  private pendingDial = new Map<string, ReturnType<typeof setTimeout>>();
  /** 正在尝试连接的 peer（用于界面显示“连接中…”） */
  private dialing = new Set<string>();
  /** 最近一次拨号时间（“连接中…”状态在拨号结束后再保留一小段时间，避免界面闪烁） */
  private lastDialAttempt = new Map<string, number>();
  /** 当前加密配置：强度 + 全局自定义密钥材料（null = 默认 ECDH 派生） */
  private cryptoConfig: { strength: Strength; psk: Buffer | null } = { strength: DEFAULT_STRENGTH, psk: null };

  constructor(store: Store, discovery: DiscoveryService) {
    super();
    this.store = store;
    this.discovery = discovery;
    this.identity = store.getIdentity();
    this.self = { id: discovery.selfId, name: discovery.selfName };
    this.contacts = store
      .readJson<ContactRecord[]>('contacts.json', [])
      .filter((c) => c.id !== this.self.id)
      .map((c) => (c.pskSeed ? { ...c, pskSeed: decryptSecret(c.pskSeed) } : c));
    this.seen = store.readJson<string[]>('seen.json', []);
    this.outbox = store.readJson<OutboxEntry[]>('outbox.json', []);
    this.transfers = store.readJson<TransferRecord[]>('transfers.json', []);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.listen();
    this.discovery.on('peers', (peers) => this.onLanPeers(peers));
    this.discovery.publish(this.listenPort);
    this.discovery.start();
    const dial = setInterval(() => this.dialLoop(), 3000);
    const presence = setInterval(() => this.presenceSweep(), 2000);
    presence.unref?.();
    dial.unref?.();
    const watchdog = setInterval(() => this.watchdog(), 10_000);
    watchdog.unref?.();
  }

  getSelfInfo(): { id: string; name: string; ips: string[]; avatar: string } {
    const prof = this.store.readJson<{ name?: string; avatar?: string }>('profile.json', {});
    if (prof.name) this.self.name = prof.name;
    return { id: this.self.id, name: this.self.name, ips: localIps(), avatar: prof.avatar || '' };
  }

  setSelfProfile(name: string, avatar: string): void {
    if (name.trim()) this.self.name = name.trim();
    this.store.writeJson('profile.json', { name: this.self.name, avatar });
  }

  shutdown(): void {
    for (const conn of this.conns.values()) {
      conn.timers.forEach(clearInterval);
      conn.channel.destroy();
    }
    this.conns.clear();
    this.server?.close();
    this.server = null;
  }

  // ── 联系人 ─────────────────────────────────────────────────────
  getContacts(): Contact[] {
    const now = Date.now();
    const connectingOf = (id: string): boolean =>
      !this.conns.has(id) && (this.dialing.has(id) || now - (this.lastDialAttempt.get(id) || 0) < 2500);
    const out: Contact[] = this.contacts.map((c) => ({
      ...c,
      online: this.conns.has(c.id),
      connecting: connectingOf(c.id),
      hasCustomKey: !!c.pskSeed,
      strength: this.conns.get(c.id)?.strength,
    }));
    const friendIds = new Set(this.contacts.map((c) => c.id));
    for (const p of this.lanPeers) {
      if (!friendIds.has(p.id)) {
        out.push({
          ...p,
          online: this.conns.has(p.id),
          connecting: connectingOf(p.id),
          lan: true,
        });
      }
    }
    return out.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  private emitContacts(): void {
    this.emit('contacts', this.getContacts());
  }

  /** 添加好友：先加密握手，非好友则发送好友申请，对方同意后双方才互为好友（未经同意无法互传任何数据） */
  async addFriend(host: string, port: number, key?: string): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
    const strength = this.cryptoConfig.strength;
    // 添加好友时填写的密钥：只存 PBKDF2 种子，不存明文；留空则沿用全局密钥（可能为空 = 默认 ECDH）
    const keySeed = key && key.trim() ? pskSeedFromPassword(key.trim()) : null;
    const psk = keySeed ? pskMaterial(keySeed, strength) : this.cryptoConfig.psk;
    const socket = net.createConnection({ host, port });
    socket.setTimeout(8000);
    const r = await clientHandshake(
      socket, this.identity, { ...this.self, port: this.listenPort }, { strength, psk },
    );
    socket.setTimeout(0);
    const fp = fingerprint(r.peerStaticPub);
    const existing = this.contacts.find((c) => c.id === r.peer.id);
    if (existing) {
      // 已是好友：更新地址直接连接
      existing.host = host;
      existing.port = port;
      existing.name = r.peer.name;
      existing.fp = fp;
      existing.pskSeed = keySeed ? keySeed.toString('base64') : undefined;
      this.saveContacts();
      this.attach(r.channel, r.peer, 'client', r.book!, fp, r.strength, { host, port });
      return { ok: true };
    }
    // 非好友：建立通道并发送好友申请，等待对方同意
    this.attach(r.channel, r.peer, 'client', r.book!, fp, r.strength, { host, port });
    this.sendFriendRequest(r.peer.id);
    return { ok: true, pending: true };
  }

  /** 通过已有连接向对端发送好友申请（对方尚未同意前连接处于“申请中”状态） */
  private sendFriendRequest(peerId: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    conn.channel.send({ json: { t: 'FREQ' } });
    // 30 秒无响应自动断开，避免空挂连接
    const timer = setTimeout(() => {
      const c = this.conns.get(conn.id);
      if (c === conn && !this.contacts.find((x) => x.id === conn.id)) {
        c.channel.destroy();
        this.emit('frienddeny', { id: conn.id, name: conn.name });
      }
    }, 30_000);
    timer.unref?.();
    conn.timers.push(timer);
  }

  /** 处理收到的好友申请：同意后互加好友；拒绝则断开连接 */
  respondFriendRequest(id: string, accept: boolean): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    if (!accept) {
      try { conn.channel.send({ json: { t: 'FDEN' } }); } catch {}
      conn.channel.destroy();
      this.conns.delete(id);
      return;
    }
    if (!this.contacts.find((c) => c.id === id)) {
      this.contacts.push({
        id: conn.id, name: conn.name, host: conn.host || '', port: conn.port || 0, fp: conn.fp || '',
      });
      this.saveContacts();
    }
    try { conn.channel.send({ json: { t: 'FACC' } }); } catch {}
    this.emitContacts();
  }

  private onFriendRequest(conn: Conn): void {
    // 已是好友则直接确认（双方状态同步）
    if (this.contacts.find((c) => c.id === conn.id)) {
      try { conn.channel.send({ json: { t: 'FACC' } }); } catch {}
      return;
    }
    this.emit('friendreq', { id: conn.id, name: conn.name, host: conn.host || '', port: conn.port || 0 });
  }

  private onFriendAccept(conn: Conn): void {
    if (!this.contacts.find((c) => c.id === conn.id)) {
      this.contacts.push({
        id: conn.id, name: conn.name, host: conn.host || '', port: conn.port || 0, fp: conn.fp || '',
      });
      this.saveContacts();
    }
    this.emit('friendaccept', { id: conn.id, name: conn.name });
    this.emitContacts();
  }

  private onFriendDeny(conn: Conn): void {
    this.emit('frienddeny', { id: conn.id, name: conn.name });
    try { conn.channel.destroy(); } catch {}
    this.conns.delete(conn.id);
  }

  /** 设置当前加密配置（强度 + 全局自定义密钥种子），由主进程在启动与设置变更时调用 */
  setCryptoConfig(cfg: { strength: Strength; pskSeed?: string }): void {
    const strength = normalizeStrength(cfg.strength);
    this.cryptoConfig = {
      strength,
      psk: cfg.pskSeed ? pskMaterial(Buffer.from(cfg.pskSeed, 'base64'), strength) : null,
    };
  }

  /** 供界面显示：当前强度与是否启用自定义密钥 */
  getCryptoInfo(): { strength: Strength; hasCustomKey: boolean } {
    return { strength: this.cryptoConfig.strength, hasCustomKey: !!this.cryptoConfig.psk };
  }

  /** 某个好友应使用的密钥：好友单独设置的优先，否则用全局密钥 */
  private pskForContact(contact?: ContactRecord): Buffer | null {
    if (contact?.pskSeed) {
      try {
        return pskMaterial(Buffer.from(contact.pskSeed, 'base64'), this.cryptoConfig.strength);
      } catch { /* 坏数据回退全局 */ }
    }
    return this.cryptoConfig.psk;
  }

  /** 入站连接按握手携带的对方 ID 选择密钥 */
  private pskForPeerId(peerId: string): Buffer | null {
    return this.pskForContact(this.contacts.find((c) => c.id === peerId));
  }

  removeFriend(id: string): void {
    this.contacts = this.contacts.filter((c) => c.id !== id);
    this.saveContacts();
    const conn = this.conns.get(id);
    if (conn) {
      conn.channel.destroy();
      this.conns.delete(id);
    }
    this.emitContacts();
  }

  renameFriend(id: string, name: string): void {
    const c = this.contacts.find((x) => x.id === id);
    if (c && name.trim()) {
      c.name = name.trim();
      this.saveContacts();
      this.emitContacts();
    }
  }

  private saveContacts(): void {
    this.store.writeJson('contacts.json', this.contacts.map((c) => (c.pskSeed ? { ...c, pskSeed: cryptSecret(c.pskSeed) } : c)));
  }

  // ── 监听 ───────────────────────────────────────────────────────
  private listen(): void {
    let port = Number(process.env.SECURE_TRANSFER_PORT) || DEFAULT_PORT;
    const tryPort = () => {
      const srv = net.createServer((sock) => this.onInbound(sock));
      srv.on('error', () => {
        port += 1; // 同机多实例：端口占用自动递增
        tryPort();
      });
      srv.listen(port, '::', () => {
        this.server = srv;
        this.listenPort = (srv.address() as net.AddressInfo).port;
        this.discovery.publish(this.listenPort);
      });
    };
    tryPort();
  }

  private async onInbound(socket: net.Socket): Promise<void> {
    try {
      const book = createBook();
      const r = await serverHandshake(
        socket, this.identity, { ...this.self, port: this.listenPort }, book,
        { strength: this.cryptoConfig.strength, psk: null },
        (peerId) => this.pskForPeerId(peerId),
      );
      this.attach(r.channel, r.peer, 'server', book, fingerprint(r.peerStaticPub), r.strength);
    } catch (e) {
      console.error('入站握手失败:', (e as Error).message);
      try { socket.destroy(); } catch {}
    }
  }

  // ── 外连与重连 ─────────────────────────────────────────────────
  /** 本机地址统一走回环（同机多实例 / 本机局域网地址，才能绕过防火墙） */
  private resolveHost(host: string): string {
    if (!host) return '';
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return host;
    const local = localIps();
    return local.includes(host) ? '127.0.0.1' : host;
  }

  /** 单次拨号：拨号循环、手动「连接」、发现到局域网设备后即时连接都复用它 */
  private async dialPeer(id: string, host: string, port: number): Promise<boolean> {
    if (id === this.self.id) return false;
    const contact = this.contacts.find((c) => c.id === id);
    const wasDialing = this.dialing.has(id);
    this.dialing.add(id);
    this.lastDialAttempt.set(id, Date.now());
    if (!wasDialing) this.emitContacts();
    const socket = net.createConnection({ host, port });
    socket.setTimeout(6000);
    try {
      const r = await clientHandshake(
        socket, this.identity, { ...this.self, port: this.listenPort },
        { strength: this.cryptoConfig.strength, psk: this.pskForContact(contact) },
      );
      socket.setTimeout(0);
      const fp = fingerprint(r.peerStaticPub);
      if (contact?.fp && fp !== contact.fp) {
        r.channel.destroy();
        this.emit('secwarn', { id, name: contact.name });
        return false;
      }
      this.attach(r.channel, r.peer, 'client', r.book!, fp, r.strength, { host, port });
      this.backoff.set(id, 0);
      return true;
    } catch (e) {
      try { socket.destroy(); } catch {}
      throw e;
    } finally {
      this.dialing.delete(id);
      this.emitContacts();
    }
  }

  /** 手动连接（聊天页「连接」按钮） */
  async connectNow(peerId: string): Promise<{ success: boolean; pending?: boolean; error?: string }> {
    if (peerId === this.self.id) return { success: false, error: '不能连接本机自己' };
    if (this.conns.has(peerId)) return { success: true };
    if (this.dialing.has(peerId)) return { success: false, error: '正在连接，请稍候' };
    const contact = this.contacts.find((c) => c.id === peerId);
    const lan = this.lanPeers.find((p) => p.id === peerId);
    const host = this.resolveHost(contact?.host || lan?.host || '');
    const port = contact?.port || lan?.port || 0;
    if (!host || !port) return { success: false, error: '还没有对方的网络地址，请让对方先向你发起一次连接' };
    this.backoff.set(peerId, 0);
    try {
      const ok = await this.dialPeer(peerId, host, port);
      if (ok && !contact) {
        // 局域网设备：建立通道后发送好友申请，对方同意后才互加好友
        this.sendFriendRequest(peerId);
        this.emitContacts();
        return { success: true, pending: true };
      }
      this.emitContacts();
      return ok ? { success: true } : { success: false, error: '连接失败，对方可能不在线' };
    } catch {
      this.backoff.set(peerId, 2000);
      return { success: false, error: '连接失败，请检查网络后重试' };
    }
  }

  /** 局域网发现到设备后 600ms 内立即拨号（上线监测：好友一上线就直连）；未加好友的设备不自动连接 */
  private scheduleDial(id: string, host: string, port: number): void {
    if (id === this.self.id) return;
    if (this.conns.has(id) || !host || !port) return;
    if (!this.contacts.find((c) => c.id === id)) return;
    const old = this.pendingDial.get(id);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.pendingDial.delete(id);
      if (this.conns.has(id)) return;
      const h = this.resolveHost(host);
      if (!h || !port) return;
      this.dialPeer(id, h, port)
        .then((ok) => { if (ok) this.emitContacts(); })
        .catch(() => { this.backoff.set(id, 2000); });
    }, 600);
    timer.unref?.();
    this.pendingDial.set(id, timer);
  }

  /** 局域网在线监测：每 2 秒对已发现且已是好友的设备发起一次快速拨号 */
  private presenceSweep(): void {
    for (const p of this.lanPeers) {
      if (p.id === this.self.id || this.conns.has(p.id)) continue;
      if (!this.contacts.find((c) => c.id === p.id)) continue;
      this.scheduleDial(p.id, p.host, p.port);
    }
  }

  private async dialLoop(): Promise<void> {
    // 只对已同意的好友自动重连；局域网陌生设备需手动发起好友申请
    const targets = this.contacts.map((c) => ({ id: c.id, host: c.host, port: c.port, isLan: false }));
    for (const t of targets) {
      if (t.id === this.self.id || this.conns.has(t.id)) continue;
      const delay = this.backoff.get(t.id) ?? 0;
      if (delay > 0) {
        this.backoff.set(t.id, Math.min(delay * 2, 5000));
        continue;
      }
      this.backoff.set(t.id, t.isLan ? 2000 : 3000);
      const host = this.resolveHost(t.host);
      if (!host || !t.port) continue;
      try {
        await this.dialPeer(t.id, host, t.port);
      } catch {
        // 静默等待下次退避重连
      }
    }
  }

  // ── 连接注册 / 去重 / 心跳 ─────────────────────────────────────
  private attach(
    channel: SecureChannel,
    peer: { id: string; name: string; port?: number },
    role: 'client' | 'server',
    book: HaoMiBook,
    fp: string,
    strength: Strength,
    extra?: { host?: string; port?: number },
  ): void {
    // 防御：同机自连接（历史遗留的好友记录等）直接拒绝，避免自连风暴
    if (peer.id === this.self.id) {
      channel.destroy();
      return;
    }
    const old = this.conns.get(peer.id);
    // 双向同时连接去重：ID 较大方保留“服务端”连接，ID 较小方保留“客户端”连接。
    // 无旧连接时先接受，偏好角色的连接到达后再替换。
    const keepThis = role === 'server'
      ? this.self.id > peer.id
      : this.self.id < peer.id;
    if (old && !keepThis) {
      channel.destroy();
      return;
    }
    if (old && keepThis) {
      old.channel.destroy();
      this.conns.delete(peer.id);
    }

    // 已知好友：server 侧用实际来源地址回填（双方都能主动重连）
    const contact = this.contacts.find((c) => c.id === peer.id);
    if (contact) {
      if (role === 'server' && channel.remoteHost) {
        contact.host = channel.remoteHost;
        contact.port = peer.port || contact.port;
        contact.fp = fp;
        contact.name = contact.name || peer.name;
        this.saveContacts();
      }
    }
    // 非好友不自动持久化：必须先通过好友申请同意（否则任何人连上来都会自动变成好友）

    const conn: Conn = {
      id: peer.id,
      name: peer.name,
      channel,
      role,
      book,
      strength,
      lastActive: Date.now(),
      timers: [],
      host: role === 'client' ? (extra?.host || '') : (channel.remoteHost || ''),
      port: role === 'client' ? (extra?.port || peer.port || 0) : (peer.port || 0),
      fp,
    };
    this.conns.set(peer.id, conn);
    this.backoff.set(peer.id, 0);
    this.store.log('info', `连接建立 ${role === 'client' ? '→' : '←'} ${peer.name || peer.id} (${conn.host || channel.remoteHost || '未知地址'})`);

    channel.on('message', (m: WireMessage) => {
      conn.lastActive = Date.now();
      this.onMessage(conn, m).catch((e) => console.error('消息处理失败:', e));
    });
    // 只处理“自己”的关闭事件：双向同时建连去重时，旧连接迟到的 close 不能误删新连接
    channel.on('close', () => {
      if (this.conns.get(conn.id) === conn) this.onConnClose(conn.id);
    });
    channel.on('error', (e) => console.error('通道错误:', e.message));

    const ping = setInterval(() => {
      if (channel.isClosed) return;
      try {
        channel.send({ json: { t: 'PING' } });
      } catch {}
    }, PING_INTERVAL);
    ping.unref?.();
    conn.timers.push(ping);

    this.emitContacts();
    this.onSessionReady(conn).catch((e) => console.error('会话恢复失败:', e));
  }

  private onConnClose(id: string): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    conn.timers.forEach(clearInterval);
    this.conns.delete(id);
    this.backoff.set(id, 0);
    this.store.log('warn', `连接断开 ${conn.name || id}`);
    // 断线后立即安排一次快速重连（对方重新上线可秒连）
    const c = this.contacts.find((x) => x.id === id);
    if (c) this.scheduleDial(c.id, c.host, c.port);
    // 中断的接收分片保留，等待重连续传
    this.emitContacts();
  }

  private watchdog(): void {
    const now = Date.now();
    for (const conn of this.conns.values()) {
      if (now - conn.lastActive > DEAD_TIMEOUT) {
        conn.channel.destroy();
      }
    }
  }

  private onLanPeers(peers: Peer[]): void {
    this.lanPeers = peers;
    // 已加好友：发现更可靠的地址则更新；未连接则立即拨号（上线监测）。未加好友的设备只展示、不自动连接
    for (const p of peers) {
      const c = this.contacts.find((x) => x.id === p.id);
      if (c && (c.host !== p.host || c.port !== p.port)) {
        c.host = p.host;
        c.port = p.port;
        this.saveContacts();
      }
      if (c && !this.conns.has(p.id)) this.scheduleDial(p.id, p.host, p.port);
    }
    this.emitContacts();
  }

  // ── 会话就绪：重投文字 / 续传文件 ─────────────────────────────
  private async onSessionReady(conn: Conn): Promise<void> {
    const pendingText = this.outbox.filter((o) => o.peer === conn.id);
    for (const o of pendingText) {
      try {
        conn.channel.send({ json: { t: 'TEXT', id: o.id, ts: o.ts, name: o.name, text: haomiEncipher(o.text, conn.book) } });
        this.updateOutHistory(conn.id, o.id, 'sent');
      } catch {}
    }
    // 断点续传：未发完的重发数据；数据已全部发出但完成通知（FDONE）没送达的补发通知
    for (const tr of this.transfers.filter((t) => t.peer === conn.id)) {
      this.resumeTransfer(conn, tr).catch((e) => console.error('续传失败:', e));
    }
  }

  // ── 消息分发 ───────────────────────────────────────────────────
  private async onMessage(conn: Conn, m: WireMessage): Promise<void> {
    const body: any = 'json' in m ? m.json : m.header;
    switch (body.t) {
      case 'PING':
        conn.channel.send({ json: { t: 'PONG' } });
        return;
      case 'PONG':
        return;
      case 'TEXT':
        this.onText(conn, body);
        return;
      case 'TACK':
        this.updateOutHistory(conn.id, body.id, 'delivered');
        this.removeOutbox(body.id);
        return;
      case 'TREAD':
        this.updateOutHistory(conn.id, body.id, 'read');
        return;
      case 'FOFFER':
        await this.onFileOffer(conn, body);
        return;
      case 'FREQ':
        this.onFriendRequest(conn);
        return;
      case 'FACC':
        this.onFriendAccept(conn);
        return;
      case 'FDEN':
        this.onFriendDeny(conn);
        return;
      case 'FACCEPT':
        // streamOut 内的监听器负责消费续传起点
        return;
      case 'FREJECT':
        this.failTransfer(body.id, '对方拒绝接收');
        return;
      case 'FDATA':
        this.onFileData(conn, body, (m as any).data as Buffer);
        return;
      case 'FACK':
        this.onFileAck(conn, body);
        return;
      case 'FDONE':
        await this.onFileDone(conn, body);
        return;
    }
  }

  // ── 文字 ───────────────────────────────────────────────────────
  private historyFile(peerId: string): string {
    return 'history/' + peerId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  }

  private loadHistory(peerId: string): ChatMsg[] {
    return this.store.readJson<ChatMsg[]>(this.historyFile(peerId), []);
  }

  private saveHistory(peerId: string, list: ChatMsg[]): void {
    this.store.writeJson(this.historyFile(peerId), list);
  }

  getHistory(peerId: string): ChatMsg[] {
    return this.loadHistory(peerId);
  }

  private pushHistory(peerId: string, msg: ChatMsg): void {
    const list = this.loadHistory(peerId);
    const idx = list.findIndex((x) => x.id === msg.id);
    if (idx >= 0) list[idx] = msg;
    else list.push(msg);
    this.saveHistory(peerId, list);
  }

  private updateOutHistory(peerId: string, id: string, status: ChatMsg['status']): void {
    const list = this.loadHistory(peerId);
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx].status = status;
      this.saveHistory(peerId, list);
      this.emit('chat-status', { peer: peerId, id, status });
    }
  }

  private removeOutbox(id: string): void {
    const n = this.outbox.filter((o) => o.id !== id);
    if (n.length !== this.outbox.length) {
      this.outbox = n;
      this.store.writeJson('outbox.json', this.outbox);
    }
  }

  sendText(peerId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // 非好友（申请未通过）不能发消息
    if (!this.contacts.find((c) => c.id === peerId)) return;
    const id = uuidv4();
    const ts = Date.now();
    const msg: ChatMsg = {
      id, peer: peerId, dir: 'out', ts, text: trimmed,
      status: this.conns.has(peerId) ? 'sending' : 'failed',
      name: this.self.name,
    };
    this.pushHistory(peerId, msg);
    this.emit('chat', msg);

    // 离线也暂存，上线后自动重投；同时给出失败提示
    this.outbox.push({ id, peer: peerId, ts, text: trimmed, name: this.self.name });
    this.store.writeJson('outbox.json', this.outbox);

    const conn = this.conns.get(peerId);
    if (!conn) {
      this.emit('chat-status', { peer: peerId, id, status: 'failed' });
      return;
    }
    try {
      conn.channel.send({
        json: { t: 'TEXT', id, ts, name: this.self.name, text: haomiEncipher(trimmed, conn.book) },
      });
      this.updateOutHistory(peerId, id, 'sent');
    } catch {
      this.emit('chat-status', { peer: peerId, id, status: 'failed' });
    }
  }

  private onText(conn: Conn, body: { id: string; ts: number; name: string; text: string }): void {
    // 非好友（申请未通过）的消息一律丢弃，避免陌生内容进入聊天记录
    if (!this.contacts.find((c) => c.id === conn.id)) return;
    conn.channel.send({ json: { t: 'TACK', id: body.id } });
    if (this.seen.includes(body.id)) return;
    this.seen.push(body.id);
    if (this.seen.length > SEEN_CAP) this.seen = this.seen.slice(-SEEN_CAP);
    this.store.writeJson('seen.json', this.seen);

    let text: string;
    try {
      text = haomiDecipher(body.text, conn.book);
    } catch {
      this.emit('secwarn', { id: conn.id, name: conn.name });
      return;
    }
    const msg: ChatMsg = {
      id: body.id, peer: conn.id, dir: 'in', ts: body.ts, text,
      status: 'delivered', name: body.name || conn.name,
    };
    this.pushHistory(conn.id, msg);
    this.emit('chat', msg);
  }

  markRead(peerId: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    const list = this.loadHistory(peerId);
    for (const m of list) {
      if (m.dir === 'in' && m.status !== 'read') {
        m.status = 'read';
        try { conn.channel.send({ json: { t: 'TREAD', id: m.id } }); } catch {}
      }
    }
    this.saveHistory(peerId, list);
  }

  // ── 文件：发送 ─────────────────────────────────────────────────
  private emitFile(p: FileProgress): void {
    this.emit('file', p);
  }

  async sendFile(peerId: string, filePath: string): Promise<void> {
    // 非好友（申请未通过）不能发文件
    if (!this.contacts.find((c) => c.id === peerId)) {
      this.emitFile({
        id: uuidv4(), name: path.basename(filePath), percent: 0, bytes: 0, size: 0,
        direction: 'out', status: 'failed', error: '对方还不是好友，请先通过好友申请', peerName: peerId,
      });
      return;
    }
    const conn = this.conns.get(peerId);
    if (!conn) {
      this.emitFile({
        id: uuidv4(), name: path.basename(filePath), percent: 0, bytes: 0, size: 0,
        direction: 'out', status: 'failed', error: '对方不在线，文件未发送', peerName: peerId,
      });
      return;
    }
    let localPath = filePath;
    let displayName = path.basename(filePath);
    if (/^https?:\/\//i.test(filePath)) {
      const r = await fetch(filePath);
      if (!r.ok || !r.body) throw new Error('云端文件下载失败: HTTP ' + r.status);
      displayName = path.basename(new URL(filePath).pathname) || 'download';
      localPath = path.join(os.tmpdir(), 'st-' + uuidv4() + '-' + displayName);
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(localPath);
        (r.body as any).pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      });
    }
    const stat = fs.statSync(localPath);
    const id = uuidv4();
    const record: TransferRecord = {
      id, peer: peerId, path: localPath, name: displayName, size: stat.size, sent: 0,
    };
    this.transfers.push(record);
    this.saveTransfers();
    this.emitFile({
      id, name: displayName, percent: 0, bytes: 0, size: stat.size,
      direction: 'out', status: 'waiting', peerName: conn.name,
    });
    conn.channel.send({ json: { t: 'FOFFER', id, name: displayName, size: stat.size } });
    this.store.log('info', `发送开始 ${displayName} (${stat.size}B) → ${conn.name}`);
    this.streamOut(conn, record).catch((e) => this.failTransfer(id, e.message));
  }

  private saveTransfers(): void {
    this.store.writeJson('transfers.json', this.transfers);
  }

  private async resumeTransfer(conn: Conn, tr: TransferRecord): Promise<void> {
    if (!fs.existsSync(tr.path)) {
      this.failTransfer(tr.id, '本地文件已丢失，无法续传');
      return;
    }
    // 数据已全部发出（上次断在完成确认前）：只补发 FDONE，让对方完成校验落盘
    if (tr.sent >= tr.size) {
      try {
        const sha = await this.hashFile(tr.path);
        conn.channel.send({ json: { t: 'FDONE', id: tr.id, sha } });
        this.store.log('info', `续传补发完成通知 ${tr.name} (${tr.id})`);
        this.finishTransfer(tr, conn.name);
      } catch (e: any) {
        this.failTransfer(tr.id, e?.message || '补发完成通知失败');
      }
      return;
    }
    conn.channel.send({ json: { t: 'FOFFER', id: tr.id, name: tr.name, size: tr.size } });
    this.store.log('info', `续传发起 ${tr.name} 从 ${tr.sent}/${tr.size}`);
    this.streamOut(conn, tr).catch((e) => this.failTransfer(tr.id, e.message));
  }

  private async streamOut(conn: Conn, tr: TransferRecord): Promise<void> {
    // 等接收方 FACCEPT（含续传起点）
    const from = await new Promise<number>((resolve, reject) => {
      const onMsg = (m: WireMessage) => {
        const b: any = 'json' in m ? m.json : m.header;
        if (b.id === tr.id && b.t === 'FACCEPT') {
          cleanup();
          resolve(b.from);
        } else if (b.id === tr.id && b.t === 'FREJECT') {
          cleanup();
          reject(new Error('对方拒绝接收'));
        }
      };
      const onClose = () => { cleanup(); reject(new Error('连接中断，等待重连续传')); };
      const cleanup = () => {
        conn.channel.removeListener('message', onMsg);
        conn.channel.removeListener('close', onClose);
      };
      conn.channel.on('message', onMsg);
      conn.channel.on('close', onClose);
      setTimeout(() => { cleanup(); reject(new Error('接收方响应超时')); }, 30_000);
    });

    // 续传起点以接收方实际落盘大小为准（未确认的数据重发）
    tr.sent = from;
    const fd = fs.openSync(tr.path, 'r');
    let acked = tr.sent;
    try {
      this.emitFile({
        id: tr.id, name: tr.name, percent: Math.round((tr.sent / tr.size) * 100),
        bytes: tr.sent, size: tr.size, direction: 'out', status: 'transferring', peerName: conn.name,
      });
      while (tr.sent < tr.size) {
        const buf = Buffer.alloc(CHUNK);
        const n = fs.readSync(fd, buf, 0, CHUNK, tr.sent);
        if (n === 0) break;
        const off = tr.sent;
        while (tr.sent + n - acked > WINDOW) {
          await new Promise<void>((resolve) => {
            const onMsg2 = (m: WireMessage) => {
              const b: any = 'json' in m ? m.json : m.header;
              if (b.t === 'FACK' && b.id === tr.id) {
                acked = Math.max(acked, b.recv);
                conn.channel.removeListener('message', onMsg2);
                resolve();
              }
            };
            conn.channel.on('message', onMsg2);
            setTimeout(() => { conn.channel.removeListener('message', onMsg2); resolve(); }, 5000);
          });
        }
        conn.channel.send({ header: { t: 'FDATA', id: tr.id, off }, data: buf.subarray(0, n) });
        tr.sent += n;
        if (tr.sent % (256 * 1024) < CHUNK) {
          this.emitFile({
            id: tr.id, name: tr.name, percent: Math.round((tr.sent / tr.size) * 100),
            bytes: tr.sent, size: tr.size, direction: 'out', status: 'transferring', peerName: conn.name,
          });
          tr.sent > 0 && this.saveTransfers();
        }
      }
      const sha = await this.hashFile(tr.path);
      conn.channel.send({ json: { t: 'FDONE', id: tr.id, sha } });
      this.finishTransfer(tr, conn.name);
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  }

  /** 发送完成：移除记录并通知界面 */
  private finishTransfer(tr: TransferRecord, peerName: string): void {
    this.transfers = this.transfers.filter((t) => t.id !== tr.id);
    this.saveTransfers();
    this.emitFile({
      id: tr.id, name: tr.name, percent: 100, bytes: tr.size, size: tr.size,
      direction: 'out', status: 'done', peerName,
    });
    this.store.log('info', `发送完成 ${tr.name}`);
  }

  private async hashFile(p: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(p);
      s.on('data', (c) => h.update(c));
      s.on('end', () => resolve(h.digest('hex')));
      s.on('error', reject);
    });
  }

  private failTransfer(id: string, error: string): void {
    const tr = this.transfers.find((t) => t.id === id);
    if (!tr) return;
    // 数据已全部发出但完成确认没送达：保留记录，等重连后补发 FDONE
    if (tr.sent >= tr.size) {
      this.saveTransfers();
      this.store.log('warn', `发送中断（已发完待确认） ${tr.name}: ${error}`);
      this.emitFile({
        id, name: tr.name, percent: 99, bytes: tr.sent, size: tr.size, direction: 'out',
        status: 'waiting', error: '连接中断，重连后自动续传',
      });
      return;
    }
    if (tr.sent > 0) {
      // 已传一部分：保留记录，等会话恢复自动续传
      this.saveTransfers();
      this.store.log('warn', `发送中断（${tr.sent}/${tr.size}） ${tr.name}: ${error}`);
      this.emitFile({
        id, name: tr.name, percent: Math.round((tr.sent / tr.size) * 100),
        bytes: tr.sent, size: tr.size, direction: 'out',
        status: 'waiting', error: '连接中断，重连后自动续传',
      });
      return;
    }
    this.transfers = this.transfers.filter((t) => t.id !== id);
    this.saveTransfers();
    this.store.log('error', `发送失败 ${tr?.name || id}: ${error}`);
    this.emitFile({
      id, name: tr?.name || id, percent: 0, bytes: 0, size: tr?.size || 0,
      direction: 'out', status: 'failed', error,
    });
  }

  // ── 文件：接收 ─────────────────────────────────────────────────
  // 好友之间免二次确认：文件/语音到达后直接自动接收（只有通过好友申请的对端才能建立连接）

  private async onFileOffer(conn: Conn, body: { id: string; name: string; size: number }): Promise<void> {
    // 只有已同意的好友才能自动接收；非好友（申请未通过）一律拒绝，不做任何二次确认弹窗
    if (!this.contacts.find((c) => c.id === conn.id)) {
      conn.channel.send({ json: { t: 'FREJECT', id: body.id } });
      return;
    }
    const partPath = this.store.partPath(body.id);
    if (fs.existsSync(partPath)) {
      // 断点续传：此前已接收过，自动续传
      const resume = fs.statSync(partPath).size;
      await this.openRecv(body.id, body.name, body.size, partPath, resume);
      conn.channel.send({ json: { t: 'FACCEPT', id: body.id, from: resume } });
      return;
    }
    await this.openRecv(body.id, body.name, body.size, partPath, 0);
    conn.channel.send({ json: { t: 'FACCEPT', id: body.id, from: 0 } });
  }

  private async openRecv(id: string, name: string, size: number, partPath: string, resume: number): Promise<void> {
    const fd = fs.openSync(partPath, resume > 0 ? 'a' : 'w');
    const hash = crypto.createHash('sha256');
    if (resume > 0) {
      await new Promise<void>((resolve, reject) => {
        const s = fs.createReadStream(partPath);
        s.on('data', (c) => hash.update(c));
        s.on('end', () => resolve());
        s.on('error', reject);
      });
    }
    this.recv.set(id, {
      name, size, received: resume, partPath, fd, hash, lastAck: resume,
    });
  }

  private onFileData(conn: Conn, body: { id: string; off: number }, data: Buffer): void {
    const st = this.recv.get(body.id);
    if (!st || st.fd === null) return;
    if (body.off !== st.received) {
      conn.channel.send({ json: { t: 'FACCEPT', id: body.id, from: st.received } });
      return;
    }
    fs.writeSync(st.fd, data);
    st.hash.update(data);
    st.received += data.length;
    if (st.received - st.lastAck >= ACK_EVERY || st.received >= st.size) {
      st.lastAck = st.received;
      conn.channel.send({ json: { t: 'FACK', id: body.id, recv: st.received } });
      this.emitFile({
        id: body.id, name: st.name, percent: Math.round((st.received / st.size) * 100),
        bytes: st.received, size: st.size, direction: 'in', status: 'transferring', peerName: conn.name,
      });
    }
  }

  private onFileAck(_conn: Conn, _body: { id: string; recv: number }): void {
    // 窗口推进已在 streamOut 内处理；此处仅同步进度
  }

  private async onFileDone(conn: Conn, body: { id: string; sha: string }): Promise<void> {
    const st = this.recv.get(body.id);
    if (!st) return;
    if (st.fd !== null) {
      fs.closeSync(st.fd);
      st.fd = null;
    }
    const actual = st.hash.digest('hex');
    if (actual !== body.sha) {
      this.recv.delete(body.id);
      try { fs.unlinkSync(st.partPath); } catch {}
      this.emitFile({
        id: body.id, name: st.name, percent: 0, bytes: 0, size: st.size,
        direction: 'in', status: 'failed', error: '校验失败（SHA-256 不一致）', peerName: conn.name,
      });
      this.store.log('error', `接收校验失败 ${st.name}（SHA-256 不一致）`);
      return;
    }
    const dest = this.uniquePath(st.name);
    try {
      fs.renameSync(st.partPath, dest);
    } catch (e: any) {
      if (e.code !== 'EXDEV') throw e;
      // 分片与下载目录不在同一卷（如下载目录重定向到其他盘）：复制后删除
      fs.copyFileSync(st.partPath, dest);
      fs.unlinkSync(st.partPath);
    }
    this.recv.delete(body.id);
    this.emitFile({
      id: body.id, name: st.name, percent: 100, bytes: st.size, size: st.size,
      direction: 'in', status: 'done', peerName: conn.name, savePath: dest,
    });
    this.store.log('info', `接收完成 ${st.name} → ${dest}`);
  }

  private uniquePath(name: string): string {
    const dir = this.store.getDownloadsDir();
    let p = path.join(dir, name);
    let i = 1;
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    while (fs.existsSync(p)) {
      p = path.join(dir, `${base} (${i})${ext}`);
      i++;
    }
    return p;
  }

  getDownloadsDir(): string {
    return this.store.getDownloadsDir();
  }

  /** 缓存统计（设置页展示与清理用） */
  getCacheInfo(): { path: string; size: number } {
    return this.store.cacheInfo();
  }

  /** 清理统一缓存目录（分片/语音临时文件/未送达消息/日志） */
  clearCache(): void {
    this.store.clearCache();
  }

  /** 语音临时文件路径（统一缓存目录） */
  voicePath(name: string): string {
    return this.store.voicePath(name);
  }
}

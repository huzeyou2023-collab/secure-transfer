/**
 * AES-256-GCM 加密通道
 *
 * 握手（X25519 ECDH + HKDF-SHA256，仿 Noise XX 单向认证，首次配对 TOFU 记录指纹）：
 *   C → S  H1（明文 JSON）：{ epk, spk, id, name }
 *   S → C  H2（用 k_cs 加密）：{ epk, spk, id, name, book, fp }
 *   C → S  H3（用 k_cs 加密）：{ id, name, ok, fp }
 * 握手完成后所有帧均为 AES-256-GCM 密文（12 字节 nonce + 密文 + 16 字节 tag）。
 *
 * 帧格式（握手后）：
 *   [u32 BE 长度][12 字节 nonce][AES-256-GCM 密文+tag]
 * 密文内业务负载：
 *   JSON  ：0x00 + JSON UTF-8
 *   二进制：0x01 + u32BE(头长度) + JSON 头 + 裸数据（用于文件分块）
 */
import * as net from 'net';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { HaoMiBook } from './haomi';

export interface IdentityKey {
  priv: string; // base64 X25519 私钥
  pub: string;  // base64 X25519 公钥
}

interface PeerInfo {
  id: string;
  name: string;
  port?: number;
}

interface HandshakeResult {
  channel: SecureChannel;
  peer: PeerInfo;
  peerStaticPub: string;
  book?: HaoMiBook; // 仅客户端拿到服务端生成的底本/乱码表
}

export function generateIdentity(): IdentityKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    priv: (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64'),
    pub: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'),
  };
}

function importPriv(b64: string): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.from(b64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}
function importPub(b64: string): crypto.KeyObject {
  return crypto.createPublicKey({
    key: Buffer.from(b64, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function hkdf(master: Buffer, label: string): Buffer {
  return crypto.hkdfSync('sha256', master, 'secure-transfer-v4', label, 32) as unknown as Buffer;
}

function deriveKeys(e1: Buffer, e2: Buffer): { kCs: Buffer; kSc: Buffer } {
  const master = crypto.createHash('sha256').update(Buffer.concat([e1, e2])).digest();
  return {
    kCs: Buffer.from(hkdf(master, 'client->server')),
    kSc: Buffer.from(hkdf(master, 'server->client')),
  };
}

/** 长度前缀裸帧读写（握手明文用） */
function writeRawFrame(socket: net.Socket, data: Buffer): void {
  const h = Buffer.alloc(4);
  h.writeUInt32BE(data.length, 0);
  socket.write(Buffer.concat([h, data]));
}

function readExact(socket: net.Socket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onReadable = () => {
      const b = socket.read(n);
      if (b) {
        socket.removeListener('error', onErr);
        resolve(b);
      }
    };
    const onErr = (e: Error) => {
      socket.removeListener('readable', onReadable);
      reject(e);
    };
    socket.once('readable', onReadable);
    socket.once('error', onErr);
  });
}

async function readRawFrame(socket: net.Socket): Promise<Buffer> {
  const h = await readExact(socket, 4);
  const len = h.readUInt32BE(0);
  if (len > 32 * 1024 * 1024) throw new Error('帧过大');
  return readExact(socket, len);
}

/** 业务消息（明文） */
export type WireMessage =
  | { json: any }
  | { header: any; data: Buffer };

function encodeMessage(msg: WireMessage): Buffer {
  if ('json' in msg) {
    return Buffer.concat([Buffer.from([0x00]), Buffer.from(JSON.stringify(msg.json), 'utf-8')]);
  }
  const hj = Buffer.from(JSON.stringify(msg.header), 'utf-8');
  const out = Buffer.alloc(5 + hj.length);
  out[0] = 0x01;
  out.writeUInt32BE(hj.length, 1);
  hj.copy(out, 5);
  return Buffer.concat([out, msg.data]);
}

function decodeMessage(buf: Buffer): WireMessage {
  if (buf[0] === 0x00) return { json: JSON.parse(buf.subarray(1).toString('utf-8')) };
  const hl = buf.readUInt32BE(1);
  const header = JSON.parse(buf.subarray(5, 5 + hl).toString('utf-8'));
  return { header, data: Buffer.from(buf.subarray(5 + hl)) };
}

const AAD = Buffer.from('secure-transfer-v4');

export class SecureChannel extends EventEmitter {
  private socket: net.Socket;
  private sendKey: Buffer;
  private recvKey: Buffer;
  private sendCounter = 0;
  private recvCounter = 0;
  private recvBuf = Buffer.alloc(0);
  private closed = false;
  private closeEmitted = false;

  constructor(socket: net.Socket, sendKey: Buffer, recvKey: Buffer) {
    super();
    this.socket = socket;
    this.sendKey = sendKey;
    this.recvKey = recvKey;
    this.socket.setKeepAlive(true, 10_000);
    // 关键：清除连接超时残留，避免空闲 recv 抛超时杀死会话
    this.socket.setTimeout(0);
    this.socket.on('data', (d) => this.onData(d as Buffer));
    this.socket.on('close', () => this.emitClose());
    this.socket.on('error', (err) => {
      if (!this.closeEmitted) this.emit('error', err);
    });
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.closed = true;
    this.emit('close');
  }

  send(msg: WireMessage): void {
    if (this.closed) throw new Error('通道已关闭');
    const plain = encodeMessage(msg);
    const nonce = Buffer.alloc(12);
    nonce.writeUInt32BE(this.sendCounter >>> 0, 4);
    this.sendCounter++;
    const cipher = crypto.createCipheriv('aes-256-gcm', this.sendKey, nonce, { authTagLength: 16 });
    cipher.setAAD(AAD);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const len = Buffer.alloc(4);
    len.writeUInt32BE(nonce.length + enc.length + tag.length, 0);
    this.socket.write(Buffer.concat([len, nonce, enc, tag]));
  }

  private onData(chunk: Buffer): void {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    for (;;) {
      if (this.recvBuf.length < 4) return;
      const len = this.recvBuf.readUInt32BE(0);
      if (len > 16 * 1024 * 1024 + 64) {
        this.destroy(new Error('密文帧过大'));
        return;
      }
      if (this.recvBuf.length < 4 + len) return;
      const frame = this.recvBuf.subarray(4, 4 + len);
      this.recvBuf = this.recvBuf.subarray(4 + len);
      try {
        const nonce = frame.subarray(0, 12);
        const tag = frame.subarray(frame.length - 16);
        const enc = frame.subarray(12, frame.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.recvKey, nonce, { authTagLength: 16 });
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
        const expect = Buffer.alloc(12);
        expect.writeUInt32BE(this.recvCounter >>> 0, 4);
        this.recvCounter++;
        if (!nonce.equals(expect)) throw new Error('nonce 序列异常');
        this.emit('message', decodeMessage(plain));
      } catch (e) {
        this.destroy(e as Error);
        return;
      }
    }
  }

  destroy(err?: Error): void {
    if (this.closeEmitted) return;
    this.closed = true;
    try { this.socket.destroy(); } catch {}
    if (err) this.emit('error', err);
    this.emitClose();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get remoteHost(): string {
    const a = this.socket.remoteAddress || '';
    return a.startsWith('::ffff:') ? a.slice(7) : a;
  }
}

/** 加密一条 JSON（握手 H2/H3 用，独立计数器，仅一条） */
function sealJson(key: Buffer, nonce: Buffer, obj: any): Buffer {
  const plain = Buffer.from(JSON.stringify(obj), 'utf-8');
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(AAD);
  return Buffer.concat([nonce, c.update(plain), c.final(), c.getAuthTag()]);
}
function openJson(key: Buffer, frame: Buffer): any {
  const nonce = frame.subarray(0, 12);
  const tag = frame.subarray(frame.length - 16);
  const enc = frame.subarray(12, frame.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  d.setAAD(AAD);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf-8'));
}

/** 客户端：对服务端发起加密握手 */
export async function clientHandshake(
  socket: net.Socket,
  identity: IdentityKey,
  self: PeerInfo,
): Promise<HandshakeResult> {
  const epk = crypto.generateKeyPairSync('x25519');
  const epPub = epk.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const h1 = { v: 4, epk: epPub, spk: identity.pub, id: self.id, name: self.name, port: self.port || 0 };
  writeRawFrame(socket, Buffer.from(JSON.stringify(h1), 'utf-8'));

  const h2Frame = await readRawFrame(socket);
  // 此时还没有密钥，先读取 H1 回显需要的密钥：H2 用 k_cs 封装，密钥依赖 H2 中的服务端临时公钥——
  // 为避免先有鸡先有蛋，H2 分两段：H2A 明文（服务端临时/静态公钥），H2B 密文（含底本）。
  const h2a = JSON.parse(h2Frame.toString('utf-8'));
  if (h2a.v !== 4) throw new Error('协议版本不匹配');

  const epPriv = epk.privateKey;
  const s1 = crypto.diffieHellman({ privateKey: epPriv, publicKey: importPub(h2a.epk) });
  const s2 = crypto.diffieHellman({ privateKey: importPriv(identity.priv), publicKey: importPub(h2a.epk) });
  const { kCs, kSc } = deriveKeys(s1, s2);

  const h2bFrame = await readRawFrame(socket);
  const h2 = openJson(kCs, h2bFrame);
  const channel = new SecureChannel(socket, kCs, kSc);

  channel.send({ json: { t: 'H3', id: self.id, name: self.name, port: self.port || 0, ok: true } });
  return {
    channel,
    peer: { id: h2.id, name: h2.name, port: h2.port || 0 },
    peerStaticPub: h2.spk,
    book: h2.book as HaoMiBook,
  };
}

/** 服务端：接受一个连接并完成加密握手，book 由服务端生成（每次会话不同） */
export async function serverHandshake(
  socket: net.Socket,
  identity: IdentityKey,
  self: PeerInfo,
  book: HaoMiBook,
): Promise<HandshakeResult> {
  const h1Frame = await readRawFrame(socket);
  const h1 = JSON.parse(h1Frame.toString('utf-8'));
  if (h1.v !== 4) throw new Error('协议版本不匹配');

  const epk = crypto.generateKeyPairSync('x25519');
  const epPriv = epk.privateKey;
  const epPub = (epk.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
  const s1 = crypto.diffieHellman({ privateKey: epPriv, publicKey: importPub(h1.epk) });
  const s2 = crypto.diffieHellman({ privateKey: epPriv, publicKey: importPub(h1.spk) });
  const { kCs, kSc } = deriveKeys(s1, s2);

  writeRawFrame(socket, Buffer.from(JSON.stringify({ v: 4, epk: epPub, spk: identity.pub }), 'utf-8'));
  const h2 = { id: self.id, name: self.name, port: self.port || 0, spk: identity.pub, book };
  writeRawFrame(socket, sealJson(kCs, Buffer.alloc(12), h2));

  // 服务端：发送 kSc，接收 kCs
  const channel = new SecureChannel(socket, kSc, kCs);
  await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('握手超时')), 10_000);
    channel.once('message', (m: WireMessage) => {
      clearTimeout(timer);
      if ('json' in m && m.json.t === 'H3') resolve(m.json);
      else reject(new Error('握手失败'));
    });
    channel.once('error', (e) => { clearTimeout(timer); reject(e); });
  });

  return {
    channel,
    peer: { id: h1.id, name: h1.name, port: h1.port || 0 },
    peerStaticPub: h1.spk,
  };
}

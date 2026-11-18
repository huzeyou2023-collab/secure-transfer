/**
 * 加密通道（v5.2）：AES-GCM 级联
 *
 * 握手（X25519 ECDH + HKDF-SHA512，仿 Noise XX 单向认证，首次配对 TOFU 记录指纹）：
 *   C → S  H1（明文 JSON）：{ v:5, epk, spk, id, name, port, s:强度, k:是否自定义密钥 }
 *   S → C  H2A（明文 JSON）：{ v:5, epk, spk, s:强度, k:是否自定义密钥, err? }
 *   S → C  H2B（加密）：{ id, name, port, spk, book }
 *   C → S  H3（加密通道内）：{ id, name, port, ok }
 *
 * 加密强度（128/192/256/512/1024 位）：
 *   · 128/192/256：单层 AES-{n}-GCM（AES-NI 加速）
 *   · 512/1024：拆成 2/4 段 256 位密钥的级联 AES-256-GCM（逐层封装，各自带 tag）
 *   · 自定义密钥（口令）经 PBKDF2-SHA512 派生后参与 HKDF，双方不一致则握手失败
 *
 * 帧格式（握手后）：[u32 BE 长度][12B nonce][密文][16B tag]（级联时逐层嵌套）
 * 密文内业务负载：
 *   JSON  ：0x00 + JSON UTF-8
 *   二进制：0x01 + u32BE(头长度) + JSON 头 + 裸数据（用于文件分块）
 */
import * as net from 'net';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { HaoMiBook } from './haomi';
import {
  AesLayer,
  Strength,
  deriveSessionKeys,
  normalizeStrength,
  openLayers,
  sealLayers,
} from './keys';

export interface IdentityKey {
  priv: string; // base64 X25519 私钥
  pub: string;  // base64 X25519 公钥
}

interface PeerInfo {
  id: string;
  name: string;
  port?: number;
}

export interface HandshakeOptions {
  strength: Strength;
  /** 自定义密钥材料（null = 使用默认 ECDH 派生） */
  psk: Buffer | null;
}

export interface HandshakeResult {
  channel: SecureChannel;
  peer: PeerInfo;
  peerStaticPub: string;
  book?: HaoMiBook; // 仅客户端拿到服务端生成的底本/乱码表
  strength: Strength;
  hasPsk: boolean;
}

const PROTO_VERSION = 5;

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

export class SecureChannel extends EventEmitter {
  private socket: net.Socket;
  private sendLayers: AesLayer[];
  private recvLayers: AesLayer[];
  private sendCounter = 0;
  private recvCounter = 0;
  private recvBuf = Buffer.alloc(0);
  private closed = false;
  private closeEmitted = false;

  constructor(socket: net.Socket, keys: { send: AesLayer[]; recv: AesLayer[] }) {
    super();
    this.socket = socket;
    this.sendLayers = keys.send;
    this.recvLayers = keys.recv;
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
    const frame = sealLayers(this.sendLayers, this.sendCounter, plain, 'frame');
    this.sendCounter++;
    const len = Buffer.alloc(4);
    len.writeUInt32BE(frame.length, 0);
    this.socket.write(Buffer.concat([len, frame]));
  }

  private onData(chunk: Buffer): void {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    for (;;) {
      if (this.recvBuf.length < 4) return;
      const len = this.recvBuf.readUInt32BE(0);
      if (len > 16 * 1024 * 1024 + 512) {
        this.destroy(new Error('密文帧过大'));
        return;
      }
      if (this.recvBuf.length < 4 + len) return;
      const frame = this.recvBuf.subarray(4, 4 + len);
      this.recvBuf = this.recvBuf.subarray(4 + len);
      try {
        const plain = openLayers(this.recvLayers, this.recvCounter, frame, 'frame');
        this.recvCounter++;
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

/** 客户端：对服务端发起加密握手 */
export async function clientHandshake(
  socket: net.Socket,
  identity: IdentityKey,
  self: PeerInfo,
  opts: HandshakeOptions,
): Promise<HandshakeResult> {
  const strength = normalizeStrength(opts.strength);
  const psk = opts.psk;
  const epk = crypto.generateKeyPairSync('x25519');
  const epPub = epk.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const h1 = {
    v: PROTO_VERSION,
    epk: epPub,
    spk: identity.pub,
    id: self.id,
    name: self.name,
    port: self.port || 0,
    s: strength,
    k: psk ? 1 : 0,
  };
  writeRawFrame(socket, Buffer.from(JSON.stringify(h1), 'utf-8'));

  const h2aFrame = await readRawFrame(socket);
  const h2a = JSON.parse(h2aFrame.toString('utf-8'));
  if (h2a.v !== PROTO_VERSION) throw new Error('对方版本过旧，请双方都升级到 v5.3.0.0 或更高版本');
  if (h2a.err) throw new Error(String(h2a.err));
  const peerStrength = normalizeStrength(h2a.s);
  if (peerStrength !== strength) {
    throw new Error(`加密强度不一致：本机 ${strength} 位，对方 ${peerStrength} 位，请在设置中调成一致`);
  }
  const peerHasPsk = !!h2a.k;
  if (peerHasPsk !== !!psk) {
    throw new Error(psk
      ? '对方没有设置自定义密钥，请对方在设置中填入相同密钥，或本机留空'
      : '对方设置了自定义密钥，请在本机「添加好友」里填入相同密钥');
  }

  const epPriv = epk.privateKey;
  const s1 = crypto.diffieHellman({ privateKey: epPriv, publicKey: importPub(h2a.epk) });
  const s2 = crypto.diffieHellman({ privateKey: importPriv(identity.priv), publicKey: importPub(h2a.epk) });
  const { kCs, kSc } = deriveSessionKeys(s1, s2, strength, psk);

  const h2bFrame = await readRawFrame(socket);
  let h2: any;
  try {
    h2 = JSON.parse(openLayers(kCs, 0, h2bFrame, 'hs').toString('utf-8'));
  } catch {
    throw new Error('密钥不一致：双方自定义密钥不同，请确认两端填写完全相同的密钥');
  }
  const channel = new SecureChannel(socket, { send: kCs, recv: kSc });

  channel.send({ json: { t: 'H3', id: self.id, name: self.name, port: self.port || 0, ok: true, s: strength } });
  return {
    channel,
    peer: { id: h2.id, name: h2.name, port: h2.port || 0 },
    peerStaticPub: h2.spk,
    book: h2.book as HaoMiBook,
    strength,
    hasPsk: !!psk,
  };
}

/** 服务端：接受一个连接并完成加密握手，book 由服务端生成（每次会话不同） */
export async function serverHandshake(
  socket: net.Socket,
  identity: IdentityKey,
  self: PeerInfo,
  book: HaoMiBook,
  opts: HandshakeOptions,
  pskForPeer: (peerId: string) => Buffer | null,
): Promise<HandshakeResult> {
  const strength = normalizeStrength(opts.strength);
  const h1Frame = await readRawFrame(socket);
  const h1 = JSON.parse(h1Frame.toString('utf-8'));
  if (h1.v !== PROTO_VERSION) {
    try {
      writeRawFrame(socket, Buffer.from(JSON.stringify({ v: PROTO_VERSION, err: '对方版本不匹配，请升级到 v5.3.0.0 或更高' }), 'utf-8'));
    } catch {}
    throw new Error('对方版本过旧，无法建立加密通道');
  }

  const clientStrength = normalizeStrength(h1.s);
  const psk = pskForPeer(String(h1.id || ''));
  const reply = (err?: string) => {
    try {
      writeRawFrame(socket, Buffer.from(JSON.stringify({
        v: PROTO_VERSION,
        s: strength,
        k: psk ? 1 : 0,
        ...(err ? { err } : {}),
      }), 'utf-8'));
    } catch {}
  };
  if (clientStrength !== strength) {
    reply(`加密强度不一致：本机 ${strength} 位，对方 ${clientStrength} 位，请在设置中调成一致`);
    throw new Error('加密强度不一致');
  }
  const clientHasPsk = !!h1.k;
  if (clientHasPsk !== !!psk) {
    reply(clientHasPsk
      ? '对方设置了自定义密钥，而本机未设置；请在本机设置相同密钥'
      : '本机设置了自定义密钥，而对方未设置；请对方填入相同密钥');
    throw new Error('自定义密钥状态不一致');
  }

  const epk = crypto.generateKeyPairSync('x25519');
  const epPriv = epk.privateKey;
  const epPub = (epk.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
  const s1 = crypto.diffieHellman({ privateKey: epPriv, publicKey: importPub(h1.epk) });
  const s2 = crypto.diffieHellman({ privateKey: epPriv, publicKey: importPub(h1.spk) });
  const { kCs, kSc } = deriveSessionKeys(s1, s2, strength, psk);

  writeRawFrame(socket, Buffer.from(JSON.stringify({
    v: PROTO_VERSION,
    epk: epPub,
    spk: identity.pub,
    s: strength,
    k: psk ? 1 : 0,
  }), 'utf-8'));
  const h2 = { id: self.id, name: self.name, port: self.port || 0, spk: identity.pub, book };
  writeRawFrame(socket, sealLayers(kCs, 0, Buffer.from(JSON.stringify(h2), 'utf-8'), 'hs'));

  // 服务端：发送 kSc，接收 kCs
  const channel = new SecureChannel(socket, { send: kSc, recv: kCs });
  await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('握手超时')), 10_000);
    channel.once('message', (m: WireMessage) => {
      clearTimeout(timer);
      if ('json' in m && m.json.t === 'H3') resolve(m.json);
      else reject(new Error('握手失败'));
    });
    channel.once('error', (e: { message?: string }) => { clearTimeout(timer); reject(e); });
  }).catch((e: Error) => {
    channel.destroy();
    throw new Error(e?.message === '握手超时' ? '握手超时：对方未响应' : '握手失败：自定义密钥不一致或连接异常');
  });

  return {
    channel,
    peer: { id: h1.id, name: h1.name, port: h1.port || 0 },
    peerStaticPub: h1.spk,
    strength,
    hasPsk: !!psk,
  };
}

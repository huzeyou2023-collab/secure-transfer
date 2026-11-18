/**
 * 加密强度 / 密钥派生（v5.2）
 *
 * 强度（位）：64 / 128 / 192 / 256 / 512 / 1024，默认 256。
 *   · 128 / 192 / 256：单层 AES-{n}-GCM（走 AES-NI 指令集，最快）
 *   · 64：兼容通道，64 位密钥材料经 HKDF 扩展为 AES-128-GCM 单层
 *     （有效熵 64 位，用于老旧设备 / 极端低算力场景）
 *   · 512 / 1024：拆成 2 / 4 段独立的 256 位密钥，做级联 AES-256-GCM
 *     （每段各有一把 256 位密钥、各自的 GCM tag，密钥总长度与所选强度一致）
 *
 * 密钥统一来源：
 *   · 默认：X25519 ECDH 双方临时/静态公钥 → HKDF-SHA512 派生
 *   · 自定义密钥（口令）：PBKDF2-SHA512（固定盐，210000 轮）得到 64 字节种子，
 *     再按所选强度扩展成密钥材料，与 ECDH 结果一起送入 HKDF-SHA512。
 *     口令本身不落盘，只保存 PBKDF2 种子；两端用同一算法，保证互通。
 */
import * as crypto from 'crypto';

export type Strength = 64 | 128 | 192 | 256 | 512 | 1024;

export const STRENGTHS: Strength[] = [64, 128, 192, 256, 512, 1024];
export const DEFAULT_STRENGTH: Strength = 256;

export function normalizeStrength(v: unknown): Strength {
  const n = Number(v);
  return (STRENGTHS as number[]).includes(n) ? (n as Strength) : DEFAULT_STRENGTH;
}

const PROTO = 'secure-transfer-v5';
const PSK_SALT = 'secure-transfer-psk-v1';
/** PBKDF2 迭代次数：兼顾桌面端性能（每次设置/添加好友只算一次）与暴力破解成本 */
const PBKDF2_ITERATIONS = 210_000;

export interface AesLayer {
  algo: 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm';
  key: Buffer;
}

function hkdf(ikm: Buffer, salt: string, info: string, bytes: number): Buffer {
  return Buffer.from(crypto.hkdfSync('sha512', ikm, Buffer.from(salt), Buffer.from(info), bytes));
}

/** 密钥材料 → 加密层（64 位扩为 AES-128；512/1024 拆成多段 256 位） */
export function toLayers(material: Buffer, strength: Strength): AesLayer[] {
  if (strength === 64) {
    return [{ algo: 'aes-128-gcm', key: hkdf(material, PROTO, 'x64', 16) }];
  }
  if (strength <= 256) {
    return [{ algo: `aes-${strength}-gcm` as AesLayer['algo'], key: material.subarray(0, strength / 8) }];
  }
  const layers: AesLayer[] = [];
  for (let i = 0; i < strength / 256; i++) {
    layers.push({ algo: 'aes-256-gcm', key: material.subarray(i * 32, i * 32 + 32) });
  }
  return layers;
}

/** 口令 → 64 字节种子（PBKDF2-SHA512）。两端算法完全一致，存入设置/联系人后不再保存明文口令 */
export function pskSeedFromPassword(password: string): Buffer {
  return crypto.pbkdf2Sync(Buffer.from(password.normalize('NFKC'), 'utf-8'), PSK_SALT, PBKDF2_ITERATIONS, 64, 'sha512');
}

/** 种子 → 指定强度的密钥材料（HKDF-SHA512 扩展，长度 = 强度/8 字节） */
export function pskMaterial(seed: Buffer, strength: Strength): Buffer {
  return hkdf(seed, PROTO, `psk|${strength}`, strength / 8);
}

function layerNonce(counter: number, layer: number): Buffer {
  const n = Buffer.alloc(12);
  n.writeUInt32BE(counter >>> 0, 4);
  n[0] = layer & 0xff;
  return n;
}

function layerAad(label: string, layer: number): Buffer {
  return Buffer.from(`${PROTO}|${label}|${layer}`);
}

/**
 * 级联加密：plain 依次被每一层封装，第 i 层的输出为 [12B nonce][密文][16B tag]。
 * counter 每帧自增（握手等一次性数据用 0），每层 nonce 独立，杜绝重放/重排。
 */
export function sealLayers(layers: AesLayer[], counter: number, plain: Buffer, label = 'frame'): Buffer {
  let data = plain;
  for (let i = 0; i < layers.length; i++) {
    const nonce = layerNonce(counter, i);
    const c = crypto.createCipheriv(layers[i].algo, layers[i].key, nonce, { authTagLength: 16 });
    c.setAAD(layerAad(label, i));
    const enc = Buffer.concat([c.update(data), c.final()]);
    data = Buffer.concat([nonce, enc, c.getAuthTag()]);
  }
  return data;
}

/** 级联解密（反向拆层） */
export function openLayers(layers: AesLayer[], counter: number, frame: Buffer, label = 'frame'): Buffer {
  let data = frame;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (data.length < 28) throw new Error('密文帧过短');
    const nonce = data.subarray(0, 12);
    const expect = layerNonce(counter, i);
    if (!nonce.equals(expect)) throw new Error('nonce 序列异常');
    const tag = data.subarray(data.length - 16);
    const enc = data.subarray(12, data.length - 16);
    const d = crypto.createDecipheriv(layers[i].algo, layers[i].key, nonce, { authTagLength: 16 });
    d.setAAD(layerAad(label, i));
    d.setAuthTag(tag);
    data = Buffer.concat([d.update(enc), d.final()]);
  }
  return data;
}

/** 由 ECDH 共享秘密 + 可选自定义密钥派生双向会话密钥 */
export function deriveSessionKeys(
  s1: Buffer,
  s2: Buffer,
  strength: Strength,
  psk: Buffer | null,
): { kCs: AesLayer[]; kSc: AesLayer[] } {
  const master = crypto.createHash('sha512').update(Buffer.concat([s1, s2])).digest();
  const ikm = psk ? Buffer.concat([master, psk]) : master;
  const salt = `${PROTO}|${strength}|${psk ? 'psk' : 'plain'}`;
  const n = strength / 8;
  return {
    kCs: toLayers(hkdf(ikm, salt, 'client->server', n), strength),
    kSc: toLayers(hkdf(ikm, salt, 'server->client', n), strength),
  };
}

/** 供界面显示／日志使用的强度说明 */
export function strengthLabel(strength: Strength): string {
  if (strength === 64) return 'AES-128-GCM（64 位有效密钥，兼容通道）';
  return strength <= 256 ? `AES-${strength}-GCM` : `${strength / 256} × AES-256-GCM 级联`;
}

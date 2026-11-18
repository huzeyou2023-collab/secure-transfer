/**
 * 豪密层（HaoMi cipher）
 *
 * 复刻红军豪密“底本 + 乱码表”思路的现代实现，仅作用于文字信息：
 *   1. 底本：对 Base32 符号表做一次随机置换（代换表），每次握手生成；
 *   2. 乱码表：以种子派生命令置换，对每块符号的位置做置乱（换位表）。
 * 每次会话握手生成新的底本与乱码表，仅在该次加密通道内有效。
 * 豪密层输出仍是文本，随后再送入 AES-256-GCM 通道，与文件走同一通道。
 */
import * as crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BLOCK = 128;

export interface HaoMiBook {
  /** 底本：Base32 符号的随机置换，32 个互不相同的字符 */
  alpha: string;
  /** 乱码表种子：64 位十六进制（32 字节随机） */
  seed: string;
}

export function createBook(): HaoMiBook {
  const arr = B32.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { alpha: arr.join(''), seed: crypto.randomBytes(32).toString('hex') };
}

/** UTF-8 文本 → 无填充 Base32 文本 */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** 种子 + 块号 → 确定性 PRNG（mulberry32，仅用于乱码位置置换） */
function prng(seed: string, blockIndex: number): () => number {
  const h = crypto.createHash('sha256').update(seed).update(':' + blockIndex).digest();
  let a = h.readUInt32LE(0) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字 → 豪密密文（Base32 文本） */
export function haomiEncipher(text: string, book: HaoMiBook): string {
  if (book.alpha.length !== 32 || new Set(book.alpha.split('')).size !== 32) {
    throw new Error('无效的豪密底本');
  }
  // 代换：标准 Base32 符号 → 底本符号
  let s = '';
  for (const ch of base32Encode(Buffer.from(text, 'utf-8'))) {
    s += book.alpha[B32.indexOf(ch)];
  }
  // 置乱：块内 Fisher–Yates 位置置换
  const pad = (BLOCK - (s.length % BLOCK)) % BLOCK;
  s += B32[0].repeat(pad);
  let out = '';
  for (let b = 0; b < s.length; b += BLOCK) {
    const block = s.slice(b, b + BLOCK).split('');
    const rnd = prng(book.seed, b / BLOCK);
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    out += block.join('');
  }
  return pad.toString(36) + '.' + out;
}

/** 豪密密文 → 文字 */
export function haomiDecipher(cipher: string, book: HaoMiBook): string {
  const dot = cipher.indexOf('.');
  if (dot < 0) throw new Error('无效的豪密密文');
  const pad = parseInt(cipher.slice(0, dot), 36);
  const body = cipher.slice(dot + 1);
  // 逆置乱
  let restored = '';
  for (let b = 0; b < body.length; b += BLOCK) {
    const block = body.slice(b, b + BLOCK).split('');
    const rnd = prng(book.seed, b / BLOCK);
    const swaps: [number, number][] = [];
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      swaps.push([i, j]);
    }
    for (let k = swaps.length - 1; k >= 0; k--) {
      const [i, j] = swaps[k];
      [block[i], block[j]] = [block[j], block[i]];
    }
    restored += block.join('');
  }
  if (pad > 0) restored = restored.slice(0, -pad);
  // 逆代换：底本符号 → 标准 Base32 符号
  let s = '';
  for (const ch of restored) {
    const idx = book.alpha.indexOf(ch);
    if (idx < 0) throw new Error('豪密密文含未知符号');
    s += B32[idx];
  }
  return base32Decode(s).toString('utf-8');
}

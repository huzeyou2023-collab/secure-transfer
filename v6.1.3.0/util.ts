/**
 * 轻量工具：避免运行时依赖 npm 包。
 * uuid v4 使用 Node 内置 crypto.randomUUID（与 uuid 包的 v4 输出格式一致）。
 * cryptSecret / decryptSecret：密钥种子加密落盘（safeStorage = Windows DPAPI）。
 */
import { randomUUID } from 'crypto';

export function uuidv4(): string {
  return randomUUID();
}

/** 密钥种子 → 加密字符串（'e:' 前缀 = safeStorage 加密；'x:' 前缀 = 无 Electron 时的兜底编码） */
export function cryptSecret(plain: string): string {
  if (!plain) return '';
  try {
    // 仅在 Electron 主进程内可用
    const { safeStorage } = require('electron');
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      return 'e:' + safeStorage.encryptString(plain).toString('base64');
    }
  } catch { /* 非 Electron 环境（CLI 测试） */ }
  return 'x:' + Buffer.from(plain, 'utf-8').toString('base64');
}

/** 加密字符串 → 密钥种子；兼容旧版明文落盘 */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith('e:')) {
    try {
      const { safeStorage } = require('electron');
      return safeStorage.decryptString(Buffer.from(stored.slice(2), 'base64'));
    } catch {
      return '';
    }
  }
  if (stored.startsWith('x:')) {
    try {
      return Buffer.from(stored.slice(2), 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }
  return stored;
}

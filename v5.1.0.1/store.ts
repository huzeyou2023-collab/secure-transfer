/**
 * 本地数据：身份密钥、联系人、消息外发箱、消息历史、去重表、断点续传状态、分片文件。
 * 优先使用 Electron userData；脱离 Electron（测试/CLI）时落到 ~/.secure-transfer。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateIdentity, IdentityKey } from './channel';

function home(): string {
  const env = process.env.SECURE_TRANSFER_HOME;
  if (env) return env;
  try {
    // 仅在 Electron 主进程内可用
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('userData');
  } catch {}
  return path.join(os.homedir(), '.secure-transfer');
}

export class Store {
  readonly root: string;
  readonly partsDir: string;
  readonly historyDir: string;
  private downloadsDirValue = '';

  constructor() {
    this.root = home();
    this.partsDir = path.join(this.root, 'parts');
    this.historyDir = path.join(this.root, 'history');
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.partsDir, { recursive: true });
    fs.mkdirSync(this.historyDir, { recursive: true });
  }

  private p(name: string): string {
    return path.join(this.root, name);
  }

  readJson<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.p(name), 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  writeJson(name: string, value: unknown): void {
    const tmp = this.p(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, this.p(name));
  }

  getIdentity(): IdentityKey {
    const id = this.readJson<IdentityKey | null>('identity.json', null);
    if (id && id.priv && id.pub) return id;
    const fresh = generateIdentity();
    this.writeJson('identity.json', fresh);
    return fresh;
  }

  getDownloadsDir(): string {
    if (this.downloadsDirValue) return this.downloadsDirValue;
    const env = process.env.SECURE_TRANSFER_DOWNLOADS;
    let base = env || '';
    if (!base) {
      try {
        const { app } = require('electron');
        base = app.getPath('downloads');
      } catch {
        base = path.join(os.homedir(), 'Downloads');
      }
    }
    this.downloadsDirValue = path.join(base, '安全传输');
    fs.mkdirSync(this.downloadsDirValue, { recursive: true });
    return this.downloadsDirValue;
  }

  partPath(transferId: string): string {
    return path.join(this.partsDir, transferId + '.part');
  }
}

/**
 * 本地数据：身份密钥、联系人、消息外发箱、消息历史、去重表、断点续传状态、分片文件。
 * 优先使用 Electron userData；脱离 Electron（测试/CLI）时落到 ~/.secure-transfer。
 *
 * 缓存统一放在 <userData>/cache/ 下（可在设置中一键清理）：
 *   cache/parts/     断点续传分片
 *   cache/voice/     语音临时文件
 *   cache/outbox.json    未送达的消息（重连后自动重投）
 *   cache/transfers.json 传输记录（含续传状态）
 *   cache/logs/app.log   运行日志
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

const CACHE_NAMES = ['outbox.json', 'transfers.json'];
const LOG_MAX = 2 * 1024 * 1024; // 日志超过 2MB 滚动为 .old

export class Store {
  readonly root: string;
  readonly cacheRoot: string;
  readonly partsDir: string;
  readonly voiceDir: string;
  readonly logDir: string;
  readonly historyDir: string;
  private downloadsDirValue = '';

  constructor() {
    this.root = home();
    this.cacheRoot = path.join(this.root, 'cache');
    this.partsDir = path.join(this.cacheRoot, 'parts');
    this.voiceDir = path.join(this.cacheRoot, 'voice');
    this.logDir = path.join(this.cacheRoot, 'logs');
    this.historyDir = path.join(this.root, 'history');
    for (const d of [this.cacheRoot, this.partsDir, this.voiceDir, this.logDir, this.historyDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    // 迁移旧位置 → 统一缓存目录（一次性，幂等）
    this.migrate();
  }

  private migrate(): void {
    // 旧 parts 目录（<root>/parts）迁到 cache/parts
    const legacyParts = path.join(this.root, 'parts');
    if (fs.existsSync(legacyParts) && legacyParts !== this.partsDir) {
      try {
        for (const f of fs.readdirSync(legacyParts)) {
          const from = path.join(legacyParts, f);
          const to = path.join(this.partsDir, f);
          if (fs.statSync(from).isFile()) {
            if (!fs.existsSync(to)) fs.renameSync(from, to);
          }
        }
        if (fs.readdirSync(legacyParts).length === 0) fs.rmdirSync(legacyParts);
      } catch (e: any) {
        this.log('warn', '迁移旧分片目录失败: ' + (e?.message || e));
      }
    }
    // outbox.json / transfers.json 从根目录迁到 cache
    for (const name of CACHE_NAMES) {
      const old = path.join(this.root, name);
      const neo = path.join(this.cacheRoot, name);
      try {
        if (fs.existsSync(old) && !fs.existsSync(neo)) fs.renameSync(old, neo);
      } catch (e: any) {
        this.log('warn', `迁移 ${name} 失败: ` + (e?.message || e));
      }
    }
  }

  private p(name: string): string {
    // 缓存类状态文件统一放 cache/ 下
    return path.join(CACHE_NAMES.includes(name) ? this.cacheRoot : this.root, name);
  }

  readJson<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.p(name), 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  writeJson(name: string, value: unknown): void {
    const target = this.p(name);
    const tmp = target + '.tmp';
    const data = JSON.stringify(value);
    for (let i = 0; i < 3; i++) {
      try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, target);
        return;
      } catch (e: any) {
        const code = (e as NodeJS.ErrnoException)?.code;
        // 杀软/索引短暂锁定导致的失败：稍候重试
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
      }
    }
    // 原子替换失败时降级为直接覆盖写，保证状态不丢；本方法不向上抛异常
    try { fs.writeFileSync(target, data); } catch {}
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

  voicePath(name: string): string {
    return path.join(this.voiceDir, name);
  }

  // ── 运行日志 ──────────────────────────────────────────────────
  log(level: 'info' | 'warn' | 'error', msg: string): void {
    try {
      const file = path.join(this.logDir, 'app.log');
      if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX) {
        try { fs.renameSync(file, file + '.old'); } catch {}
      }
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
      fs.appendFileSync(file, `[${stamp}] [${level.toUpperCase()}] ${msg}\n`, 'utf-8');
    } catch {}
  }

  // ── 缓存统计 / 清理 ───────────────────────────────────────────
  private dirSize(dir: string): number {
    let total = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        try {
          const st = fs.statSync(p);
          if (st.isDirectory()) total += this.dirSize(p);
          else total += st.size;
        } catch {}
      }
    } catch {}
    return total;
  }

  cacheInfo(): { path: string; size: number } {
    return { path: this.cacheRoot, size: this.dirSize(this.cacheRoot) };
  }

  /** 清理整个缓存目录（保留目录结构；正在传输的分片会一并删除，由 UI 二次确认后调用） */
  clearCache(): void {
    for (const d of [this.partsDir, this.voiceDir, this.logDir]) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        try {
          if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
          else fs.unlinkSync(p);
        } catch {}
      }
    }
    for (const name of CACHE_NAMES) {
      try { fs.unlinkSync(this.p(name)); } catch {}
    }
    this.log('info', '缓存已清理: ' + this.cacheRoot);
  }
}

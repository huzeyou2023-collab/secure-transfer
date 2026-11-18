/**
 * 本机网络信息：固定 IPv6、公网 IPv4、本机 IPv4/IPv6 列表
 * - 固定 IPv6：优先取全局单播、排除临时地址 / 隧道 / 链路本地 / ULA
 * - 公网 IPv4：走 http 探测（带缓存，失败静默降级为空字符串）
 */
import * as os from 'os';
import * as http from 'http';
import { execFileSync } from 'child_process';

export interface NetworkInfo {
  /** 固定（首选）全局 IPv6，取不到时为空串 */
  fixedIpv6: string;
  /** 全部全局 IPv6（不含链路本地） */
  ipv6: string[];
  /** 公网 IPv4，取不到时为空串 */
  publicIpv4: string;
  /** 本机 IPv4（局域网地址） */
  localIpv4: string[];
  /** 公网 IPv4 的获取时间戳（0 表示未取到） */
  publicIpv4At: number;
}

interface NetshAddr {
  iface: string;
  type: string;
  address: string;
}

/** 读取 `netsh interface ipv6 show addresses`，用于区分 Public / Temporary */
function readNetshAddrs(): NetshAddr[] {
  let text = '';
  try {
    text = execFileSync('netsh', ['interface', 'ipv6', 'show', 'addresses'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
  } catch {
    return [];
  }
  const out: NetshAddr[] = [];
  let iface = '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^Interface\s+\d+:\s*(.+?)\s*$/.exec(line);
    if (m) { iface = m[1]; continue; }
    const a = /^\s*(\w+)\s+(?:Preferred|Deprecated|Tentative|Duplicate)\s+\S+\s+\S+\s+([0-9a-fA-F:%]+)\s*$/.exec(line);
    if (a) out.push({ iface, type: a[1], address: a[2].split('%')[0] });
  }
  return out;
}

function isGlobalV6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (!a.includes(':')) return false;
  if (a === '::1') return false;
  if (a.startsWith('fe80')) return false;      // 链路本地
  if (a.startsWith('::ffff:')) return false;   // IPv4 映射
  if (a.startsWith('2001:0:')) return false;   // Teredo
  if (a.startsWith('2002:')) return false;     // 6to4
  return true;
}

function isPublicV6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (!isGlobalV6(a)) return false;
  // 2xxx/3xxx 为公网全局单播；fc/fd 为 ULA（非公网）
  return /^[23]/.test(a) && !a.startsWith('fc') && !a.startsWith('fd');
}

function collectLocal(): { ipv4: string[]; ipv6: string[] } {
  const ipv4: string[] = [];
  const ipv6: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const a of iface) {
      if (a.internal) continue;
      if (a.family === 'IPv4') {
        if (!a.address.startsWith('169.254.')) ipv4.push(a.address);
      } else if (a.family === 'IPv6') {
        if (isGlobalV6(a.address)) ipv6.push(a.address);
      }
    }
  }
  return { ipv4: dedupe(ipv4), ipv6: dedupe(ipv6) };
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

/** 固定 IPv6：Public 类型 > 任意全局；排除临时地址、Teredo、Hyper-V 虚拟网卡 */
function detectFixedIpv6(): { fixed: string; all: string[] } {
  const addrs = readNetshAddrs();
  const real = addrs.filter((a) => !/teredo|loopback|isatap/i.test(a.iface) && isGlobalV6(a.address));
  const local = collectLocal();
  const fromOs = local.ipv6;

  const publicV6 = real.filter((a) => a.type === 'Public' && isPublicV6(a.address));
  const preferred = publicV6[0]?.address
    || real.filter((a) => a.type === 'Public')[0]?.address
    || addrs.find((a) => a.type === 'Public' && isGlobalV6(a.address))?.address
    || fromOs.find(isPublicV6)
    || fromOs[0]
    || '';

  const all = dedupe([...fromOs, ...real.map((a) => a.address)]);
  return { fixed: preferred, all };
}

// ── 公网 IPv4（http 探测 + 缓存） ─────────────────────────────
const PUBLIC_ENDPOINTS = [
  'http://ipv4.icanhazip.com/',
  'http://api.ipify.org/',
  'http://ipv4.ident.me/',
];
const PUBLIC_TTL = 10 * 60 * 1000;
const PUBLIC_FAIL_TTL = 60 * 1000;
let publicCache: { value: string; at: number } = { value: '', at: 0 };

function httpGetText(url: string, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs, family: 4 as any, headers: { 'User-Agent': 'SecureTransfer/5.0' } }, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 256) res.destroy(); });
      res.on('end', () => resolve(body.trim()));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchPublicIpv4(): Promise<string> {
  for (const url of PUBLIC_ENDPOINTS) {
    try {
      const text = (await httpGetText(url)).split('\n')[0].trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text;
    } catch {
      /* 换下一个探测源 */
    }
  }
  return '';
}

export async function getNetworkInfo(): Promise<NetworkInfo> {
  const { fixed, all } = detectFixedIpv6();
  const local = collectLocal();

  const now = Date.now();
  const age = now - publicCache.at;
  const ttl = publicCache.value ? PUBLIC_TTL : PUBLIC_FAIL_TTL;
  if (!publicCache.at || age > ttl) {
    const v = await fetchPublicIpv4();
    publicCache = { value: v, at: Date.now() };
  }

  return {
    fixedIpv6: fixed,
    ipv6: dedupe([...all, ...local.ipv6]).filter(isGlobalV6),
    publicIpv4: publicCache.value,
    localIpv4: local.ipv4,
    publicIpv4At: publicCache.value ? publicCache.at : 0,
  };
}

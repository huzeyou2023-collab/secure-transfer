/**
 * 局域网发现：UDP 多播 + 子网广播，周期性心跳；在线状态交给加密会话层判定。
 */
import * as dgram from 'dgram';
import * as os from 'os';
import { uuidv4 } from '../util';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Peer } from './types';

const MULTICAST_GROUP = '239.255.70.83';
const DISCOVERY_PORT = 42813;
const ANNOUNCE_INTERVAL = 2000;
const PEER_TTL = 10_000;

function dataDir(): string {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('userData');
  } catch {}
  return path.join(os.homedir(), '.secure-transfer');
}

function getOrCreatePeerId(): string {
  const idFile = path.join(dataDir(), 'peer-id');
  try {
    const existing = fs.readFileSync(idFile, 'utf-8').trim();
    if (existing) return existing;
  } catch {}
  fs.mkdirSync(dataDir(), { recursive: true });
  const id = uuidv4();
  fs.writeFileSync(idFile, id, 'utf-8');
  return id;
}

function hostName(): string {
  return os.hostname().replace(/\.local$/, '');
}

function ipv4s(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const a of iface) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function broadcasts(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const a of iface) {
      if (a.family === 'IPv4' && !a.internal && a.netmask) {
        const ip = a.address.split('.').map(Number);
        const mask = a.netmask.split('.').map(Number);
        out.push(ip.map((b, i) => b | (~mask[i] & 255)).join('.'));
      }
    }
  }
  return out;
}

interface Announce {
  v: number;
  id: string;
  name: string;
  port: number;
}

export class DiscoveryService extends EventEmitter {
  readonly selfId: string = getOrCreatePeerId();
  readonly selfName: string = hostName();
  private port = 0;
  private peers = new Map<string, Peer & { lastSeen: number }>();
  private socket: dgram.Socket | null = null;
  private destroyed = false;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  publish(port: number): void {
    this.port = port;
  }

  start(): void {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = sock;

    sock.on('message', (buf, rinfo) => {
      try {
        const msg = JSON.parse(buf.toString()) as Announce;
        if (msg.v !== 4 || msg.id === this.selfId) return;
        this.onAnnounce(msg, rinfo.address);
      } catch {}
    });

    sock.on('error', (err) => {
      console.error('discovery error:', err.message);
      if (!this.destroyed) {
        try { sock.close(); } catch {}
        setTimeout(() => this.start(), 3000);
      }
    });

    sock.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      for (const addr of ipv4s()) {
        try { sock.addMembership(MULTICAST_GROUP, addr); } catch {}
      }
      try { sock.setBroadcast(true); } catch {}
      this.sendAnnounce();
      this.announceTimer = setInterval(() => this.sendAnnounce(), ANNOUNCE_INTERVAL);
      this.announceTimer.unref?.();
      this.sweepTimer = setInterval(() => this.sweep(), 3000);
      this.sweepTimer.unref?.();
    });
  }

  private sendAnnounce(): void {
    if (!this.socket || this.port === 0) return;
    const pkt = Buffer.from(JSON.stringify({
      v: 4, id: this.selfId, name: this.selfName, port: this.port,
    } satisfies Announce));
    this.socket.send(pkt, 0, pkt.length, DISCOVERY_PORT, MULTICAST_GROUP, () => {});
    for (const b of broadcasts()) {
      this.socket.send(pkt, 0, pkt.length, DISCOVERY_PORT, b, () => {});
    }
  }

  private onAnnounce(msg: Announce, host: string): void {
    const existing = this.peers.get(msg.id);
    if (!existing || existing.host !== host || existing.port !== msg.port) {
      this.peers.set(msg.id, {
        id: msg.id, name: msg.name, host, port: msg.port, lastSeen: Date.now(),
      });
      this.emit('peers', this.getLanPeers());
    } else {
      existing.lastSeen = Date.now();
    }
  }

  private sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > PEER_TTL) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('peers', this.getLanPeers());
  }

  getLanPeers(): Peer[] {
    return Array.from(this.peers.values()).map((p) => ({
      id: p.id, name: p.name, host: p.host, port: p.port,
    }));
  }

  destroy(): void {
    this.destroyed = true;
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.socket) try { this.socket.close(); } catch {}
  }
}


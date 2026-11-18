import React, { useState, useMemo, useEffect } from 'react';
import { useContacts, useChat, useTransfers } from './hooks';
import { ChatView } from './components/ChatView';
import { IncomingAlert } from './components/IncomingAlert';
import { SettingsView } from './components/SettingsView';
import { applyAppearance, normalizeAppearance } from './appearance';
import { setAmbientInfo } from './shadowfx';
import { installRipple } from './ripple';
import { getInitials, getAvatarGradient } from './services/device';
import type { Contact, NetworkInfo, SendKeyMode } from './types';

const ContactRow: React.FC<{
  c: Contact;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}> = ({ c, active, onSelect, onRemove }) => {
  const lan = c.lan;
  const stateText = c.online ? '在线' : c.connecting ? '连接中…' : '离线';
  const stateCls = c.online ? 'on' : c.connecting ? 'connecting' : 'off';
  return (
    <div className={`contact-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <div className="avatar" style={{ background: getAvatarGradient(c.name) }}>
        {getInitials(c.name)}
      </div>
      <div className="contact-info">
        <div className="contact-name">{c.name}
          {lan && <span className="lan-tag">局域网</span>}
        </div>
        <div className={`contact-state ${stateCls}`}>
          <span className="dot" />{stateText}
        </div>
      </div>
      {onRemove && (
        <button
          className="btn btn-sm btn-ghost contact-del"
          title="删除好友"
          onClick={(e) => { e.stopPropagation(); if (confirm(`删除好友 ${c.name}？`)) onRemove(); }}
        >×</button>
      )}
    </div>
  );
};

const AddFriend: React.FC<{ onAdded: () => void }> = ({ onAdded }) => {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('42815');
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!host.trim()) return;
    const r = await window.api.addFriend(host.trim(), Number(port) || 42815);
    if (r.success) {
      setOpen(false);
      setHost('');
      setErr('');
      onAdded();
    } else {
      setErr(r.error || '配对失败');
    }
  };

  if (!open) {
    return <button className="btn glass-btn btn-add" onClick={() => setOpen(true)}>＋ 添加好友（IP:端口）</button>;
  }
  return (
    <div className="add-box">
      <div className="add-row">
        <input
          className="form-control form-control-sm"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="对方 IP 地址（IPv4 / IPv6）"
          autoFocus
        />
      </div>
      <div className="add-row">
        <input
          className="form-control form-control-sm port-input"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="端口"
        />
        <button className="btn btn-sm btn-primary" onClick={submit}>配对</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setOpen(false)}>取消</button>
      </div>
      {err && <div className="add-err">{err}</div>}
    </div>
  );
};

/** macOS 风格交通灯符号（悬停显示） */
const LightGlyph: React.FC<{ kind: 'close' | 'min' | 'max'; restored?: boolean }> = ({ kind, restored }) => {
  if (kind === 'close') {
    return (
      <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3.3 3.3l5.4 5.4M8.7 3.3L3.3 8.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  if (kind === 'min') {
    return (
      <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.7 6h6.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  // 绿色按钮：窗口化时是放大（朝外），全屏时变为缩小（朝内），与 macOS 一致
  return restored ? (
    <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M9.3 2.7L6.4 5.6v-2.9h2.9Z" fill="currentColor" />
      <path d="M2.7 9.3l2.9-2.9v2.9H2.7Z" fill="currentColor" />
    </svg>
  ) : (
    <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.7 9.3V6.1L5.9 9.3H2.7Z" fill="currentColor" />
      <path d="M9.3 2.7v3.2L6.1 2.7h3.2Z" fill="currentColor" />
    </svg>
  );
};

export default function App() {
  const { contacts, self, refreshSelf } = useContacts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { messages, sendText } = useChat(selectedId);
  const { transfers, offer, respond } = useTransfers();
  const [showSettings, setShowSettings] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [runtime, setRuntime] = useState<{ version: string; isPortable: boolean }>({ version: '', isPortable: false });
  const [sendKey, setSendKey] = useState<SendKeyMode>('enter');
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [copied, setCopied] = useState('');
  const [hasNet, setHasNet] = useState(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

  useEffect(() => {
    const on = () => setHasNet(true);
    const off = () => setHasNet(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    window.api.onWindowState?.(setMaximized);
    return () => window.api.removeAllListeners('window:state');
  }, []);

  // 苹果式点击水波（委托到所有悬浮玻璃交互元素）
  useEffect(() => installRipple(), []);

  // 透明边距/阴影区域点击穿透：鼠标在 UI 外时忽略鼠标事件，点击可落到下层窗口
  useEffect(() => {
    let ignored = false;
    const setIg = (v: boolean) => {
      if (v === ignored) return;
      ignored = v;
      try { (window.api as any).setIgnoreMouse?.(v); } catch { /* 忽略 */ }
    };
    const onMove = (e: MouseEvent) => {
      const app = document.querySelector('.app-root');
      if (!app) return;
      const r = app.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      setIg(!inside);
    };
    window.addEventListener('mousemove', onMove);
    const onLeave = () => setIg(true);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const toggleAlwaysOnTop = async () => {
    try {
      const r = await (window.api as any).windowAction('toggle-always-on-top');
      if (r && typeof r.alwaysOnTop === 'boolean') setAlwaysOnTop(r.alwaysOnTop);
    } catch { /* 忽略 */ }
  };

  useEffect(() => {
    const api = window.api as any;
    api.getRuntimeInfo().then((r: any) => {
      applyAppearance(normalizeAppearance(r.settings?.appearance));
      setRuntime({ version: r.version || '', isPortable: !!r.isPortable });
      setSendKey(r.settings?.sendKey === 'shift-enter' ? 'shift-enter' : 'enter');
    });
    const loadNet = () => {
      api.getNetworkInfo().then((n: NetworkInfo) => setNet(n)).catch(() => { /* 忽略 */ });
    };
    loadNet();
    const timer = setInterval(loadNet, 60_000);
    return () => clearInterval(timer);
  }, []);

  // 环境光采样（桌面背景色 / 亮度 / 光照传感器）→ 物理光影
  useEffect(() => {
    const api = window.api as any;
    let alive = true;
    const load = () => {
      api.getAmbientInfo?.().then((a: any) => { if (alive && a) setAmbientInfo(a); }).catch(() => { /* 忽略 */ });
    };
    load();
    const timer = setInterval(load, 9000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const copy = async (label: string, value: string) => {
    if (!value) return;
    try {
      await (window.api as any).copyText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      /* 忽略 */
    }
  };

  const selected = contacts.find((c) => c.id === selectedId) || null;

  // 顶层状态：本机网络是否可用（没有网络时显示离线）
  const networkOnline = hasNet && (!net || net.localIpv4.length > 0 || net.ipv6.length > 0);

  const friends = useMemo(() => contacts.filter((c) => !c.lan), [contacts]);
  const lan = useMemo(() => contacts.filter((c) => c.lan), [contacts]);

  const sendFile = (filePath: string) => {
    if (selectedId) window.api.sendFile(selectedId, filePath);
  };

  return (
    <div className={`app-root ${maximized ? 'maximized' : ''}`}>
      <div className="window-bar">
        <div className="traffic">
          <button className="light close" title="关闭" aria-label="关闭" onClick={() => window.api.windowAction('close')}>
            <LightGlyph kind="close" />
          </button>
          <button className="light min" title="最小化" aria-label="最小化" onClick={() => window.api.windowAction('minimize')}>
            <LightGlyph kind="min" />
          </button>
          <button className="light max" title={maximized ? '退出全屏' : '全屏'} aria-label={maximized ? '退出全屏' : '全屏'} onClick={() => window.api.windowAction('maximize')}>
            <LightGlyph kind="max" restored={maximized} />
          </button>
        </div>
        <div className="window-title">安全传输</div>
        <button
          className={`pin-btn glass-btn ${alwaysOnTop ? 'active' : ''}`}
          onClick={toggleAlwaysOnTop}
          title={alwaysOnTop ? '取消置顶' : '窗口置顶'}
          aria-label={alwaysOnTop ? '取消置顶' : '窗口置顶'}
        >📌</button>
        <div className={`window-status ${networkOnline ? 'online' : ''}`} title={networkOnline ? '网络已连接' : '网络未连接'}>
          <span className="dot" />{networkOnline ? '在线' : '离线'}
        </div>
        <button className="settings-btn glass-btn" onClick={() => setShowSettings(true)} title="设置"><span className="settings-gear">⚙</span></button>
      </div>
      <div className="app-body">
        <div className="sidebar glass-panel">
          <div className="brand">
            <div
              className="avatar self-avatar"
              style={self.avatar ? { backgroundImage: `url(${self.avatar})`, backgroundSize: 'cover' } : { background: getAvatarGradient(self.name) }}
              title="我的头像（在设置中修改）"
            >{!self.avatar && getInitials(self.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="brand-name">{self.name}</div>
              <div className="brand-sub ips" title={(self.ips || []).join(' · ')}>
                {(self.ips || []).slice(0, 2).join(' · ')}
              </div>
            </div>
          </div>
          <AddFriend onAdded={() => {}} />
          <div className="contact-list">
            {friends.map((c) => (
              <ContactRow
                key={c.id}
                c={c}
                active={selectedId === c.id}
                onSelect={() => setSelectedId(c.id)}
                onRemove={() => {
                  window.api.removeFriend(c.id);
                  if (selectedId === c.id) setSelectedId(null);
                }}
              />
            ))}
            {lan.length > 0 && <div className="list-section">局域网设备</div>}
            {lan.map((c) => (
              <ContactRow
                key={c.id}
                c={c}
                active={selectedId === c.id}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
            {friends.length === 0 && lan.length === 0 && (
              <div className="no-devices">
                同一网络下的设备会自动出现在这里；<br />也可以输入对方的 IP 直接添加。
              </div>
            )}
          </div>

          {/* 本机网络地址（点击整行复制） */}
          <div className="sidebar-net">
            <button
              className={`net-row ${copied === 'ipv6' ? 'copied' : ''}`}
              onClick={() => copy('ipv6', net?.fixedIpv6 || '')}
              title={net?.fixedIpv6 ? `固定 IPv6：${net.fixedIpv6}（点击复制）` : '正在检测本机固定 IPv6…'}
            >
              <span className="net-label">固定 IPv6</span>
              <span className="net-value mono">{net?.fixedIpv6 || '检测中…'}</span>
              <span className="net-action">{copied === 'ipv6' ? '已复制' : '复制'}</span>
            </button>
            <button
              className={`net-row ${copied === 'pub' ? 'copied' : ''}`}
              onClick={() => copy('pub', net?.publicIpv4 || '')}
              title={net?.publicIpv4 ? `公网 IPv4：${net.publicIpv4}（点击复制）` : '无法获取公网 IPv4（可能无外网）'}
            >
              <span className="net-label">公网 IPv4</span>
              <span className="net-value mono">{net?.publicIpv4 || (net ? '未获取' : '检测中…')}</span>
              <span className="net-action">{copied === 'pub' ? '已复制' : '复制'}</span>
            </button>
            <button
              className={`net-row ${copied === 'lan' ? 'copied' : ''}`}
              onClick={() => copy('lan', (net?.localIpv4 || []).join(', '))}
              title={(net?.localIpv4 || []).join(' · ') || '未检测到局域网 IPv4'}
            >
              <span className="net-label">本机 IPv4</span>
              <span className="net-value mono">{net?.localIpv4?.slice(0, 2).join(' · ') || '检测中…'}</span>
              <span className="net-action">{copied === 'lan' ? '已复制' : '复制'}</span>
            </button>
          </div>

          <div className="sidebar-footer">
            <span className="ver-tag">{runtime.version || 'v5.1.5.0'}</span>
            <span className={`mode-tag ${runtime.isPortable ? 'portable' : ''}`}>
              {runtime.isPortable ? '便携版' : '安装版'}
            </span>
          </div>
        </div>

        <div className="main-pane glass-panel">
          {selected ? (
            <ChatView
              contact={selected}
              messages={messages}
              transfers={transfers}
              sendKeyMode={sendKey}
              onBack={() => setSelectedId(null)}
              onSend={(t) => sendText(selected.id, t)}
              onFile={sendFile}
              onConnect={(id) => (window.api as any).connectPeer(id)}
            />
          ) : (
            <div className="empty-pane">
              <div className="empty-logo">盾</div>
              <div className="empty-title">选择一个好友，开始聊天</div>
              <div className="empty-sub">文字和文件都能发，原图原文件无损传输</div>
            </div>
          )}
        </div>
      </div>
      <IncomingAlert offer={offer} onRespond={respond} />
      {showSettings && (
        <SettingsView
          self={self}
          onClose={() => setShowSettings(false)}
          onProfileSaved={refreshSelf}
          onSendKeyChange={(mode) => setSendKey(mode)}
        />
      )}
    </div>
  );
}












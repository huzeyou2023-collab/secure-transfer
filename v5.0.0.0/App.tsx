import React, { useState, useMemo, useEffect } from 'react';
import { useContacts, useChat, useTransfers } from './hooks';
import { ChatView } from './components/ChatView';
import { IncomingAlert } from './components/IncomingAlert';
import { SettingsView } from './components/SettingsView';
import { applyAppearance, normalizeAppearance } from './appearance';
import { getInitials, getAvatarGradient } from './services/device';
import type { Contact, NetworkInfo } from './types';

const ContactRow: React.FC<{
  c: Contact;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}> = ({ c, active, onSelect, onRemove }) => {
  const lan = c.lan;
  return (
    <div className={`contact-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <div className="avatar" style={{ background: getAvatarGradient(c.name) }}>
        {getInitials(c.name)}
      </div>
      <div className="contact-info">
        <div className="contact-name">{c.name}
          {lan && <span className="lan-tag">局域网</span>}
        </div>
        <div className={`contact-state ${c.online ? 'on' : 'off'}`}>
          <span className="dot" />{c.online ? '在线' : '离线'}
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
          placeholder="对方 IP 地址（IPv4 / IPv6）"
          autoFocus
        />
      </div>
      <div className="add-row">
        <input
          className="form-control form-control-sm port-input"
          value={port}
          onChange={(e) => setPort(e.target.value)}
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
const LightGlyph: React.FC<{ kind: 'close' | 'min' | 'max' }> = ({ kind }) => {
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
  return (
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
  const [runtime, setRuntime] = useState<{ version: string; isPortable: boolean }>({ version: '', isPortable: false });
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    window.api.onWindowState?.(setMaximized);
    return () => window.api.removeAllListeners('window:state');
  }, []);

  useEffect(() => {
    const api = window.api as any;
    api.getRuntimeInfo().then((r: any) => {
      applyAppearance(normalizeAppearance(r.settings?.appearance));
      setRuntime({ version: r.version || '', isPortable: !!r.isPortable });
    });
    const loadNet = () => {
      api.getNetworkInfo().then((n: NetworkInfo) => setNet(n)).catch(() => { /* 忽略 */ });
    };
    loadNet();
    const timer = setInterval(loadNet, 60_000);
    return () => clearInterval(timer);
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
          <button className="light max" title="最大化 / 还原" aria-label="最大化" onClick={() => window.api.windowAction('maximize')}>
            <LightGlyph kind="max" />
          </button>
        </div>
        <div className="window-title">安全传输</div>
        <div className={`window-status ${contacts.some((c) => c.online) ? 'online' : ''}`}>
          <span className="dot" />{contacts.some((c) => c.online) ? '已连接' : '待连接'}
        </div>
        <button className="settings-btn glass-btn" onClick={() => setShowSettings(true)} title="设置">⚙</button>
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
                同一局域网的设备会自动出现在这里；<br />也可输入对方公网 IP 直接配对。
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
            <span className="ver-tag">{runtime.version || 'v5.0.0.0'}</span>
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
              onBack={() => setSelectedId(null)}
              onSend={(t) => sendText(selected.id, t)}
              onFile={sendFile}
            />
          ) : (
            <div className="empty-pane">
              <div className="empty-logo">盾</div>
              <div className="empty-title">选择一位好友开始安全传输</div>
              <div className="empty-sub">文字、文件均端到端加密；文件原始无损传输</div>
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
        />
      )}
    </div>
  );
}

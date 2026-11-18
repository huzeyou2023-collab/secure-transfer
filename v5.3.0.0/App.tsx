import React, { useState, useMemo, useEffect } from 'react';
import { useContacts, useChat, useTransfers, useFriendRequests } from './hooks';
import { ChatView } from './components/ChatView';
import { SettingsView } from './components/SettingsView';
import { AddFriendModal } from './components/AddFriendModal';
import { FriendRequestModal } from './components/FriendRequestModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { IntroOverlay } from './components/IntroOverlay';
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
  const addr = `${c.host}:${c.port}`;
  const [addrCopied, setAddrCopied] = useState(false);
  const copyAddr = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!addr) return;
    try {
      await (window.api as any).copyText(addr);
      setAddrCopied(true);
      window.setTimeout(() => setAddrCopied(false), 1600);
    } catch { /* 忽略 */ }
  };
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
          <span className="contact-addr" title={`连接地址 ${addr}（点击复制）`}>{addr}</span>
          <button
            className={`addr-copy ${addrCopied ? 'copied' : ''}`}
            title={addrCopied ? '已复制' : '复制连接地址'}
            aria-label="复制连接地址"
            onClick={copyAddr}
          >
            {addrCopied ? '✓' : (
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <rect x="3.6" y="3.6" width="7" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
                <path d="M1.4 8.4V2.8A1.4 1.4 0 0 1 2.8 1.4h5.6" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {onRemove && (
        <button
          className="btn btn-sm btn-ghost contact-del"
          title="删除好友"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
        >×</button>
      )}
    </div>
  );
};

/** macOS 风格交通灯符号（悬停显示，SVG 描边） */
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
  // 绿色按钮：窗口化时两个箭头朝外（放大）；全屏/最大化后两个箭头朝内（缩小），与 macOS 一致
  return restored ? (
    <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M9.2 2.8H6.5M9.2 2.8v2.7M9.2 2.8L5.9 6.1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M2.8 9.2h2.7M2.8 9.2V6.5M2.8 9.2l3.3-3.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ) : (
    <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.8 2.8h2.7M2.8 2.8v2.7M2.8 2.8l3.3 3.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M9.2 9.2H6.5M9.2 9.2V6.5M9.2 9.2L5.9 5.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
};

export default function App() {
  const { contacts, self, refreshSelf } = useContacts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { messages, sendText } = useChat(selectedId);
  const { transfers } = useTransfers();
  const { requests, respond: respondRequest } = useFriendRequests();
  const [showSettings, setShowSettings] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Contact | null>(null);
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
      setShowIntro(!r.settings?.onboardingDone);
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
          <button className="light max" title={maximized ? '还原' : '最大化'} aria-label={maximized ? '还原' : '最大化'} onClick={() => window.api.windowAction('maximize')}>
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
          <div className="add-row">
            <button className="btn glass-btn btn-add" onClick={() => setShowAddFriend(true)}>＋ 添加好友</button>
            <button
              className={`btn glass-btn btn-requests ${requests.length ? 'has-req' : ''}`}
              onClick={() => setShowRequests(true)}
              title="好友申请列表"
            >
              申请列表
              {requests.length > 0 && <span className="req-badge">{requests.length}</span>}
            </button>
          </div>
          <div className="contact-list">
            {friends.map((c) => (
              <ContactRow
                key={c.id}
                c={c}
                active={selectedId === c.id}
                onSelect={() => setSelectedId(c.id)}
                onRemove={() => setRemoveTarget(c)}
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
            <span className="ver-tag">{runtime.version || 'v5.3.0.0'}</span>
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
      <AddFriendModal
        open={showAddFriend}
        onClose={() => setShowAddFriend(false)}
        onAdded={() => {}}
      />
      <FriendRequestModal
        open={showRequests}
        requests={requests}
        onRespond={respondRequest}
        onClose={() => setShowRequests(false)}
      />
      <ConfirmDialog
        open={!!removeTarget}
        danger
        title={`删除好友「${removeTarget?.name || ''}」？`}
        description="将解除与对方的配对，并清除本机保存的该好友信息；聊天记录仍保留在本机。"
        confirmText="删除"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) {
            window.api.removeFriend(removeTarget.id);
            if (selectedId === removeTarget.id) setSelectedId(null);
          }
          setRemoveTarget(null);
        }}
      />
      {showSettings && (
        <SettingsView
          self={self}
          onClose={() => setShowSettings(false)}
          onProfileSaved={refreshSelf}
          onSendKeyChange={(mode) => setSendKey(mode)}
        />
      )}
      {showIntro && (
        <IntroOverlay
          onDone={() => {
            setShowIntro(false);
            window.api.setSettings({ onboardingDone: true });
          }}
        />
      )}
    </div>
  );
}

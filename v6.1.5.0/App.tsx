import React, { useState, useMemo, useEffect } from 'react';
import { useContacts, useChat, useTransfers, useFriendRequests } from './hooks';
import { ChatView } from './components/ChatView';
import { SettingsView } from './components/SettingsView';
import { AddFriendModal } from './components/AddFriendModal';
import { FriendRequestModal } from './components/FriendRequestModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { IntroOverlay } from './components/IntroOverlay';
import { EncSetupModal } from './components/EncSetupModal';
import { applyAppearance, normalizeAppearance } from './appearance';
import { setAmbientInfo } from './shadowfx';
import { installRipple } from './ripple';
import { getInitials, getAvatarGradient } from './services/device';
import { ShieldGlyph, Icon } from './components/Icons';
import type { Contact, NetworkInfo, SendKeyMode, EncryptionStrength, FileProgress } from './types';
import { DEFAULT_ENCRYPTION_STRENGTH } from './types';

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
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
        >×</button>
      )}
    </div>
  );
};

/** 苹果式双实心黑三角（最大化 / 还原）：主对角线排列（左上↖ + 右下↘），黑色不随主题变化 */
const MaxGlyph: React.FC<{ restored?: boolean; size?: number; className?: string }> = ({ restored, size = 9, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    {restored ? (
      <>
        <path d="M5.4 5.4 1.2 5.4 5.4 1.2Z" fill="#1b1b1b" stroke="none" />
        <path d="M6.6 6.6 10.8 6.6 6.6 10.8Z" fill="#1b1b1b" stroke="none" />
      </>
    ) : (
      <>
        <path d="M1.2 5.4 1.2 1.2 5.4 1.2Z" fill="#1b1b1b" stroke="none" />
        <path d="M6.6 10.8 10.8 10.8 10.8 6.6Z" fill="#1b1b1b" stroke="none" />
      </>
    )}
  </svg>
);

/** macOS 红绿灯符号（悬停显示）：叉 / 横线用黑色描边，最大化用黑色双三角，均不随深色主题变色 */
const LightGlyph: React.FC<{ kind: 'close' | 'min' | 'max'; restored?: boolean }> = ({ kind, restored }) => {
  if (kind === 'close') {
    return (
      <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3.3 3.3l5.4 5.4M8.7 3.3L3.3 8.7" stroke="#1b1b1b" strokeWidth="1.35" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  if (kind === 'min') {
    return (
      <svg className="light-glyph" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.7 6h6.6" stroke="#1b1b1b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return <MaxGlyph restored={restored} className="light-glyph" />;
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
  /** 首次介绍页跳过后弹出「是否设置密钥」 */
  const [showEncSetup, setShowEncSetup] = useState(false);
  const [hasEncSecret, setHasEncSecret] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Contact | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [runtime, setRuntime] = useState<{ version: string; isPortable: boolean }>({ version: '', isPortable: false });
  const [sendKey, setSendKey] = useState<SendKeyMode>('enter');
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [copied, setCopied] = useState('');
  const [hasNet, setHasNet] = useState(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  /** 本机全局加密强度（聊天页与对方强度对比） */
  const [myStrength, setMyStrength] = useState<EncryptionStrength>(DEFAULT_ENCRYPTION_STRENGTH);
  /** 窗口控制键模式：mac 红绿灯 / win 系统三键 */
  const [winControls, setWinControls] = useState<'mac' | 'win'>('mac');
  /** 传输中心（断点续传与进行中传输）面板开关 */
  const [transferCenterOpen, setTransferCenterOpen] = useState(false);

  const activeTransfers = transfers.filter((t) => t.status === 'waiting' || t.status === 'transferring');
  const finishedTransfers = transfers.filter((t) => t.status === 'done' || t.status === 'failed' || t.status === 'rejected').slice(-5);

  const tcStatusText = (t: FileProgress): string => {
    if (t.status === 'transferring') return `${t.percent}%`;
    if (t.status === 'done') return '已完成';
    if (t.status === 'waiting') return t.error || '等待续传';
    return t.error || '失败';
  };

  useEffect(() => {
    (window.api as any).getCryptoInfo?.().then((c: any) => {
      if (c && c.strength) setMyStrength(c.strength);
    }).catch(() => { /* 忽略 */ });
  }, []);

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
    (window.api as any).onWindowTop?.(setAlwaysOnTop);
    return () => {
      window.api.removeAllListeners('window:state');
      window.api.removeAllListeners('window:top');
    };
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
      const appearance = normalizeAppearance(r.settings?.appearance);
      applyAppearance(appearance);
      setWinControls(appearance.windowControls);
      setRuntime({ version: r.version || '', isPortable: !!r.isPortable });
      setSendKey(r.settings?.sendKey === 'shift-enter' ? 'shift-enter' : 'enter');
      setShowIntro(!r.settings?.onboardingDone);
      setHasEncSecret(!!r.settings?.hasEncSecret);
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

  const sendFile = async (filePath: string): Promise<boolean> => {
    if (!selectedId) return false;
    const r = await window.api.sendFile(selectedId, filePath);
    return !!r?.success;
  };

  return (
    <div className={`app-root ${maximized ? 'maximized' : ''}`}>
      {/* 透明窗口：边缘自绘缩放手柄（拖动调整窗口大小；最大化/全屏时不渲染） */}
      {!maximized && (
        <>
          {(['nw', 'ne', 'sw', 'se', 'e', 's', 'w'] as const).map((edge) => (
            <div
              key={edge}
              className={`resize-zone ${edge}`}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                (window.api as any).windowResizeStart?.(edge);
                const end = () => { (window.api as any).windowResizeEnd?.(); window.removeEventListener('mouseup', end); };
                window.addEventListener('mouseup', end);
              }}
            />
          ))}
        </>
      )}
      <div className={`window-bar ${winControls === 'win' ? 'win-controls' : ''}`}>
        {winControls === 'mac' && (
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
        )}
        {winControls === 'win' && (
          <div className="win-tools">
            <button className="settings-btn glass-btn" onClick={() => setShowSettings(true)} title="设置"><span className="settings-gear">⚙</span></button>
            <div className={`window-status ${networkOnline ? 'online' : ''}`} title={networkOnline ? '网络已连接' : '网络未连接'}>
              <span className="dot" />{networkOnline ? '在线' : '离线'}
            </div>
            <button
              className={`transfer-btn glass-btn ${transferCenterOpen ? 'active' : ''}`}
              onClick={() => setTransferCenterOpen((v) => !v)}
              title="传输中心（断点续传与进行中的传输）"
              aria-label="传输中心"
            >
              <Icon name="resume" size={18} />
              {activeTransfers.length > 0 && <span className="transfer-badge">{activeTransfers.length}</span>}
            </button>
            <button
              className={`pin-btn glass-btn ${alwaysOnTop ? 'active' : ''}`}
              onClick={toggleAlwaysOnTop}
              title={alwaysOnTop ? '取消置顶' : '窗口置顶'}
              aria-label={alwaysOnTop ? '取消置顶' : '窗口置顶'}
            >📌</button>
          </div>
        )}
        <div className="window-title">安全传输</div>
        {winControls === 'mac' && (
          <>
            <button
              className={`pin-btn glass-btn ${alwaysOnTop ? 'active' : ''}`}
              onClick={toggleAlwaysOnTop}
              title={alwaysOnTop ? '取消置顶' : '窗口置顶'}
              aria-label={alwaysOnTop ? '取消置顶' : '窗口置顶'}
            >📌</button>
            <button
              className={`transfer-btn glass-btn ${transferCenterOpen ? 'active' : ''}`}
              onClick={() => setTransferCenterOpen((v) => !v)}
              title="传输中心（断点续传与进行中的传输）"
              aria-label="传输中心"
            >
              <Icon name="resume" size={18} />
              {activeTransfers.length > 0 && <span className="transfer-badge">{activeTransfers.length}</span>}
            </button>
            <div className={`window-status ${networkOnline ? 'online' : ''}`} title={networkOnline ? '网络已连接' : '网络未连接'}>
              <span className="dot" />{networkOnline ? '在线' : '离线'}
            </div>
            <button className="settings-btn glass-btn" onClick={() => setShowSettings(true)} title="设置"><span className="settings-gear">⚙</span></button>
          </>
        )}
        {/* Windows 模式：右上角自绘三键（— □ ×），与 mac 红绿灯共用一套最大化/还原逻辑 */}
        {winControls === 'win' && (
          <div className="win-keys">
            <button className="wkey wkey-min" title="最小化" aria-label="最小化" onClick={() => window.api.windowAction('minimize')}>
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6h7.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" /></svg>
            </button>
            <button className="wkey wkey-max" title={maximized ? '还原' : '最大化'} aria-label={maximized ? '还原' : '最大化'} onClick={() => window.api.windowAction('maximize')}>
              <MaxGlyph restored={maximized} size={13} />
            </button>
            <button className="wkey wkey-close" title="关闭" aria-label="关闭" onClick={() => window.api.windowAction('close')}>
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 3.4l5.2 5.2M8.6 3.4L3.4 8.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" /></svg>
            </button>
          </div>
        )}
      </div>
      {transferCenterOpen && (
        <>
          <div className="transfer-center-backdrop" onClick={() => setTransferCenterOpen(false)} />
          <div className="transfer-center glass-panel">
            <div className="transfer-center-head">
              <span className="transfer-center-title"><Icon name="transfer" size={14} /> 传输中心</span>
              <button className="transfer-center-x" onClick={() => setTransferCenterOpen(false)} title="关闭">×</button>
            </div>
            <div className="transfer-center-list">
              {activeTransfers.length === 0 && finishedTransfers.length === 0 && (
                <div className="tc-empty">暂无传输</div>
              )}
              {activeTransfers.length > 0 && <div className="tc-section">进行中 / 断点续传</div>}
              {activeTransfers.map((t) => (
                <div className={`tc-item ${t.status}`} key={t.id}>
                  <span className="tc-icon"><Icon name={t.direction === 'in' ? 'download' : 'upload'} size={14} /></span>
                  <span className="tc-body">
                    <span className="tc-name">{t.name}</span>
                    <span className="tc-meta">{t.peerName || ''} · {tcStatusText(t)}</span>
                    {t.status === 'transferring' && (
                      <span className="tc-progress"><span className="tc-progress-bar" style={{ width: `${t.percent}%` }} /></span>
                    )}
                  </span>
                </div>
              ))}
              {finishedTransfers.length > 0 && <div className="tc-section">最近完成 / 失败</div>}
              {finishedTransfers.map((t) => (
                <div className={`tc-item ${t.status}`} key={t.id}>
                  <span className="tc-icon"><Icon name={t.direction === 'in' ? 'download' : 'upload'} size={14} /></span>
                  <span className="tc-body">
                    <span className="tc-name">{t.name}</span>
                    <span className="tc-meta">{t.peerName || ''} · {tcStatusText(t)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
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
              {/* 左上角只显示固定 IPv6 地址 + 复制按钮 */}
              {(() => {
                const ips = self.ips || [];
                const fixedV6 = ips.find((ip) => ip.includes(':') && !ip.toLowerCase().startsWith('fe80')) || ips.find((ip) => ip.includes(':')) || '';
                return fixedV6 ? (
                  <div className="brand-sub ips" title={fixedV6}>
                    <span className="ips-text">{fixedV6}</span>
                    <span
                      className={`chat-addr ${copied === 'ipv6' ? 'copied' : ''}`}
                      title={`固定 IPv6 地址 ${fixedV6}（点击复制）`}
                      onClick={(e) => { e.stopPropagation(); copy('ipv6', fixedV6); }}
                    >
                      <span className="addr-copy">{copied === 'ipv6' ? '✓' : (
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <rect x="3.6" y="3.6" width="7" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
                          <path d="M1.4 8.4V2.8A1.4 1.4 0 0 1 2.8 1.4h5.6" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
                        </svg>
                      )}</span>
                    </span>
                  </div>
                ) : (
                  <div className="brand-sub ips muted">未获取到固定 IPv6 地址</div>
                );
              })()}
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
            <span className="ver-tag">{runtime.version || 'v6.1.5.0'}</span>
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
              myStrength={myStrength}
              onBack={() => setSelectedId(null)}
              onSend={(t) => sendText(selected.id, t)}
              onFile={sendFile}
              onConnect={(id) => (window.api as any).connectPeer(id)}
            />
          ) : (
            <div className="empty-pane">
              {/* 盾牌底：主题色渐变圆角块（与动态应用图标同款质感） */}
              <div className="empty-logo"><div className="shield-tile"><ShieldGlyph size={34} /></div></div>
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
          onClose={() => {
            setShowSettings(false);
            // 设置里可能改了加密强度，关设置后同步到聊天页对比展示
            (window.api as any).getCryptoInfo?.().then((c: any) => {
              if (c && c.strength) setMyStrength(c.strength);
            }).catch(() => { /* 忽略 */ });
          }}
          onProfileSaved={refreshSelf}
          onSendKeyChange={(mode) => setSendKey(mode)}
        />
      )}
      {showIntro && (
        <IntroOverlay
          onDone={() => {
            setShowIntro(false);
            window.api.setSettings({ onboardingDone: true });
            // 首次介绍页跳过后：还没设置密钥就弹「是否设置密钥」
            if (!hasEncSecret) setShowEncSetup(true);
          }}
        />
      )}
      <EncSetupModal
        open={showEncSetup}
        onClose={() => {
          setShowEncSetup(false);
          // 保存密钥后同步状态（避免再次弹出）
          (window.api as any).getSettings?.().then((s: any) => {
            if (s) setHasEncSecret(!!s.hasEncSecret);
          }).catch(() => { /* 忽略 */ });
        }}
      />
    </div>
  );
}

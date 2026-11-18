import React, { useEffect, useRef, useState } from 'react';
import { getInitials, getAvatarGradient } from '../services/device';
import {
  applyAppearance,
  buildBackgroundCss,
  resolveTheme,
  BACKGROUND_PRESETS,
  ACCENT_PRESETS,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  type Appearance,
} from '../appearance';
import type { NetworkInfo, SendKeyMode, EncryptionStrength } from '../types';
import { DEFAULT_ENCRYPTION_STRENGTH, ENCRYPTION_STRENGTHS } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon, type IconName, ShieldGlyph } from './Icons';

interface Props {
  self: { id: string; name: string; ips?: string[]; avatar?: string };
  onClose: () => void;
  onProfileSaved: () => void;
  onSendKeyChange: (mode: SendKeyMode) => void;
}

type Tab = 'profile' | 'appearance' | 'encryption' | 'runtime' | 'about';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'profile', label: '个人资料', icon: 'user' },
  { id: 'appearance', label: '外观', icon: 'palette' },
  { id: 'encryption', label: '加密', icon: 'lock' },
  { id: 'runtime', label: '运行偏好', icon: 'gear' },
  { id: 'about', label: '关于', icon: 'info' },
];

/** 加密强度说明 */
function strengthDetail(v: EncryptionStrength): string {
  if (v === 64) return '兼容通道：64 位密钥材料扩展为单层 AES-128-GCM（有效熵 64 位）';
  return v <= 256
    ? `单层 AES-${v}-GCM（AES-NI 指令集加速，速度最快）`
    : `${v / 256} 段 256 位密钥级联 AES-256-GCM（总密钥长度 ${v} 位）`;
}

/** 缓存大小格式化 */
function fmtSize(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/** 外观参数滑杆（可选一行小字说明） */
const GlassSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, suffix, hint, onChange }) => (
  <div className="settings-field">
    <label className="settings-label">
      {label}
      <span className="settings-value">{value}{suffix || ''}</span>
    </label>
    <input
      className="glass-range"
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
    {hint && <div className="settings-hint-inline">{hint}</div>}
  </div>
);

/** 外观页的实时预览（迷你窗口，跟随当前主题明暗；预览图置顶，说明文字不置顶） */
const AppearancePreview: React.FC<{ ap: Appearance }> = ({ ap }) => {
  const theme = resolveTheme(ap.theme);
  return (
    <>
      <div className="settings-preview" data-preview-theme={theme} style={{ background: buildBackgroundCss(ap, theme), opacity: ap.opacity }}>
        <div className="preview-bar">
          {ap.windowControls === 'mac' ? (
            <>
              <span className="preview-light close" />
              <span className="preview-light min" />
              <span className="preview-light max" />
            </>
          ) : (
            <span className="preview-win-keys"><i className="pwkey">—</i><i className="pwkey">□</i><i className="pwkey">×</i></span>
          )}
          <span className="preview-title">安全传输</span>
        </div>
        <div className="preview-body">
          <div className="preview-card glass-demo">
            <div className="preview-chip" />
            <div className="preview-line" style={{ width: '72%' }} />
            <div className="preview-line" style={{ width: '46%' }} />
          </div>
          <div className="preview-side glass-demo">
            <div className="preview-line" style={{ width: '78%' }} />
            <div className="preview-line" style={{ width: '58%' }} />
            <div className="preview-line" style={{ width: '66%' }} />
          </div>
        </div>
        <div className="preview-pill glass-demo">悬浮玻璃按钮</div>
      </div>
      <div className="settings-hint">
        迷你窗口预览：背景颜色与浓度、不透明度、玻璃模糊、圆角、高光、投影全部实时联动，深色模式同步压深。
      </div>
    </>
  );
};

export const SettingsView: React.FC<Props> = ({ self, onClose, onProfileSaved, onSendKeyChange }) => {
  const [tab, setTab] = useState<Tab>('profile');
  const [nick, setNick] = useState(self.name);
  const [avatar, setAvatar] = useState(self.avatar || '');
  const [runtime, setRuntime] = useState<any>({ version: '', isPortable: false });
  const [autoStart, setAutoStart] = useState(false);
  const [minToTray, setMinToTray] = useState(false);
  const [sendKey, setSendKey] = useState<SendKeyMode>('enter');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [encStrength, setEncStrength] = useState<EncryptionStrength>(DEFAULT_ENCRYPTION_STRENGTH);
  const [hasEncSecret, setHasEncSecret] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [oldKeyInput, setOldKeyInput] = useState('');
  const [oldKeyVisible, setOldKeyVisible] = useState(false);
  const [encConfirm, setEncConfirm] = useState<null | { kind: 'strength'; strength: EncryptionStrength } | { kind: 'key' } | { kind: 'clear' }>(null);
  const [encErr, setEncErr] = useState('');
  const [encBusy, setEncBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ap, setAp] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ path: string; size: number } | null>(null);
  const [cacheConfirm, setCacheConfirm] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  /** 窗口控制键切换确认（切换会重建窗口） */
  const [controlsConfirm, setControlsConfirm] = useState(false);
  const apRef = useRef<Appearance>(DEFAULT_APPEARANCE);
  const saveTimer = useRef<number | undefined>(undefined);

  // 打开设置或切到「运行」页时刷新缓存占用
  useEffect(() => {
    if (tab !== 'runtime' && tab !== 'about') return;
    (window as any).api.getCacheInfo?.().then((c: any) => setCacheInfo(c)).catch(() => {});
  }, [tab]);

  const clearCache = async () => {
    if (cacheBusy) return;
    setCacheBusy(true);
    try {
      const r = await (window as any).api.clearCache();
      if (r?.success) setCacheInfo({ path: r.path, size: r.size ?? 0 });
      setCacheConfirm(false);
    } catch { /* 忽略 */ }
    setCacheBusy(false);
  };

  useEffect(() => {
    (window as any).api.getRuntimeInfo().then((r: any) => {
      setRuntime(r);
      setAutoStart(!!r.settings?.autoStart);
      setMinToTray(!!r.settings?.minimizeToTray);
      setSendKey(r.settings?.sendKey === 'shift-enter' ? 'shift-enter' : 'enter');
      setEncStrength(r.settings?.encStrength || DEFAULT_ENCRYPTION_STRENGTH);
      setHasEncSecret(!!r.settings?.hasEncSecret);
      const appearance = normalizeAppearance(r.settings?.appearance);
      apRef.current = appearance;
      setAp(appearance);
      applyAppearance(appearance);
      if (!r.isPortable) {
        (window as any).api.getLoginItem().then((v: boolean) => setAutoStart(v));
      }
    });
    (window as any).api.getNetworkInfo().then((n: NetworkInfo) => setNet(n)).catch(() => { /* 忽略 */ });
    return () => {
      window.clearTimeout(saveTimer.current);
    };
  }, []);

  const persistProfile = async (nextNick: string, nextAvatar: string) => {
    setSaving(true);
    try {
      await (window as any).api.setSelfProfile(nextNick.trim() || self.name, nextAvatar);
      onProfileSaved();
    } finally {
      setSaving(false);
    }
  };

  const saveNick = () => persistProfile(nick, avatar);

  const changeAvatar = async () => {
    const av = await (window as any).api.pickAvatar();
    if (!av) return;
    setAvatar(av);
    await persistProfile(nick, av);
  };

  const toggle = (key: 'autoStart' | 'minimizeToTray', val: boolean) => {
    const next = key === 'autoStart' ? { autoStart: val, minimizeToTray: minToTray } : { autoStart, minimizeToTray: val };
    setAutoStart(next.autoStart);
    setMinToTray(next.minimizeToTray);
    (window as any).api.setSettings(next);
  };

  /** 回车键行为：立即持久化，并同步给聊天输入框 */
  const changeSendKey = (mode: SendKeyMode) => {
    setSendKey(mode);
    (window as any).api.setSettings({ sendKey: mode });
    onSendKeyChange(mode);
  };

  /** 提交外观（立即应用 + 250ms 防抖持久化；用 ref 避免连续操作时的旧状态覆盖） */
  const commitAppearance = (next: Appearance) => {
    apRef.current = next;
    setAp(next);
    applyAppearance(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      (window as any).api.setSettings({ appearance: next });
    }, 250);
  };

  const updateAppearance = (patch: Partial<Appearance>) => {
    commitAppearance(normalizeAppearance({ ...apRef.current, ...patch }));
  };

  const resetAppearance = () => {
    commitAppearance(normalizeAppearance(DEFAULT_APPEARANCE));
  };

  /** 恢复默认设置（只重置设置项，不删除昵称、好友和聊天记录） */
  const resetAllSettings = async () => {
    const defaults = {
      autoStart: false,
      minimizeToTray: false,
      sendKey: 'enter' as SendKeyMode,
      appearance: normalizeAppearance(DEFAULT_APPEARANCE),
    };
    await (window as any).api.setSettings(defaults);
    setAutoStart(false);
    setMinToTray(false);
    setSendKey('enter');
    onSendKeyChange('enter');
    commitAppearance(defaults.appearance);
    setResetConfirm(false);
  };

  /** 应用加密设置（强度 / 密钥）：修改或清除密钥必须验证旧密钥 */
  const applyEncryption = async (strength: EncryptionStrength, password: string | null, oldPassword?: string) => {
    setEncBusy(true);
    setEncErr('');
    try {
      const r = await (window as any).api.setEncryption(strength, password, oldPassword);
      if (!r?.success) {
        setEncErr(r?.error || '保存失败');
        return;
      }
      setEncStrength(r.settings?.encStrength || strength);
      setHasEncSecret(!!r.settings?.hasEncSecret);
      if (password !== null) setKeyInput('');
      setOldKeyInput('');
    } finally {
      setEncBusy(false);
      setEncConfirm(null);
    }
  };

  const requestStrength = (v: EncryptionStrength) => {
    if (v === encStrength) return;
    setEncErr('');
    setEncConfirm({ kind: 'strength', strength: v });
  };

  const requestSaveKey = () => {
    if (!keyInput.trim()) {
      setEncErr('请先输入新密钥');
      return;
    }
    if (hasEncSecret && !oldKeyInput.trim()) {
      setEncErr('修改密钥必须先输入旧密钥');
      return;
    }
    setEncErr('');
    setEncConfirm({ kind: 'key' });
  };

  const requestClearKey = () => {
    if (hasEncSecret && !oldKeyInput.trim()) {
      setEncErr('清除密钥必须先输入旧密钥');
      return;
    }
    setEncErr('');
    setEncConfirm({ kind: 'clear' });
  };

  const title = TABS.find((t) => t.id === tab)?.label || '设置';

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-nav-title">设置</div>
          <div className="settings-nav-list">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`settings-nav-item ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="nav-icon"><Icon name={t.icon} size={17} /></span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="settings-nav-foot">
            <span className="ver-tag">{runtime.version || 'v6.1.5.0'}</span>
            <span className={`mode-tag ${runtime.isPortable ? 'portable' : ''}`}>
              {runtime.isPortable ? '便携版' : '安装版'}
            </span>
          </div>
        </nav>

        <section className="settings-content">
          <header className="settings-header">
            <span className="settings-title">{title}</span>
            <button className="settings-close glass-btn" onClick={onClose} title="关闭">×</button>
          </header>

          <div className="settings-scroll">
            {tab === 'profile' && (
              <>
                <div className="settings-profile">
                  <div
                    className="avatar self-avatar-lg"
                    style={avatar ? { backgroundImage: `url(${avatar})`, backgroundSize: 'cover' } : { background: getAvatarGradient(nick || self.name) }}
                  >{!avatar && getInitials(nick || self.name)}</div>
                  <div className="settings-profile-fields">
                    <label className="settings-label">显示名称</label>
                    <input
                      className="form-control form-control-sm"
                      value={nick}
                      onChange={(e) => setNick(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNick(); } }}
                      placeholder="我的显示名称"
                    />
                    <div className="settings-btn-row">
                      <button className="btn btn-sm glass-btn" onClick={saveNick} disabled={saving}>保存昵称</button>
                      <button className="btn btn-sm glass-btn" onClick={changeAvatar} disabled={saving}>更换头像</button>
                    </div>
                  </div>
                </div>
                <div className="settings-section-title">本机身份</div>
                <div className="settings-id">我的 ID：{self.id}</div>
                <div className="settings-id">固定 IPv6：{net?.fixedIpv6 || '检测中…'}</div>
                <div className="settings-id">公网 IPv4：{net?.publicIpv4 || '未获取（可能无外网）'}</div>
                <div className="settings-id">本机 IPv4：{(net?.localIpv4 || []).join(' · ') || '检测中…'}</div>
                <div className="settings-hint">
                  昵称与头像会随设备发现广播给同一局域网内的设备；身份密钥不会离开本机。
                </div>
              </>
            )}

            {tab === 'appearance' && (
              <>
                <AppearancePreview ap={ap} />

                <div className="settings-section-title">主题模式</div>
                <div className="segmented theme-mode-seg" role="group" aria-label="主题模式">
                  <button className={`seg-item ${ap.theme === 'light' ? 'active' : ''}`} onClick={() => updateAppearance({ theme: 'light' })}>
                    浅色
                  </button>
                  <button className={`seg-item ${ap.theme === 'dark' ? 'active' : ''}`} onClick={() => updateAppearance({ theme: 'dark' })}>
                    深色
                  </button>
                  <button className={`seg-item ${ap.theme === 'system' ? 'active' : ''}`} onClick={() => updateAppearance({ theme: 'system' })}>
                    跟随系统
                  </button>
                  <button className={`seg-item ${ap.theme === 'time' ? 'active' : ''}`} onClick={() => updateAppearance({ theme: 'time' })}>
                    跟随时间
                  </button>
                </div>
                <div className="settings-hint">
                  深色模式保留你选的背景色和主题色，只把整体压深；跟随时间 = 19:00–07:00 自动深色。任务栏图标底色跟随主题色，盾牌图案按底色明暗自适应。
                </div>

                <div className="settings-section-title">窗口控制键</div>
                <div className="segmented controls-mode-seg" role="group" aria-label="窗口控制键模式">
                  <button className={`seg-item ${ap.windowControls === 'mac' ? 'active' : ''}`} onClick={() => { if (ap.windowControls !== 'mac') setControlsConfirm(true); }}>
                    macOS
                  </button>
                  <button className={`seg-item ${ap.windowControls === 'win' ? 'active' : ''}`} onClick={() => { if (ap.windowControls !== 'win') setControlsConfirm(true); }}>
                    Windows
                  </button>
                </div>
                <div className="settings-hint">
                  macOS = 左侧自绘红绿灯；Windows = 左上工具按钮 + 右上自绘三键（— □ ×）。两种模式均为透明超椭圆窗口，窗口圆角统一由上方「窗口圆角」设置驱动。切换会重建窗口。
                </div>

                <div className="settings-section-title">全屏行为</div>
                <div className="switch-row">
                  <div>
                    <div className="switch-label">最大化时隐藏任务栏</div>
                    <div className="settings-hint-inline">开启后点最大化会铺满整个屏幕（任务栏一并覆盖），点还原恢复正常。</div>
                  </div>
                  <button
                    className={`switch ${ap.hideTaskbarOnMax ? 'on' : ''}`}
                    role="switch"
                    aria-checked={ap.hideTaskbarOnMax}
                    onClick={() => updateAppearance({ hideTaskbarOnMax: !ap.hideTaskbarOnMax })}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>

                <div className="settings-section-title">背景颜色 · 马卡龙预设</div>
                <div className="bg-grid">
                  {BACKGROUND_PRESETS.map((b) => (
                    <button
                      key={b.id}
                      className={`bg-chip ${ap.background.toLowerCase() === b.hex.toLowerCase() ? 'active' : ''}`}
                      style={{ background: b.hex }}
                      title={`${b.name} ${b.hex.toUpperCase()}`}
                      onClick={() => updateAppearance({ background: b.hex })}
                    >
                      <span className="bg-chip-name">{b.name}</span>
                    </button>
                  ))}
                </div>

                <div className="settings-field color-field">
                  <label className="settings-label">自定义背景色<span className="settings-value">{ap.background.toUpperCase()}</span></label>
                  <div className="color-picker-row">
                    <input
                      type="color"
                      className="color-input"
                      value={ap.background}
                      onChange={(e) => updateAppearance({ background: e.target.value })}
                    />
                    <span className="settings-hint-inline">点击色块用取色器选择任意颜色</span>
                  </div>
                </div>

                <GlassSlider label="背景浓度" value={Math.round(ap.intensity)} min={0} max={100} suffix="%" hint="背景色的浓淡：数值越高背景色越鲜明，越低越接近白底（深色下为蓝黑底）。" onChange={(v) => updateAppearance({ intensity: v })} />
                <GlassSlider label="背景不透明度" value={Math.round(ap.opacity * 100)} min={5} max={100} suffix="%" hint="窗口整体透明度：调低后桌面可透出，窗口轮廓与投影同步变淡。最低 5% 保留一层 Liquid Glass 底色。" onChange={(v) => updateAppearance({ opacity: v / 100 })} />
                <GlassSlider label="Liquid Glass 强度" value={Math.round(ap.blur)} min={0} max={60} suffix="px" hint="数值越大，面板背后的内容越模糊、玻璃质感越强。" onChange={(v) => updateAppearance({ blur: v })} />
                <GlassSlider label="窗口圆角" value={Math.round(ap.radius)} min={8} max={48} suffix="px" hint="四角超椭圆弧度：顶栏红绿灯 / 三键与右侧按钮会随圆角同步内移，保证留白。最大化时临时直角贴边。" onChange={(v) => updateAppearance({ radius: v })} />
                <GlassSlider label="玻璃高光" value={Math.round(ap.specular)} min={0} max={100} suffix="%" hint="玻璃面板的镜面高光与边缘反光：数值越高越透亮、越有玻璃质感。" onChange={(v) => updateAppearance({ specular: v })} />
                <GlassSlider label="悬浮投影" value={Math.round(ap.shadow)} min={0} max={100} suffix="%" hint="面板与窗口悬浮投影的深浅：数值越高阴影越明显、悬浮感越强，0 为几乎无投影。" onChange={(v) => updateAppearance({ shadow: v })} />

                <div className="settings-section-title">主题色 · 系统色板</div>
                <div className="accent-grid">
                  {ACCENT_PRESETS.map((c) => (
                    <button
                      key={c.id}
                      className={`accent-chip ${ap.accent.toLowerCase() === c.hex.toLowerCase() ? 'active' : ''}`}
                      style={{ background: c.hex }}
                      title={`${c.name} ${c.hex.toUpperCase()}`}
                      onClick={() => updateAppearance({ accent: c.hex })}
                    />
                  ))}
                </div>

                <div className="settings-field color-field">
                  <label className="settings-label">自定义主题色<span className="settings-value">{ap.accent.toUpperCase()}</span></label>
                  <div className="color-picker-row">
                    <input
                      type="color"
                      className="color-input"
                      value={ap.accent}
                      onChange={(e) => updateAppearance({ accent: e.target.value })}
                    />
                    <button className="btn btn-sm glass-btn" onClick={resetAppearance}>恢复默认外观</button>
                  </div>
                </div>
              </>
            )}

            {tab === 'encryption' && (
              <>
                <div className="settings-section-title">加密强度</div>
                <div className="segmented strength-seg" role="group" aria-label="加密强度">
                  {ENCRYPTION_STRENGTHS.map((v) => (
                    <button
                      key={v}
                      className={`seg-item ${encStrength === v ? 'active' : ''}`}
                      onClick={() => requestStrength(v)}
                    >
                      {v} 位{v === DEFAULT_ENCRYPTION_STRENGTH ? ' · 推荐' : ''}
                    </button>
                  ))}
                </div>
                <div className="settings-hint">
                  当前：{strengthDetail(encStrength)}。128 / 192 / 256 位走 AES-NI 指令集，速度最快；64 位为兼容通道；512 / 1024 位拆成 2 / 4 段 256 位密钥级联，强度更高、稍有开销。
                  连接时<b>以被连接方配置为准</b>，强度不一致会自动协商；修改后已建立的连接不受影响，下次重连时生效。
                </div>

                <div className="settings-section-title">加密密钥（可选）</div>
                <div className="settings-field">
                  <label className="settings-label">
                    自定义密钥
                    <span className="settings-value">{hasEncSecret ? '已启用' : '未设置（默认密钥）'}</span>
                  </label>
                  {hasEncSecret && (
                    <div className="key-input-row" style={{ marginBottom: 8 }}>
                      <input
                        className="form-control"
                        type={oldKeyVisible ? 'text' : 'password'}
                        value={oldKeyInput}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="修改或清除密钥前：输入当前旧密钥"
                        onChange={(e) => setOldKeyInput(e.target.value)}
                      />
                      <button className="btn btn-sm glass-btn" onClick={() => setOldKeyVisible((v) => !v)}>
                        {oldKeyVisible ? '隐藏' : '显示'}
                      </button>
                    </div>
                  )}
                  <div className="key-input-row">
                    <input
                      className="form-control"
                      type={keyVisible ? 'text' : 'password'}
                      value={keyInput}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={hasEncSecret ? '已设置；输入新密钥可替换' : '未填写则使用默认密钥（ECDH 自动协商）'}
                      onChange={(e) => setKeyInput(e.target.value)}
                    />
                    <button className="btn btn-sm glass-btn" onClick={() => setKeyVisible((v) => !v)}>
                      {keyVisible ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <div className="settings-btn-row">
                    <button className="btn btn-sm btn-primary" onClick={requestSaveKey} disabled={encBusy || !keyInput.trim()}>
                      保存密钥
                    </button>
                    {hasEncSecret && (
                      <button className="btn btn-sm glass-btn" onClick={requestClearKey} disabled={encBusy}>
                        清除密钥
                      </button>
                    )}
                  </div>
                </div>
                <div className="settings-hint">
                  密钥按当前加密强度经 PBKDF2-SHA512（21 万轮）派生，本机只保存哈希、不保存明文；与对方填入完全相同的密钥才能连接。
                  修改或清除已设置的密钥，必须先输入旧密钥验证。
                  连接时以<b>被连接方</b>配置为准：对方设置了密钥，就在添加好友时填对方的密钥并选对方的强度。
                </div>
                {encErr && <div className="add-err">{encErr}</div>}

                <ConfirmDialog
                  open={!!encConfirm}
                  title={encConfirm?.kind === 'clear' ? '清除自定义密钥？' : encConfirm?.kind === 'key' ? '设置自定义密钥？' : '修改加密强度？'}
                  description={encConfirm?.kind === 'strength'
                    ? `将把加密强度改为 ${encConfirm.strength} 位。以被连接方配置为准：连接时按对方强度自动协商；已连接的会话在下次重连时生效。`
                    : encConfirm?.kind === 'clear'
                      ? '清除后将回到默认密钥（ECDH 自动协商）。若对方仍在使用自定义密钥，将无法连接。'
                      : `将使用你输入的密钥，按当前 ${encStrength} 位强度派生新密钥。必须与对方填入相同的密钥，否则无法连接。`}
                  confirmText={encConfirm?.kind === 'clear' ? '清除' : '确定'}
                  danger={encConfirm?.kind === 'clear'}
                  onCancel={() => setEncConfirm(null)}
                  onConfirm={() => {
                    if (!encConfirm) return;
                    if (encConfirm.kind === 'strength') void applyEncryption(encConfirm.strength, null);
                    else if (encConfirm.kind === 'key') void applyEncryption(encStrength, keyInput, oldKeyInput);
                    else void applyEncryption(encStrength, '', oldKeyInput);
                  }}
                />
              </>
            )}

            {tab === 'runtime' && (
              <>
                <div className="settings-section-title">发送与换行</div>
                <div className="segmented" role="group" aria-label="回车键行为">
                  <button
                    className={`seg-item ${sendKey === 'enter' ? 'active' : ''}`}
                    onClick={() => changeSendKey('enter')}
                  >
                    Enter 发送
                  </button>
                  <button
                    className={`seg-item ${sendKey === 'shift-enter' ? 'active' : ''}`}
                    onClick={() => changeSendKey('shift-enter')}
                  >
                    Shift+Enter 发送
                  </button>
                </div>
                <div className="settings-hint">
                  当前使用 {sendKey === 'enter' ? 'Enter 发送，Shift+Enter 换行' : 'Shift+Enter 发送，Enter 换行'}；
                  Ctrl+Enter 始终发送。中文输入法组词时按回车只上屏，不会误发送。
                </div>

                <div className="settings-section-title">启动与驻留</div>
                {runtime.isPortable ? (
                  <div className="settings-note">
                    当前为便携版：无托盘、无后台驻留、关闭窗口即退出，不写注册表、不开机自启；
                    数据仅保存在便携版所在目录（Data\、下载\）。删除所在文件夹即等于卸载。
                  </div>
                ) : (
                  <>
                    <label className="settings-row">
                      <span>开机自启动</span>
                      <input type="checkbox" checked={autoStart} onChange={(e) => toggle('autoStart', e.target.checked)} />
                    </label>
                    <label className="settings-row">
                      <span>关闭窗口时最小化到托盘（关闭则直接退出）</span>
                      <input type="checkbox" checked={minToTray} onChange={(e) => toggle('minimizeToTray', e.target.checked)} />
                    </label>
                    <div className="settings-hint">
                      安装版数据保存在 <span className="mono">%APPDATA%\安全传输</span>，卸载时随程序一并清除。
                    </div>
                  </>
                )}

                <div className="settings-section-title">缓存</div>
                <div className="settings-reset-row">
                  {!cacheConfirm ? (
                    <button className="btn glass-btn" onClick={() => setCacheConfirm(true)}>清理缓存</button>
                  ) : (
                    <div className="settings-reset-confirm">
                      <span>确定清理全部缓存吗？未送达消息和未完成的传输会一并清除。</span>
                      <button className="btn btn-sm btn-primary" onClick={clearCache} disabled={cacheBusy}>清理</button>
                      <button className="btn btn-sm glass-btn" onClick={() => setCacheConfirm(false)}>取消</button>
                    </div>
                  )}
                  <div className="settings-hint-inline">
                    缓存目录 <span className="mono">{cacheInfo?.path || '检测中…'}</span>，当前占用 {fmtSize(cacheInfo?.size)}。
                    包含断点续传分片、语音临时文件、未送达消息、传输记录与运行日志。
                  </div>
                </div>

                <div className="settings-section-title">其他</div>
                <div className="settings-reset-row">
                  {!resetConfirm ? (
                    <button className="btn glass-btn" onClick={() => setResetConfirm(true)}>恢复默认设置</button>
                  ) : (
                    <div className="settings-reset-confirm">
                      <span>确定恢复所有设置为默认状态吗？</span>
                      <button className="btn btn-sm btn-primary" onClick={resetAllSettings}>恢复</button>
                      <button className="btn btn-sm glass-btn" onClick={() => setResetConfirm(false)}>取消</button>
                    </div>
                  )}
                  <div className="settings-hint-inline">只恢复设置，不会删除好友和聊天记录；加密强度与自定义密钥不会被重置（需在上方「加密」页单独修改）。</div>
                </div>
              </>
            )}

            {tab === 'about' && (
              <>
                <div className="about-hero">
                  <div className="about-logo"><ShieldGlyph size={34} /></div>
                  <div>
                    <div className="about-name">安全传输</div>
                    <div className="about-desc">局域网 / 公网点对点加密通信与文件传输</div>
                  </div>
                </div>
                <div className="about-rows">
                  <div className="about-row"><span>版本</span><span className="mono">{runtime.version || 'v6.1.5.0'}</span></div>
                  <div className="about-row"><span>运行模式</span><span>{runtime.isPortable ? '便携版（免安装，零残留）' : '安装版（可开机自启 / 托盘驻留）'}</span></div>
                  <div className="about-row"><span>加密</span><span>X25519 握手 · 豪密 · {encStrength} 位 / {strengthDetail(encStrength)}</span></div>
                  <div className="about-row"><span>界面</span><span>Liquid Glass · 白底马卡龙 · 圆弧窗口</span></div>
                </div>
                <div className="settings-hint">
                  版本号采用 4 位格式（当前 v6.1.5.0）。后续每次更新按改动幅度递增版本号。
                </div>
              </>
            )}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={controlsConfirm}
        title={ap.windowControls === 'win' ? '切换为 macOS 窗口控制键？' : '切换为 Windows 窗口控制键？'}
        description={
          ap.windowControls === 'win'
            ? '将改为左侧自绘红绿灯（macOS 样式）。需要重启应用生效，重启后窗口位置与数据保持不变。'
            : '将改为左上工具按钮 + 右上自绘三键（Windows 样式，— □ ×）。需要重启应用生效，重启后窗口位置与数据保持不变。'
        }
        confirmText="立即重启"
        cancelText="稍后重启"
        onCancel={() => setControlsConfirm(false)}
        onConfirm={async () => {
          const next: 'mac' | 'win' = ap.windowControls === 'win' ? 'mac' : 'win';
          const merged = normalizeAppearance({ ...apRef.current, windowControls: next });
          apRef.current = merged;
          setAp(merged);
          applyAppearance(merged);
          setControlsConfirm(false);
          window.clearTimeout(saveTimer.current);
          // 先落盘再重启，防止重启后设置丢失
          await (window as any).api.setSettings({ appearance: merged });
          (window as any).api.restartApp();
        }}
      />
    </div>
  );
};

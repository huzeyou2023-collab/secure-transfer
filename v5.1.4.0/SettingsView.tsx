import React, { useEffect, useRef, useState } from 'react';
import { getInitials, getAvatarGradient } from '../services/device';
import {
  applyAppearance,
  buildBackgroundCss,
  BACKGROUND_PRESETS,
  ACCENT_PRESETS,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  type Appearance,
} from '../appearance';
import type { NetworkInfo, SendKeyMode } from '../types';

interface Props {
  self: { id: string; name: string; ips?: string[]; avatar?: string };
  onClose: () => void;
  onProfileSaved: () => void;
  onSendKeyChange: (mode: SendKeyMode) => void;
}

type Tab = 'profile' | 'appearance' | 'runtime' | 'about';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'profile', label: '个人资料', icon: '👤' },
  { id: 'appearance', label: '外观', icon: '🎨' },
  { id: 'runtime', label: '运行偏好', icon: '⚙️' },
  { id: 'about', label: '关于', icon: 'ⓘ' },
];

/** 外观参数滑杆 */
const GlassSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, suffix, onChange }) => (
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
  </div>
);

/** 外观页的实时预览（迷你窗口） */
const AppearancePreview: React.FC<{ ap: Appearance }> = ({ ap }) => (
  <div className="settings-preview-wrap">
    <div className="settings-preview" style={{ background: buildBackgroundCss(ap) }}>
      <div className="preview-bar">
        <span className="preview-light close" />
        <span className="preview-light min" />
        <span className="preview-light max" />
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
      白色为底、玻璃为面：所有面板悬浮于背景之上，浅色背景也保持深色文字的高对比度。
      预览会随下方参数实时变化。
    </div>
  </div>
);

export const SettingsView: React.FC<Props> = ({ self, onClose, onProfileSaved, onSendKeyChange }) => {
  const [tab, setTab] = useState<Tab>('profile');
  const [nick, setNick] = useState(self.name);
  const [avatar, setAvatar] = useState(self.avatar || '');
  const [runtime, setRuntime] = useState<any>({ version: '', isPortable: false });
  const [autoStart, setAutoStart] = useState(false);
  const [minToTray, setMinToTray] = useState(false);
  const [sendKey, setSendKey] = useState<SendKeyMode>('enter');
  const [fullscreenTaskbar, setFullscreenTaskbar] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ap, setAp] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const apRef = useRef<Appearance>(DEFAULT_APPEARANCE);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    (window as any).api.getRuntimeInfo().then((r: any) => {
      setRuntime(r);
      setAutoStart(!!r.settings?.autoStart);
      setMinToTray(!!r.settings?.minimizeToTray);
      setSendKey(r.settings?.sendKey === 'shift-enter' ? 'shift-enter' : 'enter');
      setFullscreenTaskbar(!!r.settings?.fullscreenTaskbar);
      const appearance = normalizeAppearance(r.settings?.appearance);
      apRef.current = appearance;
      setAp(appearance);
      applyAppearance(appearance);
      if (!r.isPortable) {
        (window as any).api.getLoginItem().then((v: boolean) => setAutoStart(v));
      }
    });
    (window as any).api.getNetworkInfo().then((n: NetworkInfo) => setNet(n)).catch(() => { /* 忽略 */ });
    return () => window.clearTimeout(saveTimer.current);
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

  /** 全屏时任务栏：false = 覆盖任务栏（苹果式全屏），true = 保留任务栏 */
  const changeFullscreenTaskbar = (keep: boolean) => {
    setFullscreenTaskbar(keep);
    (window as any).api.setSettings({ fullscreenTaskbar: keep });
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
      fullscreenTaskbar: false,
      appearance: normalizeAppearance(DEFAULT_APPEARANCE),
    };
    await (window as any).api.setSettings(defaults);
    setAutoStart(false);
    setMinToTray(false);
    setSendKey('enter');
    setFullscreenTaskbar(false);
    onSendKeyChange('enter');
    commitAppearance(defaults.appearance);
    setResetConfirm(false);
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
                <span className="nav-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="settings-nav-foot">
            <span className="ver-tag">{runtime.version || 'v5.1.4.0'}</span>
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

                <GlassSlider label="背景浓度" value={Math.round(ap.intensity)} min={0} max={100} suffix="%" onChange={(v) => updateAppearance({ intensity: v })} />
                <GlassSlider label="背景不透明度" value={Math.round(ap.opacity * 100)} min={55} max={100} suffix="%" onChange={(v) => updateAppearance({ opacity: v / 100 })} />
                <GlassSlider label="毛玻璃强度" value={Math.round(ap.blur)} min={0} max={60} suffix="px" onChange={(v) => updateAppearance({ blur: v })} />
                <GlassSlider label="超椭圆圆角" value={Math.round(ap.radius)} min={8} max={48} suffix="px" onChange={(v) => updateAppearance({ radius: v })} />
                <div className="settings-field">
                  <label className="settings-label">
                    全屏时任务栏
                    <span className="settings-value">{fullscreenTaskbar ? '保留' : '隐藏'}</span>
                  </label>
                  <div className="segmented" role="group" aria-label="全屏时任务栏">
                    <button
                      className={`seg-item ${!fullscreenTaskbar ? 'active' : ''}`}
                      onClick={() => changeFullscreenTaskbar(false)}
                    >
                      隐藏任务栏
                    </button>
                    <button
                      className={`seg-item ${fullscreenTaskbar ? 'active' : ''}`}
                      onClick={() => changeFullscreenTaskbar(true)}
                    >
                      保留任务栏
                    </button>
                  </div>
                </div>
                <div className="settings-hint-inline" style={{ marginBottom: 10 }}>
                  全屏时四角以纯黑填充，模拟苹果全屏的屏幕圆角；隐藏任务栏时铺满整块屏幕，保留任务栏时止于任务栏上沿。
                </div>
                <GlassSlider label="玻璃高光" value={Math.round(ap.specular)} min={0} max={100} suffix="%" onChange={(v) => updateAppearance({ specular: v })} />
                <GlassSlider label="悬浮投影" value={Math.round(ap.shadow)} min={0} max={100} suffix="%" onChange={(v) => updateAppearance({ shadow: v })} />

                <div className="settings-section-title">强调色 · 系统色板</div>
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
                  <label className="settings-label">自定义强调色<span className="settings-value">{ap.accent.toUpperCase()}</span></label>
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
                  <div className="settings-hint-inline">只恢复设置，不会删除好友和聊天记录。</div>
                </div>
              </>
            )}

            {tab === 'about' && (
              <>
                <div className="about-hero">
                  <div className="about-logo">盾</div>
                  <div>
                    <div className="about-name">安全传输</div>
                    <div className="about-desc">局域网 / 公网点对点加密通信与文件传输</div>
                  </div>
                </div>
                <div className="about-rows">
                  <div className="about-row"><span>版本</span><span className="mono">{runtime.version || 'v5.1.4.0'}</span></div>
                  <div className="about-row"><span>运行模式</span><span>{runtime.isPortable ? '便携版（免安装，零残留）' : '安装版（可开机自启 / 托盘驻留）'}</span></div>
                  <div className="about-row"><span>加密</span><span>X25519 握手 · 豪密 · AES-256-GCM</span></div>
                  <div className="about-row"><span>界面</span><span>Liquid Glass · 白底马卡龙 · 超椭圆</span></div>
                  <div className="about-row"><span>开源</span><span>MIT 协议。允许商用与修改，再分发时请保留版权声明。</span></div>
                </div>
                <div className="settings-hint">
                  版本号采用 4 位格式（v5.1.4.0）。后续每次更新按改动幅度递增版本号。
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};










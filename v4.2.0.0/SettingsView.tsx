import React, { useState, useEffect } from 'react';
import { getInitials, getAvatarGradient } from '../services/device';
import { applyAppearance, BACKGROUNDS, ACCENTS, DEFAULT_APPEARANCE, normalizeAppearance, Appearance } from '../appearance';

interface Props {
  self: { id: string; name: string; ips?: string[]; avatar?: string };
  onClose: () => void;
  onProfileSaved: () => void;
}

export const SettingsView: React.FC<Props> = ({ self, onClose, onProfileSaved }) => {
  const [nick, setNick] = useState(self.name);
  const [avatar, setAvatar] = useState(self.avatar || '');
  const [runtime, setRuntime] = useState<any>({ version: '', isPortable: false, settings: { autoStart: false, minimizeToTray: false, appearance: DEFAULT_APPEARANCE } });
  const [autoStart, setAutoStart] = useState(false);
  const [minToTray, setMinToTray] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ap, setAp] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    (window as any).api.getRuntimeInfo().then((r: any) => {
      setRuntime(r);
      setAutoStart(!!r.settings?.autoStart);
      setMinToTray(!!r.settings?.minimizeToTray);
      const appearance = normalizeAppearance(r.settings?.appearance);
      setAp(appearance);
      applyAppearance(appearance);
      // 安装版：以注册表真实状态为准（防止被外部工具改过而显示不一致）
      if (!r.isPortable) {
        (window as any).api.getLoginItem().then((v: boolean) => setAutoStart(v));
      }
    });
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

  /** 外观参数修改：立即应用 + 持久化 */
  const updateAppearance = (patch: Partial<Appearance>) => {
    const next = normalizeAppearance({ ...ap, ...patch });
    setAp(next);
    applyAppearance(next);
    (window as any).api.setSettings({ appearance: next });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>设置</span>
          <button className="btn btn-sm glass-btn settings-close" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="settings-body">
          <div className="settings-section-title">个人资料</div>
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
                placeholder="我的显示名称"
              />
              <div className="settings-btn-row">
                <button className="btn btn-sm glass-btn" onClick={saveNick} disabled={saving}>保存昵称</button>
                <button className="btn btn-sm glass-btn" onClick={changeAvatar} disabled={saving}>更换头像</button>
              </div>
            </div>
          </div>
          <div className="settings-id">我的 ID：{self.id}</div>
          <div className="settings-id">本机地址：{(self.ips || []).join(' · ') || '未检测到网络'}</div>

          <div className="settings-section-title">外观</div>
          <div className="settings-field">
            <label className="settings-label">背景</label>
            <div className="bg-chips">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.id}
                  className={`bg-chip ${ap.backgroundId === b.id ? 'active' : ''}`}
                  style={{ background: b.css }}
                  title={b.name}
                  onClick={() => updateAppearance({ backgroundId: b.id })}
                />
              ))}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-label">窗口不透明度 <span className="settings-value">{Math.round(ap.opacity * 100)}%</span></label>
            <input
              className="glass-range"
              type="range"
              min={55}
              max={100}
              value={Math.round(ap.opacity * 100)}
              onChange={(e) => updateAppearance({ opacity: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">毛玻璃强度 <span className="settings-value">{ap.blur}px</span></label>
            <input
              className="glass-range"
              type="range"
              min={0}
              max={44}
              value={ap.blur}
              onChange={(e) => updateAppearance({ blur: Number(e.target.value) })}
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">超椭圆圆角 <span className="settings-value">{ap.radius}px</span></label>
            <input
              className="glass-range"
              type="range"
              min={8}
              max={34}
              value={ap.radius}
              onChange={(e) => updateAppearance({ radius: Number(e.target.value) })}
            />
          </div>
          <div className="settings-field">
            <label className="settings-label">强调色</label>
            <div className="accent-chips">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  className={`accent-chip ${ap.accent.toLowerCase() === c.toLowerCase() ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => updateAppearance({ accent: c })}
                />
              ))}
            </div>
          </div>

          <div className="settings-section-title">运行偏好</div>
          {runtime.isPortable ? (
            <div className="settings-note">当前为便携版：无托盘、无后台驻留、关闭窗口即退出，不写注册表、不开机自启；数据仅保存在便携版所在目录。</div>
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
            </>
          )}

          <div className="settings-section-title">开源</div>
          <div className="settings-note">MIT 协议。允许商用与修改，再分发时请保留版权声明。</div>
          <div className="settings-version">{runtime.version}{runtime.isPortable ? ' · 便携版' : ' · 安装版'}</div>
        </div>
      </div>
    </div>
  );
};

/**
 * 外观（Liquid Glass v3）参数模型
 * ────────────────────────────────────────────────────────────
 * 参照 macOS 26 Tahoe / macOS 27 的 Liquid Glass：
 *   · 白色为底（白底不透明窗口，避免 DWM 合成穿透）
 *   · 背景为马卡龙粉彩；可调浓度 / 不透明度
 *   · 玻璃面板 = 模糊 + 饱和 + 镜面高光 + 边缘提亮 + 柔和投影
 *   · 全局超椭圆 squircle（corner-shape），圆角可调（更大更明显）
 * 所有参数均可在「设置 → 外观」独立页调整，持久化在 settings.json。
 */

import { setShadowStrength } from './shadowfx';

/** 主题模式：手动浅色 / 手动深色 / 跟随系统 / 跟随时间 */
export type ThemeMode = 'light' | 'dark' | 'system' | 'time';

export interface Appearance {
  /** 背景色（#rrggbb，马卡龙预设或取色器自定义） */
  background: string;
  /** 背景浓度 0–100：0 近乎纯白，100 马卡龙色最饱和 */
  intensity: number;
  /** 背景层不透明度 55–100（窗口本身为白底不透明） */
  opacity: number;
  /** 毛玻璃强度 0–60px */
  blur: number;
  /** 窗口圆角 8–48px（窗口化与全屏统一使用；全屏时四角由纯黑填充） */
  radius: number;
  /** 强调色 #rrggbb */
  accent: string;
  /** 玻璃镜面高光强度 0–100 */
  specular: number;
  /** 玻璃投影强度 0–100（物理光影强度） */
  shadow: number;
  /** 主题模式：light 手动浅色 / dark 手动深色 / system 跟随系统 / time 跟随时间（19:00–07:00 深色） */
  theme: ThemeMode;
}

interface ColorPreset {
  id: string;
  name: string;
  hex: string;
}

/** 马卡龙背景预设（30 色，低饱和粉彩；白底友好） */
export const BACKGROUND_PRESETS: ColorPreset[] = [
  { id: 'sakura', name: '樱花粉', hex: '#ffe3ec' },
  { id: 'peach', name: '蜜桃', hex: '#ffdcc9' },
  { id: 'apricot', name: '杏橙', hex: '#ffe3c2' },
  { id: 'lemon', name: '柠檬', hex: '#fff3bf' },
  { id: 'lime', name: '青柠', hex: '#d9f5d6' },
  { id: 'matcha', name: '抹茶', hex: '#dff0c8' },
  { id: 'mint', name: '薄荷', hex: '#cff1e1' },
  { id: 'seasalt', name: '海盐', hex: '#cfeff7' },
  { id: 'sky', name: '天空蓝', hex: '#d6ebff' },
  { id: 'haze', name: '雾霾蓝', hex: '#dce4fa' },
  { id: 'blueberry', name: '蓝莓', hex: '#d9e1ff' },
  { id: 'lavender', name: '薰衣草', hex: '#e3daff' },
  { id: 'wisteria', name: '紫藤', hex: '#efe1f7' },
  { id: 'rose', name: '玫瑰', hex: '#fbd9e8' },
  { id: 'coral', name: '珊瑚', hex: '#ffd8d2' },
  { id: 'milkcoffee', name: '奶咖', hex: '#f0e4d8' },
  { id: 'oat', name: '燕麦', hex: '#f5ebdd' },
  { id: 'cream', name: '奶油白', hex: '#fbf6ee' },
  { id: 'silver', name: '银灰', hex: '#eef1f5' },
  { id: 'lake', name: '湖水绿', hex: '#cbe9e4' },
  { id: 'melon', name: '蜜瓜', hex: '#ffe9c7' },
  { id: 'grape', name: '葡萄', hex: '#ead9f7' },
  { id: 'mist', name: '晨雾', hex: '#eef3fa' },
  { id: 'azure', name: '天青', hex: '#d3eef9' },
  { id: 'honey', name: '蜜糖', hex: '#ffebcb' },
  { id: 'blush', name: '桃粉', hex: '#ffe6dc' },
  { id: 'aqua', name: '薄荷蓝', hex: '#d2f0ed' },
  { id: 'lilac', name: '雾紫', hex: '#e8ddf5' },
  { id: 'periwinkle', name: '长春花', hex: '#e0e6ff' },
  { id: 'white', name: '纯白', hex: '#ffffff' },
];

/** 强调色预设（macOS 26/27 系统色，浅色模式） */
export const ACCENT_PRESETS: ColorPreset[] = [
  { id: 'blue', name: '系统蓝', hex: '#0088ff' },
  { id: 'indigo', name: '靛蓝', hex: '#6155f5' },
  { id: 'purple', name: '紫', hex: '#cb30e0' },
  { id: 'pink', name: '粉', hex: '#ff2d55' },
  { id: 'red', name: '红', hex: '#ff383c' },
  { id: 'orange', name: '橙', hex: '#ff8d28' },
  { id: 'yellow', name: '黄', hex: '#ffcc00' },
  { id: 'green', name: '绿', hex: '#34c759' },
  { id: 'mint', name: '薄荷', hex: '#00c8b3' },
  { id: 'teal', name: '青绿', hex: '#00c3d0' },
  { id: 'cyan', name: '青', hex: '#00c0e8' },
  { id: 'brown', name: '棕', hex: '#ac7f5e' },
  { id: 'graphite', name: '石墨', hex: '#8e8e93' },
  { id: 'brand', name: '品牌蓝', hex: '#5b7cfa' },
];

/** 旧版（v4.2）预设 id → 新马卡龙色 */
const LEGACY_BACKGROUNDS: Record<string, string> = {
  aurora: '#dce4fa',
  violet: '#e3daff',
  mint: '#cff1e1',
  sand: '#f5ebdd',
  rose: '#fbd9e8',
};

export const DEFAULT_APPEARANCE: Appearance = {
  background: '#dce4fa',
  intensity: 82,
  opacity: 1,
  blur: 30,
  radius: 20,
  accent: '#007aff',
  specular: 76,
  shadow: 58,
  theme: 'light',
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function normHex(v: unknown, fallback: string): string {
  if (typeof v === 'string' && HEX_RE.test(v.trim())) return v.trim().toLowerCase();
  return fallback;
}

/** 补全 / 夹取外观参数（兼容 v4.2 旧 settings.json） */
export function normalizeAppearance(a?: Partial<Appearance> | null): Appearance {
  const src: any = a || {};
  let background = normHex(src.background, '');
  // v4.2 无 background 字段（只有 backgroundId）→ 视为旧版，外观整体迁移到 v5 默认值
  const legacy = !background;
  if (legacy) {
    background = LEGACY_BACKGROUNDS[src.backgroundId] || DEFAULT_APPEARANCE.background;
  }
  const pick = (v: unknown, def: number) => (legacy ? def : Number(v ?? def));
  const theme = legacy || !src.theme ? DEFAULT_APPEARANCE.theme : src.theme;
  return {
    background,
    intensity: clamp(pick(src.intensity, DEFAULT_APPEARANCE.intensity), 0, 100),
    opacity: clamp(pick(src.opacity, DEFAULT_APPEARANCE.opacity), 0.55, 1),
    blur: clamp(pick(src.blur, DEFAULT_APPEARANCE.blur), 0, 60),
    radius: clamp(pick(src.radius, DEFAULT_APPEARANCE.radius), 8, 48),
    accent: normHex(src.accent, DEFAULT_APPEARANCE.accent),
    specular: clamp(pick(src.specular, DEFAULT_APPEARANCE.specular), 0, 100),
    shadow: clamp(pick(src.shadow, DEFAULT_APPEARANCE.shadow), 0, 100),
    theme: theme === 'dark' || theme === 'system' || theme === 'time' ? theme : 'light',
  };
}

/* ── 颜色工具 ───────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/** 把颜色与白色混合：amount=0 原色，amount=1 纯白 */
function mixWhite(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, amount));
  return rgbToHex(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a);
}

/** 深色基底（蓝黑）：所有深色渐变都压向这一族色，保留背景色相 */
const DARK_BASE: [number, number, number] = [16, 19, 28];

/** 把颜色与深色基底混合：amount=0 原色，amount=1 纯深基底 */
function mixDark(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, amount));
  return rgbToHex(
    r + (DARK_BASE[0] - r) * a,
    g + (DARK_BASE[1] - g) * a,
    b + (DARK_BASE[2] - b) * a,
  );
}

/** 解析主题模式为实际深浅：跟随系统用 prefers-color-scheme，跟随时间 19:00–07:00 为深色 */
export function resolveTheme(mode: ThemeMode | undefined): 'light' | 'dark' {
  if (mode === 'dark') return 'dark';
  if (mode === 'system') {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch { return 'light'; }
  }
  if (mode === 'time') {
    const h = new Date().getHours();
    return h >= 19 || h < 7 ? 'dark' : 'light';
  }
  return 'light';
}

/** 生成背景 CSS（马卡龙粉彩 + 柔光；深色模式保留色相、整体压深） */
export function buildBackgroundCss(a: Appearance, theme: 'light' | 'dark' = 'light'): string {
  if (theme === 'dark') {
    const s = a.intensity / 100;
    // 色相不变：原始背景色按比例压向蓝黑基底，浓度控制饱和度保留程度
    const glowA = mixDark(a.background, 0.86 - 0.10 * s);
    const glowB = mixDark(a.background, 0.90 - 0.08 * s);
    const mid = mixDark(a.background, 0.92 - 0.06 * s);
    const bottom = mixDark(a.background, 0.95 - 0.04 * s);
    return [
      `radial-gradient(1200px 700px at 12% -16%, ${glowA} 0%, transparent 64%)`,
      `radial-gradient(940px 560px at 94% -8%, ${glowB} 0%, transparent 60%)`,
      `radial-gradient(820px 500px at 58% 120%, ${mixDark(a.background, 0.93 - 0.05 * s)} 0%, transparent 68%)`,
      `linear-gradient(163deg, ${mixDark(a.background, 0.88 - 0.05 * s)} 0%, ${mid} 56%, ${bottom} 100%)`,
    ].join(', ');
  }
  const s = a.intensity / 100;
  const glowA = mixWhite(a.background, 0.10 - 0.10 * s);
  const glowB = mixWhite(a.background, 0.32 - 0.20 * s);
  const mid = mixWhite(a.background, 0.52 - 0.42 * s);
  const bottom = mixWhite(a.background, 0.72 - 0.42 * s);
  return [
    `radial-gradient(1200px 700px at 12% -16%, ${glowA} 0%, transparent 64%)`,
    `radial-gradient(940px 560px at 94% -8%, ${glowB} 0%, transparent 60%)`,
    `radial-gradient(820px 500px at 58% 120%, ${mixWhite(a.background, 0.48 - 0.28 * s)} 0%, transparent 68%)`,
    `linear-gradient(163deg, ${mixWhite(a.background, 0.28 - 0.18 * s)} 0%, ${mid} 56%, ${bottom} 100%)`,
  ].join(', ');
}

/** 主题监听：system 模式监听系统深浅变化；time 模式每分钟重算；变化时整体重应用 */
let themeWatcher: { cleanup: () => void } | null = null;
let lastApplied: Appearance | null = null;

function watchTheme(a: Appearance): void {
  themeWatcher?.cleanup();
  themeWatcher = null;
  if (a.theme === 'system') {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => { if (lastApplied) applyAppearance(lastApplied); };
    try { mq?.addEventListener?.('change', onChange); } catch { try { (mq as any)?.addListener?.(onChange); } catch {} }
    themeWatcher = { cleanup: () => { try { mq?.removeEventListener?.('change', onChange); } catch {} } };
  } else if (a.theme === 'time') {
    const timer = window.setInterval(() => { if (lastApplied) applyAppearance(lastApplied); }, 60_000);
    themeWatcher = { cleanup: () => window.clearInterval(timer) };
  }
}

/** 把外观参数写到 CSS 变量（全局立即生效） */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  const spec = a.specular / 100;
  const sh = a.shadow / 100;
  const theme = resolveTheme(a.theme);

  root.dataset.theme = theme;
  lastApplied = a;
  watchTheme(a);

  root.style.setProperty('--app-bg', buildBackgroundCss(a, theme));
  root.style.setProperty('--app-opacity', String(a.opacity));
  root.style.setProperty('--glass-blur', `${a.blur}px`);
  root.style.setProperty('--app-radius', `${a.radius}px`);
  root.style.setProperty('--accent', a.accent);

  // 玻璃材质层次（高光 / 底色透明度 / 投影）→ 数值由 JS 计算，CSS 直接消费
  root.style.setProperty('--glass-alpha', (0.18 + 0.30 * spec).toFixed(3));
  root.style.setProperty('--glass-alpha-strong', (0.34 + 0.34 * spec).toFixed(3));
  root.style.setProperty('--glass-sheen', (0.30 + 0.55 * spec).toFixed(3));
  root.style.setProperty('--glass-edge', (0.45 + 0.45 * spec).toFixed(3));
  root.style.setProperty('--shadow-a', (0.10 + 0.24 * sh).toFixed(3));
  root.style.setProperty('--shadow-b', (0.05 + 0.14 * sh).toFixed(3));
  root.style.setProperty('--shadow-float-a', (0.12 + 0.22 * sh).toFixed(3));
  root.style.setProperty('--shadow-float-b', (0.08 + 0.16 * sh).toFixed(3));
  root.style.setProperty('--shadow-lift', `${(1 + 2.2 * sh).toFixed(1)}px`);
  root.style.setProperty('--lift', `${(1 + 1.6 * sh).toFixed(1)}px`);

  // 物理光影：双光源阴影强度跟随「悬浮投影」设置
  setShadowStrength(a.shadow);

  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';

  // 任务栏 / 窗口 / 托盘图标：底色跟随主题色，盾牌图案按底色明暗取白 / 深
  scheduleAppIcon(a.accent);
}

/* ── 应用图标（运行时动态绘制：底色 = 主题色，盾牌按底色明暗自适应） ── */

/** 感知亮度（0–255）：Y = 0.299R + 0.587G + 0.114B */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 盾牌轮廓（24×24 网格，经典徽章形） */
const SHIELD_PATH = 'M12 1.9 L20.2 5.1 V12 C20.2 17 16.7 20.3 12 22.1 C7.3 20.3 3.8 17 3.8 12 V5.1 Z';

/** 在 256×256 画布上绘制应用图标并返回 dataURL（底色为主题色，盾牌自适应明暗） */
export function drawAppIcon(accent: string, size = 256): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const u = size / 256;

  // 超椭圆圆角方形（squircle 近似：圆角 23%）
  const r = size * 0.225;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.clip();

  // 底色：主题色渐变（顶部提亮 14%，底部压暗 22%）
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, mixWhite(accent, 0.14));
  grad.addColorStop(0.52, accent);
  grad.addColorStop(1, mixDark(accent, 0.22));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 盾牌图案：底色亮 → 深色盾；底色暗 → 白色盾
  const darkShield = luminance(accent) > 165;
  ctx.save();
  ctx.translate(size * 0.5, size * 0.5);
  ctx.scale(u * 8.8, u * 8.8);
  ctx.translate(-12, -12);
  const shield = new Path2D(SHIELD_PATH);
  ctx.fillStyle = darkShield ? 'rgba(24, 30, 44, 0.92)' : 'rgba(255, 255, 255, 0.96)';
  ctx.shadowColor = darkShield ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.30)';
  ctx.shadowBlur = 3.2 * (size / 256);
  ctx.shadowOffsetY = 1.6 * (size / 256);
  ctx.fill(shield);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // 盾牌内高光（左上一抹，模拟玻璃质感）
  ctx.fillStyle = darkShield ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.28)';
  const glint = new Path2D('M7.6 7.2 L14.4 4.6 L12.2 9.1 L9.4 8.0 Z');
  ctx.fill(glint);
  ctx.restore();

  return c.toDataURL('image/png');
}

let iconTimer: number | undefined;
/** 主题色变化后 120ms 防抖同步图标（IPC 通知主进程 setIcon） */
function scheduleAppIcon(accent: string): void {
  window.clearTimeout(iconTimer);
  iconTimer = window.setTimeout(() => {
    try {
      (window as any).api?.setAppIcon?.(drawAppIcon(accent));
    } catch { /* 忽略 */ }
  }, 120);
}

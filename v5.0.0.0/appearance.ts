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

export interface Appearance {
  /** 背景色（#rrggbb，马卡龙预设或取色器自定义） */
  background: string;
  /** 背景浓度 0–100：0 近乎纯白，100 马卡龙色最饱和 */
  intensity: number;
  /** 背景层不透明度 55–100（窗口本身为白底不透明） */
  opacity: number;
  /** 毛玻璃强度 0–60px */
  blur: number;
  /** 超椭圆圆角 8–44px */
  radius: number;
  /** 强调色 #rrggbb */
  accent: string;
  /** 玻璃镜面高光强度 0–100 */
  specular: number;
  /** 玻璃投影强度 0–100 */
  shadow: number;
}

export interface ColorPreset {
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
export const LEGACY_BACKGROUNDS: Record<string, string> = {
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
  radius: 34,
  accent: '#007aff',
  specular: 76,
  shadow: 58,
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
  return {
    background,
    intensity: clamp(pick(src.intensity, DEFAULT_APPEARANCE.intensity), 0, 100),
    opacity: clamp(pick(src.opacity, DEFAULT_APPEARANCE.opacity), 0.55, 1),
    blur: clamp(pick(src.blur, DEFAULT_APPEARANCE.blur), 0, 60),
    radius: clamp(pick(src.radius, DEFAULT_APPEARANCE.radius), 8, 48),
    accent: normHex(src.accent, DEFAULT_APPEARANCE.accent),
    specular: clamp(pick(src.specular, DEFAULT_APPEARANCE.specular), 0, 100),
    shadow: clamp(pick(src.shadow, DEFAULT_APPEARANCE.shadow), 0, 100),
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
export function mixWhite(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, amount));
  return rgbToHex(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a);
}

/** 生成背景 CSS（白底 + 马卡龙粉彩 + 柔光） */
export function buildBackgroundCss(a: Appearance): string {
  const s = a.intensity / 100;
  const glowA = mixWhite(a.background, 0.10 - 0.10 * s);
  const glowB = mixWhite(a.background, 0.32 - 0.20 * s);
  const mid = mixWhite(a.background, 0.52 - 0.42 * s);
  const bottom = mixWhite(a.background, 0.72 - 0.42 * s);
  return [
    `radial-gradient(1200px 700px at 12% -16%, ${glowA} 0%, transparent 64%)`,
    `radial-gradient(940px 560px at 94% -8%, ${glowB} 0%, transparent 60%)`,
    `radial-gradient(820px 500px at 58% 120%, ${mixWhite(a.background, 0.48 - 0.28 * s)} 0%, transparent 68%)`,
    `linear-gradient(163deg, #ffffff 0%, ${mid} 56%, ${bottom} 100%)`,
  ].join(', ');
}

/** 把外观参数写到 CSS 变量（全局立即生效） */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  const spec = a.specular / 100;
  const sh = a.shadow / 100;

  root.style.setProperty('--app-bg', buildBackgroundCss(a));
  root.style.setProperty('--bg-color', a.background);
  root.style.setProperty('--app-opacity', String(a.opacity));
  root.style.setProperty('--glass-blur', `${a.blur}px`);
  root.style.setProperty('--app-radius', `${a.radius}px`);
  root.style.setProperty('--accent', a.accent);

  // 玻璃材质层次（高光 / 底色透明度 / 投影）→ 数值由 JS 计算，CSS 直接消费
  root.style.setProperty('--glass-alpha', (0.18 + 0.30 * spec).toFixed(3));
  root.style.setProperty('--glass-alpha-strong', (0.34 + 0.34 * spec).toFixed(3));
  root.style.setProperty('--glass-alpha-soft', (0.12 + 0.26 * spec).toFixed(3));
  root.style.setProperty('--glass-sheen', (0.30 + 0.55 * spec).toFixed(3));
  root.style.setProperty('--glass-edge', (0.45 + 0.45 * spec).toFixed(3));
  root.style.setProperty('--shadow-a', (0.10 + 0.24 * sh).toFixed(3));
  root.style.setProperty('--shadow-b', (0.05 + 0.14 * sh).toFixed(3));
  root.style.setProperty('--shadow-float-a', (0.12 + 0.22 * sh).toFixed(3));
  root.style.setProperty('--shadow-float-b', (0.08 + 0.16 * sh).toFixed(3));
  root.style.setProperty('--shadow-lift', `${(1 + 2.2 * sh).toFixed(1)}px`);
  root.style.setProperty('--lift', `${(1 + 1.6 * sh).toFixed(1)}px`);

  document.body.style.backgroundColor = '#ffffff';
}




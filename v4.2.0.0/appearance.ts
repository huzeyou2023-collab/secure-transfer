/**
 * 外观（Liquid Glass）参数：背景、不透明度、毛玻璃强度、圆角、强调色
 * 全部可在设置页调整，持久化在 settings.json 的 appearance 字段。
 */
export interface Appearance {
  backgroundId: string;
  opacity: number;
  blur: number;
  radius: number;
  accent: string;
}

export interface BackgroundPreset {
  id: string;
  name: string;
  css: string;
}

export const BACKGROUNDS: BackgroundPreset[] = [
  {
    id: 'aurora',
    name: '极光蓝',
    css: 'radial-gradient(1200px 620px at 10% -12%, #dbe7ff 0%, transparent 62%), radial-gradient(900px 520px at 92% 0%, #e6dcff 0%, transparent 60%), linear-gradient(160deg, #f3f7ff 0%, #eaf0ff 55%, #f4edff 100%)',
  },
  {
    id: 'violet',
    name: '紫罗兰',
    css: 'radial-gradient(1000px 560px at 12% -10%, #ecdcff 0%, transparent 62%), radial-gradient(820px 480px at 90% 4%, #ffd9f0 0%, transparent 58%), linear-gradient(160deg, #f7f1ff 0%, #f0e8ff 55%, #ffeefb 100%)',
  },
  {
    id: 'mint',
    name: '青瓷',
    css: 'radial-gradient(1000px 560px at 8% -10%, #d8fff2 0%, transparent 60%), radial-gradient(860px 500px at 92% 2%, #d9f3ff 0%, transparent 58%), linear-gradient(160deg, #f0fffa 0%, #e8fbf4 55%, #eef8ff 100%)',
  },
  {
    id: 'sand',
    name: '暖沙',
    css: 'radial-gradient(1000px 560px at 10% -10%, #ffe9cf 0%, transparent 60%), radial-gradient(860px 500px at 92% 0%, #ffdcd0 0%, transparent 58%), linear-gradient(160deg, #fff8ef 0%, #fdf1e4 55%, #fff3ee 100%)',
  },
  {
    id: 'rose',
    name: '玫瑰',
    css: 'radial-gradient(1000px 560px at 10% -10%, #ffe0ee 0%, transparent 60%), radial-gradient(860px 500px at 92% 0%, #ffe6d6 0%, transparent 58%), linear-gradient(160deg, #fff5fa 0%, #fdeff5 55%, #fff3ee 100%)',
  },
];

export const ACCENTS: string[] = ['#5b7cfa', '#9a6bff', '#2fb67c', '#ff8a4c', '#e85d8e'];

export const DEFAULT_APPEARANCE: Appearance = {
  backgroundId: 'aurora',
  opacity: 1,
  blur: 26,
  radius: 20,
  accent: '#5b7cfa',
};

export function normalizeAppearance(a?: Partial<Appearance> | null): Appearance {
  const src = a || {};
  return {
    backgroundId: BACKGROUNDS.some((b) => b.id === src.backgroundId) ? (src.backgroundId as string) : DEFAULT_APPEARANCE.backgroundId,
    opacity: clamp(Number(src.opacity ?? DEFAULT_APPEARANCE.opacity), 0.55, 1),
    blur: clamp(Number(src.blur ?? DEFAULT_APPEARANCE.blur), 0, 44),
    radius: clamp(Number(src.radius ?? DEFAULT_APPEARANCE.radius), 8, 34),
    accent: typeof src.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.accent) ? src.accent : DEFAULT_APPEARANCE.accent,
  };
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** 把外观参数写到 CSS 变量（全局立即生效） */
export function applyAppearance(a: Appearance): void {
  const bg = BACKGROUNDS.find((b) => b.id === a.backgroundId) || BACKGROUNDS[0];
  const root = document.documentElement;
  root.style.setProperty('--app-bg', bg.css);
  root.style.setProperty('--app-opacity', String(a.opacity));
  root.style.setProperty('--glass-blur', `${a.blur}px`);
  root.style.setProperty('--app-radius', `${a.radius}px`);
  root.style.setProperty('--accent', a.accent);
}

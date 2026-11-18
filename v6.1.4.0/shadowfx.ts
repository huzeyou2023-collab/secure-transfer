/**
 * 物理光影（双光源 + 环境色）
 * ─────────────────────────────────────────────────────────────
 * 目标：让窗口像真实物体一样悬浮在桌面上，而不是贴一层固定阴影。
 *  · 光源 1：左上方（主光，权重 1.0）
 *  · 光源 2：右上方（补光，权重 0.5）
 *  · 阴影颜色 = 窗口下方桌面平均色压暗 78%（环境色反射）
 *  · 阴影浓度随环境亮度自适应：暗环境更深、亮环境更淡
 *  · 若有光照传感器（lux），用照度进一步调节阴影浓度；
 *    传感器无法给出方向，因此方向始终使用上面两个默认光源位置。
 * 计算得到的 box-shadow 写入 --win-shadow，由 .app-root 消费。
 */
import type { AmbientInfo } from './types';

interface LightSpec {
  /** 方位角（度，0 = 正上方，负数偏左，正数偏右） */
  az: number;
  /** 相对强度 */
  weight: number;
}

const LIGHTS: LightSpec[] = [
  { az: -35, weight: 1.0 },
  { az: 40, weight: 0.5 },
];

const FALLBACK: AmbientInfo = {
  color: '#d8dce6',
  brightness: 0.82,
  lux: -1,
  hasSensor: false,
  updatedAt: 0,
};

let ambient: AmbientInfo = FALLBACK;
const FALLBACK_STRENGTH = 58;
let strength = FALLBACK_STRENGTH; // 与外观设置里的「悬浮投影」0–100 同步

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [216, 220, 230];
  const h = m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mixBlack(hex: string, amount: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const a = clamp01(amount);
  return [r * (1 - a), g * (1 - a), b * (1 - a)];
}

function render(): void {
  const root = document.documentElement;
  const s = clamp01(strength / 100);

  // 环境反射色（顶边微光用）
  root.style.setProperty('--ambient-color', ambient.color || FALLBACK.color);

  if (s <= 0.01) {
    // 投影强度为 0 时仍保留窗口边缘高光圈（标记窗口轮廓）
    root.style.setProperty('--win-shadow', 'inset 0 0 0 1px rgba(255, 255, 255, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.16)');
    return;
  }

  // 无传感器时按 400 lux 的室内环境估计；有传感器则按实际照度调整
  const luxNorm = ambient.hasSensor ? clamp01(ambient.lux / 900) : 0.45;
  // 暗环境：阴影更深更实；亮环境：被环境光填亮、更淡更柔
  const ambientFactor = 0.70 + 0.30 * (1 - luxNorm);
  // 桌面本身很亮时，影子对比更明显
  const brightFactor = 0.90 + 0.12 * clamp01(ambient.brightness);
  const baseAlpha = clamp01((0.16 + 0.30 * s) * ambientFactor * brightFactor);

  const [r, g, b] = mixBlack(ambient.color, 0.78);
  const parts: string[] = [];

  for (const L of LIGHTS) {
    const rad = (L.az * Math.PI) / 180;
    const lx = Math.sin(rad);   // 光在屏幕平面的 X 分量
    const ly = -Math.cos(rad);  // 光在屏幕平面的 Y 分量（向上为负）
    // 影子朝光源相反方向
    const dist = (1 + 3 * s) * L.weight;
    const blur = (4 + 7 * s) * (0.7 + 0.3 * L.weight);
    const spread = -Math.round(1 + 2 * s);
    const ox = -lx * dist;
    const oy = -ly * dist + 1;
    const alpha = Math.max(0.008, baseAlpha * L.weight);
    parts.push(
      `${ox.toFixed(1)}px ${oy.toFixed(1)}px ${blur.toFixed(1)}px ${spread}px rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`,
    );
  }

  // 接触阴影：贴近窗口的一圈更实的暗部，增强“压在桌面上”的物理感
  parts.push(`0 2px 7px -1px rgba(0, 0, 0, ${(baseAlpha * 0.35).toFixed(3)})`);
  // 环境高光：顶部受光边缘
  parts.push(`inset 0 1px 0 rgba(255, 255, 255, ${(0.32 + 0.24 * s).toFixed(2)})`);
  // 窗口最边缘高光圈（反馈：无论透明度多低都保留一圈淡淡高光，标出窗口轮廓）
  parts.push('inset 0 0 0 1px rgba(255, 255, 255, 0.38)');
  parts.push('0 0 0 1px rgba(255, 255, 255, 0.16)');

  root.style.setProperty('--win-shadow', parts.join(', '));
  root.style.setProperty('--win-shadow-color', `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`);
}

/** 环境信息更新（桌面背景色 / 亮度 / 传感器照度） */
export function setAmbientInfo(info: AmbientInfo | null | undefined): void {
  ambient = info || FALLBACK;
  render();
}

/** 外观设置里的「悬浮投影」强度变化 */
export function setShadowStrength(value: number): void {
  strength = Number.isFinite(value) ? value : FALLBACK_STRENGTH;
  render();
}

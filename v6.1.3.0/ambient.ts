/**
 * 环境光与桌面背景采样（用于物理光影模拟）
 * ─────────────────────────────────────────────────────────────
 * · 桌面背景色：用 desktopCapturer 抓主屏缩略图，采样窗口四周的桌面像素平均值
 * · 光照传感器：Windows 无 WinRT 依赖，用 PowerShell 一次性读取 LightSensor 照度
 *   （本机没有传感器时返回 lux=-1、hasSensor=false，前端使用默认双光源）
 */
import { desktopCapturer, screen, type BrowserWindow } from 'electron';
import { execFile } from 'child_process';

export interface AmbientInfo {
  /** 窗口周围桌面的平均颜色 #rrggbb */
  color: string;
  /** 相对亮度 0–1 */
  brightness: number;
  /** 光照传感器照度（lux），-1 表示没有传感器 / 读取失败 */
  lux: number;
  /** 是否成功读到传感器 */
  hasSensor: boolean;
  /** 采样时间戳 */
  updatedAt: number;
}

let sensorCache: { lux: number; at: number } | null = null;
let ambientCache: { info: AmbientInfo; at: number; key: string } | null = null;

const SENSOR_TTL = 5 * 60 * 1000;
const AMBIENT_TTL = 4000;

/** 用 Windows PowerShell 读 LightSensor（没有传感器时返回 -1） */
function probeLightSensor(): Promise<number> {
  return new Promise((resolve) => {
    const ps = [
      'try {',
      '  $t=[Windows.Devices.Sensors.LightSensor,Windows.Devices.Sensors,ContentType=WindowsRuntime];',
      '  $s=$t::GetDefault();',
      '  if ($s -ne $null) { $r=$s.GetCurrentReading(); if ($r -ne $null) { [Console]::WriteLine("SENSOR:" + $r.IlluminanceInLux) } }',
      '} catch { }',
    ].join('');
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 5000, windowsHide: true },
      (_err, stdout) => {
        const m = /SENSOR:([\d.]+)/.exec(String(stdout || ''));
        resolve(m ? Number(m[1]) : -1);
      },
    );
  });
}

async function readLux(): Promise<number> {
  const now = Date.now();
  if (sensorCache && now - sensorCache.at < SENSOR_TTL) return sensorCache.lux;
  const lux = await probeLightSensor();
  sensorCache = { lux, at: now };
  return lux;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function toHex(r: number, g: number, b: number): string {
  const f = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/**
 * 采样窗口四周（窗口外 80px 环带）的桌面平均色。
 * 窗口自身的像素不参与计算，避免被应用界面污染。
 */
async function sampleDesktopColor(win: BrowserWindow | null): Promise<{ color: string; brightness: number }> {
  const fallback = { color: '#d6dbe6', brightness: 0.82 };
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    if (!sources.length) return fallback;
    const primary = screen.getPrimaryDisplay();
    const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
    const img = src.thumbnail;
    const size = img.getSize();
    if (!size.width || !size.height) return fallback;
    const bmp = img.toBitmap(); // BGRA
    const disp = primary.bounds;
    const wb = win && !win.isDestroyed() ? win.getBounds() : null;
    const ring = 80;

    let r = 0, g = 0, b = 0, n = 0;
    const maxX = Math.min(size.width, 320);
    const maxY = Math.min(size.height, 180);
    for (let py = 0; py < maxY; py++) {
      const sy = disp.y + (py + 0.5) / size.height * disp.height;
      for (let px = 0; px < maxX; px++) {
        const sx = disp.x + (px + 0.5) / size.width * disp.width;
        // 只统计窗口外圈（或最大化时整屏平均）的像素
        if (wb && !win?.isMaximized()) {
          const inside = sx >= wb.x - 1 && sx <= wb.x + wb.width + 1 && sy >= wb.y - 1 && sy <= wb.y + wb.height + 1;
          if (inside) continue;
          const near = sx >= wb.x - ring && sx <= wb.x + wb.width + ring && sy >= wb.y - ring && sy <= wb.y + wb.height + ring;
          if (!near) continue;
        }
        const idx = (py * size.width + px) * 4;
        b += bmp[idx]; g += bmp[idx + 1]; r += bmp[idx + 2];
        n++;
      }
    }
    if (!n) return fallback;
    r /= n; g /= n; b /= n;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { color: toHex(r, g, b), brightness: clamp(luminance, 0, 1) };
  } catch {
    return fallback;
  }
}

/** 获取环境信息（带缓存，渲染层可高频轮询而不会频繁抓屏） */
export async function getAmbientInfo(win: BrowserWindow | null): Promise<AmbientInfo> {
  const now = Date.now();
  const key = win && !win.isDestroyed()
    ? `${win.getBounds().x},${win.getBounds().y},${win.getBounds().width},${win.getBounds().height},${win.isMaximized()}`
    : 'none';
  if (ambientCache && ambientCache.key === key && now - ambientCache.at < AMBIENT_TTL) {
    return ambientCache.info;
  }
  const [lux, sampled] = await Promise.all([readLux(), sampleDesktopColor(win)]);
  const info: AmbientInfo = {
    color: sampled.color,
    brightness: sampled.brightness,
    lux,
    hasSensor: lux >= 0,
    updatedAt: Date.now(),
  };
  ambientCache = { info, at: Date.now(), key };
  return info;
}

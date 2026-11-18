/**
 * 物理引擎（Liquid Glass 光影/动态）
 * ────────────────────────────────────────────────────────────
 * 内置轻量 2D 刚体模拟：一个「光源球」质点受 重力 + 弹簧锚点 + 阻尼 + 边界反弹，
 * 点击玻璃元素时给球施加冲量（反弹触感），波纹与光尘粒子随动。
 * 每帧把光源位置 / 波纹强度写入 CSS 变量（--lg-lx / --lg-ly / --lg-ripple），
 * Liquid Glass 高光渐变消费这些变量 → 光影由物理引擎驱动。
 * 窗口最小化 / 最大化 / 还原动画不受影响，仍走系统原生。
 */

export type GlassMaterial = 'glass' | 'frost' | 'metal' | 'jelly';

export interface PhysicsSettings {
  enabled: boolean;
  /** 光源锚点 X（0–1，相对窗口宽） */
  lightX: number;
  /** 光源锚点 Y（0–1，相对窗口高） */
  lightY: number;
  /** Liquid Glass 材质 */
  material: GlassMaterial;
  /** 反弹触感 0–1（弹性系数） */
  bounce: number;
  /** 反弹速度 0–1（回弹速率；越小阻尼越大） */
  rebound: number;
  /** 波纹强度 0–1 */
  ripple: number;
  /** 光尘粒子数量 0–80 */
  particles: number;
  /** 黏稠度 0–1（光源球惯性阻尼） */
  viscosity: number;
  /** 重力 0–2（0 失重漂浮，2 双倍重力） */
  gravity: number;
  /** 玻璃厚度 0–1（凸透镜中心厚度：越大凸度与边缘厚度感越强） */
  thickness: number;
  /** 折射强度 0–1（凸玻璃折射率：越大背景弯曲与色散越明显） */
  refraction: number;
}

export const DEFAULT_PHYSICS: PhysicsSettings = {
  enabled: false,
  lightX: 0.72,
  lightY: 0.22,
  material: 'glass',
  bounce: 0.55,
  rebound: 0.62,
  ripple: 0.7,
  particles: 26,
  viscosity: 0.35,
  gravity: 1,
  thickness: 0.55,
  refraction: 0.6,
};

export const MATERIALS: { id: GlassMaterial; label: string; desc: string }[] = [
  { id: 'glass', label: '标准玻璃', desc: '高光锐利、通透' },
  { id: 'frost', label: '磨砂玻璃', desc: '光斑发散、柔和' },
  { id: 'metal', label: '液态金属', desc: '强对比、镜面拉丝' },
  { id: 'jelly', label: '果冻', desc: '弹性过冲、软弹' },
];

interface Ripple { x: number; y: number; r: number; max: number; alpha: number; }
interface Dust { x: number; y: number; vx: number; vy: number; r: number; a: number; }

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class PhysicsEngine {
  private cfg: PhysicsSettings = { ...DEFAULT_PHYSICS };
  private raf = 0;
  private last = 0;
  private listeners = new Set<() => void>();
  // 光源球状态（0–1 空间）
  private px = 0.72;
  private py = 0.22;
  private vx = 0;
  private vy = 0;
  // 果冻材质形变量（过冲）
  private sx = 0;
  private sy = 0;
  private ripples: Ripple[] = [];
  private dust: Dust[] = [];

  /** 订阅引擎启停/配置变化（用于挂载 / 卸载 GPU 折射层） */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* 忽略 */ }
    }
  }

  get running(): boolean { return this.raf !== 0; }
  get lightPos(): { x: number; y: number } { return { x: this.px, y: this.py }; }
  /** 供 GPU 渲染器读取的波纹快照（只读引用） */
  get ripplesSnap(): readonly Ripple[] { return this.ripples; }
  /** 供 GPU 渲染器读取的光尘快照（只读引用） */
  get dustSnap(): readonly Dust[] { return this.dust; }

  /** 帧状态快照（GPU 渲染器 / 预览共用） */
  frameState() {
    return {
      lightX: this.px,
      lightY: this.py,
      sx: this.sx,
      sy: this.sy,
      ripples: this.ripples as readonly Ripple[],
      dust: this.dust as readonly Dust[],
      material: this.cfg.material,
      thickness: this.cfg.thickness,
      refraction: this.cfg.refraction,
      ripple: this.cfg.ripple,
    };
  }

  setConfig(cfg: PhysicsSettings): void {
    this.cfg = { ...cfg };
    // 锚点变化时若引擎未运行，直接把球放回锚点（静态光源位置即时生效）
    if (!this.running) {
      this.px = cfg.lightX;
      this.py = cfg.lightY;
      this.vx = 0; this.vy = 0;
    }
    // 光尘数量对齐
    const want = cfg.particles;
    while (this.dust.length < want) {
      this.dust.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.02, vy: (Math.random() - 0.5) * 0.02,
        r: 1.5 + Math.random() * 3.5, a: 0.25 + Math.random() * 0.5,
      });
    }
    this.dust.length = want;
    this.pushCss();
    this.notify();
  }

  /** 点击冲量：向光源球施加一个背离点击点的速度（反弹触感） */
  pulse(nx: number, ny: number): void {
    const dx = this.px - nx;
    const dy = this.py - ny;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const force = 0.34 * (0.4 + this.cfg.bounce * 1.2) * (0.5 + this.cfg.rebound);
    this.vx += (dx / d) * force;
    this.vy += (dy / d) * force;
    const amp = 0.16 + 0.5 * this.cfg.ripple;
    this.ripples.push({ x: nx, y: ny, r: 0.01, max: amp, alpha: 1 });
    if (this.ripples.length > 10) this.ripples.shift();
    if (!this.running) this.start();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      this.tick(Math.min(0.05, (t - this.last) / 1000));
      this.last = t;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.notify();
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // 停回锚点
    this.px = this.cfg.lightX;
    this.py = this.cfg.lightY;
    this.vx = 0; this.vy = 0;
    this.sx = 0; this.sy = 0;
    this.pushCss();
    this.notify();
  }

  private tick(dt: number): void {
    const c = this.cfg;
    const g = c.gravity * 0.16;              // 重力加速度（0–1 空间）
    const vis = clamp(c.viscosity, 0, 0.92);
    const damp = Math.pow(1 - vis * 0.055, dt * 60); // 黏稠度阻尼（按帧率归一）
    const elastic = 0.25 + c.bounce * 1.9;    // 弹簧刚度（反弹触感）
    const k = (0.8 + c.rebound * 2.2);        // 回弹速率

    // 果冻：锚点弹簧有过冲；其他材质弹簧收敛
    const spring = c.material === 'jelly' ? elastic * 1.6 : elastic;
    const accel = spring * dt * k;
    this.vx = (this.vx + (c.lightX - this.px) * accel) * damp;
    this.vy = (this.vy + (c.lightY - this.py) * accel + g * dt) * damp;
    this.px += this.vx * dt;
    this.py += this.vy * dt;

    // 边界反弹（反弹触感 + 反弹速度决定回弹比例）
    const rest = 0.42 * (0.4 + c.bounce) * (0.5 + c.rebound * 0.5);
    if (this.px < 0.02) { this.px = 0.02; this.vx = Math.abs(this.vx) * rest; this.spawnRipple(0.02, this.py); }
    if (this.px > 0.98) { this.px = 0.98; this.vx = -Math.abs(this.vx) * rest; this.spawnRipple(0.98, this.py); }
    if (this.py < 0.02) { this.py = 0.02; this.vy = Math.abs(this.vy) * rest; this.spawnRipple(this.px, 0.02); }
    if (this.py > 0.98) { this.py = 0.98; this.vy = -Math.abs(this.vy) * rest; this.spawnRipple(this.px, 0.98); }

    // 果冻形变（速度映射为过冲量）
    if (c.material === 'jelly') {
      this.sx = clamp(this.vx * 1.4, -0.12, 0.12);
      this.sy = clamp(this.vy * 1.4, -0.12, 0.12);
    } else {
      this.sx *= 0.9; this.sy *= 0.9;
    }

    // 波纹扩散
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += (0.22 + 0.5 * c.ripple) * dt;
      rp.alpha -= dt * 0.9;
      if (rp.alpha <= 0 || rp.r > rp.max) this.ripples.splice(i, 1);
    }

    // 光尘
    for (const d of this.dust) {
      d.vx += (this.px - d.x) * 0.06 * dt;
      d.vy += (this.py - d.y) * 0.06 * dt;
      d.vx *= 0.985; d.vy *= 0.985;
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0 || d.x > 1) d.vx *= -1;
      if (d.y < 0 || d.y > 1) d.vy *= -1;
    }

    this.pushCss();
  }

  private spawnRipple(x: number, y: number): void {
    const amp = 0.12 + 0.3 * this.cfg.ripple;
    this.ripples.push({ x, y, r: 0.01, max: amp, alpha: 1 });
    if (this.ripples.length > 10) this.ripples.shift();
  }

  /** 把光源位置 / 材质 / 波纹写入 CSS 变量 */
  private pushCss(): void {
    const root = document.documentElement;
    const set = (k: string, v: string) => root.style.setProperty(k, v);
    set('--lg-lx', (this.px * 100).toFixed(2) + '%');
    set('--lg-ly', (this.py * 100).toFixed(2) + '%');
    set('--lg-sx', this.sx.toFixed(4));
    set('--lg-sy', this.sy.toFixed(4));
    set('--lg-ripple', this.ripples.length ? String(Math.max(...this.ripples.map((r) => r.alpha))) : '0');
    set('--lg-mat-blur', this.cfg.material === 'frost' ? '1.6' : this.cfg.material === 'metal' ? '0.55' : '1');
    set('--lg-mat-sheen', this.cfg.material === 'metal' ? '1.35' : this.cfg.material === 'frost' ? '0.75' : '1');
    set('--lg-mat-sat', this.cfg.material === 'metal' ? '1.25' : this.cfg.material === 'frost' ? '0.85' : '1');
    set('--lg-thick', this.cfg.thickness.toFixed(3));
    set('--lg-refr', this.cfg.refraction.toFixed(3));
  }

  /** 把当前状态画进预览 canvas（可点击：点击处产生波纹 + 冲量） */
  renderPreview(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 逻辑尺寸用 CSS 像素（配合调用方的 dpr 变换），保证高清屏不偏移
    const W = canvas.clientWidth || canvas.width;
    const H = canvas.clientHeight || canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 玻璃面板底（圆角、半透明白渐变）
    const panel = ctx.createLinearGradient(0, 0, W * 0.4, H);
    panel.addColorStop(0, 'rgba(255,255,255,0.85)');
    panel.addColorStop(1, 'rgba(255,255,255,0.32)');
    ctx.fillStyle = panel;
    const rr = Math.min(W, H) * 0.14;
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, rr);
    ctx.fill();
    // 面板描边（玻璃边缘提亮）
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 光斑（光源球 + 材质差异）
    const lx = this.px * W;
    const ly = this.py * H;
    const mat = this.cfg.material;
    const glowR = (mat === 'frost' ? 1.35 : mat === 'metal' ? 0.8 : 1) * Math.min(W, H) * 0.22;
    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, glowR);
    glow.addColorStop(0, mat === 'metal' ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.9)');
    glow.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, glowR, 0, Math.PI * 2);
    ctx.fill();

    // 果冻形变：光斑拉伸
    if (mat === 'jelly' && (Math.abs(this.sx) > 0.005 || Math.abs(this.sy) > 0.005)) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.scale(1 + this.sx * 2, 1 + this.sy * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(0, 0, glowR * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 光尘
    for (const d of this.dust) {
      ctx.fillStyle = `rgba(255,255,255,${(d.a * 0.7).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 波纹
    for (const rp of this.ripples) {
      const R = rp.r * Math.min(W, H);
      ctx.strokeStyle = `rgba(255,255,255,${(rp.alpha * 0.85).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(rp.x * W, rp.y * H, R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** 全局单例：外观光影与设置页预览共用 */
export const physics = new PhysicsEngine();

export function normalizePhysics(p?: Partial<PhysicsSettings> | null): PhysicsSettings {
  const src: any = p || {};
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v ?? def);
    return Number.isFinite(n) ? clamp(n, min, max) : def;
  };
  return {
    enabled: !!src.enabled,
    lightX: num(src.lightX, DEFAULT_PHYSICS.lightX, 0.02, 0.98),
    lightY: num(src.lightY, DEFAULT_PHYSICS.lightY, 0.02, 0.98),
    material: MATERIALS.some((m) => m.id === src.material) ? src.material : 'glass',
    bounce: num(src.bounce, DEFAULT_PHYSICS.bounce, 0, 1),
    rebound: num(src.rebound, DEFAULT_PHYSICS.rebound, 0, 1),
    ripple: num(src.ripple, DEFAULT_PHYSICS.ripple, 0, 1),
    particles: num(src.particles, DEFAULT_PHYSICS.particles, 0, 80),
    viscosity: num(src.viscosity, DEFAULT_PHYSICS.viscosity, 0, 1),
    gravity: num(src.gravity, DEFAULT_PHYSICS.gravity, 0, 2),
    thickness: num(src.thickness, DEFAULT_PHYSICS.thickness, 0, 1),
    refraction: num(src.refraction, DEFAULT_PHYSICS.refraction, 0, 1),
  };
}

/**
 * 应用物理设置：
 *  · enabled=false → 停止引擎，静态光源写回 CSS 变量（设置的光源位置仍生效）
 *  · enabled=true  → 启动引擎，光影由物理模拟驱动
 * 返回归一化后的配置。
 */
export function applyPhysics(p?: Partial<PhysicsSettings> | null): PhysicsSettings {
  const cfg = normalizePhysics(p);
  physics.setConfig(cfg);
  if (cfg.enabled) physics.start();
  else physics.stop();
  return cfg;
}

/* ════════════════════════════════════════════════════════════
 * GlassRenderer — Liquid Glass GPU 渲染器（WebGL2）
 * ────────────────────────────────────────────────────────────
 * 凸透镜折射 / 色散 / 高光 / 波纹 / 光尘全部在 fragment shader
 * 里逐像素计算（GPU）；CPU 只做光源球质点动力学（每帧几十次
 * 乘加，可忽略）。渲染内容：
 *   · 凸透镜折射：厚度 → 透镜高度场 → 法线 → Snell 折射偏移，
 *     背景按偏移采样弯曲；R/B 通道偏移量不同 → 边缘彩虹色散。
 *   · 镜面高光：Blinn-Phong，光源位置由物理引擎驱动。
 *   · 波纹 / 光尘：物理引擎状态直通 uniform 数组。
 *   · 厚度边缘：边缘变厚吸光（暗角）+ 内缘提亮线。
 * 创建失败（无 WebGL2）返回 null，调用方回退到 CSS 光影。
 * ════════════════════════════════════════════════════════════ */

export interface GlassFrame {
  /** 光源位置 0–1 */
  lightX: number;
  lightY: number;
  /** 果冻形变 0–1 */
  sx: number;
  sy: number;
  /** 波纹列表 */
  ripples: readonly { x: number; y: number; r: number; alpha: number }[];
  /** 光尘列表 */
  dust: readonly { x: number; y: number; r: number; a: number }[];
  /** 材质 */
  material: GlassMaterial;
  /** 玻璃厚度 0–1 */
  thickness: number;
  /** 折射强度 0–1 */
  refraction: number;
  /** 波纹强度 0–1 */
  ripple: number;
  /** 背景 4 色（RGB 0–255） */
  bgA: [number, number, number];
  bgB: [number, number, number];
  bgMid: [number, number, number];
  bgBottom: [number, number, number];
  /** 窗口圆角（CSS px） */
  radiusPx: number;
  /** 已运行秒数 */
  time: number;
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;        // 物理像素尺寸
uniform float uDpr;        // devicePixelRatio
uniform vec2  uLight;      // 光源位置 0–1
uniform vec2  uStretch;    // 果冻形变
uniform float uThick;      // 玻璃厚度 0–1
uniform float uRefr;       // 折射强度 0–1
uniform float uRippleAmp;  // 波纹强度
uniform float uMatGlow;    // 材质光斑半径系数（frost 扩散 / metal 收紧）
uniform float uMatSheen;   // 材质高光系数
uniform float uRadius;     // 圆角（CSS px）
uniform float uTime;
uniform vec3  uBgA;
uniform vec3  uBgB;
uniform vec3  uBgMid;
uniform vec3  uBgBottom;
uniform float uRippleCount;
uniform float uDustCount;
uniform vec4  uRipples[10];  // x,y,r,alpha
uniform vec4  uDust[80];     // x,y,r,a

vec3 bgColor(vec2 uv) {
  vec3 c = mix(uBgBottom, uBgMid, smoothstep(0.0, 0.75, uv.y));
  float d1 = distance(uv, vec2(0.14, -0.14));
  c = mix(c, uBgA, exp(-d1 * d1 * 13.0) * 0.95);
  float d2 = distance(uv, vec2(0.96, -0.06));
  c = mix(c, uBgB, exp(-d2 * d2 * 10.0) * 0.85);
  float d3 = distance(uv, vec2(0.55, 1.18));
  c = mix(c, uBgMid * 1.06, exp(-d3 * d3 * 8.0) * 0.6);
  return c;
}

void main() {
  // CSS px 空间（物理像素 / dpr），原点左上
  vec2 px = gl_FragCoord.xy / uDpr;
  vec2 uv = px / uRes;
  vec2 size = uRes;

  // 圆角裁剪（四角超出圆角矩形 → 透明）
  float rad = uRadius;
  vec2 halfS = size * 0.5;
  vec2 q = abs(px - halfS) - (halfS - vec2(rad));
  float corner = length(max(q, 0.0)) - rad;
  if (corner > 0.0) discard;

  // 透镜坐标系：中心原点，按宽高比校正为正方形空间
  vec2 p = (px - halfS) / min(size.x, size.y);   // 0–1 量级
  float r = length(p);

  // 凸透镜高度场（球冠）：厚度越大中心越凸
  float lensR = 0.72;                            // 透镜半径（超出后为平板玻璃）
  float dh = 0.0;                                // dh/dr
  if (r < lensR) {
    float k = uThick * 0.16;                     // 中心最大凸起（0–1 空间）
    float t = clamp(r / lensR, 0.0, 1.0);
    dh = -k * t / max(0.001, sqrt(max(0.0, 1.0 - t * t)) * lensR);
  }
  // 法线（高度场梯度）
  vec2 grad = r < lensR && r > 0.0001 ? (p / r) * dh : vec2(0.0);
  vec3 n = normalize(vec3(-grad, 1.0));

  // Snell 折射偏移（凸透镜：背景向外侧弯曲 → 中心放大、边缘压缩）
  float ior = 1.0 + 0.85 * uRefr;               // 折射率 1.0–1.85
  vec2 off = grad * (ior - 1.0) * (0.6 + 0.8 * uThick);
  // 波纹折射扰动（波纹处局部隆起再凹下）
  vec2 offR = vec2(0.0);
  float ringLight = 0.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= uRippleCount) break;
    vec4 rp = uRipples[i];
    vec2 rc = (rp.xy * uRes - px) / min(size.x, size.y);
    float d = length(rc);
    float band = exp(-pow((d - rp.z) * 9.0, 2.0));
    offR += normalize(rc + 0.0001) * band * 0.05 * rp.w * uRippleAmp;
    ringLight += band * 0.35 * rp.w * uRippleAmp;
  }
  vec2 offT = off + offR;

  // 折射采样：R 偏移更大 / B 偏移更小 → 色散
  vec2 uvR = uv + offT * 1.22 * (uRes / max(uRes.x, uRes.y));
  vec2 uvG = uv + offT * 1.00 * (uRes / max(uRes.x, uRes.y));
  vec2 uvB = uv + offT * 0.82 * (uRes / max(uRes.x, uRes.y));
  vec3 col;
  col.r = bgColor(uvR).r;
  col.g = bgColor(uvG).g;
  col.b = bgColor(uvB).b;

  // 高光：Blinn-Phong，光源由物理引擎驱动
  vec2 lp = (uLight - vec2(0.5)) * vec2(1.0, -1.0);
  vec3 l = normalize(vec3(lp, 0.85));
  vec3 v = vec3(0.0, 0.0, 1.0);
  vec3 hvec = normalize(l + v);
  float ndh = max(dot(n, hvec), 0.0);
  float spec = pow(ndh, 90.0 - 30.0 * uThick) * (0.55 + 1.1 * uThick) * uMatSheen;
  // 次高光（宽晕）
  float spec2 = pow(max(dot(n, l), 0.0), 6.0) * 0.18 * uMatSheen;
  // 光源光斑（材质半径差异）
  vec2 lp2 = (uLight - vec2(0.5)) * vec2(1.0, -1.0) + uStretch;
  float lr = uMatGlow * 0.34;
  float spot = exp(-dot(lp2 - p, lp2 - p) / (lr * lr)) * (0.5 + 0.3 * uThick);

  // 光尘
  float dustGlow = 0.0;
  for (int i = 0; i < 80; i++) {
    if (float(i) >= uDustCount) break;
    vec4 dd = uDust[i];
    vec2 dp = dd.xy - uv;
    float g = exp(-dot(dp, dp) / (dd.z * dd.z * 0.0009)) * dd.w;
    dustGlow += g;
  }
  dustGlow *= 0.9 + 0.1 * sin(uTime * 2.0 + 1.7);

  // 厚度边缘：边缘玻璃变厚 → 透光率下降 + 内缘高光细线
  float edge = smoothstep(0.30, 0.50, r) * (0.10 + 0.30 * uThick);
  float edgeLine = (smoothstep(0.40, 0.485, r) - smoothstep(0.485, 0.5, r)) * (0.12 + 0.4 * uThick);
  float transmit = 1.0 - edge;
  // 果冻过冲微亮
  float jelly = length(uStretch) * 0.35;

  vec3 outCol = col * transmit;
  outCol += vec3(1.0) * (spec + spec2 + spot + ringLight + dustGlow + edgeLine + jelly);
  outCol = max(outCol, col * (0.25 + 0.2 * uThick));  // 玻璃底透色

  outColor = vec4(outCol, 1.0);
}`;

export class GlassRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject;
  private t0 = performance.now();

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, prog: WebGLProgram) {
    this.canvas = canvas;
    this.gl = gl;
    this.prog = prog;
    const g = gl;
    for (const name of [
      'uRes', 'uDpr', 'uLight', 'uStretch', 'uThick', 'uRefr', 'uRippleAmp',
      'uMatGlow', 'uMatSheen', 'uRadius', 'uTime', 'uBgA', 'uBgB', 'uBgMid',
      'uBgBottom', 'uRippleCount', 'uDustCount', 'uRipples', 'uDust',
    ]) {
      this.uni[name] = g.getUniformLocation(prog, name);
    }
    this.vao = g.createVertexArray()!;
  }

  /** 在 canvas 上创建 WebGL2 渲染器；失败返回 null（调用方回退 CSS 光影） */
  static create(canvas: HTMLCanvasElement): GlassRenderer | null {
    try {
      const gl = canvas.getContext('webgl2', {
        antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance',
      }) as WebGL2RenderingContext | null;
      if (!gl) return null;
      const compile = (type: number, src: string): WebGLShader => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error('shader: ' + gl.getShaderInfoLog(sh));
        }
        return sh;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('link: ' + gl.getProgramInfoLog(prog));
      }
      return new GlassRenderer(canvas, gl, prog);
    } catch (e) {
      console.warn('[GlassRenderer] WebGL2 不可用，回退 CSS 光影', e);
      return null;
    }
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(f: GlassFrame): void {
    const g = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.viewport(0, 0, w, h);
    g.useProgram(this.prog);
    g.bindVertexArray(this.vao);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const u = this.uni;
    g.uniform2f(u.uRes, this.canvas.clientWidth, this.canvas.clientHeight);
    g.uniform1f(u.uDpr, dpr);
    g.uniform2f(u.uLight, f.lightX, f.lightY);
    g.uniform2f(u.uStretch, f.sx, f.sy);
    g.uniform1f(u.uThick, f.thickness);
    g.uniform1f(u.uRefr, f.refraction);
    g.uniform1f(u.uRippleAmp, 0.4 + f.ripple);
    const mat = f.material;
    g.uniform1f(u.uMatGlow, mat === 'frost' ? 1.35 : mat === 'metal' ? 0.8 : 1);
    g.uniform1f(u.uMatSheen, mat === 'metal' ? 1.35 : mat === 'frost' ? 0.75 : 1);
    g.uniform1f(u.uRadius, f.radiusPx);
    g.uniform1f(u.uTime, (performance.now() - this.t0) / 1000);
    const c = (x: [number, number, number]) => [x[0] / 255, x[1] / 255, x[2] / 255] as const;
    g.uniform3f(u.uBgA, ...c(f.bgA));
    g.uniform3f(u.uBgB, ...c(f.bgB));
    g.uniform3f(u.uBgMid, ...c(f.bgMid));
    g.uniform3f(u.uBgBottom, ...c(f.bgBottom));

    const rp = new Float32Array(40);
    const rc = Math.min(10, f.ripples.length);
    for (let i = 0; i < rc; i++) {
      const r = f.ripples[i];
      rp[i * 4] = r.x; rp[i * 4 + 1] = r.y; rp[i * 4 + 2] = r.r; rp[i * 4 + 3] = r.alpha;
    }
    g.uniform1f(u.uRippleCount, rc);
    g.uniform4fv(u.uRipples, rp);

    const ds = new Float32Array(320);
    const dc = Math.min(80, f.dust.length);
    for (let i = 0; i < dc; i++) {
      const d = f.dust[i];
      ds[i * 4] = d.x; ds[i * 4 + 1] = d.y; ds[i * 4 + 2] = Math.max(0.001, d.r); ds[i * 4 + 3] = d.a;
    }
    g.uniform1f(u.uDustCount, dc);
    g.uniform4fv(u.uDust, ds);

    g.drawArrays(g.TRIANGLES, 0, 3);
  }
}

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

  get running(): boolean { return this.raf !== 0; }
  get lightPos(): { x: number; y: number } { return { x: this.px, y: this.py }; }

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

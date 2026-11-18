import React, { useEffect, useRef } from 'react';
import {
  PhysicsEngine,
  GlassRenderer,
  MATERIALS,
  normalizePhysics,
  type PhysicsSettings,
  type GlassMaterial,
} from '../physics';
import { getShaderBg } from '../appearance';

interface Props {
  value: PhysicsSettings;
  onChange: (next: PhysicsSettings) => void;
}

/** 物理参数滑杆 */
const PSlider: React.FC<{
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
      step={max <= 2 ? 0.01 : 1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </div>
);

/** Liquid Glass 物理预览：独立模拟实例，可点击（点击处产生波纹并把冲量传给光源球）；GPU 折射渲染，无 WebGL2 时回退 2D */
const PhysicsPreview: React.FC<{ cfg: PhysicsSettings }> = ({ cfg }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instRef = useRef<PhysicsEngine | null>(null);
  const rendererRef = useRef<GlassRenderer | null>(null);
  if (!instRef.current) {
    const inst = new PhysicsEngine();
    inst.setConfig(cfg);
    inst.start();
    instRef.current = inst;
  }
  const inst = instRef.current;

  useEffect(() => {
    inst.setConfig(cfg);
  }, [cfg, inst]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = GlassRenderer.create(canvas);
    rendererRef.current = renderer;
    let raf = 0;
    const draw = () => {
      const r2 = canvas.getBoundingClientRect();
      if (r2.width > 0 && r2.height > 0) {
        if (renderer) {
          renderer.resize();
          const st = inst.frameState();
          const bg = getShaderBg();
          renderer.draw({
            lightX: st.lightX, lightY: st.lightY, sx: st.sx, sy: st.sy,
            ripples: st.ripples, dust: st.dust, material: st.material,
            thickness: st.thickness, refraction: st.refraction, ripple: st.ripple,
            bgA: bg.a, bgB: bg.b, bgMid: bg.mid, bgBottom: bg.bottom,
            radiusPx: Math.min(r2.width, r2.height) * 0.14,
            time: performance.now() / 1000,
          });
        } else {
          // WebGL2 不可用：回退 2D 预览
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            inst.renderPreview(canvas);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [inst]);

  return (
    <canvas
      ref={canvasRef}
      className="physics-preview"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
        const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
        inst.pulse(nx, ny);
      }}
    />
  );
};

/** 设置 → 物理引擎（Liquid Glass 光影与动态） */
export const PhysicsView: React.FC<Props> = ({ value, onChange }) => {
  const cfg = normalizePhysics(value);
  const patch = (p: Partial<PhysicsSettings>) => onChange(normalizePhysics({ ...cfg, ...p }));

  return (
    <>
      <div className="settings-section-title">物理引擎</div>
      <div className="switch-row">
        <div>
          <div className="switch-label">启用物理引擎</div>
          <div className="settings-hint-inline">
            开启后所有光影（含 Liquid Glass 高光、波纹、光尘）由物理模拟实时驱动；窗口最小化 / 最大化 / 还原动画仍走系统原生。
          </div>
        </div>
        <button
          className={`switch ${cfg.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={cfg.enabled}
          onClick={() => patch({ enabled: !cfg.enabled })}
        >
          <span className="switch-knob" />
        </button>
      </div>

      {!cfg.enabled && (
        <div className="settings-hint">
          当前关闭：Liquid Glass 使用静态光源（位置仍可调整）。开启后光源会像真实光点一样受重力、惯性、反弹影响，点击界面可给它一个冲量。
        </div>
      )}

      <div className="settings-section-title">Liquid Glass 预览</div>
      <PhysicsPreview cfg={cfg} />
      <div className="settings-hint">点击预览面板：玻璃会荡起波纹，光源球被弹开。效果与主界面一致。</div>

      <div className="settings-section-title">Liquid Glass 光源</div>
      <PSlider label="光源位置 · 水平" value={Math.round(cfg.lightX * 100)} min={2} max={98} suffix="%" onChange={(v) => patch({ lightX: v / 100 })} />
      <PSlider label="光源位置 · 垂直" value={Math.round(cfg.lightY * 100)} min={2} max={98} suffix="%" onChange={(v) => patch({ lightY: v / 100 })} />
      <div className="settings-section-title">Liquid Glass 材质</div>
      <div className="mat-grid">
        {MATERIALS.map((m) => (
          <button
            key={m.id}
            className={`mat-chip ${cfg.material === m.id ? 'active' : ''}`}
            onClick={() => patch({ material: m.id as GlassMaterial })}
          >
            <span className="mat-name">{m.label}</span>
            <span className="mat-desc">{m.desc}</span>
          </button>
        ))}
      </div>

      <div className="settings-section-title">玻璃厚度与折射</div>
      <PSlider label="玻璃厚度" value={Math.round(cfg.thickness * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ thickness: v / 100 })} />
      <PSlider label="折射强度" value={Math.round(cfg.refraction * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ refraction: v / 100 })} />
      <div className="settings-hint">
        玻璃越厚，凸透镜的弯曲越明显、边缘越有「厚边」暗角；折射强度控制透过玻璃看到的背景弯曲与彩虹色散。渲染由 GPU（WebGL2）逐像素完成。
      </div>

      <div className="settings-section-title">动力学</div>
      <PSlider label="反弹触感" value={Math.round(cfg.bounce * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ bounce: v / 100 })} />
      <PSlider label="反弹速度" value={Math.round(cfg.rebound * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ rebound: v / 100 })} />
      <PSlider label="波纹强度" value={Math.round(cfg.ripple * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ ripple: v / 100 })} />
      <PSlider label="光尘数量" value={cfg.particles} min={0} max={80} suffix=" 粒" onChange={(v) => patch({ particles: v })} />
      <PSlider label="黏稠度" value={Math.round(cfg.viscosity * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ viscosity: v / 100 })} />
      <PSlider label="重力" value={cfg.gravity} min={0} max={2} suffix=" G" onChange={(v) => patch({ gravity: v })} />
      <div className="settings-hint">
        反弹触感 = 点击时玻璃对光源球的回弹力度；反弹速度 = 回弹快慢；黏稠度越大光源越「重」；重力 0 时光源失重漂浮。
      </div>
    </>
  );
};

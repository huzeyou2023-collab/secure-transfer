import React from 'react';

/**
 * 统一线稿图标：24x24 网格、1.8 描边、圆角线帽，currentColor 取色
 * 风格参考微信/QQ/抖音的线性图标，无 emoji、无自带底色
 */
export type IconName =
  | 'file' | 'paperclip' | 'mic' | 'folder' | 'stop' | 'lock'
  | 'user' | 'palette' | 'gear' | 'info' | 'download' | 'upload' | 'pin' | 'atom' | 'transfer'
  | 'emoji' | 'resume';

/** 盾牌 Logo 图形：白心高光渐变 + 浅蓝边缘渐变 + 轮廓；路径与任务栏图标盾形一致 */
export const ShieldGlyph: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <radialGradient id="sg-glow" cx="0.4" cy="0.3" r="0.85">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.42" stopColor="#f3f8fe" />
        <stop offset="1" stopColor="#c3d9f4" />
      </radialGradient>
      <linearGradient id="sg-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#eaf2fc" />
        <stop offset="1" stopColor="#8fb2d8" />
      </linearGradient>
    </defs>
    <path
      d="M12 2.2 19.8 5.1v7.1c0 5-3.5 8.2-7.8 10-4.3-1.8-7.8-5-7.8-10V5.1Z"
      fill="url(#sg-glow)"
      stroke="#4f7cb0"
      strokeWidth="1"
      strokeLinejoin="round"
    />
    <path
      d="M12 2.2 19.8 5.1v7.1c0 5-3.5 8.2-7.8 10-4.3-1.8-7.8-5-7.8-10V5.1Z"
      fill="none"
      stroke="url(#sg-rim)"
      strokeWidth="0.5"
      strokeLinejoin="round"
      opacity="0.55"
    />
    {/* 左上高光条 */}
    <path
      d="M6.2 6.5c1.4-.5 3.2-1.3 4.7-2.5l-.8 4.4c-1.4.5-2.7 1.5-3.7 2.9Z"
      fill="#ffffff"
      opacity="0.95"
    />
    <path
      d="M8.6 12.1l2.2 2.4 4.6-5.2"
      fill="none"
      stroke="#2f5d94"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const S = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

const PATHS: Record<IconName, React.ReactNode> = {
  // 折角文档（微信式文件）
  file: (
    <>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" {...S} />
      <path d="M13.5 3.5V8.5H19" {...S} />
      <path d="M9 13h6M9 16.5h6" {...S} />
    </>
  ),
  // 回形针（微信式附件）
  paperclip: (
    <path d="M20 12.2l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.5 3.5 0 0 1 5 5L10 18a2 2 0 0 1-2.8-2.8l7.2-7.2" {...S} />
  ),
  // 麦克风
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" {...S} />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" {...S} />
      <path d="M12 18v2.5M8.5 20.5h7" {...S} />
    </>
  ),
  // 文件夹
  folder: (
    <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" {...S} />
  ),
  // 停止
  stop: <rect x="7" y="7" width="10" height="10" rx="2" {...S} />,
  // 锁
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" {...S} />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" {...S} />
      <circle cx="12" cy="15.2" r="1.2" {...S} />
    </>
  ),
  // 个人资料
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" {...S} />
      <path d="M5 20a7 7 0 0 1 14 0" {...S} />
    </>
  ),
  // 外观（调色板）
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 1.9-1.1 1.2-2-.7-1 .1-2.2 1.3-2.2H17a4.5 4.5 0 0 0 4.5-4.4C21.2 7 17.1 3.5 12 3.5z" {...S} />
      <circle cx="8" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // 齿轮
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" {...S} />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" {...S} />
    </>
  ),
  // 信息
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M12 11v5" {...S} />
      <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5" {...S} />
      <path d="M5 19.5h14" {...S} />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V9.5M7.5 13.5 12 9l4.5 4.5" {...S} />
      <path d="M5 4.5h14" {...S} />
    </>
  ),
  // 原子（物理引擎）
  atom: (
    <>
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" {...S} />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" {...S} />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)" {...S} />
    </>
  ),
  // 传输中心（双向交换箭头）
  transfer: (
    <>
      <path d="M4.5 8.5h10.5M12 5.5 15 8.5l-3 3" {...S} />
      <path d="M19.5 15.5H9M12 12.5 9 15.5l3 3" {...S} />
    </>
  ),
  // 表情（圆脸笑脸）
  emoji: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d="M8.5 14.2c.9 1.2 2 1.8 3.5 1.8s2.6-.6 3.5-1.8" {...S} />
    </>
  ),
  // 断点续传：底部开口矩形（顶边裁掉）+ 中间向上箭头（箭头自开口伸出）
  resume: (
    <>
      <path d="M6.2 8.6V15.6a1.2 1.2 0 0 0 1.2 1.2h9.2a1.2 1.2 0 0 0 1.2-1.2V8.6" {...S} />
      <path className="resume-arrow" d="M12 12.4V5.2M9.4 7.8 12 5.2l2.6 2.6" {...S} />
    </>
  ),
};

export const Icon: React.FC<{ name: IconName; size?: number }> = ({ name, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {PATHS[name]}
  </svg>
);

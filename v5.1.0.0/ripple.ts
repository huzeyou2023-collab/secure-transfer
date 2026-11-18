/**
 * 苹果式点击水波：所有悬浮玻璃交互元素按下时从指针位置扩散白色波纹。
 * 与 CSS 中的“悬停变白 / 按压回弹”一起构成 Liquid Glass 的触感反馈。
 */
const RIPPLE_SELECTOR = [
  '.btn',
  '.glass-btn',
  '.seg-item',
  '.bg-chip',
  '.accent-chip',
  '.net-row',
  '.contact-row',
  '.settings-nav-item',
  '.traffic .light',
  '.chat-plus',
  '.chat-expand',
  '.plus-item',
  '.settings-close',
  '.connect-btn',
  '.settings-btn',
].join(',');

export function installRipple(): () => void {
  const onDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const el = target.closest<HTMLElement>(RIPPLE_SELECTOR);
    if (!el || el.hasAttribute('disabled')) return;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const size = Math.max(rect.width, rect.height) * 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

    el.appendChild(ripple);
    let removed = false;
    const cleanup = (): void => {
      if (removed) return;
      removed = true;
      ripple.remove();
    };
    ripple.addEventListener('animationend', cleanup, { once: true });
    window.setTimeout(cleanup, 900);
  };

  document.addEventListener('pointerdown', onDown);
  return () => document.removeEventListener('pointerdown', onDown);
}

import React, { useEffect } from 'react';

interface Props {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 通用二次确认弹窗（玻璃风格）。用于删除好友、修改加密强度/密钥等敏感操作 */
export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-mask" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal-card confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {description && <div className="modal-desc">{description}</div>}
        <div className="modal-actions">
          <button className="btn glass-btn" onClick={onCancel}>{cancelText}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>{confirmText}</button>
        </div>
      </div>
    </div>
  );
};

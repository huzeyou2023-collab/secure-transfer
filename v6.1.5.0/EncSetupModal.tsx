import React, { useState } from 'react';
import type { EncryptionStrength } from '../types';
import { DEFAULT_ENCRYPTION_STRENGTH } from '../types';

interface Props {
  open: boolean;
  /** 关闭（跳过/保存后） */
  onClose: () => void;
}

/** 首次介绍页跳过后弹出：是否设置加密密钥
 *  顶部提示词 / 中部输入框 / 左下「跳过」/ 右下「保存」 */
export const EncSetupModal: React.FC<Props> = ({ open, onClose }) => {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;

  const save = async () => {
    if (busy) return;
    setErr('');
    const k = key.trim();
    if (!k) { setErr('请输入密钥，或点左下角「跳过」不设置'); return; }
    setBusy(true);
    try {
      const r = await window.api.setEncryption(DEFAULT_ENCRYPTION_STRENGTH, k);
      if (r.success) {
        setKey('');
        onClose();
      } else {
        setErr(r.error || '保存失败');
      }
    } catch (e: any) {
      setErr(e?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    setKey('');
    setErr('');
    onClose();
  };

  return (
    <div className="modal-mask" onClick={() => { if (!busy) skip(); }} role="dialog" aria-modal="true">
      <div className="modal-card enc-setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">设置加密密钥</div>
        <div className="enc-setup-hint">
          要不要给你的通信再加一层自定义密钥？<br />
          双方填同样的密钥才能连上；不设置也可以正常使用（默认加密）。
        </div>
        <div className="modal-field">
          <label htmlFor="enc-setup-key">自定义密钥</label>
          <div className="key-input-row">
            <input
              id="enc-setup-key"
              className="form-control"
              type={show ? 'text' : 'password'}
              value={key}
              spellCheck={false}
              autoComplete="off"
              placeholder="输入密钥（至少 6 位，建议混合字母数字）"
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            />
            <button className="btn btn-sm glass-btn key-eye" type="button" onClick={() => setShow((v) => !v)} title={show ? '隐藏' : '显示'}>
              {show ? '隐藏' : '显示'}
            </button>
          </div>
        </div>
        {err && <div className="modal-err">{err}</div>}
        <div className="modal-actions enc-setup-actions">
          <button className="btn glass-btn" onClick={skip} disabled={busy}>跳过</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

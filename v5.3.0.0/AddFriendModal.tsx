import React, { useEffect, useMemo, useState } from 'react';
import type { EncryptionStrength } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

function strengthText(v?: EncryptionStrength): string {
  if (!v) return '';
  if (v === 64) return '64 位 · AES-128-GCM 兼容通道';
  return v <= 256 ? `${v} 位 · 单层 AES-${v}-GCM（AES-NI）` : `${v} 位 · ${v / 256} × AES-256-GCM 级联`;
}

/** 添加好友弹窗：IP → 端口 → 密钥（可选，留空使用默认密钥） */
export const AddFriendModal: React.FC<Props> = ({ open, onClose, onAdded }) => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('42815');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [crypto, setCrypto] = useState<{ strength?: EncryptionStrength; hasCustomKey?: boolean }>({});

  useEffect(() => {
    if (!open) return;
    setErr('');
    setBusy(false);
    (window as any).api.getCryptoInfo?.().then((c: any) => setCrypto(c || {})).catch(() => { /* 忽略 */ });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const canSubmit = useMemo(() => host.trim().length > 0 && !busy, [host, busy]);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr('');
    try {
      const r = await window.api.addFriend(host.trim(), Number(port) || 42815, key.trim() || undefined);
      if (r.success) {
        setHost('');
        setKey('');
        setPort('42815');
        setErr(r.pending ? '申请已发送，等待对方同意后即可建立连接' : '');
        if (!r.pending) {
          onAdded();
          onClose();
        }
      } else {
        setErr(r.error || '添加好友失败');
      }
    } catch (e: any) {
      setErr(e?.message || '添加好友失败');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="modal-mask" onClick={() => { if (!busy) onClose(); }} role="dialog" aria-modal="true">
      <div className="modal-card add-friend-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">添加好友</div>
        <div className="modal-desc">依次填写对方 ID、端口与密钥；密钥留空即使用默认密钥。</div>

        <div className="modal-field">
          <label htmlFor="af-host">ID</label>
          <input
            id="af-host"
            className="form-control"
            value={host}
            autoFocus
            spellCheck={false}
            placeholder="对方 ID 或 IP，例如 192.168.1.10"
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>

        <div className="modal-field">
          <label htmlFor="af-port">端口</label>
          <input
            id="af-port"
            className="form-control"
            value={port}
            inputMode="numeric"
            placeholder="42815"
            onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>

        <div className="modal-field">
          <label htmlFor="af-key">密钥（可选）</label>
          <div className="key-input-row">
            <input
              id="af-key"
              className="form-control"
              type={showKey ? 'text' : 'password'}
              value={key}
              spellCheck={false}
              autoComplete="off"
              placeholder={crypto.hasCustomKey ? '留空 = 使用设置里的全局密钥' : '留空 = 使用默认密钥（推荐）'}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
            <button className="btn btn-sm glass-btn key-eye" type="button" onClick={() => setShowKey((v) => !v)} title={showKey ? '隐藏' : '显示'}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </div>

        <div className="modal-hint">
          当前加密强度：{strengthText(crypto.strength)}
          {crypto.hasCustomKey ? ' · 已启用全局密钥' : ''}
          <br />
          填写密钥即与该好友使用固定密钥：双方必须填写完全相同的密钥，否则无法连接；密钥只以哈希形式保存在本机。
        </div>

        {err && <div className="modal-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn glass-btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
            {busy ? '配对中…' : '添加好友'}
          </button>
        </div>
      </div>
    </div>
  );
};

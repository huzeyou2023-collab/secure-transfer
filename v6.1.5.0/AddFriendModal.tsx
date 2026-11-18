import React, { useEffect, useMemo, useState } from 'react';
import type { EncryptionStrength } from '../types';
import { ENCRYPTION_STRENGTHS } from '../types';

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

/** 添加好友弹窗：ID → 端口 → 强度 → 密钥（密钥留空使用默认密钥） */
export const AddFriendModal: React.FC<Props> = ({ open, onClose, onAdded }) => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('42815');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; ok?: boolean } | null>(null);
  const [crypto, setCrypto] = useState<{ strength?: EncryptionStrength; hasCustomKey?: boolean }>({});
  const [strength, setStrength] = useState<EncryptionStrength>(256);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setBusy(false);
    (window as any).api.getCryptoInfo?.().then((c: any) => {
      setCrypto(c || {});
      if (c?.strength) setStrength(c.strength);
    }).catch(() => { /* 忽略 */ });
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
    setErr(null);
    try {
      const r = await window.api.addFriend(host.trim(), Number(port) || 42815, key.trim() || undefined, strength);
      if (r.success) {
        setHost('');
        setKey('');
        setPort('42815');
        // 申请已发送：绿色；失败才红色
        setErr(r.pending ? { text: '申请已发送，等待对方同意后即可建立连接', ok: true } : null);
        if (!r.pending) {
          onAdded();
          onClose();
        }
      } else {
        setErr({ text: r.error || '添加好友失败' });
      }
    } catch (e: any) {
      setErr({ text: e?.message || '添加好友失败' });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="modal-mask" onClick={() => { if (!busy) onClose(); }} role="dialog" aria-modal="true">
      <div className="modal-card add-friend-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">添加好友</div>
        <div className="modal-desc">依次填写对方 ID、端口、强度与密钥；密钥留空即使用默认密钥。</div>

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
          <label htmlFor="af-strength">加密强度（对方设置的值）</label>
          <div className="key-input-row">
            <select
              id="af-strength"
              className="form-control"
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value) as EncryptionStrength)}
            >
              {ENCRYPTION_STRENGTHS.map((s) => <option key={s} value={s}>{strengthText(s)}</option>)}
            </select>
          </div>
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
              placeholder={crypto.hasCustomKey ? '对方设置了密钥就填对方的；留空 = 本机全局密钥' : '对方设置了密钥就填对方的；留空 = 默认密钥（推荐）'}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
            <button className="btn btn-sm glass-btn key-eye" type="button" onClick={() => setShowKey((v) => !v)} title={showKey ? '隐藏' : '显示'}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </div>

        <div className="modal-hint">
          本机加密强度：{strengthText(crypto.strength)}
          {crypto.hasCustomKey ? ' · 已启用全局密钥' : ''}
          <br />
          以被连接方配置为准：对方设置了密钥就在上面填入对方密钥、并选对方的强度；双方强度不同时自动按对方协商适配；密钥只以哈希形式保存在本机。
        </div>

        {err && <div className={`modal-err ${err.ok ? 'ok' : ''}`}>{err.text}</div>}

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

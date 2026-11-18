import React, { useEffect, useState } from 'react';
import type { FriendRequest } from '../types';
import { getInitials, getAvatarGradient } from '../services/device';

interface Props {
  open: boolean;
  requests: FriendRequest[];
  onRespond: (id: string, accepted: boolean) => void;
  onClose: () => void;
}

/** 好友申请列表：同意后双方才互为好友并建立连接 */
export const FriendRequestModal: React.FC<Props> = ({ open, requests, onRespond, onClose }) => {
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const respond = async (id: string, accepted: boolean) => {
    if (busy) return;
    setBusy(id);
    try {
      await onRespond(id, accepted);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="modal-mask" onClick={() => { if (!busy) onClose(); }} role="dialog" aria-modal="true">
      <div className="modal-card friend-req-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">好友申请</div>
        <div className="modal-desc">对方同意申请后才会建立连接；好友之间收发文件不再二次确认。</div>

        {requests.length === 0 ? (
          <div className="req-empty">暂无好友申请</div>
        ) : (
          <div className="req-list">
            {requests.map((r) => (
              <div className="req-item" key={r.id}>
                <div className="avatar" style={{ background: getAvatarGradient(r.name) }}>
                  {getInitials(r.name)}
                </div>
                <div className="req-info">
                  <div className="req-name">{r.name}</div>
                  <div className="req-addr mono">{r.host || '未知地址'}{r.port ? `:${r.port}` : ''}</div>
                </div>
                <div className="req-actions">
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    disabled={busy === r.id}
                    onClick={() => respond(r.id, false)}
                  >拒绝</button>
                  <button
                    className="btn btn-primary btn-sm ms-2"
                    disabled={busy === r.id}
                    onClick={() => respond(r.id, true)}
                  >同意</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn glass-btn" onClick={onClose} disabled={!!busy}>关闭</button>
        </div>
      </div>
    </div>
  );
};

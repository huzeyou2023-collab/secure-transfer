import React from 'react';
import type { FileOffer } from '../types';
import { formatBytes } from '../services/device';

interface Props {
  offer: FileOffer | null;
  onRespond: (accepted: boolean) => void;
}

export const IncomingAlert: React.FC<Props> = ({ offer, onRespond }) => {
  if (!offer) return null;
  return (
    <div className="modal-mask">
      <div className="modal-card">
        <div className="modal-title">收到文件</div>
        <div className="modal-body">
          <div className="incoming-name">{offer.name}</div>
          <div className="incoming-meta">
            来自 {offer.peerName} · {formatBytes(offer.size)}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-outline-secondary" onClick={() => onRespond(false)}>拒绝</button>
          <button className="btn btn-primary ms-2" onClick={() => onRespond(true)}>接收</button>
        </div>
      </div>
    </div>
  );
};

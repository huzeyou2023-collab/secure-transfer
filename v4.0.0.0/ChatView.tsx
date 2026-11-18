import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Contact, ChatMessage, FileProgress } from '../types';
import { getInitials, getAvatarGradient, formatBytes } from '../services/device';

const StatusTag: React.FC<{ status: ChatMessage['status'] }> = ({ status }) => {
  if (status === 'read') {
    return <span className="msg-tag tag-read">已读</span>;
  }
  if (status === 'delivered' || status === 'sent') {
    return <span className="msg-tag tag-ok">发送成功</span>;
  }
  if (status === 'sending') {
    return <span className="msg-tag tag-sending">发送中…</span>;
  }
  return (
    <span className="msg-tag tag-failed">
      发送失败 · 对方不在线，已暂存，上线后自动重发
    </span>
  );
};

const Bubble: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mine = msg.dir === 'out';
  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="bubble">
        {!mine && <div className="bubble-name">{msg.name}</div>}
        <div className="bubble-text">{msg.text}</div>
        <div className="bubble-meta">
          {time}
          {mine && <StatusTag status={msg.status} />}
        </div>
      </div>
    </div>
  );
};

const TransferRow: React.FC<{ t: FileProgress }> = ({ t }) => {
  const failed = t.status === 'failed' || t.status === 'rejected';
  const done = t.status === 'done';
  const waiting = t.status === 'waiting';
  return (
    <div className={`transfer-row ${failed ? 'transfer-failed' : ''} ${done ? 'transfer-done' : ''}`}>
      <div className="d-flex justify-content-between align-items-center gap-2">
        <span className="transfer-name">
          {t.direction === 'in' ? '⬇' : '⬆'} {t.name}
        </span>
        <span className="transfer-pct">
          {done ? '已完成' : failed ? '失败' : `${t.percent}%`}
        </span>
      </div>
      {(t.status === 'transferring') && (
        <div className="progress mt-2"><div className="progress-bar" style={{ width: `${t.percent}%` }} /></div>
      )}
      {(failed || waiting) && (
        <div className={`transfer-msg ${failed ? 'transfer-msg-fail' : ''}`}>
          {failed ? t.error : t.error || '等待接收方确认…'}
        </div>
      )}
    </div>
  );
};

interface Props {
  contact: Contact;
  messages: ChatMessage[];
  transfers: FileProgress[];
  onBack: () => void;
  onSend: (text: string) => void;
  onFile: (path: string) => void;
}

export const ChatView: React.FC<Props> = ({ contact, messages, transfers, onBack, onSend, onFile }) => {
  const [text, setText] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const peerTransfers = transfers.filter((t) => t.peerName === contact.name).slice(-6);

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0] as any;
    if (f?.path) onFile(f.path);
  }, [onFile]);

  const browse = useCallback(async () => {
    const files = await window.api.selectFiles();
    if (files.length) for (const f of files) onFile(f);
  }, [onFile]);

  const sendPath = () => {
    const p = pathInput.trim();
    if (p) { onFile(p); setPathInput(''); }
  };

  return (
    <div className="chat-view"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
      onDrop={handleDrop}>
      <div className="chat-header">
        <button className="btn btn-sm btn-ghost me-2 back-btn" onClick={onBack}>‹ 好友</button>
        <div className="avatar" style={{ background: getAvatarGradient(contact.name) }}>
          {getInitials(contact.name)}
        </div>
        <div className="ms-2">
          <div className="chat-title">{contact.name}</div>
          <div className={`chat-status ${contact.online ? 'on' : 'off'}`}>
            <span className="dot" />{contact.online ? '在线 · 已加密（豪密 + AES-256-GCM）' : '离线'}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost ms-auto" onClick={() => window.api.openDownloads()}>
          接收文件夹
        </button>
      </div>

      {!contact.online && (
        <div className="offline-banner">对方当前不在线：消息与文件会在上线后自动发送（文件建议先保持程序运行）</div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && <div className="chat-empty">开始聊天，文字与文件均端到端加密</div>}
        {messages.map((m) => <Bubble key={m.id} msg={m} />)}
      </div>

      {peerTransfers.length > 0 && (
        <div className="transfer-box">
          {peerTransfers.map((t) => <TransferRow key={t.id} t={t} />)}
        </div>
      )}

      {dragging && <div className="drop-overlay">拖入文件，松开即发送（无损直传）</div>}

      <div className="path-row">
        <button className="btn btn-sm btn-attach" onClick={browse}>发送文件</button>
        <input
          className="form-control form-control-sm path-input"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendPath()}
          placeholder="可粘贴本地路径或 http(s) 地址，回车发送"
        />
      </div>

      <div className="input-row">
        <textarea
          className="form-control chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={contact.online ? '输入消息，回车发送…' : '对方离线，可先留言，上线自动送达…'}
          rows={1}
        />
        <button className="btn btn-primary send-btn" onClick={handleSend} disabled={!text.trim()}>发送</button>
      </div>
    </div>
  );
};

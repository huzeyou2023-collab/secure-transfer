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
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const peerTransfers = transfers.filter((t) => t.peerName === contact.name).slice(-6);

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    // 路径/URL 自动识别为文件发送
    if (/^([a-zA-Z]:[\\/]|https?:\/\/)/.test(t) && (t.includes('\\') || t.includes('/') || t.startsWith('http'))) {
      onFile(t);
    } else {
      onSend(t);
    }
    setText('');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0] as any;
    if (f?.path) onFile(f.path);
  }, [onFile]);

  const browse = useCallback(async () => {
    const files = await (window as any).api.selectFiles();
    if (files.length) for (const f of files) onFile(f);
  }, [onFile]);

  const toggleRec = useCallback(async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const b64 = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.readAsDataURL(blob);
        });
        await (window as any).api.saveVoice(contact.id, b64, '语音.webm');
        setRecording(false);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      alert('无法访问麦克风');
    }
  }, [recording, contact.id]);

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

      <div className="input-row">
        <button className={`btn btn-sm btn-attach ${recording ? 'rec' : ''}`} onClick={browse} title="选择文件">📎</button>
        <button className={`btn btn-sm btn-attach ${recording ? 'rec' : ''}`} onClick={toggleRec} title={recording ? '停止并发送语音' : '按住说话（点一下开始，再点一下发送）'}>
          {recording ? '⏺ 发送' : '🎤'}
        </button>
        <textarea
          className="form-control chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={contact.online ? '输入消息，回车发送；粘贴文件路径直接发文件…' : '对方离线，可先留言，上线自动送达…'}
          rows={1}
        />
        <button className="btn btn-primary send-btn" onClick={handleSend} disabled={!text.trim()}>发送</button>
      </div>
    </div>
  );
};

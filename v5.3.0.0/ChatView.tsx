import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Contact, ChatMessage, FileProgress } from '../types';
import { getInitials, getAvatarGradient } from '../services/device';

const StatusTag: React.FC<{ status: ChatMessage['status'] }> = ({ status }) => {
  if (status === 'read') {
    return <span className="msg-tag tag-read">已读</span>;
  }
  if (status === 'delivered' || status === 'sent') {
    return <span className="msg-tag tag-ok">已发送</span>;
  }
  if (status === 'sending') {
    return <span className="msg-tag tag-sending">发送中</span>;
  }
  return <span className="msg-tag tag-failed">发送失败</span>;
};

/** 输入框缩放箭头：展开 = 双箭头朝外，收起 = 双箭头朝内（SVG 描边，比字符清晰） */
const ExpandGlyph: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    {collapsed ? (
      <>
        <path d="M9.4 2.6H6.6M9.4 2.6v2.8M9.4 2.6L5.8 6.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M2.6 9.4h2.8M2.6 9.4V6.6M2.6 9.4l3.6-3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    ) : (
      <>
        <path d="M2.6 2.6h2.8M2.6 2.6v2.8M2.6 2.6l3.6 3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M9.4 9.4H6.6M9.4 9.4V6.6M9.4 9.4l-3.6-3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    )}
  </svg>
);

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
  sendKeyMode: 'enter' | 'shift-enter';
  onBack: () => void;
  onSend: (text: string) => void;
  onFile: (path: string) => void;
  onConnect: (peerId: string) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
}

export const ChatView: React.FC<Props> = ({ contact, messages, transfers, sendKeyMode, onBack, onSend, onFile, onConnect }) => {
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 连接成功后清掉旧的连接错误提示
  useEffect(() => {
    if (contact.online) setConnectErr('');
  }, [contact.online]);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectErr('');
    try {
      const r = await onConnect(contact.id);
      if (r.pending) setConnectErr('好友申请已发送，等待对方同意');
      else if (!r.success) setConnectErr(r.error || '连接失败，请确认对方已上线');
    } catch (e: any) {
      setConnectErr('连接失败：' + (e?.message || '未知错误'));
    } finally {
      setConnecting(false);
    }
  };

  const peerTransfers = transfers.filter((t) => t.peerName === contact.name).slice(-6);

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    // 输入框只发文字；文件统一走左下角「＋」菜单
    onSend(t);
    setText('');
  };

  /**
   * 回车行为（可在设置中切换）：
   *  · enter（默认）：Enter 发送，Shift+Enter 换行
   *  · shift-enter：Shift+Enter 发送，Enter 换行
   *  · Ctrl/Cmd+Enter 始终发送；中文输入法组词中不触发
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if ((e.nativeEvent as any).isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const wantSend = mod || (sendKeyMode === 'enter' ? !e.shiftKey : e.shiftKey);
    if (wantSend) {
      e.preventDefault();
      handleSend();
    }
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
          <div className={`chat-status ${contact.online ? 'on' : contact.connecting ? 'connecting' : 'off'}`}>
            <span className="dot" />{contact.online ? '在线' : contact.connecting ? '连接中…' : '离线'}
          </div>
        </div>
        {!contact.online && (
          <button
            className="btn btn-sm glass-btn connect-btn"
            onClick={handleConnect}
            disabled={connecting || contact.connecting}
            title="连接对方"
          >
            {connecting || contact.connecting ? '连接中…' : '连接'}
          </button>
        )}
        <button className="btn btn-sm btn-ghost ms-auto" onClick={() => window.api.openDownloads()}>
          聊天文件
        </button>
      </div>

      {!contact.online && (
        <div className={`offline-banner ${contact.connecting ? 'connecting' : ''}`}>
          {connectErr || (contact.connecting ? '正在连接对方，请稍候…' : '对方不在线，消息会在对方上线后送达')}
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && <div className="chat-empty">发个消息，开始聊天吧</div>}
        {messages.map((m) => <Bubble key={m.id} msg={m} />)}
      </div>

      {peerTransfers.length > 0 && (
        <div className="transfer-box">
          {peerTransfers.map((t) => <TransferRow key={t.id} t={t} />)}
        </div>
      )}

      {dragging && <div className="drop-overlay">松开鼠标，把文件发给对方</div>}

      <div className="input-row">
        <div
          className={`chat-input-card ${expanded ? 'expanded' : ''}`}
          onClick={() => inputRef.current?.focus()}
        >
          <div className="chat-input-top">
            <div className="chat-tools">
              {plusOpen && <div className="plus-backdrop" onClick={() => setPlusOpen(false)} />}
              <button
                className={`chat-plus ${plusOpen ? 'open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setPlusOpen((v) => !v); }}
                title="发送文件、语音等"
                aria-label="更多功能"
              >＋</button>
              {plusOpen && (
                <div className="plus-menu">
                  <button className="plus-item" onClick={(e) => { e.stopPropagation(); setPlusOpen(false); browse(); }}>
                    <span className="plus-icon">📎</span><span>发送文件</span>
                  </button>
                  <button
                    className={`plus-item ${recording ? 'recording' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setPlusOpen(false); toggleRec(); }}
                  >
                    <span className="plus-icon">{recording ? '⏹' : '🎤'}</span>
                    <span>{recording ? '发送语音' : '语音消息'}</span>
                  </button>
                  <button className="plus-item" onClick={(e) => { e.stopPropagation(); setPlusOpen(false); window.api.openDownloads(); }}>
                    <span className="plus-icon">🗂</span><span>聊天文件</span>
                  </button>
                </div>
              )}
            </div>
            <button
              className="chat-expand"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              title={expanded ? '收起输入框' : '放大输入框'}
              aria-label={expanded ? '收起输入框' : '放大输入框'}
            ><ExpandGlyph collapsed={expanded} /></button>
          </div>

          <textarea
            ref={inputRef}
            className="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="发消息…"
            rows={1}
          />

          <div className="chat-input-foot">
            <span className="chat-input-hint">
              {sendKeyMode === 'enter' ? 'Enter 发送 · Shift+Enter 换行' : 'Shift+Enter 发送 · Enter 换行'}
            </span>
            <button className="btn btn-primary send-btn" onClick={handleSend} disabled={!text.trim()}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
};

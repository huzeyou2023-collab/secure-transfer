import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Contact, ChatMessage, FileProgress } from '../types';
import { getInitials, getAvatarGradient } from '../services/device';
import { Icon } from './Icons';

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

/** 输入框缩放箭头（SVG 描边）：右上+左下双箭头，放大前朝外、展开后朝内 */
const ExpandGlyph: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    {collapsed ? (
      // 展开态：右上角 + 左下角，箭头朝内（收起）
      <>
        <path d="M9.2 2.8H6.5M9.2 2.8v2.7M9.2 2.8L5.9 6.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M2.8 9.2h2.7M2.8 9.2V6.5M2.8 9.2l3.3-3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    ) : (
      // 收起态：右上角 + 左下角，箭头朝外（放大）
      <>
        <path d="M9.2 5.5V2.8H6.5M9.2 2.8L5.9 6.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M2.8 6.5v2.7h2.7M2.8 9.2l3.3-3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
          <Icon name={t.direction === 'in' ? 'download' : 'upload'} size={15} /> {t.name}
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
  const [micFlash, setMicFlash] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  /** 待发区：文件/语音挂到输入框，按发送键才真正发出 */
  const [pendingFile, setPendingFile] = useState<{ path: string; name: string } | null>(null);
  const [pendingVoice, setPendingVoice] = useState<{ path: string; size: number; secs: number } | null>(null);
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

  const copyAddr = async () => {
    const addr = `${contact.host || ''}:${contact.port || ''}`;
    if (!contact.host && !contact.port) return;
    try {
      await (window.api as any).copyText(addr);
      setAddrCopied(true);
      window.setTimeout(() => setAddrCopied(false), 1600);
    } catch { /* 忽略 */ }
  };

  const peerTransfers = transfers.filter((t) => t.peerName === contact.name).slice(-6);

  const handleSend = () => {
    // 优先发送待发区的文件/语音，其次发文字
    if (pendingFile) {
      onFile(pendingFile.path);
      setPendingFile(null);
      return;
    }
    if (pendingVoice) {
      onFile(pendingVoice.path);
      setPendingVoice(null);
      return;
    }
    const t = text.trim();
    if (!t) return;
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
    const dropped = Array.from(e.dataTransfer.files || []);
    for (const f of dropped) {
      // 新版 Electron 无 File.path，走 preload 暴露的 webUtils
      const p = (window as any).api.getPathForFile?.(f) || (f as any).path;
      // 拖入先挂到输入框待发区，按发送键确认才发出
      if (p) setPendingFile({ path: p, name: f.name || p.split(/[\\/]/).pop() || '文件' });
    }
  }, []);

  const browse = useCallback(async () => {
    const files = await (window as any).api.selectFiles();
    if (files.length) {
      for (const f of files) {
        setPendingFile({ path: f, name: f.split(/[\\/]/).pop() || '文件' });
      }
    }
  }, []);

  const toggleRec = useCallback(async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    // 点击语音：零点几秒的启动动画后停留在聊天界面直接录
    setMicFlash(true);
    window.setTimeout(() => setMicFlash(false), 450);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const started = Date.now();
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const b64 = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.readAsDataURL(blob);
        });
        // 只存缓存：挂到输入框待发区，按发送键确认才发出
        const r = await (window as any).api.saveVoice(contact.id, b64, '语音.webm');
        if (r?.success) setPendingVoice({ path: r.path, size: r.size || blob.size, secs });
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
            {(contact.host || contact.port) && (
              <span
                className={`chat-addr ${addrCopied ? 'copied' : ''}`}
                title={`连接地址 ${contact.host}:${contact.port}（点击复制）`}
                onClick={(e) => { e.stopPropagation(); copyAddr(); }}
              >
                <span className="chat-addr-text">{contact.host}:{contact.port}</span>
                <span className="addr-copy">{addrCopied ? '✓' : (
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <rect x="3.6" y="3.6" width="7" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
                    <path d="M1.4 8.4V2.8A1.4 1.4 0 0 1 2.8 1.4h5.6" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
                  </svg>
                )}</span>
              </span>
            )}
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
                    <span className="plus-icon"><Icon name="file" size={18} /></span><span>文件</span>
                  </button>
                  <button
                    className={`plus-item ${recording ? 'recording' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setPlusOpen(false); toggleRec(); }}
                  >
                    <span className="plus-icon"><Icon name={recording ? 'stop' : 'mic'} size={18} /></span>
                    <span>{recording ? '结束录音' : '语音'}</span>
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

          {recording && (
            <div className="rec-strip">
              <span className="rec-pulse" />
              <span className="rec-text">录音中…点左侧「结束录音」或再点一次语音结束</span>
              <button className="rec-stop" onClick={toggleRec} title="结束录音">
                <Icon name="stop" size={14} /> 结束录音
              </button>
            </div>
          )}

          {(pendingFile || pendingVoice) && (
            <div className="pending-strip">
              {pendingFile && (
                <div className="pending-chip">
                  <span className="pending-icon"><Icon name="file" size={18} /></span>
                  <span className="pending-meta">
                    <span className="pending-name">{pendingFile.name}</span>
                    <span className="pending-path" title={pendingFile.path}>{pendingFile.path}</span>
                  </span>
                  <button className="pending-x" onClick={() => setPendingFile(null)} title="取消">×</button>
                </div>
              )}
              {pendingVoice && (
                <div className="pending-chip">
                  <span className="pending-icon"><Icon name="mic" size={18} /></span>
                  <span className="pending-meta">
                    <span className="pending-name">语音 {pendingVoice.secs}s</span>
                    <span className="pending-path" title={pendingVoice.path}>录音已就绪，点发送发出</span>
                  </span>
                  <button className="pending-x" onClick={() => setPendingVoice(null)} title="取消">×</button>
                </div>
              )}
            </div>
          )}

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
            <button
              className={`btn btn-primary send-btn ${micFlash ? 'mic-flash' : ''}`}
              onClick={handleSend}
              disabled={!text.trim() && !pendingFile && !pendingVoice}
            >{recording ? '结束录音' : '发送'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

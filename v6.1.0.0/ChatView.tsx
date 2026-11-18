import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Contact, ChatMessage, FileProgress, EncryptionStrength } from '../types';
import { ENCRYPTION_STRENGTHS } from '../types';
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

/** 输入框缩放箭头（SVG 描边）：右上+左下双箭头，未展开时朝外（示意放大），展开后朝内（示意收起） */
const ExpandGlyph: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    {expanded ? (
      // 已展开：右上角 + 左下角，箭头朝内（收起）
      <>
        <path d="M9.2 2.8H6.5M9.2 2.8v2.7M9.2 2.8L5.9 6.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M2.8 9.2h2.7M2.8 9.2V6.5M2.8 9.2l3.3-3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    ) : (
      // 未展开：右上角 + 左下角，箭头朝外（放大）
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
  /** 本机全局加密强度（设置里改；用于与对方强度对比展示） */
  myStrength: EncryptionStrength;
  onBack: () => void;
  onSend: (text: string) => void;
  onFile: (path: string) => Promise<boolean>;
  onConnect: (peerId: string) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
}

export const ChatView: React.FC<Props> = ({ contact, messages, transfers, sendKeyMode, myStrength, onBack, onSend, onFile, onConnect }) => {
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micFlash, setMicFlash] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState<{ text: string; ok?: boolean } | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  /** 待发区：多个文件/语音挂到输入框，按发送键逐个真正发出 */
  const [pendingFiles, setPendingFiles] = useState<{ path: string; name: string }[]>([]);
  const [pendingVoice, setPendingVoice] = useState<{ path: string; size: number; secs: number } | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 录音计时：只在输入框工具那一行内显示秒数
  useEffect(() => {
    if (!recording) { setRecSecs(0); return; }
    recStartRef.current = Date.now();
    setRecSecs(0);
    const t = window.setInterval(() => {
      setRecSecs(Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000)));
    }, 500);
    return () => window.clearInterval(t);
  }, [recording]);

  // 连接成功后清掉旧的连接错误提示
  useEffect(() => {
    if (contact.online) setConnectErr(null);
  }, [contact.online]);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectErr(null);
    try {
      const r = await onConnect(contact.id);
      if (r.pending) setConnectErr({ text: '好友申请已发送，等待对方同意', ok: true });
      else if (!r.success) setConnectErr({ text: r.error || '连接失败，请确认对方已上线' });
    } catch (e: any) {
      setConnectErr({ text: '连接失败：' + (e?.message || '未知错误') });
    } finally {
      setConnecting(false);
    }
  };

  const copyAddr = async () => {
    // 只复制地址本体，不带端口
    const addr = `${contact.host || ''}`;
    if (!contact.host) return;
    try {
      await (window.api as any).copyText(addr);
      setAddrCopied(true);
      window.setTimeout(() => setAddrCopied(false), 1600);
    } catch { /* 忽略 */ }
  };

  const peerTransfers = transfers.filter((t) => t.peerName === contact.name).slice(-6);

  const handleSend = async () => {
    // 优先发送待发区的文件/语音，其次发文字（失败按传输记录提示，不打断后续发送）
    if (pendingFiles.length) {
      const [first, ...rest] = pendingFiles;
      setPendingFiles(rest);
      await onFile(first.path);
      return;
    }
    if (pendingVoice) {
      setPendingVoice(null);
      await onFile(pendingVoice.path);
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
    const next: { path: string; name: string }[] = [];
    for (const f of dropped) {
      // 新版 Electron 无 File.path，走 preload 暴露的 webUtils
      const p = (window as any).api.getPathForFile?.(f) || (f as any).path;
      // 拖入先挂到输入框待发区，按发送键确认才发出；支持多文件同时待发
      if (p) next.push({ path: p, name: f.name || p.split(/[\\/]/).pop() || '文件' });
    }
    if (next.length) setPendingFiles((prev) => [...prev, ...next]);
  }, []);

  const browse = useCallback(async () => {
    const files = await (window as any).api.selectFiles();
    if (files.length) {
      const next = files.map((f: string) => ({ path: f, name: f.split(/[\\/]/).pop() || '文件' }));
      setPendingFiles((prev) => [...prev, ...next]);
    }
  }, []);

  const removePending = (i: number) => {
    setPendingFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const toggleRec = useCallback(async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    // 点击语音：零点几秒的启动动画后停留在聊天界面直接录；录音状态只显示在输入框这一行内
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
            {(contact.host) && (
              <span
                className={`chat-addr ${addrCopied ? 'copied' : ''}`}
                title={`连接地址 ${contact.host}（点击复制）`}
                onClick={(e) => { e.stopPropagation(); copyAddr(); }}
              >
                <span className="chat-addr-text">{contact.host}</span>
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
        {/* 双方加密强度不同时：在「聊天文件」左侧给出强度选择（从小到大），并备注双方强度 */}
        {(() => {
          const peer = contact.enc ?? myStrength;
          if (peer === myStrength) return null;
          const [lo, hi] = peer < myStrength ? [peer, myStrength] : [myStrength, peer];
          return (
            <div className="enc-select-wrap" title="连接该好友时使用的加密强度（以对方设置为准）">
              <span className="enc-note">对方 {peer} 位 · 我方 {myStrength} 位（{lo}→{hi}）</span>
              <select
                className="enc-select"
                value={peer}
                onChange={(e) => {
                  const s = Number(e.target.value) as EncryptionStrength;
                  (window.api as any).setContactEnc(contact.id, s);
                }}
              >
                {ENCRYPTION_STRENGTHS.map((s) => <option key={s} value={s}>{s} 位</option>)}
              </select>
            </div>
          );
        })()}
      </div>

      {!contact.online && (
        <div className={`offline-banner ${contact.connecting ? 'connecting' : ''} ${connectErr?.ok ? 'ok' : ''}`}>
          {connectErr ? connectErr.text : (contact.connecting ? '正在连接对方，请稍候…' : '对方不在线，消息会在对方上线后送达')}
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
              {/* 录音状态只在输入框这一行内显示（脉冲圆点 + 秒数 + 结束按钮），不再出现整行红色横条 */}
              {recording && (
                <span className={`rec-inline ${micFlash ? 'flash' : ''}`}>
                  <span className="rec-inline-dot" />
                  <span className="rec-inline-text">{recSecs}s</span>
                  <button className="rec-inline-stop" onClick={toggleRec} title="结束录音">
                    <Icon name="stop" size={12} /> 结束录音
                  </button>
                </span>
              )}
              {plusOpen && (
                <div className="plus-menu">
                  <button className="plus-item" onClick={(e) => { e.stopPropagation(); setPlusOpen(false); browse(); }}>
                    <span className="plus-icon"><Icon name="paperclip" size={18} /></span><span>文件</span>
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
            ><ExpandGlyph expanded={expanded} /></button>
          </div>

          {(pendingFiles.length > 0 || pendingVoice) && (
            <div className="pending-strip">
              {pendingFiles.map((f, i) => (
                <div className="pending-chip" key={`${f.path}-${i}`}>
                  <span className="pending-icon"><Icon name="paperclip" size={18} /></span>
                  <span className="pending-meta">
                    <span className="pending-name">{f.name}</span>
                    <span className="pending-path" title={f.path}>{f.path}</span>
                  </span>
                  <button className="pending-x" onClick={() => removePending(i)} title="取消">×</button>
                </div>
              ))}
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
              onClick={recording ? toggleRec : handleSend}
              disabled={!recording && !text.trim() && !pendingFiles.length && !pendingVoice}
            >{recording ? '结束录音' : '发送'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

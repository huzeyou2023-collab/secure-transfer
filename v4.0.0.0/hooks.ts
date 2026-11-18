import { useState, useEffect, useCallback, useRef } from 'react';
import type { Contact, ChatMessage, FileProgress, FileOffer } from './types';

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [self, setSelf] = useState<{ id: string; name: string }>({ id: '', name: '' });

  useEffect(() => {
    window.api.getSelf().then(setSelf);
    window.api.getContacts().then(setContacts);
    window.api.onContacts(setContacts);
    return () => window.api.removeAllListeners('contacts:updated');
  }, []);

  return { contacts, self };
}

export function useChat(openPeerId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const openRef = useRef<string | null>(openPeerId);
  openRef.current = openPeerId;

  useEffect(() => {
    if (!openPeerId) {
      setMessages([]);
      return;
    }
    window.api.getHistory(openPeerId).then((list) => {
      if (openRef.current === openPeerId) setMessages(list);
    });
    window.api.markRead(openPeerId);

    const onChat = (msg: ChatMessage) => {
      if (msg.peer !== openRef.current) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (msg.dir === 'in') window.api.markRead(msg.peer);
    };
    const onStatus = (s: { peer: string; id: string; status: ChatMessage['status'] }) => {
      if (s.peer !== openRef.current) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === s.id ? { ...m, status: s.status } : m))
      );
    };

    window.api.onChat(onChat);
    window.api.onChatStatus(onStatus);
    return () => {
      window.api.removeAllListeners('chat:message');
      window.api.removeAllListeners('chat:status');
    };
  }, [openPeerId]);

  const sendText = useCallback((peerId: string, text: string) => {
    window.api.sendText(peerId, text);
  }, []);

  return { messages, sendText };
}

export function useTransfers() {
  const [transfers, setTransfers] = useState<FileProgress[]>([]);
  const [offer, setOffer] = useState<FileOffer | null>(null);

  const upsert = useCallback((p: FileProgress) => {
    setTransfers((prev) => {
      const idx = prev.findIndex((t) => t.id === p.id);
      if (idx < 0) return [...prev, p];
      // 不允许旧的“等待”状态覆盖最终状态
      const old = prev[idx];
      if ((old.status === 'done' || old.status === 'failed' || old.status === 'rejected')
        && p.status === 'waiting') return prev;
      const next = [...prev];
      next[idx] = { ...old, ...p };
      return next;
    });
  }, []);

  useEffect(() => {
    window.api.onFileProgress(upsert);
    window.api.onOffer((o) => setOffer(o));
    window.api.onSecWarn((w) => alert('安全警告：' + (w.name || '') + ' 的身份校验失败'));
    return () => {
      window.api.removeAllListeners('file:progress');
      window.api.removeAllListeners('file:offer');
      window.api.removeAllListeners('security:warn');
    };
  }, [upsert]);

  const respond = useCallback(async (accepted: boolean) => {
    if (offer) {
      await window.api.respondOffer(offer.id, accepted);
      setOffer(null);
    }
  }, [offer]);

  return { transfers, offer, respond };
}

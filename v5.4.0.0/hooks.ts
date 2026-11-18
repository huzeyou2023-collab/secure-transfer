import { useState, useEffect, useCallback, useRef } from 'react';
import type { Contact, ChatMessage, FileProgress, FriendRequest } from './types';

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [self, setSelf] = useState<{ id: string; name: string; ips?: string[]; avatar?: string }>({ id: '', name: '' });

  useEffect(() => {
    window.api.getSelf().then(setSelf);
    window.api.getContacts().then(setContacts);
    window.api.onContacts(setContacts);
    return () => window.api.removeAllListeners('contacts:updated');
  }, []);

  const refreshSelf = useCallback(() => {
    window.api.getSelf().then(setSelf);
  }, []);

  return { contacts, self, refreshSelf };
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
    window.api.onSecWarn((w) => alert('安全警告：' + (w.name || '') + ' 的身份校验失败'));
    return () => {
      window.api.removeAllListeners('file:progress');
      window.api.removeAllListeners('security:warn');
    };
  }, [upsert]);

  return { transfers };
}

/** 好友申请：收申请列表、同意/拒绝、结果提示 */
export function useFriendRequests() {
  const [requests, setRequests] = useState<FriendRequest[]>([]);

  useEffect(() => {
    const onReq = (req: FriendRequest) => {
      setRequests((prev) => (prev.some((r) => r.id === req.id) ? prev : [...prev, req]));
    };
    const onAccept = (info: { id: string; name: string }) => {
      alert(`「${info.name}」同意了你的好友申请`);
      setRequests((prev) => prev.filter((r) => r.id !== info.id));
    };
    const onDeny = (info: { id: string; name: string }) => {
      alert(`「${info.name}」拒绝了你的好友申请`);
      setRequests((prev) => prev.filter((r) => r.id !== info.id));
    };
    window.api.onFriendRequest(onReq);
    window.api.onFriendAccept(onAccept);
    window.api.onFriendDeny(onDeny);
    return () => {
      window.api.removeAllListeners('friend:request');
      window.api.removeAllListeners('friend:accepted');
      window.api.removeAllListeners('friend:denied');
    };
  }, []);

  const respond = useCallback(async (id: string, accepted: boolean) => {
    await window.api.respondFriendRequest(id, accepted);
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { requests, respond };
}

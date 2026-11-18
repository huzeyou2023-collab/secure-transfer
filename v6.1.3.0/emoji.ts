/**
 * 表情包：抖音官方小表情（顺序按抖音官方元数据，hide=0 可见项）
 * 数据在 emoji-data.ts（由 info.json 生成），本文件负责资源映射与富文本切分。
 */
import { EMOJI_LIST } from './emoji-data';

export interface EmojiDef {
  id: string;
  token: string;
  name: string;
  file: string;
}

export { EMOJI_LIST };

const FILES = import.meta.glob('./assets/emoji/*.png', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;

const BY_ID = new Map<string, EmojiDef>();
for (const e of EMOJI_LIST) BY_ID.set(e.id, e);

const NAME_TO_ID = new Map<string, string>();
for (const e of EMOJI_LIST) NAME_TO_ID.set(e.token, e.id);

export function emojiUrl(id: string): string {
  const e = BY_ID.get(id);
  if (!e) return '';
  return FILES[`./assets/emoji/${e.file}`] || '';
}

export type RichSeg =
  | { type: 'text'; value: string }
  | { type: 'emoji'; id: string; token: string };

/** 把文本中的 [表情名] 切分成片段；未命中的保留原样 */
export function splitRich(text: string): RichSeg[] {
  const re = /\[([^\[\]]{1,12})\]/g;
  const out: RichSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    const id = NAME_TO_ID.get(m[0]);
    if (id) out.push({ type: 'emoji', id, token: m[0] });
    else out.push({ type: 'text', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

const RECENT_KEY = 'emoji-recent';
const RECENT_MAX = 16;

export function getRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && BY_ID.has(x)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string): string[] {
  const cur = getRecent().filter((x) => x !== id);
  cur.unshift(id);
  const next = cur.slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* 忽略 */ }
  return next;
}

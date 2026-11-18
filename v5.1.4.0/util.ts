/**
 * 轻量工具：避免运行时依赖 npm 包。
 * uuid v4 使用 Node 内置 crypto.randomUUID（与 uuid 包的 v4 输出格式一致）。
 */
import { randomUUID } from 'crypto';

export function uuidv4(): string {
  return randomUUID();
}

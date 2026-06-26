import { createHash } from 'node:crypto';
import type { MyInvoisDocument } from './types.js';

/** 提交用的规范化 JSON 串(base64 与 hash 都基于它)。 */
export function canonicalJson(doc: MyInvoisDocument): string {
  return JSON.stringify(doc);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function toBase64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

import type { FileRef } from '../replica-v2/types.js';

/** Release identity is metadata about executable contracts, never permission to
 * add a widget or a replacement for live target/resource qualification. */
export interface SystemRelease {
  componentExtension?: FileRef;
  version: 1;
  executorId: 'native44';
  componentSet: { id: string; catalog: FileRef; types: string[] };
  knowledge: { id: string; index: FileRef; fingerprint: string; learningRelease?: FileRef };
  selectionRules: { id: string; sha256: string; files: FileRef[] };
  adapters: { id: string; sha256: string; files: FileRef[] };
}

export type SystemIntent = 'replica' | 'original' | 'learn' | 'compare' | 'resume' | 'maintain';
export const SYSTEM_LAYERS = [
  { id: 'components', title: '组件知识层' },
  { id: 'planning', title: '分析规划层' },
  { id: 'platform', title: '平台与数据适配层' },
  { id: 'execution', title: '生成执行层' },
  { id: 'delivery', title: '验收交付层' },
] as const;

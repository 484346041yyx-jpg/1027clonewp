export interface CanvasShellProof {
  enabled: boolean;
  pageId: number;
  css?: string;
  cssSourceSha256?: string;
  sourceRule?: string;
  reason?: string;
  control?: { type: string; default?: unknown };
}

/** Fixed, exact-page native Document custom_css. No model CSS enters this helper. */
export function canvasShellCSS(pageId: number, sourceCSS: string, replicationProfile?: Native44ReplicationProfile): string {
  if (!Number.isSafeInteger(pageId) || pageId < 1) throw new Error('Invalid owned page identity');
  if (!sourceCSS.includes('@media (max-width: 1024px){.sticky-toolbar-on{padding-bottom:55px}') || !sourceCSS.includes('@media (min-width: 1025px){.wd-toolbar{display:none}}')) throw new Error('Unsupported Woodmart toolbar source');
  if (isDesktopBrowserProfile(replicationProfile)) return `/* cloneWP: own desktop Canvas shell ${pageId}; manual page CSS handoff */\n@media (min-width: 1025px) { body.page-id-${pageId} .wd-toolbar { display: none !important; } body.page-id-${pageId}.sticky-toolbar-on { padding-bottom: 0 !important; } }`;
  return `/* cloneWP: own Canvas shell ${pageId}; native content uses registered controls */\n@media (max-width: 1024px) { body.page-id-${pageId} .wd-toolbar { display: none !important; } body.page-id-${pageId}.sticky-toolbar-on { padding-bottom: 0 !important; } }`;
}
import { isDesktopBrowserProfile, type Native44ReplicationProfile } from '../native44/profile.js';

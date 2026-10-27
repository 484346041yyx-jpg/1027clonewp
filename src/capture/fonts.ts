import type { CDPSession, Page } from 'playwright';
import type { RenderedFontUsage } from './types.js';

export interface FontNodeRequest { id: string; domPath: string; kind?: string; text?: string; directText?: string; primaryOwnerId?: string }
export interface RenderedFontsReport { fontsById: Record<string, RenderedFontUsage[]>; warnings: string[]; queried: number; eligible: number; timedOut: boolean }
export interface RenderedFontsOptions { maxNodes?: number; timeoutMs?: number; deadlineAt?: number; concurrency?: number }
export function isTextFontCandidate(node: FontNodeRequest): boolean {
  return (!node.primaryOwnerId || node.primaryOwnerId === node.id) && !['image', 'icon'].includes(node.kind ?? '') && !!(node.directText || node.text)?.trim() && ['text', 'link', 'button'].includes(node.kind ?? 'text');
}

/** Actual glyph font evidence from Chromium; bounded calls never infer fonts from CSS family names. */
export async function collectRenderedFonts(page: Page, nodes: FontNodeRequest[], options: RenderedFontsOptions = {}): Promise<RenderedFontsReport> {
  const candidates = nodes.filter(isTextFontCandidate);
  const maxNodes = Math.min(500, Math.max(0, options.maxNodes ?? 160));
  const chosen = candidates.slice(0, maxNodes);
  const deadline = Math.min(Date.now() + (options.timeoutMs ?? 5000), options.deadlineAt ?? Infinity);
  const report: RenderedFontsReport = { fontsById: {}, warnings: [], queried: 0, eligible: candidates.length, timedOut: false };
  if (chosen.length < candidates.length) report.warnings.push(`Rendered font proof is limited to ${chosen.length}/${candidates.length} text atoms; remaining fonts are unverified`);
  if (!chosen.length) return report;
  let session: CDPSession | undefined;
  let failed = 0;
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { report.timedOut = true; throw new Error('Rendered font evidence deadline reached'); }
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => { report.timedOut = true; reject(new Error('Rendered font evidence deadline reached')); }, Math.min(1000, remaining)); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  try {
    session = await bounded(page.context().newCDPSession(page));
    await bounded(session.send('DOM.enable'));
    await bounded(session.send('CSS.enable'));
    const { root } = await bounded(session.send('DOM.getDocument', { depth: 0, pierce: false }));
    let next = 0;
    const worker = async () => {
      while (next < chosen.length && Date.now() < deadline) {
        const node = chosen[next++];
        report.queried++;
        try {
          const { nodeId } = await bounded(session!.send('DOM.querySelector', { nodeId: root.nodeId, selector: node.domPath }));
          if (!nodeId) { failed++; continue; }
          const response = await bounded(session!.send('CSS.getPlatformFontsForNode', { nodeId }));
          const fonts = response.fonts.filter(font => typeof font.familyName === 'string' && font.familyName.length > 0 && typeof font.postScriptName === 'string' && typeof font.isCustomFont === 'boolean' && Number.isFinite(font.glyphCount) && font.glyphCount > 0).map(({ familyName, postScriptName, isCustomFont, glyphCount }) => ({ familyName, postScriptName, isCustomFont, glyphCount }));
          if (fonts.length) report.fontsById[node.id] = fonts;
          else failed++;
        } catch { failed++; }
      }
      if (next < chosen.length) report.timedOut = true;
    };
    await Promise.all(Array.from({ length: Math.min(8, Math.max(1, options.concurrency ?? 4), chosen.length) }, worker));
    if (failed) report.warnings.push(`Actual rendered font evidence unavailable for ${failed} queried text atoms; CSS family matching remains required`);
  } catch { report.warnings.push('Chromium rendered font evidence unavailable; no actual font usage was inferred'); }
  finally { await session?.detach().catch(() => undefined); }
  if (report.timedOut) report.warnings.push('Rendered font evidence hit its bounded time budget; missing font records remain unverified');
  return report;
}

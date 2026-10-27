export const SOURCE_OBSERVER_TOOLS = ['cua_repl', 'claude_browser'] as const;
export type SourceObserverTool = typeof SOURCE_OBSERVER_TOOLS[number];
export type SourceObservationMethod = 'user-opened-browser' | 'agent-opened-browser';
export type SourceObserverBrowser = 'chrome' | 'edge' | 'iab' | 'chromium';

/** Each front end keeps its own truthful pairing; neither can borrow the other's identity. */
export function sourceObserverProvenanceAllowed(method: string, tool: string, browser: string): boolean {
  if (tool === 'cua_repl') return (method === 'user-opened-browser' || method === 'agent-opened-browser') && ['chrome', 'edge', 'iab'].includes(browser);
  if (tool === 'claude_browser') return method === 'agent-opened-browser' && ['chrome', 'edge', 'chromium'].includes(browser);
  return false;
}

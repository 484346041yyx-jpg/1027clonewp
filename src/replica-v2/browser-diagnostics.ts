import { z } from 'zod';

/** A conservative project request budget, not a claim about the extension's protocol limit. */
export const BROWSER_REQUEST_BUDGET_BYTES = 32 * 1024;
export const BROWSER_READ_ONLY_RETRY_LIMIT = 1;
export const BROWSER_DIAGNOSTIC_INPUT_LIMIT_BYTES = 1024 * 1024;
export type BrowserReadFailure = 'message_too_large' | 'tab_debugger_not_attached' | 'tool_execution_timeout' | 'operation_deadline' | 'cdp_timeout' | 'browser_transport_disconnected' | 'unknown_probe_failure';
/** Failure category only; a single transport error never proves browser inventory is offline. */
export function classifyBrowserReadFailure(error: string): BrowserReadFailure {
  // The enclosing tool can stop before CDP ever returns. It is not evidence that
  // Chrome disconnected, even when the interrupted request mentioned Runtime.
  if (/js execution timed out|kernel reset|(?:tool|script) execution.{0,40}(?:timed? out|timeout)/is.test(error)) return 'tool_execution_timeout';
  if (/browser_recovery_operation_deadline(?::(?:inventory|bind|url|dom|open))?\b/i.test(error)) return 'operation_deadline';
  if (/message.{0,60}(?:too (?:large|big)|exceed)|(?:native.messaging|native message).{0,80}(?:size|limit)|(?:max(?:imum)?|exceed).{0,40}message.{0,30}(?:size|length)/is.test(error)) return 'message_too_large';
  if (/(?:debugger|debugging).{0,50}(?:not attached|not connected|detached)|not attached.{0,50}(?:tab|debugger)/is.test(error)) return 'tab_debugger_not_attached';
  if (/(?:timed? out|timeout).{0,100}(?:CDP|Page\.|Runtime\.|getFrameTree)|(?:CDP|Page\.|Runtime\.|getFrameTree).{0,100}(?:timed? out|timeout)/is.test(error)) return 'cdp_timeout';
  if (/browser.{0,40}(?:disconnected|not connected|offline)|(?:connection|transport|extension).{0,40}(?:closed|disconnected|lost)|no connected browsers/is.test(error)) return 'browser_transport_disconnected';
  return 'unknown_probe_failure';
}

/** The outer tool must be able to return the inner result or its real error. */
export function browserCallBudgetValid(operationMs: number, toolMs: number, returnMarginMs: number): boolean {
  return [operationMs, toolMs, returnMarginMs].every(value => Number.isSafeInteger(value) && value > 0)
    && operationMs + returnMarginMs <= toolMs;
}

const identity = z.string().min(1).max(240);
const positive = z.number().finite().positive();
const publicPageUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
const viewport = z.object({ width: positive, height: positive, clientWidth: positive }).strict();
const probe = z.union([
  z.object({ stage: z.literal('url'), outcome: z.literal('ok'), actualUrl: publicPageUrl }).strict(),
  z.object({ stage: z.literal('dom'), outcome: z.literal('ok'), actualUrl: publicPageUrl, readyState: z.enum(['loading', 'interactive', 'complete']), bodyPresent: z.boolean() }).strict(),
  z.object({ stage: z.enum(['url', 'dom']), outcome: z.literal('error'), error: z.string().min(1).max(8192) }).strict(),
]);
const inputSchema = z.object({
  version: z.literal(1), sourceUrl: publicPageUrl,
  inventory: z.object({ browsers: z.array(z.object({
    browserId: identity,
    tabs: z.array(z.object({ tabId: identity, url: z.string().max(8192) }).strict()).max(1000),
  }).strict()).max(100) }).strict().optional(),
  selected: z.object({ browserId: identity, tabId: identity }).strict().optional(),
  request: z.object({ utf8Bytes: z.number().int().nonnegative() }).strict().optional(),
  // Chronological real tool results for the currently selected binding only.
  probes: z.array(probe).max(6).default([]),
  capture: z.object({
    mode: z.enum(['viewport', 'full-page']), rasterWidth: positive, rasterHeight: positive,
    before: viewport, after: viewport, layoutStable: z.boolean(),
  }).strict().optional(),
}).strict();
export type BrowserDiagnosticInput = z.input<typeof inputSchema>;
export type BrowserDiagnosticCode = 'inventory_required' | 'browser_offline' | 'source_tab_missing' | 'source_tab_ambiguous'
  | 'stale_binding' | 'request_size_required' | 'request_too_large' | 'url_probe_required' | 'dom_probe_required'
  | 'source_url_changed' | 'source_document_not_ready' | 'tab_debugger_not_attached' | 'cdp_timeout_retry' | 'cdp_timeout_exhausted'
  | 'message_too_large' | 'tool_execution_timeout' | 'operation_deadline' | 'browser_transport_disconnected' | 'unknown_probe_failure' | 'read_only_retry_exhausted'
  | 'screenshot_layout_changed' | 'screenshot_geometry_mismatch' | 'ready';
export interface BrowserDiagnosticResult {
  version: 1; kind: 'browser-preflight'; status: 'ready' | 'action-required' | 'blocked';
  code: BrowserDiagnosticCode; summary: string; nextActions: string[];
  retry: { allowed: boolean; maxAdditionalAttempts: number; stage?: 'url' | 'dom' };
  requestBudgetBytes: number; checked: string[];
  scope: 'connection-preflight' | 'connection-and-screenshot-geometry';
}

function normalizedUrl(value: string): string {
  const url = new URL(value); url.hash = ''; return url.href;
}
function sameUrl(actual: string, expected: string): boolean {
  try { return normalizedUrl(actual) === normalizedUrl(expected); } catch { return false; }
}
export function browserRequestUtf8Bytes(value: unknown): number {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value, (_key, child: unknown) => {
      // Functions must be supplied as the actual transmitted source string;
      // JSON's silent omission would otherwise undercount a browser evaluate call.
      if (typeof child === 'function' || typeof child === 'symbol' || child === undefined) throw Error('browser_request_not_serializable');
      return child;
    });
    if (serialized === undefined) throw Error('browser_request_not_serializable');
    return Buffer.byteLength(serialized, 'utf8');
  } catch { throw Error('browser_request_not_serializable'); }
}

/**
 * Diagnoses supplied observations only. It never launches, attaches, navigates,
 * restarts or authorizes a browser, and never treats a tool error as page content.
 * Error text is consumed for classification and deliberately absent from output.
 */
export function diagnoseBrowserPreflight(value: unknown): BrowserDiagnosticResult {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw Error('browser_preflight_input_invalid');
  const input = parsed.data, checked: string[] = [];
  const result = (code: BrowserDiagnosticCode, summary: string, nextActions: string[], retryStage?: 'url' | 'dom'): BrowserDiagnosticResult => ({
    version: 1, kind: 'browser-preflight', status: code === 'ready' ? 'ready' : retryStage || code.endsWith('_required') ? 'action-required' : 'blocked',
    code, summary, nextActions,
    retry: { allowed: retryStage !== undefined, maxAdditionalAttempts: retryStage ? BROWSER_READ_ONLY_RETRY_LIMIT : 0, ...(retryStage ? { stage: retryStage } : {}) },
    requestBudgetBytes: BROWSER_REQUEST_BUDGET_BYTES, checked: [...checked],
    scope: input.capture ? 'connection-and-screenshot-geometry' : 'connection-preflight',
  });
  if (!input.inventory) return result('inventory_required', '尚无本次会话的浏览器库存。', ['先用当前受支持工具清点已连接实例和现有标签；由代理组装诊断输入。']);
  checked.push('current-browser-inventory');
  if (!input.inventory.browsers.length) return result('browser_offline', '当前库存没有已连接的浏览器实例。', ['先由代理进入 browser:preflight --recover 的统一有界恢复，按 0/2/5 秒重新取得真实库存；只有恢复终态 userHelpRequired:true 才请求用户连接，不要求重启浏览器。']);
  const candidates = input.inventory.browsers.flatMap(browser => browser.tabs.filter(tab => sameUrl(tab.url, input.sourceUrl)).map(tab => ({ browserId: browser.browserId, tabId: tab.tabId })));
  const selected = input.selected ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!selected) return candidates.length
    ? result('source_tab_ambiguous', '同一来源 URL 对应多个现有标签。', ['从库存逐个做小型 URL/正文只读探针，绑定实际内容完整的来源标签；不得按最近标签或浏览器名称猜测。'])
    : result('source_tab_missing', '浏览器在线，但库存中没有来源 URL 对应的标签。', ['进入 browser:preflight --recover 的有界库存恢复并核对实际来源 URL；持续缺失才报告需要用户帮助，不把标签缺失报告为浏览器离线。']);
  const binding = input.inventory.browsers.find(browser => browser.browserId === selected.browserId)?.tabs.find(tab => tab.tabId === selected.tabId);
  if (!binding || !sameUrl(binding.url, input.sourceUrl)) return result('stale_binding', '选中的会话标识不再对应当前来源标签。', ['进入 browser:preflight --recover，重新清点并按实际 URL 取得本次返回的原有标签，再验证小型读取；不沿用过期 ID 或立即要求用户重连。']);
  checked.push('inventory-source-binding');
  if (!input.request) return result('request_size_required', '尚未测量下一次浏览器调用的完整 UTF-8 请求大小。', ['代理在调用前用 browserRequestUtf8Bytes 测量完整调用体，或通过 CLI --request 检查本地请求文件。']);
  if (input.request.utf8Bytes > BROWSER_REQUEST_BUDGET_BYTES) return result('request_too_large', '下一次调用超过项目的 32 KiB 保守请求预算。', ['不要发送或重试该请求；改用区域根内遍历和小批次参数，重新测量完整请求体。']);
  checked.push('bounded-request');
  for (const stage of ['url', 'dom'] as const) {
    const history = input.probes.filter(item => item.stage === stage);
    if (!history.length) return result(stage === 'url' ? 'url_probe_required' : 'dom_probe_required', `尚未完成当前标签的 ${stage === 'url' ? '实际 URL' : '最小正文'} 只读探针。`, [stage === 'url' ? '先读取已绑定标签的实际 URL，再执行正文读取。' : '读取 location.href、document.readyState 与正文根是否存在等少量事实；不要直接发送整页采集。']);
    if (history.length > BROWSER_READ_ONLY_RETRY_LIMIT + 1) return result('read_only_retry_exhausted', '当前阶段已超过首次探针加一次只读重试的上限。', ['停止循环探针；保留分类结果并重新核对库存与绑定，报告具体障碍，不再要求重复重启。']);
    const latest = history[history.length - 1];
    if (latest.outcome === 'ok') {
      if (!sameUrl(latest.actualUrl, input.sourceUrl)) return result('source_url_changed', '实际读取的 URL 与当前来源不一致。', ['停止采集并核对重定向或错误实例；按实际页面重新建立来源身份。']);
      if (latest.stage === 'dom' && (!latest.bodyPresent || latest.readyState === 'loading')) return result('source_document_not_ready', '标签可读取，但正文尚未就绪。', ['保留当前绑定；等待当前正常加载完成后重新取得小型正文事实，不能把空根认定为内容丢失或浏览器断线。']);
      checked.push(`${stage}-probe`); continue;
    }
    const failure = classifyBrowserReadFailure(latest.error);
    if (failure === 'tool_execution_timeout') return result('tool_execution_timeout', '外层工具执行超时或会话内核被重置，尚未取得浏览器读取结果。', ['先核对工具调用方式及内外层预算；外层须覆盖初始化或读取期限与返回余量。不能把被工具中断的调用认定为 CDP 断线，也不要求用户重启或重连。']);
    if (failure === 'operation_deadline') return result('operation_deadline', '代理自己的有界操作期限已到，浏览器连接状态尚未证实。', ['区分页面内小探针预算与完整工具动作期限；工具启动、传输和结果返回时间不能塞进页面内的短预算。保留未返回状态，不制造传输断线结论或重复初始化。']);
    if (failure === 'message_too_large') return result('message_too_large', '工具报告消息大小超过通信限制。', ['缩小完整请求；若请求已小于预算，检查响应分片与工具输出大小，保持原始证据，不能用浏览器重启代替。']);
    if (failure === 'tab_debugger_not_attached') return result('tab_debugger_not_attached', '浏览器在线，但当前标签的调试会话未附着。', ['进入 browser:preflight --recover，先清点并通过受支持 API 重新取得原有来源标签、验证 URL/正文；有界恢复仍失败才请求用户执行确实缺少的连接动作，不自行重启。']);
    if (failure === 'cdp_timeout') return history.length === 1
      ? result('cdp_timeout_retry', '出现一次 CDP 只读超时，尚不足以认定浏览器断线。', ['保留当前实例与标签；对同一小型只读探针最多重试一次。'], stage)
      : result('cdp_timeout_exhausted', '同一阶段的 CDP 小探针重试仍超时。', ['停止同绑定探针循环，进入 browser:preflight --recover 的新库存及原标签重新取得流程；保留已用的一次重试事实，不将超时推断成离线或要求重启。']);
    if (failure === 'browser_transport_disconnected') return result('browser_transport_disconnected', '探针报告连接传输中断，需要新的库存事实确认范围。', ['由代理进入 browser:preflight --recover，重新取得连接器库存及原来源标签，按有界退避恢复；不能仅凭此错误要求用户重连或重启。']);
    return result('unknown_probe_failure', '探针失败，但错误不属于已证实的故障类别。', ['停止大采集，保留经脱敏的错误类别及阶段并检查工具文档；不得猜测为断线或自动更换来源访问方式。']);
  }
  if (input.capture) {
    const { before, after, rasterWidth, rasterHeight, mode, layoutStable } = input.capture;
    if (before.clientWidth > before.width || after.clientWidth > after.width || !layoutStable || before.width !== after.width || before.height !== after.height || before.clientWidth !== after.clientWidth) return result('screenshot_layout_changed', '截图前后视口或正文几何发生变化。', ['保留两次几何与原始截图，修复滚动条/临时 viewport 变化后重采；不可用缩放或空白填充掩盖布局变化。']);
    if (Math.abs(rasterWidth - before.width) > 1 || (mode === 'viewport' ? Math.abs(rasterHeight - before.height) > 1 : rasterHeight < before.height)) return result('screenshot_geometry_mismatch', '原始截图像素不能直接对应所声明的 CSS 视口。', ['先验证截图实际格式与缩放比例；需要规范化时走现有 viewport-raster/capture-equivalence 的像素来源和几何校验，不能当作连接故障。']);
    checked.push('screenshot-raster-and-stable-viewport');
  }
  return result('ready', input.capture ? '当前来源的小型读取与截图几何预检通过。' : '当前来源的小型 URL/正文读取和下一次请求大小预检通过。', [input.capture ? '继续当前来源采集；仍需现有观察导入器验证完整截图和语义证据。' : '继续有界采集；截图后补入前后视口及实际像素再做几何诊断。']);
}

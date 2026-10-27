import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { awaitWorkflowEditorReady } from '../editor-completion/session.js';

export interface EditorStartupResponse { location: string; resourceType: string; status: number; elapsedMs: number; failed?: true }
export interface NativeEditorReadinessReport {
  version: 1; passed: boolean; readOnly: true; budgetMs: number; elapsedMs: number;
  stages: Array<{ name: string; elapsedMs: number; durationMs: number; remainingBudgetMs: number; passed: boolean; errorKind?: string }>;
  documentResponses: EditorStartupResponse[];
  resourceTimings?: unknown; fonts?: unknown; error?: string;
}
const publicLocation = (raw: string) => { try { const url = new URL(raw); return `${url.origin}${url.pathname.replace(/(\/admin-access\/)[^/]+/g, '$1[omitted]')}`; } catch { return 'unavailable'; } };
/** Response timing only: never retain request/response headers, queries or authentication data. */
export function attachEditorStartupNetwork(page: Page): EditorStartupResponse[] {
  const started = Date.now(), responses: EditorStartupResponse[] = [];
  page.on('response', response => { if (responses.length < 400) responses.push({ location: publicLocation(response.url()), resourceType: response.request().resourceType(), status: response.status(), elapsedMs: Date.now() - started }); });
  page.on('requestfailed', request => { if (responses.length < 400) responses.push({ location: publicLocation(request.url()), resourceType: request.resourceType(), status: 0, elapsedMs: Date.now() - started, failed: true }); });
  return responses;
}

/** The observed 679-node editor took ~90s after DCL to initialize. Selection/control deadlines remain separate. */
export async function awaitNativeEditorReady(options: { page: Page; editorUrl: string; rootIds: string[]; runDir: string; label: string; requirePanelAPI?: boolean; timeoutMs?: number; responses?: EditorStartupResponse[] }): Promise<NativeEditorReadinessReport> {
  const { page } = options, expected = new URL(options.editorUrl);
  if (!options.rootIds.length || options.rootIds.some(id => !/^[\w-]+$/.test(id)) || !/^[\w-]+$/.test(options.label)) throw new Error('Native editor readiness requires legal owned native IDs and a receipt label');
  const current = new URL(page.url());
  if (current.origin !== expected.origin || current.pathname !== expected.pathname || current.searchParams.get('post') !== expected.searchParams.get('post') || current.searchParams.get('action') !== 'elementor') throw new Error('Native editor readiness did not reach its exact owned editor');
  const budgetMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(budgetMs) || budgetMs < 100 || budgetMs > 120_000) throw new Error('Editor initialization has a bounded maximum budget of 120 seconds');
  const started = Date.now(), report: NativeEditorReadinessReport = { version: 1, passed: false, readOnly: true, budgetMs, elapsedMs: 0, stages: [], documentResponses: [] };
  const directory = path.join(options.runDir, 'verification', 'editor-readiness'); await mkdir(directory, { recursive: true });
  const runStage = async (name: string, predicate: () => Promise<unknown>) => {
    const stageStarted = Date.now(), record: NativeEditorReadinessReport['stages'][number] = { name, elapsedMs: stageStarted - started, durationMs: 0, remainingBudgetMs: Math.max(0, budgetMs - (stageStarted - started)), passed: false }; report.stages.push(record);
    if (record.remainingBudgetMs <= 0) throw new Error(`Native editor initialization budget expired during ${name}`);
    try { await predicate(); record.passed = true; }
    catch (error) { record.errorKind = error instanceof Error && ['TimeoutError', 'TypeError', 'ReferenceError', 'Error'].includes(error.name) ? error.name : 'unavailable'; throw new Error(`Native editor initialization did not finish during ${name} within its shared ${budgetMs}ms budget`); }
    finally { record.durationMs = Date.now() - stageStarted; report.elapsedMs = Date.now() - started; }
  };
  const remaining = () => Math.max(1, budgetMs - (Date.now() - started));
  try {
    const runtime = await awaitWorkflowEditorReady(page, options.rootIds, options.label);
    if (runtime) {
      report.budgetMs = 240_000;
      report.passed = true;
      report.stages.push({ name: 'owned-editor-runtime', elapsedMs: 0, durationMs: Date.now() - started, remainingBudgetMs: Math.max(0, 240_000 - runtime.elapsedMs), passed: true });
    } else {
    await runStage('panel-model', async () => {
      const handle = await page.waitForFunction(requireAPI => {
        if (document.querySelector('#loginform')) return 'login';
        const panel = document.querySelector('#elementor-panel');
        const elementor = (window as unknown as { elementor?: { getPanelView?: () => { getCurrentPageView?: () => unknown } } }).elementor;
        if (!panel) return false;
        if (requireAPI || elementor) {
          // Elementor installs these methods before its panel view is constructed.
          try { return !!elementor?.getPanelView?.()?.getCurrentPageView?.(); }
          catch { return false; }
        }
        // Classic standalone fixtures expose their real controls directly; this is recorded as DOM readiness only.
        return !!panel.querySelector('[data-setting]');
      }, options.requirePanelAPI === true, { polling: 100, timeout: remaining() });
      if (await handle.jsonValue() === 'login') throw new Error('Owned editor authentication was unavailable');
    });
    await runStage('preview-document', async () => {
      const handle = await page.waitForFunction(() => {
        const iframe = document.querySelector<HTMLIFrameElement>('#elementor-preview-iframe'), doc = iframe?.contentDocument;
        if (!iframe || !doc || doc.readyState !== 'complete') return false;
        try { if (new URL(doc.URL).origin !== location.origin) return false; } catch { return false; }
        const box = iframe.getBoundingClientRect(), css = getComputedStyle(iframe);
        if (box.width <= 0 || box.height <= 0 || css.display === 'none' || css.visibility === 'hidden') return false;
        if (doc.querySelector('#loginform,.wp-die-message,.php-error-message')) return 'preview-error';
        return !!doc.body;
      }, undefined, { polling: 100, timeout: remaining() });
      if (await handle.jsonValue() === 'preview-error') throw new Error('Owned editor preview was unavailable');
    });
    await runStage('native-roots', async () => {
      await page.waitForFunction(ids => {
        const doc = document.querySelector<HTMLIFrameElement>('#elementor-preview-iframe')?.contentDocument;
        if (!doc) return false;
        return ids.every(id => {
          const matches = Array.from(doc.querySelectorAll(`[data-id="${id}"]`)).filter(element => !element.closest('.slick-cloned,.swiper-slide-duplicate,.elementor-sticky__spacer'));
          if (matches.length !== 1) return false;
          const element = matches[0], box = element.getBoundingClientRect(), css = doc.defaultView?.getComputedStyle(element);
          return !!element.closest('.elementor,[data-elementor-type]') && box.width > 0 && box.height > 0 && css?.display !== 'none' && css?.visibility !== 'hidden';
        });
      }, options.rootIds, { polling: 100, timeout: remaining() });
    });
    }
    report.passed = true;
    report.resourceTimings = await page.evaluate(() => [performance, document.querySelector<HTMLIFrameElement>('#elementor-preview-iframe')?.contentWindow?.performance].map(view => view?.getEntriesByType('resource').filter(entry => entry.duration > 500).slice(-80).map(entry => {
      const resource = entry as PerformanceResourceTiming;
      let address = 'unavailable';
      try { const url = new URL(resource.name); address = `${url.origin}${url.pathname.replace(/(\/admin-access\/)[^/]+/g, '$1[omitted]')}`; } catch { /* Malformed public resource URL. */ }
      return { location: address, kind: resource.initiatorType, startTime: Math.round(resource.startTime), duration: Math.round(resource.duration), responseEnd: Math.round(resource.responseEnd), transferSize: resource.transferSize };
    }) ?? []));
    report.fonts = await page.evaluate(() => ({ main: document.fonts.status, preview: document.querySelector<HTMLIFrameElement>('#elementor-preview-iframe')?.contentDocument?.fonts.status }));
    return report;
  } catch (error) { report.error = error instanceof Error ? error.message : 'Native editor initialization failed'; throw error; }
  finally { report.elapsedMs = Date.now() - started; report.documentResponses = [...(options.responses ?? [])]; await writeFile(path.join(directory, `${options.label}.json`), JSON.stringify(report, null, 2)); }
}

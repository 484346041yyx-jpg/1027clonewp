import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser } from 'playwright';
import { captureTarget } from './capture-target.js';
import { compareEvidence, repairSummary } from './compare.js';
import { unverifiedEditability } from './editability.js';
import { createPixelDiagnostic } from './pixel-diagnostic.js';
import { normalizeBindings } from './bindings.js';
import type { ElementMap, ImportedMediaEvidence, NativeEditabilityReport, ScopedBrowserAuth, SourceEvidence, VerificationReport, Viewport } from './types.js';

export * from './types.js';
export { captureTarget, createScopedContext } from './capture-target.js';
export { compareEvidence, compareElement, normalizeText, repairSummary, resolveEvidenceURL } from './compare.js';
export { verifyNativeEditor, unverifiedEditability } from './editability.js';
export type { AuthorizedEditorEdit,EditorVerificationOptions } from './editability.js';
export { normalizeBindings, targetSelector } from './bindings.js';
export { verifySafeToggles } from './interactions.js';

export async function verifyPage(options: {
  previewUrl: string;
  runDir: string;
  source: SourceEvidence;
  viewports?: Viewport[];
  plan?: unknown;
  expectedSourceIds?: string[];
  elementMap: ElementMap;
  auth?: ScopedBrowserAuth;
  browser?: Browser;
  editability?: NativeEditabilityReport;
  pixelDiagnostics?: boolean;
  assetMap?: ImportedMediaEvidence[];
  expectedMediaURLs?: Record<string, string[]>;
}): Promise<VerificationReport> {
  const sourceKinds = new Map(options.source.viewports.flatMap(viewport => viewport.elements.map(element => [element.id, element.kind] as const)));
  const elementMap = normalizeBindings(options.elementMap).map(binding => ({ ...binding, kind: binding.kind ?? sourceKinds.get(binding.sourceId) }));
  const sourceInteractions = Object.fromEntries(options.source.viewports.map(viewport => [viewport.name, viewport.interactions ?? []]));
  const measurements = await captureTarget({ ...options, elementMap, sourceInteractions, viewports: options.viewports ?? options.source.viewports.map(({name,width,height}) => ({name,width,height})) });
  const comparison = compareEvidence(options.source, measurements, options.expectedSourceIds, { assetMap: options.assetMap, expectedMediaURLs: options.expectedMediaURLs });
  const editability = options.editability ?? unverifiedEditability();
  const issues = [...comparison.issues, ...editability.issues];
  const screenshots: VerificationReport['screenshots'] = [];
  const pixelReports: unknown[] = [];
  const directory = path.join(options.runDir, 'verification');
  await mkdir(directory, { recursive: true });
  for (const target of measurements) {
    const source = options.source.viewports.find(viewport => viewport.name === target.name && viewport.width === target.width);
    const screenshot: VerificationReport['screenshots'][number] = { viewport: target.name, target: target.screenshotPath, source: source?.screenshotPath };
    if (options.pixelDiagnostics !== false && source?.screenshotPath) {
      try {
        const pixelReport = await createPixelDiagnostic(source.screenshotPath, target.screenshotPath, path.join(directory, `${target.name}-heatmap.png`));
        screenshot.heatmap = pixelReport.heatmapPath;
        pixelReports.push({ viewport: target.name, ...pixelReport });
      } catch (error) {
        issues.push({ code: 'pixel-diagnostic-unavailable', status: 'unverified', severity: 'warning', viewport: target.name, message: `Screenshot diagnostic unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    screenshots.push(screenshot);
  }
  const visualPassed = !comparison.issues.some(issue => issue.severity === 'error');
  const passed = visualPassed && editability.status === 'verified' && !issues.some(issue => issue.severity === 'error');
  const report: VerificationReport = {
    version: 1,
    passed,
    visualPassed,
    status: passed ? 'passed' : issues.some(issue => issue.status === 'mismatch' && issue.severity === 'error') ? 'failed' : 'needs-review',
    issues,
    screenshots,
    measurements,
    editability,
    coverage: comparison.coverage,
    repairSummary: repairSummary(issues),
  };
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(directory, 'pixel-diagnostic.json'), JSON.stringify({ purpose: 'Visual disagreement diagnostic only; never a fidelity acceptance score.', viewports: pixelReports }, null, 2));
  await writeFile(path.join(directory, 'repair-summary.txt'), report.repairSummary);
  return report;
}

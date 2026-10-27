import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Route } from 'playwright';
import { buildNative44PageCSS, canonicalNative44CSS, native44CSSHash, verifyNative44AppliedCSS, type Native44CSSRule } from './css-handoff.js';
import { collectNative44ProductChecks, NATIVE44_PRODUCT_WIDGETS, type Native44ProductCheck, type Native44ProductCheckEvidence } from './catalog-check.js';
import { collectNative44PostChecks, native44ObservedPostProblems, native44PostEvidencePassed, type Native44PostCheck, type Native44PostCheckEvidence } from './post-check.js';
import { collectNative44InteractionChecks, NATIVE44_CAROUSEL_WIDGETS, type Native44InteractionCheck, type Native44InteractionEvidence } from './interaction-check.js';
import { collectNative44DisclosureChecks, native44DisclosureEvidencePassed, validateNative44DisclosureChecks, type Native44DisclosureCheck, type Native44DisclosureEvidence } from './disclosure-check.js';
import { collectNative44TabsChecks, native44TabsEvidencePassed, validateNative44TabsChecks, type Native44TabsCheck, type Native44TabsEvidence } from './tabs-check.js';
import { loadNative44SourceCaptures, readNative44SourceCapture, type LoadedNative44SourceCaptures, type Native44SourceCaptureSet } from './source-captures.js';
import { assertNative44ProfileIdentity, isDesktopBrowserProfile, native44ProfileViewports, type Native44ReplicationProfile } from './profile.js';
import { captureLayoutStableScreenshot } from '../verification/layout-stable-screenshot.js';
import { createNative44CaptureMediaSession, type Native44CaptureMediaMetrics, type Native44CaptureMediaSession } from './capture-media-session.js';
import { NATIVE44_SELECTION_RULES_HASH } from './selection-rules.js';
import type { Native44CompareGap, Native44MeasuredModule } from './contracts.js';
import { compareNative44VisualModules } from './visual-audit.js';
import type { FileRef } from '../replica-v2/types.js';
import { assertNative44ReleaseIdentity, readNative44HistoricalReleaseEvidence, readNative44ReleaseLock } from './release-lock.js';
import { readNative44CurrentCaptureManifest } from './current-capture-binding.js';
import { assertNative44WholePageModuleCoverage, assertNative44WholePageReviewReady } from './review-workflow.js';
import { NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW } from './types.js';
import { assertTargetPostsEvidence, targetPostsQueryKey, type TargetPostsQueryInput } from '../wordpress/posts-contract.js';
export type { Native44CompareGap, Native44MeasuredModule } from './contracts.js';
export { prepareNative44SourceCaptures, loadNative44SourceCaptures } from './source-captures.js';
export type { Native44SourceCaptureSet, Native44SourceRenderEvidence } from './source-captures.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(sort(value));
function sort(value: unknown): unknown { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : value; }
export interface Native44CompareSnapshot { documentHash: string; structureHash: string; resourceHash: string; queryHash: string; pageCss: string }
/** Full non-CSS settings belong to the structure fingerprint. A harmless edit
 * can invalidate an old correction; a resource/query edit cannot evade it. */
export function fingerprintNative44Snapshot(snapshot: { hash: string; elements: unknown[]; settings: Record<string, unknown> }): Native44CompareSnapshot {
  const resources: unknown[] = [], queries: unknown[] = [];
  const clean = (value: unknown, at = ''): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => clean(item, `${at}/${index}`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'custom_css').map(([key, item]) => {
      if (/(?:image|media|attachment|background|svg|src|url)/i.test(key)) resources.push({ path: `${at}/${key}`, value: item });
      if (/(?:query|product|posts_ids|include|exclude|orderby|order|offset|items_per_page)/i.test(key)) queries.push({ path: `${at}/${key}`, value: item });
      return [key, clean(item, `${at}/${key}`)];
    }));
    return value;
  };
  const structure = clean({ elements: snapshot.elements, settings: snapshot.settings });
  return { documentHash: snapshot.hash, structureHash: hash(canonical(structure)), resourceHash: hash(canonical(resources)), queryHash: hash(canonical(queries)), pageCss: typeof snapshot.settings.custom_css === 'string' ? snapshot.settings.custom_css : '' };
}
export interface Native44CompareModule {
  key: string; className: string; sourceSelector: string; targetSelector: string; required: boolean;
  sourceVariants?: Array<{ viewport: string; snapshotId: string; nodeIds: string[]; selectors: string[]; visible: boolean }>;
  expectedMedia?: number;
  /** The plan must list expected logical state, rather than compare random slides. */
  state?: { carouselIndex?: number; expanded?: boolean; hover?: boolean };
  stateAdaptation?: Native44StateAdaptation;
}
export interface Native44StateAdaptation {
  mode: 'static-overflow' | 'target-catalog' | 'target-posts'; componentPlanHash: string;
  requirementIds: string[]; reason: string; targetComponentKeys?: string[];
}

/** Explicit task decision bound to the already frozen plan. This changes only
 * which runtime frames are comparable; it does not waive content/control proof. */
export function validateNative44StateAdaptations(manifest: Native44CompareManifest, loaded?: LoadedNative44SourceCaptures): void {
  for (const module of manifest.modules.filter(item => item.stateAdaptation)) {
    const adaptation = module.stateAdaptation!;
    if (!loaded || adaptation.componentPlanHash !== loaded.set.componentPlan.sha256 || !['static-overflow', 'target-catalog', 'target-posts'].includes(adaptation.mode) || !adaptation.reason?.trim() || !adaptation.requirementIds?.length || new Set(adaptation.requirementIds).size !== adaptation.requirementIds.length || module.state?.carouselIndex !== undefined) throw Error(`State adaptation lacks its frozen plan decision: ${module.key}`);
    const owns = (key: string): boolean => { const seen = new Set<string>(); for (let current = key; current && !seen.has(current);) { if (current === module.key) return true; seen.add(current); current = loaded.plan.components.find(item => item.id === current)?.parentId ?? ''; } return false; };
    const requirements = adaptation.requirementIds.map(id => loaded.plan.requirements?.find(item => item.id === id));
    if (requirements.some(item => !item || item.disposition !== 'adapt' || !owns(item.componentId) || !item.rule?.trim() || item.verification.property !== (adaptation.mode === 'static-overflow' ? 'carousel' : 'query'))) throw Error(`State adaptation does not identify owned explicit plan requirements: ${module.key}`);
    for (const view of loaded.set.viewports) if (!requirements.some(item => item!.verification.snapshotId === view.snapshotId)) throw Error(`State adaptation lacks its source viewport requirement: ${module.key}/${view.viewport}`);
    if (adaptation.mode === 'target-catalog') {
      if (!adaptation.targetComponentKeys?.length || new Set(adaptation.targetComponentKeys).size !== adaptation.targetComponentKeys.length) throw Error(`Target catalog adaptation has no exact query owners: ${module.key}`);
      for (const key of adaptation.targetComponentKeys) {
        const check = manifest.productChecks?.find(item => item.componentKey === key);
        if (!owns(key) || !check || !requirements.some(item => item!.componentId === key)) throw Error(`Target catalog adaptation has an unproven query owner: ${key}`);
        for (const item of requirements.filter(item => item!.componentId === key)) {
          const expected = item!.verification.expected as { widgetType?: unknown; productIds?: unknown } | undefined;
          if (!expected || expected.widgetType !== check.widgetType || canonical(expected.productIds) !== canonical(check.expectedProductIds)) throw Error(`Target catalog adaptation differs from the frozen actual product query: ${key}`);
        }
      }
    } else if (adaptation.mode === 'target-posts') {
      if (!adaptation.targetComponentKeys?.length || new Set(adaptation.targetComponentKeys).size !== adaptation.targetComponentKeys.length) throw Error(`Target posts adaptation has no exact native blog owners: ${module.key}`);
      for (const key of adaptation.targetComponentKeys) {
        const check = manifest.postChecks?.find(item => item.componentKey === key);
        if (!owns(key) || !check || !requirements.some(item => item!.componentId === key)) throw Error(`Target posts adaptation has an unproven query owner: ${key}`);
        for (const item of requirements.filter(item => item!.componentId === key)) {
          const expected = item!.verification.expected as { widgetType?: unknown; query?: unknown } | undefined;
          let sameQuery = false; try { sameQuery = !!expected?.query && targetPostsQueryKey(expected.query as TargetPostsQueryInput) === targetPostsQueryKey(check.posts.query); } catch { /* Invalid authored queries are not compatible. */ }
          if (!expected || expected.widgetType !== 'wd_blog' || !sameQuery) throw Error(`Target posts adaptation differs from its frozen dynamic article query: ${key}`);
        }
      }
    } else if (adaptation.targetComponentKeys?.length) throw Error(`Static adaptation cannot waive target query proof: ${module.key}`);
  }
}
export interface Native44CompareManifest extends Native44CompareSnapshot {
  reviewWorkflow?: typeof NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW;
  /** Absent on frozen tasks created before the rendered visual audit. */
  visualAuditVersion?: 1 | 2 | 3;
  releaseLock?: FileRef;
  replicationProfile?: Native44ReplicationProfile;
  selectionRulesHash?: string;
  version: 1; strategy: 'native44-css-handoff'; taskId: string; runId: string;
  pageId: number; sourceUrl: string; targetUrl: string; widgetTypes: string[];
  canvasCss: string; modules: Native44CompareModule[]; cssRules: Native44CSSRule[];
  viewports?: Array<{ name: string; width: number; height: number }>;
  editingEvidence?: unknown;
  knownGaps?: Native44CompareGap[];
  productChecks?: Native44ProductCheck[];
  postChecks?: Native44PostCheck[];
  interactionChecks?: Native44InteractionCheck[];
  disclosureChecks?: Native44DisclosureCheck[];
  tabsChecks?: Native44TabsCheck[];
  sourceCaptures?: Native44SourceCaptureSet;
}
export interface Native44VisualReview {
  viewport: string; sourceScreenshotHash: string; targetScreenshotHash: string; documentHash: string;
  verdict: 'passed' | 'failed'; observedAt: string; notes: string;
}
export interface Native44CSSReviewRule extends Native44CSSRule {
  parentAttribution: string;
  measurementRefs: Array<{ viewport: string; moduleKey: string; kind: 'box' | 'computed-style' }>;
}
export interface Native44CSSReview {
  replicationProfile?: Native44ReplicationProfile;
  selectionRulesHash?: string;
  version: 1; documentHash: string; manifestHash: string; observedAt: string;
  captures: Array<{ viewport: string; sourceScreenshotHash: string; targetScreenshotHash: string }>;
  parentAttribution: string; notes: string; noCorrectionReason?: string;
  rules: Native44CSSReviewRule[];
}
export interface Native44CompareDependencies {
  readSnapshot(): Promise<Native44CompareSnapshot>;
  /** The source implementation should reuse the user's connected exact tab. */
  openPage(url: string, role: 'source' | 'target'): Promise<Page>;
  close?(): Promise<void>;
  /** Process-local validated source evidence; never a browser session export. */
  sourceCaptures?: LoadedNative44SourceCaptures;
}
export interface Native44Capture {
  viewport: string; width: number; height: number; clientWidth: number; devicePixelRatio: number;
  source: { screenshot: string; sha256: string; modules: Native44MeasuredModule[] };
  target: { screenshot: string; sha256: string; modules: Native44MeasuredModule[]; productChecks?: Native44ProductCheckEvidence[]; postChecks?: Native44PostCheckEvidence[]; interactionChecks?: Native44InteractionEvidence[]; disclosureChecks?: Native44DisclosureEvidence[]; tabsChecks?: Native44TabsEvidence[]; nativeWidgets?: Array<{ elementId: string; widgetType: string; visible: boolean; isCarousel?: boolean }>; renderPreparation?: { loadState: string; initializedOwners: string[]; scrollPositions: number[]; imageSamples: number; scanMode?: 'combined-viewport-capture' | 'pre-scroll'; stagesMs?: Record<string, number>; mediaMetrics?: Native44CaptureMediaMetrics; previewChrome?: { selector: '#wpadminbar'; height: number; reservedHtmlMarginRemoved: number; persistentWrites: 0 } }; screenshotEvidence?: { method: 'viewport-segments'; receipt: { path: string; sha256: string }; frameCount: number; gaps: Array<{ code: string; message: string; tile?: number }>; metrics?: { durationMs: number; layoutSamples: number; scrollCommands: number; screenshots: number; preparationCalls: number; preparationMs: number }; layoutRefreshes?: number } };
}
export const NATIVE44_COMPARE_VIEWPORTS = native44ProfileViewports().map(({ name, width, height }) => ({ name, width, height }));

function captureCoverage(manifest: Pick<Native44CompareManifest, 'replicationProfile' | 'viewports'>, captures: Native44Capture[]): boolean {
  const required = manifest.viewports ?? native44ProfileViewports(manifest.replicationProfile);
  return captures.length === required.length && new Set(captures.map(capture => capture.viewport)).size === required.length && required.every(view => captures.some(capture => capture.viewport === view.name && capture.width === view.width && capture.height === view.height));
}

async function assertCaptureFiles(capture: Native44Capture, directory: string, profile?: Native44ReplicationProfile): Promise<void> {
  const contained = (filename: string) => { const file = path.resolve(filename); if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) throw Error('Comparison screenshot evidence escaped its directory'); return file; };
  for (const role of ['source', 'target'] as const) if (hash(await readFile(contained(capture[role].screenshot))) !== capture[role].sha256) throw Error('Comparison screenshot evidence changed');
  if (isDesktopBrowserProfile(profile)) {
    const proof = capture.target.screenshotEvidence;
    if (!proof || proof.method !== 'viewport-segments') throw Error('Desktop screenshot coverage receipt is missing');
    const bytes = await readFile(contained(proof.receipt.path)); if (hash(bytes) !== proof.receipt.sha256) throw Error('Desktop screenshot coverage receipt hash changed');
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (path.resolve(receipt.pngPath) !== path.resolve(capture.target.screenshot) || receipt.before?.innerWidth !== capture.width || receipt.before?.innerHeight !== capture.height || receipt.before?.clientWidth !== capture.clientWidth || receipt.tiles?.length !== proof.frameCount || canonical(receipt.gaps) !== canonical(proof.gaps)) throw Error('Desktop screenshot coverage receipt differs from its actual capture');
  }
}

function assertCSSReview(review: Native44CSSReview, documentHash: string, manifestHash: string, captures: Native44Capture[], manifest: Native44CompareManifest): void {
  assertNative44ProfileIdentity(review.replicationProfile, manifest.replicationProfile);
  if (review.selectionRulesHash !== manifest.selectionRulesHash) throw Error('CSS review selection rules identity differs from the manifest');
  if (review.version !== 1 || review.documentHash !== documentHash || review.manifestHash !== manifestHash || !review.parentAttribution?.trim() || !review.notes?.trim() || Number.isNaN(Date.parse(review.observedAt)) || review.captures.length !== native44ProfileViewports(manifest.replicationProfile).length || new Set(review.captures.map(capture => capture.viewport)).size !== review.captures.length || !captureCoverage(manifest, captures)) throw Error('CSS review identity, attribution or screenshot coverage is incomplete');
  for (const capture of captures) {
    const bound = review.captures.find(item => item.viewport === capture.viewport);
    if (!bound || bound.sourceScreenshotHash !== capture.source.sha256 || bound.targetScreenshotHash !== capture.target.sha256) throw Error('CSS review does not match actual source/target screenshots');
  }
  if (!review.rules.length && !review.noCorrectionReason?.trim()) throw Error('An empty CSS correction set requires an explicit measured no-correction decision');
  for (const rule of review.rules) {
    if (!rule.parentAttribution?.trim() || !rule.measurementRefs?.length) throw Error(`CSS correction lacks parent attribution or measurement references: ${rule.moduleKey}`);
    for (const reference of rule.measurementRefs) {
      const capture = captures.find(item => item.viewport === reference.viewport), source = capture?.source.modules.find(item => item.key === reference.moduleKey), target = capture?.target.modules.find(item => item.key === reference.moduleKey);
      if (!capture || !source || !target || reference.kind === 'box' && (!source.box || !target.box) || reference.kind === 'computed-style' && (!source.css || !target.css)) throw Error('CSS correction references missing actual measurements');
    }
  }
}

/** Call after Codex has inspected the captured screenshots and measurements.
 * This records a local decision and never applies CSS to WordPress. */
export async function recordNative44CSSReview(runDir: string, decision: Pick<Native44CSSReview, 'documentHash' | 'parentAttribution' | 'notes' | 'rules' | 'noCorrectionReason'>): Promise<Native44CSSReview> {
  const report = JSON.parse(await readFile(path.join(runDir, 'comparison', 'report.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(runDir, 'compare-manifest.json'), 'utf8')) as Native44CompareManifest;
  const captures = report.captures as Native44Capture[];
  if (!captures?.length || report.documentHash !== decision.documentHash) throw Error('CSS decision must refer to the frozen measured document');
  for (const capture of captures) await assertCaptureFiles(capture, path.join(runDir, 'comparison'), manifest.replicationProfile);
  const review: Native44CSSReview = { ...decision, ...(manifest.replicationProfile ? { replicationProfile: manifest.replicationProfile, selectionRulesHash: manifest.selectionRulesHash } : {}), version: 1, manifestHash: hash(canonical(manifest)), observedAt: new Date().toISOString(), captures: captures.map(capture => ({ viewport: capture.viewport, sourceScreenshotHash: capture.source.sha256, targetScreenshotHash: capture.target.sha256 })) };
  assertCSSReview(review, report.documentHash, review.manifestHash, captures, manifest);
  buildNative44PageCSS({ replicationProfile: manifest.replicationProfile, pageId: manifest.pageId, modules: manifest.modules, rules: review.rules, canvasCss: manifest.canvasCss });
  await writeFile(path.join(runDir, 'css-review.json'), `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  return review;
}

export function analyzeNative44Captures(manifest: Native44CompareManifest, captures: Native44Capture[]): { gaps: Native44CompareGap[]; differences: unknown[] } {
  const gaps = [...(manifest.knownGaps ?? [])], differences: unknown[] = [];
  for (const capture of captures) {
    if (capture.width <= 0 || capture.clientWidth <= 0 || !/^[a-f0-9]{64}$/.test(capture.source.sha256) || !/^[a-f0-9]{64}$/.test(capture.target.sha256)) throw Error('Comparison capture has invalid dimensions or screenshot hashes');
    if (isDesktopBrowserProfile(manifest.replicationProfile)) {
      if (!capture.target.screenshotEvidence) gaps.push({ category: 'evidence', viewport: capture.viewport, detail: 'Desktop screenshot lacks actual viewport coverage and stable layout receipt', blocking: true });
      for (const gap of capture.target.screenshotEvidence?.gaps ?? []) gaps.push({ category: 'evidence', viewport: capture.viewport, detail: `${gap.code}: ${gap.message}`, blocking: true });
    }
    for (const widgetType of manifest.widgetTypes.filter(type => (NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(type))) if (!manifest.productChecks?.some(check => check.widgetType === widgetType)) gaps.push({ category: 'query', viewport: capture.viewport, detail: `${widgetType}: real target product records and frontend product checks are missing; a query hash is insufficient`, blocking: true });
    for (const check of manifest.productChecks ?? []) if (!(capture.target.productChecks ?? []).some(row => row.componentKey === check.componentKey && row.widgetType === check.widgetType && row.collectionPath === check.collectionPath)) gaps.push({ category: 'query', moduleKey: check.componentKey, viewport: capture.viewport, detail: 'A declared product query has no actual frontend observation at this viewport', blocking: true });
    for (const row of capture.target.productChecks ?? []) if (row.status !== 'passed') gaps.push({ category: 'query', moduleKey: row.componentKey, viewport: capture.viewport, detail: row.problems.join('; ') || 'Target product DOM facts remain unverified', blocking: true });
    if (manifest.widgetTypes.includes('wd_blog') && !manifest.postChecks?.length) gaps.push({ category: 'query', viewport: capture.viewport, detail: 'Native blog has no actual target published-post query and frontend record proof', blocking: true });
    for (const check of manifest.postChecks ?? []) {
      const rows = (capture.target.postChecks ?? []).filter(row => row.componentKey === check.componentKey && row.selector === check.selector && row.widgetType === 'wd_blog');
      const problems = rows.length === 1 ? native44ObservedPostProblems(check, rows[0].posts) : ['A declared native blog query has no unique actual frontend observation'];
      if (rows.length !== 1 || !native44PostEvidencePassed(check, rows[0]) || problems.length) gaps.push({ category: 'query', moduleKey: check.componentKey, viewport: capture.viewport, detail: [...problems, ...(rows[0]?.problems ?? [])].join('; ') || 'Native blog query facts remain unverified', blocking: true });
      if (check.layout?.mode === 'carousel' && !(capture.target.interactionChecks ?? []).some(row => row.componentKey === check.componentKey && row.status === 'passed')) gaps.push({ category: 'interaction', moduleKey: check.componentKey, viewport: capture.viewport, detail: 'Native blog carousel lacks actual control and restoration proof', blocking: true });
    }
    for (const widgetType of manifest.widgetTypes.filter(type => (NATIVE44_CAROUSEL_WIDGETS as readonly string[]).includes(type) && type !== 'wd_testimonials')) if (!manifest.interactionChecks?.some(check => check.widgetType === widgetType)) gaps.push({ category: 'interaction', viewport: capture.viewport, detail: `${widgetType}: this page has no actual arrow/pagination control proof; an initial logical index or library registration is insufficient`, blocking: true });
    for (const row of capture.target.interactionChecks ?? []) if (row.status !== 'passed') gaps.push({ category: 'interaction', moduleKey: row.componentKey, viewport: capture.viewport, detail: row.problems.join('; ') || 'Actual carousel controls and restoration remain unverified', blocking: true });
    for (const check of manifest.disclosureChecks?.filter(check => !check.viewports || check.viewports.includes(capture.viewport)) ?? []) {
      const rows = (capture.target.disclosureChecks ?? []).filter(row => row.componentKey === check.componentKey && row.viewport === capture.viewport);
      if (rows.length !== 1 || !native44DisclosureEvidencePassed(rows[0], check)) gaps.push({ category: 'interaction', moduleKey: check.componentKey, viewport: capture.viewport, detail: rows.length === 1 && rows[0].problems.length ? rows[0].problems.join('; ') : 'Declared native disclosure lacks complete actual click, Enter, Space, ARIA, visibility and restoration proof', blocking: true });
    }
    for (const check of manifest.tabsChecks?.filter(check => !check.viewports || check.viewports.includes(capture.viewport)) ?? []) {
      const rows = (capture.target.tabsChecks ?? []).filter(row => row.componentKey === check.componentKey && row.viewport === capture.viewport);
      if (rows.length !== 1 || !native44TabsEvidencePassed(rows[0], check)) gaps.push({ category: 'interaction', moduleKey: check.componentKey, viewport: capture.viewport, detail: rows.length === 1 && rows[0].problems.length ? rows[0].problems.join('; ') : 'Declared native tabs lack complete actual tab activation, keyboard, ARIA, visible panels and restoration proof', blocking: true });
    }
    for (const mounted of capture.target.nativeWidgets ?? []) if (mounted.visible) {
      if ((NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(mounted.widgetType) && !(capture.target.productChecks ?? []).some(check => check.elementId === mounted.elementId)) gaps.push({ category: 'query', viewport: capture.viewport, detail: `Mounted product widget ${mounted.elementId} has no own observed collection proof`, blocking: true });
      if (mounted.widgetType === 'wd_blog' && !(capture.target.postChecks ?? []).some(check => check.elementId === mounted.elementId)) gaps.push({ category: 'query', viewport: capture.viewport, detail: `Mounted blog widget ${mounted.elementId} has no own observed published-post proof`, blocking: true });
      if (((NATIVE44_CAROUSEL_WIDGETS as readonly string[]).includes(mounted.widgetType) && mounted.widgetType !== 'wd_testimonials' || mounted.isCarousel) && !(capture.target.interactionChecks ?? []).some(check => check.elementId === mounted.elementId)) gaps.push({ category: 'interaction', viewport: capture.viewport, detail: `Mounted carousel ${mounted.elementId} has no own actual control proof`, blocking: true });
    }
    for (const check of manifest.productChecks?.filter(check => check.carouselExpected) ?? []) if (!(capture.target.interactionChecks ?? []).some(row => row.componentKey === check.componentKey && row.status === 'passed')) gaps.push({ category: 'interaction', moduleKey: check.componentKey, viewport: capture.viewport, detail: 'Target product carousel controls have not been exercised and restored on this page', blocking: true });
    for (const module of manifest.modules) {
      const source = capture.source.modules.find(item => item.key === module.key), target = capture.target.modules.find(item => item.key === module.key);
      if (!source || !target || source.count !== 1 || target.count !== 1) { gaps.push({ category: 'structure', moduleKey: module.key, viewport: capture.viewport, detail: 'Source and target require one unambiguous module owner', blocking: module.required }); continue; }
      if (source.visible !== target.visible) gaps.push({ category: 'structure', moduleKey: module.key, viewport: capture.viewport, detail: 'Source/target module visibility differs; ownership or responsive variant must be resolved', blocking: module.required });
      if (source.visible && target.visible) {
        if ((source.media ?? []).some(item => item.drawable === false)) gaps.push({ category: 'media', moduleKey: module.key, viewport: capture.viewport, detail: 'Source media is not drawable; comparison evidence is incomplete', blocking: true });
        if ((source.media ?? []).some(item => item.drawable === null)) gaps.push({ category: 'evidence', moduleKey: module.key, viewport: capture.viewport, detail: 'Source media decode/paint was not observed; a visible DOM use cannot substitute for drawable evidence', blocking: true });
        if ((target.media ?? []).some(item => !item.drawable) || module.expectedMedia !== undefined && (target.media ?? []).length < module.expectedMedia) gaps.push({ category: 'media', moduleKey: module.key, viewport: capture.viewport, detail: 'Target has missing or undecodable required media', blocking: true });
        if (manifest.visualAuditVersion === 1 || manifest.visualAuditVersion === 2 || manifest.visualAuditVersion === 3) {
          if (!source.visual || !target.visual) gaps.push({ category: 'evidence', moduleKey: module.key, viewport: capture.viewport, detail: 'Source or target rendered visual samples are missing', blocking: true });
          else if (manifest.visualAuditVersion >= 2 && (!source.visual.paintLayers || !target.visual.paintLayers)) gaps.push({ category: 'evidence', moduleKey: module.key, viewport: capture.viewport, detail: 'Generic painted-region samples are missing', blocking: true });
          else for (const mismatch of compareNative44VisualModules(source.visual, target.visual, manifest.visualAuditVersion >= 2, manifest.visualAuditVersion >= 3).slice(0, 30)) gaps.push({ category: 'structure', moduleKey: module.key, viewport: capture.viewport, detail: `${mismatch.text ? `“${mismatch.text.slice(0, 80)}”: ` : ''}${mismatch.detail}`, blocking: true });
        }
        if (module.stateAdaptation?.mode === 'static-overflow' && target.state?.carouselIndex !== undefined) gaps.push({ category: 'interaction', moduleKey: module.key, viewport: capture.viewport, detail: 'Declared static/overflow adaptation still exposes an undeclared target carousel runtime', blocking: true });
        if (module.stateAdaptation?.mode === 'target-catalog') for (const key of module.stateAdaptation.targetComponentKeys ?? []) {
          if (!(capture.target.productChecks ?? []).some(row => row.componentKey === key && row.status === 'passed') || manifest.productChecks?.find(check => check.componentKey === key)?.carouselExpected && !(capture.target.interactionChecks ?? []).some(row => row.componentKey === key && row.status === 'passed')) gaps.push({ category: 'interaction', moduleKey: module.key, viewport: capture.viewport, detail: `Adapted target catalog ${key} has no complete actual product/control proof; a source pet frame cannot provide it`, blocking: true });
        }
        if (module.stateAdaptation?.mode === 'target-posts') for (const key of module.stateAdaptation.targetComponentKeys ?? []) {
          if (!(capture.target.postChecks ?? []).some(row => row.componentKey === key && row.status === 'passed')) gaps.push({ category: 'query', moduleKey: module.key, viewport: capture.viewport, detail: `Adapted target article list ${key} lacks its actual native post proof`, blocking: true });
        }
        if (!module.stateAdaptation && module.state?.carouselIndex === undefined && (source.state?.carouselIndex !== undefined || target.state?.carouselIndex !== undefined) && source.state?.carouselIndex !== target.state?.carouselIndex) gaps.push({ category: 'interaction', moduleKey: module.key, viewport: capture.viewport, detail: 'Source and target carousel logical positions differ', blocking: true });
        if (module.state) for (const key of ['carouselIndex', 'expanded', 'hover'] as const) if (module.state[key] !== undefined && (source.state?.[key] !== module.state[key] || target.state?.[key] !== module.state[key])) gaps.push({ category: 'interaction', moduleKey: module.key, viewport: capture.viewport, detail: `Comparable ${key} state was not established on both pages`, blocking: true });
        if (source.box && target.box) differences.push({ moduleKey: module.key, viewport: capture.viewport, source: source.box, target: target.box, delta: Object.fromEntries((['x', 'y', 'width', 'height'] as const).map(key => [key, target.box![key] - source.box![key]])), sourceCss: source.css, targetCss: target.css, attribution: 'Measurements only; investigate shared parent layout before emitting local CSS corrections' });
      }
    }
  }
  return { gaps, differences };
}

export function validateNative44CompareManifest(manifest: Native44CompareManifest, historicalSelectionRulesHash?: string): void {
  if (manifest.reviewWorkflow !== undefined && manifest.reviewWorkflow !== NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW) throw Error('Invalid native44 review workflow');
  if (manifest.visualAuditVersion !== undefined && (![1, 2, 3].includes(manifest.visualAuditVersion) || manifest.reviewWorkflow !== NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW)) throw Error('Invalid native44 visual audit contract');
  if (manifest.releaseLock && (!isDesktopBrowserProfile(manifest.replicationProfile) || typeof manifest.releaseLock.path !== 'string' || !manifest.releaseLock.path || !/^[a-f0-9]{64}$/.test(manifest.releaseLock.sha256))) throw Error('Comparison release lock identity is invalid');
  const desktop = isDesktopBrowserProfile(manifest.replicationProfile), required = native44ProfileViewports(manifest.replicationProfile);
  if (historicalSelectionRulesHash !== undefined && !/^[a-f0-9]{64}$/.test(historicalSelectionRulesHash)) throw Error('Invalid historical comparison selection rules hash');
  if (desktop ? manifest.selectionRulesHash !== (historicalSelectionRulesHash ?? NATIVE44_SELECTION_RULES_HASH) : manifest.selectionRulesHash !== undefined) throw Error('Comparison selection rules hash differs from its replication profile');
  if (manifest.version !== 1 || manifest.strategy !== 'native44-css-handoff' || !manifest.taskId || !/^[A-Za-z0-9_-]{4,100}$/.test(manifest.runId) || !Number.isSafeInteger(manifest.pageId) || manifest.pageId < 1) throw Error('Invalid native44 comparison identity');
  for (const key of ['documentHash', 'structureHash', 'resourceHash', 'queryHash'] as const) if (!/^[a-f0-9]{64}$/.test(manifest[key])) throw Error(`Invalid comparison ${key}`);
  for (const value of [manifest.sourceUrl, manifest.targetUrl]) { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(key => /token|nonce|password|authorization|secret/i.test(key))) throw Error('Comparison URLs must be credential-free'); }
  if (!manifest.modules.length || new Set(manifest.modules.map(item => item.key)).size !== manifest.modules.length || new Set(manifest.modules.map(item => item.className)).size !== manifest.modules.length) throw Error('Comparison modules require stable unique identities');
  for (const module of manifest.modules) if (!module.sourceSelector || !module.targetSelector || !/^cwp-[a-zA-Z0-9_-]+$/.test(module.className) || !module.targetSelector.includes(`.${module.className}`)) throw Error(`Invalid comparison selector mapping: ${module.key}`);
  if (!manifest.widgetTypes?.length) throw Error('Comparison requires the original registered widget identities');
  for (const check of manifest.productChecks ?? []) if (!check.componentKey || !check.selector || !(NATIVE44_PRODUCT_WIDGETS as readonly string[]).includes(check.widgetType) || !check.expectedProductIds?.length || !check.catalog?.products?.length || !check.catalog?.evidence?.length) throw Error('Product comparison check has incomplete frozen identity or actual catalog evidence');
  for (const check of manifest.postChecks ?? []) {
    assertTargetPostsEvidence(check.posts, new URL(manifest.targetUrl).origin);
    if (!check.componentKey || !check.selector || check.widgetType !== 'wd_blog' || !check.expectedPostIds?.length || check.expectedPostIds.length !== check.posts.posts.length || canonical(check.expectedPostIds) !== canonical(check.posts.posts.map(post => post.id)) || !check.posts.evidence.length) throw Error('Blog comparison check has incomplete actual target article-query evidence');
  }
  for (const check of manifest.interactionChecks ?? []) if (!check.componentKey || !check.selector || !check.widgetType) throw Error('Carousel interaction comparison requires an explicit component owner');
  validateNative44DisclosureChecks(manifest.disclosureChecks ?? [], desktop ? required.map(view => view.name) : undefined);
  validateNative44TabsChecks(manifest.tabsChecks ?? [], manifest.disclosureChecks ?? [], desktop ? required.map(view => view.name) : undefined);
  if (desktop && !manifest.sourceCaptures) throw Error('Desktop browser comparison requires validated user-tab source captures; source browser fallback is disabled');
  if (manifest.sourceCaptures) { assertNative44ProfileIdentity(manifest.replicationProfile, manifest.sourceCaptures.replicationProfile); if (manifest.sourceCaptures.selectionRulesHash !== manifest.selectionRulesHash || manifest.sourceCaptures.taskId !== manifest.taskId || manifest.sourceCaptures.version !== (desktop ? 2 : 1) || manifest.sourceCaptures.viewports?.length !== required.length) throw Error('Source captures must belong to this exact comparison task'); }
  const viewports = manifest.viewports ?? required;
  if (viewports.length !== required.length || new Set(viewports.map(viewport => viewport.width)).size !== required.length || required.some(view => !viewports.some(viewport => viewport.width === view.width && (!desktop || viewport.height === view.height && viewport.name === view.name)))) throw Error(`Native44 comparison requires ${required.map(view => `${view.width}x${view.height}`).join(', ')} viewports`);
  if (viewports.some(viewport => !Number.isInteger(viewport.height) || viewport.height < 300 || !/^[a-z][a-z0-9-]*$/.test(viewport.name))) throw Error('Invalid comparison viewport');
  if (desktop) for (const check of manifest.interactionChecks ?? []) if (check.viewports?.some(name => !required.some(view => view.name === name))) throw Error('Desktop comparison cannot declare mobile/tablet interactions');
  buildNative44PageCSS({ replicationProfile: manifest.replicationProfile, pageId: manifest.pageId, modules: manifest.modules, rules: manifest.cssRules, canvasCss: manifest.canvasCss });
}

/** Wait for actual frontend initialization and viewport-triggered lazy work.
 * Only browser scrolling and reads occur here; no src/loading/style setters. */
export async function waitNative44CaptureVisibleImages(page: Page, session: Native44CaptureMediaSession, receipt: { imageSamples: number }) {
  const deadline = Date.now() + 10_000; let stable = 0, resourceStateChanged = false;
  while (Date.now() < deadline) {
    const samples = await session.viewport(); receipt.imageSamples += samples.length; resourceStateChanged ||= samples.some(sample => sample.resourceChanged);
    const failed = samples.find(sample => sample.failed); if (failed) throw Error(`Visible image has actual failed/undecodable pixels in owner ${failed.owner}`);
    if (samples.every(sample => sample.ready)) stable++; else stable = 0;
    if (stable >= 2) return { resourceStateChanged };
    await page.waitForTimeout(120);
  }
  throw Error('Visible lazy image did not establish actual currentSrc and decoded pixels within its bounded readiness wait');
}

export async function prepareNative44CapturePage(page: Page, checks: Native44InteractionCheck[], viewport: string, align?: () => Promise<void>, options: { scanDocument?: boolean; mediaSession?: Native44CaptureMediaSession } = {}) {
  const receipt = { loadState: 'load', initializedOwners: [] as string[], scrollPositions: [] as number[], imageSamples: 0, scanMode: options.scanDocument === false ? 'combined-viewport-capture' as const : 'pre-scroll' as const, stagesMs: {} as Record<string, number> };
  const media = options.mediaSession ?? await createNative44CaptureMediaSession(page), started = performance.now();
  try {
  await page.waitForLoadState('load', { timeout: 45_000 });
  await page.evaluate(async () => { await document.fonts.ready; if ([...document.fonts].some(font => font.status === 'error')) throw Error('Page has fonts that failed to load'); });
  receipt.stagesMs.loadAndFonts = Math.round(performance.now() - started);
  const visibleImages = () => waitNative44CaptureVisibleImages(page, media, receipt), initializing = performance.now();
  for (const check of checks.filter(check => !check.viewports || check.viewports.includes(viewport))) {
    const root = page.locator(check.selector); if (await root.count() !== 1 || !await root.isVisible()) continue;
    await root.scrollIntoViewIfNeeded();
    await page.waitForFunction(selector => { const owner = document.querySelector(selector); if (!owner) return false; const runtimes = [owner, ...owner.querySelectorAll('*')].filter(node => node.closest('[data-widget_type]') === owner).map(node => (node as any).swiper).filter(runtime => runtime?.initialized === true && runtime.destroyed !== true); const unique = [...new Set(runtimes)]; return unique.length === 1 && unique[0].animating !== true; }, check.selector, { timeout: 15_000 });
    receipt.initializedOwners.push(check.componentKey); await visibleImages();
  }
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await align?.();
  receipt.stagesMs.initializationAndInteractions = Math.round(performance.now() - initializing);
  if (options.scanDocument === false) { await visibleImages(); return receipt; }
  const scanning = performance.now();
  let previousHeight = -1;
  for (let index = 0; index < 80; index++) {
    const info = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight })), top = Math.min(index * Math.max(300, info.viewport - 80), Math.max(0, info.height - info.viewport));
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top); await page.waitForTimeout(120); await visibleImages(); receipt.scrollPositions.push(top);
    const actual = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, bottom: scrollY + innerHeight }));
    if (actual.bottom >= actual.height - 1 && previousHeight === actual.height) break;
    previousHeight = actual.height; if (index === 79) throw Error('Comparison could not reach a stable page bottom');
  }
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' })); await visibleImages();
  receipt.stagesMs.preScroll = Math.round(performance.now() - scanning);
  return receipt;
  } finally { if (!options.mediaSession) await media.dispose(); }
}

/** Runtime ownership is proved by the actual object on visible DOM elements,
 * independently of theme class names. Multiple distinct instances are retained
 * as ambiguity, never resolved by selecting the first matching CSS class. */
export async function readNative44ModuleCarouselStates(page: Page, modules: Pick<Native44CompareModule, 'key' | 'sourceSelector' | 'targetSelector'>[], role: 'source' | 'target') {
  return page.evaluate(({ modules, role }) => modules.map(module => {
    const owners = document.querySelectorAll(role === 'source' ? module.sourceSelector : module.targetSelector), owner = owners.length === 1 ? owners[0] : undefined;
    const instances = owner ? [owner, ...owner.querySelectorAll('*')].filter(node => {
      const runtime = (node as any).swiper, box = node.getBoundingClientRect();
      if (runtime?.initialized !== true || runtime.destroyed === true || box.width <= 0 || box.height <= 0) return false;
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) { const css = getComputedStyle(ancestor); if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0) return false; }
      return true;
    }).map(node => (node as any).swiper) : [];
    const unique = [...new Set(instances)], runtime = unique.length === 1 ? unique[0] : undefined;
    return { key: module.key, carouselRuntimeCount: unique.length, carouselIndex: Number.isInteger(runtime?.realIndex) ? runtime.realIndex as number : undefined };
  }), { modules, role });
}

/** Logged-in WordPress preview chrome is not page content. Only its exact
 * top-level admin bar and matching standard reserved html margin are excluded;
 * unrelated fixed overlays and all authored page spacing stay under QA. */
export async function adjustNative44PreviewChrome(page: Page) {
  await page.waitForLoadState('load', { timeout: 45_000 });
  const bars = page.locator('#wpadminbar'); if (await bars.count() !== 1) return undefined;
  const observed = await bars.evaluate(bar => {
    const box = bar.getBoundingClientRect(), css = getComputedStyle(bar), htmlMargin = Number.parseFloat(getComputedStyle(document.documentElement).marginTop);
    if (!document.body.classList.contains('admin-bar') || bar.closest('[data-widget_type],[data-elementor-type]') || css.position !== 'fixed' || box.width < document.documentElement.clientWidth - 2 || Math.abs(box.top) > 1 || ![32, 46].some(height => Math.abs(height - box.height) <= 1)) return undefined;
    return { height: box.height, margin: Number.isFinite(htmlMargin) && Math.abs(htmlMargin - box.height) <= 1 ? htmlMargin : 0 };
  });
  if (!observed) return undefined;
  const style = await page.addStyleTag({ content: `#wpadminbar{display:none!important}${observed.margin ? 'html{margin-top:0!important}' : ''}` });
  return { receipt: { selector: '#wpadminbar' as const, height: observed.height, reservedHtmlMarginRemoved: observed.margin, persistentWrites: 0 as const }, restore: async () => { await style.evaluate(element => element.parentNode?.removeChild(element)); } };
}

/** Read-only page capture. The exact logged-in preview chrome may be excluded
 * ephemerally; no authored styles, saved document or editor session is changed. */
export async function captureNative44Role(page: Page, role: 'source' | 'target', manifest: Native44CompareManifest, file: string, viewport: string): Promise<Native44Capture['target'] & { clientWidth: number; devicePixelRatio: number }> {
  const media = await createNative44CaptureMediaSession(page), started = performance.now();
  let previewChrome: Awaited<ReturnType<typeof adjustNative44PreviewChrome>>;
  try {
  if (role === 'target') previewChrome = await adjustNative44PreviewChrome(page);
  let interactionChecks: Native44InteractionEvidence[] | undefined;
  const desktop = isDesktopBrowserProfile(manifest.replicationProfile);
  const renderPreparation: NonNullable<Native44Capture['target']['renderPreparation']> = await prepareNative44CapturePage(page, role === 'target' ? manifest.interactionChecks ?? [] : [], viewport, role === 'target' ? async () => { interactionChecks = await collectNative44InteractionChecks(page, manifest.interactionChecks ?? [], viewport); } : undefined, { scanDocument: !desktop, mediaSession: media });
  const disclosureStarted = performance.now();
  const disclosureChecks = role === 'target' && manifest.disclosureChecks?.length ? await collectNative44DisclosureChecks(page, manifest.disclosureChecks, viewport) : undefined;
  if (disclosureChecks) renderPreparation.stagesMs!.disclosureChecks = Math.round(performance.now() - disclosureStarted);
  const tabsStarted = performance.now();
  const tabsChecks = role === 'target' && manifest.tabsChecks?.length ? await collectNative44TabsChecks(page, manifest.tabsChecks, viewport, manifest.disclosureChecks) : undefined;
  if (tabsChecks) renderPreparation.stagesMs!.tabsChecks = Math.round(performance.now() - tabsStarted);
  if (previewChrome) renderPreparation.previewChrome = previewChrome.receipt;
  const moduleStates = await readNative44ModuleCarouselStates(page, manifest.modules, role);
  const checking = performance.now();
  const productChecks = role === 'target' ? await collectNative44ProductChecks(page, manifest.productChecks ?? [], viewport) : undefined;
  renderPreparation.stagesMs!.productChecks = Math.round(performance.now() - checking);
  let bytes: Buffer, screenshotEvidence: Native44Capture['target']['screenshotEvidence'];
  if (desktop) {
    const receipt = await captureLayoutStableScreenshot(page, { path: file, selectors: manifest.modules.map(module => role === 'target' ? module.targetSelector : module.sourceSelector), prepareFrame: () => waitNative44CaptureVisibleImages(page, media, renderPreparation) });
    screenshotEvidence = { method: 'viewport-segments', receipt: { path: receipt.receiptPath, sha256: hash(await readFile(receipt.receiptPath)) }, frameCount: receipt.tiles.length, gaps: receipt.gaps, metrics: receipt.metrics, layoutRefreshes: receipt.preparation?.layoutRefreshes ?? 0 };
    bytes = await readFile(file);
  } else bytes = await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  // The one whole-page capture already exposes and decodes lazy article media;
  // verify query facts afterwards, without a separate document scroll pass.
  const postChecking = performance.now();
  const postChecks = role === 'target' && manifest.postChecks !== undefined ? await collectNative44PostChecks(page, manifest.postChecks, viewport) : undefined;
  if (postChecks !== undefined) renderPreparation.stagesMs!.postChecks = Math.round(performance.now() - postChecking);
  const measuring = performance.now();
  const modules = await media.modules(manifest.modules.map(module => ({ key: module.key, selector: role === 'target' ? module.targetSelector : module.sourceSelector })));
  for (const module of modules) { const observed = moduleStates.find(state => state.key === module.key)!; module.carouselRuntimeCount = observed.carouselRuntimeCount; if (observed.carouselIndex !== undefined) module.state = { ...module.state, carouselIndex: observed.carouselIndex }; }
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, devicePixelRatio }));
  const nativeWidgets = role === 'target' ? await page.evaluate(pageId => Array.from(document.querySelectorAll(`.elementor-${pageId} [data-widget_type]`)).map(element => { const box = element.getBoundingClientRect(); return { elementId: element.getAttribute('data-id') ?? '', widgetType: (element.getAttribute('data-widget_type') ?? '').replace(/\.default$/, ''), visible: box.width > 0 && box.height > 0 && getComputedStyle(element).display !== 'none', isCarousel: [element, ...element.querySelectorAll('*')].some(node => node.closest('[data-widget_type]') === element && (node as any).swiper?.initialized === true) }; }), manifest.pageId) : undefined;
  renderPreparation.stagesMs!.moduleAndMediaInventory = Math.round(performance.now() - measuring);
  renderPreparation.stagesMs!.total = Math.round(performance.now() - started);
  renderPreparation.mediaMetrics = await media.metrics();
  const afterStates = await readNative44ModuleCarouselStates(page, manifest.modules, role);
  for (const item of modules) if (item.state?.carouselIndex !== undefined && afterStates.find(state => state.key === item.key)?.carouselIndex !== item.state.carouselIndex) throw Error(`Carousel moved during screenshot capture: ${item.key}; comparable state remains unverified`);
  return { screenshot: file, sha256: hash(bytes), modules, ...dimensions, renderPreparation, ...(screenshotEvidence ? { screenshotEvidence } : {}), ...(role === 'target' ? { productChecks, ...(postChecks !== undefined ? { postChecks } : {}), interactionChecks, nativeWidgets, ...(disclosureChecks ? { disclosureChecks } : {}), ...(tabsChecks ? { tabsChecks } : {}) } : {}) };
  } finally { try { await media.dispose(); } finally { await previewChrome?.restore(); } }
}

export async function compareNative44Run(runDir: string, dependencies: Native44CompareDependencies, options: { verifyApplied?: boolean; reviews?: Native44VisualReview[]; captureCurrent?: boolean } = {}) {
  const startedAt = new Date().toISOString(), started = performance.now();
  const root = path.resolve(runDir, '..', '..');
  const current = options.captureCurrent ? await (await import('./current-state.js')).readNative44CurrentState(root, runDir) : undefined;
  if (options.captureCurrent && (!current || current.runId !== path.basename(runDir))) throw Error('native44_current_capture_manifest_missing');
  const captureInput = current ? await readNative44CurrentCaptureManifest(root, runDir, current) : undefined;
  const manifestBytes = captureInput?.manifestBytes ?? await readFile(path.join(runDir, 'compare-manifest.json'));
  if (current?.currentManifest && hash(manifestBytes) !== current.currentManifest.sha256) throw Error('native44_current_manifest_changed_during_capture');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Native44CompareManifest;
  validateNative44CompareManifest(manifest, current ? manifest.selectionRulesHash : undefined);
  let journal: any;
  try { journal = JSON.parse(await readFile(path.join(runDir, 'journal.json'), 'utf8')); assertNative44ReleaseIdentity(journal.releaseLock, manifest.releaseLock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  assertNative44WholePageReviewReady({ manifest, journal, current, snapshot: captureInput?.binding.snapshot });
  if (manifest.releaseLock) { const lock = current ? await readNative44HistoricalReleaseEvidence(root, manifest.releaseLock, { taskId: manifest.taskId, programHash: journal.programHash }) : await readNative44ReleaseLock(root, manifest.releaseLock, { taskId: manifest.taskId }); if (lock.phase !== 'final') throw Error('Comparison needs the final program-bound release lock'); }
  const manifestHash = hash(canonical(manifest));
  const loadedSource = manifest.sourceCaptures ? dependencies.sourceCaptures ?? await loadNative44SourceCaptures(manifest.sourceCaptures, { taskId: manifest.taskId, sourceUrl: manifest.sourceUrl, replicationProfile: manifest.replicationProfile, ...(current ? { expectedSelectionRulesHash: manifest.selectionRulesHash } : {}) }) : undefined;
  if (current && !loadedSource) throw Error('native44_current_capture_source_missing');
  if (loadedSource && canonical(loadedSource.set) !== canonical(manifest.sourceCaptures)) throw Error('Prepared source capture identity differs from the frozen comparison manifest');
  validateNative44StateAdaptations(manifest, loadedSource);
  if (loadedSource) assertNative44WholePageModuleCoverage(manifest, loadedSource.plan.components.filter(component => component.parentId === null).map(component => component.id));
  const outputDir = current ? path.join(root, 'runs', `native44-review-${randomUUID()}`) : path.join(runDir, options.verifyApplied ? 'comparison-applied' : 'comparison'); await mkdir(outputDir, { recursive: !current });
  // A historical v1 pointer has no currentManifest slot. Freeze the exact
  // already-existing manifest bytes beside this capture instead of migrating
  // the pointer or reconstructing a more permissive task contract.
  const captureManifest = captureInput?.legacy ? { path: path.join(outputDir, 'compare-manifest.json'), sha256: hash(manifestBytes) } : current?.currentManifest;
  if (captureInput?.legacy) await writeFile(captureManifest!.path, manifestBytes, { flag: 'wx' });
  const before = await dependencies.readSnapshot(), gaps: Native44CompareGap[] = [];
  for (const key of ['structureHash', 'resourceHash', 'queryHash'] as const) if (before[key] !== manifest[key]) gaps.push({ category: 'conflict', detail: `${key} changed since the complete draft save; old CSS is stale and human changes are preserved`, blocking: true });
  if ((!options.verifyApplied || current) && before.documentHash !== manifest.documentHash) gaps.push({ category: 'conflict', detail: 'The saved document changed before comparison', blocking: true });
  if (manifest.reviewWorkflow && before.pageCss !== manifest.pageCss) gaps.push({ category: 'conflict', detail: 'Consolidated page CSS changed before complete-page review; rebuild the current CSS revision before capture', blocking: true });
  let css: ReturnType<typeof buildNative44PageCSS> = current ? { css: manifest.pageCss, sha256: native44CSSHash(manifest.pageCss), canonicalSha256: native44CSSHash(canonicalNative44CSS(manifest.pageCss)), selectorMap: [] } : buildNative44PageCSS({ replicationProfile: manifest.replicationProfile, pageId: manifest.pageId, modules: manifest.modules, rules: manifest.cssRules, canvasCss: manifest.canvasCss });
  let cssReview: Native44CSSReview | undefined, cssReviewValid = false;
  try { if (!current) cssReview = JSON.parse(await readFile(path.join(runDir, 'css-review.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Invalid css-review.json'); }
  const captures: Native44Capture[] = [];
  let blockedMutationRequests = 0;
  // Adding a hash-bound visual judgement must not recapture an animation at a
  // different frame. Reuse only exact unchanged document + screenshot bytes.
  const previousFile = path.join(outputDir, 'report.json');
  let reusedCapture = false;
  if ((options.reviews?.length || cssReview) && !gaps.some(gap => gap.blocking)) {
    try {
      const previous = JSON.parse(await readFile(previousFile, 'utf8'));
      if (previous.manifestHash === manifestHash && previous.documentHash === before.documentHash && previous.baselineDocumentHash === manifest.documentHash && captureCoverage(manifest, previous.captures ?? [])) {
        for (const capture of previous.captures as Native44Capture[]) await assertCaptureFiles(capture, outputDir, manifest.replicationProfile);
        captures.push(...previous.captures); reusedCapture = true;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') gaps.push({ category: 'evidence', detail: 'Previous screenshot evidence cannot be reused; new screenshots are required', blocking: true }); }
  }
  const guard = async (route: Route) => { if (['GET', 'HEAD'].includes(route.request().method())) await route.fallback(); else { blockedMutationRequests++; await route.abort('blockedbyclient'); } };
  try {
    if (!reusedCapture && !gaps.some(gap => gap.category === 'conflict')) {
      const sourcePage = loadedSource ? undefined : await dependencies.openPage(manifest.sourceUrl, 'source'), targetPage = await dependencies.openPage(manifest.targetUrl, 'target');
      await sourcePage?.route('**/*', guard); await targetPage.route('**/*', guard);
      try {
        for (const viewport of [...(manifest.viewports ?? native44ProfileViewports(manifest.replicationProfile))].sort((a, b) => b.width - a.width)) {
          await sourcePage?.setViewportSize({ width: viewport.width, height: viewport.height }); await targetPage.setViewportSize({ width: viewport.width, height: viewport.height });
          const sourceModuleKeys = loadedSource ? [...new Set([...manifest.modules.map(module => module.key), ...(manifest.interactionChecks ?? []).map(check => check.sourceComponentKey ?? check.componentKey)])].map(key => ({ key })) : manifest.modules;
          const source = loadedSource ? await readNative44SourceCapture(loadedSource, viewport, sourceModuleKeys, path.join(outputDir, `${viewport.name}-source.png`)) : await captureNative44Role(sourcePage!, 'source', manifest, path.join(outputDir, `${viewport.name}-source.png`), viewport.name);
          if ('gaps' in source) gaps.push(...source.gaps);
          const targetCatalogKeys = new Set(manifest.modules.flatMap(module => module.stateAdaptation?.mode === 'target-catalog' ? module.stateAdaptation.targetComponentKeys ?? [] : []));
          const alignedManifest = { ...manifest, interactionChecks: (manifest.interactionChecks ?? []).map(check => targetCatalogKeys.has(check.componentKey) ? { ...check, requireSourceAlignment: false, expectedLogicalIndex: undefined } : { ...check, requireSourceAlignment: true, expectedLogicalIndex: source.modules.find(module => module.key === (check.sourceComponentKey ?? check.componentKey))?.state?.carouselIndex }) };
          const target = await captureNative44Role(targetPage, 'target', alignedManifest, path.join(outputDir, `${viewport.name}-target.png`), viewport.name);
          if (source.clientWidth !== target.clientWidth || source.devicePixelRatio !== target.devicePixelRatio) gaps.push({ category: 'evidence', viewport: viewport.name, detail: 'Actual content viewport or zoom differs between source and target', blocking: true });
          captures.push({ ...viewport, viewport: viewport.name, clientWidth: target.clientWidth, devicePixelRatio: target.devicePixelRatio, source, target });
        }
      } finally { await sourcePage?.unroute('**/*', guard); await targetPage.unroute('**/*', guard); }
    }
  } catch (error) { await dependencies.close?.(); throw error; }
  let after: Native44CompareSnapshot;
  try { after = await dependencies.readSnapshot(); } finally { await dependencies.close?.(); }
  if (after.documentHash !== before.documentHash) gaps.push({ category: 'conflict', detail: 'Document changed during read-only comparison; evidence is stale', blocking: true });
  if (current) {
    const latest = await (await import('./current-state.js')).readNative44CurrentState(root, runDir);
    const pointerHash = (state: typeof current) => state?.evidence.find(item => path.basename(item.path) === 'current-user-amendment.json' && path.basename(path.dirname(item.path)) === state.runId)?.sha256;
    if (!latest || latest.documentHash !== current.documentHash || latest.currentSnapshot.sha256 !== current.currentSnapshot.sha256 || latest.currentCSS.sha256 !== current.currentCSS.sha256 || latest.currentManifest?.sha256 !== current.currentManifest?.sha256 || pointerHash(latest) !== pointerHash(current) || captureInput && hash(await readFile(captureInput.manifestRef.path)) !== captureInput.manifestRef.sha256) gaps.push({ category: 'conflict', detail: 'Current revision or frozen capture manifest changed during capture; evidence is stale', blocking: true });
  }
  const analyzed = analyzeNative44Captures(manifest, captures); gaps.push(...analyzed.gaps);
  if (cssReview) {
    try {
      const baseline = options.verifyApplied ? JSON.parse(await readFile(path.join(runDir, 'comparison', 'report.json'), 'utf8')) : { captures, documentHash: before.documentHash };
      assertCSSReview(cssReview, baseline.documentHash, manifestHash, baseline.captures, manifest);
      for (const capture of baseline.captures as Native44Capture[]) await assertCaptureFiles(capture, path.join(runDir, 'comparison'), manifest.replicationProfile);
      css = buildNative44PageCSS({ replicationProfile: manifest.replicationProfile, pageId: manifest.pageId, modules: manifest.modules, rules: cssReview.rules, canvasCss: manifest.canvasCss });
      cssReviewValid = true;
    } catch (error) { gaps.push({ category: 'evidence', detail: `CSS review is stale or incomplete: ${error instanceof Error ? error.message : 'invalid review'}`, blocking: true }); }
  } else if (!current) gaps.push({ category: 'evidence', detail: 'CSS differences have not been attributed and reviewed against the profile-required source/target screenshot pairs; candidate CSS is not a complete handoff', blocking: true });
  const verifyApplied = options.verifyApplied || !!current, cssApplied = verifyApplied ? verifyNative44AppliedCSS(css.css, before.pageCss, manifest.replicationProfile) : undefined;
  if (verifyApplied && !cssApplied!.applied) gaps.push({ category: 'evidence', detail: 'Current page custom CSS does not match the delivered complete CSS; the applied result remains unverified', blocking: true });
  const reviews = captureInput?.legacy ? [] : options.reviews ?? [], acceptedReviews = captures.map(capture => reviews.find(review => review.viewport === capture.viewport && review.sourceScreenshotHash === capture.source.sha256 && review.targetScreenshotHash === capture.target.sha256 && review.documentHash === before.documentHash && !Number.isNaN(Date.parse(review.observedAt)) && review.notes.trim()));
  const visualReviewed = captureCoverage(manifest, captures) && acceptedReviews.every(Boolean), visualPassed = visualReviewed && acceptedReviews.every(review => review!.verdict === 'passed');
  if (isDesktopBrowserProfile(manifest.replicationProfile) && !visualReviewed) gaps.push({ category: 'evidence', detail: 'The required desktop screenshots have no complete hash-bound Codex visual review', blocking: true });
  else if (isDesktopBrowserProfile(manifest.replicationProfile) && !visualPassed) gaps.push({ category: 'structure', detail: 'Codex desktop visual review failed; required visual problems remain unresolved', blocking: true });
  const deliveryComplete = !captureInput?.legacy && captureCoverage(manifest, captures) && !gaps.some(gap => gap.blocking);
  const targetWork = reusedCapture ? [] : captures.map(capture => capture.target);
  const captureWork = {
    targetCaptureMs: targetWork.reduce((sum, capture) => sum + (capture.renderPreparation?.stagesMs?.total ?? 0), 0),
    targetScreenshotMs: targetWork.reduce((sum, capture) => sum + (capture.screenshotEvidence?.metrics?.durationMs ?? 0), 0),
    targetModuleInventoryMs: targetWork.reduce((sum, capture) => sum + (capture.renderPreparation?.stagesMs?.moduleAndMediaInventory ?? 0), 0),
    scrollCommands: targetWork.reduce((sum, capture) => sum + (capture.screenshotEvidence?.metrics?.scrollCommands ?? 0) + (capture.renderPreparation?.scrollPositions.length ?? 0), 0),
    imageSamples: targetWork.reduce((sum, capture) => sum + (capture.renderPreparation?.imageSamples ?? 0), 0),
    mediaDecodes: targetWork.reduce((sum, capture) => sum + (capture.renderPreparation?.mediaMetrics?.decodeAttempts ?? 0), 0),
    mediaDecodeCacheHits: targetWork.reduce((sum, capture) => sum + (capture.renderPreparation?.mediaMetrics?.decodeCacheHits ?? 0), 0),
    mediaCacheInvalidations: targetWork.reduce((sum, capture) => sum + (capture.renderPreparation?.mediaMetrics?.cacheInvalidations ?? 0), 0),
    actualViewportScreenshots: targetWork.reduce((sum, capture) => sum + (capture.screenshotEvidence?.metrics?.screenshots ?? 0), 0),
    layoutRefreshes: targetWork.reduce((sum, capture) => sum + (capture.screenshotEvidence?.layoutRefreshes ?? 0), 0),
  };
  const result = {
    version: 1, executionStrategy: 'native44-css-handoff', ...(manifest.replicationProfile ? { replicationProfile: manifest.replicationProfile, selectionRulesHash: manifest.selectionRulesHash } : {}), ...(manifest.releaseLock ? { releaseLock: manifest.releaseLock } : {}), taskId: manifest.taskId, runId: manifest.runId, pageId: manifest.pageId,
    startedAt, finishedAt: new Date().toISOString(), deliveryComplete,
    visualVerification: verifyApplied && cssApplied?.applied && visualPassed && !gaps.some(gap => gap.blocking) ? 'applied-verified' : verifyApplied ? 'applied-unverified' : 'awaiting-user-css',
    comparisonReview: visualReviewed ? visualPassed ? 'passed' : 'failed' : 'pending',
    css: { path: current?.currentCSS.path ?? path.join(runDir, 'page-custom.css'), sha256: css.sha256, canonicalSha256: css.canonicalSha256, pasteLocation: 'Elementor > Page Settings > Advanced > Custom CSS', applied: cssApplied?.applied ?? false, status: current ? 'current-model' : cssReviewValid ? 'reviewed-handoff' : 'candidate', reviewHash: cssReviewValid ? hash(canonical(cssReview)) : null },
    ...(current ? { currentManifest: captureManifest, reviewOutputDir: outputDir, ...(captureInput?.legacy ? { legacyCapture: true, captureManifestInput: captureInput.manifestRef, reviewStatus: 'fresh-capture-pending-review', scope: 'Read-only fresh evidence for the exact saved v1 snapshot; no task goal, pointer or acceptance migration and no new delivery verdict.' } : {}) } : {}),
    documentHash: before.documentHash, finalReadHash: after.documentHash, baselineDocumentHash: manifest.documentHash, manifestHash,
    editingEvidence: { componentKnowledge: manifest.editingEvidence ?? null, pageReadOnly: 'Saved document fingerprints and frontend module owners only; no temporary edit/save/restore experiment was run' },
    gaps, captures, differences: analyzed.differences, stateAdaptations: manifest.modules.filter(module => module.stateAdaptation).map(module => ({ moduleKey: module.key, ...module.stateAdaptation })), visualReviews: acceptedReviews.filter(Boolean), selectorMap: css.selectorMap,
    metrics: { durationMs: Math.round(performance.now() - started), documentReads: 2, documentWrites: 0, editorSessions: 0, screenshots: reusedCapture ? 0 : captures.length * (loadedSource ? 1 : 2), viewportScreenshotFrames: reusedCapture ? 0 : captures.reduce((sum, capture) => sum + (capture.target.screenshotEvidence?.frameCount ?? 0), 0), reusedScreenshots: reusedCapture ? captures.length * 2 : loadedSource ? captures.length : 0, sourceBrowserNavigations: loadedSource ? 0 : reusedCapture ? 0 : 1, blockedMutationRequests, captureWork },
  };
  // Final delivery cannot overwrite the user's stylesheet or mutate the draft.
  if (!current) await writeFile(path.join(runDir, 'page-custom.css'), css.css, 'utf8');
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', ...(current ? { flag: 'wx' } : {}) });
  await writeFile(path.join(outputDir, 'REPORT.md'), `# Native44 comparison\n\n- Draft: ${manifest.pageId}\n- CSS: ${result.css.path}\n- Paste into: ${result.css.pasteLocation}\n- Delivery complete: ${deliveryComplete}\n- Visual verification: ${result.visualVerification}\n- Screenshot review: ${result.comparisonReview}\n- Target document writes: 0\n\n## Gaps\n\n${gaps.length ? gaps.map(gap => `- ${gap.category}${gap.moduleKey ? ` / ${gap.moduleKey}` : ''}: ${gap.detail}`).join('\n') : 'No automatic structural gaps detected. Screenshot review is a separate requirement.'}\n`, 'utf8');
  return result;
}

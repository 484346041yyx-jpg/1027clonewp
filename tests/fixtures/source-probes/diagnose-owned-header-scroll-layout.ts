/** Read-only three-position geometry diagnostic. No text/URL/form-value reads,
 * screenshots, authored DOM/CSS changes, animation suppression or acceptance. */
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { adjustNative44PreviewChrome } from '../../../src/native44/compare.js';
import { readNative44CurrentState } from '../../../src/native44/current-state.js';
import { readNative44CurrentCaptureManifest, sameNative44CurrentFingerprint } from '../../../src/native44/current-capture-binding.js';
import { canonicalV2, ensureDiskSpaceV2, hashV2 } from '../../../src/replica-v2/journal.js';
import { createCanonicalNative44CompareDependencies } from './canonical-snapshot-adapter.js';
import { serializableBrowserCallback } from './browser-callback.js';

const ROOT = 'D:/cloneWP', OBS = path.join(ROOT, 'references/furryskitchen-20261017-observation');
const RUN = '2026-10-17T18-02-44-676Z-n44-c92312fe';
const DOCUMENT = 'b88d53714f9470a4ab63c9489bc5cc71d7eecfc75147839b34df1abb26f39079';
const safeError = (error: unknown) => (error instanceof Error ? error.message : 'Geometry diagnostic failed').replace(/https?:\/\/[^\s<>"']+/gi, '[URL omitted]').replace(/\b(?:Bearer|Basic)\s+[^\s]+/gi, '[authorization omitted]');

export async function collectOwnedHeaderScrollGeometry(page: Page, options: { ownerSelector: string; headerSelector: string; middleScrollY?: number }) {
  const { ownerSelector, headerSelector } = options, middleScrollY = options.middleScrollY ?? 970;
  if (![ownerSelector, headerSelector].every(value => typeof value === 'string' && value.length > 0 && value.length <= 500) || middleScrollY !== 970) throw Error('Exact bounded diagnostic selectors and middle scroll970 required');
  const original = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const baselineNodes = await page.$$('body *');
  if (!baselineNodes.length || baselineNodes.length > 12_000) throw Error('Geometry node inventory exceeds bound');
  const read = async () => {
    const observed = await page.evaluate(serializableBrowserCallback(({ ownerSelector, headerSelector, baselineNodes }: { ownerSelector: string; headerSelector: string; baselineNodes: Element[] }) => {
      const owners = document.querySelectorAll(ownerSelector), headers = document.querySelectorAll(headerSelector);
      if (owners.length !== 1 || headers.length !== 1 || !owners[0].contains(headers[0])) throw Error('Exact unique owned header identity is required');
      const owner = owners[0], header = headers[0], h = header.getBoundingClientRect();
      const nodes = Array.from(document.body.querySelectorAll('*'));
      if (nodes.length > 12_000) throw Error('Actual geometry node bound exceeded');
      const indices = new Map(nodes.map((node, index) => [node, index])), originalIndices = new Map(baselineNodes.map((node, index) => [node, index]));
      const suppression = new Map<Element, boolean>(), fixedRoots = new Map<Element, number | null>();
      const rootSuppressed = [document.documentElement, document.body].some(node => { const s = getComputedStyle(node); return s.display === 'none' || Number(s.opacity) === 0 || s.contentVisibility === 'hidden'; });
      const round = (value: number) => Math.round(value * 64) / 64;
      const rows = nodes.map((node, index) => {
        const s = getComputedStyle(node), r = node.getBoundingClientRect(), inHeader = node === header || header.contains(node);
        const inheritedFixed = fixedRoots.get(node.parentElement!) ?? null, fixedRoot = inheritedFixed ?? (s.position === 'fixed' ? index : null);
        fixedRoots.set(node, fixedRoot);
        const inheritedSuppression = suppression.get(node.parentElement!) ?? rootSuppressed;
        const subtreeSuppressed = inheritedSuppression || s.display === 'none' || Number(s.opacity) === 0 || s.contentVisibility === 'hidden'; suppression.set(node, subtreeSuppressed);
        // Visibility may be overridden by a descendant; display/ancestor
        // opacity/content-visibility suppression cannot be overridden that way.
        const suppressed = subtreeSuppressed || s.visibility === 'hidden' || s.visibility === 'collapse';
        const positiveBox = r.width > 0 && r.height > 0, intersectsViewport = r.x < innerWidth && r.right > 0 && r.y < innerHeight && r.bottom > 0;
        const frame = inHeader ? 'owned-header-relative' : fixedRoot !== null ? 'viewport-fixed-subtree' : 'document';
        const legacyRow = [node.tagName, node.childElementCount, inHeader ? 'owned-header' : s.position, positiveBox ? round(r.x - (inHeader ? h.x : 0)) : null, positiveBox ? round(r.y + (inHeader ? -h.y : scrollY)) : null, round(r.width), round(r.height)];
        const proposedRow = [node.tagName, node.childElementCount, inHeader ? 'owned-header' : s.position, frame, positiveBox ? round(r.x - (inHeader ? h.x : 0)) : null, positiveBox ? round(r.y + (inHeader ? -h.y : fixedRoot !== null ? 0 : scrollY)) : null, round(r.width), round(r.height)];
        return { index, baselineIndex: originalIndices.get(node) ?? null, parentIndex: indices.get(node.parentElement!) ?? null, tag: node.tagName.toLowerCase(), id: node.id, className: node.getAttribute('class') ?? '', childElementCount: node.childElementCount, inOwner: node === owner || owner.contains(node), inHeader, fixedRootIndex: fixedRoot, frame, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, documentRect: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }, offset: { left: (node as HTMLElement).offsetLeft ?? null, top: (node as HTMLElement).offsetTop ?? null, width: (node as HTMLElement).offsetWidth ?? null, height: (node as HTMLElement).offsetHeight ?? null, parentIndex: indices.get((node as HTMLElement).offsetParent!) ?? null }, dimensions: { clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight }, style: { position: s.position, display: s.display, visibility: s.visibility, opacity: s.opacity, contentVisibility: s.contentVisibility, transform: s.transform, top: s.top, right: s.right, bottom: s.bottom, left: s.left, overflowX: s.overflowX, overflowY: s.overflowY, clipPathPresent: s.clipPath !== 'none', maskPresent: s.maskImage !== 'none' }, inheritedSuppression, suppressed, positiveBox, intersectsViewport, possiblyPaintedInViewport: positiveBox && !suppressed && intersectsViewport, legacyRow, proposedRow };
      });
      return { observedAt: new Date().toISOString(), viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, devicePixelRatio }, scroll: { x: scrollX, y: scrollY }, document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }, runningAnimations: document.getAnimations().filter(animation => animation.playState === 'running' || animation.pending).length, fontsLoading: document.fonts.status === 'loading', ownedHeader: { index: indices.get(header), x: h.x, y: h.y, width: h.width, height: h.height, position: getComputedStyle(header).position }, identityStable: nodes.length === baselineNodes.length && rows.every(row => row.index === row.baselineIndex), rows };
    }), { ownerSelector, headerSelector, baselineNodes });
    return { ...observed, legacyLayoutHash: hashV2(JSON.stringify(observed.rows.map(row => row.legacyRow))), proposedCoordinateHash: hashV2(JSON.stringify(observed.rows.map(row => row.proposedRow))) };
  };
  const samples: Awaited<ReturnType<typeof read>>[] = [], settling: any[] = [];
  try {
    for (const requestedY of [0, middleScrollY, 0]) {
      await page.evaluate(y => scrollTo({ left: 0, top: y, behavior: 'instant' }), requestedY);
      let previous = '', stable = 0, actual: Awaited<ReturnType<typeof read>> | undefined;
      const started = Date.now(), observations: any[] = [];
      while (Date.now() - started < 7000) {
        actual = await read();
        const signature = canonicalV2({ viewport: actual.viewport, scroll: actual.scroll, document: actual.document, rows: actual.rows, runningAnimations: actual.runningAnimations, fontsLoading: actual.fontsLoading });
        stable = signature === previous && actual.runningAnimations === 0 && !actual.fontsLoading ? stable + 1 : 0; previous = signature;
        observations.push({ observedAt: actual.observedAt, scroll: actual.scroll, height: actual.document.scrollHeight, runningAnimations: actual.runningAnimations, fontsLoading: actual.fontsLoading, legacyLayoutHash: actual.legacyLayoutHash, proposedCoordinateHash: actual.proposedCoordinateHash });
        if (stable >= 2) break; await page.waitForTimeout(100);
      }
      settling.push({ requestedY, settled: stable >= 2, observations });
      if (!actual || stable < 2 || Math.abs(actual.scroll.y - requestedY) > .02 || actual.scroll.x !== 0 || !actual.identityStable) throw Error('Actual diagnostic geometry did not settle at the exact requested position/identity');
      samples.push(actual);
    }
    return { samples, settling, readPolicy: 'Only tag/id/class/node identity, actual BCR/offset/dimensions, computed layout/visibility/fixed ancestry. No text, links, media URLs, HTML, attributes inventory or form values.', acceptanceVerdict: 'none' };
  } finally {
    try { await page.evaluate(({ x, y }) => scrollTo({ left: x, top: y, behavior: 'instant' }), original); }
    finally { await Promise.all(baselineNodes.map(handle => handle.dispose())); }
  }
}

export async function runOwnedHeaderScrollDiagnostic(args: string[]) {
  if (args.length !== 2 || args[0] !== '--run' || args[1] !== RUN) throw Error('Usage: --run 2026-10-17T18-02-44-676Z-n44-c92312fe');
  const runDir = path.join(ROOT, 'runs', RUN), current = await readNative44CurrentState(ROOT, runDir);
  if (!current || current.pageId !== 15769 || current.documentHash !== DOCUMENT || !current.currentManifest) throw Error('Geometry probe requires exact current b88 owned draft');
  const input = await readNative44CurrentCaptureManifest(ROOT, runDir, current), manifest = input.manifest;
  const headers = manifest.modules.filter(module => module.key === 'header'); if (headers.length !== 1) throw Error('Unique current header module is required');
  const pointerPath = path.join(runDir, 'current-user-amendment.json'), pointerBytes = await readFile(pointerPath);
  await ensureDiskSpaceV2(ROOT);
  const folder = path.join(OBS, `owned-header-scroll-geometry-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`); await mkdir(folder);
  const save = async (name: string, value: unknown) => { await ensureDiskSpaceV2(ROOT); const file = path.join(folder, name), bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(file, bytes, { flag: 'wx' }); return { path: file, sha256: hashV2(bytes) }; };
  let deps: Awaited<ReturnType<typeof createCanonicalNative44CompareDependencies>> | undefined;
  let chrome: Awaited<ReturnType<typeof adjustNative44PreviewChrome>>, chromeRestored = false;
  try {
    deps = await createCanonicalNative44CompareDependencies(ROOT, manifest, { purpose: 'owned-header-scroll-geometry-only' });
    const before = await deps.readSnapshot(); if (!sameNative44CurrentFingerprint(before, input.binding.fingerprint) || before.documentHash !== DOCUMENT) throw Error('Actual before fingerprint not current');
    const page = await deps.openPage(manifest.targetUrl, 'target'); await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForLoadState('load', { timeout: 45_000 });
    await page.evaluate(async () => { await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 10_000))]); });
    chrome = await adjustNative44PreviewChrome(page);
    let data: Awaited<ReturnType<typeof collectOwnedHeaderScrollGeometry>>;
    try { data = await collectOwnedHeaderScrollGeometry(page, { ownerSelector: '.elementor-15769', headerSelector: headers[0].targetSelector }); }
    finally { await chrome?.restore(); chromeRestored = true; }
    const restoredChrome = await page.evaluate(() => ({ adminBars: document.querySelectorAll('#wpadminbar').length, adminBarHeight: document.querySelector('#wpadminbar')?.getBoundingClientRect().height ?? null, adminBarDisplay: document.querySelector('#wpadminbar') ? getComputedStyle(document.querySelector('#wpadminbar')!).display : null, htmlMarginTop: getComputedStyle(document.documentElement).marginTop }));
    const after = await deps.readSnapshot();
    if (!sameNative44CurrentFingerprint(before, after) || !sameNative44CurrentFingerprint(after, input.binding.fingerprint) || after.documentHash !== DOCUMENT || !(await readFile(pointerPath)).equals(pointerBytes) || hashV2(await readFile(input.manifestRef.path)) !== input.manifestRef.sha256) throw Error('Actual document/CSS/resources/query/manifest/pointer changed');
    const files = []; for (const [index, sample] of data.samples.entries()) files.push(await save(`sample-${index}-scroll-${sample.scroll.y}.json`, sample));
    const base = data.samples[0], changes = data.samples.slice(1).map((sample, offset) => ({ sampleIndex: offset + 1, scroll: sample.scroll, legacyHashChanged: sample.legacyLayoutHash !== base.legacyLayoutHash, proposedCoordinateHashChanged: sample.proposedCoordinateHash !== base.proposedCoordinateHash, rows: sample.rows.flatMap((row, index) => canonicalV2(row.legacyRow) === canonicalV2(base.rows[index].legacyRow) ? [] : [{ index, baseline: base.rows[index], actual: row, coordinateOnly: canonicalV2(row.proposedRow) === canonicalV2(base.rows[index].proposedRow) }]) }));
    const report = await save('report.json', { version: 1, kind: 'actual-owned-header-scroll-geometry-diagnostic', taskId: current.taskId, runId: RUN, pageId: 15769, documentHash: DOCUMENT, freshBefore: before, freshAfter: after, completeFingerprintsUnchanged: true, currentManifest: input.manifestRef, currentSnapshot: current.currentSnapshot, currentPointer: { path: pointerPath, sha256: hashV2(pointerBytes) }, canonicalSnapshotEvidence: deps.canonicalSnapshotEvidence, viewport: { width: 1920, height: 1080 }, samples: files, settling: data.settling, changes, previewChrome: chrome?.receipt ?? null, previewChromeRestored: chromeRestored, restoredChrome, readPolicy: data.readPolicy, documentWrites: 0, screenshots: 0, editorSessions: 0, formsSubmitted: 0, acceptanceVerdict: 'none', originalFailedReceiptUnchanged: true });
    return { folder, report, samples: files, changeCounts: changes.map(change => ({ sampleIndex: change.sampleIndex, rows: change.rows.length, coordinateOnly: change.rows.filter(row => row.coordinateOnly).length })), completeFingerprintsUnchanged: true };
  } catch (error) { await save('failure.json', { kind: 'owned-header-scroll-geometry-diagnostic-failure', reason: safeError(error), chromeRestored, documentWrites: 0, acceptanceVerdict: 'none' }); throw error; }
  finally { try { if (!chromeRestored) await chrome?.restore(); } finally { await deps?.close?.(); } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runOwnedHeaderScrollDiagnostic(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; });

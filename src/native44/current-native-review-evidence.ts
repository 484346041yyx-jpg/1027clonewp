import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { hashV2 } from '../replica-v2/journal.js';
import type { Native44CurrentNativeSourceBinding } from './current-native-model.js';

type Ref = { path: string; sha256: string };
type Identity = { taskId: string; runId: string; pageId: number };
export interface Native44CurrentNativeReviewEvidence { readonly kind: 'qualified-current-native-review-evidence' }
const qualified = new WeakMap<object, Identity & { root: string; declared: Map<string, string>; readable: Map<string, string>; dependencies: Ref[] }>();
const fail = (reason: string): never => { throw Error(`native44_current_native_review_evidence_${reason}`); };
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };
const reference = (value: any): value is Ref => !!value && typeof value.path === 'string' && !/[?\r\n]|^[a-z]+:\/\//i.test(value.path) && /^[a-f\d]{64}$/.test(value.sha256);
const sameRef = (root: string, a: any, b: any) => reference(a) && reference(b) && path.resolve(root, a.path) === path.resolve(root, b.path) && a.sha256 === b.sha256;
/** Only another bounded runs directory is eligible for this narrow contract. */
export function native44CurrentNativeExternalReviewPath(root: string, runId: string, filename: string): boolean {
  const resolved = path.resolve(root, filename), runs = path.resolve(root, 'runs'), own = path.join(runs, runId);
  return inside(runs, resolved) && !inside(own, resolved) && path.relative(runs, resolved).split(path.sep).length >= 2;
}
export function native44CurrentNativeReviewEvidenceAllows(token: Native44CurrentNativeReviewEvidence | undefined, root: string, ref: Ref, identity: Identity, declaredOnly = false): boolean {
  const data = token && qualified.get(token); return !!data && data.root === path.resolve(root) && data.taskId === identity.taskId && data.runId === identity.runId && data.pageId === identity.pageId && reference(ref) && (declaredOnly ? data.declared : data.readable).get(path.resolve(root, ref.path)) === ref.sha256;
}
export function native44CurrentNativeReviewDependencies(token: Native44CurrentNativeReviewEvidence): Ref[] {
  const data = qualified.get(token); if (!data) fail('process_identity_required'); return structuredClone(data!.dependencies);
}

/** Namespace qualification only: historical failed reviews remain diagnostic
 * evidence. This grants neither acceptance nor authority for a remote write. */
export async function qualifyNative44CurrentNativeReviewEvidence(input: { root: string; taskId: string; runId: string; pageId: number; sourceBindings: Native44CurrentNativeSourceBinding[] }): Promise<Native44CurrentNativeReviewEvidence> {
  const root = path.resolve(input.root), runs = path.join(root, 'runs'), ownRun = path.join(runs, input.runId), declared = new Map<string, string>(), dependencies = new Map<string, Ref>(), cache = new Map<string, { bytes: Buffer; value?: any; reference: Ref }>(); let cachedBytes = 0;
  for (const binding of input.sourceBindings) for (const ref of [...binding.evidence, ...(binding.descendantBindings ?? []).flatMap(row => row.evidence)]) {
    if (!reference(ref)) fail('reference_invalid'); const file = path.resolve(root, ref.path);
    if (!native44CurrentNativeExternalReviewPath(root, input.runId, file)) continue;
    if (declared.has(file) && declared.get(file) !== ref.sha256) fail('declared_hash_conflict'); declared.set(file, ref.sha256);
  }
  const read = async (file: string, expected?: string) => {
    file = path.resolve(root, file); if (!inside(runs, file)) fail('path_escape');
    const hit = cache.get(file); if (hit) { if (expected && hit.reference.sha256 !== expected) fail('hash_mismatch'); return hit; }
    if (await realpath(file) !== file) fail('reference_alias'); const info = await stat(file); if (!info.isFile() || info.size > 64 * 1024 * 1024) fail('artifact_size');
    const bytes = await readFile(file), sha256 = hashV2(bytes); if (expected && sha256 !== expected) fail('hash_mismatch'); const result: { bytes: Buffer; value?: any; reference: Ref } = { bytes, reference: { path: file, sha256 } };
    if (path.extname(file) === '.json' && cachedBytes + bytes.length <= 128 * 1024 * 1024) { cache.set(file, result); cachedBytes += bytes.length; } dependencies.set(file, result.reference); return result;
  };
  const json = async (ref: Ref) => { if (!reference(ref)) fail('reference_invalid'); const loaded = await read(ref.path, ref.sha256); if (!Object.hasOwn(loaded, 'value')) { try { loaded.value = JSON.parse(loaded.bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { fail('json_invalid'); } } return loaded.value; };
  const identity = (value: any) => value?.taskId === input.taskId && value?.runId === input.runId && value?.pageId === input.pageId;
  const owners = new Map<string, Map<string, string>>();
  for (const [file, sha] of declared) { const owner = path.join(runs, path.relative(runs, file).split(path.sep)[0]); if (!/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/.test(path.basename(owner)) || path.basename(owner).includes('..')) fail('owner_invalid'); const items = owners.get(owner) ?? new Map(); items.set(file, sha); owners.set(owner, items); }
  for (const [owner, items] of owners) {
    const reportFile = path.join(owner, 'report.json'), qaFile = path.join(owner, 'qa-module-pairs', 'index.json');
    let qa: any; if (items.has(qaFile)) qa = await json({ path: qaFile, sha256: items.get(qaFile)! });
    if (qa && (!reference(qa.report) || path.resolve(root, qa.report.path) !== reportFile)) fail('qa_report_owner_conflict');
    const reportLoaded = await read(reportFile, items.get(reportFile) ?? qa?.report.sha256), report = await json(reportLoaded.reference);
    if (report.version !== 1 || !identity(report) || !/^[a-f\d]{64}$/.test(report.documentHash)) fail('report_identity_conflict');
    const actual = report.kind === 'native44-current-review' && report.documentUnchanged === true && report.metrics?.documentWrites === 0 && report.metrics?.editorSessions === 0;
    const standard = report.executionStrategy === 'native44-css-handoff' && report.documentHash === report.finalReadHash && report.documentHash === report.baselineDocumentHash && report.metrics?.documentWrites === 0 && report.metrics?.editorSessions === 0;
    const probe = report.kind === 'actual-owned-current-testimonial-style-diagnostic' && report.currentUnchanged === true && report.targetWrites === 0 && report.documentWrites === 0 && report.editorSessions === 0;
    if (!actual && !standard && !probe) fail('report_kind_or_readonly_contract_invalid');
    const manifestRef = probe ? report.manifest : report.currentManifest;
    if (!reference(manifestRef) || !inside(ownRun, path.resolve(root, manifestRef.path))) fail('owned_manifest_required');
    const manifest = await json(manifestRef); if (!identity(manifest) || manifest.documentHash !== report.documentHash) fail('historical_manifest_identity_conflict');
    if (probe) { if (!reference(report.snapshot) || !inside(ownRun, path.resolve(root, report.snapshot.path))) fail('probe_snapshot_required'); const snapshot = await json(report.snapshot); if (snapshot.runId !== input.runId || snapshot.pageId !== input.pageId || snapshot.hash !== report.documentHash) fail('probe_snapshot_identity_conflict'); }
    const members = new Map<string, string>(), captures = new Map<string, any>();
    const member = (ref: any) => { if (!reference(ref) || !inside(owner, path.resolve(root, ref.path))) fail('member_owner_conflict'); const file = path.resolve(root, ref.path); if (members.has(file) && members.get(file) !== ref.sha256) fail('member_hash_conflict'); members.set(file, ref.sha256); };
    members.set(reportFile, reportLoaded.reference.sha256);
    if (actual || standard) {
      if (!Array.isArray(report.captures)) fail('capture_inventory_invalid');
      for (const capture of report.captures) {
        const viewport = capture.viewport, source = actual ? capture.sourceScreenshot : { path: capture.source?.screenshot, sha256: capture.source?.sha256 }, target = actual ? capture.targetScreenshot : { path: capture.target?.screenshot, sha256: capture.target?.sha256 };
        if (typeof viewport !== 'string' || captures.has(viewport)) fail('capture_viewport_invalid'); member(source); member(target);
        const census = actual ? capture.targetDOMCensus : undefined, supplemental = actual ? capture.supplementalInteractions : undefined, receipt = actual ? capture.screenshotEvidence?.receipt : capture.target?.screenshotEvidence?.receipt;
        for (const ref of [census, supplemental, receipt]) if (ref !== undefined) member(ref);
        captures.set(viewport, { source, target, census });
      }
    } else {
      if (!Array.isArray(report.observations)) fail('probe_observation_inventory_invalid');
      for (const row of report.observations) { if (row.documentHash !== report.documentHash) fail('probe_observation_document_conflict'); member(row.observations); }
    }
    if (qa) {
      if (qa.version !== 1 || qa.kind !== 'actual-current-review-qa-derivatives' || qa.documentHash !== report.documentHash || !sameRef(root, qa.report, reportLoaded.reference) || !Array.isArray(qa.rows)) fail('qa_identity_conflict');
      for (const row of qa.rows) {
        const capture = captures.get(row.viewport), source = row.actualInputReferences?.source, target = row.actualInputReferences?.target, measurementRef = row.actualInputReferences?.measurements;
        if (!capture || !sameRef(root, source, capture.source) || !sameRef(root, target, capture.target) || !reference(measurementRef) || !inside(owner, path.resolve(root, measurementRef.path)) || !reference(row.derivative) || !inside(path.join(owner, 'qa-module-pairs'), path.resolve(root, row.derivative.path))) fail('qa_capture_membership_conflict');
        if (items.has(path.resolve(root, measurementRef.path)) || items.has(path.resolve(root, row.derivative.path))) {
          const measurement = await json(measurementRef);
          const viewport = Array.isArray(manifest.viewports) ? manifest.viewports.find((value: any) => value?.name === row.viewport) : undefined;
          if (!viewport || measurement.viewport?.name !== viewport.name || measurement.viewport?.width !== viewport.width || measurement.viewport?.height !== viewport.height || !sameRef(root, { path: measurement.source?.screenshot, sha256: measurement.source?.sha256 }, capture.source) || !sameRef(root, { path: measurement.target?.screenshot, sha256: measurement.target?.sha256 }, capture.target) || !sameRef(root, measurement.targetDOMCensus, capture.census)) fail('measurement_capture_membership_conflict');
        }
        member(measurementRef); member(row.derivative);
      }
      members.set(qaFile, items.get(qaFile)!);
    }
    for (const [file, sha] of items) {
      if (members.get(file) !== sha) fail('undeclared_report_member');
      const loaded = await read(file, sha);
      if (path.extname(file) === '.json' && file !== reportFile && file !== qaFile) {
        const value = await json(loaded.reference), candidate = value.kind === 'actual-owned-testimonial-style-probe' ? value.current : value;
        if (value.taskId !== undefined || value.runId !== undefined || value.pageId !== undefined) if (!identity(value) || value.documentHash !== report.documentHash) fail('member_identity_conflict');
        if (candidate.taskId !== undefined || candidate.runId !== undefined || candidate.pageId !== undefined) if (!identity(candidate) || candidate.documentHash !== report.documentHash) fail('member_identity_conflict');
      }
    }
  }
  const token: Native44CurrentNativeReviewEvidence = Object.freeze({ kind: 'qualified-current-native-review-evidence' });
  qualified.set(token, { root, taskId: input.taskId, runId: input.runId, pageId: input.pageId, declared, readable: new Map([...dependencies.values()].map(ref => [ref.path, ref.sha256])), dependencies: [...dependencies.values()] }); return token;
}

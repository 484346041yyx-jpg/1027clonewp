import path from 'node:path';
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { acquireLock, writeJson } from '../core/files.js';
import { redactor } from '../core/config.js';
import { canonicalV2, ensureDiskSpaceV2, hashV2 } from '../replica-v2/journal.js';
import { readNative44CurrentState, validateNative44CurrentCaptureReviewPointer, type Native44CurrentRef } from './current-state.js';
import { emitNative44DeliverySummary } from './delivery-summary.js';
import { Native44CurrentCaptureReviewRequestSchema, Native44CurrentCaptureReviewSchema, Native44CurrentReviewRefSchema } from './current-review-contract.js';

function fail(code: string): never { throw Error(`native44_current_review_${code}`); }
function inside(root: string, filename: string): void { const relative = path.relative(root, filename); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('path_escape'); }
async function bounded(root: string, reference: Native44CurrentRef) {
  Native44CurrentReviewRefSchema.parse(reference);
  if (/[?\r\n]|^[a-z]+:\/\//i.test(reference.path)) fail('reference_invalid');
  const filename = path.resolve(root, reference.path); inside(root, filename); if (await realpath(filename) !== filename) fail('reference_alias');
  const info = await stat(filename); if (!info.isFile() || info.size > 64 * 1024 * 1024) fail('reference_size_limit');
  const bytes = await readFile(filename); if (bytes.length > 64 * 1024 * 1024 || hashV2(bytes) !== reference.sha256) fail('reference_changed');
  return { filename, bytes };
}
async function locatedReference(root: string, reference: Native44CurrentRef, field: string) {
  try { return await bounded(root, reference); }
  catch (error) { throw Error(`${error instanceof Error ? error.message : 'native44_current_review_reference_invalid'}; field=${field}`); }
}
async function immutable(filename: string, bytes: Buffer): Promise<Native44CurrentRef> {
  try { await writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await readFile(filename)).equals(bytes)) fail('immutable_conflict'); }
  return { path: filename, sha256: hashV2(bytes) };
}
const serialize = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** Build the complete candidate in memory. The normal current-state reader
 * still validates every external file, decoded screenshot and actual check. */
async function prepareCurrentCaptureReview(rootInput: string, runId: string, input: unknown) {
  const request = Native44CurrentCaptureReviewRequestSchema.parse(input), root = await realpath(rootInput);
  if (request.runId !== runId || redactor()(JSON.stringify(request)) !== JSON.stringify(request)) fail('request_identity_or_secret');
  const runDir = path.join(root, 'runs', runId); if (await realpath(runDir) !== runDir) fail('run_alias');
    await ensureDiskSpaceV2(root);
    const pointerFile = path.join(runDir, 'current-user-amendment.json'), beforeBytes = await readFile(pointerFile), pointer = JSON.parse(beforeBytes.toString('utf8'));
    if (pointer.version !== 1 || pointer.kind !== 'completed-explicit-user-draft-amendment' || pointer.taskId !== request.taskId || pointer.runId !== request.runId || pointer.pageId !== request.pageId || pointer.documentHash !== request.documentHash) fail('v1_current_identity_conflict');
    const current = await readNative44CurrentState(root, runDir); if (!current || current.resolvedFrom || current.runId !== runId) fail('successor_requires_exact_run');
    if (current.evidence.find(item => item.path === pointerFile)?.sha256 !== hashV2(beforeBytes)) fail('parent_pointer_changed');
    if (hashV2(beforeBytes) !== request.expectedPointerHash) {
      if (pointer.status !== 'reviewed-current-capture' || !pointer.currentCaptureReview) fail('parent_pointer_changed');
      const record = Native44CurrentCaptureReviewSchema.parse(JSON.parse((await bounded(root, pointer.currentCaptureReview)).bytes.toString('utf8'))), original = JSON.parse((await bounded(root, record.request)).bytes.toString('utf8'));
      if (canonicalV2(original) !== canonicalV2(request) || record.parentPointerHash !== request.expectedPointerHash) fail('parent_pointer_changed');
      if (!(await readFile(pointerFile)).equals(beforeBytes)) fail('parent_pointer_changed');
      return { root, runDir, pointerFile, beforeBytes, current, request, idempotent: true as const, files: new Map<string, Buffer>(), candidate: pointer };
    }
    const reportFile = await locatedReference(root, request.report, 'report'), visualFile = await locatedReference(root, request.visualReview, 'visualReview'), report = JSON.parse(reportFile.bytes.toString('utf8'));
    const reviewDir = path.dirname(reportFile.filename);
    if (path.dirname(reviewDir) !== path.join(root, 'runs') || path.basename(reportFile.filename) !== 'report.json' || path.dirname(visualFile.filename) !== reviewDir || path.basename(visualFile.filename) !== 'visual-reviews.json') fail('review_owner_conflict');
    const manifestRef = Native44CurrentReviewRefSchema.parse(report.currentManifest), manifest = await locatedReference(root, manifestRef, 'report.currentManifest');
    if (path.dirname(manifest.filename) !== reviewDir || path.basename(manifest.filename) !== 'compare-manifest.json') fail('manifest_owner_conflict');
    const owns = (base: string, filename: string) => { const relative = path.relative(base, filename); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
    const noteReference = async (reference: Native44CurrentRef, field: string) => {
      const filename = path.resolve(root, reference.path);
      if (![path.join(root, 'references', request.taskId), runDir, reviewDir].some(base => owns(base, filename))) throw Error(`native44_current_capture_review_note_owner_conflict; field=${field}`);
      await locatedReference(root, reference, field);
    };
    for (const [section, entries] of Object.entries(request.notes)) for (const [index, entry] of entries.entries()) for (const [referenceIndex, reference] of entry.evidence.entries()) await noteReference(reference, `notes.${section}[${index}].evidence[${referenceIndex}]`);
    for (const [index, gap] of request.gapReviews.entries()) for (const [referenceIndex, reference] of gap.evidence.entries()) await noteReference(reference, `gapReviews[${index}].evidence[${referenceIndex}]`);
    const folder = path.join(runDir, 'amendments', `current-review-${hashV2(canonicalV2(request)).slice(0, 24)}`);
    const requestBytes = serialize(request), requestRef = { path: path.join(folder, 'request.json'), sha256: hashV2(requestBytes) };
    // Do not follow an alias while looking for an interrupted prior record.
    // The virtual reader independently checks all three prospective paths.
    try { if (await realpath(folder) !== folder) fail('review_alias'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = path.dirname(folder); if (await realpath(parent) !== parent) fail('review_alias'); }
    let recordedAt = new Date().toISOString();
    try { const stored = await readFile(path.join(folder, 'current-capture-review.json')); recordedAt = Native44CurrentCaptureReviewSchema.parse(JSON.parse(stored.toString('utf8'))).recordedAt; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const record = Native44CurrentCaptureReviewSchema.parse({ version: 1, kind: 'native44-current-capture-review', taskId: request.taskId, runId, pageId: request.pageId, documentHash: request.documentHash, reviewGoal: 'component-reference-v1', frozenContractPreserved: true, requirementsComplete: false, userInstruction: request.userInstruction, recordedAt, parentPointerHash: request.expectedPointerHash, request: requestRef, currentSnapshot: current.currentSnapshot, currentCSS: current.currentCSS, report: { path: reportFile.filename, sha256: request.report.sha256 }, manifest: { path: manifest.filename, sha256: manifestRef.sha256 }, visualReview: { path: visualFile.filename, sha256: request.visualReview.sha256 }, notes: request.notes, gapReviews: request.gapReviews });
    const recordBytes = serialize(record), recordRef = { path: path.join(folder, 'current-capture-review.json'), sha256: hashV2(recordBytes) };
    const candidate = { ...pointer, status: 'reviewed-current-capture', verification: record.report, visualReview: record.visualReview, currentCaptureReview: recordRef, reviewedAt: recordedAt, reviewStatus: 'current-capture-reviewed' };
    const files = new Map([[requestRef.path, requestBytes], [path.join(folder, 'parent-pointer.json'), beforeBytes], [recordRef.path, recordBytes]]);
    const validated = await validateNative44CurrentCaptureReviewPointer(root, runDir, candidate, { virtualEvidence: files });
    if (!(await readFile(pointerFile)).equals(beforeBytes)) fail('parent_pointer_changed');
    return { root, runDir, pointerFile, beforeBytes, current: validated, request, idempotent: false as const, files, candidate };
}

/** Read-only preparation, with precisely the same complete evidence validation
 * as import. No amendment directory, immutable record or current pointer is saved. */
export async function prepareNative44CurrentCaptureReview(rootInput: string, runId: string, input: unknown) {
  const prepared = await prepareCurrentCaptureReview(rootInput, runId, input), review = prepared.current.currentCaptureReview;
  if (!review) fail('prepared_review_missing');
  return { status: 'prepared-current-capture-review' as const, idempotent: prepared.idempotent, remoteWrites: 0, localWrites: 0, taskId: prepared.request.taskId, runId, pageId: prepared.request.pageId, documentHash: prepared.request.documentHash, reviewStatus: prepared.current.status, automated: review.automated, qualityFloor: review.qualityFloor, draftReady: review.draftReady, deliveryReady: review.deliveryReady, notes: review.notes, report: prepared.request.report, visualReview: prepared.request.visualReview, currentManifest: prepared.current.currentManifest };
}

/** Local-only explicit review import. Prepare fully before creating records;
 * then persist the exact checked bytes and perform actual readback before CAS. */
export async function importNative44CurrentCaptureReview(rootInput: string, runId: string, input: unknown) {
  const root = await realpath(rootInput), prepared = await prepareCurrentCaptureReview(root, runId, input), unlock = await acquireLock(root);
  try {
    const { runDir, pointerFile, beforeBytes, candidate, request } = prepared;
    if (!(await readFile(pointerFile)).equals(beforeBytes)) fail('parent_pointer_changed');
    for (const reference of new Map(prepared.current.evidence.map(item => [item.path, item])).values()) if (!prepared.files.has(reference.path)) await bounded(root, { path: reference.path, sha256: reference.sha256 });
    let validated = prepared.current;
    if (!prepared.idempotent) {
      const folder = path.dirname(candidate.currentCaptureReview.path); await mkdir(folder, { recursive: true }); if (await realpath(folder) !== folder) fail('review_alias');
      for (const [filename, bytes] of prepared.files) await immutable(filename, bytes);
      validated = await validateNative44CurrentCaptureReviewPointer(root, runDir, candidate);
    }
    // The root lock serializes cooperating writers; exact bytes and every
    // observed evidence hash additionally protect against external changes.
    for (const reference of new Map(validated.evidence.map(item => [item.path, item])).values()) await bounded(root, { path: reference.path, sha256: reference.sha256 });
    if (!(await readFile(pointerFile)).equals(beforeBytes)) fail('parent_pointer_changed');
    if (!prepared.idempotent) await writeJson(pointerFile, candidate);
    if (!(await readFile(pointerFile)).equals(serialize(candidate))) fail('readback_review_conflict');
    const actual = await readNative44CurrentState(root, runDir); if (!actual?.currentCaptureReview || actual.documentHash !== request.documentHash || canonicalV2(actual.currentCaptureReview.record) !== canonicalV2(candidate.currentCaptureReview)) fail('readback_conflict');
    const delivery = await emitNative44DeliverySummary(root, runId, { expectedState: actual, lockHeld: true });
    if (!(await readFile(pointerFile)).equals(serialize(candidate)) || !delivery.summary.identityEvidence.some(reference => canonicalV2(reference) === canonicalV2(candidate.currentCaptureReview))) fail('readback_review_conflict');
    return { status: 'reviewed-current-capture' as const, idempotent: prepared.idempotent, remoteWrites: 0, current: actual, delivery };
  } finally { await unlock(); }
}

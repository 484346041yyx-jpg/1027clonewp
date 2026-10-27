import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readJson } from '../core/config.js';
import { writeJson } from '../core/files.js';
import { WordPressClient, getAssetImportFailure, type ImportedAsset } from '../wordpress/client.js';
import { ensureDiskSpaceV2, hashV2, retryReadV2 } from '../replica-v2/journal.js';
import { importAssetAttemptV2 } from '../assets/import-attempt.js';
import { validateAssetBytesV2 } from '../assets/validation.js';
import type { ImportedAssetV2 } from '../replica-v2/types.js';
import { validateSourceFontBytes } from '../wordpress/source-font.js';
export interface Native44Asset { key: string; localPath: string; sourceUrl: string; sha256: string; mediaType: string; alt?: string; originalSha256?: string }
interface Entry { key: string; sha256: string; status: 'intent' | 'complete' | 'unknown' | 'retryable'; remoteWriteStarted?: boolean; imported?: ImportedAssetV2; operations: Array<{ id: string; phase: string; status: string; beforeHash: string; expectedAfterHash: string }> }
/** The manifest preserves usage identity; identical files share the confirmed attachment. */
type MediaOptions = { client: Pick<WordPressClient,'verifyImportedAssets'|'importAsset'|'inspectPendingAsset'>; root: string; runDir: string; jobDir: string; runId: string; pageId: number; manifest: Native44Asset[]; required: readonly string[] };
export async function importNative44Media(options: MediaOptions): Promise<ImportedAssetV2[]> { return importResources(options, false); }
export async function importNative44SourceFonts(options: Omit<MediaOptions, 'client'> & { client: Pick<WordPressClient, 'verifyImportedAssets'|'importSourceFont'|'inspectPendingAsset'> }): Promise<ImportedAssetV2[]> {
  return importResources({ ...options, client: { verifyImportedAssets: options.client.verifyImportedAssets.bind(options.client), importAsset: options.client.importSourceFont.bind(options.client), inspectPendingAsset: options.client.inspectPendingAsset.bind(options.client) } }, true);
}
async function importResources(options: MediaOptions, sourceFonts: boolean): Promise<ImportedAssetV2[]> {
  const { client } = options, filename = path.join(options.runDir, 'assets', 'ledger.json');
  let ledger: { version: 1; runId: string; pageId: number; assets: Entry[] };
  try { ledger = await readJson(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ledger = { version: 1, runId: options.runId, pageId: options.pageId, assets: [] }; }
  if (ledger.runId !== options.runId || ledger.pageId !== options.pageId || !Array.isArray(ledger.assets) || new Set(ledger.assets.map(entry => entry.key)).size !== ledger.assets.length || new Set(options.manifest.map(entry=>entry.key)).size!==options.manifest.length || new Set(options.required).size!==options.required.length) throw Error('Media ledger ownership or manifest identity changed');
  const persist = async () => { await ensureDiskSpaceV2(options.root); await writeJson(filename, ledger); };
  for (const entry of ledger.assets) if (entry.status === 'complete' && (!entry.imported || entry.imported.key!==entry.key || entry.sha256 !== entry.imported.sha256 || !options.manifest.some(asset => asset.key === entry.key && asset.sha256 === entry.sha256 && asset.mediaType===entry.imported!.mimeType))) throw Error('Confirmed media bytes or identity changed');
  const complete = () => ledger.assets.filter(entry => entry.status === 'complete').map(entry => entry.imported!);
  const verify = async () => { const assets = complete(); for (let offset = 0; offset < assets.length; offset += 100) await retryReadV2(() => client.verifyImportedAssets(options.pageId, assets.slice(offset, offset + 100))); };
  await verify();
  for (const key of options.required) {
    const source = options.manifest.find(asset => asset.key === key); if (!source) throw Error(`Missing required current-task media ${key}`);
    let entry = ledger.assets.find(item => item.key === key); if (entry && entry.sha256 !== source.sha256) throw Error(`Media bytes changed ${key}`);
    if (entry?.status === 'complete') continue;
    const alias = ledger.assets.find(item => item.status === 'complete' && item.sha256 === source.sha256 && item.imported?.mimeType===source.mediaType);
    if (alias?.imported) { const imported = { ...alias.imported, key }; if (entry) Object.assign(entry, { imported, status: 'complete' }); else ledger.assets.push({ key, sha256: source.sha256, status: 'complete', imported, operations: [] }); await persist(); continue; }
    const recovering = !!entry; entry ??= { key, sha256: source.sha256, status: 'intent', operations: [] }; if (!ledger.assets.includes(entry)) ledger.assets.push(entry);
    const previousWriteStarted=entry.remoteWriteStarted;let provenBefore=false;
    const local = await realpath(path.resolve(options.jobDir, source.localPath)), relative = path.relative(options.jobDir, local);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Current-job media escaped the job');
    const bytes = await readFile(local); if (hashV2(bytes) !== source.sha256) throw Error(`Media hash mismatch ${key}`); if (sourceFonts) validateSourceFontBytes(bytes, source.mediaType); else await validateAssetBytesV2(bytes, source.mediaType);
    const base = { runId: options.runId, pageId: options.pageId, sourceUrl: source.sourceUrl, mimeType: source.mediaType, alt: source.alt, verifiedSha256: source.sha256, originalSha256: source.originalSha256 };
    await persist();
    try {
      let imported: ImportedAsset | undefined, recoverPendingUpload = false;
      if (recovering) {
        try { imported = await retryReadV2(() => client.importAsset(local, { ...base, requireExisting: true })); }
        catch (error) { if ((error as { code?: string }).code !== 'existing_asset_required') throw error; }
        if (!imported && entry.remoteWriteStarted !== false) {
          const pending = await retryReadV2(() => client.inspectPendingAsset(local, base));
          if (pending.status === 'attachment-present') throw Error(`Ambiguous media registration ${key}; duplicate upload refused`);
          recoverPendingUpload = pending.status === 'staged';
          provenBefore=pending.status==='absent';
        }
      }
      imported ??= await importAssetAttemptV2(client, local, { ...base, recoverPendingUpload, onCheckpoint: async checkpoint => {
        entry!.remoteWriteStarted = checkpoint.remoteWriteStarted;
        if (checkpoint.phase === 'uploading' || checkpoint.phase === 'registering') entry!.operations.push({ id: randomUUID(), phase: checkpoint.phase, status: 'intent', beforeHash: hashV2(`${options.runId}:${key}:${checkpoint.phase}:before`), expectedAfterHash: source.sha256 });
        if (checkpoint.phase === 'complete') entry!.operations.forEach(operation => operation.status = 'confirmed');
        await persist();
      } });
      entry.imported = { ...imported, key }; entry.status = 'complete'; entry.operations.forEach(operation => operation.status = 'confirmed'); await persist();
    } catch (error) { const state = getAssetImportFailure(error); if (state&&(!recovering||previousWriteStarted===false||provenBefore||state.remoteWriteStarted)) entry.remoteWriteStarted = state.remoteWriteStarted; else if(recovering&&previousWriteStarted!==false)entry.remoteWriteStarted=previousWriteStarted; entry.status = entry.remoteWriteStarted === false ? 'retryable' : 'unknown'; entry.operations.filter(operation => operation.status === 'intent').forEach(operation => operation.status = 'write-unknown'); await persist(); throw error; }
  }
  await verify(); await writeJson(path.join(options.runDir, 'assets', 'imported.json'), complete()); return complete();
}

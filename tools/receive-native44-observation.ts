import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { validateObservationPacketV2, observationCountsV2, type ObservationManifestV2 } from '../src/replica-v2/observation.js';
import { ensureDiskSpaceV2 } from '../src/replica-v2/journal.js';
import { validateSceneInventoryV2 } from '../src/replica-v2/scene-inventory.js';
const project = 'D:/cloneWP', taskId = process.argv[2], options = process.argv.slice(3);
if (!taskId || !/^[a-zA-Z][a-zA-Z0-9_-]{1,90}$/.test(taskId)) throw Error('A bounded current task ID is required');
let port = 0, requestedStartedAt: string | undefined, revision: 'final' | undefined;
for (let index = 0; index < options.length; index++) {
  if (options[index] === '--port') { port = Number(options[++index]); if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('A valid --port is required'); }
  else if (options[index] === '--collection-started-at') { requestedStartedAt = options[++index]; if (!requestedStartedAt || !Number.isFinite(Date.parse(requestedStartedAt))) throw Error('An ISO --collection-started-at is required'); requestedStartedAt = new Date(requestedStartedAt).toISOString(); }
  else if (options[index] === '--revision') { if (options[++index] !== 'final') throw Error('Only the explicit current-task final observation revision is supported'); revision = 'final'; }
  else throw Error(`Unknown option: ${options[index]}`);
}
const directory = path.join(project, 'references', `${taskId}${revision ? `-${revision}` : ''}-observation`);
await ensureDiskSpaceV2(project); await mkdir(directory, { recursive: true });
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const escape = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function previousJson(name: string): Promise<any | undefined> { try { return JSON.parse(await readFile(path.join(directory, name), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }
const previousCollection = await previousJson('collection.json');
if (previousCollection && (previousCollection.taskId !== taskId || previousCollection.sourceUrl !== 'https://www.petsupermarket.com/' || !Number.isFinite(Date.parse(previousCollection.collectionStartedAt)))) throw Error('Existing collection identity is invalid');
if (previousCollection && requestedStartedAt && previousCollection.collectionStartedAt !== requestedStartedAt) throw Error('Requested collection start differs from the existing current-task collection');
const collectedAt = previousCollection?.collectionStartedAt ?? requestedStartedAt ?? new Date().toISOString();
let manifest: ObservationManifestV2 = await previousJson('observation-manifest.json') ?? { version: 2, kind: 'observation-manifest', sourceUrl: 'https://www.petsupermarket.com/', provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [], sceneInventories: [] };
if (manifest.version !== 2 || manifest.kind !== 'observation-manifest' || manifest.sourceUrl !== 'https://www.petsupermarket.com/' || !Array.isArray(manifest.packets) || !Array.isArray(manifest.screenshots) || manifest.sceneInventories !== undefined && !Array.isArray(manifest.sceneInventories)) throw Error('Existing manifest is invalid');
for (const ref of [...manifest.packets, ...manifest.screenshots, ...manifest.sceneInventories ?? []]) {
  const file = path.resolve(directory, ref.path), relative = path.relative(directory, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || hash(await readFile(file)) !== ref.sha256) throw Error('Existing manifest evidence failed path/hash validation');
}
await writeFile(path.join(directory,'collection.json'),JSON.stringify({taskId,...revision ? {revision} : {},collectionStartedAt:collectedAt,sourceUrl:manifest.sourceUrl,directory},null,2)+'\n');
interface Transfer { snapshotId: string; totalParts: number; encoding: 'json' | 'gzip-base64' | 'lzw16-base64'; parts: Map<number, string>; bytes: number }
const transfers = new Map<string, Transfer>();
let queuedSave: Promise<void> = Promise.resolve();
const snapshotAllowed = (value: unknown): value is string => typeof value === 'string' && /^(?:desktop|narrow|tablet|mobile)-current$/.test(value);
/** Transport-only LZW: initial bytes 0..255, clear 256, next 257; little-endian Uint16 codes. */
function decodeLzw16(bytes: Buffer): Buffer {
  if (!bytes.length || bytes.length % 2) throw Error('LZW transport requires complete little-endian Uint16 codes');
  const initial = Array.from({length:256},(_,code)=>Buffer.from([code]));
  let dictionary = [...initial], next = 257, previous: Buffer | undefined, outputBytes = 0;
  const output: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const code = bytes.readUInt16LE(offset);
    if (code === 256) { dictionary = [...initial]; next = 257; previous = undefined; continue; }
    let entry = dictionary[code];
    if (!entry && code === next && next < 65535 && previous) entry = Buffer.concat([previous, previous.subarray(0,1)]);
    if (!entry) throw Error(`Unknown LZW transport code ${code}`);
    outputBytes += entry.length; if (outputBytes > 65_000_000) throw Error('Decompressed observation transfer exceeded bound');
    output.push(entry);
    if (previous && next < 65535) dictionary[next++] = Buffer.concat([previous, entry.subarray(0,1)]);
    previous = entry;
  }
  return Buffer.concat(output, outputBytes);
}
async function saveObservation(body: any): Promise<string> {
    if (body.taskId !== taskId || !snapshotAllowed(body.snapshotId)) throw Error('Unknown snapshot');
    if (manifest.screenshots.some(item=>item.snapshotId===body.snapshotId)) return body.snapshotId;
    if (typeof body.screenshotBase64 !== 'string' || typeof body.transportJson !== 'string') throw Error('Complete screenshot and serialized transport required');
    if (typeof body.renderEvidence === 'string') body.renderEvidence = JSON.parse(body.renderEvidence);
    else if (Array.isArray(body.renderEvidence) && body.renderEvidence.every((part: unknown)=>typeof part==='string')) body.renderEvidence = JSON.parse(body.renderEvidence.join(''));
    if (revision === 'final' && (!body.renderEvidence || typeof body.renderEvidence !== 'object' || Array.isArray(body.renderEvidence) || body.renderEvidence.taskId !== taskId || body.renderEvidence.snapshotId !== body.snapshotId || body.renderEvidence.sourceUrl !== manifest.sourceUrl || !Number.isFinite(Date.parse(body.renderEvidence.capturedAt)) || body.renderEvidence.capturedAt < collectedAt)) throw Error('Final snapshot requires corresponding current-task source render evidence from the same capture batch');
    const bytes = Buffer.from(body.screenshotBase64, 'base64'), metadata = await sharp(bytes, {limitInputPixels:120_000_000}).metadata();
    if (metadata.format !== 'jpeg' || bytes.length > 30_000_000 || !metadata.width || !metadata.height) throw Error('Actual JPEG bytes required');
    const screenshot = { path: `${body.snapshotId}.jpg`, sha256: hash(bytes), width: metadata.width, height: metadata.height };
    const transport = JSON.parse(body.transportJson), snapshotPackets = [];
    if (!Array.isArray(transport.chunks) || !transport.chunks.length) throw Error('Nonempty serialized observation chunks required');
    for (const chunk of transport.chunks) {
      const packet = JSON.parse(chunk.json); packet.snapshot.screenshot = screenshot;
      if (packet.snapshot.id !== body.snapshotId || packet.snapshot.url !== manifest.sourceUrl || packet.snapshot.capturedAt < collectedAt) throw Error('Capture identity/time mismatch');
      snapshotPackets.push(validateObservationPacketV2(packet));
    }
    const inventory = validateSceneInventoryV2(transport.sceneInventory);
    if (inventory.snapshotId !== body.snapshotId) throw Error('Inventory identity mismatch');
    const next: ObservationManifestV2 = { ...manifest, packets: [...manifest.packets], screenshots: [...manifest.screenshots], sceneInventories: [...manifest.sceneInventories ?? []] };
    await writeFile(path.join(directory,screenshot.path), bytes);
    for (const packet of snapshotPackets) { const name=`${body.snapshotId}-${packet.regions[0].id}.json`, json=JSON.stringify(packet)+'\n'; await writeFile(path.join(directory,name),json); next.packets.push({path:name,sha256:hash(json),snapshotId:body.snapshotId,regionIds:packet.regions.map(region=>region.id),counts:observationCountsV2(packet),dependencies:[]}); }
    const inventoryName=`${body.snapshotId}-scene.json`, inventoryJson=JSON.stringify(inventory)+'\n'; await writeFile(path.join(directory,inventoryName),inventoryJson); next.sceneInventories!.push({path:inventoryName,sha256:hash(inventoryJson),snapshotId:body.snapshotId});
    next.screenshots.push({path:screenshot.path,sha256:screenshot.sha256,snapshotId:body.snapshotId});
    if (body.renderEvidence) { body.renderEvidence.screenshotHash=screenshot.sha256; await writeFile(path.join(directory,`${body.snapshotId}-render.json`),JSON.stringify(body.renderEvidence)+'\n'); }
    await writeFile(path.join(directory,'observation-manifest.json'),JSON.stringify(next,null,2)+'\n');
    manifest = next;
    return body.snapshotId;
}
const server = createServer(async (request, response) => {
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  if (request.method === 'GET' && request.url?.startsWith('/')) {
    const collector = await readFile(path.join(project,'src/replica-v2/collect.browser.js'),'utf8');
    const renderStart = collector.indexOf('async function collectSourceRenderEvidenceV2('), renderEnd = collector.indexOf('/** Independent whole-body denominator',renderStart);
    const renderSource = renderStart >= 0 ? collector.slice(renderStart,renderEnd > renderStart ? renderEnd : undefined) : '';
    const query = new URL(request.url,origin).searchParams;
    const status = query.has('saved') ? `Saved ${query.get('saved')}` : query.has('received') ? `Received ${query.get('received')}` : `Ready; saved snapshots ${manifest.screenshots.length}`;
    response.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(`<title>Local observation handoff</title><h1>Local observation handoff</h1><p id="status">${escape(status)}</p><pre id="collector-source" hidden>${escape(collector)}</pre><pre id="source-render" hidden>${escape(renderSource)}</pre><form method="post" action="/save"><label for="payload">Observation payload</label><textarea id="payload" name="payload"></textarea><button type="submit">Save observation</button></form>`); return;
  }
  if (request.method !== 'POST' || request.url !== '/save' || request.headers.origin !== origin) { response.writeHead(403).end(); return; }
  try {
    await ensureDiskSpaceV2(project); let size = 0; const chunks: Buffer[]=[];
    for await (const chunk of request) { size += chunk.length; if (size > 65_000_000) throw Error('Observation transfer exceeded bound'); chunks.push(chunk); }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8')), body = JSON.parse(form.get('payload') ?? '{}');
    if (body.taskId !== taskId || !snapshotAllowed(body.snapshotId)) throw Error('Unknown task/snapshot');
    if (Object.hasOwn(body, 'content')) {
      if (typeof body.transferId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.transferId) || !Number.isInteger(body.partIndex) || !Number.isInteger(body.totalParts) || body.totalParts < 1 || body.totalParts > 1024 || body.partIndex < 0 || body.partIndex >= body.totalParts || typeof body.content !== 'string' || Buffer.byteLength(body.content) > 300_000 || !['json', 'gzip-base64', 'lzw16-base64'].includes(body.encoding)) throw Error('Invalid bounded transfer part (encoding json/gzip-base64/lzw16-base64 required, zero-based partIndex, <=300000 UTF-8 bytes)');
      if (manifest.screenshots.some(item=>item.snapshotId===body.snapshotId)) { response.writeHead(303,{location:`/?saved=${body.snapshotId}`}).end(); return; }
      let transfer = transfers.get(body.transferId);
      if (!transfer) { if (transfers.size >= 8) throw Error('Too many active current-task transfers'); transfer = { snapshotId: body.snapshotId, totalParts: body.totalParts, encoding: body.encoding, parts: new Map(), bytes: 0 }; transfers.set(body.transferId, transfer); }
      if (transfer.snapshotId !== body.snapshotId || transfer.totalParts !== body.totalParts || transfer.encoding !== body.encoding) throw Error('Transfer identity/encoding changed');
      const previous = transfer.parts.get(body.partIndex);
      if (previous !== undefined && previous !== body.content) throw Error('Conflicting duplicate transfer part');
      if (previous === undefined) {
        const bytes = Buffer.byteLength(body.content); if (transfer.bytes + bytes > 65_000_000) throw Error('Joined observation transfer exceeded bound');
        transfer.parts.set(body.partIndex, body.content); transfer.bytes += bytes;
      }
      if (transfer.parts.size < transfer.totalParts) { response.writeHead(303,{location:`/?received=${transfer.parts.size}/${transfer.totalParts}`}).end(); return; }
      const joined = Array.from({length:transfer.totalParts},(_,index)=>transfer!.parts.get(index)!).join('');
      let payload = joined;
      if (transfer.encoding === 'gzip-base64' || transfer.encoding === 'lzw16-base64') {
        if (!joined.length || joined.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(joined)) throw Error('Invalid canonical compressed base64 transport');
        const encoded = Buffer.from(joined, 'base64');
        const decoded = transfer.encoding === 'gzip-base64' ? gunzipSync(encoded, { maxOutputLength: 65_000_000 }) : decodeLzw16(encoded);
        if (decoded.byteLength > 65_000_000) throw Error('Decompressed observation transfer exceeded bound');
        payload = new TextDecoder('utf-8', {fatal:true}).decode(decoded);
      }
      if (Buffer.byteLength(payload) > 65_000_000) throw Error('Decoded observation transfer exceeded bound');
      const complete = JSON.parse(payload);
      if (complete.taskId !== taskId || complete.snapshotId !== transfer.snapshotId) throw Error('Joined payload identity mismatch');
      const saved = queuedSave.then(()=>saveObservation(complete)); queuedSave = saved.then(()=>undefined,()=>undefined);
      const snapshotId = await saved; transfers.delete(body.transferId);
      response.writeHead(303,{location:`/?saved=${snapshotId}`}).end(); return;
    }
    const saved = queuedSave.then(()=>saveObservation(body)); queuedSave = saved.then(()=>undefined,()=>undefined);
    response.writeHead(303,{location:`/?saved=${await saved}`}).end();
  } catch(error) { response.writeHead(400,{'content-type':'text/plain'}).end(error instanceof Error ? error.message : 'Invalid observation'); }
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port:(server.address() as {port:number}).port,taskId,...revision ? {revision} : {},directory,collectionStartedAt:collectedAt,savedSnapshots:manifest.screenshots.length,partIndexBase:0,maxPartBytes:300000,encodings:['json','gzip-base64','lzw16-base64'],maxDecodedBytes:65000000})));

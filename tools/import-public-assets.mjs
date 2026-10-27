import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const jobDir = path.resolve(process.argv[2] ?? '');
const bundlePath = path.resolve(process.argv[3] ?? '');
if (!jobDir.toLowerCase().startsWith('d:\\clonewp\\references\\')) throw new Error('Current reference job required');
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
const sourceDir = path.join(jobDir, 'source-assets');
await mkdir(sourceDir, { recursive: true });
const assets = [], supplemental = [];
for (const entry of bundle.assets ?? []) {
  if (typeof entry.url !== 'string' || !entry.url.startsWith('https://www.petsupermarket.com/')) throw new Error('Unexpected source asset URL');
  const extension = path.extname(entry.path).toLowerCase();
  const localPath = path.join(sourceDir, `${entry.id}${extension}`);
  await copyFile(entry.path, localPath);
  const bytes = await readFile(localPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const record = { key: `asset-${entry.id}`, sourceUrl: entry.url, localPath, sha256, alt: '', mediaType: entry.contentType, provenance: `Connected public browser pageAssets bundle ${bundlePath}` };
  if (['image/png', 'image/jpeg', 'image/webp'].includes(entry.contentType)) assets.push(record);
  else supplemental.push(record);
}
await writeFile(path.join(jobDir, 'asset-manifest.json'), JSON.stringify({ version: 1, sourceUrl: 'https://www.petsupermarket.com/', downloadedAt: new Date().toISOString(), assets }, null, 2));
await writeFile(path.join(jobDir, 'supplemental-asset-evidence.json'), JSON.stringify({ sourceUrl: 'https://www.petsupermarket.com/', assets: supplemental }, null, 2));
console.log(JSON.stringify({ copied: assets.length + supplemental.length, nativeMediaCandidates: assets.length, svgEvidence: supplemental.length }));

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const job = path.resolve(process.argv[2] ?? '');
if (!job.toLowerCase().startsWith('d:\\clonewp\\references\\')) throw new Error('Current reference job required');
const manifestPath = path.join(job, 'asset-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const supplement = JSON.parse(await readFile(path.join(job, 'supplemental-asset-evidence.json'), 'utf8'));
let created = 0;
for (const source of supplement.assets ?? []) {
  if (source.mediaType !== 'image/svg+xml') continue;
  const svg = await readFile(source.localPath);
  if (createHash('sha256').update(svg).digest('hex') !== source.sha256) throw new Error('Original SVG source bytes changed');
  const output = path.join(job, 'source-assets', `${source.key}.png`);
  const png = await sharp(svg, { density: 192 }).png().toBuffer();
  await writeFile(output, png);
  const key = `${source.key}-raster`;
  manifest.assets = manifest.assets.filter(asset => asset.key !== key);
  manifest.assets.push({ key, sourceUrl: source.sourceUrl, localPath: output, sha256: createHash('sha256').update(png).digest('hex'), alt: '', mediaType: 'image/png', provenance: `Derived raster from current-job public SVG ${source.localPath}; original source SHA-256 ${source.sha256}` });
  created++;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ derived: created, sourceBytesPreserved: true, manifestAssets: manifest.assets.length }));

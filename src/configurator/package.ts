import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';

/** Build reviewable extension files. This never installs a plugin, edits a site, or enables a catalog identity. */
export async function buildConfiguratorPackage(directory: string, root = 'D:/cloneWP') {
  const resolvedRoot = await realpath(root), target = path.resolve(directory), relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('configurator_package_outside_workspace');
  // Reject every existing ancestor reparse point, including the output folder itself.
  let ancestor = target;
  while (ancestor !== path.dirname(ancestor)) {
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw Error('configurator_package_reparse_point'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (ancestor === resolvedRoot) break; ancestor = path.dirname(ancestor);
  }
  await mkdir(target, { recursive: true });
  const bundled = await build({ entryPoints: [path.join(root, 'src/configurator/runtime.ts')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', minify: true });
  const files = [{ name: 'runtime.js', bytes: bundled.outputFiles[0].contents },
    { name: 'style.css', bytes: await readFile(path.join(root, 'src/configurator/style.css')) },
    { name: 'clonewp-bottle-configurator.php', bytes: await readFile(path.join(root, 'src/configurator/widget.php')) }];
  const manifest = { version: 1, kind: 'clonewp-configurator-package', widgetType: 'clonewp_bottle_configurator', status: 'local-development-not-qualified',
    deployment: 'requires-explicit-plugin-install-authorization', files: files.map(f => ({ path: f.name, sha256: createHash('sha256').update(f.bytes).digest('hex'), bytes: f.bytes.length })) };
  for (const file of files) await writeFile(path.join(target, file.name), file.bytes, { flag: 'wx' });
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}

import path from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { readCurrentRelease } from '../../src/components/registry.js';

/** Isolated release fixtures copy only immutable writer contracts and shared
 * knowledge, not a site configuration, credential or a historical task. */
export async function copySystemReleaseFixture(root: string): Promise<void> {
  const project = path.resolve(import.meta.dirname, '../..'), release = await readCurrentRelease(project);
  const index = JSON.parse(await readFile(path.join(project, release.knowledge.index.path), 'utf8'));
  const names = new Set([release.componentSet.catalog.path, release.knowledge.index.path, `data/native44/${index.sharedControls.path}`, ...release.selectionRules.files.map(ref => ref.path), ...release.adapters.files.map(ref => ref.path)]);
  for (const name of names) { const destination = path.join(root, name); await mkdir(path.dirname(destination), { recursive: true }); await copyFile(path.join(project, name), destination); }
}

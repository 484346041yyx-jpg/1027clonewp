import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DraftSnapshot } from '../../wordpress/types.js';
import { documentHashV2 } from '../../replica-v2/journal.js';
import { carouselPlaybackBrowserSource, type CarouselPlaybackBinding } from './carousel-playback.js';

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
export interface CarouselPlaybackOptIn {
  version: 1; kind: 'clonewp-carousel-playback-opt-in'; pageId: number; runId: string;
  documentHash: string; canonicalDocumentJSON: string; runtimeSha256: string;
  bindings: CarouselPlaybackBinding[];
}

/** Local intent data only. Does not load credentials or write WordPress meta.
 * The eventual protected deployment adapter must compare a fresh owned draft,
 * persist intent, update only this meta key and read it back before use. */
export function prepareCarouselPlaybackOptIn(snapshot: DraftSnapshot, bindings: CarouselPlaybackBinding[], runtimeSha256 = sha256(carouselPlaybackBrowserSource())): CarouselPlaybackOptIn {
  if (snapshot.status !== 'draft' || !Number.isSafeInteger(snapshot.pageId) || snapshot.pageId < 1 || !/^[a-zA-Z0-9_-]{4,100}$/.test(snapshot.runId) || documentHashV2(snapshot.elements, snapshot.settings) !== snapshot.hash || !/^[a-f0-9]{64}$/.test(runtimeSha256)) throw Error('playback_opt_in_snapshot_invalid');
  const nodes = new Map<string, DraftSnapshot['elements'][number]>();
  const walk = (items: DraftSnapshot['elements'], depth = 0) => { if (depth > 16) throw Error('playback_opt_in_tree_invalid'); for (const node of items) { if (nodes.has(node.id) || nodes.size >= 2500) throw Error('playback_opt_in_tree_invalid'); nodes.set(node.id, node); walk(node.elements ?? [], depth + 1); } }; walk(snapshot.elements);
  const owners = new Set<string>(), buttons = new Set<string>(), keys = new Set<string>();
  if (!bindings.length || bindings.length > 16) throw Error('playback_opt_in_bindings_invalid');
  for (const binding of bindings) {
    const owner = nodes.get(binding.ownerId), button = nodes.get(binding.buttonId);
    if (
      Object.keys(binding).sort().join(',') !== ['key', 'pageId', 'ownerId', 'buttonId', 'widgetType', 'initialState', 'playLabel', 'pauseLabel'].sort().join(',') ||
      binding.pageId !== snapshot.pageId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(binding.key) ||
      !/^[a-f0-9]{7}$/.test(binding.ownerId) || !/^[a-f0-9]{7}$/.test(binding.buttonId) || binding.ownerId === binding.buttonId ||
      binding.widgetType !== 'nested-carousel' || owner?.widgetType !== 'nested-carousel' || !['button', 'wd_button'].includes(button?.widgetType ?? '') ||
      !['paused', 'playing'].includes(binding.initialState) || owners.has(binding.ownerId) || buttons.has(binding.buttonId) || keys.has(binding.key) ||
      [binding.playLabel, binding.pauseLabel].some(label => typeof label !== 'string' || !label.trim() || label.length > 160 || /[<>\u0000-\u001f]/.test(label))
    ) throw Error('playback_opt_in_bindings_invalid');
    const link = (button!.settings.link as { url?: unknown } | undefined)?.url ?? '';
    if (link !== '' && link !== '#') throw Error('playback_opt_in_business_button');
    owners.add(binding.ownerId); buttons.add(binding.buttonId); keys.add(binding.key);
  }
  const canonicalDocumentJSON = JSON.stringify(canonical({ elements: snapshot.elements, settings: snapshot.settings }));
  if (sha256(canonicalDocumentJSON) !== snapshot.hash || Buffer.byteLength(canonicalDocumentJSON) > 8 * 1024 * 1024) throw Error('playback_opt_in_canonical_hash_invalid');
  return { version: 1, kind: 'clonewp-carousel-playback-opt-in', pageId: snapshot.pageId, runId: snapshot.runId, documentHash: snapshot.hash, canonicalDocumentJSON, runtimeSha256, bindings: structuredClone(bindings) };
}

/** Prepare an immutable local review folder. No package installation or remote
 * API is implemented here. Refuse existing output rather than replace a review. */
export async function prepareCarouselPlaybackPluginPackage(root: string, outputDirectory: string) {
  const rootReal = await realpath(root), target = path.resolve(rootReal, outputDirectory), relative = path.relative(rootReal, target);
  if (!/^(?:reports|artifacts|\.cache)[\\/]/.test(relative) || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('playback_package_output_invalid');
  const parent = path.dirname(target); await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent); if (path.relative(rootReal, parentReal).startsWith('..') || path.isAbsolute(path.relative(rootReal, parentReal))) throw Error('playback_package_output_escape');
  await mkdir(target);
  const runtime = carouselPlaybackBrowserSource(), runtimeHash = sha256(runtime);
  const template = await readFile(path.join(rootReal, 'src/native44/behaviors/wordpress/clonewp-carousel-playback.php'), 'utf8');
  const php = template.replace('__CLONEWP_FIXED_RUNTIME_SHA256__', runtimeHash);
  if (php.includes('__CLONEWP_FIXED_RUNTIME_SHA256__') || !php.includes(runtimeHash)) throw Error('playback_package_template_invalid');
  const readme = `# cloneWP Draft Carousel Playback\n\nPrepared review source. Not installed, activated, or enabled on any site.\n\nThis optional plugin runs only for an authenticated editor previewing an explicitly opted-in owned draft page. It verifies page ID, unique run ownership, document canonical SHA and actual tree equality, and this package's fixed runtime SHA. No settings page, REST write route, arbitrary script/URL field, installer, or opt-in writer is provided.\n\nThe source widget remains nested-carousel; the control is an existing native button widget. The page-level opt-in manifest is bound to the current document. Any document edit invalidates it. Published pages and anonymous visitors are excluded.\n\nInstallation/activation and the protected opt-in metadata adapter require separate authorization and validation. This local package is not proof that playback works on the configured WordPress site. The automated browser evidence uses an explicitly named timer fixture.\n`;
  const files = [
    { path: 'clonewp-carousel-playback.php', contents: php },
    { path: 'carousel-playback.js', contents: runtime },
    { path: 'README.md', contents: readme },
  ];
  for (const file of files) await writeFile(path.join(target, file.path), file.contents, { flag: 'wx' });
  const manifest = { version: 1, kind: 'clonewp-playback-plugin-review-package', status: 'prepared-not-deployed', installationAuthorized: false, runtimeSha256: runtimeHash, files: files.map(file => ({ path: file.path, sha256: sha256(file.contents), bytes: Buffer.byteLength(file.contents) })), validationLimit: 'Local timer fixture; WordPress/PHP execution and installed-site Swiper integration remain unverified.' };
  await writeFile(path.join(target, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory: target, manifest };
}

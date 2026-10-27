import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';
import type { CarouselPlaybackBinding } from '../src/native44/behaviors/carousel-playback.js';
import { prepareCarouselPlaybackOptIn, prepareCarouselPlaybackPluginPackage } from '../src/native44/behaviors/playback-package.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const binding: CarouselPlaybackBinding = { key: 'campaign-playback', pageId: 77, ownerId: 'aaaaaaa', buttonId: 'bbbbbbb', widgetType: 'nested-carousel', initialState: 'paused', playLabel: 'Play carousel', pauseLabel: 'Pause carousel' };
function snapshot(): DraftSnapshot {
  const current: DraftSnapshot = { pageId: 77, runId: 'owned-generic-fixture', title: 'Fixture', status: 'draft', elements: [
    { id: 'aaaaaaa', elType: 'widget', widgetType: 'nested-carousel', settings: { autoplay: 'yes', autoplay_speed: 5000 }, elements: [] },
    { id: 'bbbbbbb', elType: 'widget', widgetType: 'button', settings: { text: 'Play carousel', link: { url: '#' } }, elements: [] },
  ], settings: { tiny: 1e-7, negativeZero: -0, large: 1e21, decimal: 0.125, emptyArray: [], emptyObject: {}, text: '中文 / "quotes" \u2028 <tag>' }, hash: '' };
  current.hash = documentHashV2(current.elements, current.settings); return current;
}

test('local playback opt-in binds existing writer canonical document bytes and refuses foreign, stale, business or ambiguous data', () => {
  const current = snapshot(), prepared = prepareCarouselPlaybackOptIn(current, [binding]);
  assert.equal(digest(prepared.canonicalDocumentJSON), current.hash);
  assert.deepEqual(JSON.parse(prepared.canonicalDocumentJSON), JSON.parse(JSON.stringify({ elements: current.elements, settings: current.settings })));
  assert.equal(prepared.kind, 'clonewp-carousel-playback-opt-in');
  assert.throws(() => prepareCarouselPlaybackOptIn({ ...current, status: 'publish' } as unknown as DraftSnapshot, [binding]), /snapshot_invalid/);
  assert.throws(() => prepareCarouselPlaybackOptIn({ ...current, settings: {} }, [binding]), /snapshot_invalid/);
  assert.throws(() => prepareCarouselPlaybackOptIn(current, [{ ...binding, pageId: 88 }]), /bindings_invalid/);
  assert.throws(() => prepareCarouselPlaybackOptIn(current, [binding, { ...binding, key: 'duplicate' }]), /bindings_invalid/);
  assert.throws(() => prepareCarouselPlaybackOptIn(current, [{ ...binding, arbitraryURL: 'https://example.invalid/script.js' } as CarouselPlaybackBinding]), /bindings_invalid/);
  const business = structuredClone(current); business.elements[1].settings.link = { url: '/checkout/' }; business.hash = documentHashV2(business.elements, business.settings);
  assert.throws(() => prepareCarouselPlaybackOptIn(business, [binding]), /business_button/);
  const duplicate = structuredClone(current); duplicate.elements.push(structuredClone(duplicate.elements[0])); duplicate.hash = documentHashV2(duplicate.elements, duplicate.settings);
  assert.throws(() => prepareCarouselPlaybackOptIn(duplicate, [binding]), /tree_invalid/);
});

test('local review package has hash-bound fixed assets, preserves existing packages and refuses output escape', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const temporary = await mkdtemp(path.join(root, '.cache/playback-package-test-'));
  assert.ok(temporary.startsWith(path.join(root, '.cache') + path.sep));
  try {
    const result = await prepareCarouselPlaybackPluginPackage(root, path.join(temporary, 'review-package'));
    assert.equal(result.manifest.status, 'prepared-not-deployed');
    assert.equal(result.manifest.installationAuthorized, false);
    for (const file of result.manifest.files) {
      const bytes = await readFile(path.join(result.directory, file.path));
      assert.equal(digest(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
    }
    const php = await readFile(path.join(result.directory, 'clonewp-carousel-playback.php'), 'utf8');
    assert.ok(php.includes(result.manifest.runtimeSha256));
    assert.ok(!php.includes('__CLONEWP_FIXED_RUNTIME_SHA256__'));
    const manifestBefore = await readFile(path.join(result.directory, 'package-manifest.json'));
    await assert.rejects(prepareCarouselPlaybackPluginPackage(root, result.directory), /EEXIST/);
    assert.deepEqual(await readFile(path.join(result.directory, 'package-manifest.json')), manifestBefore);
    await assert.rejects(prepareCarouselPlaybackPluginPackage(root, path.join(root, '..', 'foreign-playback-package')), /output_invalid/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('optional PHP execution checks the shared canonical JSON numeric, Unicode, empty-type and array-order fixtures', t => {
  const available = spawnSync('php', ['-v'], { encoding: 'utf8', windowsHide: true });
  if (available.error || available.status !== 0) { t.skip('PHP CLI unavailable: WordPress/PHP execution remains unverified; local browser tests use a timer fixture.'); return; }
  const prepared = prepareCarouselPlaybackOptIn(snapshot(), [binding]);
  const actual = JSON.parse(prepared.canonicalDocumentJSON); delete actual.settings.large;
  // PHP deliberately excludes unsafe JSON integers. Large JS numbers are not
  // silently rounded into a matching document. The other forms must compare.
  const supported = { ...JSON.parse(prepared.canonicalDocumentJSON) }; delete supported.settings.large;
  const fixtureJSON = JSON.stringify({ supported: JSON.stringify(supported), actual: JSON.stringify(actual), full: prepared.canonicalDocumentJSON });
  const plugin = path.join(root, 'src/native44/behaviors/wordpress/clonewp-carousel-playback.php');
  const script = `define('ABSPATH', __DIR__); function add_action(...$args) {} require ${JSON.stringify(plugin.replace(/\\/g, '/'))}; $fixture=json_decode(stream_get_contents(STDIN)); $a=json_decode($fixture->actual); $b=json_decode($fixture->supported); $full=json_decode($fixture->full); $same='CloneWP_Draft_Carousel_Playback_V1'; $changed=clone $b; $changed->settings=clone $b->settings; $changed->settings->tiny=0.1; echo json_encode([$same::same_json($a,$b),$same::same_json($a,$changed),$same::same_json((object)[],[]),$same::same_json([1,2],[2,1]),$same::same_json($full,$full)]);`;
  const execution = spawnSync('php', ['-r', script], { encoding: 'utf8', input: fixtureJSON, windowsHide: true });
  assert.equal(execution.status, 0, execution.stderr); assert.deepEqual(JSON.parse(execution.stdout), [true, false, false, false, false]);
});

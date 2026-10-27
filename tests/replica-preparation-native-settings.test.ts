import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationIOFixture } from './helpers/preparation-io-fixture.js';
import { initializePreparation, readPreparationNativeSettings } from '../src/replica-preparation/io.js';
import { parsePreparationArgs, runPreparationCLI } from '../src/replica-preparation/cli.js';

test('native settings reader uses the existing local preparation entry with a specific enabled type', async () => {
  assert.deepEqual(parsePreparationArgs(['read-native-settings', '--directory', 'prepared', '--widget', 'heading']), { command: 'read-native-settings', directory: 'prepared', widget: 'heading' });
  for (const args of [
    ['read-native-settings', '--directory', 'prepared'],
    ['read-native-settings', '--directory', 'prepared', '--widget', 'invented-widget'],
    ['read-native-settings', '--directory', 'prepared', '--widget', 'heading', '--publish', 'true'],
    ['status', '--directory', 'prepared', '--widget', 'heading'],
  ]) assert.throws(() => parsePreparationArgs(args), /replica_preparation_arguments/);
  const help = await runPreparationCLI(['--help']) as { help: string; remoteWrites: number };
  assert.match(help.help, /read-native-settings/);
  assert.equal(help.remoteWrites, 0);
});

test('explicit historical preparation does not gain a settings catalog or migrate when read', async () => {
  const fixture = await preparationIOFixture();
  try {
    const initial = await initializePreparation(fixture.plan, { finalRunDirectory: fixture.finalRunDirectory });
    assert.equal('nativeSettingsCapabilities' in initial, false);
    const state = await fixture.readState();
    await assert.rejects(() => readPreparationNativeSettings(fixture.preparationDirectory, 'heading'), /native_settings_capabilities_version/);
    assert.deepEqual(await fixture.readState(), state);
    const repeated = await initializePreparation(fixture.plan, { finalRunDirectory: fixture.finalRunDirectory });
    assert.equal('nativeSettingsCapabilities' in repeated, false);
    assert.deepEqual(await fixture.readState(), state);
  } finally { await fixture.cleanup(); }
});

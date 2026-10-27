import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNativeHeaderFailure } from '../src/replica-full/native-diagnostics.js';
import { WordPressHeaderModuleDriver, type HeaderModuleIdentity } from '../src/woodmart-header/generic/wordpress.js';

const identity: HeaderModuleIdentity = { moduleKey: 'alder', owner: { ownerId: 'clonewp', runId: 'alder-run' }, targetOrigin: 'https://target.example', headerId: 'header_123' };
const operationId = 'native-bind-123', digest = 'a'.repeat(64), request = { action: 'bind' as const, operationId, expectedHash: digest, payload: { pageId: 111, expectedBodyHash: digest } }, intent = { operationId, runId: identity.owner.runId, resource: 'header-module/alder', expectedSnapshotSha256: digest, persistedIntentSha256: digest };

test('new native diagnostics retains the real fixed server rejection code without changing or retrying the old driver', async () => {
  let calls = 0;
  const driver = new WordPressHeaderModuleDriver({ origin: identity.targetOrigin, async readPHP() { throw Error('No read expected'); }, async executePHP() { calls++; return { ok: false, code: 'page_binding_precondition_changed' } as any; } }), observed = captureNativeHeaderFailure(driver);
  assert.equal(observed.failure(), null);
  await assert.rejects(observed.driver.mutate(identity, request, intent), /woodmart_header_driver_page_binding_precondition_changed/);
  assert.deepEqual(observed.failure(), { code: 'woodmart_header_driver_page_binding_precondition_changed', action: 'bind', operationId }); assert.equal(calls, 1);
});

test('native diagnostics retains only allowlisted transport codes and discards raw messages and arbitrary codes', async () => {
  for (const [error, expected] of [[Object.assign(Error('Authorization: private-secret'), { code: 'php_operation_rejected' }), 'replica_full_native_header_php_operation_rejected'], [Object.assign(Error('https://example.test/?token=private-secret'), { code: 'private-secret' }), 'replica_full_native_header_mutation_unconfirmed']] as const) {
    let calls = 0; const observed = captureNativeHeaderFailure({ async inspect() { throw Error('No read expected'); }, async mutate() { calls++; throw error; } });
    await assert.rejects(observed.driver.mutate(identity, request, intent)); assert.equal(observed.failure()?.code, expected); assert.doesNotMatch(JSON.stringify(observed.failure()), /private-secret|Authorization/); assert.equal(calls, 1);
  }
});

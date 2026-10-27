import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetProductReadPHP } from '../src/wordpress/product.js';
import { parseTargetProductSnapshot } from '../src/wordpress/product-contract.js';
import { currentProductFixture } from './fixtures/current-product.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('actual generated PHP reads simple and variable product getters and refuses unpublished, protected and unsupported records', t => {
  const portable = path.join(root, '.cache/php-8.3/php.exe'), php = existsSync(portable) ? portable : 'php';
  const probe = spawnSync(php, ['-v'], { encoding: 'utf8', cwd: root, windowsHide: true });
  if (probe.error || probe.status !== 0) { t.skip('PHP unavailable; target WooCommerce verification remains required.'); return; }
  const execute = (snapshot: ReturnType<typeof currentProductFixture>, extra = {}) => {
    const result = spawnSync(php, [path.join(root, 'tests/fixtures/current-product.php')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000, input: JSON.stringify({ ...snapshot, ...extra, readCode: targetProductReadPHP(snapshot.product.id) }) });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return JSON.parse(result.stdout);
  };
  for (const variable of [false, true]) {
    const snapshot = currentProductFixture(undefined, variable), result = execute(snapshot);
    assert.deepEqual(result.product, snapshot.product);
    const actual = parseTargetProductSnapshot({ ...snapshot, ...result }, snapshot.targetOrigin, snapshot.product.id); assert.equal(actual.product.type, variable ? 'variable' : 'simple');
  }
  const shortage = currentProductFixture(); shortage.product.media = []; shortage.product.stock.quantity = null; shortage.product.price.current = '';
  assert.deepEqual(execute(shortage).product, shortage.product);
  const draft = currentProductFixture(); draft.product.status = 'draft' as any; assert.equal(execute(draft).error, 'target_product_not_public');
  assert.equal(execute(currentProductFixture(), { password: 'synthetic-only' }).error, 'target_product_not_public');
  const grouped = currentProductFixture(); grouped.product.type = 'grouped' as any; assert.equal(execute(grouped).error, 'target_product_type_not_supported');
  const variable = currentProductFixture(undefined, true); variable.product.variations[0].parentId = 99;
  assert.equal(execute(variable).error, 'target_product_variation_owner');
});

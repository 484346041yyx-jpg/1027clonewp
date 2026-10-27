import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertCreationTaskMode } from '../src/core/creation-mode.js';
import { native44KnowledgeIdentity } from '../src/native44/knowledge.js';
import { validateLocalNative44Input } from '../src/native44/runtime.js';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
test('a new task cannot borrow another project document as its source facts or omit its job marker', async () => {
  const taskId = `native44-isolation-${randomUUID()}`, directory = path.join(root, 'references', taskId);
  await mkdir(directory, { recursive: true });
  try {
    const identity = await native44KnowledgeIdentity(root), borrowed = path.join(root, 'README.md');
    const sourceFacts = { path: borrowed, sha256: createHash('sha256').update(await readFile(borrowed)).digest('hex') };
    const input = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId, title: 'Isolation test', sourceUrl: 'https://example.com/', ...identity, sourceFacts, componentPlan: sourceFacts, assetsManifest: sourceFacts, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks: [{ key: 'title', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Own content' } }] };
    const filename = path.join(directory, 'program.json'); await writeFile(filename, JSON.stringify(input));
    await assert.rejects(assertCreationTaskMode(root, filename, 'replica'), /job marker/);
    await writeFile(path.join(directory, 'job.json'), JSON.stringify({ workflow: input.workflow, mode: 'replica', taskId, url: input.sourceUrl, executionStrategy: input.executionStrategy, ...identity }));
    await assert.rejects(validateLocalNative44Input(filename, root), /escaped/);
  } finally {
    const relative = path.relative(root, directory); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});

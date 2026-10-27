import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(root, '.agents', 'skills', 'reference-elementor');

test('the reference skill directs executors to real registered project commands', async () => {
  const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const commands = [...skill.matchAll(/^npm run ([a-z][a-z0-9:-]*)\b/gm)].map(match => match[1]);
  assert.ok(commands.length > 0, 'The skill must provide an executable project entry');
  for (const command of commands) {
    assert.equal(typeof pkg.scripts[command], 'string', `The skill advertises an unregistered npm command: ${command}`);
    const entry = pkg.scripts[command].match(/(?:^|\s)(src\/[A-Za-z0-9_./-]+\.ts)(?:\s|$)/)?.[1];
    assert.ok(entry, `The documented command has no inspectable TypeScript entry: ${command}`);
    assert.equal((await stat(path.join(root, entry))).isFile(), true, `The entry file is missing: ${entry}`);
  }
});

test('the reference skill source-block and native-program contracts resolve in the current project', async () => {
  const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
  const references = [...skill.matchAll(/`((?:config|src)\/[A-Za-z0-9_./-]+)`/g)].map(match => match[1]);
  assert.ok(references.length > 0, 'The skill must identify the maintained block and program contracts');
  for (const maintained of ['src/replica-v2/types.ts', 'src/replica-v2/component-plan.ts', 'src/native44/types.ts', 'src/native44/validate.ts']) assert.ok(references.includes(maintained), `The skill must identify the maintained v2 and historical v1 contract: ${maintained}`);
  for (const reference of references) {
    const absolute = path.resolve(root, reference);
    assert.ok(!path.relative(root, absolute).startsWith('..'), 'Skill contracts must remain in this project');
    assert.equal((await stat(absolute)).isFile(), true, `The maintained contract is missing: ${reference}`);
  }
});

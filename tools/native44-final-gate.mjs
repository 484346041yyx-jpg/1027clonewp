import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'reports', 'native44'); await mkdir(output, { recursive: true });
try {
  await stat(path.join(output, 'final-gate.json'));
  const previous = path.join(output, 'previous-gates', new Date().toISOString().replace(/[:.]/g, '-')); await mkdir(previous, { recursive: true });
  for (const name of ['final-gate.json', 'source-manifest.json', 'frozen-tests.log', 'frozen-build.log', 'FINAL-GATE-20261016.md']) { try { await copyFile(path.join(output, name), path.join(previous, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const digest = value => createHash('sha256').update(value).digest('hex');
// These are task-specific page recipes. They remain reviewable and require
// their own type check; changing page content does not change platform code.
const excludedPageRecipeNames = ['tools/plan-pet-native44-20261016.ts', 'tools/pet-native44-native-controls-20261016.ts', 'tools/read-pet-native44-catalog-20261016.ts', 'tools/import-pet-native44-assets-20261016.ts'];
async function pageRecipeInventory() {
  return Promise.all(excludedPageRecipeNames.map(async name => { try { return { path: path.join(root, name), sha256: digest(await readFile(path.join(root, name))) }; } catch (error) { if (error.code !== 'ENOENT') throw error; return { path: path.join(root, name), missing: true }; } }));
}
async function inventory() {
  const files = [];
  async function scan(name) { for (const entry of await readdir(path.join(root, name), { withFileTypes: true })) { const child = `${name}/${entry.name}`; if (entry.isDirectory()) await scan(child); else if (entry.isFile()) files.push(child); } }
  for (const directory of ['src', 'tests', 'tools', '.agents/skills', 'data/native44']) await scan(directory);
  files.push('AGENTS.md', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'config/native44-component-set.json');
  return Promise.all(files.filter(name => !excludedPageRecipeNames.includes(name)).sort().map(async name => ({ path: name, sha256: digest(await readFile(path.join(root, name))) })));
}
async function run(args, filename) {
  const started = performance.now(), stream = createWriteStream(path.join(output, filename));
  const command = `npm ${args.join(' ')}`;
  const exitCode = await new Promise((resolve, reject) => { const child = process.platform === 'win32' ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: root, env: { ...process.env, GOMAXPROCS: process.env.GOMAXPROCS || '2' }, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn('npm', args, { cwd: root, env: { ...process.env, GOMAXPROCS: process.env.GOMAXPROCS || '2' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false }); child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
  await new Promise(resolve => stream.end(resolve));
  return { command, exitCode, durationMs: Math.round(performance.now() - started), log: filename, sha256: digest(await readFile(path.join(output, filename))) };
}
const startedAt = new Date().toISOString(), before = await inventory(), excludedPageRecipeFiles = await pageRecipeInventory();
await writeFile(path.join(output, 'source-manifest.json'), JSON.stringify(before, null, 2) + '\n');
console.log('Frozen source recorded; running npm test.');
const tests = await run(['test'], 'frozen-tests.log');
console.log(`Tests exited ${tests.exitCode}; running npm run build.`);
const build = await run(['run', 'build'], 'frozen-build.log'), after = await inventory();
const beforeMap = new Map(before.map(row => [row.path, row.sha256])), afterMap = new Map(after.map(row => [row.path, row.sha256]));
const changes = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].filter(name => beforeMap.get(name) !== afterMap.get(name)).map(name => ({ path: name, before: beforeMap.get(name) ?? null, after: afterMap.get(name) ?? null }));
const logText = await readFile(path.join(output, tests.log), 'utf8'), testSummary = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(logText.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`))?.[1] ?? NaN)]));
const policyTests = ['different actual versions pass when the used registrations and source contracts are verified', 'matching version labels cannot authorize missing or changed actual contracts', 'source method drift, incomplete observations and header disagreements remain blockers', 'requires actual active platforms and only required component registrations', 'resume lock binds actual schema, source contracts, versions and used types', 'known inactive random parent sync IDs do not create false resume conflicts', 'preliminary or offline fingerprints cannot serve as live write authorization'];
const policyEvidence = policyTests.map(name => ({ name: `native44 ${name}`, observedPassed: logText.includes(`✔ native44 ${name}`) || logText.includes(`ok `) && logText.includes(`native44 ${name}`) && tests.exitCode === 0 }));
const unchanged = JSON.stringify(before) === JSON.stringify(after);
const gate = { startedAt, finishedAt: new Date().toISOString(), reason: process.env.NATIVE44_GATE_REASON || 'Frozen platform implementation verification', sourceHash: digest(JSON.stringify(before)), sourceFiles: before.length, unchanged, changes, excludedPageRecipeFiles, excludedPageRecipeFilesAfter: await pageRecipeInventory(), pageRecipes: { scope: 'Task-specific Pet page content only; excluded from platform freeze, separate type check required', typeCheck: 'not-performed-by-platform-gate' }, tests: { ...tests, summary: testSummary }, build, componentContractPolicy: { environmentSource: before.find(row => row.path === 'src/native44/environment.ts'), testsSource: before.find(row => row.path === 'tests/native44-environment.test.ts'), evidence: policyEvidence, passed: tests.exitCode === 0 && policyEvidence.every(row => row.observedPassed) }, status: unchanged ? 'finished' : 'stale', passed: tests.exitCode === 0 && build.exitCode === 0 && unchanged && policyEvidence.every(row => row.observedPassed) };
await writeFile(path.join(output, 'final-gate.json'), JSON.stringify(gate, null, 2) + '\n');
console.log(JSON.stringify(gate, null, 2)); process.exitCode = gate.passed ? 0 : 1;

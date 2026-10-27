import { redactor } from './core/config.js';
import { assertWorkspaceAccess } from './workspace/service.js';
import path from 'node:path';
import { NATIVE44_BROWSER_OBSERVATION_FILE, prepareNative44Reference, prepareObservedNative44Reference } from './native44/source.js';
const args = process.argv.slice(2);
const observedDirectory = args.length === 3 && args[1] === '--observed' && path.isAbsolute(args[2]) ? args[2] : undefined;
if (!/^https?:\/\//i.test(args[0] ?? '') || !(args.length === 1 || observedDirectory)) {
  console.error('Usage: npm run reference -- <REFERENCE_URL> [--observed <ABSOLUTE_OBSERVATION_DIRECTORY>]'); process.exitCode = 2;
} else {
  try {
    await assertWorkspaceAccess(process.cwd());
    const job = observedDirectory
      ? await prepareObservedNative44Reference(args[0], observedDirectory)
      : await prepareNative44Reference(args[0], { onProgress: message => console.error('[reference native44] '+message) });
    console.log(JSON.stringify(job, null, 2)); process.exitCode = job.status === 'blocked' ? 1 : 0;
  } catch (error) { console.error(redactor()(error)); process.exitCode = 1; }
}

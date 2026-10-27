import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactor } from '../core/config.js';
import { emitNative44DeliverySummary } from './delivery-summary.js';

/** Explicit local artifact emission. No browser or credentials are loaded. */
export async function runNative44DeliverySummaryCli(argv: string[], root = process.cwd()): Promise<number> {
  if (argv.length !== 1 || argv[0].startsWith('--')) throw Error('Usage: npm run delivery -- <RUN_ID|RUN_DIR>');
  const provided = argv[0], runDir = /[\\/]/.test(provided) ? path.resolve(root, provided) : path.join(root, 'runs', provided);
  if (path.dirname(runDir) !== path.resolve(root, 'runs')) throw Error('native44_delivery_path_escape');
  const result = await emitNative44DeliverySummary(root, path.basename(runDir));
  console.log(JSON.stringify({ deliveryComplete: result.summary.deliveryComplete, requirementsComplete: result.summary.requirementsComplete, status: result.summary.status, summary: result.summaryRef, delivery: result.markdownRef }, null, 2));
  return result.summary.deliveryComplete ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runNative44DeliverySummaryCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(redactor()(error)); process.exitCode = 1; });

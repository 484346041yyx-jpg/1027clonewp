import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';
import { redactor } from '../core/config.js';
import { importNative44CurrentCaptureReview, prepareNative44CurrentCaptureReview } from './current-review.js';

export function parseNative44CurrentReviewArguments(argv: string[]) {
  const options: Record<string, string> = {}, args = [...argv]; let prepare = false, summary = false;
  if (args[0] === 'prepare' || args[0] === 'import') prepare = args.shift() === 'prepare';
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--summary' && !summary) { summary = true; continue; }
    if (option === '--dry-run' && !prepare) { prepare = true; continue; }
    if (!['--run', '--request'].includes(option) || !args[index + 1] || args[index + 1].startsWith('--') || options[option]) throw Error('current_review_cli_invalid_arguments');
    options[option] = args[++index];
  }
  if (!options['--run'] || !options['--request']) throw Error('Usage: npm run current-review -- [prepare|import] --run RUN_ID --request REVIEW_REQUEST_JSON [--dry-run] [--summary]');
  return { runId: options['--run'], request: options['--request'], prepare, summary };
}

export async function runNative44CurrentReviewCli(argv: string[], rootInput = process.cwd()) {
  const options = parseNative44CurrentReviewArguments(argv);
  const root = await realpath(rootInput), filename = path.resolve(root, options.request), relative = path.relative(root, filename);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || /[?\r\n]|^[a-z]+:\/\//i.test(options.request) || await realpath(filename) !== filename) throw Error('current_review_cli_path_escape');
  const info = await stat(filename); if (!info.isFile() || info.size > 16 * 1024 * 1024) throw Error('current_review_cli_request_size_limit');
  const bytes = await readFile(filename); if (bytes.length > 16 * 1024 * 1024) throw Error('current_review_cli_request_size_limit');
  return (options.prepare ? prepareNative44CurrentCaptureReview : importNative44CurrentCaptureReview)(root, options.runId, JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}

export function summarizeNative44CurrentReviewResult(result: Awaited<ReturnType<typeof runNative44CurrentReviewCli>>) {
  if (result.status === 'prepared-current-capture-review') {
    const { notes, ...state } = result; return { ...state, sections: notes };
  }
  const { current, delivery } = result, review = current.currentCaptureReview;
  return { status: result.status, idempotent: result.idempotent, remoteWrites: result.remoteWrites, taskId: current.taskId, runId: current.runId, pageId: current.pageId, documentHash: current.documentHash, reviewStatus: current.status, automated: review?.automated, qualityFloor: review?.qualityFloor, draftReady: review?.draftReady, deliveryReady: review?.deliveryReady, deliveryComplete: current.deliveryComplete, requirementsComplete: current.requirementsComplete, sections: delivery.summary.sections, deliverySummary: delivery.summaryRef, delivery: delivery.markdownRef };
}

/** Import success is independent of acceptance. Named gaps stay visible in the
 * structured result; only an actual command/evidence failure exits nonzero. */
export async function native44CurrentReviewMain(argv = process.argv.slice(2), root = process.cwd(), io: { write: (value: string) => void; error: (value: string) => void } = { write: value => { process.stdout.write(value); }, error: value => { process.stderr.write(value); } }): Promise<number> {
  try { const options = parseNative44CurrentReviewArguments(argv), result = await runNative44CurrentReviewCli(argv, root); io.write(JSON.stringify(options.summary ? summarizeNative44CurrentReviewResult(result) : result, null, 2) + '\n'); return 0; }
  catch (error) { io.error(redactor()(error) + '\n'); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await native44CurrentReviewMain();

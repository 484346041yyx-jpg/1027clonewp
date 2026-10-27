import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { validateNative44Program } from '../native44/validate.js';
import { canonicalV2 } from '../replica-v2/journal.js';
import { assertNative44ProfileIdentity } from '../native44/profile.js';
export type CreationMode = 'replica';
const inside = (root: string, filename: string): void => {
  const relative = path.relative(root, filename);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Creation input must stay inside the project');
};


/** Internal native44 input only. Public creation is routed by replica-full/entry. */
export function resolveCreationMode(input: unknown, explicitMode?: CreationMode): CreationMode {
  if (explicitMode !== undefined && explicitMode !== 'replica') throw Error('Retired creation mode');
  if (!input || (input as any).workflow !== 'block-replication' || (input as any).version !== 2 || (input as any).executionStrategy !== 'native44-css-handoff') throw Error('Retired creation workflow; current native44 input required');
  validateNative44Program(input); return 'replica';
}
export async function readCreationInput(root: string, filename: string): Promise<{ filename: string; input: unknown }> {
  const actualRoot = await realpath(root), local = path.resolve(actualRoot, filename);
  inside(actualRoot, local);
  const actual = await realpath(local); inside(actualRoot, actual);
  const info = await stat(actual);
  if (!info.isFile() || info.size > 8_388_608) throw new Error('Creation input must be a regular JSON file within 8 MiB');
  return { filename: actual, input: JSON.parse((await readFile(actual, 'utf8')).replace(/^\uFEFF/, '')) };
}


export async function assertCreationTaskMode(root: string, filename: string, mode: CreationMode): Promise<void> {
  const actualRoot=await realpath(root), {filename:actual,input}=await readCreationInput(actualRoot,filename);
  resolveCreationMode(input,mode); const program=input as any; let found=false;
  for(let directory=path.dirname(actual);directory!==actualRoot;directory=path.dirname(directory)) {
    const marker=path.join(directory,'job.json'); let info;
    try {info=await stat(marker);} catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
    inside(actualRoot,await realpath(marker)); if(!info.isFile()||info.size>1_048_576)throw Error('Task marker must be a bounded regular JSON file');
    const job=JSON.parse((await readFile(marker,'utf8')).replace(/^\uFEFF/,''));
    if(job.workflow!=='block-replication'||job.mode!==undefined&&job.mode!=='replica'||job.executionStrategy!=='native44-css-handoff')throw Error('Retired or conflicting task workflow');
    for(const key of ['componentCatalog','knowledge','targetEnvironment'])if(canonicalV2(job[key])!==canonicalV2(program[key]))throw Error('Task '+key+' identity conflicts with the program');
    assertNative44ProfileIdentity(job.replicationProfile,program.replicationProfile);
    if(job.selectionRulesHash!==program.selectionRulesHash)throw Error('Task selection rules identity conflicts with the program');
    if(job.taskId!==program.taskId||job.url!==program.sourceUrl)throw Error('Task source URL or task identity conflicts with the native44 program');
    found=true;
  }
  if(!found)throw Error('New native44 tasks require their own strategy-bound job marker');
}

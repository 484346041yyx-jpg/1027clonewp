import path from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { inquiryConfigurationSchema, inquirySitesSchema, type InquiryConfiguration } from '../native44/inquiry-form.js';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';

/** Source controls cannot disappear by replacing the form with static text. */
export function assertInquirySourceCoverage(source:SourceFactsV2,program:Native44Program,navigationForms:ReadonlyArray<{sourceFactIds:string[]}> = []):void {
  if(!program.inquiryPolicy)return;
  const nodes=walkNative44(program.blocks),owned=new Set(nodes.flatMap(node=>node.sourceFactIds??[]));
  const covered=new Set([...nodes.flatMap(node=>node.kind==='native'&&node.pendingForm ? node.pendingForm.sourceControls.flatMap(row=>'fieldFactIds' in row ? [...row.fieldFactIds,row.submitFactId] : [row.emailFactId,row.submitFactId]):[]),...navigationForms.flatMap(form=>form.sourceFactIds),...program.inquiryPolicy.exceptions.flatMap(row=>row.sourceFactIds)]);
  for(const id of sourceFormControlIds(source,owned))if(!covered.has(id))throw Error('replica_preparation_inquiry_source_control_unmapped:'+id);
}
export function sourceFormControlIds(source:SourceFactsV2,owned:ReadonlySet<string>):string[]{
  const result:string[]=[];
  for(const fact of Object.values(source.facts)){
    if(!owned.has(fact.id)||fact.kind!=='interaction')continue;
    const snapshot=source.snapshots.find(row=>row.id===fact.snapshotId),control=snapshot?.nodes[fact.nodeId];
    if(!control||!['input','select','textarea'].includes(control.tag.toLowerCase())||String(control.attributes?.type).toLowerCase()==='hidden')continue;
    let currentId:string|null=fact.nodeId;const seen=new Set<string>();
    while(currentId&&!seen.has(currentId)){seen.add(currentId);const current:typeof control|undefined=snapshot!.nodes[currentId];if(!current)break;if(current.tag.toLowerCase()==='form'){result.push(fact.id);break;}currentId=current.parentId;}
  }
  return result;
}

/** Missing business configuration is explicit; never copy source recipients. */
export async function readProjectInquiryConfiguration(root: string, targetOrigin: string): Promise<InquiryConfiguration | undefined> {
  const filename = path.join(root,'config','inquiry-forms.local.json');
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || path.resolve(await realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase() || info.size > 16384) throw Error('inquiry_configuration_file_invalid');
    const raw=JSON.parse(await readFile(filename,'utf8'));
    if(raw?.version===2){
      const sites=inquirySitesSchema.parse(raw),site=sites.sites.find(site=>site.targetOrigin===targetOrigin);
      return site??(sites.defaultRecipients?inquiryConfigurationSchema.parse({version:1,kind:'clonewp-inquiry-configuration',targetOrigin,recipients:sites.defaultRecipients}):undefined);
    }
    const configuration=inquiryConfigurationSchema.parse(raw);
    return configuration.targetOrigin===targetOrigin?configuration:undefined;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

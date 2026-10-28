import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCreationInput} from '../core/creation-mode.js';
import {runFullReplicaCLI,FULL_REPLICA_HELP} from './cli.js';
import {validateFullReplicaManifest} from './contract.js';
import {runPreparationCLI,PREPARATION_HELP} from '../replica-preparation/cli.js';
import {validatePreparationPlan} from '../replica-preparation/contract.js';
import {assertReplicaSourceSlug} from '../core/replica-url.js';
import { isPublicReplica, validatePublicReplicaManifest } from './public-contract.js';
import {isPopupReplica,popupManifestSchema} from './popup-contract.js';
import {runPopupReplica} from './popup-scope.js';
export function selectReplicaEntry(input:unknown,args:string[]):'preparation'|'full'|'public'|'popup'{
 if(args.includes('--resume')||args.includes('--stage'))throw Error('replica_full_retired_entry');
 const providerIndex=args.indexOf('--provider');
 if(providerIndex>=0&&(args[providerIndex+1]!=='woodmart-header-builder'||args.lastIndexOf('--provider')!==providerIndex))throw Error('replica_full_entry_provider');
 if(isPublicReplica(input)){validatePublicReplicaManifest(input);return 'public';}
 if(isPopupReplica(input)){popupManifestSchema.parse(input);return 'popup';}
 if((input as any)?.kind==='clonewp-replica-preparation'){assertReplicaSourceSlug(validatePreparationPlan(input));return 'preparation';}
 if((input as any)?.kind!=='clonewp-full-replica')throw Error('replica_full_entry_manifest_required');
 const manifest=validateFullReplicaManifest(input);
 if(manifest.headerProvider==='component')throw Error('replica_full_retired_entry');
 assertReplicaSourceSlug(manifest);
 return 'full';
}
export async function runReplicaEntry(args:string[],root='D:/cloneWP'):Promise<unknown>{
 if(!args.length||args.includes('--help'))return {help:PREPARATION_HELP+'\n'+FULL_REPLICA_HELP,remoteWrites:0};
 if(['run','resume','review','publish','status','reconcile','revise-style','revise-header-style','revise-native-motion','revise-layout','revise-configurator-catalog'].includes(args[0]))return runFullReplicaCLI(args);
 const filename=args.find(a=>!a.startsWith('--')&&/\.json$/i.test(a));if(!filename)throw Error('replica_full_entry_input');
 const {input,filename:absolute}=await readCreationInput(root,filename),provider=selectReplicaEntry(input,args);
 const allowed=new Set([filename,'--provider','woodmart-header-builder','--run-dir']);
 const dirIndex=args.indexOf('--run-dir'),runDirectory=dirIndex<0?path.join(root,'runs',(input as any).runId):args[dirIndex+1];
 if(!runDirectory||args.some((a,i)=>!allowed.has(a)&&i!==dirIndex+1)||args.lastIndexOf('--run-dir')!==dirIndex)throw Error('replica_full_entry_arguments');
 return provider==='popup'?runPopupReplica(input,{command:'run',runDirectory}):provider==='preparation'?runPreparationCLI(['dispatch','--input',absolute,'--run-dir',runDirectory]):runFullReplicaCLI(['run','--manifest',absolute,'--run-dir',runDirectory]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 try{const result=await runReplicaEntry(process.argv.slice(2));console.log(JSON.stringify(result,null,2));if((result as any)?.status==='write-unknown')process.exitCode=2;else if(['awaiting-preparation','awaiting-review','review-changes-required'].includes((result as any)?.status))process.exitCode=3;}
 catch(error){const message=error instanceof Error?error.message:'';console.error(JSON.stringify({error:/^(?:replica_(?:full|preparation|responsive)|workspace)_[a-z0-9_]+$/.test(message)?message:'replica_full_entry_failed'}));process.exitCode=1;}
}

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, redactor } from './core/config.js';
import { createOfflineNative44Plan } from './native44/offline-plan.js';
export interface NativePlanArguments {job:string;registry:string;catalog?:string;posts?:string}
export function parseNativePlanArguments(args:string[]):NativePlanArguments|undefined {
 const positional:string[]=[],options:Record<string,string>={};
 for(let i=0;i<args.length;i++){const a=args[i];if(a==='--catalog'||a==='--posts'){if(options[a]||!args[i+1]||/^(?:[a-z]+:\/\/|--)/i.test(args[i+1]))return;options[a]=args[++i];}else{if(/^(?:[a-z]+:\/\/|--)/i.test(a)||positional.length>=2)return;positional.push(a);}}
 return positional.length===2?{job:positional[0],registry:positional[1],...(options['--catalog']?{catalog:options['--catalog']}:{}),...(options['--posts']?{posts:options['--posts']}:{})}:undefined;
}
export async function createOfflineNativePlan(input:NativePlanArguments,root=process.cwd()) {
 const program:any=await readJson(path.resolve(root,input.job,'program.json'));
 if(program.workflow!=='block-replication'||program.executionStrategy!=='native44-css-handoff'||program.version!==2)throw Error('Current native44 input required; old planning workflows are retired');
 return createOfflineNative44Plan(input,root);
}
export function nativePlanConsoleOutput(result:Awaited<ReturnType<typeof createOfflineNativePlan>>){return {...result.plan,resultFile:result.resultFile};}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=parseNativePlanArguments(process.argv.slice(2));if(!args){console.error('Usage: npm run design:plan -- JOB REGISTRY [--catalog FILE] [--posts FILE]');process.exitCode=2;}else try{const result=await createOfflineNativePlan(args);console.log(JSON.stringify(nativePlanConsoleOutput(result),null,2));process.exitCode=result.plan.passed?0:3;}catch(error){console.error(redactor()(error));process.exitCode=1;}}

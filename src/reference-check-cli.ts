import path from 'node:path';
import { redactor } from './core/config.js';
import { validateLocalNative44Input } from './native44/local-task.js';
const args=process.argv.slice(2);
if(args.length!==1||/^(?:[a-z]+:\/\/|--)/i.test(args[0])){console.error('Usage: npm run design:check -- JOB');process.exitCode=2;}
else try{const checked=await validateLocalNative44Input(path.resolve(process.cwd(),args[0],'program.json'),process.cwd());console.log(JSON.stringify({passed:true,executionStrategy:'native44-css-handoff',blocks:checked.program.blocks.length,sourceFactsHash:checked.sourceFactsHash,componentPlanHash:checked.componentPlanHash,deliveryComplete:false},null,2));}catch(error){console.error(redactor()(error));process.exitCode=1;}

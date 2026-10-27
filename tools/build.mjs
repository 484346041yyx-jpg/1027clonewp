import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lstat, readdir, realpath, unlink } from 'node:fs/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
// Retired source must not survive as a runnable stale build artifact. Only
// generated JS whose corresponding source has disappeared is removed.
const dist=path.join(root,'dist');
async function prune(directory) {
  let entries; try { entries=await readdir(directory,{withFileTypes:true}); }
  catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){
    const filename=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error('Build output contains a reparse point');
    const actual=await realpath(filename),relative=path.relative(dist,actual);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Build output escaped dist');
    if(entry.isDirectory()){await prune(filename);continue;}
    if(!entry.isFile()||!filename.endsWith('.js'))continue;
    const source=path.join(root,relative.replace(/\.js$/,'.ts'));
    try{await lstat(source);}catch(error){if(error.code!=='ENOENT')throw error;await unlink(filename);}
  }
}
try { if((await lstat(dist)).isSymbolicLink())throw Error('dist cannot be a reparse point'); await prune(dist); }
catch(error){if(error.code!=='ENOENT')throw error;}
// The native TypeScript compiler otherwise follows the host's very large CPU
// count and can exhaust memory while browser verification is running.
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url)),'-p','tsconfig.json'],{
  cwd:root,stdio:'inherit',env:{...process.env,GOMAXPROCS:process.env.GOMAXPROCS||'2'},
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root='D:/cloneWP/references/pet-v2-observation-20261015';
await mkdir(root,{recursive:true});
const token=randomBytes(24).toString('hex');
const server=createServer(async(req,res)=>{
  if(req.headers['x-observation-token']!==token){res.writeHead(403).end();return;}
  if(req.method==='GET'&&req.url==='/collector'){res.writeHead(200,{'content-type':'text/plain'}).end(await readFile('D:/cloneWP/src/replica-v2/collect.browser.js'));return;}
  const name=decodeURIComponent((req.url??'').slice(1));
  if(req.method!=='POST'||!name||name.includes('..')||!/^[a-zA-Z0-9_./-]+\.(json|jpg|png)$/.test(name)){res.writeHead(400).end();return;}
  const target=path.resolve(root,name);if(!target.toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep)){res.writeHead(400).end();return;}
  try{let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>40000000)throw Error('bounded');chunks.push(b);}await mkdir(path.dirname(target),{recursive:true});await writeFile(target,Buffer.concat(chunks));res.writeHead(201).end('saved');}catch{res.writeHead(400).end('failed');}
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port,token,directory:root})+'\n'));

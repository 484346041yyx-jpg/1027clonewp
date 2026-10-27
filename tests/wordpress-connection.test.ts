import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {WordPressConnection} from '../src/wordpress/connection.js';
import {createWordPressNetwork} from '../src/wordpress/network.js';
import {WordPressClient} from '../src/wordpress/client.js';
import {WoodMartHeaderTransport} from '../src/woodmart-header/transport.js';

const options={targetUrl:'https://connection.example/',username:'fixture',applicationPassword:'fixture-secret'};
function fixture(failExecution=false){
 const counts={initialize:0,registry:0,schema:0,execute:0,close:0};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:input.toString());assert.equal(url.origin,'https://connection.example');assert.equal(new Headers(init?.headers).get('Authorization'),'Basic '+Buffer.from('fixture:fixture-secret').toString('base64'));assert.equal(init?.redirect,'manual');
  if(init?.method==='DELETE'){counts.close++;return new Response(null,{status:204});}
  const rpc=JSON.parse(String(init?.body??'{}'));if(rpc.id===undefined)return new Response(null,{status:init?.method==='GET'?405:202});
  const result=(value:unknown)=>new Response(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:value}),{headers:{'Content-Type':'application/json'}});
  const output=(value:unknown)=>result({structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]});
  if(rpc.method==='initialize'){counts.initialize++;await new Promise(r=>setImmediate(r));return result({protocolVersion:rpc.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});}
  if(rpc.method==='tools/list')return result({tools:['discover-abilities','get-ability-info','execute-ability'].map(name=>({name,inputSchema:{type:'object',additionalProperties:true}}))});
  const name=rpc.params.name;if(name==='discover-abilities'){counts.registry++;return output({abilities:[{name:'novamira/execute-php'}]});}
  if(name==='get-ability-info'){counts.schema++;return output({input_schema:{type:'object',properties:{code:{type:'string'}}}});}
  if(name==='execute-ability'){counts.execute++;if(failExecution)throw Error('fixture-secret network failure');return output({success:true,data:{success:true,return_value:{read:counts.execute}}});}
  throw Error('Unexpected fixture request');
 };return{counts,options:{...options,fetch:fetcher}};
}
test('header and body share one connection, registry and schema while every resource read stays fresh',async()=>{
 const f=fixture(),session=new WordPressConnection(f.options),client=new WordPressClient(f.options,session),header=new WoodMartHeaderTransport(f.options,session);
 try{
  const [a,b]=await Promise.all([header.readPHP({name:'header.inspect',code:'return [];',trustedLocalCode:true}),client.abilityInfo('novamira/execute-php')]);
  assert.deepEqual(a,{read:1});assert.equal(b.input_schema?.type,'object');assert.deepEqual(f.counts,{initialize:1,registry:1,schema:1,execute:1,close:0});
  b.input_schema!.type='tampered';assert.equal((await client.abilityInfo('novamira/execute-php')).input_schema!.type,'object');
  await client.close();assert.deepEqual(await header.readPHP({name:'header.inspect',code:'return [];',trustedLocalCode:true}),{read:2});
  await header.close();assert.equal(f.counts.execute,2);assert.equal(session.diagnostics().gateway.connections,1);assert.equal(session.diagnostics().gateway.registryReads,1);
  assert.doesNotMatch(JSON.stringify(session.diagnostics()),/fixture-secret|Authorization|return \[|connection\.example/);
 }finally{await session.close();}
});
test('shared connections reject changed origin, credentials, timeout and route before requests',async()=>{
 const f=fixture(),session=new WordPressConnection(f.options);
 try{for(const delta of [{targetUrl:'https://other.example/'},{applicationPassword:'different'},{timeoutMs:1000},{networkRoute:'direct' as const}])assert.throws(()=>new WordPressClient({...f.options,...delta},session),(e:any)=>e.code==='connection_identity_mismatch');assert.equal(f.counts.initialize,0);}finally{await session.close();}
});
test('ambiguous mutation executes once without reconnecting, retrying or changing routes',async()=>{
 const f=fixture(true),session=new WordPressConnection(f.options),header=new WoodMartHeaderTransport(f.options,session);
 try{await assert.rejects(header.executePHP({name:'header.update',code:'return [];',trustedLocalCode:true,intent:{runId:'run',operationId:'write',resource:'header/module',expectedSnapshotSha256:'a'.repeat(64),persistedIntentSha256:'b'.repeat(64)}}));assert.equal(f.counts.execute,1);assert.equal(f.counts.initialize,1);assert.equal(header.diagnostics().operations[0].state,'unconfirmed');assert.equal(session.diagnostics().route,'environment');}finally{await session.close();}
});
test('explicit direct route is per request and leaves environment, global dispatcher and TLS settings alone',async()=>{
 const environmentHash=()=>createHash('sha256').update(JSON.stringify(Object.entries(process.env).sort())).digest('hex'),env=environmentHash();
 const dispatcher=(globalThis as any)[Symbol.for('undici.globalDispatcher.1')];let calls=0;
 const server=createServer((req,res)=>{calls++;assert.equal(req.headers['accept-encoding'],'identity');res.setHeader('set-cookie',['a=1','b=2']);res.end('ok');});server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+(server.address() as any).port,network=createWordPressNetwork(origin,'direct');
 try{const response=await network.fetch(origin);assert.equal(await response.text(),'ok');assert.deepEqual(response.headers.getSetCookie(),['a=1','b=2']);await assert.rejects(network.fetch('https://other.example/'),(e:any)=>e.code==='cross_origin_blocked');assert.equal(calls,1);assert.equal(environmentHash(),env);assert.equal((globalThis as any)[Symbol.for('undici.globalDispatcher.1')],dispatcher);}finally{await network.close();server.close();await once(server,'close');}
 await assert.rejects(network.fetch(origin),(e:any)=>e.code==='connection_closed');
});
test('concurrent gateway handshakes coalesce and a closed session drops all metadata caches',async()=>{
 const f=fixture(),session=new WordPressConnection(f.options);
 // Test the same gateway connection lifecycle without constructing another authenticated caller.
 await Promise.all([session.mcp.connect(),session.mcp.connect(),session.mcp.connect()]);assert.equal(f.counts.initialize,1);
 await Promise.all([session.mcp.discover(),session.mcp.discover(),session.mcp.info('novamira/execute-php'),session.mcp.info('novamira/execute-php')]);assert.equal(f.counts.registry,1);assert.equal(f.counts.schema,1);
 await session.mcp.close();await session.mcp.discover();await session.mcp.info('novamira/execute-php');assert.equal(f.counts.initialize,2);assert.equal(f.counts.registry,2);assert.equal(f.counts.schema,2);await session.close();
});
test('failed connection setup allows one later explicit read without automatically replaying any PHP',async()=>{
 const f=fixture();let first=true;
 const fetcher:typeof fetch=async(i,o)=>{const rpc=JSON.parse(String(o?.body??'{}'));if(first&&rpc.method==='initialize'){first=false;throw Error('fixture offline');}return f.options.fetch(i,o);};
 const session=new WordPressConnection({...f.options,fetch:fetcher}),header=new WoodMartHeaderTransport({...f.options,fetch:fetcher},session);
 try{await assert.rejects(header.readPHP({name:'read.current',code:'return [];',trustedLocalCode:true}));assert.equal(f.counts.execute,0);assert.deepEqual(await header.readPHP({name:'read.current',code:'return [];',trustedLocalCode:true}),{read:1});assert.equal(session.diagnostics().gateway.connections,2);assert.equal(f.counts.execute,1);}finally{await session.close();}
});

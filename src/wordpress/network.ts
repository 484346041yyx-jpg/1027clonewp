import {Agent as HttpAgent,request as httpRequest} from 'node:http';
import {Agent as HttpsAgent,request as httpsRequest} from 'node:https';
import {Readable} from 'node:stream';
import {WordPressError} from './errors.js';

export type WordPressNetworkRoute='environment'|'direct';
/** Per-target route, fixed before authentication. No environment/global dispatcher/TLS overrides. */
export function createWordPressNetwork(targetOrigin:string,route:WordPressNetworkRoute='environment',fetcher?:typeof fetch){
  if(!['environment','direct'].includes(route))throw new WordPressError('network_route_invalid','Unsupported WordPress connection route.');
  const target=new URL(targetOrigin);
  if(target.origin!==targetOrigin||(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname))))throw new WordPressError('network_target_invalid','WordPress connections require HTTPS or a loopback test target.');
  const agent=route==='direct'?(target.protocol==='https:'?new HttpsAgent({keepAlive:true,maxSockets:4}):new HttpAgent({keepAlive:true,maxSockets:4})):undefined;
  let closed=false;
  const request:typeof fetch=async(input,init)=>{
    if(closed)throw new WordPressError('connection_closed','The WordPress connection is closed.');
    const url=new URL(input instanceof Request?input.url:input.toString(),targetOrigin);
    if(url.origin!==targetOrigin||url.username||url.password)throw new WordPressError('cross_origin_blocked','WordPress connection routes cannot leave their target origin.');
    if(fetcher||!agent)return(fetcher??globalThis.fetch)(input,init);
    const request=new Request(input,init),bytes=request.body?Buffer.from(await request.arrayBuffer()):undefined;
    request.signal.throwIfAborted();
    const headers:Record<string,string>={};request.headers.forEach((value,key)=>headers[key]=value);
    // Node core does not auto-decompress fetch bodies. Ask for identity, without altering credentials.
    headers['accept-encoding']='identity';if(bytes)headers['content-length']=String(bytes.length);
    return new Promise<Response>((resolve,reject)=>{
      const native=(target.protocol==='https:'?httpsRequest:httpRequest)(url,{method:request.method,headers,agent,signal:request.signal},response=>{
        const responseHeaders=new Headers();for(const[key,value]of Object.entries(response.headers)){if(Array.isArray(value))value.forEach(v=>responseHeaders.append(key,v));else if(value!==undefined)responseHeaders.set(key,value);}
        const status=response.statusCode??500,empty=request.method==='HEAD'||[204,205,304].includes(status);
        if(empty)response.resume();
        resolve(new Response(empty?null:Readable.toWeb(response) as ReadableStream<Uint8Array>,{status,statusText:response.statusMessage,headers:responseHeaders}));
      });
      native.on('error',()=>reject(new WordPressError('network_error','The configured WordPress connection did not complete.')));
      native.end(bytes);
    });
  };
  return {route,fetch:request,close:async()=>{if(closed)return;closed=true;agent?.destroy();}};
}

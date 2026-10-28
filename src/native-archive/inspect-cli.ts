import { loadConfig } from '../core/config.js';
import { WordPressConnection } from '../wordpress/connection.js';
import { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { decodeCapabilityPayload } from '../wordpress/capability-payload.js';
import { archiveInspectionRequest, archiveInspectionPHP, validateArchiveInspection } from './inspection.js';

/** Explicit per-process site selection; outputs only public category/product IDs and registered control metadata. */
async function main() {
  if(process.argv.length!==5) throw Error('usage: inspect-cli CATEGORY_ID CATEGORY_ID PER_PAGE');
  const {config,credentials}=await loadConfig('D:/cloneWP');
  const request=archiveInspectionRequest.parse({targetOrigin:new URL(config.targetUrl).origin,categoryIds:[Number(process.argv[2]),Number(process.argv[3])],perPage:Number(process.argv[4])});
  const connection={targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password,networkRoute:config.wordpressNetworkRoute};
  const session=new WordPressConnection(connection);
  try{const transport=new WoodMartHeaderTransport(connection,session);const raw=decodeCapabilityPayload(await transport.readPHP({name:'native-archive-inspection',code:archiveInspectionPHP(request),trustedLocalCode:true}));try{console.log(JSON.stringify(validateArchiveInspection(request,raw),null,2));}catch(error){console.error(JSON.stringify({code:'archive_inspection_unverified',observation:raw}));throw error;}}finally{await session.close();}
}
main().catch((error:unknown)=>{console.error(error instanceof Error ? error.message : 'archive_inspection_failed');process.exitCode=1;});

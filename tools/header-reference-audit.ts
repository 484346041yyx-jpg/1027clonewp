import {loadConfig} from '../src/core/config.js';
import {WoodMartHeaderTransport} from '../src/woodmart-header/transport.js';
const {config,credentials}=await loadConfig('D:/cloneWP');
const t=new WoodMartHeaderTransport({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password});
try { console.log(JSON.stringify(await t.readPHP({name:'whb.audit-reference-identities',trustedLocalCode:true,code:`global $wpdb; return $wpdb->get_results($wpdb->prepare("SELECT p.ID,p.post_type,p.post_status,p.post_parent,m.meta_key FROM {$wpdb->posts} p JOIN {$wpdb->postmeta} m ON m.post_id=p.ID WHERE m.meta_value LIKE %s",'%'.$wpdb->esc_like('header_193941').'%'),ARRAY_A);`}),null,2)); } finally {await t.close();}

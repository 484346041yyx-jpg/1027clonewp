import {readFile,writeFile} from 'node:fs/promises';
import {loadConfig} from '../src/core/config.js';
import {WoodMartHeaderTransport} from '../src/woodmart-header/transport.js';
const root='D:/cloneWP',dir=root+'/.cache/header-test';
const request=JSON.parse(await readFile(dir+'/save-request.json','utf8'));
const {config,credentials}=await loadConfig(root);
const t=new WoodMartHeaderTransport({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password});
try {
  const code='$expected=json_decode(base64_decode(\''+Buffer.from(JSON.stringify(request)).toString('base64')+'\'),true);'+`
    $pid=15858;$settings=get_post_meta($pid,'_elementor_page_settings',true);$elements=json_decode(get_post_meta($pid,'_elementor_data',true),true);$css=new \\Elementor\\Core\\Files\\CSS\\Post($pid);$path=$css->get_path();
    return ['headerMatches'=>get_option('whb_header_193941')===$expected['raw'],'pageCSSMatches'=>($settings['custom_css']??null)===$expected['css'],'elementsMatch'=>$elements===$expected['elements'],'template'=>get_post_meta($pid,'_wp_page_template',true),'headerBinding'=>get_post_meta($pid,'_woodmart_whb_header',true),'compiledCSSHasRule'=>is_file($path)&&str_contains(file_get_contents($path),'left:auto;right:0'),'ownLockAbsent'=>get_option('clonewp_header_test_lock',null)===null];`;
  const result=await t.readPHP({name:'whb.reconcile-save',trustedLocalCode:true,code});
  await writeFile(dir+'/save-reconciliation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await t.close();}

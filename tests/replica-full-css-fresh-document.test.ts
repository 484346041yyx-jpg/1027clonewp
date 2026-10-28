import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

test('CSS generation reads a fresh document after a settings-only native save',async t=>{
 const source=await readFile(new URL('../src/replica-full/wordpress-full.php',import.meta.url),'utf8');
 const start=source.indexOf("$saveInput=$action==='style'?"),end=source.indexOf('\n      }finally',start),branch=source.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.ok(branch.indexOf("documents->get($id,false)")>branch.indexOf('$doc->save($saveInput)'));
 assert.ok(branch.indexOf("documents->get($id,false)")<branch.indexOf('new \\Elementor\\Core\\Files\\CSS\\Post'));
 const available=spawnSync('php',['-v'],{encoding:'utf8',windowsHide:true});
 if(available.error||available.status!==0){t.diagnostic('PHP CLI unavailable; actual Elementor CSS generation is checked in the owned page browser.');return;}
 const script=`namespace Elementor {class Plugin {public static $instance;}} namespace Elementor\\Core\\Files\\CSS {class Post {function __construct($id){} function update(){$GLOBALS['css']=\\Elementor\\Plugin::$instance->documents->get(9)->get_settings('custom_css');}}} namespace {class Doc {function __construct(public $settings){} function save($input){$GLOBALS['saved']=$input['settings'];return true;}function get_settings($key){return $this->settings[$key]??null;}}class Docs {public $doc;function __construct(){$this->doc=new Doc(['custom_css'=>'old']);}function get($id,$cache=true){if(!$cache)$this->doc=new Doc($GLOBALS['saved']);return $this->doc;}}\\Elementor\\Plugin::$instance=(object)['documents'=>new Docs];$doc=\\Elementor\\Plugin::$instance->documents->get(9);$id=9;$action='style';$settings=['custom_css'=>'new'];$targetElements=[];${branch}echo json_encode([$GLOBALS['css'],$GLOBALS['saved']]);}`;
 const result=spawnSync('php',['-r',script],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['new',{custom_css:'new'}]);
});

test('reused-header body CSS refreshes the manager document before regenerating this page file',async t=>{
 const source=await readFile(new URL('../src/replica-full/reused-driver.php',import.meta.url),'utf8');
 const start=source.indexOf("if(!$doc->save(['elements'=>$expectedElements,'settings'=>$settings]))"),end=source.indexOf('$check=$inspect();',start),branch=source.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.ok(branch.indexOf('documents->get($id,false)')>branch.indexOf("$doc->save(['elements'=>$expectedElements,'settings'=>$settings])"));
 assert.ok(branch.indexOf('documents->get($id,false)')<branch.indexOf('new \\Elementor\\Core\\Files\\CSS\\Post'));
 const available=spawnSync('php',['-v'],{encoding:'utf8',windowsHide:true});
 if(available.error||available.status!==0){t.diagnostic('PHP CLI unavailable; generated CSS must also be read in the current owned page browser.');return;}
 const mock=String.raw`namespace Elementor {class Plugin {public static $instance;}} namespace Elementor\Core\Files\CSS {class Post {function __construct($id){}function update(){$GLOBALS['css']=\Elementor\Plugin::$instance->documents->get(9)->get_settings('custom_css');}}} namespace {function update_post_meta($id,$key,$value){}class Doc {function __construct(public $settings){}function save($input){$GLOBALS['saved']=$input['settings'];return true;}function get_settings($key){return $this->settings[$key]??null;}}class Docs {public $doc;public $refreshes=0;function __construct(){$this->doc=new Doc(['custom_css'=>'old']);}function get($id,$cache=true){if(!$cache){$this->refreshes++;$this->doc=new Doc($GLOBALS['saved']);}return $this->doc;}}\Elementor\Plugin::$instance=(object)['documents'=>new Docs];$plugin=\Elementor\Plugin::$instance;$doc=$plugin->documents->get(9);$id=9;$action='style';$settings=['custom_css'=>'new'];$expectedElements=[];`;
 const result=spawnSync('php',['-r',mock+branch+"echo json_encode([$GLOBALS['css'],$GLOBALS['saved'],$plugin->documents->refreshes]);}"],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['new',{custom_css:'new'},1]);
});

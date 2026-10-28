import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { nativeArchiveRequestPHP } from '../../src/native-archive/archive-request.js';

test('rejects invalid category, pagination, and empty trusted code', () => {
  for (const [term, page, count, code] of [[0,1,12,'return 1;'],[1,0,12,'return 1;'],[1,1,101,'return 1;'],[1.5,1,12,'return 1;'],[1,1,12,' ']] as const) assert.throws(() => nativeArchiveRequestPHP(term, page, count, code), /native_archive_request_input/);
});

const phpAvailable = spawnSync('php', ['-v'], { windowsHide: true }).status === 0;
test('constructs main category query and restores existing globals after success and exception', { skip: !phpAvailable }, () => {
  const run = (body: string) => {
    const wrapper = nativeArchiveRequestPHP(17, 2, 12, body);
    const php = `<?php
class WP_Query { public $vars=[]; function query($v){if($GLOBALS['wp_query']!==$this||$GLOBALS['wp_the_query']!==$this)throw new Exception('not_main');$this->vars=$v;} function is_tax($t){return $t==='product_cat';} function get_queried_object_id(){return 17;} function get($k){return $this->vars[$k]??null;} }
function get_term($id,$tax){return (object)['term_id'=>$id,'taxonomy'=>$tax,'slug'=>'example'];} function is_wp_error($v){return false;}
$GLOBALS['post']='before';$GLOBALS['wp_query']='original';unset($GLOBALS['product'],$GLOBALS['wp_the_query']);
try {$value=(static function(){${wrapper}})();}catch(Throwable $e){$value=$e->getMessage();}
echo json_encode(['value'=>$value,'post'=>$GLOBALS['post'],'query'=>$GLOBALS['wp_query'],'productExists'=>array_key_exists('product',$GLOBALS),'theQueryExists'=>array_key_exists('wp_the_query',$GLOBALS)]);`;
    const result = spawnSync('php', { input: php, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(run("return [$GLOBALS['wp_query']->vars['product_cat'],$GLOBALS['wp_query']->vars['paged'],$GLOBALS['wp_query']->vars['posts_per_page']];"), { value: ['example',2,12], post:'before',query:'original',productExists:false,theQueryExists:false });
  assert.deepEqual(run("throw new Exception('controlled');"), { value:'controlled',post:'before',query:'original',productExists:false,theQueryExists:false });
});

<?php
// Synthetic getters for exercising the actual generated read operation locally.
// No WordPress database, templates, network or business service is loaded.
define('WC_VERSION', 'synthetic');
$fixture = json_decode(file_get_contents('php://stdin'), true);
class FixtureAttribute {
    private $data;
    function __construct($data) { $this->data=$data; }
    function get_name() { return $this->data['name']; }
    function is_taxonomy() { return strpos($this->get_name(),'pa_')===0; }
    function get_options() { return $this->data['options']; }
    function get_visible() { return $this->data['visible']; }
    function get_variation() { return $this->data['variation']; }
}
class WC_Product {
    public $data;
    function __construct($data) { $this->data=$data; }
    function get_id() { return $this->data['id']; }
    function get_parent_id() { return $this->data['parentId']??0; }
    function get_type() { return $this->data['parentId']??false ? 'variation' : $this->data['type']; }
    function is_type($type) { return $this->get_type()===$type; }
    function get_status() { return $this->data['status']??'publish'; }
    function is_visible() { return $this->data['visible']??true; }
    function variation_is_visible() { return $this->data['visible']??true; }
    function get_price() { return $this->data['price']['current']; }
    function get_regular_price() { return $this->data['price']['regular']; }
    function get_sale_price() { return $this->data['price']['sale']; }
    function get_price_html() { return $this->data['price']['html']; }
    function is_on_sale() { return $this->data['price']['onSale']; }
    function get_stock_status() { return $this->data['stock']['status']; }
    function managing_stock() { return $this->data['stock']['managed']; }
    function get_stock_quantity() { return $this->data['stock']['quantity']; }
    function is_purchasable() { return $this->data['stock']['purchasable']; }
    function is_in_stock() { return $this->data['stock']['inStock']; }
    function backorders_allowed() { return $this->data['stock']['backordersAllowed']; }
    function get_image_id() { return ($this->data['image']??$this->data['media'][0]??[])['id']??0; }
    function get_gallery_image_ids() { return array_column(array_slice($this->data['media']??[],1),'id'); }
    function get_attributes() { return $this->is_type('variation') ? $this->data['attributes'] : array_map(fn($a)=>new FixtureAttribute($a),$this->data['attributes']); }
    function get_children() { return array_column($this->data['variations'],'id'); }
    function get_default_attributes() { return $this->data['defaultAttributes']; }
    function get_name() { return $this->data['name']; }
    function get_permalink() { return $this->data['permalink']; }
    function get_sku() { return $this->data['sku']; }
    function get_description() { return $this->data['description']; }
    function get_short_description() { return $this->data['shortDescription']; }
    function is_sold_individually() { return $this->data['soldIndividually']; }
    function get_reviews_allowed() { return $this->data['reviews']['enabled']; }
    function get_average_rating() { return $this->data['reviews']['average']; }
    function get_rating_count() { return $this->data['reviews']['ratingCount']; }
    function get_review_count() { return $this->data['reviews']['reviewCount']; }
}
function wc_get_product($id) { global $fixture; if($id===$fixture['product']['id'])return new WC_Product($fixture['product']); foreach($fixture['product']['variations'] as $v)if($v['id']===$id)return new WC_Product($v); return false; }
function get_post_field($field,$id) { global $fixture; return $field==='post_password'?($fixture['password']??''):null; }
function wp_get_attachment_image_url($id,$size) { global $fixture; foreach($fixture['product']['media'] as $m)if($m['id']===$id)return $m['url']; foreach($fixture['product']['variations'] as $v)if(($v['image']['id']??0)===$id)return $v['image']['url']; return false; }
function get_post_meta($id,$key,$single) { global $fixture; foreach($fixture['product']['media'] as $m)if($m['id']===$id)return $m['alt']; return ''; }
function sanitize_title($name) { return strtolower(str_replace(' ','-',$name)); }
function wc_attribute_label($name,$product) { foreach($product->data['attributes'] as $a)if($a['name']===$name)return $a['label']; return $name; }
function wc_get_product_terms($id,$taxonomy,$args) { global $fixture; if($taxonomy==='product_cat'||$taxonomy==='product_tag')return array_map(fn($t)=>(object)['term_id'=>$t['id'],'name'=>$t['name'],'slug'=>$t['slug']],$fixture['product'][$taxonomy==='product_cat'?'categories':'tags']); foreach($fixture['product']['attributes'] as $a)if($a['name']===$taxonomy)return $a['options']; return []; }
function get_woocommerce_currency() { global $fixture; return $fixture['currency']; }
function is_wp_error($value) { return false; }
try { $result=(static function() { return eval($GLOBALS['fixture']['readCode']); })(); echo json_encode($result); }
catch (Throwable $error) { echo json_encode(['error'=>$error->getMessage()]); }

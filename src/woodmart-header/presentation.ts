/** Styling belongs only to the new test page. Existing Elementor CSS is not imported. */
export function furryHeaderPageCSS(pageId: number): string {
  if (!Number.isSafeInteger(pageId)||pageId<1)throw new Error('header_test_page_invalid');
  const p=`body.page-id-${pageId}`,h=`${p} .whb-header_193941`;
  return `@font-face{font-family:CloneWPHeaderNunito;font-style:normal;font-weight:700;src:url(https://furryskitchen.sg/cdn/fonts/nunito/nunito_n7.37cf9b8cf43b3322f7e6e13ad2aad62ab5dc9109.woff2) format("woff2");font-display:swap}
${h}{--nav-color:#303339;--nav-color-hover:#ff8b15;--wd-header-el-color:#363a44;--wd-header-el-color-hover:#ff8b15}
${h} .whb-general-header{background:#e8e9eb;border:0}
${h} .whb-general-header>.container{width:100%;max-width:1660px;padding:0 30px;margin-inline:auto}
${h} .whb-general-header-inner{display:grid;grid-template-columns:25% minmax(0,1fr) auto;align-items:center;height:109px;min-height:109px;gap:0;margin:0;width:100%}
${h} .whb-col-left,${h} .whb-col-center,${h} .whb-col-right{width:auto;min-width:0;flex:none;padding:0;margin:0}
${h} .whb-col-left{justify-content:flex-start}
${h} .whb-col-center{justify-content:flex-end;margin:0}
${h} .whb-col-right{justify-content:flex-end;gap:26px;margin-left:40px}
${h} .site-logo{padding:0;max-width:260px;transform:translateY(-8px)}
${h} .wd-logo img{width:260px;max-width:260px;height:auto;padding:0}
${h} .wd-header-main-nav{margin:0;padding:0;max-width:none}
${h} .wd-nav-main{display:flex;flex-wrap:nowrap;gap:2.8px;justify-content:flex-end}
${h} .wd-nav-main>.item-level-0{margin:0;flex-shrink:0}
${h} .wd-nav-main>.item-level-0>a{font-family:CloneWPHeaderNunito,Nunito,sans-serif;font-size:14px;font-weight:700;line-height:14px;text-transform:none;letter-spacing:.5px;color:#303339;padding:15px;min-height:44px;height:auto}
${h} .wd-nav-main>.item-level-0:last-child>a{padding-right:0}
${h} .wd-nav-main>.menu-item-has-children>a:after{font-size:8px;margin-left:15px;color:currentColor}
${h} .wd-tools-element>a{font-family:CloneWPHeaderNunito,Nunito,sans-serif;font-size:14px;font-weight:700;line-height:22.4px;color:#363a44;padding:0;height:auto;white-space:nowrap}
${h} .wd-tools-icon{font-size:18px;width:auto;height:auto;margin-right:7px}
${h} .wd-tools-text{font-size:14px;line-height:22.4px;text-transform:none;letter-spacing:0;font-weight:700}
${h} .wd-dropdown-menu{background:#e8e9eb;border:0;border-radius:0;box-shadow:none;padding:0;min-width:225px;width:max-content;max-width:min(452px,calc(100vw - 60px));margin-top:0}
${h} .wd-nav-main>.item-level-0:nth-last-child(2)>.wd-dropdown-menu{left:auto;right:0}
${h} .wd-dropdown-menu>.container{padding:0;max-width:none;width:auto}
${h} .wd-sub-menu{padding:0;margin:0}
${h} .wd-sub-menu>li{margin:0;padding:0}
${h} .wd-sub-menu>li>a{font-family:CloneWPHeaderNunito,Nunito,sans-serif;font-size:14px;font-weight:700;line-height:14px;letter-spacing:.5px;color:#303339;padding:15px 30px 15px 15px;min-height:44px;white-space:nowrap}
${h} .wd-nav-main a:hover,${h} .wd-tools-element>a:hover{color:#ff8b15}
${h} a:focus-visible{outline:2px solid #e07a11;outline-offset:3px}
${p} .clonewp-header-test-body{font-family:CloneWPHeaderNunito,Nunito,sans-serif;max-width:1100px;margin:0 auto;padding:90px 30px;min-height:1300px;color:#303339}
${p} .clonewp-header-test-body h1{font-size:34px;line-height:1.3;margin-bottom:24px}
${p} .clonewp-header-test-body p{font-size:17px;line-height:1.8;max-width:760px}
${p} .clonewp-header-test-body a{color:#a95608;text-decoration:underline}
${p} .page-title{display:none}
@media(min-width:1025px) and (max-width:1699px){
${h} .whb-general-header-inner{grid-template-columns:25% minmax(0,1fr);grid-template-rows:44.6px 26.9px;align-content:center}
${h} .whb-col-left{grid-column:1;grid-row:1/3}
${h} .whb-col-center{grid-column:2;grid-row:1;align-self:end}
${h} .whb-col-right{grid-column:2;grid-row:2;align-self:start;margin-left:0}
}
`;
}

export const furryHeaderTestBody=`<section class="clonewp-header-test-body"><h1>Furry’s Kitchen 页眉测试</h1><p>此页展示 WoodMart 页眉生成器与独立 test 菜单的组合。可展开 Shop 和 Food For Thought，或向下滚动检查吸顶。</p><p><a href="https://primevapeoutlet.com/furrys-kitchen-desktop-native-replica/">查看保留的原组件版本</a></p><p>账户与购物车连接本站 WooCommerce；商品、喂养指南等内容链接保留参考站地址。</p></section>`;

export function furryHeaderTestElements(){return [{id:'fhtbody',elType:'container',settings:{content_width:'full',padding:{unit:'px',top:'0',right:'0',bottom:'0',left:'0',isLinked:true}},elements:[{id:'fhttext',elType:'widget',widgetType:'text-editor',settings:{editor:furryHeaderTestBody},elements:[]}]}];}

import {assertProductExtensionReference} from './product-extension.js';
import type {FileRef} from '../replica-v2/types.js';
import { assertAllowedWidget, type Native44WidgetType } from './catalog.js';

export type Native44PageRole = 'landing' | 'archive' | 'single-product' | 'unresolved';
type AdviceStatus = 'native-candidate' | 'context-dependent' | 'capability-gap';
interface ResponsibilityRule {
  status: AdviceStatus;
  candidates: readonly Native44WidgetType[];
  dependencies: readonly string[];
  requiredEvidence: readonly string[];
  restrictions: readonly string[];
  referenceOnlyWidgets: readonly string[];
  prohibitedSubstitutes?: readonly Native44WidgetType[];
}

const responsibilities = {
  'page-heading': { status:'native-candidate', candidates:['heading','wd_title'], dependencies:[], requiredEvidence:['来源标题、层级和所属区域'], restrictions:['当前页面上下文标题与静态编辑标题必须区分'], referenceOnlyWidgets:[] },
  'body-content': { status:'native-candidate', candidates:['wd_text_block','text-editor'], dependencies:[], requiredEvidence:['来源正文与共同所有者'], restrictions:['说明和附注不统一转换为 Heading'], referenceOnlyWidgets:[] },
  'navigation-list': { status:'native-candidate', candidates:['wd_list','wd_extra_menu_list'], dependencies:[], requiredEvidence:['链接列表所有者、真实项目边界和目标链接'], restrictions:['普通导航链接不拆成按钮组'], referenceOnlyWidgets:[] },
  'image-card': { status:'native-candidate', candidates:['image-box'], dependencies:[], requiredEvidence:['图片、名称、说明和链接属于同一卡片'], restrictions:['多链接或特殊内容顺序采用组合时记录具体字段不足'], referenceOnlyWidgets:[] },
  'information-card': { status:'native-candidate', candidates:['wd_infobox','icon-box'], dependencies:[], requiredEvidence:['图片或图标、标题、说明及 CTA 的真实所有权'], restrictions:['组件内按钮仅对应真实 CTA'], referenceOnlyWidgets:[] },
  'marketing-products': { status:'context-dependent', candidates:['wd_products','woocommerce-products'], dependencies:['target-woocommerce','frozen-product-ids-and-order'], requiredEvidence:['目标现有商品集合、查询字段和实际卡片事实'], restrictions:['固定 ID 营销集合不证明当前分类筛选、分页或排序联动','不得把源站价格和优惠写到目标商品'], referenceOnlyWidgets:[] },
  'product-collection-tabs': { status:'context-dependent', candidates:['wd_products_tabs'], dependencies:['target-woocommerce','one-verified-query-per-tab'], requiredEvidence:['每个标签对应的真实目标商品集合及实际切换'], restrictions:['商品集合 Tabs 不等于单品说明、参数和评论 Tabs'], referenceOnlyWidgets:[] },
  'static-content-tabs': { status:'native-candidate', candidates:['nested-tabs'], dependencies:['registered-nested-child-contract'], requiredEvidence:['独立静态内容面板和标题的共同所有权'], restrictions:['静态内容 Tabs 不能冒充当前商品动态详情或评论'], referenceOnlyWidgets:[] },
  'breadcrumb': { status:'context-dependent', candidates:['wd_wc_breadcrumb','wd_element_breadcrumbs','breadcrumbs'], dependencies:['existing-provider','actual-page-context'], requiredEvidence:['当前真实页面/分类/商品上下文和已注册提供器'], restrictions:['普通草稿不能仅凭源路径或标题获得商品/分类上下文'], referenceOnlyWidgets:[] },
  'existing-sidebar': { status:'context-dependent', candidates:['wd_sidebar'], dependencies:['existing-target-sidebar'], requiredEvidence:['目标已有 Sidebar 身份、内容和实际渲染'], restrictions:['侧栏存在不证明它能驱动本页商品结果筛选','不得新建或复制业务 Sidebar 资源'], referenceOnlyWidgets:[] },
  'archive-results': { status:'capability-gap', candidates:[], dependencies:['current-archive-query','term-and-query-context','filter-sort-pagination-state'], requiredEvidence:['来源实际归档查询的所有者、结果集和查询状态变化'], restrictions:['当前工具仅写普通自有草稿，未实现 archive template/query 交付','不能用冻结 ID 的 wd_products 或 woocommerce-products 冒充分类结果'], referenceOnlyWidgets:['wd_archive_products'], prohibitedSubstitutes:['wd_products','woocommerce-products','wd_products_tabs'] },
  'archive-filters': { status:'capability-gap', candidates:[], dependencies:['existing-target-filters','current-archive-query','filter-result-linkage'], requiredEvidence:['过滤控件与实际归档结果共同上下文及筛选后结果变化'], restrictions:['静态按钮、手风琴或已有 Sidebar 外观不能证明筛选功能','当前普通草稿不建立归档筛选联动'], referenceOnlyWidgets:['wd_builder_off_canvas_column_btn'], prohibitedSubstitutes:['button','wd_button','nested-accordion','wd_sidebar'] },
  'archive-toolbar': { status:'capability-gap', candidates:[], dependencies:['current-archive-query','ordering-pagination-view-contract'], requiredEvidence:['每页数量、视图和排序控制对真实结果的影响'], restrictions:['不创建只有外观的选择框、数量或排序按钮','专用工具栏控件只作研究参考，不进入固定44写入器'], referenceOnlyWidgets:['wd_shop_archive_per_page','wd_shop_archive_view','wd_shop_archive_orderby'] },
  'single-product-gallery': { status:'capability-gap', candidates:[], dependencies:['current-product','product-media-variation-context'], requiredEvidence:['当前真实商品媒体、缩略图、变体与选中状态'], restrictions:['普通图片/轮播仅能参考构图，不能证明商品图库或变体联动','当前工具未实现单品模板交付'], referenceOnlyWidgets:['wd_single_product_gallery'], prohibitedSubstitutes:['wd_image_or_svg','nested-carousel','slides'] },
  'single-product-title': { status:'capability-gap', candidates:[], dependencies:['current-product'], requiredEvidence:['当前商品记录与动态标题绑定'], restrictions:['源标题不能静态写成目标商品标题','普通 heading 不代替未实现的当前商品动态绑定'], referenceOnlyWidgets:['wd_single_product_title'], prohibitedSubstitutes:['heading','wd_title','wd_text_block','text-editor'] },
  'single-product-rating': { status:'capability-gap', candidates:[], dependencies:['current-product','actual-product-reviews'], requiredEvidence:['当前商品真实评分及评论关联'], restrictions:['图标、营销评价或来源星级不能冒充当前商品评分'], referenceOnlyWidgets:['wd_single_product_rating'], prohibitedSubstitutes:['icon','wd_testimonials','wd_text_block'] },
  'single-product-price': { status:'capability-gap', candidates:[], dependencies:['current-product','variation-and-sale-price-state'], requiredEvidence:['当前商品实际价格、货币、变体及促销状态'], restrictions:['禁止用正文、HTML 或伪元素静态补价格','商品集合查询不能充当当前商品价格字段'], referenceOnlyWidgets:['wd_single_product_price'], prohibitedSubstitutes:['text-editor','wd_text_block','heading','html','wd_products'] },
  'single-product-purchase': { status:'capability-gap', candidates:[], dependencies:['current-product','variation-selection','stock-and-cart-service'], requiredEvidence:['目标真实购买表单、变体、库存和购物车合同'], restrictions:['普通 Button/form/HTML 不能冒充加入购物车','研究和只读比较不加入购物车或提交业务表单'], referenceOnlyWidgets:['wd_single_product_add_to_cart','wd_wc_notices','wd_price_tracker'], prohibitedSubstitutes:['button','wd_button','form','html'] },
  'single-product-tabs': { status:'capability-gap', candidates:[], dependencies:['current-product','product-description-attributes-reviews'], requiredEvidence:['当前商品详情、属性与评论面板的实际提供器和数据'], restrictions:['wd_products_tabs 是商品集合查询，不是单品详情 Tabs','静态 nested-tabs 外观不证明商品详情动态绑定'], referenceOnlyWidgets:['wd_single_product_tabs'], prohibitedSubstitutes:['wd_products_tabs','nested-tabs'] },
  'single-product-reviews': { status:'capability-gap', candidates:[], dependencies:['current-product','actual-product-reviews','review-form-service'], requiredEvidence:['真实评论集合与当前商品所有权'], restrictions:['wd_testimonials 不能冒充 WooCommerce 商品评论','不复制评论、不发送评论或创建业务记录'], referenceOnlyWidgets:['wd_single_product_reviews'], prohibitedSubstitutes:['wd_testimonials','form','text-editor'] },
  'single-product-navigation': { status:'capability-gap', candidates:[], dependencies:['current-product','actual-adjacent-product-query'], requiredEvidence:['相邻商品查询、顺序与真实链接'], restrictions:['普通链接列表不能假称动态前后商品导航'], referenceOnlyWidgets:['wd_single_product_nav'], prohibitedSubstitutes:['wd_list','button','wd_button'] },
  'single-product-compare-action': { status:'capability-gap', candidates:[], dependencies:['current-product','existing-compare-service'], requiredEvidence:['当前商品与比较动作、状态的真实绑定'], restrictions:['wd_compare 显示比较内容，不是单品加入比较按钮','普通按钮不得伪装比较动作'], referenceOnlyWidgets:['wd_single_product_compare_button'], prohibitedSubstitutes:['wd_compare','button','wd_button'] },
  'single-product-wishlist-action': { status:'capability-gap', candidates:[], dependencies:['current-product','existing-wishlist-service'], requiredEvidence:['当前商品与愿望清单动作、状态的真实绑定'], restrictions:['wd_wishlist 显示清单内容，不是单品收藏按钮','普通按钮不得伪装收藏动作'], referenceOnlyWidgets:['wd_single_product_wishlist_button'], prohibitedSubstitutes:['wd_wishlist','button','wd_button'] },
  'compare-content': { status:'context-dependent', candidates:['wd_compare'], dependencies:['existing-compare-service','comparison-page-context'], requiredEvidence:['目标已启用比较服务和当前内容上下文'], restrictions:['清单/比较内容与单品动作分开处理'], referenceOnlyWidgets:[] },
  'wishlist-content': { status:'context-dependent', candidates:['wd_wishlist'], dependencies:['existing-wishlist-service','wishlist-page-context'], requiredEvidence:['目标已启用愿望清单服务和当前内容上下文'], restrictions:['清单内容与单品收藏按钮分开处理'], referenceOnlyWidgets:[] },
  'social-links': { status:'native-candidate', candidates:['wd_social_buttons','social-icons'], dependencies:[], requiredEvidence:['真实社交链接或来源明确的分享入口'], restrictions:['分享页面上下文与固定社交主页链接需分别记录'], referenceOnlyWidgets:[] },
} as const satisfies Record<string,ResponsibilityRule>;

export type Native44ContextResponsibility = keyof typeof responsibilities;
const pageRules = {
  landing:{ requiredEvidence:['来源整页主要模块与内容归属','商品集合与静态营销卡分别识别'], responsibilities:['page-heading','body-content','navigation-list','image-card','information-card','marketing-products','product-collection-tabs','social-links'], limits:['仅交付普通自有草稿，不修改公共首页或共享主题区域'] },
  archive:{ requiredEvidence:['来源实际分类/商店归档结果所有者','观察到的查询、筛选、分页和排序上下文'], responsibilities:['page-heading','body-content','breadcrumb','navigation-list','existing-sidebar','archive-filters','archive-toolbar','archive-results','marketing-products','static-content-tabs'], limits:['归档正文、共享页头/页脚和独立营销商品区分别归属','当前工具未实现真实 archive template/query 交付，核心能力缺口必须保留'] },
  'single-product':{ requiredEvidence:['来源当前商品主要所有者','图库、标题、价格、购买和详情与同一商品记录的关系'], responsibilities:['breadcrumb','single-product-navigation','single-product-gallery','single-product-title','single-product-rating','single-product-price','single-product-purchase','single-product-tabs','single-product-reviews','single-product-compare-action','single-product-wishlist-action','image-card','information-card','body-content','social-links','marketing-products'], limits:['商品详情、推荐商品和共享页脚分别归属','当前工具未实现真实 single-product template/record binding 交付，普通草稿不能冒充单品模板'] },
  unresolved:{ requiredEvidence:['补齐实际来源所有者、查询和当前记录上下文'], responsibilities:[], limits:['不能凭 URL、域名、品牌、商品 ID 或模板名称猜页面类型','上下文不明确时记录具名缺口，不自动按首页或商品页降级'] },
} as const satisfies Record<Native44PageRole,{requiredEvidence:readonly string[];responsibilities:readonly Native44ContextResponsibility[];limits:readonly string[]}>;

/** Hash this rule layer alongside semantic selection rules; it adds knowledge,
 * never widget identities, data binding adapters or template write permission. */
export const NATIVE44_PAGE_CONTEXT_RULES = {
  version:1,
  roleIdentification:['actual-source-ownership','observed-query-context','current-record-context'],
  writeBoundary:'owned-draft-page-only',
  supportsArchiveTemplate:false,
  supportsSingleProductTemplate:false,
  outside44Policy:'reference-only-never-discover-compile-or-write',
  responsibilities,
  pages:pageRules,
  containers:{
    retainFor:['visual-module-ownership','independent-grid-flex-layout','centered-max-width','independent-background-padding','repeated-card-ownership','registered-nested-child-contract'],
    removeOnlyWith:['plan-wrapper-has-no-layout-or-ownership-responsibility','no-registered-child-contract-dependency','preserve-effective-spacing-and-flow'],
    forbiddenHeuristics:['one-container-per-leaf','dom-wrapper-count-equals-elementor-containers','delete-by-depth-or-layer-count'],
  },
} as const;

export function native44ContextResponsibilityAdvice(role:Native44ContextResponsibility){
  const rule:ResponsibilityRule|undefined=responsibilities[role];if(!rule)throw Error(`Unknown native44 content responsibility: ${String(role)}`);
  rule.candidates.forEach(assertAllowedWidget);rule.prohibitedSubstitutes?.forEach(assertAllowedWidget);
  return{role,...structuredClone(rule),writeBoundary:NATIVE44_PAGE_CONTEXT_RULES.writeBoundary};
}

/** Call after observing source ownership/query context; this function does not
 * infer role from a URL or turn a recommendation into runtime evidence. */
export function native44PageContextAdvice(pageRole:Native44PageRole,extension?:FileRef){
  const page=pageRules[pageRole];if(!page)throw Error(`Unknown native44 page role: ${String(pageRole)}`);
  if(extension){assertProductExtensionReference(extension);if(pageRole==='single-product')return {pageRole,version:NATIVE44_PAGE_CONTEXT_RULES.version,writeBoundary:'owned-native-product-template-only',supportsArchiveTemplate:false,supportsSingleProductTemplate:true,componentExtension:extension,requiredEvidence:[...page.requiredEvidence,'fresh-current-product-and-native-template-proof'],limits:['No existing products, pages or global display conditions may be changed','One native current-record and purchase/review owner shared across devices'],responsibilities:page.responsibilities.map(role=>{const advice=native44ContextResponsibilityAdvice(role);const candidates=advice.referenceOnlyWidgets.filter(type=>/^wd_single_product_/.test(type)&&!/_nav$|_button$/.test(type));return candidates.length?{...advice,status:'context-dependent',candidates,referenceOnlyWidgets:[],restrictions:['Native template/current product proof and actual task render are required']}:advice;})};}
  return{pageRole,version:NATIVE44_PAGE_CONTEXT_RULES.version,writeBoundary:NATIVE44_PAGE_CONTEXT_RULES.writeBoundary,supportsArchiveTemplate:false as const,supportsSingleProductTemplate:false as const,requiredEvidence:[...page.requiredEvidence],limits:[...page.limits],responsibilities:page.responsibilities.map(native44ContextResponsibilityAdvice)};
}

export type Native44ContainerPurpose = 'visual-module-ownership'|'independent-grid-flex-layout'|'centered-max-width'|'independent-background-padding'|'repeated-card-ownership'|'registered-nested-child-contract';
export function native44ContainerAdvice(input:{purpose?:Native44ContainerPurpose;evidence?:readonly string[];runtimeDomWrapperOnly?:boolean;duplicatesParent?:boolean}){
  if(input.runtimeDomWrapperOnly)return{decision:'not-an-elementor-container' as const,reason:'运行时 DOM wrapper 属于控件内部实现；不能据此增加或删除 Elementor 容器。'};
  if(input.purpose&&!NATIVE44_PAGE_CONTEXT_RULES.containers.retainFor.includes(input.purpose))throw Error(`Unknown native44 container purpose: ${String(input.purpose)}`);
  if(input.purpose&&input.evidence?.some(value=>value.trim()))return{decision:'retain' as const,reason:input.purpose==='registered-nested-child-contract'?'保留实际注册嵌套合同要求的直接子容器。':'保留具有独立布局、内容归属或视觉边界职责的计划容器。'};
  if(input.duplicatesParent)return{decision:'review-redundant-plan-wrapper' as const,reason:'仅在确认没有布局/所有权职责、嵌套合同依赖且保持间距与自然流后，移除计划中的冗余包层。'};
  return{decision:'needs-evidence' as const,reason:'先证明容器的布局、限宽、背景、卡片归属或嵌套合同职责；不按层数或叶子数量自动包层/删除。'};
}

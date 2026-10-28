import { assertKnownNativeWidget as assertAllowedWidget, CORE_SINGLE_PRODUCT_TYPES, type Native44WidgetType } from './catalog.js';

export type Native44NestedRelation =
  | { policy: 'repeater'; childType: 'container'; repeaterKey: string; titleSettingKey: string }
  | { policy: 'fixed'; childType: 'container'; count: number; childSettings: Record<string, unknown> };
export interface Native44Usage {
  suitableFor: string[];
  unsuitableFor: string[];
  contentModel: 'settings' | 'repeater' | 'nested-repeater' | 'nested-fixed' | 'products' | 'product-tabs' | 'resource-query' | 'container' | 'html';
  primaryContentFields: string[];
  repeaterKeys: string[];
  resourceDependencies: string[];
  panelEditing: string;
  pageCss: string;
  interactionRequirements: string[];
  nested?: Native44NestedRelation;
  queryAdapter?: 'wd_products' | 'woocommerce-products' | 'wd_products_tabs';
  restrictions: string[];
}
type Recipe = Partial<Native44Usage> & Pick<Native44Usage, 'suitableFor' | 'primaryContentFields'>;
const rows: Record<Native44WidgetType, Recipe> = {
  'text-editor': { suitableFor: ['正文', '多段富文本'], primaryContentFields: ['editor'] },
  html: { suitableFor: ['有原生能力不足证据的局部静态内容'], primaryContentFields: ['html'], contentModel: 'html', restrictions: ['必须先记录原生候选和具体不适用证据', '禁止普通标题、单图和图文卡片整体转 HTML', '仅接受已验证模板与槽位产物'] },
  heading: { suitableFor: ['标题', '标题链接'], primaryContentFields: ['title', 'link'] },
  'woocommerce-products': { suitableFor: ['现有 WooCommerce 商品集合'], primaryContentFields: ['query_post_type', 'query_posts_ids'], contentModel: 'products', queryAdapter: 'woocommerce-products', resourceDependencies: ['products', 'woocommerce'] },
  wd_nested_carousel: { suitableFor: ['包含任意原生内容的幻灯片'], primaryContentFields: ['slides'], contentModel: 'nested-repeater', nested: { policy: 'repeater', childType: 'container', repeaterKey: 'slides', titleSettingKey: 'slide_title' }, interactionRequirements: ['至少两个实际项目切换', '箭头、分页、逻辑项目同步', '暂停控制或明确手动轮播适配'] },
  wd_text_block: { suitableFor: ['正文', '带排版设置的富文本'], primaryContentFields: ['text'] },
  slides: { suitableFor: ['图片背景、标题、说明和按钮的幻灯片'], primaryContentFields: ['slides'], contentModel: 'repeater', interactionRequirements: ['至少两个实际项目切换', '箭头与分页同步', '暂停控制或手动轮播适配'] },
  wd_products_tabs: { suitableFor: ['多个真实商品查询的标签集合'], primaryContentFields: ['title', 'description', 'tabs_items'], contentModel: 'product-tabs', queryAdapter: 'wd_products_tabs', resourceDependencies: ['products', 'woocommerce'], interactionRequirements: ['每个标签实际查询及集合切换', '不得复用其它标签的查询证明'] },
  wd_products_brands: { suitableFor: ['目标现有品牌目录'], primaryContentFields: ['ids', 'number'], contentModel: 'resource-query', resourceDependencies: ['productBrands'], unsuitableFor: ['源站静态品牌营销卡片'] },
  wd_products: { suitableFor: ['目标现有商品集合或商品轮播'], primaryContentFields: ['post_type', 'include', 'items_per_page'], contentModel: 'products', queryAdapter: 'wd_products', resourceDependencies: ['products', 'woocommerce'] },
  wd_blog: { suitableFor: ['目标现有文章查询'], primaryContentFields: ['post_type', 'include', 'items_per_page'], contentModel: 'resource-query', resourceDependencies: ['posts'] },
  wd_button: { suitableFor: ['按钮', '文本链接'], primaryContentFields: ['text', 'link'] },
  wd_wc_breadcrumb: { suitableFor: ['WooCommerce 上下文面包屑'], primaryContentFields: [], resourceDependencies: ['woocommerce', 'page-context'] },
  wd_image_or_svg: { suitableFor: ['普通图片', 'Logo', '已有安全 SVG'], primaryContentFields: ['image', 'link'] },
  accordion: { suitableFor: ['富文本折叠列表'], primaryContentFields: ['tabs'], contentModel: 'repeater', interactionRequirements: ['各项目展开、折叠及键盘操作'] },
  wd_title: { suitableFor: ['组合主副标题', '标题后的说明'], primaryContentFields: ['subtitle', 'title', 'after_title'] },
  wd_contact_form_7: { suitableFor: ['已有 Contact Form 7 表单'], primaryContentFields: ['form_id'], contentModel: 'resource-query', resourceDependencies: ['contactForms', 'contact-form-7'], restrictions: ['不能填假 ID 或创建表单', '研究与比较不得提交邮件或业务数据'] },
  wd_product_categories: { suitableFor: ['目标现有商品分类目录'], primaryContentFields: ['ids', 'number'], contentModel: 'resource-query', resourceDependencies: ['productCategories'], unsuitableFor: ['与目标分类无关的源站静态分类营销卡'] },
  wd_testimonials: { suitableFor: ['有来源的评价卡片集合'], primaryContentFields: ['items_repeater'], contentModel: 'repeater', interactionRequirements: ['轮播模式须实际多项切换'] },
  wd_banner_carousel: { suitableFor: ['图文促销横幅轮播'], primaryContentFields: ['content_repeater'], contentModel: 'repeater', interactionRequirements: ['实际多项切换', '箭头、分页与逻辑项目同步'] },
  wd_wishlist: { suitableFor: ['目标现有愿望清单服务'], primaryContentFields: [], resourceDependencies: ['wishlist-context'], restrictions: ['真实服务须已启用；不能由静态外观证明服务有效'] },
  wd_page_heading: { suitableFor: ['使用当前页面上下文的页标题'], primaryContentFields: [], resourceDependencies: ['page-context'] },
  wd_compare: { suitableFor: ['目标现有商品比较服务'], primaryContentFields: [], resourceDependencies: ['compare-context'], restrictions: ['旧实验中无适用运行证明，使用前须验证现有上下文'] },
  wd_element_breadcrumbs: { suitableFor: ['主题页面上下文面包屑'], primaryContentFields: [], resourceDependencies: ['page-context'] },
  wd_infobox_carousel: { suitableFor: ['信息卡片轮播'], primaryContentFields: ['content_repeater'], contentModel: 'repeater', interactionRequirements: ['实际多项切换', '箭头、分页与逻辑项目同步'] },
  wd_infobox: { suitableFor: ['图文信息卡片', '服务卡', '图标和按钮卡片'], primaryContentFields: ['image', 'subtitle', 'title', 'content', 'btn_text', 'link'] },
  wd_extra_menu_list: { suitableFor: ['多组导航链接', '带图标的菜单列表'], primaryContentFields: ['title', 'link', 'menu_items_repeater'], contentModel: 'repeater' },
  wd_sidebar: { suitableFor: ['目标已有 Sidebar'], primaryContentFields: ['sidebar_name'], contentModel: 'resource-query', resourceDependencies: ['sidebars'], restrictions: ['旧实验缺少适用 Sidebar；必须验证目标已有资源'] },
  wd_counter: { suitableFor: ['有来源的数字计数及说明'], primaryContentFields: ['start_value', 'value', 'label'], interactionRequirements: ['计数触发及结束值'] },
  wd_list: { suitableFor: ['图标、图片和普通链接列表'], primaryContentFields: ['list_items'], contentModel: 'repeater' },
  wd_social_buttons: { suitableFor: ['社交链接', '已有页面分享入口'], primaryContentFields: ['type', 'fb_link', 'twitter_link', 'isntagram_link', 'youtube_link'] },
  'nested-tabs': { suitableFor: ['含原生内容的标签页'], primaryContentFields: ['tabs'], contentModel: 'nested-repeater', nested: { policy: 'repeater', childType: 'container', repeaterKey: 'tabs', titleSettingKey: 'tab_title' }, interactionRequirements: ['标签、面板对应及键盘切换'] },
  'nested-accordion': { suitableFor: ['含原生内容的折叠项目'], primaryContentFields: ['items'], contentModel: 'nested-repeater', nested: { policy: 'repeater', childType: 'container', repeaterKey: 'items', titleSettingKey: 'item_title' }, interactionRequirements: ['标题、面板对应和展开状态'] },
  'social-icons': { suitableFor: ['社交图标链接'], primaryContentFields: ['social_icon_list'], contentModel: 'repeater' },
  icon: { suitableFor: ['单个图标及链接'], primaryContentFields: ['selected_icon', 'link'] },
  'image-box': { suitableFor: ['图片、标题及说明卡片'], primaryContentFields: ['image', 'title_text', 'description_text', 'link'] },
  wd_toggle: { suitableFor: ['单个开关控制的嵌套内容'], primaryContentFields: ['element_title', 'state'], contentModel: 'nested-fixed', nested: { policy: 'fixed', childType: 'container', count: 1, childSettings: { content_width: 'full' } }, interactionRequirements: ['唯一内容容器与各设备默认开关状态'] },
  'icon-box': { suitableFor: ['图标、标题及说明卡片'], primaryContentFields: ['selected_icon', 'title_text', 'description_text', 'link'] },
  breadcrumbs: { suitableFor: ['已启用的 SEO 插件页面面包屑'], primaryContentFields: [], resourceDependencies: ['seo-breadcrumb-provider', 'page-context'], restrictions: ['本地源文件与旧运行身份存在不同提供器，须以当前真实注册类型验证', '无真实上下文不可假装完成'] },
  form: { suitableFor: ['已明确授权的表单结构'], primaryContentFields: ['form_fields', 'button_text'], contentModel: 'repeater', resourceDependencies: ['form-action-configuration'], restrictions: ['不带入旧实验收件人、API Key、Webhook 或默认动作', '研究与比较不得触发表单提交'] },
  'nested-carousel': { suitableFor: ['含任意原生内容的幻灯片'], primaryContentFields: ['carousel_items'], contentModel: 'nested-repeater', nested: { policy: 'repeater', childType: 'container', repeaterKey: 'carousel_items', titleSettingKey: 'slide_title' }, interactionRequirements: ['实际多项切换', '箭头、分页与逻辑项目同步', '暂停控制或手动轮播适配'] },
  button: { suitableFor: ['按钮', '普通文字链接'], primaryContentFields: ['text', 'link'] },
  divider: { suitableFor: ['装饰分隔线', '带文字的分隔线'], primaryContentFields: ['separator_type', 'text'] },
  container: { suitableFor: ['Grid 和 Flex 布局', '视觉模块及普通组合'], primaryContentFields: [], contentModel: 'container' },
};
export function native44Usage(type: string, repeaterKeys: string[] = []): Native44Usage {
  assertAllowedWidget(type);
  const row = (rows as Record<string,Recipe>)[type] ?? ((CORE_SINGLE_PRODUCT_TYPES as readonly string[]).includes(type) || type === 'woocommerce-product-related' ? { suitableFor: ['当前商品原生字段与服务'], primaryContentFields: [], contentModel: 'resource-query' as const, resourceDependencies: ['current-product'], restrictions: ['同一已绑定原生商品文档；数据来自当前 WooCommerce 商品，不静态替代'] } : undefined);
  return {
    unsuitableFor: ['需要未验证业务服务或来源事实的内容'],
    contentModel: 'settings', repeaterKeys,
    resourceDependencies: [], panelEditing: '文字、图片、链接及项目通过各自真实面板字段编辑',
    pageCss: '尺寸、排版、间距、颜色和断点样式可统一交付到页面 CSS；内容留在面板字段',
    interactionRequirements: [], restrictions: [], ...row,
  };
}

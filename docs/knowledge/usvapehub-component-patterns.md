# Usvapehub 三页：实例观察档案

本文保留组件字段、结构、截图和操作状态，供需要时查证；不作为新增通用经验清单。与原有知识对照后，本批只细化了两处已有规则，没有形成新的顶层原则。统一经验见 [Elementor 组件与容器通用知识](D:/cloneWP/docs/knowledge/elementor-container-patterns.md)。

## 证据范围

本批于 2026-10-16 读取用户已打开的三个 Elementor 编辑页：首页正文 `27`、商品归档模板 `11727`、单品模板 `776`。依据是预览 DOM 的 `data-element_type` / `data-widget_type`、Navigator、现有面板控件值，以及本批截图。共享页脚 `308` 与正文分开统计。网站文本只作观察证据。

这是页面实例形成的规划经验。控件出现、现有内容可见与当前字段值，分别不能代替组件注册合同、保存、呈现或交互资格；本批没有保存、发布或提交业务表单。下面的数量、尺寸和开关只描述该实例，不作为新站默认值。

| 页面 | 正文结构统计 | 结构证据 | DOM 与截图 |
| --- | --- | --- | --- |
| 首页 | 11 Container、15 Widget，共 26 节点 | [实际树](D:/cloneWP/references/usvapehub-learning-20261016/home-instance-tree.json) | [DOM](D:/cloneWP/references/usvapehub-learning-20261016/home/raw-dom.json)、[截图](D:/cloneWP/references/usvapehub-learning-20261016/home/screenshot.jpg) |
| 商品归档 | 9 Container、9 Widget、1 Section、1 Column，共 20 节点 | [实际树](D:/cloneWP/references/usvapehub-learning-20261016/archive-instance-tree.json) | [DOM](D:/cloneWP/references/usvapehub-learning-20261016/archive/raw-dom.json)、[截图](D:/cloneWP/references/usvapehub-learning-20261016/archive/screenshot.jpg) |
| 单品 | 9 Container、21 Widget，共 30 节点 | [实际树](D:/cloneWP/references/usvapehub-learning-20261016/single-instance-tree.json) | [DOM](D:/cloneWP/references/usvapehub-learning-20261016/single/raw-dom.json)、[截图](D:/cloneWP/references/usvapehub-learning-20261016/single/screenshot.jpg) |

以上为正文逻辑节点，未把 Swiper 克隆、`.e-con-inner`、图片或商品卡内部 DOM 计为 Elementor Container。截图与几何的捕获范围分别保存在各页 `capture-context.json`，不能把单张当前视口截图当作整页像素覆盖。

## 1. 先判断编辑模型，再选择轮播

首页在同一页面使用了两种不同模型。

| 用途 | 实际 Widget | 内容编辑归属 | 可复用判断 |
| --- | --- | --- | --- |
| 公告条 | `wd_nested_carousel`，节点 `a2123f5` | 3 个真实子 Container，各含一个 `wd_text_block` | 每项有独立原生内容时，分别编辑 slide 内的内容节点；父组件负责项目集合与轮播行为 |
| 主广告 | `slides`，节点 `be9b5d8` | 3 个 Repeater 项；Widget 下没有 Elementor 子 Container | 背景、文案槽和链接属于 Repeater 项；不要为每个运行时 slide 人工补逻辑 Container |

公告条面板能看到项目列表；每项实际文本位于 Navigator 的子容器里。其样式面板当前为每屏 1 项、间距 30px、自动播放开启、`speed=1500`。这些是该轮播的实例设置，不能把同名或近似字段直接套到经典 Slides。[项目证据](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-a2123f5-content.json)、[轮播设置](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-a2123f5-style.json)。

主广告首项的标题、描述和按钮文字为空，链接作用于整个幻灯片，背景尺寸为 `cover`。因此，图中已有文案不能再按截图文字重复叠加为标题或按钮。图片内容、裁切方式、点击范围必须分别核对。该项链接 URL 仅为来源实例证据，新任务需重新映射。[背景面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-be9b5d8-first-slide.json)、[内容与链接面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-be9b5d8-first-slide-content.json)。

主广告高度当前为 `60vh`，同时开启箭头与圆点、自动播放、悬停暂停、交互暂停及无限循环。面板分别显示自动播放间隔 `5000`、过渡速度 `500`；不能将两个速度字段当成同一参数，也不能仅凭开关宣称暂停或切换行为已测试通过。[高度](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-be9b5d8-content.json)、[轮播选项](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-be9b5d8-slider-options.json)。

本次 DOM 中主广告有 9 个运行时 slide：3 个逻辑项与 6 个 `swiper-slide-duplicate` 克隆，重复的 `data-swiper-slide-index` 为 `0/1/2`。内容数量按逻辑项统计；显示位置与截图归属仍保留各次出现。不能按 9 个运行时节点推断 9 份内容或 9 个 Container。具体运行时事实见首页 `raw-dom.json` 的 `runtimeSlides`。

## 2. 容器参数与最终几何分开记录

首页广告外容器 `7e66faa` 使用 Flexbox、盒式内容、`boxed_width=90%`，方向为 column；内部 Slides 自己负责 `60vh` 高度。外层限宽和组件内容高度有各自所有者，不能用一个固定像素盒替代两者。[布局面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-7e66faa-layout.json)。

此容器的 margin、padding、gap 数值在面板中为空，单位显示 px。空值不等于显式 `0`；面板未选中的对齐或换行项也不等于已明确指定某个值。浏览器最终计算出的 `0px`、默认 gap 或 wrapper 宽度属于另一层观察，应同时保留原始控件状态与计算样式。[高级面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-7e66faa-advanced.json)、[当前计算样式](D:/cloneWP/references/usvapehub-learning-20261016/home/raw-dom.json)。

读取 Flexbox 几何时，应确认实际内容 wrapper。`.e-con-inner` 可以承担限宽、方向与间距，但它不是新增的 Elementor Container。组件层级依据真实元素身份，视觉布局依据真正承载内容的节点。

## 3. 首页商品标签：每个 Tab 都有独立查询

首页 `9ba0737` 是 `wd_products_tabs`。三个标签的显示名称是 GEEK BAR、Foger、lost mary；每个项目的查询面板分别选中了对应商品分类，数据来源均为 `product`。标签文字与筛选条件是不同字段，必须逐项读取，不能由显示名称推断查询。

- [GEEK BAR 查询](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-9ba0737-tab-geek.json)
- [Foger 查询](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-9ba0737-tab-foger.json)
- [lost mary 查询](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-9ba0737-tab-lost-mary.json)

该集合当前布局为 carousel，`items_per_page=12`，每屏数量为 4，按页滚动开启。这里至少有三个独立概念：查询/展示集合数量、每屏可见项数、滚动步进。分页、循环、自动播放与箭头又是独立设置，不能用一个“4 列轮播”概括全部行为。[商品布局](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-9ba0737-product-layout.json)、[轮播设置](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-9ba0737-carousel.json)。

首页另一个商品区上方写着 “SHOP 420 PRODUCTS”，但其 `909265e` 查询面板为所有产品，分类选择为空。区块标题不能证明筛选已经存在；需要的业务集合应由查询证据确认。这里不据此判定站点故障，也不把来源集合照搬到新站。[实际查询](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-909265e-products-query.json)。

## 4. 品牌、文章与正文各有数据边界

品牌区使用 `wd_products_brands`，不是静态图片拼接。当前品牌选择列表为空、数量为空，排序显示空值或继承；“隐藏空品牌”“按当前分类过滤”“禁用链接”均未勾选。面板只证明这些控件状态，不能把空值推成“没有品牌”。实际截图输出多行品牌 Logo，而 `textContent` 主要只出现 MI-POD PRO；纯文字提取不足以判断图片型内容的数量。[面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-4c0b15d-brands.json)、[截图](D:/cloneWP/references/usvapehub-learning-20261016/home/screenshot.jpg)。

文章区使用 `wd_blog`，当前数据来源为文章、排序方向为 DESC，分类和排除项为空，排序依据为空。应分别核对内容类型、筛选、排序字段和方向；“降序”本身不足以证明按发布日期排序。[文章查询面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/home-77085f7-blog.json)。

首页底部存在一个 HTML Widget 与独立 `wd_button`。这是已有实例的结构事实，不能由此授予新任务大段 HTML 使用权限。新建内容仍需按实际编辑粒度和组件能力选择原生方案；按钮文字存在也不能证明它具有某种展开交互。

## 5. 归档页：查询所有者与布局所有者分别识别

归档主体 `d2e9fc9` 为横向 Flexbox，包含侧栏列与结果列。结果列内继续分为工具栏和 `wd_archive_products`。这类层级分别承担整行、左右列、工具栏分组和结果区域职责，不应只按层数机械合并。

| 所有者 | 本例面板值 | 使用时的限定 |
| --- | --- | --- |
| 外行 `d2e9fc9` | row、盒式内容；gap 两方向 30px；盒式宽度数值为空 | 未取得显式宽度，不补填历史默认 |
| 侧栏列 `9350c14` | full、width 25% | 与右列宽度和父级 gap 一起判断实际几何 |
| 结果列 `46090a9` | full、width 75% | 25%+75% 不保证最终像素恰占满；还受 Flex 收缩等计算影响 |

证据：[外行](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-d2e9fc9-outer-layout.json)、[侧栏列](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-9350c14-left-layout.json)、[结果列](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-46090a9-right-layout.json)。

`wd_sidebar` 的预览文字为空，但面板实际选中“商店页面小工具区域”（`sidebar-shop`）。因此不能写成“未选择 Sidebar”或直接补一个分类列表；资源绑定与当前是否渲染内容需要各自证据。[侧栏面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-0221ab3-sidebar.json)。该标识属于来源网站，不进入可复用默认值。

工具栏中每页数量、视图切换、排序与归档结果是不同 Widget。每页数量选项当前为 `9,12,18,24`；`wd_archive_products` 的视图、hover、列数与间距均选择“继承自主题设置”。继承不代表无功能，也不能通过当前截图的列数反写成组件显式设置。[每页数量](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-52c5559-per-page.json)、[归档商品面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-c3d47e1-archive-products.json)。

归档后的 `wd_products` 当前为 `recently_viewed`，AJAX 最近浏览开关开启，预览文字为空。它是附加的最近浏览集合，不是归档主查询，也不能因这次为空而判为组件缺失。实际返回仍取决于用户状态与目标运行环境。[附加集合面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/archive-d376b31-secondary-products.json)。

## 6. 旧 Section/Column 与 Container 可以共存

归档底部说明内容为 `Section 32a4f90 → Column dcfc411 → text-editor ee4d516`，与上方 Container 树并存。Section、Column 应保持各自真实身份，不混入 Container 数量；学习已有结构不等于授权迁移布局。

标题为 “Shop Archive Layout - Yovo Jb50K” 或说明正文提及某产品，均不足以证明编辑器当前预览的商品查询、分类上下文或模板显示条件。应先核对页面上下文，再判断内容与查询是否一致；不能仅由模板名或编辑器样品判为线上分类错误。[归档结构](D:/cloneWP/references/usvapehub-learning-20261016/archive-instance-tree.json)、[当前预览 DOM](D:/cloneWP/references/usvapehub-learning-20261016/archive/raw-dom.json)。

## 7. 单品页：当前商品、服务卡与集合查询分组

主区 `3aad062` 是 row、盒式内容，gap 为 40px；图库列 `00280c0` 与摘要列 `f3c9fb1` 都是 full、width 50%、column。图库、标题、评分、价格、购买与详情通过专用单品 Widget 表达，不能把当前样品的商品名称、价格、评价和图像复制成固定业务内容。[主行](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-3aad062-main-layout.json)、[图库列](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-00280c0-gallery-layout.json)、[摘要列](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-f3c9fb1-summary-layout.json)。

摘要中的服务承诺是一个 row Container 内的 4 个 `image-box`。首卡现有标题为 “100% Authentic”、标题标签为 H3、图片分辨率 full，描述和链接为空。图片、标题、描述和链接分属组件槽位；服务卡可以有标题而没有跳转，不应自动变成按钮。只读取了首卡内容面板，不把其空链接推广为其它三卡的事实。[服务行](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-4c12e3a-service-layout-corrected.json)、[首卡](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-ba4e86b-service-card-corrected.json)。

比较、愿望清单、价格追踪、分享与配送说明位于另一组 Container；前三者有各自专用 Widget 身份。相似的按钮外观不能代替业务动作合同，也不能用普通按钮假定实现收藏或价格追踪。本批未触发这些动作。

倒计时 Widget `4203c6a` 存在但当前预览为空。正确面板只观察到标题、Labels 和 Separator，未取得促销日期字段及实际不显示原因。保留“当前空渲染、原因未验证”，不能断言由促销条件导致，也不能给组件补一份固定倒计时。[正确面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-4203c6a-countdown-corrected.json)。

## 8. 单品详情 Tabs 与商品集合 Tabs 不互换

单品节点 `855845b` 是 `wd_single_product_tabs`，当前布局为 tabs，描述与评论开启、附加信息关闭；面板还显示手机折叠开关开启。它组织当前商品的详情内容，首页 `wd_products_tabs` 则为每项配置独立商品查询。两者模型和数据归属不同。手机折叠只记录控件值，本批未做手机呈现或交互验证。[单品 Tabs 面板](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-855845b-product-tabs.json)。

单品后的两个 `wd_products` 进一步证明标题与数据来源需分别读取：

| 显示标题 | 实际 `post_type` | 可复用判断 |
| --- | --- | --- |
| Related Products | `related` | 是依赖当前单品上下文的相关集合 |
| Other Customers Also Bought These | `bestselling` | 当前是畅销集合；标题不足以证明同购算法、订单关系或个性化推荐 |

证据：[相关集合](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-2b369a8-related-query.json)、[畅销集合](D:/cloneWP/references/usvapehub-learning-20261016/panels/single-5f5bd3a-other-query.json)。新站的查询条件、真实数据与所需上下文必须重新适配。

## 9. 证据质量与未验证范围

以下三份最初面板捕获因选中对象不符而无效，已排除，不用于字段结论：`single-ba4e86b-service-card.json`、`single-4c12e3a-service-layout.json`、`single-4203c6a-countdown.json`。相应结论只引用 `-corrected.json`。面板标题、选中节点身份与预览元素应一致，文件名本身不能证明捕获对象。

观察中首页与单品编辑器曾出现发布按钮启用的未保存标志；仅打开旧控件面板期间出现，未输入参数，原因未证实。该标志不能用作网站已保存修改的证据，也不能被当作保存资格测试。临时编辑器状态的丢弃和最终读回应另行记录；本指南不凭初始按钮禁用状态推断结束状态。

结束读回：首页重新载入后预览与正文结构可读，但发布按钮仍启用；归档页预览可读且发布按钮禁用。单品页重载后预览为空，控制台出现 Elementor `editor-templates` 的 `selectEntities` 错误，末次 DOM 检查超时。没有输入参数、保存、发布或提交业务操作；不能宣称临时状态已清除、所有设置完全相等或编辑器已全面恢复。详见[最终编辑器状态](D:/cloneWP/references/usvapehub-learning-20261016/final-editor-state.json)。三页学习使用重载前已完整采集并查看的证据。

本批实际覆盖桌面实例结构、选定面板和当前 DOM/截图。没有为凑资格创建页面或业务记录，未认证保存往返、全部模式、轮播暂停/切换、排序筛选结果、加入购物车、评论、价格追踪或其它业务动作。目标注册、资源存在与业务上下文仍为任务级验证。

本地还对 `wd_image_or_svg`、`wd_title`、`wd_nested_carousel` 做过真实 PHP 字段研究，但三个学习预检均被现有静态验证器拒绝。`array(...)`、跨文件注入及间接常量未被当前证明流程覆盖，研究未发布为正式源码资格，也未修改验证器或启用集合。详见[源码预检记录](D:/cloneWP/references/elementor-learning-20261016-deeper/source-research/preflight-result.json)。不能用这份附加研究宣布新组件可生成。

## 10. 后续建站如何使用

历史页面模式仍可通过不可变记录及证据引用查证，但本批和首批的逐页候选都已归档。它们不再作为新建站自动展开的指导，也不会把本例尺寸、商品分类、资源 ID、URL 或开关覆盖到新页面。

统一整理后，新建复刻和原创都会直接读取统一指南全文及哈希，逐页候选不再自动展开。旧任务继续使用自己的冻结学习链，不会因本次整理自动迁移。新增经验也不扩大当前 43 Widget 加 1 Container 的执行集合，更不赋予普通草稿执行器归档或单品模板写入能力。

通用原则统一参照 [组件与学习规则](D:/cloneWP/COMPONENTS.md) 和[统一指南](D:/cloneWP/docs/knowledge/elementor-container-patterns.md)。本档案中的轮播、查询、继承/空值、混合布局及单品组件是具体例证。

本批曾追加 3 份页面模式记录，每份 6 条，共 18 条候选解释：[首页](D:/cloneWP/learning/learn-2a8327e5-fe7f-4b74-81c8-1a0641df6846/record.json)、[归档](D:/cloneWP/learning/learn-1aee0f1d-6ac6-4ed6-a10f-de126299a133/record.json)、[单品](D:/cloneWP/learning/learn-c5655cec-da44-413f-ba01-e20344eccc50/record.json)。用户指出重复与分寸问题后，逐项对照确认：8 项已有覆盖、7 项补充证据、2 处值得并入原有规则的细化、1 项样本采集事项；不能称为 18 个新通用经验。

本轮三份记录已从当前自动读取链撤回；其不可变历史与原始证据保留，旧任务冻结链不变。只将“原始参数含义与计算结果分开”“集合项数、每屏项数、切换步长分开”并入统一指南，未追加替代候选来凑数量。撤回及读回见[整理结果](D:/cloneWP/reports/usvapehub-learning-20261016/reconciliation-result.json)。[原发布验证](D:/cloneWP/reports/usvapehub-learning-20261016/knowledge-verification.json)仅记录撤回前的历史状态。

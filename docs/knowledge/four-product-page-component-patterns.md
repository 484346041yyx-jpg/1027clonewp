# 四站商品详情：组合、设置、商品绑定与手机实例档案

本档案整理 2026-10-26 本会话已完成的只读分析。用户授权将学习合并到本项目，不修改网站、商品、启用集合或执行适配器。通用细化已并入 [统一指南](D:/cloneWP/docs/knowledge/elementor-container-patterns.md) 原有第 1—5 节；本页和 [结构化实例摘要](D:/cloneWP/references/four-product-page-learning-20261026/observations.json) 仅按需查证，不是第二套自动加载的规则。这里的尺寸、开关、节点和商品/资源 ID 均是样本值，不能进入新页面默认配置。

## 证据等级及观察边界

- 来源：上轮 `cua_repl` 在用户 Chrome 中读取的 Elementor 初始文档配置、展开后的编辑模型、实际商品前台 DOM/计算样式、Swiper 运行时及实际查看过的截图；交互发生在代理创建的前台观察页，没有编辑原模板。
- 有效电脑观察宽度为 1920px、1440px，后续几何读回分别使用 1080px、1000px 高度；较早一组 1920px 捕获前三页高度为 855px，不能当作统一 1080px 捕获。手机为 390×844px 浏览器模拟，不是真机。
- 430px 补查因连接中断未取得证据；临时视口恢复及观察页关闭也未取得最终读回。没有验证全部触摸滑动、缩略图/缩放、暂停/循环、全部变体或全部设备分支。平板字段只表示保存/展开模型值，没有独立平板前台验收。
- 图像和原始模型仅在上一轮工具结果/内存中查看，未保留为本地文件；本次不能还原完整原始模型、截图字节或合法 V2 观察包。结构化文件是会话观察人工整理，`session-observation-summary`，不是注册 schema、保存回执或可重放的呈现/交互资格。
- 不运行缺少合法输入的 `learn:page` / `learn:component`，不手造 release、qualification 或 registry 事实，不更新 `knowledge-current.json`。提供的安装包只作为当时只读源码基准，不能证明四站或目标站实际安装版本与注册能力。
- 没有提交购物车、立即购买、收藏/比较、价格提醒、评价或联系表单。切换商品属性只观察 UI，不是交易测试。

## 合并与去重

| 本批内容 | 原有归属 | 本次处理 |
| --- | --- | --- |
| 静态服务卡与当前商品业务组件的职责差异 | 指南 §1；Usvapehub §7 | 合并动态字段与控制器判断，不重复新增服务卡原则 |
| 当前商品、变体、分享及重复评价所有者 | 指南 §2；Usvapehub §8 | 在同商品上下文规则内细化，不新增固定商品方案 |
| 相关/畅销/普通商品/最近浏览查询 | 指南 §2、§5 | 原则不重复；各站具体查询及执行缺口留档 |
| `.e-con-inner`、共享内容块与主题浮层归属 | 指南 §3 | 保留既有真实布局节点原则，补共享资源边界 |
| 排版开关、残留字段、父级隐藏与手机继承 | 指南 §4 | 补生效链核对，不把实例数值转成默认值 |
| 源码、实例与生成能力分离 | 指南 §5；COMPONENTS | 补适配缺口分层，23 个差异身份不等于新增启用 |
| 证据仅存在会话、第二手机宽度中断 | 指南 §4、§5；学习输入合同 | 明确未验证及不可重放，不补造资格 |

历史 [Usvapehub 档案](D:/cloneWP/docs/knowledge/usvapehub-component-patterns.md) 中的模板 776 与本次 Prime 样本有相同节点，但域名、日期与部分值不同：旧档案记录附加信息关闭及底部集合 bestselling；本次初始模型/前台记录附加信息开启、底部集合 product，手机保持标签导航。保留两个来源的历史事实，不把旧值覆盖成新值，也不凭节点相同断言同一站点或发生了何种改动。

## Vapeversse：模板 797 / 当前商品 6049

来源：[Geek Bar Meloso 30K](https://vapeversse.com/product/geek-bar-meloso-30k/)。主模板 24 个 Widget 实例、21 个类型，其中 15 类在当前 44 之外。商品为 variable，12 个口味选项。

| 职责 / 节点 | 初始配置或编辑模型 | 实际输出及限定 |
| --- | --- | --- |
| 主区 `52d07a9`；图库列 `9faa65d`、摘要列 `6caccea` | row，58%/42%，电脑列 gap 40、平板 30；top margin -20、bottom 40 | 1920px 内轨约 1450px，两列约 817.8/592.2px；1440px 内轨约 1335px，两列约 751.1/543.9px。百分比与 gap 由 Flex 共同分配 |
| 图库 `a462eeb` | `wd_single_product_gallery`，缩略图与手机设置多为 inherit/空 | 当前 10 张逻辑图片、每屏 1、自动播放关闭；已观察前台索引 0→1→0，不等于缩放/触摸全验收 |
| 摘要 | breadcrumb、notices、动态 title/rating/short description/price、purchase、wishlist、meta | 通知当前无输出；SKU/分类/品牌属于当前商品。标题电脑约 34px、手机 20px |
| 价格 `8877670` | 留有字号 34/28/22，但排版开关为空/未启用 | 电脑及手机实际约 23.25px；不得宣称留存字号生效 |
| 购买 `f7c517e` | button_design=full；enable_stock_status 空；手机标签 top、重置 bottom | 属性 `attribute_pa_flavor`；默认未选时按钮带 disabled/wc-variation-selection-needed 类，HTML disabled 为 false；选择一个口味后限制类消失。样品价 31.99，不是默认值 |
| 条件候选 | countdown `f6c12b2`；hook `21ce790`；三属性表 `5139e9b/df51004/e4855a0`；FBT `f77250c` | 当前没有实际组件输出；属性表均指 pa_brand，其中有残留 Nutrition facts 标题。缺原因，不补固定营养/倒计时/组合购数据 |
| 访客及元信息 | `1bbd7a7` with-bg；`f0a2dca` 显示品牌、不显示 tags | 当时访客显示 14，不证明真实分析统计；SKU/分类/品牌动态绑定，不复制数字 |
| 正文 `9283020` → `275d07b`、`83dfd63` | Container 折叠，desktop max-height 477、tablet 372，mobile 未明确；padding 桌面 50、手机 40；文本动态标签 `woocommerce-product-content-tag`，按钮启用 button_collapsible_content | 初始占位文本被当前商品正文覆盖；点击展开后容器约 996.8px，复点收起。按钮与容器有共同交互合同，不能仅复制按钮外观 |
| 评价 `0217d1e` | two-column，电脑评论列 2；展开模型手机 1；section padding 80/60/40 | 当前 3 条评论；手机摘要、表单、评论纵向排列。未提交评价 |
| 推荐 `834ff05` / `83cad98` | wd_products，related / bestselling；各查询 7；carousel；每屏 5.5/3.5/1.5；间距设置 20；分页隐藏，自动播放关 | 手机运行时每屏 1.5；Swiper spaceBetween=0，不能抹去 CSS/卡片间隔区别。手机箭头位于有效视口外，点击后未读到前进，不记通过 |

390px 时主区两列各约 360px，左右 15px、上下间距约 30px。价格字段的手机 22px 不是实际字号。主题手机工具栏高约 55px；向下滚动后另有约 42px 粘性购买栏，属于主题，不另计模板 Widget。全页截图中的固定栏位置不证明它在每一段均遮挡正文。

## Prime：模板 776 / 当前商品 9929

来源：[Grape Slush RINNBAR 50000](https://primevapeoutlet.com/product/grape-slush-rinnbar-50000/)。主模板 25 个 Widget 实例、20 个类型，其中 13 类在 44 之外。商品为 variable，Nicotine 与 Size 两个选择属性、两个匹配变体。

| 职责 / 节点 | 初始配置或编辑模型 | 实际输出及限定 |
| --- | --- | --- |
| 面包屑及导航 `d71e2f0`；主区 `3aad062` | 前者 row/space-between/wrap，padding 15；主区 50%/50%、gap 40，平板 gap 30；摘要 `f3c9fb1` sticky 电脑/平板 | 1920px 内轨约 1534px，两列各 747px；1440px 1395px，各 677.5px；手机列各 360px，未观察手机粘性生效 |
| 图库 `7f7ffe8` | 底部缩略图，其余多继承 | 当前只有 1 张主图；隐藏缩略轨不能证明无图库功能，也不能证明多图缩略可用 |
| 摘要 `49c4165/0cecfa9/601824a` | 动态 title、rating、price、purchase；价格自定义排版但字号为空；购买 full，留存 custom width 80% 但宽度模式未证明启用 | 标题 34→20px；价格电脑/手机约 24.8px；购买区实际满摘要宽，并非简单乘 80% |
| 变体购买 | attribute_nicotine=50mg；attribute_size=Single 或 5 Pack；库存开关 yes | 默认价格区间 24.99—119.99；仅选 nicotine 仍受限，两个属性齐全后限制类消失；Single 24.99、5 Pack 119.99。选中后购买区出现长变体描述，作为内容密度反例，未修改商品 |
| 保障 `4c12e3a` → 四 image-box | 每项电脑 25%、图片约 40%、标题 14px；子项保存手机 50%，父级 hide_tablet/hide_mobile | 手机父级 display:none，子项 50% 不代表手机两列 |
| 动作 `08cf3ae` | 专用 compare/wishlist/price tracker + wd_social_buttons，row/wrap | 分享实际生成当前商品地址；价格提醒未验证/未提交；不能用已有比较清单组件冒充单品比较动作 |
| 说明 `3fdc5b4` | 两 wd_infobox：配送、退货；image left/middle，padding 16 24、radius 4、bg #F5F5F5；另有红色 15px 提示 | 静态说明可评估已有组件；来源承诺及图标占位资源不作为业务默认 |
| 详情 `855845b` | expanded layout=tabs；description/additional/reviews 均启用 | 手机仍为横向标签；已验证附加属性、评价面板切换，描述为初始活动面板；最终恢复描述面板未取得读回。属性表来自当前商品 |
| 独立评价 `0563105` | two-column、评论列 1；外标题 32px/平板 26 | 与 tabs 内评价同时输出；#reviews/#respond/#commentform 各 2 份，作为去重反例，不建立双表单配方 |
| 推荐 `2b369a8` / `5f5bd3a` | 前者 related、query 4、实际 grid；后者 product、query 5、carousel、电脑每屏 4、手机字段空 | 手机前者网格两列，后者运行时每屏 2；Other Customers Also Bought 标题不证明同购算法，不能套旧档案 bestselling |
| 倒计时 `4203c6a` | separator ':'，留存自定义宽度值 | 当前无输出，未确认原因；不把残留值记为已生效 |

手机标签及 reset 为 side，和 Vapeversse 的 top/bottom 不同。手机底部为主题工具栏，当前未证明独立粘性购买栏。1440px 来源页眉有拥挤现象，属于共享主题区域，不形成商品模板布局规则。

## Budget：模板 4101 / 当前商品 2663

来源：[Wild Berry Savers Geek Bar Pulse SAVERS EDITION](https://budgetvapeoutlet.com/product/geek-bar-pulse-savers-wild-berry/)。主模板 17 个 Widget 实例、14 个类型，其中 11 类在 44 之外。商品为 simple。

| 职责 / 节点 | 初始配置或编辑模型 | 实际输出及限定 |
| --- | --- | --- |
| 外层 `f3dbbb9`；白色主卡 `8056763`；内行 `8515146` | boxed width 73%、gap 0、背景 #F8F8F8；卡片 padding 2%；图库/摘要 50%/50%，内行 gap 约 20 | 1920px 轨道约 1368.8px，1440px 1018.3px；手机外层 360px、卡片内约 345.6px，不是沿用 73% |
| 图库 `9295fa8`；标题 `a138ca8`；价格 `896e886` | 图库底部缩略继承；标题 custom=46/32/24；价格 custom=38/32/24、weight 700 | 当前一张主图；桌面标题 46px，1440px 换行增多；手机标题与价格均 24px |
| 摘要及购买 `08eede9` | 动态 short description/rating/price；购买 full、库存开关空；价格及购买父容器均 row/wrap | 简单商品无属性选择；样品 14.99；手机数量+加入购物车+立即购买紧凑排列，不把 full 当作每按钮独占一行 |
| 链接变体 `5af3bb2` | 初始配置空/展开模式 default | 当前无输出，不把普通规格选择与链接商品组混同 |
| 物流 `3a8cf02` | wd_accordion 单项，静态 text-content；faq_schema=yes；图像宽 30；局部 CSS 调整左右图标/箭头 | 默认展开，已验证收起/还原；手机展开内容约 432.7px。Schema 开关未另作输出验证，仓库、时效和链接不复制为默认 |
| 正文 `a3e70ef` | wd_single_product_content，外层标题+divider | 绑定当前商品正文，不静态复制来源产品文字 |
| 评价 `da2a0fe` | one-column、评论列 1 | 当前 2 条评论，手机单列，未提交表单 |
| 推荐 `0ff5cb3` | wd_products product、query 6、carousel，每屏电脑 6，手机空；wrap/autoheight/autoplay=yes | 手机每屏 2；运行时 autoplay enabled、delay 5000、loop=false。配置不等于循环/暂停已测；边缘外箭头点击未证明翻页 |
| 最近浏览 `03a857a` | recently_viewed，同类轮播设置 | 当前集合空而标题保留；未创建浏览历史凑数据，不认定故障 |

其他白卡组有约 50px 上间距、2% 内边距，仅作实例。电脑出现的第二购买表单来自主题 sticky bar，不是主模板重复放了购买 Widget；手机该主题节点可为零尺寸，不能据 DOM 存在判定可见。来源页脚旧品牌文字不属于当前商品模板学习。

## Notable：模板 65703 / 当前商品 70374

来源：[Benson & Hedges Special Filter–10 Packs](https://notablevapex.com/product/benson-hedges-special-filter-10-packs-20s/)。主模板 20 个 Widget 实例、16 个类型，其中 10 类在 44 之外。商品为 simple/on-sale。

| 职责 / 节点 | 初始配置或编辑模型 | 实际输出及限定 |
| --- | --- | --- |
| 面包屑/导航 `12219ee6`；主行 `37e8847` | 主行图库 40%、摘要 50%、column gap 60、row gap 20、padding 40px 15px；图库 left margin 30；tablet direction column、各列 100% | 1920px 图/文约 584/730px，1440px 约 546/682.5px；旧 _column_size 33/66 不是有效列宽 |
| 图库 `8f73e8e` | bottom 缩略、电脑底部列 4，手机继承 | 当前一张主图，未验证多图缩略/缩放 |
| 摘要 `31f8adc/fa63ebb` | price 在 title 前；价格仅明确 mobile 20px，标题 mobile 18px；多个卡片层级手机各有 10px padding | 电脑 price 24.8/title 34px；手机 price 20/title 18px，可用正文宽约 300px（外列 360px），不能盲目复制叠加留白 |
| 服务 `27ea2ad` | 四 image-box，子项手机 50%，父级 hide_tablet/hide_mobile | 手机整组隐藏；红色业务提示仍在，不把静态承诺当成验证事实 |
| 购买 `58874f4` | full；desktop reset bottom；手机 label top、widget width 100%、padding 10 | 当前无变体，原价 AUD 199、促销 AUD 145；手机第二购买按钮另起行；收藏/分享/分类继续绑定当前商品，未触发业务动作 |
| 详情 `82b3b80` | layout accordion、state all_closed、style shadow、left 对齐；additional/reviews 关闭 | 三个面板初始全关；已验证 Description→物流→FAQ 互斥切换，再关闭 FAQ |
| 共享面板 | 物流引用 HTML Block 40659，FAQ 引用 3234；内部 HTML Widget 不属于主模板初始树 | 物流内部 @media(max-width:768px) 将 .xyz-grid 改 column、卡片 width 100%/bottom margin 20；手机展开内容约 1960.8px。只观察规则与布局，未验证所有内部交互，不整体复制来源 HTML/CSS |
| 评价 `6834d07` | two-column、电脑评论列 3、手机展开默认 1 | 当前没有有效评价输出，不能称三列评价已呈现或断言评论关闭原因 |
| 推荐 `5967bb8e` | wd_products related、query 5、电脑每屏 4、手机空、分页可见、sync_group=group1 | 手机运行时每屏 2，前进索引 0→2/轨道 -370px；同步分组实际联动未测，分组名不复制为默认 |

手机左右基本边距 15px，前后商品导航和 divider 隐藏。第三方聊天与 WhatsApp 浮层遮挡商品信息，列为缺陷，不纳入默认布局；没有触发联系动作。Description 的型号字段与标题不一致，只记录当前商品内容疑点，不改源商品，也不把型号写入通用知识。

## 数据绑定与复用边界

| 数据/交互所有者 | 学习内容 | 当前执行判断 |
| --- | --- | --- |
| 当前 WooCommerce 商品 | 图库、标题、评分、短描述、价格/促销/货币、meta、属性、正文、购买、评论 | 单品模板、预览记录、实际商品与服务联动适配待补；不能用普通草稿静态模拟 |
| 静态说明内容 | image-box、infobox、标题、divider、物流和 FAQ 文案 | 当前 44 可作为原生候选；承诺、素材和具体参数在目标重新确定 |
| 动态标签及折叠控制 | 文本组件读取当前商品内容，按钮控制同一折叠容器 | 已有组件身份不证明该组合已获执行资格，需字段/条件/数据源适配与验证 |
| 商品集合 | related、bestselling、product、recently_viewed | wd_products 外观可复用；现有 ID 集合适配器不能自动承担这些真实查询，需明确查询合同 |
| 共享 HTML Block | 面板内容、资源身份、内部样式与媒体查询 | 资源/嵌入/所有权适配待补；来源 block ID 仅作证据 |
| 主题及插件 | sticky buy、手机工具栏、聊天、访客/价格提醒服务 | 不计主模板新增 Widget；可见、绑定、服务与动作分开验证 |

当前执行事实依据 [查询适配器](D:/cloneWP/src/native44/adapters.ts:57)、[查询类型](D:/cloneWP/src/native44/types.ts:28)、[页面上下文规则](D:/cloneWP/src/native44/page-context.ts:29)。这是 2026-10-26 的能力记录，不是修改这些源码或授予生成权限。

## 23 个差异身份与待适配项

详细机器可读列表在 observations.json 的 adapterGaps；所有差异身份均未启用。23 个身份不意味着需要新增全部 23 个：静态手风琴和面包屑可评估现有组件映射，无实际输出的模块先留研究候选。

| 类别 | 身份 | 状态与边界 |
| --- | --- | --- |
| 商品信息 | wd_single_product_title、rating、short_description、price、meta（各自完整前缀见 JSON） | adapter-pending：同商品绑定与字段合同 |
| 图库/购买 | wd_single_product_gallery、wd_single_product_add_to_cart、wd_wc_notices | adapter-pending：媒体/变体、库存和购物车服务、状态通知 |
| 详情/评价 | wd_single_product_content、wd_single_product_tabs、wd_single_product_additional_info_table、wd_single_product_reviews | adapter-pending：正文/属性/评论提供器、唯一表单所有者、设备模式 |
| 动作/导航 | wd_single_product_wishlist_button、wd_single_product_compare_button、wd_single_product_nav | adapter-pending：实际单品动作、服务及相邻商品查询；未执行动作 |
| 可选业务模块 | wd_single_product_countdown、wd_single_product_visitor_counter、wd_single_product_fbt_products、wd_single_product_linked_variations、wd_price_tracker | reference-only：当前条件/服务/输出或交互不充分，不自动启用 |
| 分派 Hook | wd_wc_hook | reference-only：需受限 Hook 提供器合同，不能把任意分派当静态装饰 |
| 可映射候选 | wd_accordion、woocommerce-breadcrumb | reference-only：分别评估已有静态手风琴与真实页面上下文面包屑；映射也需字段/行为证明 |

另外五类跨组件缺口为：单品模板/预览/显示条件与商品绑定；动态正文标签及容器折叠；非固定 ID 商品查询；共享内容块与资源重映射；主题/插件服务行为。仅将组件名称加入目录不能补齐这些缺口。本批不改目录、适配器或旧任务冻结合同。

## 未验证及不照搬项

未验证项包括第二手机宽度、实体手机与完整触控；各页图库缩放/缩略模式及全部变体；电脑粘性的完整滚动周期；循环、暂停、同步、自动播放完整周期；价格提醒/访客服务真实性；组合购、链接变体、倒计时与属性表无输出原因；目标站组件注册/保存/呈现及业务服务资格；FAQ schema 实际输出；断连后的临时浏览器恢复。

反例包括未启用排版的残留字号、父容器隐藏后的子项列宽、网格的残留轮播字段、旧 Column 尺寸、推荐标题与查询不符、重复评论表单、变体描述过长、来源残留营养表、浮层遮挡与型号文案疑点。来源保留为证据，不写入默认配置，不据此改网站。推荐卡片长截图中的空白图片还可能受懒加载影响，本批不把它直接判为缺媒体。

## 后续实际读取路径

新初始化的 preparation v8 通过现有 component-guidance 快照读取统一指南全文和哈希，并要求正文每板块关联真实组件 key、设置及手机机制的使用回执；本次细化自然进入该入口，不新增加载器。本实例档案和 JSON 不自动展开、不得作为来源证据或默认值。单品核心仍是当前执行缺口；规划能识别缺口，不等于已经能生成或验收这些功能。旧任务继续原冻结知识，禁止追补迁移。

后续本地系统改造已将此 JSON 接入同一 v8 的 component-learning 提示快照：仅按职责提取组合、按组件去重字段名称提示，不展开实例值或升级证据等级；统一模型报告关联实际树、设置、数据来源、交互和手机方案。执行机制见 [统一组件模型](D:/cloneWP/docs/unified-component-model.md)。单品提供器和未启用身份仍明确保留缺口，本档案不是独立生成方案。

# 同一复刻流程的桌面与手机能力

## 手机接入通用三步

手机与桌面共用 [通用三步复刻](three-step-replica.md)，但分别按实际来源决定容器、内容组和叶子的关系，不把桌面缩小当成手机设计。现有 `responsive.source` 两手机观察包在校验哈希、尺寸、来源身份和截图后进入准备包 `productionGuide.mobile`，合并后保存在同一个 `production-guide.json`；正式 `sourceFacts`、正文事实归属和旧任务合同不被改写。

第一步在新 preparation v6 的每个 section 填写 `phoneSourceOwners:[{snapshotId,nodeId}]`，以真实手机所有者对应两个快照，不按域名、选择器或区域序号猜测。允许一个区对应多个不重叠来源根；拒绝未知/桌面快照、页眉和跨区重叠。缺所有者可以继续候选准备，但保留 `phone-section-owner-unresolved`、实际可选区域和未分配事实，不声称完整。未分配项也可能是页眉或其它任务范围，不自动当作正文缺失。字段省略不迁移旧合同，不补猜测映射；决定参与既有合同/共享哈希。

指南提供每个手机宽度的主要容器、内部父子组、排列/对齐候选、宽度比例、位置与间距、可见/隐藏内容、图片来源、逐节点实际几何/配色/字体/裁切，以及状态和控制所有者。快照按实际宽高识别，不要求名称以 mobile/phone 开头。未知交互仍标为未观察；桌面悬停不自动变成手机效果，沿用既有 `responsive.touch` 分类、原生轮播数量决定及真实触屏证据。

第二步 section result 的 `responsive.contentBindings` 填写 `{snapshotId,nodeId,componentKey}`，将手机来源子树对应到本 section 原生组件。共享和复制模式均填复制前原键，复制后指南显示真实 `_phone` 键。来源须属于预先声明的手机区，不能跨区、使用未知组件或重复声明同一节点。只在外层挂全部事实不算叶子已承接；未对应的文字、媒体和控制保留 `unmapped`。

合并指南在本地调用既有响应式适配器，读出应用 `_mobile` 设置、子项顺序、整区复制/显隐和触屏方案后的真实容器树；不造另一套编译器，不改变桌面/平板，不写页面。诊断按实际手机字段判断，不拿桌面方向证明手机实现。两个手机宽度需求无法用同一设置表达时具名报告，不自动将数量设成1或叠加通用 CSS。

第三步沿用完整浏览器验收，从同一指南对照两手机当前前台：区域完整、上下顺序、内容边界、内部对齐、自然换行、图片裁切、实际同屏数及点按/展开状态。制作中先看代表性实际输出；指南始终标记未验证实际呈现，映射、软件测试及参数有值不等于页面通过。新准备状态保存指南精确路径和哈希；status 和重复 merge 读回该引用，改动报证据漂移，不猜最新文件或回写旧任务。

新任务继续使用 `create:replica` → preparation → full → review → publish，同一份 v4 合同覆盖桌面和手机，并在生成前冻结手机决定。实现集中在 `src/replica-responsive/`，既有调度、原生正文编译、页眉资源保护与串行写入继续使用。没有第二个入口、第二套复刻流程或另一项项目技能。显式旧 v1/v2 合同仍按其冻结范围读取，不能自动改造已完成页面。

## 默认与共同准备

新 preparation/full 合同使用 `version:4`；省略版本时解析默认是4，要求 `bodyBase.visualAuditVersion:3`、`responsive.version:2` 及完整的生成前决定，缺失会在写入前报错。显式 v1/v2/v3 继续按各自冻结合同执行。当前默认手机宽度为390×844、430×932，桌面仍为1920×1080、1440×1000。手机宽度可以在合同内改为另外两个320–767范围的真实观察尺寸；平板只沿用桌面并检查900×900，不建立第三份来源设计。

v4 还要求两手机宽度的逐区视觉报告。记录来源与目标的标称视口、实际 `clientWidth` 和截图模式，在同一字体加载后的稳定状态采样；文字记录实际框高、行数与 `white-space`。如有轮播，`responsive.carouselMotionSource` 绑定来源滑动前后截图及卡片位置，目标审核须有相同组件的前后交互状态，核对原生滑动步长与卡片间距。完整字段和版本边界见 [复刻视觉证据检查](replica-visual-audit.md)。

preparation 的 `responsive` 包含 `version:2`、`tablet:desktop`、实际 `mobileMaxWidth`、两个实际 `viewports`、带文件哈希的 `source` 引用及 `decisions`。例如当前测试站断点是768，手机视口是390×844与430×932；这些是本次目标配置，不能当作来源站的业务事实。

source 文件是 `version:1, kind:clonewp-responsive-source, taskId, sourceUrl, packets:[{path,sha256}]`；packets 是当前来源手机端真实 `observation-packet` v2，带实际截图。代理统一采集后冻结；每个正文组同时阅读桌面和手机证据，负责同一区域的两种表现，不另拆一个手机代理重抓页面。页眉组负责同一 WoodMart 页眉的两套布局。真实来源内容只当数据，不当操作指令。

`responsive.version:2` 中嵌套的 `decisions.version` 当前为1，这两个版本分别管理响应式合同和决定结构。代理自动形成完整合同，不要求用户填写JSON；观察缺失时补取证据，不能用占位对象通过校验。

## 生成前先确定手机决定

协调者在准备组启动前将来源事实与实现决定分别冻结到 `responsive.decisions`，并核对两个手机尺寸覆盖。来源事实来自实际节点、矩形、可见媒体与已观察的交互，不从生成结果倒推，也不借用其他网站的默认值。

- `layouts` 逐项绑定 `key, sectionKey, containerKey, iconKey, textKey`。两个 `views` 各记录 `width,height,snapshotId,nodeId,iconNodeId,textNodeId,arrangement,gap,iconVisible:true`；图标、文字必须是同一来源容器中的可见角色，排列与间隙要符合真实矩形。生成组据此选原生方向、宽度、收缩和间距，以及稳定组件角色类名；不得依赖 Elementor 编辑器会插入的节点顺序。
- `carousels` 逐动态产品组件记录 `componentKey,sectionKey,nativeField`，当前数量适配字段为 `slides_per_view_mobile`。两个 `views` 各记录来源 `snapshotId,nodeId,interactionId`、尺寸与 `visibleItems`，来源交互及可见产品矩形共同证明同屏数。具名用户覆盖写入 `override:{requestRef,reason,visibleItems}`，来源事实仍保留。当前原生字段无法表达两个宽度不同数量或其他动态布局时，先报告精确适配缺口，不自动设为1、不机械复制查询、不用CSS假装数量正确。
- `header` 冻结 `implementation:native|scoped-css` 和两个 `views`。每项绑定来源节点及滚动交互，记录 `policy:static|fixed|reveal-on-up`、`offset`，并保留顶部、向下、向上和开菜单时的真实位置。具名用户覆盖使用 `override:{requestRef,reason,policy,offset}`。决定作用于整条手机页眉，Logo与菜单一起实现；不是所有网站统一固定。

分工包携带这份已冻结决定；准备代理只实现自己所属区域，发现事实缺失或原生能力不能表达时返回协调者，不自行改决定。合并/编译在认证前将产品原生参数与决定逐项对照，并检查基础CSS及手机CSS中对容器的 `first-child`、`last-child`、`nth-*` 等位置依赖；明确只在桌面生效的规则保留。需要按子节点角色排版时使用组件自身稳定类名，不能以最终验收代替正确生成。

每个正文 section result 追加 `responsive`：`key, mode, reason, evidence:[{snapshotId,nodeId}], settings:[{componentKey,values}], childOrders:[{componentKey,children}], css`。合并时写入 full manifest 的 `responsive.sections`。必须覆盖每个正文顶层容器，每区在两个手机来源都有真实所有者；手机正文不得引用来源页眉节点。

## 原生响应式与整区复制

桌面悬停效果不能直接复制成手机 `:hover`。正文组在两个手机来源视口逐项处理自己区域内的桌面 hover 入口，并在 `section.responsive.touch` 记录来源节点、理由和处理类型：`press-feedback` 只为点按期间的装饰性 paint 生成短暂 `:active` 效果，`native-disclosure` 使用原生点击展开，`always-visible` 让关键信息默认可见，`no-mobile-equivalent` 明确记录来源手机端确无对应效果。直达链接必须保持一次点按导航，不靠第一次点按悬停、第二次点按跳转。`press-feedback` 只接受受限的 transform、opacity、filter 或 width 值，并自动限制在本 section、手机断点、`(hover:none) and (pointer:coarse)`；来源节点在两个手机快照中都必须归属该 section。手机实际点按、展开、导航和键盘可达性仍须在最终浏览器验收，不能以 CSS 生成成功代替。

`shared` 是默认决定：保持同一组件树，只在 `settings.values` 设置实际支持且本地知识已收录的 `_mobile` 原生控件，如间距、方向、对齐、字号、背景图片。内容和链接继续共享，不能借手机补丁替换标题或查询。全页断点保持现有设置，平板值从桌面继承；不接受另写平板样式。真实注册字段、类型和响应式属性在编译时核对。

`duplicate` 只用于来源证明的结构差异：复制整个静态顶层容器，自动分配 `_phone` 组件键/唯一ID、复制关联CSS；原树手机隐藏，副本桌面和平板隐藏。`childOrders` 只能重排这个副本已有的直接子元素，不可遗漏、复制或串到别的区域；文字、链接等仍来自原组件。手机图片可以用原生 `_mobile` 图片字段另选本任务素材。

动态商品、文章查询、表单、嵌套交互不允许机械复制，避免重复请求、ID和事件；优先使用其已注册的原生手机配置。需要桌面网格转为另一种手机动态组件时，报告精确适配缺口，不伪造轮播、不静默套用静态副本。`desktop-only` 必须由两个手机来源的隐藏状态证明，不允许用隐藏掩盖缺失内容。

原生布局和照片优先。手机补充CSS必须从所属 `:page .cwp-n44-…` 区域开始，外层手机媒体查询自动生成，拒绝越界、`!important`、照片URL、任意隐藏及伪造内容。原生手机控件负责的属性若被同组件CSS或强制样式覆盖，编译报错，改为把对应桌面值也放回原生控件；不得重现面板改值不生效的问题。原生图片面板换图与恢复继续参与统一验收。

## 同一个 WoodMart 页眉

同一手机数量合同支持显式原生网格：在既有 carousels 条目设置 `presentation:grid`、`nativeField:columns_mobile`，各 view 保留实际 visibleItems 并增加 columns。来源用 `kind:navigation,status:observed` 的商品链接分组及实际 itemNodeIds 证明，details 明确 presentation、columns、visibleItems；所有商品项必须归属该分组。代码从真实矩形重新计算每行数量及总行数，生成只接受 wd_products 的 layout:grid 和原生 columns_mobile，验收也从实际 product-grid-item 推导数量，不能拿未使用的轮播字段冒充网格配置。`conditional:true` 仅用于来源确实隐藏的单商品披露，要求一个原生查询商品及隐藏所有者证据；展开交互仍须实际检查，不以闭合时的零几何代替展开验收。历史未声明 presentation 的条目继续按轮播处理。

来源若在开菜单时收起 Logo，view 须显式冻结 `menuOpenLogo:hidden`、`menuOpenHeight`，并由来源交互详情中的真实 menuOpenLogoVisible、menuOpenHeight 证明；只有该具名状态允许零 Logo 矩形，实际页眉高度和菜单矩形仍校验，其余状态保持完整页眉约束。

v3/v4 header plan 的 `layout.mobile` 保存 `version:2, tablet:desktop, mobileMaxWidth:实际手机断点, rows, css, scroll`，其中 `scroll` 必须与 `responsive.decisions.header` 完全相同，不能由页眉准备组另写一份不同决定。历史手机合同的 `layout.mobile.version:1` 保持原义。rows 的 slot/columns/element形状与原桌面相同，元素键须独立；行参数仅接受原生 `mobile_height`，共享行颜色等通过手机限域CSS补足，避免手机行设置反向修改桌面。结构仍保存在同一 WHB 对象，用户可在 Header Builder 的 Mobile 标签编辑。

手机导航采用任务自有菜单绑定的原生 `mainmenu` 全屏图标样式（`full_screen:true,style:icon`），先确认实际菜单参数/渲染和交互，再补CSS。不使用全站 Mobile Side Menu 位置，不修改 `nav_menu_locations`。当前原生全屏菜单按最后一个mainmenu汇总参数，因此编译必须确认最后一项正是手机自己的菜单；后续桌面菜单覆盖它时在保存前报错，按原生行列顺序重新规划。菜单内容一致可以复用本任务菜单；结构不同在同一计划中新建另一份有真实名称的任务菜单。

原生全屏面板在WHB外渲染，`layout.mobile.menuCSS` 可选补充样式以`:mobilemenu`开头，由页眉模块编译为精确`body.page-id-ID .wd-fs-menu`作用域，仍归页眉配置维护。手机优化选项会使主题跳过此原生面板，当前适配在写前检测并具名阻断，不更改该全站选项。

当前适配范围为目标 WoodMart8.3.4、Elementor手机断点600–900/平板1024的已核实配置（当前测试站实际手机768）。认证后的只读核对在创建资源前执行；漂移会具名失败，不能修改全站断点来适应。页眉自己的手机断点之后至1024范围的限域规则显示桌面列、隐藏手机列并恢复桌面行高度，实际手机断点及以下才用手机列；所有规则经原页眉CSS作用域编译器限制在该页眉ID。新页的主题底部商店工具栏仅由精确页面ID的固定规则隐藏。

## 统一验收

同一次 full review 必须包含两个桌面与两个手机完整截图、DOM和实际交互，绑定当前页面/正文/CSS/页眉/菜单完整指纹。只有软件测试或保存成功不通过视觉验收。手机菜单每个宽度都要实际打开、关闭；有子项时实际展开子菜单；轮播、筛选和表单按实际手机交互验证，不能沿用桌面hover证据。

v3 的检查以生成前冻结的来源决定为准，附加两手机宽度各自的前台及 Elementor 编辑器画布观察：图标、文字及容器真实矩形与可见图像细节，产品视窗和实际卡片矩形推导的同屏数量，以及整条页眉 `top/down/up/menu-open` 四状态的滚动量、Logo/菜单矩形、定位类型和截图。登录工具栏或编辑器环境偏移单独记录，不把它误作来源留白；固定页眉还要确认Logo和菜单均在页眉内、开菜单不漂移且不遮挡正文。手机原生面板值正确不能代替真实渲染，也不能只检查轮播切换成功。

这些记录使用 `clonewp-responsive-decision-observation` v1，绑定当前页指纹、视口、`surface:frontend|editor`、HTML与实际截图引用。代码核对角色归属、排列/间距、图标绘制、实际同屏数及滚动状态；人工仍需判断完整视觉和交互质量。缺少任一必需表面或状态不能沿用旧截图宣称通过。它是最终验证执行是否偏离既定方案，不能用来把规划中本应确定的决定留到保存后再猜。

v3 review evidence 的 `responsive` 是 `clonewp-responsive-review` v2，新增 `decisionEvidence` 的4个引用，分别覆盖两个手机宽度的前台和编辑器；历史workflow v2继续使用review v1。它绑定 taskId/runId/pageId/fingerprint，`views` 覆盖同四个尺寸；每项记录 `width,height,clientWidth,scrollWidth,observedAt,sections,header`。sections逐区记录桌面/手机容器实际 `id,display,width,height`；header记录同一header ID及其桌面、手机列实际矩形，确保任一宽度仅一套可见。`tablet` 用同一形状追加900×900的 screenshot/dom哈希引用，只检查桌面继承和溢出。记录来自当前浏览器读回，不填造通过布尔值。

最终继续交付页面、页眉与所有菜单真实名称、ID、链接、独立布局/样式位置和实际验证范围。历史合同不借新规则冒称新增项目已验证。模块代码位于 `src/replica-responsive/`；layout.mobile位于任务页眉bundle的header.json，手机正文计划与决定位于任务不可变v4合同；源码模块独立维护，执行仍是同一流程。

来源局部静态分支可由 section.visibility 显式声明 componentKey 和 hideOn（仅 mobile 或 desktop+tablet 两种互补设备集）。目标必须是该节内独立 Container，子树只允许静态内容、媒体及原生折叠；不能藏商品/文章查询、表单、动态轮播或HTML。基础program不得自行填写hide_*，适配层统一注入原生字段并核对实际注册。phone-only 模式用于来源真实仅手机显示的整节，桌面和平板原生隐藏、手机保留；最终四视口验收按这个模式核对。

页眉只允许根本身 :header:has(.native-state-class) 的单一纯类后代条件；条件不能含组合符、多个选择器、标签、嵌套伪类或全局选择器。所有规则仍作用于精确自有页眉，不能逃到兄弟或文档根。用已观察的原生菜单打开状态驱动紧凑布局，无额外脚本。

独立页眉样式修订可附加顶层 `:mobilemenu` 规则；协调器只有在该模块唯一绑定本 run 的 Full Width 自有页后才编译到精确 `body.page-id-ID .wd-fs-menu`，普通页眉编译器不放开全局选择器。菜单内部使用目标实际 `.wd-nav-opener` 与 `.sub-menu-open` 原生点击状态，不改链接或注入页面事件脚本。原生面板在页眉外，紧凑状态由固定的自有页面规则读取 `.wd-fs-menu.wd-opened`；来源要求消除文档滚动条时，可显式使用 `:mobilemenu{--clonewp-menu-scroll-lock:1}`，只生成该页面/该原生打开面板条件下的根滚动锁。其它值、子节点指令及任意自定义属性仍拒绝。

连接浏览器若返回整张视口的等比例原始图，可在当次验收显式记录 `captureMode:"native-viewport-scaled"`，保留未改动字节与真实格式，并记录截图前后不变的 CSS 视口/滚动/几何和实测像素尺寸。验收仅接受宽差不超过24px、比例至少0.9、整张视口宽高比例相符到1px的映射；图标像素检查按该实测比例换算，裁短、任意缩放和空白图仍失败。默认旧证据继续按原有 1:1 规则。不可把截图时暂时改变排版的长图标作稳定视口。

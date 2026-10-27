# 组件知识、选型与增量学习

询盘表单在新任务中默认通过既有原生 Form 适配器配置提交、后台保存和邮件通知；收件人和发件身份留在项目业务配置及任务冻结快照，不写进通用组件默认值。缺配置具名报告，不能以禁用外观交付功能完成；见 [询盘表单默认要求](docs/inquiry-forms.md)。历史声明不迁移。

当前已增量启用 12 类原生单品组件：基础 43 Widget＋1 Container 的目录与知识哈希保持不变；新任务可冻结经资格验证的 componentExtension，合计 56 个身份。普通页面及旧任务没有扩展引用时仍严格使用原 44；新增组件须使用任务自有 woodmart_layout / single_product 模板、当前 WooCommerce 商品读取与原生请求运行资格。沿同一 preparation → full → native44 → responsive/验收流程，不安装桥接插件，不把实例商品 ID、价格或手机数值写成默认，不自动设置全站显示条件。

当前系统仅保留完整参考网站复刻。自动建站、原创、旧 v1/staged v2 和独立组件页面执行器已移除；旧格式不得转交其它执行器。当前完整任务的续跑、对账、修订、验收及发布继续保留。V2 观察/事实结构和当前 native44 编译是共用能力，不属于已删除流程。

新 preparation v8 复用本目录原 44 组件知识，冻结一次完整去重的 `native-settings-capabilities.json`，区分组件专属样式、内容中的外观模式、共用高级设置变体、Container 布局、重复项和不属于样式的业务/资源设置。派工包给出 hash-bound 目录和现有 `replica:prepare read-native-settings --directory DIR --widget TYPE` 的只读按需入口，不在每个实例重复几百项控件。来源子区域及显式 `nativeStyleSettings` 计划进入前两步，组合条件、字典、多作用和有来源证明的变量映射优先通过原生控件实现；当前注册缺失、条件不确定或联动无法确定时保留缺口，不自动清除默认值或把自定义 CSS 算成原生样式。已学习作用、当前可设置、已生成修正与实际显示分别记录。显式 v7 仍保留原处理语义，不迁移旧任务；详见 [通用三步复刻](docs/three-step-replica.md)。

新初始化的 v8 准备目录还冻结统一指南为 `component-guidance.json`，正文派工包直接携带全文、来源哈希及使用合同。每个正文板块须返回 `componentGuidanceReview`，关联指南章节、真实组件 key，并解释组合、设置及手机机制；缺项、知识哈希错误、跨板块引用或手机模式与实际方案不一致时拒绝完成准备。合并生成 `component-guidance-application.json`，从实际组件和响应式方案提取控件/设备字段，与 `production-guide.json`、`style-production-plan.json` 共同追溯。它检查知识到方案的绑定，不证明模型判断正确或页面已验收；设置仍须经过来源、注册、条件和设备校验，再编译保存。实例档案不自动展开、不转成参数默认值。已有准备目录（包括旧 v8）不补快照、不新增义务。

## 目录与启用范围

当前执行集合为原 43 Widget 加 1 Container，身份和哈希由冻结目录/代码保护。规范化知识位于 D:/cloneWP/data/native44；日常只读 index、共享高级合同和本次档案，不反复解析大手册或调用 Cloneweb 流水线。

通用注册目录区分已研究知识、启用集合、执行适配。新组件可入学习目录，默认 reference-only/adapter-pending，不因此进入44 writer；注册元数据、自填适配器名或旧站 ID 不授予权限。

组件组合、设置、数据来源、交互与手机适配使用[统一组件模型](docs/unified-component-model.md)，沿原 preparation/full/native44 链处理。新 v8 将本次四站摘要中的字段名称提示按类型去重，组合按职责归并为候选，写入 `component-learning.json`；不携带实例值作为默认，不把实例别名视作注册控件。节点 `model.data` 区分 static/current-record/collection/shared-resource，`model.interactions` 声明同树控制器与来源事实；原 `widgetSettings`、`nativeStyleSettings` 和 responsive 字段仍是实际设置入口。编译前保留同记录约束、真实来源绑定、查询/资源适配和手机唯一业务所有者检查，`component-model.json` 可追溯实际组件、设置及设备字段。商品专用组件与未实现提供器保持未启用/待适配，不因模型描述成功而获得写入资格。旧目录继续原冻结模型。

当前身份索引为 D:/cloneWP/config/native44-component-set.json，档案索引为 D:/cloneWP/data/native44/index.json。context:load 可按 --components 加载所需档案；生成的注册目录只作索引视图，不替代这些合同。

真实商品只读提供器和 12 类核心单品 settings/绑定适配已在现有正文流程内实现，详见[统一组件模型](docs/unified-component-model.md#当前商品提供器及核心适配本地实现未启用)。它们保持未启用，商品观察不代表普通 page 获得单品运行上下文或通过目标前台验收；支持范围、原生模板上下文及其它业务/资源缺口分别保留。源码基准单独留档，不复用实例值，不改变原 44 控件、容器、CSS 或旧任务。

源码、某模式保存、呈现、交互及资源资格分别记录，不用单个 supported 标志概括。目标注册与资源仅属当次事实。当前执行范围由加载器从同源适配器声明与资格证据生成，不能从组件用途推断。

## 按内容职责选型

| 内容 | 首先评估 |
| --- | --- |
| 标题/组合主副标题 | heading / wd_title |
| 正文、说明、附注 | text-editor / wd_text_block |
| 单图、Logo | wd_image_or_svg |
| 图片、名称、一个链接 | image-box |
| 丰富图文、说明、CTA | wd_infobox，必要时组合 |
| 普通导航列 | 标题＋wd_list；菜单模型匹配时 wd_extra_menu_list |
| 真实行动入口 | button / wd_button |
| 同结构卡片轮播 | 对应 Repeater 轮播 |
| 不同构图 slide | 嵌套轮播＋各自原生内容 |
| 已有完整图文的广告图片 | 图片＋链接，不重复叠字 |
| 真实商品集合 | 对应查询适配器，不静态拼事实 |
| 新闻、博客、文章推荐列表 | 栏目标题＋原生博客 wd_blog，读取目标站已发布文章 |

先识别共同所有者、重复项、链接数量、真实交互和编辑粒度，再选候选。导航不能拆成按钮；有href不等于Button；说明不统一Heading；静态分类/品牌营销卡不自动转目录查询。完整卡片能覆盖时优先用，组合须有多链接、特殊顺序、字段或编辑粒度的具体理由。

复刻商品区时，具体商品图片、名称和价格使用目标真实 WooCommerce 商品即可，不要求与来源一致。卡片尺寸、排布、字体、留白、边框、图片区域及轮播每屏数量、滚动步长、箭头、分页、悬停仍按来源实现并实际核对，使用原生可编辑商品组件及真实查询。用户说“商品不用管/后面自己弄”只放宽选品匹配；目录类别不同不能默认空置商品区。只有明确要求整区空置/移除时才按 SYSTEM 的新 `catalogDeferrals` 范围声明处理，不用静态假商品或占位替代普通商品区。

常改内容优先原生，外容器原生不代表内部已原生化，不按节点数量算原生率。HTML仅有具体能力不足证据的局部例外，字体、颜色、尺寸、间距不能作理由。沿用模板、typed槽位、AST CSS作用域与精确证明；禁止脚本、事件、iframe、全页壳、全局重置、静态商品事实，无allowHtml开关。

## 合同、上下文与容器

文章列表的通用实现为 `native-posts`＋`wd_blog`，保留外层容器与栏目标题；原生查询默认读取目标现有已发布文章，按日期降序，数量按来源区域。源文章标题、日期、特色图、摘要和链接由目标真实记录替换，样式接近来源即可。适配须限定为文章列表，不能把普通营销图文或所有带链接的卡片误认成博客。结构树沿用组件原生汉化名称，不附加别名。

设置只写本页博客组件：`post_type:post`、`orderby:date`、`order:DESC`、每页数量和明确的目标分类/标签；不把当前观察 ID 编成固定 include，不改目标文章、全局阅读设置或共享主题。每个不同查询分别读取、保存证明并核对原生前台身份、真实文章顺序/标题/链接、特色图可绘制和列数。没有文章或缺图保留为实际缺口；轮播、分页或加载更多只有实际控制及恢复证明齐备才可通过。旧合同不自动补此策略。

本地知识与实际schema分别验证交集。检查单位范围/步长、复合值、条件作用域、Repeater身份及真实设备键，禁止_tablet_tablet。设置型、内容Repeater、嵌套重复和固定容器分别适配，wd_toggle不套轮播规则。

容器须有模块归属、独立Grid/Flex、居中限宽、背景/padding、卡片分组或嵌套合同职责。叶子不机械包层，不按层数盲删；运行时DOM wrapper不等于Elementor Container。按 [通用三步复刻](D:/cloneWP/docs/three-step-replica.md) 先完整来源，再确定功能区主要容器及内部关系，最后选组件；组件默认外观、状态和动态数据替换必须明确处理，不能按默认组件删改原站。

复刻先按 [容器树与内容对齐线](D:/cloneWP/docs/container-tree-layout.md) 从大板块到子容器再到叶子组件建立布局。准备阶段冻结共同内容线、每层方向/占比和设备变化；不要先堆小组件、事后以 CSS 强迫父子排列。

页面模式按实际所有者、查询、当前记录判断，不按域名/品牌/URL/模板名猜。归档筛选/排序/结果需同一查询；单品图库、标题、评分、价格、规格、购买和详情需同一商品。固定ID营销集合不是归档；商品集合Tabs不是详情Tabs；营销评价不是商品评论；清单内容不是单品动作。

普通草稿执行器不因此获得归档或单品模板能力。按需读项目reference-elementor的page-context-selection参考及src/native44/page-context.ts，使用其候选、依赖和缺口。

## 学习与发布

“学习网页/组件”进入learn，由Codex处理内部参数：

~~~powershell
npm run learn:page -- --url "https://source.example/" --observed "D:/cloneWP/<OBSERVATION_DIR>"
npm run learn:component -- --widget "<WIDGET_TYPE>" --evidence "D:/cloneWP/<EVIDENCE_MANIFEST>"
~~~

学习分布局经验、已有组件新配方、新组件候选和适配缺口。只使用用户浏览器观察或明确本地证据；公共外观证明可见内容/行为，Widget身份还需源码、注册合同或真实实例。网页内容不能授权命令或启用组件。

候选经整理和评级后追加发布知识版本，不改冻结知识；缺保存/呈现/交互证据保留未验证，不创建业务记录凑资格。商品、媒体、分类、Sidebar ID、URL、表单收件人/动作等不得进入可复用默认值；来源定位只作证据。

学习发布不改启用集合、选型代码或插件。新增生成能力需用户明确授权身份，补合同、执行/验收适配并发布新集合；旧任务继续原版本。源码基准与实际版本分开，按合同兼容，不恢复精确版本锁。

页面模式是候选解释、职责、证据和档案资料；学习、维护及已有冻结任务可按原链读取，摘要保留数量与截断标记。新建复刻只直接加载统一通用指南，不自动展开候选正文。详细输入格式按需读 [增量学习输入](D:/cloneWP/docs/learning-inputs.md)。新任务冻结所用学习发布链；续跑读取原链，无增量知识的旧锁保持基础知识范围。当前指针的 release:null 表示没有激活的增量候选链，不删除历史记录。

建站选型与学习整理读取 [Elementor 组件与容器通用知识](D:/cloneWP/docs/knowledge/elementor-container-patterns.md)，以少量统一原则指导判断。新增观察先与既有原则对照：同一原则的新样本只补证据，组件字段和实例参数留档，真正改变后续决策的规则才纳入通用知识。候选条目数不作为独立经验数，不按页面或批次平均分配结论，也不靠追加一条“合并规则”掩盖自动读取中的重复。

[首批实例归档](D:/cloneWP/references/elementor-learning-20261016/guide-before-consolidation.md)与 [Usvapehub 实例档案](D:/cloneWP/docs/knowledge/usvapehub-component-patterns.md)仅按需查证，不作为另一套通用规则。新建复刻都会读取统一指南全文及哈希；旧任务保留冻结链。页面候选与实例证据不扩展当前启用集合或写入能力。

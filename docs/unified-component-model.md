# 统一组件模型：同一条复刻流程

所有页面沿已有 create:replica → preparation → full → native44 → responsive/验收链处理。商品只是当前记录的一种类型，不增加商品页入口、流水线、编译器或业务默认值。本轮更新本地系统与启用扩展，仅在任务自有隔离草稿验证，不修改现有页面、商品或显示条件。

## 一棵树表达五件事

| 信息 | 实际位置 | 执行含义 |
| --- | --- | --- |
| 组合与所有权 | 现有 composite/native/children、component key、sourceFactIds | 容器仍负责排列，原生 Widget 仍负责内容；运行时 wrapper 不计新组件 |
| 具体设置 | widgetSettings、nativeStyleSettings | 仍经过本地知识与实际注册交集、条件、设备键、原生控件解析，再补隔离 CSS |
| 数据来源 | 节点可选 model.data | static、current-record、collection、shared-resource；字段绑定与当前业务提供器资格分开 |
| 交互 | 节点可选 model.interactions | 具名动作、同板块控制器、当前上下文及真实来源事实 |
| 电脑与手机 | 原 responsive sections/设备字段/内容绑定 | 同一数据与动作所有者；复制静态分支时同步映射控制器，禁止复制业务表单 |

静态组件默认得到 static 解释；已有 native-products/native-posts 自动沿原类型化查询得到 ids/latest-posts 集合解释，不重复声明已有查询。业务来源与动作可通过严格的 model 合同明确表达，不能藏在文字或普通按钮里。

例如，普通说明卡仍使用 image-box 的原生文字/图片字段。需要当前商品价格时声明 current-record/product/price 及 contextKey/sourceFactIds，并在同一 program 的 currentRecord 明确选择已存在的目标商品。价格 Widget 通过已验证的单品扩展引用启用；真实读取、原生绑定适配与普通页面不具备单品运行上下文分别检查，不生成写死价格的 heading。描述数据来源不是授予组件生成权限。

## 学习进入实际规划

新初始化的 v8 准备目录读取四站会话摘要，生成一个带源文件哈希的 component-learning.json，传入同一个正文任务包。它按组件类型去重字段名称提示，按职责提供服务组、记录摘要、动态正文折叠、详情面板、评价和记录集合六类候选。

快照不展开商品/资源 ID、价格、URL、具体尺寸或其他实例值。initialSettings 中的归档别名仅为字段含义线索，不是目标注册 schema。精确数值仍在按需实例档案中，当前任务从当前来源选择参数。模板/商品事实、安装包研究、呈现与服务资格继续分别记录。

四站 observations.json 现在是此提示快照的本地知识输入，属于组件知识硬依赖；任务临时目录清理不能删除它。已创建任务只读自身冻结快照，不跟随新的档案内容。

complete 在原任务生命周期内检查统一模型；merge 将实际树、数据来源、原生设置字段、手机字段/控件、交互及缺口写入 component-model.json，并从 production-guide 引用它。pattern application 标为 candidate-only，只说明候选与实际组件的关联，不宣称已复刻或已呈现。

合并 program 冻结 componentModelPolicy=unified-components-v1 及 componentLearning 快照引用。本地任务读取继续核对引用字节哈希；编译和手机处理调用同一个模型检查，静态/现有查询仍由原适配器执行。没有第二套网站写入路径。

## 可执行与待适配分开

- 原 44 身份、现有静态原生控件、ids 商品集合和 latest-posts 文章查询继续沿已有合同；模型通过不跳过注册、设置、查询证明或原有验收。
- 当前商品提供器及下列核心原生设置适配已实现，但仍需当前读取和真实单品运行上下文；其它当前记录、共享内容块、动态标签、related/bestselling/recently_viewed 查询和未适配动作继续产生具名缺口。
- 实际来源证明是单品字段时，不允许通过省略 model 将其降成静态内容；Tabs 中的静态共享内容与独立 Widget 仍保持各自所有权，不一概推断成商品正文。
- 同一记录类型不能在同页混用多个“当前记录”上下文；购买/评价不能重复归属。手机复制不产生第二套数据/业务动作；静态控制器按复制后的组件 key 映射。
- 基础 43 Widget＋1 Container 的身份和哈希不变。额外 12 类经 native component extension 引用使用；旧任务没有引用仍只允许 44，不创建商品或修改全站显示条件凑证明。

这次学到的组合、设置、数据绑定与手机机制已进入统一规划、校验及下述本地适配函数。不能把本地测试通过写成目标单品功能或前台验收通过。

## 当前商品提供器及核心适配（原生模板增量启用）

`WordPressClient.readTargetProduct(productId)` 沿现有认证只读传输执行固定 WooCommerce getters；仅支持目标站已发布、可见、无密码的 simple/variable 商品。提供真实名称、SKU、正文、摘要、价格与促销状态、库存/可购买状态、主图/相册、属性及规范化属性键、默认变体值、公开变体及父子归属、分类/标签、评论开关及评分/评论数量。不提交购物车、评论或其它动作，不获取客户和评论作者资料，不创建业务记录。单次最多 200 图片和 200 变体子记录，超过即明确失败；可见变体数量与全部子记录数量分别记录，隐藏项不伪造。

`currentRecord` 只选择已有目标商品及同页 contextKey，不是页面模式或新入口。`readCurrentProductProvider` 在当前进程读取并校验目标域名、商品 ID，产生只在内存有效的提供器；串域、串商品、串上下文、序列化重建及过期句柄被拒绝。磁盘观察只作比较证据。目标商品 ID 与本次真实数值只进入任务选择/观察，不进入学习默认。

| 核心原生适配 | 实际数据/服务所有者 |
| --- | --- |
| gallery、title、rating、short_description、price、meta（均为 wd_single_product_ 前缀） | 当前 WooCommerce 商品的媒体、名称、评分、摘要、原生价格格式/税务过滤及元数据 |
| wd_single_product_add_to_cart | 原生购买模板、库存条件、可购买状态；variable 使用真实属性/变体、原生变体脚本及购物车服务 |
| wd_single_product_content、wd_single_product_additional_info_table | 原生正文渲染及商品属性提供器 |
| wd_single_product_tabs、wd_single_product_reviews | 原生详情 Tabs/评论服务；Tabs 开启评论时计入同一个评论表单所有者 |
| wd_wc_notices | 原生会话通知服务；观察商品不读取或消耗通知 |

`adaptCoreProductComponent` 输出实际原生 settings 与类型化绑定回执，不把 snapshot 的文本、金额或商品 ID 复制进组件字段。设置保持任务选择的原值，经本地研究控件与当次实际注册交集、条件、单位和设备键校验；未知字段、原始动态标签、来源 product_id 覆盖及未适配共享资源被拒绝。电脑/手机字段沿原 responsive 链共用一个提供器和业务所有者，不新建手机数据源。普通商品不强加变体选择/脚本依赖；缺图、零评论、空价或缺货保留原生条件输出，不填来源数据。

`prepareProgramCurrentProduct` 是现有 target-context、整页正文保存和复用公共部分的正文保存共用的读取步骤，绑定在媒体导入之前；没有 currentRecord 的普通任务不增加读取或默认设置。编译选项沿原 compileActualBody/compileNative44 传递内存提供器；原 44 资格门先执行，不增加旁路。模型报告区分 `implemented-disabled`、`record-provider-required` 与 `record-runtime-pending`，不再将这些核心适配一律说成“没有提供器”。

真实单品上下文使用原生 woodmart_layout，wd_layout_type 为 single_product。普通网页仍创建 Page；同一树、设置、手机处理与质量流程保持。单品组件在实际商品请求读取当前商品，模板换到另一件商品会随请求变化；任务 currentRecord 的商品 ID 只用于读取、预览及验证，不写入 Widget 的 product_id。保存和比较以请求内 WooCommerce 查询提供上下文，并在 finally 还原；没有部署任何桥接插件。

启用依据为 data/native-product/extension-v1.json 和其中绑定的 qualification-v1.json；data/system/component-extension-current.json 提供新任务可选择的扩展；原生单品规划明确将其冻结到 program/manifest。基础身份读取默认不带扩展，普通页面不被隐式迁移。扩展包含 12 类真实注册控件、去重的条件/设备/原生 CSS 控件和资格引用。原 44 目录、基础知识索引及既有学习发布指针不变。分析提示、complete/merge、编译、目标注册、原生保存及现有 compare 读取同一冻结引用，文档不能单独授予权限。

实际验证：同一任务自有单品草稿，simple/variable 两种真实目标商品，两个电脑宽度及两个手机宽度；注册、原生保存读回、商品身份、规格变体切换、图库弹窗、数量编辑、Tabs、评论评分选择，以及原生字体和图库列数的设备设置。请求内取原站实际资源时，WoodMart 的 REST 跳过 CSS 分支由其注册 CSS 文件装载补齐；禁止写页面 CSS 缓存。HTML 与 nonce 只留内存，观察数值仅在 qualification-work 实例证据中。

资格边界：真实样本零评分、无通知，所以正评分/有通知输出待实际任务核对；变体价格相同，不声称不同价金额变化已被此样本验证；没有提交购物车、结账或评论。当前测试模板仍为未发布且无显示条件的草稿，启用组件不等于替换现有商品页面。其它单品导航、收藏/对比、关联集合、共享内容块和未适配业务服务继续具名阻断。

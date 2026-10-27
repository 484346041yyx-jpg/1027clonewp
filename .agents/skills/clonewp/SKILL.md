---
name: clonewp
description: Route cloneWP desktop replica, component learning and project maintenance through project context and frozen task contracts.
---

## 新任务的指令范围（优先于下文的整页默认）

新任务询盘表单按 [通用询盘表单默认要求](D:/cloneWP/docs/inquiry-forms.md) 沿同一 preparation v8 → full v4 默认配置真实原生提交、后台保存和邮件通知。各站字段/样式来自实际来源，收件邮箱来自项目通用或站点专属配置，发件设置按每站自动生成。testing:user-managed：只检查原生设置、可填写性、样式与保存读回，不自动发送测试询盘或测试邮件；实际测试交用户。不要求提交成功或收件证据，不把未测试写成已送达。缺收件邮箱具名报告，旧任务不迁移。

用户明确只复刻截图/指定正文板块时，使用既有 body-only preparation v8 → full v4，并按 docs/replica-command-scope.md 的“指定正文板块”冻结 selection 和 unselectedBodyUnits。完整来源仍取证，只有选中板块进入派工与输出；旧任务不迁移，不启动旧独立组件执行器。

`复刻页眉：URL` 和 `复刻页脚：URL` 分别限定为 header-only / footer-only；原 `复刻页眉页脚：URL` 保持 header-footer。使用同一创建入口的公共资源合同，原生页脚为独立 cms_block，任务预览页只引用该块。来源电脑、手机、悬停和内容取证保留；全站旧资源及绑定不自动更改。用户明确自行检查时冻结 draft-for-user-review 并交付草稿，不伪称验收通过。详见项目范围文档。

按 [复刻指令范围](D:/cloneWP/docs/replica-command-scope.md) 分流：`复刻网页：URL`、`复刻正文：URL` 和裸参考 URL 默认只制作正文，复用当前项目已核验的公共页眉、菜单和页脚；`复刻页眉页脚：URL` 只制作公共部分及其依赖，不复制普通页面正文。只有用户明确要求包含页眉页脚时才按整页范围创建。缺公共资源先定位，不擅自创建或替换。新正文合同使用 pageScope: body-only、reusedHeader 及独立 footerUnits；保留公共页脚。所有下述取证、并行准备、原生组件、样式、响应式、验收、编辑器收尾与发布流程不变，准备组按本次范围派工；“完整流程”不等于扩大内容范围。旧任务保持冻结合同。

当前仅支持完整参考网站复刻。共用 V2 来源数据、基础 44 原生组件及经冻结引用启用的 12 类单品扩展、手机响应式、页眉菜单、修订、验收和编辑器收尾保留；不得回退已移除的旧执行器。

所有复刻路径（包括用户授权的原生制作、复制和修订）都保留组件原名，不自动设置 Navigator `_title`，不把“容器”“列表”等原名硬编码成别名。旧合同的 editorTitle 仅作元数据，不恢复自动命名。实际标题、分类文字和 item_title 等内容字段保留；既有页面别名仅在明确授权范围内清理。

通用 URL 规则：目标页面使用目标站域名加来源页面原路径，不按品牌、标题、任务名、日期或随机数另造 slug。原路径本身已有的词和层级照原样保留；来源站内导航相应替换域名，外部链接及媒体资源另行按原职责处理。新建前检查路径占用和 WordPress 原生唯一性，规范化或重名时调用 WordPress 原生唯一 slug 分配，允许 -2、-3 等后缀（草稿也先按发布时的唯一性分配，但保持草稿状态）；记录来源路径和实际路径，用实际地址绑定链接，交付时明确提示例外。不得覆盖已占用资源。现有平级建页入口遇到嵌套路径或首页，须先明确父级路径/首页所有权，不能压平或改成带前缀的测试页；旧页面仅在当次授权范围内改 URL，不覆盖无关页面或共享菜单。


工作目录 D:/cloneWP。使用项目 AGENTS 自动入口；系统见 D:/cloneWP/SYSTEM.md，组件见 D:/cloneWP/COMPONENTS.md。不要换用全局同名 reference-elementor。

## 先取得本次上下文

先按实际入口身份和当前请求执行统一只读启动；只追加已明确的原生 task/run。该入口内部复用现有 context loader 一次，不重复加载。读取返回 context.documents、shared.handoff、changedSinceHandoff；组件专项诊断仍可单独使用 context:load --components。WorkBuddy 的记录身份是 `workbuddy`，取证仍使用 `claude_browser`（代理自开浏览器），不新增观察工具。

~~~powershell
npm run workspace:start -- --agent <codex|claude|workbuddy> --intent <replica|learn|compare|resume|maintain>
~~~

读取返回 documents 与必要档案。ready 只代表上下文；歧义只询问任务对象，blocked 报具体缺口。新建不继承同 URL 旧任务，续跑使用冻结版本。索引缺失时 loader 只读现场定位，不为启动写索引或认证网站。

新建复刻的 documents 包含统一通用指南全文及哈希，按它判断组件、查询和容器职责；样本档案只按需查证。新增观察先对照已有规则，重复项合并、字段和参数留档，不按页面或批次凑经验数量。旧任务保持自身冻结知识。

修改前按 AGENTS 和 docs/shared-workspace.md 认领任务锁，令牌只留内存并通过 CLONEWP_WORKSPACE_TOKEN 进程环境传给原写入命令；每五分钟心跳，完成/中断前写交接并释放。过时交接先复核，过期锁不自动抢占，交接记录不授予发布权限。

## 新复刻任务的页眉默认

新任务默认使用既有完整流程的v4合同与响应式v2决策：桌面与手机共同取证，在并行准备前冻结图标/文字布局角色及稳定定位、每个手机宽度的动态产品同屏数量和原生参数、整条手机页眉滚动行为与具名用户覆盖。缺决定先补观察，不交给生成阶段猜测。生成前校验方案、原生参数和编辑器稳定选择器，最后以来源及用户要求对照编辑器和前台的实际布局、数量及滚动/菜单状态。具体数值按网站确定，不把2个产品或固定页眉设为所有网站的通用值。手机实现按职责放在 src/replica-responsive/，不新建入口或另一套流水线；同一WoodMart页眉内独立配置Mobile布局，绑定任务自有菜单，平板沿用桌面。缺真实来源、决策、原生适配或验收即不通过，不能降级绕过。操作格式见 [手机响应式能力](D:/cloneWP/docs/replica-responsive.md)。显式历史v1/v2保持冻结合同，旧页面和代码不自动迁移。


新建 replica 默认使用独立 WoodMart 页眉生成器搭配 WordPress 菜单，并先执行 [并行方案准备](D:/cloneWP/docs/parallel-replica-preparation.md)。代理自动形成 `clonewp-replica-preparation` 合同并用 `npm run create:replica -- PREPARATION.json` 生成独立任务包；用户不需要填写JSON或增加技能入口。协调者先冻结真实双桌面和双手机来源、共享字体/宽度/间距/断点及版本适用的原生与兼容条件，再用当前任务的协作工具并发启动页眉/菜单一组、正文最多两组。相关布局、状态和控制依赖必须同组；只有协调者操作共享浏览器、改共享规范并统一合并，准备代理只读冻结材料、只写自己精确结果路径，不认证或写远端，不触碰其它组或全局样式。不要将本地 `Promise.all` 读取已完成方案称为真实模型并行；协作工具缺失或关键兼容未知时在认证前报告阻断，不静默降级。

新 preparation v6 须在正文派工前为每板块冻结文字换行、素材/卡片数量、视觉分隔、默认状态、交互和动态六项来源检查；不适用也须带证据和理由。两个桌面宽度还须绑定来源截图的可量测文字行数/宽度、板块几何和颜色样式；有可见媒体时核对数量。正文结果逐项对应真实组件与实现机制，合并门拒绝漏项或错误映射；最后仍按这些检查在当前前台验证实际状态。普通样式和常见交互是本流程范围，订阅、库存、处方和结账后台不因此成为复刻承诺。此增强只约束新任务准备，不迁移既有任务；合并后的完整执行合同仍为 v4。

读取 [完整复刻流程](D:/cloneWP/docs/full-replica-workflow.md)；合并输出的 `FULL_MANIFEST.json` 再经 `src/replica-full/` 协调独立页眉模块与原生正文编译器，所有既有质量门保持。远程写入串行执行。正文排除全部来源页眉，避免重复；自动新建本任务页眉及菜单，只绑定自有 Full Width 页面，不改全站默认。先选目标实际支持的原生样式，再补隔离 CSS；整页桌面和手机视觉与交互通过后按任务冻结策略发布，交付资源名称、ID、编辑及预览链接和验证范围。

当前仅使用 `npm run create:replica -- PREPARATION.json` 或完整 manifest；自动建站、原创、旧分阶段及独立组件建页入口已移除。当前完整任务续跑与对账保留，旧锁不自动迁移。

页眉菜单按内容选模型：普通链接用 WordPress 子项，图片卡片/分栏/底部链接组成的富下拉面板用原生 HTML 内容块，内部沿用启用的原生 Elementor 组件并配置 WoodMart 下拉设计、宽高、配色和打开事件。不得用逐项菜单加位置选择器拼面板；静态分类卡片不强行加入商品。实现及兼容边界见 [原生菜单内容块](D:/cloneWP/docs/header-menu-content.md)，缺适配器在写入前报告，旧任务不自动迁移。

新任务的正文图片/背景照片优先写入 Elementor 原生图片控件，CSS 不得覆盖原生换图来源；渐变和照片分开。最终验收包含面板显示、代表图片实际替换生效及恢复原图的证据。最终回复必须用交付资源中页眉和菜单的真实名称作链接文字，不以“WoodMart 页眉”“菜单”代替名称。细节及新任务冻结策略见完整复刻流程。

这是现有项目流程的默认路由，不需要另一个项目技能。既有任务按自身冻结方案续跑；不迁移旧页面、菜单、组件实现或发布状态。用户明确要求组件页眉时仍可使用原实现。这里的系统默认不等于修改 WordPress 全站默认页眉。

执行速度按完整复刻流程的“执行速度约束”：同任务来源和未变知识只取一次，页眉/正文复用统一观察；已验证且版本适用的页面壳、字体、页眉换行、原生控件和减少动态效果兼容决定前置，未知组合只做相关只读核实，不为每单新增能力小样。本地素材准备可与各组方案产出重叠，原生设置优先，集中CSS后统一当前版本验收。局部修正先复查影响区域，同构交互选代表和边界状态，保留完整内容核对及最终两桌面质量底线。记录各组实际开始/完成、准备wall time，以及本地、远端、修正和验收阶段耗时；缺测项明确标记，不相加并发耗时虚构总时间或承诺倍数。普通复刻不跑平台全量测试/构建；系统源码修改先专项，冻结后全量各一次。达到验收就交付，不增加无关试验或重复检查。

协调者在取证、共享规划、本地素材和最终视觉阶段开始前，对自有已存在材料目录调用 `replica:prepare phase --directory DIR --stage source-observation|shared-planning|material-preparation|visual-acceptance --event start`，结束用返回marker提交 `succeeded`/`failed`/`cancelled`。最终同时读取材料目录 `phase-events.json`、准备组和远端timings；state未关联外部阶段的“未测量”不能覆盖已记录实测，真正缺测项仍明确未测量。具体命令见并行方案准备说明。

## 按意图执行

新准备合同使用默认 v8，不显式降回旧版本。前两步按 `docs/three-step-replica.md` 绑定来源与真实子区域：先读 hash-bound 的 44 组件专用样式与共用高级设置目录，可用 `replica:prepare read-native-settings --directory DIR --widget TYPE` 按需读取；桌面 `styleBindings` / `nativeStyleSettings`、手机 `responsive.styleBindings` / `responsive.nativeStyleSettings` 加对应 `contentBindings`。原生设置须符合实际注册、前置条件、设备及重复项身份；先执行设置，再按真实子区域处理无法表达的隔离 CSS，不能用额外 CSS 遮住失败的原生方案。读取 `style-production-plan.json` 和正式保存意图中的处理回执；来源声明、注册验证和实际显示分开记，缺绑定/不支持保留为未完成，不把组件默认外观视作来源设计。维护不创建页面作测试。已冻结 v1—v7 合同不自动升级。

- 复刻建站、参考建站、裸参考 URL：replica；读取 **D:/cloneWP/.agents/skills/reference-elementor/SKILL.md**。
- 学习网页/组件：learn；使用 COMPONENTS 的增量入口，保留证据范围，不自动启用组件或生成草稿。
- 系统代码、文档、架构：maintain；按五层职责只加载相关模块。

复刻或修正的 CSS 由系统受保护修订流程直接应用后复核，不停在让用户手动粘贴；复核只读，不能用旧 manifest 覆盖已有修订。

任务记录、测试和知识证明不能代替实际来源及本页视觉/交互判断。当前用户请求决定本轮范围，不把旧案例限制变成全局默认。

完成复刻或授权修改后，自动执行 [编辑器版本收尾](D:/cloneWP/docs/editor-completion.md)：最终保存/发布读回→当前任务页已知旧自动保存对齐→正常可编辑重开→实际模型/CSS/截图与后台核验→刷新最终交付。新任务冻结策略，新修订只约束本次版本；未知用户编辑保留，加载/安全模式/历史预览不通过。只处理当前任务页面，不修改其他页面或全局设置；不要把收尾留给用户手工触发。

该页编辑器加载中时默认自动调用上述文档的 editor:complete recover --stdin：连接正常先观察最长120秒，确认无未保存和进行中/未知保存后最多刷新一次，240秒总预算，实际就绪立即继续。只用当前任务原标签；真断线才复用一次连接恢复，穷尽后按具体原因求助，不反复要求用户重连。复用同一恢复packet和已消耗时间/刷新机会，不重建循环；未知状态保留，不能伪填空闲。

## 浏览器连接与学习观察

浏览器工具期限按 docs/browser-troubleshooting.md 的三层预算：页面内短探针、完整适配动作、外层工具返回余量。不能用8—15秒的外层包住可能仍在初始化或往返的调用；当前默认完整动作55秒、外层60秒，页面内探针5秒独立传递。使用恢复器校验 timeoutBudgets，并将其 toolTimeoutMs 实际传给 cua_repl；仅写入合同不算执行。`js execution timed out; kernel reset` 是工具执行超时，不能当作扩展离线，不让用户反复重连、重启或新开聊天。先核对实际成功/失败调用和各层预算，恢复后验证真实正文、结构化读取与截图；不能只凭标签列表或导航结果。

通用三步按 [完整呈现依据](D:/cloneWP/docs/three-step-replica.md) 执行：新采集保留逐行文字、完整排版/间距/裁切和公开状态，准备包 `productionGuide` v3 把每项对应到真实容器与原生设置，手机沿同一资料与 `_mobile` 分支处理。制作前读取自动诊断，未测文字、原生间距冲突与状态周期是具名待办，不等用户截图指出。实际前台比较可调用现有 `replica:prepare compare-presentation` 对冻结源与目标观察逐项诊断；缺映射、实际宽度/状态不一致不称通过，报告不代替视觉/交互及当前版本验收，不新增组件或改旧任务。

新复刻必须先按 [原站信息完整性](D:/cloneWP/docs/source-completeness.md) 建立与组件选型无关的全内容清单。先读来源导入返回的 `sourceCompletenessPath`，核对文字正文、全部链接及地址、可见/隐藏内容、媒体、装饰与待观察状态；不能以选定 44 组件、节点存在或制作成功证明来源已完整。具名补采及报告缺口，不按站点补固定数量，不无限重试。

接口生成和集中验收遵循 [WordPress 会话与集中验收](D:/cloneWP/docs/wordpress-session.md)。同一命令页眉/正文复用连接，不缓存当前页面/菜单/商品或跳过 CAS；失败写入先对账。静态富菜单先生成 `plan-menu-review` 计划，原生 hover/click、真实稳定状态、一次截图及前后身份核对集中完成。当前工具未提供 hover 就一次明确报告能力缺口，不用右键/Escape、拖拽或合成事件试探，不把软件测试当成当前页面验收。

先清点已连接浏览器实例和用户原有标签，再按实际 URL 绑定。同名 Chrome 可能属于不同实例；使用清点返回的 browserId 与 tabId，不把临时标识写成固定配置。绑定后读回实际 URL，避免仅凭窗口标题或浏览器名称判断未连接。新任务的来源标签缺失时按浏览器恢复的 `autoOpen:true` 由代理使用工具明确支持的 API 主动打开，最多三个只读候选错峰争用同一180秒预算；首个通过 URL/DOM 检查者胜出，仅关闭代理自建败者，不反复让用户开页。旧冻结合同仍按原入口。

用户“附加 Google Chrome”的 Appshot 只提供当时的页面上下文，不证明 CUA 中有可操作的 Chrome 实例。开始控制前必须核对实时浏览器库存和 API；若 Chrome 不在库存，先区分公开页面可用的独立采集与需要既有登录态的 Chrome 操作。后者按桌面应用 Chrome 扩展与 `@Chrome` 连接流程排查，不能以 QuickQ、CSS 或页面加载慢作为未经证实的断线原因，也不能把 `iab` 或 Playwright 冒充 Chrome。

采集前按 D:/cloneWP/docs/browser-troubleshooting.md 执行 `npm run browser:preflight -- --stdin`，输入由代理用实时库存、实际 URL、小探针结果及序列化请求字节数组装，不要求用户填写诊断 JSON。区分扩展离线、标签未附着、消息超限、瞬时 CDP 超时和截图布局差异。瞬时只读探针最多重试一次，失败后保留分类证据；不得用反复重启替代诊断，也不得硬编码会话实例或绕行来源 HTTP。

商品具体内容可不同，商品区仍须用真实原生组件还原来源布局、样式和交互；“商品以后自己弄”只豁免选品匹配，不默认空置。整区空置仅接受明确的整区空置/移除范围，见 SYSTEM 与 COMPONENTS。

学习已有 Elementor 页面时，将正文的 data-elementor-id 与共享页眉、页脚、菜单模板分开。读取真实 data-element_type、data-widget_type、Navigator 和现有面板值；面板值属于实例观察，不作为注册 schema 或通用默认。截图像素格式、尺寸及 iframe 坐标换算须实际核对，临时 viewport override 结束后 reset。

浏览器连接排查实例见 D:/cloneWP/reports/elementor-learning-20261016/BROWSER-CONNECTION.md；组件和容器经验见 D:/cloneWP/docs/knowledge/elementor-container-patterns.md。

新任务默认使用 [统一编辑器运行与续跑](D:/cloneWP/docs/editor-completion.md)：version:2 recover 协议按任务/页面/版本持久化，沿用 incidentId/cursor/已消耗预算；原生 fidelity 检查复用同作用域的干净会话，临时编辑或还原后加载新模型，最终重开独立。先集中本轮关联调整再保存整份CSS，完全相同且fresh读回匹配则跳过内容写入；只复用单次验收内哈希未变证据并复核依赖，不缓存当前后台状态。原视觉、交互及编辑验收不减少，历史合同不迁移。

## v4 手机视觉审核
新复刻任务的 bodyBase 使用 visualAuditVersion:3。两手机视口按真实 clientWidth 逐区采样文字换行、颜色、背景和控件；轮播还需来源与目标滑动前后截图及卡片几何。按 D:/cloneWP/docs/replica-visual-audit.md 验收；证据不全在远端写入前停止。显式旧合同不迁移。

## 原生单品扩展

当前已增量启用 12 类原生单品组件：基础 43 Widget＋1 Container 的目录与知识哈希保持不变；新任务可冻结经资格验证的 componentExtension，合计 56 个身份。普通页面及旧任务没有扩展引用时仍严格使用原 44；新增组件须使用任务自有 woodmart_layout / single_product 模板、当前 WooCommerce 商品读取与原生请求运行资格。沿同一 preparation → full → native44 → responsive/验收流程，不安装桥接插件，不把实例商品 ID、价格或手机数值写成默认，不自动设置全站显示条件。

资格及剩余边界见 docs/unified-component-model.md；source-only 学习不能扩大权限。新任务从 readCurrentRelease 读取可用扩展，选择新增组件后显式冻结 componentExtension；native44KnowledgeIdentity 默认仍返回基础身份，只有显式传入扩展时才带入，普通页面不被隐式迁移。单品只改变同一流程的原生保存对象和请求上下文；不创建独立流水线或安装运行插件。

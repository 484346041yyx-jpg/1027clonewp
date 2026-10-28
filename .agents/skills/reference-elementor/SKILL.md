---
name: reference-elementor
description: Build desktop and phone replicas in one cloneWP workflow from the user's open browser with enabled native components, apply consolidated page CSS to the authorized draft, and verify actual desktop and phone rendering and interactions.
---

## 新任务的指令范围（优先于下文的整页默认）

新初始化 preparation v8 冻结 `executionPolicy`，按 [统一协调与执行减耗](D:/cloneWP/docs/replica-coordination.md) 使用两个浏览器工作窗口、单中心、依赖完整的 `body-N` 工作包和最多三个制作槽；常规默认三个制作代理，仅极简低工作量正文用一个，依赖不足不强拆，页眉包也占槽。整页集中对比、批量返修和材料复用不减少原双桌面/双手机、交互、可编辑性及发布/编辑器质量门。没有策略的旧冻结任务不迁移。代理只准备本地分配文件，中心统一浏览器与串行远端写入。

新任务询盘表单按 [通用询盘表单默认要求](D:/cloneWP/docs/inquiry-forms.md) 在同一路线配置提交、后台保存和项目收件邮箱通知，按不同来源识别各自字段与样式。发件设置按每站自动生成，无需逐站提供；不生成账号或 SMTP 凭据。testing:user-managed：配置、控件、样式与实际保存读回由代理核对，真实提交/发送/收件由用户测试，不自动发测试邮件。历史任务和已发布页不自动改变。

`复刻页眉：URL` / `复刻页脚：URL` / `复刻页眉页脚：URL` 分别冻结公共资源合同 header-only / footer-only / header-footer，走同一 create:replica 入口。页眉沿用 Header Builder；页脚沿用 native44 和 responsive 并保存为独立 cms_block，具名任务预览页引用新块。悬停取证按本次公共范围执行。用户明确自行检查时可交付未绑定草稿，不能声称视觉验收通过，也不改变旧公共资源和全站绑定。

按 [复刻指令范围](D:/cloneWP/docs/replica-command-scope.md) 分流：`复刻网页：URL`、`复刻正文：URL` 和裸参考 URL 默认只制作正文，复用当前项目已核验的公共页眉、菜单和页脚；`复刻页眉页脚：URL` 只制作公共部分及其依赖，不复制普通页面正文。只有用户明确要求包含页眉页脚时才按整页范围创建。缺公共资源先定位，不擅自创建或替换。新正文合同使用 pageScope: body-only、reusedHeader 及独立 footerUnits；保留公共页脚。所有下述取证、并行准备、原生组件、样式、响应式、验收、编辑器收尾与发布流程不变，准备组按本次范围派工；“完整流程”不等于扩大内容范围。旧任务保持冻结合同。

当前仅支持完整参考网站复刻。共用 V2 来源数据、44 原生组件、手机响应式、页眉菜单、修订、验收和编辑器收尾保留；不得回退已移除的旧执行器。


本技能是 D:/cloneWP 项目内版本，处理 replica；其它意图由项目 clonewp 路由。先通过统一 workspace:start 入口取得任务合同与规则，不重复加载已有资料。

## 本次范围与制作调度

新任务使用 preparation v8 → full v4 与响应式v2决策：桌面与手机共同取证，在并行准备前冻结图标/文字布局角色及稳定定位、每个手机宽度的动态产品同屏数量和原生参数。本次制作页眉时还须冻结手机页眉滚动行为及具名用户覆盖；正文复用公共资源时按对应只读范围核验。缺决定先补观察，不交给生成阶段猜测。生成前校验方案、原生参数和编辑器稳定选择器，最后以来源及用户要求对照实际布局、数量及滚动/菜单状态。数值按网站确定，不把固定产品数量或固定页眉设为通用值。手机沿 src/replica-responsive 接入，平板沿用桌面，不新建执行器。操作格式见 [手机响应式能力](D:/cloneWP/docs/replica-responsive.md)，旧任务保持冻结合同。


无冻结 task/run 的新正文任务默认只读复用已有公共页眉/菜单/页脚；明确制作页眉时才采用 WoodMart 页眉生成器＋独立 WordPress 菜单。先执行 [并行方案准备](D:/cloneWP/docs/parallel-replica-preparation.md)，再执行 [完整复刻流程](D:/cloneWP/docs/full-replica-workflow.md)。协调者冻结共享材料和兼容条件，自动生成工作包，通过当前协作工具和队列真正并发制作；不要求用户填 JSON，不擅自创建普通独立聊天。任务结果、槽位、共同决定及返修归属按统一协调文档；相互依赖板块同包，制作代理只写自己的结果。协作能力或关键能力未知时认证前具名报告，校验成品的 `Promise.all` 不算模型并行。

统一合并、完整来源覆盖及原生编译通过后，远程写入仍串行；自动创建本任务资源，只绑定自有 Full Width 页面。正文排除来源页眉，先选合适的原生样式再补隔离 CSS，最后统一整页两桌面和两手机视觉与交互检查，既有质量门和容差不变。该默认只作用于新任务，不改变全站默认页眉及既有页面。原完整manifest及组件任务继续冻结入口，原组件路径也用于用户明确指定的组件方案。

## 观察与规划

来源工具先区分页面内探针期限与完整工具动作期限，按 docs/browser-troubleshooting.md 的 timeoutBudgets 执行：页面探针 probeTimeoutMs 不用于包住整个调用，外层 cua_repl.timeout_ms 必须覆盖动作和返回余量（当前默认完整动作55秒、工具60秒）。工具执行超时/kernel reset 不证明浏览器离线；先修正调用预算和绑定，不让用户反复重连/重启/新建聊天。恢复成功需真实URL、正文、结构化读取及截图，不能只凭导航或标签清单。目标未知写入仍先对账。

富下拉菜单先按 [原生菜单内容块](D:/cloneWP/docs/header-menu-content.md) 选型：普通链接层级可用菜单子项；图片卡片、分栏和底部链接的整体面板使用原生 HTML 内容块，内部使用启用的原生组件及任务媒体，原生下拉参数负责容器行为。此职责只属于独立页眉模块，不回到正文生成器用菜单项和 nth-child CSS 拼装。

协调者按 [并行方案准备的阶段计时](D:/cloneWP/docs/parallel-replica-preparation.md) 在取证前启动 `source-observation` marker，共享规范/素材/最终视觉分别启动对应阶段；阶段结束或失败均用返回marker收尾。日志保存在本任务材料目录 `phase-events.json`，交付时与准备组及远端timings一起读取，未测量项继续明确标记。

1. 使用用户指定或现有唯一匹配的连接标签，以实际 URL、正常 DOM 和截图判断。挑战由用户处理后继续原标签，不新开来源采集浏览器绕行。
   采集前遵循 D:/cloneWP/docs/browser-troubleshooting.md，代理以实时库存、小探针及完整请求字节数调用 `npm run browser:preflight -- --stdin`；按故障分类处理，禁止仅凭一次超时反复要求用户重启。
2. 新任务使用同一 preparation v8/full v4 合同与响应式v2决策覆盖两桌面和两个手机宽度，正文组件编译仍复用原生桌面基础；手机能力通过 src/replica-responsive 接入。先读 D:/cloneWP/docs/replica-responsive.md，并在共享规划阶段冻结本范围的布局角色、动态组件数量及页眉滚动策略；生成前完成对应校验。实际断点在冻结前核实（当前测试站手机768）；平板沿用桌面，只做断点检查。历史任务按自身冻结合同。截图前后核对视口/几何，重排长图改为固定视口分段，结束恢复视口。
3. 按 `src/native44/source.ts` 合同导入真实扁平观察，保留共同所有者、重复显示位置、背景资源、轮播和控制器关系，不伪造来源声明。

~~~powershell
npm run reference -- "https://source.example/"
npm run reference -- "https://source.example/" --observed "D:/cloneWP/<OBSERVATION_DIR>"
npm run design:check -- "D:/cloneWP/references/<TASK_ID>"
~~~

4. 从来源事实识别职责；协调者统一字体、宽度、间距、断点、原生控件及页眉/正文分区，再按依赖划分准备组。先用版本适用的已验证知识确定页面壳、页眉换行和减少动态效果兼容；未知组合只读核实所用能力，不每单建能力小样。按需读 COMPONENTS、所用档案及 [页面模式与容器](references/page-context-selection.md)。不从已选控件反推角色，保持文案、构图、留白及归属。
5. 只为本次范围实际生成的工作包启动协作任务，槽位不足的包排队，完成后继续领取；相关依赖不拆散。各组使用冻结素材清单，独立准备组件配置及局部CSS，资源缺口返回中心，不自行添加或替换。中心同时处理本地素材、接收并校验输出，统一合并和去重。制作中代表性核对结构/字体/关键状态，整页形成后集中对比并按原负责人批量返修；缺适配器具名报告，不静态拼业务能力。记录真实阶段和等待耗时，不用各组相加冒充并发总时间。
6. 商品具体内容使用目标真实商品即可，仍须用原生商品组件复刻来源卡片、排布、留白、字体与轮播交互。商品类别不同或后续自行选品，不代表商品区空置；整区省略须有明确范围声明。

## 完整生成与交付

冻结方案并准备素材，一次提交完整正文并读回。恢复依据写入回执，不创建逐块小样或反复修页。定位使用 widgetTargets，容器按职责显式规划。

~~~powershell
npm run create:replica -- "D:/cloneWP/references/<TASK_ID>/full-manifest.json"
npm run replica:full -- review --run-dir "D:/cloneWP/runs/<RUN_ID>" --evidence "D:/cloneWP/references/<TASK_ID>/review.json"
npm run replica:full -- publish --run-dir "D:/cloneWP/runs/<RUN_ID>"
~~~

整页入口的参数及证据格式以完整复刻流程和当前 CLI help 为准。旧组件任务保留原命令：

~~~powershell
当前仅使用 `npm run create:replica -- PREPARATION.json` 或完整 manifest；自动建站、原创、旧分阶段及独立组件建页入口已移除。当前完整任务续跑与对账保留，旧锁不自动迁移。
npm run compare:replica -- "D:/cloneWP/runs/<RUN_ID>"
npm run compare:replica -- "D:/cloneWP/runs/<RUN_ID>" --verify-applied
~~~

查看实际截图，判断绑定截图/文档哈希。只读比较先归因；需修正时走独立受保护修订，统一合并完整页面 CSS 到 Elementor 页面设置并直接应用、实际读回，再做双桌面视觉与交互复核。保持 compare 只读、串行写入、所有权与预期状态检查；不自动重新生成整页，不发布。结构、媒体、查询和核心交互错误不能用 CSS 掩盖。仅用户明确要求手动交付时停在 CSS 待应用，否则不得把未应用 CSS 当完成。续跑先验证 current-user-amendment 当前指针，旧 program/journal/CSS 留作历史，不覆盖后续修订。

细节按需读 [证据与编译](references/evidence-compiler.md)、[呈现检查](references/presentation-and-runtime.md)，历史步骤只用于相应历史任务。

## 维护合同

交付前自动执行 [编辑器版本收尾](D:/cloneWP/docs/editor-completion.md)：最终实际保存/发布读回后，对齐当前任务页已知旧自动保存，再正常重开，读取实际原生文档模型、页面CSS和截图并 verify，最后刷新交付摘要。只处理当前任务页面；未知编辑内容保留，重开未确认不能声称全部完成。该步骤由 src/editor-completion 独立维护，新任务默认冻结，新修订绑定当前版本，旧合同不迁移。

加载恢复也走该默认入口的 recover --stdin：连接正常保留当前任务原标签，先等待最长120秒，再严格确认无未保存修改、无进行中/未知保存后最多刷新一次，总预算240秒；真断线才复用连接恢复一次。实际就绪马上继续，自动恢复终态才按真实原因求助，不反复要求用户重连。已有等待计入同一事件预算，未知刷新响应不重发，不能重建packet重获额度。

新格式见 `src/native44/types.ts`、`src/native44/validate.ts`；共享观察及方案见 `src/replica-v2/types.ts`、`src/replica-v2/component-plan.ts`；历史 v1 保留 `src/native44/types.ts`、`src/native44/validate.ts`。未知/冲突标记不得降级。旧任务不补默认或 release lock，不改 ID、CSS、视口与编辑验证语义。

新任务默认使用 [统一编辑器运行与续跑](D:/cloneWP/docs/editor-completion.md)：version:2 recover 协议按任务/页面/版本持久化，沿用 incidentId/cursor/已消耗预算；原生 fidelity 检查复用同作用域的干净会话，临时编辑或还原后加载新模型，最终重开独立。先集中本轮关联调整再保存整份CSS，完全相同且fresh读回匹配则跳过内容写入；只复用单次验收内哈希未变证据并复核依赖，不缓存当前后台状态。原视觉、交互及编辑验收不减少，历史合同不迁移。

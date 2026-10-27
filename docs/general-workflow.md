# 通用复刻、修订与验收

平台代码入口覆盖需求、来源采集、原生能力、当前 CSS、修订事务和交付判断。新任务使用新合同；历史 program、来源、release lock、CSS 和 journal 保持冻结。这里的本地检查不能代替实际页面截图审阅。

新任务及今后准备的授权修改默认在最终保存/发布、实际读回和质量验收后执行 [编辑器版本收尾](editor-completion.md)，由代理自动对齐本任务页的已知旧自动保存、正常重开核对当前模型和截图，verify 后再生成 delivery。实现由 src/editor-completion 独立维护；新修订只绑定本次版本，不迁移历史合同。未知自动保存、他人编辑及其他页面保留，缺重开确认不能报告交付完成。

最终公开状态由任务首次创建时的 `finalDeliveryPolicy` 冻结，当前新 native44 任务默认 `publish`。构建仍先保存草稿；完整 CSS 通过通用 `revision prepare/apply/review` 形成当前指针，实际视觉、商品及交互检查通过后执行 `npm run publication -- finalize --run RUN`，无需再次询问。兼容的旧手工 CSS 比较路径不会自动创建当前指针，也不能继承新发布默认。已有任务的明确发布请求使用 `publication prepare/apply/reconcile`，精确绑定当前页面和复核证据。发布有独立回执并保留历史草稿；已发布页默认只读，用 `compare:replica -- RUN --verify-applied` 核对。

`current-review -- prepare --run RUN --request FILE --summary` 先做完整只读预检；错误引用不会留下半份复核记录。成功导入退出 0，质量缺口仍通过独立状态和固定清单报告。发布成功不等于所有功能完成，明确放弃的交互能力仍列入未完成及发布范围例外。

新任务冻结 `reviewWorkflow:whole-page-after-css-v1`：整页选型、正文和页面设置完成一次保存与读回，整理并受保护应用整份页面 CSS，之后才开始一次两桌面的完整视觉和交互验收。构建时只运行 schema、素材引用、原生控件、权限/所有权、预期状态和保存读回等必要检查；局部只读测量不触发逐块正式截图验收。问题统一收集、统一修正，实际文档或 CSS 改变后做完整回归；质量底线、容差与必需覆盖不变。

整个复刻流程（生成、原生制作、复制、修订和最终写入）均保留目标站已注册组件的原生名称，不自动写入 Navigator `_title` 或另起中文别名。新任务继续冻结 `editorNaming:native-translated-v1`；旧合同的 `editorTitle` 和来源别名只保留为可读元数据，不再生成导航器别名，不能通过旧合同兼容分支重新写入。页面文字、Widget 类型、ID、结构、CSS 及实际 `title`、`item_title` 等内容字段保持原职责；既有远端页面只在用户明确授权的范围内清除 `_title`，不自动迁移其他页面。

## 来源和要求

所有页面类型共用 `src/core/replica-url.ts` 的来源路径规则：目标域名 + 来源原路径；来源站内链接保留路径、查询和锚点。新建入口在认证前校验 sourceUrl/slug 一致性，远端建页使用 sanitize_title 与 wp_unique_post_slug 原生分配（草稿也提前按 publish 规则分配唯一地址，不改变发布状态）；不生成品牌、任务或日期前缀。规范化或重名导致 -2、-3 等后缀时记录并读回实际地址，内部链接使用实际地址，交付明确提示来源和实际路径，不覆盖原记录。路径有父级或指向首页时，当前平级入口明确阻断，先解决原生父级路径或首页所有权，禁止改造来源路径绕过。历史已建资源不因此自动迁移；获授权的现有页面按来源 URL 映射更新，并保留内容、样式与发布状态。

裸 URL 的 `reference` 返回用户浏览器观察要求，新入口要求 browser sidecar v3。代理使用本次连接库存绑定实际 browser/tab/frame，执行小请求后采集两桌面，保留每次 v2 capture transaction 回执、文档/CSS 身份、真实截图和恢复读回。事务只证明采集一致性，不能证明视觉复刻相同。

```powershell
$transactionJson | & 'C:/Program Files/nodejs/npm.cmd' run browser:preflight -- --version 2 --stdin --raster D:/cloneWP/<截图路径>
```

请求预算默认 32 KiB、响应 256 KiB，所有阶段共用一次 CDP 重试。连接、标签附着、超大消息、DOM 加载、截图漂移分别诊断，不将重复重启当恢复策略。详细字段以 `capture-transaction.ts` 和 `native44/source.ts` 的 schema 为准；历史诊断 v1 与 sidecar v2 保持原语义。

新建任务写入 v2 `requirement-profile.json`，默认 `goalProfile: component-reference-v1`，使用 `source-requirements-v1` 完整记录来源事实、控件、内层布局及行为状态。默认优先使用已启用原生组件和组合；局部 HTML 例外仍须按原有选型和证据规则证明，不能为像素相同替换成整页 HTML。旧 v1 marker 和无 goal 的冻结任务保留严格原义，不自动迁移。

每项实现映射带组件设置指纹和能力证据；按钮不是搜索输入，链接不是动态购物车数量，自动播放不是暂停控制。新默认把可编辑草稿、质量底线、需求完成度分别计算：具名未接入的搜索、购物车、表单或第三方服务可保留为待配置项，不能冒充功能已完成。主体模块、可编辑性、真实商品查询、结构、溢出及已实现的关键轮播/折叠行为失败仍阻断。离线 `design:plan` 输出 `draftReady` 和 `requirementsComplete`，认证前检查组件和质量所需能力。

隐藏节点不自动等于移动变体。可选 `sourceScopes` 保留所有来源事实与义务；只有实际两桌面原始包及可达状态探测证明 `outside-desktop` 时，验证器才排除该行为的交付阻断，结果仍列出 `scopedOut`。默认隐藏、未测试或证明不足继续是未解决项，不能靠自填分类删除要求。

商品图片、名称、价格和类别可以不同。原生商品组件、真实查询、卡片尺寸、字体、间距、图片区域、每屏数量、滚动、箭头、分页和悬停仍在合同内。整区移除须有明确范围，不能从“商品以后自己弄”推断。

## 当前 CSS 与修订

`src/native44/css-model.ts` 保存唯一当前规则模型。CSS 和 native 控件分开声明责任；历史规则只留历史，编译不拼接旧 CSS。显式 `importLegacyNative44CSSModel` 支持完整采用旧样式，遇到歧义要求调用者区分覆盖和兼容 fallback，不做破坏级联的机械去重。

```powershell
npm.cmd run revision -- prepare --request D:/cloneWP/<修订请求.json>
npm.cmd run revision -- apply --run <RUN_ID> --operation <OPERATION_ID>
npm.cmd run revision -- reconcile --run <RUN_ID> --operation <OPERATION_ID>
npm.cmd run revision -- status --run <RUN_ID>
```

请求 schema 是 `Native44RevisionRequestSchema`（`src/native44/revision.ts`）：精确 task/run/page/operation、用户指令、预期 before hash、before/当前 CSS 模型/requirements/acceptance-policy/source-units/compare-manifest 的路径与 SHA-256，以及带原因和证据的控件修正或兄弟排序。所有路径在项目内；局部 CSS 修订不新增 Widget、HTML、媒体、商品或业务绑定。

prepare 在读取凭据前验证历史锁和全部本地输入，在 `runs/<RUN_ID>/amendments/<OPERATION_ID>/` 冻结请求、before/expected、CSS 模型及整份 CSS、需求、策略、来源职责、比较 manifest 和写前意图。apply 串行核对实际草稿归属、状态、唯一 run、完整 before，再使用目标注册控件、条件和值校验和服务器 CAS 保存、实际读回。当前指针只在完整证据通过后原子切换。

同一命令内按路径和 SHA-256 复用已验证的不可变证据及解析结果；不跨命令缓存，不缓存远端页面或浏览器状态。认证前和远端保存前重新读取全部依赖并校验，返回可见 `evidenceWork` 次数。CSS 模型编译只做一次完整验证和一次合并，独立检查实际原生控件和模块所有者；历史不进入当前样式。

未知结果先 reconcile：expected 确认；before 标记 retryable，后续显式 apply 才再试；第三状态保留冲突。已确认操作不重复保存。传输始终关闭，旧输入和外部修改保留。媒体发生未知净化时，可用 `WordPressClient.reconcileOwnedMediaTransformation` 只读检查现有附件的原始/提交/存储哈希；无可信转换收据就保持待对账，不再次上传注册。本次对账 operationId 不冒充原上传操作的独立服务器证明。

## 复核与停止条件

新流程先完成当前 CSS 修订，再进入正式截图；不能用初始 `compare:replica -- RUN` 在正文/CSS 构建中提前启动整页验收。比较入口对新合同执行调度预检：完整正文提交已确认、无未决写入、当前模型 CSS 已应用、当前整份快照与 manifest 对齐、全部来源顶层模块有唯一原生所有者。未就绪时在认证和浏览器采集前停止并给出缺口。预检通过仅表示可以开始检查，不能授予任何视觉或交互通过结果。没有新字段的历史归因路径不变。

```powershell
npm.cmd run revision -- prepare --request D:/cloneWP/<完整CSS修订请求.json>
npm.cmd run revision -- apply --run <RUN_ID> --operation <OPERATION_ID>
npm.cmd run compare:replica -- D:/cloneWP/runs/<RUN_ID> --capture-current
```

先读取当前不可变 manifest 和实际草稿，使用标准比较器采集来源存档与当前草稿的两桌面证据，再实际查看截图和交互结果。`revision review` 导入绑定当前文档、CSS、requirements 和两份报告的观察，不执行页面写入：

```powershell
npm.cmd run compare:replica -- D:/cloneWP/runs/<RUN_ID> --capture-current
npm.cmd run revision -- review --run <RUN_ID> --request D:/cloneWP/<复核引用.json>
```

`--capture-current` 复用已核对的当前 manifest 和历史来源证据，抓取实际目标页面，在新的 `runs/native44-review-<UUID>/` 保存标准报告与截图，不覆盖旧 run 的 CSS、journal、报告或当前指针。标准报告由同一个通用 reader 归一化，不需要按站点写转换脚本。复核记录仍须由实际截图判断及逐项验收观察完成；命令执行成功不自动授予视觉通过。

历史 v1 当前草稿可以显式使用 `revision:css prepare/apply/reconcile` 做有证据的 CSS 修正，再用 `current-review --run <RUN_ID> --request <JSON>` 收录当前截图判断和具名缺口。两条入口保留历史合同、正文和冻结来源；CSS 修正核对完整基线和服务器 CAS，审阅只更新本地状态。未完成的关键交互会保留 `reviewed-with-gaps`，不会因检查器运行成功或填写说明而变成通过。来源已证明全部显示且控制器不可见的静态呈现差异，须精确绑定报告项和冻结来源证据后才能具名接受。

需要替换原生子组件时，使用 `revision:native prepare/apply/reconcile`。请求绑定当前完整快照和精确子树哈希；新增片段走正常44组件编译，应用时再核对实际注册合同和进程内编译证明。子树外内容、商品查询和既有媒体绑定保持不变，禁止借此添加 HTML、静态商品或业务资源。旧 program、知识、release lock 不迁移；当前 manifest、CSS、截图复核随新修订失效并重新建立。

展开导航可以由 `createNative44DisclosureNavigation` 产生原生 Accordion、Tabs、Heading、List 组合，栏目与链接均为任务数据。明确声明的 `disclosureChecks` 会验证真实点击、键盘、ARIA、面板可见性和所有者隔离。仅自动播放或悬停暂停不代表用户播放开关；`behaviors/carousel-playback` 是可复用控制器和本地可审阅插件包，默认不安装、不挂载、不授予站点能力。启用仍需获准的部署适配、当前文档绑定及真实站点验收。

目标采集把懒加载检查和实际分段截图合并为一次整页滚动。每个会话复用媒体清点和有限并发的资源解码，仍记录每个显示位置、裁切、归属；文档或 currentSrc 变化使缓存失效。新图片就绪引起整页高度变化时，丢弃旧帧并有界重取；无新媒体的几何变化、坏图和动画漂移仍失败。`metrics.captureWork` 记录实际滚动、解码、命中、失效、补拍和阶段耗时，不能把单次离线耗时换成真实网站倍数承诺。

复核请求为 `{verification:{path,sha256}, visualReview:{path,sha256}, acceptanceObservation:{path,sha256}}`，acceptance observation 严格 schema 在 `requirements.ts`。截图、报告、逐项检查证据都实际重读哈希；时间早于最新保存或指纹不符的复核保留为 stale。已复核但关键要求未满足，不倒退成“尚未截图”。本地状态明确远端仅有历史快照，不能代替当前草稿状态探针。

新默认允许经实际观察的轻微几何差异（bounds ≤2px、inset/gap ≤4px）、明确像素测量的字号 ≤1px/行高 ≤2px 差异和明确的原生装饰差异，无须为每次小差异另填策略；错误字体家族、字重、未知属性或严重差异不在默认容差内。字体、主体边界/顺序/内容流、编辑、查询与真实性未验证会阻断质量底线；装饰和细间距未验证仍列出，`requirementsComplete` 为 false。结构顺序、内容流、溢出、假业务、缺组件和关键行为不能被容差掩盖。满足验收即 `stop`，具名待配置/未验证项可使状态为 `delivered-with-open-items`；这不等于所有功能完成。三轮低收益或重复阻断给出 `revisit-model` 建议，建议不授予通过。软件测试或模拟截图不代表真实网站视觉通过。

保存草稿、确认修订、导入复核和比较完成入口自动写入 `delivery-summary.json`、`DELIVERY.md`，同时保留内容哈希副本。清单固定列出已完成且验证、未完成/待配置、小问题、未验证、商品内容替换及组件例外，空项也明确写“无”；每项含位置、影响、下一步和证据。写盘失败不会输出完成。可用 `npm.cmd run delivery -- <RUN_ID>` 从真实证据重新生成本地清单，不加载凭据。`deliveryComplete`、`requirementsComplete`、质量底线、视觉复核和远端观测分别呈现；本地摘要不冒充刚检查过实站。

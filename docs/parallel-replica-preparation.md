# 复刻方案的并行准备

新任务先按 [复刻指令范围](D:/cloneWP/docs/replica-command-scope.md) 确定正文或公共页眉页脚职责；普通“复刻网页”默认正文，只读复用公共部分。下文原完整制作与质量流程不变，其中创建页眉/菜单及关闭页脚的整页行为仅适用于相应范围或历史冻结合同。

这是新复刻任务的默认准备阶段，独立实现位于 `src/replica-preparation/`。它位于真实来源观察与现有完整manifest之间，不改变 `src/native44/` 组件实现或现有远端执行器，也不创建独立技能入口。已有完整manifest、旧组件任务和续跑保持各自冻结入口，不自动迁移。

新初始化 v8 冻结 `executionPolicy`，按 [统一协调与执行减耗](replica-coordination.md) 使用两个浏览器工作窗口、一个中心、有限并发工作包、同任务材料复用、整页集中对比及批量返修。原质量门、发布和编辑器收尾完整保留；不为旧准备记录补字段或重分组。

用户直接提供复刻网站时，由当前代理完成取证、生成准备合同、调度子任务、接收结果及合并。用户不需要填写JSON、选择协作模式或再次提醒默认规则。

## 先减少返工

新初始化 v8 的正文包包含 `componentGuidance`：统一通用指南全文、来源 SHA256、不可变 snapshot 引用和使用说明。准备结果增加 `componentGuidanceReview: { guideSha256, decisions }`；每个所属板块恰好一个 decision，字段为 `sectionKey`、`principleSections`（相关的 1—5 节）、`componentKeys`（本板块真实 key，含主容器）、`compositionReason`、`settingsReason`、`phoneReason`、`phoneMode`（必须匹配本板块 responsive.mode，无手机方案才用 not-in-scope）。三项说明须描述当前来源支持的选型、原生条件/继承和手机机制，不能用归档数值代替当前证据。实际设置仍写原 blocks/nativeStyleSettings 和 responsive 字段；写一段说明不算实现。complete/merge 核对绑定后，合并的 `production-guide.json` 引用 `component-guidance-application.json`，记录真实组件、设置字段和手机控件；该记录不授予视觉通过。已冻结目录不迁移，样本只按需查证。

两个手机来源也须在分工前按真实 `phoneSourceOwners` 对应到各正文功能区，准备包的 `productionGuide.mobile` 自动携带该区完整内容、关系及逐节点实际样式；不能只给手机截图或把桌面关系换个名称。制作结果以 `responsive.contentBindings` 对应手机来源节点和本区组件；合并后的同一指南读出实际手机原生设置与复制树，缺内容或关系保留待办，不增加完美才可继续的关口。详细字段和范围见 [手机接入通用三步](replica-responsive.md#手机接入通用三步)。

按 [通用三步复刻](three-step-replica.md) 落实前两步。v6 准备包自动附 `productionGuide` v2：各来源宽度的功能区、外层/内容几何、父子分组、排列/对齐候选、间距与宽度比例、隐藏内容和交互所有者。准备者结合截图决定主要容器和内部组，不机械复制 DOM，不接受默认外观。合并后同一指南附真实容器树及内容映射；`build-diagnostics.json` 的关系/对齐/替换提示用于具名处理待办，不因视觉推断增加禁止下一步的关口。安全、身份、结构合同与远端并发保护不放宽。

协调者使用已连接的准确来源标签，新任务使用 preparation v8（继承 v6 的完整来源和样式目标，合并后仍生成现有 full-replica v4 manifest），一次取得1920×1080、1440×1000及两个手机宽度的来源事实与截图。手机材料进入同一合同的responsive.source，生成前决定进入 `responsive.version:2` 的 `decisions`；正文每组同时负责自己的桌面与手机表现，仅当制作范围包含页眉时页眉组负责同一WHB的Desktop/Mobile布局。旧任务仍按原冻结范围。一次冻结同任务共享材料，各组复用文件及哈希；不由每组重复操作来源浏览器或各自重抓。

用户明确要求原样复用既有页眉的 preparation v8 / full v4 任务，使用绑定页眉 ID、共享哈希及真实资源证据的 `reuse-readonly` 决定，不新建或改写共享页眉；仅免除来源页眉几何、滚动策略及页眉专属悬停的等价制作义务。来源原始信息不删除，正文的双端布局、悬停及轮播验证保持，目标仍须核对单一页眉、Logo、菜单实际打开和当前资源指纹。该作用域不适用于自有新页眉，也不迁移旧任务。

每个正文板块在派工前填写六项 `fidelity`：`text-layout`（完整文字、实测行数和有效宽度）、`item-inventory`（去重后的素材/卡片数量）、`visual-boundaries`（格线、留白、配色等）、`default-state`、`interaction`（点击/悬停前后）、`motion`（滚动触发、计数、轮播等）。不适用须写明原因并绑定来源事实和证据，不能留空。文字、媒体和布局事实必须被相应项覆盖；原站存在轮播/控件/悬停时不能把交互标成不适用。采集器也标出标签切换、折叠控件与数字滚动线索；标签本身不证明动作，须在原站确认。截图只代表一个状态，计数和切换须观察前后状态；未知能力先核实，不能用静态文字或图片冒充。表中的期待结果来自当前来源，不将某网站的数值、素材或效果当作通用默认。

新任务按“采集定方案→逐板块实现→对照验收”执行，重点前置到前两步。v6 的每个正文板块另填 `visualTargets`：两个桌面来源快照各至少一个 `geometry` 和 `paint`；有可见文字时至少一个 `text-wrap`（行数与有效宽度）；有可见媒体时一个 `item-count`（本板块该快照全部可见媒体事实及去重后的节点数）。目标绑定来源事实 ID 和该快照的截图引用，预检按实际来源数据核对，不能填通用数值或拿另一宽度的截图替代。其余卡片数量、图片裁切、间距、容器排列、边线、标签、折叠、轮播和悬停仍按六项检查完整记录；相似控件选代表状态，不必逐一悬停所有链接。`visualTargets` 是前置决策与验收目标，不是浏览器验收通过证明。v5 和更早已冻结任务不补填、不迁移。

分工前统一下列会影响整页的决定：

- 字体家族和字重、内容宽度、外背景、内限宽、间距及桌面断点。
- 来源页眉/正文的完整分区、板块顺序、共同所有者与交互控制依赖。
- 目标实际可用的原生样式、组件、关键注册控件和版本范围。
- 页面壳、主题标题/侧栏/页脚、页眉换行，以及减少动态效果下原生交互的已知兼容条件。
- 静态文案/媒体保留、真实商品和文章替换、未接业务等明确适配范围。
- 两个手机宽度的图标与文字角色、排列、宽度/收缩策略及间隙；组件角色使用稳定键/类名，兼容编辑器插入额外节点。
- 动态产品区来源实际同屏数量及目标原生手机字段映射；数量不能由准备代理随意设为1。两个宽度需要不同数量但原生字段不能表达时，先补适配或具名阻断。
- 整条手机页眉在顶部、向下滚动、向上滚动及菜单打开时的来源表现，决定普通、固定或向上出现及偏移；具名用户覆盖单独保留引用和理由，不抹去来源事实。

优先采用已验证且适用于当前版本的知识。只对未知组合做所需控件和依赖的只读核实，不扫描无关全部组件、不为每单创建能力小样。知识只提供候选与兼容依据，不提供历史业务ID、页面通过状态或当前视觉结论。关键条件未知必须在认证前报告缺口，不能将猜测冻结为通过。手机决定须在各组开始前完成来源/视口和真实几何核验，任务包哈希绑定这份决定；准备代理只能落实其所属部分，不能将不确定项留到保存后再猜。决定结构及实际适配范围见 [手机响应式能力](replica-responsive.md)。

## 并发产出与文件所有权

`clonewp-replica-preparation` 合同生成不可变任务包，真实模型并发由当前任务的原生协作工具调度。新初始化 v8 的 `executionPolicy` 固定 `browserMode:two-window-single-controller`、`reviewMode:whole-page-batched`、`remoteWrites:serial`、`reuse:task-hash-bound`；`maxWorkers` 为含页眉包的制作槽总数，最多3，中心不计入制作槽。默认按正文区域数量选1/2/3并受真实依赖组数量限制，不创建空闲代理凑数；常规页面通常2个。`targetSectionsPerJob:3` 是分包软目标，预计工作量、连通依赖和复杂区域优先。`body-N` 工作包可多于槽位，空闲代理继续接队列；只有明确制作页眉时才创建 `header` 工作包。没有 `executionPolicy` 的冻结任务仍按历史 `header/body-1/body-2` 规则，不追补默认。

正文按依赖划分：共享布局、状态、轮播控制或展开行为的板块保持同组；不机械按上下半页平分，不为增加并发强拆单个板块。中心独占共享规范及浏览器，合并前检查跨包 CSS、组件身份、正文顺序、边界间距和全部来源覆盖。各组产出是候选方案，不能代替合并后的实际整页验收。

| 角色 | 可做的工作 | 写入边界 |
| --- | --- | --- |
| 协调者 | 来源取证、共享规范、分组、能力核对、调度、接收、合并和最终验收 | 任务合同、共享材料、合并输出；统一操作共享浏览器和远端 |
| 页眉/菜单准备代理 | 原生布局、菜单层级、图标/账户/购物车设置及隔离页眉CSS；使用已冻结素材清单 | 任务包指定的页眉结果文件 |
| 正文准备代理 | 分配板块的原生组件子树、字段绑定及局部CSS；使用已冻结素材清单 | 各自任务包指定的正文结果文件 |

准备代理只读共享来源与规范，不读取凭据、不认证或修改WordPress，不操作共享浏览器、不改全局规范/全局样式，不写其它组文件或旧组件代码。每个代理启动前说明文件所有权及协作者存在，禁止撤销他人修改。各正文结果逐项填入 `fidelity` 实现方式及实际组件键；合并时拒绝缺项、跨板块组件、来源事实没有落到所列组件的情况。实现声明不是前台通过证明，后续仍须用浏览器实测。新能力的实现/数据路径与原方案独立；原页面、菜单、组件方案和源码不迁移。

协调者在冻结槽位内启动各组；每组在开始产出方案前登记领取/`start`，完成自己的方案后保存精确输出并执行 `complete`，再由空闲代理领取后续包。结果身份、共享规范/来源哈希、所属分区及文件引用须通过校验才登记完成。本地持久化的短锁可以排队，不等于模型准备串行；未开始产出的排队不能伪装为已运行。协作工具不可用、身份/范围冲突或缺关键结果时，停在本地并具名报告，禁止静默串行降级或把读取成品的 `Promise.all` 称为方案并行。

素材清单在调度前冻结，准备结果只包含页眉或分配板块，不自行新增素材机制。准备代理使用该清单；发现缺少必需资源时登记并返回具名缺口，由协调者按正常流程处理，不擅自添加或替换。协调者负责的本地格式转换/尺寸和文件检查，可在来源与文件所有权确定后与方案准备重叠。同一素材按实际字节及来源证据去重，保留各显示位置；禁止借并发创建重复远端媒体。所有目标站认证、素材上传、草稿/页眉/菜单/样式保存由协调者沿原受保护流程串行执行。

## 统一合并与质量门

只有全部必需组结果完成并通过校验后，协调者按冻结顺序合并正文模块、素材及局部CSS，形成唯一完整manifest。检查完整来源覆盖、重复ID、遗漏/重叠板块、跨组依赖、样式作用域与冲突；手机原生产品数量必须符合冻结决定，页眉 `layout.mobile.scroll` 必须与共享页眉决定完全一致，基础和手机CSS不能依赖编辑器会改变的容器子节点顺序。不能让任一组扩展到别组或页眉范围，也不能以CSS隐藏重复页眉。

合并结果继续调用现有完整prepare及native44编译、目标能力和资源验证。原组件集合、注册控件交集、实际当前进程编译证明、所有权、保护哈希、写前意图、CAS及写后读回保持不变。独立准备模块没有认证或远端写入能力。

最终仍实际查看当前版本两桌面及两手机整页，覆盖全部板块、文案/媒体/字体/布局/溢出、单一WoodMart页眉且正文无页眉，并按冻结的每板块 `fidelity` 对照文字行数、素材数量、分隔线、默认状态、点击结果和动态过程；还检查所用菜单、键盘、吸顶、账户、购物车、轮播、折叠和列表交互。v3 同时将两个手机宽度前台/编辑器的图标文字矩形、实际产品同屏数，以及页眉顶部/向下/向上/开菜单四状态与规划的来源决定对照；原生参数有值或轮播能切换不能替代这些结果。同构交互按实际差异和边界选代表，内容事实仍全部核对；局部检查、合法JSON、旧截图或其它组通过均不能代替整页通过。全局字体/宽度/公共样式变化须扩大复查范围。最终门、容差和停止条件不因并发或时间目标放宽。

通过后沿 [完整复刻流程](full-replica-workflow.md) 按冻结交付策略发布，交付实际页面、页眉、菜单名称/ID/链接和独立源码/配置位置，明确未验证或未接通业务。达到标准就交付，不额外增加试验。

## 实际阶段耗时

记录各组的实际开始/完成以及整体并发准备wall time；分别记录本地处理/合并、远端操作、修正和最终验收的实际阶段时间。单命令使用单调时钟；跨代理开始/完成使用UTC时间测量并明确标签，不能冒充同一进程的单调计时。取证、共享规范等由协调者记录；没有测量的阶段标记未测量，不填0或按主观估算补齐。

协调者在取证前，对本任务已存在的 `references/TASK` 材料目录执行 `phase ... --stage source-observation --event start`，保存返回的marker；阶段结束时用该marker提交 `succeeded`，失败或取消也分别提交 `failed`/`cancelled`，保留真实耗时。共享规划、本地素材和最终视觉验收同样分别使用 `shared-planning`、`material-preparation`、`visual-acceptance`。日志只存阶段、UUID和UTC，位于该目录的 `phase-events.json`，不保存来源正文、URL、凭据或错误敏感原文。

新增阶段及实际登记原则见 [统一协调的实测说明](replica-coordination.md#实测与报告)。`phases` 同时返回原始 `timing` 和区间并集 `summary`，不能把可重叠阶段时长相加为总时间；进行中、时钟异常和缺测如实保留。`body-production/local-merge/remote-save/batched-repair/browser-wait/editor-recovery/publication/editor-completion` 按实际事件登记，平台开发/测试单独用 `system-development/system-testing`，不补造历史事件。

```powershell
npm run replica:prepare -- phase --directory D:/cloneWP/references/TASK --stage source-observation --event start
npm run replica:prepare -- phase --directory D:/cloneWP/references/TASK --stage source-observation --event succeeded --marker RETURNED_MARKER
npm run replica:prepare -- phases --directory D:/cloneWP/references/TASK
```

准备组state、远端操作timings和材料目录的阶段日志分别保留。state中的 `sourceObservation` 等未测量标签只表示该state没有关联外部日志；最终报告须同时读取外部 `phase-events.json` 和任务/准备记录中的实测，不能无视已经记录的阶段，也不能据此虚构纯模型耗时。实际没有开始/结束测量的项目继续明确未测量。

并发组耗时可分别比较，但不能求和冒充总等待时间。保留失败、重试和修正耗时，系统开发/全量测试与正常页面执行分开统计；没有相近复杂度的可比实测，不承诺提速百分比。计时记录不携带凭据、Cookie、一次性URL或远端敏感原文。

普通复刻不运行平台全量测试或构建；本地方案和实际页面仍按现有规则验证。只有系统源码变更才先专项，源码冻结后完整测试与构建各一次。

## 代理执行入口

以下文件由代理在本次任务中自动生成；不是让用户手动编写或依次执行的交付步骤。`create:replica PREPARATION.json` 只创建本地准备记录，不认证或操作网站。传入 `--run-dir FINAL_RUN_DIR` 时，准备目录为相邻的 `FINAL_RUN_DIR-preparation`；以命令实际返回路径为准，不按最新目录猜测。

```powershell
npm run create:replica -- D:/cloneWP/references/TASK/preparation.json --run-dir D:/cloneWP/runs/RUN
```

返回 `awaiting-preparation` 后，协调者读取实际工作包与并发槽，在当前任务协作工具中启动相应制作代理。新 `executionPolicy` 任务只使用生成的 `body-N` 及本范围实际需要的 `header`，不得凭空创建额外包；无策略的旧冻结任务仍最多 `header`、`body-1`、`body-2`。队列记录不自动创建普通聊天，不授予远端写入权限。

```powershell
npm run replica:prepare -- next --directory D:/cloneWP/runs/RUN-preparation --worker body-worker-a
npm run replica:prepare -- complete --directory D:/cloneWP/runs/RUN-preparation --job body-1 --result D:/cloneWP/runs/RUN-preparation/jobs/body-1/result.json
```

`next` 使用稳定逻辑 worker ID 原子领取当前可用包；读回的 job、packet、resultPath 和 `workRevision` 才是本轮输出依据，示例 `body-1` 不可代替实际返回身份。中心随后通过当前协作工具启动实际模型制作，空闲 worker 完成后再次 `next`。`start --job JOB [--worker WORKER]` 保留显式领取入口，策略任务仍守总槽位及同 worker 一个运行包。已运行包不会因超时被自动抢占，须确认原制作停止后显式 `fail`。初次结果 `workRevision` 可省略为0，返修结果必须对应新的值。

准备代理遇到不能完成的具名缺口时返回协调者，并用 `fail --directory DIR --job JOB` 保留本组失败阶段及耗时，不填造结果或完成状态；该组失败会阻止统一合并。缺口解决且冻结合同未变时，可对该失败组再次 `start`，旧失败记录保留在 `previousAttempts`，其它完成组不重复准备；合同改变则停止复用旧结果。阶段状态以实际读回为准。

合并前要批量退回候选结果时，中心准备 `version:1, kind:clonewp-preparation-rework, taskId, runId, contractHash, requests:[{jobId,expectedResultSha256,reason}]` 文件。每条 reason 具名描述至少10字符的问题；哈希必须是该包当前结果，整批先校验身份再变更。执行：

```powershell
npm run replica:prepare -- rework --directory D:/cloneWP/runs/RUN-preparation --evidence D:/cloneWP/references/TASK/rework.json
```

原结果归档、owner保留且 `workRevision` 增加，`next` 优先让原负责人处理自己的返修；旧版本结果不能覆盖新一轮。同结果哈希的 `complete` 重试按实际已完成状态幂等，不增加重复修订。已经合并的任务拒绝本地 rework，返回 `rework_requires_current_revision`；实际页面问题按协调 `repairPlan` 归组后走现有 revision/CAS，不覆盖旧冻结准备结果或旧 full manifest。

全部必需结果完成后，由协调者统一合并；该步骤继续调用既有完整正文准备质量门，保留真实 `task-native-body-component-plan` v1，不自动填造选型批准或视觉通过。

```powershell
npm run replica:prepare -- merge --directory D:/cloneWP/runs/RUN-preparation
npm run replica:prepare -- status --directory D:/cloneWP/runs/RUN-preparation
npm run create:replica -- D:/cloneWP/runs/RUN-preparation/merged-MERGE_ID/full-manifest.json --run-dir D:/cloneWP/runs/RUN
```

`status` 输出实际准备阶段耗时和未测量项。策略任务还返回 `coordination` 及 `queue` 的实际槽位、running/ready/failed 和领取提示；`activeWallMs` 是运行区间并集，`spanMs` 是首轮开始到最终完成的经过时间，`workerOccupancyMs` 是工作包占用时间之和，不能把后者当用户等待。缺少结束事件的活动包如实显示，失败和旧尝试保留。远端执行继续使用完整任务自身记录；外部 phase 日志也要一起读。若输出目录或完整manifest路径与示例不同，使用命令读回的精确路径。旧任务不通过新准备合同重新包装，避免改动冻结程序、资源与通过证据。

# 当前任务的编辑器版本收尾

本能力是完整复刻和已授权修订的默认收尾步骤，由任务代理自动执行，不要求用户再提醒或手工对齐。独立实现位于 `src/editor-completion/`，复用现有工作流，不另建技能或建站流程。它确认已保存正文、当前页自动保存和正常重开的编辑器处于同一版本；前台视觉与交互验收继续独立执行。

新完整复刻 manifest 和新 native44 journal 冻结 `editorCompletionPolicy:{version:1,mode:"align-and-reopen",runtime:"shared-owned-editor-v1"}`。旧合同不自动补字段；今后准备的授权修订通过当前版本 marker 启用收尾要求，不改旧 program、CSS、journal 或历史完成记录。只读 status/resume 不迁移旧任务，也不触发远程写入。

## 会话与读取复用边界

`task.ts` 负责任务身份读取，`session.ts` 负责实际 fidelity 检查的串行编辑器租用，`recovery.ts`/`recovery-store.ts` 负责同一恢复状态机。只在同任务、同页面、同版本、同浏览器与认证作用域下复用上下文；正常只读板块选择可与后续字段检查共用干净模型。每次开始仍fresh核对后台归属/文档及实际保存状态。临时修改或后台还原后关闭旧编辑模型，下一检查在原上下文加载新模型；不复用脏模型、未知保存、不同页面或不同认证。最终交付的正常重开独立执行，不能被会话复用替代。

就绪仍要求真实原生面板、同源预览及当前页全部必需根节点。只有冻结原生设置声明 hide_desktop 且实际带 elementor-hidden-desktop 的替代根允许桌面隐藏；缺失/重复根或其它区域隐藏仍失败。只排除可证明不携带自动保存的认证/锁心跳，未知同源写请求继续阻止刷新。

修正前先收拢同一轮观察的关联调整，在本地合并、校验整份CSS，再串行保存一次，不为每个细节单独写回。新默认任务的完整 CSS 修订若编译结果与fresh保护读回完全相同，只记录零内容写入，不增加修订、不废弃该指纹的验收；真实变化继续完整失效/验收流程。整页验收在一次调用内复用既有哈希证据缓存，返回前重新核验依赖；不缓存后台当前状态或跨命令复用旧文件内容。

## 默认执行顺序

1. 完成最终内容/CSS写入、实际读回和视觉交互验收，按冻结策略完成发布或保留草稿。把本次实际读回的完整页面保存在本 run 内，包含 pageId、runId、elements、settings 及当前指纹。页眉/菜单名字沿原交付规则列出。
2. 代理自动调用下列 prepare，传入本任务当前完整读回和具名旧快照引用。previous 是 `[{"path":"before.json","sha256":"完整文件SHA256"}]`；干净新页面可为 `[]`。只接受本 run 内、同一 pageId/runId、哈希未变的已知旧版本，不能按最近目录猜测或扫描全站。
3. prepare 只读检查精确页面归属、正式文档、自动保存和活动编辑锁，并先持久化意图。align 仅在正式页面仍匹配、自动保存明确等于已知旧版本时更新该页当前用户的自动保存；已经一致或没有自动保存时不写入。未知内容、其他用户自动保存、并发变化均保留并具名阻断，不删除自动保存或历史修订。
4. 代理关闭自己持有且确认无未保存操作、无进行中或结果未知保存的旧编辑会话，重新进入该页稳定编辑 URL。若编辑器未就绪，默认自动执行下述等待/刷新恢复，不能仅因加载中就要求用户重连。存在用户未保存操作时保留并询问，不能擅自刷新。等待实际正常可编辑状态后，在同次浏览器观察中读取当前文档模型、正文元素ID、完整页面CSS和实景截图。加载中、安全模式、历史版本预览或仅前台正确均不算重开成功。不得为此改主题、插件、全局缓存或其他页面。
5. verify 核对重开证据及截图、实际编辑器模型中的原生设置，并重新读回后台正式页和自动保存。只有一致才解除交付阻断。最后完整流程执行 status；组件流程重新生成 delivery。任何后续保存形成新版本后，旧收尾回执不能复用。

```powershell
npm run editor:complete -- prepare --run-dir D:/cloneWP/runs/RUN --saved saved-readback.json --previous previous-refs.json
npm run editor:complete -- align --run-dir D:/cloneWP/runs/RUN
# 代理通过已连接的原生浏览器重开当前页，实际读取并保存证据后：
npm run editor:complete -- verify --run-dir D:/cloneWP/runs/RUN --evidence editor-reopened.json
npm run replica:full -- status --run-dir D:/cloneWP/runs/RUN
# native44 使用原有 delivery 命令刷新摘要。
```

align 响应丢失时只执行 `editor:complete reconcile --run-dir ...` 只读对账。已成功不重发；仍为写前状态才标记 retryable，再由代理显式 align；第三状态保留冲突。prepare 的意图不可覆盖，恢复操作先读 status/reconcile，不重新 prepare。

## 默认等待和单次安全刷新

同一页面只允许一个由本任务持有的可写 Elementor 编辑会话。公开前台预览可使用多个只读候选，但不得把其胜出标签当成编辑器已就绪。编辑器的240秒安全恢复预算保持不变；180秒时可报告进度，不要求用户重新打开页面，也不通过并发编辑器标签绕过编辑锁或保存状态。

### Chrome 受控标签卡在预览文档

先区分 Elementor 自身故障与浏览器控制层的响应拦截。若普通编辑器显示“加载中”、预览 iframe 仍为 `about:blank`，可只读观察该预览请求的 `Network.responseReceivedExtraInfo`、`Network.loadingFinished` 和 `Fetch.requestPaused`：响应阶段已收到 HTTP 200、却出现 `Fetch.requestPaused` 且没有完成事件时，不能仅凭安全模式能打开就断定主题或插件故障。不要在此状态强行用 CDP 放行响应；控制接口可能正在处理同一拦截并拒绝并发命令。

初次进入编辑器且尚未启动持久恢复 incident 时，优先接管已经正常加载、无未保存改动的当前任务标签。浏览器连接代际变化后，旧标签若连续出现 CDP 焦点探针超时，而同一连接的新标签可正常读取，应把旧标签列为失效绑定；不要再对它反复刷新或把超时解释为站点宕机。只有旧标签的无未保存修改、无在途或未知保存状态已由本次事件的可信观察确认，且尚未进入持久恢复 incident，才可用当前连接新建同一任务编辑标签并在完整加载后接管；不能确认时保留旧标签和内容，不自动替换。也可从 WordPress 后台可见的“使用 Elementor 编辑”链接以浏览器原生新标签打开。进入持久恢复 incident 后严格沿用原标签和既定恢复动作，不用新标签绕过编辑锁或重置预算。任何成功标签仍须读取正常模式的 iframe、原生模型和截图，单次成功不能证明底层拦截已修复。若未经接管的普通 Chrome 标签也失败，继续按 Elementor 官方排障检查实际 PHP 内存、请求错误和主题/插件脚本；不得擅自调整全站设置。外部发布或修改导致页面状态变化时，先对账，按已发布页只读边界执行。

当前任务编辑器可读取但未就绪时，由 `src/editor-completion/recovery.ts` 统一调度：每5秒观察一次实际原生面板/模型、预览文档及该页所需原生根节点，首次最多120秒，提前就绪立即继续。连接正常不反复清点或重取标签。新任务的实际 fidelity 编辑器检查经 `session.ts` 接入此入口，不再先运行一整轮旧初始化再恢复。历史合同保留 `awaitNativeEditorReady` 原路径；同一加载事件已等待的时间计入 elapsedMs，不能把两个120秒等待叠加。

仍卡住且没有未保存修改、没有保存中状态、实际在途保存请求为0、没有结果未知的保存时，才进行归属复查及两次间隔1秒的空闲观察。真正刷新前再核对精确页面URL/ID、任务归属、文档身份和保存状态，任何变化均保留并停止。只消耗一次原生刷新机会；刷新响应丢失视为 unknown，不重发刷新。之后继续观察，总恢复预算240秒，单次等待不超过5秒，期间可以汇报进度。

保存仍在进行时继续等，不能用刷新或重连打断；预算用尽说明保存未结束并先做原操作对账。未保存修改或无法确认安全时保留内容，说明具体缺口，不要求用户重连。登录、权限、实际安全模式/历史预览按真实状态说明，不自动改插件或全局设置。真实传输断开时才调用现有连接恢复器一次，复用它自身的有界重取原标签逻辑；仍失败才求助。一次恢复达到终态后不自行重建同一事件的 packet 或再次循环询问。

CUA 场景继续使用当前已经连接的浏览器工具，不从终端另开浏览器。新任务默认发送 `{version:2,scope,incidentId:"final-reopen"}`，scope 取当前任务/run的完整身份，调用：

```powershell
$recoveryPacket | ConvertTo-Json -Depth 15 -Compress | npm.cmd --silent run editor:complete -- recover --run-dir D:/cloneWP/runs/RUN --stdin
```

CLI 返回 continue/action、cursor 与 elapsedFloorMs。由代理执行实际受支持的工具，再发送同一 scope/incidentId、返回 cursor 及单个真实 event（probe/guard/wait/reconnect/refresh、实际经过时间、实际结果）。elapsedMs 不低于 elapsedFloorMs，wait 必须实际等待；状态由 `recovery-store.ts` 原子保存到本任务 `editor-runtime/`，续跑不重置。刷新/恢复连接先保存派发声明；回复丢失后重读同一 incident，无回执的刷新记 unknown，不再次发出。旧 version:1 内存协议只保留给冻结旧合同。事件类型见 recovery.ts；延迟必须实际等待，不能伪造 elapsedMs。probe/guard 使用实际 URL、Elementor saver 的 dirty 状态、完整保存请求观察和正常模型/iframe/原生根状态；guard 必须fresh核对后台 `_clonewp_run_id` 与当前scope归属。状态只存已清理的稳定页面身份、performance.timeOrigin文档加载身份、布尔/枚举状态与计时；浏览器绑定标识、Cookie、一次性URL、POST正文和原始错误不落盘；editUrl仅保留稳定post/action。请求/响应足够小，不读全页HTML。未观察到的dirty、saving为unknown，未完整跟踪的请求数为null，不能把缺失值当false或0。

刷新 action 发出前便消耗本次机会；代理必须再做一次安全检查，通过才调用当前标签的原生刷新，超时将 unknown 追加回原 packet。工具级未知错误按真实故障处理，不能伪报掉线而要求用户重连。协议本身不操作浏览器、不加载凭据，也不保存页面；就绪后还须完成正常版本收尾verify，ready不能代替视觉/交互/版本一致验收。

原有程序化原生浏览器会话使用 `recovery-browser.ts` 的具体适配器与 `recoverOwnedNativeEditor`，已有初始化等待通过alreadyWaitedMs传入（最多120000），避免重新等待完整预算。保存观察器须在该任务编辑标签首次导航前安装，记录真实请求开始/完成/失败，只保留计数；为区分认证/锁心跳与自动保存，仅在内存解析action/data键，不落盘POST内容。已打开会话缺历史则保持unknown，只有真实后台保存对账后才能确认空闲。归属校验由现有客户端精确读取当前页并传入verifyOwnership。复用原有会话和原生组件，不改旧组件实现，不将此适配器当成来源浏览器绕行入口。

## 重开证据和验证范围

证据 schema 为 `editorReopenEvidenceSchema`，保存在当前 run 内：

```json
{
  "version": 1,
  "scope": {"taskId":"TASK","runId":"RUN","pageId":9,"targetOrigin":"https://target.example","documentHash":"64位当前版本指纹"},
  "reopenedAt":"2026-10-19T00:00:00.000Z",
  "observedAt":"2026-10-19T00:00:01.000Z",
  "editUrl":"https://target.example/wp-admin/post.php?post=9&action=elementor",
  "mode":"editable",
  "safeMode":false,
  "historicalRevisionPreview":false,
  "loadedElementIds":["实际正文ID"],
  "document":{"elements":[],"settings":{}},
  "pageCss":"浏览器实际加载的完整页面CSS",
  "viewport":{"width":1440,"height":1000},
  "screenshot":{"path":"editor-reopened.png","sha256":"实际截图SHA256"}
}
```

示例是字段说明，不能直接提交为通过证据。document 必须来自重开后的当前编辑器模型，而非复制 saved-readback；loadedElementIds 来自当前页正文，不包含共享页眉/模板。按当前已观察的 Elementor 文档/元素模型 API 读取，缺模型或浏览器能力时明确未验证，不伪造数组或改用历史预览。CLI 负责作用域、事务、模型与证据校验，不会自行操作浏览器，也不会把本地软件测试当作实景确认。代理负责在同一个默认流程中自动调用 CLI 和原生浏览器完成闭环。

服务器只对实际注册控件的默认值做缺省归一，显式非默认值、类型、元素ID和结构必须一致。不同手机原生数量等设置不能因ID/CSS相同而漏检。正式页面、标题、状态、模板、绑定页眉和正文设置保持不变；仅当前任务页面的已知旧自动保存允许同步。WordPress 对修订调用 update_post_meta 会重定向父页，因此实现明确使用 update_metadata 并核对 autosave parent。其他页面、全站菜单、全局主题/插件不在写入能力内。

交付区分发布已确认、视觉/交互已确认和编辑器收尾已确认。缺少最后一项时，新的交付摘要必须显示 editor-completion-pending，不能宣称全部完成。收尾回执绑定当前完整文档指纹、页面ID、任务归属、对齐后重开时间以及真实证据哈希，不复用旧版本结论。

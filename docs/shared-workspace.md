# Codex / Claude / WorkBuddy 统一工作上下文

三个入口使用同一物理目录 D:/cloneWP。AGENTS.md、SYSTEM.md、COMPONENTS.md 和项目技能是共同规则；CLAUDE.md 只是入口指引。聊天记忆、浏览器登录态不会自动互通。

`agent` 字段是协作归属声明，不是取证身份。Codex 对应 `cua_repl`；Claude 和 WorkBuddy 都对应 `claude_browser`（代理自开浏览器）。WorkBuddy 只增加记录身份，不新增观察工具，也不改变 sidecar v2/v3 的配对规则。

## 日常使用

用户仍可在任一工具打开本目录，直接提出修改或复刻要求；代理负责执行下面的协议，不要求用户手填 JSON。

开始或切换会话先执行：

```powershell
npm run workspace:start -- --agent codex --intent maintain
npm run workspace:start -- --agent claude --intent maintain
npm run workspace:start -- --agent workbuddy --intent maintain
```

按请求选 replica、learn、compare、resume 或 maintain。--task/--run 只用于已明确的原生任务选择，不按最近目录猜任务。启动器只读，调用既有 context loader 一次，并返回规则全文、项目指纹、交接、锁及 sessionId；它不认证网站、不创建页面、不写状态。单纯分析可以不认领。

## 修改与交接

所有修改者登记独立 taskId 和资源范围。不同任务并行；同一资源的写入由 FIFO 资源锁排队。同一任务的并行准备代理仅写协调者分配的结果文件，不分别抢锁或修改共享规范。

所有修改命令固定从标准输入读取 JSON；不接受令牌命令行参数。工具可发送一行紧凑 JSON 加换行，无需关闭 stdin 管道，上限 128 KiB。exec 的可选 input 作为子命令的 stdin，仍不落盘。

1. 读取启动返回的 context.documents、shared.handoff、changedSinceHandoff。交接可能过时；按当前用户请求重新确定范围。
2. 通过 `npm run workspace -- claim` 认领。JSON 字段为 agent、sessionId、taskId、可选 goal/runId、expectedRevision 和 expectedFingerprint。建议 goal 写本轮目标；后两项取刚刚启动/状态输出，代码或状态改变后旧请求会失败。
3. 将返回 token 只留内存。推荐通过 `workspace -- exec` 的标准输入提交 `{token,command,args}`；它仅允许固定的当前项目命令，以无 shell 的子进程启动，在内存环境中注入 CLONEWP_WORKSPACE_TOKEN，并每五分钟续租。命令名如 test、build、replica:full、replica:prepare、reference、claude:capture。令牌不得放进命令文本、进程参数、文档、交接或 .env。只有工具确实支持独立的内存环境映射时才直接传环境，不要把令牌字面值拼入终端脚本。exec 不授予远端权限；子命令仍执行原有 clone.lock、站点所有权、CAS、读回和质量门。
4. 每五分钟调用 `workspace -- heartbeat`，JSON 为 token 和 expectedRevision；使用返回的新 revision。租约为十五分钟。测试、采集等长操作期间也要心跳。
5. 完成或中断前重新 `workspace -- status`，核对当前 fingerprint，然后 `workspace -- handoff`。提交 token、expectedRevision、expectedFingerprint、release:true 以及 notes；中间检查点可设 release:false 并继续持锁。

notes 包含 goal、summary、progress（in-progress/blocked/ready-for-next-step/completed）、decisions、changes、checks、openItems、nextSteps。数组可为空，nextSteps 至少一项。checks 每项为 command 与 status（passed/failed/skipped/not-run）。记录真实已做工作和未完成项，不能把程序/页面“已保存”写成视觉或交互通过。

写入后的记录是调用方报告的上下文（reported-context-not-authorization），不自动证明测试已执行、用户已授权发布或远端已对账。禁止写入凭据、Cookie、Authorization、访问 URL 和令牌。浏览器取证身份继续使用任务原合同；agent 字段只是协作归属声明。

## 切换入口与过时状态

上一入口写交接并释放后，下一入口重新启动、读取、认领即可。交接带规则/源码/测试/依赖及知识索引指纹和实际变化文件；漂移会显示 handoffFresh:false 和 changedSinceHandoff。读取变化、核对真实任务并重跑受影响检查后才能继续，不能迁移旧冻结锁或复用旧截图称完成。

持久状态为 `data/workspace/state.json`，交接为同目录 `handoffs/` 中的不可变 JSON；state 中的哈希引用是唯一当前指针，写入串行且有 revision 和 fencing 检查。原始 token 不落盘，仅保存摘要。该目录是本地共享运行状态，Git 默认忽略；复制到另一台机器不会自动同步。

## 锁恢复

到期不会自动抢锁。先 status，确认前一会话和命令已停止，再使用 `workspace -- recover`，提供新的 agent/sessionId、同一 taskId/runId、expectedRevision、expectedFingerprint、expectedFence、confirmPreviousSessionStopped:true 和 reason。恢复会留下记录并返回新令牌；旧令牌失效。恢复不触碰远端，也不授权重试未知写入，继续前要重新核对任务。

短事务锁 `.cache/workspace-transaction.lock` 忙时不得删除。status 给出 PID、存活状态和文件摘要。只有进程已死并明确确认无运行命令后，才用 `workspace -- repair` 提交 expectedTransactionHash 和 confirmNoRunningCommand:true；它不清理任务所有者。

## 边界

这是合作协议，不是操作系统文件权限隔离：随意使用外部编辑器或绕过 CLI 的脚本仍能改文件。三个工具必须遵守同一启动/持锁/交接规则。现有未使用本协议的命令在无人持锁时维持原行为；有人持锁时，当前完整复刻、准备、页眉写入、来源导入/Claude 采集 CLI，以及调用既有 acquireLock 的写入链路都会检查令牌。状态与只读查询继续可用。准备代理的状态提交由持锁协调者执行，不能把令牌写进分组结果。共享日志不能主动推送到另一个聊天，必须由下一入口重新读取。


## 资源级并发（2026-10-28）

用户明确要求不同任务同时制作，只有同一资源操作排队。新 CLI claim 默认登记独立任务，并可提供 resources，例如 local:reports/popup-task、remote:jiangubottle.com/post/123。本地资源路径按 Windows 不区分大小写规范化，父目录与子路径冲突；不同站点的相同数字 ID 不冲突。resources 是协调标识，不授予远端操作权限。

任务登记保存在 data/workspace/resources.json，任务各自持有令牌、租约、revision 和交接链。status 的 tasks、queue、taskHandoffs 分别显示活动任务、操作队列及各任务最新交接；heartbeat/handoff 使用该任务的 revision，不能使用其他任务或旧全局 revision。交接释放只移除自己的任务，不改其他任务的租约或记录。过期任务不自动抢占，recover 仍要求精确 fence、已停止声明及先核对未知操作。存在持有或排队操作时禁止释放/恢复，以免丢弃待对账事实。

已有 v1 state.json 和旧令牌保持兼容，不改写、释放或自动迁移正在工作的任务。新命令识别资源队列；已经运行的旧命令保留其原操作锁，新命令等待它退出，不删除旧锁或重发未知保存。

acquireLock(root, resources) 原子取得一组资源。相交资源 FIFO 等待，不相交资源可同时进入；等待超时会撤销未执行票据，执行前再次核对任务租约，业务代码仍必须在取得资源锁后读取当前状态并执行 CAS。队列本身不发送或重试远端操作。进程异常留下的 held 票据不自动清除，必须先核对真实操作结果。没有足够身份资料的历史入口使用保守的 unscoped 锁，不能假称已按资源并发。

整页保存、原生修订、发布和编辑器收尾按 run 当前 manifest/state 解析站点及页面 ID；只读复用的页眉不加入写入资源。新建资源按其确定性创建标识协调。涉及菜单、页眉或其他共享对象的新增入口必须显式列出所有实际写入资源，不能只拿 taskId 当共享对象的锁。系统源码修改也须列出本地文件或目录范围，避免两个维护任务同时编辑同一文件。

原生资源所有权、写前意图、读回、未知响应对账、视觉/交互及发布规则全部保留。本机锁是协作协议，不能替代服务端 CAS，也不能约束已经载入旧代码的进程或外部人工编辑。

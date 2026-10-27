# Codex / Claude 共享工作区改造

范围：补齐同一物理目录 D:/cloneWP 内的统一启动、共享交接和项目级任务锁。仅本地维护；未提交或暂存 Git，未调用远端网站写入。

## 实际改动

- 新增 src/workspace/contracts.ts、files.ts、service.ts、cli.ts、exec.ts，复用现有 context loader；两个启动身份读取同一规则、源码指纹、交接和锁。
- data/workspace/state.json 保存当前所有者与交接指针，handoffs/ 保存不可变交接。记录目标、决定、变更、检查、未完成项和下一步；文件及规则变化会标记交接过时。原始令牌不写盘，该目录已加入 Git 忽略。
- 项目级单写入者认领使用 revision 与文件指纹；租约十五分钟，每五分钟续租。过期不自动抢占，显式恢复必须确认原会话已停止并核对 fence；旧令牌失效。短事务锁仅允许对已死进程按精确摘要修复。
- 新增标准输入执行器，只允许已登记的当前命令；无 shell、无令牌命令参数，令牌仅注入子进程内存环境，长命令自动续租。
- 现有 acquireLock 及完整复刻、准备、页眉、来源导入和 Claude 采集入口接入所有者检查；无人持锁时维持原行为。只读查询保留。
- 新增薄入口 CLAUDE.md、docs/shared-workspace.md；AGENTS.md 与项目技能改为统一启动，README / SYSTEM 提供协议链接。未新增依赖。

## 保留的能力

当前复刻的来源合同、Codex / Claude 取证身份、43 Widget 加 1 Container、方案准备、串行远端写入、所有权、CAS、读回、恢复、修订、视觉/交互/编辑验收及发布边界均保留。context:load 继续作为底层只读诊断。旧任务及其冻结 program、CSS 和知识证据不迁移。

## 使用

在 Codex 或 Claude 中打开同一个 D:/cloneWP，按正常方式提出请求即可；代理按 AGENTS.md / CLAUDE.md 自动启动读取、认领、续租和交接。切换前让上一入口写交接并释放，下一入口重新读取后继续。聊天历史、浏览器登录态不自动互通。

```powershell
npm run workspace:start -- --agent codex --intent maintain
npm run workspace:start -- --agent claude --intent maintain
npm run workspace -- status
```

复刻任务改用 intent replica，已明确任务或 run 时追加对应参数。认领、心跳、交接、恢复以及 exec 的 JSON 字段和安全输入方式见 [共享工作区协议](../shared-workspace.md)。用户无需手填 JSON。

## 验证

- TypeScript 静态检查通过。
- 专项与兼容批次 64 项通过、0 失败、0 跳过，含新增共享工作区 17 项，以及原上下文、Claude 采集、完整复刻入口、准备与页眉 CLI。
- 当前目录两个真实启动命令均 ready，指纹与交接一致；各自网络请求、凭据加载、浏览器启动和文件写入均为 0。
- 冻结后运行与 npm test 相同的 tools/test.mjs：共 1563 项，1561 通过、0 失败、2 跳过，耗时约 427 秒；跳过项均因本机缺少 PHP CLI。日志：.cache/shared-workspace-full-test-20261025.log。
- 长测试运行期间实际自动续租一次；共享状态与交接文件未包含原始任务令牌。
- 冻结后运行与 npm run build 相同的 tools/build.mjs，退出码 0；构建通过。日志：.cache/shared-workspace-build-20261025.log。

新增测试覆盖 Codex→Claude→Codex 交接、指纹漂移、并发认领、CAS、错误令牌、续租、显式恢复、旧令牌失效、原操作锁、死事务锁修复、路径/联接隔离、未知原生写入不能标完成、记录篡改、stdin 不关闭及令牌不进入参数。

## 验证边界

共享锁是两个代理遵守的合作协议，不是操作系统文件权限隔离；外部编辑器仍可绕过。交接是调用方报告的上下文，不授予远端权限，也不能替代真实页面验收。未使用实际 Claude 客户端做跨聊天端到端测试；测试包含两种身份和本地模拟浏览器采集。未操作测试站页面，因此本轮不声称当前远端页面视觉或交互通过。

一次测试启动因令牌嵌入命令文本被自动审批拒绝，调用未执行；随后撤销旧令牌，改为关闭回显的标准输入与子进程内存环境。最终令牌随任务释放失效。

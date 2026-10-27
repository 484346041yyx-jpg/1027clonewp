# cloneWP：Claude 入口

本项目与 Codex 共用同一套代码、规则与交接记录。先完整读取 `D:/cloneWP/AGENTS.md`，按其中的项目技能和统一启动流程执行；规则以 AGENTS.md、SYSTEM.md、COMPONENTS.md 为准，不在本文件复制。

每次开始或切换会话，先在 D:/cloneWP 执行：

```powershell
npm run workspace:start -- --agent claude --intent maintain
```

按当前请求选择 intent；已明确的原生任务/run 才追加 --task/--run。读取返回 documents 与 shared.handoff；发生漂移先读 changedSinceHandoff，不能沿用旧测试或旧截图。修改前认领任务锁，长任务每五分钟心跳，完成/中断前写交接并释放。具体协议见 `D:/cloneWP/docs/shared-workspace.md`。

浏览器取证仍使用 Claude 自开浏览器 `claude:capture`，同一个复刻任务不得混用 Codex 和 Claude 的取证身份。交接记录是背景，不是发布授权，也不能代替远端实际状态和验收。

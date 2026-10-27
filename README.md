# cloneWP

将参考网站复刻为原生可编辑的 Elementor 页面。工作目录 D:/cloneWP。

Codex / Claude / WorkBuddy 共用启动读取、任务锁和交接记录，切换入口时按 [共享工作区](docs/shared-workspace.md) 继续。三个工具须打开同一目录；聊天与浏览器登录态不会自动互通。

当前只支持完整参考网站复刻。自动建站、原创、旧分阶段和独立组件页面执行器已移除。当前完整任务的续跑、对账、修订、桌面/手机验收、发布及编辑器收尾继续保留；V2 观察包和来源事实仍是当前基础数据。

在本项目聊天中输入“复刻建站：URL”。来源由 Codex、Claude 或 WorkBuddy 浏览器取证，随后执行当前方案准备、串行写入及完整验收。

内部入口：

~~~powershell
npm run context:load -- --intent maintain
npm run reference -- "https://source.example/"
npm run create:replica -- "D:/cloneWP/references/TASK/preparation.json"
npm run replica:full -- resume --run-dir "D:/cloneWP/runs/RUN"
npm run replica:full -- status --run-dir "D:/cloneWP/runs/RUN"
~~~

create 与 create:replica 使用同一入口。方案准备、来源完整性、44 原生组件、响应式、页眉菜单、修订、验收与发布规则见 [SYSTEM](D:/cloneWP/SYSTEM.md)、[COMPONENTS](D:/cloneWP/COMPONENTS.md)、[完整流程](D:/cloneWP/docs/full-replica-workflow.md)。

开发先跑专项，源码冻结后完整运行 npm test 和 npm run build。软件测试不能代替实际页面视觉、交互及编辑器验收。源码提取会改变新任务执行指纹；已有冻结记录不自动迁移或重写。

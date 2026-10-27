# Claude 来源采集入口

cloneWP 是同一套系统，来源取证有两个互相独立的启动入口，下游合同、准备、写入、验收完全共用：

| 入口 | 取证工具身份 | 来源 |
| --- | --- | --- |
| Codex | `cua_repl` | 用户在浏览器打开的标签（`user-opened-browser`） |
| Claude | `claude_browser` | Claude 自己启动的真实 Chrome（`agent-opened-browser`） |
| WorkBuddy | `claude_browser` | WorkBuddy 自己启动的真实 Chrome（`agent-opened-browser`） |

三者不共享会话、不借用对方身份：`cua_repl` 记录只接受原有配对，`claude_browser` 只接受 `agent-opened-browser` 与 `chrome|edge|chromium`，sidecar v2 仍只属于 Codex。配对规则在 `src/replica-v2/observers.ts`，用户随意选一个入口启动即可，同一任务不要混用两个入口取证。WorkBuddy 不新增观察工具，复用本入口的 `claude_browser` 身份；它的记录身份 `workbuddy` 只出现在 workspace 的 agent 字段。

## 命令（目录必须在 D:/cloneWP 内）

~~~powershell
npm run claude:capture -- inspect --url URL
npm run claude:capture -- observe --url URL --task TASK_ID --regions FILE
npm run claude:capture -- phones --url URL --task TASK_ID --regions FILE
npm run claude:capture -- hover --url URL --observed D:/cloneWP/references/TASK_ID
npm run reference -- URL --observed D:/cloneWP/references/TASK_ID
~~~

- `inspect` 打印候选板块和轮播。`regions` 是代理按所见页面写的 `[{id,selector,role?}]`，选择器须唯一、互不嵌套，页眉 `header`、页脚 `footer`、正文 `body-N`。
- `observe` 在同一标签依次取 1920×1080 与 1440×1000：加载、整页预热、缩放周期稳定、冻结页面计时器和动画后，生成每区观察包、场景清单、渲染证据、六阶段采集事务和 sidecar v3，并立即用既有导入器自检。
- 截图先用真实视口分段按滚动拼合；页眉随滚动改变版式（JS 固定页眉）时改用合同的 `equivalent-expanded-viewport`：整页高视口取图，并经既有等价证明；`.lang-box` 这类自身 `visibility:hidden` 的子树不绘制像素，允许几何随视口变化。
- `phones` 用触屏手机模拟取 390×844、430×932，输出 `responsive-source.json`。`hover` 用真实指针为每种已声明悬停规则取默认/悬停/恢复三态及截图，输出 `source-hover-review` 并可被现有校验读回。

## 证据语义与限制

- 来源是代理自开的浏览器，不是用户标签，不继承用户登录态；挑战或年龄门需要用户处理时不能绕过。
- 观察前页面计时器被冻结以得到稳定画面，轮播自动播放先实测再冻结，记录在 `claude-session.json`；无限动画被暂停，有限动画直接完成。
- 取证事务只证明采集内部一致，字形字体标记为 `unavailable`，不等于视觉或交互通过；轮播引擎覆盖 splide/swiper/slick/owl/flickity/bootstrap。
- 隐藏的绝对定位元素若随视口高度撑高文档，高视口取图会因高度不一致失败并具名报错，需要改用其它取图方式。

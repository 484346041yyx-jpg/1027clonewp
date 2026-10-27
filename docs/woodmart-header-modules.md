# 独立 WoodMart 页眉模块

完整复刻默认入口现由新增的 [完整调度流程](full-replica-workflow.md) 负责：`create:replica` 接收完整manifest，并行准备页眉/正文，串行创建新Full Width页面、页眉和菜单，统一复核后发布。`create:replica:component` 保留原组件执行器。下文所述generic CLI仍是独立页眉的底层入口；历史测试结果仅说明原实例。

未来新建复刻任务默认使用 WoodMart 页眉生成器搭配独立 WordPress 菜单。原 Elementor 组件页眉实现继续保留，显式使用组件路径及旧冻结任务仍按其原合同执行；现有页面、菜单和代码不因新默认而迁移。

这个默认由现有 cloneWP 项目流程读取本指南执行，不需要另一个项目技能入口。页眉布局、菜单、样式与写入代码集中在 `src/woodmart-header/generic/`，完整调度与Full Width适配独立新增在 `src/replica-full/`。旧 `context:load` 返回格式、原组件源码和冻结执行合同保持原样；原Canvas执行器没有被修改为Full Width，新默认由新增调度器调用独立适配实现。

页眉底层入口为 `src/woodmart-header/generic/cli.ts`。旧任务 schema 和 Canvas 生成器没有增加新参数；完整新默认入口为 `src/replica-full/entry.ts`。所有命令在 `D:/cloneWP` 工作目录运行：

```powershell
npx tsx src/woodmart-header/generic/cli.ts --help
```

路由函数只返回选择结果，不启动命令、不联网、不写 WordPress。

## 选择与来源范围

新路由记录使用 `clonewp-replica-header-choice` v1，省略 `provider` 时默认 `woodmart-header-builder`；显式 `component` 保留旧组件路径。未知值（包括 `auto`）仍会拒绝，不在失败后自动回退。`sourcePartition` 分为 `allUnits`、`headerUnits`、`bodyUnits`：每个数组内部不能重复，页眉和正文不能重叠，二者并集必须恰好覆盖完整来源范围。

组件方案继续走旧的整页组件入口，页眉仍属于其整页计划。WoodMart 方案独立保存页眉范围，正文另有自己的完整计划；不能删除旧冻结 program 中的页眉后宣称原任务依然满足整页覆盖，也不能直接沿用旧任务的验收完成状态。

例如，新任务路由文件的形状如下；单元 ID 应替换为本次实际来源清单，不能以示例 ID 代替来源观察。此处 `provider` 也可省略，解析结果会明确写入默认 WoodMart 路径：

```json
{
  "version": 1,
  "kind": "clonewp-replica-header-choice",
  "provider": "woodmart-header-builder",
  "sourcePartition": {
    "allUnits": ["header", "hero", "content"],
    "headerUnits": ["header"],
    "bodyUnits": ["hero", "content"]
  }
}
```

## 页眉独立编辑

一个模块将四类内容分开保存和校验：

| 内容 | 编辑职责 |
| --- | --- |
| `header.json` | Top bar、Main header、Header bottom 的行列、Logo、导航、账户、购物车及本模块设置 |
| `menus.json` | 菜单项名称、链接、顺序、父子层级；目标真实菜单 ID 与 slug 由适配器绑定 |
| `header.css`、`fonts.json` | 本模块的间距、排布、字体、颜色、悬停和桌面规则 |
| `media.json` | 本模块素材键与已验证的目标附件 ID 映射，不作为其它站点默认值 |
| `identity.json`、`state.json`、追加式 intent 文件 | 封存模块身份、实际新建资源与精确草稿绑定、当前快照、未知操作和读回收据 |

布局、菜单和样式可分别更新。一次菜单修改不重写正文或页眉样式；一次样式修改不重写菜单或正文。每次操作都保留独立输入哈希、写前意图、预期快照及实际读回；发现外部并发修改时停止该写入，响应未知时先对账。

样式以实际模块页眉 `.whb-<headerId>` 为作用域，由本模块新建的原生 HTML Block 样式资源附加到页眉。样式不合并到正文页面 CSS，不写全局主题 CSS；也不继承 Furry 实验中的 `header_193941`、page ID、菜单 ID 或字体 URL。字体资源由每个模块输入，字体名称按模块身份隔离。媒体查询、选择器、字体和链接都需要通过对应合同检查，不能用 CSS 隐藏重复页眉来掩盖结构错误。

后续在 WordPress 后台可分别找到对应页眉、菜单和 HTML Block。后台手动修改会使本地旧快照过期；下次自动更新应先读取实际状态、确认差异，再准备当前操作，不能用旧文件覆盖手工修改。

`identity.json` 的模块键、所有者、目标站及随机生成的 header ID 在初始化后保持固定。用户可以修改布局、菜单、CSS 和字体文件；改身份会被加载器拒绝。Bundle 只能位于 `D:/cloneWP` 内，拒绝 junction、符号链接及路径逃逸。写入使用本地独占锁，不自动抢占过期锁；未知操作及运行依赖不能在对账前清理。

## 隔离与绑定

默认只创建当前任务拥有的新 header、menu 和 style block，不接管旧资源，不改变全站默认页眉、主题预设引用或主菜单、移动菜单位置。复刻测试页也使用独立新页面。

绑定必须是精确的任务自有 `page`，状态为 `draft`，页面 `_clonewp_run_id` 与运行身份相符，模板已经是保留主题页眉的 Elementor Full Width（`elementor_header_footer`），并且没有旧页眉绑定或内置重复页眉。仅设置页面标题、填入页眉 ID，或提供一个自报所有权的 JSON，都不构成写入授权。

现有 Canvas 页面不会显示主题页眉；此入口拒绝自动把旧 Canvas 转成 Full Width，也拒绝修改现有发布页。需要新测试页时使用独立 `create-page` 入口创建 Full Width 草稿，再编辑新页正文。绑定前后检查正文内容与正文 CSS 哈希一致；服务端在写锁内重新核对页面身份、状态、模板及完整快照。

`validateOwnedDraftHeaderBinding()` 是本地语义预检，不是认证能力或远端所有权证明。只有服务端实际读取、并发核对和保存后的读回才证明操作落在指定草稿上。

## 操作与验收

以下命令中的 `FILE`、`DIR` 为工作区内的实际绝对路径；`KEY` 是菜单计划中的稳定键，`ID` 和 `SHA256` 取自当前读回。`init` 的 `--choice` 承载完整来源范围，解析后的 provider 必须为 WoodMart；新任务省略 provider 即采用该默认。

| 命令参数 | 作用 |
| --- | --- |
| `route --choice FILE` | 纯本地读取方案选择，组件方案返回原创建入口 |
| `init --bundle DIR --plan FILE --choice FILE [--media FILE]` | 验证计划和来源分区，新建本地 bundle；不联网 |
| `status --bundle DIR` | 纯本地读取身份、哈希、未知操作和验收提示 |
| `inspect --bundle DIR` | 只读检查目标当前资源、合同及隔离情况 |
| `provision --bundle DIR` | 串行创建本模块的新菜单、样式块和页眉 |
| `update-header --bundle DIR` | 仅应用 `header.json` 的布局和原生设置 |
| `update-menu --bundle DIR --menu KEY` | 仅应用指定菜单计划 |
| `update-style --bundle DIR` | 仅应用本模块 CSS 与字体 |
| `create-page --bundle DIR --title TITLE --slug SLUG` | 新建任务自有的空 Full Width 草稿页面 |
| `bind --bundle DIR --page-id ID` | 核对正文未变后，将页眉绑定到精确自有草稿 |
| `reconcile --bundle DIR` | 只读对账未知写入；确认前值或后值，不盲重发 |
| `checkpoint --bundle DIR --expected-hash SHA256` | 按明确读回哈希接受已核对的后台手工修改，仅更新本地快照 |

命令需加前缀 `npx tsx src/woodmart-header/generic/cli.ts`。新入口没有发布命令，`create-page` 也不会自动创建复刻正文。后续正文编辑和整页验收独立进行；不会隐式执行旧组件生成器或旧整页比较器。

构建和验收是不同状态。合法计划、成功保存和本地测试通过，不能代替实际网站视觉与交互检查。实际使用时仍需查看当前新页面的两种桌面宽度，核对仅一个所选页眉、Logo、真实菜单层级和链接、下拉打开关闭、键盘焦点、吸顶，以及选择启用的账户、购物车等原生行为。手机、复杂 Mega Menu、未选择的工具和未实际执行的业务流程不能自动标记通过。

页眉模块完成不代表正文复刻完成。模块状态应分别记录资源与绑定是否确认、检查范围和当前未验证项；正文由其独立计划和验收负责。首次 Furry 测试页的历史截图和交互证明只说明那个实例，不能作为所有未来配置的通用视觉通过证明。

本地开发与文档扩展不需要修改现有远端页面。新增通用能力本身不应触发全站设置变化、旧测试页重写、插件安装升级或共享资源接管。

## 当前测试状态（2026-10-19）

最新完整 `npm test` 共 1,451 项：1,450 通过、0 失败、1 跳过，耗时 382,161.8747 ms；跳过项为本机缺少 PHP CLI 的原有可选执行测试。`npm run build` 成功。目标 WoodMart 8.3.4 的实际合同读取、固定 helper 的服务端 PHP 语法检查及 3 项只读过滤案例通过；本次新页 setup、publish 辅助代码也分别通过真实服务端 `TOKEN_PARSE` 检查。软件证据与当前源码指纹见 [software-verification.json](../runs/furry-generic-header-live-20261018/software-verification.json)。

新的通用模块已完成 Furry’s Kitchen 页眉实站实例验证并发布：[测试页 15924](https://primevapeoutlet.com/furrys-kitchen-generic-header-live-test/)。独立页眉为 `header_12708956952161743`，菜单 981 含 27 项，样式块为 15923。公开页面在 1920/1440 两种桌面宽度的实际视觉、鼠标与键盘下拉、购物车侧栏、Home、账户入口和吸顶均已复核通过；本地编译 CSS 与远端逐字一致，无 pending。原组件版本继续保留。完整结果和编辑入口见 [本次交付](../runs/furry-generic-header-live-20261018/DELIVERY.md) 与 [任务状态](../runs/furry-generic-header-live-20261018/STATUS.md)。

该实例正文为滚动说明 fixture；未验手机、复杂 Mega Menu、结账或整页正文，也不将结果推广至其它未测试配置。账户及购物车使用目标站原生文案和图标适配。本次 `support.ts`、`page-run.ts`、公开复核退回和恢复辅助工具均仅属于该任务，不构成通用模块的生产发布或已发布页修订入口。

实站测试修复了新适配器的动态 HTML Block 资源选项指纹、生成缓存引用与严格页眉读回比较；样式操作的历史保护冲突按用户明确同意保留归档，并以当前现场重新建立取证边界，未伪造原事务成功。旧源码 221 个文件、其中 native44 组件代码 72 个文件均保持原哈希；保留核验见 [code-preservation.json](../runs/furry-generic-header-live-20261018/code-preservation.json)。原组件页面和菜单的实际保护检查单独记录在任务验收中，不能由软件测试或源码哈希替代。

通用布局没有写死参考品牌或旧资源 ID。原组件实现和入口继续保留，没有新增独立项目技能入口。当前模块支持经目标合同接受的桌面 Logo、主菜单、账户、购物车、搜索及间距元素；手机、复杂 Mega Menu 和未执行的业务流程不能自动标记通过。交付清理不删除未决意图或运行所需资料。

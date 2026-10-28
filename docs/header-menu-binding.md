# 新任务的原生菜单绑定与后台回显验收

新 preparation v8 有自有页眉时冻结 `headerBase.menuBindingPolicy={version:1,editorReview:"desktop-and-mobile-reopen"}`。新完整任务创建入口和独立页眉 `init` 同样冻结；公共部分任务在首次创建的状态中冻结策略。续跑已有目录读取原冻结值，缺省历史合同不补字段、不改哈希、不迁移现有远端资源。普通正文任务只读复用共享页眉，不能为了此策略修改它。

## 制作与保存

主导航使用原生 `mainmenu`，次级导航使用原生 `menu`；语言、邮箱和询价导航可各自绑定不同的 `menuKey`。每个电脑和手机节点声明自己的绑定；不以电脑正确代替手机，也不擅自改变手机面板与语言菜单的原生职责。

目标只读原生合同须确认两类组件 `menu_id` 字段为 `select`。程序根据当前任务菜单资源解析实际 slug，不能把数字 term ID、菜单名称或来源站 ID 当作编辑器选项。中文菜单沿用真实百分号编码 slug；不得自行解码、二次编码或给全部网站硬编码一个值。若目标原生控件契约不同，报告缺口并在创建资源前停止，不猜测另一种格式。

生成阶段核对字段 `id/type/value`、实际控件资源声明、菜单归属、每个组件与设备的对应关系。服务端写前再次核验原生字段及归属；原生工厂保存后既比对完整原始读回，又验证实际菜单字段。客户端也对保存响应与新鲜检查结果做同样验证。CAS、意图、未知结果对账和串行写入保持；不能因前台能按 ID 显示而忽略错误的后台保存格式。

## 后台回显验收

新策略要求手机布局。生成和保存通过不等于后台验收通过。整页批准前必须获取当前原生页眉读回，并为 **每一个电脑及手机菜单组件** 提交 `clonewp-header-menu-editor-observation`：

- 当前 task/run、页眉 ID、稳定组件 ID、device、整页 fingerprint 和已保存的 headerHash。
- 正确域名的 WoodMart 页眉编辑 URL、重开时间与观察时间。
- 实际原生 `select-menu_id` 的 `.value`，全部选项的 value、名称及 `.selected` 状态。
- 同一面板的截图文件及 SHA-256。

浏览器适配器按 `captureHeaderMenuEditorObservation` 执行：重开已保存的正确页眉 → 选电脑/手机并打开准确组件设置 → 读取选择器 → 截图 → 再读核对面板未变。不修改选项、不点保存，不读取隐藏应用状态来代替可见控件。`HEADER_MENU_SELECT_READER` 可在受支持浏览器的只读 DOM evaluator 中读取选择器。截图本身须由代理实际查看；程序校验图片格式和身份不能替代视觉判断。

证据严格匹配当前保存的菜单 slug 和任务菜单名称，不接受空白“选择”、数字 ID 代替实际 slug、错菜单、同组件重复冒充遗漏项、旧版本、跨站或过期证据。缺任意设备/组件观察时，整页不得批准或进入正常发布流程。证据只在当前保存版本和验收范围内有效，不缓存后续后台状态。

完整任务将各观察 JSON 的 hash-bound 引用放在既有 `reviewerEvidence` 文件的 `headerMenuSelections` 数组中。正式验收继续经过 `verifyFullReplicaReviewEvidence`；不新建发布通道。原有前台视觉、菜单交互、响应式和编辑器质量门保持。

独立页眉可从同一 CLI 获取检查清单和只读核验结果：

```powershell
npx.cmd tsx src/woodmart-header/generic/cli.ts plan-menu-editor-review --bundle D:/cloneWP/任务/header
npx.cmd tsx src/woodmart-header/generic/cli.ts verify-menu-editor --bundle D:/cloneWP/任务/header --evidence D:/cloneWP/任务/editor-review.json
```

独立核验文件包含 `observedAt` 和 `selections` 引用数组，fingerprint 为当前 `{header,menus}` 的 `headerJsonHash`；整页任务使用其整页 fingerprint。核验命令重新只读检查目标，不能用本地旧快照作通过证明。公共部分 `draft-for-user-review` 交付继续标明 `menuEditorReview:desktop-and-mobile-reopen-required`，未提供实际证据不声称后台已通过。

## 本轮维护边界

本轮仅改本地系统和测试。测试包含拦截到本地内容的 Chromium 原生选择器及本地 PHP 验证器，未对测试站或正式站发起写入，也未为测试创建页面、页眉或菜单。原有网站的错误绑定不因此自动修复。

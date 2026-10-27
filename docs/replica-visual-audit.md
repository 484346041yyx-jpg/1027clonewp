# 复刻视觉证据检查

独立桌面组件任务继续使用 `visualAuditVersion: 2`。新建完整复刻 v4 任务必须在 `bodyBase` / `program.json` 中使用 `visualAuditVersion: 3`，手机和桌面都检查来源绑定的计算样式与通用绘制区域。显式旧 v1/v2/v3 任务继续使用冻结合同，不自动迁移。

## 检查范围

- 来源与目标区块背后第一层不透明纯色背景；透明区块透出主题底色也会被发现。
- 可见图片和 SVG 图标在区块内的相对位置及尺寸。对数量超过 20 的复杂区块仍以整页截图人工复核。
- 复制文案相同且在区块内唯一的文字颜色、字号、行高和相对水平位置。字体家族不参与判断。
- 链接、标签及按钮的背景、字色、尺寸和下划线实现。
- 轮播进度条的数量、宽高、水平位置、颜色及填充比例；前后箭头的数量、位置、外框与图标尺寸。
- 独立 WoodMart 页眉与来源相同的居中内容限宽。
- 可见的背景、渐变、边框及阴影区域按位置和绘制样式比较，不依赖控件名称或 CSS 类名；任意造型的按钮和装饰块都可进入这一层检查。

动态商品和文章文案不会强行按文字匹配。背景图片与渐变只比较类型，具体像素、图标轮廓、伪元素、动画和交互状态仍需绑定截图及实际操作复核；此检查不代替整页视觉和交互验收。版本 2 要求每个模块提交 `paintLayers`，缺失即拒绝审核；旧版本 1 报告缺少此字段时按原冻结合同执行。

## 完整复刻的审核证据

每个 `review-evidence.json` 的桌面 `viewports[]` 项需增加 `visualAudit` 文件引用（`path` 与 `sha256`）。它引用的 JSON 格式为：

```json
{
  "version": 1,
  "kind": "clonewp-full-replica-visual-audit",
  "pageId": 123,
  "fingerprint": "<与 review 相同的页面指纹>",
  "width": 1920,
  "height": 1080,
  "screenshotSha256": "<此 viewport 截图的 sha256>",
  "observedAt": "<与截图同一稳定页面状态的 ISO 时间>",
  "modules": [
    {
      "sourceUnitId": "<source-units.json 中该视口的 body unit ID>",
      "targetSelector": ".elementor-123 .cwp-n44-<顶部组件的实际哈希类名>",
      "visual": { "solidBackground": "rgb(255, 255, 255)", "texts": [], "progress": [], "arrows": [], "mediaGeometry": [], "paintLayers": [] }
    }
  ]
}
```

桌面 v1 报告的 `modules` 必须覆盖该视口所有可见正文 source unit，且每个 source unit 只能出现一次。选择器由顶部组件的 `native44ModuleClass(key)` 计算。目标模块的 `visual` 必须在与审核截图相同的浏览器、视口、页面状态以及字体加载完成后，从真实 DOM 计算样式采集；可使用 `src/replica-full/visual-review.ts` 导出的 `sampleFullReplicaVisualModule(root)`。采样前要求选择器恰好匹配一个可见根节点。采样函数返回每个模块的背景、图片位置、文字、控件、进度条、箭头和绘制区域读数。旧 v1/v2 的手机仍沿用冻结的响应式与人工审核。

审核器不接受报告中自称的来源颜色或尺寸；它按 `source-evidence.json`、`source-units.json` 和原始 observation packet 的哈希绑定重新计算来源读数。目标报告与页面指纹、截图哈希和视口绑定，任一可比较的视觉偏差会阻止“通过”审核。修正目标页后重新采集截图和报告；不要编辑原始来源证据或沿用旧截图。

## v4 手机视觉与换行

v4 的四个 `review-evidence.json` 视口都必须引用 `visualAudit`。两个桌面仍用上述版本 1 报告，但 `texts[]` 要增加浏览器实际 `width`、`height`、`lineCount`（行高可解析时）和 `whiteSpace`。两个手机用版本 2 报告，包含 `clientWidth`，并将 `modules[]` 中的 `sourceUnitId` 改为 `sectionKey`。每个可见响应式区块恰好一项；`targetSelector` 为该区块实际生成的稳定类名，手机独立区块使用 `_phone` 组件键。

手机来源由 `responsive.source` 的哈希绑定 observation packet 及各区块 `evidence.snapshotId/nodeId` 重新计算，目标的 `clientWidth` 必须和来源相同。截图标称 390px 而内容区是 375px 时，不得用内容区 390px 的模拟结果替代。文字比对增加实际文字框高度、渲染行数和 `nowrap` 状态；已有颜色、字号、行高、背景、控件、箭头、进度条及绘制区域检查仍适用。修正 CSS 后重新采集浏览器计算样式；保存成功不证明覆盖规则生效。

## v4 手机轮播前后状态

如正文含原生轮播，或响应式决定把动态商品配置为轮播，`responsive.carouselMotionSource` 必须引用 `clonewp-responsive-carousel-motion-source` v1。每个轮播在两个手机宽度各有一项：组件和所属区块、来源 snapshot/node、`width/height/clientWidth`、滑动前后截图及 `before/after` 帧。每帧记录轮播视窗宽、当前逻辑索引，以及至少两张卡片相对视窗的 `index/x/width`。来源节点必须属于该区块，截图必须读回哈希和尺寸。

```json
{
  "version": 1,
  "kind": "clonewp-responsive-carousel-motion-source",
  "taskId": "task-id",
  "sourceUrl": "https://source.example/",
  "rows": [{
    "componentKey": "category-carousel",
    "sectionKey": "categories",
    "snapshotId": "phone-390",
    "sourceNodeId": "source-carousel-node",
    "width": 390,
    "height": 844,
    "clientWidth": 375,
    "observedAt": "2026-10-22T00:00:00.000Z",
    "before": { "viewportWidth": 327, "activeIndex": 0, "items": [{ "index": 0, "x": 0, "width": 225 }, { "index": 1, "x": 245, "width": 225 }] },
    "after": { "viewportWidth": 327, "activeIndex": 1, "items": [{ "index": 0, "x": -245, "width": 225 }, { "index": 1, "x": 0, "width": 225 }] },
    "beforeScreenshot": { "path": "source-before.png", "sha256": "<64 位 SHA-256>" },
    "afterScreenshot": { "path": "source-after.png", "sha256": "<64 位 SHA-256>" }
  }]
}
```

目标交互证据对每项增加一次 `carousel-motion:<componentKey>` 操作，选择器使用该组件稳定类名，操作类型为 `carousel`。操作前后状态各带 `motion` 帧和截图。审核器比对来源与目标的逻辑步长、卡片宽度、初始及滑动后位置；首帧看起来正确但原生引擎移动步长错误，会阻止通过。动态商品内容可以不同，位置和行为仍要匹配。来源未能取得实际滑动证据时，v4 在远端写入前失败，不编造通过记录。

# 增量学习输入

学习命令只处理明确的本地证据，不联网、不读取凭据、不启动浏览器、不改网站。先由项目技能从用户已打开的浏览器取得证据，再调用内部命令。以下是输入合同参考，字段的严格校验以 `src/components/learning.ts` 为准。

学习发布保存候选解释和证据资格，不把分析者写下的一句话变成已验证组件事实。`conclusionStatus` 始终为 `candidate-interpretation`；资格由具体证据校验派生，输入不能自填。学习发布不改变当前启用 44 项或生产写入合同。

## 学习页面

```text
npm run learn:page -- --url https://example.com/ --observed D:/cloneWP/references/example-observation
```

观察目录需要：

- `observation-manifest.json`、其引用的扁平 V2 packet 和截图；实体、字节哈希、计数、所有权、URL、图片格式及尺寸必须对应。
- provenance 为 `user-opened-browser`、`cua_repl` 和真实浏览器；只接受桌面观察。
- `learning-conclusions.json`，由 Codex 根据实际截图和结构整理：

```json
{
  "version": 1,
  "kind": "page-learning-conclusions",
  "conclusions": [
    {
      "responsibility": "service-card",
      "statement": "图片、名称和单一入口属于同一张卡片，选型时应一起评估。",
      "snapshotId": "desktop-one",
      "ownerNodeIds": ["service-card-one"]
    }
  ]
}
```

`snapshotId` 和 `ownerNodeIds` 必须实际存在。公共页面外观只支持页面模式研究；即使 DOM 中出现某个组件类名，页面学习也不会据此发布全局组件身份、保存或交互资格。

## 学习组件

```text
npm run learn:component -- --widget future_card --evidence D:/cloneWP/learning/input/component-evidence.json
```

证据清单示例：

```json
{
  "version": 1,
  "kind": "component-learning-evidence",
  "widgetType": "future_card",
  "provider": "example-provider",
  "evidence": [
    {
      "path": "learning/input/source-contract.json",
      "sha256": "填写该文件真实 SHA-256",
      "kind": "source-contract",
      "scope": "source-contract"
    }
  ],
  "conclusions": [
    {
      "responsibility": "information-card",
      "statement": "该候选的 title 字段可承载卡片名称；具体页面仍须判断共同所有者。",
      "evidenceIndexes": [0]
    }
  ]
}
```

哈希示例是说明文字，实际输入必须是对应文件字节的 64 位小写十六进制 SHA-256。引用路径可以是项目内绝对路径或相对项目根目录的路径。证据限定在源码、测试、冻结知识、learning、references、reports 或 `.cache`，禁止配置凭据、会话文件和路径越界。

### 各种证据的实际要求

| kind / scope | 被引用文件及校验 | 能证明的范围 |
|---|---|---|
| `source-contract` / `source-contract` | 下方源码合同、真实 PHP 源码哈希、`get_name()` 返回值及对应 `add_control` 字段类型 | 已研究的具体源码字段 |
| `registered-schema` / `target-registration-observation` | 实际 `{type,class,controls}`，各字段具有真实 type | 某次目标注册观察，不成为全局注册事实 |
| `dom-instance` / `dom-instance-observation` | 实际 V2 packet，存在可见节点及准确 `data-widget_type` | 已观察到该实例身份 |
| `save-replay` / `local-save-replay` | 两份文档及元素 ID，实际 widgetType 和 settings 完整相等 | 本地保存回执重放一致，不证明本轮远程保存 |
| `render-replay` / `local-render-replay` | packet、具体节点、实际截图，正尺寸、身份及截图像素尺寸相符 | 局部呈现证据的本地一致性 |
| `interaction-replay` / `local-interaction-replay` | 前后 packet 与截图；共同交互所有者、控制器和实际 details 变化 | 本地交互观察重放，不证明所有模式 |

源码合同例：

```json
{
  "version": 1,
  "kind": "component-source-contract",
  "widgetType": "future_card",
  "provider": "example-provider",
  "source": {
    "path": "learning/input/future-card.php",
    "sha256": "填写真实源码 SHA-256"
  },
  "controls": [{ "id": "title", "type": "text" }]
}
```

当前静态源码验证支持明确的 PHP `get_name()` 字面量和 `add_control` / `add_responsive_control` 数组。间接注册、动态工厂和无法静态确认的控制类型会阻止该份证据；应继续研究，不可填写虚假源码合同。

保存重放文件字段为 `version:1`、`kind:component-save-replay`、`widgetType`、`elementId`、`intended`、`readback`，后两项为文件引用。

呈现重放文件字段为 `version:1`、`kind:component-render-replay`、`widgetType`、`nodeId`、`packet`、`screenshot`。

交互重放文件字段为 `version:1`、`kind:component-interaction-replay`、`widgetType`、`interactionId`、`before`、`after`、`beforeScreenshot`、`afterScreenshot`。

## 发布与使用边界

- 先验证全部显式输入，再复制证据到 `learning/<learningId>/evidence/<hash>.<ext>`；不会把其中的商品、附件、表单或 Sidebar 值当作默认值。
- `record.json` 与 `learning/releases/<hash>.json` 只追加。`data/system/knowledge-current.json` 是原子更新的目录指针；`release:null` 表示没有激活的增量候选链，历史记录和显式冻结引用继续有效。
- 发布有本地串行锁和至少 512 MiB 可用空间要求。中断留下的锁或孤立文件保留供检查，不自动清理历史。
- 新组件可以进入 `reference-only` 或 `adapter-pending`，原 44 项仍是唯一启用集合。学习成功不授予编译、查询或写入权限。
- 页面模式通过 registry 的 `pagePatterns` 提供给学习、维护和已冻结任务，始终标为候选解释；摘要保留数量、截断标记与记录引用。新建复刻和原创直接读取统一指南全文及哈希，不自动展开逐页候选。组件字段、实例参数、操作事项先留档；与已有规则重复的内容只补证据，需要的细化并入原有原则。
- 当前目标注册与资源可用性始终是任务局部事实。`local-replay-verified` 不能写成真实站点本轮验收通过。
- `readCurrentRelease` 分别返回冻结 native44 执行合同与当前 `knowledge.learningRelease`。新任务同时冻结两者；旧任务传其已冻结发布引用，没有增量知识的旧锁明确传 `null`，不会跟随新指针。学习更新不改变写入权限，也不使仍完整的旧知识链失效。

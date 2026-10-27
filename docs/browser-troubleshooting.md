# 来源浏览器预检与故障分类

## 工具等待预算与真实断线分开

浏览器调用有三层期限：页面内短探针、适配动作的完整等待（含工具传输和初始化）、最外层 `cua_repl.js.timeout_ms`。页面内 `timeoutMs:5000` 不能证明整个工具会在5秒内返回。`timeoutBudgets` 分别提供 initializationMs、readMs、probeMs、toolTimeoutMs、returnMarginMs；外层必须覆盖完整动作加返回余量。默认完整初始化/读取55秒、页面内探针5秒、外层60秒只是有界调度配置，不是网站、组件或网络的固定性能标准。调用前由恢复器校验预算关系，不足返回 configure-tool-budget，不启动浏览器动作。适配器将 probeTimeoutMs 传给页面探针，将 toolTimeoutMs 传给真实工具调用；不能只改变JSON而保留外层8—15秒。

Codex 使用当前工具文档支持的 `cua.getTab(..., {browser:实际ID})` 或 `cua.createBrowserTab('chrome', URL, {sessionName:'🔎 任务名'})`。这些API取得标签时可能同时读取初始状态，使用覆盖初始化的外层期限。已存在且绑定有效的标签继续复用；需要新标签时按既有有界恢复，不逐次重建。普通取证小段的外层同样覆盖工具往返，读回真实URL/正文后才宣布恢复；`goto()` 和标签清单成功不能代替正文、结构化读取或截图验证。

`js execution timed out; kernel reset` 属于工具执行超时，进入 inspect-tool-runtime，先检查真实外层预算和调用方式；本地动作到期使用独立 operation-deadline，绝不构造 transport disconnected。只有工具明确报告断线才归入传输故障，再以库存确认；在线但读取失败由代理排查，不因为耗尽等待就要求用户重启。未知目标写入仍优先 reconcile，不能借超时恢复重复写入。

2026-10-26实测：同一旧聊天在外层60秒时成功读取测试页、结构化DOM和截图，实际完整调用约21—43秒；新聊天成功调用也约43秒。此前8—15秒外层会提前终止。以上是本次测量，不能当固定默认或断言所有延迟均由预算造成。只读代理检查显示用户/进程代理同端点、localhost及IPv4回环有绕过；没有开关对照证据，不能断言QuickQ造成或不造成延迟。不自动修改代理，也不把反复新聊天/重启作为正常操作。

这是代理执行入口，不要求用户制作诊断文件或反复重启。先读本次可用浏览器工具的文档，使用其中实际存在的 API。该项目 CLI 只分析代理取得的事实，不连接或控制浏览器，也不授予调试权限。`browser-recovery.ts` 提供可注入受支持工具适配器的执行器；CLI `--recover` 与执行器共用同一个有界状态机，代理须执行恢复步骤后才把确需用户动作的终态交给用户。

“附加 Google Chrome”带来的 Appshot、截图或页面结构是观察材料，不等于本次会话取得 Chrome 控制连接。执行来源或已登录目标站的浏览器步骤前，代理先用当前工具清点 `browserId`、标签和可调用能力；只有确实列出 Chrome，并支持所需的读取或建标签操作，才把它作为可控制的 Chrome。只有 `iab`/`mcpapps` 时，不能把 Appshot 当作实时标签，也不能把独立 Playwright/应用内浏览器的会话说成用户已登录的 Chrome。公开页面可继续独立只读采集；必须复用 Chrome 登录态的步骤应报告连接缺口，并依据桌面应用的 Chrome 扩展设置与 `@Chrome` 入口排查，而非反复要求用户打开网页或重设代理。

设置页显示 Chrome 扩展“已安装”且开关开启，仍不代表当前聊天已取得连接。若 `@` 菜单没有 Chrome，先核实当前 Chrome 配置文件的 ChatGPT 扩展侧边聊天能否加载；应用更新状态、浏览器库存和配置文件须以实时观察为准。之后按 [OpenAI 官方浏览器扩展排查顺序](https://learn.chatgpt.com/docs/chrome-extension)检查浏览器重启、新聊天和桌面应用重启；这些步骤可能影响未保存的编辑器状态，不应自动执行。仍缺失时报告当前工具能力缺口，不修改 QuickQ、代理、全局站点设置或旧页面来猜测修复。

扩展侧边聊天恢复后，重新清点当前工具库存，并实际读取一个标签，才宣布控制连接恢复。首次建标签或导航若出现超时，先清点刚创建的同一标签及其实际 URL/内容；它可能仍在加载，不得立即再建重复标签，也不得把一次导航超时当作扩展断线。

一次读取成功只证明当次会话可用，不保证后续消息或新任务继续持有 Chrome 连接。每次需要复用用户登录态前，重新清点当前连接；若 Chrome 缺失，即使浏览器窗口和扩展侧边聊天仍正常，也不启动“三开”候选或改用不共享登录态的浏览器冒充。按官方流程先在新 Codex 聊天测试 `@Chrome`，用于区分当前聊天的连接状态与桌面应用/扩展故障；若仍缺失，再排查桌面应用重启和扩展重装。未保存的编辑器内容须先保全。

目标站当前任务的Elementor编辑器加载恢复使用 [编辑器等待与单次安全刷新](editor-completion.md#默认等待和单次安全刷新)。它与来源连接预检分开：连接正常就先观察原标签最长120秒，确认无未保存、无进行中/未知保存后才刷新一次，恢复总预算240秒。不能把编辑器iframe为空或初始化慢交给来源重连状态机反复重取标签。只有真实传输错误才调用这里的连接恢复器一次；终态才按具体缺口求助，其他任务页面不参与。

Chrome 扩展连接重新建立后，要区分失效旧标签与整个浏览器离线：若库存仍列出旧标签，但对其 CDP 焦点探针超时，同时新建的只读测试标签可正常读取，则只证明旧绑定失效。不要反复要求用户重连，也不要用 `Fetch.enable` 空规则或强行 `Fetch.continueResponse` 当作修复；成功加载的预览仍可能先出现 `Fetch.requestPaused`，关键是其后是否完成导航。当前任务编辑器仅在上述收尾文档要求的保存安全条件已可信确认时，才允许在恢复 incident 启动前换新标签；无法确认就保留旧标签，不关闭、不覆盖。

公开来源自动抓取与当前任务的目标前台对比预览使用 `src/verification/page-opening.ts`：先后相隔15秒启动最多三个只读候选，共用180秒截止；只有真实 URL、成功响应、正文和访问状态通过才选用，其他代理自建页立即关闭。该能力不用于同一文章的 Elementor 编辑器，也不替代后续完整视觉及交互复核。目标站其他需要在原 Page 上监听请求或重复载入视口的检查，继续使用原有单页有界导航。

## 自动恢复入口

正常绑定的小型 URL/DOM 探针在本次采集会话开始时执行一次。绑定、实际 URL、文档身份和视口状态没有改变时，分段采集继续使用当前绑定及事务身份，不为每段重新清点、重复连接诊断或重新验证整页。事务要求的截图前后几何、状态及最终完整复核照常执行。仅在实际读取失败、标签/会话改变或身份不一致时进入恢复。

恢复顺序由 `nextBrowserRecoveryAction` 固定：同一绑定的 CDP 小探针最多重试一次；仍失败或报告未附着/传输中断时，取得新库存，以实际来源 URL 和本次标识重新取得原有标签，再做小型 URL 与正文读取。库存/绑定仍不可用时，最多三轮，后两轮分别等待 2 秒、5 秒；多个精确 URL 候选逐个验证，优先原绑定，首个实际可读的标签继续工作。新任务传 `autoOpen:true`：仍无可用标签且不是实际登录/挑战/权限时，执行一次受支持的 `open` 动作，错峰创建最多三个只读候选，在180秒内选择首个真正可用者，关闭代理自建败者，再以 URL/DOM 小探针核实获胜标签。旧合同省略该字段，保持原恢复行为。所有候选失败后才报告确需用户完成的连接、登录或权限动作；不能重新建立 packet 获得第二次机会。

不允许把所有故障交给“重新连接”：消息超限返回 `reduce-request`；截图事务超时返回 `resume-bounded-capture`；`Uint8Array is not a constructor` 等运行时故障返回 `inspect-tool-runtime`；目标写入的未知响应返回 `reconcile-target-write`。这些结果要求代理先处理具体问题，不要求用户重连。目标写入必须使用原操作身份对账，不能调用读取恢复器重发保存/发布。

代理可以直接调用库执行器，提供当前工具文档实际支持的四种只读操作和等待函数：

```ts
import { recoverSourceBrowser } from './src/replica-v2/browser-recovery.js';

const result = await recoverSourceBrowser({
  version: 1, sourceUrl: stablePublicSourceUrl, autoOpen: true,
  initialBinding: currentLiveBinding, // 没有当前绑定时省略
  nextRequestUtf8Bytes: measuredCaptureRequestBytes,
  probeRequestUtf8Bytes: { url: measuredUrlProbeBytes, dom: measuredDomProbeBytes },
}, {
  inventory: readCurrentToolInventory,
  bind: reacquireExistingTabThroughSupportedApi,
  readUrl: readActualUrlFromBoundTab,
  readDom: readMinimalDocumentFactsFromBoundTab,
  openCandidates: raceSupportedReadOnlyTabsAndCloseLosers,
  wait: waitBriefly,
});
```

适配器的每个操作收到 `{timeoutMs, signal}`，必须向实际工具传递受支持的超时/取消能力并遵守取消信号；不能在内部做另一层无限重试。普通小探针单次5秒，`open` 动作最多180秒；读取结果仅允许实际 URL、readyState、body 是否存在及可证实的访问状态，不得凭空填写 `access:'normal'`。`bind` 仅绑定实际库存或刚由 `open` 返回的标签，不调用未文档化的 attach。`openCandidates` 只对公开来源 URL 使用工具实际支持的建标签操作，候选错峰启动、同一截止时间、先通过身份及内容检查者胜出；仅关闭代理自建的败者，不关闭或刷新用户原标签。工具不支持建标签时返回真实失败并一次说明能力缺口，不伪称已自动打开。库没有自动通知用户的副作用。

当前 CUA 工具由代理逐步驱动，不能假设终端进程可以直接调用 CUA。先遵守 CUA 首次调用/文档要求，然后按 `--recover` 返回的 `action` 执行当前工具支持的 API：`inventory` 对应 `cua.getState()`；`bind` 对应 `cua.getTab(tabId, {browser:browserId})`，参数只取实时库存；`url`、`dom` 对应所读工具文档提供的小型读取方法；`wait` 使用短等待工具。`open` 只能调用当前工具文档明确支持的建标签 API，先核实浏览器实例、会话与认证作用域，绝不把不共享登录态的浏览器当成已连接的 Chrome。不得把这些例子当作不存在的原生附着 API。

代理在内存中初始化下列 packet，经 stdin 调用 `npm.cmd --silent run browser:preflight -- --recover --stdin`。收到 `status:'continue'` 后执行 `action`，把实际结果追加到 `events` 再调用；状态机会拒绝乱序事件或错误绑定。`events` 不写任务文档或固定配置，结束即释放。

```json
{
  "version": 1,
  "sourceUrl": "https://example.com/shop/",
  "autoOpen": true,
  "nextRequestUtf8Bytes": 3000,
  "probeRequestUtf8Bytes": { "url": 110, "dom": 280 },
  "events": []
}
```

事件形状为 `{kind:'inventory',result:{outcome:'ok',inventory:{browsers:[...]}}}`、`{kind:'bind',binding:{browserId,tabId},result:{outcome:'ok'}}`、`{kind:'url',binding,result:{outcome:'ok',actualUrl}}`、`{kind:'dom',binding,result:{outcome:'ok',actualUrl,readyState,bodyPresent,access}}`，或 `{kind:'wait',delayMs,result:{outcome:'ok'}}`。错误结果是 `{outcome:'error',error:'实际工具错误'}`；原文仅供内存分类，CLI 不回显。访问状态为 `normal|login|challenge|permission-required`。已有失败可附 `failure:{scope:'source-read|source-capture|tool-runtime|target-write',error:...,probeStage:'url|dom'}`；已有绑定可附 `initialBinding`。从历史 v1 预检进入时，如果同绑定一次重试已经用完，必须附 `sameBindingRetryUsed:true`，不能重新获得重试额度。`ready` 的退出码为 0，继续执行或代理可处理的结果为 2，确需用户帮助为 1。返回标识只用于当前会话，不持久化为下次默认。

`autoOpen:true` 时还可能出现 `{kind:'open',result:{outcome:'ok',binding:{browserId,tabId}}}`。工具不支持或所有候选失败时记录真实错误；不得把未验证的候选伪装为胜出标签。

PowerShell 只在内存中传递状态和返回值，例如：

```powershell
$recoveryPacket = @{ version = 1; sourceUrl = $stablePublicSourceUrl; autoOpen = $true; nextRequestUtf8Bytes = $captureBytes; probeRequestUtf8Bytes = @{ url = $urlBytes; dom = $domBytes }; events = @() }
$recoveryStep = ($recoveryPacket | ConvertTo-Json -Depth 20 -Compress | npm.cmd --silent run browser:preflight -- --recover --stdin) | ConvertFrom-Json
# 代理用当前受支持浏览器工具执行 $recoveryStep.action，取得真实 $toolEvent 后：
$recoveryPacket.events += $toolEvent
$recoveryStep = ($recoveryPacket | ConvertTo-Json -Depth 20 -Compress | npm.cmd --silent run browser:preflight -- --recover --stdin) | ConvertFrom-Json
```

该命令在 `D:/cloneWP` 运行。PowerShell 不自行伪造浏览器操作；`$toolEvent` 必须来自代理刚完成的对应工具调用。CLI 的退出码 2 表示下一步仍应由代理执行，不能把它误当成要求用户处理。

截图超时后拆成较短事务并保留已成功分段，必须先恢复视口、滚动和交互状态，实际读回 document/style/geometry/state 哈希和 viewport，再通过 `canResumeBrowserCapture` 精确比对。任何身份变化都不能复用旧分段；需在当前身份下重采受影响的完整覆盖。该函数只判断能否续采，不替代现有 capture transaction、像素/覆盖/等价校验及代理实际查看两桌面截图和交互。

新任务在小探针之后使用 `browser:preflight -- --version 2 --stdin --raster <项目内真实截图>` 校验 URL、DOM、baseline、layout、screenshot、restore 六阶段事务；完整 schema 是 `src/replica-v2/capture-transaction.ts`。请求、响应、绑定、文档修订、CSS 哈希、实际 viewport、字体/媒体/轮播、截图前后几何与恢复均纳入检查。sidecar v3 把每次事务与来源截图归档，后续按采集当时的时间重放验证。代理主动打开的获胜标签须在 manifest 与 sidecar 同时如实标记 `agent-opened-browser`，复用用户原标签则继续 `user-opened-browser`；两者仍须绑定相同真实标签、URL、截图和事务，不得只改标签伪造来源。报告明确是 `capture-consistency-only`。下面的默认 v1 命令保留给历史预检，不能代替新的采集事务。

## 会话预检与事务前置条件

1. 清点当前已连接浏览器实例和用户原有标签，按实际来源 URL 找到候选。用本次库存返回的标识绑定，不能按 Chrome 名称、最近标签或旧会话 ID 猜测。多个相同 URL 标签时，对候选做小型只读探针，选择当前内容完整的标签。
2. 测量下一次调用的完整 UTF-8 请求体，包含函数源码、参数和包装字段。项目保守预算为 **32 KiB**，不是扩展协议硬上限。超预算时先减小请求，使用现有 `measure-geometry.browser.js` 的区域根内遍历，不把每个节点的长选择器发回浏览器。
3. 对已绑定标签先读取实际 URL，再读取少量正文事实（例如 URL、readyState、正文根是否存在）。这些探针也使用预算。只使用工具文档提供的读取方法，不调用未知附着 API。
4. 代理将脱敏后的本次库存、选定标识、完整请求字节数和真实探针结果组装为下列规范化输入，调用 **`npm run browser:preflight -- --stdin`**。由代理通过标准输入传递 JSON；不得把 Cookie、Authorization、一次性 URL 或原始会话导出写入文件。来源 URL 只用稳定公开页面 URL。
5. 严格执行报告的 `code`、`retry` 与 `nextActions`。非 ready 不发起大采集；需要恢复时进入上述统一状态机，不在每个调用方另写重试循环。历史 v1 的 `cdp_timeout_retry` 仍只允许同一实例和标签上的小探针重试 **一次**。

Windows PowerShell 中由代理使用 **`npm.cmd`** 入口；当前机器已验证的调用如下，终端工作目录显式设为 `D:/cloneWP`：

```powershell
$diagnosticJson | & 'C:/Program Files/nodejs/npm.cmd' run browser:preflight -- --stdin
```

`$diagnosticJson` 是代理在内存中组装的上述实时事实 JSON。当前 PowerShell 的 `npm.ps1` 包装可能吞掉 `--stdin` 并报告 `Unknown cli config`，这属于命令入口转发问题，不能判断成浏览器断线，也不要求用户处理；代理直接改用本机已安装的 `npm.cmd`。其他系统继续使用 `npm run browser:preflight -- --stdin`。

规范化输入来自实时工具输出，示例标识仅说明字段，不是固定配置：

```json
{
  "version": 1,
  "sourceUrl": "https://example.com/shop/",
  "inventory": {
    "browsers": [{
      "browserId": "本次库存返回的实例标识",
      "tabs": [{ "tabId": "本次标签标识", "url": "https://example.com/shop/" }]
    }]
  },
  "selected": { "browserId": "本次库存返回的实例标识", "tabId": "本次标签标识" },
  "request": { "utf8Bytes": 3113 },
  "probes": [
    { "stage": "url", "outcome": "ok", "actualUrl": "https://example.com/shop/" },
    { "stage": "dom", "outcome": "ok", "actualUrl": "https://example.com/shop/", "readyState": "complete", "bodyPresent": true }
  ]
}
```

失败探针使用 `{ "stage": "url", "outcome": "error", "error": "脱敏后的实际错误文本" }`。代理不得编造成功探针或用本地检查替代实时读取。`probes` 仅属于当前绑定，绑定改变后重新采集探针。每阶段首次加重试最多两条。

可直接导入 `browserRequestUtf8Bytes` 测量内存中的完整调用对象；函数必须以实际传输的源码字符串计入，不能传入会被 JSON 静默忽略的函数对象。已有不含凭据的本地请求时，可以加 `--request D:/cloneWP/.../request.json` 让 CLI 实际量取字节，并覆盖输入中声明的大小。`--input` 只用于本项目内已脱敏的输入；默认优先 stdin，不持久化会话标识。CLI 不输出来源 URL、标识或错误原文，不自动写报告。退出码 `0` 是预检通过，`2` 是还需执行具名的小探针或一次只读重试，`1` 是阻断。

## 分类和恢复边界

| 报告代码 | 已知事实与处理 |
| --- | --- |
| `browser_offline` | 本次库存没有已连接实例；检查连接器/扩展连接。不能从单个工具超时推出此结论。 |
| `source_tab_missing` / `source_tab_ambiguous` / `stale_binding` | 浏览器库存与来源绑定不唯一或已过期；重新核对实际 URL 与已有标签，不沿用重启前 ID。 |
| `source_document_not_ready` | 小探针可读取，但正文仍在加载或 body 不存在；等待正常加载并再读回，不认定页面内容丢失。 |
| `request_too_large` / `message_too_large` | 缩小完整请求；若小请求仍出现消息大小错误，再核对响应分片及工具输出大小。重启不能解决体积限制。 |
| `tab_debugger_not_attached` | 浏览器在线、单标签未附着；清点其他现有标签，用小探针确认范围，然后通过工具实际支持的连接流程恢复。底层原因未证实时不称作扩展已修复。 |
| `cdp_timeout_retry` | 一次 CDP 超时；保留当前绑定最多重试一次小型只读探针。 |
| `cdp_timeout_exhausted` / `read_only_retry_exhausted` | 停止重复调用，重新清点并具名报告；不要再要求用户重复重启。 |
| `browser_transport_disconnected` | 探针报告传输中断；重新库存确认影响范围。 |
| `unknown_probe_failure` | 未归类错误；检查当前工具文档，不猜测为断线。 |
| `screenshot_layout_changed` / `screenshot_geometry_mismatch` | 截图布局或像素问题；走下面的几何验证，不归类成连接问题。 |

这些处理均不得自动关闭、重启用户浏览器，绕过 URL 安全守卫、授权提示或来源浏览器限制，也不得改用来源 HTTP/无头浏览器访问来掩盖连接失败。确实需要用户执行受支持连接动作时，先给出已排查的具体故障类别和缺少的那一步。

## 截图后再诊断几何

连接预检通过不代表截图可导入。截图前后保留实际 CSS 视口（含 clientWidth）、正文几何与原始截图尺寸，在同一输入增加：

```json
{
  "capture": {
    "mode": "viewport",
    "rasterWidth": 1920,
    "rasterHeight": 1080,
    "before": { "width": 1920, "height": 1080, "clientWidth": 1905 },
    "after": { "width": 1920, "height": 1080, "clientWidth": 1905 },
    "layoutStable": true
  }
}
```

该段合并入前面的完整输入；数值取自当前真实读回，不照抄示例。`layoutStable` 来自现有采集前后节点几何检查，不能只根据截图看起来相似填写。整页截图用 `mode: "full-page"`，允许真实图高大于视口。

原始 JPEG 可能被工具缩放，临时截图视口可能改变滚动条。发现差异时保留原始证据，使用已有 `viewport-raster.ts`、`capture-equivalence.ts` 和观察导入器校验像素来源及逐节点等价关系；不能补空白、修改来源事实或仅凭诊断 ready 声称整页视觉已验证。结束后恢复临时 viewport 与交互状态并读回。

## 本次故障证据

- [Pet Supermarket 修复记录](../references/pet-20261016-2117-observation/repair-report.json)：6,831 个长选择器约 3.44 MB，请求改成区域根遍历后约 3 KB。旧标签附着问题和截图滚动条变化是另外的故障。
- [实例选择排查](../reports/elementor-learning-20261016/BROWSER-CONNECTION.md)：同名 Chrome 位于不同实例，按实际库存和 URL 绑定后恢复；示例会话 ID 不作为以后默认。

该诊断与本地测试证明分类和请求预算执行；当前浏览器是否已恢复仍需实时 URL/正文读回。未改扩展底层，未自动获得权限，也未证明所有未附着问题的根因已经修复。

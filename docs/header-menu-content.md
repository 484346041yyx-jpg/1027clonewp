# 独立页眉的原生菜单内容块

这是既有 `src/woodmart-header/generic/` 的可选能力，不新增 Widget、入口、插件或全站菜单位置。旧合同没有 `menuContent` 时保持原有文件和快照形状。

页眉方案可增加 `menuContent` 数组；每项声明 `key`、真实资源 `name`、任务自有 `menuKey`、叶菜单项 `itemKey` 和完整 `program`。`program.taskId` 使用本页眉的 `owner.runId`，避免与正文的元素身份重叠。菜单项不能同时含 WordPress 子项：WoodMart 原生 walker 在有子项时不渲染绑定内容块。完整下级分类、标题和链接应进入该内容块。

先按来源内容选模型：普通逐级链接使用菜单子项；包含图片卡片、分栏、标题、分隔线或底部链接的完整面板使用一个原生 HTML 内容块，面板内部用 Elementor 原生组件编辑。不得用一串菜单项加 nth-child 定位拼出富内容面板。商品推荐仍使用真实商品组件，不把静态分类图片误判为商品。

内容块沿用 native44 编译器、当前研究知识与目标注册控件交集。未声明 version 的 v1 保持原合同：Container、heading/text-editor/wd_list/button 和 `native-products: wd_products`，至少一组真实商品、单组最多八个，不接收导入媒体。显式 `version:2` 支持纯静态面板及 wd_image_or_svg/image-box/divider；商品查询按实际需要声明，纯静态面板不会读取商品。`assets:{path,sha256}` 指向本任务已导入媒体账本，必须完整覆盖引用且没有多余项，实际附件归属、字节哈希和 URL 在写前核实。两版均拒绝原始 HTML、表单及其它查询模型，来源事实必须从哈希绑定观察包重新推导且属于页眉。

v2 必须声明 `dropdown:{design,colorScheme,event,width?,height?,padding?}`。design 为 default/full-width/sized；仅 sized 接收宽高且宽度必填；padding 是原生下拉间距（0–200px）；colorScheme 为 default/light/dark，default 保存为空的原生默认选项；event 为 hover/click。这些参数保存为测试站实际 WoodMart 原生菜单项设置，不用 CSS 模拟原生下拉容器。未适配的原生参数先报告能力缺口，不写猜测字段。内容排版 CSS 仍归独立页眉，不能改正文或全站设置。

用户明确要求转换现有任务菜单时，`retireChildren` 声明实际完整旧分支的稳定 key，目标菜单方案移除这些子项。前后两端验证它恰好覆盖该父项全部后代且逐项归属，原生内容块保存及渲染确认后才将旧项移入回收站。其他菜单项、菜单、手机内容块及页面正文保持读回一致。已发布自有页面的修改需要服务调用显式传入精确 pageId，落盘意图记录当前正文/页面指纹，服务器在锁内再次核对；这不改变旧任务合同或允许修改共享资源。

菜单入口照片使用同一方案的可选 `menuItemMedia:[{menuKey,itemKey,mediaKey}]`。mediaKey 来自该任务页眉素材清单和已读回的附件绑定，保存到 WoodMart 原生菜单图片（featured image 和 image-type）；不把照片地址硬写入 CSS。只支持同时启用 menuContent 的新模块，全部图片引用和实际附件在菜单写入前验证，绑定值也进入菜单快照与读回。

`prepareHeaderMenuContentLocal` 在认证前验证文件、知识和来源。目标预备只读核实已安装 walker 的叶项绑定及全屏菜单分支、实际 Elementor 控件和目标商品；持久化商品读取证据后才编译。精确的当前进程编译证明才能进入写入接口，序列化元素不能直接授权保存。

`menu-content` 写入沿用模块锁、预期快照、落盘意图、started/complete 收据及响应未知对账。只创建或修改精确归属的 cms_block，经 Elementor document save 保存，再绑定该任务菜单项 `_menu_item_block`。保护其它菜单项元数据、正文、共享记录、全站页眉和菜单位置。引用审计覆盖其它菜单、页眉、页面和共享块；另有编辑锁与真实商品状态检查。

模块读回包含内容块完整文档及各绑定项的文档和元数据指纹，进入现有菜单指纹和整页保护。原生内容块编辑入口随完整交付资源输出。更新使用既有 header-module CLI 的 `update-menu-content --bundle DIR --content KEY`；响应未知仍先 reconcile。

软件测试及目标只读兼容核实不等于当前页面通过。新任务必须实际检查两手机宽度的商品数量、图片/名称/价格/链接、打开/返回/关闭菜单，以及原生编辑器内的商品控件；桌面相关菜单和整页验收同时保留。

菜单数量上限为每个自有菜单 200 项；层级、链接、身份去重和所有权检查继续保留，客户端与服务器使用相同边界。手机布局仍必须恰有一个 style=icon/full_screen=true 的主面板菜单；允许额外的原生 style=text/full_screen=false 工具菜单承载地区等文字入口。主面板菜单须在 WHB 的菜单聚合顺序最后，防止 WoodMart 8.3.4 用工具菜单覆盖面板绑定。

正文订阅外观的 pending Form 可以显式声明 sourceSubmitModel=aria-button，限真实来源 div[role=button] 与同一个 form 下的唯一可见 email 控件。声明只扩大来源模型识别；目标仍是 inert 原生 Form、空 submit_actions、业务 pending，且来源节点/角色/归属/几何和双桌面证据必须完全匹配。

当来源字体的 CORS 不允许当前测试站时，显式 source-font 资源能力可把已冻结的原始 TrueType 文件导入为当前任务页面的附件。`importNative44SourceFonts` 复用原媒体的串行意图、逐阶段状态、相同字节去重、未知结果只读对账及附件实际哈希核验；普通图片入口仍拒绝字体。字节校验限制 TTF magic、目录数量、唯一表及界限和必需表。`WordPressClient.importSourceFont` 只允许真实归属草稿、精确哈希和 font/ttf，经独立受锁注册创建附件，不安装系统字体、不改全站字体注册或 upload_mimes。附件保留在本任务 uploads 目录并随该附件生命周期管理。恢复扫描有界为512个本页附件，常规批量验证仍每批100。应用字体继续使用本任务页面独立 CSS；对当前渲染字体及实际资源请求验证，不能用成功上传代替字体已使用。

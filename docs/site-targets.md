# 测试站默认复刻与正式站独立维护

站点登记在 `config/sites.json`。未指定目标时继续使用 `config/project.json` 的 yaoxuxuan.com 测试站；jiangubottle.com 的独立配置在 `config/sites/jiangubottle.json`。不修改默认文件来临时切换站点，不设置永久的 CLONEWP_SITE 系统环境变量。

用户普通“复刻网页/正文：来源网址”仍默认制作到测试站。用户明确“修改正式站：页面网址，修改内容”时，代理才为这一条维护命令设置 `CLONEWP_SITE=jiangubottle`，结束后恢复原进程环境。推荐在内存子进程环境中传递；workspace exec 会继承调用进程的该选择，同时继续注入锁令牌。对测试站任务可显式传 `CLONEWP_SITE=yaoxuxuan`。参数不匹配、目标身份冲突或配置缺失时失败，不回退另一站。

本地只读检查（不认证、不读取密码、不请求站点）：

```powershell
npm run site:config
npm run site:config -- jiangubottle
```

这里的命令参数仅检查该配置，不改变后续命令的目标。`loadConfig` 的原有消费者共用选择入口，不新增另一套制作、修订或发布流水线。

正式站凭据独立指向 `config/credentials.jiangubottle.local.json`，不未经核验直接复制测试站凭据、不创建占位密码。2026-10-28 按用户明确接入授权，在内存中验证复制站沿用的应用凭据有效后，已使用 Windows DPAPI CurrentUser 独立加密保存并解密读回，再用正式站独立文件完成只读认证。未新建或修改远端用户、密码或应用凭据。若使用内存环境凭据，必须同时设置 `CLONEWP_WP_SITE=jiangubottle`，以免意外沿用测试站的环境凭据。文件存在不代表未来认证仍有效。

所有原有范围、组件、响应式、视觉/交互验收、表单 testing:user-managed、串行写入、所有权、CAS、读回及编辑器收尾规则保持。正式站现有发布页面默认只读；仅当前用户明确授权的页面/资源及修改内容可进入维护。配置选择本身不授予写入权限，不把“新建任务默认发布”用于授权不明的既有页面。

站点复制不迁移旧任务授权、页面所有权、ID、证据、公共资源绑定、询盘收件设置或当前环境核验证明；正式站实际修改前逐项读取核实。不得仅更换旧任务域名继续执行，不把相同 ID 当作同一对象。公共组件知识可复用，目标环境及当前能力必须实际核验。此配置不代表已有正式站页面已经取得现有受保护修订工具的所有权资格；如资格不足，在具体维护任务中处理，不能绕过。

测试站恢复插件保持仅允许 yaoxuxuan.com；正式站不使用测试站初始化、清空或恢复工具。2026-10-28 的只读清点发现正式站也复制并启用了 `clonewp-test-reset` 0.1.1；仅报告现状，未调用、停用或更改插件。

## 2026-10-28 连接与环境核验

正式站独立凭据认证通过，实际 home/siteurl 均为 https://jiangubottle.com，默认测试站配置未改变。两站 WordPress 7.1.3、Elementor 3.35.4、Elementor Pro 3.35.1、WooCommerce 10.9.4、Novamira 1.12.12、WoodMart 父主题 8.5.0、WoodMart Core 1.1.7 一致；PHP 分别为正式站 8.3.22、测试站 8.3.31。

正式站实际 REST 索引未注册 `mcp` 命名空间及 `/mcp/novamira`，现有维护入口返回 HTTP 404。测试站注册了该入口，但本轮能力请求返回 HTTP 500。因此只确认认证和上述环境清点，组件 schema、响应式断点、核心源码合同及完整维护兼容性未核验通过；不能仅凭版本或复制关系视为已具备写入资格。未修改或修复两站插件、设置及页面。

不含凭据的当前核验记录：`D:/cloneWP/data/sites/jiangubottle/connection-check.json`。这是带时间的观察，不能代替后续任务的实时认证、目标所有权或质量门。

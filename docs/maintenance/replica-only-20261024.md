# 当前复刻功能瘦身记录（2026-10-24）

状态：本地瘦身及最终软件回归完成；未执行真实站点验收。

本轮只操作 D:/cloneWP 本地文件；没有提交或暂存 Git，没有操作真实 WordPress 网站。测试 HTTP/MCP 交互使用本地模拟服务，浏览器集成使用本地 fixture。

删除 75 个源码文件、83 个旧工具文件、86 个退出功能的测试文件；提取或迁移 10 个共用模块。删除清单按本轮变更前本地快照核对，不把用户已有改动算成本轮成果。

## 移除的执行流程

- 原创/自动设计建站及其设计、编译、保存和验收执行器。
- 旧 URL 自动采集、内置 Codex 模型规划与生成执行器。
- fidelity v1 与 staged replica-v2 的独立建站执行器。
- 独立 native44 组件页面创建器；保留其当前编译与校验能力。
- 旧 reference-to-original/旧观察包回退及转交 src/cli.ts 的分支。
- create:original、create:replica:component、reference:brief 命令。create 与 create:replica 现在使用同一个完整复刻入口。
- 内置规划器的 @openai/codex-sdk 依赖和锁文件记录。

## 保留的当前能力

当前准备派工与合并、来源完整性、44 原生组件、桌面和手机适配、WoodMart 页眉/菜单/富菜单、真实商品与文章查询、隔离 CSS、受保护修订、未知写入对账、发布与编辑器收尾均保留。Codex/Claude 两个来源入口共用同一后续流程。

V2 观察包、来源事实、组件映射、哈希和证据合同继续使用原数据语义；保留历史证据读取不等于保留旧建站执行器。WordPress 所需 MCP SDK、Playwright、Sharp、Zod、CSS/HTML 解析器保留。

## 共用能力去向

| 模块 | 保留职责 |
| --- | --- |
| `src/core/draft-guards.ts` | 草稿哈希、授权修改及并发保护 |
| `src/wordpress/preview-session.ts` | 仅内存的同源预览会话 |
| `src/core/project-path.ts` | 项目路径边界 |
| `src/assets/validation.ts` | 图片 MIME、尺寸和 SVG 安全检查 |
| `src/core/raw-input.ts` | 原始输入字节归档与保护 |
| `src/assets/import-attempt.ts` | 只在已证明未写入时重试素材导入 |
| `src/verification/carousel-runtime.ts` | 真实轮播状态、就绪和逻辑位置 |
| `src/wordpress/catalog-contract.ts` | 当前商品与呈现证据类型 |
| `src/wordpress/posts-contract.ts` | 真实文章查询及证据验证 |
| `src/verification/catalog-browser.ts` | 原生商品呈现与轮播观察 |

六组函数正文与本轮提取前逐字一致：draft-guards、preview-session、media-validation、raw-input-archive、media-import-retry、carousel-runtime。核对 SHA-256 保存在本轮提取审计中。

## 验证

- 最终 npm test：1546 项，1544 通过、0 失败、2 跳过、0 取消；总耗时 421004 ms，退出码 0。
- 两项跳过均因本机没有 PHP CLI：页面模板/空媒体等价、共享规范化 JSON 数字/Unicode/空类型/顺序 fixture。未把跳过算作通过。
- 最终 npm run build：退出码 0。
- 六组提取函数正文的逐字/哈希核对通过。
- npm prune --ignore-scripts --offline --no-audit --no-fund：移除 3 个退出的安装包；npm ls --depth=0 正常，Codex SDK 安装目录已不存在，其余声明版本未变化。
- 完整日志：D:/cloneWP/.cache/replica-only-tests.log。
- 提取审计：D:/cloneWP/.cache/replica-only-extraction-audit.json。

新增了旧入口拒绝、生产源码无旧执行器依赖、动态浏览器资源存在性、素材字节/MIME 与原始输入归档回归。保留当前编译、来源、响应式、交互、页眉、CAS/读回、修订、发布与编辑器测试。

四份必需的探针脚本已固定到 tests/fixtures/source-probes；部分当前测试仍依赖已有本地历史截图/观察数据，因此本轮没有清理相关历史目录，也未证明仅凭 Git 干净检出即可复现所有测试。

没有进行真实测试站视觉、交互、编辑器或发布验收，不能用本地测试替代这些结论。

## 冻结记录与恢复边界

现有 runs、references、revisions、组件知识、config 目录及凭据未删除或迁移。发现 8 份既有 full-replica write-unknown 记录；本轮没有联网对账，也没有更改其 pending 状态、CSS、program 或冻结锁。

源码提取会改变新任务的执行指纹。当前任务续跑/对账代码保留，但本轮之前冻结的任务不能直接视为已验证可续跑；未知写入只能先按原证据单独对账，不能盲重试或更新旧锁掩盖差异。因为这些未决记录，本轮保留 .cache/replica-only-before 中的变更前文件快照与运行审计，不执行历史证据清理。该快照不是对所有历史版本完整重放的承诺。

## 删除文件清单

### src

- `src/agent-check.ts`
- `src/capture/font-proof.ts`
- `src/capture/index.ts`
- `src/capture/svg-paint.ts`
- `src/cli.ts`
- `src/core/runner.ts`
- `src/fidelity/acceptance.ts`
- `src/fidelity/block-writer.ts`
- `src/fidelity/browser-environment.ts`
- `src/fidelity/capability-plan.ts`
- `src/fidelity/catalog-browser.ts`
- `src/fidelity/catalog-contract.ts`
- `src/fidelity/catalog-style.ts`
- `src/fidelity/check.ts`
- `src/fidelity/completion.ts`
- `src/fidelity/control-alignment.ts`
- `src/fidelity/editor-checkpoint.ts`
- `src/fidelity/native-fraction.ts`
- `src/fidelity/native.ts`
- `src/fidelity/posts-contract.ts`
- `src/fidelity/presentation-browser.ts`
- `src/fidelity/presentation-contract.ts`
- `src/fidelity/presentation-schema.ts`
- `src/fidelity/revision.ts`
- `src/fidelity/runner.ts`
- `src/fidelity/runtime.ts`
- `src/fidelity/scoped-css.ts`
- `src/fidelity/source-binding-plan.ts`
- `src/fidelity/source-binding.ts`
- `src/fidelity/source-coverage.ts`
- `src/fidelity/source-static-text.ts`
- `src/fidelity/text-paint.ts`
- `src/fidelity/types.ts`
- `src/fidelity/validate.ts`
- `src/fidelity/verify.ts`
- `src/fidelity/visual-acceptance.ts`
- `src/fidelity/visual-compare.ts`
- `src/original/acceptance.ts`
- `src/original/compile.ts`
- `src/original/components.ts`
- `src/original/design.ts`
- `src/original/native-verification.ts`
- `src/original/prototype.ts`
- `src/original/runner.ts`
- `src/original/types.ts`
- `src/original/validate.ts`
- `src/original/verify.ts`
- `src/planning/codex.ts`
- `src/planning/evidence-server.ts`
- `src/planning/evidence-store.ts`
- `src/reference/audit.ts`
- `src/reference/brief.ts`
- `src/reference/capture.ts`
- `src/reference/collect-blocks.browser.js`
- `src/reference/derive.ts`
- `src/reference/observation.ts`
- `src/reference/prepare.ts`
- `src/reference/profile.ts`
- `src/reference/readiness.ts`
- `src/reference/relocate.ts`
- `src/reference/responsive.ts`
- `src/reference/scoped.ts`
- `src/reference/source-scene.ts`
- `src/reference/types.ts`
- `src/reference-brief-cli.ts`
- `src/replica-v2/capability-sample.ts`
- `src/replica-v2/compile.ts`
- `src/replica-v2/editor-recovery.ts`
- `src/replica-v2/editor.ts`
- `src/replica-v2/native-carousel.ts`
- `src/replica-v2/product-interaction.ts`
- `src/replica-v2/render-preparation.ts`
- `src/replica-v2/runtime.ts`
- `src/replica-v2/validate.ts`
- `src/replica-v2/verify.ts`

### tools

- `tools/append-pet-v2-responsive.mjs`
- `tools/apply-pet-block-final-20261017.ts`
- `tools/apply-pet-block-refinement-20261017.ts`
- `tools/apply-pet-header-navigation-20261017.ts`
- `tools/apply-pet-notice-alignment-20261017.ts`
- `tools/apply-pet-pixel-finish-20261017.ts`
- `tools/apply-pet-product-amendment-20261017.ts`
- `tools/apply-pet-repair-copy-20261017.ts`
- `tools/apply-pet-visual-correction-20261017.ts`
- `tools/attach-pet-v2-inventory.mjs`
- `tools/author-pet-scope-20261017.ts`
- `tools/author-pet-v2-plan.mjs`
- `tools/author-pet-v2-responsive.mjs`
- `tools/author-pet-v2.mjs`
- `tools/bind-pet-target-20261017.ts`
- `tools/build-pet-product-amendment-20261017.ts`
- `tools/check-current-geometry-review.ts`
- `tools/check-pet-scope-20261017.ts`
- `tools/compare-current-draft-checkpoint.ts`
- `tools/compare-pet-amendment-20261017.ts`
- `tools/create-pet-repair-copy-20261017.ts`
- `tools/declare-pet-v2-media-variants.mjs`
- `tools/diagnose-pet-owned-draft-20261017.ts`
- `tools/diagnose-pet-source-20261017.ts`
- `tools/discover-pet-scope-target-20261017.ts`
- `tools/finalize-pet-handoff-20261017.ts`
- `tools/finalize-pet-unified-repair-20261017.ts`
- `tools/finish-pet-applied-delivery-20261017.ts`
- `tools/freeze-pet-scope-revision-20261017.ts`
- `tools/handoff-pet-css-20261017.ts`
- `tools/hoshiichi-mobile-build.mjs`
- `tools/hoshiichi-mobile-current.ts`
- `tools/hoshiichi-mobile-planning-fix.mjs`
- `tools/import-pet-inline-media-20261017.ts`
- `tools/import-pet-native44-assets-20261016.ts`
- `tools/inspect-pet-applied-layout-20261017.ts`
- `tools/inspect-pet-v2.ts`
- `tools/link-pet-repair-successor-20261017.ts`
- `tools/map-pet-review-controls-20261017.ts`
- `tools/pet-applied-crops-20261017.ts`
- `tools/pet-native44-native-controls-20261016.ts`
- `tools/pet-review-artifacts-20261017.ts`
- `tools/pet-v2-decisions.mjs`
- `tools/pet-v2-marketing.mjs`
- `tools/pet-v2-media-variants.mjs`
- `tools/pet-v2-responsive-assets.mjs`
- `tools/pet-v2-responsive-mapping.mjs`
- `tools/pet-v2-responsive-marketing.mjs`
- `tools/pet-v2-source-variants.mjs`
- `tools/plan-pet-native44-20261016.ts`
- `tools/plan-pet-scope-20261017.ts`
- `tools/prepare-pet-arrow-assets-20261017.ts`
- `tools/prepare-pet-arrow-png-assets-20261017.ts`
- `tools/prepare-pet-block-final-20261017.ts`
- `tools/prepare-pet-block-refinement-20261017.ts`
- `tools/prepare-pet-header-navigation-20261017.ts`
- `tools/prepare-pet-notice-alignment-20261017.ts`
- `tools/prepare-pet-pixel-finish-20261017.ts`
- `tools/prepare-pet-product-amendment-20261017.ts`
- `tools/prepare-pet-unified-css-20261017.ts`
- `tools/prepare-pet-visual-correction-20261017.ts`
- `tools/probe-pet-v2-breakpoints.ts`
- `tools/prove-pet-copy-css-equivalence-20261017.ts`
- `tools/prove-pet-css-consolidation-20261017.ts`
- `tools/read-pet-native44-catalog-20261016.ts`
- `tools/recheck-original.ts`
- `tools/reconcile-pet-arrow-media-20261017.ts`
- `tools/reconcile-pet-copy-metadata-20261017.ts`
- `tools/record-pet-block-review-20261017.ts`
- `tools/refine-pet-applied-css-20261017.ts`
- `tools/refine-pet-applied-final-20261017.ts`
- `tools/refine-pet-caption-footer-20261017.ts`
- `tools/refine-pet-deal-row-insets-20261017.ts`
- `tools/refine-pet-fluid-desktop-20261017.ts`
- `tools/report-pet-v2.mjs`
- `tools/review-pet-draft-20261017.ts`
- `tools/revise-current-review-draft.ts`
- `tools/run-current-review-draft.ts`
- `tools/update-pet-current-revision-20261017.ts`
- `tools/verify-context-sessions.mjs`
- `tools/verify-current-review-editor.ts`
- `tools/verify-pet-block-styles-20261017.ts`
- `tools/verify-pet-final-20261017.ts`

### tests

- `tests/capture.test.ts`
- `tests/catalog-style.test.ts`
- `tests/codex-evidence.test.ts`
- `tests/creation-mode.test.ts`
- `tests/evidence-reader.test.ts`
- `tests/fidelity-acceptance.test.ts`
- `tests/fidelity-browser-environment.test.ts`
- `tests/fidelity-capability-plan.test.ts`
- `tests/fidelity-carousel-panel.test.ts`
- `tests/fidelity-carousel-save-lifecycle.test.ts`
- `tests/fidelity-catalog-browser.test.ts`
- `tests/fidelity-catalog-query-editor.test.ts`
- `tests/fidelity-catalog-role-paint.test.ts`
- `tests/fidelity-content-bounds.test.ts`
- `tests/fidelity-contract.test.ts`
- `tests/fidelity-control-alignment.test.ts`
- `tests/fidelity-editor-checkpoint.test.ts`
- `tests/fidelity-final-frontend.test.ts`
- `tests/fidelity-frontend-interaction.test.ts`
- `tests/fidelity-frontend-readonly.test.ts`
- `tests/fidelity-hidden-static-text.test.ts`
- `tests/fidelity-local-css.test.ts`
- `tests/fidelity-native.test.ts`
- `tests/fidelity-preflight.test.ts`
- `tests/fidelity-presentation-contract.test.ts`
- `tests/fidelity-revision.test.ts`
- `tests/fidelity-runner.test.ts`
- `tests/fidelity-runtime.test.ts`
- `tests/fidelity-target-catalog.test.ts`
- `tests/fidelity-text-paint.test.ts`
- `tests/fidelity-visual-acceptance.test.ts`
- `tests/fidelity-visual-compare.test.ts`
- `tests/native-fraction.test.ts`
- `tests/native44-requirements.test.ts`
- `tests/native44-review-draft-runtime.test.ts`
- `tests/original-compile.test.ts`
- `tests/original-native-verification.test.ts`
- `tests/original-validation.test.ts`
- `tests/original-verify.test.ts`
- `tests/paint-visibility.test.ts`
- `tests/pet-v2-breakpoint-header.test.ts`
- `tests/pet-v2-breakpoint-promo.test.ts`
- `tests/pet-v2-explicit-node-variants.test.ts`
- `tests/pet-v2-header-offers-browser.test.ts`
- `tests/pet-v2-marketing.test.ts`
- `tests/pet-v2-native-breakpoint.test.ts`
- `tests/pet-v2-plan-responsive.test.ts`
- `tests/pet-v2-promo-flow-browser.test.ts`
- `tests/pet-v2-responsive-append.test.ts`
- `tests/pet-v2-responsive-assets.test.ts`
- `tests/pet-v2-responsive-mapping.test.ts`
- `tests/pet-v2-responsive-marketing.test.ts`
- `tests/pet-v2-source-variants.test.ts`
- `tests/presentation-browser.test.ts`
- `tests/reference-audit.test.ts`
- `tests/reference-capture.test.ts`
- `tests/reference-collect-blocks.test.ts`
- `tests/reference-content-layout.test.ts`
- `tests/reference-derive.test.ts`
- `tests/reference-observation.test.ts`
- `tests/reference-prepare.test.ts`
- `tests/reference-readiness.test.ts`
- `tests/reference-relocate.test.ts`
- `tests/reference-scoped.test.ts`
- `tests/replica-v2-browser.test.ts`
- `tests/replica-v2-capability-sample.test.ts`
- `tests/replica-v2-carousel-browser.test.ts`
- `tests/replica-v2-cli.test.ts`
- `tests/replica-v2-compile.test.ts`
- `tests/replica-v2-disclosure-content-browser.test.ts`
- `tests/replica-v2-editor-browser.test.ts`
- `tests/replica-v2-editor-recovery.test.ts`
- `tests/replica-v2-editor-save-lifecycle.test.ts`
- `tests/replica-v2-native-media-browser.test.ts`
- `tests/replica-v2-product-interaction.test.ts`
- `tests/replica-v2-render-preparation.test.ts`
- `tests/replica-v2-runtime.test.ts`
- `tests/responsive-widths.test.ts`
- `tests/source-binding-catalog-alias.test.ts`
- `tests/source-binding-plan.test.ts`
- `tests/source-binding.test.ts`
- `tests/source-coverage-repeats.test.ts`
- `tests/source-scene-loading.test.ts`
- `tests/source-scene-performance.test.ts`
- `tests/source-scene-static-copy.test.ts`
- `tests/source-scene.test.ts`

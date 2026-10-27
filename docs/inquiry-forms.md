# 通用询盘表单默认要求

新任务继续走现有 create:replica → preparation v8 → full v4 → native44。询盘表单默认配置真实原生提交、Elementor 后台保存和邮件通知，不能静默交付 inert 或静态按钮。实际提交、发送和收件测试交给用户；代理不自动发送测试询盘或测试邮件，也不以真实邮件测试作为默认交付门槛。

## 跨网站业务配置

config/inquiry-forms.local.json 使用 version 2 / kind clonewp-inquiry-sites：defaultRecipients 保存项目通用收件邮箱，sites 保存可选的目标站专属 profile。专属配置优先，其他网站使用通用收件人。示例见 config/inquiry-forms.example.json；配置不进入组件通用知识，也不从参考站复制收件邮箱。兼容原 version 1 的单目标站配置。

每个网站按实际来源表单识别字段、标签、选项、必填规则和顺序，不固定 HUAQI、字段名称、数量或六行布局。支持当前原生 Form 适配器已核实的控件；未知业务或复杂控件具名说明，不替换成假的外观表单。项目收件配置与来源网站的不同字段相互独立。

用户已授权自动生成发件设置：默认地址为 noreply@目标站域名；默认显示名随来源网站域名生成，例如 brand.example inquiries。已有明确 fromEmail/fromName 时优先使用。自动生成的是表单的发件设置，不创建邮箱账号，不生成 SMTP 凭据，不安装或修改全站发信插件。未配置的邮件主题、成功/失败提示沿用目标站原生默认；各站可在 profile 中覆盖。

只需有收件邮箱即可制作，不再索要发件身份。询盘来源存在但没有可用收件配置时，派工前具名报告缺项。没有表单的页面不因邮件配置受阻，也不会无谓嵌入邮箱信息。每个新任务只冻结其选中的业务 profile 和生成后的发件设置，后续配置变动不改旧任务或已发布页面。

## 原生生成与交付

bodyBase.inquiryPolicy 冻结 mode:submit-save-email、testing:user-managed。合并时将 source-bound Form 转成 native44-inquiry-form-v1（声明 version 4），按固定顺序配置 save-to-database、email，去掉禁用属性。邮件采用纯文本 [all-fields]，覆盖各站实际字段；Reply-To 只指向本表单的 email 字段。明确属于 Email 的 text 输入可升级为 email 校验，不改变原始来源证据。

原生字段控件、来源绑定、当前注册、设置条件、所有权、写前意图、CAS、保存读回、隔离 CSS 和原响应式复核继续执行。选中来源的表单控件不能被静态文字或按钮替换；非询盘分类和用户明确要求的静态展示在 inquiryPolicy.exceptions 记录事实与原因。旧 pending v1/v2 和 submissions-only v3 不自动迁移。

默认核对：

- 各站字段、必填与选项正确，原生 Form、提交按钮及手机布局正常。
- 表单可填写、可选择，没有 inert、disabled、readonly 或错误的提交覆盖。
- 实际保存的动作是后台保存＋邮件通知，收件邮箱正确，生成的发件设置与任务快照一致。
- 各站实际样式按原视觉流程检查；业务地址和动作不能通过 CSS/样式修订通道改写。

交付明确写“提交/保存/通知已配置；实际提交和收件由用户测试”，不能写已收到邮件或声称发件账号已验证。binding 的 runtimeVerification:user-managed-submission 表示真实发送尚未由代理测试。新任务不要求 reviewerEvidence.inquiryForms；若用户主动提供提交测试证据或要求排查，仍可使用现有可选核对能力。

## 可选只读对账

仅在用户要求或提供测试记录时使用：

npm run replica:full -- inspect-inquiry --run-dir RUN_DIR --element-id FORM_ID --test-marker clonewp-inquiry-test-HEX

它只读当前任务原生表单中一条带唯一标记的记录，返回记录 ID、时间、字段哈希和 email 动作状态，不提交表单、不发邮件、不返回客户字段原文。页面/run/Form 由当前 bound checkpoint 和 program 限定。邮件状态可区分 success、failed、pending；success 只代表 wp_mail 接受发送，不代表进入收件箱。

可选的 inquiryForms 证据及验证器保留在 src/replica-full/inquiry-review.ts，只有主动提供证据时才核对原生请求、成功提示、校验状态、后台记录和邮件动作，不成为新默认的自动测试动作。未知请求结果先对账，不能盲目重复发送。

历史任务保持原合同；本次维护不改动已发布页面、不提交来源站表单、不向项目邮箱发送测试邮件。

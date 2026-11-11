# 配置页原型约定

- 本项目是 Flutter UI Atlas 配置页的独立 React 交互原型，不代表 `atlas config`、真实登录或自动构建已经接通。
- 用户已选择方向 2：左侧角色表格，右侧常驻编辑栏；选中来源为 `reference/selected-direction.png`。
- 按用户浏览器标注，自动采集开关仅保留在角色列表，不在编辑栏重复展示；保存角色时保留列表设置的启停状态。
- `RoleDraft` 与 `saveRole` 不携带启停字段；已有角色保存时保留最新状态，只有 `setEnabled` 可以修改启停，避免并发保存覆盖列表操作。
- 保留现有 Atlas 低饱和蓝灰风格，使用桌面窗口布局，不增加手机端断点。
- 所有新增说明、用户文案和交付记录使用中文。演示账号仅使用 `example.test`，不引入接入方账号。
- `ConfigPage` 通过 `ConfigAdapter` 接口注入数据；演示适配器只保留内存状态，不用 localStorage 或真实网络登录。
- 不修改工程原有公共页面卡片、Viewer 或 CLI 行为；原型后续集成另行实施。

## 原型运行时约定

自行运行本地服务，并在当前环境的浏览器中打开预览。可以代为启动时，不把启动服务留给用户。

视觉来源不明确或已不符合当前目标时，在大幅修改前通过 Product Design 的 `get-context` 流程澄清。用户明确给出长期适用的原型偏好或决定时，在本文件记录。

按已选设计图实现时，以该图的布局、组件结构、密度、间距、颜色、字体、文案和层级为视觉依据。

页面实现放在 `src/`。保留 `.openai/hosting.json`、`worker/index.js`、`scripts/prepare-sites-build.mjs` 和 `tests/sites-worker.test.mjs` 的运行时约定，以便同一原型后续可交付 Sites。仅在用户明确要求发布后进行 Sites 交付；届时先运行 `npm run build` 与 `npm run test:sites`，构建必须产出 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。

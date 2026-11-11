# Atlas 配置页交互原型

采用用户选定的方向 2：左侧角色表格，右侧编辑栏。React 19、TypeScript、Vite，与当前工程依赖版本对齐；小图标使用 Tabler。

这是独立页面模板，尚未接入 CLI、真实账号存储与 Flutter 登录。示例角色和修改仅保存在内存中，刷新页面还原；不会把密码写入浏览器存储或发往应用。

## 运行

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 60230 --strictPort
```

## 已提供的交互

- 新增、编辑角色的 Tag、显示名称、账号与密码。
- Tag 格式与重复检查；账号和密码缺失提示。
- 仅在角色列表中独立启停角色；编辑栏提供密码显示／隐藏、保留和清除。
- 未保存就切换角色、关闭编辑栏时的放弃提醒。
- 登录测试的进行中、通过与失败状态。示例密码为 `atlas-demo`，测试只由演示适配器判断，不产生认证证据。
- 编辑应用名称与地址。地址变化使既有示例登录测试失效。
- 保存、取消与反馈；键盘操作及桌面窗口尺寸适配。

## 后续接入

`src/ConfigPage.tsx` 是页面模板；`src/types.ts` 定义 `ConfigAdapter`。当前由 `src/demo-adapter.ts` 提供示例数据。后续将适配器替换为本地配置服务，实现受限凭据保存与真实登录测试，无须重写页面结构。

`saveRole` 不接收启停字段，保存已有角色时必须保留最新的列表状态；启停只由 `setEnabled` 更新。新增角色默认启用，保存后可在列表中调整。

真实构建仍需单独落实多角色会话、采集作用域与图谱发布协议；本原型未改变现有 `atlas build` 或 `atlas view`。

## 验证

```sh
npm run type-check
npm test
npm run build
```

视觉来源为 `reference/selected-direction.png`，Logo 从该来源提取；字体优先使用本机系统字体。实际浏览器验收与设计对比见 `design-qa.md`。

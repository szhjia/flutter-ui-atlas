# 紧凑 Header 实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话执行；用户已确认短设计与实施，不再重复请求同范围授权。步骤用复选框记录。

**Goal:** 将 108px 的顶部双栏合并为 56px 单行 Header，角色改为下拉，保持全部画布功能及公共组件契约。

**Architecture:** ShellHeader 提供筛选与操作插槽；新增 HeaderMenu 负责布局与自定义链接弹层。MapCanvas 继续持有现有状态和操作回调，原生角色下拉、GroupSelect、搜索和覆盖范围在 Header 内组合，CanvasToolbar 整体放入 Layout 弹层。

**Tech Stack:** React 19、TypeScript、现有 Tabler Icons、React Flow、CSS、项目 Playwright 和 Vitest。

**Spec:** `docs/superpowers/specs/2026-11-13-compact-header-design.md`（用户已确认）。

## Global Constraints

- Header 固定 56px，桌面宽度 1543／1305／1024px 均单行；不新增手机断点。
- ScreenCard、GroupSelect、CanvasToolbar 的内部结构、尺寸、默认样式和行为保持当前内容；不用内部 CSS 覆盖或新增变体。
- UI 使用英文，保留应用数据和自定义品牌／链接；旧筛选标识、页面身份、布局存储及快捷键不变。
- 保留当前此前已授权但未提交的英文化与截图工作；不自动提交、推送或发布。

## Review Focus

- 长品牌、长账户和多账户不能把筛选或操作撑出 Header；对应桌面几何与下拉筛选测试。
- 发现模式的额外覆盖范围下拉不能挤掉搜索与布局入口；对应发现模式桌面测试。
- Layout 弹层里的方向键和 Esc 不得移动已选画布节点；对应键盘隔离与焦点恢复测试。
- 整理确认必须可见、可取消，原布局工具功能不能丢失；对应 Layout 实际操作测试。
- 品牌链接、计数及卡片信息必须保持可达／完整；对应链接、底栏、卡片几何和真实 Demo 验收。

---

### Task 1: 顶部组合、弹层和桌面验收

**Files:**
- Create: `packages/viewer/src/header/HeaderMenu.tsx`
- Modify: `packages/viewer/src/AppMap.tsx`、`packages/viewer/src/app-map.css`
- Test: `tests/browser/compact-header.spec.ts`、`tests/browser/viewer-chrome.spec.ts`、`tests/browser/viewer-language.spec.ts`、`tests/browser/canvas.spec.ts`
- Docs: 已确认的短设计状态和本计划；当前页面保持 Demo 数据可用。

**Interfaces:**
- Consumes: 现有角色／分组／搜索／覆盖范围状态；CanvasToolbar 既有 props；Shell 配置的品牌与链接。
- Produces: `HeaderMenu({label: string, children: ReactNode})`；ShellHeader 新增 `filters?: ReactNode`、`actions?: ReactNode` 插槽；原角色过滤语义保持不变。

- [x] 编写实际浏览器测试：三种桌面宽度、长名称／多账户、发现模式、角色与搜索联合筛选、Layout 弹层／Esc／焦点、整理确认、自定义链接、计数及卡片几何。
- [x] 在实现前运行新增测试，确认因 108px 顶部和缺失角色下拉／Layout 入口而失败；保留 RED 输出。
- [x] 实现 HeaderMenu 的点击外部关闭、Esc 关闭／焦点恢复及非模态键盘导航；在 MapCanvas 根快捷键处理排除 Header 控件。
- [x] 调整 ShellHeader 和外层 CSS，组合角色下拉、原 GroupSelect、搜索／覆盖范围、Layout、刷新／全景／详情图标，统计移动到底栏。
- [x] 更新原有测试的角色选择与 Layout 操作入口，保持其原行为断言。
- [x] 运行 `pnpm type-check`、`pnpm test` 和 `pnpm test:browser`，收集失败后批量修复，再复验失败与相关回归。
- [x] 使用本机 Chrome 验证真实 Demo 页面，保存前后截图，核对 56px Header、角色过滤、菜单键盘与卡片保护边界。
- [x] 对本次增量做独立审查并处理必要问题，保留既有未提交内容；不执行提交或推送。

Expected: 所有要求范围检查通过；三种桌面窗口均无横向溢出且画布从 56px 开始；公共组件基线比较一致。

自查：一个自洽任务，共享接口集中在 MapCanvas 与 HeaderMenu，保护边界及五类输入均有对应验证。无需新增依赖、修改后端或更换应用接入方式。

# Viewer 基础控件迁移：第一阶段

用户选择先迁移 Header、菜单、按钮和提示。使用官方 shadcn/ui 的 Radix Nova 组件源码，Lucide 统一本阶段图标；React Flow 继续负责画布。

## 已实施范围

- Header 的图标按钮与自定义链接使用 Button，搜索使用 Input。
- 账户使用 shadcn Select 与自绘选项弹层；覆盖范围仍使用 NativeSelect。保留原筛选值、完整账户名称与既有分组组件。账户弹层通过 data-atlas-header 隔离画布快捷键。
- HeaderMenu 使用非模态 Popover，接入框架的定位、碰撞处理、Esc 和外部关闭。Tab 使用 Radix 标准命令区循环行为；关闭后恢复入口焦点，点击外部保持目标控件焦点。
- Tooltip 同时支持鼠标和键盘，保留原有英文无障碍名称。
- 原有 CanvasToolbar 整体复用；仅保留命令移除／禁用时的外层焦点恢复，不修改其内部确认流程。

## 样式与保护边界

- Viewer 仅支持桌面。移除组件自带的移动端字号断点，禁用 Tailwind 默认屏幕断点；保留 1100px 的桌面窄窗口规则及既有面板容器规则。
- Tailwind 仅引入 theme 和 utilities，不引入 Preflight。原有 CSS 的公共选择器排除迁移控件时使用零特异性的 :where，保持原有组件级覆盖关系。
- ScreenCard、GroupSelect、CanvasToolbar 源码与本阶段基线一致。浏览器断言保留卡片 224px、图片 202×438px，以及锁定按钮的边框、间距、字号。
- 组件源码位于 packages/viewer/src/components/ui，语义主题在 ui.css，通用 cn 工具在 lib/utils.ts。依赖和锁文件由根工程维护；继续添加组件后需核对 CLI 的包目标、实际导入和根依赖声明。
- 配置页、其余详情控件及内部公共组件留待后续明确范围，配置页暂保留 Tabler。

## 验证记录

- 类型与构建通过；Node 142 项、组件 60 项和完整 Chrome 42 项通过。
- 1543／1305／1024px 桌面窗口通过 Header 几何和公共卡片保护断言；真实 60218 Demo 页面已显示新控件。
- 新增 Tooltip 用例先确认旧 title 实现失败。后续采用连续鼠标轨迹验证 Radix 的悬停缓冲；Tab 验收遵循 Radix 的标准行为，不另写键盘导航系统。
- 去掉移动端断点后的桌面专项复验另记本地日志。
- 不提交或推送，保留现有未提交内容。

用户复核指出账户原 NativeSelect 展开为系统菜单；改为真正的 Select，补充 20 个长名称、弹层边界、End／Enter 选择、Esc 恢复及方向键不移动画布的浏览器用例。

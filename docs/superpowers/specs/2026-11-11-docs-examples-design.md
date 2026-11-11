# Spec + 计划：docs-examples · 文档与示例一致性

**模块**：`docs-examples`（P1-11、P2-7、P1-8、P2-4；捎带附录A dart-5「两页」旧状态）。持续授权；台账 `.superpowers/sdd/2026-11-11-docs-examples/progress.md`。评审与 canvas-core-maint / delivery-surface 合并做。
**另记**：`dart-sdk-scope` 被工具链阻塞（本机无 Flutter SDK，Dart 改动无法运行 `flutter test` 验证）——方案保持既定收缩方向，待 SDK 可用后执行，能力地图标 blocked。

## 任务与验收

### A（P1-11，保守处置）：MD 为单一事实源 + HTML 漂移警示
- `docs/架构与接入指南.md:3` 的 HTML 链接注明「内容以本文为准」；`架构与接入指南.html` `<body>` 顶部加醒目声明（本页为手工图文版，已与 MD 分叉，内容以 `架构与接入指南.md` 为单一事实源；修改请改 MD 并同步或删除本页）。删除/生成器方案留 backlog（设计产物属用户裁决）。
- 验收：两处声明可见；grep 无其他 HTML 引用。

### B（P2-7 + dart-5）：指南第 48 行段落改写
- 「已登记『项目列表』和『项目详情』」→ 不写死数量的现况描述；「采集文件位于 examples/.atlas/generated/」→ 指引式（`atlas build` 后生成、目录按约定不入库）。
- 验收：段落不再断言不存在的事实。

### C（P1-8 + P2-4）：发现示例加固（TDD）
- `examples/atlas-discovery.mjs`：抽出纯函数 `parseRouteDeclarations(code)`（正则升级：const 可选、支持多行声明）与 `hashRouteOf(url)`（hash 剥查询参数，与 `declarative.mjs:44` 语义一致）；`candidates()` 在「读到路由表源码但 0 命中」时抛中文诊断；`routes` 从模块级移入闭包（factory 构造 discovery，消除并发共享）。
- 验收：`tests/atlas-discovery-example.test.mjs`（node --test）锚定：单行/多行/无 const 解析、0 命中报错、`#/home?tab=1→/home`、空/根 hash。

## 关卡
`pnpm type-check && pnpm test && pnpm test:browser`；验证记录；能力地图更新（docs-examples 完成、dart-sdk-scope blocked）。

# Spec + 计划：canvas-core-maint · 画布核心可维护性

**模块**：`canvas-core-maint`（P2-1、P2-2、P2-3 + 行宽裁决）。用户持续授权（2026-11-11）：每轮完成后自动推进。
**台账**：`.superpowers/sdd/2026-11-11-canvas-core-maint/progress.md`

## 任务与验收

### A（P2-1）：A* 路径搜索补测试锚定
- 现状：`route-edges.ts` 的手写二叉堆 + A*（`search()`，预算 4096、转向代价 24）零覆盖，既有 2 用例被 quick/自环分支短路。
- 做法：`tests/canvas/route-edges.test.ts` 增两条用例——① quick 候选全部被封死的布局，断言 A* 返回 `routed` 且路径为正交折线（相邻段横竖交替、点数 >2）；② 目标被四障碍完全封闭，断言 `unroutable`。布局需经验证调到真正进入 A* 分支（quick 的边界贴线放行是评审实证过的陷阱）。
- 验收：两条用例通过且能锚定现状（测试补齐型，如评审先例 SC1 一样直接通过是预期——但要先确认它们测的是 A* 而非 quick，必要时用断点式验证记录在台账）。

### B（P2-2）：命名常量收敛
- 新增 `packages/viewer/src/canvas/constants.ts`：`DEFAULT_NODE_SIZE{224,528}`、`DRAG_GAP{96,80}`（拖动/冲突紧凑）、`ARRANGE_GAP{160,120}`（整理宽松）、`COMPONENT_GAP 240`、`EDGE_TURN_COST 24`、`EDGE_SIBLING_OFFSET 18`、`EDGE_STUB_LENGTH 24`、`EDGE_SEARCH_BUDGET 4096`、`OBSTACLE_PADDING 16`、`DRAG_SEARCH_BUDGET 512`、`DRAG_DEPTH_LIMIT 128`、`DRAG_MAX_DISPLACED 12`、`NEAREST_RING_LIMIT 40`、`NEAREST_ATTEMPT_BUDGET 2048`、`CANVAS_ZOOM{.08,1.8}`、`LOCAL_SCAN_MARGIN 32`。
- 替换内联数字：geometry/arrange/route-edges/solve-drag/reconcile/useCanvasController/layout-storage（zoom 校验）/AppMap（minZoom/maxZoom）。「拖动紧凑 96/80、整理宽松 160/120」的有意差异以命名显式化。
- 验收：行为不变——既有全部测试绿（44+46 基线）；zoom 双处重复消除。

### C（P2-3）：格式化与行宽裁决
- **裁决**（评审挂账项落定）：对 `packages/viewer/src/canvas/**` 全目录执行 `prettier --write`（printWidth 120，house 配置）；13 条超 300 字符密排行在此拆分。`AppMap.tsx` 等 viewer 应用层文件不属本 finding 范围，留待后续演进（记台账）。
- 验收：`format:check` 对 canvas/ 全过；type-check/test/test:browser 全绿（canvas.spec 的 100 节点 p95≤50ms 性能门禁护航格式化无行为影响）。

## 边界
- 不改任何算法语义（B/C 均为行为不变重构）；不新增依赖；不提交。
- 每任务后 `pnpm test`；模块收尾 `type-check + test + test:browser`。

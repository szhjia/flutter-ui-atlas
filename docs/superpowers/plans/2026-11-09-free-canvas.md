# Flutter UI Atlas 自由画布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将固定网格改为可保存的自由画布，支持有限局部避让、锁定、整次撤销及不遮挡页面和文字的连线。

**Architecture:** 保留 React Flow，将几何计算、布局状态、存储、边路由及标签排布拆为独立模块。拖动从手势起始快照求解，成功后原子提交；宿主只提供稳定 layoutKey，通用包不认识业务角色或路由。

**Tech Stack:** 当前锁定的 React 19、TypeScript、React Flow 12、Vite、Vitest、Playwright；不默认引入新依赖。Node 使用工程 `.nvmrc` 的 26.12.1。

**Spec:** `docs/superpowers/specs/2026-11-09-free-canvas-design.md`，用户于 2026-11-09 确认完整设计。

## Global Constraints

- 工程根目录 `/Users/kimi/product/flutter-ui-atlas`；寓科接入工程 `/Users/kimi/projects/zhiwo_learning`。
- 初始水平间距 160、垂直间距 120；交互最小安全间距水平 96、垂直 80；断开子图间距至少 240；障碍外扩 16。
- 拖动最多影响 12 个邻居；其起始中心限制在目标节点中心两个最大节点对角线范围内。不全图重排；锁定、隐藏节点不动。
- 手势从起始快照求解；Esc、无解回退和撤销均恢复整组。历史最多 50 条；只保存已提交布局，不保存中间帧。
- 缩放 < 0.45 隐藏普通标签；选中/悬停标签至少 11 个屏幕像素；长标题最多两行，完整内容保留于详情。
- 使用真实节点测量；图片、公共产品组件、App Dart 与原生宿主不改。保留当前截图与不缩放 iframe 的实时预览。
- 当前56页及100节点/150边合成图验收；参考设备记录拖动反馈 p95，目标 ≤50ms。超预算保持上个合法预览，不能提交非法布局。
- 不实现组件详情、RPC、自动采集、多选拖动或云同步。设计示意只作参考，不直接复制为正式实现。
- 保留已有未提交内容；本计划不授权提交、推送或发布。各任务结束保存可审核 diff，不执行技能模板中的自动 commit。

## Review Focus

1. 新采集在拖动中到达：取消旧手势、先恢复其起始状态，再按 ID 合并新目录，不能提交已删除节点（任务4）。
2. 不同 viewport/同名应用及多窗口：layoutKey 隔离；外部写入只提示，不能抢占拖动或覆盖未知版本数据（任务2）。
3. 锁定的已删除节点重新出现且原位置被占：保留锁定坐标，进入待定位列表，不能自动移动它或占位者（任务3）。
4. 长标题/异形截图/测量延迟：使用实际尺寸；尺寸变化提示冲突，不后台推挤；标签不得压住页面（任务3、5）。
5. 输入框、iframe 与高频键盘操作：不截获业务输入；键盘位移与指针位移共用约束，取消/撤销语义一致（任务4、6）。

## 文件组织与公共类型

路径均相对独立工程，外部宿主路径另行完整注明。

| 文件 | 职责 |
| --- | --- |
| `packages/viewer/src/canvas/types.ts`、`geometry.ts` | 几何、布局及求解结果类型与基础关系 |
| `packages/viewer/src/canvas/solve-drag.ts` | 有限局部碰撞求解 |
| `packages/viewer/src/canvas/layout-state.ts`、`layout-storage.ts` | 提交/历史与持久化 |
| `packages/viewer/src/canvas/arrange.ts`、`reconcile.ts` | 首次/显式排列及采集目录合并 |
| `packages/viewer/src/canvas/route-edges.ts`、`place-labels.ts` | 障碍路径与标签候选选择 |
| `packages/viewer/src/canvas/useCanvasController.ts` | React Flow 事件协调、测量与帧预算 |
| `packages/viewer/src/canvas/AtlasEdge.tsx`、`EdgeLabels.tsx`、`CanvasToolbar.tsx` | 路径、标签层与布局操作 UI |
| `packages/viewer/src/AppMap.tsx`、`app-map.css` | 接入协调器，保留页面/关系详情及实时预览 |
| `tests/canvas/*.test.ts`、`tests/canvas/*.test.tsx` | 纯函数与组件行为测试 |
| `tests/browser/canvas.spec.ts`、`tests/browser/fixtures/` | 专用确定性页面与密集图浏览器验收 |
| `vitest.config.ts`、`playwright.config.ts`、`package.json` | 分离现有 Node 采集测试与新增画布测试命令 |

在 `types.ts` 定义下列接口，后续任务不得各自重定义：

```ts
type Point = {x:number; y:number};
type Size = {width:number; height:number};
type Viewport = Point & {zoom:number};
type Placement = Point & {locked:boolean};
type LayoutDocument = {schemaVersion:1; nodes:Record<string,Placement>; viewport:Viewport};
type LayoutHistory = {present:LayoutDocument; past:LayoutDocument[]; future:LayoutDocument[]};
type CanvasNode = Placement & Size & {id:string; hidden:boolean};
type SolveResult = {ok:true; nodes:CanvasNode[]; affectedIds:string[]} |
  {ok:false; reason:'locked'|'no-space'|'budget'; nodes:CanvasNode[]};
type ReconcileResult = {document:LayoutDocument; pendingIds:string[]; conflictIds:string[]};
type EdgeSpec = {id:string; source:string; target:string; action:string};
type RoutedEdge = {id:string; points:Point[]; status:'routed'|'unroutable'};
type LabelSpec = {id:string; size:Size; priority:number};
type LabelPlacement = {id:string; center:Point; mode:'full'|'count'|'hidden'};
```

`CanvasNode` 是当前有效目录的测量结果；历史文档可含已删除 ID。类型均导出。框架实例、DOM 元素和捕获时间不进入 LayoutDocument。

## 任务1：可独立验证的局部求解器

**Files:** 新建 `types.ts`、`geometry.ts`、`solve-drag.ts`、`tests/canvas/solve-drag.test.ts`、`vitest.config.ts`；修改 `package.json`。

**Interfaces:** `solveDrag(start:CanvasNode[], draggedId:string, target:Point):SolveResult`；`hasSpacingConflict(a:CanvasNode,b:CanvasNode):boolean`。矩形边界接触允许；安全间距内部相交才算冲突。函数不修改输入。

- [ ] 写失败测试：宽224高528的 A@(0,0)、B@(500,0)、C@(3000,0)，A 目标@(300,0)；断言成功、B.x≥620、C 原位、输入深相等、affectedIds 仅 B。锁定 B 后断言 B 原位且 A 找到合法候选或整次失败，绝不重叠。
- [ ] 补边界测试：隐藏节点视作固定、超过12邻居/范围失败、重复相同输入结果相同、反向拖回起点无累计漂移、负坐标、有限数值验证。无解返回原快照。
- [ ] 运行 `pnpm exec vitest run tests/canvas/solve-drag.test.ts`，先记录失败原因。
- [ ] 实现四向最小平移候选、按拖动方向优先及总位移排序、ID稳定平局；从原快照做有界分支搜索，最多512候选、128传播迭代。锁定障碍先尝试最近合法停放点；最终整体校验。不使用持续物理模拟。
- [ ] 配置 `test:canvas` 为 `vitest run`，include 仅 `tests/canvas/**/*.test.{ts,tsx}`，保留现有 Node 测试命令；运行本任务测试、类型检查，确认通过。

## 任务2：提交、撤销和布局存储

**Files:** 新建 `layout-state.ts`、`layout-storage.ts`、`tests/canvas/layout-state.test.ts`、`tests/canvas/layout-storage.test.ts`。

**Interfaces:** `commitLayout(history:LayoutHistory,next:LayoutDocument):LayoutHistory`、`undoLayout(history):LayoutHistory`、`redoLayout(history):LayoutHistory`；`readLayout(storage:Storage,key:string):{document:LayoutDocument|null; issue:string|null; writable:boolean}`、`writeLayout(storage:Storage,key:string,document:LayoutDocument):{ok:boolean; issue:string|null}`。存储键前缀 `flutter-ui-atlas:layout:v1:`；缺 key 不调用存储。

- [ ] 写失败测试：一次提交同时移动A/B，一次撤销两者恢复；第51次提交后 past.length 为50；新提交清空 future；无变化不占历史。
- [ ] 写存储失败测试：两个key不串写；坏JSON/未知schema/非有限坐标不加载且禁止自动覆盖；getItem/setItem抛错返回明确issue；重新加载恢复locked与viewport但不恢复history。
- [ ] 运行两个测试文件确认 RED，再实现上述纯状态与存储函数；错误文案必须可用于“布局未保存”的可见提示。
- [ ] 运行两个测试文件与类型检查确认通过。storage 事件的跨窗口交互在任务4接入，不能在存储模块自动替换内存状态。

## 任务3：初次排列与采集目录合并

**Files:** 新建 `arrange.ts`、`reconcile.ts`、`tests/canvas/arrange.test.ts`、`tests/canvas/reconcile.test.ts`。

**Interfaces:** `arrangeNodes(nodes:CanvasNode[],edges:EdgeSpec[],movableIds:Set<string>):SolveResult`；`reconcileLayout(document:LayoutDocument|null,nodes:CanvasNode[],edges:EdgeSpec[]):ReconcileResult`。

- [ ] 写测试：环图、分叉图与不连通图初排无重叠，间距160/120、子图≥240；只整理movableIds，隐藏/锁定/其他ID坐标逐项不变；无解回退。
- [ ] 写目录合并测试：刷新captureId但screen.id不变时坐标和locked不变；新增邻居有空位且旧页不动；删除记录保留；已锁定节点回归冲突时pendingIds包含它且原坐标未改；尺寸增大只返回conflictIds、不推挤其他页。
- [ ] 运行测试记录 RED；实现强连通分量收缩、分层起点与最近空位搜索。显式整理为一次候选结果，不能在函数中写localStorage；搜寻最多2048候选，预算耗尽返回旧文档/明确冲突。
- [ ] 运行测试及类型检查。确认筛选不会调用初排或合并，只有目录/测量改变才进入对应路径。

## 任务4：自由画布交互与宿主稳定标识

**Files:** 新建 `useCanvasController.ts`、`CanvasToolbar.tsx`、`tests/canvas/controller.test.tsx`；修改 `AppMap.tsx`、`app-map.css`、`src/main.tsx`；修改外部 `/Users/kimi/projects/zhiwo_learning/tools/dev-workbench/frontend/src/features/app-map/AppMap.tsx`。

**Interfaces:** 扩展 `AtlasViewerAdapter.layoutKey?:string`。`useCanvasController({map,layoutKey,visibleIds})` 返回 `{nodes,viewport,pendingIds,conflictIds,issue,canUndo,canRedo,onDragStart,onDrag,onDragStop,cancelDrag,moveByKeyboard,toggleLock,undo,redo,arrangeVisible,loadExternalLayout,onViewportCommit,onMeasured}`。事件参数在本文件类型化，所有位置变化调用前述纯函数。

- [ ] 写组件失败测试：拖动预览不写存储，松手只提交一条历史；Esc/无解恢复整个起始快照；锁定不能拖动；过滤不变坐标或镜头；拖动中目录更新取消旧手势再合并。
- [ ] 写交互测试：外部storage事件只提示，可选择载入；坏/未知布局禁止自动覆盖；input/textarea/contenteditable/iframe焦点不触发画布快捷键；键盘按方向移动10画布单位并共用求解器。
- [ ] 运行组件测试确认 RED。使用jsdom、实际React协调器和最小ResizeObserver环境替身，避免mock求解器/历史模块。
- [ ] 接入React Flow受控节点：去掉按筛选数组下标放置及过滤时setViewport；去掉captureId引起的整棵画布重挂载；稳定ID管理当前节点与保存记录。测量由React Flow尺寸变化传入，拖动以requestAnimationFrame合并，每次从start求解。
- [ ] 实现锁定、撤销/重做、可见未锁定整理影响数量提示、隐藏障碍占位框、pending列表和存储告警；自定义节点快捷键避免React Flow默认移动绕过求解器；锁定仍可选中和看实时预览。
- [ ] 示例key使用 `atlas-example:phone-393x852:v1`，寓科key使用 `zhiwo-demo:phone-393x852:v1`；仅宿主写业务标识。视口变化保存按提交/结束事件，不持续写盘。
- [ ] 运行组件测试、全部canvas测试及类型检查。颜色/字号采用Spec；节点外壳稳定且测量真实，不能改截图内UI或缩放实时iframe。减少动态效果时取消邻居过渡。

## 任务5：绕障路径与独立标签层

**Files:** 新建 `route-edges.ts`、`place-labels.ts`、`AtlasEdge.tsx`、`EdgeLabels.tsx`、对应 `tests/canvas/route-edges.test.ts`、`place-labels.test.ts`；修改 `AppMap.tsx`、`app-map.css`。

**Interfaces:** `routeEdges(nodes:CanvasNode[],edges:EdgeSpec[],previous:RoutedEdge[],changedIds:Set<string>):RoutedEdge[]`；`placeLabels(routes:RoutedEdge[],nodes:CanvasNode[],labels:LabelSpec[],zoom:number,focusedIds:Set<string>):LabelPlacement[]`。LabelSpec.size 是经字体布局实测后换算的画布尺寸，标签框也必须避障。

- [ ] 写路径失败测试：A→C中间B阻挡，所有中间线段不进入B外扩16矩形；平行/反向/自环不重合为同一通道；移动无关节点不改远处路径；超预算返回unroutable，不生成穿页fallback，不改业务验证状态。
- [ ] 写标签失败测试：全量标签框互不覆盖且不交页面；优先选中关系；zoom=.2普通标签hidden，focused保持可访问；zoom=.65/1恢复；长中文两行外省略但详情完整；无完整空位返回count。
- [ ] 运行测试确认 RED；使用四向可见网格+A*搜索，候选坐标来自端口与障碍边界，单边最多4096搜索状态。成本为长度+转弯24+重叠通道48+偏离旧路径12，ID稳定排序；这些为计划初值，可据实测调优。
- [ ] 只失效关联边及旧路径与移动节点新旧障碍相交的边；每帧时间预算耗尽保留旧的合法候选，若旧路径已穿新障碍则暂时收起并显示关系计数，不能继续画穿页路径。
- [ ] SVG仅绘线/箭头；HTML标签层单独置顶、白色实底，screen字号≥11，候选优先长水平线段。标签点击选择关系，详情保留source/target/action/status；无合法路径/标签仍有计数入口和完整关系列表。
- [ ] 运行本任务与所有canvas测试、类型检查和构建；绘制遮挡由下一任务真实浏览器复验，不以几何单测替代。

## 任务6：真实浏览器回归、性能与交付

**Files:** 新建 `playwright.config.ts`、`tests/browser/canvas.spec.ts`、`tests/browser/fixtures/canvas.html`、`canvas.tsx`、`graphs.ts`；修改 `package.json`、`examples/verify-viewer.mjs`、`README.md`；新增 `docs/自由画布验证记录.md`。按实际影响更新寓科 `scripts/verify-app-map.mjs`，保留原有有效断言，不按新行为静默弱化。

**Interfaces:** 专用fixture只注入公开 AtlasViewerAdapter，使用确定性8节点碰撞图和100节点/150边密集图；不调用内部求解器替代用户事件。测试服务用127.0.0.1:60202、strictPort，启动前查占用；不停止其他项目服务。

- [ ] 配置 `test:browser`；`test` 依次执行既有Node采集测试及Vitest画布测试。真实浏览器测试保留为独立命令，避免单测自动启动App。
- [ ] 用实际鼠标拖动测试局部避让、锁定、隐藏障碍、无解回退、Esc、一次撤销整组；断言所有未受影响节点坐标完全不变，锁定不动，提交后不重叠。
- [ ] 验证刷新、filter往返、viewport隔离、同key多标签通知、存储异常；截图变更和新目录到达不洗牌。验证input撤销及iframe正常操作，不被画布抢快捷键。
- [ ] 在0.2/0.65/1缩放与1100/1600宽度检查线段、标签及页面实际包围盒；检查标签中心命中元素属于标签层、实色背景且不交页面。保存代表截图并人工审视，不只验证DOM存在。
- [ ] 记录参考机器、浏览器版本、100/150图的实际指针到反馈p95和求解预算降级次数，目标≤50ms。主线程阻塞超过目标时先优化失效范围/候选缓存，必要时以Worker为一次独立调整重新验收，不降低锁定与碰撞约束。
- [ ] 在独立示例及寓科当前56页分别真实验证；沿用现有采集结果，除非截图/适配器变化，不因画布改动重跑56页采集或Flutter构建。
- [ ] 集中执行 `pnpm test`、`pnpm type-check`、`pnpm build`、`pnpm test:browser`；外部工作台执行type-check、受影响测试及build，并在内置浏览器检查用户使用的实际URL。
- [ ] 记录全部失败并修复，再复跑失败项及相关回归；所有必要检查为绿后更新文档，区分正式画布验证和早期示意。无需无关Go/Flutter/原生全量测试。
- [ ] 最终独立审阅接口一致性、局部边界、持久化、标签降级和未修改产品组件；保存diff和验证证据，未经另行要求不提交、不发布。

## 自检与执行交接

- Spec第3–5节分别由任务1–4覆盖，第6节由任务5覆盖，第7–8节由任务6验收；任务3覆盖新增/删除/锁定恢复，任务2/4覆盖存储与多窗口。
- Review Focus五项已各自纳入所属任务的断言；失败采集保留上一批结果的现有9项测试继续运行，不绕过。
- 类型/函数名在后续任务沿用本计划定义。所有预算常量允许据实测调优，但不能突破最多12邻居、锁定不动、禁止拖动触发全图重排等交互契约。
- 推荐同一会话原生执行：本计划模块共享几何和状态接口，连续实施更易保持契约一致；完成后独立审阅整体。也可选择逐任务实施与独立审阅的子代理流程。
- 状态：2026-11-09 用户确认后已完成正式实施及独立审阅修复；实际覆盖、实现裁决和证据以 `docs/自由画布验证记录.md` 为准。未提交、未发布。

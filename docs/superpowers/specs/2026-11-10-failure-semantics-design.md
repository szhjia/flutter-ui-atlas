# Spec: failure-semantics · 失败路径统一语义

**模块**：`failure-semantics`（能力地图第 1 项，来源评审 P0-1、P1-4、P1-5、P1-7）
**状态**：待人工审批
**日期**：2026-11-10

## Objective

**根因**：四个失败点各自为政——有的丢掉上一个好状态，有的把诊断信息清零，有的直接崩溃。本模块建立一个统一语义并落到四处：

> **失败不降级**：任何「本应得到好状态」的操作失败时，若此前存在好状态则必须保留它并叠加可行动诊断；只有从未有过好状态才进入错误态。诊断必须中文、含原因首行、含下一步动作（重试 / 恢复出口 / 报告路径）。

四个落点（均为已复核成立）：

| 评审项 | 位置 | 现状违背 |
|---|---|---|
| P0-1 刷新失败丢画布 | `packages/viewer/src/AppMap.tsx:249-272` | `pending.then` 无条件整体 `setSnapshot`，失败快照 `map:null` 直接覆盖好状态，跌入错误屏 |
| P1-4 布局损坏无恢复 | `packages/viewer/src/canvas/layout-storage.ts:4-14`、`useCanvasController.ts:14,27,48` | 校验全有全无；`writable:false` 后写死锁，三条路径只能提示，无清除/恢复动作 |
| P1-5 入口白屏 | `src/main.tsx:4-13` | 顶层 `JSON.parse(#atlas-config)` 无防护，非法配置即未捕获异常白屏 |
| P1-7 失败归档空 | `packages/capture/discovery.mjs:147-151,245-259` | 失败点都发生在 `:245` 填充之前，归档 manifest 的 screens/edges 恒空、`failedScreens/failedEdges` 硬编码 0 |

**用户**：本工具的维护者与接入方开发者（画布使用者的瞬时故障体验；排查采集失败的工程师的可诊断性）。

## Tech Stack

现有栈，零新增依赖：React 19 + @xyflow/react 12、TypeScript strict、vitest + jsdom + @testing-library/react（组件级，devDeps 已备）、node --test（capture 侧纯函数）、Playwright（浏览器套件）、pnpm。

## Commands

```sh
rtk proxy pnpm type-check     # 类型检查
rtk proxy pnpm test           # build + node --test + vitest 全量
rtk proxy pnpm test:canvas    # 仅画布（vitest）
rtk proxy pnpm build          # Viewer 构建
rtk proxy pnpm test:browser   # 浏览器套件（模块收尾必跑一次）
```

## Project Structure

```
packages/viewer/src/AppMap.tsx                 # P0-1：快照合并语义
packages/viewer/src/config.ts                  # P0-1 辅助（如需 merge helper）
packages/viewer/src/canvas/layout-storage.ts   # P1-4：discardLayout + 恢复语义
packages/viewer/src/canvas/useCanvasController.ts # P1-4：恢复动作出口
src/main.tsx                                   # P1-5：容错入口
src/entry-config.ts                            # P1-5 新增：可测的配置解析
packages/capture/discovery.mjs                 # P1-7：失败归档填充
tests/canvas/app-map.test.tsx                  # 新增：P0-1 组件测试
tests/canvas/layout-storage.test.ts            # 扩展：P1-4
tests/entry-config.test.ts（或并入现有 vitest include） # 新增：P1-5
discovery 归档断言                             # 并入现有 node --test / browser spec
docs/协议与适配接口.md                          # 新增「失败语义」小节
```

注意：`vitest.config.ts` 的 include 目前仅 `tests/canvas/**`；P1-5 的测试文件放 `tests/canvas/` 内或扩 include，在 Plan 阶段定。

## Code Style

现有库内是单行密排风格；**本模块新写与改动的行遵循：行宽 ≤120、失败分支必须具名**（不内联在三元链里）。不顺手重排既有密排——那是 `canvas-core-maint` 模块的事。本模块的语义样板：

```ts
// 失败不降级：保留上一个好状态，叠加诊断
void pending.then(snapshot => {
  if (request !== revision.current) return;
  setSnapshot(previous => snapshot.map
    ? snapshot
    : {...previous, error: snapshot.error || '读取采集结果失败'});
});
```

错误文案格式统一为：`<发生了什么>。<下一步动作>`（如「布局数据损坏，当前使用自动整理布局。可丢弃损坏数据以恢复保存。」）。

## Testing Strategy

TDD，每处先红后绿：

- **P0-1**：`@testing-library/react` 组件测试。场景 A：首次加载成功 → 第二次 `loadManifest` reject → 断言旧页面卡片仍在文档中、出现 `role="alert"` 且含错误首行、提示带「当前显示上一次成功结果」语义；场景 B：首次即失败（无旧状态）→ 错误屏 + 重新加载按钮（锚定现状）。
- **P1-4**：`layout-storage.test.ts` 扩展——损坏文档 → `writable:false` 且 `discardLayout` 后恢复可写、原数据在丢弃前不被覆盖；controller 层断言 issue 文案含恢复动作入口。
- **P1-5**：`src/entry-config.ts` 纯函数单测（合法/空/非法 JSON 三态）；jsdom 渲染断言非法配置显示中文错误与 captureHint，不抛未捕获异常。
- **P1-7**：归档统计抽纯函数（node --test 直测：失败批次 `failedScreens` = declared 中 `status!=='captured'` 数）；浏览器 spec 捎带断言失败归档的 attempt.json 计数与 manifest 节点状态。

覆盖期望：四个修复点各有锚定用例；全量 `type-check` / `test` / `build` 不回归；模块收尾 `test:browser` 通过。

## Boundaries

- **Always**：TDD 先红后绿；失败保留旧状态；诊断中文可行动；每任务完成跑 `rtk proxy pnpm test`。
- **Ask first**：`docs/协议与适配接口.md` 新增小节（spec 批准即授权方向，写入时展示完整 diff）；localStorage 键名或 `LayoutDocument` schema 变更（本模块预期不碰）。
- **Never**：不改 `manifest.json`/`attempt.json` 既有字段的兼容性（只把恒 0 的计数改成真实值、填充已有数组字段）；不动 `zoom` 字面量重复（属 `canvas-core-maint` 的常量收敛，本模块不引常量模块）；不碰输出目录互斥（属 `output-locking`）；不提交、不推送。

## Success Criteria

1. 刷新加载失败时旧画布保留且叠加错误提示（组件测试断言，含「当前显示上一次成功结果」语义文案）；首次失败仍为错误屏 + 重试。
2. 布局损坏时会话以整理布局继续工作，提示提供「丢弃损坏布局」恢复出口；执行后 localStorage 对应键清除、保存恢复；丢弃前原数据不被自动覆盖。
3. `#atlas-config` 内非法 JSON 渲染中文错误提示与 captureHint，不白屏；空标签行为不变（默认配置）。
4. discovery 失败批次的归档：attempt.json 的 `failedScreens`/`failedEdges` 为真实统计，批内 manifest.json 的 screens 含各节点最终 `status`/`error`；成功路径产物不变。
5. `docs/协议与适配接口.md` 新增「失败语义」小节，成文覆盖上述约定。
6. `rtk proxy pnpm type-check`、`test`、`build` 全绿；`test:browser` 通过。

## Open Questions

1. **P1-4 恢复出口形态**：显式「丢弃损坏布局」按钮（保守，用户主动）vs 自动降级（静默丢弃非法字段）？——本 spec 按「显式按钮 + 提示指引」设计；如你倾向自动降级请指出。
2. **P1-5 错误呈现**：复用 `map-empty` 错误屏样式类、独立轻量渲染（不经过 AppMap 加载流程）？——spec 按后者设计。
3. **P1-7 failedEdges 口径**：discovery 的 edges 来自录制而非声明，失败批次建议保持已观察 edges 原样归档、`failedEdges` 取「已捕获节点间未能验证的关系数」（多数场景为 0）——口径在 Plan 阶段细化，spec 层接受此默认。

## Assumptions

1. 协议文档新增小节符合工程「先维护协议」约定，属本模块交付物之一。
2. `failedScreens` 等字段已存在于 attempt schema，本模块只改取值语义，不算 schema 变更。
3. 组件级测试所需依赖已齐（@testing-library/react、jsdom 在 devDeps），不新增。
4. `src/entry-config.ts` 是 vite 入口的平凡抽取，不影响构建产物结构。

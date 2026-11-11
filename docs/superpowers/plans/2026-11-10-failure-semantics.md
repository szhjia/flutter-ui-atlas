# 实施计划：failure-semantics · 失败路径统一语义

**日期**：2026-11-10　**Spec**：`docs/superpowers/specs/2026-11-10-failure-semantics-design.md`（已批准，含三项默认倾向）
**台账**：`.superpowers/sdd/2026-11-10-failure-semantics/progress.md`（任务 1 开工时创建，逐任务记录 RED→GREEN 与裁决）
**执行约定**：每任务 TDD（先红后绿）、完成即跑 `rtk proxy pnpm test`；新写/改动行宽 ≤120、失败分支具名；不提交（AGENTS.md）。

## 任务顺序与依赖

```
任务1 (P0-1 刷新保留旧画布) → 任务2 (P1-4 布局恢复出口)   # 共用 AppMap 通知区，串行
任务3 (P1-5 入口容错)        # 独立
任务4 (P1-7 失败归档)        # 独立（capture 侧）
任务5 (协议文档 + 收尾验证)  # 最后
```

## 任务 1：刷新失败保留旧画布（P0-1）

- **做法**：`AppMap.tsx` 的 `load()` 合并语义——失败快照（`map:null`）到达且 `previous.map` 存在时，保留 `previous.map`、合并 `snapshot.attempt ?? previous.attempt` 与错误信息；`map` 存在则原样替换。`MapCanvas` 顶部在 `error && map` 时渲染 `role="alert"` 通知：`读取采集结果失败：<首行>。当前显示上一次成功结果。`（复用 `atlas-notice` 样式类与 AttemptNotice 的文案节奏）。
- **Acceptance**：组件测试两场景通过——A) 首载成功 → 二次 `loadManifest` reject → 旧页面卡片仍在、出现含「当前显示上一次成功结果」的 alert；B) 首载即失败 → 错误屏 + 重新加载按钮（锚定现状防回归）。
- **Verify**：`rtk proxy pnpm test:canvas`（新增 `tests/canvas/app-map.test.tsx`）+ 全量 `rtk proxy pnpm test`。
- **Files**：`packages/viewer/src/AppMap.tsx`、`tests/canvas/app-map.test.tsx`（新增，含最小 manifest fixture 与 adapter mock）。
- **风险与对策**：ReactFlow 在 jsdom 需要 `ResizeObserver` stub——测试文件顶部统一 stub；若整树渲染不稳，降级为「合并逻辑纯函数测试 + 浏览器 spec 断言」双保险（在台账记录裁决）。

## 任务 2：布局损坏恢复出口（P1-4）

- **做法**：`layout-storage.ts` 的 `readLayout` 返回增加 `corrupted:boolean`（有数据但不可读/无效，区别于存储本身不可用）；新增 `discardLayout(storage,key)`（`removeItem`，仅在用户点击后执行，丢弃前原数据不动）。`useCanvasController` 暴露 `corrupted` 与 `discardCorruptedLayout()`：丢弃后重读、以 reconcile 默认布局安装并恢复保存。`AppMap.tsx:176` 通知区在 `corrupted` 时追加按钮「丢弃损坏布局」。
- **Acceptance**：损坏文档 → `writable:false` + `corrupted:true`，issue 文案含指引；点击丢弃后键清除、后续 `writeLayout` 成功；丢弃前原损坏数据未被自动覆盖；存储不可用（非损坏）时不出现丢弃按钮。
- **Verify**：`tests/canvas/layout-storage.test.ts` 扩展 + controller 级用例（沿用现有 hook 测试形态）。
- **Files**：`packages/viewer/src/canvas/layout-storage.ts`、`useCanvasController.ts`、`AppMap.tsx`、`tests/canvas/layout-storage.test.ts`（+`tests/canvas/controller.test.tsx` 扩展）。

## 任务 3：入口容错（P1-5）

- **做法**：新增 `src/entry-config.ts`——`parseEntryConfig(text)` 三态（合法→config；空→默认 config；非法→`{config:null,error:'画布配置解析失败…'}`），默认配置逻辑原样迁入。`src/main.tsx` 据此分流：错误时渲染独立轻量错误视图（`role="alert"`、中文、含「检查 #atlas-config」指引，不依赖 AppMap 加载流程与外部 CSS）；空标签行为不变。
- **Acceptance**：非法 JSON → 页面渲染中文错误提示，无未捕获异常；空标签 → 默认配置照常；合法 JSON → 正常画布。
- **Verify**：`parseEntryConfig` 纯函数单测（三态）；jsdom 下加载 `main.tsx`（预置 `#atlas-config` 非法内容 + `#root`）断言错误渲染。
- **Files**：`src/entry-config.ts`（新增）、`src/main.tsx`、`vitest.config.ts`（include 增 `tests/entry/**`）、`tests/entry/entry-config.test.ts`（新增）。
- **风险与对策**：`main.tsx` 顶层副作用（import 即渲染）——测试用动态 import + `vi.resetModules()` 隔离；若 jsdom 环境项缺失则补 `environment` 配置。

## 任务 4：discovery 失败归档（P1-7）

- **做法**：`discovery.mjs` 的 `runBatch` 把 `nodes`/`edges`/`result` 声明提升到 try 之外（成功路径语义不变）；抽出纯函数 `finalizeArchive({result,nodes,edges,failed})`——失败时以 `[...nodes.values()]` 填充 `result.screens`、`[...edges.values()]` 填充 `result.edges`，`failedScreens`/`failedEdges` 一律从归档数组计算（`status!=='captured'` / `status!=='observed'`），不再硬编码 0；成功路径走同一函数（结果等价）。
- **Acceptance**：任一失败点（open 抛错、requireCapture、runtimeErrors、指纹变化）归档的批内 manifest 含各节点最终 `status`/`error`，attempt 计数为真实统计；成功路径产物逐字节等价（除时间戳）。
- **Verify**：新增根目录 `discovery-archive.test.mjs`（node --test 直测纯函数：失败/成功两态）；`tests/browser/discovery.spec.ts` 失败场景补断言 attempt.json 计数与 manifest.screens 非空。
- **Files**：`packages/capture/discovery.mjs`、`discovery-archive.test.mjs`（新增）、`tests/browser/discovery.spec.ts`。

## 任务 5：协议文档 + 收尾验证

- **做法**：`docs/协议与适配接口.md` 新增「失败语义」小节——统一约定（失败不降级、诊断可行动）+ 四个落点的具体行为；写 `docs/失败语义验证记录.md`（验证证据：命令输出、测试计数）与 sdd 台账终审记录。
- **Acceptance**：协议小节成文并覆盖四点；验证记录含全量命令结果。
- **Verify**：`rtk proxy pnpm type-check && rtk proxy pnpm test && rtk proxy pnpm build && rtk proxy pnpm test:browser` 全绿。
- **Files**：`docs/协议与适配接口.md`、`docs/失败语义验证记录.md`（新增）、`.superpowers/sdd/2026-11-10-failure-semantics/progress.md`。

## 验证关卡

| 关卡 | 命令 | 时机 |
|---|---|---|
| 任务级 | `rtk proxy pnpm test`（含新增用例） | 每任务 GREEN 后 |
| 模块级 | `rtk proxy pnpm type-check`、`test`、`build` | 任务 5 |
| 浏览器 | `rtk proxy pnpm test:browser` | 任务 5（真实浏览器验收，静态检查不冒充） |

## 边界重申（对齐 spec）

不碰 zoom 字面量统一（canvas-core-maint）、不碰输出互斥（output-locking）、不改 manifest/attempt 字段兼容性、不顺手重排既有密排。

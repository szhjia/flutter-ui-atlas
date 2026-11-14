# Atlas Account Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Track steps below; project instructions override TDD/commit/worktree defaults.

**Goal:** 实现已批准的 B 方案，独立账户画布、可复用成功采集版本与可诊断安装。
**Architecture:** CLI 维护稳定应用身份及原子 v2 索引；账户/profile revision 引用不可变采集资源。Viewer 从索引或旧 manifest 派生单账户控制器。缓存私有，证据时间不可伪造。
**Tech Stack:** Node 26.12.1、pnpm 10.33.0、Playwright/Chrome、React/React Flow。
**Spec:** docs/superpowers/specs/2026-11-13-account-workspace-design.md

## Global Constraints

- 保留当前所有未提交修改，不创建脱离这些修改的 worktree，不 commit/push/publish。
- 后端先实现、再单元/集成测试、最后集中验证及批量修复。
- 外部文案英文；.atlas 私有；不启动接入方 Flutter；Chrome channel；桌面 Viewer。
- 性能100页150边反馈p95≤50ms；真实浏览器和独立安装采集不可省略。

## Review Focus

- 缓存引用损坏必须重采，不能只比较键（任务2）。
- 公共登录证据不可泄漏另一账户关系或凭据（任务2/3）。
- 配置/源码采集中改变与多profile失败不能发布混合版本（任务2）。
- 同名账户、切换中迟到实时会话不能串空间（任务3）。
- 独立包不能借用仓库node_modules，缺浏览器应明确诊断（任务5/6）。

### Task 1: 协议与输入
**Files:** packages/cli/build-input.mjs (new), packages/cli/application-identity.mjs (new), packages/cli/project-catalog.mjs, packages/capture/index.mjs, packages/capture/adapter.ts, packages/viewer/src/model.ts; tests/build-input.test.mjs (new).
**Interfaces:** ensureApplicationIdentity(directory) → applicationId; fingerprintSources(config,directory) → {digest,files,reusable,reasons}; workspaceCatalog(catalog,accountId) → {screens,edges}; pageName?:string 贯穿协议。
- [x] 实现身份、规范化输入与默认源码范围/显式目录/依赖覆盖。
- [x] 实现pageName验证和透传；更新协议文档。
- [x] 添加无Git、dirty/untracked、目录变更、路径/链接、语义稳定性测试。

### Task 2: 账户版本与原子缓存
**Files:** packages/cli/workspace-build.mjs (new), packages/cli/managed-workflow.mjs, packages/cli/config-store.mjs, packages/cli/project-runtime.mjs, packages/cli/index.mjs, packages/cli/view-server.mjs; tests/workspace-build.test.mjs (new), tests/standard-workflow.test.mjs.
**Interfaces:** buildWorkspaces(input,profiles,launchBrowser,{force}) → exitCode; readWorkspaceManifest(output,profileName) → manifest|null; index schemaVersion2含applicationId/accounts/profiles，每profile含account revision引用；每revision保留captureId/capturedAt/screens/edges。
- [x] 实现应用级锁、账户依赖键、公共资源复用、不可变revision和原子索引提交。
- [x] CLI接入force，Viewer服务器按profile加载索引并提供兼容manifest；失败报告独立。
- [x] 实时会话使用对应revision与账户依赖版本，拒绝过期、清理资源。
- [x] 添加零浏览器命中、force、改名、凭据局部失效、损坏、并发、批次失败和发布前变更测试。

### Task 3: 单账户画布
**Files:** packages/viewer/src/workspaces.ts (new), packages/viewer/src/AppMap.tsx, model.ts, canvas/layout-storage.ts; tests/canvas/workspaces.test.ts (new), tests/canvas/app-map.test.tsx, tests/canvas/managed-live.test.tsx.
**Interfaces:** accountWorkspaces(manifest) → [{id,name,map}]; WorkspaceMap组件以稳定应用/账户/profile key挂载。
- [x] v2与v1分组、匿名闭包、稳定ID和默认账户恢复。
- [x] controller只接收当前子图，筛选统计详情布局全局改成空间作用域。
- [x] 账户切换卸载会话/请求，旧布局保留但不混用；同名账户可区分。
- [x] 添加空间隔离与迟到请求测试。

### Task 4: 卡片与连线
**Files:** packages/viewer/src/AppMap.tsx, app-map.css, canvas/route-edges.ts, canvas/AtlasEdge.tsx; tests/canvas/route-edges.test.ts, tests/browser/canvas.spec.ts, tests/browser/viewer-chrome.spec.ts.
- [x] 卡片名称/route/截图，正常冗余文字移除，异常可见，Handle隐藏。
- [x] 开放箭头、双向与多边稳定偏移、有限端口分散、hover不改变选中。
- [x] 更新交互断言，添加几何分离及长文本、键盘验收。

### Task 5: 安装诊断
**Files:** packages/cli/doctor.mjs (new), index.mjs, managed-browser.mjs, scripts/pack-cli.mjs; tests/doctor.test.mjs (new), tests/pack-cli.test.mjs。
**Interfaces:** diagnose({config,directory,launchBrowser,installationOnly}) → {ok,checks}; CLI atlas doctor [--config]。
- [x] Node/module/assets/browser/URL/输入范围检查，重采预检、纯命中不启动浏览器。
- [x] 英文修复建议、无秘密输出；缺Chrome与应用不可达测试。

### Task 6: 集成、真实验收与交付
**Files:** tests/browser/*, tests/shop-browser/*, README.md, README.zh-CN.md, demo/README.md, .agents/skills/flutter-ui-atlas/SKILL.md; docs/superpowers/specs/2026-11-13-account-workspace-delivery.md (new).
- [x] 完成所有受影响单元/集成测试后，统一format/type-check/Node/Vitest/build；汇总修复后回归。
- [x] 跑真实Chrome项目浏览器测试与100/150性能；普通Demo6页8边验证。
- [x] 打包tarball，在仓库外安装，检查依赖解析不指向仓库；独立Demo init/config/doctor/build/view、复用/force/失败路径。
- [x] 更新英文对外文档及中文交付证据。
- [x] 独立全变更审查，批量修复重要发现，verification-before-completion确认实测结果；保留未验证范围并持续处理。

## 执行记录

用户已明确授权计划并继续实施，不重复请求执行许可。选择本会话执行，最终独立审查。计划无需提交。运行证据与账本保存在 .runtime/account-workspace/；避免提交型技能脚本因当前未提交工作区产生错误范围。任务1至5先完成生产代码和测试，再执行任务6集中验证。

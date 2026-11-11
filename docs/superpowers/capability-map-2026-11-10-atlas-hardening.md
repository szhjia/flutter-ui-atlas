# 能力地图：Atlas 加固（2026-11-10）

**来源**：七切面工程评审（workflow `dwfrun-4cee1053`，2026-11-10）——21 条已复核编号发现 + 附录 A 捎带项。
**治理**：每模块独立走 SDD 四闸门（Specify → Plan → Tasks → Implement），spec 存 `docs/superpowers/specs/`，计划存 `docs/superpowers/plans/`，执行台账存 `.superpowers/sdd/<日期>-<模块>/progress.md`。全程只改与本模块根因相关的内容；不自动提交、不推送、不发布。

## 已批准决定（2026-11-10，用户拍板）

- **构建顺序**：P0 止血优先（failure-semantics、output-locking 先行，eng-base 第三）。
- **dart-sdk-scope**：收缩导出面，只保留 `AtlasNavigatorObserver`，等真实接入方出现再展开。
- **eng-base**：最小集——仅代码风格工具（lint/format，支撑 canvas-core-maint 的格式化）+ P2-8 忽略规则；CI 工作流与覆盖率门槛转 backlog。
- **范围**：21 条编号发现全修；附录 A 其余未复核项仅在所属根因模块内捎带，不单独开模块。

## 模块表

| 模块 id | 责任 · 根因 | 覆盖发现 | 依赖 | 状态 |
|---|---|---|---|---|
| `failure-semantics` | 失败路径无统一「保留上一个好状态 + 可行动诊断」语义 | P0-1 刷新丢画布、P1-4 布局损坏无恢复、P1-5 入口白屏、P1-7 失败归档空 | — | **已完成**（2026-11-10，验证记录 `docs/失败语义验证记录.md`） |
| `output-locking` | 输出目录写互斥模型未定义（持锁者、生命周期、陈旧检测） | P0-2 锁残留阻塞 + 附录A★ capture() 不取锁可并发发布 | — | **已完成**（2026-11-11，验证记录 `docs/输出互斥验证记录.md`） |
| `eng-base` | 验证全靠手工、无风格护栏（最小集） | P1-10（部分：lint/format）、P2-8 忽略规则（捎带：tsconfig 含 tests、playwright 版本钉法、jest-dom 清理） | — | **已完成**（2026-11-11，验证记录 `docs/工程化基座验证记录.md`；捎带三项全部落实） |
| `boundary-consistency` | URL 校验/浏览器启动/路由构造散落多入口，无单一策略出口 | P1-1 回环口径不一、P1-2 Chrome 硬编码、P1-3 pathname 根路径假设 | — | 未开始 |
| `delivery-surface` | 「包对外承诺什么」无单一事实源 | P1-6 exports 缺 config、P1-9 打包双维护 + engines 漂移 | —（冒烟内置在 pack 脚本，不依赖 eng-base） | 未开始 |
| `canvas-core-maint` | 常量无名内联 + 单行密排，有意差异不可见 | P2-1 A* 零覆盖、P2-2 常量收敛、P2-3 格式化 | `eng-base`（format 工具） | 未开始 |
| `dart-sdk-scope` | 预付抽象：三接口零消费者 → 收缩导出面 | P2-5 三接口零消费、P2-6 SDK 测试单薄 | — | 未开始 |
| `docs-examples` | 文档/示例即接口却无事实源、不被验证 | P1-11 HTML/MD 双维护、P2-7 指向不存在目录、P1-8 正则示例脆弱、P2-4 hash 不剥参 | — | 未开始 |

## 构建顺序

```
failure-semantics → output-locking → eng-base → boundary-consistency
                                              → canvas-core-maint（需 eng-base 格式化工具）
                                              → delivery-surface、dart-sdk-scope、docs-examples（随时可插）
```

## Backlog（本轮不做，留档）

- CI 工作流（GitHub Actions：type-check + test + build）
- 覆盖率门槛（vitest coverage provider + 阈值）
- 附录 A 其余 36 条未复核低优先项（评审报告附录 A 全文见评审工件；★ capture 并发项已并入 output-locking）

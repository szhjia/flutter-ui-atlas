# Spec: output-locking · 采集输出写入互斥

**模块**：`output-locking`（能力地图第 2 项，来源评审 P0-2 + 附录A★ 升级项）
**状态**：待人工审批
**日期**：2026-11-10

## Objective

**根因**：输出目录的写互斥模型未定义——谁持锁、锁的生命周期、崩溃后如何判定陈旧，均无约定。两个已核实的事实：

| 评审项 | 位置 | 现状 |
|---|---|---|
| P0-2 崩溃残留锁永久阻塞 | `packages/capture/discovery.mjs:106-117` | mkdir 锁目录作互斥、finally rmdir；SIGKILL/断电后 `.atlas-discovery-lock` 永久残留，后续 `runDiscovery` 一律报「已有写入任务」，无 PID/TTL 陈旧检测，报错不含锁路径，docs/tests 无恢复说明 |
| 附录A★ capture() 不取锁 | `packages/capture/index.mjs:62-189`（已通读核实） | `capture()` 全程无锁：`createBatch` 建时间戳目录后直接采集、`publishBatch` 写 `latest-attempt.json`/`manifest.json`——与 discovery 并发写同一 output 时可能交错发布两个批次的结果 |

**目标语义**：

> 同一 output 目录同一时刻至多一个写入任务（`capture()` 或 `runDiscovery()`）；持锁进程崩溃后，后续任务可判定锁陈旧并自动恢复；无法自动判定时，拒绝并在错误信息中给出锁绝对路径与人工清理指引。

**用户**：以 agent/脚本方式运行采集的工具使用者（正是会被 SIGKILL 的运行方式），以及排查「为什么采集不了」的接入方工程师。

## Tech Stack

现有栈，零新增依赖：Node 内建 `fs/promises`、`process`；测试 node --test（锁行为可完全本地验证）+ 既有 Playwright 浏览器套件回归。

## Commands

```sh
pnpm type-check
pnpm test               # build + node --test + vitest
pnpm test:browser       # 模块收尾必跑（discovery 既有路径不回归）
```

## Project Structure

```
packages/capture/index.mjs       # 新增共享锁：acquireOutputLock/releaseOutputLock（或独立 lock.mjs）
packages/capture/discovery.mjs   # runDiscovery 改用共享锁（替换现 mkdir/rmdir 逻辑）
tests/output-lock.test.mjs       # 新增：锁行为 node --test（占用/陈旧恢复/活锁拒绝/清理指引）
tests/capture.test.mjs 或新增    # capture() 持锁与拒绝路径
tests/browser/discovery.spec.ts  # 回归：正常序列不受影响（如需补断言）
docs/协议与适配接口.md            # 新增「输出目录写入互斥」小节
```

## 锁设计（默认方案）

- **统一锁名** `.atlas-lock`（output 目录内），`capture()` 与 `runDiscovery()` 共用；旧 `.atlas-discovery-lock` 残留无害（代码不再读取），不做迁移。
- **锁内容**：锁目录内写 `meta.json`（`{pid, acquiredAt}`）。获取顺序：mkdir 成功 → 立即写 meta → 开始批次；finally rmdir 释放。
- **陈旧判定**（EEXIST 时读 meta）：
  - `pid` 已不存在（`process.kill(pid, 0)` 抛 ESRCH）→ 视为陈旧：告警后删除锁目录并重试获取一次；
  - 无 meta 或 meta 不可读：以锁目录 mtime 判断——超过宽限时间（默认 60 秒）视为陈旧自动恢复（覆盖 mkdir 后、写 meta 前被杀的窗口），否则按「他人正在获取」拒绝；
  - `pid` 存活 → 一律拒绝，**不强抢**（活进程可能是交互式手动录制，双写风险大于可用性；无 TTL 强抢选项）。
- **拒绝文案**（中文、可行动，含锁绝对路径）：`采集输出目录正被另一个写入任务使用（锁：<绝对路径>，持有进程 PID <pid>）。若该任务已退出，删除该锁目录后重试。`
- **互斥范围**：整个批次（`createBatch` → `publishBatch` 完成）；获取失败立即拒绝（不阻塞等待——手动录制会持锁数分钟）。

## Code Style

与 failure-semantics 相同：新写/改动行宽 ≤120、失败分支具名；锁相关函数导出以便 node --test 直测，不依赖浏览器。

## Testing Strategy

TDD 先红后绿，锁行为全部 node --test 本地可测：

- **占用与释放**：获取成功 → 锁目录与 meta 存在；释放后目录消失；同进程再次获取成功。
- **活锁拒绝**：预置锁（meta.pid = `process.pid`，即自己）→ 第二次获取拒绝，错误含锁绝对路径与「删除该锁目录」指引。
- **陈旧自动恢复**：预置锁 meta.pid 指向不存在的进程（如 0x7fffffff 或探明死 PID）→ 获取成功且带告警日志。
- **空锁目录宽限**：预置无 meta 的锁目录——mtime 新（拒绝）/mtime 旧（自动恢复）。测试用 `utimes` 控制时间。
- **capture() 接入**：预置活锁（本进程 PID）→ `capture()` 拒绝且含锁路径；正常路径既有 `tests/capture.test.mjs` 与浏览器套件回归。
- **discovery 接入**：既有浏览器 spec 序列回归；锁释放在 finally（Ctrl+C 路径）不回归。

## Boundaries

- **Always**：TDD；拒绝与告警文案中文可行动；陈旧恢复打告警日志（含被接管锁的路径与旧 pid）。
- **Ask first**：锁目录名与 meta 格式（本 spec 默认 `.atlas-lock`/`meta.json`）；宽限时间数值（默认 60 秒）。
- **Never**：不改 `publishBatch` 写序与原子性（报告→最近尝试→manifest 的顺序不动，「批内 manifest 非 writeAtomic」是附录 A 另一条，不属本模块）；不做跨设备/网络锁；不碰 viewer；不提交。

## Success Criteria

1. 预置陈旧锁（死 PID 或超宽限的空目录）时，`runDiscovery` 与 `capture()` 均可自动恢复并完成批次（测试断言 + 告警日志）。
2. 预置活锁时两者均拒绝，错误信息包含锁绝对路径、持有 PID 与清理指引（测试断言文案要素）。
3. 正常批次（无锁）行为与产物不变：既有全部测试与浏览器套件通过。
4. SIGINT（Ctrl+C）正常路径仍经 finally 释放锁（现有行为回归）。
5. 协议文档新增「输出目录写入互斥」小节：锁名、互斥范围、陈旧判定与恢复指引成文。
6. `pnpm type-check`、`pnpm test`、`pnpm test:browser` 全绿。

## Open Questions

1. **锁名**：统一为 `.atlas-lock`（默认）还是沿用 `.atlas-discovery-lock` 以保持现场兼容？——默认前者（旧残留无害，名字不再撒谎）。
2. **活锁一律拒绝、无 TTL 强抢**（默认）——接受吗？还是想要超时告警/`--force` 选项（默认不做，YAGNI）？
3. **宽限时间 60 秒**（默认）——手动录制 session 可持锁很久，但那是「有 meta 的活锁」，不受宽限影响；宽限只管无 meta 的空目录窗口。

## Assumptions

1. 附录A★ 的复核结论（capture() 无锁）以代码通读为凭，进入实现后如发现遗漏的锁路径，模块范围随之收窄并记录台账。
2. 单进程内不会同时跑两个批次（CLI 一次一个命令），锁不需要进程内重入计数。
3. 锁只服务本机单用户场景（AGENTS.md：本机开发工具），不做跨用户权限处理。

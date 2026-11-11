# 实施计划：output-locking · 采集输出写入互斥

**日期**：2026-11-11　**Spec**：`docs/superpowers/specs/2026-11-10-output-locking-design.md`（默认倾向生效：`.atlas-lock` 统一锁名、活锁一律拒绝不强抢、空锁宽限 60 秒；用户授权按最佳实践/默认推进，SDD 台账记录）
**台账**：`.superpowers/sdd/2026-11-11-output-locking/progress.md`
**执行约定**：TDD 先红后绿；每任务跑 `pnpm test`；新文件行宽 ≤120；不提交。

## 任务顺序

```
任务1 (lock.mjs 共享锁) → 任务2 (discovery/capture 接入) → 任务3 (协议 + 收尾)
```

## 任务 1：共享锁 `packages/capture/lock.mjs`

- **API**：`acquireOutputLock(output, {warn?, now?})` → `release()`（幂等）；`lockPath(output)` 导出供测试。锁目录 `.atlas-lock`，内写 `meta.json {pid, acquiredAt}`；获取失败按 spec 三分支（pid 死→接管重试一次；无 meta 且 mtime>60s→接管；否则拒绝）。
- **错误文案**：`采集输出目录正被另一个写入任务使用（锁：<绝对路径>，持有进程 PID <pid>）。若该任务已退出，删除该锁目录后重试。`（PID 未知时省略 PID 段）
- **Acceptance/Verify**：`tests/output-lock.test.mjs`（node --test，tmpdir）：获取与释放、活锁拒绝（含路径+PID+指引）、死 PID 自动接管（warn 断言）、空锁目录按 mtime 宽限两态、释放幂等。
- **Files**：`packages/capture/lock.mjs`（新增）、`tests/output-lock.test.mjs`（新增）。

## 任务 2：discovery 与 capture 接入

- **做法**：`runDiscovery` 的 mkdir/rmdir 互斥替换为 `acquireOutputLock`/`release`（finally 释放）；`capture()` 整个批次（`createBatch` → `publishBatch`）包进同一锁的 try/finally。两者共用一把 `.atlas-lock`。
- **Acceptance/Verify**：预置活锁（本进程 PID）时 `runDiscovery` 与 `capture()` 均拒绝且错误含锁路径（node --test 新用例）；既有全部测试 + 浏览器套件回归（discovery.spec 同一 output 连续 6 次 runDiscovery，锁不释放会当场死锁——天然回归网）。
- **Files**：`packages/capture/discovery.mjs`、`packages/capture/index.mjs`、`tests/output-lock.test.mjs`（追加接入用例）。

## 任务 3：协议文档 + 收尾验证

- `docs/协议与适配接口.md` 新增「输出目录写入互斥」小节（锁名、互斥范围、陈旧判定、恢复指引、capture/discovery 共用）。
- `docs/输出互斥验证记录.md` + 台账终审。
- 关卡：`pnpm type-check`、`pnpm test`、`pnpm test:browser` 全绿。

## 风险

- `process.kill(pid, 0)` 的 EPERM（进程存在但属其他用户）必须按「存活」处理，否则误抢活锁。
- 释放用 `rm(recursive, force)`（旧实现 `rmdir` 在锁目录异常残留内容时会抛）；`release()` 幂等防 finally 二次调用。
- capture() 锁范围覆盖浏览器会话（手动/长批次持锁数分钟）——符合 spec「整个批次」语义，浏览器套件串行不受影响。

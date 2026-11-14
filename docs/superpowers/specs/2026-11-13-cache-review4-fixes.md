# 间接 CommonJS 与长期服务认证模块复用修复

按 systematic-debugging，沿用上一轮审查的两个最小复现追踪根因。保留原有未提交改动，不提交、推送或发布。

## 修复与行为边界

- 依赖扫描只对显式 `.mjs` 文件声明完整 ESM 图。`.cjs` 可通过别名加载其他模块，`.js` 还依赖图外的包格式，因此保守标记不完整；不再将间接 CommonJS 的 `const load = require` 判为可复用。
- 认证加载器记录依赖摘要、完整性及操作作用域。不完整依赖图不允许跨作用域复用；新登录测试、同进程中新建 runner 均明确要求重启服务或改用可完整追踪的 `.mjs` 依赖。
- 同一构建快照作为受控作用域，允许该次构建的多页、多账户、多个视口使用同一模块。新 CLI 进程仍能正常采集并读取新的 CommonJS 策略。此方案采用拒绝跨操作复用，不声称隔离执行任意动态模块。
- README 已同步说明限制。

## 验证

新增单元用例覆盖间接 `.cjs` 和 `.js` 中的 require 别名。新增真实配置服务 HTTP API/Chrome 用例：第一次登录通过，修改策略后第二次返回失败并提示重启，浏览器启动次数保持 1；同进程另建 runner 也无法绕过。

CLI/Chrome 用例同时覆盖 createRequire 别名与间接 CommonJS 别名，两种模式均完成多页、两账户采集；新命令不命中不完整缓存，策略改变后认证失败并保留旧索引，旧实时快照在浏览器启动前被拒绝。

| 验证 | 结果 |
| --- | --- |
| pnpm test（含构建、真实服务/CLI/Chrome 集成） | Node 175、组件 70 通过 |
| pnpm type-check、pnpm format:check、git diff --check | 通过 |
| pnpm test:browser | 49 通过；100 页/150 连线 p95 38ms，原门槛 50ms |
| pnpm test:demo | 独立安装包手机/平板等 6 项通过 |

首轮唯一失败是新增配置服务测试目录缺少必需的 config.html，认证流程尚未运行；补齐 fixture 后全量重跑通过，未削弱断言。日志位于 `.runtime/cache-review4-fixes/`。

HEAD 仍为 `3b1d731`；未提交、推送或发布。

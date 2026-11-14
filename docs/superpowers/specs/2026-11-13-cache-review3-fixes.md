# createRequire 与模块 URL 解析修复

沿用审查中两个临时模块的复现证据，按 systematic-debugging 处理根因。保留当前未提交改动，不提交、推送或发布。

## 修复边界

- 认证依赖链导入 `node:module` 时保守禁用复用，包括命名别名、命名空间、动态字面量导入和间接依赖。静态 ESM 图无法覆盖 createRequire 的任意别名加载，不再将其标记为完整。仍支持新 CLI 进程执行真实采集；旧实时快照在浏览器启动前被拒绝。此方案不声称追踪任意 CommonJS 动态加载。
- 相对模块说明符使用 `new URL(specifier, pathToFileURL(file))` 与 `fileURLToPath` 解析，遵循 Node 文件 URL 解码规则。编码空格、中文、#、?、% 等文件名字符可正常参与依赖指纹；真正的 query/fragment 仍禁止复用。
- README 已说明上述边界。

## 回归与真实验收

新增单元用例验证多种 createRequire 导入形式均不具备完整指纹，以及编码文件名的 Node 实际导入、依赖变化和 query/fragment 拒绝。真实认证采集用例使用编码文件名的 helper，验证后续变化使旧缓存和实时快照失效。

新增真实 CLI/Chrome 用例连续启动独立进程：不变输入下动态加载器仍重新采集；helper 策略改变后执行新认证并失败，旧索引保持；实时快照在启动浏览器前拒绝。

| 验证 | 结果 |
| --- | --- |
| pnpm test（含构建、真实 CLI/Chrome 集成） | Node 172、组件 70 通过 |
| pnpm type-check、pnpm format:check、git diff --check | 通过 |
| pnpm test:browser | 49 通过；100 页面/150 连线 p95 48.8ms，原门槛 50ms |
| pnpm test:demo | 独立安装包手机/平板等 6 项通过 |

日志：`.runtime/cache-review3-fixes/`。本轮生产实现仅修改 `build-input.mjs`，同时补测试与文档。HEAD 保持 `3b1d731`，没有提交、推送或发布。

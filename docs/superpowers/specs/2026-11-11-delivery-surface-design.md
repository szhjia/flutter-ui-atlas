# Spec + 计划：delivery-surface · 交付面单一事实源

**模块**：`delivery-surface`（P1-6、P1-9）。持续授权推进；台账 `.superpowers/sdd/2026-11-11-delivery-surface/progress.md`。独立评审与 canvas-core-maint 合并做（同批落地）。

## 任务与验收

### A（P1-6）：viewer 包出口补 `./config`
- `packages/viewer/package.json` exports 增 `"./config": "./src/config.ts"`（createPreviewUrl/safeLink/readViewerSnapshot/readSourceFingerprint 与 ViewerSnapshot 类型随子路径可达）；协议「声明式 Viewer 外壳」补一句，README 嵌入段提及。
- 验收：契约测试 `tests/viewer-exports.test.mjs`——读 exports 表，逐项解析目标文件存在（同时锚定 `.` 与 `./model`）。

### B（P1-9）：打包清单消除双处维护 + 产物冒烟
- `scripts/pack-cli.mjs` 重构为可测：导出 `collectExternalImports(texts)`（裸说明符提取，跳过相对与 `node:`）与 `buildManifest(source, external)`（**engines 原样拷贝根 manifest（保留上界）**；dependencies 由扫描结果映射根 deps 自动生成；缺失依赖中文报错）；主流程加**冒烟**：npm pack 前在 stage 内跑 `node packages/cli/atlas.mjs --version` 并断言等于源版本。
- 验收：`tests/pack-cli.test.mjs`——helper 单测（提取规则、engines 拷贝含上界、缺依赖报错）+ 端到端（spawn 脚本到临时目录，退出码 0、tgz 生成；冒烟失败即脚本抛错）。files 字段与 stage 布局镜像关系保持，残余手工项（bin/files 结构字段）记台账说明。
- 边界：不新增运行时依赖；不做 tgz 安装级测试（stage 内冒烟已覆盖「产物可跑」本质）。

## 关卡
`pnpm type-check && pnpm test && pnpm test:browser`；验证记录 `docs/交付面验证记录.md`；能力地图更新。

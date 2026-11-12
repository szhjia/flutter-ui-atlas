# 普通商城 Demo 与标准 Atlas 接入验证记录

日期：2026-11-12。本轮已完成标准接入重构与下列验收；没有提交、推送或发布。

## 实现边界

- `demo/` 为普通 Flutter 工程，只有标准入口 `lib/main.dart`，没有 Atlas SDK、专用适配器、预览参数或外部状态注入。保留既有本地数据格式和存储键，两个账户购物车隔离。
- Atlas 仅读取项目配置并连接已启动的 Web 服务，不执行 Flutter 安装、编译或启动命令。根 `pnpm dev` 仅启动 Node／React 画布。
- 配置页管理应用、认证与账户；项目 `.atlas/atlas.yaml` 明确声明页面、步骤和视口。具名账户使用稳定 UUID 页面命名空间，匿名页面共享。
- `init` 安全合并工程根 `.gitignore` 的 `/.atlas/`，保留已有内容，不修改索引。配置、凭据、构建、失败报告和私有会话记录全部位于该目录。
- `build` 默认遍历所有视口，`--profile` 可选择单个；各视口独立保存最后成功图谱，失败视口不替换好图，整体返回非零。
- 快照固定配置与凭据；初次读配置与读取快照间、采集期间、发布前、实时打开前的变化均校验。最终 manifest 发布在配置锁内执行，并在原子替换前再次检查版本。私有版本校验信息不进入公开产物。
- 实时操作在工具独占 Chrome 中登录、准备与核验，服务端不接收客户端 URL 或凭据。替换、取消、迟到启动、手动关窗及服务退出均释放所属资源；不同 Viewer 的私有记录互不覆盖。旧 JSON／MJS、可选 SDK、iframe 与 v1 manifest 保留兼容。
- 公共卡片内部结构、信息、尺寸与样式未修改。旧生产 `scripts/shop-*` 编排已删除，商城资料和静态服务仅存在于测试 harness。

## 当前验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Flutter 静态检查与单元／组件测试 | analyze 无问题，16/16 | `.runtime/standard-flutter-analyze.log`、`standard-flutter-tests.log` |
| 独立纯 Demo 安装、测试与 Web 构建 | 通过 | `.runtime/pure-demo-copy-pub-get.log`、`pure-demo-copy-tests.log`、`pure-demo-local-build.log` |
| 完整 Node 回归（含真实 Chrome 工具集成） | 138/138 | `.runtime/standard-full-accepted.log` |
| 完整 Viewer／入口 Vitest | 60/60，13 个文件 | 同上 |
| 通用真实 Chrome 浏览器回归 | 30/30；位置边界修改后相关 3/3 复验 | `.runtime/standard-generic-browser.log`、`standard-route-browser-final.log` |
| 独立 Demo 与安装包标准链路 Chrome 验收 | 6/6，3.2 分钟 | `.runtime/pure-demo-standard-browser-r4.log` |
| 默认构建所有视口 | phone、pad 各 16 captured／21 observed／0 runtimeErrors | `.runtime/shop-test-results/` 中 phone 的 `build.log` |
| 显式 pad 构建与独立窗口操作 | 16 captured／21 observed；真实操作通过 | `.runtime/shop-verification/standard-pad/` |
| TypeScript、Vite 构建与变更文件格式 | 通过 | `.runtime/standard-types-final.log`、完整测试构建输出、`standard-changed-format-check.log` |

完整 Node 回归覆盖错误密码、停用账户、正文缺失、同路由无效操作、应用不可达、配置中途变化、部分视口失败保留好图、旧源码实时拒绝、同源错误入口、部署目录逃逸、中文前缀、私有权限与错误脱敏。会话测试还验证账户、视口、真实计数操作、独占 PID、取消期间最大一个资源和多 Viewer 清理边界。

## 独立接入证据

普通 Demo 复制到 `/private/tmp/pure-demo-20261112-green/shop_demo`，上层没有 Atlas 源码或 SDK 包；由项目侧执行 `flutter pub get`、`flutter test` 和普通 Web 构建。为避免外部 CanvasKit 不可达，最终使用 `flutter build web --release --no-web-resources-cdn --no-wasm-dry-run`，输出 `.runtime/pure-demo-web-local/`。Atlas 没有参与这一步。

随后测试再复制这份纯源码到独立临时工程，真实打包并通过 npm 安装 Atlas tarball，运行安装目录内的公开 CLI。CLI 子进程 PATH 只有 node、npm、git、sh，实际执行 `command -v flutter` 返回 1，证据在 `.runtime/pure-demo-no-flutter-path.log`。

链路按 `atlas init → atlas config → atlas build → atlas view` 执行，端到端没有调用内部采集 API：

1. 在新临时工程 `git init`，记录 15 个源文件、依赖与入口 SHA；初始化只合并 `.gitignore` 并生成 `.atlas/`。
2. 用真实配置页填写表单认证，分别录入、测试并保存 user1、user2；另验证错误密码、服务重启后恢复与删除。声明式流程由测试资料写入，配置页保存完整保留这些字段。
3. 默认 `atlas build` 构建 phone 393×852、pad 1024×768，各 16 状态、21 条真实操作；另用 `--profile pad` 验证单视口选择。
4. `atlas view` 展示真实截图；从 Viewer 打开独立 Chrome，实际加购、查看 69 元合计，切到 user2 验证空购物车，核对旧窗口关闭及新进程。手动关窗后私有记录删除，普通浏览器原 129 元购物车保持不变。
5. 修改正文判据使其缺失，公开 CLI 构建返回 1，上一份 manifest 字节保持不变，Viewer 仍展示好图。
6. 多次比较源码、依赖和入口 SHA，全部保持原样；`.gitignore` 严格只追加 `/.atlas/`，真实 `git check-ignore --no-index` 验证 YAML、凭据、截图、manifest 及会话记录，Git 索引保持为空。

成功图谱存于 `.runtime/shop-verification/standard-phone/`、`standard-pad/`。画布、真实窗口截图和构建日志存于 `.runtime/shop-test-results/`；临时操作工程及服务已由测试清理。

## TDD 与审查

各新增行为先观察失败，再实现并运行相关回归。RED 日志包括 `standard-snapshot-red.log`、`standard-catalog-red.log`、`capture-snapshot-red.log`、`live-snapshot-red.log`、`ready-not-red.log`、`locator-any-red.log`、`standard-boundaries-red.log`、`standard-entry-red.log`、`live-one-owner-red.log`、`route-prefix-red.log`、`unicode-prefix-red.log` 与 `thrown-redaction-red.log`。Demo 资料的错误选择器和专用路径也保留 RED 证据，未修改应用迎合采集。

独立代码审查发现并修复初读配置竞态、hash 入口路径、routePrefix 边界和迟到资源重叠；修复后继续补中文／空格前缀回归。相关定向日志 `.runtime/review-boundaries-green.log`，最终完整测试包含所有修复。

## 已知限制与全仓告警

- 全仓 `format:check` 仍报告 39 个既有文件格式问题，见 `.runtime/standard-global-format.log`；本轮变更文件单独检查通过。未扩散格式化到未修改文件，不宣称全部门禁通过。
- Vitest 的 JSDOM 会输出既有 canvas `getContext` 未实现提示；60 项测试通过，实际画布另外通过 Chrome 验证。
- Flutter Web 构建有 CupertinoIcons 字体提示但构建退出 0；本轮真实页面未出现运行错误。
- 本轮只验收 Web。未验证 iOS／Android 原生端；没有流程编辑器或自动探索，目录和步骤需明确配置。源码指纹不证明浏览器已加载对应构建，接入方仍须维护其 Web 服务版本。

## 历史证据

旧专用入口、场景参数和采集产物归档在 `.runtime/pre-standard-atlas/`，不参与本轮普通接入验收。此前旧架构的测试数字、地址和截图仅为历史，不作为本轮结果。

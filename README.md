# Flutter UI Atlas · Flutter 界面图谱

把真实 Flutter Web 页面整理为可查看截图、状态和导航连线的桌面画布，并由工具打开隔离的 Chrome 会话进行真实操作。Atlas 是独立开发工具，当前版本 `0.1.0`，公开 npm 包尚未发布。

Atlas 连接接入方已经启动的 Web 地址。CLI 不执行 Flutter 命令，不构建、不启动应用；应用开发、编译与发布由接入方自己的工具负责。接入普通 Flutter 工程无需专用入口、SDK、场景注入或修改组件内部契约。

声明式多账户采集与工具管理的实时会话已完成独立 Demo 验收。当前证据、全仓告警和验证范围见[商城 Demo 验证记录](docs/商城Demo验证记录.md)。

## 安装与接入

安装使用 `.nvmrc` 对应的 Node 与 `package.json` 对应的 pnpm；浏览器采集、登录测试和实时会话默认使用本机 Google Chrome。

```sh
# 在 Atlas 源码根目录生成并安装本地 CLI 包
pnpm install --frozen-lockfile
pnpm run pack:cli
npm install --global .runtime/packages/flutter-ui-atlas-0.1.0.tgz

# 在接入方 Flutter 工程根目录运行
atlas init
atlas config
# 在另一个终端用应用自己的方式启动 Flutter Web 后
atlas build
atlas view
# 有命名视口时：build 默认全部，view 默认首个
atlas build --profile phone
atlas view --profile pad
```

`init` 仅读取 `pubspec.yaml` 识别 Flutter 工程，生成本机 `.atlas/atlas.yaml` 和说明，并在工程根 `.gitignore` 中维护 `/.atlas/`。整个 `.atlas/` 包括 YAML、账户凭据、快照、截图、布局相关产物都属于本机数据，不应提交。重复初始化不会覆盖已有 YAML。忽略文件是符号链接或 `.atlas` 内已有 Git 跟踪文件时拒绝继续，请按提示自行处理；Atlas 不修改 Git 索引，不自动取消跟踪。

`atlas config` 打开本机配置页，可编辑应用地址、认证方式、账户与启停状态，并执行真实登录测试。账户 ID 为稳定 UUID，修改名称或 Tag 不改变身份。用户名与密码存入 `.atlas/local/credentials.json`，目录 0700、文件 0600；文件是受限明文，读取接口不返回密码。角色列表的启停影响后续采集，不删除已有图谱。

单入口可设置 `readyText`；留空只登记候选。多页面在 YAML 登记 `screens` 与 `edges`；命名视口使用 `profiles`，页面按 `screens[].roles` 选择账户，`prepare` 复现状态，`ready.all` 同时核对多项证据，`edges[].steps` 记录真实操作。密码不写入 YAML，也不通过模板进入截图公开配置。完整字段与兼容规则见[协议与适配接口](docs/协议与适配接口.md)。

配置页账户通过私有构建快照供采集与实时会话读取。批次使用固定配置、账户身份及凭据；配置或凭据变化使旧快照失效，不能把旧截图当成新配置的结果。页面身份以稳定账户 UUID 与 YAML 页面 ID 组合，改账户显示名不会丢失原页面布局。

结果默认写入 `.atlas/generated/`。采集失败保留上一批成功图谱，最近失败报告单独记录；只有真实操作、目标路由和内容同时成立，连线才标记为 `observed`。仅截图成功不能证明导航通过。Flutter 服务停止后仍能查看已有截图与连线，实时操作要求应用地址可用。

实时操作由 Atlas 在独立 Chrome 上下文中登录并准备选中页面，工具负责替换、取消和关闭会话。无需应用识别 `atlasSession` 或任何 Atlas 场景参数。旧 iframe／SDK 接入作为可选兼容方式保留，不作为普通应用的接入前提。

显式 `--config` 优先，否则读取 Flutter 工程 `.atlas/atlas.yaml`，再回退到旧 JSON／MJS 配置；可信 MJS 可通过 `adapterConfig` 引用。旧 `atlas capture` 兼容 `atlas build`。复杂录制仍由提供 `discovery` 的适配器支持，应用差异留在适配器中。

## 工程结构与画布开发

```text
packages/viewer/             React Flow 桌面画布
packages/capture/            通用浏览器采集器与适配协议
packages/cli/                初始化、配置、采集、查看与实时会话
packages/flutter_ui_atlas/   可选 Flutter 导航监听 SDK
demo/                       可独立复制运行的普通 Flutter 商城
tests/shop-browser/         商城真实浏览器测试与测试 harness
```

根目录开发入口只启动 Node／React 画布，无需 Flutter SDK：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

画布地址为 `http://127.0.0.1:60200/`。没有产物时展示待采集状态；已有截图和连线可以离线查看。开发画布不隐式构建、启动或采集 Demo。Viewer 仅面向桌面窗口，不新增手机端断点。

## 独立运行商城 Demo

`demo/` 是普通 Flutter 工程，只有 `lib/main.dart`，有自己的 pubspec、锁文件、素材与测试。可将整个目录复制到其他位置，使用标准 Flutter 工具运行；它不依赖 Atlas SDK、专用入口或 Atlas 生产运行脚本。

```sh
cd demo
flutter pub get
flutter run -d web-server --web-hostname 127.0.0.1 --web-port 60210
# 测试与构建同样在 demo 目录运行
flutter analyze
flutter test
flutter build web --no-web-resources-cdn --no-wasm-dry-run
```

演示账户为 `user1`、`user2`，密码均为 `1234.com`，权限相同。这些仅属于独立 Demo。先登录再进入首页、商城、我的；6 个本地商品均有详情，购物车支持增减、删除与整数分合计。各账户购物车保存在当前浏览器，刷新恢复登录，退出保留购物车；我的页面可确认后重置演示数据。没有后端、订单、支付或真实交易。

应用宽度小于 720 逻辑像素使用底部导航，其余使用侧边导航；基准采集视口为 phone 393×852、pad 1024×768。接入 Atlas 时按普通工程执行 `atlas init`、在配置页设置演示账户、用 YAML 描述页面和操作。[商城声明资料](tests/helpers/shop-catalog.yaml)可供参考；合并流程字段时保留配置页保存的应用、认证与账户。生产 `scripts/shop-*` 专用编排路径已退出当前方案，测试 harness 仅供验收使用。

旧专用入口的编译和采集产物已归档至 `.runtime/pre-standard-atlas/`，不能作为普通 Demo 本轮采集或实时会话通过的证据。

## 接入与维护边界

- 应用页面变化后，先由接入方让 Web 服务加载新代码，再重新采集、刷新画布。磁盘源码指纹不能证明浏览器加载的构建版本。
- 新增页面至少提供稳定 ID、入口、路由、确定样本和就绪条件；动态详情、空态与身份差异需要明确样本，不能靠猜测路由覆盖。
- 登录、数据准备和自定义路由通过通用声明式步骤或可信本地 MJS 适配器完成。默认地址限回环，远程开发服务需显式 `allowRemoteUrls: true`。
- 嵌入 Viewer 可使用 `AtlasViewerAdapter`；结果、预览及源码指纹由宿主提供。可选 `AtlasNavigatorObserver` 只监听命名 Navigator 路由，不代表存在通用 go_router 插件。
- 普通应用无需导入 SDK。已有独立开发入口的 SDK 和 iframe 预览仍可按兼容协议使用；不要求修改原生宿主或 UI 公共组件。

## 自由画布

拖动只推动附近未锁定页面；锁定或筛选隐藏的页面作为固定障碍。空间不足恢复整次拖动，Esc 取消，撤销／重做以手势为单位。方向键移动 10 个画布单位，⌘／Ctrl Z 撤销，Shift Z 重做。

整理可见页面先确认影响范围；筛选、刷新和截图尺寸变化不自动全局重排。布局通过稳定 `layoutKey` 与页面 ID 保存，每种视口使用不同 key，同一视口跨采集批次复用。另一窗口更新只提示；损坏或未知存储不覆盖原数据。详情见[自由画布验证记录](docs/自由画布验证记录.md)。

## 验证

```sh
pnpm type-check
pnpm test
pnpm build
pnpm test:browser
# demo 目录内：flutter analyze、flutter test、flutter build web
# 可选 SDK 目录内：flutter test、flutter analyze --no-pub
```

本轮通过 16 项 Flutter、138 项 Node、60 项 Vitest、30 项通用 Chrome 和 6 项独立 Demo Chrome 验收，默认构建两视口各 16 状态／21 条操作。全仓格式检查仍有既有告警，变更文件检查通过；当前结果与历史证据见[商城 Demo 验证记录](docs/商城Demo验证记录.md)。Web 验证不替代 iOS／Android 验收。

# Flutter UI Atlas · Flutter 界面图谱

把真实 Flutter 页面放进全局画布，查看页面状态、导航连线、采集截图，并进入真实 Web 页面操作。独立开发工具，当前版本 `0.1.0`，本地使用，尚未发布 npm/pub 包。

## 工程结构

```text
packages/viewer/             React Flow 画布，可嵌入其他开发工作台
packages/capture/            浏览器采集器、声明式适配器与 BrowserAdapter 接口
packages/cli/                本地 capture 与 view 命令
packages/flutter_ui_atlas/   可选 Flutter 导航、场景与就绪接口
examples/flutter_app/       独立 Flutter 应用，普通入口与 Atlas 入口分离
examples/capture.mjs        独立应用的浏览器适配器与采集入口
examples/verify-viewer.mjs  真实浏览器验收
docs/协议与适配接口.md       协议、证据含义和适配边界
tests/                      采集器失败路径与目录契约测试
```

通用工程没有寓科账号、路由、数据库、测试 fixture 或端口依赖。寓科只是工具的一个外部使用方。

## 运行独立示例

本轮验证工具链为 Node 26.12.1（见 `.nvmrc`）、pnpm 10.33.0（见 `packageManager`）和已安装的 Google Chrome。构建独立 Flutter 示例还需 Flutter SDK。配置文件中的端口可以替换；已有服务可复用，端口冲突时启动失败。

```sh
rtk proxy pnpm install --frozen-lockfile

# 终端一，从 examples/flutter_app 目录运行
rtk proxy flutter pub get
rtk proxy flutter build web --debug --no-web-resources-cdn --target lib/main.dart
rtk proxy python3 -m http.server 60210 --bind 127.0.0.1 --directory build/web

# 终端二，从 Atlas 工程根目录运行
rtk proxy pnpm atlas capture --config examples/atlas.config.json
rtk proxy pnpm atlas view --config examples/atlas.config.json
```

打开 `http://127.0.0.1:60200/`。示例使用普通 `main.dart` 构建，配置在 [examples/atlas.config.json](examples/atlas.config.json)。产物默认写到配置所在目录的 `.atlas/generated/`。用 `output` 可继续读取已有的 v1 采集目录。失败时当前地图继续指向最近一次成功采集，画布提示最近失败并提供报告。

## 接入其他 Flutter Web 应用

复制示例 JSON 到项目自己的开发工具目录，配置 `baseUrl`、页面 ID、路由和能区分页面状态的可见内容。使用 `routeMode: "pathname"` 支持路径路由。需要复现的页面操作通过连线的 `click` 登记；省略时只展示声明关系。启动项目自身的 Web 服务，再运行 Atlas 两条命令。可从任意目录使用 `rtk proxy pnpm --dir <Atlas目录> atlas capture --config <配置绝对路径>`，或直接用 Node 执行 `packages/cli/index.mjs`。

登录、数据准备或自定义路由可使用可信本地 `.mjs` 配置。默认导出含 `adapter`、`output` 等设置的对象，选填 `previewUrls` 为按页面 ID 索引的 HTTP(S) 地址。没有地址时，独立画布仍支持截图和关系查看。适配接口、判据和配置字段见 [协议与适配接口](docs/协议与适配接口.md)。

嵌入已有开发工作台时，宿主通过本地 `link:` 引用 `packages/viewer`，并在 Vite 配置中去重 React、React DOM 和 React Flow。向 `AtlasViewerAdapter` 提供结果加载，并按需提供预览地址、最近尝试、源码指纹和会话隔离能力。独立画布和嵌入方式都复用同一 manifest。

需要 Flutter 内部导航事件时，在 `dev_dependencies` 引入 `packages/flutter_ui_atlas`，由独立 `main_atlas.dart` 组装 `AtlasNavigatorObserver` 或自定义 `AtlasNavigationAdapter`。业务应用的普通入口可以继续独立运行。

## 页面变化后怎样维护

- 已登记页面的 UI 改变：先确保 Flutter 服务加载新代码，然后重新运行项目采集入口；画布点击“刷新采集结果”。
- 新增页面或状态：在应用侧目录增加稳定 ID、入口、路由、内容就绪条件及样本；工具自动形成节点，无须改画布代码。
- 新增跳转：登记 source、target、action，适配器执行实际点击。未提供操作适配时显示“声明关系，未验证”。
- 动态详情、登录身份、空数据：作为不同样本登记；不会通过猜测路由自动获得全部覆盖。
- 开关：不启动工具、不运行采集入口，产品仍按原入口工作；专用 Flutter 开发入口按需启用。

## 验证命令

```sh
rtk proxy pnpm type-check
rtk proxy pnpm test
rtk proxy pnpm build
rtk proxy pnpm test:browser
rtk proxy node examples/verify-viewer.mjs http://127.0.0.1:60200/
# packages/flutter_ui_atlas 目录
rtk proxy flutter test
rtk proxy flutter analyze --no-pub
```

浏览器验收证据保存在 `.runtime/`，采集截图保存在配置的产物目录。当前已有 Navigator 独立示例和外部自定义 Router 应用接入，见[配置化接入验证记录](docs/配置化接入验证记录.md)。自动热重载采集、增量依赖分析、构建版本握手与 go_router 专用插件仍未实现。

## 自由画布

- 拖动页面时只推动附近未锁定页面；锁定或被筛选隐藏的页面是固定障碍。空间不足会恢复整次拖动。按 Esc 取消，撤销／重做以整次手势为单位。
- 页面标题右侧圆点切换锁定；锁定后仍可选中、查看截图和实时预览。方向键移动选中页 10 个画布单位，⌘／Ctrl Z 撤销，Shift Z 重做。
- “整理可见页面”先显示影响数量，确认后只整理可见、未锁定页。筛选、刷新和截图尺寸变化不触发全局重排；尺寸变化造成的冲突会明确提示。
- 连线绕开页面，文字为独立白底标签；缩放低于45%时收起普通标签，选中页面或关系仍能查看。空间不足显示省略入口，完整操作名和验证状态保留在详情中。
- 接入方设置 `layoutKey`（例如 `my-app:phone-393x852:v1`）启用本机浏览器布局保存。标识应包含应用、截图视口及布局版本，不能使用每批变化的 captureId。未设置时只在会话中保存。
- 另一窗口更新布局只提示，不自动覆盖当前操作；可手动载入或保留当前布局。损坏、未知版本或存储受限时不覆盖旧数据，并显示告警。

实现与验收见 [自由画布验证记录](docs/自由画布验证记录.md)。组件树、组件配色详情仍留待后续设计。

## 自动发现和流程录制

自动模式使用独立的 `discovery` 配置与产物目录。启动上文的 Flutter Web 示例后，在 Atlas 根目录执行：

```sh
rtk proxy pnpm atlas capture --config examples/atlas-discovery.mjs
rtk proxy pnpm atlas record --config examples/atlas-discovery.mjs
rtk proxy pnpm atlas record --config examples/atlas-discovery.mjs --journeys
rtk proxy pnpm atlas view --config examples/atlas-discovery.mjs
```

手动录制从应用入口打开隔离 Chrome，操作完成后在终端按回车。普通路由候选由项目适配器从已有定义派生。Atlas 对实际到达、内容就绪的页面截图，对已确认的真实操作生成连线。新候选和缺少复现数据的候选显示为「待采集」。独立画布实时预览需要应用服务继续运行。

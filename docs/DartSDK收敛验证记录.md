# Dart SDK 收敛验证记录（2026-11-11）

对应能力模块 `dart-sdk-scope`（台账：`.superpowers/sdd/2026-11-11-dart-sdk-scope/progress.md`）。关闭评审 P2-5（三接口零消费预付抽象）、P2-6（SDK 测试单薄）。

## 变更与证据

| 项 | 变更 | 验证 |
|---|---|---|
| 公开面收缩（P2-5） | `lib/flutter_ui_atlas.dart` 仅导出 `AtlasNavigatorObserver`；`AtlasLocation` 与三个规划接口移入 `lib/src/navigation.dart` 休眠（等真实接入方验证后重新导出） | 公开面锚定用例（observer 可构造、src 契约可编译实现）；协议「Flutter 可选注入」与 README 改写 |
| SDK 测试（P2-6） | observer 测试 1 → 5：初始路由启动即上报、未命名路由不上报、didReplace 上报新路由、didRemove 保持沉默、公开面锚定 | `flutter test` 5/5 |
| 兼容性 | 示例应用 `main_atlas.dart` 仅用 observer，不受收缩影响 | `flutter analyze --no-pub` 两处均 0 issues |

## 环境说明

- 本机原无 Flutter SDK（登录 shell/rc/brew/asdf/fvm 全查确认），经用户授权 `brew install --cask flutter` 安装 **3.47.9**（stable，Dart 3.13.7，`/opt/homebrew/bin/flutter`）——模块由 blocked 转完成。
- 验证命令：`cd packages/flutter_ui_atlas && flutter test && flutter analyze --no-pub`；示例应用同（examples/flutter_app）。

# 拾物商城 Demo

本目录是独立的 Flutter 工程，入口为 `lib/main.dart`。可将整个目录复制到其他位置，使用 Flutter SDK 开发、测试和构建。

```sh
# 在 demo 目录中执行
flutter pub get
flutter run -d web-server --web-hostname 127.0.0.1 --web-port 60210
flutter analyze
flutter test
flutter build web --no-web-resources-cdn --no-wasm-dry-run
```

账户 `user1`、`user2`，密码均为 `1234.com`。支持手机和平板布局、登录退出、商品详情、购物车、本地保存与重置，无业务后端。

两个账户的购物车独立保存在当前浏览器中，刷新后恢复；退出登录保留购物车。重置演示数据会清空两个账户的购物车并退出登录。

Web 构建产物位于 `build/web/`。

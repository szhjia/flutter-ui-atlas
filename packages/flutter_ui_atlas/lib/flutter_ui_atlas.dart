library;

import 'package:flutter/widgets.dart';

/// 监听命名 Navigator 页面。不会推测 IndexedStack、业务权限或动态样本。
/// 这是 Dart SDK 当前的全部公开面；规划中的导航/场景/就绪接口见 lib/src/navigation.dart（未导出）。
class AtlasNavigatorObserver extends NavigatorObserver {
  AtlasNavigatorObserver(this.onLocation);
  final ValueChanged<String> onLocation;

  void _report(Route<dynamic>? route) {
    final name = route?.settings.name;
    if (name != null) onLocation(name);
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => _report(route);
  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _report(previousRoute);
  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) => _report(newRoute);
  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    // 删除非栈顶页面不能推断当前页；调用方可用自定义导航适配器报告状态。
  }
}

library;

import 'dart:async';
import 'package:flutter/widgets.dart';

/// 由应用决定稳定状态 ID，避免同一路由的不同数据状态被合并。
class AtlasLocation {
  const AtlasLocation({required this.screenId, required this.route});
  final String screenId;
  final String route;
}

abstract interface class AtlasNavigationAdapter {
  AtlasLocation get current;
  Stream<AtlasLocation> get changes;
  Future<void> open(String screenId);
}

abstract interface class AtlasScenarioProvider {
  Future<void> prepare(String scenarioId);
  Future<void> reset();
}

abstract interface class AtlasReadinessProbe {
  Future<void> waitUntilReady(String screenId);
}

/// 监听命名 Navigator 页面。不会推测 IndexedStack、业务权限或动态样本。
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

// 规划中的接入方契约草案：2026-11-11 收缩公开面时移出库导出（评审 P2-5，三接口零消费者）。
// 保留在 src/ 内休眠编译，等第一个真实接入方出现并验证后再经 flutter_ui_atlas.dart 重新导出。
import 'dart:async';

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

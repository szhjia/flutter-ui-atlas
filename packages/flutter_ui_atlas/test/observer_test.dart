import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_ui_atlas/flutter_ui_atlas.dart';
import 'package:flutter_ui_atlas/src/navigation.dart';

void main() {
  testWidgets('命名页面 push 与 pop 报告当前页面', (tester) async {
    final seen = <String>[];
    final key = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(navigatorKey: key,
      navigatorObservers: [AtlasNavigatorObserver(seen.add)],
      routes: {'/': (_) => const Text('首页'), '/detail': (_) => const Text('详情')},
    ));
    key.currentState!.pushNamed('/detail');
    await tester.pumpAndSettle();
    expect(seen.last, '/detail');
    key.currentState!.pop();
    await tester.pumpAndSettle();
    expect(seen.last, '/');
  });

  testWidgets('初始路由在启动时即上报', (tester) async {
    final seen = <String>[];
    await tester.pumpWidget(MaterialApp(
      navigatorObservers: [AtlasNavigatorObserver(seen.add)],
      routes: {'/': (_) => const Text('首页')},
    ));
    expect(seen.first, '/');
  });

  testWidgets('未命名路由不上报', (tester) async {
    final seen = <String>[];
    final key = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(navigatorKey: key,
      navigatorObservers: [AtlasNavigatorObserver(seen.add)],
      routes: {'/': (_) => const Text('首页')},
    ));
    final before = seen.length;
    key.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Text('匿名页')));
    await tester.pumpAndSettle();
    expect(seen.length, before, reason: '未命名路由（settings.name 为 null）不应上报');
  });

  testWidgets('didReplace 上报新路由，didRemove 保持沉默', (tester) async {
    final seen = <String>[];
    final key = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(navigatorKey: key,
      navigatorObservers: [AtlasNavigatorObserver(seen.add)],
      routes: {'/': (_) => const Text('首页'), '/a': (_) => const Text('A'), '/b': (_) => const Text('B')},
    ));
    key.currentState!.pushNamed('/a');
    await tester.pumpAndSettle();
    key.currentState!.pushReplacementNamed('/b');
    await tester.pumpAndSettle();
    expect(seen.last, '/b', reason: 'replace 应上报新路由');

    key.currentState!.pushNamed('/a');
    await tester.pumpAndSettle();
    final removed = MaterialPageRoute<void>(
      settings: const RouteSettings(name: '/stack'),
      builder: (_) => const Text('栈顶'),
    );
    key.currentState!.push(removed);
    await tester.pumpAndSettle();
    final beforeRemove = seen.length;
    key.currentState!.removeRoute(removed);
    await tester.pumpAndSettle();
    expect(seen.length, beforeRemove, reason: '移除页面不能推断当前页，应保持沉默');
  });

  test('收缩后的公开面：observer 可用，规划接口仅存于 src/（休眠待真实接入方）', () {
    final observer = AtlasNavigatorObserver((_) {});
    expect(observer, isA<NavigatorObserver>());
    // 三个规划接口移入 lib/src/navigation.dart 后仍可编译实现（未来接入方的契约草案）。
    final AtlasLocation location = AtlasLocation(screenId: 'home', route: '/home');
    expect(location.screenId, 'home');
  });
}

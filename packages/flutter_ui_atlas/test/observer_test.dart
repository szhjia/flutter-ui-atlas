import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_ui_atlas/flutter_ui_atlas.dart';

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
}

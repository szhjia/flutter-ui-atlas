import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shop_demo/app.dart';
import 'package:shop_demo/store.dart';

void main() {
  for (final width in [393.0, 719.0, 720.0, 1024.0]) {
    testWidgets('宽度 $width 使用对应导航，详情和购物车可操作', (tester) async {
      tester.view.physicalSize = Size(width, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = await ShopStore.load(MemoryShopStorage());
      await store.login('user1', '1234.com');
      await tester.pumpWidget(ShopApp(store: store, initialLocation: '/shop'));
      await tester.pumpAndSettle();
      expect(
        find.byType(NavigationBar),
        width < 720 ? findsOneWidget : findsNothing,
      );
      expect(
        find.byType(NavigationRail),
        width >= 720 ? findsOneWidget : findsNothing,
      );
      await tester.tap(find.byKey(const Key('product-cup')));
      await tester.pumpAndSettle();
      final art = tester.getRect(find.byType(ProductArt));
      final name = tester.getRect(find.text('轻量随行杯'));
      if (width < 720) {
        expect(name.top, greaterThan(art.bottom));
      } else {
        expect(name.left, greaterThan(art.right));
      }
      await tester.tap(find.text('加入购物车'));
      await tester.pumpAndSettle();
      expect(store.cart, {'cup': 1});
      await tester.tap(find.byTooltip('打开购物车'));
      await tester.pumpAndSettle();
      expect(find.text('合计 ¥69.00'), findsOneWidget);
      await tester.tap(find.byTooltip('增加轻量随行杯数量'));
      await tester.pumpAndSettle();
      expect(find.text('合计 ¥138.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('未登录深链受保护，登录错误可恢复，退出后受保护页面消失', (tester) async {
    final store = await ShopStore.load(MemoryShopStorage());
    await tester.pumpWidget(ShopApp(store: store, initialLocation: '/cart'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(find.text('账号或密码错误'), findsNothing);
    await tester.enterText(find.byKey(const Key('username')), 'user1');
    await tester.enterText(find.byKey(const Key('password')), 'wrong');
    await tester.tap(find.text('登录'));
    await tester.pumpAndSettle();
    expect(find.text('账号或密码错误'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('password')), '1234.com');
    await tester.tap(find.text('登录'));
    await tester.pumpAndSettle();
    expect(store.account, 'user1');
    await tester.tap(find.text('我的').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('退出登录'));
    await tester.pumpAndSettle();
    expect(store.account, isNull);
    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('账号或密码错误'), findsNothing);
  });
}

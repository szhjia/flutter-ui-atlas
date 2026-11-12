import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shop_demo/app.dart';
import 'package:shop_demo/store.dart';

void main() {
  for (final width in [393.0, 719.0, 720.0, 1024.0]) {
    testWidgets('Navigation, product details, and cart work at width $width', (
      tester,
    ) async {
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
      final name = tester.getRect(find.text('Travel cup'));
      if (width < 720) {
        expect(name.top, greaterThan(art.bottom));
      } else {
        expect(name.left, greaterThan(art.right));
      }
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      expect(store.cart, {'cup': 1});
      await tester.tap(find.byTooltip('Open cart'));
      await tester.pumpAndSettle();
      expect(find.text('Total ¥69.00'), findsOneWidget);
      await tester.tap(find.byTooltip('Increase Travel cup quantity'));
      await tester.pumpAndSettle();
      expect(find.text('Total ¥138.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'Deep links require sign-in, failed sign-in can recover, and sign-out hides protected pages',
    (tester) async {
      final store = await ShopStore.load(MemoryShopStorage());
      await tester.pumpWidget(ShopApp(store: store, initialLocation: '/cart'));
      await tester.pumpAndSettle();
      expect(find.byType(TextFormField), findsNWidgets(2));
      expect(find.text('Incorrect username or password'), findsNothing);
      await tester.enterText(find.byKey(const Key('username')), 'user1');
      await tester.enterText(find.byKey(const Key('password')), 'wrong');
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('Incorrect username or password'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('password')), '1234.com');
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();
      expect(store.account, 'user1');
      await tester.tap(find.text('Profile').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(store.account, isNull);
      expect(find.byType(TextFormField), findsNWidgets(2));
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.text('Incorrect username or password'), findsNothing);
    },
  );
}

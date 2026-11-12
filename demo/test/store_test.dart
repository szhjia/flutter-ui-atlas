import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:shop_demo/store.dart';

void main() {
  test('两个账户登录、退出及购物车独立保存，刷新恢复', () async {
    final storage = MemoryShopStorage();
    final store = await ShopStore.load(storage);
    expect(await store.login('user1', 'wrong'), false);
    expect(store.account, isNull);
    expect(await store.login('user1', '1234.com'), true);
    await store.add('cup');
    await store.add('cup');
    expect(store.totalCents, 13800);
    await store.logout();
    expect(store.quantity, 0);
    await store.login('user2', '1234.com');
    expect(store.quantity, 0);
    await store.add('bag');
    final restored = await ShopStore.load(storage);
    expect(restored.account, 'user2');
    expect(restored.quantity, 1);
    await restored.logout();
    await restored.login('user1', '1234.com');
    expect(restored.cart, {'cup': 2});
    await restored.change('cup', -1);
    expect(restored.cart, {'cup': 1});
    await restored.remove('cup');
    expect(restored.totalCents, 0);
  });

  test('未登录不能加购，未知商品拒绝，数量限制 1 到 99', () async {
    final store = await ShopStore.load(MemoryShopStorage());
    expect(() => store.add('cup'), throwsStateError);
    await store.login('user1', '1234.com');
    expect(() => store.add('missing'), throwsArgumentError);
    await store.change('cup', -1);
    expect(store.quantity, 0);
    for (var i = 0; i < 102; i++) {
      await store.add('cup');
    }
    expect(store.cart['cup'], 99);
    expect(store.totalCents, 683100);
  });

  test('重置只清除本应用数据并结束登录', () async {
    final storage = MemoryShopStorage();
    final store = await ShopStore.load(storage);
    await store.login('user1', '1234.com');
    await store.add('cup');
    await store.reset();
    expect(store.account, isNull);
    await store.login('user1', '1234.com');
    expect(store.cart, isEmpty);
    expect(jsonDecode(storage.value!)['version'], 1);
  });

  test('快速操作按顺序写入，保存失败保留内存并支持重试', () async {
    final storage = FailingStorage();
    final store = await ShopStore.load(storage);
    await store.login('user1', '1234.com');
    await Future.wait([store.add('cup'), store.add('bag'), store.logout()]);
    final restored = await ShopStore.load(storage);
    expect(restored.account, isNull);
    await restored.login('user1', '1234.com');
    expect(restored.quantity, 2);
    storage.fail = true;
    await store.login('user1', '1234.com');
    await store.add('cup');
    expect(store.quantity, 3);
    expect(store.warning, contains('保存失败'));
    storage.fail = false;
    await store.retrySave();
    expect(store.warning, isNull);
    expect((await ShopStore.load(storage)).quantity, 3);
  });

  test('读取失败不覆盖磁盘数据，重置后恢复保存', () async {
    final storage = UnreadableStorage();
    final store = await ShopStore.load(storage);
    expect(store.warning, contains('读取失败'));
    await store.login('user1', '1234.com');
    expect(storage.value, isNull);
    storage.fail = false;
    await store.reset();
    expect(store.warning, isNull);
    expect((await ShopStore.load(storage)).account, isNull);
  });

  for (final value in [
    '{bad',
    '{"version":9}',
    '{"version":1,"account":"unknown","carts":{}}',
    '{"version":1,"account":"user1","carts":{"user1":{"cup":100}}}',
    '{"version":1,"account":null,"carts":{"user2":{"missing":1}}}',
  ]) {
    test('损坏数据保留原值并暂停自动覆盖：$value', () async {
      final storage = MemoryShopStorage()..value = value;
      final store = await ShopStore.load(storage);
      expect(store.warning, contains('损坏'));
      await store.login('user1', '1234.com');
      await store.add('cup');
      expect(storage.value, value);
      await store.reset();
      expect(store.warning, isNull);
      expect((await ShopStore.load(storage)).account, isNull);
    });
  }
}

class FailingStorage extends MemoryShopStorage {
  bool fail = false;
  @override
  Future<void> write(String value) async {
    await Future<void>.delayed(const Duration(milliseconds: 1));
    if (fail) throw StateError('模拟磁盘失败');
    await super.write(value);
  }
}

class UnreadableStorage extends MemoryShopStorage {
  bool fail = true;
  @override
  Future<String?> read() async {
    if (fail) throw StateError('模拟读取失败');
    return super.read();
  }
}

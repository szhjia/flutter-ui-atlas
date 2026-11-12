import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'products.dart';

abstract interface class ShopStorage {
  Future<String?> read();
  Future<void> write(String value);
}

class MemoryShopStorage implements ShopStorage {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String value) async {
    this.value = value;
  }
}

class LocalShopStorage implements ShopStorage {
  final _preferences = SharedPreferencesAsync();
  static const key = 'atlas.shop.v1';
  @override
  Future<String?> read() => _preferences.getString(key);
  @override
  Future<void> write(String value) => _preferences.setString(key, value);
}

class ShopStore extends ChangeNotifier {
  ShopStore._(this.storage);
  final ShopStorage storage;
  static const accounts = ['user1', 'user2'];
  String? _account;
  String? get account => _account;
  final Map<String, Map<String, int>> _carts = {};
  String? warning;
  bool _blocked = false;
  Future<void> _writes = Future.value();

  static Future<ShopStore> load(ShopStorage storage) async {
    final store = ShopStore._(storage);
    String? raw;
    try {
      raw = await storage.read();
    } catch (_) {
      store._blocked = true;
      store.warning = '本地数据读取失败，已暂停保存。可继续临时使用，或重置演示数据后重试。';
      return store;
    }
    if (raw == null) return store;
    try {
      final data = jsonDecode(raw);
      if (data is! Map ||
          data['version'] != 1 ||
          (data['account'] != null && !accounts.contains(data['account'])) ||
          data['carts'] is! Map) {
        throw const FormatException();
      }
      final carts = <String, Map<String, int>>{};
      for (final entry in (data['carts'] as Map).entries) {
        if (!accounts.contains(entry.key) || entry.value is! Map) {
          throw const FormatException();
        }
        final cart = <String, int>{};
        for (final item in (entry.value as Map).entries) {
          if (item.key is! String ||
              findProduct(item.key) == null ||
              item.value is! int ||
              item.value < 1 ||
              item.value > 99) {
            throw const FormatException();
          }
          cart[item.key] = item.value;
        }
        carts[entry.key] = cart;
      }
      store._account = data['account'];
      store._carts.addAll(carts);
    } catch (_) {
      store._blocked = true;
      store.warning = '本地数据损坏，已保留原数据并暂停保存。可临时使用，或重置演示数据。';
    }
    return store;
  }

  Map<String, int> get cart => Map.unmodifiable(_carts[_account] ?? {});
  int get quantity => cart.values.fold(0, (sum, value) => sum + value);
  int get totalCents => cart.entries.fold(
    0,
    (sum, item) => sum + findProduct(item.key)!.priceCents * item.value,
  );

  Future<bool> login(String username, String password) async {
    if (!accounts.contains(username) || password != '1234.com') return false;
    _account = username;
    await _save();
    return true;
  }

  Future<void> logout() {
    _account = null;
    return _save();
  }

  Future<void> add(String id) => change(id, 1);
  Future<void> change(String id, int delta) {
    if (_account == null) throw StateError('请先登录');
    if (findProduct(id) == null) throw ArgumentError.value(id, 'id', '商品不存在');
    final cart = _carts.putIfAbsent(_account!, () => {});
    final next = ((cart[id] ?? 0) + delta).clamp(0, 99);
    if (next == 0) {
      cart.remove(id);
    } else {
      cart[id] = next;
    }
    return _save();
  }

  Future<void> remove(String id) {
    if (_account == null) throw StateError('请先登录');
    _carts[_account]?.remove(id);
    return _save();
  }

  Future<void> reset() {
    _account = null;
    _carts.clear();
    _blocked = false;
    return _save();
  }

  Future<void> retrySave() => _save();

  Future<void> _save() {
    final snapshot = jsonEncode({
      'version': 1,
      'account': _account,
      'carts': _carts,
    });
    notifyListeners();
    if (_blocked) return Future.value();
    // 在排队前捕获快照，快速加购、切换账户及退出也遵循操作顺序。
    _writes = _writes.then((_) async {
      try {
        await storage.write(snapshot);
        warning = null;
      } catch (_) {
        warning = '本地保存失败，当前操作仍在内存中。请重试保存后再刷新。';
      }
      notifyListeners();
    });
    return _writes;
  }
}

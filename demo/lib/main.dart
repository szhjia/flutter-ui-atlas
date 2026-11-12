import 'package:flutter/material.dart';
import 'app.dart';
import 'store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await ShopStore.load(LocalShopStorage());
  runApp(ShopApp(store: store));
}

import 'package:flutter/widgets.dart';
import 'package:flutter_ui_atlas/flutter_ui_atlas.dart';
import 'main.dart';

// SDK 仅由专用入口导入；普通 main.dart 和原生宿主不依赖工具。
void main() {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  binding.ensureSemantics();
  runApp(ExampleApp(observers: [AtlasNavigatorObserver((route) {
    debugPrint('ATLAS_LOCATION:$route');
  })]));
}

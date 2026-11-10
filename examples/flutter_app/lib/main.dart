import 'package:flutter/material.dart';

void main() => runApp(const ExampleApp());

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key, this.observers = const []});
  final List<NavigatorObserver> observers;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Atlas 示例',
    debugShowCheckedModeBanner: false,
    navigatorObservers: observers,
    theme: ThemeData(colorSchemeSeed: Colors.blue, fontFamily: 'NotoSansSC'),
    routes: {
      '/': (context) => const ExamplePage(title: '欢迎', next: '/home', action: '进入示例'),
      '/home': (context) => const ExamplePage(title: '项目列表', next: '/detail', action: '查看详情'),
      '/detail': (context) => const ExamplePage(title: '项目详情', next: '/settings', action: '打开设置'),
      '/settings': (context) => const ExamplePage(title: '偏好设置'),
    },
  );
}

class ExamplePage extends StatelessWidget {
  const ExamplePage({super.key, required this.title, this.next, this.action});
  final String title;
  final String? next;
  final String? action;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: Padding(padding: const EdgeInsets.all(24), child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.map_outlined, size: 72),
        const SizedBox(height: 28),
        Text(title, style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 16),
        const Text('这是独立 Flutter 应用的真实页面。目录、截图和连线通过适配接口接入 UI Atlas。'),
        const SizedBox(height: 24),
        if(next != null) FilledButton(onPressed: () => Navigator.of(context).pushNamed(next!), child: Text(action!)),
        if(next == null) const SwitchListTile(value: true, onChanged: null, title: Text('示例通知')),
      ],
    )),
  );
}

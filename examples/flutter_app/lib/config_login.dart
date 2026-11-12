import 'package:flutter/material.dart';

/// 独立登录验收入口：不影响现有四页面示例，也不需要原生宿主改动。
void main() => runApp(const MaterialApp(home: ConfigLoginExample()));

class ConfigLoginExample extends StatefulWidget {
  const ConfigLoginExample({super.key});
  @override
  State<ConfigLoginExample> createState() => _ConfigLoginExampleState();
}

class _ConfigLoginExampleState extends State<ConfigLoginExample> {
  final username = TextEditingController();
  final password = TextEditingController();
  bool loggedIn = false;
  bool failed = false;

  @override
  void dispose() {
    username.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Atlas 独立登录示例')),
    body: Center(child: SizedBox(width: 360, child: Padding(
      padding: const EdgeInsets.all(24),
      child: loggedIn ? Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('登录成功'),
        Text('当前账号：${username.text}'),
        FilledButton(onPressed: () => setState(() { loggedIn = false; failed = false; }), child: const Text('退出登录')),
      ]) : Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: username, decoration: const InputDecoration(labelText: '登录账号')),
        const SizedBox(height: 16),
        TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: '登录密码')),
        const SizedBox(height: 24),
        FilledButton(onPressed: () => setState(() {
          loggedIn = username.text == 'reader@example.test' && password.text == 'atlas-example';
          failed = !loggedIn;
        }), child: const Text('登录')),
        if (failed) const Padding(padding: EdgeInsets.only(top: 16), child: Text('账号或密码错误')),
      ]),
    ))),
  );
}
